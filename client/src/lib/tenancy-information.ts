import {
  PROTOTYPE_DATE,
  toMinor,
  type DemoEntity,
  type EntityMap,
} from "@shared/prototype";

export type TenancyStatus =
  | "rented"
  | "vacant"
  | "partial"
  | "reserved"
  | "unavailable"
  | "unknown";
export type TenancySource = "lease" | "declaration" | "units" | "none";
export type TenancySummary = {
  status: TenancyStatus;
  label: string;
  source: TenancySource;
  locked: boolean;
  startDate?: string;
  endDate?: string;
  leaseId?: string;
  monthlyRentMinor?: number;
  monthlyRentCurrency?: string;
};

type DeclarationStatus = "rented" | "vacant";
type TenancyDeclaration = {
  v: 1;
  status: DeclarationStatus;
  startDate?: string;
  endDate?: string;
  monthlyRentMinor?: number;
};
type DatedLease = {
  lease: DemoEntity;
  startDate: string;
  endDate: string;
};
type UnitSummary = TenancySummary & { hasEvidence: boolean };

const EMPTY_FORM_VALUES: Record<string, string> = {
  tenancyStatus: "",
  tenancyStartDate: "",
  tenancyEndDate: "",
};
const MAX_DECLARATION_LENGTH = 1024;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveMinor(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 1_000_000_000_000
    ? value
    : undefined;
}

function parseDeclaredMonthlyRent(value: string): number | undefined {
  let normalized = value
    .trim()
    .replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - "۰".charCodeAt(0)))
    .replaceAll("٬", "")
    .replaceAll("٫", ".");
  if (!normalized) return undefined;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized))
    normalized = normalized.replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "الإيجار الشهري الحالي يجب أن يكون مبلغًا موجبًا بحد أقصى منزلتين عشريتين."
    );
  let minor: number;
  try {
    minor = toMinor(normalized);
  } catch {
    throw new Error(
      "الإيجار الشهري الحالي يجب أن يكون مبلغًا موجبًا بحد أقصى منزلتين عشريتين."
    );
  }
  if (positiveMinor(minor) === undefined)
    throw new Error(
      "الإيجار الشهري الحالي يجب أن يكون مبلغًا موجبًا ضمن الحد الآمن."
    );
  return minor;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function requireDate(value: string, label: string): string {
  if (!validDate(value)) throw new Error(`${label} غير صحيح`);
  return value;
}

function dateBefore(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseDeclaration(raw: unknown): TenancyDeclaration | undefined {
  if (typeof raw !== "string" || !raw || raw.length > MAX_DECLARATION_LENGTH)
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1 || (value.status !== "rented" && value.status !== "vacant"))
    return undefined;
  if (value.status === "vacant") return { v: 1, status: "vacant" };
  const startDate = text(value.startDate);
  const endDate = text(value.endDate);
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate)
    return undefined;
  if (
    value.monthlyRentMinor !== undefined &&
    positiveMinor(value.monthlyRentMinor) === undefined
  )
    return undefined;
  return {
    v: 1,
    status: "rented",
    startDate,
    endDate,
    ...(value.monthlyRentMinor !== undefined
      ? { monthlyRentMinor: value.monthlyRentMinor as number }
      : {}),
  };
}

function declarationFor(
  entity?: Pick<DemoEntity, "meta">
): TenancyDeclaration | undefined {
  return parseDeclaration(entity?.meta.tenancyDeclaration);
}

/** Returns safe string form values; malformed or over-limit metadata is ignored. */
export function getTenancyFormValues(
  entity?: Pick<DemoEntity, "meta">
): Record<string, string> {
  const declaration = declarationFor(entity);
  if (!declaration) return { ...EMPTY_FORM_VALUES };
  return {
    tenancyStatus: declaration.status,
    tenancyStartDate: declaration.startDate ?? "",
    tenancyEndDate: declaration.endDate ?? "",
    ...(declaration.monthlyRentMinor !== undefined
      ? { tenancyMonthlyRent: String(declaration.monthlyRentMinor / 100) }
      : {}),
  };
}

/**
 * Encodes a small, versioned metadata declaration. It is intentionally only a
 * declaration: callers decide where it is saved and it never creates a lease,
 * receivable, payment, or occupancy update.
 */
export function makeTenancyDeclaration(
  values: Record<string, string>,
  existing?: unknown
): string | undefined {
  const submittedMonthlyRent = Object.prototype.hasOwnProperty.call(
    values,
    "tenancyMonthlyRent"
  );
  values = {
    ...getTenancyFormValues({
      meta: {
        tenancyDeclaration: typeof existing === "string" ? existing : "",
      },
    }),
    ...values,
  };
  const status = text(values.tenancyStatus);
  if (
    submittedMonthlyRent &&
    status !== "rented" &&
    text(values.tenancyMonthlyRent)
  )
    throw new Error("اختر حالة مؤجر قبل تسجيل الإيجار الشهري الحالي.");
  if (!status) return undefined;
  if (status === "vacant") return JSON.stringify({ v: 1, status: "vacant" });
  if (status !== "rented") throw new Error("حالة التأجير غير صالحة");

  const startDate = requireDate(
    text(values.tenancyStartDate),
    "تاريخ بداية العقد"
  );
  const endDate = requireDate(text(values.tenancyEndDate), "تاريخ نهاية العقد");
  if (endDate < startDate)
    throw new Error("تاريخ نهاية العقد لا يمكن أن يسبق تاريخ البداية");
  const monthlyRentMinor = parseDeclaredMonthlyRent(
    text(values.tenancyMonthlyRent)
  );
  return JSON.stringify({
    v: 1,
    status: "rented",
    startDate,
    endDate,
    ...(monthlyRentMinor !== undefined ? { monthlyRentMinor } : {}),
  });
}

function isDraft(lease: DemoEntity): boolean {
  return /مسودة|مقترح|بانتظار|draft|pending/i.test(lease.status);
}

function isCancelled(lease: DemoEntity): boolean {
  return /ملغ|مرفوض|cancel|rejected/i.test(lease.status);
}

/**
 * Mirrors the lifecycle's activation convention while retaining ended records
 * as authoritative historical contracts. A draft or cancelled record is never
 * contract evidence for this display-only resolver.
 */
function isAuthoritativeLease(lease: DemoEntity): boolean {
  if (isDraft(lease) || isCancelled(lease)) return false;
  if (lease.meta.lifecycleActivated === true) return true;
  return /نافذ|نشط|مؤجر|مجد|منته|إنهاء|active|occupied|renewed|ended/i.test(
    lease.status
  );
}

function leaseDates(lease: DemoEntity): DatedLease | undefined {
  const startDate =
    text(lease.meta.startDate) || text(lease.meta.start) || text(lease.date);
  const naturalEnd = text(lease.meta.endDate) || text(lease.meta.end);
  if (!validDate(startDate) || !validDate(naturalEnd)) return undefined;

  const terminationDate = text(lease.meta.terminationEffectiveDate);
  if (terminationDate && !validDate(terminationDate)) return undefined;
  const endDate =
    terminationDate && terminationDate <= naturalEnd
      ? dateBefore(terminationDate)
      : naturalEnd;
  return { lease, startDate, endDate };
}

function validUnitScope(property: DemoEntity, unit: DemoEntity): boolean {
  return (
    Boolean(property.id) &&
    Boolean(property.portfolioId) &&
    unit.propertyId === property.id &&
    unit.portfolioId === property.portfolioId
  );
}

function isCanonicalWholeUnit(
  entities: EntityMap,
  property: DemoEntity,
  unitId: string
): boolean {
  return entities.units.some(
    unit =>
      unit.id === unitId &&
      unit.propertyId === property.id &&
      unit.portfolioId === property.portfolioId &&
      unit.meta.wholeProperty === true
  );
}

function leaseAppliesToTarget(
  entities: EntityMap,
  lease: DemoEntity,
  property: DemoEntity,
  unit?: DemoEntity
): boolean {
  if (
    lease.propertyId !== property.id ||
    lease.portfolioId !== property.portfolioId
  ) {
    return false;
  }
  if (!unit) return true;
  if (!validUnitScope(property, unit)) return false;

  const unitId = text(lease.meta.unitId);
  if (!unitId || unitId === unit.id) return true;
  return isCanonicalWholeUnit(entities, property, unitId);
}

function applicableLeases(
  entities: EntityMap,
  property: DemoEntity,
  unit?: DemoEntity
): DatedLease[] {
  return entities.leases.flatMap(lease => {
    if (
      !isAuthoritativeLease(lease) ||
      !leaseAppliesToTarget(entities, lease, property, unit)
    ) {
      return [];
    }
    const dates = leaseDates(lease);
    return dates ? [dates] : [];
  });
}

function sortByDate<T extends DatedLease>(
  rows: T[],
  key: "startDate" | "endDate",
  direction: "asc" | "desc"
): T[] {
  return [...rows].sort((left, right) => {
    const comparison = left[key].localeCompare(right[key]);
    if (comparison) return direction === "asc" ? comparison : -comparison;
    return left.lease.id.localeCompare(right.lease.id);
  });
}

function leaseLabel(status: TenancyStatus): string {
  if (status === "rented") return "مؤجر بعقد مسجل";
  if (status === "reserved") return "محجوز بعقد مسجل";
  return "غير مؤجر · عقد مسجل منتهٍ";
}

function summaryFromLease(
  leases: DatedLease[],
  asOf: string
): TenancySummary | undefined {
  if (!leases.length) return undefined;
  const current = sortByDate(
    leases.filter(row => row.startDate <= asOf && asOf <= row.endDate),
    "startDate",
    "desc"
  )[0];
  const future = sortByDate(
    leases.filter(row => row.startDate > asOf && row.endDate >= row.startDate),
    "startDate",
    "asc"
  )[0];
  const expired = sortByDate(
    leases.filter(row => !current && !future && row.endDate < asOf),
    "endDate",
    "desc"
  )[0];
  const selected =
    current ?? future ?? expired ?? sortByDate(leases, "endDate", "desc")[0];
  const monthlyRentMinor = Object.prototype.hasOwnProperty.call(
    selected.lease.meta,
    "rentMinor"
  )
    ? positiveMinor(selected.lease.meta.rentMinor)
    : positiveMinor(selected.lease.amountMinor);
  const status: TenancyStatus = current
    ? "rented"
    : future
      ? "reserved"
      : "vacant";
  return {
    status,
    label: leaseLabel(status),
    source: "lease",
    locked: true,
    startDate: selected.startDate,
    endDate: selected.endDate,
    leaseId: selected.lease.id,
    ...(monthlyRentMinor !== undefined
      ? { monthlyRentMinor, monthlyRentCurrency: selected.lease.currency }
      : {}),
  };
}

function declarationLabel(status: TenancyStatus): string {
  if (status === "rented") return "مؤجر · إدخال أولي";
  if (status === "reserved") return "محجوز · إدخال أولي";
  return "غير مؤجر · إدخال أولي";
}

function summaryFromDeclaration(
  declaration: TenancyDeclaration,
  asOf: string
): TenancySummary {
  if (declaration.status === "vacant") {
    return {
      status: "vacant",
      label: declarationLabel("vacant"),
      source: "declaration",
      locked: false,
    };
  }
  const status: TenancyStatus =
    declaration.startDate! > asOf
      ? "reserved"
      : declaration.endDate! < asOf
        ? "vacant"
        : "rented";
  return {
    status,
    label:
      status === "vacant"
        ? "غير مؤجر · إدخال أولي منتهٍ"
        : declarationLabel(status),
    source: "declaration",
    locked: false,
    startDate: declaration.startDate,
    endDate: declaration.endDate,
    ...(declaration.monthlyRentMinor !== undefined
      ? { monthlyRentMinor: declaration.monthlyRentMinor }
      : {}),
  };
}

function unavailable(entity: DemoEntity): boolean {
  return /غير متاح|قيد التجهيز|unavailable/i.test(entity.status);
}

function noContractSummary(entity?: DemoEntity): TenancySummary {
  if (entity && unavailable(entity)) {
    return {
      status: "unavailable",
      label: "غير متاحة للتأجير",
      source: "none",
      locked: false,
    };
  }
  return {
    status: "vacant",
    label: "لا يوجد عقد مسجل",
    source: "none",
    locked: false,
  };
}

function summaryForUnit(
  entities: EntityMap,
  property: DemoEntity,
  unit: DemoEntity,
  asOf: string
): UnitSummary {
  if (!validUnitScope(property, unit)) {
    return {
      status: "unknown",
      label: "تعذر التحقق من نطاق الوحدة",
      source: "none",
      locked: false,
      hasEvidence: false,
    };
  }
  const leaseSummary = summaryFromLease(
    applicableLeases(entities, property, unit),
    asOf
  );
  if (leaseSummary) return { ...leaseSummary, hasEvidence: true };

  const declaration = declarationFor(unit);
  if (declaration)
    return {
      ...summaryFromDeclaration(declaration, asOf),
      hasEvidence: true,
    };
  return { ...noContractSummary(unit), hasEvidence: false };
}

function splitPropertySummary(
  entities: EntityMap,
  property: DemoEntity,
  asOf: string
): TenancySummary | undefined {
  const physicalUnits = entities.units.filter(
    unit => validUnitScope(property, unit) && unit.meta.wholeProperty !== true
  );
  if (text(property.meta.rentalMode) !== "units" || !physicalUnits.length)
    return undefined;

  const summaries = physicalUnits.map(unit =>
    summaryForUnit(entities, property, unit, asOf)
  );
  if (!summaries.some(summary => summary.hasEvidence)) return undefined;

  const rentedCount = summaries.filter(
    summary => summary.status === "rented"
  ).length;
  const reservedCount = summaries.filter(
    summary => summary.status === "reserved"
  ).length;
  const unavailableCount = summaries.filter(
    summary => summary.status === "unavailable"
  ).length;
  const locked = summaries.some(summary => summary.locked);

  let status: TenancyStatus;
  let label: string;
  if (rentedCount === physicalUnits.length) {
    status = "rented";
    label = "كل الوحدات مؤجرة";
  } else if (rentedCount > 0) {
    status = "partial";
    label = "تأجير جزئي بين الوحدات";
  } else if (reservedCount === physicalUnits.length) {
    status = "reserved";
    label = "كل الوحدات محجوزة";
  } else if (reservedCount > 0 || unavailableCount > 0) {
    status = "partial";
    label = "حالات تأجير مختلفة بين الوحدات";
  } else {
    status = "vacant";
    label = "الوحدات غير مؤجرة";
  }

  // Deliberately omit dates and lease ids: combining unit dates would invent a
  // property-wide contract period that does not exist.
  return { status, label, source: "units", locked };
}

function validPropertyScope(property: DemoEntity): boolean {
  return Boolean(property.id) && Boolean(property.portfolioId);
}

/**
 * Resolves display status only. It does not call occupancy transitions and does
 * not mutate financial, lease, unit, or declaration records.
 */
export function getTenancySummary(
  entities: EntityMap,
  property: DemoEntity,
  unit?: DemoEntity,
  asOf = PROTOTYPE_DATE
): TenancySummary {
  const effectiveAsOf = text(asOf) || PROTOTYPE_DATE;
  if (!validDate(effectiveAsOf) || !validPropertyScope(property)) {
    return {
      status: "unknown",
      label: "تعذر تحديد حالة التأجير",
      source: "none",
      locked: false,
    };
  }
  if (unit) {
    const unitSummary = summaryForUnit(entities, property, unit, effectiveAsOf);
    if (unitSummary.status === "unknown") return unitSummary;

    // A physical unit has only its own declaration. The hidden whole-property
    // target is not a physical unit and may resolve the parent declaration.
    if (unit.meta.wholeProperty === true && !unitSummary.hasEvidence) {
      const leaseSummary = summaryFromLease(
        applicableLeases(entities, property, unit),
        effectiveAsOf
      );
      if (leaseSummary) return leaseSummary;
      const propertyDeclaration = declarationFor(property);
      if (propertyDeclaration)
        return summaryFromDeclaration(propertyDeclaration, effectiveAsOf);
    }
    return unitSummary;
  }

  const aggregate = splitPropertySummary(entities, property, effectiveAsOf);
  if (aggregate) return aggregate;

  const leaseSummary = summaryFromLease(
    applicableLeases(entities, property),
    effectiveAsOf
  );
  if (leaseSummary) return leaseSummary;
  const declaration = declarationFor(property);
  if (declaration) return summaryFromDeclaration(declaration, effectiveAsOf);
  return noContractSummary(property);
}
