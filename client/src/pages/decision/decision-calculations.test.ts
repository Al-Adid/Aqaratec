import { describe, expect, it } from "vitest";
import {
  calculateGrowth,
  calculateOpportunityScenario,
  multiplyPercentBpsFloor,
  opportunityEvidence,
} from "./DecisionShared";
import type { DemoEntity } from "@shared/prototype";

describe("decision calculations", () => {
  it("builds distinct 1/5/10 stages from user inputs and keeps potential funding separate", () => {
    const result = calculateGrowth({
      goalMonthlyMinor: 100_000,
      resourcesMinor: 1_000_000,
      livingMonthlyMinor: 20_000,
      monthlySavingsMinor: 10_000,
      possibleFundingMinor: 500_000,
      evidenceReady: true,
    });

    expect(result.safe).toBe(true);
    expect(result.stages.map(stage => stage.goalMonthlyMinor)).toEqual([
      50_000, 75_000, 100_000,
    ]);
    expect(result.stages.map(stage => stage.requirementMinor)).toEqual([
      840_000, 1_140_000, 1_440_000,
    ]);
    expect(result.stages[0]?.confirmedResourcesMinor).toBe(1_120_000);
    expect(result.stages[0]?.confirmedGapMinor).toBe(0);
    expect(result.stages[0]?.conditionalGapMinor).toBe(0);
    expect(result.stages[2]?.savedMinor).toBe(1_200_000);
    expect(result.stages[0]?.note).not.toBe(result.stages[2]?.note);
  });

  it("uses floor with integer bps and blocks an incomplete opportunity even when its ceiling fits", () => {
    expect(multiplyPercentBpsFloor(101, 250)).toBe(2);
    const calculation = calculateOpportunityScenario({
      askingPriceMinor: 8_000_000,
      cashMinor: 10_000_000,
      potentialFundingMinor: 2_000_000,
      reserveMinor: 500_000,
      feesMinor: 200_000,
      setupMinor: 300_000,
      scenarioRateBps: 125,
      scenario: "تطوير",
      dataComplete: false,
    });

    expect(calculation.safe).toBe(true);
    expect(calculation.scenarioRateCostMinor).toBe(100_000);
    expect(calculation.totalCostsMinor).toBe(1_100_000);
    expect(calculation.confirmedMaxPriceMinor).toBe(8_900_000);
    expect(calculation.maximumPriceMinor).toBe(10_900_000);
    expect(calculation.withinLiquidity).toBe(true);
    expect(calculation.needsData).toBe(true);
    expect(calculation.decisionBlocked).toBe(true);
  });

  it("reads opportunity metadata only when all declared evidence fields are complete", () => {
    const incomplete: DemoEntity = {
      id: "incomplete",
      title: "فرصة",
      subtitle: "",
      portfolioId: "family",
      propertyId: "",
      status: "مسودة",
      date: "2026-10-24",
      amountMinor: 100_000,
      currency: "QAR",
      meta: { evidence: "نص فقط", dataComplete: false },
    };
    const complete: DemoEntity = {
      ...incomplete,
      id: "complete",
      meta: {
        dataComplete: true,
        expectedValueMinor: 120_000,
        rehabMinor: 1_000,
        feesMinor: 2_000,
        rentMinor: 800,
      },
    };

    expect(opportunityEvidence(incomplete).needsData).toBe(true);
    expect(opportunityEvidence(complete)).toMatchObject({
      dataComplete: true,
      expectedValueMinor: 120_000,
      rehabMinor: 1_000,
      feesMinor: 2_000,
      rentMinor: 800,
    });
  });
});
