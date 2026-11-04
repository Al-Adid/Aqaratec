import type {
  AuditEvent,
  DemoEntity,
  EntityMap,
  MetaValue,
  PrototypeState,
} from "@shared/prototype";
import { PROTOTYPE_DATE } from "@shared/prototype";
import { validatePrototypeState } from "@shared/prototype-validation";
import type {
  ApartmentLayout,
  FurnishingStatus,
  PropertyMortgageStatus,
  PropertyProfile,
  PropertyPurpose,
  UnitCategory,
  UnitPurpose,
  UnitProfile,
  UnitProfileInput,
  UnitProfileTransition,
  VillaArrangement,
} from "@shared/unit-profile-types";
import {
  MAX_PROPERTY_TITLE_LENGTH,
  parseMonthlyRentMinor,
  parsePropertyProfile,
  parseSalePriceMinor,
  serializePropertyProfile,
} from "./property-fields";
import { roomLayoutLabel } from "./room-layout";
import {
  assertUnitIdentifierAvailable,
  nextUnitIdentifier,
} from "./prototype-unit-identifiers";
import { scenarioDate } from "@shared/prototype-clock";
import {
  getTenancyFormValues,
  getTenancySummary,
  makeTenancyDeclaration,
} from "./tenancy-information";
import { assertExpectedEntityToken } from "./prototype-edit-concurrency";

export {
  makePropertyProfile,
  parsePropertyProfile,
  serializePropertyProfile,
} from "./property-fields";

const MAX_TEXT_LENGTH = 1024;
const MAX_IDENTIFIER_LENGTH = 80;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_META_ENTRIES = 32;
const MAX_UNITS_PER_KIND = 500;
const MAX_ENTITIES_TOTAL = 2000;
const AUDIT_LIMIT = 300;

const UNIT_PROFILE_KEYS = [
  "v",
  "purpose",
  "category",
  "villaArrangement",
  "roomLayout",
  "apartmentLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "contents",
  "propertyNumber",
  "planNumber",
  "waterNumber",
  "salePriceMinor",
  "areaM2",
] as const;

const PROFILE_FORM_KEYS = [
  "unitPurpose",
  "category",
  "villaArrangement",
  "roomLayout",
  "apartmentLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "contents",
  "propertyNumber",
  "planNumber",
  "waterNumber",
  "salePrice",
  "unitArea",
] as const;

const UNIT_CATEGORIES: readonly UnitCategory[] = [
  "villa",
  "apartment",
  "shop",
  "office",
  "other",
];
const UNIT_PURPOSES: readonly UnitPurpose[] = ["rent", "sale"];
const VILLA_ARRANGEMENTS: readonly VillaArrangement[] = [
  "attached",
  "detached",
];
const APARTMENT_LAYOUTS: readonly ApartmentLayout[] = [
  "studio",
  "1-living",
  "2-living",
  "3-living",
  "4-living",
  "5-living",
  "custom",
];
const FURNISHING_STATUSES: readonly FurnishingStatus[] = [
  "furnished",
  "unfurnished",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(values: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `unit-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function normalizeDigits(value: string): string {
  return value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

/**
 * Parses a manually entered physical unit area while retaining a number (not a
 * formatted string) in the compact profile. Arabic digits and separators match
 * the property-number input conventions, but areas never accept exponent or
 * negative notation.
 */
export function parseUnitAreaM2(value: unknown): number | undefined {
  let normalized = normalizeDigits(text(value))
    .replaceAll("٬", "")
    .replaceAll("٫", ".");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized))
    normalized = normalized.replaceAll(",", "");
  if (!normalized) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(
      "مساحة الوحدة يجب أن تكون رقمًا موجبًا بحد أقصى منزلتين عشريتين."
    );
  }
  const area = Number(normalized);
  if (!Number.isFinite(area) || area <= 0 || area > 1_000_000_000_000) {
    throw new Error(
      "مساحة الوحدة يجب أن تكون رقمًا موجبًا ضمن الحد الآمن للميتاداتا."
    );
  }
  return area;
}

function validAreaM2(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000_000_000 &&
    Number(value.toFixed(2)) === value
  );
}

/** A legacy numeric `meta.area` is display-compatible but never guessed from text. */
function legacyUnitAreaM2(value: unknown): number | undefined {
  return validAreaM2(value) ? value : undefined;
}

function parseCount(value: unknown, label: string): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = normalizeDigits(raw);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا بين 0 و20.`);
  }
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < 0 || result > 20) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا بين 0 و20.`);
  }
  return result;
}

function assertIdentifier(value: string, label: string): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_IDENTIFIER_LENGTH)
    throw new Error(`${label} يتجاوز ${MAX_IDENTIFIER_LENGTH} حرفًا.`);
  return value;
}

function validUnitCategory(value: unknown): value is UnitCategory {
  return UNIT_CATEGORIES.includes(value as UnitCategory);
}

function validUnitPurpose(value: unknown): value is UnitPurpose {
  return UNIT_PURPOSES.includes(value as UnitPurpose);
}

function validVillaArrangement(value: unknown): value is VillaArrangement {
  return VILLA_ARRANGEMENTS.includes(value as VillaArrangement);
}

function validApartmentLayout(value: unknown): value is ApartmentLayout {
  return APARTMENT_LAYOUTS.includes(value as ApartmentLayout);
}

function validFurnishing(value: unknown): value is FurnishingStatus {
  return FURNISHING_STATUSES.includes(value as FurnishingStatus);
}

function hasProfileDetails(profile: UnitProfile): boolean {
  return Object.keys(profile).some(key => key !== "v");
}

/** Layout choices validate explicitly supplied counts and never infer them. */
function validateRoomLayoutCounts(
  layout: ApartmentLayout | undefined,
  bedrooms: number | undefined,
  livingRooms: number | undefined
): void {
  if (!layout) return;
  if (bedrooms === undefined || livingRooms === undefined)
    throw new Error("حدّد عدد الغرف والصالات لتوزيع الغرف المختار.");
  if (layout === "studio") {
    if (bedrooms !== 0 || livingRooms !== 0)
      throw new Error("الاستوديو لا يحتوي غرفًا أو صالة مستقلة.");
  } else if (layout !== "custom") {
    const expectedBedrooms = Number(layout.slice(0, 1));
    if (bedrooms !== expectedBedrooms || livingRooms !== 1)
      throw new Error("عدد الغرف والصالات لا يطابق توزيع الغرف المختار.");
  }
}

/** Enforces semantic layout rules after all submitted profile fields are merged. */
function validateUnitProfile(profile: UnitProfile): UnitProfile {
  if (profile.v !== 1) throw new Error("بيانات وصف الوحدة غير صالحة.");
  if (profile.purpose !== undefined && !validUnitPurpose(profile.purpose))
    throw new Error("هدف الوحدة غير صالح.");
  if (profile.category !== undefined && !validUnitCategory(profile.category))
    throw new Error("نوع الوحدة غير صالح.");
  if (
    profile.villaArrangement !== undefined &&
    !validVillaArrangement(profile.villaArrangement)
  )
    throw new Error("ترتيب الفيلا غير صالح.");
  if (
    profile.apartmentLayout !== undefined &&
    !validApartmentLayout(profile.apartmentLayout)
  )
    throw new Error("توزيع الشقة غير صالح.");
  if (
    profile.roomLayout !== undefined &&
    !validApartmentLayout(profile.roomLayout)
  )
    throw new Error("توزيع الغرف غير صالح.");
  if (profile.furnishing !== undefined && !validFurnishing(profile.furnishing))
    throw new Error("حالة التأثيث غير صالحة.");

  for (const [key, label] of [
    ["bedrooms", "عدد الغرف"],
    ["livingRooms", "عدد الصالات"],
    ["bathrooms", "عدد الحمامات"],
    ["kitchens", "عدد المطابخ"],
  ] as const) {
    const value = profile[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > 20)
    ) {
      throw new Error(`${label} يجب أن يكون عددًا صحيحًا بين 0 و20.`);
    }
  }
  validateRoomLayoutCounts(
    profile.roomLayout,
    profile.bedrooms,
    profile.livingRooms
  );
  if (
    profile.contents !== undefined &&
    (typeof profile.contents !== "string" ||
      profile.contents.length > MAX_TEXT_LENGTH)
  )
    throw new Error("محتويات الوحدة غير صالحة.");
  for (const [key, label] of [
    ["propertyNumber", "رقم العقار الخاص بالوحدة"],
    ["planNumber", "رقم مخطط الوحدة"],
    ["waterNumber", "رقم ماء الوحدة"],
  ] as const) {
    const value = profile[key];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > MAX_IDENTIFIER_LENGTH)
    )
      throw new Error(`${label} يتجاوز ${MAX_IDENTIFIER_LENGTH} حرفًا.`);
  }
  if (
    profile.salePriceMinor !== undefined &&
    (!Number.isSafeInteger(profile.salePriceMinor) ||
      profile.salePriceMinor <= 0)
  ) {
    throw new Error("سعر بيع الوحدة غير صالح.");
  }
  if (profile.areaM2 !== undefined && !validAreaM2(profile.areaM2)) {
    throw new Error("مساحة الوحدة غير صالحة.");
  }

  if (profile.category === "villa") {
    if (!profile.villaArrangement)
      throw new Error("حدّد ما إذا كانت الفيلا متلاصقة أو منفصلة.");
    if (profile.apartmentLayout !== undefined)
      throw new Error("لا يمكن إسناد توزيع شقة إلى فيلا.");
  } else if (profile.category === "apartment") {
    if (!profile.apartmentLayout) throw new Error("حدّد توزيع الشقة.");
    if (profile.villaArrangement !== undefined)
      throw new Error("لا يمكن إسناد ترتيب فيلا إلى شقة.");

    if (
      profile.roomLayout !== undefined &&
      profile.roomLayout !== profile.apartmentLayout
    ) {
      throw new Error("توزيع الغرف لا يطابق توزيع الشقة المحفوظ.");
    }

    const bedrooms = profile.bedrooms;
    const livingRooms = profile.livingRooms;
    if (bedrooms === undefined || livingRooms === undefined)
      throw new Error("حدّد عدد الغرف والصالات لتوزيع الشقة.");
    validateRoomLayoutCounts(profile.apartmentLayout, bedrooms, livingRooms);
  } else if (
    profile.villaArrangement !== undefined ||
    profile.apartmentLayout !== undefined
  ) {
    throw new Error("حدّد نوع الوحدة قبل ترتيب الفيلا أو توزيع الشقة.");
  }

  return profile;
}

function applyProfileFields(
  base: UnitProfile,
  values: UnitProfileInput
): UnitProfile {
  const profile: UnitProfile = { ...base, v: 1 };
  if (hasOwn(values, "unitPurpose")) {
    const purpose = text(values.unitPurpose);
    if (!purpose) delete profile.purpose;
    else if (!validUnitPurpose(purpose))
      throw new Error("هدف الوحدة غير صالح.");
    else profile.purpose = purpose;
  }
  const optionalEnum = <T extends string>(
    key:
      | "category"
      | "villaArrangement"
      | "roomLayout"
      | "apartmentLayout"
      | "furnishing",
    valid: (value: unknown) => value is T,
    message: string
  ) => {
    if (!hasOwn(values, key)) return;
    const value = text(values[key]);
    if (!value) {
      delete profile[key];
      return;
    }
    if (!valid(value)) throw new Error(message);
    Object.assign(profile, { [key]: value });
  };
  optionalEnum("category", validUnitCategory, "نوع الوحدة غير صالح.");
  optionalEnum(
    "villaArrangement",
    validVillaArrangement,
    "ترتيب الفيلا غير صالح."
  );
  const roomLayoutSubmitted = hasOwn(values, "roomLayout");
  const apartmentLayoutSubmitted = hasOwn(values, "apartmentLayout");
  const requestedRoomLayout = text(values.roomLayout);
  const requestedApartmentLayout = text(values.apartmentLayout);
  if (
    roomLayoutSubmitted &&
    apartmentLayoutSubmitted &&
    requestedRoomLayout &&
    requestedApartmentLayout &&
    requestedRoomLayout !== requestedApartmentLayout
  ) {
    throw new Error("توزيع الغرف لا يطابق توزيع الشقة المرسل.");
  }
  optionalEnum("roomLayout", validApartmentLayout, "توزيع الغرف غير صالح.");
  optionalEnum(
    "apartmentLayout",
    validApartmentLayout,
    "توزيع الشقة غير صالح."
  );
  // An explicit universal layout becomes the apartment compatibility value only
  // for an apartment. Conversely, a submitted legacy apartment layout refreshes
  // the universal field. Neither path classifies a generic unit as an apartment.
  if (profile.category === "apartment") {
    if (roomLayoutSubmitted && profile.roomLayout) {
      profile.apartmentLayout = profile.roomLayout;
    } else if (apartmentLayoutSubmitted && profile.apartmentLayout) {
      profile.roomLayout = profile.apartmentLayout;
    } else if (
      hasOwn(values, "category") &&
      profile.roomLayout &&
      !profile.apartmentLayout
    ) {
      profile.apartmentLayout = profile.roomLayout;
    }
  }
  optionalEnum("furnishing", validFurnishing, "حالة التأثيث غير صالحة.");

  for (const [key, label] of [
    ["bedrooms", "عدد الغرف"],
    ["livingRooms", "عدد الصالات"],
    ["bathrooms", "عدد الحمامات"],
    ["kitchens", "عدد المطابخ"],
  ] as const) {
    if (!hasOwn(values, key)) continue;
    const value = parseCount(values[key], label);
    if (value === undefined) delete profile[key];
    else Object.assign(profile, { [key]: value });
  }

  if (hasOwn(values, "contents")) {
    const value = text(values.contents);
    if (!value) delete profile.contents;
    else profile.contents = value;
  }
  for (const [key, label] of [
    ["propertyNumber", "رقم العقار الخاص بالوحدة"],
    ["planNumber", "رقم مخطط الوحدة"],
    ["waterNumber", "رقم ماء الوحدة"],
  ] as const) {
    if (!hasOwn(values, key)) continue;
    const value = assertIdentifier(text(values[key]), label);
    if (value === undefined) delete profile[key];
    else Object.assign(profile, { [key]: value });
  }
  if (hasOwn(values, "salePrice")) {
    const salePriceMinor = parseSalePriceMinor(
      values.salePrice,
      "سعر بيع الوحدة المطلوب"
    );
    if (salePriceMinor === undefined) delete profile.salePriceMinor;
    else profile.salePriceMinor = salePriceMinor;
  }
  if (hasOwn(values, "unitArea")) {
    const areaM2 = parseUnitAreaM2(values.unitArea);
    if (areaM2 === undefined) delete profile.areaM2;
    else profile.areaM2 = areaM2;
  }

  return validateUnitProfile(profile);
}

/**
 * Parses a v1 unit profile from its single JSON metadata value. Missing values
 * are intentionally represented as v1 with no optional attributes so legacy
 * units remain unspecified rather than being guessed as a villa or apartment.
 */
export function parseUnitProfile(value: unknown): UnitProfile {
  if (value === undefined || value === null || value === "") return { v: 1 };
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH)
    throw new Error("بيانات وصف الوحدة غير صالحة.");

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("بيانات وصف الوحدة غير صالحة.");
  }
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    decoded.v !== 1 ||
    Object.keys(decoded).some(
      key =>
        !UNIT_PROFILE_KEYS.includes(key as (typeof UNIT_PROFILE_KEYS)[number])
    )
  ) {
    throw new Error("بيانات وصف الوحدة غير صالحة.");
  }

  const profile: UnitProfile = { v: 1 };
  if (decoded.purpose !== undefined) {
    if (!validUnitPurpose(decoded.purpose))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.purpose = decoded.purpose;
  }
  if (decoded.category !== undefined) {
    if (!validUnitCategory(decoded.category))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.category = decoded.category;
  }
  if (decoded.villaArrangement !== undefined) {
    if (!validVillaArrangement(decoded.villaArrangement))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.villaArrangement = decoded.villaArrangement;
  }
  if (decoded.apartmentLayout !== undefined) {
    if (!validApartmentLayout(decoded.apartmentLayout))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.apartmentLayout = decoded.apartmentLayout;
  }
  if (decoded.roomLayout !== undefined) {
    if (!validApartmentLayout(decoded.roomLayout))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.roomLayout = decoded.roomLayout;
  }
  // New universal-layout payloads remain compatible with apartment-only
  // consumers. Legacy apartment payloads that omit roomLayout stay unchanged.
  if (
    profile.category === "apartment" &&
    profile.roomLayout &&
    !profile.apartmentLayout
  ) {
    profile.apartmentLayout = profile.roomLayout;
  }
  if (decoded.furnishing !== undefined) {
    if (!validFurnishing(decoded.furnishing))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.furnishing = decoded.furnishing;
  }
  for (const key of [
    "bedrooms",
    "livingRooms",
    "bathrooms",
    "kitchens",
  ] as const) {
    const value = decoded[key];
    if (value !== undefined) {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 20
      )
        throw new Error("بيانات وصف الوحدة غير صالحة.");
      profile[key] = value;
    }
  }
  if (decoded.contents !== undefined) {
    if (typeof decoded.contents !== "string")
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.contents = decoded.contents;
  }
  for (const key of ["propertyNumber", "planNumber", "waterNumber"] as const) {
    const value = decoded[key];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length > MAX_IDENTIFIER_LENGTH)
        throw new Error("بيانات وصف الوحدة غير صالحة.");
      profile[key] = value;
    }
  }
  if (decoded.salePriceMinor !== undefined) {
    if (
      typeof decoded.salePriceMinor !== "number" ||
      !Number.isSafeInteger(decoded.salePriceMinor) ||
      decoded.salePriceMinor <= 0
    ) {
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    }
    profile.salePriceMinor = decoded.salePriceMinor;
  }
  if (decoded.areaM2 !== undefined) {
    if (!validAreaM2(decoded.areaM2))
      throw new Error("بيانات وصف الوحدة غير صالحة.");
    profile.areaM2 = decoded.areaM2;
  }

  try {
    return validateUnitProfile(profile);
  } catch {
    throw new Error("بيانات وصف الوحدة غير صالحة.");
  }
}

/** Serializes a validated compact unit profile and enforces its metadata cap. */
export function serializeUnitProfile(value: UnitProfile): string {
  const profile = validateUnitProfile(value);
  const serialized = JSON.stringify(profile);
  if (serialized.length > MAX_TEXT_LENGTH)
    throw new Error("وصف الوحدة يتجاوز 1024 حرفًا.");
  return serialized;
}

export function propertyPurposeLabel(value: unknown): string {
  const purpose = value as PropertyPurpose;
  if (purpose === "rent") return "إيجار";
  if (purpose === "sale") return "بيع";
  if (purpose === "mixed") return "بيع وإيجار";
  return "غير مسجل";
}

export function mortgageStatusLabel(value: unknown): string {
  const status = value as PropertyMortgageStatus;
  if (status === "free") return "حر";
  if (status === "mortgaged") return "مرهون";
  return "غير مسجل";
}

export function unitProfileFromEntity(unit: DemoEntity): UnitProfile {
  return parseUnitProfile(unit.meta.unitProfile);
}

/**
 * Resolves a unit's descriptive purpose without guessing from prices. An
 * explicit valid unit value wins; only a single-purpose parent may be inherited.
 */
export function resolveUnitPurpose(
  unit: DemoEntity | undefined,
  property: DemoEntity
): UnitPurpose | undefined {
  const explicit = unit ? unitProfileFromEntity(unit).purpose : undefined;
  if (explicit) return explicit;
  const parentPurpose = parsePropertyProfile(
    property.meta.propertyProfile
  ).purpose;
  return parentPurpose === "rent" || parentPurpose === "sale"
    ? parentPurpose
    : undefined;
}

function countLabel(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : `${value} ${plural}`;
}

/** A concise display-only summary; it never infers a missing legacy profile. */
export function unitProfileSummary(unit: DemoEntity): string {
  const profile = unitProfileFromEntity(unit);
  const summary: string[] = [];
  const selectedRoomLayout = profile.roomLayout ?? profile.apartmentLayout;
  if (profile.category === "villa") {
    summary.push(
      profile.villaArrangement === "attached" ? "فيلا متلاصقة" : "فيلا منفصلة"
    );
  } else if (profile.category === "apartment") {
    if (selectedRoomLayout === "studio") summary.push("شقة استوديو");
    else if (selectedRoomLayout === "custom") summary.push("شقة بتوزيع مخصص");
    else if (selectedRoomLayout) {
      const rooms = Number(selectedRoomLayout.slice(0, 1));
      summary.push(rooms === 1 ? "شقة غرفة وصالة" : `شقة ${rooms} غرف وصالة`);
    } else summary.push("شقة");
  } else if (profile.category === "shop") summary.push("محل");
  else if (profile.category === "office") summary.push("مكتب");
  else if (profile.category === "other") summary.push("وحدة أخرى");

  if (profile.category !== "apartment" && profile.roomLayout)
    summary.push(roomLayoutLabel(profile.roomLayout));

  if (profile.bathrooms !== undefined)
    summary.push(countLabel(profile.bathrooms, "حمام", "حمامات"));
  if (profile.kitchens !== undefined)
    summary.push(countLabel(profile.kitchens, "مطبخ", "مطابخ"));
  if (profile.furnishing === "furnished") summary.push("مفروشة");
  if (profile.furnishing === "unfurnished") summary.push("غير مفروشة");
  if (profile.contents) summary.push(profile.contents);
  return summary.join(" · ") || "غير موصوف";
}

function minorToInput(value: MetaValue | undefined): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    return "";
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return fraction
    ? `${whole}.${String(fraction).padStart(2, "0")}`
    : String(whole);
}

/** Values for the UI form, including only an explicit independent meter. */
export function unitProfileFormValues(
  unit?: DemoEntity
): Record<string, string> {
  const profile = unit ? unitProfileFromEntity(unit) : { v: 1 as const };
  const areaM2 =
    profile.areaM2 ?? (unit ? legacyUnitAreaM2(unit.meta.area) : undefined);
  const source = unit
    ? text(unit.meta.electricityNumberSource).toLowerCase()
    : "";
  const hasIndependentMeter = source !== "property" && source !== "inherited";
  return {
    title: unit?.title ?? "",
    description: unit ? text(unit.meta.description) : "",
    unitCode: unit ? text(unit.meta.unitCode) || text(unit.meta.code) : "",
    // Floor stays display text: basement labels, Arabic digits, and leading
    // zeroes are meaningful input and must not be coerced to a number.
    floor: unit ? text(unit.meta.floor) : "",
    electricityNumber:
      unit && hasIndependentMeter ? text(unit.meta.electricityNumber) : "",
    monthlyRent: unit ? minorToInput(unit.meta.monthlyRentMinor) : "",
    salePrice: minorToInput(profile.salePriceMinor),
    unitPurpose: profile.purpose ?? "",
    category: profile.category ?? "",
    villaArrangement: profile.villaArrangement ?? "",
    roomLayout: profile.roomLayout ?? profile.apartmentLayout ?? "",
    apartmentLayout: profile.apartmentLayout ?? "",
    bedrooms: profile.bedrooms === undefined ? "" : String(profile.bedrooms),
    livingRooms:
      profile.livingRooms === undefined ? "" : String(profile.livingRooms),
    bathrooms: profile.bathrooms === undefined ? "" : String(profile.bathrooms),
    kitchens: profile.kitchens === undefined ? "" : String(profile.kitchens),
    furnishing: profile.furnishing ?? "",
    contents: profile.contents ?? "",
    propertyNumber: profile.propertyNumber ?? "",
    planNumber: profile.planNumber ?? "",
    waterNumber: profile.waterNumber ?? "",
    unitArea: areaM2 === undefined ? "" : String(areaM2),
    ...getTenancyFormValues(unit),
  };
}

/** Builds a validated v1 profile from direct UI form fields. */
export function makeUnitProfile(values: UnitProfileInput): UnitProfile {
  return applyProfileFields({ v: 1 }, values);
}

function unitDescription(value: unknown): string {
  const description = text(value);
  if (description.length > MAX_TEXT_LENGTH)
    throw new Error(`وصف الوحدة يتجاوز ${MAX_TEXT_LENGTH} حرفًا.`);
  return description;
}

function assertOperator(state: PrototypeState): void {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function propertyForUnit(
  entities: EntityMap,
  propertyId: string
): { property: DemoEntity; portfolio: DemoEntity } {
  const property = entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار المرتبط بالوحدة غير موجود.");
  if (!property.portfolioId)
    throw new Error("العقار لا يتبع محفظة صالحة؛ لم يُحفظ أي تعديل.");
  const portfolio = entities.portfolios.find(
    row => row.id === property.portfolioId
  );
  if (!portfolio)
    throw new Error("العقار لا يتبع محفظة صالحة؛ لم يُحفظ أي تعديل.");
  return { property, portfolio };
}

function assertPortfolioScope(
  state: PrototypeState,
  property: DemoEntity
): void {
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== property.portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة؛ لم يُحفظ أي تعديل.");
  }
}

function entityCount(state: PrototypeState): number {
  return Object.values(state.entities).reduce(
    (total, rows) => total + rows.length,
    0
  );
}

function assertUnitCapacity(state: PrototypeState): void {
  if (
    state.entities.units.length >= MAX_UNITS_PER_KIND ||
    entityCount(state) >= MAX_ENTITIES_TOTAL
  ) {
    throw new Error("إنشاء الوحدة يتجاوز سعة سجلات نسخة التجربة.");
  }
}

function assertMetaCapacity(meta: Record<string, MetaValue>): void {
  if (Object.keys(meta).length > MAX_META_ENTRIES)
    throw new Error(
      "الوحدة وصلت إلى سعة 32 حقلًا؛ لا يمكن إضافة وصف جديد دون ترحيل معتمد. بقيت بياناتها السابقة دون تغيير."
    );
}

function assertValidTransition(state: PrototypeState, action: string): void {
  const validation = validatePrototypeState(state);
  if (!validation.success)
    throw new Error(`لم يُعتمد ${action}: ${validation.message}`);
}

function profileFieldWasSubmitted(values: UnitProfileInput): boolean {
  return PROFILE_FORM_KEYS.some(key => hasOwn(values, key));
}

const TENANCY_DECLARATION_FORM_KEYS = [
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const;
function tenancyDeclarationWasSubmitted(values: UnitProfileInput): boolean {
  return TENANCY_DECLARATION_FORM_KEYS.some(key => hasOwn(values, key));
}

function tenancyDeclarationChanged(
  current: DemoEntity,
  declaration: string | undefined
): boolean {
  return current.meta.tenancyDeclaration !== declaration;
}

function assertDeclarationIsNotLockedByLease(
  state: PrototypeState,
  property: DemoEntity,
  unit: DemoEntity
): void {
  const summary = getTenancySummary(
    state.entities,
    property,
    unit,
    scenarioDate(state)
  );
  if (summary.locked) {
    throw new Error(
      "عدّل العقد المسجل لتغيير حالة التأجير؛ لا يمكن تعديلها من الوصف."
    );
  }
}

function profileForUpdate(
  current: DemoEntity,
  values: UnitProfileInput
): UnitProfile {
  if (hasOwn(values, "unitProfile")) {
    const raw = text(values.unitProfile);
    if (!raw) return { v: 1 };
    return parseUnitProfile(raw);
  }
  const existing = unitProfileFromEntity(current);
  return profileFieldWasSubmitted(values)
    ? applyProfileFields(existing, values)
    : existing;
}

function assertRequestId(values: UnitProfileInput): string {
  const requestId = text(values.requestId);
  if (requestId.length > MAX_REQUEST_ID_LENGTH)
    throw new Error("معرف طلب الوحدة غير صالح.");
  return requestId;
}

function fingerprint(
  values: UnitProfileInput,
  propertyId: string,
  operation: string
): string {
  const stable = Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => key !== "requestId")
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return hash(JSON.stringify({ operation, propertyId, values: stable }));
}

function audit(title: string, detail: string): AuditEvent {
  return { id: newId(), at: new Date().toISOString(), title, detail };
}

/**
 * Creates one physical unit in a pure transition intended for
 * PrototypeContext.commitTransition. It never creates a sale, debt, tenancy,
 * or other financial record.
 */
export function createDescribedUnit(
  state: PrototypeState,
  propertyId: string,
  values: UnitProfileInput
): UnitProfileTransition {
  assertOperator(state);
  const { property } = propertyForUnit(state.entities, propertyId);
  assertPortfolioScope(state, property);

  const title = text(values.title);
  if (!title) throw new Error("اسم الوحدة مطلوب.");
  if (title.length > MAX_PROPERTY_TITLE_LENGTH)
    throw new Error(`اسم الوحدة يتجاوز ${MAX_PROPERTY_TITLE_LENGTH} حرفًا.`);

  const requestId = assertRequestId(values);
  const requestFingerprint = fingerprint(
    values,
    propertyId,
    "create-described-unit"
  );
  const previousRequest = requestId
    ? state.entities.units.find(row => row.meta.requestId === requestId)
    : undefined;
  if (previousRequest) {
    if (
      previousRequest.propertyId !== propertyId ||
      (text(previousRequest.meta.requestFingerprint) &&
        previousRequest.meta.requestFingerprint !== requestFingerprint)
    ) {
      throw new Error(
        "سبق إنشاء هذه الوحدة ببيانات مختلفة؛ افتح عملية إضافة جديدة."
      );
    }
    assertValidTransition(state, "إنشاء الوحدة");
    return { state, result: previousRequest };
  }
  assertUnitCapacity(state);

  const isWholePropertyTarget = text(property.meta.rentalMode) === "whole";
  if (isWholePropertyTarget && hasOwn(values, "unitArea")) {
    throw new Error(
      "هدف تأجير العقار بالكامل ليس وحدة مادية ولا يسجل مساحة وحدة."
    );
  }
  const existingTargets = state.entities.units.filter(
    unit => unit.propertyId === property.id
  );
  if (
    (isWholePropertyTarget ||
      existingTargets.some(unit => unit.meta.wholeProperty === true)) &&
    existingTargets.length
  ) {
    throw new Error(
      "العقار المؤجر كاملاً لديه هدف تأجير واحد؛ لا يمكن إضافة وحدة ثانية."
    );
  }

  const requestedCode = text(values.unitCode);
  const unitCode =
    isWholePropertyTarget && !requestedCode
      ? assertUnitIdentifierAvailable(state.entities, property.id, "WHOLE")
      : requestedCode
        ? assertUnitIdentifierAvailable(
            state.entities,
            property.id,
            requestedCode
          )
        : nextUnitIdentifier(state.entities, property.id);
  const electricityNumber = assertIdentifier(
    text(values.electricityNumber),
    "رقم كهرباء الوحدة"
  );
  const floor = hasOwn(values, "floor")
    ? assertIdentifier(text(values.floor), "الدور")
    : undefined;
  if (isWholePropertyTarget && floor) {
    throw new Error(
      "هدف تأجير العقار بالكامل ليس وحدة مادية ولا يسجل دورًا مستقلًا."
    );
  }
  const monthlyRentMinor = hasOwn(values, "monthlyRent")
    ? parseMonthlyRentMinor(values.monthlyRent, "إيجار الوحدة الشهري")
    : undefined;
  const profile = makeUnitProfile(values);
  const tenancyDeclarationSubmitted = tenancyDeclarationWasSubmitted(values);
  const tenancyDeclaration = tenancyDeclarationSubmitted
    ? makeTenancyDeclaration(values)
    : undefined;
  if (
    parsePropertyProfile(property.meta.propertyProfile).purpose === "mixed" &&
    !profile.purpose
  ) {
    throw new Error("حدّد هدف الوحدة للبيع أو الإيجار قبل الحفظ.");
  }
  const description = hasOwn(values, "description")
    ? unitDescription(values.description)
    : "";
  const meta: Record<string, MetaValue> = {
    code: unitCode,
    unitCode,
    electricityNumberSource: electricityNumber ? "unit" : "property",
    unitProfile: serializeUnitProfile(profile),
    ...(isWholePropertyTarget ? { wholeProperty: true } : {}),
    ...(electricityNumber ? { electricityNumber } : {}),
    ...(floor ? { floor } : {}),
    ...(monthlyRentMinor === undefined ? {} : { monthlyRentMinor }),
    ...(description ? { description } : {}),
    ...(tenancyDeclaration ? { tenancyDeclaration } : {}),
    ...(requestId ? { requestId, requestFingerprint } : {}),
  };
  assertMetaCapacity(meta);

  const result: DemoEntity = {
    id: newId(),
    title,
    subtitle: "وحدة مرتبطة بالعقار",
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "متاحة",
    date: state.settings.scenarioDate ?? PROTOTYPE_DATE,
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      units: [...state.entities.units, result],
    },
    audit: [
      audit(
        `إضافة وحدة: ${result.title}`,
        "حُفظ وصف الوحدة محليًا؛ لا تتغير العقود أو الذمم أو النقد أو الإشغال."
      ),
      ...state.audit,
    ].slice(0, AUDIT_LIMIT),
  };
  assertValidTransition(nextState, "إنشاء الوحدة");
  return { state: nextState, result };
}

/**
 * Updates only submitted unit description fields in a pure transition. A blank
 * optional meter intentionally restores property inheritance; an omitted rent
 * or meter remains untouched.
 */
export function updateDescribedUnit(
  state: PrototypeState,
  unitId: string,
  values: UnitProfileInput
): UnitProfileTransition {
  assertOperator(state);
  const unitIndex = state.entities.units.findIndex(row => row.id === unitId);
  if (unitIndex < 0) throw new Error("الوحدة المطلوبة غير موجودة.");
  const current = state.entities.units[unitIndex];
  if (!current.propertyId)
    throw new Error("الوحدة لا تحمل ربطًا بعقار؛ لم يُحفظ أي تعديل.");
  const { property } = propertyForUnit(state.entities, current.propertyId);
  if (current.portfolioId !== property.portfolioId)
    throw new Error(
      "الوحدة والعقار لا يتبعان المحفظة نفسها؛ لم يُحفظ أي تعديل."
    );
  assertPortfolioScope(state, property);
  // This is an optimistic UI conflict check only; role and portfolio checks
  // above remain required and authoritative.
  assertExpectedEntityToken(current, values._expectedEntityToken);

  if (current.meta.wholeProperty === true && hasOwn(values, "unitArea")) {
    throw new Error(
      "هدف تأجير العقار بالكامل ليس وحدة مادية ولا يسجل مساحة وحدة."
    );
  }
  if (current.meta.wholeProperty === true && text(values.roomLayout)) {
    throw new Error(
      "توزيع غرف العقار المؤجر بالكامل يُعدّل من بيانات العقار، وليس من هدف التأجير الداخلي."
    );
  }

  const requestId = assertRequestId(values);
  const requestFingerprint = fingerprint(
    values,
    property.id,
    "update-described-unit"
  );
  if (requestId && current.meta.unitProfileUpdateRequestId === requestId) {
    if (
      text(current.meta.unitProfileUpdateRequestFingerprint) &&
      current.meta.unitProfileUpdateRequestFingerprint !== requestFingerprint
    ) {
      throw new Error(
        "سبق تحديث هذه الوحدة ببيانات مختلفة؛ افتح عملية تعديل جديدة."
      );
    }
    assertValidTransition(state, "تعديل الوحدة");
    return { state, result: current };
  }

  const meta: Record<string, MetaValue> = { ...current.meta };
  const title = hasOwn(values, "title") ? text(values.title) : current.title;
  if (!title) throw new Error("اسم الوحدة مطلوب.");
  if (title.length > MAX_PROPERTY_TITLE_LENGTH)
    throw new Error(`اسم الوحدة يتجاوز ${MAX_PROPERTY_TITLE_LENGTH} حرفًا.`);

  if (hasOwn(values, "unitCode")) {
    const requestedCode = text(values.unitCode);
    if (!requestedCode) throw new Error("رقم/رمز الوحدة مطلوب.");
    const code = assertUnitIdentifierAvailable(
      state.entities,
      property.id,
      requestedCode,
      current.id
    );
    meta.code = code;
    meta.unitCode = code;
  }

  if (hasOwn(values, "floor")) {
    const floor = assertIdentifier(text(values.floor), "الدور");
    if (current.meta.wholeProperty === true && floor) {
      throw new Error(
        "هدف تأجير العقار بالكامل ليس وحدة مادية ولا يسجل دورًا مستقلًا."
      );
    }
    if (floor) meta.floor = floor;
    else delete meta.floor;
  }

  const profileChanged =
    hasOwn(values, "unitProfile") || profileFieldWasSubmitted(values);
  if (profileChanged) {
    const profile = profileForUpdate(current, values);
    if (
      current.meta.wholeProperty === true &&
      (profile.roomLayout || profile.apartmentLayout)
    ) {
      throw new Error(
        "توزيع غرف العقار المؤجر بالكامل يُعدّل من بيانات العقار، وليس من هدف التأجير الداخلي."
      );
    }
    if (hasProfileDetails(profile))
      meta.unitProfile = serializeUnitProfile(profile);
    else delete meta.unitProfile;

    // A recognized legacy numeric area is only removed after an intentional
    // clear. New profile data wins when present, while unrelated historical
    // metadata remains intact.
    if (
      hasOwn(values, "unitArea") &&
      !text(values.unitArea) &&
      legacyUnitAreaM2(meta.area) !== undefined
    ) {
      delete meta.area;
    }
  }

  if (hasOwn(values, "electricityNumber")) {
    const electricityNumber = assertIdentifier(
      text(values.electricityNumber),
      "رقم كهرباء الوحدة"
    );
    if (electricityNumber) {
      meta.electricityNumber = electricityNumber;
      meta.electricityNumberSource = "unit";
    } else {
      delete meta.electricityNumber;
      // An intentional clear always returns to dynamic property inheritance.
      meta.electricityNumberSource = "property";
    }
  }

  if (hasOwn(values, "monthlyRent")) {
    const monthlyRentMinor = parseMonthlyRentMinor(
      values.monthlyRent,
      "إيجار الوحدة الشهري"
    );
    if (monthlyRentMinor === undefined) delete meta.monthlyRentMinor;
    else meta.monthlyRentMinor = monthlyRentMinor;
  }

  if (hasOwn(values, "description")) {
    const description = unitDescription(values.description);
    if (description) meta.description = description;
    else delete meta.description;
  }

  if (tenancyDeclarationWasSubmitted(values)) {
    const tenancyDeclaration = makeTenancyDeclaration(
      values,
      current.meta.tenancyDeclaration
    );
    if (tenancyDeclarationChanged(current, tenancyDeclaration)) {
      assertDeclarationIsNotLockedByLease(state, property, current);
      if (tenancyDeclaration) meta.tenancyDeclaration = tenancyDeclaration;
      else delete meta.tenancyDeclaration;
    }
  }

  if (requestId) {
    meta.unitProfileUpdateRequestId = requestId;
    meta.unitProfileUpdateRequestFingerprint = requestFingerprint;
  }
  assertMetaCapacity(meta);

  const result: DemoEntity = {
    ...current,
    title,
    // Neither status nor amountMinor is taken from descriptive-form values.
    meta,
  };
  const units = [...state.entities.units];
  units[unitIndex] = result;
  const nextState: PrototypeState = {
    ...state,
    entities: { ...state.entities, units },
    audit: [
      audit(
        `تعديل وحدة: ${result.title}`,
        "حُفظ وصف الوحدة محليًا؛ لا تتغير العقود أو الذمم أو النقد أو الإشغال."
      ),
      ...state.audit,
    ].slice(0, AUDIT_LIMIT),
  };
  assertValidTransition(nextState, "تعديل الوحدة");
  return { state: nextState, result };
}
