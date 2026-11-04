import { describe, expect, it } from "vitest";
import { diagnoseAdvisor, evaluateHunter } from "./advisor-engine";
import type { AdvisorProfile, HunterBrief } from "./advisor-types";
import { ENTITY_KINDS, type DemoEntity, type EntityMap } from "./prototype";

const riyal = (value: number) => value * 100;

function emptyEntities(): EntityMap {
  return Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
}

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل اختبار",
    subtitle: "مصدر اختبار",
    portfolioId: "p1",
    propertyId: "",
    status: "قائم",
    date: "2026-12-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function profile(overrides: Partial<AdvisorProfile> = {}): AdvisorProfile {
  return {
    portfolioId: "p1",
    goal: "wealth",
    targetMinor: riyal(10_000),
    horizonYears: 1,
    cashMinor: 0,
    assetValueMinor: 0,
    debtMinor: 0,
    salaryMinor: 0,
    businessIncomeMinor: 0,
    livingMinor: 0,
    installmentMinor: 0,
    monthlyContributionMinor: 0,
    emergencyReserveMinor: 0,
    monthlyWithdrawalMinor: 0,
    risk: "medium",
    lockMonths: 12,
    hoursMonthly: 10,
    potentialFinancingMinor: 0,
    approvedFinancingMinor: 0,
    financingInstallmentMinor: 0,
    dataDate: "2026-12-24",
    source: "إقرار اختبار",
    ...overrides,
  };
}

function brief(overrides: Partial<HunterBrief> = {}): HunterBrief {
  return {
    portfolioId: "p1",
    cashBudgetMinor: 0,
    potentialFinancingMinor: 0,
    approvedFinancingMinor: 0,
    goal: "wealth",
    risk: "medium",
    maxMonths: 12,
    country: "قطر",
    createdAt: "2026-12-24",
    sourcePlanId: "plan-1",
    ...overrides,
  };
}

function documentedDeal(overrides: Partial<DemoEntity["meta"]> = {}): DemoEntity {
  return entity({
    amountMinor: riyal(100_000),
    meta: {
      country: "قطر",
      currencyCode: "QAR",
      source: "سجل اختبار",
      sourceDate: "2026-12-24",
      kind: "عقار",
      available: true,
      evidenceCount: 4,
      verified: true,
      rightsVerified: true,
      eligibilityVerified: true,
      risk: "low",
      purchaseMinor: riyal(100_000),
      saleMinor: riyal(120_000),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 1,
      marketingMonths: 0,
      ...overrides,
    },
  });
}

describe("R01-R04 advisor calculation corrections", () => {
  it("R01 applies one approved facility once and reports the sources-and-uses funding gap", () => {
    const evaluation = evaluateHunter(
      documentedDeal({
        purchaseMinor: riyal(1_000_000),
        saleMinor: riyal(1_200_000),
        loanPrincipalMinor: riyal(600_000),
      }),
      brief({
        cashBudgetMinor: riyal(100_000),
        approvedFinancingMinor: riyal(600_000),
      })
    );

    expect(evaluation.result.totalCostMinor).toBe(riyal(1_000_000));
    expect(evaluation.funding.requestedFacilityMinor).toBe(riyal(600_000));
    expect(evaluation.funding.appliedConfirmedFinancingMinor).toBe(
      riyal(600_000)
    );
    expect(evaluation.funding.confirmedSourcesMinor).toBe(riyal(700_000));
    expect(evaluation.funding.fundingGapMinor).toBe(riyal(300_000));
    expect(evaluation.financiallyFit).toBe(false);
    expect(evaluation.suitable).toBe(false);
    expect(evaluation.reasons.join(" ")).toContain("عجز تمويل");
  });

  it("R01 keeps a potential facility conditional rather than treating it as confirmed funding", () => {
    const evaluation = evaluateHunter(
      documentedDeal({
        purchaseMinor: riyal(1_000_000),
        saleMinor: riyal(1_200_000),
        loanPrincipalMinor: riyal(600_000),
      }),
      brief({
        cashBudgetMinor: riyal(400_000),
        potentialFinancingMinor: riyal(600_000),
      })
    );

    expect(evaluation.funding.fundingGapMinor).toBe(riyal(600_000));
    expect(evaluation.funding.conditionalFundingGapMinor).toBe(0);
    expect(evaluation.financiallyFit).toBe(false);
    expect(evaluation.suitable).toBe(false);
    expect(evaluation.missing.join(" ")).toContain("تمويل محتمل");
  });

  it("R02 preserves a negative net-worth starting basis through the no-yield plan", () => {
    const diagnosis = diagnoseAdvisor(
      profile({
        assetValueMinor: 0,
        debtMinor: riyal(100_000),
        businessIncomeMinor: riyal(1_000),
        monthlyContributionMinor: riyal(1_000),
        targetMinor: riyal(10_000),
      }),
      emptyEntities()
    );

    expect(diagnosis.netWorthMinor).toBe(-riyal(100_000));
    expect(diagnosis.initialGoalBasisMinor).toBe(-riyal(100_000));
    expect(diagnosis.baselineEndMinor).toBe(-riyal(88_000));
    expect(diagnosis.goalGapMinor).toBe(riyal(98_000));
    expect(diagnosis.monthsRequired).not.toBe(0);
  });

  it("R03 includes zero months in an explicit operating window and excludes unsupported cash from the forecast", () => {
    const entities = emptyEntities();
    entities.receivables.push(
      entity({
        id: "ar-jan",
        date: "2026-01-01",
        amountMinor: riyal(12_000),
        meta: { recurring: true },
      }),
      entity({
        id: "ar-dec",
        date: "2026-12-01",
        amountMinor: riyal(12_000),
        meta: { recurring: true },
      })
    );
    entities.collections.push(
      entity({
        id: "collection-jan",
        date: "2026-01-15",
        status: "محصّل",
        amountMinor: riyal(12_000),
        meta: { receivableId: "ar-jan", recurring: true },
      }),
      entity({
        id: "collection-dec",
        date: "2026-12-15",
        status: "محصّل",
        amountMinor: riyal(12_000),
        meta: { receivableId: "ar-dec", recurring: true },
      })
    );

    const diagnosis = diagnoseAdvisor(
      profile({
        operatingWindowStart: "2026-01",
        operatingWindowEnd: "2026-12",
      }),
      entities
    );

    expect(diagnosis.operatingEstimate.period).toEqual({
      start: "2026-01",
      end: "2026-12",
    });
    expect(diagnosis.operatingEstimate.months).toBe(12);
    expect(diagnosis.operatingEstimate.totalCashMinor).toBe(riyal(24_000));
    expect(diagnosis.operatingEstimate.confirmedObservedCashAverageMinor).toBe(
      riyal(2_000)
    );
    expect(diagnosis.operatingEstimate.coverage.zeroCashMonths).toBe(10);
    expect(diagnosis.operatingEstimate.reliability).toBe("insufficient");
    expect(diagnosis.operatingEstimate.sustainableMonthlyOperatingMinor).toBe(0);
    expect(diagnosis.monthlySurplusMinor).toBe(0);
    expect(diagnosis.alerts.join(" ")).toContain("تغطية");

    const defaultWindow = diagnoseAdvisor(profile(), emptyEntities());
    expect(defaultWindow.operatingEstimate.period).toEqual({
      start: "2026-01",
      end: "2026-12",
    });
    expect(defaultWindow.operatingEstimate.months).toBe(12);
  });

  it("R04 separates goal economics so evidence cannot rank an uneconomic deal highly", () => {
    const lossWithNoRent = documentedDeal({
      saleMinor: riyal(50_000),
      monthlyRentMinor: 0,
      residenceEligible: true,
      affordabilityVerified: true,
    });
    const common = {
      cashBudgetMinor: riyal(100_000),
      risk: "high" as const,
    };

    const wealth = evaluateHunter(lossWithNoRent, brief({ ...common, goal: "wealth" }));
    const income = evaluateHunter(lossWithNoRent, brief({ ...common, goal: "income" }));
    const home = evaluateHunter(lossWithNoRent, brief({ ...common, goal: "home" }));
    const debt = evaluateHunter(lossWithNoRent, brief({ ...common, goal: "debt" }));

    expect(wealth.economicEligibility).toMatchObject({
      goal: "wealth",
      eligible: false,
    });
    expect(income.economicEligibility).toMatchObject({
      goal: "income",
      eligible: false,
    });
    expect(home.economicEligibility).toMatchObject({
      goal: "home",
      eligible: true,
    });
    expect(debt.economicEligibility).toMatchObject({
      goal: "debt",
      eligible: false,
    });
    expect(wealth.suitable).toBe(false);
    expect(income.suitable).toBe(false);
    expect(home.suitable).toBe(true);
    expect(wealth.score).toBe(0);
    expect(income.score).toBe(0);
    expect(debt.score).toBeLessThanOrEqual(25);
    expect(debt.economicEligibility.missing.join(" ")).toContain("فائدة");
  });
});
