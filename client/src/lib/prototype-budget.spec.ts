import { describe, expect, it } from "vitest";
import type { DemoEntity } from "@shared/prototype";
import {
  buildBudgetVarianceRows,
  canonicalReportingPeriod,
} from "./prototype-budget";

function row(
  id: string,
  amountMinor: number,
  overrides: Partial<DemoEntity> = {}
): DemoEntity {
  return {
    id,
    title: id,
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "property-a",
    status: "مسدد",
    date: "2026-10-10",
    amountMinor,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function budget(
  id: string,
  amountMinor: number,
  meta: DemoEntity["meta"] = {},
  overrides: Partial<DemoEntity> = {}
): DemoEntity {
  return row(id, amountMinor, {
    status: "معتمدة محليًا",
    meta: { category: "تشغيل", period: "2026-10", ...meta },
    ...overrides,
  });
}

const actuals = (
  budgets: DemoEntity[],
  expenses: DemoEntity[] = [],
  collections: DemoEntity[] = [],
  receivables: DemoEntity[] = []
) =>
  buildBudgetVarianceRows({
    budgets,
    expenses,
    collections,
    receivables,
    period: "2026-10",
  });

describe("prototype budget actual matching", () => {
  it("keeps portfolio and property actuals isolated instead of putting their combined total in every row", () => {
    const a = budget(
      "budget-a",
      20_000,
      {},
      { portfolioId: "portfolio-a", propertyId: "property-a" }
    );
    const b = budget(
      "budget-b",
      20_000,
      {},
      { portfolioId: "portfolio-b", propertyId: "property-b" }
    );
    const rows = actuals(
      [a, b],
      [
        row("expense-a", 10_000, { meta: { category: "تشغيلي" } }),
        row("expense-b", 20_000, {
          portfolioId: "portfolio-b",
          propertyId: "property-b",
          meta: { category: "تشغيلي" },
        }),
      ]
    );

    expect(rows.map(item => item.actualMinor)).toEqual([10_000, 20_000]);
    expect(rows.map(item => item.varianceMinor)).toEqual([10_000, 0]);
  });

  it("matches an explicit expense category and item key only to the requested line", () => {
    const repairs = budget("repairs", 20_000, {
      matchCategory: "صيانة تشغيلية",
    });
    const utilities = budget("utilities", 20_000, { itemKey: "utilities" });
    const rows = actuals(
      [repairs, utilities],
      [
        row("repair-expense", 10_000, { meta: { category: "صيانة تشغيلية" } }),
        row("utility-expense", 20_000, {
          meta: { category: "تشغيلي", itemKey: "utilities" },
        }),
        row("other-expense", 30_000, {
          meta: { category: "تشغيلي", itemKey: "other" },
        }),
      ]
    );

    expect(rows.map(item => item.actualMinor)).toEqual([10_000, 20_000]);
    expect(rows.map(item => item.actualStatus)).toEqual(["matched", "matched"]);
  });

  it("preserves the signed budget-minus-actual variance so an overrun of 30 is negative", () => {
    const rows = actuals(
      [budget("maintenance", 10_000)],
      [row("maintenance-actual", 13_000, { meta: { category: "تشغيلي" } })]
    );

    expect(rows[0]).toMatchObject({
      actualMinor: 13_000,
      varianceMinor: -3_000,
      actualStatus: "matched",
    });
  });

  it("flags overlapping aggregate budgets as unknown rather than copying the same expense to both", () => {
    const rows = actuals(
      [budget("broad-one", 10_000), budget("broad-two", 20_000)],
      [row("shared-expense", 13_000, { meta: { category: "تشغيلي" } })]
    );

    expect(rows.map(item => item.actualStatus)).toEqual(["unknown", "unknown"]);
    expect(rows.map(item => item.actualMinor)).toEqual([null, null]);
  });

  it("does not invent a zero capital actual from maintenance and accepts only explicit capital records", () => {
    const capital = budget("capital", 20_000, { category: "رأسمالي" });
    const noCapital = actuals(
      [capital],
      [row("maintenance", 13_000, { meta: { category: "صيانة تشغيلية" } })]
    );
    expect(noCapital[0]).toMatchObject({
      actualStatus: "unknown",
      actualMinor: null,
    });

    const actualCapital = actuals(
      [capital],
      [
        row("capital-record", 13_000, {
          meta: { classification: "رأسمالي", category: "تحسين رأسمالي" },
        }),
      ]
    );
    expect(actualCapital[0]).toMatchObject({
      actualStatus: "matched",
      actualMinor: 13_000,
      varianceMinor: 7_000,
    });
  });

  it("separates cash receipts from accrual receivables for income-budget actuals", () => {
    const cash = budget("cash-income", 100_000, {
      category: "دخل",
      basis: "income_cash",
    });
    const accrual = budget("accrual-income", 100_000, {
      category: "دخل",
      basis: "income_accrual",
    });
    const source = row("ar-1000", 100_000, { status: "مستحق" });
    const receipt = row("cash-400", 40_000, {
      status: "محصّل",
      meta: { receivableId: source.id },
    });
    const rows = actuals([cash, accrual], [], [receipt], [source]);

    expect(rows.map(item => item.actualMinor)).toEqual([40_000, 100_000]);
  });

  it("uses a single canonical period key for the preset current month", () => {
    expect(canonicalReportingPeriod("month", "2026-10-24")).toBe("2026-10");
    expect(canonicalReportingPeriod("quarter", "2026-10-24")).toBe("2026-Q4");
  });

  it("counts a repeated sourceEventId only once instead of duplicating an actual", () => {
    const rows = actuals(
      [budget("interest", 20_000)],
      [
        row("interest-expense", 10_000, {
          meta: { category: "مصروف فائدة", sourceEventId: "interest-100" },
        }),
        row("interest-mirrored-record", 10_000, {
          meta: { category: "مصروف فائدة", sourceEventId: "interest-100" },
        }),
      ]
    );

    expect(rows[0]).toMatchObject({
      actualStatus: "matched",
      actualMinor: 10_000,
      varianceMinor: 10_000,
    });
  });
});
