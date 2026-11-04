import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  FileClock,
  FilePlus2,
  Landmark,
  ListChecks,
  Save,
  SearchCheck,
  ShieldCheck,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AdvisorDiagnosis,
  AdvisorGoal,
  AdvisorProfile,
  ConstructionReviewInput,
  DealInput,
  DealResult,
  RiskLevel,
} from "@shared/advisor-types";
import {
  advisorPaths,
  advisorStages,
  calculateDeal,
  constructionReview,
  diagnoseAdvisor,
  profileFromEntity,
} from "@shared/advisor-engine";
import {
  money,
  toMinor,
  type DemoEntity,
  type MetaValue,
  type NewEntity,
} from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  Badge,
  DemoNotice,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { AdvisorExplanation } from "@/components/app/AdvisorExplanation";
import {
  buildAdvisorPlanVersionTransition,
  fullProfileToMeta,
  type AdvisorPlanVersionResult,
} from "@/lib/advisor-plan-versions";
import "./advisor.css";

const TODAY = "2026-10-24";
const STEPS = ["هدفك", "وضعك", "خطتك", "المتابعة"] as const;
type Step = (typeof STEPS)[number];
type ComparisonTab = "development" | "hold" | "debt" | "cash";
type MoneyProfileKey =
  | "targetMinor"
  | "cashMinor"
  | "assetValueMinor"
  | "debtMinor"
  | "salaryMinor"
  | "businessIncomeMinor"
  | "livingMinor"
  | "installmentMinor"
  | "monthlyContributionMinor"
  | "emergencyReserveMinor"
  | "monthlyWithdrawalMinor"
  | "potentialFinancingMinor"
  | "approvedFinancingMinor"
  | "financingInstallmentMinor";
type DealMoneyKey = Exclude<
  keyof DealInput,
  "vacancyPercent" | "buildMonths" | "marketingMonths"
>;
type AdvisorField = keyof AdvisorProfile | keyof DealInput | "general";
type ValidationErrors = Partial<Record<AdvisorField, string>>;
type Calculation<T> =
  | { ok: true; value: T; errors: ValidationErrors }
  | { ok: false; errors: ValidationErrors };

function safeCalculation<T>(
  calculate: () => T,
  errors: (message: string) => ValidationErrors
): Calculation<T> {
  try {
    return { ok: true, value: calculate(), errors: {} };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "تعذر حساب هذه المدخلات.";
    return { ok: false, errors: errors(message) };
  }
}

function dealErrors(message: string): ValidationErrors {
  if (message.includes("مدة البناء") || message.includes("مدة التسويق"))
    return { buildMonths: message, marketingMonths: message };
  if (message.includes("أصل التمويل")) return { loanPrincipalMinor: message };
  if (message.includes("نسبة الشغور")) return { vacancyPercent: message };
  if (message.includes("مدة الدورة"))
    return { buildMonths: message, marketingMonths: message };
  return { general: message };
}

function profileErrors(message: string): ValidationErrors {
  if (message.includes("أفق الخطة")) return { horizonYears: message };
  if (message.includes("محفظة")) return { portfolioId: message };
  if (message.includes("مصدر")) return { source: message };
  if (message.includes("تاريخ")) return { dataDate: message };
  if (message.includes("بداية نافذة التشغيل"))
    return { operatingWindowStart: message };
  if (message.includes("نهاية نافذة التشغيل"))
    return { operatingWindowEnd: message };
  return { general: message };
}

export interface RealEstateAdvisorPageProps {
  /** مساحة اختيارية لشرح AI مستقبلي بعد الحساب الحتمي؛ لا تغير أي مبلغ أو سجل. */
  aiNarrativeSlot?: ReactNode;
}

function fictionalProfile(portfolioId = ""): AdvisorProfile {
  return {
    portfolioId,
    goal: "wealth",
    targetMinor: 1_000_000_000,
    horizonYears: 5,
    cashMinor: 10_000_000,
    assetValueMinor: 30_000_000,
    debtMinor: 0,
    salaryMinor: 2_000_000,
    businessIncomeMinor: 0,
    livingMinor: 1_500_000,
    installmentMinor: 0,
    monthlyContributionMinor: 200_000,
    emergencyReserveMinor: 6_000_000,
    monthlyWithdrawalMinor: 0,
    risk: "medium",
    lockMonths: 12,
    hoursMonthly: 10,
    potentialFinancingMinor: 120_000_000,
    approvedFinancingMinor: 0,
    financingInstallmentMinor: 0,
    dataDate: TODAY,
    source: "مثال خيالي قابل للتعديل داخل البروتوتايب",
  };
}

const INITIAL_DEAL: DealInput = {
  purchaseMinor: 100_000_000,
  developmentMinor: 80_000_000,
  feesMinor: 5_000_000,
  designMinor: 0,
  operatingMinor: 0,
  marketingMinor: 0,
  reserveMinor: 0,
  financingCostMinor: 0,
  loanPrincipalMinor: 0,
  saleMinor: 250_000_000,
  monthlyRentMinor: 0,
  monthlyOperatingMinor: 0,
  vacancyPercent: 0,
  buildMonths: 12,
  marketingMonths: 6,
  monthlyHoldingMinor: 0,
};

const INITIAL_REVIEW: ConstructionReviewInput = {
  originalBudgetMinor: 100_000_000,
  revisedCostMinor: 85_000_000,
  evidenceStage: "quote",
  equivalentScope: false,
  projectCashMinor: 100_000_000,
  upcomingPaymentsMinor: 55_000_000,
  reserveMinor: 15_000_000,
};

function asMinorDisplay(value: number): string {
  return String(value / 100);
}

function asNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function metaText(entity: DemoEntity, key: string, fallback = "-"): string {
  const value = entity.meta[key];
  return value === undefined || value === "" ? fallback : String(value);
}

function entityInput(title: string, overrides: Partial<DemoEntity>): NewEntity {
  return {
    title,
    subtitle: "سجل صوري محلي للمستشار العقاري",
    portfolioId: "",
    propertyId: "",
    status: "مسودة",
    date: TODAY,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

/** Metadata is deliberately scalar, bounded, and human-inspectable for local prototype storage. */
function boundedMeta(
  values: Record<string, MetaValue>
): Record<string, MetaValue> {
  const entries = Object.entries(values);
  if (entries.length > 32)
    throw new Error("سجل المستشار يتجاوز الحد المسموح لحقول البيانات الوصفية.");
  for (const [key, value] of entries) {
    if (!key || typeof value === "object")
      throw new Error("البيانات الوصفية يجب أن تكون حقولاً مسطحة.");
    if (typeof value === "string" && value.length > 1024)
      throw new Error(`قيمة «${key}» أطول من الحد المحلي المسموح.`);
  }
  return values;
}

function goalLabel(goal: AdvisorGoal): string {
  return (
    {
      wealth: "بناء الثروة",
      income: "دخل دوري",
      debt: "سداد دين",
      home: "تملك منزل",
    }[goal] ?? goal
  );
}

function riskLabel(risk: RiskLevel): string {
  return { low: "منخفضة", medium: "متوسطة", high: "مرتفعة" }[risk] ?? risk;
}

function statusTone(suitable: boolean): "green" | "amber" {
  return suitable ? "green" : "amber";
}

function ProgressButtons({
  step,
  onStep,
}: {
  step: Step;
  onStep: (next: Step) => void;
}) {
  const position = STEPS.indexOf(step);
  return (
    <div className="advisor-step-actions">
      {position > 0 && (
        <button
          className="btn-secondary"
          type="button"
          onClick={() => onStep(STEPS[position - 1])}
        >
          <ArrowRight size={16} /> السابق
        </button>
      )}
      {position < STEPS.length - 1 && (
        <button
          className="btn-primary"
          type="button"
          onClick={() => onStep(STEPS[position + 1])}
        >
          التالي <ArrowLeft size={16} />
        </button>
      )}
    </div>
  );
}

export function RealEstateAdvisorPage({
  aiNarrativeSlot,
}: RealEstateAdvisorPageProps) {
  const { state, list, add, log, canEdit, commitTransition } = usePrototype();
  const portfolios = list("portfolios");
  const allPlans = list("plans");
  const allReviews = list("reviews");
  const [step, setStep] = useState<Step>("هدفك");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(() =>
    state.settings.portfolioId === "all" ? "" : state.settings.portfolioId
  );
  const [profile, setProfile] = useState<AdvisorProfile>(() =>
    fictionalProfile(
      state.settings.portfolioId === "all" ? "" : state.settings.portfolioId
    )
  );
  const [activePathId, setActivePathId] = useState("");
  const [comparisonTab, setComparisonTab] =
    useState<ComparisonTab>("development");
  const [deal, setDeal] = useState<DealInput>(INITIAL_DEAL);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [review, setReview] = useState<ConstructionReviewInput>(INITIAL_REVIEW);
  const [reviewProgress, setReviewProgress] = useState(35);
  const [reviewDate, setReviewDate] = useState(TODAY);
  const [reviewMemo, setReviewMemo] = useState(
    "عرض أقل من التقدير الأولي؛ يلزم التحقق من النطاق والضمانات والدفعات قبل اعتماد أي تعديل."
  );
  const [country, setCountry] = useState("قطر");
  const [searchBudgetBasis, setSearchBudgetBasis] = useState<"plan" | "saving">(
    "plan"
  );
  const [hunterMonths, setHunterMonths] = useState(18);
  const [profileChangeReason, setProfileChangeReason] = useState("");
  const [message, setMessage] = useState(
    "الأرقام التالية مثال خيالي قابل للتعديل. المحرك حتمي للمقارنة، وليس توصية أو وعداً بعائد."
  );

  const scopedPortfolio = portfolios.find(
    row => row.id === selectedPortfolioId
  );
  const profilePlans = useMemo(
    () =>
      allPlans.filter(
        row =>
          row.portfolioId === selectedPortfolioId &&
          row.meta.recordType === "advisor-profile"
      ),
    [allPlans, selectedPortfolioId]
  );
  const storedProfileRecord = profilePlans.at(-1);
  const storedProfile = useMemo(
    () => (storedProfileRecord ? profileFromEntity(storedProfileRecord) : null),
    [storedProfileRecord]
  );
  const hydratedProfileKey = useRef<string | null>(null);

  useEffect(() => {
    const nextKey = `${selectedPortfolioId}:${storedProfileRecord?.id ?? ""}`;
    if (hydratedProfileKey.current === nextKey) return;
    hydratedProfileKey.current = nextKey;
    if (storedProfile) {
      setProfile({ ...storedProfile, portfolioId: selectedPortfolioId });
      return;
    }
    setProfile(current =>
      current.portfolioId === selectedPortfolioId
        ? current
        : { ...fictionalProfile(selectedPortfolioId), source: current.source }
    );
  }, [selectedPortfolioId, storedProfile, storedProfileRecord?.id]);

  const scopedProfile = useMemo(
    () => ({ ...profile, portfolioId: selectedPortfolioId }),
    [profile, selectedPortfolioId]
  );
  const diagnosisCalculation = useMemo<Calculation<AdvisorDiagnosis>>(
    () =>
      scopedPortfolio
        ? safeCalculation(
            () => diagnoseAdvisor(scopedProfile, state.entities),
            profileErrors
          )
        : { ok: false, errors: { portfolioId: "اختر محفظة واحدة أولاً." } },
    [scopedProfile, state.entities, scopedPortfolio]
  );
  const diagnosis = diagnosisCalculation.ok
    ? diagnosisCalculation.value
    : null;
  const paths = useMemo(
    () => (diagnosis ? advisorPaths(scopedProfile, diagnosis) : []),
    [scopedProfile, diagnosis]
  );
  const chosenPathId = activePathId || paths[0]?.id || "";
  const chosenPath = paths.find(path => path.id === chosenPathId) ?? paths[0];
  const stages = useMemo(
    () =>
      diagnosis
        ? advisorStages(scopedProfile, diagnosis, chosenPathId)
        : [],
    [scopedProfile, diagnosis, chosenPathId]
  );
  const dealCalculation = useMemo<Calculation<DealResult>>(
    () => safeCalculation(() => calculateDeal(deal), dealErrors),
    [deal]
  );
  const [lastValidDealResult, setLastValidDealResult] =
    useState<DealResult | null>(null);
  useEffect(() => {
    if (dealCalculation.ok) setLastValidDealResult(dealCalculation.value);
  }, [dealCalculation]);
  const constructionCalculation = useMemo(
    () => safeCalculation(() => constructionReview(review), () => ({ general: "راجع مدخلات مراجعة البناء." })),
    [review]
  );
  const construction = constructionCalculation.ok
    ? constructionCalculation.value
    : null;
  const searchBudgetMinor =
    diagnosis && construction
      ? searchBudgetBasis === "plan"
        ? diagnosis.investableCashMinor
        : construction.availableForSearchMinor
      : null;
  const hunterFeedback = allReviews.filter(
    row =>
      row.portfolioId === selectedPortfolioId &&
      row.meta.recordType === "hunter-feedback" &&
      (row.meta.profileId === storedProfileRecord?.id ||
        row.meta.sourcePlanId === storedProfileRecord?.id)
  );
  const scopedOpportunities = useMemo(
    () =>
      list("opportunities").filter(
        row => row.portfolioId === selectedPortfolioId
      ),
    [list, selectedPortfolioId]
  );
  const selectedOpportunity = scopedOpportunities.find(
    row => row.id === selectedOpportunityId
  );
  const reviewHistory = useMemo(
    () =>
      allReviews
        .filter(
          row =>
            row.meta.recordType === "advisor-review" &&
            row.meta.profileId === storedProfileRecord?.id
        )
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date)),
    [allReviews, storedProfileRecord?.id]
  );
  const existingStageRows = useMemo(
    () =>
      allPlans.filter(
        row =>
          row.meta.recordType === "advisor-stage" &&
          row.meta.profileId === storedProfileRecord?.id
      ),
    [allPlans, storedProfileRecord?.id]
  );
  const planFamilyId = String(
    storedProfileRecord?.meta.planFamilyId ?? storedProfileRecord?.id ?? ""
  );
  const archivedPlanVersions = useMemo(
    () =>
      allPlans.filter(
        row =>
          row.meta.recordType === "advisor-profile-version" &&
          String(row.meta.planFamilyId ?? "") === planFamilyId
      ),
    [allPlans, planFamilyId]
  );

  const report = (
    title: string,
    detail: string,
    tone: "info" | "error" = "info"
  ) => {
    setMessage(detail);
    log(title, detail);
    if (tone === "error") toast.error(detail);
    else toast.success(detail);
  };

  const mustEdit = (): boolean => {
    if (canEdit) return true;
    const detail = "هذه معاينة قراءة فقط. اختر دور الموظف لتجربة الحفظ المحلي.";
    report("امتناع عن تعديل المستشار", detail, "error");
    return false;
  };

  const requireScope = (): boolean => {
    if (selectedPortfolioId && scopedPortfolio) return true;
    const detail =
      "اختر محفظة واحدة أولاً. لا يجمع المستشار سيولة محافظ الأسرة أو يعالج نطاق «الكل» كرأس مال واحد.";
    report("نطاق محفظة مطلوب", detail, "error");
    return false;
  };

  const updateProfile = <K extends keyof AdvisorProfile>(
    key: K,
    value: AdvisorProfile[K]
  ) => {
    setProfile(current => ({ ...current, [key]: value }));
  };

  const updateProfileMoney = (key: MoneyProfileKey, value: string) => {
    try {
      updateProfile(key, value.trim() === "" ? 0 : toMinor(value));
    } catch {
      setMessage("أدخل مبلغاً موجباً بمنزلتين عشريتين كحد أقصى.");
    }
  };

  const updateDealMoney = (key: DealMoneyKey, value: string) => {
    try {
      setDeal(current => ({
        ...current,
        [key]: value.trim() === "" ? 0 : toMinor(value),
      }));
    } catch {
      setMessage(
        "تحقق من مبلغ الحسبة؛ يقبل النموذج قيمة موجبة بمنزلتين عشريتين كحد أقصى."
      );
    }
  };

  const persistPlanVersion = (
    includeStages: boolean,
    revisedBudgetMinor?: number
  ): AdvisorPlanVersionResult | null => {
    if (!diagnosis || !scopedPortfolio) {
      report(
        "تعذر حفظ الخطة",
        diagnosisCalculation.errors.general ??
          "أصلح حقول التشخيص قبل الحفظ أو إنشاء توصية جديدة.",
        "error"
      );
      return null;
    }
    try {
      const result = commitTransition(current =>
        buildAdvisorPlanVersionTransition(current, {
          portfolioId: selectedPortfolioId,
          portfolioTitle: scopedPortfolio.title,
          profileMeta: fullProfileToMeta(scopedProfile),
          activeProfileId: storedProfileRecord?.id,
          path: includeStages && chosenPath
            ? { id: chosenPath.id, label: chosenPath.label }
            : undefined,
          stages: includeStages && chosenPath ? stages : undefined,
          revisedBudgetMinor,
          reason: revisedBudgetMinor === undefined
            ? profileChangeReason
            : reviewMemo,
          reviewDate: revisedBudgetMinor === undefined
            ? scopedProfile.dataDate
            : reviewDate,
          now: new Date().toISOString(),
        })
      );
      setProfileChangeReason("");
      return result;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "تعذر حفظ إصدار الخطة.";
      report("تعذر حفظ إصدار الخطة", detail, "error");
      return null;
    }
  };

  const saveProfile = (): DemoEntity | null => {
    if (!mustEdit() || !requireScope()) return null;
    const saved = persistPlanVersion(existingStageRows.length > 0);
    if (!saved) return null;
    report(
      saved.createdVersion ? "حفظ إصدار تشخيص المستشار" : "تشخيص المستشار محفوظ",
      saved.createdVersion
        ? "حُفظ إصدار جديد وتاريخ المراجعة؛ بقي الهدف الأصلي والمراحل السابقة في السجل."
        : "لم تتغير بيانات التشخيص؛ لم تُنشأ نسخة أو مرحلة مكررة."
    );
    return saved.profile;
  };

  const saveStages = () => {
    if (!mustEdit() || !requireScope()) return;
    const saved = persistPlanVersion(true);
    if (!saved) return;
    report(
      "حفظ مراحل المستشار",
      saved.phases.length
        ? "حُفظ إصدار الخطة ومراحله محلياً دون إنشاء مهام مكررة أو تمويل."
        : "المراحل النشطة مطابقة للإصدار الحالي؛ لم تُنشأ مراحل أو مهام مكررة."
    );
  };

  const saveConstructionReview = () => {
    if (!mustEdit() || !requireScope()) return;
    if (!construction) {
      report(
        "تعذر حفظ مراجعة البناء",
        constructionCalculation.errors.general ??
          "أصلح مدخلات مراجعة البناء قبل الحفظ.",
        "error"
      );
      return;
    }
    if (!reviewMemo.trim()) {
      report(
        "تفسير تعديل الميزانية مطلوب",
        "أضف سبباً واضحاً قبل حفظ تعديل الميزانية؛ لا تتغير الخطة بصمت.",
        "error"
      );
      return;
    }
    const version = persistPlanVersion(true, review.revisedCostMinor);
    if (!version) return;
    const profileRecord = version.profile;
    try {
      const reviewRecord = add(
        "reviews",
        entityInput("مراجعة بناء شهرية", {
          portfolioId: selectedPortfolioId,
          amountMinor: review.revisedCostMinor,
          date: reviewDate,
          status:
            review.evidenceStage === "paid"
              ? "تكلفة فعلية تحت المراجعة"
              : "عرض/عقد تحت المراجعة",
          meta: boundedMeta({
            recordType: "advisor-review",
            profileId: profileRecord.id,
            goal: scopedProfile.goal,
            originalGoal:
              profileRecord.meta.originalGoal ??
              profileRecord.meta.goal ??
              scopedProfile.goal,
            originalTargetMinor:
              profileRecord.meta.originalTargetMinor ??
              profileRecord.meta.targetMinor ??
              scopedProfile.targetMinor,
            originalBudgetMinor: review.originalBudgetMinor,
            revisedCostMinor: review.revisedCostMinor,
            evidenceStage: review.evidenceStage,
            equivalentScope: review.equivalentScope,
            projectCashMinor: review.projectCashMinor,
            upcomingPaymentsMinor: review.upcomingPaymentsMinor,
            reserveMinor: review.reserveMinor,
            potentialSavingMinor: construction.potentialSavingMinor,
            freeCashMinor: construction.freeCashMinor,
            availableForSearchMinor: construction.availableForSearchMinor,
            progressPercent: reviewProgress,
            reviewDate,
            memo: reviewMemo.trim(),
            note: construction.note,
          }),
        })
      );
      report(
        "حفظ مراجعة بناء",
        "سُجلت المراجعة والتفسير محلياً. الوفر المحتمل لا يتحول إلى نقد حر أو استثمار جديد تلقائياً."
      );
    } catch (error) {
      report(
        "تعذر حفظ مراجعة البناء",
        error instanceof Error ? error.message : "تعذر حفظ المراجعة.",
        "error"
      );
    }
  };

  const sendHunterBrief = () => {
    if (!mustEdit() || !requireScope()) return;
    if (searchBudgetMinor === null) {
      report(
        "تعذر إعداد موجز القناص",
        "أصلح التشخيص أو مراجعة البناء قبل حفظ موجز أو توصية جديدة.",
        "error"
      );
      return;
    }
    const profileRecord = storedProfileRecord ?? saveProfile();
    if (!profileRecord) return;
    try {
      add(
        "plans",
        entityInput(`موجز قناص فرص · ${goalLabel(scopedProfile.goal)}`, {
          portfolioId: selectedPortfolioId,
          amountMinor: searchBudgetMinor,
          date: TODAY,
          status: "موجز بحث محلي · لم يُرسل",
          meta: boundedMeta({
            recordType: "hunter-brief",
            portfolioId: selectedPortfolioId,
            cashBudgetMinor: searchBudgetMinor,
            potentialFinancingMinor: scopedProfile.potentialFinancingMinor,
            approvedFinancingMinor: scopedProfile.approvedFinancingMinor,
            goal: scopedProfile.goal,
            risk: scopedProfile.risk,
            maxMonths: hunterMonths,
            country: country.trim() || "غير محدد",
            createdAt: TODAY,
            sourcePlanId: profileRecord.id,
          }),
        })
      );
      report(
        "إعداد موجز قناص فرص",
        "أُنشئ موجز بحث محلي للمحفظة المختارة فقط. لم يُرسل إشعار، ولم تُشترَ فرصة أو يُطلب تمويل."
      );
    } catch (error) {
      report(
        "تعذر إعداد موجز القناص",
        error instanceof Error ? error.message : "تعذر إعداد الموجز.",
        "error"
      );
    }
  };

  const renderedSource = selectedOpportunity
    ? `الفرصة المختارة: ${selectedOpportunity.title} · ${metaText(selectedOpportunity, "evidence", "تحتاج تحققاً")}`
    : "مثال الشحانية خيالي؛ ليس إعلاناً أو تقييماً أو فرصة سوق حقيقية.";

  return (
    <div className="section-stack real-estate-advisor">
      <PageHeader
        eyebrow="خطة شخصية مرتبطة بمحفظة واحدة"
        title="المستشار العقاري"
        description="شخّص هدفك، قارن مسارات مشروطة، ثم راجع ما تغيّر. لا شراء أو تمويل أو عائد مضمون داخل هذا النموذج."
      >
        <Badge tone="blue">محرك حتمي محلي</Badge>
      </PageHeader>

      <DemoNotice mode="interactive">
        الأمثلة والأرقام خيالية وموسومة. الخطة المجانية تعني مخرج سنة أولى فقط،
        لا سنة استخدام أو اشتراك مجاني؛ الأسعار وحدود الباقات غير محسومة.
      </DemoNotice>

      <nav className="advisor-journey" aria-label="رحلة المستشار العقاري">
        {STEPS.map((item, index) => (
          <button
            type="button"
            key={item}
            className={step === item ? "advisor-step active" : "advisor-step"}
            aria-current={step === item ? "step" : undefined}
            onClick={() => setStep(item)}
          >
            <span>{index + 1}</span>
            {item}
          </button>
        ))}
      </nav>

      <Panel
        title="نطاق الخطة"
        description="كل حساب وسجل وموجز بحث مرتبط بمحفظة واحدة. لا ندمج سيولة الأسرة لمجرد ظهورها في العرض الإجمالي."
        className="advisor-scope"
      >
        <div className="advisor-scope-row">
          <label className="form-label">
            <span>المحفظة المختارة</span>
            <select
              className="field"
              value={selectedPortfolioId}
              onChange={event => setSelectedPortfolioId(event.target.value)}
            >
              <option value="">اختر محفظة مستقلة</option>
              {portfolios.map(portfolio => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.title}
                </option>
              ))}
            </select>
          </label>
          <div className="advisor-scope-state">
            <ShieldCheck size={18} />
            <span>
              {scopedPortfolio
                ? `المورد والالتزامات تخص «${scopedPortfolio.title}» فقط.`
                : "لن تُحسب محافظ «الكل» معاً؛ اختر نطاقاً قبل الحفظ أو إرسال بحث."}
            </span>
          </div>
        </div>
      </Panel>

      {!scopedPortfolio && (
        <p className="advisor-callout neutral">
          اختر محفظة مستقلة أولاً لعرض الحسابات والخطة والمتابعة. لا نختار أموال
          محفظة أخرى نيابة عنك.
        </p>
      )}
      {step === "هدفك" && (
        <div className="advisor-two-column">
          <Panel
            title="ما الذي تريد الوصول إليه؟"
            description="ابدأ بهدف واحد ومدة؛ لا تحتاج إلى استبيان طويل قبل أن ترى الصورة الأولية."
          >
            <fieldset className="advisor-choice-grid">
              <legend>نوع الهدف</legend>
              {(
                [
                  ["wealth", "بناء الثروة", "رأس مال مستهدف"],
                  ["income", "دخل دوري", "دخل شهري مطلوب"],
                  ["debt", "سداد دين", "خفض التزام قائم"],
                  ["home", "تملك منزل", "دفعة/قيمة مستهدفة"],
                ] as Array<[AdvisorGoal, string, string]>
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={
                    profile.goal === value
                      ? "advisor-choice selected"
                      : "advisor-choice"
                  }
                >
                  <input
                    type="radio"
                    name="advisor-goal"
                    value={value}
                    checked={profile.goal === value}
                    disabled={!canEdit}
                    onChange={() => updateProfile("goal", value)}
                  />
                  <strong>{label}</strong>
                  <span>{hint}</span>
                </label>
              ))}
            </fieldset>
            <div className="form-grid advisor-form-spaced">
              <label className="form-label">
                <span>
                  {profile.goal === "income"
                    ? "صافي الإيجار الشهري المستهدف (ر.ق)"
                    : profile.goal === "wealth"
                      ? "صافي الثروة المستهدفة (ر.ق)"
                      : profile.goal === "debt"
                        ? "مبلغ الدين المطلوب سداده (صفر = كامل الدين)"
                        : "رأس المال المطلوب للتملك (ر.ق)"}
                </span>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={asMinorDisplay(profile.targetMinor)}
                  disabled={!canEdit}
                  onChange={event =>
                    updateProfileMoney("targetMinor", event.target.value)
                  }
                />
              </label>
              <label className="form-label">
                <span>أفق الخطة</span>
                <select
                  className="field"
                  value={profile.horizonYears}
                  disabled={!canEdit}
                  onChange={event =>
                    updateProfile(
                      "horizonYears",
                      Number(event.target.value) as 1 | 5 | 10
                    )
                  }
                >
                  <option value={1}>سنة واحدة · مخرج أولي مجاني</option>
                  <option value={5}>5 سنوات · متابعة شهرية مقترحة</option>
                  <option value={10}>10 سنوات · متابعة شهرية مقترحة</option>
                </select>
              </label>
              <label className="form-label span-all">
                <span>مصدر الأرقام</span>
                <input
                  className="field"
                  value={profile.source}
                  disabled={!canEdit}
                  onChange={event =>
                    updateProfile("source", event.target.value.slice(0, 1024))
                  }
                />
              </label>
              <label className="form-label">
                <span>تاريخ بيانات التشخيص</span>
                <input
                  className="field"
                  type="date"
                  value={profile.dataDate}
                  disabled={!canEdit}
                  aria-invalid={Boolean(diagnosisCalculation.errors.dataDate)}
                  onChange={event => updateProfile("dataDate", event.target.value)}
                />
                {diagnosisCalculation.errors.dataDate && (
                  <small className="advisor-field-error">
                    {diagnosisCalculation.errors.dataDate}
                  </small>
                )}
              </label>
              <label className="form-label">
                <span>بداية نافذة التشغيل (اختيارية)</span>
                <input
                  className="field"
                  type="month"
                  value={profile.operatingWindowStart ?? ""}
                  disabled={!canEdit}
                  aria-invalid={Boolean(
                    diagnosisCalculation.errors.operatingWindowStart
                  )}
                  onChange={event =>
                    updateProfile(
                      "operatingWindowStart",
                      event.target.value || undefined
                    )
                  }
                />
                {diagnosisCalculation.errors.operatingWindowStart && (
                  <small className="advisor-field-error">
                    {diagnosisCalculation.errors.operatingWindowStart}
                  </small>
                )}
              </label>
              <label className="form-label">
                <span>نهاية نافذة التشغيل (اختيارية)</span>
                <input
                  className="field"
                  type="month"
                  value={profile.operatingWindowEnd ?? ""}
                  disabled={!canEdit}
                  aria-invalid={Boolean(
                    diagnosisCalculation.errors.operatingWindowEnd
                  )}
                  onChange={event =>
                    updateProfile(
                      "operatingWindowEnd",
                      event.target.value || undefined
                    )
                  }
                />
                {diagnosisCalculation.errors.operatingWindowEnd && (
                  <small className="advisor-field-error">
                    {diagnosisCalculation.errors.operatingWindowEnd}
                  </small>
                )}
              </label>
              {storedProfileRecord && (
                <label className="form-label span-all">
                  <span>سبب تعديل التشخيص (عند الحفظ)</span>
                  <input
                    className="field"
                    value={profileChangeReason}
                    disabled={!canEdit}
                    maxLength={512}
                    onChange={e => setProfileChangeReason(e.target.value)}
                  />
                </label>
              )}
            </div>
          </Panel>
          <Panel
            title="ملخص قابل للتصحيح"
            description="يفصل الحساب بين ما هو نقد/أصل/دين وما هو افتراض تمويل؛ لا يرفع الادخار من تلقاء نفسه."
          >
            <div className="advisor-summary-list">
              <div>
                <span>الهدف</span>
                <strong>
                  {goalLabel(profile.goal)} · {money(profile.targetMinor)}
                </strong>
              </div>
              <div>
                <span>الأفق</span>
                <strong>
                  {profile.horizonYears === 1
                    ? "سنة أولى"
                    : `${profile.horizonYears} سنوات`}
                </strong>
              </div>
              <div>
                <span>المساهمة التي أدخلتها</span>
                <strong>
                  {money(profile.monthlyContributionMinor)} شهرياً
                </strong>
              </div>
              <div>
                <span>حالة التمويل</span>
                <strong>
                  محتمل {money(profile.potentialFinancingMinor)} / معتمد{" "}
                  {money(profile.approvedFinancingMinor)}
                </strong>
              </div>
            </div>
            <div className="advisor-callout neutral">
              <CircleAlert size={18} />
              <span>
                راتب المثال 20,000 ر.ق ومصروفه 15,000 ر.ق، لكن المساهمة تبقى
                2,000 ر.ق حتى يختار العميل غير ذلك.
              </span>
            </div>
            <ProgressButtons step={step} onStep={setStep} />
          </Panel>
        </div>
      )}

      {step === "وضعك" && scopedPortfolio && (
        <div className="advisor-two-column">
          <Panel
            title="الوضع المالي الحالي"
            description="أدخل المبالغ التي تؤكدها الآن. الأصل والدين منفصلان عن النقد، ولا تصبح القدرة المحتملة تمويلاً معتمداً."
          >
            <div className="advisor-form-groups">
              <fieldset>
                <legend>
                  <WalletCards size={16} /> السيولة والأصول والديون
                </legend>
                <div className="form-grid">
                  <MoneyField
                    label="نقد إضافي خارج حسابات المحفظة (ر.ق)"
                    value={profile.cashMinor}
                    disabled={!canEdit}
                    onChange={value => updateProfileMoney("cashMinor", value)}
                  />
                  <MoneyField
                    label="قيمة أصول قائمة (ر.ق)"
                    value={profile.assetValueMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("assetValueMinor", value)
                    }
                  />
                  <MoneyField
                    label="ديون قائمة (ر.ق)"
                    value={profile.debtMinor}
                    disabled={!canEdit}
                    onChange={value => updateProfileMoney("debtMinor", value)}
                  />
                  <MoneyField
                    label="احتياطي شخصي إضافي (ر.ق)"
                    value={profile.emergencyReserveMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("emergencyReserveMinor", value)
                    }
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend>
                  <Landmark size={16} /> الدخل والالتزامات الشهرية
                </legend>
                <div className="form-grid">
                  <MoneyField
                    label="راتب الوظيفة (ر.ق)"
                    value={profile.salaryMinor}
                    disabled={!canEdit}
                    onChange={value => updateProfileMoney("salaryMinor", value)}
                  />
                  <MoneyField
                    label="دخل الأعمال (ر.ق)"
                    value={profile.businessIncomeMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("businessIncomeMinor", value)
                    }
                  />
                  <MoneyField
                    label="المعيشة (ر.ق)"
                    value={profile.livingMinor}
                    disabled={!canEdit}
                    onChange={value => updateProfileMoney("livingMinor", value)}
                  />
                  <MoneyField
                    label="أقساط قائمة (ر.ق)"
                    value={profile.installmentMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("installmentMinor", value)
                    }
                  />
                  <MoneyField
                    label="مساهمة شهرية تختارها (ر.ق)"
                    value={profile.monthlyContributionMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("monthlyContributionMinor", value)
                    }
                  />
                  <MoneyField
                    label="سحب شهري مطلوب (ر.ق)"
                    value={profile.monthlyWithdrawalMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("monthlyWithdrawalMinor", value)
                    }
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend>
                  <ShieldCheck size={16} /> حدود المخاطرة والتمويل
                </legend>
                <div className="form-grid">
                  <label className="form-label">
                    <span>المخاطرة المقبولة</span>
                    <select
                      className="field"
                      disabled={!canEdit}
                      value={profile.risk}
                      onChange={event =>
                        updateProfile("risk", event.target.value as RiskLevel)
                      }
                    >
                      <option value="low">منخفضة</option>
                      <option value="medium">متوسطة</option>
                      <option value="high">مرتفعة</option>
                    </select>
                  </label>
                  <label className="form-label">
                    <span>أشهر تجميد مقبولة</span>
                    <input
                      className="field"
                      type="number"
                      min="0"
                      value={profile.lockMonths}
                      disabled={!canEdit}
                      onChange={event =>
                        updateProfile(
                          "lockMonths",
                          asNumber(event.target.value)
                        )
                      }
                    />
                  </label>
                  <label className="form-label">
                    <span>وقت شهري للمشروع (ساعة)</span>
                    <input
                      className="field"
                      type="number"
                      min="0"
                      value={profile.hoursMonthly}
                      disabled={!canEdit}
                      onChange={event =>
                        updateProfile(
                          "hoursMonthly",
                          asNumber(event.target.value)
                        )
                      }
                    />
                  </label>
                  <MoneyField
                    label="تمويل محتمل غير مؤكد (ر.ق)"
                    value={profile.potentialFinancingMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("potentialFinancingMinor", value)
                    }
                  />
                  <MoneyField
                    label="تمويل معتمد فقط (ر.ق)"
                    value={profile.approvedFinancingMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("approvedFinancingMinor", value)
                    }
                  />
                  <MoneyField
                    label="قسط تمويل معتمد (ر.ق)"
                    value={profile.financingInstallmentMinor}
                    disabled={!canEdit}
                    onChange={value =>
                      updateProfileMoney("financingInstallmentMinor", value)
                    }
                  />
                </div>
              </fieldset>
            </div>
          </Panel>
          {diagnosis ? (
          <Panel
            title="تشخيص حتمي للقراءة"
            description="المحرك يوضح الحدود ولا يملأ البيانات الناقصة بعائد أو تمويل مفترض."
          >
            <div className="stats-grid advisor-metrics">
              <Metric
                label="نقد قابل للدراسة"
                value={money(diagnosis.investableCashMinor)}
                detail="بعد الاحتياطي المعلن"
                icon={<WalletCards size={18} />}
              />
              <Metric
                label="فائض شهري"
                value={money(diagnosis.monthlySurplusMinor)}
                detail="دخل ناقص معيشة وأقساط"
                icon={<TrendingUp size={18} />}
              />
              <Metric
                label="صافي الثروة"
                value={money(diagnosis.netWorthMinor)}
                detail="أصول ونقد ناقص ديون"
                icon={<Landmark size={18} />}
              />
              <Metric
                label={
                  profile.goal === "income" ? "فجوة دخل شهري" : "فجوة الهدف"
                }
                value={money(diagnosis.goalGapMinor)}
                detail="ليست وعداً بإغلاقها"
                icon={<Target size={18} />}
              />
            </div>
            {diagnosis.alerts.length > 0 && (
              <ul className="advisor-alert-list">
                {diagnosis.alerts.map(alert => (
                  <li key={alert}>
                    <CircleAlert size={15} />
                    {alert}
                  </li>
                ))}
              </ul>
            )}
            <div className="advisor-callout neutral">
              <ListChecks size={18} />
              <span>
                المساهمة في التشخيص هي {money(diagnosis.contributionMinor)}{" "}
                شهرياً كما أدخلتها، وليست الفائض النظري المفترض.
              </span>
            </div>
            {diagnosis.operatingEstimate && (
              <div className="advisor-operating-estimate">
                <div>
                  <span>مصدر التشغيل وتاريخ التشخيص</span>
                  <strong>
                    {profile.source} · {profile.dataDate}
                  </strong>
                </div>
                <div>
                  <span>نافذة القياس الفعلية</span>
                  <strong>
                    {diagnosis.operatingEstimate.period.start} إلى{" "}
                    {diagnosis.operatingEstimate.period.end} ·{" "}
                    {diagnosis.operatingEstimate.months} شهرًا
                  </strong>
                </div>
                <div>
                  <span>الأشهر الصفرية/المرصودة</span>
                  <strong>
                    {diagnosis.operatingEstimate.coverage.zeroCashMonths} صفرية ·{" "}
                    {diagnosis.operatingEstimate.coverage.observedMonths} مرصودة
                  </strong>
                </div>
                <div>
                  <span>مدخلات المخاطر</span>
                  <strong>
                    {riskLabel(profile.risk)} · تجميد {profile.lockMonths} شهر ·{" "}
                    {profile.hoursMonthly} ساعة/شهر
                  </strong>
                </div>
                <div className="advisor-operating-reliability">
                  <span>موثوقية الدخل التشغيلي المستدام</span>
                  <strong>
                    {diagnosis.operatingEstimate.reliability === "sufficient"
                      ? "كافية وفق بيانات دورية موسومة"
                      : diagnosis.operatingEstimate.reliability === "limited"
                        ? "محدودة؛ لا يُفترض دخل مستدام"
                        : "غير كافية؛ لا يُفترض دخل مستدام"}
                  </strong>
                </div>
              </div>
            )}
            <div className="advisor-inline-actions">
              {storedProfileRecord && (
                <label className="form-label">
                  <span>سبب تعديل التشخيص</span>
                  <input
                    className="field"
                    value={profileChangeReason}
                    disabled={!canEdit}
                    maxLength={512}
                    onChange={e => setProfileChangeReason(e.target.value)}
                  />
                </label>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={!canEdit}
                onClick={saveProfile}
              >
                <Save size={16} /> حفظ التشخيص محلياً
              </button>
              <span className="muted small">
                الحفظ لا يغير الأرصدة أو يستحدث تمويلاً.
              </span>
            </div>
            {scopedPortfolio && <AdvisorExplanation profile={scopedProfile} />}
            <ProgressButtons step={step} onStep={setStep} />
          </Panel>
          ) : (
            <Panel
              title="أصلح مدخلات التشخيص"
              description="لم نعرض أرقاماً بديلة أو صفراً؛ صحح الحقل المشار إليه ثم أعد الحساب."
            >
              <p className="advisor-field-error" role="alert">
                {diagnosisCalculation.errors.general ??
                  diagnosisCalculation.errors.horizonYears ??
                  diagnosisCalculation.errors.source ??
                  diagnosisCalculation.errors.portfolioId ??
                  "تعذر حساب التشخيص بالمدخلات الحالية."}
              </p>
              <ProgressButtons step={step} onStep={setStep} />
            </Panel>
          )}
        </div>
      )}

      {step === "خطتك" && scopedPortfolio && diagnosis && (
        <div className="section-stack">
          <Panel
            title="ثلاثة مسارات استباقية"
            description="المسار غير المناسب يعرض سبب الرفض أو الشرط، ولا يضاف فقط لملء ثلاثة صناديق."
          >
            <div className="advisor-path-grid">
              {paths.map(path => (
                <article
                  key={path.id}
                  className={
                    path.id === chosenPathId
                      ? "advisor-path-card selected"
                      : "advisor-path-card"
                  }
                >
                  <div className="advisor-card-heading">
                    <span>{path.label}</span>
                    <Badge tone={statusTone(path.suitable)}>
                      {path.suitable ? "متاح للدراسة" : "غير مناسب الآن"}
                    </Badge>
                  </div>
                  <p className="muted small">
                    مخاطرة {riskLabel(path.risk)} · {path.resultLabel}
                  </p>
                  <strong>{path.reason}</strong>
                  <ul>
                    {path.actions.map(action => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                  <p className="advisor-gate">
                    <ShieldCheck size={15} /> بوابة الانتقال: {path.gate}
                  </p>
                  <span className="advisor-project-value">
                    {path.projectedMinor === null
                      ? "لا قيمة متوقعة معتمدة"
                      : `ناتج حسابي مشروط: ${money(path.projectedMinor)}`}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!canEdit}
                    onClick={() => setActivePathId(path.id)}
                  >
                    عرض المراحل
                  </button>
                </article>
              ))}
            </div>
            {!paths.length && (
              <EmptyState
                title="لا يظهر مسار قابل للدراسة بعد"
                description="تحقق من المحفظة والمدخلات؛ لا يفترض النموذج عائداً أو قرضاً لتعويض نقص البيانات."
              />
            )}
          </Panel>

          <div className="advisor-two-column">
            <Panel
              title="فجوة الهدف والبدائل"
              description="إذا لم تكف الموارد والمدة، لا نرفع العائد أو الاقتراض حتى تتطابق الأرقام."
            >
              <div className="advisor-gap">
                <strong>{money(diagnosis.goalGapMinor)}</strong>
                <span>
                  {profile.goal === "income"
                    ? "فجوة صافي الإيجار الشهري؛ لا نحول النقد إلى دخل بلا أصل موثق"
                    : `فجوة الحساب إلى الهدف ضمن ${profile.horizonYears === 1 ? "سنة" : `${profile.horizonYears} سنوات`}`}
                </span>
              </div>
              <ul className="advisor-alternatives">
                <li>
                  <span>
                    {profile.goal === "income"
                      ? "صافي تشغيل شهري سابق (ليس ضمانًا)"
                      : profile.goal === "debt"
                        ? "سداد ممكن ضمن المدة"
                        : "نتيجة بلا عائد استثماري مفترض"}
                  </span>
                  <strong>{money(diagnosis.baselineEndMinor)}</strong>
                </li>
                <li>
                  <span>مساهمة شهرية إضافية محسوبة</span>
                  <strong>
                    {profile.goal === "income"
                      ? "تحتاج خطة أصل وإيجار موثق"
                      : money(diagnosis.additionalMonthlyMinor)}
                  </strong>
                </li>
                <li>
                  <span>مدة تقريبية عند المدخلات الحالية</span>
                  <strong>
                    {diagnosis.monthsRequired === null
                      ? profile.goal === "income"
                        ? "لا مدة موثقة للوصول إلى الدخل"
                        : "لا يمكن تقديرها دون فائض موجب"
                      : `${diagnosis.monthsRequired} شهراً`}
                  </strong>
                </li>
              </ul>
              <p className="muted small">
                أنت تختار إن كنت ستغير المدة أو المساهمة أو الهدف؛ لا يقبل
                النظام التغيير نيابة عنك.
              </p>
            </Panel>
            <Panel
              title="مراحل المسار المختار"
              description="كل مرحلة لها فعل ومؤشر وبوابة؛ لا يصبح سعر بيع مفترض تمويلاً للدورة التالية."
            >
              {chosenPath ? (
                <>
                  <div className="advisor-active-path">
                    <TrendingUp size={17} />
                    <span>
                      {chosenPath.label}: {chosenPath.reason}
                    </span>
                  </div>
                  <ol className="advisor-stage-list">
                    {stages.map((stage, index) => (
                      <li key={`${stage.name}-${index}`}>
                        <span className="advisor-stage-index">{index + 1}</span>
                        <div>
                          <strong>{stage.name}</strong>
                          <span>
                            شهر {stage.startMonth}-{stage.endMonth} · ميزانية{" "}
                            {money(stage.budgetMinor)}
                          </span>
                          <span>المؤشر: {stage.indicator}</span>
                          <span>الإجراء: {stage.action}</span>
                          <em>البوابة: {stage.gate}</em>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="advisor-inline-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!canEdit || !chosenPath}
                      onClick={saveStages}
                    >
                      <FilePlus2 size={16} /> حفظ مراحل محلية
                    </button>
                    <span className="muted small">
                      المحفوظ حالياً: {existingStageRows.length} مرحلة.
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState title="اختر مساراً لعرض المراحل" />
              )}
            </Panel>
          </div>

          <Panel
            title="مقارنة قرار وحاسبة صفقة"
            description="قارن الشراء/البناء والبيع والاحتفاظ والتأجير وسداد الدين والنقد. الأرقام بلا دليل كافٍ تبقى مشروطة ولا تتحول إلى عائد مخترع."
          >
            <div
              className="advisor-comparison-tabs"
              role="tablist"
              aria-label="أنواع المقارنة"
            >
              {(
                [
                  ["development", "شراء · بناء · بيع"],
                  ["hold", "احتفاظ · تأجير"],
                  ["debt", "سداد الدين"],
                  ["cash", "الاحتفاظ بالنقد"],
                ] as Array<[ComparisonTab, string]>
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  role="tab"
                  aria-selected={comparisonTab === key}
                  className={comparisonTab === key ? "active" : ""}
                  onClick={() => setComparisonTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="advisor-opportunity-row">
              <label className="form-label">
                <span>فرصة قائمة في المحفظة (اختيارية)</span>
                <select
                  className="field"
                  value={selectedOpportunityId}
                  disabled={!canEdit}
                  onChange={event =>
                    setSelectedOpportunityId(event.target.value)
                  }
                >
                  <option value="">استخدم المثال الخيالي</option>
                  {scopedOpportunities.map(row => (
                    <option key={row.id} value={row.id}>
                      {row.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">{renderedSource}</p>
            </div>
            {comparisonTab === "development" && (
              <DealCalculator
                deal={deal}
                disabled={!canEdit}
                onMoneyChange={updateDealMoney}
                onChange={setDeal}
                calculation={dealCalculation}
                lastValidResult={lastValidDealResult}
              />
            )}
            {comparisonTab === "hold" && (
              <div className="advisor-comparison-copy">
                <Calculator size={20} />
                <div>
                  <strong>احتفاظ وتأجير</strong>
                  <p>
                    {dealCalculation.ok
                      ? `صافي الإيجار الشهري في الحسبة: ${money(dealCalculation.value.monthlyNetRentMinor)}.`
                      : "نتيجة الإيجار غير متاحة حتى تصحيح حقول الصفقة."}{" "}
                    لا توجد مقارنة إيجارات موثقة أو شغور وتكاليف كافية لتسمية
                    ذلك عائداً ثابتاً؛ أضف مصدر الفرصة ومصروفاتها قبل القرار.
                  </p>
                </div>
              </div>
            )}
            {comparisonTab === "debt" && (
              <div className="advisor-comparison-copy">
                <Landmark size={20} />
                <div>
                  <strong>سداد دين مقابل دورة نمو</strong>
                  <p>
                    الدين المسجل: {money(profile.debtMinor)}. لا يمكن ترتيب سداد
                    الدين مقابل التطوير دون تكلفة التمويل وتاريخ الاستحقاق
                    واحتياج السيولة؛ لا ينشئ النموذج قرضاً بديلاً.
                  </p>
                </div>
              </div>
            )}
            {comparisonTab === "cash" && (
              <div className="advisor-comparison-copy">
                <WalletCards size={20} />
                <div>
                  <strong>الاحتفاظ بالنقد</strong>
                  <p>
                    النقد القابل للدراسة: {money(diagnosis.investableCashMinor)}
                    . الاحتفاظ به بديل مقصود عندما لا تكفي أدلة الصفقة أو لا
                    تتحقق بوابة المخاطرة والسيولة.
                  </p>
                </div>
              </div>
            )}
          </Panel>
          <ProgressButtons step={step} onStep={setStep} />
        </div>
      )}

      {step === "المتابعة" && scopedPortfolio && (
        <div className="section-stack">
          <div className="advisor-two-column">
            <Panel
              title="مراجعة بناء شهرية"
              description="يفصل العرض عن العقد عن المدفوع. لا يصبح فرق العرض تحصيلاً أو فائضاً قابلاً للاستثمار تلقائياً."
            >
              <div className="form-grid">
                <MoneyField
                  label="الميزانية الأصلية (ر.ق)"
                  value={review.originalBudgetMinor}
                  disabled={!canEdit}
                  onChange={value =>
                    setReview(current => ({
                      ...current,
                      originalBudgetMinor: value.trim() ? toMinor(value) : 0,
                    }))
                  }
                />
                <MoneyField
                  label="القيمة المراجعة (ر.ق)"
                  value={review.revisedCostMinor}
                  disabled={!canEdit}
                  onChange={value =>
                    setReview(current => ({
                      ...current,
                      revisedCostMinor: value.trim() ? toMinor(value) : 0,
                    }))
                  }
                />
                <label className="form-label">
                  <span>حالة الدليل</span>
                  <select
                    className="field"
                    value={review.evidenceStage}
                    disabled={!canEdit}
                    onChange={event =>
                      setReview(current => ({
                        ...current,
                        evidenceStage: event.target
                          .value as ConstructionReviewInput["evidenceStage"],
                      }))
                    }
                  >
                    <option value="quote">عرض سعر</option>
                    <option value="contract">عقد موقّع</option>
                    <option value="paid">مدفوع فعلياً</option>
                  </select>
                </label>
                <label className="check-row advisor-check">
                  <input
                    type="checkbox"
                    checked={review.equivalentScope}
                    disabled={!canEdit}
                    onChange={event =>
                      setReview(current => ({
                        ...current,
                        equivalentScope: event.target.checked,
                      }))
                    }
                  />
                  النطاق والجودة والضمانات والمدة متكافئة
                </label>
                <MoneyField
                  label="نقد المشروع (ر.ق)"
                  value={review.projectCashMinor}
                  disabled={!canEdit}
                  onChange={value =>
                    setReview(current => ({
                      ...current,
                      projectCashMinor: value.trim() ? toMinor(value) : 0,
                    }))
                  }
                />
                <MoneyField
                  label="دفعات قادمة (ر.ق)"
                  value={review.upcomingPaymentsMinor}
                  disabled={!canEdit}
                  onChange={value =>
                    setReview(current => ({
                      ...current,
                      upcomingPaymentsMinor: value.trim() ? toMinor(value) : 0,
                    }))
                  }
                />
                <MoneyField
                  label="احتياطي المشروع (ر.ق)"
                  value={review.reserveMinor}
                  disabled={!canEdit}
                  onChange={value =>
                    setReview(current => ({
                      ...current,
                      reserveMinor: value.trim() ? toMinor(value) : 0,
                    }))
                  }
                />
                <label className="form-label">
                  <span>الإنجاز الفعلي (%)</span>
                  <input
                    className="field"
                    type="number"
                    min="0"
                    max="100"
                    value={reviewProgress}
                    disabled={!canEdit}
                    onChange={event =>
                      setReviewProgress(
                        Math.min(100, asNumber(event.target.value))
                      )
                    }
                  />
                </label>
                <label className="form-label">
                  <span>تاريخ المراجعة</span>
                  <input
                    className="field"
                    type="date"
                    value={reviewDate}
                    disabled={!canEdit}
                    onChange={event => setReviewDate(event.target.value)}
                  />
                </label>
                <label className="form-label span-all">
                  <span>سبب التعديل/الملاحظة</span>
                  <textarea
                    className="field"
                    rows={3}
                    value={reviewMemo}
                    disabled={!canEdit}
                    onChange={event =>
                      setReviewMemo(event.target.value.slice(0, 1024))
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={!canEdit}
                onClick={saveConstructionReview}
              >
                <Save size={16} /> تسجيل مراجعة البناء
              </button>
            </Panel>
            <Panel
              title="أثر المراجعة والقرار التالي"
              description="النتيجة حتمية من الحقول المدخلة، وليست تحصيلاً أو تصريحاً باستخدام الفرق."
            >
              <div className="stats-grid advisor-metrics">
                <Metric
                  label="وفر محتمل"
                  value={construction ? money(construction.potentialSavingMinor) : "غير متاح"}
                  detail={
                    review.evidenceStage === "quote"
                      ? "عرض فقط"
                      : "يحتاج مراجعة قبل الاعتماد"
                  }
                  icon={<Calculator size={18} />}
                />
                <Metric
                  label="نقد حر بعد الدفعات والاحتياطي"
                  value={construction ? money(construction.freeCashMinor) : "غير متاح"}
                  detail="لا يشمل تمويلاً محتملاً"
                  icon={<WalletCards size={18} />}
                />
                <Metric
                  label="متاح للبحث بعد البوابة"
                  value={construction ? money(construction.availableForSearchMinor) : "غير متاح"}
                  detail="ليس استثماراً تلقائياً"
                  icon={<SearchCheck size={18} />}
                />
              </div>
              <div className="advisor-callout amber">
                <CircleAlert size={18} />
                <span>{construction?.note ?? "أصلح مدخلات مراجعة البناء قبل عرض نتيجة."}</span>
              </div>
              <div className="advisor-progress-card">
                <div>
                  <span>إنجاز فعلي هذا الشهر</span>
                  <strong>{reviewProgress}%</strong>
                </div>
                <div className="advisor-progress-track">
                  <span style={{ width: `${reviewProgress}%` }} />
                </div>
                <p>
                  التكلفة مقابل الخطة:{" "}
                  {money(
                    Math.abs(
                      review.revisedCostMinor - review.originalBudgetMinor
                    )
                  )}{" "}
                  {review.revisedCostMinor <= review.originalBudgetMinor
                    ? "أقل من التقدير"
                    : "أعلى من التقدير"}
                  . الانحراف الزمني يحتاج تاريخ بداية وموعد مرحلة معتمدين؛ لا
                  نخترعه من نسبة الإنجاز.
                </p>
                <p>
                  <strong>القرار التالي:</strong>{" "}
                  {review.equivalentScope
                    ? "راجع الاحتياطي والدفعات، ثم قرر هل يتاح مبلغ للبحث."
                    : "تحقق من تكافؤ النطاق أولاً؛ لا تعتمد الوفراً ولا توجهه لفرصة أخرى."}
                </p>
              </div>
            </Panel>
          </div>

          <div className="advisor-two-column">
            <Panel
              title="سجل النسخ والمراجعات"
              description="يبقى الهدف الأصلي مرئياً، ويعرض السجل قبل/بعد بالتسلسل بدلاً من استبدال الرقم بصمت."
            >
              {storedProfileRecord && (
                <p className="muted small">
                  الهدف الأصلي:{" "}
                  {goalLabel(
                    (storedProfileRecord.meta.originalGoal ??
                      storedProfileRecord.meta.goal) as AdvisorGoal
                  )}{" "}
                  ·{" "}
                  {money(
                    Number(
                      storedProfileRecord.meta.originalTargetMinor ??
                        storedProfileRecord.meta.targetMinor ??
                        0
                    )
                  )} {" "}
                  · نسخة {String(storedProfileRecord.meta.version ?? 1)}
                </p>
              )}
              {archivedPlanVersions.map(row => (
                  <p className="muted small" key={row.id}>
                    نسخة سابقة: {String(row.meta.archivedAt ?? row.date)} ·{" "}
                    {String(row.meta.changeReason)} · الهدف وقتها{" "}
                    {money(row.amountMinor)}
                  </p>
                ))}
              {reviewHistory.length ? (
                <ol className="advisor-history-list">
                  {reviewHistory.map(row => (
                    <li key={row.id}>
                      <FileClock size={17} />
                      <div>
                        <strong>
                          {row.date} ·{" "}
                          {metaText(row, "originalGoal", metaText(row, "goal"))}
                        </strong>
                        <span>
                          قبل:{" "}
                          {money(Number(row.meta.originalBudgetMinor ?? 0))} ←
                          بعد:{" "}
                          {money(
                            Number(row.meta.revisedCostMinor ?? row.amountMinor)
                          )}
                        </span>
                        <span>
                          {metaText(row, "evidenceStage")} · إنجاز{" "}
                          {metaText(row, "progressPercent", "0")}%
                        </span>
                        <em>{metaText(row, "memo")}</em>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="لا توجد مراجعات محفوظة"
                  description="سجّل عرضاً أو عقداً أو تكلفة مدفوعة مع التفسير لرؤية التسلسل هنا."
                />
              )}
            </Panel>
            <Panel
              title="تحويل الاحتياج إلى قناص الفرص"
              description="ينشئ موجز بحث محلياً عند الضغط فقط. لا يوجد إشعار أو شراء أو طلب تمويل أو تشغيل بحث خارجي."
            >
              <div className="form-grid">
                <label className="form-label">
                  <span>مصدر ميزانية البحث</span>
                  <select
                    className="field"
                    value={searchBudgetBasis}
                    onChange={e =>
                      setSearchBudgetBasis(e.target.value as "plan" | "saving")
                    }
                  >
                    <option value="plan">سيولة الخطة بعد الحجز</option>
                    <option value="saving">وفر بناء محقق واجتاز البوابة</option>
                  </select>
                </label>
                <label className="form-label">
                  <span>البلد المقصود</span>
                  <input
                    className="field"
                    value={country}
                    disabled={!canEdit}
                    onChange={event =>
                      setCountry(event.target.value.slice(0, 120))
                    }
                  />
                </label>
                <label className="form-label">
                  <span>أقصى مدة للبحث (شهر)</span>
                  <input
                    className="field"
                    type="number"
                    min="1"
                    value={hunterMonths}
                    disabled={!canEdit}
                    onChange={event =>
                      setHunterMonths(
                        Math.max(1, asNumber(event.target.value, 1))
                      )
                    }
                  />
                </label>
              </div>
              <div className="advisor-brief-preview">
                <strong>الموجز المقترح</strong>
                <span>
                  نقد {searchBudgetMinor === null ? "غير متاح حتى التصحيح" : money(searchBudgetMinor)} · تمويل محتمل{" "}
                  {money(profile.potentialFinancingMinor)} · معتمد{" "}
                  {money(profile.approvedFinancingMinor)}
                </span>
                <span>
                  هدف {goalLabel(profile.goal)} · مخاطرة{" "}
                  {riskLabel(profile.risk)} · {country || "بلد غير محدد"}
                </span>
              </div>
              <div className="advisor-inline-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canEdit}
                  onClick={sendHunterBrief}
                >
                  <SearchCheck size={16} /> إنشاء موجز للقناص
                </button>
                <a className="link-button" href="/opportunities">
                  فتح قناص الفرص <ArrowLeft size={15} />
                </a>
              </div>
            </Panel>
          </div>
          <Panel
            title="ملاحظات قناص الفرص"
            description="تعود ملاحظات الفرص لهذه الخطة فقط، وتبقى للمراجعة لا تغير قرارًا أو مبلغًا تلقائيًا."
          >
            {hunterFeedback.length ? (
              hunterFeedback.map(row => (
                <article className="advisor-callout neutral" key={row.id}>
                  <FileClock size={17} />
                  <div>
                    <strong>
                      {list("opportunities").find(
                        o => o.id === row.meta.opportunityId
                      )?.title ?? "فرصة مرتبطة بالخطة"}
                    </strong>
                    <p>
                      {String(row.meta.reason ?? row.meta.memo ?? row.subtitle)}{" "}
                      · {row.date}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted small">
                لا ملاحظات مرتبطة بالخطة بعد. افتح القناص وأرسل سبب المراجعة من
                تفاصيل الفرصة.
              </p>
            )}
          </Panel>
          {aiNarrativeSlot && (
            <Panel
              title="شرح مساعد اختياري"
              description="يأتي بعد الحساب الحتمي ولا يغير مبلغاً أو مساراً أو سجلاً."
            >
              {aiNarrativeSlot}
            </Panel>
          )}
          <ProgressButtons step={step} onStep={setStep} />
        </div>
      )}

      <p className="advisor-live-message" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

function MoneyField({
  label,
  value,
  disabled,
  onChange,
  error,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <label className="form-label">
      <span>{label}</span>
      <input
        className="field"
        type="number"
        min="0"
        step="0.01"
        value={asMinorDisplay(value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={event => onChange(event.target.value)}
      />
      {error && <small className="advisor-field-error">{error}</small>}
    </label>
  );
}

function DealCalculator({
  deal,
  disabled,
  onMoneyChange,
  onChange,
  calculation,
  lastValidResult,
}: {
  deal: DealInput;
  disabled: boolean;
  onMoneyChange: (key: DealMoneyKey, value: string) => void;
  onChange: (input: DealInput) => void;
  calculation: Calculation<DealResult>;
  lastValidResult: DealResult | null;
}) {
  const fields: Array<[DealMoneyKey, string]> = [
    ["purchaseMinor", "سعر الشراء/الأرض (ر.ق)"],
    ["developmentMinor", "البناء/التطوير (ر.ق)"],
    ["feesMinor", "رسوم ومصروفات إضافية (ر.ق)"],
    ["financingCostMinor", "تكلفة تمويل معروفة (ر.ق)"],
    ["loanPrincipalMinor", "أصل الدين عند الخروج (ر.ق)"],
    ["saleMinor", "سعر البيع المفترض (ر.ق)"],
    ["monthlyRentMinor", "إيجار شهري مفترض (ر.ق)"],
    ["monthlyOperatingMinor", "تشغيل شهري (ر.ق)"],
    ["reserveMinor", "احتياطي الصفقة (ر.ق)"],
    ["monthlyHoldingMinor", "تكلفة حمل شهرية (ر.ق)"],
  ];
  const result = calculation.ok ? calculation.value : lastValidResult;
  const stale = !calculation.ok && Boolean(lastValidResult);
  return (
    <div className="advisor-deal-calculator">
      <div className="advisor-callout neutral">
        <Calculator size={18} />
        <span>
          مثال خيالي: أرض 1,000,000 ر.ق + بناء 800,000 ر.ق + مصروفات 50,000 ر.ق
          + بيع مفترض 2,500,000 ر.ق. لا يمثل فرصة سوق أو ضماناً.
        </span>
      </div>
      <div className="form-grid">
        {fields.map(([key, label]) => (
          <MoneyField
            key={key}
            label={label}
            value={deal[key]}
            disabled={disabled}
            onChange={value => onMoneyChange(key, value)}
            error={calculation.errors[key]}
          />
        ))}
        <label className="form-label">
          <span>شغور مفترض (%)</span>
          <input
            className="field"
            type="number"
            min="0"
            max="100"
            value={deal.vacancyPercent}
            disabled={disabled}
            aria-invalid={Boolean(calculation.errors.vacancyPercent)}
            onChange={event =>
              onChange({ ...deal, vacancyPercent: asNumber(event.target.value) })
            }
          />
          {calculation.errors.vacancyPercent && (
            <small className="advisor-field-error">
              {calculation.errors.vacancyPercent}
            </small>
          )}
        </label>
        <label className="form-label">
          <span>مدة البناء (شهر)</span>
          <input
            className="field"
            type="number"
            min="0"
            value={deal.buildMonths}
            disabled={disabled}
            aria-invalid={Boolean(calculation.errors.buildMonths)}
            onChange={event =>
              onChange({ ...deal, buildMonths: asNumber(event.target.value) })
            }
          />
          {calculation.errors.buildMonths && (
            <small className="advisor-field-error">
              {calculation.errors.buildMonths}
            </small>
          )}
        </label>
        <label className="form-label">
          <span>مدة التسويق (شهر)</span>
          <input
            className="field"
            type="number"
            min="0"
            value={deal.marketingMonths}
            disabled={disabled}
            aria-invalid={Boolean(calculation.errors.marketingMonths)}
            onChange={event =>
              onChange({ ...deal, marketingMonths: asNumber(event.target.value) })
            }
          />
          {calculation.errors.marketingMonths && (
            <small className="advisor-field-error">
              {calculation.errors.marketingMonths}
            </small>
          )}
        </label>
      </div>
      {!calculation.ok && (
        <p className="advisor-field-error" role="alert">
          {calculation.errors.general ??
            calculation.errors.loanPrincipalMinor ??
            calculation.errors.buildMonths ??
            "أصلح الحقول المشار إليها؛ لم تُحسب نتيجة للمدخلات الحالية."}
        </p>
      )}
      {stale && (
        <p className="advisor-callout amber">
          النتيجة السابقة معروضة للمرجع فقط وهي لا تطابق المدخلات الحالية.
        </p>
      )}
      {result && (
        <>
          <div className="advisor-deal-result">
            <div><span>الهامش الأولي</span><strong>{money(result.initialMarginMinor)}</strong></div>
            <div><span>إجمالي التكلفة</span><strong>{money(result.totalCostMinor)}</strong></div>
            <div><span>الناتج بعد الدين</span><strong>{money(result.resultMinor)}</strong></div>
            <div><span>عائد الدورة فقط</span><strong>{result.cycleReturnPercent === null ? "غير متاح" : `${result.cycleReturnPercent.toFixed(1)}%`}</strong></div>
            <div><span>المدة</span><strong>{result.durationMonths} شهراً</strong></div>
            <div><span>النقد المطلوب</span><strong>{money(result.cashRequiredMinor)}</strong></div>
          </div>
          {result.warnings.length > 0 && (
            <ul className="advisor-alert-list">
              {result.warnings.map(warning => (
                <li key={warning}><CircleAlert size={15} />{warning}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="muted small">
        النتيجة نسبة لدورة الصفقة لا لسنة، ولا تُسمى ربحاً نهائياً قبل تحقق كامل
        التكاليف والتمويل والبيع.
      </p>
    </div>
  );
}

export default RealEstateAdvisorPage;
