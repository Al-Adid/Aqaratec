import { describe, expect, it } from "vitest";
import {
  calculateDeal,
  constructionReview,
  diagnoseAdvisor,
  evaluateHunter,
  stressDeal,
} from "./advisor-engine";
import type { AdvisorProfile, DealInput, HunterBrief } from "./advisor-types";
import { ENTITY_KINDS, type DemoEntity, type EntityMap } from "./prototype";

const riyal = (value: number) => value * 100;

function emptyEntities(): EntityMap {
  return Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
}

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل اختبار",
    subtitle: "مصدر اختبار",
    portfolioId: "p1",
    propertyId: "",
    status: "قائم",
    date: "2026-10-24",
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
    targetMinor: riyal(10_000_000),
    horizonYears: 5,
    cashMinor: riyal(100_000),
    assetValueMinor: 0,
    debtMinor: 0,
    salaryMinor: 0,
    businessIncomeMinor: 0,
    livingMinor: 0,
    installmentMinor: 0,
    monthlyContributionMinor: riyal(2_000),
    emergencyReserveMinor: 0,
    monthlyWithdrawalMinor: 0,
    risk: "medium",
    lockMonths: 12,
    hoursMonthly: 10,
    potentialFinancingMinor: 0,
    approvedFinancingMinor: 0,
    financingInstallmentMinor: 0,
    dataDate: "2026-10-24",
    source: "إقرار العميل",
    ...overrides,
  };
}

const sourceDeal: DealInput = {
  purchaseMinor: riyal(1_000_000),
  developmentMinor: riyal(800_000),
  feesMinor: riyal(50_000),
  designMinor: 0,
  operatingMinor: 0,
  marketingMinor: 0,
  reserveMinor: 0,
  financingCostMinor: 0,
  loanPrincipalMinor: 0,
  saleMinor: riyal(2_500_000),
  monthlyRentMinor: 0,
  monthlyOperatingMinor: 0,
  vacancyPercent: 0,
  buildMonths: 12,
  marketingMonths: 6,
  monthlyHoldingMinor: 0,
};

describe("advisor engine", () => {
  it("calculates the Shahania example as a project-cycle result, not annual return", () => {
    const result = calculateDeal(sourceDeal);
    expect(result.initialMarginMinor).toBe(riyal(700_000));
    expect(result.totalCostMinor).toBe(riyal(1_850_000));
    expect(result.resultMinor).toBe(riyal(650_000));
    expect(result.cycleReturnPercent).toBe(35.135);
    expect(result.durationMonths).toBe(18);
    expect(result.warnings.join(" ")).toContain("وليست عائدًا سنويًا");
  });

  it("uses a no-yield baseline: 100k plus 2k for 60 months equals 220k", () => {
    const diagnosis = diagnoseAdvisor(
      profile({ businessIncomeMinor: riyal(2_000) }),
      emptyEntities()
    );
    expect(diagnosis.baselineEndMinor).toBe(riyal(220_000));
    expect(diagnosis.goalGapMinor).toBe(riyal(9_780_000));
    expect(diagnosis.monthsRequired).toBe(4950);
  });

  it("caps a user-selected contribution and keeps one unlinked observed collection out of the sustainable forecast", () => {
    const entities = emptyEntities();
    entities.portfolios.push(
      row({ id: "p1", portfolioId: "p1", amountMinor: riyal(5_000) }),
      row({ id: "p2", portfolioId: "p2", amountMinor: riyal(90_000) })
    );
    entities.collections.push(
      row({
        id: "c1",
        portfolioId: "p1",
        status: "محصّل",
        date: "2026-10-15",
        amountMinor: riyal(1_000),
      }),
      row({
        id: "c2",
        portfolioId: "p2",
        status: "محصّل",
        date: "2026-10-15",
        amountMinor: riyal(50_000),
      })
    );
    entities.expenses.push(
      row({
        id: "e1",
        portfolioId: "p1",
        status: "مسدد",
        date: "2026-10-18",
        amountMinor: riyal(100),
      })
    );

    const diagnosis = diagnoseAdvisor(
      profile({
        cashMinor: 0,
        salaryMinor: riyal(5_000),
        livingMinor: riyal(1_000),
        monthlyContributionMinor: riyal(9_000),
      }),
      entities
    );

    // p2 never enters p1's cash, surplus, or investable cash. The p1
    // collection remains observed portfolio cash, but one unlinked month is not
    // enough evidence to forecast recurring operating income.
    expect(diagnosis.portfolioCashMinor).toBe(riyal(5_900));
    expect(diagnosis.monthlySurplusMinor).toBe(riyal(4_000));
    expect(diagnosis.contributionMinor).toBe(riyal(4_000));
    expect(
      diagnosis.sources.find(source => source.label.includes("خارجي"))
        ?.amountMinor
    ).toBe(0);
    expect(diagnosis.alerts.join(" ")).toContain("أكبر من الفائض");
  });

  it("removes both principal and finance cost under financing-rejected stress", () => {
    const base: DealInput = {
      ...sourceDeal,
      purchaseMinor: riyal(100_000),
      developmentMinor: 0,
      feesMinor: 0,
      financingCostMinor: riyal(1_000),
      loanPrincipalMinor: riyal(50_000),
      saleMinor: riyal(120_000),
      buildMonths: 1,
      marketingMonths: 0,
    };
    const stressed = stressDeal(base, {
      saleDeclinePercent: 0,
      developmentIncreasePercent: 0,
      delayMonths: 0,
      financingRejected: true,
    });
    expect(stressed.financingCostMinor).toBe(0);
    expect(stressed.cashRequiredMinor).toBe(riyal(100_000));
    expect(stressed.saleProceedsAfterDebtMinor).toBe(riyal(120_000));
    expect(stressed.warnings.join(" ")).toContain("التمويل مرفوض");
  });

  it("rejects negative minor values and an invalid zero-duration deal", () => {
    expect(() => calculateDeal({ ...sourceDeal, feesMinor: -1 })).toThrow();
    expect(() =>
      calculateDeal({ ...sourceDeal, buildMonths: 0, marketingMonths: 0 })
    ).toThrow();
  });

  it("does not turn a 1m-to-850k quote into deployable cash", () => {
    const review = constructionReview({
      originalBudgetMinor: riyal(1_000_000),
      revisedCostMinor: riyal(850_000),
      evidenceStage: "quote",
      equivalentScope: true,
      projectCashMinor: riyal(300_000),
      upcomingPaymentsMinor: riyal(100_000),
      reserveMinor: riyal(50_000),
    });
    expect(review.potentialSavingMinor).toBe(riyal(150_000));
    expect(review.freeCashMinor).toBe(riyal(150_000));
    expect(review.availableForSearchMinor).toBe(0);
    expect(review.note).toContain("ليس نقدًا حرًا");
  });

  it("refuses to combine a SAR advertisement with a QAR budget and keeps it screened, never approved", () => {
    const brief: HunterBrief = {
      portfolioId: "p1",
      cashBudgetMinor: riyal(1_000_000),
      potentialFinancingMinor: 0,
      approvedFinancingMinor: 0,
      goal: "wealth",
      risk: "high",
      maxMonths: 24,
      country: "السعودية",
      createdAt: "2026-10-24",
      sourcePlanId: "plan-1",
    };
    const evaluation = evaluateHunter(
      row({
        amountMinor: riyal(700_000),
        meta: {
          country: "السعودية",
          currencyCode: "SAR",
          source: "إعلان",
          sourceDate: "2026-10-24",
          available: true,
          evidenceCount: 3,
          verified: true,
          rightsVerified: true,
          eligibilityVerified: true,
          kind: "أرض",
          risk: "high",
          purchaseMinor: riyal(700_000),
          saleMinor: riyal(900_000),
          buildMonths: 12,
          marketingMonths: 2,
        },
      }),
      brief
    );
    expect(evaluation.suitable).toBe(false);
    expect(evaluation.state).toBe("غير مناسبة حاليًا");
    expect(evaluation.reason).toContain("SAR");
    expect(evaluation.state).not.toContain("معتمدة");
  });
});
