import type { AdvisorProfile, AdvisorStage } from "@shared/advisor-types";
import type { DemoEntity, MetaValue, PrototypeState } from "@shared/prototype";

export const ADVISOR_PROFILE_RECORD_TYPE = "advisor-profile";
export const ADVISOR_PROFILE_VERSION_RECORD_TYPE = "advisor-profile-version";
export const ADVISOR_STAGE_RECORD_TYPE = "advisor-stage";
export const ADVISOR_PLAN_REVIEW_RECORD_TYPE = "advisor-plan-version-review";

const MAX_META_FIELDS = 32;
const MAX_META_TEXT = 1024;
const MAX_MINOR = 1_000_000_000_000;

export type AdvisorPlanPath = {
  id: string;
  label: string;
};

export type AdvisorPlanVersionInput = {
  portfolioId: string;
  portfolioTitle: string;
  profileMeta: Record<string, MetaValue>;
  activeProfileId?: string;
  path?: AdvisorPlanPath;
  stages?: readonly AdvisorStage[];
  /** A documented construction-budget revision, applied to the final active phase. */
  revisedBudgetMinor?: number;
  reason?: string;
  reviewDate: string;
  now: string;
  idFactory?: () => string;
};

export type AdvisorPlanVersionResult = {
  profile: DemoEntity;
  phases: DemoEntity[];
  review: DemoEntity | null;
  createdVersion: boolean;
  state: PrototypeState;
};

export type AdvisorPlanVersionTransition = {
  state: PrototypeState;
  result: AdvisorPlanVersionResult;
};

function nextId(input: AdvisorPlanVersionInput): string {
  return input.idFactory?.() ?? crypto.randomUUID();
}

function assertText(value: string, label: string, required = true): string {
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > MAX_META_TEXT)
    throw new Error(`${label} مطلوب ولا يتجاوز ${MAX_META_TEXT} حرفًا.`);
  return normalized;
}

function assertMinor(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_MINOR
  )
    throw new Error(`${label} يجب أن يكون مبلغًا آمنًا بين 0 و${MAX_MINOR}.`);
  return value;
}

function boundedMeta(meta: Record<string, MetaValue>): Record<string, MetaValue> {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_FIELDS)
    throw new Error(`بيانات الخطة تتجاوز ${MAX_META_FIELDS} حقلاً وصفيًا.`);
  for (const [key, value] of entries) {
    if (!key.trim()) throw new Error("اسم حقل البيانات الوصفية مطلوب.");
    if (typeof value === "string" && value.length > MAX_META_TEXT)
      throw new Error(`قيمة «${key}» تتجاوز ${MAX_META_TEXT} حرفًا.`);
  }
  return meta;
}

/**
 * Complete profile data belongs in metadata except for portfolioId, which is
 * already a first-class entity column. Observation-window keys remain explicit
 * so an absent window is distinguishable from an older partial profile record.
 */
export function fullProfileToMeta(
  profile: AdvisorProfile
): Record<string, MetaValue> {
  return boundedMeta({
    goal: profile.goal,
    targetMinor: profile.targetMinor,
    horizonYears: profile.horizonYears,
    cashMinor: profile.cashMinor,
    assetValueMinor: profile.assetValueMinor,
    debtMinor: profile.debtMinor,
    salaryMinor: profile.salaryMinor,
    businessIncomeMinor: profile.businessIncomeMinor,
    livingMinor: profile.livingMinor,
    installmentMinor: profile.installmentMinor,
    monthlyContributionMinor: profile.monthlyContributionMinor,
    emergencyReserveMinor: profile.emergencyReserveMinor,
    monthlyWithdrawalMinor: profile.monthlyWithdrawalMinor,
    risk: profile.risk,
    lockMonths: profile.lockMonths,
    hoursMonthly: profile.hoursMonthly,
    potentialFinancingMinor: profile.potentialFinancingMinor,
    approvedFinancingMinor: profile.approvedFinancingMinor,
    financingInstallmentMinor: profile.financingInstallmentMinor,
    dataDate: profile.dataDate,
    source: profile.source,
    operatingWindowStart: profile.operatingWindowStart ?? "",
    operatingWindowEnd: profile.operatingWindowEnd ?? "",
  });
}

function entity(
  input: AdvisorPlanVersionInput,
  values: Omit<DemoEntity, "id" | "currency">
): DemoEntity {
  return {
    ...values,
    id: nextId(input),
    currency: "QAR",
  };
}

function profileSnapshot(meta: Record<string, MetaValue>): Record<string, MetaValue> {
  const keys = [
    "goal",
    "targetMinor",
    "horizonYears",
    "cashMinor",
    "assetValueMinor",
    "debtMinor",
    "salaryMinor",
    "businessIncomeMinor",
    "livingMinor",
    "installmentMinor",
    "monthlyContributionMinor",
    "emergencyReserveMinor",
    "monthlyWithdrawalMinor",
    "risk",
    "lockMonths",
    "hoursMonthly",
    "potentialFinancingMinor",
    "approvedFinancingMinor",
    "financingInstallmentMinor",
    "dataDate",
    "source",
    "operatingWindowStart",
    "operatingWindowEnd",
  ];
  return Object.fromEntries(
    keys
      .filter(key => meta[key] !== undefined)
      .map(key => [key, meta[key]])
  );
}

function profileChanged(
  existing: DemoEntity | undefined,
  nextMeta: Record<string, MetaValue>,
  revisedBudgetMinor: number | undefined
): boolean {
  if (!existing) return true;
  const current = profileSnapshot(existing.meta);
  const next = profileSnapshot(nextMeta);
  if (JSON.stringify(current) !== JSON.stringify(next)) return true;
  return revisedBudgetMinor !== undefined &&
    existing.meta.revisedBudgetMinor !== revisedBudgetMinor;
}

function versionOf(row: DemoEntity | undefined): number {
  const version = row?.meta.version;
  return typeof version === "number" && Number.isSafeInteger(version)
    ? version
    : 0;
}

function phaseFor(
  input: AdvisorPlanVersionInput,
  profile: DemoEntity,
  stage: AdvisorStage,
  index: number,
  finalIndex: number
): DemoEntity {
  assertMinor(stage.budgetMinor, "ميزانية المرحلة");
  const budgetMinor =
    input.revisedBudgetMinor !== undefined && index === finalIndex
      ? assertMinor(input.revisedBudgetMinor, "الميزانية المعدلة")
      : stage.budgetMinor;
  const path = input.path!;
  const phase = `${path.label} · المرحلة ${index + 1}`;
  return entity(input, {
    title: phase,
    subtitle: "مرحلة محلية صورية مرتبطة بإصدار الخطة؛ لا تنشئ دفعة أو تمويلًا.",
    portfolioId: input.portfolioId,
    propertyId: "",
    status: "مرحلة مقترحة · تحتاج بوابة قرار",
    date: input.reviewDate,
    amountMinor: budgetMinor,
    meta: boundedMeta({
      recordType: ADVISOR_STAGE_RECORD_TYPE,
      planId: profile.id,
      profileId: profile.id,
      planVersion: versionOf(profile),
      phase,
      pathId: path.id,
      startMonth: stage.startMonth,
      endMonth: stage.endMonth,
      indicator: stage.indicator,
      gate: stage.gate,
      action: stage.action,
      reviewDate: input.reviewDate,
      ...(input.revisedBudgetMinor !== undefined && index === finalIndex
        ? {
            revisedBudgetMinor: budgetMinor,
            budgetChangeReason: assertText(input.reason ?? "", "سبب تعديل الميزانية"),
          }
        : {}),
    }),
  });
}

function matchingPhase(
  row: DemoEntity,
  profileId: string,
  path: AdvisorPlanPath,
  stage: AdvisorStage,
  index: number
): boolean {
  return (
    row.meta.recordType === ADVISOR_STAGE_RECORD_TYPE &&
    row.meta.profileId === profileId &&
    row.meta.pathId === path.id &&
    row.meta.phase === `${path.label} · المرحلة ${index + 1}` &&
    row.meta.startMonth === stage.startMonth &&
    row.meta.endMonth === stage.endMonth
  );
}

/**
 * Pure plan/profile/phase transition. It never creates tasks, so historic tasks
 * remain attached to their original phase/version. Pass this entire transition to
 * PrototypeContext.commitTransition when that atomic API is available.
 */
export function buildAdvisorPlanVersionTransition(
  state: PrototypeState,
  input: AdvisorPlanVersionInput
): AdvisorPlanVersionTransition {
  const portfolioId = assertText(input.portfolioId, "المحفظة");
  const portfolioTitle = assertText(input.portfolioTitle, "اسم المحفظة");
  const reviewDate = assertText(input.reviewDate, "تاريخ المراجعة");
  const now = assertText(input.now, "وقت التعديل");
  const targetMinor = assertMinor(input.profileMeta.targetMinor, "هدف الخطة");
  const horizonYears = input.profileMeta.horizonYears;
  if (horizonYears !== 1 && horizonYears !== 5 && horizonYears !== 10)
    throw new Error("أفق الخطة يجب أن يكون سنة أو 5 أو 10 سنوات.");
  if (input.revisedBudgetMinor !== undefined)
    assertMinor(input.revisedBudgetMinor, "الميزانية المعدلة");

  const current = input.activeProfileId
    ? state.entities.plans.find(row => row.id === input.activeProfileId)
    : state.entities.plans
        .filter(
          row =>
            row.portfolioId === portfolioId &&
            row.meta.recordType === ADVISOR_PROFILE_RECORD_TYPE
        )
        .at(-1);
  if (current && current.meta.recordType !== ADVISOR_PROFILE_RECORD_TYPE)
    throw new Error("إصدار الخطة النشط غير صالح.");

  const changed = profileChanged(current, input.profileMeta, input.revisedBudgetMinor);
  const reason = changed && current
    ? assertText(input.reason ?? "", "سبب إنشاء إصدار الخطة")
    : (input.reason ?? "").trim();

  let profile = current;
  let plans = state.entities.plans;
  let review: DemoEntity | null = null;
  if (changed) {
    const profileId = nextId(input);
    const version = versionOf(current) + 1;
    const originalGoal = current?.meta.originalGoal ?? current?.meta.goal ?? input.profileMeta.goal;
    const originalTargetMinor =
      current?.meta.originalTargetMinor ?? current?.meta.targetMinor ?? targetMinor;
    profile = {
      id: profileId,
      title: `تشخيص المستشار · ${portfolioTitle}`,
      subtitle: "إصدار خطة محلي قابل للمراجعة؛ ليس تفويض تمويل أو شراء.",
      portfolioId,
      propertyId: "",
      status: "تشخيص محفوظ للمراجعة",
      date: String(input.profileMeta.dataDate ?? reviewDate),
      amountMinor: targetMinor,
      currency: "QAR",
      meta: boundedMeta({
        recordType: ADVISOR_PROFILE_RECORD_TYPE,
        ...input.profileMeta,
        originalGoal,
        originalTargetMinor,
        version,
        planFamilyId: current?.meta.planFamilyId ?? profileId,
        ...(current
          ? {
              supersedesId: current.id,
              changeReason: reason,
              reviewDate,
              ...(input.revisedBudgetMinor !== undefined
                ? { revisedBudgetMinor: input.revisedBudgetMinor }
                : {}),
            }
          : {}),
      }),
    };
    const archivedCurrent = current
      ? {
          ...current,
          status: "إصدار مؤرشف · محفوظ للإنجاز والتاريخ",
          meta: boundedMeta({
            ...current.meta,
            recordType: ADVISOR_PROFILE_VERSION_RECORD_TYPE,
          }),
        }
      : null;
    plans = [
      ...state.entities.plans.map(row =>
        archivedCurrent && row.id === archivedCurrent.id ? archivedCurrent : row
      ),
      profile,
    ];
    if (current) {
      review = entity(input, {
        title: "مراجعة إصدار خطة المستشار",
        subtitle: "سجل سبب التغيير وتاريخه؛ لا يعدل إنجاز المرحلة السابقة.",
        portfolioId,
        propertyId: "",
        status: "مراجعة إصدار محفوظة",
        date: reviewDate,
        amountMinor: input.revisedBudgetMinor ?? targetMinor,
        meta: boundedMeta({
          recordType: ADVISOR_PLAN_REVIEW_RECORD_TYPE,
          kind:
            input.revisedBudgetMinor !== undefined
              ? "budget-change"
              : "profile-or-horizon-change",
          profileId,
          priorProfileId: current.id,
          planFamilyId: profile.meta.planFamilyId,
          version,
          reason,
          reviewDate,
          horizonMonths: horizonYears * 12,
          archivedAt: now,
          successorPlanId: profileId,
          ...(input.revisedBudgetMinor !== undefined
            ? { revisedBudgetMinor: input.revisedBudgetMinor }
            : {}),
        }),
      });
    }
  }
  if (!profile)
    throw new Error("تعذر إنشاء إصدار الخطة.");

  const phases: DemoEntity[] = [];
  if (input.path && input.stages && input.stages.length > 0) {
    const activePhases = plans.filter(
      row =>
        row.meta.recordType === ADVISOR_STAGE_RECORD_TYPE &&
        row.meta.profileId === profile!.id &&
        row.meta.pathId === input.path!.id
    );
    for (let index = 0; index < input.stages.length; index += 1) {
      const stage = input.stages[index]!;
      const exists = activePhases.some(row =>
        matchingPhase(row, profile!.id, input.path!, stage, index)
      );
      if (!exists) phases.push(phaseFor(input, profile, stage, index, input.stages.length - 1));
    }
  }

  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      plans: [...plans, ...phases],
      reviews: review ? [...state.entities.reviews, review] : state.entities.reviews,
    },
  };
  const result: AdvisorPlanVersionResult = {
    profile,
    phases,
    review,
    createdVersion: changed,
    state: nextState,
  };
  return { state: nextState, result };
}
