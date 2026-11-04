import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  Calculator,
  DatabaseZap,
  FileLock2,
  Filter,
  Landmark,
  Send,
  ShieldQuestion,
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
} from "@/components/app/Primitives";
import {
  ChartPanel,
  EvidenceNotice,
  FUNDING_CHECKLIST,
  LocalOnly,
  OPPORTUNITY_FIXTURES,
  OPPORTUNITY_SCENARIO_CONFIG,
  QualityFlag,
  SOURCE_FIXTURES,
  StatusLine,
  calculateOpportunityScenario,
  entityInput,
  mergeRows,
  meta,
  money,
  opportunityEvidence,
  parseMinor,
  parsePercentBps,
} from "./DecisionShared";

export function OpportunitiesPage() {
  const { filtered, log } = usePrototype();
  const [kind, setKind] = useState("الكل");
  const [source, setSource] = useState("الكل");
  const [freshness, setFreshness] = useState("الكل");
  const [match, setMatch] = useState("الكل");
  const [selected, setSelected] = useState<string[]>([]);
  const [compared, setCompared] = useState(false);
  const [cash, setCash] = useState("450000");
  const [potentialFunding, setPotentialFunding] = useState("0");
  const [reserve, setReserve] = useState("80000");
  const [fees, setFees] = useState("25000");
  const [setup, setSetup] = useState("120000");
  const [scenarioRate, setScenarioRate] = useState("0");
  const [scenario, setScenario] =
    useState<keyof typeof OPPORTUNITY_SCENARIO_CONFIG>("احتفاظ");
  const [calculatorResult, setCalculatorResult] = useState(
    "اختر فرصة واحدة أو اثنتين ثم أدخل افتراضات محلية ظاهرة لفحص السقف."
  );
  const [reportResult, setReportResult] = useState(
    "لا يوجد تقرير قرار بعد. التقرير، إن أنشئ، معاينة قراءة مقيدة فقط."
  );
  const opportunities = mergeRows(
    OPPORTUNITY_FIXTURES,
    filtered("opportunities")
  );
  const kindOptions = [
    "الكل",
    ...new Set(opportunities.map(row => meta(row, "kind"))),
  ];
  const sourceOptions = [
    "الكل",
    ...new Set(opportunities.map(row => meta(row, "source"))),
  ];
  const freshnessOptions = [
    "الكل",
    ...new Set(opportunities.map(row => meta(row, "freshness"))),
  ];
  const matchOptions = [
    "الكل",
    ...new Set(opportunities.map(row => meta(row, "match"))),
  ];
  const visible = opportunities.filter(
    row =>
      (kind === "الكل" || meta(row, "kind") === kind) &&
      (source === "الكل" || meta(row, "source") === source) &&
      (freshness === "الكل" || meta(row, "freshness") === freshness) &&
      (match === "الكل" || meta(row, "match") === match)
  );
  const selectedRows = opportunities.filter(row => selected.includes(row.id));
  const calculatorInputs = useMemo(
    () => ({
      cash: parseMinor(cash),
      potentialFunding: parseMinor(potentialFunding),
      reserve: parseMinor(reserve),
      fees: parseMinor(fees),
      setup: parseMinor(setup),
      scenarioRate: parsePercentBps(scenarioRate),
    }),
    [cash, potentialFunding, reserve, fees, setup, scenarioRate]
  );
  const inputError = Object.values(calculatorInputs).find(
    item => item.value === undefined
  )?.error;
  const calculations = useMemo(() => {
    if (inputError) return [];
    return selectedRows.map(row => {
      const evidence = opportunityEvidence(row);
      const effectiveFeesMinor =
        evidence.feesMinor ?? calculatorInputs.fees.value ?? 0;
      const effectiveSetupMinor =
        evidence.rehabMinor ?? calculatorInputs.setup.value ?? 0;
      return {
        row,
        evidence,
        feesSource:
          evidence.feesMinor === undefined
            ? "افتراض مدخل محلي"
            : "بيانات الفرصة",
        setupSource:
          evidence.rehabMinor === undefined
            ? "افتراض مدخل محلي"
            : "بيانات الفرصة",
        calculation: calculateOpportunityScenario({
          askingPriceMinor: row.amountMinor,
          cashMinor: calculatorInputs.cash.value ?? 0,
          potentialFundingMinor: calculatorInputs.potentialFunding.value ?? 0,
          reserveMinor: calculatorInputs.reserve.value ?? 0,
          feesMinor: effectiveFeesMinor,
          setupMinor: effectiveSetupMinor,
          scenarioRateBps: calculatorInputs.scenarioRate.value ?? 0,
          scenario,
          dataComplete: evidence.dataComplete,
        }),
      };
    });
  }, [selectedRows, inputError, calculatorInputs, scenario]);
  const config = OPPORTUNITY_SCENARIO_CONFIG[scenario];
  const evidenceBlocked =
    !selectedRows.length ||
    calculations.some(
      item => item.calculation.needsData || !item.calculation.safe
    );
  const liquidityBlocked =
    selectedRows.length > 0 &&
    calculations.some(item => !item.calculation.withinLiquidity);

  const toggleSelected = (id: string) => {
    setCompared(false);
    setSelected(current => {
      if (current.includes(id)) return current.filter(item => item !== id);
      if (current.length >= 2) {
        setReportResult(
          "يمكن اختيار فرصتين فقط للمقارنة. أزل إحداهما أولاً؛ لم يُتخذ أي إجراء شراء."
        );
        return current;
      }
      return [...current, id];
    });
  };

  const compare = () => {
    if (selectedRows.length !== 2) {
      const message =
        "اختر فرصتين بالضبط قبل المقارنة؛ لا توجد مقارنة أو توصية تلقائية.";
      setReportResult(message);
      log("امتناع عن مقارنة فرص", message);
      return;
    }
    setCompared(true);
    const message = `عرضت مقارنة محلية بين «${selectedRows[0]?.title}» و«${selectedRows[1]?.title}». لا شراء أو مراسلة أو التزام خارجي.`;
    setReportResult(message);
    log("مقارنة فرص محلية", message);
  };

  const runCalculator = () => {
    if (!selectedRows.length) {
      const message =
        "امتنع عن القرار: اختر فرصة واحدة على الأقل حتى يربط النموذج السقف بمبلغ معروض ودليل محدد.";
      setCalculatorResult(message);
      log("امتناع عن قرار فرصة", message);
      return;
    }
    if (inputError || !calculations.length) {
      setCalculatorResult(inputError ?? "تعذر قراءة افتراضات الحاسبة.");
      return;
    }
    const unsafe = calculations.find(item => !item.calculation.safe);
    if (unsafe) {
      const message = `امتنع عن القرار: ${unsafe.calculation.error ?? "حساب غير آمن"}.`;
      setCalculatorResult(message);
      log("امتناع عن قرار فرصة", message);
      return;
    }
    const missing = calculations.filter(item => item.calculation.needsData);
    if (missing.length) {
      const message = `امتنع عن القرار: دليل ${missing.map(item => `«${item.row.title}»`).join(" و")} غير مكتمل. النص الوصفي وحده لا يكفي؛ يعرض السقف كمحاكاة فقط.`;
      setCalculatorResult(message);
      log("امتناع عن قرار فرصة", message);
      return;
    }
    const aboveCap = calculations.filter(
      item => !item.calculation.withinLiquidity
    );
    if (aboveCap.length) {
      const message = `امتنع عن القرار: المبلغ المعروض يتجاوز سقف السيولة مع التمويل المحتمل لـ${aboveCap.map(item => `«${item.row.title}»`).join(" و")}.`;
      setCalculatorResult(message);
      log("امتناع عن قرار فرصة", message);
      return;
    }
    const requiresPotential = calculations.filter(
      item => !item.calculation.withinConfirmedLiquidity
    );
    const message = requiresPotential.length
      ? `نتيجة محاكاة مقيدة: السقف يغطي المبلغ المعروض فقط بعد إدخال تمويل محتمل غير مؤكد لـ${requiresPotential.map(item => `«${item.row.title}»`).join(" و")}. لا قرار قابل للتنفيذ أو تفويض تمويل.`
      : `نتيجة محاكاة محلية: كل مبلغ معروض ضمن السيولة المؤكدة بعد احتياطي وتكاليف سيناريو «${scenario}». ليست نصيحة أو موافقة شراء.`;
    setCalculatorResult(message);
    log("حساب أقصى شراء مرتبط بالفرصة", message);
  };

  const renderRestrictedReport = () => {
    if (!compared) {
      const message = "أنشئ مقارنة فرصتين أولاً قبل معاينة التقرير المقيد.";
      setReportResult(message);
      log("امتناع عن تقرير قرار مقيد", message);
      return;
    }
    if (inputError) {
      const message = `امتنع عن تقرير قرار: ${inputError}`;
      setReportResult(message);
      log("امتناع عن تقرير قرار مقيد", message);
      return;
    }
    if (evidenceBlocked || liquidityBlocked) {
      const message = evidenceBlocked
        ? "امتنع عن تقرير قرار: الدليل ناقص أو لا توجد فرصة مختارة، لذلك لا يعرض النموذج توصية أو ترتيباً نهائياً."
        : "امتنع عن تقرير قرار: مبلغ معروض واحد على الأقل يتجاوز سقف السيولة المحسوب.";
      setReportResult(message);
      log("امتناع عن تقرير قرار مقيد", message);
      return;
    }
    const message =
      "أُنشئت معاينة تقرير قرار مقيد ضمن البروتوتايب. لا يمكن مشاركته خارج النموذج ولا يفوّض شراءً أو بيعاً أو اقتراضاً.";
    setReportResult(message);
    log("إنشاء معاينة تقرير قرار مقيد", message);
  };

  const comparisonData = selectedRows.map(row => ({
    name: row.title.replace(" · ", "\n"),
    asking: row.amountMinor,
  }));

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F29 + F30 · الفرص"
        title="تدفق الفرص وقرار المقارنة"
        description="فرص خيالية مصنفة ومؤرخة. المنصة لا تشتري ولا تبيع ولا تراسل مصدراً تلقائياً."
      />
      <DemoNotice mode="interactive">
        المصادر والفرص التالية أمثلة داخلية فقط. لا يوجد بحث يومي فعلي أو عقد
        مصدر أو تنفيذ صفقة.
      </DemoNotice>

      <Panel
        title="مرشحات تدفق الفرص"
        description="المطابقة وصفية وقابلة للمراجعة، وليست تقييم ائتماني أو توصية."
      >
        <div className="filter-row">
          <label>
            النوع
            <select
              className="field"
              value={kind}
              onChange={event => setKind(event.target.value)}
            >
              {kindOptions.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            المصدر
            <select
              className="field"
              value={source}
              onChange={event => setSource(event.target.value)}
            >
              {sourceOptions.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            الحداثة
            <select
              className="field"
              value={freshness}
              onChange={event => setFreshness(event.target.value)}
            >
              {freshnessOptions.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            المطابقة
            <select
              className="field"
              value={match}
              onChange={event => setMatch(event.target.value)}
            >
              {matchOptions.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          <Filter size={15} /> {visible.length} فرصة ظاهرة · لم تنفذ أي عملية
          شراء تلقائية.
        </p>
      </Panel>

      <Panel
        title="قائمة فرص صورية"
        description="اختر فرصتين للمقارنة. يظهر سبب المطابقة والدليل الناقص مع كل سجل."
      >
        <EntityTable
          rows={visible}
          empty="لا توجد فرص مطابقة للمرشحات الحالية."
          columns={[
            {
              key: "selection",
              label: "اختيار",
              render: row => (
                <button
                  className={
                    selected.includes(row.id) ? "btn-primary" : "btn-secondary"
                  }
                  onClick={() => toggleSelected(row.id)}
                >
                  {selected.includes(row.id) ? "مختارة" : "اختيار للمقارنة"}
                </button>
              ),
            },
            {
              key: "opportunity",
              label: "الفرصة",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">{row.subtitle}</span>
                </>
              ),
            },
            {
              key: "kind",
              label: "النوع/المطابقة",
              render: row => `${meta(row, "kind")} · ${meta(row, "match")}`,
            },
            {
              key: "source",
              label: "المصدر/الحداثة",
              render: row =>
                `${meta(row, "source")} · ${meta(row, "freshness")}`,
            },
            {
              key: "evidence",
              label: "الدليل",
              render: row => (
                <Badge tone="amber">{meta(row, "evidence")}</Badge>
              ),
            },
          ]}
        />
        <div className="action-row">
          <button className="btn-primary" onClick={compare}>
            <ArrowLeftRight size={16} /> قارن الفرصتين المختارتين
          </button>
          <span className="muted">{selected.length}/2 مختارة</span>
        </div>
      </Panel>

      {compared && (
        <div className="split-layout">
          <ChartPanel
            title="المبلغ المعروض في المقارنة"
            description="قيم طلب صورية، لا تقييم أو سعر عادل أو عائد متوقع."
            data={comparisonData}
            dataKey="asking"
            format={value => money(value)}
          />
          <Panel
            title="مقارنة مقيدة بالسقف"
            description="لكل فرصة يظهر السعر المعروض مقابل سقفها قبل أي تقرير؛ لا تقود المقارنة إلى تنفيذ."
          >
            <div className="mini-list">
              {calculations.map(({ row, evidence, calculation }) => (
                <div key={row.id}>
                  <strong>{row.title}</strong>
                  <span>
                    المعروض {money(row.amountMinor)} · السقف مع التمويل المحتمل{" "}
                    {money(calculation.maximumPriceMinor)} · ضمن السيولة:{" "}
                    {calculation.withinLiquidity ? "نعم" : "لا"} ·{" "}
                    {evidence.needsData
                      ? "يحتاج بيانات"
                      : "الدليل مكتمل محلياً"}
                  </span>
                </div>
              ))}
            </div>
            <EvidenceNotice complete={!evidenceBlocked && !liquidityBlocked}>
              تظل المقارنة صورية. الامتناع لازم عند نقص الدليل أو تجاوز سقف
              السيولة، ولا يوجد أمر شراء أو اتصال بالمصدر.
            </EvidenceNotice>
          </Panel>
        </div>
      )}

      <div className="split-layout">
        <Panel
          title="حاسبة أقصى شراء مرتبطة بالفرصة"
          description="تطبق الافتراضات على كل فرصة مختارة: السيولة المؤكدة + التمويل المحتمل − الاحتياطي − عناصر السيناريو. التمويل المحتمل لا يعد سيولة مؤكدة."
        >
          <div className="form-grid">
            <label>
              السيولة المؤكدة ر.ق
              <input
                className="field"
                value={cash}
                inputMode="decimal"
                onChange={event => setCash(event.target.value)}
              />
            </label>
            <label>
              تمويل محتمل غير مؤكد ر.ق
              <input
                className="field"
                value={potentialFunding}
                inputMode="decimal"
                onChange={event => setPotentialFunding(event.target.value)}
              />
            </label>
            <label>
              احتياطي محجوز ر.ق
              <input
                className="field"
                value={reserve}
                inputMode="decimal"
                onChange={event => setReserve(event.target.value)}
              />
            </label>
            <label>
              رسوم محلية ظاهرة ر.ق
              <input
                className="field"
                value={fees}
                inputMode="decimal"
                onChange={event => setFees(event.target.value)}
              />
            </label>
            <label>
              {config.setupLabel} ر.ق
              <input
                className="field"
                value={setup}
                inputMode="decimal"
                onChange={event => setSetup(event.target.value)}
              />
            </label>
            <label>
              {config.rateLabel} %
              <input
                className="field"
                value={scenarioRate}
                inputMode="decimal"
                onChange={event => setScenarioRate(event.target.value)}
              />
            </label>
            <label>
              السيناريو
              <select
                className="field"
                value={scenario}
                onChange={event =>
                  setScenario(
                    event.target
                      .value as keyof typeof OPPORTUNITY_SCENARIO_CONFIG
                  )
                }
              >
                <option>شراء</option>
                <option>تطوير</option>
                <option>بيع</option>
                <option>احتفاظ</option>
              </select>
            </label>
          </div>
          <p className="muted">
            هذه نسب ومبالغ افتراضية تدخلها أنت؛ لا يوجد افتراض رسم محلي أو سعر
            سوق أو عائد. في «{scenario}»:{" "}
            {config.usesFees ? "تدخل الرسوم" : "لا تدخل الرسوم"} و
            {config.usesSetup ? "يدخل التجهيز" : "لا يدخل التجهيز"} في السقف.
          </p>
          <button className="btn-primary" onClick={runCalculator}>
            <Calculator size={16} /> افحص السقف والسيناريو
          </button>
          <p className="muted">{calculatorResult}</p>
        </Panel>
        <Panel
          title="ناتج الحاسبة وسبب الامتناع"
          description="تظهر أرقام صحيحة بوحدة صغرى فقط. لا تحول السقف الحسابي إلى رأي أو تفويض."
        >
          {!selectedRows.length ? (
            <p className="muted">
              اختر فرصة واحدة أو اثنتين لإظهار السعر المعروض مقابل سقف الحاسبة.
            </p>
          ) : (
            <div className="mini-list">
              {calculations.map(
                ({ row, evidence, feesSource, setupSource, calculation }) => (
                  <div key={row.id}>
                    <strong>{row.title}</strong>
                    <span>
                      المعروض {money(row.amountMinor)} · السقف المؤكد{" "}
                      {money(calculation.confirmedMaxPriceMinor)} · السقف مع
                      التمويل المحتمل {money(calculation.maximumPriceMinor)} ·
                      ضمن السيولة: {calculation.withinLiquidity ? "نعم" : "لا"}.
                    </span>
                    <span className="muted">
                      احتياطي {money(calculation.reserveMinor)} · رسوم{" "}
                      {money(calculation.feesMinor)} ({feesSource}) · تجهيز{" "}
                      {money(calculation.setupMinor)} ({setupSource}) · نسبة
                      افتراضية {money(calculation.scenarioRateCostMinor)}.
                    </span>
                    <span className="muted">
                      بيانات موروثة: قيمة متوقعة{" "}
                      {evidence.expectedValueMinor === undefined
                        ? "غير متاحة"
                        : money(evidence.expectedValueMinor)}{" "}
                      · إيجار{" "}
                      {evidence.rentMinor === undefined
                        ? "غير متاح"
                        : money(evidence.rentMinor)}
                      . لا تستخدم هذه الأرقام كتوقع أو عائد.
                    </span>
                  </div>
                )
              )}
            </div>
          )}
          <QualityFlag
            label="الدليل الأساسي"
            status={evidenceBlocked ? "block" : "review"}
            detail={
              evidenceBlocked
                ? "وسم dataComplete أو حقول القيمة/الرسوم/التجهيز/الإيجار غير مكتملة؛ القرار متوقف."
                : "البيانات مكتملة محلياً فقط وتبقى بحاجة مراجعة بشرية."
            }
          />
          <QualityFlag
            label="السيولة"
            status={liquidityBlocked ? "block" : "review"}
            detail={
              liquidityBlocked
                ? "مبلغ معروض واحد على الأقل يتجاوز سقف السيولة مع التمويل المحتمل."
                : "السقف لا يساوي توصية أو تفويضاً بالالتزام."
            }
          />
          <QualityFlag
            label="الشراء التلقائي"
            status="good"
            detail="محظور في النموذج: لا زر شراء ولا تفويض أو اتصال بمصدر."
          />
          <button className="btn-secondary" onClick={renderRestrictedReport}>
            <FileLock2 size={16} /> معاينة تقرير قرار مقيد
          </button>
          <p className="muted">{reportResult}</p>
        </Panel>
      </div>
      <LocalOnly>
        كل مقارنة وحساب و«تقرير» هنا محلي. لا يعرض عائداً، ولا يرسل طلباً، ولا
        يوقع أو يشتري بالنيابة عن أحد.
      </LocalOnly>
    </div>
  );
}

export function DataPage() {
  const { list, add, patch, log, canEdit } = usePrototype();
  const [qualityResult, setQualityResult] = useState(
    "لم ينفذ فحص جودة محلي بعد."
  );
  const sources = mergeRows(SOURCE_FIXTURES, list("sources"));
  const qualityRows = list("quality");

  const markConnectorReviewed = (rowId: string) => {
    if (!canEdit) {
      setQualityResult(
        "معاينة القراءة لا تسجل مراجعة موصل. النتيجة مقيدة ولم يُستدعَ أي تعديل محفوظ."
      );
      return;
    }
    const source = sources.find(row => row.id === rowId);
    const savedSource = list("sources").find(row => row.id === rowId);
    if (savedSource) {
      patch("sources", savedSource.id, {
        status: "تصميم مراجع محلياً",
        meta: { ...savedSource.meta, reviewedAt: "2026-10-24" },
      });
    } else if (source) {
      add(
        "sources",
        entityInput(`مراجعة تصميم موصل: ${source.title}`, {
          portfolioId: "data",
          status: "تصميم مراجع محلياً",
          meta: {
            reviewedSourceId: source.id,
            connector: "غير مفعّل",
            reviewedAt: "2026-10-24",
          },
        })
      );
    }
    const message =
      "حُفظت مراجعة تصميم الموصل محلياً؛ لم يُفعّل أي API ولم تُنقل بيانات.";
    setQualityResult(message);
    log("مراجعة موصل بيانات", message);
  };

  const runQualityCheck = () => {
    if (!canEdit) {
      setQualityResult(
        "معاينة القراءة لا تسجل فحص جودة. تظهر النواقص فقط من دون استدعاء add المحروس."
      );
      return;
    }
    add(
      "quality",
      entityInput("فحص جودة قرار محلي", {
        status: "غير كافٍ للقرار",
        meta: {
          missing: "مصدر مرخّص وعينة تحقق",
          duplicate: "تشابه محتمل بين قائمتين",
          sensitiveChange: "تغيير سعر يتطلب مراجعة",
          accusation: false,
        },
      })
    );
    const message =
      "أظهر الفحص نقصاً وتكراراً محتملاً وتغييراً حساساً للمراجعة. لا يعني ذلك اتهاماً بتلاعب أو خطأ متعمد.";
    setQualityResult(message);
    log("تشغيل فحص جودة محلي", message);
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F31 + F32 · طبقة البيانات"
        title="كتالوج المصادر وجودة القرار"
        description="نُظهر المصدر والحقوق والبلد والعملة والتاريخ والجودة قبل استخدام أي سجل في قرار."
      />
      <DemoNotice mode="external">
        واجهات الاتصال مجرد حالات تصميم. لا يوجد API خارجي مفعّل، ولا يمكن
        استخدام RentCast لقطر في هذا النموذج.
      </DemoNotice>

      <Panel
        title="كتالوج المصادر والموصلات"
        description="لا ينتقل موصل من الاقتراح إلى التفعيل قبل الحقوق والتحقق والعينة؛ هذه الصفحة لا تفعل موصلاً."
        action={
          <FormDialog
            title="إضافة مصدر صوري"
            trigger={
              <button className="btn-primary" disabled={!canEdit}>
                <DatabaseZap size={16} /> إضافة مصدر
              </button>
            }
            fields={[
              { key: "title", label: "اسم المصدر", required: true },
              { key: "country", label: "البلد", required: true },
              {
                key: "currency",
                label: "العملة",
                required: true,
                defaultValue: "QAR",
              },
              { key: "rights", label: "حقوق الاستخدام", required: true },
              {
                key: "quality",
                label: "حالة الجودة",
                type: "select",
                required: true,
                options: [
                  { value: "بانتظار عينة", label: "بانتظار عينة" },
                  { value: "محدودة", label: "محدودة" },
                  { value: "مراجعة", label: "مراجعة" },
                ],
              },
            ]}
            submitLabel="حفظ المصدر محلياً"
            onSubmit={values => {
              if (!canEdit) {
                setQualityResult(
                  "معاينة القراءة لا تحفظ مصدراً. لا يُستدعى إجراء إضافة محروس."
                );
                return;
              }
              add(
                "sources",
                entityInput(values.title, {
                  portfolioId: "data",
                  status: "موصل مقترح",
                  meta: {
                    country: values.country,
                    dataCurrency: values.currency,
                    rights: values.rights,
                    quality: values.quality,
                    connector: "مقترح",
                  },
                })
              );
              const message = `أضيف مصدر صوري «${values.title}» بحالة موصل مقترح فقط.`;
              setQualityResult(message);
              log("إضافة مصدر بيانات صوري", message);
            }}
          />
        }
      >
        <EntityTable
          rows={sources}
          empty="لا توجد مصادر في الكتالوج."
          columns={[
            {
              key: "source",
              label: "المصدر",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">{row.subtitle}</span>
                </>
              ),
            },
            {
              key: "coverage",
              label: "البلد/العملة",
              render: row =>
                `${meta(row, "country")} · ${meta(row, "dataCurrency")}`,
            },
            {
              key: "rights",
              label: "الحقوق والجودة",
              render: row => `${meta(row, "rights")} · ${meta(row, "quality")}`,
            },
            {
              key: "status",
              label: "حالة الموصل",
              render: row => (
                <Badge tone={row.status === "موقوف" ? "amber" : "blue"}>
                  {row.status}
                </Badge>
              ),
            },
            {
              key: "action",
              label: "أثر محلي",
              render: row => (
                <button
                  className="btn-ghost"
                  disabled={!canEdit}
                  onClick={() => markConnectorReviewed(row.id)}
                >
                  تسجيل مراجعة
                </button>
              ),
            },
          ]}
        />
      </Panel>

      <div className="split-layout">
        <Panel
          title="تقرير جودة وجاهزية"
          description="وجود نقص أو تكرار أو تغير حساس يوقف القرار الواثق؛ لا يتحول تلقائياً إلى اتهام."
        >
          <QualityFlag
            label="اكتمال المصدر"
            status="block"
            detail="حقوق الاستخدام والعينة المستقلة لم تتحققا بعد."
          />
          <QualityFlag
            label="تكرار محتمل"
            status="review"
            detail="يتطلب مطابقة بشرية قبل حذف أو دمج أي سجل."
          />
          <QualityFlag
            label="تغيير حساس"
            status="review"
            detail="يحفظ للسجل ويراجع؛ لا يساوي حكماً بتلاعب."
          />
          <button
            className="btn-primary"
            disabled={!canEdit}
            onClick={runQualityCheck}
          >
            <ShieldQuestion size={16} /> تشغيل فحص محلي
          </button>
          <p className="muted">{qualityResult}</p>
        </Panel>
        <Panel
          title="أثر الجاهزية على القرار"
          description="الصفحة تشرح قرار الامتناع ولا تخفي النواقص وراء درجة عامة."
        >
          <div className="mini-list">
            <div>
              <strong>جاهزية التوصية</strong>
              <span>غير كافية حتى تتوافر الحقوق والعينة والتاريخ.</span>
            </div>
            <div>
              <strong>حالة RentCast لقطر</strong>
              <span>
                ممنوع الافتراض: النموذج يوسمه «موقوف» ولا يخلط تغطيته مع قطر.
              </span>
            </div>
            <div>
              <strong>الفحص المسجل</strong>
              <span>
                {qualityRows.length
                  ? `${qualityRows.length} فحص/فحوص محلية ظاهرة.`
                  : "لا يوجد فحص مسجل بعد."}
              </span>
            </div>
          </div>
          <EvidenceNotice complete={false}>
            نقص الدليل يمنع تقرير قرار واثق؛ المطلوب مراجعة بشرية وحقوق استخدام،
            لا تخمين أو اتهام.
          </EvidenceNotice>
        </Panel>
      </div>
      <LocalOnly>
        لا يتم استدعاء مصدر خارجي أو تخزين مفتاح API أو نقل سجل شخصي من هذه
        الشاشة.
      </LocalOnly>
    </div>
  );
}

export function FundingPage() {
  const { list, add, patch, log, canEdit } = usePrototype();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [approvalReady, setApprovalReady] = useState(false);
  const [message, setMessage] = useState(
    "الحزمة مسودة محلية؛ لا يغادر أي مستند أو ملخص هذا النموذج."
  );
  const funding = list("funding");
  const latest = funding[0];
  const completed = FUNDING_CHECKLIST.filter(item => checked[item]).length;

  const createPackage = () => {
    if (!canEdit) {
      setMessage(
        "معاينة القراءة لا تنشئ حزمة. المحتوى الظاهر معاينة مقيدة من دون استدعاء add."
      );
      return;
    }
    add(
      "funding",
      entityInput("حزمة جاهزية تمويل صورية", {
        status: "مسودة حزمة",
        meta: {
          completed,
          total: FUNDING_CHECKLIST.length,
          humanReview: true,
          sent: false,
        },
      })
    );
    const next = `أُنشئت حزمة جاهزية صورية بـ${completed}/${FUNDING_CHECKLIST.length} بنداً. لا تعني قابلية تمويل أو موافقة.`;
    setMessage(next);
    log("إنشاء حزمة جاهزية تمويل", next);
  };

  const requestApproval = () => {
    if (!canEdit) {
      setMessage("معاينة القراءة لا تسجل طلب موافقة. لم يُستدعَ إجراء محفوظ.");
      return;
    }
    add(
      "approvals",
      entityInput("موافقة مستقلة لإرسال حزمة تمويل", {
        status: "بانتظار اعتماد مستقل",
        meta: {
          requester: "المشغّل التجريبي",
          approver: "صاحب القرار التجريبي",
          selfApprovalBlocked: true,
          packageId: latest?.id ?? "لم تنشأ حزمة",
        },
      })
    );
    setApprovalReady(true);
    const next =
      "سجلت طلب موافقة إرسال مستقلة في النموذج. لا ترسل الموافقة أي مستند أو بيانات إلى طرف تمويل.";
    setMessage(next);
    log("طلب موافقة إرسال حزمة", next);
  };

  const simulateSending = () => {
    if (!canEdit) {
      setMessage("معاينة القراءة لا تحاكي إرسالاً ولا تستدعي patch محروساً.");
      return;
    }
    if (!latest || !approvalReady) {
      const next =
        "لا يمكن محاكاة الإرسال: أنشئ الحزمة ثم اطلب موافقة إرسال مستقلة أولاً.";
      setMessage(next);
      log("امتناع عن محاكاة إرسال تمويل", next);
      return;
    }
    patch("funding", latest.id, {
      status: "إرسال محاكى · لا شيء أُرسل",
      meta: { ...latest.meta, sent: false, simulatedAt: "2026-10-24" },
    });
    const next =
      "تمت محاكاة الإرسال داخل البروتوتايب بعد طلب الموافقة. لم يُرسل مستند أو طلب تمويل أو بيانات إلى أي جهة.";
    setMessage(next);
    log("محاكاة إرسال حزمة تمويل", next);
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F33 · جاهزية التمويل"
        title="حزمة الفحص وموافقة الإرسال"
        description="قائمة جاهزية ومعاينة حزمة مع فصل صريح بين الإعداد وموافقة الإرسال والمحاكاة."
      />
      <DemoNotice mode="simulation">
        لا توجد جهة تمويل أو API مصرفي أو وعد تمويل. لا يُرسل النموذج مستندات أو
        ملخصات أو بيانات عميل.
      </DemoNotice>

      <div className="split-layout">
        <Panel
          title="قائمة التحقق"
          description="أكمل ما هو متاح في المثال. اكتمال القائمة لا يساوي اعتماداً أو أهلية تمويل."
        >
          <div className="checklist">
            {FUNDING_CHECKLIST.map(item => (
              <label className="check-row" key={item}>
                <input
                  type="checkbox"
                  checked={Boolean(checked[item])}
                  onChange={event =>
                    setChecked(current => ({
                      ...current,
                      [item]: event.target.checked,
                    }))
                  }
                />
                {item}
              </label>
            ))}
          </div>
          <Metric
            label="اكتمال الحزمة"
            value={`${completed}/${FUNDING_CHECKLIST.length}`}
            detail="حالة تجربة فقط"
            icon={<BadgeCheck size={18} />}
          />
          <button
            className="btn-primary"
            onClick={createPackage}
            disabled={!canEdit}
          >
            <Landmark size={16} /> إنشاء حزمة محلية
          </button>
        </Panel>
        <Panel
          title="معاينة الحزمة المقيدة"
          description="المحتوى نموذجي: لا يحمل مستندات حقيقية ولا يمكن تنزيله أو إرساله خارجياً."
        >
          <div className="mini-list">
            <div>
              <strong>ملخص الفرصة</strong>
              <span>نموذج قرار مقيد، لا توصية تمويل.</span>
            </div>
            <div>
              <strong>المستندات</strong>
              <span>أسماء بنود فقط؛ لا رفع أو قراءة ملفات حقيقية.</span>
            </div>
            <div>
              <strong>مراجعة بشرية</strong>
              <span>مطلوبة قبل طلب الموافقة، ولا تستبدلها القائمة.</span>
            </div>
          </div>
          <StatusLine tone="amber">
            {latest?.status ?? "لا توجد حزمة بعد"}
          </StatusLine>
        </Panel>
      </div>

      <Panel
        title="موافقة إرسال مستقلة"
        description="إعداد الحزمة لا يطلق إرسالاً. الطلب محلي ومنفصل، والمحاكاة لا ترسل أي شيء."
      >
        <div className="action-row">
          <button
            className="btn-secondary"
            onClick={requestApproval}
            disabled={!canEdit}
          >
            <FileLock2 size={16} /> طلب موافقة إرسال مستقلة
          </button>
          <button
            className="btn-primary"
            onClick={simulateSending}
            disabled={!canEdit}
          >
            <Send size={16} /> محاكاة الإرسال بعد الموافقة
          </button>
        </div>
        <p className="muted">{message}</p>
        <EntityTable
          rows={funding.slice(0, 4)}
          empty="لا توجد حزم جاهزية محفوظة."
          columns={[
            { key: "package", label: "الحزمة", render: row => row.title },
            {
              key: "completion",
              label: "الاكتمال",
              render: row =>
                `${String(row.meta.completed ?? 0)}/${String(row.meta.total ?? 0)}`,
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <Badge tone="blue">{row.status}</Badge>,
            },
          ]}
        />
      </Panel>
      <LocalOnly>
        كل إرسال في F33 محاكاة واجهة. لا تواصل مع بنك أو وسيط أو مزود مستندات
        ولا وعد تمويل.
      </LocalOnly>
    </div>
  );
}
