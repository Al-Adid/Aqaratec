import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import { ContentPresetPicker } from "@/components/app/ContentPresetPicker";
import { RoomLayoutFields } from "@/components/app/RoomLayoutFields";
import { TenancyFields } from "@/components/app/TenancyFields";
import { UnitBulkFillPanel } from "./UnitBulkFillPanel";
import { getTenancySummary } from "@/lib/tenancy-information";
import {
  updateMatchedUnits,
  type UnitMatchRequest,
} from "@/lib/unit-match-fill";
import { scenarioDate } from "@shared/prototype-clock";
import {
  AssetPhotoGallery,
  type LocalPhotoAvailability,
} from "@/components/app/PhotoGallery";
import { parsePhotoGallery } from "@/lib/property-photo-gallery";
import { readMatchingPhotoIds } from "@/lib/photo-match-readability";
import {
  electricityNumberForRentalTarget,
  propertyNumberForRentalTarget,
} from "@/lib/prototype-rental";
import {
  parsePropertyProfile,
  parseUnitProfile,
  resolveUnitPurpose,
  unitProfileFormValues,
  unitProfileSummary,
  updateDescribedUnit,
} from "@/lib/unit-profile";
import {
  assetFieldForError,
  nativeAssetFieldMessage,
} from "@/lib/asset-form-errors";
import { entityEditToken } from "@/lib/prototype-edit-concurrency";
import type { PropertyPurpose } from "@shared/unit-profile-types";
import "./UnitSetupWizard.css";

type UnitFormValues = Record<string, string>;
type UnitDrafts = Record<string, UnitFormValues>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneValues(values: UnitFormValues): UnitFormValues {
  return { ...values };
}

function valuesEqual(left: UnitFormValues, right: UnitFormValues): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => left[key] === right[key]);
}

/** Keeps every existing descriptive profile field present when this wizard saves. */
function valuesForUnit(unit: DemoEntity): UnitFormValues {
  try {
    const profile = parseUnitProfile(unit.meta.unitProfile);
    return {
      title: unit.title,
      unitCode: "",
      villaArrangement: "",
      apartmentLayout: "",
      roomLayout: "",
      bedrooms: "",
      livingRooms: "",
      bathrooms: "",
      kitchens: "",
      furnishing: "",
      propertyNumber: "",
      electricityNumber: "",
      planNumber: "",
      waterNumber: "",
      monthlyRent: "",
      salePrice: "",
      unitPurpose: "",
      category: "",
      description: "",
      contents: "",
      unitArea: "",
      floor: text(unit.meta.floor),
      tenancyStatus: "",
      tenancyStartDate: "",
      tenancyEndDate: "",
      ...unitProfileFormValues(unit),
      // This stays local to the draft. It records the only case where a
      // category transition must persist the universal replacement for a
      // legacy apartment-only layout.
      legacyApartmentRoomLayout:
        profile.roomLayout === undefined ? (profile.apartmentLayout ?? "") : "",
    };
  } catch {
    // A malformed historical profile remains visible to the domain transition,
    // which will reject it without losing this user's four staged fields.
    return {
      title: unit.title,
      unitCode: text(unit.meta.unitCode) || text(unit.meta.code),
      villaArrangement: "",
      apartmentLayout: "",
      roomLayout: "",
      bedrooms: "",
      livingRooms: "",
      bathrooms: "",
      kitchens: "",
      furnishing: "",
      propertyNumber: "",
      electricityNumber: "",
      planNumber: "",
      waterNumber: "",
      monthlyRent: "",
      salePrice: "",
      unitPurpose: "",
      category: "",
      description: "",
      contents: "",
      unitArea: "",
      floor: text(unit.meta.floor),
      tenancyStatus: "",
      tenancyStartDate: "",
      tenancyEndDate: "",
    };
  }
}

function purposeFor(
  property: DemoEntity | undefined
): PropertyPurpose | undefined {
  try {
    return parsePropertyProfile(property?.meta.propertyProfile).purpose;
  } catch {
    return undefined;
  }
}

function serialFor(unit: DemoEntity): string {
  return text(unit.meta.unitCode) || text(unit.meta.code) || "غير مسجل";
}

function draftPurpose(
  values: UnitFormValues,
  property: DemoEntity | undefined
): "rent" | "sale" | undefined {
  const selected = text(values.unitPurpose);
  if (selected === "rent" || selected === "sale") return selected;
  const parent = purposeFor(property);
  return parent === "rent" || parent === "sale" ? parent : undefined;
}

function descriptionFor(unit: DemoEntity): string {
  try {
    return unitProfileSummary(unit);
  } catch {
    return "تعذر قراءة المواصفات؛ راجع وصف الوحدة قبل الحفظ.";
  }
}

function photoReferenceKey(unit: DemoEntity): string {
  try {
    return parsePhotoGallery(unit.meta.photoGallery).ids.join("|");
  } catch {
    return "";
  }
}

function missingEvidence(
  property: DemoEntity,
  unit: DemoEntity,
  electricityNumber: string,
  propertyNumber: string,
  localPhotoCount: number
): string[] {
  const values = valuesForUnit(unit);
  const missing: string[] = [];
  if (purposeFor(property) === "mixed" && !text(values.unitPurpose))
    missing.push("هدف الوحدة (بيع أو إيجار)");
  if (!text(values.category)) missing.push("نوع الوحدة");
  if (!propertyNumber) missing.push("رقم العقار");
  if (!text(values.planNumber)) missing.push("رقم المخطط");
  if (!electricityNumber) missing.push("رقم الكهرباء");
  if (!localPhotoCount) missing.push("صورة واحدة على الأقل");
  return missing;
}

function suggestedCategory(
  property: DemoEntity | undefined
): "apartment" | "villa" | undefined {
  try {
    const composition = parsePropertyProfile(
      property?.meta.propertyProfile
    ).unitComposition;
    return composition === "apartments"
      ? "apartment"
      : composition === "villas"
        ? "villa"
        : undefined;
  } catch {
    return undefined;
  }
}

function initialDrafts(
  units: DemoEntity[],
  cached?: UnitDrafts,
  categorySuggestion?: "apartment" | "villa"
): UnitDrafts {
  return Object.fromEntries(
    units.map(unit => {
      const previousDraft = cached?.[unit.id];
      const values = cloneValues(previousDraft ?? valuesForUnit(unit));
      // A parent composition may suggest a fresh type, but it never supplies a
      // layout, villa arrangement, or replacement for a stored user choice.
      if (!previousDraft && !values.category && categorySuggestion)
        values.category = categorySuggestion;
      return [unit.id, values];
    })
  );
}

function profileSubmission(
  values: UnitFormValues,
  initial: UnitFormValues,
  purpose: PropertyPurpose | undefined,
  tenancyEditable: boolean,
  migrateLegacyRoomLayout = false
): UnitFormValues {
  // Submit only fields this stage exposes. The domain merges these into the
  // latest profile, preserving newer room/layout/furnishing/content changes.
  const submitted: UnitFormValues = {};
  for (const key of [
    "title",
    "unitCode",
    "propertyNumber",
    "planNumber",
    "electricityNumber",
    "waterNumber",
    "unitPurpose",
    "category",
    "villaArrangement",
    "apartmentLayout",
    "roomLayout",
    "bedrooms",
    "livingRooms",
    "bathrooms",
    "kitchens",
    "furnishing",
    "description",
    "contents",
    "unitArea",
    "floor",
  ])
    if ((values[key] ?? "") !== (initial[key] ?? ""))
      submitted[key] = values[key] ?? "";
  if (migrateLegacyRoomLayout && values.roomLayout)
    submitted.roomLayout = values.roomLayout;
  if (tenancyEditable)
    for (const key of [
      "tenancyStatus",
      "tenancyStartDate",
      "tenancyEndDate",
      "tenancyMonthlyRent",
    ])
      if ((values[key] ?? "") !== (initial[key] ?? ""))
        submitted[key] = values[key] ?? "";
  // Declaration is one compound field. Include its other visible inputs only
  // when the user changed it, so newer unedited declarations are not replaced.
  if (Object.keys(submitted).some(key => key.startsWith("tenancy")))
    for (const key of [
      "tenancyStatus",
      "tenancyStartDate",
      "tenancyEndDate",
      "tenancyMonthlyRent",
    ])
      submitted[key] = values[key] ?? "";
  if (purpose !== "sale" && values.monthlyRent !== initial.monthlyRent)
    submitted.monthlyRent = values.monthlyRent ?? "";
  if (purpose !== "rent" && values.salePrice !== initial.salePrice)
    submitted.salePrice = values.salePrice ?? "";
  return submitted;
}

export function UnitSetupWizard({
  propertyId,
  onClose,
}: {
  propertyId: string;
  onClose: () => void;
}) {
  const { state, identity, canEdit, commitAssetTransition } = usePrototype();
  const property = state.entities.properties.find(row => row.id === propertyId);
  const propertyPurpose = purposeFor(property);
  const units = useMemo(
    () =>
      property
        ? state.entities.units.filter(
            unit =>
              unit.propertyId === property.id &&
              unit.portfolioId === property.portfolioId
          )
        : [],
    [property, state.entities.units]
  );
  const scopeKey = identity.storageKey;
  const openedScopeRef = useRef(scopeKey);
  const openedPropertyRef = useRef(propertyId);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const requestCloseRef = useRef<() => void>(() => {});
  const savingRef = useRef(false);
  const photoBusyRef = useRef(false);
  const latestContextRef = useRef({ scopeKey, canEdit });
  const snapshotsRef = useRef<UnitDrafts | null>(null);
  const openedTokensRef = useRef<Record<string, string> | null>(null);

  if (!snapshotsRef.current) {
    snapshotsRef.current = initialDrafts(units);
  }
  if (!openedTokensRef.current) {
    openedTokensRef.current = Object.fromEntries(
      units.map(unit => [unit.id, entityEditToken(unit)])
    );
  }
  latestContextRef.current = { scopeKey, canEdit };

  const [drafts, setDrafts] = useState<UnitDrafts>(() =>
    initialDrafts(units, undefined, suggestedCategory(property))
  );
  const [selectedUnitId, setSelectedUnitId] = useState(
    () => units[0]?.id ?? ""
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [closeReviewOpen, setCloseReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [matchSource, setMatchSource] = useState<{
    unitId: string;
    changes: UnitFormValues;
    token: string;
    photoIds: string[];
    unavailablePhotoCount: number;
  } | null>(null);
  const matchPanelRef = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const handleGalleryBusy = useCallback((busy: boolean) => {
    photoBusyRef.current = busy;
    setPhotoBusy(busy);
  }, []);
  const acceptOwnGalleryChange = useCallback(
    (change: {
      kind: string;
      id: string;
      scopeKey: string;
      before: DemoEntity;
      after: DemoEntity;
    }) => {
      if (change.kind !== "units" || change.scopeKey !== openedScopeRef.current)
        return;
      if (
        openedTokensRef.current?.[change.id] === entityEditToken(change.before)
      )
        openedTokensRef.current = {
          ...openedTokensRef.current,
          [change.id]: entityEditToken(change.after),
        };
    },
    []
  );
  const [localPhotoAvailability, setLocalPhotoAvailability] = useState<
    Record<string, LocalPhotoAvailability>
  >({});
  const receiveLocalPhotoAvailability = useCallback(
    (availability: LocalPhotoAvailability) => {
      if (
        availability.kind !== "units" ||
        availability.scopeKey !== openedScopeRef.current ||
        openedScopeRef.current !== latestContextRef.current.scopeKey
      )
        return;
      setLocalPhotoAvailability(previous => {
        const existing = previous[availability.id];
        if (
          existing?.scopeKey === availability.scopeKey &&
          existing.galleryKey === availability.galleryKey &&
          existing.availableCount === availability.availableCount
        )
          return previous;
        return { ...previous, [availability.id]: availability };
      });
    },
    []
  );
  savingRef.current = saving;

  const scopeMatches =
    openedScopeRef.current === scopeKey &&
    openedPropertyRef.current === propertyId;
  const inPortfolioScope =
    property !== undefined &&
    (state.settings.portfolioId === "all" ||
      state.settings.portfolioId === property.portfolioId);
  const selectedIndex = units.findIndex(unit => unit.id === selectedUnitId);
  const selectedUnit = selectedIndex >= 0 ? units[selectedIndex] : undefined;
  const selectedValues = selectedUnit
    ? (drafts[selectedUnit.id] ?? valuesForUnit(selectedUnit))
    : {};
  const purpose = draftPurpose(selectedValues, property);
  const requiresUnitPurpose = propertyPurpose === "mixed" && !purpose;
  // A whole-property target is explicit metadata on that internal target. A
  // parent mode never turns an existing physical unit into a whole property or
  // hides its independently saved area, meter, layout, or furnishing.
  const isWholePropertyTarget = selectedUnit?.meta.wholeProperty === true;
  const isPhysicalUnit = !isWholePropertyTarget;
  const showVillaArrangement =
    isPhysicalUnit && selectedValues.category === "villa";

  const dirtyUnitIds = useMemo(
    () =>
      units
        .filter(unit => {
          const current = drafts[unit.id] ?? valuesForUnit(unit);
          const initial =
            snapshotsRef.current?.[unit.id] ?? valuesForUnit(unit);
          return !valuesEqual(current, initial);
        })
        .map(unit => unit.id),
    [drafts, units]
  );

  const evidence = useMemo(
    () =>
      property
        ? units.map(unit => ({
            unit,
            missing: missingEvidence(
              property,
              unit,
              electricityNumberForRentalTarget(
                state.entities,
                property.id,
                unit.id
              ),
              propertyNumberForRentalTarget(
                state.entities,
                property.id,
                unit.id
              ),
              localPhotoAvailability[unit.id]?.scopeKey === scopeKey &&
                localPhotoAvailability[unit.id]?.galleryKey ===
                  photoReferenceKey(unit)
                ? localPhotoAvailability[unit.id].availableCount
                : 0
            ),
          }))
        : [],
    [property, state.entities, units, localPhotoAvailability, scopeKey]
  );

  const isFreshWorkspace = useCallback(
    () =>
      openedScopeRef.current === latestContextRef.current.scopeKey &&
      openedPropertyRef.current === propertyId,
    [propertyId]
  );

  useEffect(() => {
    if (selectedUnitId || !units[0]) return;
    setSelectedUnitId(units[0].id);
  }, [selectedUnitId, units]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));
    const timer = window.setTimeout(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        "input:not(:disabled), textarea:not(:disabled), button:not(:disabled)"
      );
      (firstField ?? focusable()[0] ?? dialogRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!savingRef.current) requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
    // The modal is one mounted dialog. Deliberately do not re-run on photo/state
    // updates, otherwise a gallery transition could reset focus or a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishClose = useCallback(() => {
    setCloseReviewOpen(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (savingRef.current || photoBusyRef.current) return;
    if (!isFreshWorkspace()) {
      // There is no write to the current (new) workspace if the identity or
      // namespace changed while this dialog was open.
      finishClose();
      return;
    }
    if (dirtyUnitIds.length) {
      setCloseReviewOpen(true);
      return;
    }
    finishClose();
  }, [dirtyUnitIds.length, finishClose, isFreshWorkspace]);
  requestCloseRef.current = requestClose;

  const discardAndClose = () => {
    if (savingRef.current || photoBusyRef.current) return;
    finishClose();
  };

  const updateDraft = (key: string, value: string) => {
    if (
      !selectedUnit ||
      !scopeMatches ||
      savingRef.current ||
      photoBusyRef.current ||
      bulkOpen
    )
      return;
    setDrafts(previous => ({
      ...previous,
      [selectedUnit.id]: {
        ...(previous[selectedUnit.id] ?? valuesForUnit(selectedUnit)),
        [key]: value,
      },
    }));
    setError("");
    setFieldErrors(previous => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setMessage("");
  };

  const updateCategory = (category: string) => {
    if (
      !selectedUnit ||
      !scopeMatches ||
      savingRef.current ||
      photoBusyRef.current ||
      bulkOpen
    )
      return;
    setDrafts(previous => {
      const current = previous[selectedUnit.id] ?? valuesForUnit(selectedUnit);
      const next: UnitFormValues = { ...current, category };
      // This is a user-initiated category change. Clear only an incompatible
      // subtype so the merged profile remains valid; never guess its replacement.
      if (category !== current.category) {
        if (category !== "villa") next.villaArrangement = "";
        if (category !== "apartment") next.apartmentLayout = "";
        if (category === "apartment")
          next.apartmentLayout =
            current.roomLayout || current.apartmentLayout || "";
      }
      return { ...previous, [selectedUnit.id]: next };
    });
    setError("");
    setMessage("");
  };

  const updateRoomLayout = (patch: UnitFormValues) => {
    if (
      !selectedUnit ||
      !scopeMatches ||
      savingRef.current ||
      photoBusyRef.current ||
      bulkOpen
    )
      return;
    setDrafts(previous => {
      const current = previous[selectedUnit.id] ?? valuesForUnit(selectedUnit);
      return { ...previous, [selectedUnit.id]: { ...current, ...patch } };
    });
    setError("");
    setMessage("");
  };

  const moveTo = (index: number) => {
    const next = units[index];
    if (!next || savingRef.current || photoBusyRef.current || bulkOpen) return;
    setSelectedUnitId(next.id);
    setError("");
    setMessage("");
    if (scrollBodyRef.current) scrollBodyRef.current.scrollTop = 0;
  };

  const moveToSection = (sectionId: string) => {
    const section = dialogRef.current?.querySelector<HTMLElement>(
      `#${sectionId}`
    );
    section?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    section
      ?.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
      )
      ?.focus({ preventScroll: true });
  };

  // The ordinary save and matching preview use the same visible-field policy.
  // No source is written merely by opening the selector.
  const currentSubmission = (
    current: PrototypeState,
    unitId: string,
    values: UnitFormValues
  ): UnitFormValues => {
    if (!isFreshWorkspace())
      throw new Error("تغيّر نطاق مساحة العمل؛ أعد فتح معلومات الوحدات.");
    const latestProperty = current.entities.properties.find(
      row => row.id === propertyId
    );
    const latestUnit = current.entities.units.find(row => row.id === unitId);
    if (
      !latestProperty ||
      !latestUnit ||
      latestUnit.propertyId !== latestProperty.id ||
      latestUnit.portfolioId !== latestProperty.portfolioId
    )
      throw new Error(
        "الوحدة أو العقار لم يعدا متاحين في مساحة العمل الحالية."
      );
    if (
      current.settings.portfolioId !== "all" &&
      current.settings.portfolioId !== latestProperty.portfolioId
    )
      throw new Error("العقار خارج نطاق المحفظة الحالية؛ لم يُحفظ أي تعديل.");
    const initial = snapshotsRef.current?.[unitId] ?? valuesForUnit(latestUnit);
    const purposeChanged =
      (values.unitPurpose ?? "") !== (initial.unitPurpose ?? "");
    const activePurpose = purposeChanged
      ? draftPurpose(values, latestProperty)
      : resolveUnitPurpose(latestUnit, latestProperty);
    const latestValues = valuesForUnit(latestUnit);
    const migrateLegacy =
      values.category !== initial.category &&
      values.category !== "apartment" &&
      Boolean(values.roomLayout) &&
      initial.legacyApartmentRoomLayout === values.roomLayout &&
      latestValues.legacyApartmentRoomLayout === values.roomLayout;
    if (purposeFor(latestProperty) === "mixed" && !activePurpose)
      throw new Error(
        "حدد هدف الوحدة: بيع أو إيجار، أو تخطّها لإكمالها لاحقًا."
      );
    const submitted = profileSubmission(
      values,
      initial,
      activePurpose,
      !getTenancySummary(
        current.entities,
        latestProperty,
        latestUnit,
        scenarioDate(current)
      ).locked,
      migrateLegacy
    );
    const token = openedTokensRef.current?.[unitId];
    if (token) submitted._expectedEntityToken = token;
    return submitted;
  };

  const openMatching = async () => {
    if (
      !selectedUnit ||
      !canEdit ||
      !inPortfolioScope ||
      !scopeMatches ||
      savingRef.current ||
      photoBusyRef.current ||
      !isPhysicalUnit
    )
      return;
    if (!formRef.current?.reportValidity()) return;
    try {
      const token = openedTokensRef.current?.[selectedUnit.id];
      if (!token)
        throw new Error("أعد فتح معلومات الوحدات للتحقق من نسخة الوحدة.");
      const changes = currentSubmission(
        state,
        selectedUnit.id,
        cloneValues(selectedValues)
      );
      const sourceIds = parsePhotoGallery(selectedUnit.meta.photoGallery).ids;
      let photos = { ids: [] as string[], missingCount: 0 };
      if (sourceIds.length) {
        savingRef.current = true;
        setSaving(true);
        photos = await readMatchingPhotoIds(scopeKey, sourceIds);
        if (
          !isFreshWorkspace() ||
          !dialogRef.current ||
          openedTokensRef.current?.[selectedUnit.id] !== token
        )
          throw new Error(
            "تغيّرت مساحة العمل أو نسخة المصدر أثناء قراءة الصور؛ أعد فتح المطابقة."
          );
      }
      setMatchSource({
        unitId: selectedUnit.id,
        changes,
        token,
        photoIds: photos.ids,
        unavailablePhotoCount: photos.missingCount,
      });
      setBulkOpen(true);
      setError("");
      setMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر فتح المطابقة.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!bulkOpen) return;
    matchPanelRef.current?.scrollIntoView?.({
      block: "start",
      behavior: "smooth",
    });
  }, [bulkOpen]);

  const saveCurrent = async (): Promise<boolean> => {
    if (!selectedUnit || savingRef.current || photoBusyRef.current)
      return false;
    if (!scopeMatches || !isFreshWorkspace()) {
      setError(
        "تغيّر نطاق مساحة العمل؛ أعد فتح مرحلة إكمال الوحدات قبل الحفظ."
      );
      return false;
    }
    if (!canEdit) {
      setError("المعاينة الحالية للقراءة فقط.");
      return false;
    }
    if (!inPortfolioScope) {
      setError("العقار خارج نطاق المحفظة الحالية؛ لم يُحفظ أي تعديل.");
      return false;
    }
    const values = cloneValues(selectedValues);
    savingRef.current = true;
    setSaving(true);
    try {
      const savedUnitId = selectedUnit.id;
      const saved = await commitAssetTransition(current => {
        return updateDescribedUnit(
          current,
          savedUnitId,
          currentSubmission(current, savedUnitId, values)
        );
      });
      const savedValues = valuesForUnit(saved);
      setDrafts(previous => ({ ...previous, [savedUnitId]: savedValues }));
      snapshotsRef.current = {
        ...snapshotsRef.current,
        [savedUnitId]: cloneValues(savedValues),
      };
      openedTokensRef.current = {
        ...openedTokensRef.current,
        [savedUnitId]: entityEditToken(saved),
      };
      setError("");
      setMessage(
        "حُفظت بيانات هذه الوحدة وسعرها الخاص محليًا؛ لا تتغير العقود أو الإشغال أو المبالغ المستحقة السابقة."
      );
      return true;
    } catch (caught) {
      const textError =
        caught instanceof Error ? caught.message : "تعذر حفظ بيانات الوحدة.";
      const key = assetFieldForError(textError, true);
      if (key) setFieldErrors(previous => ({ ...previous, [key]: textError }));
      setError(textError);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * The batch helper builds every member update against a local state before
   * this one asset commit occurs. A failed member never yields a partial state.
   */
  const saveBulk = async (request: UnitMatchRequest): Promise<boolean> => {
    if (savingRef.current || photoBusyRef.current) return false;
    if (!scopeMatches || !isFreshWorkspace()) {
      setError(
        "تغيّر نطاق مساحة العمل؛ أعد فتح مرحلة إكمال الوحدات قبل التعبئة الجماعية."
      );
      return false;
    }
    if (!canEdit) {
      setError("المعاينة الحالية للقراءة فقط.");
      return false;
    }
    if (!inPortfolioScope) {
      setError("العقار خارج نطاق المحفظة الحالية؛ لم يُحفظ أي تعديل.");
      return false;
    }

    if (
      !matchSource ||
      request.sourceUnitId !== matchSource.unitId ||
      request.propertyId !== propertyId
    ) {
      setError("تغيّرت الوحدة المصدر؛ أغلق المطابقة وافتحها مجددًا.");
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (request.photoIds?.length) {
        const readable = await readMatchingPhotoIds(scopeKey, request.photoIds);
        if (readable.missingCount)
          throw new Error(
            "تعذرت قراءة صورة من صور المطابقة محليًا؛ لم تُحفظ أي معلومات أو صور. أعد فتح المطابقة."
          );
        if (!isFreshWorkspace())
          throw new Error(
            "تغيّرت مساحة العمل أثناء قراءة الصور؛ لم تُحفظ المطابقة."
          );
      }
      const saved = await commitAssetTransition(current => {
        if (!isFreshWorkspace())
          throw new Error(
            "تغيّر نطاق مساحة العمل أثناء الحفظ؛ لم تُنقل المسودة إلى النطاق الجديد."
          );
        return updateMatchedUnits(current, request);
      });

      // Do not acknowledge into an unrelated workspace if identity changed only
      // after the atomic transition completed. The saved source remains intact.
      if (!isFreshWorkspace()) {
        setError(
          "تغيّر نطاق مساحة العمل بعد الحفظ؛ لم تُحدّث هذه النافذة مسوداتها. أعد فتحها من النطاق الصحيح."
        );
        setBulkOpen(false);
        setMatchSource(null);
        return true;
      }

      const acknowledged = saved.updates.filter(
        update =>
          openedTokensRef.current?.[update.unitId] ===
          entityEditToken(update.before)
      );
      if (acknowledged.length !== saved.updates.length) {
        // This should be unreachable because every update required the opening
        // token, but it is safer not to overwrite a newer local draft.
        setError(
          "حُفظت المطابقة؛ تعذر تحديث نسخة إحدى الوحدات في هذه النافذة. لم تُستبدل مسودتك المحلية؛ أعد فتح معلومات الوحدات."
        );
        setBulkOpen(false);
        setMatchSource(null);
        return true;
      }

      const nextSnapshots = { ...(snapshotsRef.current ?? {}) };
      const nextTokens = { ...(openedTokensRef.current ?? {}) };
      const sourceValues = valuesForUnit(saved.source);
      nextSnapshots[saved.source.id] = cloneValues(sourceValues);
      nextTokens[saved.source.id] = entityEditToken(saved.source);
      for (const update of acknowledged) {
        const savedValues = valuesForUnit(update.after);
        nextSnapshots[update.unitId] = cloneValues(savedValues);
        nextTokens[update.unitId] = entityEditToken(update.after);
      }
      snapshotsRef.current = nextSnapshots;
      openedTokensRef.current = nextTokens;
      setDrafts(previous => {
        const next = {
          ...previous,
          [saved.source.id]: cloneValues(sourceValues),
        };
        for (const update of acknowledged) {
          const savedValues = valuesForUnit(update.after);
          const draft = next[update.unitId] ?? valuesForUnit(update.before);
          // Fields not applied by the batch keep this wizard's unsaved draft.
          const patch = Object.fromEntries(
            update.appliedKeys.map(key => [key, savedValues[key] ?? ""])
          );
          next[update.unitId] = { ...draft, ...patch };
        }
        return next;
      });
      setFieldErrors({});
      setError("");
      setMessage(
        `حُفظت الوحدة الحالية وطُوبقت معلوماتها المشتركة مع ${saved.updates.length} وحدة. يمكنك الانتقال إلى الوحدة التالية؛ العقود وأرقام الوحدات والعدادات لم تتغير.`
      );
      setBulkOpen(false);
      setMatchSource(null);
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ التعبئة الجماعية للوحدات."
      );
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bulkOpen) return;
    if (!formRef.current?.reportValidity()) return;
    if (!(await saveCurrent())) return;
    if (selectedIndex >= units.length - 1) {
      // saveCurrent updates the snapshot synchronously, while this submit
      // closure still sees the pre-save dirty list. Only other unit drafts
      // should require an explicit cache/discard choice at this point.
      if (dirtyUnitIds.some(unitId => unitId !== selectedUnit?.id))
        setCloseReviewOpen(true);
      else finishClose();
    } else moveTo(selectedIndex + 1);
  };

  const scopeBlocked = !scopeMatches;
  const unavailable = !property || !inPortfolioScope || !units.length;
  const parentPropertyNumber = property
    ? text(property.meta.propertyNumber)
    : "";
  const electricity =
    property && selectedUnit
      ? electricityNumberForRentalTarget(
          state.entities,
          property.id,
          selectedUnit.id
        )
      : "";

  return (
    <div
      className="modal-backdrop unit-setup-wizard-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) requestClose();
      }}
    >
      <section
        className="modal property-dialog unit-setup-wizard"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="إكمال بيانات الوحدات"
        aria-describedby={
          !scopeBlocked && !unavailable && selectedUnit
            ? "unit-setup-wizard-description"
            : undefined
        }
       
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">المرحلة 2 من 2</span>
            <h2>إكمال بيانات الوحدات</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={requestClose}
            disabled={saving || photoBusy}
            aria-label="إغلاق إكمال بيانات الوحدات"
          >
            <X size={20} />
          </button>
        </div>

        {scopeBlocked ? (
          <section className="unit-setup-wizard__blocked" role="alert">
            <h3>تغيّر نطاق مساحة العمل</h3>
            <p>
              أُوقفت هذه النافذة لحماية بيانات المسودة. لم تُنقل أي قيمة إلى
              مساحة العمل أو الهوية الجديدة؛ أغلقها وافتح العقار من النطاق
              الحالي.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={finishClose}
            >
              إغلاق
            </button>
          </section>
        ) : unavailable ? (
          <section className="unit-setup-wizard__blocked" role="alert">
            <h3>تعذر فتح وحدات هذا العقار</h3>
            <p>
              {!property
                ? "العقار لم يعد متاحًا في مساحة العمل الحالية."
                : !inPortfolioScope
                  ? "العقار خارج نطاق المحفظة الحالي؛ لم يُفتح أي سجل للتعديل."
                  : "لا توجد وحدات محفوظة لهذا العقار لإكمالها."}
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={requestClose}
            >
              إغلاق
            </button>
          </section>
        ) : selectedUnit ? (
          <>
            <div className="unit-setup-wizard__body" ref={scrollBodyRef}>
              <p id="unit-setup-wizard-description" className="muted small">
                أكمل معلومات كل وحدة ثم اضغط «حفظ ومتابعة». هذه المرحلة للوحدات
                الموجودة فقط؛ لا تغيّر عقودها أو إشغالها. الصور محلية لهذا
                المتصفح.
              </p>
              <p className="muted small">
                العقار: {property.title} · {units.length} وحدة محفوظة
              </p>
              <div className="unit-setup-wizard__progress">
                <div>
                  <h3>
                    الوحدة {selectedIndex + 1} من {units.length}
                  </h3>
                  <p className="muted small">
                    {selectedUnit.title}{" "}
                    <strong dir="ltr">{serialFor(selectedUnit)}</strong>
                  </p>
                  <p className="muted small">
                    المواصفات: {descriptionFor(selectedUnit)}
                  </p>
                </div>
                <span className="unit-setup-wizard__serial" dir="ltr">
                  {serialFor(selectedUnit)}
                </span>
              </div>

              <label className="form-label unit-setup-wizard__picker">
                <span>انتقل إلى الوحدة</span>
                <select
                  className="field"
                  aria-label="انتقل إلى الوحدة"
                  value={selectedUnitId}
                  disabled={saving || photoBusy || bulkOpen}
                  onChange={event =>
                    moveTo(
                      units.findIndex(unit => unit.id === event.target.value)
                    )
                  }
                >
                  {units.map((unit, index) => (
                    <option key={unit.id} value={unit.id}>
                      {index + 1} · {serialFor(unit)} · {unit.title}
                    </option>
                  ))}
                </select>
              </label>

              {!canEdit && (
                <p className="property-form-error" role="alert">
                  المعاينة الحالية للقراءة فقط. يمكنك مراجعة البيانات والنواقص
                  دون حفظ أي تعديل.
                </p>
              )}
              {error && (
                <p className="property-form-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="unit-setup-wizard__message" role="status">
                  {message}
                </p>
              )}

              <form
                ref={formRef}
                id={formId}
                onSubmit={submit}
                aria-busy={saving || photoBusy}
                onInvalidCapture={event => {
                  const control = event.target as HTMLInputElement;
                  if (control.name)
                    setFieldErrors(previous => ({
                      ...previous,
                      [control.name]: nativeAssetFieldMessage(control),
                    }));
                }}
              >
                <fieldset
                  className="unit-setup-wizard__source-fields"
                  disabled={!canEdit || saving || photoBusy || bulkOpen}
                >
                  <nav
                    aria-label="انتقال سريع بين بيانات الوحدة"
                    className="unit-setup-nav"
                  >
                    {[
                      ["unit-basic-fields", "الأساسية"],
                      ["unit-description-fields", "الوصف والتوزيع"],
                      ["unit-tenancy-fields", "التأجير"],
                      ["unit-pricing-fields", "الهدف والأسعار"],
                      ["unit-references-fields", "المراجع والصور"],
                    ].map(([sectionId, label]) => (
                      <button
                        key={sectionId}
                        type="button"
                        className="btn-ghost"
                        onClick={() => moveToSection(sectionId)}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>

                  <section
                    id="unit-basic-fields"
                    className="unit-setup-section"
                    aria-labelledby="unit-basic-heading"
                  >
                    <h3 id="unit-basic-heading">البيانات الأساسية للوحدة</h3>
                    <p className="muted small">
                      سجّل هوية هذه الوحدة وبياناتها المستقلة. لا تُستنتج
                      المساحة أو العداد الخاص من بيانات العقار.
                    </p>
                    <div className="form-grid">
                      <label className="form-label">
                        <span>
                          اسم الوحدة <i className="required-mark">*</i>
                        </span>
                        <input
                          name="title"
                          className="field"
                          value={selectedValues.title ?? ""}
                          required
                          maxLength={256}
                          disabled={!canEdit || saving || photoBusy}
                          onChange={event =>
                            updateDraft("title", event.target.value)
                          }
                        />

                        {fieldErrors.title && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.title}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>
                          رمز الوحدة <i className="required-mark">*</i>
                        </span>
                        <input
                          name="unitCode"
                          className="field"
                          value={selectedValues.unitCode ?? ""}
                          required
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="مثال اختياري: A-01 أو V-01"
                          onChange={event =>
                            updateDraft("unitCode", event.target.value)
                          }
                        />
                        <small className="muted">
                          رمز عرض قابل للتعديل ضمن هذا العقار فقط؛ لا يغيّر
                          المعرّف الداخلي أو العقود السابقة.
                        </small>

                        {fieldErrors.unitCode && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.unitCode}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>رقم الكهرباء / العداد</span>
                        <input
                          name="electricityNumber"
                          className="field"
                          value={selectedValues.electricityNumber ?? ""}
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اختياري · يرث رقم العقار عند تركه فارغًا"
                          onChange={event =>
                            updateDraft("electricityNumber", event.target.value)
                          }
                        />
                        <small className="muted">
                          {electricity
                            ? `الرقم الفعّال الآن: ${electricity}${selectedValues.electricityNumber ? " · خاص بالوحدة" : " · موروث من العقار"}.`
                            : "لا يوجد رقم كهرباء موروث أو خاص مسجل بعد."}
                        </small>

                        {fieldErrors.electricityNumber && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.electricityNumber}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>مساحة الوحدة (م²)</span>
                        <input
                          name="unitArea"
                          className="field"
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={selectedValues.unitArea ?? ""}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اختياري · مثل ١٢٠٫٥٠"
                          onChange={event =>
                            updateDraft("unitArea", event.target.value)
                          }
                        />
                        <small className="muted">
                          مساحة هذه الوحدة وحدها؛ لا تقسّم مساحة الأصل تلقائيًا.
                        </small>

                        {fieldErrors.unitArea && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.unitArea}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>الدور (اختياري)</span>
                        <input
                          name="floor"
                          className="field"
                          value={selectedValues.floor ?? ""}
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          onChange={event =>
                            updateDraft("floor", event.target.value)
                          }
                        />
                        {fieldErrors.floor && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.floor}
                          </small>
                        )}
                      </label>
                    </div>
                  </section>

                  <section
                    id="unit-description-fields"
                    className="unit-setup-section"
                    aria-labelledby="unit-description-heading"
                  >
                    <h3 id="unit-description-heading">
                      الوصف والنوع والتوزيع والتأثيث
                    </h3>
                    <p className="muted small">
                      يتضمن هذا القسم التأثيث ضمن حقول التوزيع نفسها، دون إنشاء
                      حقل تأثيث مكرر.
                    </p>
                    <div className="form-grid">
                      <label className="form-label">
                        <span>نوع الوحدة</span>
                        <select
                          name="category"
                          className="field"
                          value={selectedValues.category ?? ""}
                          disabled={!canEdit || saving || photoBusy}
                          onChange={event => updateCategory(event.target.value)}
                        >
                          <option value="">غير مصنفة / إكمال لاحقًا</option>
                          <option value="apartment">شقة</option>
                          <option value="villa">فيلا</option>
                          <option value="shop">محل</option>
                          <option value="office">مكتب</option>
                          <option value="other">أخرى</option>
                        </select>
                        <small className="muted">
                          اختياري للسجلات القديمة. لا يغيّر اختيار النوع رمز
                          الوحدة أو المحتويات أو المساحة أو الأسعار؛ اختر
                          الترتيب أو التوزيع صراحةً عند اختيار فيلا أو شقة.
                        </small>

                        {fieldErrors.category && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.category}
                          </small>
                        )}
                      </label>
                      {showVillaArrangement && (
                        <label className="form-label">
                          <span>
                            ترتيب الفيلا <i className="required-mark">*</i>
                          </span>
                          <select
                            name="villaArrangement"
                            className="field"
                            value={selectedValues.villaArrangement ?? ""}
                            required
                            disabled={!canEdit || saving || photoBusy}
                            onChange={event =>
                              updateDraft(
                                "villaArrangement",
                                event.target.value
                              )
                            }
                          >
                            <option value="">اختر متلاصقة أو منفصلة</option>
                            <option value="attached">متلاصقة</option>
                            <option value="detached">منفصلة</option>
                          </select>
                          <small className="muted">
                            لا يُفترض ترتيب الفيلا تلقائيًا.
                          </small>

                          {fieldErrors.villaArrangement && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.villaArrangement}
                            </small>
                          )}
                        </label>
                      )}
                      {isPhysicalUnit && (
                        <RoomLayoutFields
                          errors={fieldErrors}
                          values={selectedValues}
                          onChange={updateRoomLayout}
                          disabled={!canEdit || saving || photoBusy}
                        />
                      )}
                      <label className="form-label">
                        <span>وصف الوحدة</span>
                        <textarea
                          name="description"
                          className="field"
                          rows={3}
                          maxLength={1024}
                          value={selectedValues.description ?? ""}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اكتب وصف هذه الوحدة ومميزاتها"
                          onChange={event =>
                            updateDraft("description", event.target.value)
                          }
                        />

                        {fieldErrors.description && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.description}
                          </small>
                        )}
                      </label>
                      <ContentPresetPicker
                        label="محتويات الوحدة / توزيعها"
                        value={selectedValues.contents ?? ""}
                        disabled={!canEdit || saving || photoBusy}
                        onChange={value => updateDraft("contents", value)}
                      />
                    </div>
                  </section>

                  <section
                    id="unit-tenancy-fields"
                    className="unit-setup-section"
                    aria-labelledby="unit-tenancy-heading"
                  >
                    <h3 id="unit-tenancy-heading">حالة التأجير وتواريخه</h3>
                    <div className="form-grid">
                      <div style={{ gridColumn: "1 / -1" }}>
                        <TenancyFields
                          values={selectedValues}
                          onChange={updateDraft}
                          property={property}
                          unit={selectedUnit}
                          disabled={!canEdit || saving || photoBusy}
                        />
                      </div>
                    </div>
                  </section>

                  <section
                    id="unit-pricing-fields"
                    className="unit-setup-section"
                    aria-labelledby="unit-pricing-heading"
                  >
                    <h3 id="unit-pricing-heading">هدف الوحدة والأسعار</h3>
                    <div className="form-grid">
                      <label className="form-label">
                        <span>
                          هدف الوحدة{" "}
                          {propertyPurpose === "mixed" && (
                            <i className="required-mark">*</i>
                          )}
                        </span>
                        <select
                          name="unitPurpose"
                          className="field"
                          value={selectedValues.unitPurpose ?? ""}
                          required={propertyPurpose === "mixed"}
                          disabled={!canEdit || saving || photoBusy}
                          onChange={event =>
                            updateDraft("unitPurpose", event.target.value)
                          }
                        >
                          <option value="">
                            {propertyPurpose === "mixed"
                              ? "اختر بيع أو إيجار لهذه الوحدة"
                              : "موروث من هدف العقار إن كان محددًا"}
                          </option>
                          <option value="rent">إيجار</option>
                          <option value="sale">بيع</option>
                        </select>
                        <small className="muted">
                          يمكن تخصيص بعض الوحدات للبيع وبعضها للإيجار؛ اختيار
                          الهدف لا ينهي عقدًا قائمًا ولا ينفذ بيعًا.
                        </small>

                        {fieldErrors.unitPurpose && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.unitPurpose}
                          </small>
                        )}
                      </label>
                      {purpose !== "sale" && !requiresUnitPurpose && (
                        <label className="form-label">
                          <span>إيجار الوحدة الشهري (ر.ق)</span>
                          <input
                            name="monthlyRent"
                            className="field"
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={selectedValues.monthlyRent ?? ""}
                            disabled={!canEdit || saving || photoBusy}
                            placeholder="اختياري · مثال ١٬٢٣٤٫٥٠"
                            onChange={event =>
                              updateDraft("monthlyRent", event.target.value)
                            }
                          />
                          <small className="muted">
                            سعر خاص بهذه الوحدة، وليس سعرًا موحدًا للعقار. لا
                            يغيّر العقود أو التحصيل السابق.
                          </small>

                          {fieldErrors.monthlyRent && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.monthlyRent}
                            </small>
                          )}
                        </label>
                      )}
                      {purpose !== "rent" && !requiresUnitPurpose && (
                        <label className="form-label">
                          <span>سعر بيع الوحدة المطلوب (ر.ق)</span>
                          <input
                            name="salePrice"
                            className="field"
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={selectedValues.salePrice ?? ""}
                            disabled={!canEdit || saving || photoBusy}
                            placeholder="اختياري · مثال ٦٥٠٬٠٠٠"
                            onChange={event =>
                              updateDraft("salePrice", event.target.value)
                            }
                          />
                          <small className="muted">
                            قيمة هذه الوحدة وحدها، وليست قيمة العقار الكامل أو
                            بيعًا منفذًا.
                          </small>

                          {fieldErrors.salePrice && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.salePrice}
                            </small>
                          )}
                        </label>
                      )}
                    </div>
                  </section>

                  <section
                    id="unit-references-fields"
                    className="unit-setup-section"
                    aria-labelledby="unit-references-heading"
                  >
                    <h3 id="unit-references-heading">المراجع والصور</h3>
                    <div className="form-grid">
                      <label className="form-label">
                        <span>رقم العقار الخاص بالوحدة</span>
                        <input
                          name="propertyNumber"
                          className="field"
                          value={selectedValues.propertyNumber ?? ""}
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اختياري · يرث رقم العقار عند تركه فارغًا"
                          onChange={event =>
                            updateDraft("propertyNumber", event.target.value)
                          }
                        />
                        <small className="muted">
                          {parentPropertyNumber
                            ? `عند تركه فارغًا، يستخدم رقم العقار الحالي: ${parentPropertyNumber}.`
                            : "لا يوجد رقم مسجل للأصل الآن؛ لا يعد الفراغ وراثة صحيحة حتى يضاف رقم العقار للأصل."}
                        </small>

                        {fieldErrors.propertyNumber && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.propertyNumber}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>رقم المخطط</span>
                        <input
                          name="planNumber"
                          className="field"
                          value={selectedValues.planNumber ?? ""}
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اختياري · يحفظ الأصفار البادئة"
                          onChange={event =>
                            updateDraft("planNumber", event.target.value)
                          }
                        />

                        {fieldErrors.planNumber && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.planNumber}
                          </small>
                        )}
                      </label>
                      <label className="form-label">
                        <span>رقم الماء</span>
                        <input
                          name="waterNumber"
                          className="field"
                          value={selectedValues.waterNumber ?? ""}
                          maxLength={80}
                          disabled={!canEdit || saving || photoBusy}
                          placeholder="اختياري · يحفظ الأصفار البادئة"
                          onChange={event =>
                            updateDraft("waterNumber", event.target.value)
                          }
                        />

                        {fieldErrors.waterNumber && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.waterNumber}
                          </small>
                        )}
                      </label>
                    </div>
                    <section
                      className="unit-setup-wizard__photos"
                      aria-label="صور الوحدة"
                    >
                      <AssetPhotoGallery
                        kind="units"
                        id={selectedUnit.id}
                        title={`${selectedUnit.title} · ${serialFor(selectedUnit)}`}
                        onLocalAvailabilityChange={
                          receiveLocalPhotoAvailability
                        }
                        disabled={saving || bulkOpen}
                        onBusyChange={handleGalleryBusy}
                        onCommittedChange={acceptOwnGalleryChange}
                      />
                    </section>
                  </section>

                  {requiresUnitPurpose && (
                    <p className="muted small">
                      العقار للبيع والإيجار معًا؛ حدد هدف هذه الوحدة أولًا ليظهر
                      سعرها المناسب.
                    </p>
                  )}
                  {!purpose && propertyPurpose !== "mixed" && (
                    <p className="muted small">
                      هدف العقار غير محدد؛ يمكنك تسجيل سعر الإيجار والبيع
                      مستقلين، دون افتراض هدف أو نسخ سعر عام.
                    </p>
                  )}
                </fieldset>
              </form>

              {bulkOpen && matchSource && (
                <div
                  ref={matchPanelRef}
                  className="unit-setup-wizard__match-slot"
                >
                  <UnitBulkFillPanel
                    state={state}
                    propertyId={property.id}
                    propertyTitle={property.title}
                    units={units}
                    sourceUnit={selectedUnit}
                    sourceChanges={matchSource.changes}
                    sourceToken={matchSource.token}
                    photoIds={matchSource.photoIds}
                    unavailablePhotoCount={matchSource.unavailablePhotoCount}
                    openedTokens={openedTokensRef.current ?? {}}
                    disabled={!canEdit || saving || photoBusy || !scopeMatches}
                    onApply={saveBulk}
                    onCancel={() => {
                      setBulkOpen(false);
                      setMatchSource(null);
                    }}
                  />
                </div>
              )}

              <details
                className="unit-setup-wizard__evidence"
                aria-label="ملخص البيانات الناقصة"
              >
                <summary>معلومات لا تزال ناقصة · {units.length} وحدة</summary>
                <p className="muted small">
                  لا تعتبر الوحدة مكتملة لمجرد حفظ هذه الخطوة. رقم العقار
                  الموروث صالح فقط إن كان رقم الأصل الحالي موجودًا، وتبقى أرقام
                  المخطط والكهرباء والصورة أدلة مطلوبة يمكن إكمالها لاحقًا. لا
                  تكفي مراجع الصور؛ تُتحقق ملفاتها محليًا عند فتح معرض كل وحدة،
                  وتبقى الصورة مطلوبة إلى أن يتأكد توفرها في هذا المتصفح.
                </p>
                <ul>
                  {evidence.map(({ unit, missing }) => (
                    <li key={unit.id}>
                      <strong>
                        {unit.title} · <span dir="ltr">{serialFor(unit)}</span>
                      </strong>
                      {missing.length ? (
                        <span> يحتاج: {missing.join("، ")}</span>
                      ) : (
                        <span> لا توجد عناصر ناقصة من هذه القائمة.</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            <div className="unit-setup-wizard__actions modal-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={saving || photoBusy || bulkOpen || selectedIndex <= 0}
                onClick={() => moveTo(selectedIndex - 1)}
              >
                <ChevronRight size={16} /> السابق
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  saving ||
                  photoBusy ||
                  bulkOpen ||
                  selectedIndex >= units.length - 1
                }
                onClick={() => moveTo(selectedIndex + 1)}
              >
                تخطي الوحدة
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving || photoBusy}
                onClick={requestClose}
              >
                إكمال لاحقًا
              </button>
              {isPhysicalUnit &&
                units.filter(unit => unit.meta.wholeProperty !== true).length >
                  1 && (
                  <label className="unit-setup-wizard__match-toggle">
                    <input
                      type="checkbox"
                      aria-label="مطابقة الوحدة بوحدات أخرى"
                      checked={bulkOpen}
                      disabled={!canEdit || saving || photoBusy}
                      onChange={event => {
                        if (event.target.checked) openMatching();
                        else {
                          setBulkOpen(false);
                          setMatchSource(null);
                        }
                      }}
                    />
                    مطابقة الوحدة بوحدات أخرى
                  </label>
                )}
              <button
                type="submit"
                form={formId}
                className="btn-primary"
                disabled={!canEdit || saving || photoBusy || bulkOpen}
              >
                <Save size={16} />
                {saving
                  ? "جارٍ الحفظ…"
                  : selectedIndex >= units.length - 1
                    ? "حفظ وإنهاء"
                    : "حفظ ومتابعة"}
                {selectedIndex < units.length - 1 && <ChevronLeft size={16} />}
              </button>
            </div>
          </>
        ) : null}

        {closeReviewOpen && (
          <section
            className="unit-setup-wizard__close-review"
            aria-label="تأكيد التعامل مع التعديلات غير المحفوظة"
          >
            <h3>لديك تعديلات غير محفوظة</h3>
            <p>
              يوجد تعديل محلي في {dirtyUnitIds.length} وحدة. تجاهل التعديلات
              للعودة عند الفتح التالي إلى آخر بيانات محفوظة، أو واصل التحرير.
              لحفظ بيانات الوحدة استخدم «حفظ ومتابعة».
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={discardAndClose}
              >
                تجاهل التعديلات
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setCloseReviewOpen(false)}
              >
                متابعة التحرير
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

export default UnitSetupWizard;
