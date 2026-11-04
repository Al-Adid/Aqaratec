import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  ClipboardCheck,
  FileSearch,
  ListFilter,
  RefreshCw,
  Send,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  Badge,
  DemoNotice,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import type { DemoEntity } from "@shared/prototype";
import { money, toMinor } from "@shared/prototype";
import {
  calculateDeal,
  dealFromEntity,
  evaluateHunter,
  stressDeal,
} from "@shared/advisor-engine";
import type {
  AdvisorGoal,
  HunterBrief,
  RiskLevel,
} from "@shared/advisor-types";
import {
  HUNTER_BRIEF_RECORD_TYPE,
  HUNTER_DEFAULT_PROFILE_ID,
  HUNTER_DEFAULT_SOURCE_PLAN_ID,
  HUNTER_EXECUTION_TASK_RECORD_TYPE,
  HUNTER_FEEDBACK_RECORD_TYPE,
  HUNTER_RECORD_TYPE,
  fixtureToOpportunity,
  hasMissingEvidence,
  hunterMeta,
  hunterMoneyMeta,
  scanFixedHunterFixtures,
  sourceFreshness,
} from "@/lib/hunter-demo";
import "./hunter.css";

type BriefForm = {
  cashBudget: string;
  potentialFinancing: string;
  approvedFinancing: string;
  goal: AdvisorGoal;
  risk: RiskLevel;
  maxMonths: string;
  country: string;
};

type StressForm = {
  saleDeclinePercent: string;
  developmentIncreasePercent: string;
  delayMonths: string;
  financingRejected: boolean;
};

const DEFAULT_BRIEF_FORM: BriefForm = {
  cashBudget: "450000",
  potentialFinancing: "200000",
  approvedFinancing: "0",
  goal: "wealth",
  risk: "medium",
  maxMonths: "18",
  country: "قطر",
};

const DEFAULT_STRESS: StressForm = {
  saleDeclinePercent: "20",
  developmentIncreasePercent: "25",
  delayMonths: "12",
  financingRejected: false,
};

const GOALS: Array<{ value: AdvisorGoal; label: string }> = [
  { value: "wealth", label: "نمو رأس المال" },
  { value: "income", label: "دخل دوري" },
  { value: "debt", label: "خفض دين" },
  { value: "home", label: "تملك" },
];

const RISKS: Array<{ value: RiskLevel; label: string }> = [
  { value: "low", label: "منخفضة" },
  { value: "medium", label: "متوسطة" },
  { value: "high", label: "مرتفعة" },
];

function scalarNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fallback;
}

function majorToMinor(value: string): number {
  return toMinor(value.trim() || "0");
}

function numberFromText(value: string, fallback = 0): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : fallback;
}

function briefFromPlan(row: DemoEntity): HunterBrief | null {
  if (hunterMeta(row, "recordType") !== HUNTER_BRIEF_RECORD_TYPE) return null;
  const goal = hunterMeta(row, "goal") as AdvisorGoal;
  const risk = hunterMeta(row, "risk") as RiskLevel;
  if (
    !GOALS.some(item => item.value === goal) ||
    !RISKS.some(item => item.value === risk)
  )
    return null;
  const maxMonths = scalarNumber(row.meta.maxMonths, 0);
  if (maxMonths < 1) return null;
  return {
    portfolioId: row.portfolioId,
    cashBudgetMinor: scalarNumber(row.meta.cashBudgetMinor),
    potentialFinancingMinor: scalarNumber(row.meta.potentialFinancingMinor),
    approvedFinancingMinor: scalarNumber(row.meta.approvedFinancingMinor),
    goal,
    risk,
    maxMonths,
    country: hunterMeta(row, "country") || "قطر",
    createdAt: hunterMeta(row, "createdAt") || row.date,
    sourcePlanId:
      hunterMeta(row, "sourcePlanId") || HUNTER_DEFAULT_SOURCE_PLAN_ID,
  };
}

function formFromBrief(brief: HunterBrief): BriefForm {
  return {
    cashBudget: String(brief.cashBudgetMinor / 100),
    potentialFinancing: String(brief.potentialFinancingMinor / 100),
    approvedFinancing: String(brief.approvedFinancingMinor / 100),
    goal: brief.goal,
    risk: brief.risk,
    maxMonths: String(brief.maxMonths),
    country: brief.country,
  };
}

function draftBrief(
  form: BriefForm,
  portfolioId: string,
  sourcePlanId: string
): HunterBrief {
  return {
    portfolioId,
    cashBudgetMinor: majorToMinor(form.cashBudget),
    potentialFinancingMinor: majorToMinor(form.potentialFinancing),
    approvedFinancingMinor: majorToMinor(form.approvedFinancing),
    goal: form.goal,
    risk: form.risk,
    maxMonths: Math.max(1, numberFromText(form.maxMonths, 1)),
    country: form.country.trim() || "قطر",
    createdAt: "2026-10-24",
    sourcePlanId,
  };
}

function currencyFor(row: DemoEntity): string {
  return hunterMeta(row, "currencyCode") || "QAR";
}

function recordedMeta(row: DemoEntity, key: string): string {
  return hunterMeta(row, key).trim() || "غير مسجل";
}

function statusTone(
  status: string
): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "مرشح للمراجعة") return "green";
  if (status === "غير مناسب") return "red";
  if (status === "تحت الدراسة") return "blue";
  if (status === "يحتاج بيانات") return "amber";
  return "gray";
}

type SafeResult<T> = { ok: true; value: T } | { ok: false; message: string };
function safeEngine<T>(run: () => T): SafeResult<T> {
  try { return { ok: true, value: run() }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "تعذر حساب المدخلات." }; }
}
function resultMessage<T>(outcome: SafeResult<T> | null): string | null {
  return outcome && !outcome.ok ? outcome.message : null;
}
function safeEvaluation(row: DemoEntity, brief: HunterBrief) {
  return safeEngine(() => evaluateHunter(row, brief));
}
function safeDeal(row: DemoEntity) {
  return safeEngine(() => calculateDeal(dealFromEntity(row)));
}
function stressError(stress: StressForm): string | null {
  const fields: Array<[string, string]> = [
    [stress.saleDeclinePercent, "انخفاض البيع"],
    [stress.developmentIncreasePercent, "زيادة التطوير"],
  ];
  for (const [value, label] of fields) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
      return `${label} يجب أن يكون نسبة بين 0 و100`;
  }
  const delay = Number(stress.delayMonths);
  if (!Number.isSafeInteger(delay) || delay < 0)
    return "تأخر المشروع يجب أن يكون عددًا صحيحًا غير سالب";
  return null;
}
function suitabilityText(row: DemoEntity, brief: HunterBrief): string {
  const outcome = safeEvaluation(row, brief);
  if (!outcome.ok) return `نتيجة غير متاحة حتى تصحيح البيانات: ${outcome.message}`;
  const evaluation = outcome.value;
  if (hasMissingEvidence(row)) return "غير مناسب الآن: دليل المصدر والحقوق أو الأهلية غير مكتمل.";
  if (evaluation.conditional) return "مشروطة: قد تعتمد على تمويل أو تحقق إضافي، وليست سيولة مؤكدة.";
  if (evaluation.suitable) return "قابلة للدراسة الآن حسابيًا فقط؛ يلزم تحقق بشري قبل أي انتقال.";
  return "غير مناسبة الآن: لا تلائم الحد المالي أو المدة أو مستوى المخاطرة في الموجز.";
}
function screeningStatus(row: DemoEntity, brief: HunterBrief): string {
  const outcome = safeEvaluation(row, brief);
  if (!outcome.ok) return "يحتاج بيانات";
  if (hasMissingEvidence(row)) return "يحتاج بيانات";
  if (outcome.value.conditional) return "تحت الدراسة";
  return outcome.value.suitable ? "مرشح للمراجعة" : "غير مناسب";
}
function riskSummary(row: DemoEntity, brief: HunterBrief): string {
  const risks: string[] = [];
  if (sourceFreshness(row) !== "حديث") risks.push("العرض غير حديث أو غير متاح");
  if (!row.meta.verified) risks.push("المصدر غير متحقق");
  if (!row.meta.rightsVerified) risks.push("الحقوق غير مثبتة");
  if (!row.meta.eligibilityVerified) risks.push("الأهلية غير مثبتة");
  if (currencyFor(row) !== "QAR") risks.push("العملة مستقلة ولا تُجمع مع QAR");
  const outcome = safeEvaluation(row, brief);
  if (!outcome.ok) risks.push(outcome.message);
  else if (outcome.value.conditional) risks.push("التمويل أو شرط السيولة غير مؤكد");
  return risks.join(" · ") || "لا يزال فحص البشر مطلوبًا قبل القرار.";
}

function nextCheck(row: DemoEntity): string {
  const kind = hunterMeta(row, "kind");
  if (kind.includes("ترميز") || kind.includes("حصة"))
    return "تحقق من نوع الحق، التسجيل، الجهة المصدرة، قابلية الخروج، وأهلية العميل.";
  if (kind.includes("ناقص"))
    return "اطلب نطاق إكمال موثقًا، مخططًا، عروضًا متكافئة، وحالة الترخيص.";
  if (kind.includes("احتفاظ"))
    return "افصل العملة والتحويل والضرائب وحق التملك وسيولة الخروج قبل المقارنة.";
  return "تحقق من الملكية، الاستخدام/الترخيص، نطاق العمل، التكاليف، والطلب قبل العرض.";
}

export function OpportunityHunterPage() {
  const { state, list, add, patch, log, canEdit } = usePrototype();
  const portfolios = list("portfolios");
  const initialPortfolio =
    state.settings.portfolioId !== "all"
      ? state.settings.portfolioId
      : (portfolios[0]?.id ?? "family");
  const [portfolioId, setPortfolioId] = useState(initialPortfolio);
  const [briefForm, setBriefForm] = useState<BriefForm>(DEFAULT_BRIEF_FORM);
  const [activeTab, setActiveTab] = useState("list");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [freshnessFilter, setFreshnessFilter] = useState("الكل");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [stress, setStress] = useState<StressForm>(DEFAULT_STRESS);
  const [message, setMessage] = useState(
    "ابدأ بحفظ موجز البحث أو استخدم الموجز الافتراضي الصريح؛ لا يوجد مسح خارجي أو جدولة يومية مفعّلة."
  );
  const [scan, setScan] = useState<ReturnType<
    typeof scanFixedHunterFixtures
  > | null>(null);

  const plans = list("plans");
  const advisorProfile = plans.find(
    row =>
      row.portfolioId === portfolioId &&
      hunterMeta(row, "recordType") === "advisor-profile"
  );
  const sourcePlanId = advisorProfile?.id ?? HUNTER_DEFAULT_SOURCE_PLAN_ID;
  const profileId =
    hunterMeta(advisorProfile ?? ({ meta: {} } as DemoEntity), "profileId") ||
    advisorProfile?.id ||
    HUNTER_DEFAULT_PROFILE_ID;
  const savedBriefRow = plans
    .filter(
      row =>
        row.portfolioId === portfolioId &&
        hunterMeta(row, "recordType") === HUNTER_BRIEF_RECORD_TYPE
    )
    .at(-1);
  const savedBrief = savedBriefRow ? briefFromPlan(savedBriefRow) : null;

  useEffect(() => {
    setSelected([]);
    setActiveId("");
    setScan(null);
    const next = savedBrief ? formFromBrief(savedBrief) : DEFAULT_BRIEF_FORM;
    setBriefForm(next);
  }, [portfolioId, savedBriefRow?.id]);

  const activeBrief = useMemo(() => {
    try {
      return savedBrief ?? draftBrief(briefForm, portfolioId, sourcePlanId);
    } catch {
      return {
        ...draftBrief(DEFAULT_BRIEF_FORM, portfolioId, sourcePlanId),
        sourcePlanId,
      };
    }
  }, [briefForm, portfolioId, savedBrief, sourcePlanId]);

  const rows = useMemo(
    () =>
      list("opportunities").filter(
        row =>
          row.portfolioId === portfolioId &&
          hunterMeta(row, "recordType") === HUNTER_RECORD_TYPE
      ),
    [list, portfolioId, state.entities.opportunities]
  );
  const kindOptions = useMemo(
    () => ["الكل", ...new Set(rows.map(row => hunterMeta(row, "kind")))],
    [rows]
  );
  const statusOptions = useMemo(
    () => ["الكل", ...new Set(rows.map(row => row.status))],
    [rows]
  );
  const visibleRows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("ar");
    return rows.filter(row => {
      const matchesText =
        !text ||
        `${row.title} ${row.subtitle} ${hunterMeta(row, "kind")} ${hunterMeta(row, "country")}`
          .toLocaleLowerCase("ar")
          .includes(text);
      return (
        matchesText &&
        (kindFilter === "الكل" || hunterMeta(row, "kind") === kindFilter) &&
        (statusFilter === "الكل" || row.status === statusFilter) &&
        (freshnessFilter === "الكل" || sourceFreshness(row) === freshnessFilter)
      );
    });
  }, [rows, query, kindFilter, statusFilter, freshnessFilter]);
  const selectedRows = rows.filter(row => selected.includes(row.id));
  const activeRow =
    rows.find(row => row.id === activeId) ?? selectedRows[0] ?? visibleRows[0];

  const saveBrief = () => {
    if (!canEdit) {
      setMessage("دور القراءة لا يحفظ موجزًا أو يعدل حالة في النموذج.");
      return;
    }
    try {
      const next = draftBrief(briefForm, portfolioId, sourcePlanId);
      const meta = {
        recordType: HUNTER_BRIEF_RECORD_TYPE,
        profileId,
        sourcePlanId: next.sourcePlanId,
        cashBudgetMinor: next.cashBudgetMinor,
        potentialFinancingMinor: next.potentialFinancingMinor,
        approvedFinancingMinor: next.approvedFinancingMinor,
        goal: next.goal,
        risk: next.risk,
        maxMonths: next.maxMonths,
        country: next.country,
        createdAt: next.createdAt,
      };
      if (savedBriefRow) {
        patch("plans", savedBriefRow.id, {
          title: "موجز قناص الفرص · تجريبي",
          amountMinor: next.cashBudgetMinor,
          status: "موجز محفوظ محليًا",
          meta,
        });
      } else {
        add("plans", {
          title: "موجز قناص الفرص · تجريبي",
          subtitle: advisorProfile
            ? `مرتبط بملف المستشار «${advisorProfile.title}»`
            : "مرتبط بملف مستشار افتراضي معلن",
          portfolioId,
          status: "موجز محفوظ محليًا",
          amountMinor: next.cashBudgetMinor,
          meta,
        });
      }
      const nextMessage =
        "حُفظ موجز البحث داخل الخطة المحددة فقط؛ التمويل المحتمل غير معتمد ولا يجمع العملات.";
      setMessage(nextMessage);
      log("حفظ موجز قناص الفرص", nextMessage);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر قراءة مدخلات الموجز."
      );
    }
  };

  const runScan = () => {
    if (!canEdit) {
      setMessage(
        "دور القراءة يعرض النتيجة الحالية فقط؛ لم يبدأ مسح محلي جديد."
      );
      return;
    }
    const result = scanFixedHunterFixtures(list("opportunities"), portfolioId);
    for (const fixture of result.additions) {
      const fixtureRow = {
        ...fixture,
        portfolioId,
        propertyId: "",
      } as DemoEntity;
      add(
        "opportunities",
        fixtureToOpportunity(
          fixture,
          portfolioId,
          screeningStatus(fixtureRow, activeBrief)
        )
      );
    }
    setScan(result);
    const nextMessage = `محاكاة محلية: رُصد ${result.detected}، أزيل ${result.deduplicated} مكرر، استبعد ${result.old} قديم/غير متاح، وسُجّل ${result.additions.length} فقط ضمن المحفظة.`;
    setMessage(nextMessage);
    log("محاكاة مسح قناص الفرص", nextMessage);
  };

  const toggleSelected = (id: string) => {
    if (!canEdit) return;
    setSelected(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id]
    );
    setActiveId(id);
  };

  const transferToExecution = (row: DemoEntity) => {
    if (!canEdit) {
      setMessage("دور القراءة لا يسجل انتقالًا أو مهمة متابعة.");
      return;
    }
    const evaluationOutcome = safeEvaluation(row, activeBrief);
    const evaluation = evaluationOutcome.ok ? evaluationOutcome.value : null;
    const blocked: string[] = evaluation
      ? []
      : ["message" in evaluationOutcome ? evaluationOutcome.message : "تعذر تقييم الفرصة."];
    if (sourceFreshness(row) !== "حديث")
      blocked.push("المصدر غير حديث أو غير متاح");
    if (row.meta.verified !== true) blocked.push("لا يوجد تحقق من المصدر");
    if (row.meta.rightsVerified !== true)
      blocked.push("حقوق الملكية/المنتج غير مثبتة");
    if (row.meta.eligibilityVerified !== true)
      blocked.push("الأهلية أو الترخيص غير مثبت");
    if (!evaluation || evaluation.conditional || !evaluation.suitable)
      blocked.push("الملاءمة ليست جاهزة بلا شرط");
    if (blocked.length) {
      const nextMessage = `امتنع الانتقال: ${blocked.join("؛ ")}. لا يمكن تخطي التحقق ولا يوجد شراء أو تمويل أو تحويل أموال.`;
      setMessage(nextMessage);
      log("امتناع عن انتقال فرصة للتنفيذ", nextMessage);
      return;
    }
    patch("opportunities", row.id, {
      status: "قيد تجهيز التنفيذ البشري",
      meta: { ...row.meta, executionRequested: true },
    });
    const taskExists = list("tasks").some(
      task => hunterMeta(task, "sourceIdeaId") === `hunter-execution:${row.id}`
    );
    if (!taskExists) {
      add("tasks", {
        title: `تحقق بشري قبل تنفيذ: ${row.title}`,
        subtitle: "مهمة متابعة محلية؛ لا تفويض شراء أو تمويل أو دفع.",
        portfolioId,
        status: "بانتظار مراجعة بشرية",
        amountMinor: 0,
        meta: {
          recordType: HUNTER_EXECUTION_TASK_RECORD_TYPE,
          sourceIdeaId: `hunter-execution:${row.id}`,
          opportunityId: row.id,
          sourcePlanId: activeBrief.sourcePlanId,
          profileId,
        },
      });
    }
    const nextMessage =
      "سُجل طلب انتقال ومهمة تحقق بشرية محلية فقط. لا شراء ولا توقيع ولا اقتراض ولا تحويل أموال.";
    setMessage(nextMessage);
    log("طلب انتقال فرصة للتنفيذ", nextMessage);
  };

  const currentStressError = stressError(stress);
  const comparison = useMemo(() => {
    if (currentStressError) return { rows: [], error: currentStressError };
    const rows: Array<{ row: DemoEntity; base: ReturnType<typeof calculateDeal>; conservative: ReturnType<typeof stressDeal> }> = [];
    for (const row of selectedRows) {
      const base = safeDeal(row);
      const conservative = safeEngine(() => stressDeal(dealFromEntity(row), {
        saleDeclinePercent: Number(stress.saleDeclinePercent),
        developmentIncreasePercent: Number(stress.developmentIncreasePercent),
        delayMonths: Number(stress.delayMonths),
        financingRejected: stress.financingRejected,
      }));
      if (!base.ok || !conservative.ok)
        return {
          rows: [],
          error: !base.ok && "message" in base
            ? base.message
            : ("message" in conservative ? conservative.message : "تعذر حساب المقارنة."),
        };
      rows.push({ row, base: base.value, conservative: conservative.value });
    }
    return { rows, error: null as string | null };
  }, [selectedRows, stress, currentStressError]);
  const comparisonRows = comparison.rows;
  const activeDeal = activeRow ? safeDeal(activeRow) : null;
  const activeEvaluation = activeRow ? safeEvaluation(activeRow, activeBrief) : null;
  const activeDealResult = activeDeal?.ok ? activeDeal.value : null;
  const activeEvaluationResult = activeEvaluation?.ok
    ? activeEvaluation.value
    : null;

  return (
    <div className="section-stack hunter-page">
      <PageHeader
        eyebrow="قناص الفرص · محاكاة محلية"
        title="قناص الفرص"
        description="تدفق رصد وحسبة وملاءمة قابل للتدقيق. لا يوجد بحث سوق حي أو شراء أو تمويل أو تحويل أموال تلقائي."
      >
        <button
          className="btn-primary"
          type="button"
          onClick={runScan}
          disabled={!canEdit}
        >
          <RefreshCw size={16} /> محاكاة المسح
        </button>
      </PageHeader>
      <DemoNotice mode="simulation">
        الاستيراد التالي fixtures ثابتة داخل التطبيق وموسومة «مرجع تجريبي».
        المسح اليومي المرغوب غير مفعّل الآن، ولا توجد مصادر خارجية أو جدولة
        خلفية.
      </DemoNotice>

      <div className="hunter-scope-bar">
        <label className="form-label">
          <span>المحفظة المختارة للموجز والفرص</span>
          <select
            className="field"
            value={portfolioId}
            onChange={event => setPortfolioId(event.target.value)}
            disabled={!canEdit}
          >
            {portfolios.map(portfolio => (
              <option value={portfolio.id} key={portfolio.id}>
                {portfolio.title}
              </option>
            ))}
          </select>
        </label>
        <div className="hunter-scope-note">
          <strong>
            {advisorProfile ? "ملف مستشار مرتبط" : "لا يوجد ملف مستشار محفوظ"}
          </strong>
          <span>
            {advisorProfile
              ? `الربط: ${advisorProfile.title}`
              : "سيُستخدم ملف افتراضي تجريبي معلن فقط حتى يُنشأ التشخيص."}
          </span>
          {!advisorProfile && <a href="/growth">انتقل إلى المستشار العقاري</a>}
        </div>
        {!canEdit && <Badge tone="amber">قراءة فقط · لا تحفظ الإجراءات</Badge>}
      </div>

      <TabBar
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "list", label: "قائمة الفرص" },
          {
            key: "compare",
            label: `المقارنة والحساسية (${selectedRows.length})`,
          },
          { key: "brief", label: "موجز البحث" },
        ]}
      />

      {activeTab === "list" && (
        <>
          <div className="hunter-pipeline" aria-label="نتيجة خط أنابيب المسح">
            {[
              ["رُصد", scan?.detected ?? 0, "detected"],
              ["مكرر", scan?.deduplicated ?? 0, "dedup"],
              ["قديم/غير متاح", scan?.old ?? 0, "old"],
              ["يحتاج بيانات", scan?.missing ?? 0, "missing"],
              ["دخل الفرز", scan?.screened ?? 0, "screened"],
            ].map(([label, value, key]) => (
              <div className="hunter-pipeline-step" key={String(key)}>
                <span>{label}</span>
                <strong className="number">{value}</strong>
              </div>
            ))}
          </div>
          <Panel
            title="سجل الفرص المرصودة"
            description="ابحث وصفِّ الفرص ضمن محفظة واحدة. اختر ما تريد مقارنته ثم افتح التفاصيل لفهم الفرض والدليل والنواقص."
          >
            <div className="hunter-filters">
              <label className="form-label hunter-search">
                <span>بحث</span>
                <input
                  className="field"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="اسم الفرصة أو نوعها أو البلد"
                />
              </label>
              <label className="form-label">
                <span>النوع</span>
                <select
                  className="field"
                  value={kindFilter}
                  onChange={event => setKindFilter(event.target.value)}
                >
                  {kindOptions.map(option => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                <span>الحالة</span>
                <select
                  className="field"
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value)}
                >
                  {statusOptions.map(option => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                <span>حداثة المصدر</span>
                <select
                  className="field"
                  value={freshnessFilter}
                  onChange={event => setFreshnessFilter(event.target.value)}
                >
                  <option>الكل</option>
                  <option>حديث</option>
                  <option>قديم</option>
                  <option>غير متاح</option>
                </select>
              </label>
            </div>
            <div className="hunter-table-note">
              <ListFilter size={15} /> {visibleRows.length} من {rows.length}{" "}
              سجلات ضمن المحفظة المختارة · العملة تعرض لكل فرصة ولا تُجمع بين
              العملات.
            </div>
            <EntityTable
              rows={visibleRows}
              empty="لا توجد فرص محفوظة لهذه المحفظة بعد. استخدم «محاكاة المسح» لإدخال العينات الثابتة فقط."
              onRow={row => setActiveId(row.id)}
              columns={[
                {
                  key: "choose",
                  label: "مقارنة",
                  render: row => (
                    <button
                      className={
                        selected.includes(row.id)
                          ? "btn-primary"
                          : "btn-secondary"
                      }
                      type="button"
                      disabled={!canEdit}
                      onClick={event => {
                        event.stopPropagation();
                        toggleSelected(row.id);
                      }}
                    >
                      {selected.includes(row.id) ? "مختارة" : "اختيار"}
                    </button>
                  ),
                },
                {
                  key: "opportunity",
                  label: "الفرصة",
                  render: row => (
                    <div className="table-title">
                      <strong>{row.title}</strong>
                      <span>{hunterMeta(row, "kind")}</span>
                    </div>
                  ),
                },
                {
                  key: "price",
                  label: "الدخول/العملة",
                  render: row =>
                    `${money(hunterMoneyMeta(row, "purchaseMinor"), currencyFor(row))} · ${currencyFor(row)}`,
                },
                {
                  key: "source",
                  label: "المصدر والتاريخ",
                  render: row => (
                    <div className="hunter-cell-stack">
                      <span>{recordedMeta(row, "source")}</span>
                      <small>
                        {`مصدر: ${recordedMeta(row, "sourceDate")} · تحقق: ${recordedMeta(row, "verifiedDate")} · ${sourceFreshness(row)}`}
                      </small>
                    </div>
                  ),
                },
                {
                  key: "status",
                  label: "الحالة",
                  render: row => (
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  ),
                },
              ]}
            />
          </Panel>

          {activeRow && (
            <details className="hunter-details" open>
              <summary>
                <span>
                  <FileSearch size={17} /> تفاصيل القرار: {activeRow.title}
                </span>
                <span className="muted">فتح/إغلاق</span>
              </summary>
              <div className="hunter-details-content">
                <div className="hunter-detail-topline">
                  <Badge tone={statusTone(activeRow.status)}>
                    {activeRow.status}
                  </Badge>
                  <strong>{suitabilityText(activeRow, activeBrief)}</strong>
                </div>
                <div className="hunter-detail-grid">
                  <div>
                    <span>السبب والحسبة الأساسية</span>
                    <strong>
                      دخول{" "}
                      {money(
                        hunterMoneyMeta(activeRow, "purchaseMinor"),
                        currencyFor(activeRow)
                      )} {" "}
                      · نتيجة أساسية{" "}
                      {activeDealResult
                        ? money(activeDealResult.resultMinor, currencyFor(activeRow))
                        : "غير متاحة حتى تصحيح البيانات"}
                    </strong>
                  </div>
                  <div>
                    <span>المصدر والتواريخ المسجلة</span>
                    <strong>
                      {`${recordedMeta(activeRow, "source")} · مصدر: ${recordedMeta(activeRow, "sourceDate")} · تحقق: ${recordedMeta(activeRow, "verifiedDate")} · ${hunterMoneyMeta(activeRow, "evidenceCount")} بند/بنود · ${sourceFreshness(activeRow)}`}
                    </strong>
                  </div>
                  <div>
                    <span>المخاطر</span>
                    <strong>{riskSummary(activeRow, activeBrief)}</strong>
                  </div>
                  <div>
                    <span>التحقق التالي</span>
                    <strong>{nextCheck(activeRow)}</strong>
                  </div>
                  {activeEvaluationResult && (
                    <>
                      <div>
                        <span>مصادر التمويل المؤكدة</span>
                        <strong>
                          نقد {money(activeEvaluationResult.funding.cashSourceMinor, currencyFor(activeRow))}
                          {" · "}معتمد {" "}
                          {money(
                            activeEvaluationResult.funding.appliedConfirmedFinancingMinor,
                            currencyFor(activeRow)
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>تمويل محتمل مشروط</span>
                        <strong>
                          {money(
                            activeEvaluationResult.funding.appliedPotentialFinancingMinor,
                            currencyFor(activeRow)
                          )}
                          {" · "}لا يدخل في العجز المؤكد
                        </strong>
                      </div>
                      <div>
                        <span>العجز المؤكد (نقد + اعتماد فقط)</span>
                        <strong>
                          {money(
                            activeEvaluationResult.funding.fundingGapMinor,
                            currencyFor(activeRow)
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>العجز بعد التمويل المحتمل</span>
                        <strong>
                          {money(
                            activeEvaluationResult.funding.conditionalFundingGapMinor,
                            currencyFor(activeRow)
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>
                          الملاءمة الاقتصادية لهدف {activeEvaluationResult.economicEligibility.goal}
                        </span>
                        <strong>
                          {activeEvaluationResult.economicEligibility.eligible
                            ? "تتحقق مع الشروط المعروضة"
                            : "لا تتحقق وفق المعايير الاقتصادية"}
                        </strong>
                        <small>
                          {activeEvaluationResult.economicEligibility.reasons.join(" · ") ||
                            "لا سبب اقتصادي مكتمل مسجل"}
                        </small>
                      </div>
                      <div>
                        <span>شروط الملاءمة والنواقص</span>
                        <strong>
                          {activeEvaluationResult.economicEligibility.criteria
                            .map(criterion =>
                              `${criterion.label}: ${
                                criterion.met === null
                                  ? "بيانات غير كافية"
                                  : criterion.met
                                    ? "متحقق"
                                    : "غير متحقق"
                              }`
                            )
                            .join(" · ")}
                        </strong>
                        {activeEvaluationResult.economicEligibility.missing.length >
                          0 && (
                          <small>
                            نواقص: {" "}
                            {activeEvaluationResult.economicEligibility.missing.join(
                              " · "
                            )}
                          </small>
                        )}
                      </div>
                      <div>
                        <span>سبب الفرز والنواقص المسجلة</span>
                        <strong>{activeEvaluationResult.reason}</strong>
                        {activeEvaluationResult.missing.length > 0 && (
                          <small>
                            نواقص الفرصة: {" "}
                            {activeEvaluationResult.missing.join(" · ")}
                          </small>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {resultMessage(activeDeal) && (
                  <p className="hunter-message" role="alert">
                    نتيجة الصفقة غير متاحة: {resultMessage(activeDeal)}
                  </p>
                )}
                {resultMessage(activeEvaluation) && (
                  <p className="hunter-message" role="alert">
                    تقييم الملاءمة غير متاح: {resultMessage(activeEvaluation)}
                  </p>
                )}
                <div
                  className="hunter-checklist"
                  aria-label="قائمة تحقق العناية الواجبة"
                >
                  <strong>
                    <ClipboardCheck size={16} /> قائمة تحقق بشرية قبل أي انتقال
                  </strong>
                  <ul>
                    <li>
                      {activeRow.meta.verified === true
                        ? "مصدر راجعه إنسان"
                        : "المصدر: يحتاج إثباتًا أو وثيقة مستقلة"}
                    </li>
                    <li>
                      {activeRow.meta.rightsVerified === true
                        ? "الحقوق موثقة"
                        : "الملكية/الحق/المنتج: يحتاج وثيقة وخبيرًا مختصًا"}
                    </li>
                    <li>
                      {activeRow.meta.eligibilityVerified === true
                        ? "الأهلية موثقة"
                        : "الأهلية والترخيص والاستخدام: يحتاج تحققًا مستقلًا"}
                    </li>
                    <li>
                      التكاليف، نطاق العمل، التمويل، البيع أو الإيجار: مراجعة
                      بشرية قبل قرار العميل.
                    </li>
                  </ul>
                  <p>
                    لا توجد خانة اعتماد قانوني هنا؛ لا يمكن وصف أي حق أو أهلية
                    بأنها معتمدة بلا دليل مستقل.
                  </p>
                </div>
                <div className="hunter-detail-actions">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => transferToExecution(activeRow)}
                    disabled={!canEdit}
                  >
                    <ShieldAlert size={16} /> طلب انتقال للتنفيذ البشري
                  </button>
                  <FormDialog
                    title="إرسال تغذية راجعة إلى المستشار"
                    description="تنشئ ملاحظة محلية مرتبطة بالموجز والفرصة؛ لا ترسل رسالة خارجية ولا تغير قرارًا."
                    disabled={!canEdit}
                    trigger={
                      <button
                        className="btn-secondary"
                        type="button"
                        disabled={!canEdit}
                      >
                        <Send size={16} /> ملاحظة للمستشار
                      </button>
                    }
                    fields={[
                      {
                        key: "reason",
                        label: "سبب الملاحظة",
                        type: "textarea",
                        required: true,
                        placeholder: "ما الذي يحتاج المستشار إلى مراجعته؟",
                      },
                    ]}
                    submitLabel="حفظ الملاحظة محليًا"
                    onSubmit={values => {
                      if (!canEdit) return;
                      add("reviews", {
                        title: `تغذية راجعة قناص: ${activeRow.title}`,
                        subtitle:
                          "ملاحظة محلية للمستشار؛ ليست أمرًا أو توصية شراء.",
                        portfolioId,
                        status: "ملاحظة قيد المراجعة",
                        amountMinor: 0,
                        meta: {
                          recordType: HUNTER_FEEDBACK_RECORD_TYPE,
                          profileId,
                          sourcePlanId: activeBrief.sourcePlanId,
                          briefId: savedBriefRow?.id ?? "غير محفوظ",
                          opportunityId: activeRow.id,
                          reason: values.reason,
                        },
                      });
                      const nextMessage =
                        "حُفظت ملاحظة القناص للمستشار داخل النموذج فقط.";
                      setMessage(nextMessage);
                      log("إرسال تغذية راجعة للقناص", nextMessage);
                    }}
                  />
                </div>
              </div>
            </details>
          )}
        </>
      )}

      {activeTab === "compare" && (
        <>
          <Panel
            title="مقارنة الفرص المختارة"
            description="كل صف يحسب في عملته المسجلة. لا يوجد جمع بين QAR وSAR ولا تحويل سعر صرف مفترض."
          >
            {comparison.error ? (
              <p className="hunter-message" role="alert">
                أصلح مدخلات الضغط أولاً؛ أخفينا نتيجة المقارنة غير المطابقة: {" "}
                {comparison.error}
              </p>
            ) : !comparisonRows.length ? (
              <div className="hunter-empty-compare">
                اختر فرصة واحدة أو أكثر من القائمة. المقارنة تصف النتائج
                الحسابية ولا تصدر توصية أو أمر شراء.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table hunter-comparison-table">
                  <thead>
                    <tr>
                      <th>الفرصة</th>
                      <th>السعر/الدخول</th>
                      <th>التكلفة الأساسية</th>
                      <th>النتيجة الأساسية</th>
                      <th>المدة</th>
                      <th>النقد المطلوب</th>
                      <th>المحافظ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map(({ row, base, conservative }) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.title}</strong>
                          <span className="hunter-table-sub">
                            {currencyFor(row)} · {hunterMeta(row, "country")}
                          </span>
                        </td>
                        <td>
                          {money(
                            hunterMoneyMeta(row, "purchaseMinor"),
                            currencyFor(row)
                          )}
                        </td>
                        <td>{money(base.totalCostMinor, currencyFor(row))}</td>
                        <td>
                          {money(base.resultMinor, currencyFor(row))}
                          <span className="hunter-table-sub">
                            محافظ:{" "}
                            {money(conservative.resultMinor, currencyFor(row))}
                          </span>
                        </td>
                        <td>
                          {base.durationMonths} شهر
                          <span className="hunter-table-sub">
                            محافظ: {conservative.durationMonths} شهر
                          </span>
                        </td>
                        <td>
                          {money(base.cashRequiredMinor, currencyFor(row))}
                        </td>
                        <td>{suitabilityText(row, activeBrief)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <div className="split-layout">
            <Panel
              title="ضغط محافظ افتراضي"
              description="هذه نسب قابلة للتعديل لا توقع سوقي ولا سعر بيع أو تكلفة مستقبلية مؤكدة."
            >
              <div className="hunter-stress-form">
                <label className="form-label">
                  <span>هبوط سعر البيع %</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    value={stress.saleDeclinePercent}
                    aria-invalid={Boolean(
                      currentStressError?.includes("انخفاض البيع")
                    )}
                    onChange={event =>
                      setStress(current => ({
                        ...current,
                        saleDeclinePercent: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="form-label">
                  <span>زيادة التطوير %</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    value={stress.developmentIncreasePercent}
                    aria-invalid={Boolean(
                      currentStressError?.includes("زيادة التطوير")
                    )}
                    onChange={event =>
                      setStress(current => ({
                        ...current,
                        developmentIncreasePercent: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="form-label">
                  <span>تأخر إضافي بالأشهر</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    value={stress.delayMonths}
                    aria-invalid={Boolean(
                      currentStressError?.includes("تأخر المشروع")
                    )}
                    onChange={event =>
                      setStress(current => ({
                        ...current,
                        delayMonths: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="hunter-checkbox">
                  <input
                    type="checkbox"
                    checked={stress.financingRejected}
                    onChange={event =>
                      setStress(current => ({
                        ...current,
                        financingRejected: event.target.checked,
                      }))
                    }
                  />{" "}
                  رفض تمويل افتراضي
                </label>
              </div>
              {currentStressError && (
                <p className="hunter-message" role="alert">
                  {currentStressError}. احتفظنا بالمسودة ولم نستخدم نتيجة سابقة.
                </p>
              )}
              <p className="muted small">
                الإعداد الحالي: بيع −{numberFromText(stress.saleDeclinePercent)}
                %، تطوير +{numberFromText(stress.developmentIncreasePercent)}%،
                تأخر +{numberFromText(stress.delayMonths)} شهر. التمويل المحتمل
                ليس موافقة.
              </p>
            </Panel>
            <Panel
              title="حدود نتيجة الحسبة"
              description="تستخدم الحسبة كل بنود الكلفة المخزنة بوحدة العملة الصغرى، لكنها لا تثبت صحة المدخلات."
            >
              <div className="hunter-calculation-note">
                <BadgeCheck size={18} />
                <div>
                  <strong>الأساس مقابل المحافظ</strong>
                  <span>
                    مثال الشحانية يحافظ على 700 ألف هامش أولي قبل التكاليف
                    الإضافية، و650 ألف فقط مع فرض 50 ألف؛ ليس ربحًا سنويًا أو
                    عرض سوق.
                  </span>
                </div>
              </div>
              <div className="hunter-calculation-note hunter-warning">
                <SlidersHorizontal size={18} />
                <div>
                  <strong>القرار يبقى بشريًا</strong>
                  <span>
                    لا تزيل الحسبة نقص الحقوق أو الأهلية أو التمويل، ولا تفعّل
                    شراءً أو تحويلًا أو جدولة سوق.
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}

      {activeTab === "brief" && (
        <>
          <Panel
            title="موجز بحث القناص"
            description="يحفظ داخل خطة المحفظة المحددة كسجل hunter-brief. التمويل المحتمل والمعتمد يظهران منفصلين؛ لا يتحولان إلى نقد أو موافقة."
            action={
              savedBrief ? (
                <Badge tone="green">موجز محفوظ محليًا</Badge>
              ) : (
                <Badge tone="amber">افتراضي تجريبي غير محفوظ</Badge>
              )
            }
          >
            <div className="hunter-brief-form">
              <label className="form-label">
                <span>النقد المخصص ({"ر.ق"})</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={briefForm.cashBudget}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      cashBudget: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="form-label">
                <span>تمويل محتمل غير مؤكد ({"ر.ق"})</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={briefForm.potentialFinancing}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      potentialFinancing: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="form-label">
                <span>تمويل معتمد فقط ({"ر.ق"})</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={briefForm.approvedFinancing}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      approvedFinancing: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="form-label">
                <span>الهدف</span>
                <select
                  className="field"
                  value={briefForm.goal}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      goal: event.target.value as AdvisorGoal,
                    }))
                  }
                >
                  {GOALS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                <span>المخاطرة</span>
                <select
                  className="field"
                  value={briefForm.risk}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      risk: event.target.value as RiskLevel,
                    }))
                  }
                >
                  {RISKS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                <span>المدة القصوى (شهر)</span>
                <input
                  className="field"
                  inputMode="numeric"
                  value={briefForm.maxMonths}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      maxMonths: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="form-label">
                <span>البلد</span>
                <input
                  className="field"
                  value={briefForm.country}
                  disabled={!canEdit}
                  onChange={event =>
                    setBriefForm(current => ({
                      ...current,
                      country: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="hunter-brief-footer">
              <span>
                الملف المرتبط:{" "}
                {advisorProfile?.title ?? "المستشار الافتراضي التجريبي"} ·
                المحفظة:{" "}
                {portfolios.find(row => row.id === portfolioId)?.title ??
                  portfolioId}
              </span>
              <button
                className="btn-primary"
                type="button"
                onClick={saveBrief}
                disabled={!canEdit}
              >
                حفظ موجز البحث
              </button>
            </div>
          </Panel>
          <div className="stats-grid hunter-brief-stats">
            <Metric
              label="نقد مخصص"
              value={money(activeBrief.cashBudgetMinor)}
              detail="يدخل كمبلغ صحيح بوحدة صغرى"
            />
            <Metric
              label="تمويل محتمل"
              value={money(activeBrief.potentialFinancingMinor)}
              detail="ليس سيولة مؤكدة"
            />
            <Metric
              label="تمويل معتمد"
              value={money(activeBrief.approvedFinancingMinor)}
              detail="يبقى مرتبطًا بشروطه"
            />
            <Metric
              label="المدة/البلد"
              value={`${activeBrief.maxMonths} شهر`}
              detail={activeBrief.country}
            />
          </div>
        </>
      )}

      <div className="hunter-message" role="status">
        {message}
      </div>
    </div>
  );
}
