import type { DemoEntity, EntityMap, PrototypePeriod } from "@shared/prototype";
import { financialSummary, outstandingFor } from "./prototype-finance";
import { inPrototypePeriod } from "./prototype-period";

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export type InsightKind =
  | "سيولة"
  | "تحصيل"
  | "صيانة"
  | "شغور"
  | "إيجار"
  | "تطوير";
export type InsightPriority = "عاجلة" | "عالية" | "متوسطة";
export type EvidenceQuality =
  | "سجل داخلي"
  | "عينة خيالية محدودة"
  | "يتطلب مستنداً";

export interface InsightIdea {
  id: string;
  kind: InsightKind;
  priority: InsightPriority;
  scope: "محفظة" | "عقار";
  title: string;
  reason: string;
  modelSource: string;
  sourceRecordIds: string[];
  potentialImpactMinor?: number;
  potentialImpactNote: string;
  evidenceQuality: EvidenceQuality;
  nextStep: string;
  portfolioId: string;
  propertyId: string;
}

export interface RentComparableComparison {
  propertyId: string;
  region: string;
  propertyType: string;
  currentRentMinor: number | null;
  sampleIds: string[];
  sampleCount: number;
  evidenceCounts: Record<"إعلان" | "عقد" | "صفقة" | "أخرى", number>;
  advertisedMiddleMinor: number | null;
  contractMiddleMinor: number | null;
  dealMiddleMinor: number | null;
}

export interface PriceEvidenceCard {
  title: "بيانات غير كافية لتوقع الأسعار";
  predictionAvailable: false;
  detail: string;
}

export interface StressScenarioInput {
  expectedMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  rentReductionPercent: number;
  expenseIncreasePercent: number;
}

export interface StressScenarioResult {
  safe: boolean;
  error?: string;
  expectedMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  rentReductionPercent: number;
  expenseIncreasePercent: number;
  expectedRentReductionMinor: number;
  incomeReductionMinor: number;
  expenseIncreaseMinor: number;
  stressedExpectedMinor: number;
  stressedIncomeMinor: number;
  stressedExpenseMinor: number;
  currentNetMinor: number;
  stressedNetMinor: number;
  netImpactMinor: number;
}

export interface PortfolioInsightsResult {
  financials: ReturnType<typeof financialSummary>;
  ideas: InsightIdea[];
  rentComparisons: RentComparableComparison[];
  priceEvidence: PriceEvidenceCard;
}

function isSafeMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_MINOR
  );
}

function addMinor(...values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!isSafeMinor(value) || total > MAX_SAFE_MINOR - value) return null;
    total += value;
  }
  return total;
}

function sumMinor(rows: DemoEntity[]): number | null {
  return addMinor(...rows.map(row => row.amountMinor));
}

function percentageOfMinor(value: number, percent: number): number | null {
  if (
    !isSafeMinor(value) ||
    !Number.isSafeInteger(percent) ||
    percent < 0 ||
    percent > 30
  )
    return null;
  if (value === 0 || percent === 0) return 0;
  if (value > Math.floor(MAX_SAFE_MINOR / percent)) return null;
  return Math.floor((value * percent) / 100);
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function propertyRegion(property: DemoEntity): string {
  const location = String(property.meta.location ?? property.subtitle ?? "");
  return normalizedText(location.split("•")[0]);
}

function comparableRegion(row: DemoEntity): string {
  const area =
    typeof row.meta.area === "string"
      ? row.meta.area
      : typeof row.meta.region === "string"
        ? row.meta.region
        : "";
  return normalizedText(area);
}

function propertyType(property: DemoEntity): string {
  return normalizedText(property.meta.type);
}

function comparableType(
  row: DemoEntity,
  propertiesById: Map<string, DemoEntity>
): string {
  const explicit = row.meta.propertyType ?? row.meta.type ?? row.meta.unitType;
  if (typeof explicit === "string" && explicit.trim())
    return normalizedText(explicit);
  const linkedProperty = propertiesById.get(row.propertyId);
  return linkedProperty ? propertyType(linkedProperty) : "";
}

function evidenceType(row: DemoEntity): "إعلان" | "عقد" | "صفقة" | "أخرى" {
  const value = String(
    row.meta.evidenceType ?? row.meta.evidence ?? row.status ?? ""
  );
  if (value.includes("صفقة")) return "صفقة";
  if (value.includes("عقد")) return "عقد";
  if (value.includes("إعلان")) return "إعلان";
  return "أخرى";
}

function medianMinor(rows: DemoEntity[]): number | null {
  const values = rows
    .map(row => row.amountMinor)
    .filter(isSafeMinor)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const lower = values[Math.floor((values.length - 1) / 2)] ?? 0;
  const upper = values[Math.floor(values.length / 2)] ?? 0;
  return lower + Math.floor((upper - lower) / 2);
}

function propertyCurrentRentMinor(
  property: DemoEntity,
  units: DemoEntity[]
): number | null {
  const unitRows = units.filter(
    row =>
      row.propertyId === property.id &&
      isSafeMinor(row.amountMinor) &&
      row.amountMinor > 0
  );
  const unitTotal = sumMinor(unitRows);
  if (unitRows.length && unitTotal !== null)
    return Math.floor(unitTotal / unitRows.length);
  const declared = property.meta.monthlyRentMinor;
  return isSafeMinor(declared) ? declared : null;
}

/**
 * يعيد فقط العينات المتجانسة: المنطقة والنوع متطابقان حرفياً بعد تطبيع بسيط.
 * الإعلان والعقد والصفقة تبقى أنواع دليل منفصلة في النتيجة، ولا تتحول إلى سعر صفقة.
 */
export function comparePropertyRent(
  property: DemoEntity,
  units: DemoEntity[],
  comparables: DemoEntity[],
  properties: DemoEntity[]
): RentComparableComparison {
  const propertiesById = new Map(properties.map(row => [row.id, row]));
  const region = propertyRegion(property);
  const type = propertyType(property);
  const matched = comparables.filter(
    row =>
      Boolean(region) &&
      Boolean(type) &&
      comparableRegion(row) === region &&
      comparableType(row, propertiesById) === type
  );
  const evidenceCounts: RentComparableComparison["evidenceCounts"] = {
    إعلان: 0,
    عقد: 0,
    صفقة: 0,
    أخرى: 0,
  };
  for (const row of matched) evidenceCounts[evidenceType(row)] += 1;
  const byEvidence = (type: keyof RentComparableComparison["evidenceCounts"]) =>
    matched.filter(row => evidenceType(row) === type);

  return {
    propertyId: property.id,
    region,
    propertyType: type,
    currentRentMinor: propertyCurrentRentMinor(property, units),
    sampleIds: matched.map(row => row.id),
    sampleCount: matched.length,
    evidenceCounts,
    advertisedMiddleMinor: medianMinor(byEvidence("إعلان")),
    contractMiddleMinor: medianMinor(byEvidence("عقد")),
    dealMiddleMinor: medianMinor(byEvidence("صفقة")),
  };
}

/** لا يقدم البروتوتايب تنبؤاً سعرياً من لقطات محلية غير زمنية. */
export function marketPriceEvidenceCard(): PriceEvidenceCard {
  return {
    title: "بيانات غير كافية لتوقع الأسعار",
    predictionAvailable: false,
    detail:
      "لا توجد سلسلة زمنية أو بيانات سوق خارجية موثقة في النموذج؛ لذلك لا يعرض اتجاه صعود أو نزول ولا توقع سعراً.",
  };
}

/**
 * محاكاة حتمية منفصلة عن التوصيات. تقبل نسباً صحيحة من 0 إلى 30 فقط وتحافظ
 * على الحساب بوحدات العملة الصغرى من دون تقريب عشري عائم.
 */
export function calculateStressScenario(
  input: StressScenarioInput
): StressScenarioResult {
  const empty = (error: string): StressScenarioResult => ({
    safe: false,
    error,
    expectedMinor: 0,
    incomeMinor: 0,
    expenseMinor: 0,
    rentReductionPercent: 0,
    expenseIncreasePercent: 0,
    expectedRentReductionMinor: 0,
    incomeReductionMinor: 0,
    expenseIncreaseMinor: 0,
    stressedExpectedMinor: 0,
    stressedIncomeMinor: 0,
    stressedExpenseMinor: 0,
    currentNetMinor: 0,
    stressedNetMinor: 0,
    netImpactMinor: 0,
  });
  if (
    ![input.expectedMinor, input.incomeMinor, input.expenseMinor].every(
      isSafeMinor
    )
  )
    return empty(
      "تعذر الحساب: يجب أن تكون القيم مبالغ صحيحة وآمنة بوحدة العملة الصغرى."
    );
  if (
    !Number.isSafeInteger(input.rentReductionPercent) ||
    !Number.isSafeInteger(input.expenseIncreasePercent) ||
    input.rentReductionPercent < 0 ||
    input.rentReductionPercent > 30 ||
    input.expenseIncreasePercent < 0 ||
    input.expenseIncreasePercent > 30
  )
    return empty("تقبل محاكاة الضغط نسباً صحيحة من 0% إلى 30% فقط.");

  const expectedRentReductionMinor = percentageOfMinor(
    input.expectedMinor,
    input.rentReductionPercent
  );
  const incomeReductionMinor = percentageOfMinor(
    input.incomeMinor,
    input.rentReductionPercent
  );
  const expenseIncreaseMinor = percentageOfMinor(
    input.expenseMinor,
    input.expenseIncreasePercent
  );
  if (
    expectedRentReductionMinor === null ||
    incomeReductionMinor === null ||
    expenseIncreaseMinor === null
  )
    return empty("تعذر حساب النسبة ضمن الحد الآمن للعملة الصغرى.");

  const stressedExpenseMinor = addMinor(
    input.expenseMinor,
    expenseIncreaseMinor
  );
  const netImpactMinor = addMinor(incomeReductionMinor, expenseIncreaseMinor);
  if (stressedExpenseMinor === null || netImpactMinor === null)
    return empty("تعذر جمع أثر الضغط ضمن الحد الآمن للعملة الصغرى.");

  const stressedExpectedMinor =
    input.expectedMinor - expectedRentReductionMinor;
  const stressedIncomeMinor = input.incomeMinor - incomeReductionMinor;
  const currentNetMinor = input.incomeMinor - input.expenseMinor;
  const stressedNetMinor = stressedIncomeMinor - stressedExpenseMinor;
  return {
    safe: true,
    expectedMinor: input.expectedMinor,
    incomeMinor: input.incomeMinor,
    expenseMinor: input.expenseMinor,
    rentReductionPercent: input.rentReductionPercent,
    expenseIncreasePercent: input.expenseIncreasePercent,
    expectedRentReductionMinor,
    incomeReductionMinor,
    expenseIncreaseMinor,
    stressedExpectedMinor,
    stressedIncomeMinor,
    stressedExpenseMinor,
    currentNetMinor,
    stressedNetMinor,
    netImpactMinor,
  };
}

function withinPortfolio(
  rows: DemoEntity[],
  portfolioId: string
): DemoEntity[] {
  return portfolioId === "all"
    ? rows
    : rows.filter(row => row.portfolioId === portfolioId);
}

function groupByProperty(rows: DemoEntity[]): Map<string, DemoEntity[]> {
  const groups = new Map<string, DemoEntity[]>();
  for (const row of rows) {
    if (!row.propertyId) continue;
    const entries = groups.get(row.propertyId) ?? [];
    entries.push(row);
    groups.set(row.propertyId, entries);
  }
  return groups;
}

function priorityRank(priority: InsightPriority): number {
  return priority === "عاجلة" ? 0 : priority === "عالية" ? 1 : 2;
}

function safeMetaMinor(row: DemoEntity, key: string): number | null {
  return isSafeMinor(row.meta[key]) ? row.meta[key] : null;
}

function taskPortfolioId(
  selectedPortfolioId: string,
  properties: DemoEntity[],
  entities: EntityMap
): string {
  if (selectedPortfolioId !== "all") return selectedPortfolioId;
  return properties[0]?.portfolioId ?? entities.portfolios[0]?.id ?? "";
}

/**
 * محرك قواعد محلي لا يتصل بسوق أو نموذج لغوي. معرّفات الأفكار ثابتة حسب
 * المحفظة/العقار والمشكلة، حتى تستطيع الواجهة منع تكرار مهمة المراجعة.
 */
export function buildPortfolioInsights({
  entities,
  portfolioId,
  period,
}: {
  entities: EntityMap;
  portfolioId: string;
  period: PrototypePeriod;
}): PortfolioInsightsResult {
  const financials = financialSummary(entities, portfolioId, period);
  const properties = withinPortfolio(entities.properties, portfolioId);
  const units = withinPortfolio(entities.units, portfolioId);
  const receivables = withinPortfolio(entities.receivables, portfolioId).filter(
    row => inPrototypePeriod(row.date, period)
  );
  const maintenance = withinPortfolio(entities.maintenance, portfolioId);
  const vacancies = withinPortfolio(entities.vacancies, portfolioId);
  const comparables = withinPortfolio(entities.comparables, portfolioId);
  const ideas: InsightIdea[] = [];
  const defaultTaskPortfolioId = taskPortfolioId(
    portfolioId,
    properties,
    entities
  );
  const portfolioScope =
    portfolioId === "all" ? "كل المحافظ المعروضة" : "المحفظة الحالية";

  ideas.push({
    id: `liquidity:${portfolioId}:reserve-liabilities`,
    kind: "سيولة",
    priority: financials.availableDrawMinor > 0 ? "متوسطة" : "عالية",
    scope: "محفظة",
    title: "راجع السيولة المتاحة قبل أي التزام جديد",
    reason: `السيولة المتاحة بعد الاحتياطي والتأمين والالتزامات التشغيلية القائمة هي قيمة نموذجية مشتقة من السجلات الحالية.`,
    modelSource:
      "ملخص مالي للفترة المختارة: نقد محصل − احتياطي − تأمين − التزامات قائمة غير تمويلية.",
    sourceRecordIds: [
      ...withinPortfolio(entities.reserves, portfolioId).map(row => row.id),
      ...withinPortfolio(entities.liabilities, portfolioId)
        .filter(row => row.status === "قائم")
        .map(row => row.id),
    ],
    potentialImpactMinor: financials.availableDrawMinor,
    potentialImpactNote:
      "سيولة متاحة تقديرياً بعد الاحتياط والالتزامات، وليست تفويض صرف أو رصيداً بنكياً مؤكداً.",
    evidenceQuality: "سجل داخلي",
    nextStep:
      "طابق الرصيد مع كشف البنك والمصروفات المعتمدة يدوياً قبل تخصيص أو صرف أي مبلغ.",
    portfolioId: defaultTaskPortfolioId,
    propertyId: "",
  });

  const outstandingByProperty = groupByProperty(
    receivables.filter(row => outstandingFor(entities, row.id) > 0)
  );
  for (const [propertyId, rows] of outstandingByProperty) {
    const property = properties.find(row => row.id === propertyId);
    const outstanding = addMinor(
      ...rows.map(row => outstandingFor(entities, row.id))
    );
    if (!property || outstanding === null || outstanding === 0) continue;
    ideas.push({
      id: `collection:${property.id}:outstanding`,
      kind: "تحصيل",
      priority: "عالية",
      scope: "عقار",
      title: `اجمع المطالبات غير المحصلة · ${property.title}`,
      reason: `${rows.length} استحقاق/استحقاقات في الفترة ما زالت لها أرصدة بعد التحصيل والخسارة المسجلة.`,
      modelSource:
        "الاستحقاقات في الفترة + التحصيلات المؤكدة + الخسائر المسجلة المرتبطة بها.",
      sourceRecordIds: rows.map(row => row.id),
      potentialImpactMinor: outstanding,
      potentialImpactNote:
        "مبلغ قابل للمتابعة كتحصيل محتمل؛ لا يعد نقداً محصلاً ولا يضمن التحصيل.",
      evidenceQuality: "سجل داخلي",
      nextStep:
        "راجع العقد وإثبات الاستحقاق وسجل التواصل، ثم سجّل التحصيل أو النزاع يدوياً في دورة الاستحقاقات.",
      portfolioId: property.portfolioId,
      propertyId: property.id,
    });
  }

  const urgentMaintenanceByProperty = groupByProperty(
    maintenance.filter(row => {
      const priority = normalizedText(row.meta.priority);
      const pending = /بانتظار|جديد|قيد التنفيذ/.test(row.status);
      return pending && (priority === "عاجل" || priority === "عاجلة");
    })
  );
  for (const [propertyId, rows] of urgentMaintenanceByProperty) {
    const property = properties.find(row => row.id === propertyId);
    const estimated = sumMinor(rows);
    if (!property || estimated === null) continue;
    ideas.push({
      id: `maintenance:${property.id}:urgent-review`,
      kind: "صيانة",
      priority: "عاجلة",
      scope: "عقار",
      title: `راجع الصيانة العاجلة قبل الصرف · ${property.title}`,
      reason: `${rows.length} طلب/طلبات صيانة عاجلة ما زالت مفتوحة أو بانتظار اعتماد.`,
      modelSource: "سجل طلبات الصيانة: أولوية معلنة وحالة طلب وتقدير/سقف مسجل.",
      sourceRecordIds: rows.map(row => row.id),
      potentialImpactMinor: estimated,
      potentialImpactNote:
        "تقدير أو سقف مسجل للمراجعة؛ ليس فاتورة ولا موافقة ولا صرفاً محققاً.",
      evidenceQuality: "سجل داخلي",
      nextStep:
        "راجع وصف العطل والعروض وحدود التفويض والاعتماد المستقل قبل الإسناد أو أي صرف.",
      portfolioId: property.portfolioId,
      propertyId: property.id,
    });
  }

  const vacanciesByProperty = groupByProperty(vacancies);
  for (const [propertyId, rows] of vacanciesByProperty) {
    const property = properties.find(row => row.id === propertyId);
    const lostIncome = addMinor(
      ...rows.map(
        row => safeMetaMinor(row, "lostIncomeMinor") ?? row.amountMinor
      )
    );
    if (!property || lostIncome === null) continue;
    ideas.push({
      id: `vacancy:${property.id}:foregone-income`,
      kind: "شغور",
      priority: "عالية",
      scope: "عقار",
      title: `قلّص الشغور قبل احتساب دخل جديد · ${property.title}`,
      reason: `${rows.length} وحدة/وحدات شاغرة أو قيد التجهيز مسجلة ضمن العقار.`,
      modelSource:
        "سجل الشغور وقيمة الإيجار/الدخل الضائع التقديرية المسجلة لكل وحدة.",
      sourceRecordIds: rows.map(row => row.id),
      potentialImpactMinor: lostIncome,
      potentialImpactNote:
        "دخل ضائع تقديري فقط، وليس دخلاً محققاً أو توقعاً لمستقبل الإيجار.",
      evidenceQuality: "سجل داخلي",
      nextStep:
        "تحقق من سبب الشغور والجاهزية وقائمة التجهيز، ثم راجع تسويق الوحدة يدوياً قبل افتراض أي إشغال.",
      portfolioId: property.portfolioId,
      propertyId: property.id,
    });
  }

  const rentComparisons = properties
    .map(property =>
      comparePropertyRent(property, units, comparables, properties)
    )
    .filter(comparison => comparison.sampleCount > 0);
  for (const comparison of rentComparisons) {
    const property = properties.find(row => row.id === comparison.propertyId);
    if (!property) continue;
    const reference =
      comparison.contractMiddleMinor ??
      comparison.dealMiddleMinor ??
      comparison.advertisedMiddleMinor;
    const difference =
      comparison.currentRentMinor !== null && reference !== null
        ? Math.abs(comparison.currentRentMinor - reference)
        : undefined;
    ideas.push({
      id: `rent:${property.id}:same-area-type-sample`,
      kind: "إيجار",
      priority: "متوسطة",
      scope: "عقار",
      title: `راجع إيجار ${property.title} مقابل عينة متجانسة`,
      reason: `العينة مقيّدة على منطقة ${comparison.region || "غير محددة"} ونوع ${comparison.propertyType || "غير محدد"} فقط؛ الإعلانات والعقود والصفقات معروضة منفصلة.`,
      modelSource: `عينات إيجار خيالية: إعلان ${comparison.evidenceCounts.إعلان} · عقد ${comparison.evidenceCounts.عقد} · صفقة ${comparison.evidenceCounts.صفقة}.`,
      sourceRecordIds: comparison.sampleIds,
      potentialImpactMinor: difference,
      potentialImpactNote:
        difference === undefined
          ? "لا يوجد فرق وصفي قابل للحساب بسبب غياب إيجار مسجل أو عينة قابلة للمقارنة."
          : "فرق وصفي بين إيجار مسجل ووسط نوع دليل واحد؛ ليس توصية تسعير أو أثراً محققاً.",
      evidenceQuality: "عينة خيالية محدودة",
      nextStep:
        "تحقق من نوع الدليل وتاريخ العينة ووحدة المقارنة يدوياً؛ لا تجعل الإعلان سعراً لصفقة ولا تستخدم العينة كتوصية إيجار.",
      portfolioId: property.portfolioId,
      propertyId: property.id,
    });
  }

  for (const property of properties) {
    const vacancyRows = vacanciesByProperty.get(property.id) ?? [];
    ideas.push({
      id: `development:${property.id}:use-review`,
      kind: "تطوير",
      priority: vacancyRows.length ? "متوسطة" : "متوسطة",
      scope: "عقار",
      title: vacancyRows.length
        ? `ادرس تهيئة الشاغر أو استخداماً بديلاً · ${property.title}`
        : `ادرس تحسين استخدام العقار بحذر · ${property.title}`,
      reason: vacancyRows.length
        ? "وجود شغور يبرر دراسة خيارات التهيئة قبل افتراض دخل إضافي."
        : "الفكرة دراسة أولية لتطوير الاستخدام، وليست قرار تنفيذ أو زيادة دخل مؤكدة.",
      modelSource: vacancyRows.length
        ? "سجل الشغور ووحدات العقار في النموذج."
        : "سجل العقار ووحداته التجريبية فقط.",
      sourceRecordIds: [property.id, ...vacancyRows.map(row => row.id)],
      potentialImpactNote:
        "لا يحسب النموذج زيادة دخل أو عدد وحدات أو نسبة بناء؛ الأثر غير محدد حتى تكتمل المستندات والمراجعة الفنية.",
      evidenceQuality: "يتطلب مستنداً",
      nextStep:
        "اجمع مستند استعمال العقار والضوابط النظامية ذات الصلة، ثم اطلب مراجعة مهندس مرخص قبل أي تصميم أو تنفيذ. لا يفترض النموذج نسبة بناء أو موافقة أو زيادة وحدات.",
      portfolioId: property.portfolioId,
      propertyId: property.id,
    });
  }

  return {
    financials,
    ideas: ideas.sort(
      (left, right) =>
        priorityRank(left.priority) - priorityRank(right.priority) ||
        left.id.localeCompare(right.id, "ar")
    ),
    rentComparisons,
    priceEvidence: marketPriceEvidenceCard(),
  };
}
