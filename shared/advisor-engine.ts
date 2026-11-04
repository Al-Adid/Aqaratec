import {
  confirmed,
  financialSummary,
} from "../client/src/lib/prototype-finance";
import type { DemoEntity, EntityMap, MetaValue } from "./prototype";
import type {
  AdvisorDiagnosis,
  CalculatedAdvisorDiagnosis,
  AdvisorPath,
  AdvisorProfile,
  AdvisorStage,
  ConstructionReviewInput,
  ConstructionReviewResult,
  DealInput,
  DealResult,
  DealStress,
  HunterBrief,
  HunterEconomicEligibility,
  HunterFunding,
  HunterEvaluation,
  RiskLevel,
} from "./advisor-types";

const MAX_MINOR = Number.MAX_SAFE_INTEGER;
const MONEY_FIELDS: Array<keyof DealInput> = [
  "purchaseMinor",
  "developmentMinor",
  "feesMinor",
  "designMinor",
  "operatingMinor",
  "marketingMinor",
  "reserveMinor",
  "financingCostMinor",
  "loanPrincipalMinor",
  "saleMinor",
  "monthlyRentMinor",
  "monthlyOperatingMinor",
  "monthlyHoldingMinor",
];
const PROFILE_MONEY_FIELDS: Array<keyof AdvisorProfile> = [
  "targetMinor",
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
  "potentialFinancingMinor",
  "approvedFinancingMinor",
  "financingInstallmentMinor",
];

function fail(message: string): never {
  throw new Error(message);
}

function assertMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(`${label} يجب أن يكون مبلغًا صحيحًا غير سالب بوحدة صغرى آمنة`);
  return value;
}

function assertSignedMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value))
    fail(`${label} يجب أن يكون مبلغًا صحيحًا بوحدة صغرى آمنة`);
  return value;
}

function assertInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    fail(`${label} يجب أن يكون عددًا صحيحًا صالحًا`);
  return value;
}

function assertPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    fail(`${label} يجب أن يكون نسبة بين 0 و100`);
  return value;
}

function safeAdd(values: number[], label: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  return assertSignedMinor(total, label);
}

function safeSubtract(left: number, right: number, label: string): number {
  return assertSignedMinor(left - right, label);
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) fail(`${label} يتجاوز الحد الآمن للمبالغ`);
  return result;
}

function moneyAfterPercent(
  amountMinor: number,
  percent: number,
  label: string
): number {
  assertMinor(amountMinor, label);
  if (!Number.isFinite(percent)) fail(`${label} يحتوي نسبة غير صالحة`);
  const result = Math.round(amountMinor * (percent / 100));
  return assertMinor(result, label);
}

function zeroOrMetaMinor(row: DemoEntity, key: string, fallback = 0): number {
  const value = row.meta[key];
  if (value === undefined || value === "") return assertMinor(fallback, key);
  if (typeof value === "number") return assertMinor(value, key);
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return assertMinor(Number(value.trim()), key);
  return fail(`${key} في الفرصة يجب أن يكون مبلغًا صحيحًا بوحدة صغرى`);
}

function metaNumber(row: DemoEntity, key: string, fallback = 0): number {
  const value = row.meta[key];
  if (value === undefined || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fail(`${key} في الفرصة يجب أن يكون رقمًا صالحًا`);
}

function metaString(row: DemoEntity, key: string): string {
  const value = row.meta[key];
  return typeof value === "string" ? value.trim() : "";
}

function metaBoolean(row: DemoEntity, key: string): boolean | undefined {
  const value = row.meta[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return undefined;
}

function riskRank(risk: RiskLevel): number {
  return risk === "low" ? 0 : risk === "medium" ? 1 : 2;
}

function metaRisk(value: MetaValue | undefined): RiskLevel | undefined {
  if (value === "low" || value === "منخفض") return "low";
  if (value === "medium" || value === "متوسط") return "medium";
  if (value === "high" || value === "مرتفع") return "high";
  return undefined;
}

function validateProfile(profile: AdvisorProfile): void {
  if (!profile.portfolioId.trim() || profile.portfolioId === "all")
    fail("يلزم تحديد محفظة واحدة للتشخيص");
  if (![1, 5, 10].includes(profile.horizonYears))
    fail("أفق الخطة يجب أن يكون 1 أو 5 أو 10 سنوات");
  if (!["wealth", "income", "debt", "home"].includes(profile.goal))
    fail("هدف المستشار غير صالح");
  if (!["low", "medium", "high"].includes(profile.risk))
    fail("مستوى المخاطر غير صالح");
  for (const field of PROFILE_MONEY_FIELDS)
    assertMinor(profile[field] as number, String(field));
  assertInteger(profile.lockMonths, "مدة تجميد المال");
  assertInteger(profile.hoursMonthly, "الساعات الشهرية");
  if (!profile.dataDate.trim()) fail("يلزم تاريخ بيانات التشخيص");
  if (!profile.source.trim()) fail("يلزم مصدر بيانات التشخيص");
  if (profile.operatingWindowStart)
    parseYearMonth(profile.operatingWindowStart, "بداية نافذة التشغيل");
  if (profile.operatingWindowEnd)
    parseYearMonth(profile.operatingWindowEnd, "نهاية نافذة التشغيل");
}

function validateDeal(input: DealInput): void {
  for (const field of MONEY_FIELDS) assertMinor(input[field], String(field));
  assertPercent(input.vacancyPercent, "نسبة الشغور");
  assertInteger(input.buildMonths, "مدة البناء");
  assertInteger(input.marketingMonths, "مدة التسويق");
  if (input.buildMonths + input.marketingMonths <= 0)
    fail("يجب أن تكون مدة البناء أو التسويق شهرًا واحدًا على الأقل");
}

function parseYearMonth(value: string, label: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (!match) fail(`${label} يجب أن تكون بصيغة YYYY-MM`);
  return match[0];
}

function yearMonthFromDate(value: string, label: string): string {
  const match = /^(\d{4}-(0[1-9]|1[0-2]))(?:-|$)/.exec(value.trim());
  if (!match) fail(`${label} يجب أن يتضمن شهرًا صالحًا بصيغة YYYY-MM`);
  return match[1];
}

function monthIndex(month: string): number {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
}

function fromMonthIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function operatingPeriod(profile: AdvisorProfile): {
  start: string;
  end: string;
  months: string[];
} {
  const dataMonth = yearMonthFromDate(profile.dataDate, "تاريخ بيانات التشخيص");
  const end = profile.operatingWindowEnd
    ? parseYearMonth(profile.operatingWindowEnd, "نهاية نافذة التشغيل")
    : dataMonth;
  const start = profile.operatingWindowStart
    ? parseYearMonth(profile.operatingWindowStart, "بداية نافذة التشغيل")
    : fromMonthIndex(monthIndex(end) - 11);
  const startIndex = monthIndex(start);
  const endIndex = monthIndex(end);
  if (endIndex < startIndex)
    fail("نهاية نافذة التشغيل لا يمكن أن تسبق بدايتها");
  const length = endIndex - startIndex + 1;
  if (length > 120)
    fail("نافذة التشغيل لا يمكن أن تتجاوز 120 شهرًا في هذا التشخيص");
  return {
    start,
    end,
    months: Array.from({ length }, (_, offset) => fromMonthIndex(startIndex + offset)),
  };
}

function metaBooleanAny(row: DemoEntity, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = metaBoolean(row, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function rowLooksLikeDeposit(row: DemoEntity): boolean {
  if (metaBooleanAny(row, ["deposit", "isDeposit"]) === true) return true;
  const type = [
    metaString(row, "type"),
    metaString(row, "collectionType"),
    metaString(row, "incomeType"),
  ].join(" ");
  return /deposit|وديعة|تأمين/.test(type.toLowerCase());
}

function addExcludedFlow(
  flows: Map<string, { label: string; amountMinor: number; count: number }>,
  kind: "arrears" | "bulk" | "deposit" | "recovery" | "unlinked" | "unclassifiedExpense",
  label: string,
  amountMinor: number
): void {
  const current = flows.get(kind) ?? { label, amountMinor: 0, count: 0 };
  current.amountMinor = safeAdd(
    [current.amountMinor, amountMinor],
    `تدفقات مستبعدة: ${label}`
  );
  current.count += 1;
  flows.set(kind, current);
}

function monthlyPortfolioOperatingEstimate(
  profile: AdvisorProfile,
  entities: EntityMap
): {
  portfolioOperatingMinor: number;
  estimate: import("./advisor-types").AdvisorOperatingEstimate;
} {
  const period = operatingPeriod(profile);
  const periodMonths = new Set(period.months);
  const observedByMonth = new Map(period.months.map(month => [month, 0]));
  const sustainableByMonth = new Map(period.months.map(month => [month, 0]));
  const observedMonths = new Set<string>();
  const recurringIncomeMonths = new Set<string>();
  const recurringExpenseMonths = new Set<string>();
  const excluded = new Map<
    string,
    { label: string; amountMinor: number; count: number }
  >();
  const receivables = new Map(
    entities.receivables
      .filter(row => row.portfolioId === profile.portfolioId)
      .map(row => [row.id, row])
  );

  const addObserved = (month: string, amountMinor: number) => {
    if (!periodMonths.has(month)) return;
    observedByMonth.set(
      month,
      safeAdd([observedByMonth.get(month) ?? 0, amountMinor], "النقد المرصود")
    );
    observedMonths.add(month);
  };
  const addSustainable = (month: string, amountMinor: number) => {
    sustainableByMonth.set(
      month,
      safeAdd(
        [sustainableByMonth.get(month) ?? 0, amountMinor],
        "التشغيل المستدام"
      )
    );
  };

  for (const row of entities.collections) {
    if (!confirmed(row) || row.portfolioId !== profile.portfolioId) continue;
    if (!/^\d{4}-\d{2}/.test(row.date)) continue;
    const month = row.date.slice(0, 7);
    if (!periodMonths.has(month)) continue;
    const amountMinor = assertMinor(row.amountMinor, "تحصيل مؤكد");
    addObserved(month, amountMinor);

    if (row.meta.recoveryParent) {
      addExcludedFlow(excluded, "recovery", "تحصيل استرداد", amountMinor);
      continue;
    }
    if (rowLooksLikeDeposit(row)) {
      addExcludedFlow(excluded, "deposit", "تأمين أو وديعة", amountMinor);
      continue;
    }
    if (metaBooleanAny(row, ["bulk", "isBulk"]) === true) {
      addExcludedFlow(excluded, "bulk", "دفعة مجمعة", amountMinor);
      continue;
    }
    const receivableId = metaString(row, "receivableId");
    const receivable = receivableId ? receivables.get(receivableId) : undefined;
    if (!receivable) {
      addExcludedFlow(excluded, "unlinked", "تحصيل غير مربوط باستحقاق دوري", amountMinor);
      continue;
    }
    const receivableMonth = /^\d{4}-\d{2}/.test(receivable.date)
      ? receivable.date.slice(0, 7)
      : "";
    if (receivableMonth < month) {
      addExcludedFlow(excluded, "arrears", "تحصيل متأخر", amountMinor);
      continue;
    }
    if (receivableMonth !== month) {
      addExcludedFlow(excluded, "bulk", "تحصيل خارج شهر الاستحقاق", amountMinor);
      continue;
    }
    const recurring =
      metaBooleanAny(row, ["recurring", "isRecurring"]) === true ||
      metaBooleanAny(receivable, ["recurring", "isRecurring"]) === true;
    if (!recurring) {
      addExcludedFlow(excluded, "unlinked", "استحقاق غير موسوم بالدورية", amountMinor);
      continue;
    }
    addSustainable(month, amountMinor);
    recurringIncomeMonths.add(month);
  }

  for (const row of entities.expenses) {
    if (row.status !== "مسدد" || row.portfolioId !== profile.portfolioId) continue;
    if (!/^\d{4}-\d{2}/.test(row.date)) continue;
    const month = row.date.slice(0, 7);
    if (!periodMonths.has(month)) continue;
    const amountMinor = assertMinor(row.amountMinor, "مصروف مسدد");
    addObserved(month, -amountMinor);
    if (metaBooleanAny(row, ["recurring", "isRecurring"]) === true) {
      addSustainable(month, -amountMinor);
      recurringExpenseMonths.add(month);
    } else {
      addExcludedFlow(
        excluded,
        "unclassifiedExpense",
        "مصروف غير موسوم بالدورية",
        amountMinor
      );
    }
  }

  const totalCashMinor = safeAdd(
    [...observedByMonth.values()],
    "إجمالي النقد المرصود"
  );
  const averageMinor = assertSignedMinor(
    Math.floor(totalCashMinor / period.months.length),
    "متوسط النقد المرصود"
  );
  const sustainableTotalMinor = safeAdd(
    [...sustainableByMonth.values()],
    "إجمالي التشغيل الدوري"
  );
  const recurringCoverage = recurringIncomeMonths.size / period.months.length;
  const reliability =
    recurringIncomeMonths.size >= 6 && recurringCoverage >= 0.5
      ? "sufficient"
      : recurringIncomeMonths.size >= 3
        ? "limited"
        : "insufficient";
  const sustainableMonthlyOperatingMinor =
    reliability === "sufficient"
      ? assertSignedMinor(
          Math.floor(sustainableTotalMinor / period.months.length),
          "متوسط التشغيل المستدام"
        )
      : 0;

  return {
    portfolioOperatingMinor: sustainableMonthlyOperatingMinor,
    estimate: {
      period: { start: period.start, end: period.end },
      months: period.months.length,
      totalCashMinor,
      averageMinor,
      confirmedObservedCashAverageMinor: averageMinor,
      sustainableMonthlyOperatingMinor,
      coverage: {
        observedMonths: observedMonths.size,
        zeroCashMonths: period.months.length - observedMonths.size,
        recurringIncomeMonths: recurringIncomeMonths.size,
        recurringExpenseMonths: recurringExpenseMonths.size,
      },
      excludedFlows: [...excluded.entries()].map(([kind, flow]) => ({
        kind: kind as import("./advisor-types").OperatingFlowKind,
        ...flow,
      })),
      reliability,
    },
  };
}

function scopedLiabilities(entities: EntityMap, portfolioId: string): number {
  return safeAdd(
    entities.liabilities
      .filter(row => row.portfolioId === portfolioId && row.status === "قائم")
      .map(row => assertMinor(row.amountMinor, "التزام المحفظة")),
    "التزامات المحفظة"
  );
}

function cappedContribution(
  requestedMinor: number,
  monthlySurplusMinor: number
): number {
  return Math.min(requestedMinor, Math.max(0, monthlySurplusMinor));
}

function ceilingDivide(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const result = Math.ceil(numerator / denominator);
  return Number.isSafeInteger(result) ? result : null;
}

/**
 * Builds a conservative diagnosis from exactly one portfolio. Portfolio cash comes
 * from confirmed collections and paid expenses; declared user cash remains a separate
 * external source. The baseline has no assumed investment yield.
 */
export function diagnoseAdvisor(
  profile: AdvisorProfile,
  entities: EntityMap
): CalculatedAdvisorDiagnosis {
  validateProfile(profile);
  const summary = financialSummary(entities, profile.portfolioId, "all");
  const portfolioCashMinor = assertSignedMinor(
    summary.cashMinor,
    "النقد التشغيلي للمحفظة"
  );
  const portfolioReserveMinor = assertMinor(
    summary.reserveMinor,
    "احتياطي المحفظة"
  );
  const portfolioLiabilityMinor = scopedLiabilities(
    entities,
    profile.portfolioId
  );
  const operatingAvailableMinor = assertMinor(
    summary.availableDrawMinor,
    "السيولة التشغيلية المتاحة"
  );
  const investableCashMinor = Math.max(
    0,
    safeSubtract(
      safeAdd(
        [profile.cashMinor, operatingAvailableMinor],
        "النقد المتاح قبل الاحتياطي الشخصي"
      ),
      profile.emergencyReserveMinor,
      "النقد القابل للاستثمار بعد الاحتياطي الشخصي"
    )
  );
  const { portfolioOperatingMinor, estimate: operatingEstimate } =
    monthlyPortfolioOperatingEstimate(profile, entities);
  const monthlySurplusMinor = safeAdd(
    [
      profile.salaryMinor,
      profile.businessIncomeMinor,
      portfolioOperatingMinor,
      -profile.livingMinor,
      -profile.installmentMinor,
      -profile.financingInstallmentMinor,
      -profile.monthlyWithdrawalMinor,
    ],
    "الفائض الشهري"
  );
  const contributionMinor = cappedContribution(
    profile.monthlyContributionMinor,
    monthlySurplusMinor
  );
  const horizonMonths = safeMultiply(profile.horizonYears, 12, "أشهر الخطة");
  const netWorthMinor = safeAdd(
    [
      profile.assetValueMinor,
      profile.cashMinor,
      portfolioCashMinor,
      -profile.debtMinor,
    ],
    "صافي الثروة"
  );
  const contributions = safeMultiply(
    contributionMinor,
    horizonMonths,
    "المساهمات خلال الخطة"
  );
  const incomeGoal = profile.goal === "income";
  const debtGoal = profile.goal === "debt";
  // Income targets are monthly net rental income, never compared with a capital balance.
  const baselineEndMinor = incomeGoal
    ? Math.max(0, portfolioOperatingMinor - profile.financingInstallmentMinor)
    : debtGoal
      ? Math.min(
          profile.debtMinor,
          safeAdd(
            [investableCashMinor, contributions],
            "سداد ممكن دون اقتراض جديد"
          )
        )
      : safeAdd(
          [
            profile.goal === "wealth"
              ? netWorthMinor
              : investableCashMinor,
            contributions,
          ],
          "نهاية المسار الأساسي"
        );
  const effectiveTargetMinor = debtGoal
    ? profile.targetMinor > 0
      ? Math.min(profile.targetMinor, profile.debtMinor)
      : profile.debtMinor
    : profile.targetMinor;
  const goalGapMinor = Math.max(
    0,
    safeSubtract(effectiveTargetMinor, baselineEndMinor, "فجوة الهدف")
  );
  const additionalMonthlyMinor = incomeGoal
    ? 0
    : goalGapMinor === 0
      ? 0
      : (ceilingDivide(goalGapMinor, horizonMonths) ?? MAX_MINOR);
  const initialGoalBasisMinor =
    profile.goal === "wealth"
      ? netWorthMinor
      : investableCashMinor;
  const targetAfterCashMinor = Math.max(
    0,
    safeSubtract(
      effectiveTargetMinor,
      initialGoalBasisMinor,
      "الهدف بعد الرصيد الابتدائي"
    )
  );
  const monthsRequired = incomeGoal
    ? goalGapMinor === 0
      ? 0
      : null
    : targetAfterCashMinor === 0
      ? 0
      : ceilingDivide(targetAfterCashMinor, contributionMinor);
  const alerts: string[] = [];

  if (profile.emergencyReserveMinor > 0)
    alerts.push(
      "احتياطي الطوارئ الشخصي مستبعد من النقد القابل للاستثمار؛ لا يُخصم من ملكية الثروة."
    );
  if (incomeGoal)
    alerts.push(
      "هدف الدخل يقارن فقط بتشغيل دوري موثق وكافٍ التغطية؛ لا نحول رأس المال أو متوسط التحصيل المرصود إلى إيجار مستدام بلا دليل."
    );
  if (operatingEstimate.reliability !== "sufficient")
    alerts.push(
      `تغطية التشغيل ${operatingEstimate.coverage.observedMonths}/${operatingEstimate.months} شهرًا مرصودًا و${operatingEstimate.coverage.recurringIncomeMonths}/${operatingEstimate.months} شهرًا بدخل دوري مربوط؛ لا يدخل المتوسط المرصود في التوقع حتى تكتمل التغطية.`
    );
  if (operatingEstimate.excludedFlows.length > 0)
    alerts.push(
      "استُبعدت التحصيلات المتأخرة أو المجمعة أو الودائع أو الاستردادات أو التدفقات غير المربوطة من توقع التشغيل المستدام."
    );
  if (profile.monthlyContributionMinor > contributionMinor)
    alerts.push(
      "المساهمة الشهرية المختارة أكبر من الفائض المؤكد؛ خُفّضت إلى السقف الممكن ولم تُرفع تلقائيًا."
    );
  if (monthlySurplusMinor < 0)
    alerts.push(
      "الفائض الشهري سلبي؛ لا توجد مساهمة دورية متاحة قبل معالجة العجز."
    );
  if (portfolioReserveMinor > 0)
    alerts.push("احتياطي المحفظة مستبعد من السيولة القابلة للاستثمار.");
  if (portfolioLiabilityMinor > 0)
    alerts.push("التزامات المحفظة القائمة تخفض السيولة التشغيلية المتاحة.");
  if (
    profile.potentialFinancingMinor > 0 &&
    profile.approvedFinancingMinor === 0
  )
    alerts.push("التمويل المحتمل ليس نقدًا مؤكدًا ولا يدخل المسار الأساسي.");
  if (goalGapMinor > 0)
    alerts.push(
      "الهدف لا يصل إليه المسار الأساسي بلا عائد مفترض؛ تظهر الفجوة بدل اختراع عائد."
    );

  return {
    portfolioCashMinor,
    investableCashMinor,
    monthlySurplusMinor,
    contributionMinor,
    netWorthMinor,
    initialGoalBasisMinor,
    baselineEndMinor,
    goalGapMinor,
    additionalMonthlyMinor,
    monthsRequired,
    alerts,
    operatingEstimate,
    sources: [
      {
        label: "احتياطي طوارئ شخصي إضافي",
        amountMinor: profile.emergencyReserveMinor,
        source: profile.source,
        date: profile.dataDate,
      },
      {
        label: "نقد خارجي معلن من العميل",
        amountMinor: profile.cashMinor,
        source: profile.source,
        date: profile.dataDate,
      },
      {
        label: "سيولة تشغيلية للمحفظة بعد الاحتياطي والالتزامات",
        amountMinor: operatingAvailableMinor,
        source: "الملخص المالي للمحفظة المحددة",
        date: profile.dataDate,
      },
      {
        label: "احتياطي محجوز للمحفظة",
        amountMinor: portfolioReserveMinor,
        source: "الملخص المالي للمحفظة المحددة",
        date: profile.dataDate,
      },
    ],
  };
}

/** Paths remain alternatives for study: no fixed yield or financing approval is invented. */
export function advisorPaths(
  profile: AdvisorProfile,
  diagnosis: AdvisorDiagnosis
): AdvisorPath[] {
  validateProfile(profile);
  const debtPriority = profile.goal === "debt" && profile.debtMinor > 0;
  const lowSuitable = diagnosis.monthlySurplusMinor >= 0;
  const incomeSuitable =
    profile.risk !== "low" &&
    profile.goal !== "debt" &&
    diagnosis.investableCashMinor > 0 &&
    profile.lockMonths >= 6;
  const growthSuitable =
    profile.risk === "high" &&
    profile.goal === "wealth" &&
    diagnosis.investableCashMinor > 0 &&
    profile.lockMonths >= 12 &&
    profile.hoursMonthly >= 8;

  return [
    {
      id: "stability",
      label: debtPriority
        ? "تثبيت السيولة وسداد الالتزامات"
        : "تثبيت السيولة وتجميع رأس المال",
      risk: "low",
      suitable: lowSuitable,
      reason: debtPriority
        ? "الهدف دين؛ لذلك تسبق مراجعة الالتزامات أي دورة نمو جديدة."
        : "يبقي الاحتياطي والسيولة تحت السيطرة قبل أي التزام جديد.",
      actions: [
        "اعتماد الاحتياطي والدفعات القادمة.",
        "مراجعة الفائض المؤكد شهريًا.",
        "تجميع المساهمة التي اختارها العميل فقط.",
      ],
      gate: "لا التزام أو تمويل جديد قبل بقاء الفائض والسيولة بعد الاحتياطي موجبين.",
      resultLabel: "الرصيد الأساسي بلا عائد مفترض",
      projectedMinor: diagnosis.baselineEndMinor,
    },
    {
      id: "income",
      label: "دراسة أصل يركز على الدخل",
      risk: "medium",
      suitable: incomeSuitable,
      reason: incomeSuitable
        ? "توجد سيولة ومدة كافيتان لفحص دخل تشغيلي مؤكد بدل افتراض إيجار."
        : "يتطلب هذا المسار سيولة ومدة وملاءمة مخاطر أكبر مما تؤكده البيانات الحالية.",
      actions: [
        "فرز فرص ذات دخل موثق ومصروفات وشغور ظاهرين.",
        "مقارنة صافي التحصيل الفعلي لا الإيجار المعلن فقط.",
        "فحص الملكية والحقوق والأهلية قبل العرض.",
      ],
      gate: "يبقى إعلان السوق فحصًا أوليًا؛ لا يصبح اعتمادًا أو وعد دخل.",
      resultLabel: "لا إسقاط عائد؛ النتيجة تتطلب بيانات فرصة موثقة",
      projectedMinor: null,
    },
    {
      id: "growth",
      label: "دراسة دورة تنمية رأس المال",
      risk: "high",
      suitable: growthSuitable,
      reason: growthSuitable
        ? "حدود المخاطر والمدة والوقت تسمح بدراسة دورة مشروطة، لا بتنفيذ تلقائي."
        : "لا تنشأ دورة عالية المخاطر لمجرد ملء خيار ثالث؛ شروطها غير مكتملة.",
      actions: [
        "حساب كامل التكلفة والمدة والسيولة قبل الترشيح.",
        "اختبار انخفاض البيع وزيادة التكلفة وتأخر الخروج ورفض التمويل.",
        "فصل فحص الحقوق والتمويل عن الهامش الحسابي.",
      ],
      gate: "لا تبدأ دورة ثانية على سعر بيع أو تمويل لم يتحقق بعد.",
      resultLabel: "هامش دورة مشروط وليس عائدًا مضمونًا أو سنويًا",
      projectedMinor: null,
    },
  ];
}

function stageBudget(
  totalMinor: number,
  months: number,
  contributionMinor: number
): number {
  return safeAdd(
    [totalMinor, safeMultiply(contributionMinor, months, "ميزانية المرحلة")],
    "ميزانية المرحلة"
  );
}

export function advisorStages(
  profile: AdvisorProfile,
  diagnosis: AdvisorDiagnosis,
  pathId: string
): AdvisorStage[] {
  validateProfile(profile);
  const months = profile.horizonYears * 12;
  if (!["stability", "income", "growth"].includes(pathId)) return [];

  if (pathId === "stability") {
    const reviewEnd = Math.min(3, months);
    return [
      {
        name: "تثبيت البيانات والسيولة",
        startMonth: 1,
        endMonth: reviewEnd,
        budgetMinor: 0,
        indicator: "تأكيد الاحتياطي والدفعات والفائض الشهري",
        gate: "لا يحرر الاحتياطي ولا يضاف تمويل غير معتمد.",
        action: "راجع التحصيل الفعلي والمصروفات والالتزامات للمحفظة المحددة.",
      },
      {
        name: "تجميع المساهمة المختارة",
        startMonth: reviewEnd + 1,
        endMonth: months,
        budgetMinor: stageBudget(
          diagnosis.investableCashMinor,
          Math.max(0, months - reviewEnd),
          diagnosis.contributionMinor
        ),
        indicator: "الفائض الشهري والمساهمة دون تجاوز سقفها",
        gate: "يتوقف التجميع الاستثماري عند عجز السيولة أو ارتفاع الالتزامات.",
        action: "سجل المساهمة التي اختارها العميل وأعد حساب الفجوة شهريًا.",
      },
    ];
  }

  if (pathId === "income") {
    const evidenceEnd = Math.min(3, months);
    return [
      {
        name: "فرز دخل موثق",
        startMonth: 1,
        endMonth: evidenceEnd,
        budgetMinor: 0,
        indicator: "اكتمال التحصيل والمصروفات والشغور والحقوق",
        gate: "لا يتحول إعلان أو إيجار معلن إلى دخل معتمد.",
        action: "افحص فرصًا ضمن المحفظة والبلد والعملة والمخاطر المسموح بها.",
      },
      {
        name: "قرار مشروط ومتابعة",
        startMonth: evidenceEnd + 1,
        endMonth: months,
        budgetMinor: diagnosis.investableCashMinor,
        indicator: "السيولة بعد الاحتياطي والالتزامات والدليل",
        gate: "القرار يتطلب تحققًا رسميًا منفصلًا وموافقة العميل.",
        action: "قارن صافي التدفق المؤكد ولا تفترض عائدًا أو تمويلًا.",
      },
    ];
  }

  const diligenceEnd = Math.min(3, months);
  const executionEnd = Math.max(diligenceEnd + 1, months - 1);
  return [
    {
      name: "فحص فرصة ودراسة ضغط",
      startMonth: 1,
      endMonth: diligenceEnd,
      budgetMinor: 0,
      indicator: "اكتمال التكلفة والحقوق والأهلية ودراسة الضغط",
      gate: "لا دراسة تنفيذ قبل تحقق الملكية والتكلفة والتمويل إن وجد.",
      action:
        "اختبر البيع والتكلفة والمدة ورفض التمويل دون تغيير هدف العميل بصمت.",
    },
    {
      name: "تنفيذ مشروط ومراقبة",
      startMonth: diligenceEnd + 1,
      endMonth: executionEnd,
      budgetMinor: diagnosis.investableCashMinor,
      indicator: "المدفوعات الفعلية مقابل الخطة والاحتياطي المتبقي",
      gate: "لا يضاف رأس مال أو تمويل لمجرد سد فجوة الهدف.",
      action: "حدّث التكلفة والمدة والسيولة عند كل تغير موثق.",
    },
    {
      name: "إغلاق ومراجعة قرار لاحق",
      startMonth: executionEnd + 1,
      endMonth: months,
      budgetMinor: 0,
      indicator: "تحقق البيع أو التحصيل وصافي السيولة بعد الالتزامات",
      gate: "لا يبدأ مسار جديد قبل تحقق الخروج فعليًا.",
      action: "وثّق النتيجة وراجع الفجوة قبل اقتراح بديل.",
    },
  ];
}

/**
 * Calculates a complete project-cost view. Loan principal is financing, not a cost
 * or profit: total cost includes finance cost once, equity is total cost minus the
 * principal, and the post-debt sale proceeds field only settles principal.
 */
export function calculateDeal(input: DealInput): DealResult {
  validateDeal(input);
  const durationMonths = assertInteger(
    input.buildMonths + input.marketingMonths,
    "مدة الدورة",
    1
  );
  const holdingMinor = safeMultiply(
    input.monthlyHoldingMinor,
    durationMonths,
    "تكلفة الاحتفاظ"
  );
  const initialMarginMinor = safeSubtract(
    input.saleMinor,
    safeAdd(
      [input.purchaseMinor, input.developmentMinor],
      "تكلفة الدخول الأولية"
    ),
    "الهامش الأولي"
  );
  const totalCostMinor = safeAdd(
    [
      input.purchaseMinor,
      input.developmentMinor,
      input.feesMinor,
      input.designMinor,
      input.operatingMinor,
      input.marketingMinor,
      input.financingCostMinor,
      holdingMinor,
      input.reserveMinor,
    ],
    "إجمالي تكلفة الصفقة"
  );
  if (input.loanPrincipalMinor > totalCostMinor)
    fail("أصل التمويل لا يمكن أن يتجاوز إجمالي تكلفة الصفقة");
  const cashRequiredMinor = safeSubtract(
    totalCostMinor,
    input.loanPrincipalMinor,
    "التمويل الذاتي المطلوب"
  );
  const resultMinor = safeSubtract(
    input.saleMinor,
    totalCostMinor,
    "نتيجة الصفقة"
  );
  const saleProceedsAfterDebtMinor = safeSubtract(
    input.saleMinor,
    input.loanPrincipalMinor,
    "حصيلة البيع بعد أصل التمويل"
  );
  const occupiedRentMinor = moneyAfterPercent(
    input.monthlyRentMinor,
    100 - input.vacancyPercent,
    "إيجار ما بعد الشغور"
  );
  const monthlyNetRentMinor = safeSubtract(
    occupiedRentMinor,
    input.monthlyOperatingMinor,
    "صافي الإيجار الشهري"
  );
  const cycleReturnPercent =
    totalCostMinor === 0
      ? null
      : Number(((resultMinor / totalCostMinor) * 100).toFixed(3));
  const warnings: string[] = [
    "نسبة العائد تخص دورة المشروع الكاملة وليست عائدًا سنويًا.",
    "أصل التمويل لا يعد تكلفة أو ربحًا؛ تكلفة التمويل مدرجة مرة واحدة ضمن إجمالي التكلفة.",
  ];
  if (input.saleMinor === 0)
    warnings.push("لا توجد حصيلة بيع مدخلة؛ لا تمثل النتيجة تخارجًا فعليًا.");
  if (saleProceedsAfterDebtMinor < 0)
    warnings.push("سعر البيع المفترض لا يغطي أصل التمويل.");
  if (monthlyNetRentMinor < 0)
    warnings.push("صافي الإيجار الشهري سلبي بعد الشغور والتشغيل.");

  return {
    initialMarginMinor,
    totalCostMinor,
    resultMinor,
    cycleReturnPercent,
    durationMonths,
    cashRequiredMinor,
    saleProceedsAfterDebtMinor,
    monthlyNetRentMinor,
    financingCostMinor: input.financingCostMinor,
    warnings,
  };
}

export function stressDeal(input: DealInput, stress: DealStress): DealResult {
  validateDeal(input);
  assertPercent(stress.saleDeclinePercent, "انخفاض البيع");
  assertPercent(stress.developmentIncreasePercent, "زيادة التطوير");
  assertInteger(stress.delayMonths, "تأخر المشروع");
  if (typeof stress.financingRejected !== "boolean")
    fail("حالة رفض التمويل غير صالحة");

  const stressed: DealInput = {
    ...input,
    saleMinor: moneyAfterPercent(
      input.saleMinor,
      100 - stress.saleDeclinePercent,
      "سعر البيع بعد الضغط"
    ),
    developmentMinor: moneyAfterPercent(
      input.developmentMinor,
      100 + stress.developmentIncreasePercent,
      "تكلفة التطوير بعد الضغط"
    ),
    buildMonths: assertInteger(
      input.buildMonths + stress.delayMonths,
      "مدة البناء بعد الضغط"
    ),
    loanPrincipalMinor: stress.financingRejected ? 0 : input.loanPrincipalMinor,
    financingCostMinor: stress.financingRejected ? 0 : input.financingCostMinor,
  };
  const result = calculateDeal(stressed);
  result.warnings.push(
    "اختبار ضغط: انخفاض البيع وزيادة التكلفة وتأخر الخروج هي افتراضات فحص وليست توقعات."
  );
  if (stress.financingRejected)
    result.warnings.push(
      "اختبار ضغط: التمويل مرفوض؛ أزيل أصل التمويل وتكلفته ولا تمثل النتيجة موافقة بديلة."
    );
  return result;
}

export function constructionReview(
  input: ConstructionReviewInput
): ConstructionReviewResult {
  assertMinor(input.originalBudgetMinor, "ميزانية البناء الأصلية");
  assertMinor(input.revisedCostMinor, "التكلفة المعدلة");
  assertMinor(input.projectCashMinor, "نقد المشروع");
  assertMinor(input.upcomingPaymentsMinor, "الدفعات القادمة");
  assertMinor(input.reserveMinor, "الاحتياطي");
  if (!["quote", "contract", "paid"].includes(input.evidenceStage))
    fail("مرحلة الدليل غير صالحة");
  if (typeof input.equivalentScope !== "boolean")
    fail("حالة تكافؤ النطاق غير صالحة");

  const potentialSavingMinor = Math.max(
    0,
    safeSubtract(
      input.originalBudgetMinor,
      input.revisedCostMinor,
      "فرق الميزانية"
    )
  );
  const freeCashMinor = Math.max(
    0,
    safeAdd(
      [
        input.projectCashMinor,
        -input.upcomingPaymentsMinor,
        -input.reserveMinor,
      ],
      "النقد الحر للمشروع"
    )
  );
  const evidenceAllowsAllocation =
    input.equivalentScope && input.evidenceStage !== "quote";
  const availableForSearchMinor = evidenceAllowsAllocation
    ? Math.min(potentialSavingMinor, freeCashMinor)
    : 0;
  const note = !input.equivalentScope
    ? "لا يمكن اعتبار الفرق وفرًا قبل إثبات تكافؤ النطاق والجودة والشروط."
    : input.evidenceStage === "quote"
      ? "العرض الأقل يوضح وفرًا محتملًا فقط؛ العرض ليس نقدًا حرًا ولا يطلق استثمارًا جديدًا."
      : "المبلغ المؤهل للبحث محدود بالوفر المتحقق وبالنقد الحر بعد الدفعات والاحتياطي؛ لا تنفيذ تلقائي.";

  return {
    potentialSavingMinor,
    freeCashMinor,
    availableForSearchMinor,
    note,
  };
}

export function dealFromEntity(row: DemoEntity): DealInput {
  assertMinor(row.amountMinor, "مبلغ الفرصة");
  const purchaseMinor = zeroOrMetaMinor(row, "purchaseMinor", row.amountMinor);
  return {
    purchaseMinor,
    developmentMinor:
      row.meta.developmentMinor === undefined
        ? zeroOrMetaMinor(row, "rehabMinor", 0)
        : zeroOrMetaMinor(row, "developmentMinor"),
    feesMinor: zeroOrMetaMinor(row, "feesMinor", 0),
    designMinor: zeroOrMetaMinor(row, "designMinor", 0),
    operatingMinor: zeroOrMetaMinor(row, "operatingMinor", 0),
    marketingMinor: zeroOrMetaMinor(row, "marketingMinor", 0),
    reserveMinor: zeroOrMetaMinor(row, "reserveMinor", 0),
    financingCostMinor: zeroOrMetaMinor(row, "financingCostMinor", 0),
    loanPrincipalMinor: zeroOrMetaMinor(row, "loanPrincipalMinor", 0),
    saleMinor:
      row.meta.saleMinor === undefined
        ? zeroOrMetaMinor(row, "expectedValueMinor", 0)
        : zeroOrMetaMinor(row, "saleMinor"),
    monthlyRentMinor:
      row.meta.monthlyRentMinor === undefined
        ? zeroOrMetaMinor(row, "rentMinor", 0)
        : zeroOrMetaMinor(row, "monthlyRentMinor"),
    monthlyOperatingMinor: zeroOrMetaMinor(row, "monthlyOperatingMinor", 0),
    vacancyPercent: assertPercent(
      metaNumber(row, "vacancyPercent", 0),
      "نسبة الشغور"
    ),
    buildMonths: assertInteger(metaNumber(row, "buildMonths", 1), "مدة البناء"),
    marketingMonths: assertInteger(
      metaNumber(row, "marketingMonths", 0),
      "مدة التسويق"
    ),
    monthlyHoldingMinor: zeroOrMetaMinor(row, "monthlyHoldingMinor", 0),
  };
}

function briefRisk(brief: HunterBrief): void {
  assertMinor(brief.cashBudgetMinor, "ميزانية النقد");
  assertMinor(brief.potentialFinancingMinor, "التمويل المحتمل");
  assertMinor(brief.approvedFinancingMinor, "التمويل المعتمد");
  assertInteger(brief.maxMonths, "المدة القصوى", 1);
  if (!["wealth", "income", "debt", "home"].includes(brief.goal))
    fail("هدف القناص غير صالح");
  if (!["low", "medium", "high"].includes(brief.risk))
    fail("مستوى مخاطر القناص غير صالح");
  if (!brief.portfolioId.trim() || !brief.country.trim())
    fail("يلزم تحديد المحفظة والبلد لطلب قناص الفرص");
}

function optionalMetaMinor(row: DemoEntity, key: string): number | undefined {
  const value = row.meta[key];
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") return assertMinor(value, key);
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return assertMinor(Number(value.trim()), key);
  return fail(`${key} في الفرصة يجب أن يكون مبلغًا صحيحًا بوحدة صغرى`);
}

function hunterFunding(
  deal: DealInput,
  result: DealResult,
  brief: HunterBrief
): HunterFunding {
  // A deal has one requested facility. The profile approval can fund it once, never
  // in addition to the cash requirement that already subtracts the same principal.
  const requestedFacilityMinor = deal.loanPrincipalMinor;
  const appliedConfirmedFinancingMinor = Math.min(
    requestedFacilityMinor,
    brief.approvedFinancingMinor,
    result.totalCostMinor
  );
  const cashSourceMinor = Math.min(
    brief.cashBudgetMinor,
    Math.max(0, result.totalCostMinor - appliedConfirmedFinancingMinor)
  );
  const confirmedSourcesMinor = safeAdd(
    [cashSourceMinor, appliedConfirmedFinancingMinor],
    "مصادر التمويل المؤكدة"
  );
  const fundingGapMinor = Math.max(
    0,
    safeSubtract(result.totalCostMinor, confirmedSourcesMinor, "عجز التمويل")
  );
  const appliedPotentialFinancingMinor = Math.min(
    brief.potentialFinancingMinor,
    fundingGapMinor
  );
  const conditionalSourcesMinor = safeAdd(
    [confirmedSourcesMinor, appliedPotentialFinancingMinor],
    "مصادر التمويل المشروطة"
  );
  const conditionalFundingGapMinor = Math.max(
    0,
    safeSubtract(
      result.totalCostMinor,
      conditionalSourcesMinor,
      "عجز التمويل المشروط"
    )
  );
  return {
    usesMinor: result.totalCostMinor,
    requestedFacilityMinor,
    cashSourceMinor,
    appliedConfirmedFinancingMinor,
    potentialFinancingMinor: brief.potentialFinancingMinor,
    appliedPotentialFinancingMinor,
    confirmedSourcesMinor,
    conditionalSourcesMinor,
    fundingGapMinor,
    conditionalFundingGapMinor,
  };
}

function goalEconomicEligibility(
  row: DemoEntity,
  result: DealResult,
  goal: HunterBrief["goal"]
): HunterEconomicEligibility {
  const reasons: string[] = [];
  const missing: string[] = [];
  const criteria: HunterEconomicEligibility["criteria"] = [];
  const criterion = (
    id: string,
    label: string,
    met: boolean | null,
    amountMinor?: number
  ) => criteria.push({ id, label, met, ...(amountMinor === undefined ? {} : { amountMinor }) });

  if (goal === "wealth") {
    const met = result.resultMinor > 0;
    criterion("positiveNetResult", "صافي نتيجة موجب بعد كل التكاليف", met, result.resultMinor);
    if (!met)
      reasons.push("هدف نمو الثروة يتطلب صافي نتيجة موجبة بعد جميع التكاليف.");
  } else if (goal === "income") {
    const met = result.monthlyNetRentMinor > 0;
    criterion(
      "positiveNetRent",
      "صافي إيجار تشغيلي موجب بعد الشغور والتشغيل",
      met,
      result.monthlyNetRentMinor
    );
    if (!met)
      reasons.push("هدف الدخل يتطلب صافي إيجار تشغيلي موجبًا؛ لا يكفي سعر بيع أو دليل مكتمل.");
  } else if (goal === "home") {
    const residenceEligible = metaBooleanAny(row, [
      "residenceEligible",
      "residenceVerified",
    ]);
    const affordabilityVerified = metaBooleanAny(row, [
      "affordabilityVerified",
      "affordabilityEligible",
    ]);
    criterion(
      "residenceEligible",
      "معيار إقامة أو استخدام سكني صريح",
      residenceEligible ?? null
    );
    criterion(
      "affordabilityVerified",
      "معيار قدرة على السداد موثق",
      affordabilityVerified ?? null
    );
    if (residenceEligible === false)
      reasons.push("الفرصة لا تحقق معيار الإقامة أو الاستخدام السكني المعلن.");
    else if (residenceEligible === undefined)
      missing.push("معيار إقامة أو استخدام سكني صريح");
    if (affordabilityVerified === false)
      reasons.push("معيار القدرة على السداد لا يثبت قابلية السكن للعميل.");
    else if (affordabilityVerified === undefined)
      missing.push("معيار قدرة على السداد موثق");
  } else {
    const debtBenefitMinor = optionalMetaMinor(row, "debtBenefitMinor");
    const debtBenefitVerified = metaBooleanAny(row, [
      "debtBenefitVerified",
      "paydownVerified",
      "refinanceVerified",
    ]);
    if (debtBenefitMinor === undefined) {
      criterion("documentedDebtBenefit", "فائدة سداد أو إعادة تمويل موثقة", null);
      missing.push("فائدة سداد أو إعادة تمويل موثقة تشمل تكاليف التمويل الجديد");
    } else {
      const netDebtBenefitMinor = safeSubtract(
        debtBenefitMinor,
        result.financingCostMinor,
        "فائدة الدين الصافية بعد تكلفة التمويل"
      );
      const met = netDebtBenefitMinor > 0;
      criterion(
        "documentedDebtBenefit",
        "فائدة سداد أو إعادة تمويل موجبة بعد تكلفة التمويل الجديد",
        met,
        netDebtBenefitMinor
      );
      if (!met)
        reasons.push("فائدة الدين بعد تكلفة التمويل الجديد ليست موجبة.");
    }
    criterion(
      "debtBenefitVerified",
      "دليل صريح للسداد أو إعادة التمويل",
      debtBenefitVerified ?? null
    );
    if (debtBenefitVerified === false)
      reasons.push("لا يوجد دليل صالح يثبت فائدة سداد أو إعادة تمويل.");
    else if (debtBenefitVerified === undefined)
      missing.push("دليل صريح لفائدة السداد أو إعادة التمويل");
  }

  return {
    goal,
    eligible: reasons.length === 0 && missing.length === 0,
    viable: reasons.length === 0,
    reasons,
    missing,
    criteria,
  };
}

export function evaluateHunter(
  row: DemoEntity,
  brief: HunterBrief
): HunterEvaluation {
  briefRisk(brief);
  const deal = dealFromEntity(row);
  const result = calculateDeal(deal);
  const funding = hunterFunding(deal, result, brief);
  const economicEligibility = goalEconomicEligibility(row, result, brief.goal);
  const missing: string[] = [];
  const country = metaString(row, "country");
  const currencyCode = metaString(row, "currencyCode") || row.currency;
  const source = metaString(row, "source");
  const sourceDate = metaString(row, "sourceDate");
  const kind = metaString(row, "kind") || metaString(row, "type");
  const available = metaBoolean(row, "available");
  const duplicateOf = metaString(row, "duplicateOf");
  const evidenceCount = assertInteger(
    metaNumber(row, "evidenceCount", 0),
    "عدد الأدلة"
  );
  const verified = metaBoolean(row, "verified");
  const rightsVerified = metaBoolean(row, "rightsVerified");
  const eligibilityVerified = metaBoolean(row, "eligibilityVerified");
  const opportunityRisk = metaRisk(row.meta.risk);
  const hardFailures: string[] = [];

  if (row.portfolioId && row.portfolioId !== brief.portfolioId)
    hardFailures.push("الفرصة خارج المحفظة المقصودة");
  if (!country) missing.push("البلد");
  else if (country !== brief.country)
    hardFailures.push("البلد لا يطابق نطاق الطلب");
  if (!currencyCode) missing.push("العملة");
  // The prototype budget is QAR. No FX conversion is invented for SAR/unknown currencies.
  else if (currencyCode !== row.currency)
    hardFailures.push(
      `عملة الفرصة ${currencyCode} لا تطابق ميزانية ${row.currency}`
    );
  if (!source) missing.push("مصدر الإعلان أو الفرصة");
  if (!sourceDate || Number.isNaN(Date.parse(sourceDate)))
    missing.push("تاريخ المصدر");
  if (!kind) missing.push("نوع الفرصة");
  if (available !== true) {
    if (available === false) hardFailures.push("العرض غير متاح");
    else missing.push("تأكيد التوفر");
  }
  if (duplicateOf)
    hardFailures.push("السجل مكرر محتملًا ولا يزيد الدليل أو عدد الفرص");
  if (evidenceCount < 1) missing.push("دليل مستقل واحد على الأقل");
  if (verified !== true) missing.push("تحقق البيانات");
  if (rightsVerified !== true) missing.push("فحص الحقوق أو الملكية");
  if (eligibilityVerified !== true) missing.push("فحص الأهلية والتنظيم");
  if (!opportunityRisk) missing.push("تصنيف المخاطر");
  else if (riskRank(opportunityRisk) > riskRank(brief.risk))
    hardFailures.push("مخاطر الفرصة أعلى من الحد الذي اختاره العميل");

  missing.push(...economicEligibility.missing);
  if (!economicEligibility.viable)
    hardFailures.push(...economicEligibility.reasons);
  if (funding.fundingGapMinor > 0)
    hardFailures.push(
      `عجز تمويل مؤكد قدره ${funding.fundingGapMinor} بعد مصادر الاستخدامات؛ لا يعالج بإضافة نفس القرض مرة ثانية.`
    );
  if (funding.appliedPotentialFinancingMinor > 0)
    missing.push("تمويل محتمل غير مؤكد؛ لا يدخل الملاءمة المالية المؤكدة");
  if (result.durationMonths > brief.maxMonths)
    hardFailures.push("مدة الصفقة تتجاوز الحد الزمني للعميل");

  const financiallyFit = funding.fundingGapMinor === 0;
  const riskFit =
    opportunityRisk !== undefined &&
    riskRank(opportunityRisk) <= riskRank(brief.risk);
  const suitable =
    hardFailures.length === 0 &&
    financiallyFit &&
    riskFit &&
    economicEligibility.viable;
  const conditional = suitable && missing.length > 0;
  const cashScore =
    funding.usesMinor === 0
      ? 25
      : Math.max(
          0,
          Math.min(
            25,
            Math.round((funding.confirmedSourcesMinor / funding.usesMinor) * 25)
          )
        );
  const timeScore = Math.max(
    0,
    Math.min(25, Math.round((brief.maxMonths / result.durationMonths) * 25))
  );
  const riskScore = opportunityRisk && riskFit ? 15 : 0;
  const evidenceScore =
    Math.min(15, evidenceCount * 3) +
    (verified === true ? 3 : 0) +
    (rightsVerified === true ? 3 : 0) +
    (eligibilityVerified === true ? 3 : 0);
  const economicScore = economicEligibility.eligible ? 25 : 0;
  const preliminaryScore =
    hardFailures.length > 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            cashScore + timeScore + riskScore + evidenceScore + economicScore
          )
        );
  const score = economicEligibility.eligible
    ? preliminaryScore
    : Math.min(25, preliminaryScore);
  const state =
    hardFailures.length > 0
      ? "غير مناسبة حاليًا"
      : conditional
        ? "مرصودة · تحتاج تحققًا"
        : "مرشحة للدراسة وليست معتمدة";
  const reasons = [...hardFailures];
  const reason = reasons.length
    ? reasons.join("؛ ")
    : conditional
      ? `مطابقة أولية مشروطة: ${missing.join("، ")}.`
      : "مطابقة أولية للحساب فقط؛ يلزم قرار العميل وفحوص مستقلة قبل أي تنفيذ.";

  return {
    id: row.id,
    suitable,
    conditional,
    financiallyFit,
    state,
    reason,
    reasons,
    score,
    missing,
    funding,
    economicEligibility,
    result,
  };
}

export function profileFromEntity(row: DemoEntity): AdvisorProfile {
  const goal = metaString(row, "goal");
  const horizon = metaNumber(row, "horizonYears", metaNumber(row, "years", 1));
  const risk = metaRisk(row.meta.risk) ?? "medium";
  const profile: AdvisorProfile = {
    portfolioId: row.portfolioId,
    goal:
      goal === "income" ||
      goal === "debt" ||
      goal === "home" ||
      goal === "wealth"
        ? goal
        : "wealth",
    targetMinor: zeroOrMetaMinor(row, "targetMinor", row.amountMinor),
    horizonYears:
      horizon === 1 || horizon === 5 || horizon === 10 ? horizon : 1,
    cashMinor:
      row.meta.cashMinor === undefined
        ? zeroOrMetaMinor(row, "externalCashMinor", 0)
        : zeroOrMetaMinor(row, "cashMinor"),
    assetValueMinor: zeroOrMetaMinor(row, "assetValueMinor", 0),
    debtMinor: zeroOrMetaMinor(row, "debtMinor", 0),
    salaryMinor: zeroOrMetaMinor(row, "salaryMinor", 0),
    businessIncomeMinor: zeroOrMetaMinor(row, "businessIncomeMinor", 0),
    livingMinor: zeroOrMetaMinor(row, "livingMinor", 0),
    installmentMinor: zeroOrMetaMinor(row, "installmentMinor", 0),
    monthlyContributionMinor: zeroOrMetaMinor(
      row,
      "monthlyContributionMinor",
      zeroOrMetaMinor(row, "savingsMinor", 0)
    ),
    emergencyReserveMinor: zeroOrMetaMinor(row, "emergencyReserveMinor", 0),
    monthlyWithdrawalMinor: zeroOrMetaMinor(row, "monthlyWithdrawalMinor", 0),
    risk,
    lockMonths: assertInteger(
      metaNumber(row, "lockMonths", 0),
      "مدة تجميد المال"
    ),
    hoursMonthly: assertInteger(
      metaNumber(row, "hoursMonthly", 0),
      "الساعات الشهرية"
    ),
    potentialFinancingMinor: zeroOrMetaMinor(row, "potentialFinancingMinor", 0),
    approvedFinancingMinor: zeroOrMetaMinor(row, "approvedFinancingMinor", 0),
    financingInstallmentMinor: zeroOrMetaMinor(
      row,
      "financingInstallmentMinor",
      0
    ),
    dataDate: metaString(row, "dataDate") || row.date,
    source: metaString(row, "source") || row.subtitle || row.title,
    operatingWindowStart: metaString(row, "operatingWindowStart") || undefined,
    operatingWindowEnd: metaString(row, "operatingWindowEnd") || undefined,
  };
  validateProfile(profile);
  return profile;
}

export function profileToMeta(
  profile: AdvisorProfile
): Record<string, string | number | boolean> {
  validateProfile(profile);
  const meta: Record<string, string | number | boolean> = {
    portfolioId: profile.portfolioId,
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
    ...(profile.operatingWindowStart
      ? { operatingWindowStart: profile.operatingWindowStart }
      : {}),
    ...(profile.operatingWindowEnd
      ? { operatingWindowEnd: profile.operatingWindowEnd }
      : {}),
  };
  if (Object.keys(meta).length > 32)
    fail("بيانات الملف تتجاوز عدد الحقول المسموح");
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" && value.length > 1024)
      fail(`${key} يتجاوز طول بيانات التعريف المسموح`);
  }
  return meta;
}
