import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  FolderKanban,
  Home,
  Image as ImageIcon,
  Landmark,
  Plus,
  ReceiptText,
  Search,
  X,
} from "lucide-react";
import {
  AssetTransitionError,
  usePrototype,
} from "@/contexts/PrototypeContext";
import {
  PropertyMediaEditor,
  type PropertyMediaEditorHandle,
} from "@/components/app/PropertyMediaEditor";
import { PropertyMediaDisplay } from "@/components/app/PropertyMediaDisplay";
import { PropertyCover } from "@/components/app/PropertyCover";
import { PropertyInlineUnits } from "@/components/app/PropertyInlineUnits";
import { AssetRemovalButton } from "@/components/app/AssetRemovalButton";
import { UnitSerialEditor } from "@/components/app/UnitSerialEditor";
import { UnitMonthlyRentEditor } from "@/components/app/UnitMonthlyRentEditor";
import { PropertyImport } from "@/components/app/PropertyImport";
import {
  AssetPhotoGallery,
  GroupUnitPhotoGallery,
} from "@/components/app/PhotoGallery";
import { Link } from "wouter";
import { useI18n, toEnglish } from "@/i18n";
import NotFound from "@/pages/NotFound";
import { UnitDetailsDialog } from "./UnitDetailsDialog";
import { UnitSetupWizard } from "./UnitSetupWizard";
import {
  COMPOSITION_CATEGORIES,
  compositionCategory,
  compositionCategoryLabel,
  physicalCompositionUnits,
  propertyUnitComposition,
  type CompositionCategory,
} from "@/lib/unit-composition";
import {
  DemoNotice,
  EmptyState,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { BRAND_ASSETS, money, type DemoEntity } from "@shared/prototype";
import {
  ageLabel,
  assetTypeFromMeta,
  assetTypeLabel,
  buildingYearFromMeta,
  collectionAccountFromMeta,
  derivePropertyAge,
  inputMethodFromMeta,
  inputMethodLabel,
  MAX_PROPERTY_TITLE_LENGTH,
  usageTypeLabel,
  propertyUnitCompositionLabel,
  PROPERTY_UNIT_COMPOSITION_OPTIONS,
  rentalModeFromMeta,
  rentalModeLabel,
  type PropertyAssetType,
  type PropertyUsageType,
} from "@/lib/property-fields";
import {
  electricityNumberForRentalTarget,
  createRentalProperty as transitionCreateRentalProperty,
  updateRentalProperty,
} from "@/lib/prototype-rental";
import { parsePropertyMedia } from "@/lib/property-media";
import { unitOccupancyAt } from "@/lib/prototype-lease-lifecycle";
import { unitDisplayReference } from "@/lib/prototype-unit-identifiers";
import {
  createDescribedUnit,
  makePropertyProfile,
  mortgageStatusLabel,
  parsePropertyProfile,
  parseUnitProfile,
  resolveUnitPurpose,
  propertyPurposeLabel,
  serializePropertyProfile,
  unitProfileFormValues,
  unitProfileSummary,
  updateDescribedUnit,
} from "@/lib/unit-profile";
import { scenarioDate } from "@shared/prototype-clock";
import {
  DEMO_DATE,
  StatusBadge,
  entityInput,
  entityMeta,
  idSuffix,
  portfolioName,
  scopedRows,
  sumMinor,
  value,
} from "./operatingUtils";
import "./property-sheet.css";
import { ContentPresetPicker } from "@/components/app/ContentPresetPicker";
import { RoomLayoutFields } from "@/components/app/RoomLayoutFields";
import {
  accommodationFormValues,
  accommodationSummary,
} from "@/lib/room-layout";
import { TenancyFields } from "@/components/app/TenancyFields";
import { TenancyReadout } from "@/components/app/TenancyReadout";
import {
  activePropertyFormValues,
  filterPropertyProfileForType,
  getPropertyFieldPolicy,
} from "@/lib/property-applicability";
import {
  makePropertyLocation,
  parsePropertyLocation,
} from "@/lib/newproperty-location";
import { entityEditToken } from "@/lib/prototype-edit-concurrency";
import {
  assetFieldForError,
  nativeAssetFieldMessage,
} from "@/lib/asset-form-errors";
import {
  getTenancyFormValues,
  getTenancySummary,
} from "@/lib/tenancy-information";

const PROPERTY_IMAGES = [
  BRAND_ASSETS.villa,
  BRAND_ASSETS.apartments,
  BRAND_ASSETS.tower,
];

const ASSET_OPTIONS: Array<{ value: PropertyAssetType; label: string }> = [
  { value: "villa", label: "فيلا" },
  { value: "villa_complex", label: "مجمع فلل" },
  { value: "building", label: "عمارة" },
  { value: "apartment", label: "شقق" },
  { value: "land", label: "أرض" },
  { value: "shop", label: "محل" },
  { value: "office", label: "مكتب" },
  { value: "mixed", label: "متعدد الاستخدام" },
];

const USAGE_OPTIONS: Array<{ value: PropertyUsageType; label: string }> = [
  { value: "residential", label: "سكني" },
  { value: "commercial", label: "تجاري" },
  { value: "mixed", label: "مختلط" },
];

const DEFAULT_USAGE: Record<PropertyAssetType, PropertyUsageType> = {
  villa: "residential",
  villa_complex: "residential",
  building: "residential",
  apartment: "residential",
  land: "residential",
  shop: "commercial",
  office: "commercial",
  mixed: "mixed",
};

type PropertyFormValues = Record<string, string>;
type SortKey = "title" | "assetType" | "age" | "units" | "account" | "source";
type SortDirection = "asc" | "desc";
const PROPERTY_LOCATION_FIELDS = [
  "zoneNumber",
  "streetNumber",
  "buildingNumber",
  "mapUrl",
] as const;
type PropertyLocationField = (typeof PROPERTY_LOCATION_FIELDS)[number];

interface PropertyRegistryRow {
  property: DemoEntity;
  assetType?: PropertyAssetType;
  age: ReturnType<typeof derivePropertyAge>;
  unitCount: number;
  occupiedCount: number;
  account: string;
  source: string;
}

function EditGuard({ canEdit }: { canEdit: boolean }) {
  return canEdit ? null : (
    <p className="muted">
      المعاينة الحالية للقراءة؛ بدّل الدور إلى المشغّل لتجربة التعديل المحلي.
    </p>
  );
}

function occupancyLabel(occupancy: ReturnType<typeof unitOccupancyAt>): string {
  if (occupancy === "occupied") return "مؤجرة";
  if (occupancy === "reserved") return "محجوزة";
  if (occupancy === "unavailable") return "قيد التجهيز";
  return "شاغرة";
}

function minorToInput(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value / 100)
    : "";
}

function positiveMinor(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function positiveMinorToInput(value: unknown): string {
  const amount = positiveMinor(value);
  return amount === undefined ? "" : String(amount / 100);
}

function areaLabel(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value} م²`
    : "غير مسجلة";
}

function propertyMonthlyRentLabel(property: DemoEntity): string {
  const profile = propertyProfileFor(property);
  if (rentalModeFromMeta(property.meta) === "units")
    return "سعر مستقل في معلومات كل وحدة";
  if (profile.purpose === "mixed") {
    const rent = positiveMinor(property.meta.monthlyRentMinor);
    return `إيجار: ${rent === undefined ? "غير مسجل" : money(rent)} شهريًا · بيع: ${profile.salePriceMinor === undefined ? "غير مسجل" : money(profile.salePriceMinor)}`;
  }
  if (profile.purpose === "sale") {
    return profile.salePriceMinor === undefined
      ? "سعر البيع غير مسجل"
      : `${money(profile.salePriceMinor)} · للبيع`;
  }
  const rentalMode = rentalModeFromMeta(property.meta);
  if (rentalMode === "whole") {
    const amount = positiveMinor(property.meta.monthlyRentMinor);
    return amount === undefined ? "غير مسجل" : `${money(amount)} شهريًا`;
  }
  if (rentalMode === "units") {
    const amount = positiveMinor(property.meta.unitMonthlyRentMinor);
    return amount === undefined
      ? "غير مسجل"
      : `${money(amount)} لكل وحدة (افتراضي)`;
  }
  const whole = positiveMinor(property.meta.monthlyRentMinor);
  const unit = positiveMinor(property.meta.unitMonthlyRentMinor);
  if (whole !== undefined) return `${money(whole)} · نمط التأجير غير محدد`;
  if (unit !== undefined)
    return `${money(unit)} لكل وحدة · نمط التأجير غير محدد`;
  return "غير مسجل · حدّد طريقة التأجير";
}

function propertyMonthlyRentFact(property: DemoEntity): {
  label: string;
  value: string;
} {
  if (rentalModeFromMeta(property.meta) === "units")
    return {
      label: "تسعير الوحدات",
      value: propertyMonthlyRentLabel(property),
    };
  if (propertyProfileFor(property).purpose === "mixed")
    return {
      label: "قيمة الإيجار والبيع للعقار",
      value: propertyMonthlyRentLabel(property),
    };
  if (propertyProfileFor(property).purpose === "sale") {
    return {
      label: "سعر البيع المطلوب",
      value: propertyMonthlyRentLabel(property),
    };
  }
  const rentalMode = rentalModeFromMeta(property.meta);
  if (rentalMode === "whole") {
    return {
      label: "الإيجار الشهري",
      value: propertyMonthlyRentLabel(property),
    };
  }
  if (rentalMode === "units") {
    return {
      label: "الإيجار الشهري الافتراضي لكل وحدة",
      value: propertyMonthlyRentLabel(property),
    };
  }
  return {
    label: "إيجار شهري مسجل",
    value: propertyMonthlyRentLabel(property),
  };
}

function propertyProfileFor(property: DemoEntity) {
  return filterPropertyProfileForType(
    parsePropertyProfile(property.meta.propertyProfile),
    assetTypeFromMeta(property.meta),
    property.meta.usageType as PropertyUsageType | undefined,
    rentalModeFromMeta(property.meta)
  );
}

function propertyLocationFormValues(
  raw: unknown
): Record<PropertyLocationField, string> {
  try {
    const location = parsePropertyLocation(raw);
    return {
      zoneNumber: location.zoneNumber ?? "",
      streetNumber: location.streetNumber ?? "",
      buildingNumber: location.buildingNumber ?? "",
      mapUrl: location.mapUrl ?? "",
    };
  } catch {
    // Historical descriptive `location` remains independently viewable/editable.
    return {
      zoneNumber: "",
      streetNumber: "",
      buildingNumber: "",
      mapUrl: "",
    };
  }
}

function locationFieldForError(
  message: string
): PropertyLocationField | undefined {
  const aliases: Array<[RegExp, PropertyLocationField]> = [
    [/رقم المنطقة|zoneNumber/i, "zoneNumber"],
    [/رقم الشارع|streetNumber/i, "streetNumber"],
    [/رقم المبنى|buildingNumber/i, "buildingNumber"],
    [/رابط الموقع|عنوان الرابط|mapUrl/i, "mapUrl"],
  ];
  return aliases.find(([pattern]) => pattern.test(message))?.[1];
}

function accommodationDraft(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function propertyProfileDisplayLabel(label: string): string {
  return label === "غير مسجل" ? "غير محدد" : label;
}

function propertyProfileLabel(property: DemoEntity): string {
  const profile = propertyProfileFor(property);
  return `${propertyProfileDisplayLabel(propertyPurposeLabel(profile.purpose))} · ${propertyProfileDisplayLabel(mortgageStatusLabel(profile.mortgageStatus))}`;
}

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `property-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultValues(
  defaultPortfolioId: string,
  initialValues: Partial<PropertyFormValues> = {}
): PropertyFormValues {
  const assetType = (initialValues.assetType as PropertyAssetType) || "villa";
  return {
    title: "",
    portfolioId: defaultPortfolioId,
    assetType,
    usageType: DEFAULT_USAGE[assetType],
    buildingYear: "",
    rentalMode: "whole",
    monthlyRent: "",
    propertyPurpose: "",
    mortgageStatus: "",
    mortgageBank: "",
    salePrice: "",
    unitCount: "1",
    propertyNumber: "",
    electricityNumber: "",
    location: "",
    zoneNumber: "",
    streetNumber: "",
    buildingNumber: "",
    mapUrl: "",
    collectionAccount: "",
    bankName: "",
    accountOwner: "",
    condition: "",
    landArea: "",
    buildingArea: "",
    lastMaintenanceDate: "",
    lastMaintenanceCost: "",
    notes: "",
    description: "",
    unitComposition: "",
    availableServices: "",
    contents: "",
    accommodation: "",
    tenancyStatus: "",
    tenancyStartDate: "",
    tenancyEndDate: "",
    tenancyMonthlyRent: "",
    deedRef: "",
    planNumber: "",
    propertyMedia: "",
    inputMethod: "يدوي",
    ...initialValues,
  };
}

function valuesFromProperty(
  property: DemoEntity,
  unitCount: number,
  referenceDate = scenarioDate()
): PropertyFormValues {
  const assetType = assetTypeFromMeta(property.meta);
  const usage = String(property.meta.usageType ?? "");
  const rentalMode = rentalModeFromMeta(property.meta);
  const propertyProfile = propertyProfileFor(property);
  const propertyLocation = propertyLocationFormValues(
    property.meta.propertyLocation
  );
  return defaultValues(property.portfolioId, {
    ...getTenancyFormValues(property),
    title: property.title,
    assetType: assetType ?? "",
    usageType: usage,
    buildingYear: String(
      buildingYearFromMeta(property.meta, referenceDate) ?? ""
    ),
    unitCount: String(unitCount),
    rentalMode: rentalMode ?? "",
    propertyPurpose: propertyProfile.purpose ?? "",
    mortgageStatus: propertyProfile.mortgageStatus ?? "",
    mortgageBank: propertyProfile.mortgageBank ?? "",
    salePrice: positiveMinorToInput(propertyProfile.salePriceMinor),
    unitComposition: propertyProfile.unitComposition ?? "",
    contents: propertyProfile.contents ?? "",
    availableServices: entityMeta(property, "availableServices", ""),
    accommodation: propertyProfile.accommodation
      ? JSON.stringify(accommodationFormValues(propertyProfile.accommodation))
      : "",
    description: entityMeta(property, "description", ""),
    // A legacy property without an explicit mode must not be silently
    // reclassified from the shape of a saved amount.
    monthlyRent:
      rentalMode === "whole"
        ? positiveMinorToInput(property.meta.monthlyRentMinor)
        : rentalMode === "units"
          ? positiveMinorToInput(property.meta.unitMonthlyRentMinor)
          : "",
    propertyNumber: entityMeta(property, "propertyNumber", ""),
    electricityNumber: entityMeta(property, "electricityNumber", ""),
    location: entityMeta(property, "location", ""),
    ...propertyLocation,
    collectionAccount: collectionAccountFromMeta(property.meta),
    bankName: entityMeta(property, "bankName", ""),
    accountOwner: entityMeta(property, "accountOwner", ""),
    condition: entityMeta(property, "condition", ""),
    landArea: String(property.meta.landArea ?? ""),
    buildingArea: String(property.meta.buildingArea ?? ""),
    lastMaintenanceDate: entityMeta(property, "lastMaintenanceDate", ""),
    lastMaintenanceCost: minorToInput(property.meta.lastMaintenanceCostMinor),
    notes: entityMeta(
      property,
      "notes",
      entityMeta(property, "description", "")
    ),
    deedRef: entityMeta(property, "deedRef", ""),
    planNumber: entityMeta(
      property,
      "planNumber",
      entityMeta(property, "planRef", "")
    ),
    propertyMedia: entityMeta(property, "propertyMedia", ""),
    inputMethod: inputMethodFromMeta(property.meta) ?? "",
  });
}

function hasSavedPhotoReference(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return Boolean(parsePropertyMedia(value).photo);
  } catch {
    return false;
  }
}

function PropertyFormDialog({
  title,
  description,
  trigger,
  portfolios,
  defaultPortfolioId,
  canEdit,
  initialValues,
  unitCountLabel,
  rentalModeLocked = false,
  lockPortfolio = false,
  referenceDate,
  submitLabel,
  onSubmit,
  onSaved,
  property,
}: {
  title: string;
  description?: string;
  trigger: ReactNode;
  portfolios: DemoEntity[];
  defaultPortfolioId: string;
  canEdit: boolean;
  initialValues?: Partial<PropertyFormValues>;
  unitCountLabel?: string;
  rentalModeLocked?: boolean;
  lockPortfolio?: boolean;
  referenceDate: string;
  submitLabel: string;
  onSubmit: (values: PropertyFormValues) => unknown | Promise<unknown>;
  onSaved?: (result: unknown, values: PropertyFormValues) => void;
  property?: DemoEntity;
}) {
  const {
    identity,
    canEdit: latestCanEdit,
    state: currentState,
  } = usePrototype();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<PropertyFormValues>(() =>
    defaultValues(defaultPortfolioId, initialValues)
  );
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaDirty, setMediaDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [changePrompt, setChangePrompt] = useState<{
    key: string;
    next: string;
    labels: string[];
  } | null>(null);
  const openedEntityTokenRef = useRef<string | null>(null);
  const valuesRef = useRef(values);
  const dirtyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const mediaEditorRef = useRef<PropertyMediaEditorHandle>(null);
  const openedValuesRef = useRef<PropertyFormValues>({});
  const openedScopeRef = useRef<string | null>(null);
  const submissionRef = useRef(false);
  const latestContextRef = useRef({
    storageKey: identity.storageKey,
    canEdit: latestCanEdit,
  });
  const isBusy = isSubmitting || mediaBusy;
  const busyRef = useRef(isBusy);
  const policy = getPropertyFieldPolicy(
    values.assetType as PropertyAssetType,
    values.usageType as PropertyUsageType,
    values.rentalMode as "whole" | "units"
  );
  valuesRef.current = values;
  dirtyRef.current =
    mediaDirty ||
    JSON.stringify(values) !== JSON.stringify(openedValuesRef.current);

  latestContextRef.current = {
    storageKey: identity.storageKey,
    canEdit: latestCanEdit,
  };
  busyRef.current = isBusy;

  useEffect(() => {
    if (!open) return;
    const latestProperty =
      property &&
      currentState.entities.properties.find(row => row.id === property.id);
    const savedValues = latestProperty
      ? valuesFromProperty(
          latestProperty,
          currentState.entities.units.filter(
            unit =>
              unit.propertyId === latestProperty.id &&
              unit.portfolioId === latestProperty.portfolioId
          ).length,
          referenceDate
        )
      : initialValues;
    const openedValues = defaultValues(defaultPortfolioId, savedValues);
    openedValuesRef.current = openedValues;
    openedEntityTokenRef.current = latestProperty
      ? entityEditToken(latestProperty)
      : null;
    setValues(openedValues);
    setRequestId(generateRequestId());
    setError("");
    setIsSubmitting(false);
    setMediaBusy(false);
    setMediaDirty(false);
    setFieldErrors({});
    setDiscardPrompt(false);
    setChangePrompt(null);
    // Values are intentionally captured when the dialog opens, not on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));
    const initial = dialogRef.current?.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)"
    );
    (initial ?? focusable()[0] ?? dialogRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (busyRef.current) return;
        if (dirtyRef.current) setDiscardPrompt(true);
        else setOpen(false);
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  const setValue = (key: string, next: string) => {
    if (
      submissionRef.current ||
      busyRef.current ||
      !canEdit ||
      !latestContextRef.current.canEdit
    )
      return;
    setError("");
    setFieldErrors({});
    if (["assetType", "usageType", "rentalMode"].includes(key)) {
      const previous = valuesRef.current;
      const nextAsset =
        key === "assetType"
          ? (next as PropertyAssetType)
          : (previous.assetType as PropertyAssetType);
      const nextUsage =
        key === "assetType"
          ? getPropertyFieldPolicy(nextAsset).allowedUsages[0]
          : key === "usageType"
            ? (next as PropertyUsageType)
            : (previous.usageType as PropertyUsageType);
      const proposed = { ...previous, [key]: next, usageType: nextUsage };
      const before = activePropertyFormValues(previous);
      const after = activePropertyFormValues(proposed);
      const labels: string[] = [];
      const oldRooms = accommodationDraft(before.accommodation);
      const newRooms = accommodationDraft(after.accommodation);
      if (
        Object.keys(oldRooms).some(field => oldRooms[field] && !newRooms[field])
      )
        labels.push("مواصفات البناء أو تكوين الغرف غير المنطبقة");
      if (before.buildingYear && !after.buildingYear) labels.push("سنة البناء");
      if (before.buildingArea && !after.buildingArea)
        labels.push("مساحة البناء");
      if (before.unitComposition && !after.unitComposition)
        labels.push("وصف تقسيم الوحدات");
      if (labels.length) {
        setChangePrompt({ key, next, labels });
        return;
      }
    }
    applyValue(key, next);
  };

  const applyValue = (key: string, next: string) => {
    setValues(previous => {
      if (key === "rentalMode") {
        const unitCount =
          next === "whole"
            ? "1"
            : next === "units" && Number(previous.unitCount) < 2
              ? "2"
              : previous.unitCount;
        return {
          ...previous,
          rentalMode: next,
          unitCount,
        };
      }
      if (key !== "assetType") return { ...previous, [key]: next };
      const nextAsset = next as PropertyAssetType;
      return {
        ...previous,
        assetType: next,
        usageType: getPropertyFieldPolicy(nextAsset).allowedUsages[0],
      };
    });
  };

  const assertCurrentSubmissionContext = () => {
    if (openedScopeRef.current !== latestContextRef.current.storageKey) {
      throw new Error(
        "تغيّر نطاق مساحة العمل أثناء الحفظ؛ أعد فتح النموذج قبل المحاولة."
      );
    }
    if (!latestContextRef.current.canEdit) {
      throw new Error("لم تعد لديك صلاحية التعديل في السياق الحالي.");
    }
  };

  const closeWhenIdle = () => {
    if (busyRef.current) return;
    if (dirtyRef.current) setDiscardPrompt(true);
    else setOpen(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionRef.current || isBusy) return;
    if (!canEdit || !latestCanEdit) {
      setError("المعاينة الحالية للقراءة فقط.");
      return;
    }
    submissionRef.current = true;
    setIsSubmitting(true);
    setError("");
    let prepared = false;
    try {
      assertCurrentSubmissionContext();
      const activeValues = activePropertyFormValues(values);
      const openedActiveValues = activePropertyFormValues(
        openedValuesRef.current
      );
      const latestEntity =
        property &&
        currentState.entities.properties.find(row => row.id === property.id);
      if (
        latestEntity &&
        openedEntityTokenRef.current &&
        entityEditToken(latestEntity) !== openedEntityTokenRef.current
      )
        throw new Error(
          "يوجد تعديل أحدث على هذا العقار؛ لم نستبدله بمسودتك. احتفظ بمدخلاتك أو ألغِ وأعد الفتح لتحميل آخر نسخة."
        );
      const changedLocationValues = Object.fromEntries(
        PROPERTY_LOCATION_FIELDS.filter(
          key => activeValues[key] !== openedActiveValues[key]
        ).map(key => [key, activeValues[key]])
      );
      const propertyLocation = makePropertyLocation(
        latestEntity
          ? {
              ...propertyLocationFormValues(latestEntity.meta.propertyLocation),
              ...changedLocationValues,
            }
          : Object.fromEntries(
              PROPERTY_LOCATION_FIELDS.map(key => [key, activeValues[key]])
            )
      );
      // Validate the conditional price and mortgage before preparing any bytes.
      const latestPropertyForProfile =
        property &&
        currentState.entities.properties.find(row => row.id === property.id);
      const latestAccommodation = latestPropertyForProfile
        ? accommodationFormValues(
            propertyProfileFor(latestPropertyForProfile).accommodation
          )
        : {};
      const accommodationValues = accommodationDraft(
        activeValues.accommodation
      );
      const openedAccommodation = accommodationDraft(
        openedValuesRef.current.accommodation
      );
      const accommodationPatch = Object.fromEntries(
        Object.keys(accommodationValues)
          .filter(
            key =>
              (accommodationValues[key] ?? "") !==
              (openedAccommodation[key] ?? "")
          )
          .map(key => [key, accommodationValues[key]])
      );
      // An explicit standard preset sets its paired counts as one user action.
      if (
        accommodationPatch.roomLayout &&
        accommodationPatch.roomLayout !== "custom"
      ) {
        accommodationPatch.bedrooms = accommodationValues.bedrooms ?? "";
        accommodationPatch.livingRooms = accommodationValues.livingRooms ?? "";
      }
      const profileValues = latestPropertyForProfile
        ? {
            ...activeValues,
            accommodation: JSON.stringify({
              ...latestAccommodation,
              ...accommodationPatch,
            }),
          }
        : activeValues;
      const propertyProfileJSON = serializePropertyProfile(
        makePropertyProfile(
          values.rentalMode === "units" && !unitCountLabel
            ? { ...activePropertyFormValues(profileValues), salePrice: "" }
            : activePropertyFormValues(profileValues)
        )
      );
      const propertyMedia =
        (await mediaEditorRef.current?.prepare()) ?? values.propertyMedia;
      prepared = true;
      assertCurrentSubmissionContext();
      const {
        propertyPurpose,
        mortgageStatus,
        mortgageBank,
        salePrice,
        unitComposition,
        accommodation,
        monthlyRent,
        contents,
        tenancyStatus,
        tenancyStartDate,
        tenancyEndDate,
        tenancyMonthlyRent,
        ...propertyValues
      } = activeValues;
      PROPERTY_LOCATION_FIELDS.forEach(key => delete propertyValues[key]);
      const currentProperty =
        property &&
        currentState.entities.properties.find(row => row.id === property.id);
      const tenancyLocked =
        !!currentProperty &&
        getTenancySummary(
          currentState.entities,
          currentProperty,
          undefined,
          scenarioDate(currentState)
        ).locked;
      const submitted: PropertyFormValues = {
        ...propertyValues,
        ...(tenancyLocked
          ? {}
          : {
              tenancyStatus,
              tenancyStartDate,
              tenancyEndDate,
              tenancyMonthlyRent,
            }),
        // A hidden rental price must not clear or replace historical rent.
        ...(propertyPurpose === "sale" || values.rentalMode === "units"
          ? {}
          : { monthlyRent }),
        propertyLocation,
        propertyMedia,
        // The single persisted profile value is serialized JSON. Its storage
        // key is deliberately not split into purpose/mortgage metadata fields.
        propertyProfile: propertyProfileJSON,
        requestId,
        ...(openedEntityTokenRef.current
          ? { _expectedEntityToken: openedEntityTokenRef.current }
          : {}),
      };
      if (unitCountLabel) {
        const changed = Object.keys(values).filter(
          key =>
            !PROPERTY_LOCATION_FIELDS.includes(key as PropertyLocationField) &&
            key !== "propertyPurpose" &&
            key !== "mortgageStatus" &&
            key !== "mortgageBank" &&
            key !== "salePrice" &&
            key !== "unitComposition" &&
            key !== "accommodation" &&
            key !== "contents" &&
            (!tenancyLocked ||
              ![
                "tenancyStatus",
                "tenancyStartDate",
                "tenancyEndDate",
                "tenancyMonthlyRent",
              ].includes(key)) &&
            (key !== "monthlyRent" ||
              (propertyPurpose !== "sale" && values.rentalMode !== "units")) &&
            activeValues[key] !== openedActiveValues[key]
        );
        if (Object.keys(changedLocationValues).length)
          changed.push("propertyLocation");
        if (
          values.propertyPurpose !== openedValuesRef.current.propertyPurpose ||
          values.mortgageStatus !== openedValuesRef.current.mortgageStatus ||
          values.mortgageBank !== openedValuesRef.current.mortgageBank ||
          values.salePrice !== openedValuesRef.current.salePrice ||
          values.unitComposition !== openedValuesRef.current.unitComposition ||
          activeValues.accommodation !==
            activePropertyFormValues(openedValuesRef.current).accommodation ||
          values.contents !== openedValuesRef.current.contents
        )
          changed.push("propertyProfile");
        // Pending files become opaque references only during prepare(), so the
        // prepared value—not the pre-prepare form value—must drive this patch.
        if (
          propertyMedia !== openedValuesRef.current.propertyMedia &&
          !changed.includes("propertyMedia")
        )
          changed.push("propertyMedia");
        submitted._changedFields = JSON.stringify(changed);
      }
      const result = await onSubmit(submitted);
      // Once the property transition succeeded, its new blobs are referenced.
      // A later role/identity change must not roll back committed file bytes.
      prepared = false;
      setOpen(false);
      if (
        openedScopeRef.current === latestContextRef.current.storageKey &&
        latestContextRef.current.canEdit
      )
        onSaved?.(result, submitted);
    } catch (caught) {
      if (
        prepared &&
        !(caught instanceof AssetTransitionError && caught.assetCommitted)
      ) {
        try {
          await mediaEditorRef.current?.rollback();
        } catch {
          // Preserve the original save error; the editor owns pending-file cleanup.
        }
      }
      setError(caught instanceof Error ? caught.message : "تعذر حفظ العقار.");
      const message =
        caught instanceof Error ? caught.message : "تعذر حفظ العقار.";
      const field =
        assetFieldForError(message) ?? locationFieldForError(message);
      if (field) setFieldErrors({ [field]: message });
    } finally {
      submissionRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <span
        className="dialog-trigger"
        onClick={event => {
          event.stopPropagation();
          if (!canEdit) return;
          returnFocusRef.current = event.target as HTMLElement;
          openedScopeRef.current = latestContextRef.current.storageKey;
          setOpen(true);
        }}
      >
        {trigger}
      </span>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeWhenIdle();
          }}
        >
          <section
            className="modal property-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {unitCountLabel
                    ? "سجل عقار محلي"
                    : "المرحلة 1 · بيانات العقار"}
                </span>
                <h2>{title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closeWhenIdle}
                aria-label="إغلاق"
                disabled={isBusy}
              >
                <X size={20} />
              </button>
            </div>
            {description && <p className="muted small">{description}</p>}
            {!unitCountLabel && (
              <p className="property-form-step-preview muted small">
                1 بيانات العقار · 2 الوحدات والتسعير · 3 المساحات والتأجير · 4
                الموقع · 5 الصور والمرفقات
              </p>
            )}
            {error && (
              <p className="property-form-error" role="alert">
                {error}
              </p>
            )}
            {changePrompt && (
              <section
                className="property-form-error"
                role="alert"
                aria-label="تأكيد تغيير حقول العقار"
              >
                <p>
                  لن تحفظ {changePrompt.labels.join("، ")} كمعلومات نشطة بعد هذا
                  التغيير. تبقى مسودتها هنا للرجوع، ولا تتغير المراجع أو الصور
                  أو الحقول المشتركة. هل تتابع؟
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    applyValue(changePrompt.key, changePrompt.next);
                    setChangePrompt(null);
                  }}
                >
                  متابعة التغيير
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setChangePrompt(null)}
                >
                  رجوع دون تغيير
                </button>
              </section>
            )}
            {discardPrompt && (
              <section
                className="property-form-error"
                role="alert"
                aria-label="تغييرات عقار غير محفوظة"
              >
                <p>لديك تغييرات غير محفوظة. إغلاق النموذج يلغيها ولا يحفظها.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setDiscardPrompt(false);
                    setOpen(false);
                  }}
                >
                  تجاهل التغييرات والإغلاق
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setDiscardPrompt(false)}
                >
                  متابعة التحرير
                </button>
              </section>
            )}
            <form
              onSubmit={submit}
              aria-busy={isBusy}
              onInvalidCapture={event => {
                const field = event.target as HTMLInputElement;
                if (field.name)
                  setFieldErrors(previous => ({
                    ...previous,
                    [field.name]: nativeAssetFieldMessage(field),
                  }));
              }}
            >
              <fieldset
                className="property-form-content property-form-fieldset"
                disabled={isBusy || !canEdit || !latestCanEdit}
                aria-label="معلومات العقار"
              >
                <section
                  className="property-entry-choice"
                  aria-label="العقار كامل أم جزئي"
                >
                  <h3>العقار كامل أم جزئي؟</h3>
                  <div className="form-grid">
                    <label className="form-label">
                      <span>
                        طريقة إدارة العقار <i className="required-mark">*</i>
                      </span>
                      <select
                        name="rentalMode"
                        className="field"
                        value={values.rentalMode}
                        disabled={rentalModeLocked}
                        onChange={event =>
                          setValue("rentalMode", event.target.value)
                        }
                      >
                        {!values.rentalMode && (
                          <option value="">
                            غير مسجلة · اختر كامل أو جزئي
                          </option>
                        )}
                        <option value="whole">
                          كامل · بيع أو تأجير العقار بالكامل
                        </option>
                        <option value="units">جزئي · وحدات مستقلة</option>
                      </select>
                      {rentalModeLocked && (
                        <small className="muted">
                          هذا العقار لديه وحدات مرتبطة؛ تغيير الطريقة يخضع
                          لحماية بياناتها.
                        </small>
                      )}
                      {fieldErrors.rentalMode && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.rentalMode}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>هدف العقار</span>
                      <select
                        name="propertyPurpose"
                        className="field"
                        value={values.propertyPurpose}
                        onChange={event =>
                          setValue("propertyPurpose", event.target.value)
                        }
                      >
                        <option value="">غير محدد</option>
                        <option value="sale">بيع</option>
                        <option value="rent">إيجار</option>
                        <option value="mixed">بيع وإيجار</option>
                      </select>
                      {fieldErrors.propertyPurpose && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.propertyPurpose}
                        </small>
                      )}
                    </label>
                  </div>
                  <p className="muted small" aria-live="polite">
                    {values.rentalMode === "units"
                      ? "جزئي: أدخل المعلومات العامة والمساحات الكلية والخدمات هنا، ثم احفظ وافتح معلومات كل وحدة: المساحة والكهرباء والتأثيث والتأجير والوصف والسعر والصور."
                      : "كامل: أدخل وصف العقار ومساحته والكهرباء والتأثيث وحالة التأجير وتواريخ العقد والخدمات والسعر والصور مرة واحدة هنا، دون إضافة وحدات مستقلة."}
                  </p>
                </section>
                <section
                  className="property-form-section"
                  data-property-section="basic"
                  aria-labelledby="property-form-basic-title"
                >
                  <header className="property-form-section__heading">
                    <span className="property-form-section__number">1</span>
                    <div>
                      <h3 id="property-form-basic-title">بيانات العقار</h3>
                      <p className="muted small">
                        عرّف الأصل أولاً وحدد وصفه المختصر بصورة مستقلة عن النص
                        الحر.
                      </p>
                    </div>
                  </header>
                  <div className="form-grid">
                    <label className="form-label">
                      <span>
                        اسم العقار <i className="required-mark">*</i>
                      </span>
                      <input
                        name="title"
                        className="field"
                        value={values.title}
                        required
                        maxLength={MAX_PROPERTY_TITLE_LENGTH}
                        onChange={event =>
                          setValue("title", event.target.value)
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
                        المحفظة <i className="required-mark">*</i>
                      </span>
                      <select
                        name="portfolioId"
                        className="field"
                        value={values.portfolioId}
                        required
                        disabled={lockPortfolio}
                        onChange={event =>
                          setValue("portfolioId", event.target.value)
                        }
                      >
                        <option value="">اختر المحفظة التابعة</option>
                        {portfolios.map(portfolio => (
                          <option key={portfolio.id} value={portfolio.id}>
                            {portfolio.title}
                          </option>
                        ))}
                      </select>

                      {fieldErrors.portfolioId && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.portfolioId}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>
                        نوع الأصل <i className="required-mark">*</i>
                      </span>
                      <select
                        name="assetType"
                        className="field"
                        value={values.assetType}
                        onChange={event =>
                          setValue("assetType", event.target.value)
                        }
                      >
                        {ASSET_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      {fieldErrors.assetType && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.assetType}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>وصف العقار</span>
                      <select
                        name="unitComposition"
                        className="field"
                        value={values.unitComposition}
                        disabled={!policy.supportsUnitComposition}
                        onChange={event =>
                          setValue("unitComposition", event.target.value)
                        }
                      >
                        <option value="">
                          {policy.supportsUnitComposition
                            ? "غير محدد"
                            : "لا ينطبق"}
                        </option>
                        {PROPERTY_UNIT_COMPOSITION_OPTIONS.map(option => (
                          <option
                            key={option.value || "unspecified"}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {rentalModeLocked && (
                        <small className="muted">
                          وصف وصفي فقط؛ تبقى الوحدات الحالية ورموزها وأنواعها
                          كما هي.
                        </small>
                      )}
                      {!rentalModeLocked && (
                        <small className="muted">
                          اختيار وصفي مستقل عن كامل أو جزئي الذي حددته في بداية
                          الإضافة.
                        </small>
                      )}

                      {fieldErrors.unitComposition && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.unitComposition}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>
                        الاستخدام <i className="required-mark">*</i>
                      </span>
                      <select
                        name="usageType"
                        className="field"
                        value={values.usageType}
                        onChange={event =>
                          setValue("usageType", event.target.value)
                        }
                      >
                        {USAGE_OPTIONS.filter(option =>
                          policy.allowedUsages.includes(option.value)
                        ).map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      {fieldErrors.usageType && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.usageType}
                        </small>
                      )}
                    </label>
                    <label className="form-label span-all">
                      <span>الخدمات المتاحة للعقار</span>
                      <textarea
                        name="availableServices"
                        className="field"
                        rows={2}
                        maxLength={1024}
                        value={values.availableServices}
                        placeholder="مثل مواقف سيارات، أمن، مسبح، مصعد، حديقة أو خدمات أخرى"
                        onChange={event =>
                          setValue("availableServices", event.target.value)
                        }
                      />
                      <small className="muted">
                        خدمات عامة للعقار؛ معلومات ومحتويات كل وحدة تحفظ بشكل
                        مستقل.
                      </small>
                      {fieldErrors.availableServices && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.availableServices}
                        </small>
                      )}
                    </label>
                    <label className="form-label span-all">
                      <span>وصف نصي إضافي للعقار</span>
                      <textarea
                        name="description"
                        className="field"
                        rows={3}
                        value={values.description}
                        maxLength={1024}
                        placeholder="اكتب وصف العقار ومميزاته، سواء كان كاملًا أو مقسمًا إلى وحدات"
                        onChange={event =>
                          setValue("description", event.target.value)
                        }
                      />

                      {fieldErrors.description && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.description}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>سنة البناء</span>
                      <input
                        name="buildingYear"
                        className="field"
                        type="text"
                        inputMode="numeric"
                        min="1800"
                        max={Number(referenceDate.slice(0, 4))}
                        placeholder={
                          values.assetType === "land"
                            ? "لا ينطبق على الأرض"
                            : "غير معروفة"
                        }
                        disabled={!policy.supportsBuildingYear}
                        value={
                          policy.supportsBuildingYear ? values.buildingYear : ""
                        }
                        onChange={event =>
                          setValue("buildingYear", event.target.value)
                        }
                      />
                    </label>
                    <label className="form-label">
                      <span>رقم السند</span>
                      <input
                        name="deedRef"
                        className="field"
                        maxLength={1024}
                        placeholder="اختياري · مرجع السند"
                        value={values.deedRef}
                        onChange={event =>
                          setValue("deedRef", event.target.value)
                        }
                      />

                      {fieldErrors.deedRef && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.deedRef}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم المخطط العقاري</span>
                      <input
                        name="planNumber"
                        className="field"
                        maxLength={1024}
                        placeholder="اختياري · يُحفظ كمرجع للمخطط"
                        value={values.planNumber}
                        onChange={event =>
                          setValue("planNumber", event.target.value)
                        }
                      />

                      {fieldErrors.planNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.planNumber}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم العقار</span>
                      <input
                        name="propertyNumber"
                        className="field"
                        maxLength={80}
                        placeholder="اختياري · يحفظ الأصفار البادئة"
                        value={values.propertyNumber}
                        onChange={event =>
                          setValue("propertyNumber", event.target.value)
                        }
                      />

                      {fieldErrors.propertyNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.propertyNumber}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم الكهرباء / العداد</span>
                      <input
                        name="electricityNumber"
                        className="field"
                        maxLength={80}
                        placeholder="اختياري · يمكن إكماله عند إنشاء العقد"
                        value={values.electricityNumber}
                        onChange={event =>
                          setValue("electricityNumber", event.target.value)
                        }
                      />

                      {fieldErrors.electricityNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.electricityNumber}
                        </small>
                      )}
                    </label>
                  </div>
                </section>

                <section
                  className="property-form-section"
                  data-property-section="units-pricing"
                  aria-labelledby="property-form-units-pricing-title"
                >
                  <header className="property-form-section__heading">
                    <span className="property-form-section__number">2</span>
                    <div>
                      <h3 id="property-form-units-pricing-title">
                        الوحدات والهدف والتسعير
                      </h3>
                      <p className="muted small">
                        حدد عرض الأصل كاملًا أو تقسيمه صراحةً. مواصفات الأصل
                        الكامل هنا، وتفاصيل كل وحدة في المرحلة الثانية عند
                        التقسيم.
                      </p>
                    </div>
                  </header>
                  <div className="form-grid">
                    {unitCountLabel ? (
                      <div className="form-label property-readonly-field">
                        <span>
                          {values.rentalMode === "whole"
                            ? "هدف التأجير"
                            : "الوحدات"}
                        </span>
                        <strong>{unitCountLabel}</strong>
                      </div>
                    ) : values.rentalMode === "whole" ? (
                      <div className="form-label property-readonly-field">
                        <span>هدف التأجير</span>
                        <strong>هدف واحد: العقار بالكامل</strong>
                      </div>
                    ) : (
                      <label className="form-label">
                        <span>
                          عدد الوحدات الأولية <i className="required-mark">*</i>
                        </span>
                        <input
                          name="unitCount"
                          className="field"
                          type="text"
                          inputMode="numeric"
                          min="2"
                          max="50"
                          step="1"
                          value={values.unitCount}
                          required
                          onChange={event =>
                            setValue("unitCount", event.target.value)
                          }
                        />

                        {fieldErrors.unitCount && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.unitCount}
                          </small>
                        )}
                      </label>
                    )}
                    {values.rentalMode === "units" ? (
                      <div className="form-label property-readonly-field">
                        <span>سعر كل وحدة</span>
                        <strong>
                          يُحدد في معلومات الوحدة في المرحلة الثانية
                        </strong>
                        <small className="muted">
                          لكل وحدة إيجار أو سعر بيع مستقل حسب نوعها ومواصفاتها.
                          لا يُنسخ سعر موحد إلى الوحدات، وتبقى الأسعار العامة
                          السابقة محفوظة دون اعتبارها سعرًا خاصًا للوحدة.
                        </small>
                      </div>
                    ) : values.propertyPurpose === "mixed" ? (
                      <>
                        <label className="form-label">
                          <span>الإيجار الشهري (ر.ق)</span>
                          <input
                            name="monthlyRent"
                            className="field"
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={values.monthlyRent}
                            disabled={!values.rentalMode}
                            placeholder="اختياري · قيمة إيجار العقار الكامل"
                            onChange={event =>
                              setValue("monthlyRent", event.target.value)
                            }
                          />

                          {fieldErrors.monthlyRent && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.monthlyRent}
                            </small>
                          )}
                        </label>
                        <label className="form-label">
                          <span>سعر البيع المطلوب (ر.ق)</span>
                          <input
                            name="salePrice"
                            className="field"
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={values.salePrice}
                            disabled={!values.rentalMode}
                            placeholder="اختياري · قيمة بيع العقار الكامل"
                            onChange={event =>
                              setValue("salePrice", event.target.value)
                            }
                          />
                          <small className="muted">
                            عرض للبيع والإيجار في الوقت نفسه؛ لا ينفذ بيعًا أو
                            قبضًا ولا ينشئ هدف تأجير إضافيًا.
                          </small>

                          {fieldErrors.salePrice && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.salePrice}
                            </small>
                          )}
                        </label>
                      </>
                    ) : values.propertyPurpose === "sale" ? (
                      <label className="form-label">
                        <span>سعر البيع المطلوب (ر.ق)</span>
                        <input
                          name="salePrice"
                          className="field"
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={values.salePrice}
                          placeholder="اختياري · مثال ٢٬٥٠٠٬٠٠٠"
                          onChange={event =>
                            setValue("salePrice", event.target.value)
                          }
                        />
                        <small className="muted">
                          سعر مطلوب للعقار، وليس إيجارًا أو بيعًا منفذًا. تبقى
                          العقود والإيجارات السابقة دون تغيير.
                        </small>

                        {fieldErrors.salePrice && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.salePrice}
                          </small>
                        )}
                      </label>
                    ) : (
                      <label className="form-label">
                        <span>
                          {values.rentalMode === "units"
                            ? "الإيجار الشهري الافتراضي لكل وحدة (ر.ق)"
                            : "الإيجار الشهري (ر.ق)"}
                        </span>
                        <input
                          name="monthlyRent"
                          className="field"
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          placeholder={
                            values.rentalMode
                              ? "اختياري · مثال ١٬٢٣٤٫٥٠"
                              : "حدّد طريقة التأجير أولاً"
                          }
                          disabled={!values.rentalMode}
                          value={values.monthlyRent}
                          onChange={event =>
                            setValue("monthlyRent", event.target.value)
                          }
                        />
                        <small className="muted">
                          {!values.rentalMode
                            ? "السجل غير المصنّف لا يُفترض له سعر؛ اختر نمط التأجير صراحةً أولاً."
                            : values.rentalMode === "units"
                              ? "سعر افتراضي لكل وحدة، وليس إجمالي العمارة. تظل الوحدة بلا سعر خاص حتى تُنشأ أو تُعدّل."
                              : "اختياري؛ اتركه فارغًا لمسح الإيجار الشهري المسجل للعقار."}
                        </small>

                        {fieldErrors.monthlyRent && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.monthlyRent}
                          </small>
                        )}
                      </label>
                    )}
                    <div className="property-form-financial-group span-all">
                      <div className="property-form-financial-group__heading">
                        <h4>الرهن والوضع المالي الوصفي</h4>
                        <p className="muted small">
                          بنك الرهن منفصل عن حساب التحصيل ولا ينشئ تمويلاً أو
                          قرضًا.
                        </p>
                      </div>
                      <div className="form-grid">
                        <label className="form-label">
                          <span>حالة الرهن</span>
                          <select
                            name="mortgageStatus"
                            className="field"
                            value={values.mortgageStatus}
                            onChange={event =>
                              setValue("mortgageStatus", event.target.value)
                            }
                          >
                            <option value="">غير محدد</option>
                            <option value="free">حر</option>
                            <option value="mortgaged">مرهون</option>
                          </select>
                          <small className="muted">
                            صفة وصفية فقط؛ لا تسجل تمويلًا أو حسابًا مصرفيًا.
                          </small>

                          {fieldErrors.mortgageStatus && (
                            <small className="property-form-error" role="alert">
                              {fieldErrors.mortgageStatus}
                            </small>
                          )}
                        </label>
                        {values.mortgageStatus === "mortgaged" && (
                          <label className="form-label">
                            <span>
                              اسم بنك الرهن <i className="required-mark">*</i>
                            </span>
                            <input
                              name="mortgageBank"
                              className="field"
                              value={values.mortgageBank}
                              required
                              maxLength={160}
                              placeholder="البنك المرهون له العقار"
                              onChange={event =>
                                setValue("mortgageBank", event.target.value)
                              }
                            />
                            <small className="muted">
                              بنك الرهن، وليس بنك حساب التحصيل. لا ينشئ قرضًا.
                            </small>

                            {fieldErrors.mortgageBank && (
                              <small
                                className="property-form-error"
                                role="alert"
                              >
                                {fieldErrors.mortgageBank}
                              </small>
                            )}
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                  {!unitCountLabel && values.rentalMode === "units" && (
                    <p className="property-unit-auto-note muted small">
                      عند اختيار «تقسيم إلى وحدات»، تُنشأ الوحدات الأولية
                      تلقائيًا عند حفظ العقار، ثم تُكمل معلوماتها بشكل صريح في
                      المرحلة التالية.
                    </p>
                  )}
                </section>

                <section
                  className="property-form-section"
                  data-property-section="areas-tenancy"
                  aria-labelledby="property-form-areas-tenancy-title"
                >
                  <header className="property-form-section__heading">
                    <span className="property-form-section__number">3</span>
                    <div>
                      <h3 id="property-form-areas-tenancy-title">
                        المساحات وحالة التأجير
                      </h3>
                      <p className="muted small">
                        تُسجل المساحات والتصريح الحالي دون إنشاء عقد أو تحصيل.
                      </p>
                    </div>
                  </header>
                  {policy.supportsAccommodation && (
                    <div
                      className="property-media-form-block"
                      style={{ marginTop: 0, marginBottom: 16 }}
                    >
                      <h3>مواصفات العقار الكامل · يتكوّن من</h3>
                      <p className="muted small">
                        للبيع أو الإيجار كاملًا: سجل التكوين والمرافق هنا دون
                        إضافة وحدة مادية أخرى أو نسخ المواصفات إلى الوحدات.
                      </p>
                      <div className="form-grid">
                        <RoomLayoutFields
                          values={accommodationDraft(values.accommodation)}
                          label="تكوين العقار الكامل"
                          showVillaArrangement={policy.supportsVillaArrangement}
                          showRoomLayout={policy.supportsRoomLayout}
                          showFurnishing={policy.supportsFurnishing}
                          fieldPrefix="accommodation."
                          errors={fieldErrors}
                          disabled={isBusy || !canEdit || !latestCanEdit}
                          onChange={patch =>
                            setValue(
                              "accommodation",
                              JSON.stringify({
                                ...accommodationDraft(values.accommodation),
                                ...patch,
                              })
                            )
                          }
                        />
                      </div>
                      {fieldErrors.accommodation && (
                        <p className="property-form-error" role="alert">
                          {fieldErrors.accommodation}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="form-grid">
                    {policy.supportsBuildingArea ? (
                      <label className="form-label">
                        <span>مساحة العقار / البناء (م²)</span>
                        <input
                          name="buildingArea"
                          className="field"
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={values.buildingArea}
                          placeholder="اختياري · مثل ٤٢٠٫٥٠"
                          onChange={event =>
                            setValue("buildingArea", event.target.value)
                          }
                        />

                        {fieldErrors.buildingArea && (
                          <small className="property-form-error" role="alert">
                            {fieldErrors.buildingArea}
                          </small>
                        )}
                      </label>
                    ) : (
                      <div className="form-label property-readonly-field">
                        <span>مساحة البناء</span>
                        <strong>لا ينطبق</strong>
                      </div>
                    )}
                    <label className="form-label">
                      <span>مساحة الأرض (م²)</span>
                      <input
                        name="landArea"
                        className="field"
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.landArea}
                        placeholder="اختياري · مثل ٦٠٠"
                        onChange={event =>
                          setValue("landArea", event.target.value)
                        }
                      />

                      {fieldErrors.landArea && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.landArea}
                        </small>
                      )}
                    </label>
                    <div className="span-all">
                      <TenancyFields
                        values={values}
                        onChange={setValue}
                        property={property}
                        disabled={isBusy || !canEdit || !latestCanEdit}
                      />
                    </div>
                  </div>
                </section>

                <section
                  className="property-form-section"
                  data-property-section="location"
                  aria-labelledby="property-form-location-title"
                >
                  <header className="property-form-section__heading">
                    <span className="property-form-section__number">4</span>
                    <div>
                      <h3 id="property-form-location-title">الموقع</h3>
                      <p className="muted small">
                        أضف وصف الموقع وأرقامه المرجعية. يبقى الرابط للفتح
                        اليدوي فقط ولا يجلب التطبيق منه بيانات.
                      </p>
                    </div>
                  </header>
                  <div className="form-grid">
                    <label className="form-label">
                      <span>الموقع الوصفي</span>
                      <input
                        name="location"
                        className="field"
                        maxLength={1024}
                        placeholder="مدينة أو منطقة وصفية"
                        value={values.location}
                        onChange={event =>
                          setValue("location", event.target.value)
                        }
                      />

                      {fieldErrors.location && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.location}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم المنطقة</span>
                      <input
                        name="zoneNumber"
                        className="field"
                        maxLength={80}
                        placeholder="اختياري · يحفظ الأصفار البادئة"
                        value={values.zoneNumber}
                        onChange={event =>
                          setValue("zoneNumber", event.target.value)
                        }
                      />

                      {fieldErrors.zoneNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.zoneNumber}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم الشارع</span>
                      <input
                        name="streetNumber"
                        className="field"
                        maxLength={80}
                        placeholder="اختياري · يحفظ الأصفار البادئة"
                        value={values.streetNumber}
                        onChange={event =>
                          setValue("streetNumber", event.target.value)
                        }
                      />

                      {fieldErrors.streetNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.streetNumber}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>رقم المبنى</span>
                      <input
                        name="buildingNumber"
                        className="field"
                        maxLength={80}
                        placeholder="اختياري · يحفظ الأصفار البادئة"
                        value={values.buildingNumber}
                        onChange={event =>
                          setValue("buildingNumber", event.target.value)
                        }
                      />

                      {fieldErrors.buildingNumber && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.buildingNumber}
                        </small>
                      )}
                    </label>
                    <label className="form-label span-all">
                      <span>رابط الموقع</span>
                      <input
                        name="mapUrl"
                        className="field"
                        type="url"
                        inputMode="url"
                        dir="ltr"
                        maxLength={512}
                        placeholder="https://maps.example.com/..."
                        value={values.mapUrl}
                        onChange={event =>
                          setValue("mapUrl", event.target.value)
                        }
                      />
                      <small className="muted">
                        يقبل رابط HTTP أو HTTPS آمنًا فقط، دون اسم مستخدم أو
                        كلمة مرور.
                      </small>

                      {fieldErrors.mapUrl && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.mapUrl}
                        </small>
                      )}
                    </label>
                  </div>
                </section>

                <section
                  className="property-form-section"
                  data-property-section="media"
                  aria-labelledby="property-form-media-title"
                >
                  <header className="property-form-section__heading">
                    <span className="property-form-section__number">5</span>
                    <div>
                      <h3 id="property-form-media-title">
                        صور العقار والمخططات والخرائط والفيديو
                      </h3>
                      <p className="muted small">
                        تحفظ المرفقات الصحيحة محليًا في هذا المتصفح فقط؛ لا تدخل
                        بايتات الملفات في JSON أو الحفظ السحابي.
                      </p>
                    </div>
                  </header>
                  <div
                    className="property-media-form-block"
                    aria-label="صور العقار والمخططات والخرائط والفيديو"
                  >
                    <PropertyMediaEditor
                      ref={mediaEditorRef}
                      value={values.propertyMedia}
                      onChange={next => setValue("propertyMedia", next)}
                      onBusyChange={setMediaBusy}
                      onDirtyChange={setMediaDirty}
                      disabled={isBusy || !canEdit || !latestCanEdit}
                    />
                  </div>
                </section>

                <details
                  className="property-optional-details"
                  data-property-section="extra"
                >
                  <summary>تفاصيل إضافية</summary>
                  <div className="form-grid property-form-extra-grid">
                    <ContentPresetPicker
                      label="مواصفات ومرافق العقار"
                      value={values.contents}
                      disabled={isBusy || !canEdit || !latestCanEdit}
                      onChange={value => setValue("contents", value)}
                    />
                    <label className="form-label">
                      <span>حساب التحصيل</span>
                      <input
                        name="collectionAccount"
                        className="field"
                        maxLength={1024}
                        placeholder="تسمية الحساب فقط، لا رقم بنك"
                        value={values.collectionAccount}
                        onChange={event =>
                          setValue("collectionAccount", event.target.value)
                        }
                      />

                      {fieldErrors.collectionAccount && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.collectionAccount}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>اسم البنك (اختياري)</span>
                      <input
                        name="bankName"
                        className="field"
                        maxLength={1024}
                        value={values.bankName}
                        onChange={event =>
                          setValue("bankName", event.target.value)
                        }
                      />

                      {fieldErrors.bankName && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.bankName}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>صاحب الحساب</span>
                      <input
                        name="accountOwner"
                        className="field"
                        maxLength={1024}
                        value={values.accountOwner}
                        onChange={event =>
                          setValue("accountOwner", event.target.value)
                        }
                      />

                      {fieldErrors.accountOwner && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.accountOwner}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>حالة الأصل</span>
                      <input
                        name="condition"
                        className="field"
                        maxLength={1024}
                        placeholder="مثال: جيد"
                        value={values.condition}
                        onChange={event =>
                          setValue("condition", event.target.value)
                        }
                      />

                      {fieldErrors.condition && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.condition}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>تاريخ آخر صيانة</span>
                      <input
                        name="lastMaintenanceDate"
                        className="field"
                        type="date"
                        max={referenceDate}
                        value={values.lastMaintenanceDate}
                        onChange={event =>
                          setValue("lastMaintenanceDate", event.target.value)
                        }
                      />

                      {fieldErrors.lastMaintenanceDate && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.lastMaintenanceDate}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>تكلفة آخر صيانة (ر.ق)</span>
                      <input
                        name="lastMaintenanceCost"
                        className="field"
                        type="number"
                        min="0"
                        step="0.01"
                        value={values.lastMaintenanceCost}
                        onChange={event =>
                          setValue("lastMaintenanceCost", event.target.value)
                        }
                      />

                      {fieldErrors.lastMaintenanceCost && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.lastMaintenanceCost}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>مرجع الصك</span>
                      <input
                        name="deedRef"
                        className="field"
                        maxLength={1024}
                        value={values.deedRef}
                        onChange={event =>
                          setValue("deedRef", event.target.value)
                        }
                      />

                      {fieldErrors.deedRef && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.deedRef}
                        </small>
                      )}
                    </label>
                    <label className="form-label">
                      <span>مصدر الإدخال</span>
                      <select
                        name="inputMethod"
                        className="field"
                        value={values.inputMethod}
                        onChange={event =>
                          setValue("inputMethod", event.target.value)
                        }
                      >
                        {unitCountLabel && <option value="">غير مسجل</option>}
                        <option value="يدوي">يدوي</option>
                        <option value="Excel">Excel</option>
                      </select>

                      {fieldErrors.inputMethod && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.inputMethod}
                        </small>
                      )}
                    </label>
                    <label className="form-label span-all">
                      <span>ملاحظات</span>
                      <textarea
                        name="notes"
                        className="field"
                        rows={3}
                        maxLength={1024}
                        value={values.notes}
                        onChange={event =>
                          setValue("notes", event.target.value)
                        }
                      />

                      {fieldErrors.notes && (
                        <small className="property-form-error" role="alert">
                          {fieldErrors.notes}
                        </small>
                      )}
                    </label>
                  </div>
                </details>
              </fieldset>
              <div className="modal-footer">
                <button type="submit" className="btn-primary" disabled={isBusy}>
                  <Plus size={16} />
                  {isSubmitting
                    ? "جارٍ الحفظ…"
                    : !unitCountLabel && values.rentalMode === "units"
                      ? "حفظ العقار وإكمال معلومات الوحدات"
                      : submitLabel}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeWhenIdle}
                  disabled={isBusy}
                >
                  إلغاء
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function PropertyRegistryTable({
  rows,
  portfolios,
  canEdit,
  referenceDate,
  onUpdate,
  onUpdateUnit,
  onSetupUnits,
}: {
  rows: PropertyRegistryRow[];
  portfolios: DemoEntity[];
  canEdit: boolean;
  referenceDate: string;
  onUpdate: (property: DemoEntity, values: PropertyFormValues) => void;
  onUpdateUnit?: (
    unit: DemoEntity,
    values: Record<string, string>
  ) => void | Promise<void>;
  onSetupUnits?: (property: DemoEntity) => void;
}) {
  const { state } = usePrototype();
  const { lang } = useI18n();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const defaultPortfolioId = "";

  const physicalUnitsFor = (property: DemoEntity) =>
    state.entities.units.filter(
      unit =>
        unit.propertyId === property.id &&
        unit.portfolioId === property.portfolioId &&
        unit.meta.wholeProperty !== true
    );

  const profileForDisplay = (
    property: DemoEntity,
    assetType?: PropertyAssetType
  ) => {
    const rentalMode = rentalModeFromMeta(property.meta);
    try {
      return {
        policy: getPropertyFieldPolicy(assetType, undefined, rentalMode),
        profile: filterPropertyProfileForType(
          propertyProfileFor(property),
          assetType,
          undefined,
          rentalMode
        ),
      };
    } catch {
      return {
        policy: getPropertyFieldPolicy(assetType, undefined, rentalMode),
        profile: parsePropertyProfile(""),
      };
    }
  };

  const profileLabelFor = (
    property: DemoEntity,
    assetType?: PropertyAssetType
  ) => {
    const { profile } = profileForDisplay(property, assetType);
    const fields = [
      propertyPurposeLabel(profile.purpose),
      profile.mortgageStatus === undefined
        ? undefined
        : mortgageStatusLabel(profile.mortgageStatus),
    ].filter((label): label is string =>
      Boolean(label && label !== "غير مسجل")
    );
    return fields.join(" · ") || "غير مسجل";
  };

  const toggleExpanded = (propertyId: string) => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(lang);
    const matched = rows.filter(row => {
      const { policy, profile } = profileForDisplay(
        row.property,
        row.assetType
      );
      const haystack = [
        row.property.title,
        portfolioName(portfolios, row.property.portfolioId),
        assetTypeLabel(row.assetType ?? ""),
        rentalModeLabel(rentalModeFromMeta(row.property.meta)),
        profileLabelFor(row.property, row.assetType),
        policy.supportsUnitComposition
          ? propertyUnitCompositionLabel(profile.unitComposition)
          : "",
        entityMeta(row.property, "propertyNumber", ""),
        entityMeta(row.property, "electricityNumber", ""),
        row.account,
        row.source,
      ]
        // search works in both languages: every label is matched as written
        // and in its English form
        .flatMap(label => (label ? [label, toEnglish(label)] : []))
        .join(" ")
        .toLocaleLowerCase(lang);
      return !query || haystack.includes(query);
    });
    const compare = (left: PropertyRegistryRow, right: PropertyRegistryRow) => {
      const values: Record<SortKey, [string | number, string | number]> = {
        title: [left.property.title, right.property.title],
        assetType: [
          lang === "en"
            ? toEnglish(assetTypeLabel(left.assetType ?? ""))
            : assetTypeLabel(left.assetType ?? ""),
          lang === "en"
            ? toEnglish(assetTypeLabel(right.assetType ?? ""))
            : assetTypeLabel(right.assetType ?? ""),
        ],
        age: [left.age.years ?? -1, right.age.years ?? -1],
        units: [
          physicalUnitsFor(left.property).length,
          physicalUnitsFor(right.property).length,
        ],
        account: [left.account, right.account],
        source: [left.source, right.source],
      };
      const [a, b] = values[sortKey];
      const result =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), lang);
      return sortDirection === "asc" ? result : -result;
    };
    return [...matched].sort(compare);
  }, [lang, portfolios, rows, search, sortDirection, sortKey, state.entities.units]);

  const sort = (key: SortKey) => {
    if (key === sortKey)
      setSortDirection(direction => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const header = (key: SortKey, label: string, className = "") => {
    const active = sortKey === key;
    const direction = active
      ? sortDirection === "asc"
        ? "ascending"
        : "descending"
      : "none";
    return (
      <th className={className} aria-sort={direction}>
        <button
          type="button"
          className="property-sort-button"
          onClick={() => sort(key)}
          aria-label={`${label}: ${active ? (sortDirection === "asc" ? "تصاعدي" : "تنازلي") : "غير مرتب"}. اضغط للفرز`}
        >
          {label}{" "}
          <span aria-hidden="true">
            {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <>
      <div className="property-registry-toolbar">
        <label className="property-search">
          <span className="sr-only">ابحث في سجل العقارات</span>
          <Search size={16} aria-hidden="true" />
          <input
            className="field"
            type="search"
            value={search}
            placeholder="بحث بالاسم أو المحفظة أو النوع أو الحساب أو المصدر"
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <p className="muted small" aria-live="polite">
          {visibleRows.length} من {rows.length} عقار
        </p>
      </div>
      {!visibleRows.length ? (
        <EmptyState
          title="لا توجد نتائج في سجل العقارات"
          description="غيّر عبارة البحث أو أزل مرشح المحفظة."
        />
      ) : (
        <div className="table-wrap property-table-wrap">
          <table className="data-table property-table">
            <thead>
              <tr>
                {header("title", "العقار")}
                <th className="property-table__desktop">المحفظة</th>
                {header("assetType", "النوع")}
                {header("age", "سنة البناء / العمر", "property-table__desktop")}
                <th className="property-table__desktop property-table__wide">طريقة التأجير</th>
                <th>الهدف / الرهن</th>
                <th>السعر · إيجار / بيع</th>
                {header("units", "الوحدات")}
                {header("account", "حساب التحصيل", "property-table__desktop property-table__wide")}
                {header("source", "المصدر", "property-table__desktop property-table__wide")}
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const physicalUnits = physicalUnitsFor(row.property);
                const physicalUnitCount = physicalUnits.length;
                const occupiedCount = physicalUnits.filter(
                  unit =>
                    unitOccupancyAt(state.entities, unit.id, referenceDate) ===
                    "occupied"
                ).length;
                const rentalMode = rentalModeFromMeta(row.property.meta);
                const isExplicitSplit = rentalMode === "units";
                const isExpanded = expandedIds.has(row.property.id);
                const controlsId = `property-inline-units-${row.property.id}`;
                const { profile } = profileForDisplay(
                  row.property,
                  row.assetType
                );
                const initialValues = valuesFromProperty(
                  row.property,
                  rentalMode === "whole" ? row.unitCount : physicalUnitCount,
                  referenceDate
                );
                const usage = USAGE_OPTIONS.find(
                  option => option.value === row.property.meta.usageType
                )?.label;
                return [
                  <tr key={row.property.id}>
                    <td data-label="العقار">
                      <div className="property-cell">
                        <PropertyCover
                          property={row.property}
                          className="property-cover--registry"
                        />
                        <div className="property-cell__text">
                      <strong>{row.property.title}</strong>
                      {isExplicitSplit && (
                        <button
                          type="button"
                          className="property-registry-expand"
                          aria-expanded={isExpanded}
                          aria-controls={controlsId}
                          aria-label={`${isExpanded ? "إخفاء" : "عرض"} وحدات ${row.property.title} (${physicalUnitCount})`}
                          onClick={() => toggleExpanded(row.property.id)}
                          onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleExpanded(row.property.id);
                            }
                          }}
                        >
                          <span aria-hidden="true">
                            {isExpanded ? "▾" : "▸"}
                          </span>
                          <span className="sr-only">
                            {isExpanded ? "إخفاء الوحدات" : "عرض الوحدات"}
                          </span>
                        </button>
                      )}
                      <TenancyReadout property={row.property} />
                      <small className="muted">
                        رقم العقار:{" "}
                        {entityMeta(row.property, "propertyNumber", "غير مسجل")}
                        {" · "}
                        الكهرباء:{" "}
                        {entityMeta(
                          row.property,
                          "electricityNumber",
                          "غير مسجل"
                        )}
                      </small>
                      <small className="property-table__mobile muted">
                        {buildingYearFromMeta(row.property.meta) ??
                          "سنة البناء غير معروفة"}{" "}
                        · {ageLabel(row.age)}
                      </small>
                        </div>
                      </div>
                    </td>
                    <td
                      className="property-table__desktop"
                      data-label="المحفظة"
                    >
                      {portfolioName(portfolios, row.property.portfolioId)}
                    </td>
                    <td data-label="النوع">
                      <strong>
                        {assetTypeLabel(
                          row.assetType ?? entityMeta(row.property, "type", "")
                        )}
                      </strong>
                      <small className="muted">{usage ?? "غير مسجل"}</small>
                    </td>
                    <td
                      className="property-table__desktop"
                      data-label="سنة البناء / العمر"
                    >
                      <span>
                        {buildingYearFromMeta(row.property.meta) ??
                          "غير معروفة"}
                      </span>
                      <small className="muted">
                        {ageLabel(row.age)}
                        {row.age.kind === "stated" ? " (مصرّح)" : ""}
                      </small>
                    </td>
                    <td
                      className="property-table__desktop property-table__wide"
                      data-label="طريقة التأجير"
                    >
                      {rentalModeLabel(rentalMode)}
                    </td>
                    <td data-label="الهدف / الرهن">
                      {profileLabelFor(row.property, row.assetType)}
                    </td>
                    <td data-label="السعر · إيجار / بيع">
                      {propertyMonthlyRentLabel(row.property)}
                    </td>
                    <td data-label="الوحدات">
                      {rentalMode === "whole"
                        ? "هدف تأجير واحد"
                        : `${physicalUnitCount} وحدة`}{" "}
                      <small className="muted">
                        • {occupiedCount} مؤجرة بعقود مسجلة
                      </small>
                    </td>
                    <td
                      className="property-table__desktop property-table__wide"
                      data-label="حساب التحصيل"
                    >
                      {row.account || "غير مسجل"}
                    </td>
                    <td className="property-table__desktop property-table__wide" data-label="المصدر">
                      {row.source}
                    </td>
                    <td data-label="إجراءات" className="property-actions">
                      <Link
                        className="link-button"
                        href={`/properties/${row.property.id}`}
                      >
                        عرض تفاصيل العقار
                      </Link>
                      {rentalMode === "units" &&
                        physicalUnitCount > 0 &&
                        onSetupUnits && (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={!canEdit}
                            onClick={() => onSetupUnits(row.property)}
                          >
                            إكمال معلومات الوحدات
                          </button>
                        )}
                      <PropertyFormDialog
                        title="تعديل العقار"
                        trigger={
                          <button
                            className="btn-ghost"
                            type="button"
                            disabled={!canEdit}
                          >
                            تعديل العقار
                          </button>
                        }
                        portfolios={portfolios}
                        defaultPortfolioId={defaultPortfolioId}
                        canEdit={canEdit}
                        initialValues={initialValues}
                        unitCountLabel={
                          rentalMode === "whole"
                            ? "هدف تأجير واحد: العقار بالكامل"
                            : `${physicalUnitCount} وحدة فعلية`
                        }
                        rentalModeLocked={
                          rentalMode === "whole"
                            ? row.unitCount > 0
                            : physicalUnitCount > 0
                        }
                        lockPortfolio
                        referenceDate={referenceDate}
                        submitLabel="حفظ التعديل"
                        onSubmit={values => onUpdate(row.property, values)}
                        property={row.property}
                      />
                      <AssetRemovalButton
                        kind="properties"
                        id={row.property.id}
                        title={row.property.title}
                      />
                    </td>
                  </tr>,
                  isExplicitSplit && isExpanded ? (
                    <tr key={`${row.property.id}-units`}>
                      <td colSpan={11}>
                        <PropertyInlineUnits
                          property={row.property}
                          onUpdateUnit={onUpdateUnit}
                          parentColumnCount={11}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PortfoliosPage() {
  const { state, filtered, list, add, setSetting, canEdit } = usePrototype();
  const portfolios = filtered("portfolios");
  const properties = filtered("properties");
  const units = filtered("units");
  const receivables = filtered("receivables");
  const [message, setMessage] = useState(
    "اختر محفظة لرؤية نطاقها في جميع شاشات التشغيل."
  );

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F01 / نطاق التشغيل"
        title="المحافظ"
        description="كل بطاقة تقود إلى نطاق صوري مستقل. اختيارها يقيّد الجداول في هذه التجربة محليًا."
      />
      <DemoNotice mode="interactive">
        بيانات المحافظ تجريبية ومحفوظة محليًا في المتصفح. لا توجد صلاحيات خادم
        أو أموال حقيقية.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="محافظ ضمن النطاق"
          value={String(portfolios.length)}
          detail="حسب مرشح المحفظة الحالي"
          icon={<FolderKanban size={18} />}
        />
        <Metric
          label="عقارات ضمن النطاق"
          value={String(properties.length)}
          detail="سجل عقارات تجريبي"
          icon={<Building2 size={18} />}
        />
        <Metric
          label="وحدات"
          value={String(units.length)}
          detail="مرتبطة بعقاراتها"
          icon={<Home size={18} />}
        />
        <Metric
          label="استحقاقات مسجلة"
          value={money(sumMinor(receivables))}
          detail="لا تعني نقدًا محصلًا"
          icon={<ReceiptText size={18} />}
        />
      </div>
      <Panel
        title="بطاقات المحافظ"
        description="انقر «فتح النطاق» لتعيين المرشح ثم متابعة العقارات التابعة لها. لا يحدث أي نقل أو دمج بين المحافظ."
        action={
          <FormDialog
            title="إضافة محفظة تجريبية"
            description="ينشئ السجل محليًا فقط، ضمن نموذج البروتوتايب."
            trigger={
              <button className="btn-primary" disabled={!canEdit}>
                <Plus size={16} /> إضافة محفظة
              </button>
            }
            fields={[
              {
                key: "title",
                label: "اسم المحفظة",
                required: true,
                placeholder: "مثال: محفظة الدوحة",
              },
              {
                key: "manager",
                label: "مسؤول المتابعة",
                placeholder: "اسم صوري",
              },
              {
                key: "notes",
                label: "ملاحظة نطاق",
                type: "textarea",
                placeholder: "لا تمثل علاقة ملكية فعلية",
              },
            ]}
            submitLabel="حفظ محلي"
            onSubmit={values => {
              const portfolio = add(
                "portfolios",
                entityInput(value(values, "title"), {
                  portfolioId: "",
                  subtitle: value(values, "manager", "محفظة تجريبية"),
                  status: "نشطة",
                  date: DEMO_DATE,
                  meta: {
                    manager: value(values, "manager"),
                    notes: value(values, "notes"),
                  },
                })
              );
              setMessage(
                `أضيفت «${portfolio.title}» محليًا ويمكن الآن اختيارها كنطاق.`
              );
            }}
          />
        }
      >
        <EditGuard canEdit={canEdit} />
        <p className="muted">{message}</p>
        {portfolios.length === 0 ? (
          <EmptyState
            title="لا توجد محافظ في النطاق الحالي"
            description="أزل مرشح المحفظة أو أضف محفظة تجريبية."
          />
        ) : (
          <div className="card-grid">
            {portfolios.map(portfolio => {
              const propertyCount = properties.filter(
                property => property.portfolioId === portfolio.id
              ).length;
              const unitCount = units.filter(
                unit => unit.portfolioId === portfolio.id
              ).length;
              const due = sumMinor(
                receivables.filter(row => row.portfolioId === portfolio.id)
              );
              return (
                <article key={portfolio.id} className="entity-card">
                  <div className="entity-card__top">
                    <span className="mini-label">
                      محفظة #{idSuffix(portfolio.id)}
                    </span>
                    <StatusBadge status={portfolio.status} />
                  </div>
                  <h3>{portfolio.title}</h3>
                  <p className="muted">
                    {portfolio.subtitle || "محفظة تشغيل تجريبية"}
                  </p>
                  <div className="entity-card__metrics">
                    <span>{propertyCount} عقارات</span>
                    <span>{unitCount} وحدات</span>
                    <span>{money(due)} استحقاق</span>
                  </div>
                  <a
                    href="/properties"
                    className="link-button"
                    onClick={() => {
                      setSetting("portfolioId", portfolio.id);
                      setMessage(
                        `تم اختيار «${portfolio.title}» كنطاق للمحفظة داخل التجربة.`
                      );
                    }}
                  >
                    فتح النطاق والعقارات
                  </a>
                  <AssetRemovalButton
                    kind="portfolios"
                    id={portfolio.id}
                    title={portfolio.title}
                  />
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function PropertiesPage() {
  const {
    state,
    filtered,
    list,
    canEdit,
    commitAssetTransition,
    importRentalProperties,
  } = usePrototype();
  const portfolios = list("portfolios");
  const properties = scopedRows(
    filtered("properties"),
    state.settings,
    "properties"
  );
  const units = scopedRows(filtered("units"), state.settings, "units");
  const defaultPortfolioId =
    state.settings.portfolioId === "all" ? "" : state.settings.portfolioId;
  const asOf = scenarioDate(state);
  const [unitSetupPropertyId, setUnitSetupPropertyId] = useState<string | null>(
    null
  );

  const createProperty = async (rawValues: Record<string, string>) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    return commitAssetTransition(current => {
      const created = transitionCreateRentalProperty(current, rawValues);
      return { state: created.state, result: created.property };
    });
  };

  const importProperties = (
    rows: Array<Record<string, string>>,
    requestId: string
  ) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    return importRentalProperties(rows, requestId);
  };

  const updateProperty = (
    property: DemoEntity,
    rawValues: PropertyFormValues
  ) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    return commitAssetTransition(current =>
      updateRentalProperty(current, property.id, rawValues)
    );
  };

  const updateUnit = async (
    unit: DemoEntity,
    values: Record<string, string>
  ) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    await commitAssetTransition(current =>
      updateDescribedUnit(current, unit.id, values)
    );
  };

  const registryRows = useMemo<PropertyRegistryRow[]>(
    () =>
      properties.map(property => {
        const linkedUnits = units.filter(
          unit => unit.propertyId === property.id
        );
        const assetType = assetTypeFromMeta(property.meta);
        return {
          property,
          assetType,
          age: derivePropertyAge(property.meta, assetType, asOf),
          unitCount: linkedUnits.length,
          occupiedCount: linkedUnits.filter(
            unit =>
              unitOccupancyAt(state.entities, unit.id, asOf) === "occupied"
          ).length,
          account: collectionAccountFromMeta(property.meta),
          source: inputMethodLabel(property.meta),
        };
      }),
    [asOf, properties, state.entities, units]
  );
  const totalUnits = registryRows.reduce(
    (total, row) => total + row.unitCount,
    0
  );

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="سجل الأصل"
        title="العقارات والوحدات"
        description="جدول واحد للبحث والتعديل. أضف البيانات الأساسية ثم افتح التفاصيل عند الحاجة."
      >
        <a className="btn-secondary" href="/portfolios">
          إدارة المحافظ / إضافة محفظة
        </a>
        <PropertyFormDialog
          title="إضافة عقار"
          description="المرحلة الأولى: بيانات العقار. عند اختيار تقسيم إلى وحدات، احفظ العقار ثم أكمل أرقام وصور كل وحدة في نافذة المرحلة الثانية."
          trigger={
            <button className="btn-primary" type="button" disabled={!canEdit}>
              <Plus size={16} /> إضافة عقار
            </button>
          }
          portfolios={portfolios}
          defaultPortfolioId={defaultPortfolioId}
          canEdit={canEdit}
          referenceDate={asOf}
          submitLabel="حفظ العقار"
          onSubmit={createProperty}
          onSaved={(saved, values) => {
            if (
              values.rentalMode === "units" &&
              saved &&
              typeof saved === "object" &&
              "id" in saved &&
              typeof saved.id === "string"
            )
              setUnitSetupPropertyId(saved.id);
          }}
        />
      </PageHeader>
      {unitSetupPropertyId && (
        <UnitSetupWizard
          propertyId={unitSetupPropertyId}
          onClose={() => setUnitSetupPropertyId(null)}
        />
      )}
      <div className="property-counts-inline">
        <span>
          <Building2 size={16} /> عدد العقارات{" "}
          <strong>{registryRows.length}</strong>
        </span>
        <span>
          <Home size={16} /> عدد الوحدات <strong>{totalUnits}</strong>
        </span>
        <span className="muted small">
          إدخال يدوي أو ملف إكسل؛ حساب التحصيل تسمية فقط ولا يتصل بالبنك.
        </span>
      </div>
      <Panel
        title="سجل العقارات"
        description="رتّب الأعمدة أو ابحث؛ التعديل لا يُحفظ إلا عند الضغط على حفظ."
      >
        <PropertyImport onImportRentalProperties={importProperties} />
        <PropertyRegistryTable
          rows={registryRows}
          portfolios={portfolios}
          canEdit={canEdit}
          referenceDate={asOf}
          onUpdate={updateProperty}
          onUpdateUnit={updateUnit}
          onSetupUnits={property => setUnitSetupPropertyId(property.id)}
        />
        <EditGuard canEdit={canEdit} />
      </Panel>
    </div>
  );
}

export function PropertyDetailPage({ id }: { id: string }) {
  const {
    state,
    find,
    filtered,
    list,
    outstanding,
    canEdit,
    commitAssetTransition,
  } = usePrototype();
  const [unitSetupOpen, setUnitSetupOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<
    CompositionCategory | "all"
  >("all");
  useEffect(() => setCategoryFilter("all"), [id]);
  const property = find("properties", id);
  const inScope = property
    ? filtered("properties").some(row => row.id === property.id)
    : false;
  const portfolios = list("portfolios");
  const units = useMemo(
    () =>
      property
        ? scopedRows(
            filtered("units").filter(unit => unit.propertyId === property.id),
            state.settings,
            "units"
          )
        : [],
    [filtered, property, state.settings]
  );
  const receivables = useMemo(
    () =>
      property
        ? scopedRows(
            filtered("receivables").filter(
              row => row.propertyId === property.id
            ),
            state.settings
          )
        : [],
    [filtered, property, state.settings]
  );

  if (!property) return <NotFound />;
  if (!inScope) {
    return (
      <div className="section-stack">
        <PageHeader
          eyebrow="نطاق المحفظة"
          title="العقار خارج النطاق الحالي"
          description="العقار موجود في مساحة التجربة، لكنه لا يظهر لأن مرشح المحفظة الحالي يقيّد العرض. بدّل المرشح أو ارجع إلى سجل العقارات."
        >
          <a className="btn-secondary" href="/properties">
            العودة إلى العقارات
          </a>
        </PageHeader>
        <DemoNotice mode="interactive">
          لا يعني هذا أن المعرّف غير موجود ولا يمنح فتح سجل خارج نطاق المحفظة.
        </DemoNotice>
      </div>
    );
  }

  const outstandingMinor = receivables.reduce(
    (total, row) => total + outstanding(row.id),
    0
  );
  const assetType = assetTypeFromMeta(property.meta);
  const age = derivePropertyAge(property.meta, assetType, scenarioDate(state));
  const initialValues = valuesFromProperty(
    property,
    units.length,
    scenarioDate(state)
  );
  const account = collectionAccountFromMeta(property.meta);
  const maintenanceCost = property.meta.lastMaintenanceCostMinor;
  const rentalMode = rentalModeFromMeta(property.meta);
  const propertyProfile = propertyProfileFor(property);
  const displayPolicy = getPropertyFieldPolicy(
    assetType,
    property.meta.usageType as PropertyUsageType | undefined,
    rentalMode
  );
  const isWholePropertyLease = rentalMode === "whole";
  const composition = propertyUnitComposition(property, units);
  const visibleUnits = isWholePropertyLease
    ? units
    : physicalCompositionUnits(property, units).filter(
        unit =>
          categoryFilter === "all" ||
          compositionCategory(unit) === categoryFilter
      );
  const splitDefaultMonthlyRentMinor =
    rentalMode === "units"
      ? positiveMinor(property.meta.unitMonthlyRentMinor)
      : undefined;
  const monthlyRentFact = propertyMonthlyRentFact(property);
  const asOf = scenarioDate(state);
  const propertyMedia = entityMeta(property, "propertyMedia", "");
  const hasSavedPhoto = hasSavedPhotoReference(propertyMedia);
  const propertyLocation = propertyLocationFormValues(
    property.meta.propertyLocation
  );

  const addUnit = (values: Record<string, string>) => {
    if (isWholePropertyLease && units.length >= 1) {
      throw new Error(
        "العقار المؤجر كاملاً لديه هدف تأجير واحد؛ لا يمكن إضافة وحدة ثانية."
      );
    }
    return commitAssetTransition(current =>
      createDescribedUnit(current, property.id, values)
    );
  };

  const updateUnit = (unit: DemoEntity, values: Record<string, string>) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    return commitAssetTransition(current =>
      updateDescribedUnit(current, unit.id, values)
    );
  };

  const updateProperty = (rawValues: PropertyFormValues) => {
    if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
    return commitAssetTransition(current =>
      updateRentalProperty(current, property.id, rawValues)
    );
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow={`عقار #${idSuffix(property.id)}`}
        title={property.title}
        description={entityMeta(
          property,
          "description",
          property.subtitle || "ملف أصل تجريبي"
        )}
      >
        <a className="btn-secondary" href="/properties">
          العودة إلى العقارات
        </a>
        <a
          className="btn-primary"
          href={`/contract-templates?property=${encodeURIComponent(property.id)}`}
        >
          إنشاء عقد من نموذج · {rentalModeLabel(rentalMode)}
        </a>
      </PageHeader>
      <DemoNotice mode="interactive">
        هذه بطاقة أصل تجريبية. لا تتصل بيانات حساب التحصيل ببنك أو كشف حساب
        حقيقي.
      </DemoNotice>
      <div className="split-layout">
        <Panel
          title="ملف الأصل"
          description={`${portfolioName(portfolios, property.portfolioId)} · ${entityMeta(property, "location", "موقع وصفي غير مسجل")}`}
        >
          {propertyMedia && (
            <PropertyMediaDisplay
              value={propertyMedia}
              title={property.title}
            />
          )}
          <AssetPhotoGallery
            kind="properties"
            id={property.id}
            title={property.title}
          />
          <PropertyCover property={property} />
          <dl className="property-facts">
            <div>
              <dt>النوع</dt>
              <dd>
                {assetTypeLabel(assetType ?? entityMeta(property, "type", ""))}
              </dd>
            </div>
            <div>
              <dt>الاستخدام</dt>
              <dd>{usageTypeLabel(String(property.meta.usageType ?? ""))}</dd>
            </div>
            <div>
              <dt>سنة البناء</dt>
              <dd>
                {displayPolicy.supportsBuildingYear
                  ? (buildingYearFromMeta(property.meta, asOf) ?? "غير مسجل")
                  : "لا ينطبق"}
              </dd>
            </div>
            <div>
              <dt>العمر</dt>
              <dd>
                {ageLabel(age)}
                {age.kind === "stated" && <small>{age.note}</small>}
              </dd>
            </div>
            <div>
              <dt>مساحة الأرض</dt>
              <dd>{areaLabel(property.meta.landArea)}</dd>
            </div>
            <div>
              <dt>مساحة العقار / البناء</dt>
              <dd>
                {displayPolicy.supportsBuildingArea
                  ? areaLabel(property.meta.buildingArea)
                  : "لا ينطبق"}
              </dd>
            </div>
            <div>
              <dt>المصدر</dt>
              <dd>{inputMethodLabel(property.meta)}</dd>
            </div>
            <div>
              <dt>طريقة التأجير</dt>
              <dd>{rentalModeLabel(rentalMode)}</dd>
            </div>
            <div>
              <dt>هدف العقار</dt>
              <dd>
                {propertyProfileDisplayLabel(
                  propertyPurposeLabel(propertyProfile.purpose)
                )}
              </dd>
            </div>
            <div>
              <dt>حالة الرهن</dt>
              <dd>
                {propertyProfileDisplayLabel(
                  mortgageStatusLabel(propertyProfile.mortgageStatus)
                )}
              </dd>
            </div>
            {propertyProfile.mortgageStatus === "mortgaged" && (
              <div>
                <dt>بنك الرهن</dt>
                <dd>{propertyProfile.mortgageBank || "غير مسجل"}</dd>
              </div>
            )}
            <div>
              <dt>{monthlyRentFact.label}</dt>
              <dd>{monthlyRentFact.value}</dd>
            </div>
            <div>
              <dt>رقم السند</dt>
              <dd>{entityMeta(property, "deedRef", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>رقم العقار</dt>
              <dd>{entityMeta(property, "propertyNumber", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>رقم المخطط العقاري</dt>
              <dd>
                {entityMeta(
                  property,
                  "planNumber",
                  entityMeta(property, "planRef", "غير مسجل")
                )}
              </dd>
            </div>
            <div>
              <dt>رقم الكهرباء / العداد</dt>
              <dd>{entityMeta(property, "electricityNumber", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>الموقع الوصفي</dt>
              <dd>{entityMeta(property, "location", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>رقم المنطقة</dt>
              <dd>{propertyLocation.zoneNumber || "غير مسجل"}</dd>
            </div>
            <div>
              <dt>رقم الشارع</dt>
              <dd>{propertyLocation.streetNumber || "غير مسجل"}</dd>
            </div>
            <div>
              <dt>رقم المبنى</dt>
              <dd>{propertyLocation.buildingNumber || "غير مسجل"}</dd>
            </div>
            <div>
              <dt>رابط الموقع</dt>
              <dd>
                {propertyLocation.mapUrl ? (
                  <a
                    href={propertyLocation.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                  >
                    فتح رابط الموقع
                  </a>
                ) : (
                  "غير مسجل"
                )}
              </dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                <StatusBadge status={property.status} />
              </dd>
            </div>
            <div>
              <dt>وصف العقار</dt>
              <dd>
                {propertyUnitCompositionLabel(propertyProfile.unitComposition)}
              </dd>
            </div>
            <div>
              <dt>الخدمات المتاحة للعقار</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>
                {entityMeta(property, "availableServices", "غير مسجلة")}
              </dd>
            </div>
            <div>
              <dt>الوصف النصي الإضافي</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>
                {entityMeta(property, "description", "لم يضف وصف بعد") ||
                  "لم يضف وصف بعد"}
              </dd>
            </div>
            <div>
              <dt>مواصفات ومرافق العقار</dt>
              <dd>{propertyProfile.contents || "غير محددة"}</dd>
            </div>
            {displayPolicy.supportsAccommodation && (
              <div>
                <dt>تكوين العقار الكامل</dt>
                <dd>
                  {accommodationSummary(propertyProfile.accommodation) ||
                    "غير مسجل"}
                </dd>
              </div>
            )}
            <div>
              <dt>حالة التأجير وتواريخ العقد</dt>
              <dd>
                <TenancyReadout property={property} />
              </dd>
            </div>
          </dl>
          <PropertyFormDialog
            title="تعديل بيانات العقار"
            description="يحفظ التعديل محليًا فقط ويحافظ على الوحدات والاستحقاقات المرتبطة."
            trigger={
              <button
                className="btn-secondary"
                type="button"
                disabled={!canEdit}
              >
                تعديل العقار
              </button>
            }
            portfolios={portfolios}
            defaultPortfolioId={property.portfolioId}
            canEdit={canEdit}
            initialValues={initialValues}
            unitCountLabel={
              isWholePropertyLease
                ? "هدف تأجير واحد: العقار بالكامل"
                : `${units.length} وحدة فعلية`
            }
            rentalModeLocked={units.length > 0}
            lockPortfolio
            referenceDate={asOf}
            submitLabel="حفظ التعديل"
            onSubmit={updateProperty}
            property={property}
          />
          <AssetRemovalButton
            kind="properties"
            id={property.id}
            title={property.title}
            redirectTo="/properties"
          />
        </Panel>
        <Panel
          title="حساب التحصيل"
          description="الرصيد مشتق من الاستحقاقات وسجلات التحصيل/الخسارة، وليس كشف بنك حقيقي."
        >
          <div className="stats-grid">
            <Metric
              label="وحدات"
              value={String(units.length)}
              detail="مرتبطة بهذا الأصل"
              icon={<Home size={18} />}
            />
            <Metric
              label="استحقاقات"
              value={String(receivables.length)}
              detail="ضمن الفترة المختارة"
              icon={<ReceiptText size={18} />}
            />
            <Metric
              label="رصيد قائم"
              value={money(outstandingMinor)}
              detail="بعد التحصيل والخسارة المسجلة"
              icon={<Landmark size={18} />}
            />
          </div>
          <dl className="property-facts property-facts--compact">
            <div>
              <dt>تسمية حساب التحصيل</dt>
              <dd>{account || "غير مسجل"}</dd>
            </div>
            <div>
              <dt>اسم البنك</dt>
              <dd>{entityMeta(property, "bankName", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>صاحب الحساب</dt>
              <dd>{entityMeta(property, "accountOwner", "غير مسجل")}</dd>
            </div>
            <div>
              <dt>آخر صيانة</dt>
              <dd>
                {entityMeta(property, "lastMaintenanceDate", "غير مسجلة")}
              </dd>
            </div>
            <div>
              <dt>تكلفة آخر صيانة</dt>
              <dd>
                {typeof maintenanceCost === "number"
                  ? money(maintenanceCost)
                  : "غير مسجلة"}
              </dd>
            </div>
          </dl>
          <p className="muted">
            تسمية الحساب للمتابعة الداخلية فقط؛ لا تحتفظ هذه التجربة برقم حساب
            أو تتصل ببنك.
          </p>
        </Panel>
      </div>
      {!isWholePropertyLease && (
        <Panel
          title="محتويات العقار · تقسيم الوحدات"
          description="الشقق والفلل وحدات مستقلة لكل منها رمز ومحتويات ومساحة وسعر؛ التصنيف لا ينشئ وحدات أخرى."
        >
          <div
            className="property-counts-inline"
            aria-label="تجميع محتويات العقار حسب الوحدات"
          >
            <button
              type="button"
              className={
                categoryFilter === "all" ? "btn-secondary" : "btn-ghost"
              }
              aria-pressed={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            >
              كل الوحدات: {composition.total}
            </button>
            {composition.groups.map(group => (
              <button
                key={group.value}
                type="button"
                className={
                  categoryFilter === group.value ? "btn-secondary" : "btn-ghost"
                }
                aria-pressed={categoryFilter === group.value}
                onClick={() => setCategoryFilter(group.value)}
              >
                {group.label}: {group.count}
              </button>
            ))}
          </div>
          <p className="muted small">
            اختر النوع لعرض وحداته في الجدول، أو استخدم «إكمال بيانات الوحدات»
            لتحديد نوع ورمز كل وحدة. غير المصنفة تبقى كما هي حتى تختار نوعها؛ لا
            نخمن التصنيف من اسم العقار أو عدد الغرف.
          </p>
        </Panel>
      )}
      <Panel
        title={isWholePropertyLease ? "هدف التأجير" : "الوحدات"}
        description={
          isWholePropertyLease
            ? "«العقار بالكامل» هدف تأجير داخلي واحد، وليس شقة أو وحدة مادية إضافية."
            : "كل وحدة تابعة لنفس العقار والمحفظة؛ لا يمكن اختيار محفظة أخرى من هذا الملف."
        }
        action={
          <UnitDetailsDialog
            mode="create"
            property={property}
            trigger={
              <button
                className="btn-primary"
                type="button"
                disabled={
                  !canEdit || (isWholePropertyLease && units.length >= 1)
                }
              >
                <Plus size={16} /> إضافة وحدة
              </button>
            }
            canEdit={canEdit && !(isWholePropertyLease && units.length >= 1)}
            inheritedMonthlyRentMinor={splitDefaultMonthlyRentMinor}
            onSubmit={addUnit}
          />
        }
      >
        {!isWholePropertyLease && units.length > 0 && (
          <div className="property-counts-inline">
            <button
              className="btn-secondary"
              type="button"
              disabled={!canEdit}
              onClick={() => setUnitSetupOpen(true)}
            >
              إكمال بيانات الوحدات
            </button>
            <span className="muted small">
              حدد نوع الوحدة ورمزها، ثم راجع أرقام العقار والمخطط والكهرباء
              وصورها. الحقول الناقصة تبقى متاحة للإكمال لاحقًا.
            </span>
          </div>
        )}
        {unitSetupOpen && (
          <UnitSetupWizard
            propertyId={property.id}
            onClose={() => setUnitSetupOpen(false)}
          />
        )}
        <GroupUnitPhotoGallery propertyId={property.id} />
        {!isWholePropertyLease && (
          <label className="form-label" style={{ maxWidth: 340 }}>
            <span>تصنيف الوحدات المعروضة</span>
            <select
              className="field"
              value={categoryFilter}
              onChange={event =>
                setCategoryFilter(
                  event.target.value as CompositionCategory | "all"
                )
              }
            >
              <option value="all">جميع الوحدات</option>
              {COMPOSITION_CATEGORIES.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <EntityTable
          rows={visibleUnits}
          empty={
            categoryFilter === "all"
              ? "لا توجد وحدات مرتبطة بهذا العقار بعد."
              : "لا توجد وحدات من التصنيف المختار؛ بقية وحدات العقار ما زالت محفوظة."
          }
          columns={[
            {
              key: "unit",
              label: "الوحدة",
              render: row => (
                <div className="property-unit-picture">
                  {row.meta.wholeProperty !== true && (
                    <PropertyCover
                      property={row}
                      kind="units"
                      className="property-cover--unit"
                    />
                  )}
                  <span>{row.title}</span>
                </div>
              ),
            },
            {
              key: "category",
              label: "نوع الوحدة",
              render: row =>
                isWholePropertyLease
                  ? "العقار بالكامل · هدف داخلي"
                  : compositionCategoryLabel(row),
            },
            {
              key: "code",
              label: "الرمز",
              render: row => (
                <div className="property-unit-reference">
                  <strong>
                    {unitDisplayReference(state.entities, row.id) || "غير مسجل"}
                  </strong>
                  <UnitSerialEditor unit={row} />
                </div>
              ),
            },
            {
              key: "electricityNumber",
              label: "الكهرباء",
              render: row =>
                electricityNumberForRentalTarget(
                  state.entities,
                  property.id,
                  row.id
                ) || "غير مسجل",
            },
            {
              key: "profile",
              label: "وصف الوحدة",
              render: row => (
                <div>
                  {entityMeta(row, "description", "") && (
                    <p>{entityMeta(row, "description", "")}</p>
                  )}
                  <span className="muted small">{unitProfileSummary(row)}</span>
                </div>
              ),
            },
            {
              key: "area",
              label: "مساحة الوحدة (م²)",
              render: row => {
                if (isWholePropertyLease)
                  return `${areaLabel(property.meta.buildingArea)} · للعقار بالكامل`;
                const area = unitProfileFormValues(row).unitArea;
                return area ? `${area} م²` : "غير مسجلة";
              },
            },
            {
              key: "tenancy",
              label: "التأجير وتواريخ العقد",
              render: row => <TenancyReadout property={property} unit={row} />,
            },
            {
              key: "monthlyRent",
              label: "الهدف والسعر",
              render: row => {
                const goal = resolveUnitPurpose(row, property);
                if (isWholePropertyLease && propertyProfile.purpose === "mixed")
                  return (
                    <strong>
                      {propertyMonthlyRentLabel(property)} · للعقار بالكامل
                    </strong>
                  );
                if (goal === "sale") {
                  const salePrice = positiveMinor(
                    isWholePropertyLease
                      ? propertyProfile.salePriceMinor
                      : parseUnitProfile(row.meta.unitProfile).salePriceMinor
                  );
                  return (
                    <strong>
                      {salePrice === undefined
                        ? "للبيع · السعر غير مسجل"
                        : `للبيع: ${money(salePrice)} · ${isWholePropertyLease ? "للعقار بالكامل" : "خاص بالوحدة"}`}
                    </strong>
                  );
                }
                if (propertyProfile.purpose === "mixed" && !goal)
                  return (
                    <strong>لم يحدد هدف هذه الوحدة · اختر بيع أو إيجار</strong>
                  );
                const explicit = positiveMinor(row.meta.monthlyRentMinor);
                const wholePropertyRent = positiveMinor(
                  property.meta.monthlyRentMinor
                );
                if (isWholePropertyLease) {
                  return wholePropertyRent === undefined
                    ? "غير مسجل"
                    : `${money(wholePropertyRent)} · للعقار بالكامل`;
                }
                return (
                  <div className="property-unit-reference">
                    <strong>
                      {explicit === undefined
                        ? splitDefaultMonthlyRentMinor === undefined
                          ? "غير مسجل"
                          : `سعر الوحدة غير مسجل · افتراضي سابق ${money(splitDefaultMonthlyRentMinor)}`
                        : `للإيجار: ${money(explicit)} · خاص بالوحدة`}
                    </strong>
                    {!goal &&
                      positiveMinor(
                        parseUnitProfile(row.meta.unitProfile).salePriceMinor
                      ) !== undefined && (
                        <strong>
                          بيع:{" "}
                          {money(
                            parseUnitProfile(row.meta.unitProfile)
                              .salePriceMinor!
                          )}{" "}
                          · خاص بالوحدة
                        </strong>
                      )}
                    <UnitMonthlyRentEditor
                      unit={row}
                      inheritedMonthlyRentMinor={splitDefaultMonthlyRentMinor}
                    />
                  </div>
                );
              },
            },
            {
              key: "status",
              label: "الإشغال وفق العقود",
              render: row => {
                const summary = getTenancySummary(
                  state.entities,
                  property,
                  row,
                  asOf
                );
                const occupancy = unitOccupancyAt(state.entities, row.id, asOf);
                return (
                  <StatusBadge
                    status={
                      summary.source === "declaration" &&
                      (summary.status === "rented" ||
                        summary.status === "reserved") &&
                      occupancy !== "occupied"
                        ? "بانتظار تسجيل العقد"
                        : occupancyLabel(occupancy)
                    }
                  />
                );
              },
            },
            {
              key: "actions",
              label: "إجراءات",
              render: row => (
                <div className="property-actions">
                  <UnitDetailsDialog
                    mode="details"
                    unit={row}
                    property={property}
                    canEdit={canEdit}
                    trigger={
                      <button className="btn-secondary" type="button">
                        التفاصيل
                      </button>
                    }
                  />
                  <UnitDetailsDialog
                    mode="edit"
                    unit={row}
                    property={property}
                    canEdit={canEdit}
                    inheritedMonthlyRentMinor={splitDefaultMonthlyRentMinor}
                    onSubmit={values => updateUnit(row, values)}
                    trigger={
                      <button
                        className="btn-secondary"
                        type="button"
                        disabled={!canEdit}
                      >
                        تعديل الوحدة
                      </button>
                    }
                  />
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
