import { unitOccupancyAt } from "./prototype-lease-lifecycle";
import {
  CONFIRMED_COLLECTION_STATUSES,
  DemoEntity,
  EntityMap,
  PROTOTYPE_DATE,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { inPrototypePeriod } from "./prototype-period";

const CANCELLED_STATUSES = new Set(["ملغى", "ملغي", "ملغاة", "cancelled"]);

type FinancialEventKind =
  | "receivable"
  | "collection"
  | "expense"
  | "loss"
  | "journal";

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ar");
}

function dateOnOrBefore(date: string, asOf: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= asOf;
}

/** A cancelled/reversed prototype record stays visible in its source history but is never an active financial event. */
export function isCancelledFinancialRecord(row: DemoEntity): boolean {
  return (
    CANCELLED_STATUSES.has(normalized(row.status)) ||
    row.meta.cancelled === true ||
    row.meta.reversed === true
  );
}

export function confirmed(row: DemoEntity): boolean {
  return (
    !isCancelledFinancialRecord(row) &&
    CONFIRMED_COLLECTION_STATUSES.includes(row.status)
  );
}

export function isOccupiedUnit(row: DemoEntity): boolean {
  return ["مشغولة", "مؤجرة"].includes(row.status.trim());
}

export function isActiveReceivable(row: DemoEntity): boolean {
  return !isCancelledFinancialRecord(row);
}

/**
 * The explicit sourceEventId identifies one economic event represented in more
 * than one local record (for example, an interest expense plus its explanatory
 * journal). Records without it remain independent through a namespaced ID.
 */
export function sourceEventId(
  row: DemoEntity,
  kind: FinancialEventKind | string = "record"
): string {
  const explicit = String(
    row.meta.sourceEventId ?? row.meta.sourceEventRef ?? ""
  ).trim();
  return explicit ? `event:${explicit}` : `${kind}:${row.id}`;
}

/** A display reference never changes the source-event identity. */
export function sourceEventReference(
  row: DemoEntity,
  fallback: string
): string {
  return String(
    row.meta.sourceEventRef ??
      row.meta.sourceEventId ??
      row.meta.reference ??
      fallback
  ).trim();
}

/**
 * Keeps the first local representation of every event. Callers choose a stable
 * order deliberately; this avoids inventing a source priority from timestamps.
 */
export function uniqueSourceEvents<T extends DemoEntity>(
  rows: T[],
  kind: FinancialEventKind | string
): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = sourceEventId(row, kind);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function isCapitalExpense(row: DemoEntity): boolean {
  const classification = normalized(row.meta.classification);
  const category = normalized(row.meta.category);
  return (
    classification === "رأسمالي" ||
    classification === "capital" ||
    category === "رأسمالي" ||
    category === "capital" ||
    category === "تحسين رأسمالي"
  );
}

function linkedCollections(
  entities: EntityMap,
  receivableId: string,
  asOf?: string
): DemoEntity[] {
  return uniqueSourceEvents(
    entities.collections.filter(
      row =>
        row.meta.receivableId === receivableId &&
        confirmed(row) &&
        (!asOf || dateOnOrBefore(row.date, asOf))
    ),
    "collection"
  );
}

function linkedLosses(
  entities: EntityMap,
  receivableId: string,
  asOf?: string
): DemoEntity[] {
  return uniqueSourceEvents(
    entities.losses.filter(
      row =>
        row.meta.receivableId === receivableId &&
        !isCancelledFinancialRecord(row) &&
        (!asOf || dateOnOrBefore(row.date, asOf))
    ),
    "loss"
  );
}

function outstandingBalance(
  entities: EntityMap,
  source: DemoEntity,
  asOf?: string
): number {
  if (!isActiveReceivable(source)) return 0;
  if (asOf && !dateOnOrBefore(source.date, asOf)) return 0;
  const paid = linkedCollections(entities, source.id, asOf).reduce(
    (total, row) => total + row.amountMinor,
    0
  );
  const lost = linkedLosses(entities, source.id, asOf).reduce(
    (total, row) => total + row.amountMinor,
    0
  );
  return Math.max(0, source.amountMinor - paid - lost);
}

/**
 * Legacy current-balance API. It intentionally remains unbounded by date so
 * existing receipt and collection callers retain their established meaning.
 */
export function outstandingFor(entities: EntityMap, id: string): number {
  const source = entities.receivables.find(row => row.id === id);
  return source ? outstandingBalance(entities, source) : 0;
}

/** Balance of one receivable using events effective on or before the supplied scenario date. */
export function outstandingForAsOf(
  entities: EntityMap,
  id: string,
  asOf = PROTOTYPE_DATE
): number {
  const source = entities.receivables.find(row => row.id === id);
  return source ? outstandingBalance(entities, source, scenarioDate(asOf)) : 0;
}

/** Last calendar day of a report period, using the injected scenario date for presets. */
export function periodClosingDate(
  period: string,
  asOf = PROTOTYPE_DATE
): string {
  const reference = scenarioDate(asOf);
  const raw = period.trim();
  let year: number;
  let month: number;

  if (/^\d{4}-\d{2}$/.test(raw)) {
    year = Number(raw.slice(0, 4));
    month = Number(raw.slice(5, 7));
  } else if (/^\d{4}$/.test(raw)) {
    return `${raw}-12-31`;
  } else if (/^\d{4}-Q[1-4]$/.test(raw)) {
    year = Number(raw.slice(0, 4));
    month = Number(raw.slice(-1)) * 3;
  } else if (raw === "month") {
    year = Number(reference.slice(0, 4));
    month = Number(reference.slice(5, 7));
  } else if (raw === "quarter") {
    year = Number(reference.slice(0, 4));
    month = Math.ceil(Number(reference.slice(5, 7)) / 3) * 3;
  } else if (raw === "year") {
    return `${reference.slice(0, 4)}-12-31`;
  } else {
    return reference;
  }

  if (month < 1 || month > 12) return reference;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Closing receivable balance for the selected period. Later receipts, losses,
 * or recoveries cannot alter this historical number.
 */
export function periodClosingOutstanding(
  entities: EntityMap,
  portfolioId: string,
  period: string,
  asOf = PROTOTYPE_DATE
): number {
  const closingAsOf = periodClosingDate(period, asOf);
  return uniqueSourceEvents(
    entities.receivables.filter(
      row =>
        (portfolioId === "all" || row.portfolioId === portfolioId) &&
        isActiveReceivable(row) &&
        inPrototypePeriod(row.date, period, scenarioDate(asOf))
    ),
    "receivable"
  ).reduce(
    (total, row) => total + outstandingBalance(entities, row, closingAsOf),
    0
  );
}

/** Receivable balance for records in a report period, as known on the supplied date. */
export function currentAsOfOutstanding(
  entities: EntityMap,
  portfolioId: string,
  period: string,
  asOf = PROTOTYPE_DATE
): number {
  const currentAsOf = scenarioDate(asOf);
  return uniqueSourceEvents(
    entities.receivables.filter(
      row =>
        (portfolioId === "all" || row.portfolioId === portfolioId) &&
        isActiveReceivable(row) &&
        inPrototypePeriod(row.date, period, currentAsOf)
    ),
    "receivable"
  ).reduce(
    (total, row) => total + outstandingBalance(entities, row, currentAsOf),
    0
  );
}

/**
 * Prototype financial summary, not a production GL. The original three-argument
 * form remains supported; asOf is an optional declared scenario date for dated
 * movement and newly exposed historical/current balance fields.
 */
export function financialSummary(
  entities: EntityMap,
  portfolioId: string,
  period: string,
  asOf = PROTOTYPE_DATE
) {
  const currentAsOf = scenarioDate(asOf);
  const scoped = (row: DemoEntity) =>
    portfolioId === "all" || row.portfolioId === portfolioId;
  const inPeriod = (row: DemoEntity) =>
    inPrototypePeriod(row.date, period, currentAsOf) &&
    dateOnOrBefore(row.date, currentAsOf);
  const selected = (rows: DemoEntity[]) => rows.filter(scoped);
  const add = (rows: DemoEntity[]) =>
    rows.reduce((total, row) => total + row.amountMinor, 0);
  const portfolios = selected(entities.portfolios);
  const collections = uniqueSourceEvents(
    selected(entities.collections).filter(confirmed),
    "collection"
  );
  const paidExpenses = uniqueSourceEvents(
    selected(entities.expenses).filter(
      row => row.status === "مسدد" && !isCancelledFinancialRecord(row)
    ),
    "expense"
  ).map(row => ({
    ...row,
    date:
      typeof row.meta.paidDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.meta.paidDate)
        ? row.meta.paidDate
        : row.date,
  }));
  const activeReceivables = uniqueSourceEvents(
    selected(entities.receivables).filter(isActiveReceivable),
    "receivable"
  );
  const periodReceivables = activeReceivables.filter(inPeriod);
  const losses = uniqueSourceEvents(
    selected(entities.losses).filter(row => !isCancelledFinancialRecord(row)),
    "loss"
  );
  const openingMinor = portfolios.reduce(
    (total, row) => total + Number(row.meta.openingMinor ?? row.amountMinor),
    0
  );
  const cashMinor = openingMinor + add(collections) - add(paidExpenses);
  const cashAsOfMinor =
    openingMinor +
    add(collections.filter(row => dateOnOrBefore(row.date, currentAsOf))) -
    add(paidExpenses.filter(row => dateOnOrBefore(row.date, currentAsOf)));
  const incomeMinor = add(
    collections.filter(
      row => inPeriod(row) && !Boolean(row.meta.recoveryParent)
    )
  );
  const operatingExpenses = paidExpenses.filter(row => !isCapitalExpense(row));
  const capitalExpenses = paidExpenses.filter(isCapitalExpense);
  const expenseMinor = add(operatingExpenses.filter(inPeriod));
  const capitalExpenseMinor = add(capitalExpenses.filter(inPeriod));
  const lossMinor = add(losses.filter(inPeriod));
  const recoveryMinor = add(
    collections.filter(row => inPeriod(row) && Boolean(row.meta.recoveryParent))
  );
  const reserveMinor = add(
    selected(entities.reserves).filter(row => !isCancelledFinancialRecord(row))
  );
  const depositMinor = portfolios.reduce(
    (total, row) => total + Number(row.meta.depositMinor ?? 0),
    0
  );
  // Keep the legacy current, unbounded value to avoid changing outstandingFor semantics.
  const outstandingMinor = periodReceivables.reduce(
    (total, row) => total + outstandingFor(entities, row.id),
    0
  );
  const currentAsOfOutstandingMinor = currentAsOfOutstanding(
    entities,
    portfolioId,
    period,
    currentAsOf
  );
  const periodClosingAsOf = periodClosingDate(period, currentAsOf);
  const periodClosingOutstandingMinor = periodClosingOutstanding(
    entities,
    portfolioId,
    period,
    currentAsOf
  );
  const units = selected(entities.units);
  const occupied = units.filter(
    unit => unitOccupancyAt(entities, unit.id, currentAsOf) === "occupied"
  ).length;
  const freeCashMinor = Math.max(0, cashMinor - reserveMinor - depositMinor);
  const freeCashAsOfMinor = Math.max(
    0,
    cashAsOfMinor - reserveMinor - depositMinor
  );
  const upcomingMinor = add(
    selected(entities.liabilities).filter(
      row => row.meta.type !== "قرض" && row.status === "قائم"
    )
  );

  return {
    // Existing names preserve their current/unbounded balance behavior.
    cashMinor,
    incomeMinor,
    expenseMinor,
    outstandingMinor,
    lossMinor,
    recoveryMinor,
    reserveMinor,
    depositMinor,
    freeCashMinor,
    availableDrawMinor: Math.max(0, freeCashMinor - upcomingMinor),
    expectedMinor: add(periodReceivables),
    accrualIncomeMinor: add(periodReceivables),
    occupancy: units.length ? Math.round((occupied / units.length) * 100) : 0,
    propertyCount: selected(entities.properties).length,
    unitCount: units.length,
    overdueCount: periodReceivables.filter(
      row =>
        row.date < currentAsOf &&
        outstandingForAsOf(entities, row.id, currentAsOf) > 0
    ).length,

    // Explicit dated values for reports, CSV, and callers that need reproducibility.
    currentAsOf,
    cashAsOfMinor,
    freeCashAsOfMinor,
    currentAsOfOutstandingMinor,
    periodClosingAsOf,
    periodClosingOutstandingMinor,
    capitalExpenseMinor,
  };
}

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Six declared scenario months ending in monthEndAsOf; never labels the prototype year as today. */
export function monthlyCashflow(
  entities: EntityMap,
  portfolioId: string,
  monthEndAsOf = PROTOTYPE_DATE
) {
  const asOf = scenarioDate(monthEndAsOf);
  const endYear = Number(asOf.slice(0, 4));
  const endMonth = Number(asOf.slice(5, 7));

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(endYear, endMonth - 6 + index, 1));
    const period = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    const monthEnd = periodClosingDate(period, asOf);
    const result = financialSummary(entities, portfolioId, period, monthEnd);
    return {
      month: ARABIC_MONTHS[date.getUTCMonth()],
      period,
      asOf: monthEnd,
      income: result.incomeMinor / 100,
      expenses: result.expenseMinor / 100,
      capitalExpenses: result.capitalExpenseMinor / 100,
    };
  });
}
