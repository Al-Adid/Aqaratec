import type { DemoEntity, MetaValue, NewEntity } from "@shared/prototype";
import { PROTOTYPE_DATE, toMinor } from "@shared/prototype";

export const HUNTER_RECORD_TYPE = "hunter-opportunity";
export const HUNTER_BRIEF_RECORD_TYPE = "hunter-brief";
export const HUNTER_FEEDBACK_RECORD_TYPE = "hunter-feedback";
export const HUNTER_EXECUTION_TASK_RECORD_TYPE = "hunter-execution-review";

export const HUNTER_DEFAULT_PROFILE_ID = "advisor-default-fictional";
export const HUNTER_DEFAULT_SOURCE_PLAN_ID = "advisor-default-fictional";
export const HUNTER_SOURCE_LABEL = "مرجع تجريبي · لا مصدر سوقي فعلي";

export type HunterFixture = Omit<DemoEntity, "portfolioId" | "propertyId"> & {
  meta: Record<string, MetaValue>;
};

const qar = (value: string) => toMinor(value);

/**
 * جميع هذه العروض افتراضية داخل المنتج. sourceIdentity ثابت عمداً كي يكون
 * فحص التكرار قابلاً للاختبار ولا يوحي بأي مسح أو رابط سوق فعلي.
 */
export const HUNTER_FIXTURES: readonly HunterFixture[] = [
  {
    id: "fixture-shahania-land",
    title: "أرض الشحانية وبناء فيلا · مثال حواري",
    subtitle: "مرجع تجريبي؛ ليس عرض أرض أو تقييمًا قائمًا.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("1000000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/shahania-land-001",
      purchaseMinor: qar("1000000"),
      developmentMinor: qar("800000"),
      feesMinor: qar("50000"),
      designMinor: 0,
      operatingMinor: 0,
      marketingMinor: 0,
      reserveMinor: 0,
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("2500000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 12,
      marketingMonths: 6,
      monthlyHoldingMinor: 0,
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-20",
      available: true,
      duplicateOf: "",
      evidenceCount: 1,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "أرض وبناء ثم بيع",
      risk: "high",
    },
  },
  {
    id: "fixture-shahania-duplicate",
    title: "أرض الشحانية · إدخال مكرر للمثال",
    subtitle: "مرجع تجريبي مكرر لنفس هوية المصدر الثابتة.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("1000000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/shahania-land-001",
      purchaseMinor: qar("1000000"),
      developmentMinor: qar("800000"),
      feesMinor: qar("50000"),
      designMinor: 0,
      operatingMinor: 0,
      marketingMinor: 0,
      reserveMinor: 0,
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("2500000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 12,
      marketingMonths: 6,
      monthlyHoldingMinor: 0,
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-20",
      available: true,
      duplicateOf: "fixture-shahania-land",
      evidenceCount: 1,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "أرض وبناء ثم بيع",
      risk: "high",
    },
  },
  {
    id: "fixture-villa-optimization",
    title: "فيلا قائمة · تحسين تشغيل افتراضي",
    subtitle: "مرجع تجريبي لتحسين أصل قائم؛ لا إيجار أو سعر سوق مثبت.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("1200000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/villa-optimization-002",
      purchaseMinor: qar("1200000"),
      developmentMinor: qar("75000"),
      feesMinor: qar("30000"),
      designMinor: qar("15000"),
      operatingMinor: qar("15000"),
      marketingMinor: 0,
      reserveMinor: qar("20000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("1450000"),
      monthlyRentMinor: qar("11000"),
      monthlyOperatingMinor: qar("1500"),
      vacancyPercent: 10,
      buildMonths: 3,
      marketingMonths: 3,
      monthlyHoldingMinor: qar("1200"),
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-18",
      available: true,
      duplicateOf: "",
      evidenceCount: 2,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "تحسين أصل قائم",
      risk: "medium",
    },
  },
  {
    id: "fixture-incomplete-build",
    title: "عقار ناقص البناء · استكمال مشروط",
    subtitle: "مرجع تجريبي؛ نطاق الإكمال والحقوق لم يثبتا.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("650000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/incomplete-build-003",
      purchaseMinor: qar("650000"),
      developmentMinor: qar("400000"),
      feesMinor: qar("30000"),
      designMinor: qar("25000"),
      operatingMinor: 0,
      marketingMinor: qar("25000"),
      reserveMinor: qar("50000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("1300000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 9,
      marketingMonths: 5,
      monthlyHoldingMinor: qar("1000"),
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-21",
      available: true,
      duplicateOf: "",
      evidenceCount: 0,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "عقار ناقص البناء",
      risk: "high",
    },
  },
  {
    id: "fixture-tender",
    title: "مناقصة تطوير صغيرة · مراجعة نطاق",
    subtitle: "مرجع تجريبي؛ لا تمثل دعوة أو عقد مقاول حقيقي.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("500000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/tender-004",
      purchaseMinor: qar("500000"),
      developmentMinor: qar("260000"),
      feesMinor: qar("20000"),
      designMinor: qar("35000"),
      operatingMinor: qar("5000"),
      marketingMinor: qar("15000"),
      reserveMinor: qar("30000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("950000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 8,
      marketingMonths: 4,
      monthlyHoldingMinor: qar("800"),
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-19",
      available: true,
      duplicateOf: "",
      evidenceCount: 1,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "مناقصة تطوير",
      risk: "high",
    },
  },
  {
    id: "fixture-saudi-hold",
    title: "أرض احتفاظ ثلاث سنوات · السعودية",
    subtitle: "مرجع تجريبي بعملة مستقلة؛ لا تُجمع مع الريال القطري.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("450000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/saudi-hold-005",
      purchaseMinor: qar("450000"),
      developmentMinor: 0,
      feesMinor: qar("15000"),
      designMinor: 0,
      operatingMinor: 0,
      marketingMinor: qar("15000"),
      reserveMinor: qar("20000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("700000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 30,
      marketingMonths: 6,
      monthlyHoldingMinor: 0,
      country: "السعودية",
      currencyCode: "SAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-16",
      available: true,
      duplicateOf: "",
      evidenceCount: 1,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "احتفاظ خارج الحدود",
      risk: "medium",
    },
  },
  {
    id: "fixture-fractional-token",
    title: "حصة/ترميز عقاري · حق مشروط",
    subtitle: "مرجع تجريبي؛ لا يثبت ملكية مباشرة أو قابلية خروج.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("150000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/fractional-right-006",
      purchaseMinor: qar("150000"),
      developmentMinor: 0,
      feesMinor: qar("5000"),
      designMinor: 0,
      operatingMinor: qar("1200"),
      marketingMinor: 0,
      reserveMinor: qar("10000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("190000"),
      monthlyRentMinor: qar("900"),
      monthlyOperatingMinor: qar("150"),
      vacancyPercent: 20,
      buildMonths: 0,
      marketingMonths: 12,
      monthlyHoldingMinor: 0,
      country: "السعودية",
      currencyCode: "SAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2026-10-20",
      available: true,
      duplicateOf: "",
      evidenceCount: 0,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "حصة/ترميز مشروط",
      risk: "high",
    },
  },
  {
    id: "fixture-old-unavailable",
    title: "فيلا قديمة غير متاحة · عينة استبعاد",
    subtitle: "مرجع تجريبي قديم وغير متاح، لذلك لا يدخل قائمة الدراسة.",
    status: "مرصودة",
    date: "2026-10-24",
    amountMinor: qar("900000"),
    currency: "QAR",
    meta: {
      recordType: HUNTER_RECORD_TYPE,
      sourceIdentity: "demo://hunter/old-unavailable-007",
      purchaseMinor: qar("900000"),
      developmentMinor: qar("100000"),
      feesMinor: qar("20000"),
      designMinor: 0,
      operatingMinor: 0,
      marketingMinor: qar("10000"),
      reserveMinor: qar("20000"),
      financingCostMinor: 0,
      loanPrincipalMinor: 0,
      saleMinor: qar("1150000"),
      monthlyRentMinor: 0,
      monthlyOperatingMinor: 0,
      vacancyPercent: 0,
      buildMonths: 4,
      marketingMonths: 4,
      monthlyHoldingMinor: 0,
      country: "قطر",
      currencyCode: "QAR",
      source: HUNTER_SOURCE_LABEL,
      sourceDate: "2024-01-15",
      available: false,
      duplicateOf: "",
      evidenceCount: 1,
      verified: false,
      rightsVerified: false,
      eligibilityVerified: false,
      kind: "فيلا للبيع",
      risk: "medium",
    },
  },
] as const;

export interface HunterScanResult {
  detected: number;
  deduplicated: number;
  old: number;
  missing: number;
  screened: number;
  additions: HunterFixture[];
}

export function hunterMeta(row: DemoEntity | HunterFixture, key: string): string {
  return String(row.meta[key] ?? "");
}

export function hunterMoneyMeta(row: DemoEntity | HunterFixture, key: string): number {
  const value = row.meta[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

export function sourceIdentity(row: DemoEntity | HunterFixture): string {
  return hunterMeta(row, "sourceIdentity") || row.id;
}

export function sourceFreshness(row: DemoEntity | HunterFixture): "حديث" | "قديم" | "غير متاح" {
  if (row.meta.available !== true) return "غير متاح";
  return hunterMeta(row, "sourceDate") < "2026-07-01" ? "قديم" : "حديث";
}

export function hasMissingEvidence(row: DemoEntity | HunterFixture): boolean {
  // عدم وجود دليل مرصود نقص بيانات؛ أما حقوق/أهلية غير مثبتة فهي مخاطرة
  // مستقلة تعرض في قائمة التحقق ولا تتحول إلى اعتماد قانوني ضمن المحاكاة.
  return hunterMoneyMeta(row, "evidenceCount") < 1;
}

export function scanFixedHunterFixtures(
  existing: DemoEntity[],
  portfolioId: string
): HunterScanResult {
  const known = new Set(
    existing
      .filter(
        row =>
          row.portfolioId === portfolioId &&
          hunterMeta(row, "recordType") === HUNTER_RECORD_TYPE
      )
      .map(sourceIdentity)
  );
  const staged = new Set(known);
  const additions: HunterFixture[] = [];
  let deduplicated = 0;
  let old = 0;
  let missing = 0;
  let screened = 0;

  for (const fixture of HUNTER_FIXTURES) {
    const identity = sourceIdentity(fixture);
    if (staged.has(identity)) {
      deduplicated += 1;
      continue;
    }
    staged.add(identity);
    if (sourceFreshness(fixture) !== "حديث") {
      old += 1;
      continue;
    }
    if (hasMissingEvidence(fixture)) missing += 1;
    screened += 1;
    additions.push(fixture);
  }

  return {
    detected: HUNTER_FIXTURES.length,
    deduplicated,
    old,
    missing,
    screened,
    additions,
  };
}

export function fixtureToOpportunity(
  fixture: HunterFixture,
  portfolioId: string,
  status: string
): NewEntity {
  return {
    title: fixture.title,
    subtitle: fixture.subtitle,
    portfolioId,
    status,
    date: PROTOTYPE_DATE,
    amountMinor: fixture.amountMinor,
    meta: { ...fixture.meta },
  };
}
