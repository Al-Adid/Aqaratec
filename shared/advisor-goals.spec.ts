import { describe, expect, it } from "vitest";
import { diagnoseAdvisor } from "./advisor-engine";
import type { AdvisorProfile } from "./advisor-types";
import { ENTITY_KINDS, type EntityMap } from "./prototype";
const entities = Object.fromEntries(
  ENTITY_KINDS.map(k => [k, []])
) as unknown as EntityMap;
const p: AdvisorProfile = {
  portfolioId: "p1",
  goal: "wealth",
  targetMinor: 100_000_000,
  horizonYears: 5,
  cashMinor: 10_000_000,
  assetValueMinor: 0,
  debtMinor: 0,
  salaryMinor: 2_000_000,
  businessIncomeMinor: 0,
  livingMinor: 1_500_000,
  installmentMinor: 0,
  monthlyContributionMinor: 200_000,
  emergencyReserveMinor: 0,
  monthlyWithdrawalMinor: 0,
  risk: "low",
  lockMonths: 12,
  hoursMonthly: 5,
  potentialFinancingMinor: 0,
  approvedFinancingMinor: 0,
  financingInstallmentMinor: 0,
  dataDate: "2026-10-24",
  source: "test",
};
describe("advisor goal units and reserves", () => {
  it("excludes personal emergency money from investment but not net worth", () => {
    const d = diagnoseAdvisor(
      { ...p, emergencyReserveMinor: 4_000_000 },
      entities
    );
    expect(d.investableCashMinor).toBe(6_000_000);
    expect(d.netWorthMinor).toBe(10_000_000);
  });
  it("uses existing net assets toward a net-wealth target", () => {
    const d = diagnoseAdvisor(
      { ...p, assetValueMinor: 20_000_000, debtMinor: 5_000_000 },
      entities
    );
    expect(d.baselineEndMinor).toBe(
      20_000_000 + 10_000_000 - 5_000_000 + 200_000 * 60
    );
  });
  it("does not pretend large capital already produces target monthly rent", () => {
    const d = diagnoseAdvisor(
      { ...p, goal: "income", targetMinor: 800_000, cashMinor: 200_000_000 },
      entities
    );
    expect(d.baselineEndMinor).toBe(0);
    expect(d.goalGapMinor).toBe(800_000);
    expect(d.monthsRequired).toBeNull();
  });
  it("caps repayment at the actual debt and does not create a loan", () => {
    const d = diagnoseAdvisor(
      { ...p, goal: "debt", targetMinor: 0, debtMinor: 2_000_000 },
      entities
    );
    expect(d.baselineEndMinor).toBe(2_000_000);
    expect(d.goalGapMinor).toBe(0);
  });
  it("rejects aggregate family scope", () => {
    expect(() =>
      diagnoseAdvisor({ ...p, portfolioId: "all" }, entities)
    ).toThrow("محفظة واحدة");
  });
});
