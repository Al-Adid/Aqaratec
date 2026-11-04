// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@shared/advisor-engine", () => ({
  diagnoseAdvisor: (profile: {
    cashMinor: number;
    emergencyReserveMinor: number;
    salaryMinor: number;
    livingMinor: number;
    installmentMinor: number;
    monthlyContributionMinor: number;
    assetValueMinor: number;
    debtMinor: number;
    targetMinor: number;
  }) => ({
    portfolioCashMinor: profile.cashMinor,
    investableCashMinor: Math.max(
      0,
      profile.cashMinor - profile.emergencyReserveMinor
    ),
    monthlySurplusMinor:
      profile.salaryMinor - profile.livingMinor - profile.installmentMinor,
    contributionMinor: profile.monthlyContributionMinor,
    netWorthMinor:
      profile.cashMinor + profile.assetValueMinor - profile.debtMinor,
    baselineEndMinor: profile.cashMinor,
    goalGapMinor: Math.max(0, profile.targetMinor - profile.cashMinor),
    additionalMonthlyMinor: 0,
    monthsRequired: null,
    alerts: ["مثال اختبار حتمي"],
    sources: [],
  }),
  advisorPaths: () => [
    {
      id: "cash",
      label: "حماية النقد",
      risk: "low",
      suitable: true,
      reason: "سيولة المثال أولاً",
      actions: ["مراجعة الاحتياطي"],
      gate: "تأكيد الاحتياطي",
      resultLabel: "مقارنة حذرة",
      projectedMinor: null,
    },
    {
      id: "income",
      label: "دخل مشروط",
      risk: "medium",
      suitable: true,
      reason: "تحتاج تحققاً",
      actions: ["جمع الدليل"],
      gate: "دليل الإيجار",
      resultLabel: "مشروط",
      projectedMinor: null,
    },
    {
      id: "growth",
      label: "نمو مشروط",
      risk: "high",
      suitable: false,
      reason: "لا يكفي الدليل",
      actions: ["لا تنفيذ"],
      gate: "رفض مبدئي",
      resultLabel: "مرفوض",
      projectedMinor: null,
    },
  ],
  advisorStages: () => [
    {
      name: "تثبيت",
      startMonth: 1,
      endMonth: 3,
      budgetMinor: 100000,
      indicator: "تحقق",
      gate: "بوابة",
      action: "مراجعة",
    },
  ],
  calculateDeal: () => ({
    initialMarginMinor: 70000000,
    totalCostMinor: 185000000,
    resultMinor: 65000000,
    cycleReturnPercent: 35.1,
    durationMonths: 18,
    cashRequiredMinor: 185000000,
    saleProceedsAfterDebtMinor: 250000000,
    monthlyNetRentMinor: 0,
    financingCostMinor: 0,
    warnings: [],
  }),
  constructionReview: (review: {
    originalBudgetMinor: number;
    revisedCostMinor: number;
    projectCashMinor: number;
    upcomingPaymentsMinor: number;
    reserveMinor: number;
  }) => ({
    potentialSavingMinor: Math.max(
      0,
      review.originalBudgetMinor - review.revisedCostMinor
    ),
    freeCashMinor: Math.max(
      0,
      review.projectCashMinor -
        review.upcomingPaymentsMinor -
        review.reserveMinor
    ),
    availableForSearchMinor: 0,
    note: "لا يطلق العرض استثماراً تلقائياً.",
  }),
  profileFromEntity: (row: { meta: Record<string, unknown> }) =>
    row.meta.profile,
  profileToMeta: (profile: Record<string, unknown>) => ({ ...profile }),
}));

vi.mock("@/components/app/AdvisorExplanation", () => ({
  AdvisorExplanation: () => (
    <div data-testid="advisor-explanation">شرح اختياري معزول في الاختبار</div>
  ),
}));

import { PrototypeProvider } from "@/contexts/PrototypeContext";
import { RealEstateAdvisorPage } from "./RealEstateAdvisorPage";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
});

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(item =>
    item.textContent?.includes(label)
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}

function selectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("RealEstateAdvisorPage", () => {
  it("renders the progressive advisor journey and records a construction review locally", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PrototypeProvider>
          <RealEstateAdvisorPage />
        </PrototypeProvider>
      );
    });

    expect(document.body.textContent).toContain("المستشار العقاري");
    expect(document.body.textContent).toContain("المساهمة تبقى 2,000");
    expect(
      document.querySelector("select")?.getAttribute("aria-label")
    ).toBeNull();

    const portfolioSelect = Array.from(
      document.querySelectorAll("select")
    ).find(select =>
      Array.from(select.options).some(
        option => option.textContent === "محفظة الأسرة"
      )
    );
    expect(portfolioSelect).toBeTruthy();
    await act(async () => {
      selectValue(portfolioSelect as HTMLSelectElement, "family");
    });

    await act(async () => {
      button("المتابعة").click();
    });
    expect(document.body.textContent).toContain("الميزانية الأصلية");
    expect(document.body.textContent).toContain("وفر محتمل");

    await act(async () => {
      button("تسجيل مراجعة البناء").click();
    });
    expect(document.body.textContent).toContain(
      "سُجلت المراجعة والتفسير محلياً"
    );
    expect(document.body.textContent).toContain("مراجعة بناء شهرية");
  });
});
