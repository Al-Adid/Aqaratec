import { useMemo, useState } from "react";
import {
  Building2,
  CircleAlert,
  ClipboardList,
  Landmark,
  ReceiptText,
  Sparkles,
  TrendingDown,
  Wrench,
} from "lucide-react";
import { money } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  Badge,
  DemoNotice,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import {
  buildPortfolioInsights,
  calculateStressScenario,
  type InsightIdea,
  type InsightKind,
} from "@/lib/portfolio-insights";

const IDEA_FILTERS: Array<{ key: "الكل" | InsightKind; label: string }> = [
  { key: "الكل", label: "كل الأفكار" },
  { key: "سيولة", label: "السيولة" },
  { key: "تحصيل", label: "التحصيل" },
  { key: "صيانة", label: "الصيانة" },
  { key: "شغور", label: "الشغور" },
  { key: "إيجار", label: "الإيجار" },
  { key: "تطوير", label: "التطوير" },
];

function toneForPriority(priority: InsightIdea["priority"]) {
  return priority === "عاجلة" ? "red" : priority === "عالية" ? "amber" : "blue";
}

function actionForIdea(idea: InsightIdea) {
  if (idea.kind === "تحصيل")
    return {
      label: "فتح الاستحقاقات",
      href: "/collections",
      icon: <ReceiptText size={15} />,
    };
  if (["صيانة", "شغور", "تطوير"].includes(idea.kind))
    return {
      label: "فتح الصيانة",
      href: "/maintenance",
      icon: <Wrench size={15} />,
    };
  if (idea.propertyId)
    return {
      label: "فتح العقار",
      href: `/properties/${idea.propertyId}`,
      icon: <Building2 size={15} />,
    };
  return {
    label: "فتح المحفظة",
    href: "/properties",
    icon: <Landmark size={15} />,
  };
}

/** صفحة لوحة التحليلات؛ يربطها المضيف على /insights. */
export function PortfolioInsightsPage() {
  const { state, filtered, list, add, canEdit, financials } = usePrototype();
  const [kindFilter, setKindFilter] = useState<"الكل" | InsightKind>("الكل");
  const [rentReductionPercent, setRentReductionPercent] = useState(10);
  const [expenseIncreasePercent, setExpenseIncreasePercent] = useState(10);
  const [message, setMessage] = useState(
    "اختر فكرة لقراءة مصدرها وخطوتها التالية. لا ينفذ أي زر صرفاً أو تسعيراً أو قراراً نظامياً."
  );

  const analysis = useMemo(
    () =>
      buildPortfolioInsights({
        entities: state.entities,
        portfolioId: state.settings.portfolioId,
        period: state.settings.period,
      }),
    [state.entities, state.settings.period, state.settings.portfolioId]
  );
  const visibleIdeas = useMemo(
    () =>
      analysis.ideas.filter(
        idea => kindFilter === "الكل" || idea.kind === kindFilter
      ),
    [analysis.ideas, kindFilter]
  );
  const scopedProperties = filtered("properties");
  const scopedTasks = filtered("tasks");
  const allTasks = list("tasks");
  const portfolios = list("portfolios");
  const createdIdeaIds = useMemo(
    () =>
      new Set(
        allTasks
          .map(task => task.meta.sourceIdeaId)
          .filter((id): id is string => typeof id === "string")
      ),
    [allTasks]
  );
  const portfolioLabel =
    state.settings.portfolioId === "all"
      ? "كل المحافظ"
      : (portfolios.find(row => row.id === state.settings.portfolioId)?.title ??
        "المحفظة الحالية");
  const stress = useMemo(
    () =>
      calculateStressScenario({
        expectedMinor: financials.expectedMinor,
        incomeMinor: financials.incomeMinor,
        expenseMinor: financials.expenseMinor,
        rentReductionPercent,
        expenseIncreasePercent,
      }),
    [
      expenseIncreasePercent,
      financials.expectedMinor,
      financials.expenseMinor,
      financials.incomeMinor,
      rentReductionPercent,
    ]
  );

  const createReviewTask = (idea: InsightIdea) => {
    if (!canEdit) {
      setMessage(
        "معاينة القارئ تعرض الفكرة فقط؛ اختر دور الموظف لإنشاء مهمة مراجعة محلية."
      );
      return;
    }
    if (createdIdeaIds.has(idea.id)) {
      setMessage(
        "توجد مهمة مراجعة منشأة لهذه الفكرة بالفعل؛ لن يكرر البروتوتايب السجل."
      );
      return;
    }
    try {
      add("tasks", {
        title: `مراجعة فكرة: ${idea.title}`,
        subtitle: "مهمة مراجعة محلية مولّدة من تحليل بروتوتايب خيالي",
        portfolioId: idea.portfolioId,
        propertyId: idea.propertyId,
        status: "مفتوح",
        amountMinor: 0,
        meta: {
          sourceIdeaId: idea.id,
          sourceKind: idea.kind,
          sourceRecordIds: idea.sourceRecordIds.join(","),
          evidenceQuality: idea.evidenceQuality,
          nextStep: idea.nextStep,
          simulationOnly: true,
        },
      });
      setMessage(
        `أُنشئت مهمة مراجعة محلية للفكرة «${idea.title}»؛ لا تغيّر مالاً أو سعراً أو اعتماداً.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر إنشاء مهمة المراجعة."
      );
    }
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="تحليل المحفظة · قواعد محلية"
        title="تحليلات واقتراحات المحفظة"
        description={`نطاق العرض: ${portfolioLabel} · فترة ${state.settings.period}. أفكار قابلة للتفسير من بيانات البروتوتايب فقط، وليست توصية استثمارية أو توقع سوقي.`}
      >
        <a className="btn-secondary" href="/roadmap">
          <ClipboardList size={16} /> فهرس خدمات النظام
        </a>
      </PageHeader>
      <DemoNotice mode="interactive">
        يحلل المحرك نسخة التجربة الحالية بقواعد محلية، وجميع عينات السوق خيالية.
        لا اتصال بسوق خارجي ولا LLM؛ لا تمثل الأرقام توقعاً أو عرضاً حقيقياً.
      </DemoNotice>

      <div className="stats-grid">
        <Metric
          label="سيولة متاحة بعد الاحتياط والالتزامات"
          value={money(analysis.financials.availableDrawMinor)}
          detail="تقدير من السجل الداخلي، وليس رصيد بنك مؤكد"
          icon={<Landmark size={18} />}
        />
        <Metric
          label="مطالبات غير محصلة"
          value={money(analysis.financials.outstandingMinor)}
          detail="قابلة للمتابعة؛ ليست نقداً محصلاً"
          icon={<ReceiptText size={18} />}
        />
        <Metric
          label="عقارات في النطاق"
          value={String(scopedProperties.length)}
          detail={`أفكار قابلة للعرض: ${analysis.ideas.length}`}
          icon={<Building2 size={18} />}
        />
        <Metric
          label="مهام مراجعة في النطاق"
          value={String(scopedTasks.length)}
          detail="لا يتكرر مصدر الفكرة في مهمة ثانية"
          icon={<ClipboardList size={18} />}
        />
      </div>

      <div className="split-layout">
        <Panel
          title="القيم المحققة الحالية"
          description="قيم الدخل والمصروف أدناه من الفترة المحددة فقط، وتبقى منفصلة عن الاستحقاق المتوقع والمحاكاة."
        >
          <div className="mini-list">
            <div>
              <strong>دخل محصل/محقق في الفترة</strong>
              <span>{money(financials.incomeMinor)}</span>
            </div>
            <div>
              <strong>استحقاق متوقع مسجل</strong>
              <span>{money(financials.expectedMinor)} · ليس دخلاً محققاً</span>
            </div>
            <div>
              <strong>مصروف مدفوع في الفترة</strong>
              <span>{money(financials.expenseMinor)}</span>
            </div>
            <div>
              <strong>احتياطي مسجل</strong>
              <span>
                {money(financials.reserveMinor)} · التزام قادم داخل حساب السيولة
              </span>
            </div>
          </div>
        </Panel>
        <Panel
          title={analysis.priceEvidence.title}
          description="بطاقة امتناع، لا بطاقة تنبؤ."
          action={<CircleAlert size={18} />}
        >
          <p className="muted">{analysis.priceEvidence.detail}</p>
          <Badge tone="amber">لا توقع سعر ولا اتجاه نزول</Badge>
          <p className="muted small">
            لا تُفسَّر عينة الإيجار الخيالية كاتجاه سوق أو كدليل على انخفاض أو
            ارتفاع الأسعار.
          </p>
        </Panel>
      </div>

      <Panel
        title="محاكي ضغط افتراضي"
        description="منفصل عن الاقتراحات والقيم المحققة: خفّض الإيجار أو ارفع المصروفات بين 0% و30% لرؤية أثر حسابي محافظ بوحدات العملة الصغرى."
        action={<TrendingDown size={18} />}
      >
        <div className="form-grid">
          <label>
            انخفاض إيجار افتراضي: {rentReductionPercent}%
            <input
              className="field"
              type="range"
              min="0"
              max="30"
              step="1"
              value={rentReductionPercent}
              onChange={event =>
                setRentReductionPercent(Number(event.target.value))
              }
            />
          </label>
          <label>
            ارتفاع مصروفات افتراضي: {expenseIncreasePercent}%
            <input
              className="field"
              type="range"
              min="0"
              max="30"
              step="1"
              value={expenseIncreasePercent}
              onChange={event =>
                setExpenseIncreasePercent(Number(event.target.value))
              }
            />
          </label>
        </div>
        {!stress.safe ? (
          <p className="muted">{stress.error}</p>
        ) : (
          <div className="stats-grid compact-stats">
            <Metric
              label="استحقاق متوقع بعد الضغط"
              value={money(stress.stressedExpectedMinor)}
              detail={`انخفاض افتراضي ${money(stress.expectedRentReductionMinor)}`}
            />
            <Metric
              label="دخل محقق للمقارنة بعد الضغط"
              value={money(stress.stressedIncomeMinor)}
              detail={`أثر افتراضي ${money(stress.incomeReductionMinor)}`}
            />
            <Metric
              label="مصروف بعد الضغط"
              value={money(stress.stressedExpenseMinor)}
              detail={`زيادة افتراضية ${money(stress.expenseIncreaseMinor)}`}
            />
            <Metric
              label="أثر صافٍ افتراضي"
              value={money(stress.netImpactMinor)}
              detail={`الصافي: ${money(stress.currentNetMinor)} ← ${money(stress.stressedNetMinor)}`}
            />
          </div>
        )}
        <p className="muted small">
          هذه عملية ضغط افتراضية لا تتنبأ بسوق أو تحصيل أو مصروف مستقبلي، ولا
          تغيّر أي رقم محقق في السجل.
        </p>
      </Panel>

      <Panel
        title="أفكار المراجعة القابلة للتفسير"
        description="كل فكرة تظهر سببها ومصدر سجل النموذج والأثر المحتمل وجودة الدليل والخطوة التالية. مرشح المحفظة الحالي مطبق تلقائياً."
      >
        <TabBar
          items={IDEA_FILTERS}
          value={kindFilter}
          onChange={key => setKindFilter(key as "الكل" | InsightKind)}
        />
        <p className="muted" role="status" aria-live="polite">
          {message}
        </p>
        {!visibleIdeas.length ? (
          <EmptyState
            title="لا توجد أفكار من هذا النوع في نطاق المحفظة الحالية"
            description="جرّب نوع فكرة آخر أو غيّر مرشح المحفظة من لوحة التطبيق."
          />
        ) : (
          <div className="card-grid portfolio-insights-grid">
            {visibleIdeas.map(idea => {
              const action = actionForIdea(idea);
              const taskExists = createdIdeaIds.has(idea.id);
              return (
                <article
                  className="entity-card portfolio-insight-card"
                  key={idea.id}
                >
                  <div className="entity-card__top">
                    <span className="mini-label">
                      {idea.scope} · {idea.kind}
                    </span>
                    <Badge tone={toneForPriority(idea.priority)}>
                      {idea.priority}
                    </Badge>
                  </div>
                  <h3>{idea.title}</h3>
                  <div className="mini-list">
                    <div>
                      <strong>السبب</strong>
                      <span>{idea.reason}</span>
                    </div>
                    <div>
                      <strong>مصدر سجل النموذج</strong>
                      <span>{idea.modelSource}</span>
                    </div>
                    <div>
                      <strong>الأثر المحتمل</strong>
                      <span>
                        {idea.potentialImpactMinor !== undefined
                          ? `${money(idea.potentialImpactMinor)} · `
                          : ""}
                        {idea.potentialImpactNote}
                      </span>
                    </div>
                    <div>
                      <strong>جودة الدليل</strong>
                      <span>{idea.evidenceQuality}</span>
                    </div>
                    <div>
                      <strong>الخطوة التالية</strong>
                      <span>{idea.nextStep}</span>
                    </div>
                  </div>
                  <p className="muted small">
                    معرّف مصدر ثابت: <code>{idea.id}</code> · سجلات:{" "}
                    {idea.sourceRecordIds.join("، ") || "ملخص الفترة"}
                  </p>
                  <div className="action-row">
                    <a className="btn-secondary" href={action.href}>
                      {action.icon} {action.label}
                    </a>
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={!canEdit || taskExists}
                      onClick={() => createReviewTask(idea)}
                    >
                      <Sparkles size={16} />{" "}
                      {taskExists
                        ? "مهمة مراجعة موجودة"
                        : "حوّل إلى مهمة للمراجعة"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default PortfolioInsightsPage;
