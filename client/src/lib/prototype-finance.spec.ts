import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import {
  financialSummary,
  outstandingFor,
  outstandingForAsOf,
} from "./prototype-finance";
import { toMinor } from "@shared/prototype";

describe("prototype financial invariants", () => {
  it("parses decimal input into exact currency minor units", () => {
    expect(toMinor("12.05")).toBe(1205);
    expect(toMinor("0")).toBe(0);
    expect(() => toMinor("1.234")).toThrow();
    expect(() => toMinor("-5")).toThrow();
  });
  it("only counts a cheque once it is actually cleared", () => {
    const s = createDemoState();
    const row = s.entities.collections.find(x => x.id === "check-pending")!;
    const before = financialSummary(s.entities, "growth", "2026-10");
    row.status = "مستلم";
    expect(financialSummary(s.entities, "growth", "2026-10").cashMinor).toBe(
      before.cashMinor
    );
    row.status = "محصّل";
    expect(financialSummary(s.entities, "growth", "2026-10").cashMinor).toBe(
      before.cashMinor + row.amountMinor
    );
    row.status = "مرتجع";
    expect(financialSummary(s.entities, "growth", "2026-10").cashMinor).toBe(
      before.cashMinor
    );
  });
  it("keeps partial receipt, writeoff and recovery distinct", () => {
    const s = createDemoState();
    const id = "r-6";
    const source = s.entities.receivables.find(x => x.id === id)!;
    expect(outstandingFor(s.entities, id)).toBe(
      source.amountMinor - toMinor("2000")
    );
    const loss = {
      ...source,
      id: "test-loss",
      amountMinor: outstandingFor(s.entities, id),
      meta: { receivableId: id, reason: "demo" },
    };
    s.entities.losses.push(loss);
    expect(outstandingFor(s.entities, id)).toBe(0);
    s.entities.collections.push({
      ...source,
      id: "test-recovery",
      status: "محصّل",
      amountMinor: toMinor("100"),
      meta: { recoveryParent: loss.id },
    });
    expect(outstandingFor(s.entities, id)).toBe(0);
  });
  it("reserves change free cash but do not remove money from the bank", () => {
    const s = createDemoState();
    const before = financialSummary(s.entities, "family", "2026-10");
    s.entities.reserves[0].amountMinor += toMinor("1000");
    const after = financialSummary(s.entities, "family", "2026-10");
    expect(after.cashMinor).toBe(before.cashMinor);
    expect(after.freeCashMinor).toBe(before.freeCashMinor - toMinor("1000"));
  });
  it("vacancies and deposits do not become rental income", () => {
    const s = createDemoState();
    const before = financialSummary(s.entities, "family", "2026-10");
    s.entities.vacancies[0].amountMinor += toMinor("10000");
    s.entities.portfolios[0].meta.depositMinor =
      Number(s.entities.portfolios[0].meta.depositMinor) + toMinor("1000");
    const after = financialSummary(s.entities, "family", "2026-10");
    expect(after.incomeMinor).toBe(before.incomeMinor);
    expect(after.cashMinor).toBe(before.cashMinor);
    expect(after.freeCashMinor).toBe(before.freeCashMinor - toMinor("1000"));
  });

  it("keeps October closing AR distinct from the current-as-of-November balance", () => {
    const s = createDemoState();
    s.entities.receivables = [
      {
        id: "october-ar",
        title: "استحقاق أكتوبر",
        subtitle: "",
        portfolioId: "family",
        propertyId: "building",
        status: "مستحق",
        date: "2026-10-01",
        amountMinor: 100_000,
        currency: "QAR",
        meta: {},
      },
    ];
    s.entities.collections = [
      {
        ...s.entities.receivables[0],
        id: "october-400",
        title: "قبض أكتوبر",
        status: "محصّل",
        date: "2026-10-15",
        amountMinor: 40_000,
        meta: { receivableId: "october-ar" },
      },
      {
        ...s.entities.receivables[0],
        id: "november-600",
        title: "قبض نوفمبر",
        status: "محصّل",
        date: "2026-11-15",
        amountMinor: 60_000,
        meta: { receivableId: "october-ar" },
      },
    ];
    s.entities.losses = [];

    const report = financialSummary(
      s.entities,
      "family",
      "2026-10",
      "2026-11-30"
    );

    expect(report.incomeMinor).toBe(40_000);
    expect(report.accrualIncomeMinor).toBe(100_000);
    expect(report.periodClosingAsOf).toBe("2026-10-31");
    expect(report.periodClosingOutstandingMinor).toBe(60_000);
    expect(report.currentAsOf).toBe("2026-11-30");
    expect(report.currentAsOfOutstandingMinor).toBe(0);
    // Existing outstandingFor remains the unbounded current balance API.
    expect(outstandingFor(s.entities, "october-ar")).toBe(0);
    expect(outstandingForAsOf(s.entities, "october-ar", "2026-10-31")).toBe(
      60_000
    );
  });
});
