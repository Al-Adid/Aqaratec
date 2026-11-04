import {
  PROTOTYPE_DATE,
  isMinorAmount,
  toMinor,
  type AuditEvent,
  type DemoEntity,
  type EntityMap,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { getTemplateLeaseView } from "./lease-template-engine";

/**
 * Pure transitions for lease, receivable-calendar, and vacancy state. They are
 * intentionally independent of React/storage; callers commit them through
 * PrototypeContext.commitTransition so each operation remains atomic.
 */

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 256;
const MAX_ENTITIES_PER_KIND = 1000;
const MAX_AUDIT_EVENTS = 300;
const MAX_META_ENTRIES = 32;
const MAX_META_KEY_LENGTH = 64;
const MAX_META_TEXT_LENGTH = 1024;

type Transition<T> = { state: PrototypeState; result: T };
type LeaseTarget = {
  property: DemoEntity;
  unit?: DemoEntity;
  unitId: string;
};

type LeaseTerms = LeaseTarget & {
  startDate: string;
  endDate: string;
  rentMinor: number;
  tenant: DemoEntity;
  tenantId: string;
  tenantName: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metaText(meta: Record<string, MetaValue>, key: string): string {
  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `lease-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function fingerprint(values: Record<string, string>, keys: string[]): string {
  return hash(
    JSON.stringify(
      Object.fromEntries(keys.map(key => [key, text(values[key])]))
    )
  );
}

/** Keeps lifecycle-generated rows inside the shared 32-key/1KiB metadata contract. */
function assertLifecycleMetadata(meta: Record<string, MetaValue>): void {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_ENTRIES)
    throw new Error("بيانات السجل تتجاوز حد 32 حقلاً في نسخة التجربة");
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_META_KEY_LENGTH)
      throw new Error("اسم حقل بيانات السجل غير صالح");
    if (typeof value === "string" && value.length > MAX_META_TEXT_LENGTH)
      throw new Error("قيمة بيانات السجل تتجاوز الحد المسموح");
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("قيمة بيانات السجل غير صالحة");
  }
}

function mergeLifecycleMeta(
  current: Record<string, MetaValue>,
  changes: Record<string, MetaValue>
): Record<string, MetaValue> {
  const next = { ...current, ...changes };
  assertLifecycleMetadata(next);
  return next;
}

function assertStateShape(state: PrototypeState): void {
  if (!state || typeof state !== "object" || state.version !== 1)
    throw new Error("حالة البروتوتايب غير صالحة");
  if (!state.entities || !state.settings || !Array.isArray(state.audit))
    throw new Error("حالة البروتوتايب غير مكتملة");
  for (const kind of [
    "portfolios",
    "properties",
    "units",
    "tenants",
    "leases",
    "receivables",
    "collections",
    "losses",
    "vacancies",
  ] as const) {
    if (!Array.isArray(state.entities[kind]))
      throw new Error("سجلات البروتوتايب غير مكتملة");
  }
}

function assertOperator(state: PrototypeState): void {
  assertStateShape(state);
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function assertEntityCapacity(
  state: PrototypeState,
  kind: keyof EntityMap,
  additions = 1
): void {
  if (state.entities[kind].length + additions > MAX_ENTITIES_PER_KIND)
    throw new Error("يتجاوز الإجراء حد سجلات نسخة التجربة");
}

function assertDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} غير صحيح`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} غير صحيح`);
  }
  return value;
}

function optionalDate(value: string, label: string): string {
  return value ? assertDate(value, label) : "";
}

function assertDateRange(startDate: string, endDate: string): void {
  if (endDate < startDate)
    throw new Error("تاريخ النهاية لا يمكن أن يسبق تاريخ البداية");
}

function utcDateParts(value: string): [number, number, number] {
  return value.split("-").map(Number) as [number, number, number];
}

function dateBefore(value: string): string {
  const [year, month, day] = utcDateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function monthDueDate(startDate: string, offset: number): string {
  const [year, month, day] = utcDateParts(startDate);
  const targetMonth = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(targetYear, targetMonthIndex, Math.min(day, lastDay))
  )
    .toISOString()
    .slice(0, 10);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function requestId(values: Record<string, string>, label: string): string {
  const value = text(values.requestId);
  if (value.length > MAX_REQUEST_ID_LENGTH)
    throw new Error(`${label} غير صالح`);
  return value;
}

function requireTitle(values: Record<string, string>, fallback = ""): string {
  const title = text(values.title) || fallback;
  if (!title) throw new Error("عنوان السجل مطلوب");
  if (title.length > MAX_TITLE_LENGTH)
    throw new Error("عنوان السجل يتجاوز الحد المسموح");
  return title;
}

function parseMinor(
  values: Record<string, string>,
  keys: string[],
  label: string,
  defaultValue?: number
): number {
  const raw = keys.map(key => text(values[key])).find(Boolean);
  if (!raw && defaultValue !== undefined) return defaultValue;
  if (!raw) throw new Error(`${label} مطلوب`);
  try {
    const parsed = toMinor(raw);
    if (!isMinorAmount(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error(
      `${label} غير صالح؛ أدخل مبلغًا موجبًا بمنزلتين عشريتين كحد أقصى`
    );
  }
}

function findProperty(state: PrototypeState, propertyId: string): DemoEntity {
  const property = state.entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار غير موجود");
  if (
    state.settings.portfolioId !== "all" &&
    property.portfolioId !== state.settings.portfolioId
  ) {
    throw new Error("العقار المختار خارج نطاق المحفظة الحالي");
  }
  return property;
}

function resolveTarget(
  state: PrototypeState,
  property: DemoEntity,
  requestedUnitId: string,
  requireUnitForSplit = true
): LeaseTarget {
  const propertyUnits = state.entities.units.filter(
    row =>
      row.propertyId === property.id && row.portfolioId === property.portfolioId
  );
  let unitId = requestedUnitId;
  const rentalMode = metaText(property.meta, "rentalMode");
  if (!unitId && rentalMode === "whole") {
    const targets = propertyUnits.filter(
      row => row.meta.wholeProperty === true
    );
    if (targets.length !== 1)
      throw new Error(
        "العقار المؤجر بالكامل يحتاج هدف تأجير داخليًا واحدًا صالحًا"
      );
    unitId = targets[0].id;
  }
  if (!unitId && rentalMode === "units" && requireUnitForSplit)
    throw new Error("اختر وحدة صالحة للعقار المقسم إلى وحدات");

  if (!unitId) return { property, unitId: "" };
  const unit = state.entities.units.find(row => row.id === unitId);
  if (!unit) throw new Error("الوحدة غير موجودة ضمن نطاق المحفظة الحالي");
  if (
    unit.propertyId !== property.id ||
    unit.portfolioId !== property.portfolioId
  ) {
    throw new Error("الوحدة المختارة يجب أن تتبع العقار والمحفظة نفسيهما");
  }
  if (rentalMode === "whole" && unit.meta.wholeProperty !== true)
    throw new Error("الوحدة المختارة لا تمثل العقار المؤجر بالكامل");
  return { property, unit, unitId };
}

function assertTenantBinding(
  state: PrototypeState,
  target: LeaseTarget,
  tenantId: string,
  tenantName = ""
): { tenant: DemoEntity; tenantName: string } {
  const tenant = state.entities.tenants.find(row => row.id === tenantId);
  if (!tenant) throw new Error("المستأجر غير موجود");
  if (
    tenant.propertyId !== target.property.id ||
    tenant.portfolioId !== target.property.portfolioId
  ) {
    throw new Error("المستأجر المحدد يجب أن يتبع العقار والمحفظة نفسيهما");
  }
  const assignedUnitId = metaText(tenant.meta, "unitId");
  if (assignedUnitId && target.unitId && assignedUnitId !== target.unitId)
    throw new Error(
      "المستأجر مرتبط بوحدة أخرى؛ صحح ربط المستأجر قبل تفعيل العقد"
    );
  return { tenant, tenantName: tenantName || tenant.title };
}

function leaseStartDate(lease: DemoEntity): string {
  const date =
    metaText(lease.meta, "startDate") ||
    metaText(lease.meta, "start") ||
    lease.date;
  return assertDate(date, "تاريخ بداية العقد");
}

function leaseEndDate(lease: DemoEntity): string {
  const date = metaText(lease.meta, "endDate") || metaText(lease.meta, "end");
  if (!date) throw new Error("تاريخ نهاية العقد مطلوب قبل تفعيل العقد");
  return assertDate(date, "تاريخ نهاية العقد");
}

function leaseTerminationDate(lease: DemoEntity): string {
  const value = metaText(lease.meta, "terminationEffectiveDate");
  return value ? assertDate(value, "تاريخ إنهاء العقد") : "";
}

function leaseUnitId(lease: DemoEntity): string {
  return metaText(lease.meta, "unitId");
}

function targetForLease(state: PrototypeState, lease: DemoEntity): LeaseTarget {
  const property = findProperty(state, lease.propertyId);
  return resolveTarget(state, property, leaseUnitId(lease), false);
}

function isDraft(lease: DemoEntity): boolean {
  return /مسودة|مقترح|بانتظار/.test(lease.status);
}

function isEnded(lease: DemoEntity): boolean {
  return /منته|ملغ|مرفوض/.test(lease.status);
}

function isActivatedLease(lease: DemoEntity): boolean {
  return (
    lease.meta.lifecycleActivated === true ||
    (!isDraft(lease) &&
      !isEnded(lease) &&
      /نافذ|نشط|مؤجر|مجد/.test(lease.status))
  );
}

function actualEndDate(lease: DemoEntity): string {
  const naturalEnd = leaseEndDate(lease);
  const termination = leaseTerminationDate(lease);
  if (!termination) return naturalEnd;
  return termination <= naturalEnd ? dateBefore(termination) : naturalEnd;
}

function leaseIsActiveAt(lease: DemoEntity, asOf: string): boolean {
  if (!isActivatedLease(lease)) return false;
  const start = leaseStartDate(lease);
  const end = actualEndDate(lease);
  return start <= asOf && asOf <= end;
}

function wholePropertyTarget(
  state: PrototypeState,
  lease: DemoEntity
): boolean {
  const unitId = leaseUnitId(lease);
  if (!unitId) return true;
  return state.entities.units.some(
    unit => unit.id === unitId && unit.meta.wholeProperty === true
  );
}

function sameSubject(
  state: PrototypeState,
  left: DemoEntity,
  right: DemoEntity
): boolean {
  if (left.propertyId !== right.propertyId) return false;
  const leftUnitId = leaseUnitId(left);
  const rightUnitId = leaseUnitId(right);
  if (!leftUnitId || !rightUnitId) return true;
  if (wholePropertyTarget(state, left) || wholePropertyTarget(state, right))
    return true;
  return leftUnitId === rightUnitId;
}

function appliesToUnit(
  entities: EntityMap,
  record: DemoEntity,
  unit: DemoEntity
): boolean {
  if (
    record.propertyId !== unit.propertyId ||
    record.portfolioId !== unit.portfolioId
  ) {
    return false;
  }
  const assignedUnitId = metaText(record.meta, "unitId");
  if (!assignedUnitId || assignedUnitId === unit.id) return true;
  return entities.units.some(
    candidate =>
      candidate.id === assignedUnitId &&
      candidate.propertyId === unit.propertyId &&
      candidate.meta.wholeProperty === true
  );
}

function vacancyIsEffectiveAt(vacancy: DemoEntity, asOf: string): boolean {
  const start = metaText(vacancy.meta, "startDate") || vacancy.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > asOf) return false;
  const end = metaText(vacancy.meta, "endDate");
  if (end) return asOf < end;
  return vacancy.status !== "منتهٍ";
}

/**
 * Returns a date-effective occupancy state without depending on a stored unit
 * label. This is the single export for finance/property consumers; a future
 * lease is a reservation, while only an effective activated lease is occupied.
 */
export function unitOccupancyAt(
  entities: EntityMap,
  unitId: string,
  asOf: string
): "occupied" | "vacant" | "reserved" | "unavailable" {
  const effectiveDate = assertDate(asOf, "تاريخ الإشغال");
  const unit = entities.units.find(row => row.id === text(unitId));
  if (!unit) return "unavailable";

  if (
    entities.leases.some(
      lease =>
        isActivatedLease(lease) &&
        appliesToUnit(entities, lease, unit) &&
        leaseIsActiveAt(lease, effectiveDate)
    )
  ) {
    return "occupied";
  }

  if (
    entities.vacancies.some(
      vacancy =>
        appliesToUnit(entities, vacancy, unit) &&
        vacancyIsEffectiveAt(vacancy, effectiveDate)
    )
  ) {
    return "vacant";
  }

  if (/غير متاح|قيد التجهيز|unavailable/i.test(unit.status))
    return "unavailable";

  if (
    entities.leases.some(lease => {
      if (!isActivatedLease(lease) || !appliesToUnit(entities, lease, unit))
        return false;
      const start = leaseStartDate(lease);
      return start > effectiveDate && actualEndDate(lease) >= start;
    }) ||
    /محجوز|reserved/i.test(unit.status)
  ) {
    return "reserved";
  }

  // A legacy manual “rented” label is not evidence of an effective lease.
  return "vacant";
}

function rangesOverlap(left: DemoEntity, right: DemoEntity): boolean {
  const leftStart = leaseStartDate(left);
  const rightStart = leaseStartDate(right);
  const leftEnd = actualEndDate(left);
  const rightEnd = actualEndDate(right);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function assertNoEffectiveOverlap(
  state: PrototypeState,
  candidate: DemoEntity,
  ignoredLeaseId = ""
): void {
  const conflict = state.entities.leases.find(
    lease =>
      lease.id !== ignoredLeaseId &&
      lease.id !== candidate.id &&
      isActivatedLease(lease) &&
      sameSubject(state, lease, candidate) &&
      rangesOverlap(lease, candidate)
  );
  if (conflict)
    throw new Error("يوجد عقد نافذ متداخل على الوحدة أو العقار نفسه");
}

function audit(
  state: PrototypeState,
  title: string,
  detail: string,
  asOf: string
): AuditEvent[] {
  return [
    {
      id: newId(),
      // The scenario date is an explicit business-date input, not an audit clock.
      at: new Date().toISOString(),
      title,
      detail: `${detail} • تاريخ الأثر: ${asOf}`.slice(0, MAX_META_TEXT_LENGTH),
    },
    ...state.audit,
  ].slice(0, MAX_AUDIT_EVENTS);
}

function stateWith(
  state: PrototypeState,
  entities: EntityMap,
  title: string,
  detail: string,
  asOf: string
): PrototypeState {
  return { ...state, entities, audit: audit(state, title, detail, asOf) };
}

function entityForLease(
  lease: DemoEntity,
  target: LeaseTarget,
  dueDate: string
): DemoEntity {
  const cycleKey = `${lease.id}:${monthKey(dueDate)}`;
  const meta: Record<string, MetaValue> = {
    leaseId: lease.id,
    unitId: target.unitId,
    tenantId: metaText(lease.meta, "tenantId"),
    tenant: metaText(lease.meta, "tenantName") || lease.subtitle,
    due: dueDate,
    leaseCycleKey: cycleKey,
    calendar: "UTC",
    source: "جدول عقد دوري",
  };
  assertLifecycleMetadata(meta);
  return {
    id: newId(),
    title: `استحقاق إيجار ${monthKey(dueDate)} • ${lease.title}`,
    subtitle: metaText(lease.meta, "tenantName") || lease.subtitle,
    portfolioId: target.property.portfolioId,
    propertyId: target.property.id,
    status: "مستحق",
    date: dueDate,
    amountMinor: lease.amountMinor,
    currency: "QAR",
    meta,
  };
}

function dueDates(lease: DemoEntity): string[] {
  const start = leaseStartDate(lease);
  const end = leaseEndDate(lease);
  assertDateRange(start, end);
  const result: string[] = [];
  // 120 years is already well above any supported prototype lease. The guard
  // avoids an accidental unbounded loop if data was corrupted.
  for (let offset = 0; offset <= 1440; offset += 1) {
    const due = monthDueDate(start, offset);
    if (due > end) break;
    result.push(due);
  }
  if (!result.length || result.length > 1200)
    throw new Error("تعذر إنشاء جدول الاستحقاقات ضمن حد البروتوتايب");
  return result;
}

function existingCycleKeys(entities: EntityMap, leaseId: string): Set<string> {
  const keys = new Set<string>();
  for (const row of entities.receivables) {
    if (metaText(row.meta, "leaseId") !== leaseId) continue;
    const explicit = metaText(row.meta, "leaseCycleKey");
    if (explicit) keys.add(explicit);
    const due = metaText(row.meta, "due") || row.date;
    if (/^\d{4}-\d{2}/.test(due)) keys.add(`${leaseId}:${monthKey(due)}`);
  }
  return keys;
}

function isCancelledReceivable(row: DemoEntity): boolean {
  return row.status === "ملغى" || row.meta.cancelled === true;
}

function isActiveIssuedBillingDocument(
  row: DemoEntity,
  receivableId: string
): boolean {
  const kind = metaText(row.meta, "kind");
  return (
    row.meta.recordType === "billing-document" &&
    (kind === "invoice" || kind === "payment-request") &&
    metaText(row.meta, "receivableId") === receivableId &&
    !/ملغ|cancel/i.test(row.status)
  );
}

function settlementBlockers(
  state: PrototypeState,
  rows: DemoEntity[]
): string[] {
  const dueIds = new Set(rows.map(row => row.id));
  const blockers: string[] = [];
  if (
    state.entities.collections.some(row =>
      dueIds.has(metaText(row.meta, "receivableId"))
    )
  ) {
    blockers.push("تحصيل/دفعة مقدمة");
  }
  if (
    state.entities.losses.some(row =>
      dueIds.has(metaText(row.meta, "receivableId"))
    )
  ) {
    blockers.push("خسارة مسجلة");
  }
  if (
    state.entities.documents.some(row =>
      [...dueIds].some(dueId => isActiveIssuedBillingDocument(row, dueId))
    )
  ) {
    blockers.push("فاتورة أو مطالبة صادرة");
  }
  return blockers;
}

/** Fails before a transition commits: this module does not create cash/credit settlements. */
function assertDuesHaveNoSettlement(
  state: PrototypeState,
  rows: DemoEntity[],
  action: string
): void {
  const blockers = settlementBlockers(state, rows);
  if (blockers.length) {
    throw new Error(
      `لا يمكن ${action} لأن الذمم المتأثرة مرتبطة بـ${blockers.join(" و")}؛ نفّذ تسوية صريحة مستقلة أولاً دون حذف التاريخ`
    );
  }
}

function duesFrom(
  state: PrototypeState,
  leaseId: string,
  effectiveDate: string
): DemoEntity[] {
  return state.entities.receivables.filter(row => {
    if (metaText(row.meta, "leaseId") !== leaseId) return false;
    const dueDate = metaText(row.meta, "due") || row.date;
    return dueDate >= effectiveDate && !isCancelledReceivable(row);
  });
}

function cancellationMeta(
  row: DemoEntity,
  leaseId: string,
  reason: string,
  effectiveDate: string,
  asOf: string
): Record<string, MetaValue> {
  return mergeLifecycleMeta(row.meta, {
    cancelled: true,
    cancellationReason: reason,
    cancellationEffectiveDate: effectiveDate,
    cancelledAt: asOf,
    cancelledByLeaseId: leaseId,
  });
}

function cancelDuesFrom(
  state: PrototypeState,
  leaseId: string,
  effectiveDate: string,
  reason: string,
  asOf: string
): DemoEntity[] {
  const cancellable = duesFrom(state, leaseId, effectiveDate);
  assertDuesHaveNoSettlement(state, cancellable, "إلغاء ذمم العقد");
  const cancellableIds = new Set(cancellable.map(row => row.id));
  return state.entities.receivables.map(row =>
    cancellableIds.has(row.id)
      ? {
          ...row,
          status: "ملغى",
          meta: cancellationMeta(row, leaseId, reason, effectiveDate, asOf),
        }
      : row
  );
}

function reinstateDuesBefore(
  state: PrototypeState,
  leaseId: string,
  effectiveDate: string,
  reason: string,
  asOf: string
): DemoEntity[] {
  const reinstatable = state.entities.receivables.filter(row => {
    if (metaText(row.meta, "leaseId") !== leaseId) return false;
    const dueDate = metaText(row.meta, "due") || row.date;
    return (
      dueDate < effectiveDate &&
      isCancelledReceivable(row) &&
      metaText(row.meta, "cancelledByLeaseId") === leaseId
    );
  });
  assertDuesHaveNoSettlement(state, reinstatable, "إعادة ذمم العقد الملغاة");
  const ids = new Set(reinstatable.map(row => row.id));
  return state.entities.receivables.map(row =>
    ids.has(row.id)
      ? {
          ...row,
          status: "مستحق",
          meta: mergeLifecycleMeta(row.meta, {
            cancelled: false,
            reinstatedAt: asOf,
            reinstatementReason: reason,
          }),
        }
      : row
  );
}

function reconcileCalendar(
  state: PrototypeState,
  asOf: string
): { state: PrototypeState; changes: number } {
  const leases = state.entities.leases.map(lease => {
    const termination = metaText(lease.meta, "terminationEffectiveDate");
    if (
      isActivatedLease(lease) &&
      termination &&
      termination <= asOf &&
      lease.status !== "منتهٍ"
    ) {
      return { ...lease, status: "منتهٍ" };
    }
    return lease;
  });
  let changes = leases.reduce(
    (total, row, index) =>
      total + (row === state.entities.leases[index] ? 0 : 1),
    0
  );
  const temporary = {
    ...state,
    entities: { ...state.entities, leases },
  };
  const units = temporary.entities.units.map(unit => {
    const occupancy = unitOccupancyAt(temporary.entities, unit.id, asOf);
    // “Unavailable” is a real unit condition, so do not replace a richer
    // historical label such as “قيد التجهيز” merely by refreshing leases.
    if (occupancy === "unavailable") return unit;
    const nextStatus =
      occupancy === "occupied"
        ? "مؤجرة"
        : occupancy === "reserved"
          ? "محجوزة"
          : "شاغرة";
    if (unit.status === nextStatus) return unit;
    changes += 1;
    return { ...unit, status: nextStatus };
  });
  if (!changes) return { state, changes: 0 };
  return {
    state: { ...temporary, entities: { ...temporary.entities, units } },
    changes,
  };
}

function validLeaseTerms(state: PrototypeState, lease: DemoEntity): LeaseTerms {
  const target = targetForLease(state, lease);
  const startDate = leaseStartDate(lease);
  const endDate = leaseEndDate(lease);
  assertDateRange(startDate, endDate);
  const rentMinor = isMinorAmount(lease.meta.rentMinor)
    ? Number(lease.meta.rentMinor)
    : lease.amountMinor;
  if (!isMinorAmount(rentMinor) || rentMinor <= 0)
    throw new Error("قيمة الإيجار مطلوبة ويجب أن تكون مبلغًا موجبًا صحيحًا");
  const tenantId = metaText(lease.meta, "tenantId");
  if (!tenantId) throw new Error("ربط المستأجر مطلوب قبل تفعيل العقد");
  const binding = assertTenantBinding(
    state,
    target,
    tenantId,
    metaText(lease.meta, "tenantName") || metaText(lease.meta, "tenant")
  );
  return {
    ...target,
    startDate,
    endDate,
    rentMinor,
    tenant: binding.tenant,
    tenantId,
    tenantName: binding.tenantName,
  };
}

function operationRetry(
  rows: DemoEntity[],
  request: string,
  requestKey: string,
  fingerprintKey: string,
  expectedFingerprint: string
): DemoEntity | undefined {
  if (!request) return undefined;
  const previous = rows.find(row => metaText(row.meta, requestKey) === request);
  if (!previous) return undefined;
  const actual = metaText(previous.meta, fingerprintKey);
  if (actual && actual !== expectedFingerprint)
    throw new Error(
      "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
    );
  return previous;
}

function ensureLeaseScope(state: PrototypeState, lease: DemoEntity): void {
  const property = findProperty(state, lease.propertyId);
  if (lease.portfolioId !== property.portfolioId)
    throw new Error("ربط العقد بالعقار والمحفظة غير متسق");
}

/**
 * A template-derived lease is not evidence-bearing merely because it has a flag
 * or an old document ID. Its immutable instance must belong to this lease and
 * match the template version selected for the current draft.
 */
function assertCurrentTemplateSnapshot(
  state: PrototypeState,
  lease: DemoEntity
): void {
  const requiresSnapshot =
    lease.meta.newTemplateSnapshotRequired === true ||
    Boolean(metaText(lease.meta, "templateId"));
  if (!requiresSnapshot) return;

  const templateId = metaText(lease.meta, "templateId");
  const templateVersion = lease.meta.templateVersion;
  const snapshotDocumentId = metaText(lease.meta, "snapshotDocumentId");
  if (!templateId || !snapshotDocumentId) {
    throw new Error(
      "يلزم توليد وثيقة تجديد جديدة من القالب قبل التفعيل؛ لا تكفي علامة أو وثيقة الإصدار السابق"
    );
  }
  if (
    typeof templateVersion !== "number" ||
    !Number.isSafeInteger(templateVersion) ||
    templateVersion < 1
  ) {
    throw new Error("إصدار قالب العقد الحالي غير صالح قبل التفعيل");
  }

  let snapshot;
  try {
    snapshot = getTemplateLeaseView(state.entities, lease.id);
  } catch {
    throw new Error(
      "وثيقة القالب المطلوبة للتفعيل غير موجودة أو غير مكتملة لعقد التجديد الحالي"
    );
  }
  if (
    snapshot.document.id !== snapshotDocumentId ||
    metaText(snapshot.document.meta, "leaseId") !== lease.id ||
    metaText(snapshot.document.meta, "templateId") !== templateId ||
    snapshot.templateVersion !== templateVersion
  ) {
    throw new Error(
      "وثيقة القالب لا تطابق عقد التجديد أو إصدار القالب الحالي؛ ولّد لقطة جديدة قبل التفعيل"
    );
  }
}

/** Creates a validated lease draft. It does not create cash, dues, or occupancy. */
export function createLease(
  state: PrototypeState,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const request = requestId(values, "معرف إنشاء العقد");
  const requestFingerprint = fingerprint(values, [
    "title",
    "propertyId",
    "unitId",
    "tenantId",
    "tenantName",
    "startDate",
    "endDate",
    "rent",
    "rentMinor",
  ]);
  const retried = operationRetry(
    state.entities.leases,
    request,
    "createRequestId",
    "createFingerprint",
    requestFingerprint
  );
  if (retried) return { state, result: retried };

  const title = requireTitle(values);
  const property = findProperty(state, text(values.propertyId));
  const target = resolveTarget(state, property, text(values.unitId));
  const startDate = assertDate(text(values.startDate), "تاريخ بداية العقد");
  const endDate = assertDate(text(values.endDate), "تاريخ نهاية العقد");
  assertDateRange(startDate, endDate);
  const rentMinor = parseMinor(values, ["rent", "rentMinor"], "قيمة الإيجار");
  if (rentMinor <= 0)
    throw new Error("قيمة الإيجار مطلوبة ويجب أن تكون مبلغًا موجبًا صحيحًا");

  let tenant: DemoEntity;
  let tenantName = text(values.tenantName);
  const selectedTenantId = text(values.tenantId);
  if (selectedTenantId) {
    const binding = assertTenantBinding(state, target, selectedTenantId);
    tenant = binding.tenant;
    tenantName = binding.tenantName;
  } else {
    if (!tenantName)
      throw new Error("اختر مستأجرًا قائمًا أو أدخل اسم مستأجر جديد للعقد");
    if (tenantName.length > MAX_TITLE_LENGTH)
      throw new Error("اسم المستأجر يتجاوز الحد المسموح");
    assertEntityCapacity(state, "tenants");
    tenant = {
      id: newId(),
      title: tenantName,
      subtitle: "ملف مستأجر صوري أنشئ مع العقد",
      portfolioId: property.portfolioId,
      propertyId: property.id,
      status: "مسودة",
      date: startDate,
      amountMinor: 0,
      currency: "QAR",
      meta: { unitId: target.unitId, source: "إنشاء عقد تجريبي" },
    };
  }
  assertEntityCapacity(state, "leases");
  const leaseMeta: Record<string, MetaValue> = {
    tenantId: tenant.id,
    tenantName,
    tenant: tenantName,
    unitId: target.unitId,
    startDate,
    endDate,
    rentMinor,
    rentLabel: text(values.rent) || text(values.rentMinor),
    registrationStatus: "غير متحقق",
    signedStatus: "مسودة غير موقعة",
    version: 1,
    lifecycleActivated: false,
  };
  if (request) {
    leaseMeta.createRequestId = request;
    leaseMeta.createFingerprint = requestFingerprint;
  }
  assertLifecycleMetadata(leaseMeta);
  const lease: DemoEntity = {
    id: newId(),
    title,
    subtitle: tenantName,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: startDate,
    amountMinor: rentMinor,
    currency: "QAR",
    meta: leaseMeta,
  };
  const entities: EntityMap = {
    ...state.entities,
    tenants: selectedTenantId
      ? state.entities.tenants
      : [...state.entities.tenants, tenant],
    leases: [...state.entities.leases, lease],
  };
  return {
    state: stateWith(
      state,
      entities,
      "إنشاء مسودة عقد",
      `${lease.title} • لا إشغال ولا تحصيل حتى التفعيل الصريح`,
      startDate
    ),
    result: lease,
  };
}

/** Activates a valid draft and creates one dated receivable per contract month. */
export function activateLease(
  state: PrototypeState,
  leaseId: string,
  asOf: string
): Transition<DemoEntity> {
  assertOperator(state);
  const effectiveAsOf = assertDate(
    asOf || scenarioDate(state),
    "تاريخ التفعيل"
  );
  const lease = state.entities.leases.find(row => row.id === text(leaseId));
  if (!lease) throw new Error("العقد غير موجود");
  ensureLeaseScope(state, lease);
  if (isActivatedLease(lease)) return { state, result: lease };

  assertCurrentTemplateSnapshot(state, lease);
  const terms = validLeaseTerms(state, lease);
  assertNoEffectiveOverlap(state, lease, lease.id);
  const dues = dueDates(lease);
  const cycles = existingCycleKeys(state.entities, lease.id);
  const createdDues = dues
    .filter(due => !cycles.has(`${lease.id}:${monthKey(due)}`))
    .map(due => entityForLease(lease, terms, due));
  assertEntityCapacity(state, "receivables", createdDues.length);

  const activated: DemoEntity = {
    ...lease,
    status: "نافذ",
    amountMinor: terms.rentMinor,
    meta: mergeLifecycleMeta(lease.meta, {
      tenantName: terms.tenantName,
      rentMinor: terms.rentMinor,
      lifecycleActivated: true,
      activatedAt: effectiveAsOf,
    }),
  };
  const entities: EntityMap = {
    ...state.entities,
    tenants: state.entities.tenants.map(row =>
      row.id === terms.tenant.id && row.status === "مسودة"
        ? { ...row, status: "نشط" }
        : row
    ),
    leases: state.entities.leases.map(row =>
      row.id === activated.id ? activated : row
    ),
    receivables: [...state.entities.receivables, ...createdDues],
  };
  const calendar = reconcileCalendar({ ...state, entities }, effectiveAsOf);
  const result = calendar.state.entities.leases.find(
    row => row.id === lease.id
  )!;
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "تفعيل عقد",
      `${lease.title} • أنشئت ${createdDues.length} استحقاقات دورية دون تسجيل قبض`,
      effectiveAsOf
    ),
    result,
  };
}

/** Re-derives unit occupancy from dates; no background scheduling is used. */
export function refreshLeaseCalendar(
  state: PrototypeState,
  asOf = ""
): Transition<number> {
  assertOperator(state);
  const effectiveAsOf = assertDate(
    asOf || scenarioDate(state),
    "تاريخ تحديث التقويم"
  );
  const refreshed = reconcileCalendar(state, effectiveAsOf);
  if (!refreshed.changes) return { state, result: 0 };
  return {
    state: stateWith(
      state,
      refreshed.state.entities,
      "تحديث تقويم العقود",
      `تحديث حالة ${refreshed.changes} سجلًا كما في ${effectiveAsOf}`,
      effectiveAsOf
    ),
    result: refreshed.changes,
  };
}

function requiredReason(values: Record<string, string>, label: string): string {
  const reason = text(values.reason);
  if (!reason) throw new Error(`${label} مطلوب`);
  if (reason.length > MAX_META_TEXT_LENGTH)
    throw new Error(`${label} يتجاوز الحد المسموح`);
  return reason;
}

function terminationStatus(effectiveDate: string, asOf: string): string {
  return effectiveDate <= asOf ? "منتهٍ" : "إنهاء مجدول";
}

/** Stores a dated termination after rejecting any AR that needs an explicit settlement. */
export function terminateLease(
  state: PrototypeState,
  leaseId: string,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const lease = state.entities.leases.find(row => row.id === text(leaseId));
  if (!lease) throw new Error("العقد غير موجود");
  ensureLeaseScope(state, lease);
  const effectiveDate = assertDate(
    text(values.effectiveDate) || text(values.endDate),
    "تاريخ الإنهاء"
  );
  const asOf = assertDate(
    text(values.asOf) || scenarioDate(state),
    "تاريخ الأثر الحالي"
  );
  if (effectiveDate < leaseStartDate(lease))
    throw new Error("تاريخ الإنهاء لا يمكن أن يسبق تاريخ بداية العقد");
  const request = requestId(values, "معرف إنهاء العقد");
  const actionFingerprint = fingerprint(values, [
    "effectiveDate",
    "endDate",
    "reason",
    "asOf",
  ]);
  if (request && metaText(lease.meta, "terminationRequestId") === request) {
    const known = metaText(lease.meta, "terminationFingerprint");
    if (known && known !== actionFingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    return { state, result: lease };
  }
  if (leaseTerminationDate(lease))
    throw new Error(
      "الإنهاء مسجل بالفعل؛ استخدم إجراء تصحيح الإنهاء أو عكس الإنهاء"
    );

  const reason = requiredReason(values, "سبب الإنهاء");
  const receivables = cancelDuesFrom(
    state,
    lease.id,
    effectiveDate,
    reason,
    asOf
  );
  const terminated: DemoEntity = {
    ...lease,
    status: terminationStatus(effectiveDate, asOf),
    meta: mergeLifecycleMeta(lease.meta, {
      terminationEffectiveDate: effectiveDate,
      terminationReason: reason,
      terminationRecordedAt: asOf,
      ...(request
        ? {
            terminationRequestId: request,
            terminationFingerprint: actionFingerprint,
          }
        : {}),
    }),
  };
  const entities: EntityMap = {
    ...state.entities,
    leases: state.entities.leases.map(row =>
      row.id === lease.id ? terminated : row
    ),
    receivables,
  };
  const calendar = reconcileCalendar({ ...state, entities }, asOf);
  const result = calendar.state.entities.leases.find(
    row => row.id === lease.id
  )!;
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "إنهاء عقد",
      `${lease.title} • الأثر ${effectiveDate} • ألغيت الذمم غير المسوّاة فقط دون حذف تاريخ`,
      asOf
    ),
    result,
  };
}

/** Corrects an existing termination through a dated, reasoned, independently audited transition. */
export function correctLeaseTermination(
  state: PrototypeState,
  leaseId: string,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const lease = state.entities.leases.find(row => row.id === text(leaseId));
  if (!lease) throw new Error("العقد غير موجود");
  ensureLeaseScope(state, lease);
  if (!leaseTerminationDate(lease))
    throw new Error("لا يوجد إنهاء مسجل لتصحيحه");
  const effectiveDate = assertDate(
    text(values.effectiveDate) || text(values.endDate),
    "تاريخ التصحيح"
  );
  if (effectiveDate < leaseStartDate(lease))
    throw new Error("تاريخ التصحيح لا يمكن أن يسبق تاريخ بداية العقد");
  const asOf = assertDate(
    text(values.asOf) || scenarioDate(state),
    "تاريخ أثر التصحيح"
  );
  const reason = requiredReason(values, "سبب تصحيح الإنهاء");
  const request = requestId(values, "معرف تصحيح الإنهاء");
  const actionFingerprint = fingerprint(values, [
    "effectiveDate",
    "endDate",
    "reason",
    "asOf",
  ]);
  if (
    request &&
    metaText(lease.meta, "terminationCorrectionRequestId") === request
  ) {
    const known = metaText(lease.meta, "terminationCorrectionFingerprint");
    if (known && known !== actionFingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    return { state, result: lease };
  }

  // First revive only those cancelled solely by this lease, then cancel the
  // newly affected tail. Both helpers validate all financial blockers first.
  const reinstated = reinstateDuesBefore(
    state,
    lease.id,
    effectiveDate,
    reason,
    asOf
  );
  const afterReinstatement: PrototypeState = {
    ...state,
    entities: { ...state.entities, receivables: reinstated },
  };
  const receivables = cancelDuesFrom(
    afterReinstatement,
    lease.id,
    effectiveDate,
    reason,
    asOf
  );
  const corrected: DemoEntity = {
    ...lease,
    status: terminationStatus(effectiveDate, asOf),
    meta: mergeLifecycleMeta(lease.meta, {
      terminationEffectiveDate: effectiveDate,
      terminationReason: reason,
      terminationRecordedAt: asOf,
      terminationCorrectionEffectiveDate: effectiveDate,
      terminationCorrectionReason: reason,
      terminationCorrectionRecordedAt: asOf,
      ...(request
        ? {
            terminationCorrectionRequestId: request,
            terminationCorrectionFingerprint: actionFingerprint,
          }
        : {}),
    }),
  };
  const entities: EntityMap = {
    ...state.entities,
    leases: state.entities.leases.map(row =>
      row.id === lease.id ? corrected : row
    ),
    receivables,
  };
  const calendar = reconcileCalendar({ ...state, entities }, asOf);
  const result = calendar.state.entities.leases.find(
    row => row.id === lease.id
  )!;
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "تصحيح إنهاء عقد",
      `${lease.title} • صُحح الأثر إلى ${effectiveDate} دون تعديل قبض أو وثيقة صادرة`,
      asOf
    ),
    result,
  };
}

/** Undoes a recorded termination through a dated, reasoned, independently audited transition. */
export function undoLeaseTermination(
  state: PrototypeState,
  leaseId: string,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const lease = state.entities.leases.find(row => row.id === text(leaseId));
  if (!lease) throw new Error("العقد غير موجود");
  ensureLeaseScope(state, lease);
  const previousEffectiveDate = leaseTerminationDate(lease);
  if (!previousEffectiveDate) throw new Error("لا يوجد إنهاء مسجل لعكسه");
  const asOf = assertDate(
    text(values.asOf) || scenarioDate(state),
    "تاريخ أثر عكس الإنهاء"
  );
  const reason = requiredReason(values, "سبب عكس الإنهاء");
  const request = requestId(values, "معرف عكس الإنهاء");
  const actionFingerprint = fingerprint(values, ["reason", "asOf"]);
  if (request && metaText(lease.meta, "terminationUndoRequestId") === request) {
    const known = metaText(lease.meta, "terminationUndoFingerprint");
    if (known && known !== actionFingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    return { state, result: lease };
  }

  const receivables = reinstateDuesBefore(
    state,
    lease.id,
    "9999-12-31",
    reason,
    asOf
  );
  const {
    terminationEffectiveDate: _terminationEffectiveDate,
    terminationReason: _terminationReason,
    terminationRecordedAt: _terminationRecordedAt,
    terminationRequestId: _terminationRequestId,
    terminationFingerprint: _terminationFingerprint,
    ...preservedMeta
  } = lease.meta;
  const restored: DemoEntity = {
    ...lease,
    status: isActivatedLease(lease) ? "نافذ" : lease.status,
    meta: mergeLifecycleMeta(preservedMeta, {
      lastTerminationEffectiveDate: previousEffectiveDate,
      terminationUndoneAt: asOf,
      terminationUndoReason: reason,
      ...(request
        ? {
            terminationUndoRequestId: request,
            terminationUndoFingerprint: actionFingerprint,
          }
        : {}),
    }),
  };
  const entities: EntityMap = {
    ...state.entities,
    leases: state.entities.leases.map(row =>
      row.id === lease.id ? restored : row
    ),
    receivables,
  };
  const calendar = reconcileCalendar({ ...state, entities }, asOf);
  const result = calendar.state.entities.leases.find(
    row => row.id === lease.id
  )!;
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "عكس إنهاء عقد",
      `${lease.title} • أعيدت الذمم الملغاة غير المسوّاة فقط دون تعديل قبض أو وثيقة صادرة`,
      asOf
    ),
    result,
  };
}

/** Creates a successor lease version and atomically cancels its predecessor's affected open AR. */
export function renewLease(
  state: PrototypeState,
  leaseId: string,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const previous = state.entities.leases.find(row => row.id === text(leaseId));
  if (!previous) throw new Error("العقد السابق غير موجود");
  ensureLeaseScope(state, previous);
  const request = requestId(values, "معرف تجديد العقد");
  const actionFingerprint = fingerprint(values, [
    "title",
    "startDate",
    "endDate",
    "rent",
    "rentMinor",
    "tenantId",
    "terminatePrevious",
    "newTemplateStep",
  ]);
  const retried = operationRetry(
    state.entities.leases.filter(
      row => metaText(row.meta, "priorLeaseId") === previous.id
    ),
    request,
    "renewalRequestId",
    "renewalFingerprint",
    actionFingerprint
  );
  if (retried) return { state, result: retried };

  const startDate = assertDate(text(values.startDate), "تاريخ بداية التجديد");
  const endDate = assertDate(text(values.endDate), "تاريخ نهاية التجديد");
  assertDateRange(startDate, endDate);
  const priorTermination = leaseTerminationDate(previous);
  const mustEndPrior = priorTermination
    ? priorTermination > startDate
    : leaseEndDate(previous) >= startDate;
  const explicitlyEndPrior =
    text(values.terminatePrevious) === "confirm" ||
    text(values.endPreviousAtStart) === "confirm";
  const usesTemplate = Boolean(
    metaText(previous.meta, "templateId") ||
      metaText(previous.meta, "snapshotDocumentId")
  );
  if (usesTemplate && text(values.newTemplateStep) !== "confirm") {
    throw new Error(
      "أنشئ لقطة شروط جديدة من القالب في خطوة مستقلة؛ لا يمكن استعمال وثيقة الإصدار السابق كوثيقة حالية"
    );
  }
  const asOf = scenarioDate(state);
  let priorForState = previous;
  if (mustEndPrior) {
    if (!explicitlyEndPrior)
      throw new Error(
        "أنه العقد السابق صراحة قبل بدء الإصدار الجديد لتجنب التداخل"
      );
    priorForState = {
      ...previous,
      status: terminationStatus(startDate, asOf),
      meta: mergeLifecycleMeta(previous.meta, {
        terminationEffectiveDate: startDate,
        terminationReason: "تجديد بإصدار لاحق",
        terminationRecordedAt: asOf,
      }),
    };
  }

  const property = findProperty(state, previous.propertyId);
  const target = resolveTarget(state, property, leaseUnitId(previous), false);
  const tenantId = text(values.tenantId) || metaText(previous.meta, "tenantId");
  const binding = assertTenantBinding(
    state,
    target,
    tenantId,
    text(values.tenantName) ||
      metaText(previous.meta, "tenantName") ||
      previous.subtitle
  );
  const existingRent = isMinorAmount(previous.meta.rentMinor)
    ? Number(previous.meta.rentMinor)
    : previous.amountMinor;
  const rentMinor = parseMinor(
    values,
    ["rent", "rentMinor"],
    "قيمة التجديد",
    existingRent
  );
  if (rentMinor <= 0)
    throw new Error("قيمة التجديد يجب أن تكون مبلغًا موجبًا صحيحًا");
  assertEntityCapacity(state, "leases");

  // This is intentionally before any constructed next state. Collections,
  // losses, and issued billing documents require an explicit settlement owned
  // by the financial flow; they are never deleted or silently carried forward.
  const receivables = cancelDuesFrom(
    state,
    previous.id,
    startDate,
    "تجديد بإصدار لاحق",
    asOf
  );

  const rootLeaseId = metaText(previous.meta, "rootLeaseId") || previous.id;
  const previousVersion = Number(previous.meta.version);
  const version =
    Number.isSafeInteger(previousVersion) && previousVersion > 0
      ? previousVersion + 1
      : 2;
  const successorMeta: Record<string, MetaValue> = {
    tenantId: binding.tenant.id,
    tenantName: binding.tenantName,
    tenant: binding.tenantName,
    unitId: target.unitId,
    startDate,
    endDate,
    rentMinor,
    rentLabel: text(values.rent) || text(values.rentMinor),
    registrationStatus: "غير متحقق",
    signedStatus: "مسودة غير موقعة",
    version,
    rootLeaseId,
    priorLeaseId: previous.id,
    historicalLeaseRef: previous.id,
    lifecycleActivated: false,
    renewalFingerprint: actionFingerprint,
    ...(usesTemplate ? { newTemplateSnapshotRequired: true } : {}),
    ...(request ? { renewalRequestId: request } : {}),
  };
  assertLifecycleMetadata(successorMeta);
  const successor: DemoEntity = {
    id: newId(),
    title: requireTitle(values, `${previous.title} · إصدار ${version}`),
    subtitle: binding.tenantName,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: startDate,
    amountMinor: rentMinor,
    currency: "QAR",
    meta: successorMeta,
  };
  const linkedPrior: DemoEntity = {
    ...priorForState,
    meta: mergeLifecycleMeta(priorForState.meta, {
      renewalSuccessorId: successor.id,
    }),
  };
  const intermediate: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      leases: state.entities.leases.map(row =>
        row.id === previous.id ? linkedPrior : row
      ),
      receivables,
    },
  };
  assertNoEffectiveOverlap(intermediate, successor, successor.id);
  const entities: EntityMap = {
    ...intermediate.entities,
    leases: [...intermediate.entities.leases, successor],
  };
  return {
    state: stateWith(
      state,
      entities,
      "إنشاء إصدار تجديد عقد",
      `${previous.title} ← ${successor.title} • سُويت الذمم المفتوحة الخارجة دون حذف تاريخ`,
      startDate
    ),
    result: successor,
  };
}

/** Creates a vacancy only when its target has no active effective lease on its start date. */
export function createLeaseVacancy(
  state: PrototypeState,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const request = requestId(values, "معرف إنشاء الشغور");
  const actionFingerprint = fingerprint(values, [
    "title",
    "propertyId",
    "unitId",
    "startDate",
    "expectedReadyDate",
    "reason",
    "preparation",
    "lostIncome",
  ]);
  const retried = operationRetry(
    state.entities.vacancies,
    request,
    "createVacancyRequestId",
    "createVacancyFingerprint",
    actionFingerprint
  );
  if (retried) return { state, result: retried };

  const property = findProperty(state, text(values.propertyId));
  const target = resolveTarget(state, property, text(values.unitId), false);
  const startDate = assertDate(
    text(values.startDate) || scenarioDate(state),
    "تاريخ بداية الشغور"
  );
  const expectedReadyDate = optionalDate(
    text(values.expectedReadyDate),
    "تاريخ الجاهزية المتوقع"
  );
  if (expectedReadyDate && expectedReadyDate < startDate)
    throw new Error("تاريخ الجاهزية المتوقع لا يمكن أن يسبق بداية الشغور");
  const lostIncomeMinor = parseMinor(
    values,
    ["lostIncome"],
    "تقدير الدخل الضائع",
    0
  );
  const candidate: DemoEntity = {
    id: "vacancy-candidate",
    title: "",
    subtitle: "",
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "شاغر",
    date: startDate,
    amountMinor: lostIncomeMinor,
    currency: "QAR",
    meta: { unitId: target.unitId },
  };
  const conflict = state.entities.leases.find(
    lease =>
      leaseIsActiveAt(lease, startDate) && sameSubject(state, lease, candidate)
  );
  if (conflict)
    throw new Error("لا يمكن تسجيل شغور لوحدة عليها عقد نافذ في تاريخ البداية");

  assertEntityCapacity(state, "vacancies");
  const vacancyMeta: Record<string, MetaValue> = {
    unitId: target.unitId,
    reason: text(values.reason),
    startDate,
    expectedReadyDate,
    preparation: text(values.preparation),
    lostIncomeLabel: text(values.lostIncome) || "0",
    lostIncomeMinor,
    treatment: "دخل ضائع تقديري · لا إيراد ولا ذمة",
  };
  if (request) {
    vacancyMeta.createVacancyRequestId = request;
    vacancyMeta.createVacancyFingerprint = actionFingerprint;
  }
  assertLifecycleMetadata(vacancyMeta);
  const vacancy: DemoEntity = {
    ...candidate,
    id: newId(),
    title: requireTitle(values),
    subtitle: text(values.reason) || "سبب شغور تجريبي",
    meta: vacancyMeta,
  };
  const entities: EntityMap = {
    ...state.entities,
    vacancies: [...state.entities.vacancies, vacancy],
  };
  // A future vacancy is recorded now, but it cannot rewrite today's occupancy.
  const calendar = reconcileCalendar(
    { ...state, entities },
    scenarioDate(state)
  );
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "تسجيل شغور",
      `${vacancy.title} • تقدير تشغيلي فقط دون إيراد أو ذمة`,
      startDate
    ),
    result: vacancy,
  };
}

/** Ends a vacancy and sets the unit from a real lease effective on that date, if any. */
export function endLeaseVacancy(
  state: PrototypeState,
  vacancyId: string,
  values: Record<string, string>
): Transition<DemoEntity> {
  assertOperator(state);
  const vacancy = state.entities.vacancies.find(
    row => row.id === text(vacancyId)
  );
  if (!vacancy) throw new Error("سجل الشغور غير موجود");
  const request = requestId(values, "معرف إنهاء الشغور");
  const actionFingerprint = fingerprint(values, ["endDate", "note"]);
  if (vacancy.status === "منتهٍ") {
    if (request && metaText(vacancy.meta, "endVacancyRequestId") === request) {
      const known = metaText(vacancy.meta, "endVacancyFingerprint");
      if (known && known !== actionFingerprint)
        throw new Error(
          "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
        );
      return { state, result: vacancy };
    }
    throw new Error("سجل الشغور محدد كمنتهٍ بالفعل");
  }
  const property = findProperty(state, vacancy.propertyId);
  if (vacancy.portfolioId !== property.portfolioId)
    throw new Error("ربط سجل الشغور بالعقار والمحفظة غير متسق");
  const target = resolveTarget(
    state,
    property,
    metaText(vacancy.meta, "unitId"),
    false
  );
  const startDate = assertDate(
    metaText(vacancy.meta, "startDate") ||
      metaText(vacancy.meta, "since") ||
      vacancy.date,
    "تاريخ بداية الشغور"
  );
  const endDate = assertDate(
    text(values.endDate) || scenarioDate(state),
    "تاريخ إنهاء الشغور"
  );
  if (endDate < startDate)
    throw new Error("تاريخ إنهاء الشغور لا يمكن أن يسبق تاريخ البداية");
  if (request && metaText(vacancy.meta, "endVacancyRequestId") === request) {
    const known = metaText(vacancy.meta, "endVacancyFingerprint");
    if (known && known !== actionFingerprint)
      throw new Error(
        "سبق تنفيذ معرف العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    return { state, result: vacancy };
  }

  const ended: DemoEntity = {
    ...vacancy,
    status: "منتهٍ",
    meta: mergeLifecycleMeta(vacancy.meta, {
      endDate,
      closeNote: text(values.note),
      ...(request
        ? {
            endVacancyRequestId: request,
            endVacancyFingerprint: actionFingerprint,
          }
        : {}),
    }),
  };
  const entities: EntityMap = {
    ...state.entities,
    vacancies: state.entities.vacancies.map(row =>
      row.id === vacancy.id ? ended : row
    ),
  };
  const calendar = reconcileCalendar(
    { ...state, entities },
    scenarioDate(state)
  );
  const occupancy = target.unit
    ? unitOccupancyAt(
        calendar.state.entities,
        target.unit.id,
        scenarioDate(state)
      )
    : "vacant";
  return {
    state: stateWith(
      state,
      calendar.state.entities,
      "إنهاء شغور",
      occupancy === "occupied"
        ? `${vacancy.title} • الإشغال الحالي مستمد من عقد نافذ لا من إغلاق الشغور`
        : `${vacancy.title} • لا يوجد عقد نافذ حالي؛ لا تُضبط الوحدة «مؤجرة»`,
      endDate
    ),
    result: ended,
  };
}
