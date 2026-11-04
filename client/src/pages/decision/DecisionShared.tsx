import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash2,
  Database,
  FileCheck2,
  ShieldAlert,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DemoEntity,
  FeatureDefinition,
  MetaValue,
} from "@shared/prototype";
import { money, toMinor } from "@shared/prototype";
import { Badge, EmptyState, Panel } from "@/components/app/Primitives";

export const TODAY = "2026-10-24";
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export { FEATURE_DEFINITIONS } from "@shared/service-definitions";

export const MARKET_SAMPLES: DemoEntity[] = [
  {
    id: "sample-lusail-01",
    title: "شقة غرفتين · لوسيل",
    subtitle: "إعلان صوري مرخص للمراجعة",
    portfolioId: "market",
    propertyId: "",
    status: "مراجع",
    date: "2026-10-18",
    amountMinor: 880000,
    currency: "QAR",
    meta: {
      area: "لوسيل",
      evidenceType: "إعلان",
      bedrooms: 2,
      source: "سجل تجريبي",
      rights: "نموذج داخلي",
    },
  },
  {
    id: "sample-lusail-02",
    title: "شقة غرفتين · لوسيل",
    subtitle: "عقد صوري بعينة محدودة",
    portfolioId: "market",
    propertyId: "",
    status: "مراجع",
    date: "2026-09-30",
    amountMinor: 810000,
    currency: "QAR",
    meta: {
      area: "لوسيل",
      evidenceType: "عقد",
      bedrooms: 2,
      source: "سجل تجريبي",
      rights: "نموذج داخلي",
    },
  },
  {
    id: "sample-westbay-01",
    title: "شقة غرفتين · الخليج الغربي",
    subtitle: "صفقة صورية بعينة محدودة",
    portfolioId: "market",
    propertyId: "",
    status: "مراجع",
    date: "2026-08-21",
    amountMinor: 1040000,
    currency: "QAR",
    meta: {
      area: "الخليج الغربي",
      evidenceType: "صفقة",
      bedrooms: 2,
      source: "سجل تجريبي",
      rights: "نموذج داخلي",
    },
  },
  {
    id: "sample-lusail-03",
    title: "شقة غرفتين · لوسيل",
    subtitle: "إعلان صوري يحتاج تحققاً مستقلاً",
    portfolioId: "market",
    propertyId: "",
    status: "وارد",
    date: "2026-10-11",
    amountMinor: 930000,
    currency: "QAR",
    meta: {
      area: "لوسيل",
      evidenceType: "إعلان",
      bedrooms: 2,
      source: "سجل تجريبي",
      rights: "نموذج داخلي",
    },
  },
];

// لا تتضمن هذه العينات أرقام تقييم أو رسوم أو عائد. النص الدليلي وحده لا يحقق
// اكتمال F30، ولذلك تبقى dataComplete = false حتى لو عُرضت في المقارنة.
export const OPPORTUNITY_FIXTURES: DemoEntity[] = [
  {
    id: "opp-1",
    title: "فيلا قابلة للتجهيز · الخور",
    subtitle: "فرصة خيالية؛ تحتاج كشفاً فنياً قبل التحليل",
    portfolioId: "decision",
    propertyId: "",
    status: "مؤهل أولياً",
    date: "2026-10-23",
    amountMinor: 245000000,
    currency: "QAR",
    meta: {
      kind: "فيلا",
      source: "سجل عروض تجريبي",
      freshness: "يومان",
      match: "مرتفع",
      evidence: "صور وصفية فقط",
      dataComplete: false,
    },
  },
  {
    id: "opp-2",
    title: "أرض سكنية · أم صلال",
    subtitle: "فرصة خيالية؛ حدود التطوير غير مؤكدة",
    portfolioId: "decision",
    propertyId: "",
    status: "قيد مراجعة",
    date: "2026-10-20",
    amountMinor: 170000000,
    currency: "QAR",
    meta: {
      kind: "أرض",
      source: "قائمة داخلية تجريبية",
      freshness: "خمسة أيام",
      match: "متوسط",
      evidence: "موقع ومساحة صوريان",
      dataComplete: false,
    },
  },
  {
    id: "opp-3",
    title: "عمارة ناقصة التشغيل · الوكرة",
    subtitle: "فرصة خيالية؛ بيانات الإشغال ناقصة",
    portfolioId: "decision",
    propertyId: "",
    status: "مؤهل أولياً",
    date: "2026-10-09",
    amountMinor: 320000000,
    currency: "QAR",
    meta: {
      kind: "عقار ناقص",
      source: "سجل عروض تجريبي",
      freshness: "أسبوعان",
      match: "مرتفع",
      evidence: "إيراد غير موثق",
      dataComplete: false,
    },
  },
  {
    id: "opp-4",
    title: "مناقصة تطوير محدودة · الدوحة",
    subtitle: "فرصة خيالية؛ لا تمثل دعوة حقيقية",
    portfolioId: "decision",
    propertyId: "",
    status: "ملتقطة",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {
      kind: "مناقصة",
      source: "محاكاة موصل",
      freshness: "اليوم",
      match: "منخفض",
      evidence: "شروط أولية فقط",
      dataComplete: false,
    },
  },
];

export const SOURCE_FIXTURES: DemoEntity[] = [
  {
    id: "source-internal-demo",
    title: "سجل السوق التجريبي",
    subtitle: "عينات داخل النموذج فقط",
    portfolioId: "data",
    propertyId: "",
    status: "بيانات اختبار",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {
      country: "قطر",
      dataCurrency: "QAR",
      rights: "نموذج داخلي",
      quality: "محدودة",
      connector: "غير مطلوب",
    },
  },
  {
    id: "source-rentcast",
    title: "نموذج موصل RentCast",
    subtitle: "كتالوج تصميمي، غير مفعّل لقطر",
    portfolioId: "data",
    propertyId: "",
    status: "موقوف",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {
      country: "الولايات المتحدة",
      dataCurrency: "USD",
      rights: "تحتاج اتفاقاً",
      quality: "غير مقيمة لقطر",
      connector: "مقترح",
    },
  },
  {
    id: "source-permitted-partner",
    title: "شريك بيانات افتراضي",
    subtitle: "لا عقد أو حقوق استخدام فعلية في النموذج",
    portfolioId: "data",
    propertyId: "",
    status: "تصميم مقترح",
    date: "2026-10-15",
    amountMinor: 0,
    currency: "QAR",
    meta: {
      country: "قطر",
      dataCurrency: "QAR",
      rights: "غير متحققة",
      quality: "بانتظار عينة",
      connector: "مقترح",
    },
  },
];

export const FUNDING_CHECKLIST = [
  "تعريف العميل والهوية المصرّح بمشاركتها",
  "ملخص فرصة صوري وحدود استخدامها",
  "إثبات السيولة أو مصدر التمويل المحتمل",
  "تقييم المخاطر والنواقص غير المكتملة",
  "موافقة إرسال مستقلة باسم المستلم",
];

export const PLAN_OPTIONS = [
  {
    key: "starter-monthly",
    title: "استكشاف شهري",
    billing: "شهري",
    price: "سعر توضيحي غير معتمد",
    setup: "رسم إعداد اختياري: غير معتمد",
    limit: "محفظة واحدة · 3 تقارير قرار",
  },
  {
    key: "growth-annual",
    title: "نمو سنوي",
    billing: "سنوي",
    price: "سعر توضيحي غير معتمد",
    setup: "رسم إعداد اختياري: غير معتمد",
    limit: "3 محافظ · مراجعة شهرية صورية",
  },
  {
    key: "advisory",
    title: "استشارة بشرية",
    billing: "خدمة اختيارية",
    price: "يسعّر بعد اعتماد نطاق العمل",
    setup: "لا يشمل أي تمويل أو عائد",
    limit: "حزمة قرار ومراجعة بشرية",
  },
];

export function mergeRows(
  fixtures: DemoEntity[],
  rows: DemoEntity[]
): DemoEntity[] {
  const byId = new Map(fixtures.map(item => [item.id, item]));
  rows.forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

export function meta(row: DemoEntity, key: string, fallback = "-"): string {
  return String(row.meta[key] ?? fallback);
}

export function isSafeMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_MINOR
  );
}

export function checkedAddMinor(...values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!isSafeMinor(value) || total > MAX_SAFE_MINOR - value) return null;
    total += value;
  }
  return total;
}

export function checkedMultiplyMinor(
  value: number,
  multiplier: number
): number | null {
  if (
    !isSafeMinor(value) ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 0 ||
    (multiplier > 0 && value > Math.floor(MAX_SAFE_MINOR / multiplier))
  )
    return null;
  return value * multiplier;
}

/** يحسب النسبة بنقاط الأساس مع floor لتبقى النتيجة عدداً صحيحاً من العملة الصغرى. */
export function multiplyPercentBpsFloor(
  value: number,
  bps: number
): number | null {
  if (
    !isSafeMinor(value) ||
    !Number.isSafeInteger(bps) ||
    bps < 0 ||
    bps > 10000
  )
    return null;
  if (bps === 0 || value === 0) return 0;
  if (value > Math.floor(MAX_SAFE_MINOR / bps)) return null;
  const result = Math.floor((value * bps) / 10000);
  return isSafeMinor(result) ? result : null;
}

/** يقبل 0 إلى 100.00% ويحوله إلى bps من دون حساب عشري عائم. */
export function parsePercentBps(value: string): {
  value?: number;
  error?: string;
} {
  const text = value.trim().replace(/,/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text))
    return { error: "أدخل نسبة من 0 إلى 100 بمنزلتين عشريتين كحد أقصى." };
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps > 10000)
    return { error: "النسبة الافتراضية يجب ألا تتجاوز 100%." };
  return { value: bps };
}

export function sumMinor(rows: DemoEntity[]): number {
  const total = checkedAddMinor(...rows.map(row => row.amountMinor));
  return total ?? 0;
}

export function bpsLabel(bps: number): string {
  return `${(bps / 100).toLocaleString("en-QA", { maximumFractionDigits: 2 })}%`;
}

export function parseMinor(value: string): { value?: number; error?: string } {
  try {
    return { value: toMinor(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "تعذر قراءة المبلغ",
    };
  }
}

export interface RentSummary {
  minMinor: number;
  maxMinor: number;
  middleMinor: number;
  evidence: Record<string, number>;
  missingEvidence: boolean;
}

export function summarizeRent(rows: DemoEntity[]): RentSummary | null {
  if (!rows.length) return null;
  const values = rows
    .map(row => row.amountMinor)
    .filter(isSafeMinor)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = values[Math.floor(values.length / 2)] ?? 0;
  const evidence = rows.reduce<Record<string, number>>((current, row) => {
    const type = meta(row, "evidenceType", "غير مصنف");
    current[type] = (current[type] ?? 0) + 1;
    return current;
  }, {});
  return {
    minMinor: values[0] ?? 0,
    maxMinor: values[values.length - 1] ?? 0,
    middleMinor: middle,
    evidence,
    missingEvidence: !evidence.عقد || !evidence.صفقة,
  };
}

export interface GrowthInputs {
  goalMonthlyMinor: number;
  resourcesMinor: number;
  livingMonthlyMinor: number;
  monthlySavingsMinor: number;
  possibleFundingMinor: number;
  evidenceReady: boolean;
}

export interface GrowthStage {
  year: "1" | "5" | "10";
  phase: string;
  goalMonthlyMinor: number;
  requirementMinor: number;
  savedMinor: number;
  confirmedResourcesMinor: number;
  possibleFundingMinor: number;
  confirmedGapMinor: number;
  conditionalGapMinor: number;
  monthlyIndicator: string;
  reviewReason: string;
  executable: boolean;
  note: string;
}

export interface GrowthResult {
  annualGoalMinor: number;
  annualLivingMinor: number;
  annualSavingsMinor: number;
  confirmedCurrentMinor: number;
  possibleFundingMinor: number;
  gapMinor: number;
  feasible: boolean;
  evidenceReady: boolean;
  safe: boolean;
  error?: string;
  stages: GrowthStage[];
}

const GROWTH_STAGE_CONFIG: Array<{
  year: GrowthStage["year"];
  months: number;
  targetBps: number;
  phase: string;
  note: string;
  reviewReason: string;
}> = [
  {
    year: "1",
    months: 12,
    targetBps: 5000,
    phase: "تثبيت الأساس",
    note: "تصور سنة أولى: يربط 50% من هدف الدخل المدخل بمراجعة السيولة والادخار كل شهر.",
    reviewReason: "تحقق من السيولة، الادخار، والدليل قبل الانتقال من التشخيص.",
  },
  {
    year: "5",
    months: 60,
    targetBps: 7500,
    phase: "تدرج منضبط",
    note: "تصور خمس سنوات: يربط 75% من الهدف المدخل بتراكم الادخار المعلن فقط، بلا عائد مفترض.",
    reviewReason: "أعد فحص الفجوة والأدلة عند كل شهر وعند نهاية كل سنة.",
  },
  {
    year: "10",
    months: 120,
    targetBps: 10000,
    phase: "حماية المسار",
    note: "تصور عشر سنوات: يبلغ 100% من هدف الدخل المدخل ولا يفترض نمواً أو سعراً أو عائداً.",
    reviewReason: "أعد اعتماد الهدف والقيود عند أي تغير في المخاطر أو الموارد.",
  },
];

export function calculateGrowth(input: GrowthInputs): GrowthResult {
  const empty = (error: string): GrowthResult => ({
    annualGoalMinor: 0,
    annualLivingMinor: 0,
    annualSavingsMinor: 0,
    confirmedCurrentMinor: 0,
    possibleFundingMinor: 0,
    gapMinor: 0,
    feasible: false,
    evidenceReady: input.evidenceReady,
    safe: false,
    error,
    stages: [],
  });
  if (
    ![
      input.goalMonthlyMinor,
      input.resourcesMinor,
      input.livingMonthlyMinor,
      input.monthlySavingsMinor,
      input.possibleFundingMinor,
    ].every(isSafeMinor)
  ) {
    return empty(
      "تعذر الحساب: يجب أن تكون كل المدخلات أعداداً صحيحة آمنة بوحدة العملة الصغرى."
    );
  }
  const annualGoalMinor = checkedMultiplyMinor(input.goalMonthlyMinor, 12);
  const annualLivingMinor = checkedMultiplyMinor(input.livingMonthlyMinor, 12);
  const annualSavingsMinor = checkedMultiplyMinor(
    input.monthlySavingsMinor,
    12
  );
  if (
    annualGoalMinor === null ||
    annualLivingMinor === null ||
    annualSavingsMinor === null
  )
    return empty("تعذر الحساب لأن المضاعفة تتجاوز الحد الآمن.");

  const stages: GrowthStage[] = [];
  for (const config of GROWTH_STAGE_CONFIG) {
    const goalMonthlyMinor = multiplyPercentBpsFloor(
      input.goalMonthlyMinor,
      config.targetBps
    );
    const annualTargetMinor =
      goalMonthlyMinor === null
        ? null
        : checkedMultiplyMinor(goalMonthlyMinor, 12);
    const annualNeed =
      annualTargetMinor === null || annualLivingMinor === null
        ? null
        : checkedAddMinor(annualTargetMinor, annualLivingMinor);
    const savedMinor = checkedMultiplyMinor(
      input.monthlySavingsMinor,
      config.months
    );
    const confirmedResourcesMinor =
      savedMinor === null
        ? null
        : checkedAddMinor(input.resourcesMinor, savedMinor);
    const conditionalResourcesMinor =
      confirmedResourcesMinor === null
        ? null
        : checkedAddMinor(confirmedResourcesMinor, input.possibleFundingMinor);
    if (
      goalMonthlyMinor === null ||
      annualNeed === null ||
      savedMinor === null ||
      confirmedResourcesMinor === null ||
      conditionalResourcesMinor === null
    )
      return empty("تعذر الحساب لأن الجمع أو الضرب يتجاوز الحد الآمن.");
    const confirmedGapMinor = Math.max(0, annualNeed - confirmedResourcesMinor);
    const conditionalGapMinor = Math.max(
      0,
      annualNeed - conditionalResourcesMinor
    );
    const monthlyNeed = checkedAddMinor(
      goalMonthlyMinor,
      input.livingMonthlyMinor
    );
    if (monthlyNeed === null)
      return empty("تعذر الحساب لأن إجمالي المؤشر الشهري يتجاوز الحد الآمن.");
    stages.push({
      year: config.year,
      phase: config.phase,
      goalMonthlyMinor,
      requirementMinor: annualNeed,
      savedMinor,
      confirmedResourcesMinor,
      possibleFundingMinor: input.possibleFundingMinor,
      confirmedGapMinor,
      conditionalGapMinor,
      monthlyIndicator: `هدف دخل ${money(goalMonthlyMinor)} · ادخار مدخل ${money(input.monthlySavingsMinor)} · التزام معيشة ${money(input.livingMonthlyMinor)} شهرياً`,
      reviewReason: config.reviewReason,
      executable: input.evidenceReady && confirmedGapMinor === 0,
      note: config.note,
    });
  }
  const first = stages[0];
  return {
    annualGoalMinor,
    annualLivingMinor,
    annualSavingsMinor,
    confirmedCurrentMinor: input.resourcesMinor,
    possibleFundingMinor: input.possibleFundingMinor,
    gapMinor: first?.confirmedGapMinor ?? 0,
    feasible: Boolean(
      input.evidenceReady &&
        stages.every(stage => stage.confirmedGapMinor === 0)
    ),
    evidenceReady: input.evidenceReady,
    safe: true,
    stages,
  };
}

export type OpportunityScenario = "شراء" | "تطوير" | "بيع" | "احتفاظ";

export const OPPORTUNITY_SCENARIO_CONFIG: Record<
  OpportunityScenario,
  {
    label: string;
    usesFees: boolean;
    usesSetup: boolean;
    setupLabel: string;
    rateLabel: string;
  }
> = {
  شراء: {
    label: "شراء",
    usesFees: true,
    usesSetup: false,
    setupLabel: "تجهيز لا يدخل في شراء هذا التصور",
    rateLabel: "نسبة رسوم شراء افتراضية",
  },
  تطوير: {
    label: "تطوير",
    usesFees: true,
    usesSetup: true,
    setupLabel: "تجهيز/تطوير",
    rateLabel: "نسبة تكلفة تطوير افتراضية",
  },
  بيع: {
    label: "بيع",
    usesFees: true,
    usesSetup: true,
    setupLabel: "تجهيز/بيع",
    rateLabel: "نسبة تكلفة بيع افتراضية",
  },
  احتفاظ: {
    label: "احتفاظ",
    usesFees: false,
    usesSetup: true,
    setupLabel: "تجهيز احتفاظ",
    rateLabel: "نسبة تكلفة احتفاظ افتراضية",
  },
};

export interface OpportunityEvidence {
  expectedValueMinor?: number;
  rehabMinor?: number;
  feesMinor?: number;
  rentMinor?: number;
  dataComplete: boolean;
  needsData: boolean;
}

export function opportunityEvidence(row: DemoEntity): OpportunityEvidence {
  const numberAt = (key: string) =>
    isSafeMinor(row.meta[key]) ? Number(row.meta[key]) : undefined;
  const expectedValueMinor = numberAt("expectedValueMinor");
  const rehabMinor = numberAt("rehabMinor");
  const feesMinor = numberAt("feesMinor");
  const rentMinor = numberAt("rentMinor");
  const dataComplete =
    row.meta.dataComplete === true &&
    isSafeMinor(row.amountMinor) &&
    row.amountMinor > 0 &&
    expectedValueMinor !== undefined &&
    rehabMinor !== undefined &&
    feesMinor !== undefined &&
    rentMinor !== undefined;
  return {
    expectedValueMinor,
    rehabMinor,
    feesMinor,
    rentMinor,
    dataComplete,
    needsData: !dataComplete,
  };
}

export interface OpportunityCalculatorInput {
  askingPriceMinor: number;
  cashMinor: number;
  potentialFundingMinor: number;
  reserveMinor: number;
  feesMinor: number;
  setupMinor: number;
  scenarioRateBps: number;
  scenario: OpportunityScenario;
  dataComplete: boolean;
}

export interface OpportunityCalculation {
  safe: boolean;
  error?: string;
  askingPriceMinor: number;
  confirmedMaxPriceMinor: number;
  maximumPriceMinor: number;
  totalCostsMinor: number;
  reserveMinor: number;
  feesMinor: number;
  setupMinor: number;
  scenarioRateCostMinor: number;
  potentialFundingMinor: number;
  withinConfirmedLiquidity: boolean;
  withinLiquidity: boolean;
  needsData: boolean;
  decisionBlocked: boolean;
}

export function calculateOpportunityScenario(
  input: OpportunityCalculatorInput
): OpportunityCalculation {
  const invalid = (error: string): OpportunityCalculation => ({
    safe: false,
    error,
    askingPriceMinor: 0,
    confirmedMaxPriceMinor: 0,
    maximumPriceMinor: 0,
    totalCostsMinor: 0,
    reserveMinor: 0,
    feesMinor: 0,
    setupMinor: 0,
    scenarioRateCostMinor: 0,
    potentialFundingMinor: 0,
    withinConfirmedLiquidity: false,
    withinLiquidity: false,
    needsData: true,
    decisionBlocked: true,
  });
  const config = OPPORTUNITY_SCENARIO_CONFIG[input.scenario];
  if (!config) return invalid("سيناريو غير صالح.");
  if (
    ![
      input.askingPriceMinor,
      input.cashMinor,
      input.potentialFundingMinor,
      input.reserveMinor,
      input.feesMinor,
      input.setupMinor,
    ].every(isSafeMinor)
  ) {
    return invalid(
      "تعذر الحساب: قيمة ليست مبلغاً صحيحاً آمناً بوحدة العملة الصغرى."
    );
  }
  const scenarioRateCostMinor = multiplyPercentBpsFloor(
    input.askingPriceMinor,
    input.scenarioRateBps
  );
  if (scenarioRateCostMinor === null)
    return invalid("تعذر حساب نسبة الافتراض ضمن الحد الآمن.");
  const appliedFeesMinor = config.usesFees ? input.feesMinor : 0;
  const appliedSetupMinor = config.usesSetup ? input.setupMinor : 0;
  const totalCostsMinor = checkedAddMinor(
    input.reserveMinor,
    appliedFeesMinor,
    appliedSetupMinor,
    scenarioRateCostMinor
  );
  const availableWithPotential = checkedAddMinor(
    input.cashMinor,
    input.potentialFundingMinor
  );
  if (totalCostsMinor === null || availableWithPotential === null)
    return invalid("تعذر جمع السيولة أو التكاليف ضمن الحد الآمن.");
  const confirmedMaxPriceMinor = Math.max(0, input.cashMinor - totalCostsMinor);
  const maximumPriceMinor = Math.max(
    0,
    availableWithPotential - totalCostsMinor
  );
  const withinConfirmedLiquidity =
    input.askingPriceMinor <= confirmedMaxPriceMinor;
  const withinLiquidity = input.askingPriceMinor <= maximumPriceMinor;
  const needsData = !input.dataComplete;
  return {
    safe: true,
    askingPriceMinor: input.askingPriceMinor,
    confirmedMaxPriceMinor,
    maximumPriceMinor,
    totalCostsMinor,
    reserveMinor: input.reserveMinor,
    feesMinor: appliedFeesMinor,
    setupMinor: appliedSetupMinor,
    scenarioRateCostMinor,
    potentialFundingMinor: input.potentialFundingMinor,
    withinConfirmedLiquidity,
    withinLiquidity,
    needsData,
    decisionBlocked: needsData || !withinLiquidity,
  };
}

// توافق محدود للحاسبة السابقة؛ يستخدم فقط مدخلات صحيحة آمنة ولا يتجاوز الصفر.
export interface PriceInputs {
  cashMinor: number;
  fundingMinor: number;
  reserveMinor: number;
  acquisitionMinor: number;
  repairMinor: number;
}

export function calculateMaximumPrice(input: PriceInputs): number {
  const total = checkedAddMinor(input.cashMinor, input.fundingMinor);
  const costs = checkedAddMinor(
    input.reserveMinor,
    input.acquisitionMinor,
    input.repairMinor
  );
  return total === null || costs === null ? 0 : Math.max(0, total - costs);
}

export function modeLabel(mode: FeatureDefinition["mode"]): string {
  if (mode === "interactive") return "بروتوتايب تفاعلي";
  if (mode === "simulation") return "محاكاة محلية";
  return "موصل خارجي معلّق";
}

export function modeTone(
  mode: FeatureDefinition["mode"]
): "green" | "amber" | "blue" {
  return mode === "interactive"
    ? "green"
    : mode === "simulation"
      ? "blue"
      : "amber";
}

export function ChartPanel({
  title,
  description,
  data,
  dataKey,
  nameKey = "name",
  format = value => String(value),
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number>>;
  dataKey: string;
  nameKey?: string;
  format?: (value: number) => string;
}) {
  return (
    <Panel title={title} description={description} className="chart-panel">
      <div style={{ width: "100%", height: 230 }} aria-label={title}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 10, left: 0, right: 10, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={nameKey} tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={value => format(Number(value))}
              width={70}
            />
            <Tooltip formatter={value => format(Number(value))} />
            <Bar dataKey={dataKey} fill="#826c45" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function StatusLine({
  tone = "blue",
  children,
}: {
  tone?: "green" | "amber" | "red" | "blue" | "gray";
  children: ReactNode;
}) {
  return (
    <div className="muted">
      <Badge tone={tone}>{children}</Badge>
    </div>
  );
}

export function LocalOnly({ children }: { children: ReactNode }) {
  return (
    <div className="muted" role="note">
      <CircleSlash2 size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function EvidenceNotice({
  complete,
  children,
}: {
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        complete
          ? "evidence-note evidence-ok"
          : "evidence-note evidence-warning"
      }
    >
      {complete ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{children}</span>
    </div>
  );
}

export function QualityFlag({
  label,
  status,
  detail,
}: {
  label: string;
  status: "good" | "review" | "block";
  detail: string;
}) {
  const icon =
    status === "good" ? (
      <FileCheck2 size={17} />
    ) : status === "block" ? (
      <ShieldAlert size={17} />
    ) : (
      <Database size={17} />
    );
  const tone =
    status === "good" ? "green" : status === "block" ? "red" : "amber";
  return (
    <div className="quality-flag">
      <div>{icon}</div>
      <div>
        <strong>{label}</strong>
        <p className="muted">{detail}</p>
      </div>
      <Badge tone={tone}>
        {status === "good"
          ? "كافٍ"
          : status === "block"
            ? "يوقف القرار"
            : "مراجعة"}
      </Badge>
    </div>
  );
}

export function downloadLocalExport(payload: Record<string, unknown>): string {
  const contents = JSON.stringify(payload, null, 2);
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "sunnaafurs-prototype-export.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return `تجهيز ملف تصدير محلي (${contents.length.toLocaleString("en-QA")} بايت)`;
}

export function entityInput(title: string, extras: Partial<DemoEntity> = {}) {
  return {
    title,
    subtitle: extras.subtitle ?? "سجل صوري داخل البروتوتايب",
    portfolioId: extras.portfolioId ?? "family",
    propertyId: extras.propertyId ?? "",
    status: extras.status ?? "مسودة",
    date: extras.date ?? TODAY,
    amountMinor: extras.amountMinor ?? 0,
    currency: "QAR" as const,
    meta: (extras.meta ?? {}) as Record<string, MetaValue>,
  };
}

export { EmptyState, money };
