import { describe, expect, it } from "vitest";
import type { AdvisorProfile, AdvisorStage } from "@shared/advisor-types";
import { ENTITY_KINDS, type PrototypeState } from "@shared/prototype";
import { profileFromEntity } from "@shared/advisor-engine";
import { prototypeStateSchema } from "@shared/prototype-validation";
import {
  ADVISOR_PLAN_REVIEW_RECORD_TYPE,
  ADVISOR_PROFILE_RECORD_TYPE,
  ADVISOR_PROFILE_VERSION_RECORD_TYPE,
  ADVISOR_STAGE_RECORD_TYPE,
  buildAdvisorPlanVersionTransition,
  fullProfileToMeta,
} from "./advisor-plan-versions";

function state(): PrototypeState {
  return {
    version: 1,
    entities: Object.fromEntries(ENTITY_KINDS.map(kind => [kind, []])) as unknown as PrototypeState["entities"],
    audit: [],
    settings: { role: "operator", portfolioId: "family", period: "all", language: "ar" },
  };
}

function fullProfile(horizonYears: 1 | 5 | 10): AdvisorProfile {
  return {
    portfolioId: "family",
    goal: "wealth",
    targetMinor: 100_000_000,
    horizonYears,
    cashMinor: 10_000_000,
    assetValueMinor: 0,
    debtMinor: 0,
    salaryMinor: 200_000,
    businessIncomeMinor: 0,
    livingMinor: 100_000,
    installmentMinor: 0,
    monthlyContributionMinor: 100_000,
    emergencyReserveMinor: 0,
    monthlyWithdrawalMinor: 0,
    risk: "medium",
    lockMonths: 12,
    hoursMonthly: 8,
    potentialFinancingMinor: 0,
    approvedFinancingMinor: 0,
    financingInstallmentMinor: 0,
    dataDate: "2026-10-24",
    source: "بيانات اختبارية",
    operatingWindowStart: "2026-01",
    operatingWindowEnd: "2026-12",
  };
}

function profileMeta(horizonYears: 1 | 5 | 10) {
  return fullProfileToMeta(fullProfile(horizonYears));
}

function stages(months: number, budgetMinor: number): AdvisorStage[] {
  return [
    {
      name: "تثبيت",
      startMonth: 1,
      endMonth: Math.min(3, months),
      budgetMinor: 0,
      indicator: "تحقق",
      gate: "بوابة",
      action: "مراجعة",
    },
    {
      name: "تنفيذ ومراجعة",
      startMonth: Math.min(3, months) + 1,
      endMonth: months,
      budgetMinor,
      indicator: "ميزانية",
      gate: "قرار",
      action: "متابعة",
    },
  ];
}

function input(
  horizonYears: 1 | 5 | 10,
  ids: string[],
  activeProfileId?: string,
  revisedBudgetMinor?: number
) {
  return {
    portfolioId: "family",
    portfolioTitle: "محفظة الأسرة",
    profileMeta: profileMeta(horizonYears),
    activeProfileId,
    path: { id: "stability", label: "تثبيت السيولة" },
    stages: stages(horizonYears * 12, horizonYears * 1_000_000),
    revisedBudgetMinor,
    reason: horizonYears === 1 ? "" : `مراجعة أفق ${horizonYears} سنوات`,
    reviewDate: "2026-10-24",
    now: "2026-10-24T12:00:00.000Z",
    idFactory: () => ids.shift() ?? "id-overflow",
  };
}

describe("advisor plan versions", () => {
  it("keeps a complete compact profile through 12/60/120-month versions and preserves archived phase records", () => {
    const completeMeta = fullProfileToMeta(fullProfile(1));
    expect(Object.keys(completeMeta)).toHaveLength(23);
    expect(completeMeta).toMatchObject({
      targetMinor: 100_000_000,
      horizonYears: 1,
      source: "بيانات اختبارية",
      operatingWindowStart: "2026-01",
      operatingWindowEnd: "2026-12",
    });
    expect(completeMeta.portfolioId).toBeUndefined();

    let current = state();
    const first = buildAdvisorPlanVersionTransition(
      current,
      input(1, ["profile-1", "phase-1a", "phase-1b"])
    );
    current = first.state;
    expect(first.result.profile.meta.recordType).toBe(ADVISOR_PROFILE_RECORD_TYPE);
    expect(Object.keys(first.result.profile.meta)).toHaveLength(28);
    expect(profileFromEntity(first.result.profile)).toEqual(fullProfile(1));
    expect(prototypeStateSchema.safeParse(current).success).toBe(true);
    expect(first.result.phases.map(row => row.meta.endMonth)).toEqual([3, 12]);
    expect(first.result.review).toBeNull();
    current = {
      ...current,
      entities: {
        ...current.entities,
        plans: current.entities.plans.map(row =>
          row.id === "phase-1a"
            ? {
                ...row,
                status: "مرحلة مكتملة",
                meta: { ...row.meta, completedAt: "2026-10-24" },
              }
            : row
        ),
      },
    };

    const fiveYear = buildAdvisorPlanVersionTransition(
      current,
      input(5, ["profile-5", "review-5", "phase-5a", "phase-5b"], "profile-1")
    );
    current = fiveYear.state;
    expect(fiveYear.result.createdVersion).toBe(true);
    expect(fiveYear.result.profile.id).toBe("profile-5");
    expect(fiveYear.result.profile.meta.version).toBe(2);
    expect(Object.keys(fiveYear.result.profile.meta)).toHaveLength(31);
    expect(prototypeStateSchema.safeParse(current).success).toBe(true);
    expect(fiveYear.result.phases.map(row => row.meta.endMonth)).toEqual([3, 60]);
    expect(
      current.entities.plans.find(row => row.id === "profile-1")?.meta.recordType
    ).toBe(ADVISOR_PROFILE_VERSION_RECORD_TYPE);
    expect(
      current.entities.plans.find(row => row.id === "profile-1")?.meta
        .successorPlanId
    ).toBeUndefined();
    expect(
      current.entities.plans.filter(
        row => row.meta.recordType === ADVISOR_STAGE_RECORD_TYPE && row.meta.profileId === "profile-1"
      )
    ).toHaveLength(2);
    expect(current.entities.plans.find(row => row.id === "phase-1a")).toMatchObject({
      status: "مرحلة مكتملة",
      meta: { completedAt: "2026-10-24" },
    });
    expect(fiveYear.result.review?.meta).toMatchObject({
      recordType: ADVISOR_PLAN_REVIEW_RECORD_TYPE,
      planFamilyId: "profile-1",
      reason: "مراجعة أفق 5 سنوات",
      reviewDate: "2026-10-24",
      horizonMonths: 60,
      archivedAt: "2026-10-24T12:00:00.000Z",
      successorPlanId: "profile-5",
    });

    const repeated = buildAdvisorPlanVersionTransition(
      current,
      input(5, ["unused-profile", "unused-phase-a", "unused-phase-b"], "profile-5")
    );
    current = repeated.state;
    expect(repeated.result.createdVersion).toBe(false);
    expect(repeated.result.phases).toHaveLength(0);
    expect(current.entities.reviews).toHaveLength(1);
    expect(
      current.entities.plans.filter(
        row => row.meta.recordType === ADVISOR_STAGE_RECORD_TYPE && row.meta.profileId === "profile-5"
      )
    ).toHaveLength(2);

    const tenYear = buildAdvisorPlanVersionTransition(
      current,
      input(10, ["profile-10", "review-10", "phase-10a", "phase-10b"], "profile-5", 10_000_000)
    );
    expect(tenYear.result.profile.meta.version).toBe(3);
    expect(Object.keys(tenYear.result.profile.meta)).toHaveLength(32);
    expect(prototypeStateSchema.safeParse(tenYear.state).success).toBe(true);
    expect(tenYear.result.phases.map(row => row.meta.endMonth)).toEqual([3, 120]);
    expect(tenYear.result.phases.at(-1)?.amountMinor).toBe(10_000_000);
    expect(tenYear.result.review?.meta.kind).toBe("budget-change");
    expect(tenYear.result.review?.meta.reason).toBe("مراجعة أفق 10 سنوات");
    expect(tenYear.result.review?.meta.planFamilyId).toBe("profile-1");
    expect(tenYear.state.entities.plans.find(row => row.id === "phase-1a")).toMatchObject({
      status: "مرحلة مكتملة",
      meta: { completedAt: "2026-10-24" },
    });
  });

  it("rejects unbounded amounts and an unreasoned changed version before changing state", () => {
    const initial = state();
    expect(() =>
      buildAdvisorPlanVersionTransition(initial, {
        ...input(1, ["profile"]),
        profileMeta: { ...profileMeta(1), targetMinor: 1_000_000_000_001 },
      })
    ).toThrow("1000000000000");

    const first = buildAdvisorPlanVersionTransition(
      initial,
      input(1, ["profile-1", "phase-1a", "phase-1b"])
    );
    expect(() =>
      buildAdvisorPlanVersionTransition(first.state, {
        ...input(5, ["profile-5"], "profile-1"),
        reason: "",
      })
    ).toThrow("سبب إنشاء إصدار الخطة");
  });

  it("versions a changed operating observation window with its review reason and date", () => {
    const first = buildAdvisorPlanVersionTransition(
      state(),
      input(1, ["profile-1", "phase-1a", "phase-1b"])
    );
    const windowed = buildAdvisorPlanVersionTransition(first.state, {
      ...input(1, ["profile-window", "review-window", "phase-window-a", "phase-window-b"], "profile-1"),
      profileMeta: {
        ...profileMeta(1),
        operatingWindowStart: "2026-02",
        operatingWindowEnd: "2027-01",
      },
      reason: "توسيع نافذة قياس التشغيل إلى سنة كاملة",
      reviewDate: "2026-10-25",
    });

    expect(windowed.result.createdVersion).toBe(true);
    expect(windowed.result.profile.meta).toMatchObject({
      operatingWindowStart: "2026-02",
      operatingWindowEnd: "2027-01",
      version: 2,
    });
    expect(windowed.result.review?.meta).toMatchObject({
      priorProfileId: "profile-1",
      planFamilyId: "profile-1",
      reason: "توسيع نافذة قياس التشغيل إلى سنة كاملة",
      reviewDate: "2026-10-25",
    });
  });
});
