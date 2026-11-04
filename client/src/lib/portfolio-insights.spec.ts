import { describe, expect, it } from "vitest";
import type { DemoEntity } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import {
  buildPortfolioInsights,
  calculateStressScenario,
  comparePropertyRent,
  marketPriceEvidenceCard,
} from "./portfolio-insights";

const property = (id = "p1"): DemoEntity => ({
  id,
  title: "عمارة مثال",
  subtitle: "لوسيل • منطقة نموذجية",
  portfolioId: "family",
  propertyId: id,
  status: "مؤجر",
  date: "2026-10-01",
  amountMinor: 0,
  currency: "QAR",
  meta: { type: "عمارة سكنية", location: "لوسيل • منطقة نموذجية" },
});

const comparable = (
  id: string,
  evidenceType: string,
  amountMinor: number,
  region = "لوسيل",
  propertyId = "p1"
): DemoEntity => ({
  id,
  title: `عينة ${id}`,
  subtitle: "عينة خيالية",
  portfolioId: "family",
  propertyId,
  status: "مراجع",
  date: "2026-10-01",
  amountMinor,
  currency: "QAR",
  meta: { region, evidenceType },
});

describe("portfolio insights rules", () => {
  it("does not present an advertised listing as a deal price", () => {
    const current = property();
    const result = comparePropertyRent(
      current,
      [{ ...current, id: "u1", propertyId: current.id, amountMinor: 4_500 }],
      [comparable("listing-only", "إعلان", 4_700)],
      [current]
    );

    expect(result.advertisedMiddleMinor).toBe(4_700);
    expect(result.dealMiddleMinor).toBeNull();
    expect(result.evidenceCounts.صفقة).toBe(0);
  });

  it("only keeps rent samples from the same region and property type", () => {
    const current = property();
    const otherType = {
      ...property("p2"),
      meta: { type: "فيلا", location: "لوسيل • مثال" },
    };
    const result = comparePropertyRent(
      current,
      [],
      [
        comparable("same", "عقد", 4_500),
        comparable("other-region", "عقد", 5_000, "الدوحة"),
        comparable("other-type", "عقد", 5_100, "لوسيل", "p2"),
      ],
      [current, otherType]
    );

    expect(result.sampleIds).toEqual(["same"]);
    expect(result.contractMiddleMinor).toBe(4_500);
  });

  it("keeps development guidance conditional and price prediction unavailable", () => {
    const state = createDemoState();
    const result = buildPortfolioInsights({
      entities: state.entities,
      portfolioId: "family",
      period: "2026-10",
    });
    const development = result.ideas.find(
      idea => idea.id === "development:building:use-review"
    );

    expect(development?.nextStep).toContain("مراجعة مهندس مرخص");
    expect(development?.nextStep).toContain(
      "لا يفترض النموذج نسبة بناء أو موافقة أو زيادة وحدات"
    );
    expect(marketPriceEvidenceCard()).toMatchObject({
      title: "بيانات غير كافية لتوقع الأسعار",
      predictionAvailable: false,
    });
  });

  it("calculates stress with integer minor units and keeps expected, income, and expense distinct", () => {
    const result = calculateStressScenario({
      expectedMinor: 100_005,
      incomeMinor: 80_005,
      expenseMinor: 20_005,
      rentReductionPercent: 10,
      expenseIncreasePercent: 20,
    });

    expect(result.safe).toBe(true);
    expect(result.expectedRentReductionMinor).toBe(10_000);
    expect(result.stressedExpectedMinor).toBe(90_005);
    expect(result.incomeReductionMinor).toBe(8_000);
    expect(result.expenseIncreaseMinor).toBe(4_001);
    expect(result.stressedNetMinor).toBe(47_999);
    expect(result.netImpactMinor).toBe(12_001);
  });

  it("rejects a pressure percentage outside the declared 0-30% range", () => {
    expect(
      calculateStressScenario({
        expectedMinor: 1_000,
        incomeMinor: 1_000,
        expenseMinor: 100,
        rentReductionPercent: 31,
        expenseIncreasePercent: 0,
      }).safe
    ).toBe(false);
  });
});
