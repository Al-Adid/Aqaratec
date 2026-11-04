import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, Plus, X } from "lucide-react";
import { money, type DemoEntity } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { usePrototype } from "@/contexts/PrototypeContext";
import { AssetPhotoGallery } from "@/components/app/PhotoGallery";
import { ContentPresetPicker } from "@/components/app/ContentPresetPicker";
import { RoomLayoutFields } from "@/components/app/RoomLayoutFields";
import { TenancyFields } from "@/components/app/TenancyFields";
import {
  electricityNumberForRentalTarget,
  propertyNumberForRentalTarget,
} from "@/lib/prototype-rental";
import { unitDisplayReference } from "@/lib/prototype-unit-identifiers";
import {
  getTenancyFormValues,
  getTenancySummary,
  type TenancySummary,
} from "@/lib/tenancy-information";
import {
  makeUnitProfile,
  parsePropertyProfile,
  parseUnitProfile,
  resolveUnitPurpose,
  unitProfileFormValues,
} from "@/lib/unit-profile";
import {
  accommodationFormValues,
  accommodationSummary,
  roomLayoutLabel,
} from "@/lib/room-layout";
import {
  assetFieldForError,
  nativeAssetFieldMessage,
} from "@/lib/asset-form-errors";
import { entityEditToken } from "@/lib/prototype-edit-concurrency";
import "./UnitDetailsDialog.css";

export type UnitDialogMode = "create" | "edit" | "details";

type UnitFormValues = Record<string, string>;
type UnitPurpose = "rent" | "sale";
type ParentPurpose = UnitPurpose | "mixed" | undefined;

const CATEGORY_OPTIONS = [
  ["", "غير محدد"],
  ["villa", "فيلا"],
  ["apartment", "شقة"],
  ["shop", "محل"],
  ["office", "مكتب"],
  ["other", "أخرى"],
] as const;

const FORM_KEYS = [
  "title",
  "unitCode",
  "floor",
  "propertyNumber",
  "electricityNumber",
  "monthlyRent",
  "salePrice",
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
  "planNumber",
  "waterNumber",
  "unitArea",
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function purpose(value: unknown): UnitPurpose | undefined {
  return value === "rent" || value === "sale" ? value : undefined;
}

function generateUnitRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `unit-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultFormValues(unit?: DemoEntity): UnitFormValues {
  const fromProfile = unitProfileFormValues(unit);
  return {
    title: unit?.title ?? "",
    unitCode: "",
    floor: unit ? text(unit.meta.floor) : "",
    propertyNumber: "",
    electricityNumber: "",
    monthlyRent: "",
    salePrice: "",
    unitPurpose: "",
    category: "",
    villaArrangement: "",
    apartmentLayout: "",
    roomLayout: "",
    bedrooms: "",
    livingRooms: "",
    bathrooms: "",
    kitchens: "",
    furnishing: "",
    description: "",
    contents: "",
    planNumber: "",
    waterNumber: "",
    unitArea: "",
    ...getTenancyFormValues(unit),
    ...fromProfile,
  };
}

function detailValue(value: string | undefined): string {
  return value?.trim() || "غير محدد";
}

function furnishingLabel(value: string): string {
  if (value === "furnished") return "مفروشة";
  if (value === "unfurnished") return "غير مفروشة";
  return "غير محدد";
}

function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find(([id]) => id === value)?.[1] ?? "غير محدد";
}

function arrangementLabel(value: string): string {
  if (value === "attached") return "متلاصقة";
  if (value === "detached") return "منفصلة";
  return "غير محدد";
}

function purposeLabel(value: UnitPurpose | undefined): string {
  if (value === "rent") return "إيجار";
  if (value === "sale") return "بيع";
  return "غير محدد";
}

function explicitMonthlyRent(unit: DemoEntity): string {
  const amount = unit.meta.monthlyRentMinor;
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? `${money(amount)} · خاص بالوحدة`
    : "غير مسجل كسعر خاص للوحدة";
}

function explicitSalePrice(unit: DemoEntity): string {
  const amount = parseUnitProfile(unit.meta.unitProfile).salePriceMinor;
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? `${money(amount)} · خاص بالوحدة`
    : "غير مسجل كسعر خاص للوحدة";
}

function parentPurpose(property: DemoEntity): ParentPurpose {
  try {
    // The profile parser owns validation. The local narrowing keeps this dialog
    // compatible while historical snapshots still contain an unspecified goal.
    const parsed = parsePropertyProfile(property.meta.propertyProfile) as {
      purpose?: unknown;
    };
    return parsed.purpose === "mixed" || purpose(parsed.purpose)
      ? (parsed.purpose as ParentPurpose)
      : undefined;
  } catch {
    // A malformed historical parent profile must not make the dialog infer a
    // goal or silently hide either independent physical-unit price.
    return undefined;
  }
}

function resolvedUnitPurpose(
  unit: DemoEntity | undefined,
  property: DemoEntity
): UnitPurpose | undefined {
  try {
    return resolveUnitPurpose(unit, property);
  } catch {
    // Malformed historical metadata stays neutral in the view. The domain
    // remains the authority that rejects an attempted save.
    return undefined;
  }
}

function unitPurposeDetail(unit: DemoEntity, property: DemoEntity): string {
  let explicit: UnitPurpose | undefined;
  try {
    explicit = purpose(
      (parseUnitProfile(unit.meta.unitProfile) as { purpose?: unknown }).purpose
    );
  } catch {
    return "غير محدد";
  }
  if (explicit) return `${purposeLabel(explicit)} · محدد للوحدة`;
  const inherited = parentPurpose(property);
  if (inherited === "rent" || inherited === "sale")
    return `${purposeLabel(inherited)} · موروث من العقار`;
  if (inherited === "mixed") return "غير محدد · يلزم هدف مستقل للوحدة";
  return "غير محدد";
}

function positiveMoney(amount: unknown, empty = "غير مسجل"): string {
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? money(amount)
    : empty;
}

function tenancySourceLabel(summary: TenancySummary): string {
  if (summary.source === "lease") return "عقد مسجل";
  if (summary.source === "declaration")
    return "إدخال أولي · غير مرتبط بعقد مسجل";
  if (summary.source === "units") return "ملخص الوحدات";
  return "لا يوجد عقد مسجل";
}

function areaDetail(value: string, fallback = "غير مسجلة"): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed} م²` : fallback;
}

function wholePropertySalePrice(property: DemoEntity): string {
  try {
    return positiveMoney(
      parsePropertyProfile(property.meta.propertyProfile).salePriceMinor
    );
  } catch {
    return "غير مسجل";
  }
}

function wholePropertyAccommodationValues(
  property: DemoEntity
): UnitFormValues {
  try {
    return accommodationFormValues(
      parsePropertyProfile(property.meta.propertyProfile).accommodation
    );
  } catch {
    return accommodationFormValues();
  }
}

function wholePropertyAccommodationSummary(property: DemoEntity): string {
  try {
    return (
      accommodationSummary(
        parsePropertyProfile(property.meta.propertyProfile).accommodation
      ) || "غير محددة"
    );
  } catch {
    return "غير محددة";
  }
}

function propertyNumberDisplay(
  unit: DemoEntity,
  property: DemoEntity,
  state: ReturnType<typeof usePrototype>["state"]
): string {
  const value = propertyNumberForRentalTarget(
    state.entities,
    property.id,
    unit.id
  );
  if (!value) return "غير مسجل";
  return defaultFormValues(unit).propertyNumber.trim()
    ? `${value} · خاص بالوحدة`
    : `${value} · موروث من العقار`;
}

function changedValues(
  values: UnitFormValues,
  openedValues: UnitFormValues,
  isCreate: boolean
): UnitFormValues {
  return Object.fromEntries(
    FORM_KEYS.filter(key => isCreate || values[key] !== openedValues[key]).map(
      key => [key, values[key] ?? ""]
    )
  );
}

function valuesEqual(left: UnitFormValues, right: UnitFormValues): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => left[key] === right[key]);
}

function fieldErrorFor(error: unknown): Record<string, string> {
  const message = error instanceof Error ? error.message : "تعذر حفظ الوحدة.";
  const field = assetFieldForError(message, true);
  return field ? { [field]: message } : {};
}

function FieldError({ message }: { message: string }) {
  return (
    <small className="property-form-error" role="alert">
      {message}
    </small>
  );
}

export function UnitDetailsDialog({
  mode,
  trigger,
  unit: suppliedUnit,
  property: suppliedProperty,
  canEdit,
  inheritedMonthlyRentMinor,
  onSubmit,
}: {
  mode: UnitDialogMode;
  trigger: ReactNode;
  unit?: DemoEntity;
  property: DemoEntity;
  canEdit: boolean;
  inheritedMonthlyRentMinor?: number;
  onSubmit?: (values: UnitFormValues) => unknown | Promise<unknown>;
}) {
  const { state, identity, canEdit: latestCanEdit } = usePrototype();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<UnitFormValues>(() =>
    defaultFormValues(suppliedUnit)
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [closeReviewOpen, setCloseReviewOpen] = useState(false);
  const [openedUnit, setOpenedUnit] = useState<DemoEntity | undefined>();
  const [openedProperty, setOpenedProperty] = useState<
    DemoEntity | undefined
  >();
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef("");
  const openedValuesRef = useRef<UnitFormValues>(
    defaultFormValues(suppliedUnit)
  );
  const openedTokenRef = useRef<string | undefined>(undefined);
  const openedIdentityRef = useRef<string>(identity.storageKey);
  const openedUnitIdRef = useRef<string | undefined>(suppliedUnit?.id);
  const openedPropertyIdRef = useRef(suppliedProperty.id);
  const busyRef = useRef(false);
  const requestCloseRef = useRef<() => void>(() => {});
  const unit = open ? (openedUnit ?? suppliedUnit) : suppliedUnit;
  const property = open
    ? (openedProperty ?? suppliedProperty)
    : suppliedProperty;
  const currentCanEdit = canEdit && latestCanEdit;
  const isDetails = mode === "details";
  const isCreate = mode === "create";
  const parentGoal = parentPurpose(property);
  const isWholePropertyTarget =
    unit?.meta.wholeProperty === true ||
    text(property.meta.rentalMode) === "whole";
  const isPhysicalUnit = !isWholePropertyTarget;
  const selectedUnitGoal = purpose(values.unitPurpose);
  const inheritedUnitGoal = purpose(parentGoal);
  // A blank select means inherit a single parent goal. It never means that a
  // mixed parent may guess from a price already stored on the unit.
  const draftPurpose = selectedUnitGoal ?? inheritedUnitGoal;
  const showMonthlyRent = isPhysicalUnit && draftPurpose === "rent";
  const showSalePrice = isPhysicalUnit && draftPurpose === "sale";
  const detailPurpose = unit ? resolvedUnitPurpose(unit, property) : undefined;
  const showDetailMonthlyRent = isPhysicalUnit && detailPurpose === "rent";
  const showDetailSalePrice = isPhysicalUnit && detailPurpose === "sale";
  const showWholeMonthlyRent = isWholePropertyTarget && parentGoal !== "sale";
  const showWholeSalePrice = isWholePropertyTarget && parentGoal !== "rent";
  const title = isDetails
    ? `تفاصيل الوحدة: ${unit?.title ?? ""}`
    : isCreate
      ? "إضافة وحدة"
      : `تعديل الوحدة: ${unit?.title ?? ""}`;
  const reference = unit ? unitDisplayReference(state.entities, unit.id) : "";
  const electricity = unit
    ? electricityNumberForRentalTarget(state.entities, property.id, unit.id)
    : "";
  const detailValues = unit ? defaultFormValues(unit) : defaultFormValues();
  const wholeAccommodationValues = useMemo(
    () => wholePropertyAccommodationValues(property),
    [property]
  );
  const wholeAccommodationSummary = useMemo(
    () => wholePropertyAccommodationSummary(property),
    [property]
  );
  const tenancySummary = useMemo(
    () =>
      getTenancySummary(state.entities, property, unit, scenarioDate(state)),
    [property, state, unit]
  );
  const showVillaFields = isPhysicalUnit && values.category === "villa";
  const canOpen = isDetails || currentCanEdit;
  const isDirty = !isDetails && !valuesEqual(values, openedValuesRef.current);
  const formDescription = useMemo(() => {
    const legacyRentNotice =
      typeof inheritedMonthlyRentMinor === "number" &&
      Number.isSafeInteger(inheritedMonthlyRentMinor) &&
      inheritedMonthlyRentMinor > 0
        ? `يوجد افتراضي إيجار سابق للعقار بقيمة ${money(inheritedMonthlyRentMinor)}؛ لا يُنسخ تلقائيًا إلى هذه الوحدة ولا يعد سعرًا خاصًا لها.`
        : "";
    const priceNotice = isWholePropertyTarget
      ? "هذا هدف تأجير داخلي للعقار بالكامل، وليس وحدة مادية إضافية؛ أسعار العقار للقراءة فقط من معلومات الأصل."
      : parentGoal === "mixed"
        ? "العقار له غرضان؛ اختر هدفًا مستقلًا لهذه الوحدة قبل الحفظ. لا يُستنتج الهدف من سعر قديم."
        : draftPurpose === "rent"
          ? "يمكن إدخال إيجار شهري خاص بهذه الوحدة؛ لا ينشئ ذلك عقدًا أو ذمة."
          : draftPurpose === "sale"
            ? "يمكن إدخال سعر بيع مطلوب خاص بهذه الوحدة؛ لا ينشئ ذلك بيعًا أو قبضًا."
            : "اختر هدف الوحدة لإظهار السعر المناسب. لا يُفترض الإيجار أو البيع من سعر العقار أو من سجل قديم.";
    if (isCreate) {
      return `أدخل بيانات الوحدة الوصفية. يُولَّد الرقم التالي إن تركت الرمز فارغًا. لا يمكن اختيار «مشغولة» يدويًا؛ الإشغال على العقد فقط. ${priceNotice} ${legacyRentNotice} احفظ الوحدة أولاً؛ ستتاح إضافة صورها الفردية من نافذة التفاصيل بعد الحفظ.`;
    }
    return `البيانات الوصفية محفوظة محليًا فقط. ${priceNotice} ${legacyRentNotice} لا يثبت هذا النموذج إشغالًا ولا ينشئ عقدًا أو استحقاقًا أو عملية دفع.`;
  }, [
    draftPurpose,
    inheritedMonthlyRentMinor,
    isCreate,
    isWholePropertyTarget,
    parentGoal,
  ]);

  useEffect(() => {
    if (!open) return;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));
    const initial = dialogRef.current?.querySelector<HTMLElement>(
      isDetails
        ? "button:not(:disabled), [href]"
        : "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)"
    );
    (initial ?? focusable()[0] ?? dialogRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) requestCloseRef.current();
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
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [isDetails, open]);

  useEffect(() => {
    if (!open || isDetails || !isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDetails, isDirty, open]);

  const setValue = (key: string, next: string) => {
    if (!currentCanEdit || saving) return;
    setValues(previous => ({ ...previous, [key]: next }));
    setFieldErrors(previous => {
      if (!previous[key]) return previous;
      const { [key]: _removed, ...remaining } = previous;
      return remaining;
    });
    setError("");
  };

  const setCategory = (nextCategory: string) => {
    if (!currentCanEdit || saving) return;
    setValues(previous => {
      if (nextCategory === previous.category) return previous;
      return {
        ...previous,
        category: nextCategory,
        villaArrangement:
          nextCategory === "villa" ? previous.villaArrangement : "",
        apartmentLayout:
          nextCategory === "apartment"
            ? previous.roomLayout || previous.apartmentLayout || ""
            : "",
      };
    });
    setError("");
    setFieldErrors({});
  };

  const setRoomLayout = (patch: UnitFormValues) => {
    if (!currentCanEdit || saving) return;
    setValues(previous => ({ ...previous, ...patch }));
  };

  const closeImmediately = () => {
    setCloseReviewOpen(false);
    setOpen(false);
  };

  const requestClose = () => {
    if (busyRef.current) return;
    if (isDirty) {
      setCloseReviewOpen(true);
      return;
    }
    closeImmediately();
  };
  requestCloseRef.current = requestClose;

  const openFromTrigger = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!canOpen) return;
    const latestProperty =
      state.entities.properties.find(row => row.id === suppliedProperty.id) ??
      suppliedProperty;
    const latestUnit = suppliedUnit
      ? state.entities.units.find(row => row.id === suppliedUnit.id)
      : undefined;
    if (suppliedUnit && !latestUnit) return;
    const openedValues = defaultFormValues(latestUnit);
    returnFocusRef.current = event.target as HTMLElement;
    openedValuesRef.current = openedValues;
    openedTokenRef.current = latestUnit
      ? entityEditToken(latestUnit)
      : undefined;
    openedIdentityRef.current = identity.storageKey;
    openedUnitIdRef.current = latestUnit?.id;
    openedPropertyIdRef.current = latestProperty.id;
    requestIdRef.current = generateUnitRequestId();
    setOpenedUnit(latestUnit);
    setOpenedProperty(latestProperty);
    setValues(openedValues);
    setError("");
    setFieldErrors({});
    setCloseReviewOpen(false);
    setOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    if (!currentCanEdit || !onSubmit) {
      setError("المعاينة الحالية للقراءة فقط.");
      return;
    }
    if (!event.currentTarget.reportValidity()) return;
    if (isPhysicalUnit && parentGoal === "mixed" && !selectedUnitGoal) {
      const message = "حدّد هدف الوحدة: إيجار أو بيع.";
      setError(message);
      setFieldErrors({ unitPurpose: message });
      return;
    }
    const currentUnit = openedUnitIdRef.current
      ? state.entities.units.find(row => row.id === openedUnitIdRef.current)
      : undefined;
    const currentProperty = state.entities.properties.find(
      row => row.id === openedPropertyIdRef.current
    );
    if (
      openedIdentityRef.current !== identity.storageKey ||
      !currentProperty ||
      (openedUnitIdRef.current &&
        (!currentUnit || currentUnit.propertyId !== currentProperty.id))
    ) {
      setError(
        "تغيّر نطاق مساحة العمل أو ارتباط الوحدة؛ أعد فتح النافذة قبل الحفظ."
      );
      return;
    }
    busyRef.current = true;
    setSaving(true);
    try {
      const submitted = changedValues(
        values,
        openedValuesRef.current,
        isCreate
      );
      // A historical apartment can carry its only universal layout through an
      // intentional physical-category change. Ordinary edits never migrate a
      // profile or replace an independently updated layout.
      if (
        !isCreate &&
        currentUnit &&
        values.category !== openedValuesRef.current.category &&
        values.category !== "apartment" &&
        values.roomLayout &&
        values.roomLayout === openedValuesRef.current.roomLayout
      ) {
        const latestProfile = parseUnitProfile(currentUnit.meta.unitProfile);
        if (
          latestProfile.category === "apartment" &&
          !latestProfile.roomLayout &&
          latestProfile.apartmentLayout === values.roomLayout
        )
          submitted.roomLayout = values.roomLayout;
      }
      const validationValues = { ...values };
      const activePriceFields = new Set<string>();
      if (showMonthlyRent) activePriceFields.add("monthlyRent");
      if (showSalePrice) activePriceFields.add("salePrice");
      for (const field of ["monthlyRent", "salePrice"] as const) {
        // Strip hidden values before domain validation. An edit never submits an
        // unchanged visible price either, so it cannot overwrite a newer value
        // that was saved elsewhere while this dialog was open.
        if (
          !activePriceFields.has(field) ||
          (!isCreate && values[field] === openedValuesRef.current[field])
        ) {
          delete submitted[field];
        }
        if (!activePriceFields.has(field)) delete validationValues[field];
      }
      if (isWholePropertyTarget) {
        // This internal target represents the property as a whole. It is not a
        // second physical unit and cannot alter a unit goal or property prices.
        delete submitted.unitPurpose;
        delete validationValues.unitPurpose;
        delete submitted.unitArea;
        delete validationValues.unitArea;
      }
      if (tenancySummary.locked) {
        // A registered lease, including a ended historical lease, remains the
        // authority even if the dialog retained an earlier declaration draft.
        delete submitted.tenancyStatus;
        delete submitted.tenancyStartDate;
        delete submitted.tenancyEndDate;
        delete submitted.tenancyMonthlyRent;
      }
      // Keep profile validation and normalization in the domain contract rather
      // than recreating it in this dialog. Hidden price fields have already been
      // removed, so an inactive historical value cannot reject this submission.
      makeUnitProfile(validationValues);
      if (isCreate) submitted.requestId = requestIdRef.current;
      else if (openedTokenRef.current)
        submitted._expectedEntityToken = openedTokenRef.current;
      await onSubmit(submitted);
      closeImmediately();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "تعذر حفظ الوحدة.";
      setError(message);
      setFieldErrors(fieldErrorFor(caught));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <span
        className="dialog-trigger"
        aria-disabled={!canOpen}
        onClick={openFromTrigger}
      >
        {trigger}
      </span>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !saving) requestClose();
          }}
        >
          <section
            className="modal property-dialog unit-details-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {isDetails ? "ملف وحدة" : "وحدة مرتبطة بالعقار"}
                </span>
                <h2>{title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={requestClose}
                disabled={saving}
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>

            {isDetails ? (
              <div className="unit-details-content">
                <p className="muted small">
                  مراجعة وصف الوحدة وصورها المحلية. لا تثبت هذه الشاشة إشغالًا
                  ولا تعدّل عقودًا أو ذممًا أو عمليات دفع.
                </p>
                <dl className="property-facts unit-details-facts">
                  <div>
                    <dt>المرجع</dt>
                    <dd>{reference || "غير مسجل"}</dd>
                  </div>
                  <div>
                    <dt>العقار التابع</dt>
                    <dd>{property.title}</dd>
                  </div>
                  {isPhysicalUnit && (
                    <div>
                      <dt>الفئة</dt>
                      <dd>{categoryLabel(detailValues.category)}</dd>
                    </div>
                  )}
                  {!isWholePropertyTarget && unit && (
                    <div>
                      <dt>هدف الوحدة</dt>
                      <dd>{unitPurposeDetail(unit, property)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>الحالة</dt>
                    <dd>{detailValue(unit?.status)}</dd>
                  </div>
                  <div>
                    <dt>رقم الكهرباء / العداد</dt>
                    <dd>{detailValue(electricity)}</dd>
                  </div>
                  <div>
                    <dt>رقم العقار</dt>
                    <dd>
                      {unit
                        ? propertyNumberDisplay(unit, property, state)
                        : "غير مسجل"}
                    </dd>
                  </div>
                  <div>
                    <dt>حالة التأجير</dt>
                    <dd>{tenancySummary.label}</dd>
                  </div>
                  <div>
                    <dt>مصدر حالة التأجير</dt>
                    <dd>{tenancySourceLabel(tenancySummary)}</dd>
                  </div>
                  {tenancySummary.startDate && (
                    <div>
                      <dt>تاريخ بداية العقد</dt>
                      <dd dir="ltr">{tenancySummary.startDate}</dd>
                    </div>
                  )}
                  {tenancySummary.endDate && (
                    <div>
                      <dt>تاريخ نهاية العقد</dt>
                      <dd dir="ltr">{tenancySummary.endDate}</dd>
                    </div>
                  )}
                  {isPhysicalUnit && (
                    <div>
                      <dt>مساحة الوحدة (م²)</dt>
                      <dd>{areaDetail(detailValues.unitArea)}</dd>
                    </div>
                  )}
                  {isWholePropertyTarget && (
                    <div>
                      <dt>مساحة العقار / البناء (م²)</dt>
                      <dd>
                        {areaDetail(
                          String(property.meta.buildingArea ?? ""),
                          "غير مسجلة · للعقار بالكامل"
                        )}
                        {property.meta.buildingArea === undefined
                          ? ""
                          : " · للعقار بالكامل"}
                      </dd>
                    </div>
                  )}
                  {showDetailMonthlyRent && (
                    <div>
                      <dt>إيجار الوحدة الشهري</dt>
                      <dd>{unit ? explicitMonthlyRent(unit) : "غير محدد"}</dd>
                    </div>
                  )}
                  {showDetailSalePrice && (
                    <div>
                      <dt>سعر بيع الوحدة المطلوب</dt>
                      <dd>{unit ? explicitSalePrice(unit) : "غير محدد"}</dd>
                    </div>
                  )}
                  {showWholeMonthlyRent && (
                    <div>
                      <dt>إيجار العقار الشهري</dt>
                      <dd>{positiveMoney(property.meta.monthlyRentMinor)}</dd>
                    </div>
                  )}
                  {showWholeSalePrice && (
                    <div>
                      <dt>سعر بيع العقار المطلوب</dt>
                      <dd>{wholePropertySalePrice(property)}</dd>
                    </div>
                  )}
                </dl>
                {isWholePropertyTarget && (
                  <p className="muted small">
                    هذا هدف تأجير داخلي للعقار بالكامل؛ أسعاره تخص الأصل وتبقى
                    للقراءة فقط هنا، ولا تمثل سعرًا خاصًا لوحدة مادية.
                  </p>
                )}
                {isWholePropertyTarget ? (
                  <>
                    <section
                      className="unit-details-summary"
                      aria-label="مواصفات العقار الكامل"
                    >
                      <h3>مواصفات العقار الكامل · يتكوّن من</h3>
                      <p>{wholeAccommodationSummary}</p>
                      <AccommodationReadOnlyFacts
                        values={wholeAccommodationValues}
                      />
                    </section>
                    <section
                      className="unit-details-summary"
                      aria-label="وصف نصي إضافي للعقار"
                    >
                      <h3>وصف نصي إضافي للعقار</h3>
                      <p>{detailValue(text(property.meta.description))}</p>
                      <a
                        className="link-button"
                        href={`/properties/${property.id}`}
                      >
                        تعديل بيانات العقار
                      </a>
                    </section>
                  </>
                ) : (
                  <>
                    <section
                      className="unit-details-summary"
                      aria-label="وصف الوحدة"
                    >
                      <h3>وصف الوحدة</h3>
                      <p>{detailValue(detailValues.description)}</p>
                    </section>
                    <section
                      className="unit-details-summary"
                      aria-label="محتويات الوحدة وتوزيعها"
                    >
                      <h3>محتويات الوحدة / توزيعها</h3>
                      <p>{detailValue(detailValues.contents)}</p>
                    </section>
                    {unit && <UnitProfileReadOnlyFacts unit={unit} />}
                    {unit && (
                      <AssetPhotoGallery
                        kind="units"
                        id={unit.id}
                        title={unit.title}
                      />
                    )}
                  </>
                )}
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={requestClose}
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            ) : isWholePropertyTarget ? (
              <div className="unit-details-content">
                <p className="muted small unit-dialog-intro">
                  هذا هدف داخلي للعقار بالكامل وليس وحدة مادية مستقلة. لا تُحرر
                  مواصفاته أو هدفه أو أسعاره من ملف وحدة ثانٍ؛ استخدم بيانات
                  العقار لتبقى هناك نسخة واحدة معتمدة.
                </p>
                <section
                  className="unit-details-summary"
                  aria-label="مواصفات العقار الكامل"
                >
                  <h3>مواصفات العقار الكامل · يتكوّن من</h3>
                  <p>{wholeAccommodationSummary}</p>
                  <AccommodationReadOnlyFacts
                    values={wholeAccommodationValues}
                  />
                </section>
                <section
                  className="unit-details-summary"
                  aria-label="هدف وأسعار العقار"
                >
                  <h3>هدف وأسعار العقار</h3>
                  <p>
                    {parentGoal === "mixed"
                      ? "إيجار وبيع · من معلومات العقار"
                      : `${purposeLabel(purpose(parentGoal))} · من معلومات العقار`}
                  </p>
                </section>
                <section
                  className="unit-details-summary"
                  aria-label="وصف نصي إضافي للعقار"
                >
                  <h3>وصف نصي إضافي للعقار</h3>
                  <p>{detailValue(text(property.meta.description))}</p>
                </section>
                <div className="modal-footer">
                  <a
                    className="btn-primary"
                    href={`/properties/${property.id}`}
                  >
                    تعديل بيانات العقار
                  </a>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={requestClose}
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={submit}
                aria-busy={saving}
                onInvalidCapture={event => {
                  const control = event.target;
                  if (
                    control instanceof HTMLInputElement ||
                    control instanceof HTMLSelectElement ||
                    control instanceof HTMLTextAreaElement
                  ) {
                    const key = control.name;
                    if (key)
                      setFieldErrors(previous => ({
                        ...previous,
                        [key]: nativeAssetFieldMessage(control),
                      }));
                  }
                }}
              >
                <p className="muted small unit-dialog-intro">
                  {formDescription}
                </p>
                {error && (
                  <p className="property-form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="form-grid">
                  <label className="form-label">
                    <span>
                      اسم الوحدة <i className="required-mark">*</i>
                    </span>
                    <input
                      className="field"
                      name="title"
                      value={values.title}
                      required
                      maxLength={256}
                      disabled={!currentCanEdit || saving}
                      onChange={event => setValue("title", event.target.value)}
                    />
                    {fieldErrors.title && (
                      <FieldError message={fieldErrors.title} />
                    )}
                  </label>
                  <label className="form-label">
                    <span>
                      رمز الوحدة{" "}
                      {!isCreate && <i className="required-mark">*</i>}
                    </span>
                    <input
                      className="field"
                      name="unitCode"
                      value={values.unitCode}
                      required={!isCreate}
                      maxLength={80}
                      disabled={!currentCanEdit || saving}
                      placeholder={
                        isCreate
                          ? "اختياري · يُولّد التالي تلقائيًا"
                          : "مثل A-01 أو V-01"
                      }
                      onChange={event =>
                        setValue("unitCode", event.target.value)
                      }
                    />
                    <small className="muted">
                      رمز عرض قابل للتعديل ضمن هذا العقار فقط؛ لا يغيّر المعرّف
                      الداخلي أو العقود السابقة.
                    </small>
                    {fieldErrors.unitCode && (
                      <FieldError message={fieldErrors.unitCode} />
                    )}
                  </label>
                  {isPhysicalUnit && (
                    <label className="form-label">
                      <span>الدور</span>
                      <input
                        className="field"
                        name="floor"
                        value={values.floor}
                        maxLength={80}
                        disabled={!currentCanEdit || saving}
                        placeholder="اختياري · مثال: الأرضي أو B1"
                        onChange={event =>
                          setValue("floor", event.target.value)
                        }
                      />
                      <small className="muted">
                        وصف نصي اختياري للدور؛ لا يُحوّل أو يُخمّن رقمًا.
                      </small>
                      {fieldErrors.floor && (
                        <FieldError message={fieldErrors.floor} />
                      )}
                    </label>
                  )}
                  <label className="form-label">
                    <span>رقم العقار الخاص بالوحدة</span>
                    <input
                      className="field"
                      name="propertyNumber"
                      value={values.propertyNumber}
                      maxLength={80}
                      disabled={!currentCanEdit || saving}
                      placeholder="اختياري · يرث رقم العقار إن ترك فارغًا"
                      onChange={event =>
                        setValue("propertyNumber", event.target.value)
                      }
                    />
                    <small className="muted">
                      {text(property.meta.propertyNumber)
                        ? `رقم العقار الحالي: ${text(property.meta.propertyNumber)}.`
                        : "أضف رقم العقار للأصل أولاً إذا رغبت بالوراثة."}
                    </small>
                    {fieldErrors.propertyNumber && (
                      <FieldError message={fieldErrors.propertyNumber} />
                    )}
                  </label>
                  <label className="form-label">
                    <span>رقم الكهرباء / العداد</span>
                    <input
                      className="field"
                      name="electricityNumber"
                      value={values.electricityNumber}
                      maxLength={80}
                      disabled={!currentCanEdit || saving}
                      placeholder="اختياري · يرث رقم العقار إن ترك فارغًا"
                      onChange={event =>
                        setValue("electricityNumber", event.target.value)
                      }
                    />
                    {fieldErrors.electricityNumber && (
                      <FieldError message={fieldErrors.electricityNumber} />
                    )}
                  </label>
                  {isPhysicalUnit && (
                    <label className="form-label">
                      <span>مساحة الوحدة (م²)</span>
                      <input
                        className="field"
                        name="unitArea"
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.unitArea}
                        disabled={!currentCanEdit || saving}
                        placeholder="اختياري · مثل ١٢٠٫٥٠"
                        onChange={event =>
                          setValue("unitArea", event.target.value)
                        }
                      />
                      <small className="muted">
                        مساحة هذه الوحدة وحدها؛ لا تقسّم مساحة الأصل تلقائيًا.
                      </small>
                      {fieldErrors.unitArea && (
                        <FieldError message={fieldErrors.unitArea} />
                      )}
                    </label>
                  )}
                  <div className="span-all">
                    <TenancyFields
                      values={values}
                      onChange={setValue}
                      property={property}
                      unit={unit}
                      disabled={!currentCanEdit || saving}
                    />
                  </div>
                  {isPhysicalUnit && (
                    <label className="form-label">
                      <span>
                        هدف الوحدة
                        {parentGoal === "mixed" && (
                          <i className="required-mark">*</i>
                        )}
                      </span>
                      <select
                        className="field"
                        name="unitPurpose"
                        value={values.unitPurpose}
                        disabled={!currentCanEdit || saving}
                        onChange={event =>
                          setValue("unitPurpose", event.target.value)
                        }
                      >
                        <option value="">
                          {inheritedUnitGoal
                            ? `موروث من العقار: ${purposeLabel(inheritedUnitGoal)}`
                            : parentGoal === "mixed"
                              ? "اختر هدفًا مستقلًا"
                              : "غير محدد"}
                        </option>
                        <option value="rent">إيجار</option>
                        <option value="sale">بيع</option>
                      </select>
                      <small className="muted">
                        {parentGoal === "mixed"
                          ? "لا توجد وراثة في العقار المختلط؛ اختر إيجارًا أو بيعًا لهذه الوحدة."
                          : inheritedUnitGoal
                            ? "اتركه فارغًا لوراثة هدف العقار، أو اختر هدفًا مختلفًا كوحدة مستقلة."
                            : "اختر هدفًا لإظهار السعر المناسب؛ لا يتغير هدف العقار."}
                      </small>
                      {fieldErrors.unitPurpose && (
                        <FieldError message={fieldErrors.unitPurpose} />
                      )}
                    </label>
                  )}
                  {showMonthlyRent && (
                    <label className="form-label">
                      <span>إيجار الوحدة الشهري (ر.ق)</span>
                      <input
                        className="field"
                        name="monthlyRent"
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.monthlyRent}
                        disabled={!currentCanEdit || saving}
                        placeholder="اختياري · مثال ١٬٢٣٤٫٥٠"
                        onChange={event =>
                          setValue("monthlyRent", event.target.value)
                        }
                      />
                      <small className="muted">
                        سعر إيجار خاص اختياري لهذه الوحدة؛ لا ينسخ سعر العقار
                        تلقائيًا.
                      </small>
                      {fieldErrors.monthlyRent && (
                        <FieldError message={fieldErrors.monthlyRent} />
                      )}
                    </label>
                  )}
                  {showSalePrice && (
                    <label className="form-label">
                      <span>سعر بيع الوحدة المطلوب (ر.ق)</span>
                      <input
                        className="field"
                        name="salePrice"
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.salePrice}
                        disabled={!currentCanEdit || saving}
                        placeholder="اختياري · مثال ١٬٢٣٤٬٥٦٧٫٨٩"
                        onChange={event =>
                          setValue("salePrice", event.target.value)
                        }
                      />
                      <small className="muted">
                        سعر بيع خاص اختياري لهذه الوحدة؛ لا ينسخ سعر العقار
                        تلقائيًا.
                      </small>
                      {fieldErrors.salePrice && (
                        <FieldError message={fieldErrors.salePrice} />
                      )}
                    </label>
                  )}
                  {isWholePropertyTarget && (
                    <div className="form-label property-readonly-field">
                      <span>هدف وأسعار العقار</span>
                      <strong>
                        {parentGoal === "mixed"
                          ? "إيجار وبيع · من معلومات العقار"
                          : purposeLabel(purpose(parentGoal))}
                      </strong>
                      <small className="muted">
                        هذا هدف داخلي للعقار بالكامل؛ لا يمكن تعديل أسعار الأصل
                        أو هدفه من محرر الوحدة.
                      </small>
                    </div>
                  )}
                  {isPhysicalUnit && (
                    <>
                      <label className="form-label">
                        <span>فئة الوحدة</span>
                        <select
                          className="field"
                          name="category"
                          value={values.category}
                          disabled={!currentCanEdit || saving}
                          onChange={event => setCategory(event.target.value)}
                        >
                          {CATEGORY_OPTIONS.map(([value, label]) => (
                            <option key={value || "unknown"} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.category && (
                          <FieldError message={fieldErrors.category} />
                        )}
                      </label>
                      {showVillaFields && (
                        <label className="form-label">
                          <span>ترتيب الفيلا</span>
                          <select
                            className="field"
                            name="villaArrangement"
                            value={values.villaArrangement}
                            disabled={!currentCanEdit || saving}
                            onChange={event =>
                              setValue("villaArrangement", event.target.value)
                            }
                          >
                            <option value="">غير محدد</option>
                            <option value="attached">متلاصقة</option>
                            <option value="detached">منفصلة</option>
                          </select>
                          {fieldErrors.villaArrangement && (
                            <FieldError
                              message={fieldErrors.villaArrangement}
                            />
                          )}
                        </label>
                      )}
                      {isPhysicalUnit && (
                        <RoomLayoutFields
                          values={values}
                          onChange={setRoomLayout}
                          disabled={!currentCanEdit || saving}
                        />
                      )}
                    </>
                  )}
                  <label className="form-label">
                    <span>رقم المخطط</span>
                    <input
                      className="field"
                      name="planNumber"
                      maxLength={80}
                      value={values.planNumber}
                      disabled={!currentCanEdit || saving}
                      onChange={event =>
                        setValue("planNumber", event.target.value)
                      }
                    />
                    {fieldErrors.planNumber && (
                      <FieldError message={fieldErrors.planNumber} />
                    )}
                  </label>
                  <label className="form-label">
                    <span>رقم الماء</span>
                    <input
                      className="field"
                      name="waterNumber"
                      maxLength={80}
                      value={values.waterNumber}
                      disabled={!currentCanEdit || saving}
                      onChange={event =>
                        setValue("waterNumber", event.target.value)
                      }
                    />
                    {fieldErrors.waterNumber && (
                      <FieldError message={fieldErrors.waterNumber} />
                    )}
                  </label>
                  <label className="form-label span-all">
                    <span>وصف الوحدة</span>
                    <textarea
                      className="field"
                      name="description"
                      rows={3}
                      maxLength={1024}
                      value={values.description}
                      disabled={!currentCanEdit || saving}
                      onChange={event =>
                        setValue("description", event.target.value)
                      }
                    />
                  </label>
                  <div className="span-all">
                    <ContentPresetPicker
                      label="محتويات الوحدة / توزيعها"
                      value={values.contents}
                      onChange={next => setValue("contents", next)}
                      disabled={!currentCanEdit || saving}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!currentCanEdit || saving}
                  >
                    {isCreate ? <Plus size={16} /> : <Pencil size={16} />}
                    {saving
                      ? "جارٍ الحفظ…"
                      : isCreate
                        ? "حفظ الوحدة"
                        : "حفظ التعديل"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={requestClose}
                    disabled={saving}
                  >
                    إلغاء
                  </button>
                </div>
                {closeReviewOpen && (
                  <section
                    className="unit-dialog-confirmation"
                    role="alertdialog"
                  >
                    <h3>لديك تعديلات غير محفوظة</h3>
                    <p>
                      تجاهل التعديلات يعيد فتح الوحدة لاحقًا بآخر بيانات محفوظة.
                    </p>
                    <div className="modal-footer">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={closeImmediately}
                      >
                        تجاهل التغييرات
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
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function AccommodationReadOnlyFacts({
  values,
  showCategory = false,
  showIdentifiers = false,
}: {
  values: UnitFormValues;
  showCategory?: boolean;
  showIdentifiers?: boolean;
}) {
  const layout = values.roomLayout || values.apartmentLayout;
  return (
    <dl className="unit-profile-readonly-facts">
      {showCategory && (
        <div>
          <dt>الفئة</dt>
          <dd>{categoryLabel(values.category)}</dd>
        </div>
      )}
      {values.category === "villa" && (
        <div>
          <dt>ترتيب الفيلا</dt>
          <dd>{arrangementLabel(values.villaArrangement)}</dd>
        </div>
      )}
      <div>
        <dt>تكوين الوحدة / توزيع الشقة</dt>
        <dd>{roomLayoutLabel(layout)}</dd>
      </div>
      <div>
        <dt>الغرف</dt>
        <dd>{detailValue(values.bedrooms)}</dd>
      </div>
      <div>
        <dt>الصالات</dt>
        <dd>{detailValue(values.livingRooms)}</dd>
      </div>
      <div>
        <dt>الحمامات</dt>
        <dd>{detailValue(values.bathrooms)}</dd>
      </div>
      <div>
        <dt>المطابخ</dt>
        <dd>{detailValue(values.kitchens)}</dd>
      </div>
      <div>
        <dt>التأثيث</dt>
        <dd>{furnishingLabel(values.furnishing)}</dd>
      </div>
      {showIdentifiers && (
        <>
          <div>
            <dt>رقم المخطط</dt>
            <dd>{detailValue(values.planNumber)}</dd>
          </div>
          <div>
            <dt>رقم الماء</dt>
            <dd>{detailValue(values.waterNumber)}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

export function UnitProfileReadOnlyFacts({ unit }: { unit: DemoEntity }) {
  return (
    <AccommodationReadOnlyFacts
      values={defaultFormValues(unit)}
      showCategory
      showIdentifiers
    />
  );
}

export default UnitDetailsDialog;
