import { PROTOTYPE_DATE, type DemoEntity } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  confirmed,
  isActiveReceivable,
  isCancelledFinancialRecord,
  sourceEventId,
} from "./prototype-finance";
import { inPrototypePeriod } from "./prototype-period";

export type IncomeBasis = "income_cash" | "income_accrual";
export type BudgetActualStatus = "matched" | "unknown";

export type BudgetActualSource = Pick<
  DemoEntity,
  | "id"
  | "portfolioId"
  | "propertyId"
  | "date"
  | "amountMinor"
  | "status"
  | "meta"
>;

export type BudgetVarianceRow = {
  budget: DemoEntity;
  actualMinor: number | null;
  varianceMinor: number | null;
  actualStatus: BudgetActualStatus;
  actualBasis: "expense_operating" | "expense_capital" | IncomeBasis;
  note: string;
};

export type BudgetActualInput = {
  budgets: DemoEntity[];
  expenses: DemoEntity[];
  collections: DemoEntity[];
  receivables: DemoEntity[];
  period: string;
  asOfDate?: string;
};

type BudgetType = "operating" | "capital" | "income" | "unknown";
type Candidate = {
  budget: DemoEntity;
  selector: "broad" | "explicit";
};

const CONFIRMED_COLLECTION_STATUSES = new Set(["محصّل", "محصل", "مسوّى"]);

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ar");
}

/** A canonical key keeps preset periods (month/quarter/year) scoped to the same calendar window. */
export function canonicalReportingPeriod(
  period: string,
  asOfDate = PROTOTYPE_DATE
): string {
  const raw = period.trim();
  const month = scenarioDate(asOfDate).slice(0, 7);
  if (!raw || raw === "all") return "all";
  if (raw === "month") return month;
  if (raw === "year") return month.slice(0, 4);
  if (raw === "quarter") {
    const candidateMonth = Number(month.slice(5, 7));
    return `${month.slice(0, 4)}-Q${Math.ceil(candidateMonth / 3)}`;
  }
  return raw;
}

function isInCanonicalPeriod(date: string, canonicalPeriod: string): boolean {
  if (canonicalPeriod === "all") return true;
  if (/^\d{4}-Q[1-4]$/.test(canonicalPeriod)) {
    const year = canonicalPeriod.slice(0, 4);
    const quarter = Number(canonicalPeriod.slice(-1));
    const month = Number(date.slice(5, 7));
    return date.slice(0, 4) === year && Math.ceil(month / 3) === quarter;
  }
  return inPrototypePeriod(date, canonicalPeriod);
}

function budgetType(budget: DemoEntity): BudgetType {
  const category = normalized(budget.meta.category);
  if (category === "تشغيل" || category === "operating") return "operating";
  if (category === "رأسمالي" || category === "capital") return "capital";
  if (category === "دخل" || category === "income") return "income";
  return "unknown";
}

function incomeBasis(budget: DemoEntity): IncomeBasis {
  return budget.meta.basis === "income_accrual"
    ? "income_accrual"
    : "income_cash";
}

function explicitSelector(
  budget: DemoEntity
): { kind: "itemKey" | "category"; value: string } | null {
  const itemKey = normalized(budget.meta.itemKey);
  if (itemKey) return { kind: "itemKey", value: itemKey };
  const matchCategory = normalized(budget.meta.matchCategory);
  return matchCategory ? { kind: "category", value: matchCategory } : null;
}

function hasValidScope(
  budget: DemoEntity,
  reportPeriod: string,
  asOfDate: string
): boolean {
  const expectedPeriod = canonicalReportingPeriod(
    String(budget.meta.period ?? ""),
    asOfDate
  );
  return (
    Boolean(budget.portfolioId) &&
    expectedPeriod !== "all" &&
    expectedPeriod === reportPeriod
  );
}

function expenseType(row: BudgetActualSource): "operating" | "capital" {
  const classification = normalized(row.meta.classification);
  const category = normalized(row.meta.category);
  // Capital is only accepted when the source record explicitly says so. Maintenance is never promoted to capital.
  return classification === "رأسمالي" ||
    classification === "capital" ||
    category === "رأسمالي" ||
    category === "capital" ||
    category === "تحسين رأسمالي"
    ? "capital"
    : "operating";
}

function sourceMatchesSelector(
  source: BudgetActualSource,
  selector: ReturnType<typeof explicitSelector>
): boolean {
  if (!selector) return true;
  if (selector.kind === "itemKey") {
    return [source.meta.itemKey, source.meta.budgetItemKey]
      .map(normalized)
      .includes(selector.value);
  }
  return [source.meta.category, source.meta.classification]
    .map(normalized)
    .includes(selector.value);
}

function sourceInBudgetScope(
  source: BudgetActualSource,
  budget: DemoEntity,
  period: string
): boolean {
  return (
    source.portfolioId === budget.portfolioId &&
    (!budget.propertyId || source.propertyId === budget.propertyId) &&
    isInCanonicalPeriod(source.date, period)
  );
}

function sourceCandidates(
  source: BudgetActualSource,
  budgets: DemoEntity[],
  period: string,
  predicate: (budget: DemoEntity) => boolean
): Candidate[] {
  return budgets.flatMap(budget => {
    if (!predicate(budget) || !sourceInBudgetScope(source, budget, period))
      return [];
    const selector = explicitSelector(budget);
    if (!sourceMatchesSelector(source, selector)) return [];
    return [{ budget, selector: selector ? "explicit" : "broad" }];
  });
}

/** Budget actuals use the same explicit source-event policy as the ledger and exports. */
function uniqueBudgetSources(
  rows: BudgetActualSource[],
  kind: "receivable" | "collection" | "expense"
): BudgetActualSource[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const eventId = sourceEventId(row as DemoEntity, kind);
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    return true;
  });
}

function actualSources(
  input: BudgetActualInput,
  type: BudgetType
): BudgetActualSource[] {
  if (type === "operating" || type === "capital") {
    return uniqueBudgetSources(
      input.expenses.filter(
        row =>
          row.status === "مسدد" &&
          !isCancelledFinancialRecord(row) &&
          expenseType(row) === type
      ),
      "expense"
    );
  }
  if (type === "income") {
    const basis = incomeBasis(
      input.budgets.find(budget => budgetType(budget) === "income") ??
        input.budgets[0]!
    );
    return basis === "income_accrual"
      ? uniqueBudgetSources(
          input.receivables.filter(isActiveReceivable),
          "receivable"
        )
      : uniqueBudgetSources(
          input.collections.filter(
            row => confirmed(row) && !row.meta.recoveryParent
          ),
          "collection"
        );
  }
  return [];
}

function actualBasisFor(budget: DemoEntity): BudgetVarianceRow["actualBasis"] {
  const type = budgetType(budget);
  if (type === "capital") return "expense_capital";
  if (type === "income") return incomeBasis(budget);
  return "expense_operating";
}

const statusForBudget = (
  budget: DemoEntity,
  reportPeriod: string,
  asOfDate: string
): string | null => {
  if (!budget.portfolioId)
    return "لا يمكن مطابقة فعلي بلا محفظة محددة في الميزانية.";
  if (!String(budget.meta.period ?? "").trim())
    return "لا يمكن مطابقة فعلي بلا فترة ميزانية صريحة.";
  if (!hasValidScope(budget, reportPeriod, asOfDate))
    return "الميزانية خارج الفترة المعروضة أو لا تملك فترة مطابقة.";
  if (budgetType(budget) === "unknown")
    return "فئة الميزانية غير معروفة؛ اختر تشغيل أو رأسمالي أو دخل.";
  return null;
};

/**
 * Matches actuals only inside their portfolio/property/period/cost-class scope.
 * Explicit item/category selectors win over a broad aggregate budget. If two budgets
 * can claim a source with equal specificity, both are deliberately reported unknown.
 */
export function buildBudgetVarianceRows(
  input: BudgetActualInput
): BudgetVarianceRow[] {
  const asOfDate = scenarioDate(input.asOfDate ?? PROTOTYPE_DATE);
  const reportPeriod = canonicalReportingPeriod(input.period, asOfDate);
  const rows: BudgetVarianceRow[] = input.budgets.map(budget => ({
    budget,
    actualMinor: 0,
    varianceMinor: budget.amountMinor,
    actualStatus: "matched" as BudgetActualStatus,
    actualBasis: actualBasisFor(budget),
    note: "لا توجد حركة فعلية مطابقة ضمن النطاق.",
  }));
  const byId = new Map(rows.map(row => [row.budget.id, row]));

  for (const row of rows) {
    const reason = statusForBudget(row.budget, reportPeriod, asOfDate);
    if (reason) {
      row.actualMinor = null;
      row.varianceMinor = null;
      row.actualStatus = "unknown";
      row.note = reason;
    }
  }

  const validBudgets = rows
    .filter(row => row.actualStatus === "matched")
    .map(row => row.budget);

  for (const type of ["operating", "capital"] as const) {
    const budgets = validBudgets.filter(budget => budgetType(budget) === type);
    const sources = actualSources(input, type);
    for (const source of sources) {
      const candidates = sourceCandidates(
        source,
        budgets,
        reportPeriod,
        () => true
      );
      const explicit = candidates.filter(
        candidate => candidate.selector === "explicit"
      );
      const preferred = explicit.length ? explicit : candidates;
      if (preferred.length === 1) {
        const target = byId.get(preferred[0].budget.id)!;
        if (target.actualMinor !== null)
          target.actualMinor += source.amountMinor;
      } else if (preferred.length > 1) {
        for (const candidate of preferred) {
          const target = byId.get(candidate.budget.id)!;
          target.actualMinor = null;
          target.varianceMinor = null;
          target.actualStatus = "unknown";
          target.note =
            "توجد ميزانيات متداخلة بلا محدد بند فريد؛ لم يُنسخ الفعلي إلى أكثر من صف.";
        }
      }
    }

    // Capital has no safe zero default. It is known only from an explicit actual-capital record.
    if (type === "capital") {
      for (const budget of budgets) {
        const target = byId.get(budget.id)!;
        const hasExplicitCapitalSource = sources.some(
          source =>
            sourceInBudgetScope(source, budget, reportPeriod) &&
            sourceMatchesSelector(source, explicitSelector(budget))
        );
        if (!hasExplicitCapitalSource && target.actualStatus === "matched") {
          target.actualMinor = null;
          target.varianceMinor = null;
          target.actualStatus = "unknown";
          target.note =
            "لا يوجد سجل فعلي مصنف رأسماليًا ضمن هذا النطاق؛ لا يُفترض صفر أو تُعاد صيانة كرأسمالي.";
        }
      }
    }
  }

  for (const basis of ["income_cash", "income_accrual"] as const) {
    const budgets = validBudgets.filter(
      budget => budgetType(budget) === "income" && incomeBasis(budget) === basis
    );
    const sources =
      basis === "income_accrual"
        ? uniqueBudgetSources(
            input.receivables.filter(isActiveReceivable),
            "receivable"
          )
        : uniqueBudgetSources(
            input.collections.filter(
              row => confirmed(row) && !row.meta.recoveryParent
            ),
            "collection"
          );
    for (const source of sources) {
      const candidates = sourceCandidates(
        source,
        budgets,
        reportPeriod,
        () => true
      );
      const explicit = candidates.filter(
        candidate => candidate.selector === "explicit"
      );
      const preferred = explicit.length ? explicit : candidates;
      if (preferred.length === 1) {
        const target = byId.get(preferred[0].budget.id)!;
        if (target.actualMinor !== null)
          target.actualMinor += source.amountMinor;
      } else if (preferred.length > 1) {
        for (const candidate of preferred) {
          const target = byId.get(candidate.budget.id)!;
          target.actualMinor = null;
          target.varianceMinor = null;
          target.actualStatus = "unknown";
          target.note =
            "توجد ميزانيات دخل متداخلة بلا محدد بند فريد؛ لم يُنسخ الفعلي إلى أكثر من صف.";
        }
      }
    }
  }

  for (const row of rows) {
    if (row.actualMinor !== null) {
      row.varianceMinor = row.budget.amountMinor - row.actualMinor;
      row.note =
        row.actualMinor === 0
          ? "لا توجد حركة فعلية مطابقة ضمن النطاق."
          : "فعلي مطابق للمحفظة/العقار/الفترة والفئة.";
    }
  }
  return rows;
}
