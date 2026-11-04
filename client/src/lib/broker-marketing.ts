import {
  ENTITY_KINDS,
  money,
  type DemoEntity,
  type EntityMap,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  MAX_AUDIT_ROWS,
  MAX_ENTITY_ROWS_PER_KIND,
  MAX_ID_LENGTH,
  MAX_META_ENTRIES,
  MAX_META_KEY_LENGTH,
  MAX_SNAPSHOT_BYTES,
  MAX_TEXT_LENGTH,
  MAX_TOTAL_ENTITY_ROWS,
  serializedPrototypeBytes,
} from "@shared/prototype-validation";
import { unitOccupancyAt } from "./prototype-lease-lifecycle";
import {
  assetTypeFromMeta,
  assetTypeLabel,
  parsePropertyProfile,
} from "./property-fields";
import { getTenancySummary } from "./tenancy-information";
import { resolveUnitPurpose } from "./unit-profile";
import { listSaleMarketingInventory } from "./broker-sale-inventory";

/**
 * Local-only broker marketing. This module never sends email, constructs a
 * live recipient list, or changes leases, units, financial rows, or cash. Its
 * pure transitions are committed through PrototypeContext.commitTransition,
 * which supplies the newest state for final availability checks.
 */

const MAX_CAMPAIGN_TITLE = 80;
const MAX_CAMPAIGN_CONTENT = 600;
const MAX_REQUEST_ID = MAX_ID_LENGTH;
const MAX_CONTACT_NAME = 80;
const MAX_CONTACT_PHONE = 320;
const MAX_CONTACT_WEBSITE = 1_024;
const MAX_TARGETS = 10;
const MAX_BROKERS = 20;
const MAX_BATCH_SELECTIONS = 500;
const MAX_TARGETS_JSON = 1_024;
const BROKER_RECORD_TYPE = "broker-contact";
const CAMPAIGN_RECORD_TYPE = "broker-campaign";
const DISPATCH_RECORD_TYPE = "broker-campaign-dispatch";
const EXPIRING_WINDOWS = new Set([30, 60, 90]);
const APPROVED_BOOKING_STAGES = new Set([
  "contract-issued",
  "returns-received",
  "appointment-booked",
  "handover-submitted",
  "approved",
  "approved-reserved",
]);

export type Transition<T> = { state: PrototypeState; result: T };

export type BrokerContactInput = {
  requestId: string;
  companyName: string;
  email: string;
  contactName: string;
  phone?: string;
  website?: string;
  address?: string;
  notes?: string;
  active?: boolean;
};

export type BrokerContactUpdateInput = BrokerContactInput & {
  brokerId: string;
};

export type BrokerTargetOptions = {
  expiringWithinDays?: number;
  includeExpiring?: boolean;
  /** Adds sale opportunities while retaining rental-only behavior by default. */
  includeSale?: boolean;
};

export type BrokerCampaignInput = {
  requestId: string;
  title: string;
  content: string;
  targetIds: string[];
  brokerIds: string[];
  /** QAR minor units, one positive value for every selected rental target. */
  targetRentsMinor: Record<string, number>;
  /** QAR minor units, one positive value for every selected sale target. */
  targetSalePricesMinor?: Record<string, number>;
  /** When present, campaign targets may include active leases ending in this window. */
  expiringWithinDays?: number;
};

export type BrokerTarget = {
  id: string;
  propertyId: string;
  portfolioId: string;
  propertyTitle: string;
  propertyNumber: string;
  unitTitle: string;
  unitCode: string;
  /** Omitted by old callers and records, which retain rental semantics. */
  purpose?: "rent" | "sale";
  suggestedMonthlyRentMinor: number;
  /** Explicit sale asking price; it is never copied into a rent field. */
  suggestedSalePriceMinor?: number;
  /** The explicit metadata/lease source used for the suggested marketing rent. */
  rentSource?: string;
  rentSourceLabel?: string;
  rentSourceDate?: string;
  availability: "vacant" | "expiring" | "sale";
  contractEndDate?: string;
  availableFrom: string;
  daysToExpiry?: number;
  /** Factual tenancy only for sale marketing; it is not an availability claim. */
  tenancyLabel?: string;
  propertyType: string;
  location: string;
  area?: number;
};

export type BrokerCampaignTargetSnapshot = {
  targetId: string;
  monthlyRentMinor: number;
  /** Missing on pre-sale snapshots and therefore interpreted as rent. */
  purpose?: "rent" | "sale";
  salePriceMinor?: number;
};

export type BrokerTargetBrief = {
  targetId: string;
  propertyId: string;
  propertyTitle: string;
  propertyNumber: string;
  unitTitle: string;
  unitCode: string;
  propertyType: string;
  location: string;
  area?: number;
  monthlyRentMinor: number;
  purpose?: "rent" | "sale";
  salePriceMinor?: number;
  availability: "vacant" | "expiring" | "sale";
  contractEndDate?: string;
  availableFrom: string;
  tenancyLabel?: string;
};

export type BrokerRecipientBrief = {
  brokerId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
};

export type BrokerCampaignBrief = {
  subject: string;
  body: string;
  targets: BrokerTargetBrief[];
  recipients: BrokerRecipientBrief[];
  asOf: string;
};

export type BrokerCampaignDispatchInput = {
  campaignId: string;
  requestId: string;
};

export type BrokerCampaignBatchesSimulationInput = {
  campaignIds: string[];
  requestId: string;
};

type LeaseRange = { lease: DemoEntity; start: string; end: string };

type RelatedLeases = { ranges: LeaseRange[]; malformed: boolean };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function id(value: unknown, label: string): string {
  const result = text(value);
  if (!result || result.length > MAX_ID_LENGTH)
    throw new Error(`${label} غير صالح`);
  return result;
}

function requiredText(value: unknown, label: string, max: number): string {
  const result = text(value);
  if (!result) throw new Error(`${label} مطلوب`);
  if (result.length > max) throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} غير صالح`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function optionalInputText(
  value: unknown,
  label: string,
  max: number
): string | undefined {
  return value === undefined ? undefined : optionalText(value, label, max);
}

function assertEmail(value: unknown): string {
  if (typeof value !== "string" || /[\x00-\x1F\x7F,;<>]/.test(value))
    throw new Error("البريد الإلكتروني غير صحيح");
  const email = requiredText(value, "البريد الإلكتروني", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("البريد الإلكتروني غير صحيح");
  return email;
}

function assertPositiveMinor(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} يجب أن يكون مبلغًا موجبًا بوحدة العملة الأصغر`);
  return value;
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function assertMetadata(meta: Record<string, MetaValue>): void {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_ENTRIES)
    throw new Error("بيانات السجل تتجاوز حد 32 حقلاً في نسخة التجربة");
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_META_KEY_LENGTH)
      throw new Error("اسم حقل بيانات السجل غير صالح");
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH)
      throw new Error("قيمة بيانات السجل تتجاوز الحد المسموح");
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || !Number.isSafeInteger(value))
    ) {
      throw new Error("قيمة بيانات السجل غير صالحة");
    }
  }
}

function assertState(state: PrototypeState): void {
  if (!state || state.version !== 1 || !state.entities || !state.settings)
    throw new Error("حالة البروتوتايب غير صالحة");
  for (const kind of [
    "properties",
    "units",
    "leases",
    "applications",
    "vendors",
    "documents",
  ] as const) {
    if (!Array.isArray(state.entities[kind]))
      throw new Error("سجلات البروتوتايب غير مكتملة");
  }
}

function assertOperator(state: PrototypeState): void {
  assertState(state);
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function totalEntities(entities: EntityMap): number {
  return ENTITY_KINDS.reduce((total, kind) => total + entities[kind].length, 0);
}

function assertCapacity(
  state: PrototypeState,
  kind: "vendors" | "documents"
): void {
  if (state.entities[kind].length + 1 > MAX_ENTITY_ROWS_PER_KIND)
    throw new Error("يتجاوز الإجراء سعة سجلات نسخة التجربة");
  if (totalEntities(state.entities) + 1 > MAX_TOTAL_ENTITY_ROWS)
    throw new Error("يتجاوز الإجراء إجمالي سعة نسخة التجربة");
}

function assertSnapshotSize(next: PrototypeState): void {
  if (serializedPrototypeBytes(next) > MAX_SNAPSHOT_BYTES)
    throw new Error("يتجاوز الإجراء حد حجم نسخة التجربة");
}

function audit(state: PrototypeState, title: string, detail: string) {
  return [
    {
      id: newId("broker-audit"),
      at: new Date().toISOString(),
      title: title.slice(0, 256),
      detail: detail.slice(0, MAX_TEXT_LENGTH),
    },
    ...state.audit,
  ].slice(0, MAX_AUDIT_ROWS);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateAfter(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateBefore(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Calendar-day difference based exclusively on UTC midnights. */
function utcDayDifference(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000
  );
}

function propertyForUnit(
  entities: EntityMap,
  unit: DemoEntity
): DemoEntity | undefined {
  return entities.properties.find(
    row => row.id === unit.propertyId && row.portfolioId === unit.portfolioId
  );
}

/**
 * Only canonical whole-property rows can represent a whole rental target. A
 * legacy property with no rentalMode is deliberately treated as ordinary unit
 * data; it is never guessed to be a whole-property rental.
 */
function validPropertyUnit(
  entities: EntityMap,
  unit: DemoEntity
): DemoEntity | undefined {
  const property = propertyForUnit(entities, unit);
  if (!property) return undefined;

  const mode = text(property.meta.rentalMode);
  const siblings = entities.units.filter(
    row =>
      row.propertyId === property.id && row.portfolioId === property.portfolioId
  );
  if (mode === "whole") {
    const wholeTargets = siblings.filter(
      row => row.meta.wholeProperty === true
    );
    if (unit.meta.wholeProperty !== true || wholeTargets.length !== 1)
      return undefined;
  } else if (mode === "units") {
    if (unit.meta.wholeProperty === true) return undefined;
  } else if (unit.meta.wholeProperty === true) {
    // An untyped legacy property cannot safely promote a whole-property row.
    return undefined;
  }

  return property;
}

/**
 * Marketing is a rental-only offer surface. Invalid purpose metadata fails
 * closed, while the shared resolver retains legacy records without a purpose.
 */
function isRentalMarketingTarget(property: DemoEntity, unit: DemoEntity): boolean {
  try {
    const purpose = resolveUnitPurpose(unit, property);
    if (purpose) return purpose === "rent";

    // Purpose-less legacy records retain the historical rental eligibility.
    // A mixed parent is different: its physical units need an explicit choice,
    // while its one canonical whole-property target represents the original
    // asset and may be marketed for rent without inventing a physical unit.
    const parentPurpose = parsePropertyProfile(
      property.meta.propertyProfile
    ).purpose;
    return parentPurpose !== "mixed" || unit.meta.wholeProperty === true;
  } catch {
    return false;
  }
}

/**
 * Initial tenancy declarations are advisory records, not lease lifecycle
 * mutations. They must nevertheless prevent a new rental offer while their
 * effective declaration says the target is rented or reserved. A malformed
 * declaration/summary is unavailable rather than accidentally marketed.
 */
function declarationBlocksNewRentalOffer(
  entities: EntityMap,
  property: DemoEntity,
  unit: DemoEntity,
  asOf: string
): boolean {
  try {
    const unitSummary = getTenancySummary(entities, property, unit, asOf);
    if (unitSummary.source === "declaration")
      return unitSummary.status !== "vacant";
    if (
      Object.prototype.hasOwnProperty.call(unit.meta, "tenancyDeclaration") &&
      unitSummary.source !== "lease"
    ) {
      return true;
    }

    // A physical split unit never inherits a parent declaration. Until any
    // physical unit has lease/declaration evidence, however, the parent still
    // represents the only available tenancy evidence and must fail closed.
    // Once the resolver aggregates physical-unit evidence (source: units),
    // each vacant physical unit keeps its own independent availability.
    const needsParentSummary =
      unit.meta.wholeProperty === true || text(property.meta.rentalMode) === "units";
    if (!needsParentSummary) return false;
    const propertySummary = getTenancySummary(entities, property, undefined, asOf);
    if (propertySummary.source === "declaration")
      return propertySummary.status !== "vacant";
    return (
      Object.prototype.hasOwnProperty.call(property.meta, "tenancyDeclaration") &&
      propertySummary.source !== "lease" &&
      propertySummary.source !== "units"
    );
  } catch {
    return true;
  }
}

function sameTarget(
  entities: EntityMap,
  propertyId: string,
  unitId: string,
  otherPropertyId: string,
  otherUnitId: string
): boolean {
  if (propertyId !== otherPropertyId) return false;
  if (!unitId || !otherUnitId) return true;
  const leftWhole = entities.units.some(
    unit => unit.id === unitId && unit.meta.wholeProperty === true
  );
  const rightWhole = entities.units.some(
    unit => unit.id === otherUnitId && unit.meta.wholeProperty === true
  );
  return leftWhole || rightWhole || unitId === otherUnitId;
}

function isApprovedBooking(application: DemoEntity): boolean {
  if (application.meta.recordType !== "letting-application") return false;
  const stage = text(application.meta.stage);
  if (APPROVED_BOOKING_STAGES.has(stage)) return true;
  return /موافق|معتمد|approved/i.test(application.status);
}

function hasApprovedBooking(
  entities: EntityMap,
  propertyId: string,
  unitId: string
): boolean {
  return entities.applications.some(
    application =>
      isApprovedBooking(application) &&
      sameTarget(
        entities,
        propertyId,
        unitId,
        application.propertyId,
        text(application.meta.unitId)
      )
  );
}

/** Mirrors the lifecycle's definition of a lease that may affect occupancy. */
function isActivatedLease(lease: DemoEntity): boolean {
  const draft = /مسودة|مقترح|بانتظار/.test(lease.status);
  const ended = /منته|ملغ|مرفوض/.test(lease.status);
  return (
    lease.meta.lifecycleActivated === true ||
    (!draft && !ended && /نافذ|نشط|مؤجر|مجد/.test(lease.status))
  );
}

function leaseAppliesToUnit(
  entities: EntityMap,
  lease: DemoEntity,
  unit: DemoEntity
): boolean {
  if (
    lease.propertyId !== unit.propertyId ||
    lease.portfolioId !== unit.portfolioId
  ) {
    return false;
  }
  const leaseUnitId = text(lease.meta.unitId);
  if (!leaseUnitId || leaseUnitId === unit.id) return true;
  return entities.units.some(
    candidate =>
      candidate.id === leaseUnitId &&
      candidate.propertyId === unit.propertyId &&
      candidate.meta.wholeProperty === true
  );
}

/** Uses the same natural/termination-effective end calculation as lifecycle. */
function lifecycleLeaseRange(
  lease: DemoEntity
): Omit<LeaseRange, "lease"> | undefined {
  const start =
    text(lease.meta.startDate) || text(lease.meta.start) || lease.date;
  const naturalEnd = text(lease.meta.endDate) || text(lease.meta.end);
  if (!isIsoDate(start) || !isIsoDate(naturalEnd)) return undefined;
  const termination = text(lease.meta.terminationEffectiveDate);
  if (termination && !isIsoDate(termination)) return undefined;
  const end =
    termination && termination <= naturalEnd
      ? dateBefore(termination)
      : naturalEnd;
  if (end < start) return undefined;
  return { start, end };
}

function relatedLifecycleLeases(
  entities: EntityMap,
  unit: DemoEntity
): RelatedLeases {
  const ranges: LeaseRange[] = [];
  let malformed = false;
  for (const lease of entities.leases) {
    if (!isActivatedLease(lease) || !leaseAppliesToUnit(entities, lease, unit))
      continue;
    const range = lifecycleLeaseRange(lease);
    if (!range) {
      malformed = true;
      continue;
    }
    ranges.push({ lease, ...range });
  }
  return { ranges, malformed };
}

function numberMeta(...values: unknown[]): number | undefined {
  const value = values.find(candidate => typeof candidate === "number");
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function propertyType(property: DemoEntity): string {
  const type = assetTypeFromMeta(property.meta);
  return type
    ? assetTypeLabel(type)
    : text(property.meta.propertyType) || text(property.meta.type);
}

function propertyLocation(property: DemoEntity): string {
  return (
    text(property.meta.location) ||
    text(property.meta.address) ||
    text(property.meta.areaName)
  );
}

type MarketingRentSuggestion = {
  monthlyRentMinor: number;
  source?: string;
  label?: string;
  date?: string;
};

function positiveMetaRent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function sourceDate(row: DemoEntity, fallback: string): string | undefined {
  return isIsoDate(row.date)
    ? row.date
    : isIsoDate(fallback)
      ? fallback
      : undefined;
}

/** A cancelled or draft lease must never become a marketing price source. */
function isUsableMarketingRentLease(lease: DemoEntity): boolean {
  const status = text(lease.status);
  if (
    lease.currency !== "QAR" ||
    lease.meta.cancelled === true ||
    /مسودة|مقترح|بانتظار|ملغ|مرفوض|cancel/i.test(status)
  ) {
    return false;
  }
  return isActivatedLease(lease);
}

function marketingRentLeaseRanges(
  entities: EntityMap,
  property: DemoEntity,
  unit: DemoEntity
): LeaseRange[] {
  return entities.leases.flatMap(lease => {
    const leaseUnitId = text(lease.meta.unitId);
    const legalWholeTarget =
      text(property.meta.rentalMode) === "whole" &&
      unit.meta.wholeProperty === true &&
      (!leaseUnitId || leaseUnitId === unit.id);
    if (
      !isUsableMarketingRentLease(lease) ||
      !leaseAppliesToUnit(entities, lease, unit) ||
      (leaseUnitId !== unit.id && !legalWholeTarget)
    ) {
      return [];
    }
    const range = lifecycleLeaseRange(lease);
    return range ? [{ lease, ...range }] : [];
  });
}

function marketingRentSourceDate(range: LeaseRange): string {
  const termination = text(range.lease.meta.terminationEffectiveDate);
  const naturalEnd =
    text(range.lease.meta.endDate) || text(range.lease.meta.end);
  // lifecycleLeaseRange has already validated a governing termination date.
  // Preserve that factual date as the price-source date, rather than the
  // preceding final occupied day used internally for availability.
  return termination &&
    isIsoDate(termination) &&
    (!naturalEnd || termination <= naturalEnd)
    ? termination
    : range.end;
}

/**
 * Uses only fields explicitly named as rent. Asset amountMinor is deliberately
 * excluded because it can represent acquisition cost, a building total, or a
 * different business value.
 */
function suggestedMarketingRent(
  entities: EntityMap,
  property: DemoEntity,
  unit: DemoEntity,
  availability: "vacant" | "expiring",
  asOf: string,
  currentLease?: LeaseRange
): MarketingRentSuggestion {
  const unitRent = positiveMetaRent(unit.meta.monthlyRentMinor);
  if (unitRent) {
    return {
      monthlyRentMinor: unitRent,
      source: "unit-monthly-rent",
      label: "الإيجار الشهري المحدد للوحدة",
      ...(sourceDate(unit, asOf) ? { date: sourceDate(unit, asOf) } : {}),
    };
  }
  const namedUnitRent = positiveMetaRent(unit.meta.rentMinor);
  if (namedUnitRent) {
    return {
      monthlyRentMinor: namedUnitRent,
      source: "unit-named-rent",
      label: "قيمة الإيجار المسمّاة للوحدة",
      ...(sourceDate(unit, asOf) ? { date: sourceDate(unit, asOf) } : {}),
    };
  }

  const contractRent = (range: LeaseRange, label: string, source: string) => {
    const hasNamedRent = Object.prototype.hasOwnProperty.call(
      range.lease.meta,
      "rentMinor"
    );
    const namedRent = positiveMetaRent(range.lease.meta.rentMinor);
    // Older lease records put their monthly rental amount in amountMinor.
    // Accept that only when the contract explicitly declares monthly billing;
    // never apply this fallback to a property/unit value or an invalid override.
    const monthlyPeriod = text(
      range.lease.meta.method ||
        range.lease.meta.billingPeriod ||
        range.lease.meta.rentPeriod
    );
    const historicalMonthlyRent =
      !hasNamedRent && /^(شهري|شهريًا|monthly)$/i.test(monthlyPeriod)
        ? positiveMetaRent(range.lease.amountMinor)
        : 0;
    const rent = namedRent || historicalMonthlyRent;
    return rent
      ? {
          monthlyRentMinor: rent,
          source: historicalMonthlyRent ? `${source}-legacy-monthly` : source,
          label: historicalMonthlyRent ? `${label} · مبلغ شهري محفوظ` : label,
          date: marketingRentSourceDate(range),
        }
      : undefined;
  };
  if (availability === "expiring" && currentLease) {
    const matchingCurrent = marketingRentLeaseRanges(
      entities,
      property,
      unit
    ).find(range => range.lease.id === currentLease.lease.id);
    if (matchingCurrent) {
      const current = contractRent(
        matchingCurrent,
        "إيجار العقد النافذ",
        "active-contract-rent"
      );
      if (current) return current;
    }
  }
  if (availability === "vacant") {
    const previous = marketingRentLeaseRanges(entities, property, unit)
      .filter(range => range.end < asOf)
      .sort((left, right) =>
        right.end === left.end
          ? right.lease.id.localeCompare(left.lease.id)
          : right.end.localeCompare(left.end)
      )[0];
    if (previous) {
      const prior = contractRent(
        previous,
        "إيجار العقد السابق",
        "prior-contract-rent"
      );
      if (prior) return prior;
    }
  }

  const mode = text(property.meta.rentalMode);
  if (mode === "whole" && unit.meta.wholeProperty === true) {
    const propertyRent = positiveMetaRent(property.meta.monthlyRentMinor);
    if (propertyRent) {
      return {
        monthlyRentMinor: propertyRent,
        source: "whole-property-monthly-rent",
        label: "الإيجار الشهري للعقار كاملًا",
        ...(sourceDate(property, asOf)
          ? { date: sourceDate(property, asOf) }
          : {}),
      };
    }
  }
  if (mode === "units" && unit.meta.wholeProperty !== true) {
    const unitDefault = positiveMetaRent(property.meta.unitMonthlyRentMinor);
    if (unitDefault) {
      return {
        monthlyRentMinor: unitDefault,
        source: "property-unit-default-monthly-rent",
        label: "الإيجار الشهري الافتراضي للوحدة",
        ...(sourceDate(property, asOf)
          ? { date: sourceDate(property, asOf) }
          : {}),
      };
    }
  }
  return { monthlyRentMinor: 0 };
}

function targetBase(
  property: DemoEntity,
  unit: DemoEntity,
  availability: "vacant" | "expiring",
  availableFrom: string,
  suggestion: MarketingRentSuggestion
): BrokerTarget | undefined {
  // Missing optional numbers must be visible as missing, not erase a vacancy.
  const propertyNumber = text(property.meta.propertyNumber) || "غير مسجل";
  const unitCode =
    text(unit.meta.unitCode) || text(unit.meta.code) || "غير مسجل";
  const area = numberMeta(
    unit.meta.area,
    ...(unit.meta.wholeProperty === true
      ? [property.meta.buildingArea, property.meta.area, property.meta.landArea]
      : [])
  );
  return {
    id: unit.id,
    propertyId: property.id,
    portfolioId: property.portfolioId,
    propertyTitle: property.title,
    propertyNumber,
    unitTitle: unit.title,
    unitCode,
    suggestedMonthlyRentMinor: suggestion.monthlyRentMinor,
    ...(suggestion.source ? { rentSource: suggestion.source } : {}),
    ...(suggestion.label ? { rentSourceLabel: suggestion.label } : {}),
    ...(suggestion.date ? { rentSourceDate: suggestion.date } : {}),
    availability,
    availableFrom,
    propertyType: propertyType(property),
    location: propertyLocation(property),
    ...(area === undefined ? {} : { area }),
  };
}

function expiringOption(options: BrokerTargetOptions | undefined): {
  includeExpiring: boolean;
  includeSale: boolean;
  days: number;
} {
  const input = options ?? {};
  if (
    input.includeExpiring !== undefined &&
    typeof input.includeExpiring !== "boolean"
  ) {
    throw new Error("خيار العقود القريبة من الانتهاء غير صالح");
  }
  if (input.expiringWithinDays !== undefined) {
    if (
      typeof input.expiringWithinDays !== "number" ||
      !Number.isSafeInteger(input.expiringWithinDays) ||
      !EXPIRING_WINDOWS.has(input.expiringWithinDays)
    ) {
      throw new Error("نافذة العقود القريبة يجب أن تكون 30 أو 60 أو 90 يومًا");
    }
  }
  if (input.includeSale !== undefined && typeof input.includeSale !== "boolean") {
    throw new Error("خيار فرص البيع غير صالح");
  }
  return {
    includeExpiring: input.includeExpiring === true,
    includeSale: input.includeSale === true,
    days: input.expiringWithinDays ?? 60,
  };
}

function expiringWindowFromCampaign(campaign: DemoEntity): number | undefined {
  const value = campaign.meta.expiringWithinDays;
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !EXPIRING_WINDOWS.has(value)
  ) {
    throw new Error("نافذة العقود المحفوظة في الحملة غير صالحة");
  }
  return value;
}

/** Rental targets retain their original vacancy and expiring-contract rules. */
function listRentalBrokerTargets(
  state: PrototypeState,
  options?: BrokerTargetOptions
): BrokerTarget[] {
  assertState(state);
  const asOf = scenarioDate(state);
  const { includeExpiring, days } = expiringOption(options);
  const targetIds = new Set<string>();

  return state.entities.units.flatMap(unit => {
    if (
      state.settings.portfolioId !== "all" &&
      unit.portfolioId !== state.settings.portfolioId
    ) {
      return [];
    }
    if (targetIds.has(unit.id)) return [];

    const property = validPropertyUnit(state.entities, unit);
    if (!property) return [];
    if (!isRentalMarketingTarget(property, unit)) return [];
    if (
      declarationBlocksNewRentalOffer(state.entities, property, unit, asOf)
    ) {
      return [];
    }
    if (hasApprovedBooking(state.entities, property.id, unit.id)) return [];

    let occupancy: ReturnType<typeof unitOccupancyAt>;
    try {
      occupancy = unitOccupancyAt(state.entities, unit.id, asOf);
    } catch {
      // Malformed lifecycle data must never be advertised as a free target.
      return [];
    }

    if (occupancy === "vacant") {
      const target = targetBase(
        property,
        unit,
        "vacant",
        asOf,
        suggestedMarketingRent(state.entities, property, unit, "vacant", asOf)
      );
      if (!target) return [];
      targetIds.add(unit.id);
      return [target];
    }

    if (!includeExpiring || occupancy !== "occupied") return [];
    const related = relatedLifecycleLeases(state.entities, unit);
    if (related.malformed) return [];
    const activeNow = related.ranges.filter(
      range => range.start <= asOf && asOf <= range.end
    );
    // Lifecycle rejects overlaps; corrupted overlap data must not yield a claim.
    if (activeNow.length !== 1) return [];

    const current = activeNow[0];
    const daysToExpiry = utcDayDifference(asOf, current.end);
    if (daysToExpiry < 0 || daysToExpiry > days) return [];
    const availableFrom = dateAfter(current.end);
    const hasSuccessorAtAvailability = related.ranges.some(
      range =>
        range.lease.id !== current.lease.id &&
        range.start <= availableFrom &&
        range.end >= range.start
    );
    if (hasSuccessorAtAvailability) return [];

    const target = targetBase(
      property,
      unit,
      "expiring",
      availableFrom,
      suggestedMarketingRent(
        state.entities,
        property,
        unit,
        "expiring",
        asOf,
        current
      )
    );
    if (!target) return [];
    target.contractEndDate = current.end;
    target.daysToExpiry = daysToExpiry;
    targetIds.add(unit.id);
    return [target];
  });
}

function saleRootTargetId(propertyId: string, unavailable: Set<string>): string {
  const base = `sale-root-${hash(propertyId)}`;
  let candidate = base;
  let suffix = 1;
  while (unavailable.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  unavailable.add(candidate);
  return candidate;
}

/**
 * Sale target composition deliberately uses only the sale-inventory reader.
 * That reader owns inherited/mixed-purpose resolution, physical-unit rules,
 * tenancy labels, portfolio scope, and the strict no-price-fallback policy.
 */
function listSaleBrokerTargets(state: PrototypeState): BrokerTarget[] {
  const unavailableIds = new Set(state.entities.units.map(unit => unit.id));
  const targetIds = new Set<string>();

  return listSaleMarketingInventory(state).flatMap(group => {
    const property = state.entities.properties.find(
      row =>
        row.id === group.propertyId &&
        row.portfolioId === group.portfolioId
    );
    if (!property) return [];

    if (group.units.length) {
      return group.units.flatMap(saleUnit => {
        const unit = state.entities.units.find(
          row =>
            row.id === saleUnit.id &&
            row.propertyId === property.id &&
            row.portfolioId === property.portfolioId &&
            row.meta.wholeProperty !== true
        );
        if (!unit || targetIds.has(unit.id)) return [];
        targetIds.add(unit.id);
        return [
          {
            id: unit.id,
            propertyId: property.id,
            portfolioId: property.portfolioId,
            propertyTitle: group.propertyTitle,
            propertyNumber: group.propertyNumber,
            unitTitle: saleUnit.title,
            unitCode: saleUnit.unitCode,
            purpose: "sale" as const,
            suggestedMonthlyRentMinor: 0,
            ...(saleUnit.salePriceMinor === undefined
              ? {}
              : { suggestedSalePriceMinor: saleUnit.salePriceMinor }),
            availability: "sale" as const,
            availableFrom: "",
            tenancyLabel: saleUnit.tenancyLabel,
            propertyType: group.propertyType,
            location: group.location,
            ...(saleUnit.areaM2 === undefined ? {} : { area: saleUnit.areaM2 }),
          },
        ];
      });
    }

    // A whole-sale asset has no advertised physical unit. A single-purpose sale
    // parent with no physical sale units is also a real property-level option;
    // this never manufactures a unit row or borrows a unit price.
    if (group.rentalMode !== "whole" && group.propertyPurpose !== "sale")
      return [];
    const rootId = saleRootTargetId(property.id, unavailableIds);
    if (targetIds.has(rootId)) return [];
    targetIds.add(rootId);
    const area = numberMeta(
      property.meta.buildingArea,
      property.meta.area,
      property.meta.landArea
    );
    return [
      {
        id: rootId,
        propertyId: property.id,
        portfolioId: property.portfolioId,
        propertyTitle: group.propertyTitle,
        propertyNumber: group.propertyNumber,
        unitTitle: "العقار كاملًا",
        unitCode: "ROOT",
        purpose: "sale" as const,
        suggestedMonthlyRentMinor: 0,
        ...(group.salePriceMinor === undefined
          ? {}
          : { suggestedSalePriceMinor: group.salePriceMinor }),
        availability: "sale" as const,
        availableFrom: "",
        tenancyLabel: group.tenancyLabel,
        propertyType: group.propertyType,
        location: group.location,
        ...(area === undefined ? {} : { area }),
      },
    ];
  });
}

/**
 * Lists scoped rental targets by default. `includeSale` deliberately opts into
 * sale inventory, whose factual tenancy is not a rental-vacancy assertion.
 */
export function listBrokerTargets(
  state: PrototypeState,
  options?: BrokerTargetOptions
): BrokerTarget[] {
  assertState(state);
  const { includeSale } = expiringOption(options);
  const rentalTargets = listRentalBrokerTargets(state, options);
  if (!includeSale) return rentalTargets;

  const seen = new Set(rentalTargets.map(target => target.id));
  return [
    ...rentalTargets,
    ...listSaleBrokerTargets(state).filter(target => !seen.has(target.id)),
  ];
}

function brokerById(state: PrototypeState, brokerId: string): DemoEntity {
  const broker = state.entities.vendors.find(
    row => row.id === brokerId && row.meta.recordType === BROKER_RECORD_TYPE
  );
  if (!broker) throw new Error("جهة اتصال الوسيط غير موجودة");
  return broker;
}

function isBrokerActive(broker: DemoEntity): boolean {
  // Older records predate active and remain valid active contacts.
  return broker.meta.active !== false;
}

function assertBrokerRelationship(
  state: PrototypeState,
  broker: DemoEntity
): void {
  if (broker.propertyId)
    throw new Error("جهة اتصال الوسيط مرتبطة بعقار ولا تصلح لهذه الحملة");
  if (broker.portfolioId) {
    const portfolioExists = state.entities.portfolios.some(
      row => row.id === broker.portfolioId
    );
    if (!portfolioExists)
      throw new Error("جهة اتصال الوسيط مرتبطة بمحفظة غير موجودة");
    if (
      state.settings.portfolioId !== "all" &&
      broker.portfolioId !== state.settings.portfolioId
    ) {
      throw new Error("جهة اتصال الوسيط خارج نطاق المحفظة الحالي");
    }
  }
}

function assertEligibleBroker(
  state: PrototypeState,
  brokerId: string
): DemoEntity {
  const broker = brokerById(state, brokerId);
  assertBrokerRelationship(state, broker);
  if (!isBrokerActive(broker))
    throw new Error("جهة اتصال الوسيط موقوفة ولا يمكن اختيارها كمستلم");
  assertEmail(broker.meta.email);
  requiredText(broker.meta.contactName, "اسم جهة التواصل", MAX_CONTACT_NAME);
  return broker;
}

function uniqueIds(values: string[], label: string, max: number): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > max)
    throw new Error(`${label} يجب أن يكون بين 1 و${max}`);
  const result = values.map(value => id(value, label));
  if (new Set(result).size !== result.length)
    throw new Error(`${label} يحتوي تكرارًا غير صالح`);
  return result;
}

function chunkText(value: string, size = MAX_TEXT_LENGTH): string[] {
  const result: string[] = [];
  for (let index = 0; index < value.length; index += size)
    result.push(value.slice(index, index + size));
  return result.length ? result : [""];
}

function readChunked(
  meta: Record<string, MetaValue>,
  prefix: string,
  countKey: string
): string | undefined {
  const count = meta[countKey];
  if (typeof count !== "number") return undefined;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_META_ENTRIES)
    return undefined;
  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = meta[`${prefix}${index}`];
    if (typeof chunk !== "string" || chunk.length > MAX_TEXT_LENGTH)
      return undefined;
    chunks.push(chunk);
  }
  return chunks.join("");
}

function campaignBrokerIds(campaign: DemoEntity): string[] {
  const raw = readChunked(
    campaign.meta,
    "brokerIdsChunk",
    "brokerIdsChunkCount"
  );
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(row => typeof row === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function brokerIdsForCampaign(campaign: DemoEntity): string[] {
  if (campaign.meta.recordType !== CAMPAIGN_RECORD_TYPE) return [];
  return campaignBrokerIds(campaign);
}

export function campaignTargetsForPreview(
  campaign: DemoEntity
): BrokerCampaignTargetSnapshot[] {
  if (campaign.meta.recordType !== CAMPAIGN_RECORD_TYPE) return [];
  const raw = text(campaign.meta.targetsJSON);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(row => {
      if (
        !Array.isArray(row) ||
        typeof row[0] !== "string" ||
        !text(row[0]) ||
        row[0].length > MAX_ID_LENGTH ||
        typeof row[1] !== "number" ||
        !Number.isSafeInteger(row[1])
      ) {
        return [];
      }
      // Historical snapshots are exactly [targetId, monthlyRentMinor] and
      // retain their rental meaning. New snapshots make purpose explicit.
      if (row.length === 2) {
        return row[1] > 0
          ? [{ targetId: row[0], monthlyRentMinor: row[1] }]
          : [];
      }
      if (row[2] === "rent" && row.length === 3 && row[1] > 0) {
        return [{ targetId: row[0], monthlyRentMinor: row[1], purpose: "rent" }];
      }
      if (
        row[2] === "sale" &&
        row.length === 4 &&
        row[1] === 0 &&
        typeof row[3] === "number" &&
        Number.isSafeInteger(row[3]) &&
        row[3] > 0
      ) {
        return [
          {
            targetId: row[0],
            monthlyRentMinor: 0,
            purpose: "sale",
            salePriceMinor: row[3],
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function contactFingerprint(input: BrokerContactInput): string {
  const payload: Record<string, unknown> = {
    companyName: text(input.companyName),
    email: text(input.email).toLowerCase(),
    contactName: text(input.contactName),
  };
  if (input.phone !== undefined) payload.phone = text(input.phone);
  if (input.website !== undefined) payload.website = text(input.website);
  if (input.address !== undefined) payload.address = text(input.address);
  if (input.notes !== undefined) payload.notes = text(input.notes);
  if (input.active !== undefined) payload.active = input.active;
  return hash(JSON.stringify(payload));
}

function updateFingerprint(input: BrokerContactUpdateInput): string {
  return hash(
    JSON.stringify({
      brokerId: text(input.brokerId),
      contact: contactFingerprint(input),
    })
  );
}

function contactMeta(
  base: Record<string, MetaValue>,
  values: {
    email: string;
    contactName: string;
    phone?: string;
    website?: string;
    address?: string;
    notes?: string;
    active?: boolean;
  }
): Record<string, MetaValue> {
  const next: Record<string, MetaValue> = {
    ...base,
    email: values.email,
    contactName: values.contactName,
  };
  const optionalValues: Array<
    ["phone" | "website" | "address" | "notes", string | undefined]
  > = [
    ["phone", values.phone],
    ["website", values.website],
    ["address", values.address],
    ["notes", values.notes],
  ];
  for (const [key, value] of optionalValues) {
    if (value) next[key] = value;
    else delete next[key];
  }
  if (values.active === undefined) delete next.active;
  else next.active = values.active;
  return next;
}

function contactInputValues(input: BrokerContactInput): {
  companyName: string;
  email: string;
  contactName: string;
  phone?: string;
  website?: string;
  address?: string;
  notes?: string;
  active?: boolean;
} {
  if (input.active !== undefined && typeof input.active !== "boolean")
    throw new Error("حالة جهة الاتصال غير صالحة");
  const phone = optionalInputText(
    input.phone,
    "هاتف جهة الاتصال",
    MAX_CONTACT_PHONE
  );
  const website = optionalInputText(
    input.website,
    "موقع جهة الاتصال",
    MAX_CONTACT_WEBSITE
  );
  const address = optionalInputText(
    input.address,
    "عنوان جهة الاتصال",
    MAX_TEXT_LENGTH
  );
  const notes = optionalInputText(
    input.notes,
    "ملاحظات جهة الاتصال",
    MAX_TEXT_LENGTH
  );
  return {
    companyName: requiredText(
      input.companyName,
      "اسم الشركة",
      MAX_CAMPAIGN_TITLE
    ),
    email: assertEmail(input.email),
    contactName: requiredText(
      input.contactName,
      "اسم جهة التواصل",
      MAX_CONTACT_NAME
    ),
    ...(phone === undefined ? {} : { phone }),
    ...(website === undefined ? {} : { website }),
    ...(address === undefined ? {} : { address }),
    ...(notes === undefined ? {} : { notes }),
    ...(input.active === undefined ? {} : { active: input.active }),
  };
}

/** Creates a broker contact in vendors; it never invokes an email channel. */
export function createBrokerContact(
  state: PrototypeState,
  input: BrokerContactInput
): Transition<DemoEntity> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف عملية جهة الاتصال");
  if (requestId.length > MAX_REQUEST_ID)
    throw new Error("معرف عملية جهة الاتصال غير صالح");
  const fingerprint = contactFingerprint(input);

  const retried = state.entities.vendors.find(
    row =>
      row.meta.recordType === BROKER_RECORD_TYPE &&
      text(row.meta.createRequestId) === requestId
  );
  if (retried) {
    if (text(retried.meta.createFingerprint) !== fingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    return { state, result: retried };
  }

  const values = contactInputValues(input);
  assertCapacity(state, "vendors");
  const duplicate = state.entities.vendors.find(
    row =>
      row.meta.recordType === BROKER_RECORD_TYPE &&
      text(row.meta.email).toLowerCase() === values.email
  );
  if (duplicate) throw new Error("يوجد وسيط تجريبي آخر بنفس البريد الإلكتروني");

  const meta = contactMeta(
    {
      recordType: BROKER_RECORD_TYPE,
      createRequestId: requestId,
      createFingerprint: fingerprint,
      channel: "preview-only",
    },
    values
  );
  assertMetadata(meta);
  const broker: DemoEntity = {
    id: newId("broker"),
    title: values.companyName,
    subtitle: `مسؤول: ${values.contactName}`,
    portfolioId: "",
    propertyId: "",
    status: values.active === false ? "جهة اتصال موقوفة" : "جهة اتصال تجريبية",
    date: scenarioDate(state),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      vendors: [...state.entities.vendors, broker],
    },
    audit: audit(
      state,
      "إضافة وسيط تجريبي",
      `${values.companyName} • لا قناة إرسال`
    ),
  };
  assertSnapshotSize(next);
  return { state: next, result: broker };
}

/** Updates local broker metadata only; a paused contact remains in historical rows. */
export function updateBrokerContact(
  state: PrototypeState,
  input: BrokerContactUpdateInput
): Transition<DemoEntity> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف تحديث جهة الاتصال");
  const expectedFingerprint = updateFingerprint(input);
  const requestedBrokerId = text(input.brokerId);

  // Locate an already committed update before mutable relationship, duplicate,
  // or active-state checks. A retry is stable even if the surrounding state moved.
  const retried = state.entities.vendors.find(
    row =>
      row.meta.recordType === BROKER_RECORD_TYPE &&
      text(row.meta.updateRequestId) === requestId
  );
  if (retried) {
    if (
      text(retried.meta.updatedBrokerId) !== requestedBrokerId ||
      text(retried.meta.updateFingerprint) !== expectedFingerprint
    ) {
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    }
    return { state, result: retried };
  }

  const brokerId = id(input.brokerId, "معرف جهة الاتصال");
  const broker = brokerById(state, brokerId);
  assertBrokerRelationship(state, broker);
  const values = contactInputValues(input);
  const duplicate = state.entities.vendors.find(
    row =>
      row.id !== broker.id &&
      row.meta.recordType === BROKER_RECORD_TYPE &&
      text(row.meta.email).toLowerCase() === values.email
  );
  if (duplicate) throw new Error("يوجد وسيط تجريبي آخر بنفس البريد الإلكتروني");

  const existingOptional = {
    phone: text(broker.meta.phone),
    website: text(broker.meta.website),
    address: text(broker.meta.address),
    notes: text(broker.meta.notes),
  };
  const active =
    values.active === undefined ? broker.meta.active !== false : values.active;
  const meta = contactMeta(
    {
      ...broker.meta,
      recordType: BROKER_RECORD_TYPE,
      updateRequestId: requestId,
      updateFingerprint: expectedFingerprint,
      updatedBrokerId: broker.id,
    },
    {
      email: values.email,
      contactName: values.contactName,
      phone: values.phone === undefined ? existingOptional.phone : values.phone,
      website:
        values.website === undefined
          ? existingOptional.website
          : values.website,
      address:
        values.address === undefined
          ? existingOptional.address
          : values.address,
      notes: values.notes === undefined ? existingOptional.notes : values.notes,
      active,
    }
  );
  assertMetadata(meta);
  const updated: DemoEntity = {
    ...broker,
    // Preserve the immutable entity id and portfolio/property relationship.
    title: values.companyName,
    subtitle: `مسؤول: ${values.contactName}`,
    status: active ? "جهة اتصال تجريبية" : "جهة اتصال موقوفة",
    meta,
  };
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      vendors: state.entities.vendors.map(row =>
        row.id === broker.id ? updated : row
      ),
    },
    audit: audit(
      state,
      "تحديث وسيط تجريبي",
      `${values.companyName} • ${active ? "نشط" : "موقوف"} • لا قناة إرسال`
    ),
  };
  assertSnapshotSize(next);
  return { state: next, result: updated };
}

function targetBrief(
  target: BrokerTarget,
  monthlyRentMinor: number,
  salePriceMinor?: number
): BrokerTargetBrief {
  const purpose = target.purpose === "sale" ? "sale" : "rent";
  if (purpose === "sale") {
    assertPositiveMinor(salePriceMinor, "سعر البيع المطلوب");
  } else {
    assertPositiveMinor(monthlyRentMinor, "الإيجار الشهري المطلوب");
  }
  return {
    targetId: target.id,
    propertyId: target.propertyId,
    propertyTitle: target.propertyTitle,
    propertyNumber: target.propertyNumber,
    unitTitle: target.unitTitle,
    unitCode: target.unitCode,
    propertyType: target.propertyType,
    location: target.location,
    ...(target.area === undefined ? {} : { area: target.area }),
    purpose,
    monthlyRentMinor: purpose === "sale" ? 0 : monthlyRentMinor,
    ...(purpose === "sale" ? { salePriceMinor } : {}),
    availability: target.availability,
    ...(target.contractEndDate
      ? { contractEndDate: target.contractEndDate }
      : {}),
    availableFrom: purpose === "sale" ? "" : target.availableFrom,
    ...(purpose === "sale" && target.tenancyLabel
      ? { tenancyLabel: target.tenancyLabel }
      : {}),
  };
}

type SelectedCampaignTarget = {
  target: BrokerTarget;
  purpose: "rent" | "sale";
  /** True for the current purpose-aware snapshot tuple format. */
  explicitPurpose: boolean;
  monthlyRentMinor: number;
  salePriceMinor?: number;
};

const DEFAULT_RENT_CAMPAIGN_TITLE = "فرص تأجير جاهزة للمراجعة";
const DEFAULT_SALE_CAMPAIGN_TITLE = "فرص بيع جاهزة للمراجعة";
const DEFAULT_ALL_CAMPAIGN_TITLE = "فرص عقارية جاهزة للمراجعة";

function hasOwnRecordKey(value: unknown, key: string): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function targetPurpose(target: Pick<BrokerTarget, "purpose">): "rent" | "sale" {
  return target.purpose === "sale" ? "sale" : "rent";
}

function targetSelectionFromInput(
  target: BrokerTarget,
  input: BrokerCampaignInput,
  explicitPurpose: boolean
): SelectedCampaignTarget {
  const purpose = targetPurpose(target);
  if (purpose === "sale") {
    if (hasOwnRecordKey(input.targetRentsMinor, target.id)) {
      throw new Error(
        "أحد الأهداف لم يعد شاغرًا لحملة الإيجار؛ هدف البيع لا يقبل سعرًا في حقل الإيجار الشهري، أدخل سعر البيع المطلوب منفصلًا"
      );
    }
    return {
      target,
      purpose,
      explicitPurpose,
      monthlyRentMinor: 0,
      salePriceMinor: assertPositiveMinor(
        input.targetSalePricesMinor?.[target.id],
        `سعر البيع المطلوب للهدف ${target.id}`
      ),
    };
  }
  if (hasOwnRecordKey(input.targetSalePricesMinor, target.id)) {
    throw new Error(
      "هدف الإيجار لا يقبل سعرًا في حقل البيع؛ أدخل الإيجار الشهري المطلوب منفصلًا"
    );
  }
  return {
    target,
    purpose,
    explicitPurpose,
    monthlyRentMinor: assertPositiveMinor(
      input.targetRentsMinor?.[target.id],
      `الإيجار الشهري للهدف ${target.id}`
    ),
  };
}

function selectionFromSnapshotInput(
  snapshot: BrokerCampaignTargetSnapshot,
  input: BrokerCampaignInput
): SelectedCampaignTarget {
  const purpose = snapshot.purpose === "sale" ? "sale" : "rent";
  return targetSelectionFromInput(
    {
      id: snapshot.targetId,
      purpose: snapshot.purpose,
    } as BrokerTarget,
    input,
    snapshot.purpose !== undefined
  );
}

function campaignPurpose(
  selectedTargets: SelectedCampaignTarget[]
): "rent" | "sale" | undefined {
  const purposes = new Set(selectedTargets.map(target => target.purpose));
  return purposes.size === 1 ? [...purposes][0] : undefined;
}

function campaignTitleForPurpose(
  title: string,
  purpose: "rent" | "sale",
  splitMixedBatch = false
): string {
  if (
    purpose === "sale" &&
    (title === DEFAULT_RENT_CAMPAIGN_TITLE || title === DEFAULT_ALL_CAMPAIGN_TITLE)
  ) {
    return DEFAULT_SALE_CAMPAIGN_TITLE;
  }
  if (
    purpose === "rent" &&
    splitMixedBatch &&
    (title === DEFAULT_SALE_CAMPAIGN_TITLE || title === DEFAULT_ALL_CAMPAIGN_TITLE)
  ) {
    return DEFAULT_RENT_CAMPAIGN_TITLE;
  }
  return title;
}

function recipientBrief(broker: DemoEntity): BrokerRecipientBrief {
  const email = assertEmail(broker.meta.email);
  const phone = text(broker.meta.phone);
  return {
    brokerId: broker.id,
    companyName: broker.title,
    contactName: requiredText(
      broker.meta.contactName,
      "اسم جهة التواصل",
      MAX_CONTACT_NAME
    ),
    email,
    ...(phone ? { phone } : {}),
  };
}

function campaignFingerprint(
  title: string,
  content: string,
  targetIds: string[],
  brokerIds: string[],
  selectedTargets: SelectedCampaignTarget[],
  expiringWithinDays?: number
): string {
  const payload: Record<string, unknown> = {
    title,
    content,
    targetIds,
    brokerIds,
    ...(selectedTargets.some(row => row.explicitPurpose)
      ? {
          targetSelections: selectedTargets.map(row =>
            row.purpose === "sale"
              ? [row.target.id, "sale", row.salePriceMinor]
              : [row.target.id, "rent", row.monthlyRentMinor]
          ),
        }
      : {
          // Keep the pre-sale signature byte-for-byte compatible for a retry
          // of an historical rental-only request.
          targetRentsMinor: selectedTargets.map(row => [
            row.target.id,
            row.monthlyRentMinor,
          ]),
        }),
  };
  // Omit undefined to retain the exact fingerprint of pre-extension campaigns.
  if (expiringWithinDays !== undefined)
    payload.expiringWithinDays = expiringWithinDays;
  return hash(JSON.stringify(payload));
}

function campaignTargetsJSON(selectedTargets: SelectedCampaignTarget[]): string {
  return JSON.stringify(
    selectedTargets.map(row =>
      row.purpose === "sale"
        ? [row.target.id, 0, "sale", row.salePriceMinor]
        : [row.target.id, row.monthlyRentMinor, "rent"]
    )
  );
}

function campaignLatestTargets(
  state: PrototypeState,
  expiringWithinDays?: number
): Map<string, BrokerTarget> {
  const options: BrokerTargetOptions =
    expiringWithinDays === undefined
      ? { includeSale: true }
      : { includeSale: true, includeExpiring: true, expiringWithinDays };
  return new Map(listBrokerTargets(state, options).map(row => [row.id, row]));
}

/**
 * Saves an unsent, frozen local brief. Targets and active recipients are
 * re-evaluated against this exact state immediately before document creation.
 */
export function saveBrokerCampaign(
  state: PrototypeState,
  input: BrokerCampaignInput
): Transition<DemoEntity> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف حفظ الحملة");
  if (requestId.length > MAX_REQUEST_ID)
    throw new Error("معرف حفظ الحملة غير صالح");
  const requestedTitle = requiredText(
    input.title,
    "عنوان الحملة",
    MAX_CAMPAIGN_TITLE
  );
  const content = optionalText(
    input.content,
    "مقدمة الموجز",
    MAX_CAMPAIGN_CONTENT
  );
  const targetIds = uniqueIds(input.targetIds, "الأهداف", MAX_TARGETS);
  const brokerIds = uniqueIds(input.brokerIds, "الوسطاء", MAX_BROKERS);
  if (
    input.expiringWithinDays !== undefined &&
    (!Number.isSafeInteger(input.expiringWithinDays) ||
      !EXPIRING_WINDOWS.has(input.expiringWithinDays))
  ) {
    throw new Error("نافذة العقود القريبة يجب أن تكون 30 أو 60 أو 90 يومًا");
  }

  const retried = state.entities.documents.find(
    row =>
      row.meta.recordType === CAMPAIGN_RECORD_TYPE &&
      text(row.meta.saveRequestId) === requestId
  );
  if (retried) {
    const snapshots = campaignTargetsForPreview(retried);
    const retryTargets = snapshots.map(snapshot =>
      selectionFromSnapshotInput(snapshot, input)
    );
    const purpose = campaignPurpose(retryTargets);
    if (
      !purpose ||
      snapshots.length !== targetIds.length ||
      JSON.stringify(snapshots.map(snapshot => snapshot.targetId)) !==
        JSON.stringify(targetIds)
    ) {
      throw new Error(
        "سبق تنفيذ معرف العملية بسجل أهداف مختلف أو غير صالح؛ استخدم معرفًا جديدًا"
      );
    }
    const expectedFingerprint = campaignFingerprint(
      campaignTitleForPurpose(requestedTitle, purpose),
      content,
      targetIds,
      brokerIds,
      retryTargets,
      input.expiringWithinDays
    );
    if (text(retried.meta.saveFingerprint) !== expectedFingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    return { state, result: retried };
  }

  const latestTargets = campaignLatestTargets(state, input.expiringWithinDays);
  const selectedTargets = targetIds.map(targetId => {
    const latest = latestTargets.get(targetId);
    if (!latest)
      throw new Error(
        "أحد الأهداف لم يعد شاغرًا أو صالحًا للحملة الحالية أو خرج من النطاق؛ حدّث المعاينة قبل الحفظ"
      );
    return targetSelectionFromInput(latest, input, true);
  });
  const purpose = campaignPurpose(selectedTargets);
  if (!purpose) {
    throw new Error(
      "لا يمكن تجهيز أهداف البيع والإيجار في حملة واحدة؛ استخدم تجهيز الدفعات لتفصل كل نوع"
    );
  }
  const title = campaignTitleForPurpose(requestedTitle, purpose);
  const brokers = brokerIds.map(brokerId =>
    assertEligibleBroker(state, brokerId)
  );

  const targetsJSON = campaignTargetsJSON(selectedTargets);
  if (targetsJSON.length > MAX_TARGETS_JSON)
    throw new Error(
      "بيانات الأهداف تتجاوز حد المعاينة؛ قلل الأهداف أو استخدم معرفات أقصر"
    );
  const brokerChunks = chunkText(JSON.stringify(brokerIds));
  const brief: BrokerCampaignBrief = {
    subject: title,
    body: content,
    targets: selectedTargets.map(({ target, monthlyRentMinor, salePriceMinor }) =>
      targetBrief(target, monthlyRentMinor, salePriceMinor)
    ),
    recipients: brokers.map(recipientBrief),
    asOf: scenarioDate(state),
  };
  const briefChunks = chunkText(JSON.stringify(brief));
  const fingerprint = campaignFingerprint(
    title,
    content,
    targetIds,
    brokerIds,
    selectedTargets,
    input.expiringWithinDays
  );

  assertCapacity(state, "documents");
  const meta: Record<string, MetaValue> = {
    recordType: CAMPAIGN_RECORD_TYPE,
    saveRequestId: requestId,
    saveFingerprint: fingerprint,
    content,
    targetsJSON,
    brokerIdsChunkCount: brokerChunks.length,
    targetCount: selectedTargets.length,
    brokerCount: brokerIds.length,
    campaignPurpose: purpose,
    previewStatus: "unsent-preview",
    imagePolicy: "local-preview-only",
    briefChunkCount: briefChunks.length,
    ...(input.expiringWithinDays === undefined
      ? {}
      : { expiringWithinDays: input.expiringWithinDays }),
  };
  brokerChunks.forEach((chunk, index) => {
    meta[`brokerIdsChunk${index}`] = chunk;
  });
  briefChunks.forEach((chunk, index) => {
    meta[`briefChunk${index}`] = chunk;
  });
  assertMetadata(meta);

  const campaign: DemoEntity = {
    id: newId("broker-campaign"),
    title,
    subtitle: "لقطة حملة محلية مجمدة · لا إرسال فعلي ولا مرفقات",
    portfolioId:
      state.settings.portfolioId === "all" ? "" : state.settings.portfolioId,
    propertyId: "",
    status: "معاينة غير مرسلة",
    date: scenarioDate(state),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      documents: [...state.entities.documents, campaign],
    },
    audit: audit(
      state,
      "حفظ معاينة حملة وسطاء",
      `${title} • ${selectedTargets.length} أهداف و${brokerIds.length} وسطاء • لم تُرسل رسالة`
    ),
  };
  assertSnapshotSize(next);
  return { state: next, result: campaign };
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function briefText(value: unknown, required = true): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return required && !result ? undefined : result;
}

function parseFrozenTarget(value: unknown): BrokerTargetBrief | undefined {
  const row = plainObject(value);
  if (!row) return undefined;
  const targetId = briefText(row.targetId);
  const propertyId = briefText(row.propertyId);
  const propertyTitle = briefText(row.propertyTitle);
  const propertyNumber = briefText(row.propertyNumber);
  const unitTitle = briefText(row.unitTitle);
  const unitCode = briefText(row.unitCode);
  const propertyType = briefText(row.propertyType, false);
  const location = briefText(row.location, false);
  const availableFrom = briefText(row.availableFrom, false);
  const purpose = row.purpose;
  if (purpose !== undefined && purpose !== "rent" && purpose !== "sale")
    return undefined;
  if (
    !targetId ||
    !propertyId ||
    !propertyTitle ||
    !propertyNumber ||
    !unitTitle ||
    !unitCode ||
    propertyType === undefined ||
    location === undefined ||
    availableFrom === undefined ||
    typeof row.monthlyRentMinor !== "number" ||
    !Number.isSafeInteger(row.monthlyRentMinor)
  ) {
    return undefined;
  }
  const contractEndDate = briefText(row.contractEndDate, false);
  if (contractEndDate && !isIsoDate(contractEndDate)) return undefined;
  const area = row.area;
  if (
    area !== undefined &&
    (typeof area !== "number" || !Number.isFinite(area))
  )
    return undefined;

  if (purpose === "sale") {
    const salePriceMinor = row.salePriceMinor;
    const tenancyLabel = briefText(row.tenancyLabel);
    if (
      row.availability !== "sale" ||
      row.monthlyRentMinor !== 0 ||
      availableFrom !== "" ||
      contractEndDate ||
      !tenancyLabel ||
      typeof salePriceMinor !== "number" ||
      !Number.isSafeInteger(salePriceMinor) ||
      salePriceMinor <= 0
    ) {
      return undefined;
    }
    return {
      targetId,
      propertyId,
      propertyTitle,
      propertyNumber,
      unitTitle,
      unitCode,
      propertyType,
      location,
      ...(area === undefined ? {} : { area }),
      purpose: "sale",
      monthlyRentMinor: 0,
      salePriceMinor,
      availability: "sale",
      availableFrom: "",
      tenancyLabel,
    };
  }

  if (
    !availableFrom ||
    !isIsoDate(availableFrom) ||
    (row.availability !== "vacant" && row.availability !== "expiring") ||
    row.monthlyRentMinor <= 0
  ) {
    return undefined;
  }
  return {
    targetId,
    propertyId,
    propertyTitle,
    propertyNumber,
    unitTitle,
    unitCode,
    propertyType,
    location,
    ...(area === undefined ? {} : { area }),
    ...(purpose === "rent" ? { purpose: "rent" as const } : {}),
    monthlyRentMinor: row.monthlyRentMinor,
    availability: row.availability,
    ...(contractEndDate ? { contractEndDate } : {}),
    availableFrom,
  };
}

function parseFrozenRecipient(
  value: unknown
): BrokerRecipientBrief | undefined {
  const row = plainObject(value);
  if (!row) return undefined;
  const brokerId = briefText(row.brokerId);
  const companyName = briefText(row.companyName);
  const contactName = briefText(row.contactName);
  const email = briefText(row.email);
  const phone = row.phone === undefined ? "" : briefText(row.phone, false);
  if (
    !brokerId ||
    !companyName ||
    !contactName ||
    !email ||
    phone === undefined
  )
    return undefined;
  try {
    return {
      brokerId,
      companyName,
      contactName,
      email: assertEmail(email),
      ...(phone ? { phone } : {}),
    };
  } catch {
    return undefined;
  }
}

function frozenBrief(campaign: DemoEntity): BrokerCampaignBrief | undefined {
  const hasFrozenMarker = campaign.meta.briefChunkCount !== undefined;
  const raw = readChunked(campaign.meta, "briefChunk", "briefChunkCount");
  if (!raw) {
    if (hasFrozenMarker) throw new Error("لقطة موجز الحملة المجمدة غير صالحة");
    return undefined;
  }
  try {
    const parsed = plainObject(JSON.parse(raw));
    if (!parsed) throw new Error("invalid");
    const subject = briefText(parsed.subject);
    const body = briefText(parsed.body, false);
    const asOf = briefText(parsed.asOf);
    if (!subject || body === undefined || !asOf || !isIsoDate(asOf))
      throw new Error("invalid");
    if (!Array.isArray(parsed.targets) || !Array.isArray(parsed.recipients))
      throw new Error("invalid");
    const targets = parsed.targets.map(parseFrozenTarget);
    const recipients = parsed.recipients.map(parseFrozenRecipient);
    if (targets.some(item => !item) || recipients.some(item => !item))
      throw new Error("invalid");
    return {
      subject,
      body,
      targets: targets as BrokerTargetBrief[],
      recipients: recipients as BrokerRecipientBrief[],
      asOf,
    };
  } catch {
    throw new Error("لقطة موجز الحملة المجمدة غير صالحة");
  }
}

function legacyBrief(
  state: PrototypeState,
  campaign: DemoEntity
): BrokerCampaignBrief {
  const window = expiringWindowFromCampaign(campaign);
  const currentTargets = campaignLatestTargets(state, window);
  const targets = campaignTargetsForPreview(campaign).flatMap(snapshot => {
    const target = currentTargets.get(snapshot.targetId);
    const purpose = snapshot.purpose === "sale" ? "sale" : "rent";
    return target && targetPurpose(target) === purpose
      ? [
          targetBrief(
            target,
            snapshot.monthlyRentMinor,
            snapshot.salePriceMinor
          ),
        ]
      : [];
  });
  const recipients = campaignBrokerIds(campaign).flatMap(brokerId => {
    try {
      const broker = brokerById(state, brokerId);
      return [recipientBrief(broker)];
    } catch {
      return [];
    }
  });
  const warning =
    "تنبيه: هذه حملة قديمة بلا لقطة موجز مجمدة؛ المراجع أدناه بيانات حالية وليست لقطة تاريخية.";
  const content = text(campaign.meta.content);
  return {
    subject: campaign.title,
    body: content ? `${warning}\n\n${content}` : warning,
    targets,
    recipients,
    asOf: isIsoDate(campaign.date) ? campaign.date : scenarioDate(state),
  };
}

/**
 * Returns the immutable campaign brief where available. Legacy campaigns are
 * explicitly marked and resolve only current references; no retroactive frozen
 * snapshot is fabricated.
 */
export function getBrokerCampaignBrief(
  state: PrototypeState,
  campaign: DemoEntity
): BrokerCampaignBrief {
  assertState(state);
  if (campaign.meta.recordType !== CAMPAIGN_RECORD_TYPE)
    throw new Error("وثيقة الحملة غير صالحة");
  const frozen = frozenBrief(campaign);
  if (!frozen) return legacyBrief(state, campaign);
  // Generate the outgoing text exclusively from stored fields. This keeps the
  // frozen price, recipients and dates without duplicating text in metadata.
  const targetDescriptions = frozen.targets.map((target, index) => {
    const sale = target.purpose === "sale";
    return [
      `${index + 1}. ${target.propertyTitle}`,
      `رقم العقار: ${target.propertyNumber} · الوحدة: ${target.unitTitle} (${target.unitCode})`,
      `النوع: ${target.propertyType || "غير محدد"} · الموقع: ${target.location || "لم يحدد"}`,
      ...(target.area && target.area > 0 ? [`المساحة: ${target.area} م²`] : []),
      sale
        ? `سعر البيع المطلوب: ${money(target.salePriceMinor ?? 0)}`
        : `الإيجار المطلوب: ${money(target.monthlyRentMinor)} شهريًا`,
      ...(sale
        ? [`حالة التأجير: ${target.tenancyLabel ?? "غير مسجل"}`]
        : [
            target.availability === "expiring"
              ? `نهاية العقد: ${target.contractEndDate} · متاح متوقع من ${target.availableFrom}، وليس شاغرًا الآن.`
              : `شاغر وفق السجل في ${frozen.asOf} · متاح من ${target.availableFrom}.`,
          ]),
    ].join("\n");
  });
  const allSale =
    frozen.targets.length > 0 &&
    frozen.targets.every(target => target.purpose === "sale");
  return {
    ...frozen,
    body: [
      ...(frozen.body ? [frozen.body, ""] : []),
      `${allSale ? "موجز فرص البيع" : "موجز فرص التأجير"} · بيانات السيناريو في ${frozen.asOf}`,
      "",
      targetDescriptions.join("\n\n"),
      "",
      allSale
        ? "يرجى التواصل معنا بشأن الفرص المناسبة. هذه النسخة التجريبية ليست عرضًا تعاقديًا ولا تعني إرسالًا فعليًا."
        : "يرجى التواصل معنا بشأن الوحدات المناسبة. التوافر المتوقع لا يضمن الإخلاء أو الاعتماد، ولا تشكل هذه النسخة التجريبية عرضًا تعاقديًا.",
    ].join("\n"),
  };
}

export function brokerCampaignInCurrentScope(
  state: PrototypeState,
  campaign: DemoEntity
): boolean {
  return (
    state.settings.portfolioId === "all" ||
    Boolean(
      campaign.portfolioId &&
        campaign.portfolioId === state.settings.portfolioId
    )
  );
}

function campaignInCurrentScope(
  state: PrototypeState,
  campaign: DemoEntity
): void {
  // A campaign saved while all portfolios were selected may be multi-portfolio;
  // it cannot be viewed/exported or simulated in one narrowed portfolio.
  if (!brokerCampaignInCurrentScope(state, campaign))
    throw new Error("الحملة خارج نطاق المحفظة الحالي");
}

function revalidateDispatch(
  state: PrototypeState,
  campaign: DemoEntity,
  brief: BrokerCampaignBrief
): void {
  const window = expiringWindowFromCampaign(campaign);
  const selectedTargets = campaignTargetsForPreview(campaign);
  const selectedBrokerIds = campaignBrokerIds(campaign);
  if (!selectedTargets.length || !selectedBrokerIds.length)
    throw new Error("لا تحتوي الحملة على أهداف أو مستلمين صالحين للمحاكاة");
  if (
    new Set(selectedTargets.map(target => target.targetId)).size !==
      selectedTargets.length ||
    new Set(selectedBrokerIds).size !== selectedBrokerIds.length
  ) {
    throw new Error("بيانات الحملة تحتوي تكرارًا غير صالح");
  }

  const latestTargets = campaignLatestTargets(state, window);
  for (const selected of selectedTargets) {
    const purpose = selected.purpose === "sale" ? "sale" : "rent";
    if (purpose === "sale") {
      assertPositiveMinor(selected.salePriceMinor, "سعر بيع هدف الحملة");
      if (selected.monthlyRentMinor !== 0)
        throw new Error("هدف البيع المحفوظ يحمل إيجارًا غير صالح");
    } else {
      assertPositiveMinor(selected.monthlyRentMinor, "قيمة هدف الحملة");
    }
    const latest = latestTargets.get(selected.targetId);
    if (!latest)
      throw new Error(
        "أحد أهداف الحملة لم يعد شاغرًا أو صالحًا أو خرج من النطاق؛ حدّث الحملة قبل المحاكاة"
      );
    if (targetPurpose(latest) !== purpose)
      throw new Error(
        "تغيّر هدف أحد أهداف الحملة بين البيع والإيجار؛ حدّث الحملة قبل المحاكاة"
      );
  }
  const frozenTargetIds = new Set(brief.targets.map(target => target.targetId));
  if (
    frozenTargetIds.size !== selectedTargets.length ||
    selectedTargets.some(target => !frozenTargetIds.has(target.targetId))
  ) {
    throw new Error("لقطة أهداف الحملة لا تطابق المراجع المحفوظة");
  }
  const frozenTargetById = new Map(
    brief.targets.map(target => [target.targetId, target])
  );
  if (
    selectedTargets.some(
      target => {
        const frozenTarget = frozenTargetById.get(target.targetId);
        const purpose = target.purpose === "sale" ? "sale" : "rent";
        return (
          !frozenTarget ||
          (frozenTarget.purpose === "sale" ? "sale" : "rent") !== purpose ||
          (purpose === "sale"
            ? frozenTarget.salePriceMinor !== target.salePriceMinor ||
              frozenTarget.monthlyRentMinor !== 0
            : frozenTarget.monthlyRentMinor !== target.monthlyRentMinor)
        );
      }
    )
  ) {
    throw new Error("قيمة هدف الحملة لا تطابق اللقطة المحفوظة");
  }

  const frozenRecipientIds = new Set(
    brief.recipients.map(recipient => recipient.brokerId)
  );
  if (
    frozenRecipientIds.size !== selectedBrokerIds.length ||
    selectedBrokerIds.some(brokerId => !frozenRecipientIds.has(brokerId))
  ) {
    throw new Error("لقطة مستلمي الحملة لا تطابق المراجع المحفوظة");
  }
  selectedBrokerIds.forEach(brokerId => assertEligibleBroker(state, brokerId));
}

function recipientDispatchMeta(
  recipients: BrokerRecipientBrief[]
): Record<string, MetaValue> {
  const json = JSON.stringify(recipients);
  if (json.length <= MAX_TEXT_LENGTH) return { recipientJSON: json };
  const chunks = chunkText(json);
  const meta: Record<string, MetaValue> = {
    recipientChunkCount: chunks.length,
  };
  chunks.forEach((chunk, index) => {
    meta[`recipientChunk${index}`] = chunk;
  });
  return meta;
}

/**
 * Records an idempotent local simulation summary. It never opens SMTP, never
 * performs a network request, and deliberately leaves the campaign, brokers,
 * leases, and all financial entities untouched.
 */
export function simulateBrokerCampaignDispatch(
  state: PrototypeState,
  input: BrokerCampaignDispatchInput
): Transition<DemoEntity> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف محاكاة الإرسال");
  const campaignId = id(input.campaignId, "معرف الحملة");
  const fingerprint = hash(JSON.stringify({ campaignId }));

  const retried = state.entities.documents.find(
    row =>
      row.meta.recordType === DISPATCH_RECORD_TYPE &&
      text(row.meta.dispatchRequestId) === requestId
  );
  if (retried) {
    if (
      text(retried.meta.campaignId) !== campaignId ||
      text(retried.meta.dispatchFingerprint) !== fingerprint
    ) {
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    }
    return { state, result: retried };
  }

  const campaign = state.entities.documents.find(
    row => row.id === campaignId && row.meta.recordType === CAMPAIGN_RECORD_TYPE
  );
  if (!campaign) throw new Error("الحملة غير موجودة");
  campaignInCurrentScope(state, campaign);
  const brief = getBrokerCampaignBrief(state, campaign);
  revalidateDispatch(state, campaign, brief);

  assertCapacity(state, "documents");
  const meta: Record<string, MetaValue> = {
    recordType: DISPATCH_RECORD_TYPE,
    dispatchRequestId: requestId,
    dispatchFingerprint: fingerprint,
    campaignId: campaign.id,
    dispatchStatus: "simulated-not-sent",
    recipientCount: brief.recipients.length,
    targetCount: brief.targets.length,
    simulatedAt: scenarioDate(state),
    channel: "local-simulation-only",
    ...recipientDispatchMeta(brief.recipients),
  };
  assertMetadata(meta);
  const dispatch: DemoEntity = {
    id: newId("broker-dispatch"),
    title: `محاكاة إرسال · ${brief.subject}`.slice(0, 256),
    subtitle: "محاكاة محلية غير مرسلة؛ لا SMTP ولا شبكة",
    portfolioId: campaign.portfolioId,
    propertyId: "",
    status: "simulated-not-sent",
    date: scenarioDate(state),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      documents: [...state.entities.documents, dispatch],
    },
    audit: audit(
      state,
      "محاكاة إرسال حملة وسطاء",
      `${brief.subject} • ${brief.recipients.length} مستلمين • غير مرسل محليًا`
    ),
  };
  assertSnapshotSize(next);
  return { state: next, result: dispatch };
}

export function isBrokerContact(row: DemoEntity): boolean {
  return row.meta.recordType === BROKER_RECORD_TYPE;
}

export function isBrokerCampaign(row: DemoEntity): boolean {
  return row.meta.recordType === CAMPAIGN_RECORD_TYPE;
}

type CampaignBatchGroup = {
  targets: SelectedCampaignTarget[];
  brokers: DemoEntity[];
  purpose: "rent" | "sale";
  title: string;
};

type CampaignBatchParts = {
  meta: Record<string, MetaValue>;
  brief: BrokerCampaignBrief;
};

function splitEvery<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function splitHalf<T>(values: T[]): [T[], T[]] {
  const middle = Math.ceil(values.length / 2);
  return [values.slice(0, middle), values.slice(middle)];
}

function childRequestId(
  requestId: string,
  index: number,
  kind: string
): string {
  const suffix = `-${kind}-${index}-${hash(`${requestId}:${kind}:${index}`)}`;
  return `${requestId.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
}

function batchDocumentId(
  requestId: string,
  index: number,
  kind: string
): string {
  return `broker-${kind}-${hash(`${requestId}:${kind}:${index}`)}-${index}`;
}

function numberedBatchTitle(
  title: string,
  index: number,
  total: number
): string {
  const suffix = ` · الدفعة ${index}/${total}`;
  if (title.length + suffix.length > MAX_CAMPAIGN_TITLE) {
    throw new Error("عنوان الحملة لا يترك مساحة لرقم الدفعة ضمن الحد المسموح");
  }
  return `${title}${suffix}`;
}

/**
 * Creates the exact metadata stored for one campaign batch. Returning undefined
 * means that this group must be split further; it never drops recipients or
 * targets to make a record fit.
 */
function campaignBatchParts(
  state: PrototypeState,
  subject: string,
  content: string,
  group: CampaignBatchGroup,
  requestId: string,
  batchFingerprint: string,
  batchIndex: number,
  batchTotal: number,
  expiringWithinDays?: number
): CampaignBatchParts | undefined {
  const targetsJSON = campaignTargetsJSON(group.targets);
  if (targetsJSON.length > MAX_TARGETS_JSON) return undefined;
  const brokerIds = group.brokers.map(broker => broker.id);
  const brokerChunks = chunkText(JSON.stringify(brokerIds));
  const brief: BrokerCampaignBrief = {
    subject,
    body: content,
    targets: group.targets.map(({ target, monthlyRentMinor, salePriceMinor }) =>
      targetBrief(target, monthlyRentMinor, salePriceMinor)
    ),
    recipients: group.brokers.map(recipientBrief),
    asOf: scenarioDate(state),
  };
  const briefChunks = chunkText(JSON.stringify(brief));
  const meta: Record<string, MetaValue> = {
    recordType: CAMPAIGN_RECORD_TYPE,
    saveRequestId: childRequestId(requestId, batchIndex, "campaign"),
    saveFingerprint: batchFingerprint,
    batchRequestId: requestId,
    batchFingerprint,
    batchIndex,
    batchTotal,
    content,
    targetsJSON,
    brokerIdsChunkCount: brokerChunks.length,
    targetCount: group.targets.length,
    brokerCount: group.brokers.length,
    campaignPurpose: group.purpose,
    previewStatus: "unsent-preview",
    imagePolicy: "local-preview-only",
    briefChunkCount: briefChunks.length,
    ...(expiringWithinDays === undefined ? {} : { expiringWithinDays }),
  };
  brokerChunks.forEach((chunk, index) => {
    meta[`brokerIdsChunk${index}`] = chunk;
  });
  briefChunks.forEach((chunk, index) => {
    meta[`briefChunk${index}`] = chunk;
  });
  try {
    assertMetadata(meta);
  } catch {
    return undefined;
  }
  return { meta, brief };
}

/**
 * Starts at the established 10-target/20-recipient UI limit, then recursively
 * splits only an overflowing Cartesian cell. This retains every target × broker
 * relationship, including with long names that consume extra brief chunks.
 */
function planCampaignBatchGroups(
  state: PrototypeState,
  title: string,
  content: string,
  selectedTargets: SelectedCampaignTarget[],
  purpose: "rent" | "sale",
  brokers: DemoEntity[],
  requestId: string,
  batchFingerprint: string,
  expiringWithinDays?: number
): CampaignBatchGroup[] {
  const sizingSubject = `${title} · الدفعة 500/500`;
  const groups: CampaignBatchGroup[] = [];
  const splitUntilFits = (
    targets: SelectedCampaignTarget[],
    recipients: DemoEntity[]
  ): void => {
    const candidate = campaignBatchParts(
      state,
      sizingSubject,
      content,
      { targets, brokers: recipients, purpose, title },
      requestId,
      batchFingerprint,
      500,
      500,
      expiringWithinDays
    );
    if (candidate) {
      groups.push({ targets, brokers: recipients, purpose, title });
      return;
    }
    if (targets.length === 1 && recipients.length === 1) {
      throw new Error(
        "لا يمكن حفظ الدفعة حتى بعد التجزئة بسبب سعة الميتاداتا؛ لم يُحذف أي هدف أو وسيط"
      );
    }
    if (
      recipients.length > 1 &&
      (recipients.length >= targets.length || targets.length === 1)
    ) {
      const [left, right] = splitHalf(recipients);
      splitUntilFits(targets, left);
      splitUntilFits(targets, right);
      return;
    }
    const [left, right] = splitHalf(targets);
    splitUntilFits(left, recipients);
    splitUntilFits(right, recipients);
  };

  for (const targets of splitEvery(selectedTargets, MAX_TARGETS)) {
    for (const recipients of splitEvery(brokers, MAX_BROKERS))
      splitUntilFits(targets, recipients);
  }
  return groups;
}

function savedBatchRetry(
  state: PrototypeState,
  requestId: string,
  targetIds: string[],
  brokerIds: string[]
): DemoEntity[] | undefined {
  const rows = state.entities.documents.filter(
    row =>
      row.meta.recordType === CAMPAIGN_RECORD_TYPE &&
      text(row.meta.batchRequestId) === requestId
  );
  if (rows.length) {
    const total = rows[0].meta.batchTotal;
    if (
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      total !== rows.length ||
      rows.some(
        row =>
          row.meta.batchTotal !== total ||
          typeof row.meta.batchIndex !== "number" ||
          !Number.isSafeInteger(row.meta.batchIndex) ||
          row.meta.batchIndex < 1 ||
          row.meta.batchIndex > total
      ) ||
      new Set(rows.map(row => row.meta.batchIndex)).size !== total
    ) {
      throw new Error(
        "سجل دفعات الحملة التاريخي غير مكتمل؛ لم تُنشأ دفعات إضافية"
      );
    }
    return [...rows].sort(
      (left, right) =>
        Number(left.meta.batchIndex) - Number(right.meta.batchIndex)
    );
  }

  // A one-document legacy save is a valid historical completion for the same
  // one-cell selection. It is never reused for a larger Cartesian request.
  const legacy = state.entities.documents.filter(
    row =>
      row.meta.recordType === CAMPAIGN_RECORD_TYPE &&
      text(row.meta.saveRequestId) === requestId
  );
  if (!legacy.length) return undefined;
  if (
    legacy.length !== 1 ||
    targetIds.length > MAX_TARGETS ||
    brokerIds.length > MAX_BROKERS ||
    JSON.stringify(
      campaignTargetsForPreview(legacy[0]).map(row => row.targetId)
    ) !== JSON.stringify(targetIds) ||
    JSON.stringify(campaignBrokerIds(legacy[0])) !== JSON.stringify(brokerIds)
  ) {
    throw new Error(
      "سبق تنفيذ معرف العملية ببيانات مختلفة أو بسجل تاريخي غير مكتمل؛ استخدم معرفًا جديدًا"
    );
  }
  return legacy;
}

function selectionsFromSavedBatches(
  campaigns: DemoEntity[],
  targetIds: string[],
  input: BrokerCampaignInput
): SelectedCampaignTarget[] {
  const snapshotsById = new Map<string, BrokerCampaignTargetSnapshot>();
  for (const campaign of campaigns) {
    for (const snapshot of campaignTargetsForPreview(campaign)) {
      const existing = snapshotsById.get(snapshot.targetId);
      if (
        existing &&
        (existing.purpose !== snapshot.purpose ||
          existing.monthlyRentMinor !== snapshot.monthlyRentMinor ||
          existing.salePriceMinor !== snapshot.salePriceMinor)
      ) {
        throw new Error(
          "سجل دفعات الحملة التاريخي يحتوي أسعارًا أو أهدافًا متعارضة"
        );
      }
      snapshotsById.set(snapshot.targetId, snapshot);
    }
  }
  if (snapshotsById.size !== targetIds.length) {
    throw new Error("سجل دفعات الحملة التاريخي لا يطابق الأهداف المحفوظة");
  }
  return targetIds.map(targetId => {
    const snapshot = snapshotsById.get(targetId);
    if (!snapshot)
      throw new Error("سجل دفعات الحملة التاريخي لا يطابق الأهداف المحفوظة");
    return selectionFromSnapshotInput(snapshot, input);
  });
}

function assertBatchCapacity(
  state: PrototypeState,
  documentsToAdd: number,
  operation: string
): void {
  if (
    state.entities.documents.length + documentsToAdd >
      MAX_ENTITY_ROWS_PER_KIND ||
    totalEntities(state.entities) + documentsToAdd > MAX_TOTAL_ENTITY_ROWS
  ) {
    throw new Error(
      `لا يمكن ${operation} لجميع الدفعات بسبب سعة الحالة؛ لم تُحفظ أي دفعة`
    );
  }
}

function assertBatchSnapshotCapacity(
  next: PrototypeState,
  operation: string
): void {
  if (serializedPrototypeBytes(next) > MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `لا يمكن ${operation} لجميع الدفعات بسبب حد حجم الحالة؛ لم تُحفظ أي دفعة`
    );
  }
}

/**
 * Atomically saves all Cartesian target × broker batches. The legacy single
 * campaign function remains intentionally limited to its original 10/20 UI
 * action; this function is the non-truncating selection path.
 */
export function saveBrokerCampaignBatches(
  state: PrototypeState,
  input: BrokerCampaignInput
): Transition<DemoEntity[]> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف حفظ الحملة");
  if (requestId.length > MAX_REQUEST_ID)
    throw new Error("معرف حفظ الحملة غير صالح");
  const requestedTitle = requiredText(
    input.title,
    "عنوان الحملة",
    MAX_CAMPAIGN_TITLE
  );
  const content = optionalText(
    input.content,
    "مقدمة الموجز",
    MAX_CAMPAIGN_CONTENT
  );
  const targetIds = uniqueIds(input.targetIds, "الأهداف", MAX_BATCH_SELECTIONS);
  const brokerIds = uniqueIds(input.brokerIds, "الوسطاء", MAX_BATCH_SELECTIONS);
  if (
    input.expiringWithinDays !== undefined &&
    (!Number.isSafeInteger(input.expiringWithinDays) ||
      !EXPIRING_WINDOWS.has(input.expiringWithinDays))
  ) {
    throw new Error("نافذة العقود القريبة يجب أن تكون 30 أو 60 أو 90 يومًا");
  }
  const retried = savedBatchRetry(state, requestId, targetIds, brokerIds);
  if (retried) {
    const retryTargets = selectionsFromSavedBatches(retried, targetIds, input);
    const expectedFingerprint = campaignFingerprint(
      requestedTitle,
      content,
      targetIds,
      brokerIds,
      retryTargets,
      input.expiringWithinDays
    );
    if (
      retried.some(
        campaign =>
          text(campaign.meta.batchFingerprint || campaign.meta.saveFingerprint) !==
          expectedFingerprint
      )
    ) {
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    }
    return { state, result: retried };
  }

  const latestTargets = campaignLatestTargets(state, input.expiringWithinDays);
  const selectedTargets = targetIds.map(targetId => {
    const latest = latestTargets.get(targetId);
    if (!latest) {
      throw new Error(
        "أحد الأهداف لم يعد شاغرًا أو صالحًا للحملة الحالية أو خرج من النطاق؛ حدّث المعاينة قبل الحفظ"
      );
    }
    return targetSelectionFromInput(latest, input, true);
  });
  const fingerprint = campaignFingerprint(
    requestedTitle,
    content,
    targetIds,
    brokerIds,
    selectedTargets,
    input.expiringWithinDays
  );
  const brokers = brokerIds.map(brokerId =>
    assertEligibleBroker(state, brokerId)
  );
  const purposes = [...new Set(selectedTargets.map(target => target.purpose))];
  const groups = purposes.flatMap(purpose =>
    planCampaignBatchGroups(
      state,
      campaignTitleForPurpose(
        requestedTitle,
        purpose,
        purposes.length > 1
      ),
      content,
      selectedTargets.filter(target => target.purpose === purpose),
      purpose,
      brokers,
      requestId,
      fingerprint,
      input.expiringWithinDays
    )
  );
  if (!groups.length) throw new Error("لا توجد دفعات صالحة للحفظ");
  assertBatchCapacity(state, groups.length, "حفظ الحملة");

  const campaigns = groups.map((group, offset) => {
    const batchIndex = offset + 1;
    const subject =
      groups.length === 1
        ? group.title
        : numberedBatchTitle(group.title, batchIndex, groups.length);
    const parts = campaignBatchParts(
      state,
      subject,
      content,
      group,
      requestId,
      fingerprint,
      batchIndex,
      groups.length,
      input.expiringWithinDays
    );
    if (!parts) {
      throw new Error(
        "تعذر تكوين إحدى الدفعات ضمن سعة الميتاداتا؛ لم تُحفظ أي دفعة"
      );
    }
    const campaignId = batchDocumentId(requestId, batchIndex, "campaign");
    if (state.entities.documents.some(row => row.id === campaignId)) {
      throw new Error(
        "يتعارض معرف دفعة تاريخية مع هذه المحاولة؛ استخدم معرفًا جديدًا"
      );
    }
    return {
      id: campaignId,
      title: subject,
      subtitle: "لقطة حملة محلية مجمدة · لا إرسال فعلي ولا مرفقات",
      portfolioId:
        state.settings.portfolioId === "all" ? "" : state.settings.portfolioId,
      propertyId: "",
      status: "معاينة غير مرسلة",
      date: scenarioDate(state),
      amountMinor: 0,
      currency: "QAR" as const,
      meta: parts.meta,
    };
  });
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      documents: [...state.entities.documents, ...campaigns],
    },
    audit: audit(
      state,
      "حفظ دفعات حملة وسطاء",
      `${requestedTitle} • ${campaigns.length} دفعات • ${selectedTargets.length} أهداف × ${brokers.length} وسطاء • لم تُرسل رسالة`
    ),
  };
  assertBatchSnapshotCapacity(next, "حفظ الحملة");
  return { state: next, result: campaigns };
}

function batchSimulationFingerprint(campaignIds: string[]): string {
  return hash(JSON.stringify({ campaignIds }));
}

function simulatedBatchRetry(
  state: PrototypeState,
  requestId: string,
  fingerprint: string,
  campaignIds: string[]
): DemoEntity[] | undefined {
  const rows = state.entities.documents.filter(
    row =>
      row.meta.recordType === DISPATCH_RECORD_TYPE &&
      text(row.meta.batchDispatchRequestId) === requestId
  );
  if (rows.length) {
    if (
      rows.some(row => text(row.meta.batchDispatchFingerprint) !== fingerprint)
    ) {
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرفًا جديدًا"
      );
    }
    const total = rows[0].meta.batchDispatchTotal;
    if (
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      total !== rows.length ||
      rows.some(
        row =>
          row.meta.batchDispatchTotal !== total ||
          typeof row.meta.batchDispatchIndex !== "number" ||
          !Number.isSafeInteger(row.meta.batchDispatchIndex) ||
          row.meta.batchDispatchIndex < 1 ||
          row.meta.batchDispatchIndex > total
      ) ||
      new Set(rows.map(row => row.meta.batchDispatchIndex)).size !== total
    ) {
      throw new Error(
        "سجل محاكاة الدفعات التاريخي غير مكتمل؛ لم تُنشأ محاكاة إضافية"
      );
    }
    return [...rows].sort(
      (left, right) =>
        Number(left.meta.batchDispatchIndex) -
        Number(right.meta.batchDispatchIndex)
    );
  }
  const legacy = state.entities.documents.filter(
    row =>
      row.meta.recordType === DISPATCH_RECORD_TYPE &&
      text(row.meta.dispatchRequestId) === requestId
  );
  if (!legacy.length) return undefined;
  const legacyFingerprint =
    campaignIds.length === 1
      ? hash(JSON.stringify({ campaignId: campaignIds[0] }))
      : "";
  if (
    legacy.length !== 1 ||
    text(legacy[0].meta.dispatchFingerprint) !== legacyFingerprint ||
    text(legacy[0].meta.campaignId) !== campaignIds[0]
  ) {
    throw new Error(
      "سبق تنفيذ معرف العملية ببيانات مختلفة أو بسجل تاريخي غير مكتمل؛ استخدم معرفًا جديدًا"
    );
  }
  return legacy;
}

/**
 * Simulates every requested saved batch in one all-or-nothing local transition.
 * It is deliberately storage-only: no SMTP, network, lease, occupancy, debt,
 * cash, or campaign mutation occurs.
 */
export function simulateBrokerCampaignBatches(
  state: PrototypeState,
  input: BrokerCampaignBatchesSimulationInput
): Transition<DemoEntity[]> {
  assertOperator(state);
  const requestId = id(input.requestId, "معرف محاكاة الإرسال");
  const campaignIds = uniqueIds(
    input.campaignIds,
    "معرفات الحملات",
    MAX_BATCH_SELECTIONS
  );
  const fingerprint = batchSimulationFingerprint(campaignIds);
  const retried = simulatedBatchRetry(
    state,
    requestId,
    fingerprint,
    campaignIds
  );
  if (retried) return { state, result: retried };

  const campaigns = campaignIds.map(campaignId => {
    const campaign = state.entities.documents.find(
      row =>
        row.id === campaignId && row.meta.recordType === CAMPAIGN_RECORD_TYPE
    );
    if (!campaign) throw new Error("الحملة غير موجودة");
    campaignInCurrentScope(state, campaign);
    const brief = getBrokerCampaignBrief(state, campaign);
    revalidateDispatch(state, campaign, brief);
    return { campaign, brief };
  });
  assertBatchCapacity(state, campaigns.length, "محاكاة الإرسال");
  const dispatches = campaigns.map(({ campaign, brief }, offset) => {
    const batchIndex = offset + 1;
    const meta: Record<string, MetaValue> = {
      recordType: DISPATCH_RECORD_TYPE,
      dispatchRequestId: childRequestId(requestId, batchIndex, "dispatch"),
      dispatchFingerprint: fingerprint,
      batchDispatchRequestId: requestId,
      batchDispatchFingerprint: fingerprint,
      batchDispatchIndex: batchIndex,
      batchDispatchTotal: campaigns.length,
      campaignId: campaign.id,
      dispatchStatus: "simulated-not-sent",
      recipientCount: brief.recipients.length,
      targetCount: brief.targets.length,
      simulatedAt: scenarioDate(state),
      channel: "local-simulation-only",
      ...recipientDispatchMeta(brief.recipients),
    };
    assertMetadata(meta);
    const dispatchId = batchDocumentId(requestId, batchIndex, "dispatch");
    if (state.entities.documents.some(row => row.id === dispatchId)) {
      throw new Error(
        "يتعارض معرف محاكاة تاريخية مع هذه المحاولة؛ استخدم معرفًا جديدًا"
      );
    }
    return {
      id: dispatchId,
      title: `محاكاة إرسال · ${brief.subject}`.slice(0, 256),
      subtitle: "محاكاة محلية غير مرسلة؛ لا SMTP ولا شبكة",
      portfolioId: campaign.portfolioId,
      propertyId: "",
      status: "simulated-not-sent",
      date: scenarioDate(state),
      amountMinor: 0,
      currency: "QAR" as const,
      meta,
    };
  });
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      documents: [...state.entities.documents, ...dispatches],
    },
    audit: audit(
      state,
      "محاكاة دفعات حملة وسطاء",
      `${campaigns.length} دفعات محلية غير مرسلة؛ لا SMTP ولا شبكة`
    ),
  };
  assertBatchSnapshotCapacity(next, "محاكاة الإرسال");
  return { state: next, result: dispatches };
}
