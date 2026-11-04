import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CircleGauge,
  FileText,
  Goal,
  Plus,
  Scale,
  TrendingUp,
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
import {
  ChartPanel,
  EvidenceNotice,
  LocalOnly,
  MARKET_SAMPLES,
  StatusLine,
  calculateGrowth,
  entityInput,
  mergeRows,
  meta,
  money,
  parseMinor,
  summarizeRent,
} from "./DecisionShared";

const WIZARD_STEPS = [
  { key: "goal", label: "1. الهدف" },
  { key: "resources", label: "2. الموارد" },
  { key: "risk", label: "3. المخاطر" },
  { key: "plan", label: "4. الخطة" },
];

export function MarketPage() {
  const { filtered, add, log, canEdit } = usePrototype();
  const [area, setArea] = useState("الكل");
  const [evidenceType, setEvidenceType] = useState("الكل");
  const [target, setTarget] = useState("9000");
  const [threshold, setThreshold] = useState("8500");
  const [reportResult, setReportResult] = useState(
    "لم يُنشر تقرير بعد؛ أي نتيجة ستبقى معاينة محلية مقيدة."
  );
  const rows = mergeRows(MARKET_SAMPLES, filtered("comparables"));
  const areas = [
    "الكل",
    ...new Set(rows.map(row => meta(row, "area", "غير محدد"))),
  ];
  const evidenceTypes = ["الكل", "إعلان", "عقد", "صفقة"];
  const visibleRows = rows.filter(
    row =>
      (area === "الكل" || meta(row, "area") === area) &&
      (evidenceType === "الكل" || meta(row, "evidenceType") === evidenceType)
  );
  const summary = summarizeRent(visibleRows);
  const targetMinor = parseMinor(target).value;
  const thresholdMinor = parseMinor(threshold).value;
  const chartData = visibleRows.map(row => ({
    name: row.date.slice(5),
    rent: row.amountMinor,
  }));

  const publishLocalReport = () => {
    if (!summary || !targetMinor || !thresholdMinor) {
      const message =
        "لا يمكن إنشاء التقرير: أضف هدفاً وعتبة صالحين واختر عينة قابلة للقراءة.";
      setReportResult(message);
      log("امتناع عن تقرير سوق", message);
      return;
    }
    const message = summary.missingEvidence
      ? "أُنشئت معاينة تقرير مقيد مع فجوة دليل: لا توجد عينة عقد أو صفقة كافية؛ لا توجد توصية إيجار."
      : `أُنشئت معاينة تقرير محلي. منتصف العينة ${money(summary.middleMinor)} مقابل هدف ${money(targetMinor)}، دون توصية أو نشر خارجي.`;
    setReportResult(message);
    log("إنشاء معاينة تقرير سوق", message);
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F27 · سوق الإيجار"
        title="تقرير الإيجار والمنطقة"
        description="عينات صورية واضحة الدليل والتاريخ؛ لا تُخلط الإعلانات بالعقود أو الصفقات، ولا توجد بيانات سوق قطرية مؤكدة هنا."
      />
      <DemoNotice mode="interactive">
        العينة مصطنعة داخل النموذج. لا تمثل RentCast أو أي مزود بيانات في قطر،
        ولا تصلح كقيمة تسعير فعلية.
      </DemoNotice>

      <div className="split-layout">
        <Panel
          title="نطاق العينة"
          description="فلتر المنطقة ونوع الدليل قبل النظر إلى أي رقم."
        >
          <div className="form-grid">
            <label>
              المنطقة
              <select
                className="field"
                value={area}
                onChange={event => setArea(event.target.value)}
              >
                {areas.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              نوع الدليل
              <select
                className="field"
                value={evidenceType}
                onChange={event => setEvidenceType(event.target.value)}
              >
                {evidenceTypes.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              هدف الإيجار ر.ق
              <input
                className="field"
                value={target}
                inputMode="decimal"
                onChange={event => setTarget(event.target.value)}
              />
            </label>
            <label>
              عتبة التنبيه ر.ق
              <input
                className="field"
                value={threshold}
                inputMode="decimal"
                onChange={event => setThreshold(event.target.value)}
              />
            </label>
          </div>
          <StatusLine tone="blue">
            {visibleRows.length} عينة ظاهرة · نطاقها{" "}
            {area === "الكل" ? "متعدد المناطق" : area}
          </StatusLine>
        </Panel>
        <Panel
          title="حدود التقرير"
          description="تعرض هذه الشاشة الفرق بين نوع الدليل، ولا تستنتج سعراً أو عائداً مضموناً."
        >
          <div className="mini-list">
            <div>
              <strong>إعلان</strong>
              <span>سعر معروض، وليس عقداً أو صفقة.</span>
            </div>
            <div>
              <strong>عقد</strong>
              <span>عينة صورية مؤرخة، لا إثبات سوقي مستقل.</span>
            </div>
            <div>
              <strong>صفقة</strong>
              <span>نوع دليل منفصل ولا يُخلط مع الإعلان.</span>
            </div>
          </div>
          <LocalOnly>
            لا توجد واجهة موصل أو بحث خارجي أو إسناد لبيانات قطرية حقيقية.
          </LocalOnly>
        </Panel>
      </div>

      <div className="stats-grid">
        <Metric
          label="أدنى العينة"
          value={summary ? money(summary.minMinor) : "-"}
          detail="قيمة شهرية صورية"
          icon={<Scale size={18} />}
        />
        <Metric
          label="منتصف العينة"
          value={summary ? money(summary.middleMinor) : "-"}
          detail="منتصف حسابي بسيط"
          icon={<BarChart3 size={18} />}
        />
        <Metric
          label="أعلى العينة"
          value={summary ? money(summary.maxMinor) : "-"}
          detail="قيمة شهرية صورية"
          icon={<TrendingUp size={18} />}
        />
        <Metric
          label="الهدف / العتبة"
          value={
            targetMinor
              ? `${money(targetMinor)} / ${thresholdMinor ? money(thresholdMinor) : "-"}`
              : "مدخل غير صالح"
          }
          detail="لا يساوي توصية"
          icon={<CircleGauge size={18} />}
        />
      </div>

      <div className="split-layout">
        <Panel
          title="مقارنات العينة"
          description="لكل صف منطقة وتاريخ ومصدر وحق استخدام ونوع دليل ظاهر."
          action={
            <FormDialog
              title="إضافة مقارنة صورية"
              description="لا تضف بيانات شخصية أو سوقية حقيقية إلى النموذج."
              trigger={
                <button className="btn-secondary" disabled={!canEdit}>
                  <Plus size={16} /> إضافة عينة
                </button>
              }
              fields={[
                { key: "title", label: "وصف المقارنة", required: true },
                { key: "area", label: "المنطقة", required: true },
                {
                  key: "evidenceType",
                  label: "نوع الدليل",
                  type: "select",
                  required: true,
                  options: [
                    { value: "إعلان", label: "إعلان" },
                    { value: "عقد", label: "عقد" },
                    { value: "صفقة", label: "صفقة" },
                  ],
                },
                {
                  key: "amount",
                  label: "إيجار شهري ر.ق",
                  type: "number",
                  required: true,
                },
                {
                  key: "date",
                  label: "تاريخ الدليل",
                  type: "date",
                  required: true,
                },
              ]}
              submitLabel="حفظ العينة محلياً"
              onSubmit={values => {
                if (!canEdit) {
                  setReportResult(
                    "معاينة القراءة لا تحفظ عينات جديدة. اختر دور المشغّل لتجربة التسجيل."
                  );
                  return;
                }
                const parsed = parseMinor(values.amount);
                if (parsed.error || parsed.value === undefined) {
                  setReportResult(parsed.error ?? "مبلغ غير صالح");
                  return;
                }
                add(
                  "comparables",
                  entityInput(values.title, {
                    portfolioId: "market",
                    date: values.date,
                    amountMinor: parsed.value,
                    status: "وارد يحتاج مراجعة",
                    subtitle: "عينة صورية أضافها المستخدم في البروتوتايب",
                    meta: {
                      area: values.area,
                      evidenceType: values.evidenceType,
                      source: "إدخال تجربة محلي",
                      rights: "غير متحقق",
                    },
                  })
                );
                const message = `أُضيفت مقارنة صورية من نوع ${values.evidenceType} بتاريخ ${values.date}.`;
                setReportResult(message);
                log("إضافة مقارنة إيجار", message);
              }}
            />
          }
        >
          <EntityTable
            rows={visibleRows}
            empty="لا توجد عينات مطابقة لهذا النطاق."
            columns={[
              {
                key: "sample",
                label: "العينة",
                render: row => <strong>{row.title}</strong>,
              },
              {
                key: "evidence",
                label: "الدليل",
                render: row => (
                  <Badge
                    tone={
                      meta(row, "evidenceType") === "إعلان" ? "amber" : "blue"
                    }
                  >
                    {meta(row, "evidenceType")}
                  </Badge>
                ),
              },
              {
                key: "place",
                label: "المنطقة / التاريخ",
                render: row => `${meta(row, "area")} · ${row.date}`,
              },
              {
                key: "amount",
                label: "الإيجار",
                render: row => money(row.amountMinor),
              },
              {
                key: "source",
                label: "المصدر/الحق",
                render: row =>
                  `${meta(row, "source")} · ${meta(row, "rights")}`,
              },
            ]}
          />
        </Panel>
        <ChartPanel
          title="قيم العينة الظاهرة"
          description="رسم مبني على العينة المحلية المختارة فقط، لا اتجاه سوقي خارجي."
          data={chartData}
          dataKey="rent"
          format={value => money(value)}
        />
      </div>

      <Panel
        title="جودة الدليل والتنبيه"
        description="النقص لا يتحول إلى سعر مفترض؛ يظهر كسبب امتناع عن توصية."
      >
        <EvidenceNotice complete={Boolean(summary && !summary.missingEvidence)}>
          {summary?.missingEvidence
            ? "نقص دليل: لا تتوافر في النطاق عينة عقد وصفقة معاً. سيبقى التقرير مقيداً بلا توصية."
            : "يوجد تنوع في نوع الدليل، لكنه ما زال عينة صورية محدودة."}
        </EvidenceNotice>
        <p className="muted">
          التركيب:{" "}
          {summary
            ? Object.entries(summary.evidence)
                .map(([type, count]) => `${type}: ${count}`)
                .join(" · ")
            : "لا عينات"}
          .{" "}
          {summary && thresholdMinor && summary.middleMinor < thresholdMinor
            ? "منتصف العينة تحت العتبة، تنبيه محلي فقط."
            : "لا تنبيه عتبة من العينة الظاهرة."}
        </p>
        <button className="btn-primary" onClick={publishLocalReport}>
          <FileText size={16} /> إنشاء معاينة تقرير مقيد
        </button>
        <p className="muted">{reportResult}</p>
      </Panel>
    </div>
  );
}

export function GrowthPage() {
  const { list, add, log, canEdit } = usePrototype();
  const [step, setStep] = useState("goal");
  const [goal, setGoal] = useState("12000");
  const [resources, setResources] = useState("180000");
  const [living, setLiving] = useState("8500");
  const [monthlySavings, setMonthlySavings] = useState("2500");
  const [possibleFunding, setPossibleFunding] = useState("0");
  const [risk, setRisk] = useState(
    "لا توجد سيولة إضافية مؤكدة، وتحتاج الفرضيات إلى مراجعة شهرية."
  );
  const [evidenceReady, setEvidenceReady] = useState(false);
  const [result, setResult] = useState<ReturnType<
    typeof calculateGrowth
  > | null>(null);
  const [message, setMessage] = useState(
    "ابدأ بتشخيص المدخلات. الحساب محلي وحتمي، وليس مستشاراً ذكياً أو وعداً بعائد."
  );
  const [editReason, setEditReason] = useState(
    "تغير افتراض السيولة بعد مراجعة شهرية."
  );
  const plans = list("plans");
  const reviews = list("reviews");

  const parsed = useMemo(
    () => ({
      goal: parseMinor(goal),
      resources: parseMinor(resources),
      living: parseMinor(living),
      savings: parseMinor(monthlySavings),
      funding: parseMinor(possibleFunding),
    }),
    [goal, resources, living, monthlySavings, possibleFunding]
  );
  const ready = Object.values(parsed).every(item => item.value !== undefined);

  const calculate = () => {
    if (!ready) {
      setMessage(
        "تحقق من كل مبلغ: يقبل النموذج مبلغاً موجباً بمنزلتين عشريتين كحد أقصى."
      );
      return;
    }
    const next = calculateGrowth({
      goalMonthlyMinor: parsed.goal.value ?? 0,
      resourcesMinor: parsed.resources.value ?? 0,
      livingMonthlyMinor: parsed.living.value ?? 0,
      monthlySavingsMinor: parsed.savings.value ?? 0,
      possibleFundingMinor: parsed.funding.value ?? 0,
      evidenceReady,
    });
    setResult(next);
    if (!next.safe) {
      setMessage(next.error ?? "تعذر الحساب ضمن حدود الأرقام الآمنة.");
      return;
    }
    const first = next.stages[0];
    const nextMessage = !evidenceReady
      ? "المراحل معروضة كتصور هدف فقط: لم تؤكد مراجعة الأدلة بعد، لذلك لا يمكن إنشاء خطة قابلة للتنفيذ."
      : first?.confirmedGapMinor
        ? `تظهر فجوة مؤكدة في مرحلة السنة الأولى قدرها ${money(first.confirmedGapMinor)}. التمويل المحتمل منفصل ولا يجعل الخطة قابلة للتنفيذ.`
        : "لا تظهر فجوة مؤكدة في مرحلة السنة الأولى. تبقى كل مرحلة محاكاة محلية تتطلب مراجعة بشرية شهرية.";
    setMessage(nextMessage);
    log("حساب تشخيص نمو مرحلي محلي", nextMessage);
    setStep("plan");
  };

  const createPlan = (stage: NonNullable<typeof result>["stages"][number]) => {
    if (!canEdit) {
      setMessage(
        "معاينة القراءة تعرض التصور ولا تحفظ خطة. اختر دور المشغّل لتجربة إنشاء نسخة استراتيجية."
      );
      return;
    }
    if (!result?.safe) {
      setMessage("احسب التشخيص الآمن أولاً قبل إنشاء أي نسخة استراتيجية.");
      return;
    }
    if (!stage.executable) {
      const nextMessage = !result.evidenceReady
        ? `امتنع النموذج عن حفظ خطة ${stage.year} سنوات: الأدلة والمدخلات لم تؤكد للمراجعة.`
        : `امتنع النموذج عن حفظ خطة ${stage.year} سنوات: الفجوة المؤكدة ${money(stage.confirmedGapMinor)} ما زالت قائمة.`;
      setMessage(nextMessage);
      log("امتناع عن إنشاء خطة نمو", nextMessage);
      return;
    }
    add(
      "plans",
      entityInput(`تصور استراتيجي · ${stage.year} سنوات · ${stage.phase}`, {
        status: `نسخة استراتيجية ${stage.year} سنوات للمراجعة الشهرية`,
        amountMinor: stage.requirementMinor,
        meta: {
          strategyScenario: true,
          term: `${stage.year} سنوات`,
          phase: stage.phase,
          goalMonthlyMinor: stage.goalMonthlyMinor,
          requirementMinor: stage.requirementMinor,
          confirmedResourcesMinor: stage.confirmedResourcesMinor,
          possibleFundingMinor: stage.possibleFundingMinor,
          confirmedGapMinor: stage.confirmedGapMinor,
          conditionalGapMinor: stage.conditionalGapMinor,
          monthlyIndicator: stage.monthlyIndicator,
          reviewReason: stage.reviewReason,
          risk,
          evidenceReady: result.evidenceReady,
          assumption:
            "الهدف المرحلي والادخار والسيولة مدخلات المستخدم؛ لا سعر سوق ولا عائد أو توقع مضمّن.",
        },
      })
    );
    const nextMessage = `حُفظت نسخة استراتيجية صورية لمدة ${stage.year} سنوات بمؤشر شهري وسبب مراجعة ظاهرين؛ لا تمويل أو شراء أو عائد متوقع.`;
    setMessage(nextMessage);
    log(`إنشاء تصور استراتيجي ${stage.year} سنوات`, nextMessage);
  };

  const createReview = () => {
    if (!canEdit) {
      setMessage(
        "معاينة القراءة لا تحفظ مراجعة. النتيجة الظاهرة مقيدة ولا تستدعي عملية محروسة."
      );
      return;
    }
    add(
      "reviews",
      entityInput("مراجعة نمو شهرية", {
        status: "مسودة مراجعة",
        meta: {
          reason: editReason,
          planCount: plans.length,
          risk,
          evidenceReady,
        },
      })
    );
    const nextMessage = `أُضيفت مراجعة شهرية محلية بسبب: ${editReason}`;
    setMessage(nextMessage);
    log("إضافة مراجعة نمو شهرية", nextMessage);
  };

  const copyPlan = () => {
    if (!canEdit) {
      setMessage("معاينة القراءة لا تنسخ الخطة؛ اعرض النتيجة المقيدة فقط.");
      return;
    }
    if (!plans[0]) {
      setMessage("أنشئ تصوراً استراتيجياً قابلاً للمراجعة قبل نسخ إصدار مبرر.");
      return;
    }
    add(
      "plans",
      entityInput(`${plans[0].title} · نسخة معدلة`, {
        status: "نسخة معدلة للمراجعة",
        amountMinor: plans[0].amountMinor,
        meta: {
          ...plans[0].meta,
          copyOf: plans[0].id,
          reason: editReason,
          version: Number(plans[0].meta.version ?? 1) + 1,
        },
      })
    );
    const nextMessage = `حُفظت نسخة خطة محلية مع سبب تعديل ظاهر: ${editReason}`;
    setMessage(nextMessage);
    log("نسخ خطة نمو مع سبب", nextMessage);
  };

  const chartData =
    result?.stages.map(stage => ({
      name: `${stage.year} سنة`,
      requirement: stage.requirementMinor,
      gap: stage.confirmedGapMinor,
    })) ?? [];

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F28 · مستشار النمو"
        title="خطة النمو والمراجعة الشهرية"
        description="معالج حتمي يوضح مدخلاتك وفجوتك. لا يستخدم LLM ولا يتنبأ بعائد أو يمنح توصية شراء."
      />
      <DemoNotice mode="interactive">
        خطة السنة الأولى ناتج تشخيص مجاني فقط؛ وخطط 5 و10 سنوات تصورات
        استراتيجية صورية مستقلة. لا يستند أي منها إلى سعر إيجار أو عائد سوقي.
      </DemoNotice>

      <TabBar items={WIZARD_STEPS} value={step} onChange={setStep} />
      <div className="split-layout">
        <Panel
          title="معالج التشخيص"
          description="كل رقم يدخل بوحدة صغرى للعملة. التمويل المحتمل يبقى منفصلاً عن الموارد المؤكدة ولا يزيل فجوة التنفيذ."
        >
          {step === "goal" && (
            <div className="form-grid">
              <label>
                هدف دخل شهري نهائي ر.ق
                <input
                  className="field"
                  inputMode="decimal"
                  value={goal}
                  onChange={event => setGoal(event.target.value)}
                />
              </label>
              <p className="muted">
                تدرج الهدف المعروض هو 50% في سنة 1 و75% في سنة 5 و100% في سنة 10
                من هدفك المدخل، وليس توقع دخل.
              </p>
            </div>
          )}
          {step === "resources" && (
            <div className="form-grid">
              <label>
                الموارد والسيولة المؤكدة اليوم ر.ق
                <input
                  className="field"
                  inputMode="decimal"
                  value={resources}
                  onChange={event => setResources(event.target.value)}
                />
              </label>
              <label>
                التزامات معيشة شهرية ر.ق
                <input
                  className="field"
                  inputMode="decimal"
                  value={living}
                  onChange={event => setLiving(event.target.value)}
                />
              </label>
              <label>
                ادخار شهري مدخل ر.ق
                <input
                  className="field"
                  inputMode="decimal"
                  value={monthlySavings}
                  onChange={event => setMonthlySavings(event.target.value)}
                />
              </label>
              <label>
                تمويل محتمل غير مؤكد ر.ق
                <input
                  className="field"
                  inputMode="decimal"
                  value={possibleFunding}
                  onChange={event => setPossibleFunding(event.target.value)}
                />
              </label>
            </div>
          )}
          {step === "risk" && (
            <div className="form-grid">
              <label>
                المخاطر والافتراضات
                <textarea
                  className="field"
                  value={risk}
                  onChange={event => setRisk(event.target.value)}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={evidenceReady}
                  onChange={event => setEvidenceReady(event.target.checked)}
                />
                راجعت مصدر السيولة والادخار والقيود يدوياً لهذه المحاكاة
              </label>
            </div>
          )}
          {step === "plan" && (
            <div className="mini-list">
              <div>
                <strong>سنة 1 · تثبيت الأساس</strong>
                <span>50% من الهدف المدخل وفحص شهري للفجوة.</span>
              </div>
              <div>
                <strong>5 سنوات · تدرج منضبط</strong>
                <span>75% من الهدف المدخل مع تراكم الادخار فقط.</span>
              </div>
              <div>
                <strong>10 سنوات · حماية المسار</strong>
                <span>100% من الهدف المدخل بلا سعر سوق أو عائد مفترض.</span>
              </div>
            </div>
          )}
          <div className="action-row">
            {step !== "goal" && (
              <button
                className="btn-ghost"
                onClick={() =>
                  setStep(
                    WIZARD_STEPS[
                      Math.max(
                        0,
                        WIZARD_STEPS.findIndex(item => item.key === step) - 1
                      )
                    ]?.key ?? "goal"
                  )
                }
              >
                السابق
              </button>
            )}
            {step !== "plan" && (
              <button
                className="btn-secondary"
                onClick={() =>
                  setStep(
                    WIZARD_STEPS[
                      Math.min(
                        WIZARD_STEPS.length - 1,
                        WIZARD_STEPS.findIndex(item => item.key === step) + 1
                      )
                    ]?.key ?? "plan"
                  )
                }
              >
                التالي
              </button>
            )}
            <button className="btn-primary" onClick={calculate}>
              <Goal size={16} /> احسب التشخيص
            </button>
          </div>
        </Panel>
        <Panel
          title="نتيجة قابلة للتفسير"
          description="لا يخلط الحساب المورد الحالي بالتمويل المحتمل: الفجوة المؤكدة تستبعد التمويل المحتمل."
        >
          {!result ? (
            <p className="muted">
              أدخل القيم ثم اضغط «احسب التشخيص» لعرض الفجوة والمراحل.
            </p>
          ) : !result.safe ? (
            <EvidenceNotice complete={false}>
              {result.error ?? "تعذر حساب النتيجة بأرقام آمنة."}
            </EvidenceNotice>
          ) : (
            <>
              <div className="stats-grid compact-stats">
                <Metric
                  label="هدف سنوي نهائي"
                  value={money(result.annualGoalMinor)}
                  icon={<TrendingUp size={16} />}
                />
                <Metric
                  label="معيشة سنوية"
                  value={money(result.annualLivingMinor)}
                  icon={<CalendarClock size={16} />}
                />
                <Metric
                  label="سيولة مؤكدة اليوم"
                  value={money(result.confirmedCurrentMinor)}
                  detail={`تمويل محتمل منفصل: ${money(result.possibleFundingMinor)}`}
                  icon={<CircleGauge size={16} />}
                />
                <Metric
                  label="فجوة سنة 1"
                  value={money(result.gapMinor)}
                  detail={
                    result.evidenceReady
                      ? "فجوة مؤكدة قبل التمويل المحتمل"
                      : "الدليل غير مؤكد"
                  }
                  icon={<Goal size={16} />}
                />
              </div>
              <StatusLine tone={result.feasible ? "green" : "amber"}>
                {result.feasible
                  ? "تصور قابل للحفظ محلياً فقط؛ المراجعة البشرية الشهرية لازمة."
                  : "تصور هدف غير قابل للتنفيذ حتى تكتمل الأدلة وتنعدم الفجوة المؤكدة."}
              </StatusLine>
            </>
          )}
          <p className="muted">{message}</p>
        </Panel>
      </div>

      {result?.safe && (
        <>
          <div className="split-layout">
            <ChartPanel
              title="الحاجة السنوية عبر مراحل 1 / 5 / 10"
              description="القيم تتغير لأن هدف الدخل يتدرج وفق المدخل، ولا تتضمن عائداً أو نمو سعر أو بيانات سوق."
              data={chartData}
              dataKey="requirement"
              format={value => money(value)}
            />
            <ChartPanel
              title="الفجوة المؤكدة عبر المراحل"
              description="الفجوة تستبعد التمويل المحتمل. الصفر الحسابي لا يساوي وعداً أو تفويضاً بالتنفيذ."
              data={chartData}
              dataKey="gap"
              format={value => money(value)}
            />
          </div>
          <Panel
            title="التصورات الاستراتيجية القابلة للحفظ"
            description="ينشئ كل زر نسخة مرحلية موسومة مستقلة فقط إذا راجعت الدليل ولم تبق فجوة مؤكدة."
          >
            <div className="plan-grid">
              {result.stages.map(stage => (
                <article className="plan-card" key={stage.year}>
                  <p className="mini-label">
                    {stage.year} سنوات · {stage.phase}
                  </p>
                  <h3>هدف شهري {money(stage.goalMonthlyMinor)}</h3>
                  <div className="mini-list">
                    <div>
                      <strong>الحاجة السنوية</strong>
                      <span>{money(stage.requirementMinor)}</span>
                    </div>
                    <div>
                      <strong>المورد المؤكد</strong>
                      <span>
                        {money(stage.confirmedResourcesMinor)} · ادخار متراكم{" "}
                        {money(stage.savedMinor)}
                      </span>
                    </div>
                    <div>
                      <strong>الفجوة المؤكدة</strong>
                      <span>
                        {money(stage.confirmedGapMinor)} · بعد تمويل محتمل:{" "}
                        {money(stage.conditionalGapMinor)}
                      </span>
                    </div>
                    <div>
                      <strong>مؤشر شهري</strong>
                      <span>{stage.monthlyIndicator}</span>
                    </div>
                    <div>
                      <strong>سبب المراجعة</strong>
                      <span>{stage.reviewReason}</span>
                    </div>
                  </div>
                  <p className="muted">{stage.note}</p>
                  <button
                    className="btn-secondary"
                    onClick={() => createPlan(stage)}
                    disabled={!canEdit || !stage.executable}
                  >
                    <FileText size={16} /> إنشاء نسخة استراتيجية {stage.year}{" "}
                    سنوات
                  </button>
                </article>
              ))}
            </div>
            {!result.evidenceReady && (
              <EvidenceNotice complete={false}>
                التصورات أهداف محاكية فقط: أكد الأدلة يدوياً ثم أعد الحساب قبل
                أن يتيح النموذج حفظ أي خطة.
              </EvidenceNotice>
            )}
          </Panel>
        </>
      )}

      <Panel
        title="نسخ الخطة ومراجعتها"
        description="المراجعة والنسخ آثار محلية ظاهرة، مع حفظ سبب التعديل بدلاً من استبدال صامت."
      >
        <label>
          سبب التعديل أو المراجعة
          <textarea
            className="field"
            value={editReason}
            onChange={event => setEditReason(event.target.value)}
          />
        </label>
        <div className="action-row">
          <button
            className="btn-secondary"
            onClick={createReview}
            disabled={!canEdit}
          >
            إضافة مراجعة شهرية
          </button>
          <button
            className="btn-secondary"
            onClick={copyPlan}
            disabled={!canEdit}
          >
            نسخ إصدار مبرر
          </button>
        </div>
        <div className="split-layout">
          <EntityTable
            rows={plans.slice(0, 4)}
            empty="لا توجد خطط محفوظة."
            columns={[
              { key: "plan", label: "الخطة", render: row => row.title },
              {
                key: "status",
                label: "الحالة",
                render: row => <Badge tone="blue">{row.status}</Badge>,
              },
              {
                key: "term",
                label: "المدة",
                render: row => String(row.meta.term ?? "نسخة"),
              },
            ]}
          />
          <EntityTable
            rows={reviews.slice(0, 4)}
            empty="لا توجد مراجعات بعد."
            columns={[
              { key: "review", label: "المراجعة", render: row => row.title },
              {
                key: "reason",
                label: "السبب",
                render: row => String(row.meta.reason ?? "-"),
              },
              {
                key: "status",
                label: "الحالة",
                render: row => <Badge tone="amber">{row.status}</Badge>,
              },
            ]}
          />
        </div>
      </Panel>
      <LocalOnly>
        لا يرسل المعالج أي بيانات، ولا يستخدم نموذجاً لغوياً أو مصدر سوق أو
        واجهة تمويل خارجية.
      </LocalOnly>
    </div>
  );
}
