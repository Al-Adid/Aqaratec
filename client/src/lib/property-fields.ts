import { PROTOTYPE_DATE, toMinor, type MetaValue } from "@shared/prototype";
import type { RentalMode } from "@shared/lease-template-types";
import type {
  AccommodationProfile,
  PropertyProfile,
  PropertyUnitComposition,
} from "@shared/unit-profile-types";
import {
  ACCOMMODATION_FORM_KEYS,
  makeAccommodationProfile,
  parseAccommodationProfile,
} from "./room-layout";
import {
  activePropertyFormValues,
  filterPropertyProfileForType,
  getPropertyFieldPolicy,
  type PropertyApplicabilityScope,
} from "./property-applicability";
import {
  hasPropertyLocationFormFields,
  makePropertyLocation,
  parsePropertyLocation,
} from "./newproperty-location";
import { parsePropertyMedia, serializePropertyMedia } from "./property-media";
import { makeTenancyDeclaration } from "./tenancy-information";

export const PROPERTY_ASSET_TYPES = [
  "villa",
  "villa_complex",
  "building",
  "apartment",
  "land",
  "shop",
  "office",
  "mixed",
] as const;
export type PropertyAssetType = (typeof PROPERTY_ASSET_TYPES)[number];

export const PROPERTY_USAGE_TYPES = [
  "residential",
  "commercial",
  "mixed",
] as const;
export type PropertyUsageType = (typeof PROPERTY_USAGE_TYPES)[number];

export type PropertyInputMethod = "يدوي" | "Excel";
export const MAX_PROPERTY_FIELDS = 32;
export const MAX_PROPERTY_FIELD_LENGTH = 1024;
export const MAX_PROPERTY_IDENTIFIER_LENGTH = 80;
/** One persisted title limit shared by property and generated/unit names. */
export const MAX_PROPERTY_TITLE_LENGTH = 256;
/** The shared snapshot schema caps every numeric metadata value at this minor-unit amount. */
export const MAX_MONTHLY_RENT_MINOR = 1_000_000_000_000;

const assetLabels: Record<PropertyAssetType, string> = {
  villa: "فيلا",
  villa_complex: "مجمع فلل",
  building: "عمارة",
  apartment: "شقق",
  land: "أرض",
  shop: "محل",
  office: "مكتب",
  mixed: "متعدد الاستخدام",
};

const usageLabels: Record<PropertyUsageType, string> = {
  residential: "سكني",
  commercial: "تجاري",
  mixed: "مختلط",
};

export interface PropertyAge {
  kind: "buildingYear" | "stated" | "unknown" | "notApplicable";
  years?: number;
  note?: string;
}

export interface PropertyDraft {
  title: string;
  portfolioId: string;
  assetType: PropertyAssetType;
  usageType: PropertyUsageType;
  inputMethod?: PropertyInputMethod;
  rentalMode?: RentalMode;
  propertyNumber?: string;
  electricityNumber?: string;
  unitCount: number;
  location: string;
  meta: Record<string, MetaValue>;
  /**
   * Metadata keys explicitly cleared by a submitted optional field. Keys that
   * were omitted from the input are deliberately absent: update callers can
   * therefore preserve a historical value instead of guessing the intent.
   */
  clearMetaKeys: string[];
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

const PROPERTY_PROFILE_KEYS = [
  "v",
  "purpose",
  "mortgageStatus",
  "mortgageBank",
  "salePriceMinor",
  "contents",
  "unitComposition",
  "accommodation",
] as const;
const MAX_MORTGAGE_BANK_LENGTH = 160;
export const MAX_PROPERTY_PROFILE_CONTENTS_LENGTH = 512;

export const PROPERTY_UNIT_COMPOSITION_OPTIONS = [
  { value: "apartments", label: "شقق" },
  { value: "villas", label: "فلل" },
  { value: "coded_units", label: "وحدات ترميز" },
] as const satisfies readonly {
  value: PropertyUnitComposition;
  label: string;
}[];

function isPropertyUnitComposition(
  value: unknown
): value is PropertyUnitComposition {
  return PROPERTY_UNIT_COMPOSITION_OPTIONS.some(
    option => option.value === value
  );
}

export function propertyUnitCompositionLabel(value: unknown): string {
  return (
    PROPERTY_UNIT_COMPOSITION_OPTIONS.find(option => option.value === value)
      ?.label ?? "غيرمحدد"
  );
}

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.entries(value).every(([, entry]) => typeof entry === "string") &&
    Object.keys(value).every(key =>
      ACCOMMODATION_FORM_KEYS.includes(
        key as (typeof ACCOMMODATION_FORM_KEYS)[number]
      )
    )
  );
}

/** Parses the string-only accommodation form payload before it enters a profile. */
function parseAccommodationDraft(
  value: string | undefined
): AccommodationProfile | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("بيانات السكن غير صالحة.");
  }
  if (!isPlainStringRecord(decoded)) throw new Error("بيانات السكن غير صالحة.");
  return makeAccommodationProfile(decoded);
}

/**
 * Reads the compact optional property profile kept in one metadata value.
 * Absence deliberately means unspecified: it does not imply rent, sale, free,
 * or mortgaged for historical property rows.
 */
export function parsePropertyProfile(value: unknown): PropertyProfile {
  if (value === undefined || value === null || value === "") return { v: 1 };
  if (typeof value !== "string" || value.length > MAX_PROPERTY_FIELD_LENGTH)
    throw new Error("بيانات هدف العقار غير صالحة.");

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("بيانات هدف العقار غير صالحة.");
  }
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    decoded.v !== 1 ||
    Object.keys(decoded).some(
      key =>
        !PROPERTY_PROFILE_KEYS.includes(
          key as (typeof PROPERTY_PROFILE_KEYS)[number]
        )
    ) ||
    (decoded.purpose !== undefined &&
      decoded.purpose !== "rent" &&
      decoded.purpose !== "sale" &&
      decoded.purpose !== "mixed") ||
    (decoded.mortgageStatus !== undefined &&
      decoded.mortgageStatus !== "free" &&
      decoded.mortgageStatus !== "mortgaged") ||
    (decoded.mortgageBank !== undefined &&
      (typeof decoded.mortgageBank !== "string" ||
        decoded.mortgageBank.length > MAX_MORTGAGE_BANK_LENGTH)) ||
    (decoded.salePriceMinor !== undefined &&
      (typeof decoded.salePriceMinor !== "number" ||
        !Number.isSafeInteger(decoded.salePriceMinor) ||
        decoded.salePriceMinor <= 0)) ||
    (decoded.contents !== undefined &&
      (typeof decoded.contents !== "string" ||
        decoded.contents.length > MAX_PROPERTY_PROFILE_CONTENTS_LENGTH)) ||
    (decoded.unitComposition !== undefined &&
      !isPropertyUnitComposition(decoded.unitComposition))
  ) {
    throw new Error("بيانات هدف العقار غير صالحة.");
  }
  let accommodation: AccommodationProfile | undefined;
  try {
    accommodation = parseAccommodationProfile(decoded.accommodation);
  } catch {
    throw new Error("بيانات هدف العقار غير صالحة.");
  }
  return {
    v: 1,
    ...(decoded.purpose ? { purpose: decoded.purpose } : {}),
    ...(decoded.mortgageStatus
      ? { mortgageStatus: decoded.mortgageStatus }
      : {}),
    ...(decoded.mortgageBank !== undefined
      ? { mortgageBank: decoded.mortgageBank }
      : {}),
    ...(decoded.salePriceMinor !== undefined
      ? { salePriceMinor: decoded.salePriceMinor }
      : {}),
    ...(decoded.contents !== undefined ? { contents: decoded.contents } : {}),
    ...(decoded.unitComposition !== undefined
      ? { unitComposition: decoded.unitComposition }
      : {}),
    ...(accommodation ? { accommodation } : {}),
  } as PropertyProfile;
}

/** Serializes only a validated v1 profile; the key itself stays optional. */
export function serializePropertyProfile(value: PropertyProfile): string {
  const raw = JSON.stringify(value);
  const profile = parsePropertyProfile(raw);
  const serialized = JSON.stringify(profile);
  if (serialized.length > MAX_PROPERTY_FIELD_LENGTH)
    throw new Error("بيانات هدف العقار تتجاوز 1024 حرفًا.");
  return serialized;
}

function hasOwn(values: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function assertFieldLimits(values: Record<string, string>) {
  if (Object.keys(values).length > MAX_PROPERTY_FIELDS) {
    throw new Error(`لا يمكن حفظ أكثر من ${MAX_PROPERTY_FIELDS} حقلاً للعقار.`);
  }
  for (const [key, raw] of Object.entries(values)) {
    if (text(raw).length > MAX_PROPERTY_FIELD_LENGTH) {
      throw new Error(
        `قيمة «${key}» تتجاوز ${MAX_PROPERTY_FIELD_LENGTH} حرفًا.`
      );
    }
  }
}

/** Transition controls are never persisted property form fields. */
const OPERATIONAL_PROPERTY_FORM_KEYS = new Set([
  "requestId",
  "_changedFields",
  "_expectedEntityToken",
]);

function isAssetType(value: string): value is PropertyAssetType {
  return PROPERTY_ASSET_TYPES.includes(value as PropertyAssetType);
}

function isUsageType(value: string): value is PropertyUsageType {
  return PROPERTY_USAGE_TYPES.includes(value as PropertyUsageType);
}

function normalizeAssetType(value: string): PropertyAssetType | undefined {
  if (isAssetType(value)) return value;
  // Check compound Arabic names before the general villa matcher below.
  // Historical imports use both «مجمع فلل» and spelling variants such as
  // «مجمع فيلل» / «مجمع فيلات».
  if (/مجمع\s*(?:فلل|فيلل|فيلات|فيلا)/.test(value)) return "villa_complex";
  if (/فيلا/.test(value)) return "villa";
  if (/عمارة|برج/.test(value)) return "building";
  if (/شقة|شقق/.test(value)) return "apartment";
  if (/أرض/.test(value)) return "land";
  if (/محل/.test(value)) return "shop";
  if (/مكتب/.test(value)) return "office";
  if (/مختلط|متعدد/.test(value)) return "mixed";
  return undefined;
}

function defaultUsageFor(assetType: PropertyAssetType): PropertyUsageType {
  return getPropertyFieldPolicy(assetType).allowedUsages[0];
}

function normalizeRentalMode(value: string): RentalMode | undefined {
  if (value === "whole" || /^(كامل|العقار بالكامل|تأجير كامل)$/.test(value))
    return "whole";
  if (value === "units" || /^(وحدات|تقسيم|مقسم)$/.test(value)) return "units";
  return undefined;
}

function optionalIdentifier(value: string, label: string): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_PROPERTY_IDENTIFIER_LENGTH) {
    throw new Error(`${label} يتجاوز ${MAX_PROPERTY_IDENTIFIER_LENGTH} حرفًا.`);
  }
  return value;
}

export function normalizePropertyNumericInput(
  value: string | undefined
): string {
  let normalized = (value ?? "")
    .trim()
    .replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - "۰".charCodeAt(0)))
    .replaceAll("٬", "")
    .replaceAll("٫", ".");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized))
    normalized = normalized.replaceAll(",", "");
  return normalized;
}

/**
 * Parses an optional QAR monthly rent. Amounts are always retained in minor
 * units in metadata; an empty field deliberately signals no value/clear.
 */
export function parseMonthlyRentMinor(
  value: string | undefined,
  label = "الإيجار الشهري"
): number | undefined {
  const normalized = normalizePropertyNumericInput(value);
  if (!normalized) return undefined;
  let amount: number;
  try {
    amount = toMinor(normalized);
  } catch {
    throw new Error(
      `${label} يجب أن يكون مبلغًا موجبًا بعملة ر.ق وبحد أقصى منزلتين عشريتين.`
    );
  }
  if (amount <= 0) {
    throw new Error(`${label} يجب أن يكون مبلغًا موجبًا بعملة ر.ق.`);
  }
  if (amount > MAX_MONTHLY_RENT_MINOR) {
    throw new Error(`${label} يتجاوز الحد الآمن لميتاداتا نسخة التجربة.`);
  }
  return amount;
}

/**
 * Parses an optional requested sale price as exact QAR cents. It deliberately
 * has no monthly-rent metadata cap because the value is stored inside the
 * compact property profile, while still requiring a positive safe integer.
 */
export function parseSalePriceMinor(
  value: string | undefined,
  label = "سعر البيع المطلوب"
): number | undefined {
  const normalized = normalizePropertyNumericInput(value);
  if (!normalized) return undefined;
  let amount: number;
  try {
    amount = toMinor(normalized);
  } catch {
    throw new Error(
      `${label} يجب أن يكون مبلغًا موجبًا بعملة ر.ق وبحد أقصى منزلتين عشريتين.`
    );
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${label} يجب أن يكون مبلغًا موجبًا بعملة ر.ق.`);
  }
  return amount;
}

/**
 * Builds the active form's compact property profile. The parser remains
 * permissive for old saved rows; this helper alone requires the lender while
 * a new form explicitly selects a mortgaged status.
 */
export function makePropertyProfile(
  values: Record<string, string>,
  scope: PropertyApplicabilityScope = {}
): PropertyProfile {
  const activeValues = activePropertyFormValues({
    ...values,
    assetType: scope.assetType ?? values.assetType ?? "",
    usageType: scope.usageType ?? values.usageType ?? "",
    rentalMode: scope.rentalMode ?? values.rentalMode ?? "",
  });
  const purpose = text(activeValues.propertyPurpose);
  const mortgageStatus = text(activeValues.mortgageStatus);
  const unitComposition = text(activeValues.unitComposition);
  const accommodation = parseAccommodationDraft(activeValues.accommodation);
  if (
    purpose &&
    purpose !== "rent" &&
    purpose !== "sale" &&
    purpose !== "mixed"
  ) {
    throw new Error("هدف العقار غير صالح.");
  }
  if (
    mortgageStatus &&
    mortgageStatus !== "free" &&
    mortgageStatus !== "mortgaged"
  ) {
    throw new Error("حالة رهن العقار غير صالحة.");
  }
  if (unitComposition && !isPropertyUnitComposition(unitComposition)) {
    throw new Error("وصف وحدات العقار غير صالح.");
  }

  const profile: PropertyProfile = {
    v: 1,
    ...(purpose ? { purpose: purpose as PropertyProfile["purpose"] } : {}),
    ...(mortgageStatus
      ? { mortgageStatus: mortgageStatus as PropertyProfile["mortgageStatus"] }
      : {}),
    ...(unitComposition
      ? { unitComposition: unitComposition as PropertyUnitComposition }
      : {}),
    ...(accommodation ? { accommodation } : {}),
  };
  if (mortgageStatus === "mortgaged") {
    const mortgageBank = text(activeValues.mortgageBank);
    if (!mortgageBank) throw new Error("اسم بنك الرهن مطلوب للعقار المرهون.");
    if (mortgageBank.length > MAX_MORTGAGE_BANK_LENGTH) {
      throw new Error(
        `اسم بنك الرهن يتجاوز ${MAX_MORTGAGE_BANK_LENGTH} حرفًا.`
      );
    }
    profile.mortgageBank = mortgageBank;
  }
  const contents = text(activeValues.contents);
  if (contents.length > MAX_PROPERTY_PROFILE_CONTENTS_LENGTH) {
    throw new Error(
      `محتويات العقار تتجاوز ${MAX_PROPERTY_PROFILE_CONTENTS_LENGTH} حرفًا.`
    );
  }
  if (contents) profile.contents = contents;
  if (purpose === "sale" || purpose === "mixed") {
    const salePriceMinor = parseSalePriceMinor(activeValues.salePrice);
    if (salePriceMinor !== undefined) profile.salePriceMinor = salePriceMinor;
  }
  return filterPropertyProfileForType(
    profile,
    scope.assetType,
    scope.usageType,
    scope.rentalMode
  );
}

function parseOptionalNumber(value: string, label: string): number | undefined {
  value = normalizePropertyNumericInput(value);
  if (!value) return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${label} يجب أن تكون رقمًا موجبًا أو صفرًا.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} يجب أن تكون رقمًا موجبًا أو صفرًا.`);
  }
  return number;
}

export function parseUnitCount(value: string): number {
  value = normalizePropertyNumericInput(value);
  if (!/^\d+$/.test(value)) {
    throw new Error("عدد الوحدات يجب أن يكون عددًا صحيحًا بين 0 و50.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 50) {
    throw new Error("عدد الوحدات يجب أن يكون عددًا صحيحًا بين 0 و50.");
  }
  return count;
}

export function parseBuildingYear(
  value: string,
  assetType: PropertyAssetType,
  referenceDate = PROTOTYPE_DATE
): number | undefined {
  value = normalizePropertyNumericInput(value);
  if (!value) return undefined;
  if (assetType === "land") {
    throw new Error("الأرض لا تسجل سنة بناء أو عمر بناء.");
  }
  if (!/^\d{4}$/.test(value)) {
    throw new Error("سنة البناء يجب أن تكون سنة صحيحة من أربعة أرقام.");
  }
  const year = Number(value);
  const referenceYear = Number(referenceDate.slice(0, 4));
  if (year < 1800 || year > referenceYear) {
    throw new Error(`سنة البناء يجب أن تكون بين 1800 و${referenceYear}.`);
  }
  return year;
}

export function assetTypeLabel(value: PropertyAssetType | string): string {
  const type = normalizeAssetType(value);
  return type ? assetLabels[type] : "غير مسجل";
}

export function usageTypeLabel(value: PropertyUsageType | string): string {
  return isUsageType(value) ? usageLabels[value] : "غير مسجل";
}

/** Reads both new keys and historical demo keys without changing saved records. */
export function assetTypeFromMeta(
  meta: Record<string, MetaValue>
): PropertyAssetType | undefined {
  const explicit = normalizeAssetType(text(meta.assetType));
  if (explicit) return explicit;

  const legacy = text(meta.type);
  return normalizeAssetType(legacy);
}

export function buildingYearFromMeta(
  meta: Record<string, MetaValue>,
  referenceDate = PROTOTYPE_DATE
): number | undefined {
  const candidate = text(meta.buildingYear || meta.year);
  if (!/^\d{4}$/.test(candidate)) return undefined;
  const year = Number(candidate);
  const referenceYear = Number(referenceDate.slice(0, 4));
  return year >= 1800 && year <= referenceYear ? year : undefined;
}

export function derivePropertyAge(
  meta: Record<string, MetaValue>,
  assetType = assetTypeFromMeta(meta),
  referenceDate = PROTOTYPE_DATE
): PropertyAge {
  if (assetType === "land") return { kind: "notApplicable" };

  const year = buildingYearFromMeta(meta, referenceDate);
  if (year) {
    return {
      kind: "buildingYear",
      years: Number(referenceDate.slice(0, 4)) - year,
    };
  }

  const stated = text(meta.age);
  if (/^\d+$/.test(stated) && Number(stated) >= 0) {
    return {
      kind: "stated",
      years: Number(stated),
      note: "العمر مصرح به في سجل تاريخي؛ لا يُستنتج من تاريخ إدخال السجل.",
    };
  }
  return { kind: "unknown" };
}

export function ageLabel(age: PropertyAge): string {
  if (age.kind === "notApplicable") return "لا ينطبق · أرض";
  if (age.years !== undefined) return `${age.years} سنة`;
  return "غير معروف";
}

export function collectionAccountFromMeta(
  meta: Record<string, MetaValue>
): string {
  return text(meta.collectionAccount || meta.account);
}

export function inputMethodFromMeta(
  meta: Record<string, MetaValue>
): PropertyInputMethod | undefined {
  const candidate = text(meta.inputMethod || meta.source);
  return candidate === "يدوي" || candidate === "Excel" ? candidate : undefined;
}

export function inputMethodLabel(meta: Record<string, MetaValue>): string {
  return inputMethodFromMeta(meta) ?? "غير مسجل";
}

/** Returns only an explicitly saved mode; historical records remain unknown. */
export function rentalModeFromMeta(
  meta: Record<string, MetaValue>
): RentalMode | undefined {
  return normalizeRentalMode(text(meta.rentalMode));
}

export function rentalModeLabel(
  value: RentalMode | string | undefined
): string {
  const mode = normalizeRentalMode(String(value ?? "").trim());
  if (mode === "whole") return "تأجير العقار كاملاً";
  if (mode === "units") return "تقسيم إلى وحدات";
  return "غير مسجل";
}

export function makePropertyDraft(
  rawValues: Record<string, string>,
  options: { requireInputMethod?: boolean; referenceDate?: string } = {}
): PropertyDraft {
  // Work on an active validation copy only. The UI retains its complete draft,
  // including a former mode's values, while hidden values neither validate nor
  // become active property metadata. Operational transition keys do not consume
  // the persisted-form limit.
  const submittedValues = Object.fromEntries(
    Object.entries(rawValues).filter(
      ([key]) => !OPERATIONAL_PROPERTY_FORM_KEYS.has(key)
    )
  );
  const policyInput = { ...submittedValues };
  if (hasOwn(policyInput, "assetType")) {
    policyInput.assetType =
      normalizeAssetType(text(policyInput.assetType)) ??
      text(policyInput.assetType);
  }
  if (hasOwn(policyInput, "usageType"))
    policyInput.usageType = text(policyInput.usageType);
  if (hasOwn(policyInput, "rentalMode")) {
    policyInput.rentalMode =
      normalizeRentalMode(text(policyInput.rentalMode)) ??
      text(policyInput.rentalMode);
  }
  const activeRawValues = activePropertyFormValues(policyInput);
  assertFieldLimits(activeRawValues);
  const values = Object.fromEntries(
    Object.entries(activeRawValues).map(([key, raw]) => [key, text(raw)])
  );
  const title = values.title;
  const portfolioId = values.portfolioId;
  const assetType = normalizeAssetType(values.assetType);
  const usageType =
    values.usageType || (assetType ? defaultUsageFor(assetType) : "");
  const inputMethod = values.inputMethod;

  if (!title) throw new Error("اسم العقار مطلوب.");
  if (title.length > MAX_PROPERTY_TITLE_LENGTH) {
    throw new Error(`اسم العقار يتجاوز ${MAX_PROPERTY_TITLE_LENGTH} حرفًا.`);
  }
  if (!portfolioId) throw new Error("اختر محفظة موجودة قبل حفظ العقار.");
  if (!assetType) throw new Error("اختر نوع أصل صالح.");
  if (!isUsageType(usageType)) throw new Error("اختر استخدامًا صالحًا.");
  if (!getPropertyFieldPolicy(assetType).allowedUsages.includes(usageType)) {
    throw new Error("نوع الاستخدام لا يتوافق مع نوع الأصل المختار.");
  }
  if (inputMethod && inputMethod !== "يدوي" && inputMethod !== "Excel") {
    throw new Error("مصدر الإدخال يجب أن يكون يدويًا أو Excel.");
  }
  if (options.requireInputMethod && !inputMethod) {
    throw new Error("حدّد مصدر الإدخال قبل الحفظ.");
  }

  const rentalModeValue = values.rentalMode;
  const rentalMode = rentalModeValue
    ? normalizeRentalMode(rentalModeValue)
    : undefined;
  if (rentalModeValue && !rentalMode) {
    throw new Error("طريقة التأجير يجب أن تكون العقار كاملاً أو وحدات.");
  }
  const submittedPropertyProfile = hasOwn(activeRawValues, "propertyProfile")
    ? values.propertyProfile
      ? filterPropertyProfileForType(
          parsePropertyProfile(values.propertyProfile),
          assetType,
          usageType,
          rentalMode
        )
      : undefined
    : undefined;
  const directProfileFieldsSubmitted = [
    "propertyPurpose",
    "mortgageStatus",
    "mortgageBank",
    "salePrice",
    "contents",
    "unitComposition",
    "accommodation",
  ].some(key => hasOwn(activeRawValues, key));
  const propertyProfile =
    submittedPropertyProfile ??
    (directProfileFieldsSubmitted
      ? makePropertyProfile(values, { assetType, usageType, rentalMode })
      : undefined);
  const tenancyDeclarationFieldsSubmitted = [
    "tenancyStatus",
    "tenancyStartDate",
    "tenancyEndDate",
    "tenancyMonthlyRent",
  ].some(key => hasOwn(activeRawValues, key));
  const tenancyDeclaration = tenancyDeclarationFieldsSubmitted
    ? makeTenancyDeclaration(values)
    : undefined;
  const directPropertyLocationSubmitted =
    hasPropertyLocationFormFields(activeRawValues);
  const packedPropertyLocationSubmitted = hasOwn(
    activeRawValues,
    "propertyLocation"
  );
  // Forms submit the four direct values. Imports and compatibility callers may
  // submit the already-packed value instead. Direct fields deliberately win
  // when both appear, so a stale hidden compact field cannot overwrite a user
  // edit. The independent descriptive `location` string is handled below.
  const propertyLocation = directPropertyLocationSubmitted
    ? makePropertyLocation(values)
    : packedPropertyLocationSubmitted
      ? values.propertyLocation
        ? JSON.stringify(parsePropertyLocation(values.propertyLocation))
        : ""
      : undefined;
  const isSaleOnlyProperty = propertyProfile?.purpose === "sale";
  const hasMonthlyRent =
    hasOwn(activeRawValues, "monthlyRent") && !isSaleOnlyProperty;
  if (hasMonthlyRent && values.monthlyRent && !rentalMode) {
    throw new Error(
      "حدّد طريقة التأجير قبل تسجيل الإيجار الشهري؛ لا نفترض نمط السجل القديم."
    );
  }
  const monthlyRentMinor = hasMonthlyRent
    ? parseMonthlyRentMinor(
        values.monthlyRent,
        rentalMode === "units"
          ? "الإيجار الشهري الافتراضي لكل وحدة"
          : "الإيجار الشهري"
      )
    : undefined;
  // A whole-property tenancy has exactly one internal lease target. Do not
  // infer this mode for older rows that did not explicitly choose it.
  const parsedUnitCount =
    rentalMode === "whole" ? 1 : parseUnitCount(values.unitCount || "0");
  if (rentalMode === "units" && parsedUnitCount < 2) {
    throw new Error("التقسيم إلى وحدات يتطلب عددًا من 2 إلى 50 وحدة.");
  }
  const unitCount = parsedUnitCount;
  const propertyNumber = optionalIdentifier(
    values.propertyNumber,
    "رقم العقار"
  );
  const electricityNumber = optionalIdentifier(
    values.electricityNumber,
    "رقم الكهرباء"
  );
  const buildingYear = parseBuildingYear(
    values.buildingYear,
    assetType,
    options.referenceDate
  );
  const landArea = parseOptionalNumber(values.landArea, "مساحة الأرض");
  const buildingArea = parseOptionalNumber(values.buildingArea, "مساحة البناء");

  let lastMaintenanceCostMinor: number | undefined;
  if (values.lastMaintenanceCost) {
    try {
      lastMaintenanceCostMinor = toMinor(values.lastMaintenanceCost);
    } catch {
      throw new Error(
        "تكلفة آخر صيانة يجب أن تكون مبلغًا موجبًا بحد أقصى منزلتين عشريتين."
      );
    }
  }
  if (
    values.lastMaintenanceDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(values.lastMaintenanceDate) ||
      values.lastMaintenanceDate > (options.referenceDate ?? PROTOTYPE_DATE))
  ) {
    throw new Error("تاريخ آخر صيانة يجب أن يكون تاريخًا صحيحًا غير مستقبلي.");
  }

  const meta: Record<string, MetaValue> = {
    assetType,
    type: assetTypeLabel(assetType),
    usageType,
  };
  const clearMetaKeys = new Set<string>();
  const addText = (key: string, field = key) => {
    if (!hasOwn(activeRawValues, field)) return;
    if (values[field]) meta[key] = values[field];
    else clearMetaKeys.add(key);
  };
  addText("location");
  if (directPropertyLocationSubmitted || packedPropertyLocationSubmitted) {
    if (propertyLocation) meta.propertyLocation = propertyLocation;
    else clearMetaKeys.add("propertyLocation");
  }
  addText("condition");
  addText("availableServices");
  addText("collectionAccount");
  if (hasOwn(activeRawValues, "collectionAccount")) {
    if (values.collectionAccount) meta.account = values.collectionAccount;
    else clearMetaKeys.add("account");
  }
  addText("bankName");
  addText("accountOwner");
  addText("notes");
  if (hasOwn(activeRawValues, "description")) {
    if (values.description) meta.description = values.description;
    else clearMetaKeys.add("description");
  } else if (hasOwn(activeRawValues, "notes") && values.notes) {
    // Older forms only submit notes. Preserve that non-empty compatibility
    // mirror, but never clear an explicit description because notes are blank.
    meta.description = values.notes;
  }
  addText("deedRef");
  if (hasOwn(activeRawValues, "planNumber")) {
    const number = values.planNumber || undefined;
    if (number) {
      meta.planNumber = number;
      meta.planRef = number;
    } else {
      clearMetaKeys.add("planNumber");
      clearMetaKeys.add("planRef");
    }
  } else addText("planRef");
  if (hasOwn(activeRawValues, "propertyMedia")) {
    const media = serializePropertyMedia(
      parsePropertyMedia(values.propertyMedia)
    );
    if (media) meta.propertyMedia = media;
    else clearMetaKeys.add("propertyMedia");
  }
  if (
    hasOwn(activeRawValues, "propertyProfile") ||
    directProfileFieldsSubmitted
  ) {
    if (propertyProfile) {
      meta.propertyProfile = serializePropertyProfile(propertyProfile);
    } else {
      clearMetaKeys.add("propertyProfile");
    }
  }
  if (tenancyDeclarationFieldsSubmitted) {
    if (tenancyDeclaration) meta.tenancyDeclaration = tenancyDeclaration;
    else clearMetaKeys.add("tenancyDeclaration");
  }
  addText("lastMaintenanceDate");
  if (rentalMode) meta.rentalMode = rentalMode;
  if (hasOwn(activeRawValues, "propertyNumber")) {
    if (propertyNumber) meta.propertyNumber = propertyNumber;
    else clearMetaKeys.add("propertyNumber");
  }
  if (hasOwn(activeRawValues, "electricityNumber")) {
    if (electricityNumber) meta.electricityNumber = electricityNumber;
    else clearMetaKeys.add("electricityNumber");
  }
  if (hasOwn(activeRawValues, "buildingYear")) {
    if (buildingYear !== undefined) {
      meta.buildingYear = buildingYear;
      // Keep legacy readers working without replacing the original record date.
      meta.year = buildingYear;
    } else {
      clearMetaKeys.add("buildingYear");
      clearMetaKeys.add("year");
    }
  }
  if (hasOwn(activeRawValues, "landArea")) {
    if (landArea !== undefined) meta.landArea = landArea;
    else clearMetaKeys.add("landArea");
  }
  if (hasOwn(activeRawValues, "buildingArea")) {
    if (buildingArea !== undefined) meta.buildingArea = buildingArea;
    else clearMetaKeys.add("buildingArea");
  }
  if (hasOwn(activeRawValues, "lastMaintenanceCost")) {
    if (lastMaintenanceCostMinor !== undefined) {
      meta.lastMaintenanceCostMinor = lastMaintenanceCostMinor;
    } else {
      clearMetaKeys.add("lastMaintenanceCostMinor");
    }
  }
  if (hasMonthlyRent && rentalMode) {
    const rentKey =
      rentalMode === "whole" ? "monthlyRentMinor" : "unitMonthlyRentMinor";
    if (monthlyRentMinor !== undefined) meta[rentKey] = monthlyRentMinor;
    else clearMetaKeys.add(rentKey);
  }
  if (hasOwn(activeRawValues, "inputMethod")) {
    if (inputMethod) {
      meta.inputMethod = inputMethod;
      meta.source = inputMethod;
    } else {
      clearMetaKeys.add("inputMethod");
      clearMetaKeys.add("source");
    }
  }

  return {
    title,
    portfolioId,
    assetType,
    usageType,
    inputMethod: inputMethod as PropertyInputMethod | undefined,
    rentalMode,
    propertyNumber,
    electricityNumber,
    unitCount,
    location: values.location,
    meta,
    clearMetaKeys: [...clearMetaKeys],
  };
}
