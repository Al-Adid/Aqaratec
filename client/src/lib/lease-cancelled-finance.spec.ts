import { describe, it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import { financialSummary, outstandingFor } from "./prototype-finance";
import { getMonthlyPropertyCollections } from "./prototype-payments";
describe("R09 cancellation preserveshistorywithoutowedmoney", () => {
  it("doesnotcountcancelledfuturedueasARorinmonthlycashactions", () => {
    const state = createDemoState();
    const property = state.entities.properties[0];
    state.entities.receivables = [
      {
        id: "cancelled-due",
        title: "مستقبل ملغى",
        subtitle: "",
        portfolioId: property.portfolioId,
        propertyId: property.id,
        status: "ملغى",
        date: "2026-11-01",
        amountMinor: 100000,
        currency: "QAR",
        meta: { due: "2026-11-01", cancellationReason: "إنهاء عقد مؤرخ" },
      },
    ];
    state.entities.collections = [];
    state.entities.losses = [];
    const raw = JSON.stringify(state);
    expect(
      financialSummary(state.entities, "all", "2026-11").accrualIncomeMinor
    ).toBe(0);
    expect(outstandingFor(state.entities, "cancelled-due")).toBe(0);
    expect(
      getMonthlyPropertyCollections(state.entities, "all", "2026-11").find(
        r => r.property.id === property.id
      )!.dues
    ).toHaveLength(0);
    expect(JSON.stringify(state)).toBe(raw);
    expect(state.entities.receivables).toHaveLength(1);
  });
});
