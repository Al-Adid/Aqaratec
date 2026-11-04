import type {
  AuditEvent,
  DemoEntity,
  EntityMap,
  MetaValue,
  PrototypeState,
} from "@shared/prototype";
import type {
  CreateRentalPropertyResult,
  RentalMode,
} from "@shared/lease-template-types";
import type { UnitProfile } from "@shared/unit-profile-types";
import { PROTOTYPE_DATE } from "@shared/prototype";
import {
  assetTypeFromMeta,
  MAX_PROPERTY_TITLE_LENGTH,
  makePropertyDraft,
  parseMonthlyRentMinor,
  parsePropertyProfile,
  rentalModeFromMeta,
  serializePropertyProfile,
  type PropertyDraft,
  type PropertyUsageType,
} from "./property-fields";
import { parseUnitProfile } from "./unit-profile";
import { scenarioDate } from "@shared/prototype-clock";
import { validatePrototypeState } from "@shared/prototype-validation";
import { getTenancySummary } from "./tenancy-information";
import {
  filterPropertyProfileForType,
  getPropertyFieldPolicy,
} from "./property-applicability";
import { assertExpectedEntityToken } from "./prototype-edit-concurrency";

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ENTITIES_PER_KIND = 500;
const MAX_ENTITIES_TOTAL = 2000;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_META_ENTRIES = 32;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `rental-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hash(value: string): string {
  // A compact fingerprint is enough to protect accidental retried clicks while
  // keeping prototype metadata safely below its storage limit.
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function requestFingerprint(draft: PropertyDraft): string {
  const meta = Object.fromEntries(
    Object.entries(draft.meta).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  return hash(
    JSON.stringify({
      title: draft.title,
      portfolioId: draft.portfolioId,
      assetType: draft.assetType,
      usageType: draft.usageType,
      unitCount: draft.unitCount,
      location: draft.location,
      rentalMode: draft.rentalMode ?? "",
      propertyNumber: draft.propertyNumber ?? "",
      electricityNumber: draft.electricityNumber ?? "",
      meta,
    })
  );
}

function batchRowRequestId(requestId: string, index: number): string {
  // Keep the derived key safely below the per-operation request ID limit even
  // if a caller supplied the longest valid batch request ID.
  return `rental-import-${hash(requestId)}-${index + 1}`;
}

function entityTotal(state: PrototypeState): number {
  return Object.values(state.entities).reduce(
    (total, rows) => total + rows.length,
    0
  );
}

function snapshotBytes(state: PrototypeState): number {
  const serialized = JSON.stringify(state);
  if (typeof TextEncoder !== "undefined")
    return new TextEncoder().encode(serialized).byteLength;
  return unescape(encodeURIComponent(serialized)).length;
}

function assertValidTransition(state: PrototypeState, action: string): void {
  const validation = validatePrototypeState(state);
  if (!validation.success)
    throw new Error(`لم يُعتمد ${action}: ${validation.message}`);
}

function assertBatchCapacity(
  state: PrototypeState,
  propertyCount: number,
  unitCount: number
): void {
  if (
    state.entities.properties.length + propertyCount > MAX_ENTITIES_PER_KIND ||
    state.entities.units.length + unitCount > MAX_ENTITIES_PER_KIND ||
    entityTotal(state) + propertyCount + unitCount > MAX_ENTITIES_TOTAL
  ) {
    throw new Error("الاستيراد يتجاوز سعة سجلات نسخة التجربة");
  }
}

function entity(title: string, overrides: Partial<DemoEntity>): DemoEntity {
  return {
    id: newId(),
    title,
    subtitle: "",
    portfolioId: "",
    propertyId: "",
    status: "جديد",
    date: PROTOTYPE_DATE,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function inheritedUnitMeta(
  draft: PropertyDraft,
  unitCode: string,
  extra: Record<string, MetaValue> = {}
): Record<string, MetaValue> {
  const meta: Record<string, MetaValue> = {
    code: unitCode,
    unitCode,
    source: draft.inputMethod ?? "",
    inputMethod: draft.inputMethod ?? "",
    // This is a reference, not a copied meter value. A later property
    // correction is therefore visible to a newly generated rental draft.
    electricityNumberSource: "property",
    // A split property's unitMonthlyRentMinor is likewise never copied here:
    // no per-unit override means the target keeps inheriting a later default.
    ...extra,
  };
  return meta;
}

/** Never truncate the parent property's saved title to manufacture unit names. */
export function generatedUnitTitle(
  number: number,
  propertyTitle: string
): string {
  const expanded = `وحدة ${number} · ${propertyTitle}`;
  return expanded.length <= MAX_PROPERTY_TITLE_LENGTH
    ? expanded
    : `وحدة ${number}`;
}

function unitsFor(
  property: DemoEntity,
  draft: PropertyDraft,
  asOf: string
): DemoEntity[] {
  const common = {
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "متاحة",
    date: asOf,
    amountMinor: 0,
    currency: "QAR" as const,
  };

  if (draft.rentalMode === "whole") {
    return [
      entity("العقار بالكامل", {
        ...common,
        subtitle: "هدف تأجير داخلي للعقار بالكامل، وليس وحدة مادية إضافية",
        meta: inheritedUnitMeta(draft, "WHOLE", { wholeProperty: true }),
      }),
    ];
  }

  return Array.from({ length: draft.unitCount }, (_, index) => {
    const number = index + 1;
    const unitCode = `U-${String(number).padStart(2, "0")}`;
    return entity(generatedUnitTitle(number, property.title), {
      ...common,
      subtitle: "وحدة مرتبطة بالعقار",
      meta: inheritedUnitMeta(draft, unitCode),
    });
  });
}

function creationAudit(property: DemoEntity, mode?: RentalMode): AuditEvent {
  return {
    id: newId(),
    // The audit event is a real operation timestamp. Domain dates use the
    // separately declared scenario clock.
    at: new Date().toISOString(),
    title:
      property.title.length + 12 <= 256
        ? `إضافة عقار: ${property.title}`
        : "إضافة عقار",
    detail:
      mode === "whole"
        ? "أُنشئ هدف تأجير واحد للعقار بالكامل داخل البروتوتايب"
        : mode === "units"
          ? "أُنشئت وحدات تأجير مرقمة داخل البروتوتايب"
          : "أُنشئ سجل عقار محلي داخل البروتوتايب",
  };
}

function propertyElectricityNumber(property: DemoEntity | undefined): string {
  return property ? text(property.meta.electricityNumber) : "";
}

function propertyNumber(property: DemoEntity | undefined): string {
  return property ? text(property.meta.propertyNumber) : "";
}

interface StructuralReferences {
  units: DemoEntity[];
  leases: DemoEntity[];
  other: DemoEntity[];
}

/** Reads linked rows only; it never repairs, moves, relinks, or deletes them. */
function structuralReferences(
  state: PrototypeState,
  property: DemoEntity
): StructuralReferences {
  const units = state.entities.units.filter(
    unit => unit.propertyId === property.id
  );
  const unitIds = new Set(units.map(unit => unit.id));
  const refersToPropertyOrUnit = (row: DemoEntity) =>
    row.propertyId === property.id ||
    text(row.meta.propertyId) === property.id ||
    unitIds.has(text(row.meta.unitId));
  const leases = state.entities.leases.filter(refersToPropertyOrUnit);
  const other = Object.entries(state.entities).flatMap(([kind, rows]) =>
    kind === "properties" || kind === "units" || kind === "leases"
      ? []
      : rows.filter(refersToPropertyOrUnit)
  );
  return { units, leases, other };
}

function unitDescriptionConflictsWithAsset(
  profile: UnitProfile,
  assetType: NonNullable<ReturnType<typeof assetTypeFromMeta>>
): boolean {
  const hasResidentialLayout =
    profile.roomLayout !== undefined ||
    profile.apartmentLayout !== undefined ||
    profile.bedrooms !== undefined ||
    profile.livingRooms !== undefined;
  const hasBuiltDescription =
    profile.category !== undefined ||
    profile.villaArrangement !== undefined ||
    hasResidentialLayout ||
    profile.bathrooms !== undefined ||
    profile.kitchens !== undefined ||
    profile.furnishing !== undefined ||
    profile.areaM2 !== undefined;
  if (assetType === "land") return hasBuiltDescription;
  if (assetType === "shop") {
    return (
      (profile.category !== undefined &&
        profile.category !== "shop" &&
        profile.category !== "other") ||
      profile.villaArrangement !== undefined ||
      hasResidentialLayout
    );
  }
  if (assetType === "office") {
    return (
      (profile.category !== undefined &&
        profile.category !== "office" &&
        profile.category !== "other") ||
      profile.villaArrangement !== undefined ||
      hasResidentialLayout
    );
  }
  if (assetType === "villa") {
    return (
      profile.category === "apartment" ||
      profile.category === "shop" ||
      profile.category === "office"
    );
  }
  if (assetType === "apartment") {
    return (
      profile.category === "villa" ||
      profile.category === "shop" ||
      profile.category === "office" ||
      profile.villaArrangement !== undefined
    );
  }
  if (assetType === "villa_complex") {
    return profile.category === "shop" || profile.category === "office";
  }
  // Building and mixed-use parents can retain explicitly categorized targets.
  return false;
}

function hasIncompatibleUnitDescriptions(
  units: readonly DemoEntity[],
  assetType: NonNullable<ReturnType<typeof assetTypeFromMeta>>
): boolean {
  return units.some(unit => {
    try {
      return unitDescriptionConflictsWithAsset(
        parseUnitProfile(unit.meta.unitProfile),
        assetType
      );
    } catch {
      // A malformed description cannot be safely reclassified.
      return true;
    }
  });
}

function applyPropertyApplicability(
  meta: Record<string, MetaValue>
): Record<string, MetaValue> {
  const assetType = assetTypeFromMeta(meta);
  const usageType =
    typeof meta.usageType === "string" ? meta.usageType : undefined;
  const rentalMode = rentalModeFromMeta(meta);
  const policy = getPropertyFieldPolicy(
    assetType,
    usageType as PropertyUsageType | undefined,
    rentalMode
  );
  if (!policy.supportsBuildingYear) {
    delete meta.buildingYear;
    delete meta.year;
  }
  if (!policy.supportsBuildingArea) delete meta.buildingArea;
  if (typeof meta.propertyProfile === "string") {
    const profile = filterPropertyProfileForType(
      parsePropertyProfile(meta.propertyProfile),
      assetType,
      usageType as PropertyUsageType | undefined,
      rentalMode
    );
    meta.propertyProfile = serializePropertyProfile(profile);
  }
  return meta;
}

/**
 * Resolves the meter for a new rental/template target without modifying a
 * historical issued document. New units declare their source explicitly.
 *
 * Legacy whole-property targets are internal rather than physical units, so
 * they follow the property meter. A legacy physical unit with a stored meter
 * keeps it unless it explicitly declares property inheritance; that avoids
 * guessing that an independent meter should be overwritten.
 */
export function electricityNumberForRentalTarget(
  entities: EntityMap,
  propertyId: string,
  unitId?: string
): string {
  const property = entities.properties.find(row => row.id === propertyId);
  const propertyNumber = propertyElectricityNumber(property);
  if (!property || !unitId) return propertyNumber;

  const unit = entities.units.find(
    row => row.id === unitId && row.propertyId === propertyId
  );
  if (!unit) return propertyNumber;

  const source = text(unit.meta.electricityNumberSource).toLowerCase();
  if (source === "property" || source === "inherited") return propertyNumber;
  if (source === "unit" || source === "independent") {
    return text(unit.meta.electricityNumber);
  }
  if (unit.meta.wholeProperty === true) return propertyNumber;

  // Historical physical units have no source metadata. Preserve a saved unit
  // meter rather than reclassifying it as inherited; only a blank unit falls
  // back to the current property value.
  return text(unit.meta.electricityNumber) || propertyNumber;
}

/**
 * Resolves a property number for a new rental/template target without changing
 * issued snapshots. A validated unit-profile override wins only when that unit
 * belongs to the supplied parent property; otherwise the current parent value
 * applies and its leading zeros remain untouched.
 */
export function propertyNumberForRentalTarget(
  entities: EntityMap,
  propertyId: string,
  unitId?: string
): string {
  const property = entities.properties.find(row => row.id === propertyId);
  const inherited = propertyNumber(property);
  if (!property || !unitId) return inherited;

  const unit = entities.units.find(
    row => row.id === unitId && row.propertyId === propertyId
  );
  if (!unit) return inherited;

  return parseUnitProfile(unit.meta.unitProfile).propertyNumber || inherited;
}

/**
 * Creates a property and every initial lease target in one in-memory transition.
 * It intentionally never infers a rental mode for historical/import rows that do
 * not explicitly provide one.
 */
export function createRentalProperty(
  state: PrototypeState,
  values: Record<string, string>
): CreateRentalPropertyResult {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");

  const asOf = scenarioDate(state);
  const draft = makePropertyDraft(values, {
    requireInputMethod: true,
    referenceDate: asOf,
  });
  if (
    !state.entities.portfolios.some(
      portfolio => portfolio.id === draft.portfolioId
    )
  ) {
    throw new Error("المحفظة المختارة غير موجودة. اختر محفظة قائمة قبل الحفظ.");
  }
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== draft.portfolioId
  ) {
    throw new Error("المحفظة المختارة خارج نطاق العرض الحالي.");
  }

  const requestId = text(values.requestId);
  if (requestId.length > MAX_REQUEST_ID_LENGTH)
    throw new Error("معرف إنشاء العقار غير صالح");
  const fingerprint = requestFingerprint(draft);
  const previousRequest = requestId
    ? state.entities.properties.find(row => row.meta.requestId === requestId)
    : undefined;
  if (previousRequest) {
    if (
      text(previousRequest.meta.requestFingerprint) &&
      previousRequest.meta.requestFingerprint !== fingerprint
    ) {
      throw new Error(
        "سبق إنشاء هذا العقار ببيانات مختلفة؛ افتح عملية إضافة جديدة"
      );
    }
    assertValidTransition(state, "إنشاء العقار");
    return { state, property: previousRequest };
  }

  const propertyMeta: Record<string, MetaValue> = { ...draft.meta };
  if (requestId) {
    propertyMeta.requestId = requestId;
    propertyMeta.requestFingerprint = fingerprint;
  }
  const property = entity(draft.title, {
    subtitle: draft.location || "عنوان غير مسجل",
    portfolioId: draft.portfolioId,
    status: "نشط",
    date: asOf,
    meta: propertyMeta,
  });
  // Property IDs are self-references in the shared prototype model.
  property.propertyId = property.id;
  const units = unitsFor(property, draft, asOf);
  const audit = creationAudit(property, draft.rentalMode);
  assertBatchCapacity(state, 1, units.length);
  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      properties: [...state.entities.properties, property],
      units: [...state.entities.units, ...units],
    },
    audit: [audit, ...state.audit].slice(0, 300),
  };
  if (snapshotBytes(nextState) > MAX_SNAPSHOT_BYTES)
    throw new Error("إنشاء العقار يتجاوز حد حجم نسخة التجربة");
  assertValidTransition(nextState, "إنشاء العقار");

  return {
    state: nextState,
    property,
  };
}

export interface UpdateRentalPropertyResult {
  state: PrototypeState;
  result: DemoEntity;
  property: DemoEntity;
}

/**
 * Applies all submitted property fields in one pure state transition. It does
 * not mutate units, leases, or document snapshots: inheriting targets resolve
 * the current property meter through electricityNumberForRentalTarget, while
 * independently metered units remain unchanged.
 */
export function updateRentalProperty(
  state: PrototypeState,
  id: string,
  values: Record<string, string>
): UpdateRentalPropertyResult {
  if (state.settings.role !== "operator") {
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  }
  const propertyIndex = state.entities.properties.findIndex(
    row => row.id === id
  );
  if (propertyIndex < 0) throw new Error("العقار المطلوب غير موجود.");

  const current = state.entities.properties[propertyIndex];
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== current.portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة؛ لم يُحفظ أي تعديل.");
  }
  // This is an optimistic UI safeguard only; role and portfolio guards above
  // remain the authority for every transition.
  assertExpectedEntityToken(current, values._expectedEntityToken);
  const draft = makePropertyDraft(values, {
    referenceDate: scenarioDate(state),
  });
  if (draft.portfolioId !== current.portfolioId) {
    throw new Error("لا يمكن نقل العقار إلى محفظة أخرى من شاشة التعديل.");
  }

  let changedMetaKeys: Set<string> | null = null;
  let changedFields: Set<string> | null = null;
  if (values._changedFields !== undefined) {
    let changed: unknown;
    try {
      changed = JSON.parse(values._changedFields);
    } catch {
      throw new Error("قائمة حقول التعديل غير صالحة.");
    }
    if (
      !Array.isArray(changed) ||
      changed.length > 32 ||
      changed.some(k => typeof k !== "string")
    )
      throw new Error("قائمة حقول التعديل غير صالحة.");
    changedFields = new Set(changed);
    const aliases: Record<string, string[]> = {
      assetType: ["assetType", "type"],
      buildingYear: ["buildingYear", "year"],
      collectionAccount: ["collectionAccount", "account"],
      inputMethod: ["inputMethod", "source"],
      planNumber: ["planNumber", "planRef"],
      monthlyRent: ["monthlyRentMinor", "unitMonthlyRentMinor"],
      tenancyStatus: ["tenancyDeclaration"],
      tenancyStartDate: ["tenancyDeclaration"],
      tenancyEndDate: ["tenancyDeclaration"],
    };
    changedMetaKeys = new Set(
      changed.flatMap((key: string) => aliases[key] ?? [key])
    );
  }
  const references = structuralReferences(state, current);
  const currentAssetType = assetTypeFromMeta(current.meta);
  const currentRentalMode = rentalModeFromMeta(current.meta);
  const actualConfiguredTargetCount =
    currentRentalMode === "whole"
      ? references.units.filter(unit => unit.meta.wholeProperty === true).length
      : references.units.length;
  const typeWasChanged = changedFields
    ? changedFields.has("assetType") && draft.assetType !== currentAssetType
    : draft.assetType !== currentAssetType;
  const modeWasChanged = changedFields
    ? changedFields.has("rentalMode") &&
      draft.rentalMode !== undefined &&
      draft.rentalMode !== currentRentalMode
    : draft.rentalMode !== undefined && draft.rentalMode !== currentRentalMode;
  const countWasChanged = changedFields
    ? changedFields.has("unitCount")
    : Object.prototype.hasOwnProperty.call(values, "unitCount") &&
      draft.unitCount !== actualConfiguredTargetCount;

  if (
    modeWasChanged &&
    (references.units.length ||
      references.leases.length ||
      references.other.length)
  ) {
    throw new Error(
      "لا يمكن تغيير طريقة التأجير لأن للعقار أهدافًا أو عقودًا أو مراجع مرتبطة؛ لا تُحذف أو تُنقل الروابط تلقائيًا."
    );
  }
  if (countWasChanged && draft.unitCount !== actualConfiguredTargetCount) {
    throw new Error(
      "لا يمكن تغيير عدد الوحدات إلى قيمة لا تطابق الوحدات المرتبطة فعليًا؛ لا تُنشأ أو تُحذف وحدات تلقائيًا."
    );
  }
  if (typeWasChanged) {
    if (references.leases.length) {
      throw new Error(
        "لا يمكن تغيير نوع العقار مع وجود عقود مرتبطة؛ عدّل أو أغلق الروابط المعتمدة أولاً دون إعادة ربط تلقائية."
      );
    }
    if (
      references.units.length &&
      hasIncompatibleUnitDescriptions(references.units, draft.assetType)
    ) {
      throw new Error(
        "لا يمكن تغيير نوع العقار لأن أوصاف الوحدات المرتبطة لا تنطبق على النوع الجديد؛ لم تتغير أي وحدة أو رابط."
      );
    }
  }
  const tenancyDeclarationSubmitted =
    Object.prototype.hasOwnProperty.call(draft.meta, "tenancyDeclaration") ||
    draft.clearMetaKeys.includes("tenancyDeclaration");
  const tenancyDeclarationWillApply =
    tenancyDeclarationSubmitted &&
    (!changedMetaKeys || changedMetaKeys.has("tenancyDeclaration"));
  const nextTenancyDeclaration = Object.prototype.hasOwnProperty.call(
    draft.meta,
    "tenancyDeclaration"
  )
    ? String(draft.meta.tenancyDeclaration)
    : undefined;
  if (
    tenancyDeclarationWillApply &&
    current.meta.tenancyDeclaration !== nextTenancyDeclaration
  ) {
    const tenancy = getTenancySummary(
      state.entities,
      current,
      undefined,
      scenarioDate(state)
    );
    if (tenancy.locked) {
      throw new Error(
        "عدّل العقد المسجل لتغيير حالة التأجير؛ لا يمكن تعديلها من الوصف."
      );
    }
  }
  let activePropertyProfile = Object.prototype.hasOwnProperty.call(
    draft.meta,
    "propertyProfile"
  )
    ? parsePropertyProfile(draft.meta.propertyProfile)
    : parsePropertyProfile(current.meta.propertyProfile);
  const priorPropertyProfile = parsePropertyProfile(
    current.meta.propertyProfile
  );
  // A rent/unspecified form has no active sale-price field. Preserve the newest
  // stored opposite price rather than interpreting its omission as a clear.
  // Sale/mixed forms still permit an explicit blank to remove the asking price.
  if (
    Object.prototype.hasOwnProperty.call(draft.meta, "propertyProfile") &&
    activePropertyProfile.purpose !== "sale" &&
    activePropertyProfile.purpose !== "mixed" &&
    activePropertyProfile.salePriceMinor === undefined &&
    priorPropertyProfile.salePriceMinor !== undefined
  ) {
    activePropertyProfile = {
      ...activePropertyProfile,
      salePriceMinor: priorPropertyProfile.salePriceMinor,
    };
    draft.meta.propertyProfile = serializePropertyProfile(
      activePropertyProfile
    );
  }
  // A sale goal never reclassifies a submitted/hidden rental field as a clear
  // or as a fresh rent. This also protects old price history when a raw caller
  // submits only monthlyRent after the sale profile was already persisted.
  const ignoreRentalPrice = activePropertyProfile.purpose === "sale";
  const meta: Record<string, MetaValue> = { ...current.meta };
  Object.entries(draft.meta).forEach(([key, val]) => {
    if (
      ignoreRentalPrice &&
      (key === "monthlyRentMinor" || key === "unitMonthlyRentMinor")
    )
      return;
    if (!changedMetaKeys || changedMetaKeys.has(key)) meta[key] = val;
  });
  draft.clearMetaKeys.forEach(key => {
    if (
      ignoreRentalPrice &&
      (key === "monthlyRentMinor" || key === "unitMonthlyRentMinor")
    )
      return;
    if (!changedMetaKeys || changedMetaKeys.has(key)) delete meta[key];
  });
  // A type/mode transition must not leave old parent accommodation, building
  // facts, or composition visible as if they applied to the new scope.
  applyPropertyApplicability(meta);
  // Redundant new compatibility aliases may be omitted at capacity; existing
  // historical/unknown keys are never dropped. Every reader supports the pair.
  for (const [a, b] of [
    ["assetType", "type"],
    ["buildingYear", "year"],
    ["collectionAccount", "account"],
    ["inputMethod", "source"],
    ["planNumber", "planRef"],
  ]) {
    if (Object.keys(meta).length <= 32) break;
    if (!(a in current.meta) && a in meta && b in meta) delete meta[a];
    else if (!(b in current.meta) && a in meta && b in meta) delete meta[b];
  }
  if (Object.keys(meta).length > 32)
    throw new Error(
      "العقار وصل إلى سعة 32 حقلًا؛ لا يمكن إضافة حقل جديد دون ترحيل معتمد. بقيت بياناته السابقة دون تغيير."
    );
  const nextProperty: DemoEntity = {
    ...current,
    title:
      !changedMetaKeys || changedMetaKeys.has("title")
        ? draft.title
        : current.title,
    subtitle:
      Object.prototype.hasOwnProperty.call(values, "location") &&
      (!changedMetaKeys || changedMetaKeys.has("location"))
        ? draft.location || "عنوان غير مسجل"
        : current.subtitle,
    meta,
  };
  const properties = [...state.entities.properties];
  properties[propertyIndex] = nextProperty;
  const audit: AuditEvent = {
    id: newId(),
    at: new Date().toISOString(),
    title:
      nextProperty.title.length + 12 <= 256
        ? `تعديل عقار: ${nextProperty.title}`
        : "تعديل عقار",
    detail:
      "حُفظ التعديل محليًا بانتقال ذري؛ لا تتغير الوحدات المستقلة أو الوثائق والعقود الصادرة.",
  };
  const nextState: PrototypeState = {
    ...state,
    entities: { ...state.entities, properties },
    audit: [audit, ...state.audit].slice(0, 300),
  };
  if (snapshotBytes(nextState) > MAX_SNAPSHOT_BYTES) {
    throw new Error("تعديل العقار يتجاوز حد حجم نسخة التجربة");
  }
  assertValidTransition(nextState, "تعديل العقار");
  return { state: nextState, result: nextProperty, property: nextProperty };
}

export interface PatchUnitMonthlyRentResult {
  state: PrototypeState;
  result: DemoEntity;
  unit: DemoEntity;
}

/**
 * Saves an explicit unit-level monthly-rent override. A blank submitted field
 * removes only that override, so a split property's default remains available
 * to the unit. It intentionally never repurposes amountMinor, lease values,
 * receivables, collections, or any issued document snapshot.
 */
export function patchUnitMonthlyRent(
  state: PrototypeState,
  id: string,
  values: Record<string, string>
): PatchUnitMonthlyRentResult {
  if (state.settings.role !== "operator") {
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  }
  const unitIndex = state.entities.units.findIndex(row => row.id === id);
  if (unitIndex < 0) throw new Error("الوحدة المطلوبة غير موجودة.");

  const current = state.entities.units[unitIndex];
  const property = state.entities.properties.find(
    row => row.id === current.propertyId
  );
  if (!property)
    throw new Error("العقار المرتبط بالوحدة غير موجود؛ لم يُحفظ أي تعديل.");
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== property.portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة؛ لم يُحفظ أي تعديل.");
  }
  assertExpectedEntityToken(current, values._expectedEntityToken);
  if (!Object.prototype.hasOwnProperty.call(values, "monthlyRent")) {
    assertValidTransition(state, "تعديل إيجار الوحدة");
    return { state, result: current, unit: current };
  }
  const monthlyRentMinor = parseMonthlyRentMinor(
    values.monthlyRent,
    "إيجار الوحدة الشهري"
  );
  const meta: Record<string, MetaValue> = { ...current.meta };
  if (monthlyRentMinor === undefined) delete meta.monthlyRentMinor;
  else meta.monthlyRentMinor = monthlyRentMinor;
  if (Object.keys(meta).length > MAX_META_ENTRIES) {
    throw new Error(
      "الوحدة وصلت إلى سعة 32 حقلًا؛ لا يمكن إضافة إيجار جديد دون ترحيل معتمد. بقيت بياناتها السابقة دون تغيير."
    );
  }

  const nextUnit: DemoEntity = {
    ...current,
    // amountMinor remains untouched because older unit amounts have no
    // trustworthy rent meaning in this prototype.
    meta,
  };
  const units = [...state.entities.units];
  units[unitIndex] = nextUnit;
  const audit: AuditEvent = {
    id: newId(),
    at: new Date().toISOString(),
    title:
      nextUnit.title.length + 20 <= 256
        ? `تعديل إيجار وحدة: ${nextUnit.title}`
        : "تعديل إيجار وحدة",
    detail:
      monthlyRentMinor === undefined
        ? "أزيل override الإيجار الشهري للوحدة محليًا؛ يبقى افتراضي العقار كما هو."
        : "حُفظ إيجار شهري خاص للوحدة محليًا؛ لا تتغير العقود أو الذمم أو النقد.",
  };
  const nextState: PrototypeState = {
    ...state,
    entities: { ...state.entities, units },
    audit: [audit, ...state.audit].slice(0, 300),
  };
  if (snapshotBytes(nextState) > MAX_SNAPSHOT_BYTES) {
    throw new Error("تعديل إيجار الوحدة يتجاوز حد حجم نسخة التجربة");
  }
  assertValidTransition(nextState, "تعديل إيجار الوحدة");
  return { state: nextState, result: nextUnit, unit: nextUnit };
}

export interface ImportRentalPropertiesResult {
  state: PrototypeState;
  properties: DemoEntity[];
}

/**
 * Validates a complete spreadsheet selection before making any state visible.
 * Individual creations run only against an in-memory temporary state, so a
 * later row can never leave earlier rows partially committed.
 */
export function importRentalProperties(
  state: PrototypeState,
  rows: Array<Record<string, string>>,
  requestId: string
): ImportRentalPropertiesResult {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("اختر صفًا واحدًا صالحًا على الأقل للاستيراد");
  if (rows.length > 50) throw new Error("حد الاستيراد خمسون صفًا");

  const batchRequestId = text(requestId);
  if (!batchRequestId || batchRequestId.length > MAX_REQUEST_ID_LENGTH)
    throw new Error("معرف عملية الاستيراد غير صالح");

  const drafts: PropertyDraft[] = [];
  const rowErrors: string[] = [];
  const titlesByPortfolio = new Set(
    state.entities.properties.map(
      property =>
        `${property.portfolioId}\u0000${property.title
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleLowerCase("ar")}`
    )
  );

  rows.forEach((row, index) => {
    try {
      const draft = makePropertyDraft(
        { ...row, inputMethod: "Excel" },
        { requireInputMethod: true }
      );
      if (
        !state.entities.portfolios.some(
          portfolio => portfolio.id === draft.portfolioId
        )
      ) {
        throw new Error("المحفظة المختارة غير موجودة");
      }
      const titleKey = `${draft.portfolioId}\u0000${draft.title
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("ar")}`;
      const previousRequest = state.entities.properties.find(
        property =>
          property.meta.requestId === batchRowRequestId(batchRequestId, index)
      );
      if (titlesByPortfolio.has(titleKey) && !previousRequest)
        throw new Error("اسم العقار مكرر في المحفظة");
      titlesByPortfolio.add(titleKey);
      drafts.push(draft);
    } catch (caught) {
      rowErrors.push(
        `الصف ${index + 1}: ${
          caught instanceof Error ? caught.message : "بيانات العقار غير صالحة"
        }`
      );
    }
  });
  if (rowErrors.length) throw new Error(rowErrors.join(" • "));

  const newDrafts = drafts.filter(
    (_, index) =>
      !state.entities.properties.some(
        property =>
          property.meta.requestId === batchRowRequestId(batchRequestId, index)
      )
  );
  assertBatchCapacity(
    state,
    newDrafts.length,
    newDrafts.reduce((total, draft) => total + draft.unitCount, 0)
  );

  let temporary = state;
  const properties: DemoEntity[] = [];
  rows.forEach((row, index) => {
    try {
      const result = createRentalProperty(temporary, {
        ...row,
        inputMethod: "Excel",
        requestId: batchRowRequestId(batchRequestId, index),
      });
      temporary = result.state;
      properties.push(result.property);
    } catch (caught) {
      // This can only occur against the temporary copy (for example, a retry
      // with changed payload), but preserve the spreadsheet row in the error.
      throw new Error(
        `الصف ${index + 1}: ${
          caught instanceof Error ? caught.message : "تعذر إنشاء العقار"
        }`
      );
    }
  });
  if (snapshotBytes(temporary) > MAX_SNAPSHOT_BYTES)
    throw new Error("الاستيراد يتجاوز حد حجم نسخة التجربة");
  assertValidTransition(temporary, "استيراد العقارات");

  return { state: temporary, properties };
}
