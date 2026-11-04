import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  CalendarDays,
  Download,
  FileDown,
  Lock,
  Plus,
  ShieldCheck,
  TrendingDown,
  Unlock,
  WalletCards,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  buildBudgetVarianceRows,
  canonicalReportingPeriod,
} from "@/lib/prototype-budget";
import { financialSummary } from "@/lib/prototype-finance";
import {
  createLeaseVacancy,
  endLeaseVacancy,
} from "@/lib/prototype-lease-lifecycle";
import {
  DemoNotice,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import { money } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  DEMO_DATE,
  StatusBadge,
  entityInput,
  entityMeta,
  formMinor,
  portfolioName,
  scopedRows,
  selectOptions,
  sumMinor,
  value,
} from "./operatingUtils";

type Feedback = { tone: "ok" | "error"; text: string };

function requireEditPermission(canEdit: boolean) {
  if (!canEdit)
    throw new Error(
      "هذه الواجهة للقراءة فقط في الدور الحالي؛ لا يمكن حفظ تغيير محلي."
    );
}

function vacancyStartDate(
  row: ReturnType<ReturnType<typeof usePrototype>["filtered"]>[number]
): string {
  return (
    entityMeta(row, "startDate", "") || entityMeta(row, "since", "") || row.date
  );
}

function csvCell(text: string | number): string {
  const raw = String(text);
  const safe = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function isPrototypePeriodMarker(
  row: ReturnType<ReturnType<typeof usePrototype>["list"]>[number],
  portfolioId: string,
  period: string
): boolean {
  return (
    row.portfolioId === portfolioId &&
    entityMeta(row, "period", "") === period &&
    (row.meta.closeMarker === "prototype_period_followup" ||
      (row.status === "فترة مقفلة" && row.meta.action === "إقفال محلي"))
  );
}

function varianceDisplay(category: string, signedMinor: number): string {
  if (category === "دخل") {
    if (signedMinor > 0)
      return `فجوة مقابل هدف الدخل ${money(signedMinor)} (الفرق الموقّع: ${money(signedMinor)})`;
    if (signedMinor < 0)
      return `فوق هدف الدخل ${money(Math.abs(signedMinor))} (الفرق الموقّع: ${money(signedMinor)})`;
    return "مطابق لهدف الدخل (الفرق الموقّع: 0 ر.ق)";
  }
  if (signedMinor > 0)
    return `وفر ${money(signedMinor)} (الفرق الموقّع: ${money(signedMinor)})`;
  if (signedMinor < 0)
    return `تجاوز ${money(Math.abs(signedMinor))} (الفرق الموقّع: ${money(signedMinor)})`;
  return "مطابق للميزانية (الفرق الموقّع: 0 ر.ق)";
}

export function ReportsPage() {
  const { state, filtered, list, add, canEdit } = usePrototype();
  const asOf = scenarioDate(state);
  const financials = useMemo(
    () =>
      financialSummary(
        state.entities,
        state.settings.portfolioId,
        state.settings.period,
        asOf
      ),
    [
      asOf,
      state.entities,
      state.settings.period,
      state.settings.portfolioId,
    ]
  );
  const portfolios = list("portfolios");
  const properties = list("properties");
  const budgets = scopedRows(filtered("budgets"), state.settings);
  const reserves = scopedRows(filtered("reserves"), state.settings);
  const liabilities = scopedRows(filtered("liabilities"), state.settings);
  const journal = list("journal");
  const [tab, setTab] = useState("الميزانية والسيولة");
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "الأرقام والاتجاهات مشتقة من بيانات التجربة المحلية، وليست تقريرًا رسميًا أو توقعًا مضمونًا.",
  });
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const period = canonicalReportingPeriod(
    state.settings.period || "all",
    asOf
  );
  const periodLabel = period === "all" ? "كل الفترات" : period;
  const selectedPortfolioId = state.settings.portfolioId;
  const canMarkPeriod = Boolean(
    selectedPortfolioId && selectedPortfolioId !== "all"
  );
  const closedMarker = canMarkPeriod
    ? journal.find(row =>
        isPrototypePeriodMarker(row, selectedPortfolioId, period)
      )
    : undefined;

  useEffect(
    () => () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    },
    [exportUrl]
  );

  const createBudget = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({ tone: "error", text: "مبلغ الميزانية غير صالح." });
    if (period === "all")
      return setFeedback({
        tone: "error",
        text: "اختر فترة صريحة قبل إضافة الميزانية؛ لا تُطابق الميزانية ذات الفترة العامة فعليًا.",
      });
    const propertyId = value(values, "propertyId");
    const property = propertyId
      ? properties.find(row => row.id === propertyId)
      : undefined;
    const selectedPortfolio = value(values, "portfolioId");
    const portfolioId =
      property?.portfolioId ||
      selectedPortfolio ||
      (selectedPortfolioId !== "all" ? selectedPortfolioId : "");
    const matchCategory = value(values, "matchCategory");
    const itemKey = value(values, "itemKey");
    if (!portfolioId)
      return setFeedback({
        tone: "error",
        text: "اختر محفظة صريحة أو عقارًا تابعًا لها؛ لا توجد ميزانية عالمية في هذه المطابقة.",
      });
    if (
      property &&
      selectedPortfolio &&
      property.portfolioId !== selectedPortfolio
    )
      return setFeedback({
        tone: "error",
        text: "العقار المختار لا يتبع المحفظة المحددة.",
      });
    if (selectedPortfolioId !== "all" && portfolioId !== selectedPortfolioId)
      return setFeedback({
        tone: "error",
        text: "المحفظة أو العقار خارج نطاق العرض الحالي.",
      });
    if (matchCategory && itemKey)
      return setFeedback({
        tone: "error",
        text: "اختر محددًا واحدًا فقط: فئة المطابقة أو مفتاح البند، حتى لا تصبح المطابقة ملتبسة.",
      });
    const category = value(values, "category", "تشغيل");
    const basis = value(values, "basis");
    add(
      "budgets",
      entityInput(value(values, "title"), {
        subtitle: `ميزانية ${category}`,
        portfolioId,
        propertyId,
        status: "معتمدة محليًا",
        date: value(values, "date", asOf),
        amountMinor: amount,
        meta: {
          category,
          period,
          ...(matchCategory ? { matchCategory } : {}),
          ...(itemKey ? { itemKey } : {}),
          ...(basis ? { basis } : {}),
          note: value(values, "note"),
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `أضيفت ميزانية محلية ${money(amount)} بنطاق محفظة/فترة صريح؛ لا تغير النقد أو الرصيد البنكي.`,
    });
  };

  const createReserve = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({ tone: "error", text: "مبلغ الاحتياطي غير صالح." });
    add(
      "reserves",
      entityInput(value(values, "title", "احتياطي تجريبي"), {
        subtitle: "حجز إداري/محاسبي صوري",
        portfolioId: value(values, "portfolioId") || state.settings.portfolioId,
        status: "مخصص",
        date: asOf,
        amountMinor: amount,
        meta: {
          purpose: value(values, "purpose"),
          period,
          allocationKey: `reserve-${Date.now()}`,
          note: "لا يخصم من النقد مرتين",
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `خُصص احتياطي ${money(amount)} محليًا. الحجز لا ينشئ حركة بنك ولا يخصم الالتزام أو التأمين مرتين.`,
    });
  };

  const closePeriod = () => {
    if (!canMarkPeriod)
      return setFeedback({
        tone: "error",
        text: "من عرض كل المحافظ اختر محفظة صريحة أولًا؛ لا تُنشأ علامة متابعة عامة في سجل القيود.",
      });
    if (closedMarker)
      return setFeedback({
        tone: "error",
        text: `توجد علامة متابعة تجريبية للفترة «${period}» داخل هذه المحفظة؛ لا تمنع التعديل ولا تحذف السجل.`,
      });
    add(
      "journal",
      entityInput(`علامة متابعة ${period}`, {
        subtitle: "علامة متابعة تجريبية لا تمنع التعديل",
        portfolioId: selectedPortfolioId,
        status: "علامة متابعة فترة تجريبية",
        date: asOf,
        amountMinor: 0,
        meta: {
          period,
          action: "علامة متابعة محلية",
          closeMarker: "prototype_period_followup",
          note: "لا تمنع التعديل ولا تقفل دفترًا خارجيًا",
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `أضيفت علامة متابعة للفترة «${period}» داخل محفظتها. علامة متابعة تجريبية لا تمنع التعديل، وليست إقفالًا لدفتر فعلي.`,
    });
  };

  const makeStatementExport = () => {
    const header = [
      "الفترة",
      "المؤشر",
      "المبلغ (ر.ق)",
      "أساس التاريخ",
      "الملاحظة",
    ]
      .map(csvCell)
      .join(",");
    const entries = [
      [
        periodLabel,
        "لقطة النقد التجريبي",
        money(financials.cashAsOfMinor),
        `كما في ${financials.currentAsOf}`,
        "نقد مؤكد محلي؛ ليس رصيد بنك أو كشفًا معتمدًا.",
      ],
      [
        periodLabel,
        "حركة تحصيل نقدي مؤكدة",
        money(financials.incomeMinor),
        periodLabel,
        "تحصيلات أحداثها داخل الفترة فقط؛ لا تشمل الاستحقاق أو القبض اللاحق.",
      ],
      [
        periodLabel,
        "دخل على أساس الاستحقاق خلال الفترة",
        money(financials.accrualIncomeMinor),
        periodLabel,
        "استحقاقات نشطة داخل الفترة؛ لا تمثل نقدًا.",
      ],
      [
        periodLabel,
        "رصيد نهاية الفترة للاستحقاقات",
        money(financials.periodClosingOutstandingMinor),
        `إقفال الفترة: ${financials.periodClosingAsOf}`,
        "لا تغيره تحصيلات أو خسائر أو استردادات أحداثها بعد نهاية الفترة.",
      ],
      [
        periodLabel,
        "المتبقي الحالي لاستحقاقات الفترة",
        money(financials.currentAsOfOutstandingMinor),
        `كما في ${financials.currentAsOf}`,
        "يعكس التحصيلات والخسائر المؤرخة حتى تاريخ «كما في»؛ ليس رصيد الإقفال التاريخي.",
      ],
      [
        periodLabel,
        "مصروف تشغيلي مسدد",
        money(financials.expenseMinor),
        periodLabel,
        "تشغيلي فقط؛ الرأسمالي معروض في صف مستقل.",
      ],
      [
        periodLabel,
        "رأسمالي مسدد",
        money(financials.capitalExpenseMinor),
        periodLabel,
        "تحسين رأسمالي مصنف صراحة؛ لا يخلط بالمصروف التشغيلي.",
      ],
      [
        periodLabel,
        "احتياطي",
        money(financials.reserveMinor),
        `كما في ${financials.currentAsOf}`,
        "حجز لا يكرر خصم النقد",
      ],
      [
        periodLabel,
        "نقد حر تجريبي",
        money(financials.freeCashAsOfMinor),
        `كما في ${financials.currentAsOf}`,
        "لقطة محلية بعد الحجز والتأمين؛ ليست رصيد بنك.",
      ],
    ].map(row => row.map(csvCell).join(","));
    const next = URL.createObjectURL(
      new Blob([[header, ...entries].join("\n")], {
        type: "text/csv;charset=utf-8",
      })
    );
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl(next);
    setFeedback({
      tone: "ok",
      text: "أُنشئت نسخة CSV محلية للكشف التجريبي؛ لا تشمل بيانات بنك أو وثائق حقيقية.",
    });
  };

  const varianceRows = useMemo(
    () =>
      buildBudgetVarianceRows({
        budgets,
        expenses: state.entities.expenses,
        collections: state.entities.collections,
        receivables: state.entities.receivables,
        period,
        asOfDate: asOf,
      }).map(result => ({
        ...result.budget,
        meta: {
          ...result.budget.meta,
          actualMinor: result.actualMinor ?? "",
          varianceMinor: result.varianceMinor ?? "",
          actualStatus: result.actualStatus,
          actualBasis: result.actualBasis,
          actualNote: result.note,
        },
      })),
    [
      asOf,
      budgets,
      period,
      state.entities.collections,
      state.entities.expenses,
      state.entities.receivables,
    ]
  );

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F11 + F12 / السيولة والكشوف"
        title="التقارير والإقفال"
        description="ميزانية مقابل فعلي، احتياطي والتزامات وتوقع، ثم كشف مالك بروتوتايب يفصل حركة الفترة عن إقفالها ولقطة «كما في»."
      />
      <DemoNotice mode="simulation">
        لا تمثل الأرقام كشفًا محاسبيًا أو بنكيًا أو كشف مالك معتمدًا. التصدير
        ينشئ ملف CSV محليًا من مؤشرات التجربة فقط.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label={`لقطة نقد النموذج كما في ${financials.currentAsOf}`}
          value={money(financials.cashAsOfMinor)}
          detail="تحصيل مؤكد محلي؛ ليست رصيد بنك"
          icon={<WalletCards size={18} />}
        />
        <Metric
          label="احتياطي مخصص"
          value={money(financials.reserveMinor)}
          detail="لا يضاعف خصم الحجز"
          icon={<ShieldCheck size={18} />}
        />
        <Metric
          label="التزامات قائمة"
          value={money(
            sumMinor(
              liabilities.filter(
                row => row.status === "قائم" || row.status === "مفتوح"
              )
            )
          )}
          detail="من سجل الالتزامات المصنف"
          icon={<Archive size={18} />}
        />
        <Metric
          label="توقع معلن"
          value={money(financials.expectedMinor)}
          detail="افتراض محلي لا ضمان"
          icon={<BarChart3 size={18} />}
        />
      </div>
      <p
        className={
          feedback.tone === "error"
            ? "form-feedback form-feedback--error"
            : "form-feedback"
        }
      >
        {feedback.text}
      </p>
      <TabBar
        items={[
          { key: "الميزانية والسيولة", label: "الميزانية والسيولة" },
          { key: "كشف وإقفال", label: "كشف وإقفال" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "الميزانية والسيولة" ? (
        <>
          <div className="split-layout">
            <Panel
              title="ميزانية مقابل فعلي"
              description="الفعلي يطابق المحفظة والعقار والفترة وفئة/مفتاح البند. تداخل البنود غير المحددة يظهر «غير معروف» بدل تكرار نفس المصروف."
            >
              <FormDialog
                title="إضافة ميزانية"
                trigger={
                  <button className="btn-secondary" disabled={!canEdit}>
                    <Plus size={16} /> إضافة ميزانية
                  </button>
                }
                fields={[
                  { key: "title", label: "اسم البند", required: true },
                  {
                    key: "portfolioId",
                    label: "المحفظة",
                    type: "select",
                    options: selectOptions(
                      portfolios,
                      selectedPortfolioId === "all"
                        ? "اختر محفظة"
                        : "المحفظة الحالية"
                    ),
                    defaultValue:
                      selectedPortfolioId === "all" ? "" : selectedPortfolioId,
                  },
                  {
                    key: "propertyId",
                    label: "العقار (اختياري ضمن المحفظة)",
                    type: "select",
                    options: selectOptions(properties, "كل عقارات المحفظة"),
                  },
                  {
                    key: "category",
                    label: "فئة التكلفة/الدخل",
                    type: "select",
                    options: [
                      { value: "تشغيل", label: "تشغيل" },
                      { value: "دخل", label: "دخل" },
                      {
                        value: "رأسمالي",
                        label: "رأسمالي · من سجل فعلي مصنف فقط",
                      },
                    ],
                  },
                  {
                    key: "matchCategory",
                    label: "فئة مطابقة صريحة (اختياري)",
                    placeholder: "مثال: صيانة تشغيلية",
                  },
                  {
                    key: "itemKey",
                    label: "مفتاح بند صريح بديل (اختياري)",
                    placeholder: "مثال: utilities",
                  },
                  {
                    key: "basis",
                    label: "أساس دخل اختياري",
                    type: "select",
                    options: [
                      { value: "", label: "النقد المؤكد افتراضيًا" },
                      {
                        value: "income_cash",
                        label: "income_cash · تحصيل نقدي",
                      },
                      {
                        value: "income_accrual",
                        label: "income_accrual · استحقاقات",
                      },
                    ],
                  },
                  {
                    key: "amount",
                    label: "المبلغ (ر.ق)",
                    type: "number",
                    required: true,
                  },
                  {
                    key: "date",
                    label: "تاريخ الخطة",
                    type: "date",
                    defaultValue: asOf,
                  },
                  { key: "note", label: "فرضية", type: "textarea" },
                ]}
                submitLabel="حفظ محلي"
                onSubmit={createBudget}
              />
              <EntityTable
                rows={varianceRows}
                empty="لا توجد ميزانية في النطاق والفترة."
                columns={[
                  { key: "item", label: "البند", render: row => row.title },
                  {
                    key: "budget",
                    label: "الميزانية",
                    render: row => money(row.amountMinor),
                  },
                  {
                    key: "actual",
                    label: "الفعلي",
                    render: row =>
                      row.meta.actualStatus === "unknown" ? (
                        <span title={String(row.meta.actualNote)}>
                          غير معروف
                        </span>
                      ) : (
                        <>
                          {money(Number(row.meta.actualMinor))}
                          <span className="muted">
                            {row.meta.actualBasis === "income_cash"
                              ? "تحصيل نقدي"
                              : row.meta.actualBasis === "income_accrual"
                                ? "استحقاق"
                                : row.meta.actualBasis === "expense_capital"
                                  ? "رأسمالي مصنف"
                                  : "تشغيلي"}
                          </span>
                        </>
                      ),
                  },
                  {
                    key: "variance",
                    label: "الفرق",
                    render: row =>
                      row.meta.actualStatus === "unknown" ? (
                        <span
                          className="muted"
                          title={String(row.meta.actualNote)}
                        >
                          غير معروف · {String(row.meta.actualNote)}
                        </span>
                      ) : (
                        varianceDisplay(
                          String(row.meta.category),
                          Number(row.meta.varianceMinor)
                        )
                      ),
                  },
                ]}
              />
            </Panel>
            <Panel
              title="الاحتياطي والالتزام"
              description="تُعرض الحجوزات منفصلة حتى لا يُخصم تأمين أو التزام مغطى مرتين من النقد الحر."
            >
              <FormDialog
                title="تخصيص احتياطي"
                trigger={
                  <button className="btn-secondary" disabled={!canEdit}>
                    <ShieldCheck size={16} /> تخصيص احتياطي
                  </button>
                }
                fields={[
                  {
                    key: "title",
                    label: "اسم الاحتياطي",
                    required: true,
                    placeholder: "احتياطي صيانة",
                  },
                  {
                    key: "portfolioId",
                    label: "المحفظة",
                    type: "select",
                    options: selectOptions(portfolios, "المحفظة الحالية"),
                  },
                  {
                    key: "amount",
                    label: "المبلغ (ر.ق)",
                    type: "number",
                    required: true,
                  },
                  { key: "purpose", label: "الغرض" },
                ]}
                submitLabel="تخصيص محلي"
                onSubmit={createReserve}
              />
              <EntityTable
                rows={reserves}
                empty="لا توجد احتياطيات في الفترة."
                columns={[
                  {
                    key: "reserve",
                    label: "الاحتياطي",
                    render: row => row.title,
                  },
                  {
                    key: "amount",
                    label: "القيمة",
                    render: row => money(row.amountMinor),
                  },
                  {
                    key: "purpose",
                    label: "الغرض",
                    render: row => entityMeta(row, "purpose"),
                  },
                  {
                    key: "status",
                    label: "الحالة",
                    render: row => <StatusBadge status={row.status} />,
                  },
                ]}
              />
            </Panel>
          </div>
          <Panel
            title="لقطة السيولة"
            description={`لقطة نموذج محلي كما في ${financials.currentAsOf}. النقد الحر يختلف عن حركة الفترة والتوقع، ولا يمثل رصيد بنك.`}
          >
            <div className="summary-list">
              <span>
                الرصيد النقدي كما في {financials.currentAsOf}: {" "}
                <strong>{money(financials.cashAsOfMinor)}</strong>
              </span>
              <span>
                تأمين/نقد مقيد:{" "}
                <strong>{money(financials.depositMinor)}</strong>
              </span>
              <span>
                احتياطي: <strong>{money(financials.reserveMinor)}</strong>
              </span>
              <span>
                نقد حر كما في {financials.currentAsOf}: {" "}
                <strong>{money(financials.freeCashAsOfMinor)}</strong>
              </span>
              <span>
                توقع: <strong>{money(financials.expectedMinor)}</strong>
              </span>
            </div>
          </Panel>
        </>
      ) : (
        <>
          <Panel
            title="كشف مالك تجريبي"
            description="كشف بروتوتايب يوضح حركة الفترة ورصيد إقفالها والمتبقي الحالي بتواريخ مختلفة؛ لا ينفذ توزيعًا أو تحويلًا أو موافقة خارجية."
          >
            <div className="summary-list">
              <span>
                المحفظة:{" "}
                <strong>
                  {state.settings.portfolioId &&
                  state.settings.portfolioId !== "all"
                    ? portfolioName(portfolios, state.settings.portfolioId)
                    : "كل المحافظ ضمن النطاق"}
                </strong>
              </span>
              <span>
                الفترة: <strong>{periodLabel}</strong>
              </span>
              <span>
                حركة تحصيل نقدي مؤكدة خلال الفترة:{" "}
                <strong>{money(financials.incomeMinor)}</strong>
              </span>
              <span>
                دخل على أساس الاستحقاق خلال الفترة:{" "}
                <strong>{money(financials.accrualIncomeMinor)}</strong>
              </span>
              <span>
                رصيد نهاية الفترة للاستحقاقات ({financials.periodClosingAsOf}):{" "}
                <strong>{money(financials.periodClosingOutstandingMinor)}</strong>
              </span>
              <span>
                المتبقي الحالي لاستحقاقات الفترة، كما في {financials.currentAsOf}:{" "}
                <strong>{money(financials.currentAsOfOutstandingMinor)}</strong>
              </span>
              <span>
                مصروف تشغيلي مسدد خلال الفترة: {" "}
                <strong>{money(financials.expenseMinor)}</strong>
              </span>
              <span>
                رأسمالي مسدد خلال الفترة: {" "}
                <strong>{money(financials.capitalExpenseMinor)}</strong>
              </span>
              <span>
                خسائر مسجلة خلال الفترة: <strong>{money(financials.lossMinor)}</strong>
              </span>
              <span>
                استردادات خلال الفترة: {" "}
                <strong>{money(financials.recoveryMinor)}</strong>
              </span>
              <span>
                صافي خسارة الفترة (خسائر − استردادات): {" "}
                <strong>{money(financials.lossMinor - financials.recoveryMinor)}</strong>
              </span>
              <span>
                نقد حر (لقطة كما في {financials.currentAsOf}):{" "}
                <strong>{money(financials.freeCashAsOfMinor)}</strong>
              </span>
            </div>
            <div className="button-row">
              <button className="btn-primary" onClick={makeStatementExport}>
                <FileDown size={16} /> إنشاء CSV محلي
              </button>
              {exportUrl ? (
                <a
                  className="btn-secondary"
                  href={exportUrl}
                  download={`كشف-تجريبي-${period}.csv`}
                >
                  <Download size={16} /> تنزيل نسخة التقرير
                </a>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="علامة متابعة الفترة"
            description="علامة متابعة تجريبية لا تمنع التعديل أو الإضافة، وليست إقفالًا لدفتر فعلي أو نظام محاسبي خارجي."
          >
            <p className="muted">
              الحالة:{" "}
              {!canMarkPeriod ? (
                "اختر محفظة صريحة أولًا؛ لا توجد علامة عامة لكل المحافظ."
              ) : closedMarker ? (
                <StatusBadge status="علامة متابعة موجودة" />
              ) : (
                <StatusBadge status="بلا علامة متابعة" />
              )}
            </p>
            <div className="button-row">
              <button
                className="btn-primary"
                disabled={!canEdit || !canMarkPeriod || Boolean(closedMarker)}
                onClick={closePeriod}
              >
                <Lock size={16} /> وضع علامة متابعة
              </button>
              <FormDialog
                title="ملاحظة متابعة مؤرخة"
                description="لا تعدل هذه الملاحظة أي سجل ولا تتطلب إقفالًا فعليًا؛ هي شرح محلي تابع للعلامة التجريبية."
                trigger={
                  <button
                    className="btn-secondary"
                    disabled={!canEdit || !closedMarker}
                  >
                    <Unlock size={16} /> إضافة ملاحظة متابعة
                  </button>
                }
                fields={[
                  { key: "title", label: "مرجع الملاحظة", required: true },
                  {
                    key: "note",
                    label: "سبب الملاحظة",
                    type: "textarea",
                    required: true,
                  },
                ]}
                submitLabel="تسجيل الملاحظة"
                onSubmit={values => {
                  requireEditPermission(canEdit);
                  if (!closedMarker || !canMarkPeriod)
                    throw new Error(
                      "ضع علامة متابعة لمحفظة صريحة قبل إضافة ملاحظة تابعة لها."
                    );
                  add(
                    "journal",
                    entityInput(value(values, "title"), {
                      subtitle: "ملاحظة بعد علامة متابعة تجريبية",
                      portfolioId: selectedPortfolioId,
                      status: "ملاحظة متابعة مؤرخة",
                      date: DEMO_DATE,
                      amountMinor: 0,
                      meta: {
                        period,
                        followsPrototypeMarker: true,
                        note: value(values, "note"),
                      },
                    })
                  );
                  setFeedback({
                    tone: "ok",
                    text: "أضيفت ملاحظة متابعة مؤرخة؛ علامة المتابعة التجريبية لا تمنع التعديل.",
                  });
                }}
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

export function VacancyPage() {
  const { state, filtered, list, commitTransition, canEdit } = usePrototype();
  const portfolios = list("portfolios");
  const properties = filtered("properties");
  const units = filtered("units");
  const vacancies = scopedRows(filtered("vacancies"), state.settings);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "الشغور تقدير تشغيلي فقط؛ لا ينشئ إيراد إيجار أو ذمة أو قيدًا ماليًا.",
  });
  const activeVacancies = vacancies.filter(row => row.status !== "منتهٍ");
  const activeLostIncomeMinor = sumMinor(activeVacancies);

  const addVacancy = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const item = commitTransition(current =>
      createLeaseVacancy(current, values)
    );
    setFeedback({
      tone: "ok",
      text: `سُجل «${item.title}» كشغور محلي بعد فحص العقد النافذ وربط العقار/الوحدة. الدخل الضائع ${money(item.amountMinor)} تقديري فقط ولا يدخل الدفتر أو التحصيل.`,
    });
  };

  const endVacancy = (
    vacancy: ReturnType<typeof filtered>[number],
    values: Record<string, string>
  ) => {
    requireEditPermission(canEdit);
    const ended = commitTransition(current =>
      endLeaseVacancy(current, vacancy.id, values)
    );
    setFeedback({
      tone: "ok",
      text: `أُنهي سجل الشغور «${ended.title}» محليًا. تُشتق حالة الوحدة من وجود عقد نافذ في تاريخ الإنهاء، ولا تُضبط «مؤجرة» بلا عقد. لم يُنشأ إيراد أو ذمة.`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F14 / الشغور والتجهيز"
        title="إدارة الشغور"
        description="سبب ومدة وتجهيز ودخل ضائع تقديري، مع فصل كامل عن إيراد العقد والذمم."
      />
      <DemoNotice mode="interactive">
        الشغور هنا سجل تشغيل محلي. التقدير لا يعني دخلًا فعليًا أو مطالبة، ولا
        ينشر إعلانًا أو يغير عقدًا تلقائيًا.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="سجلات شغور نشطة"
          value={String(activeVacancies.length)}
          detail="كل حالة غير منتهية ضمن النطاق والفترة"
          icon={<Archive size={18} />}
        />
        <Metric
          label="دخل ضائع تقديري"
          value={money(activeLostIncomeMinor)}
          detail="مجموع amountMinor النشط؛ ليس إيرادًا أو ذمة"
          icon={<TrendingDown size={18} />}
        />
        <Metric
          label="قيد التجهيز"
          value={String(
            activeVacancies.filter(row => row.status === "قيد التجهيز").length
          )}
          detail="حالة تشغيلية نشطة"
          icon={<CalendarDays size={18} />}
        />
      </div>
      <p
        className={
          feedback.tone === "error"
            ? "form-feedback form-feedback--error"
            : "form-feedback"
        }
      >
        {feedback.text}
      </p>
      <Panel
        title="إضافة سجل شغور"
        description="العقار مطلوب، والوحدة اختيارية لكنها يجب أن تتبع العقار والمحفظة نفسيهما؛ عند ربطها تصبح «شاغرة» داخل ملف الأصل."
      >
        <FormDialog
          title="تسجيل شغور"
          trigger={
            <button className="btn-primary" disabled={!canEdit}>
              <Plus size={16} /> إضافة شغور
            </button>
          }
          fields={[
            {
              key: "title",
              label: "عنوان السجل",
              required: true,
              placeholder: "شغور شقة 302",
            },
            {
              key: "propertyId",
              label: "العقار",
              type: "select",
              options: selectOptions(properties, "اختر العقار"),
              required: true,
            },
            {
              key: "unitId",
              label: "الوحدة (من العقار نفسه)",
              type: "select",
              options: selectOptions(units, "بدون ربط وحدة"),
            },
            {
              key: "startDate",
              label: "بداية الشغور",
              type: "date",
              required: true,
              defaultValue: DEMO_DATE,
            },
            { key: "expectedReadyDate", label: "جاهزية متوقعة", type: "date" },
            {
              key: "reason",
              label: "السبب",
              type: "select",
              options: [
                { value: "انتهاء عقد", label: "انتهاء عقد" },
                { value: "تجهيز", label: "تجهيز" },
                { value: "صيانة", label: "صيانة" },
                { value: "سبب آخر", label: "سبب آخر" },
              ],
            },
            { key: "preparation", label: "خطة التجهيز", type: "textarea" },
            {
              key: "lostIncome",
              label: "دخل ضائع تقديري (ر.ق)",
              type: "number",
              defaultValue: "0",
            },
            {
              key: "requestId",
              label: "معرف عملية لإعادة المحاولة الآمنة (اختياري)",
              placeholder: "VAC-2026-10-24-01",
            },
          ]}
          submitLabel="حفظ سجل الشغور"
          onSubmit={addVacancy}
        />
      </Panel>
      <Panel
        title="سجل الشغور"
        description="ينهي السجل حالة الشغور محليًا فقط؛ لا ينشئ عقدًا أو دخلًا أو تحويلًا."
      >
        <EntityTable
          rows={vacancies}
          empty="لا توجد سجلات شغور في نطاق المحفظة والفترة الحاليين."
          columns={[
            {
              key: "vacancy",
              label: "السجل",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "reason", row.subtitle)}
                  </span>
                </>
              ),
            },
            {
              key: "period",
              label: "الفترة",
              render: row =>
                `${vacancyStartDate(row)} ← ${entityMeta(row, "expectedReadyDate", "غير محدد")}`,
            },
            {
              key: "preparation",
              label: "التجهيز",
              render: row => entityMeta(row, "preparation", "لا توجد خطة"),
            },
            {
              key: "lost",
              label: "تقدير ضائع",
              render: row => money(row.amountMinor),
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <StatusBadge status={row.status} />,
            },
            {
              key: "action",
              label: "إجراء",
              render: row => (
                <FormDialog
                  title={`إنهاء شغور: ${row.title}`}
                  trigger={
                    <button
                      className="btn-ghost"
                      disabled={!canEdit || row.status === "منتهٍ"}
                    >
                      إنهاء محلي
                    </button>
                  }
                  fields={[
                    {
                      key: "endDate",
                      label: "تاريخ الانتهاء",
                      type: "date",
                      defaultValue: DEMO_DATE,
                    },
                    { key: "note", label: "ملاحظة الجاهزية", type: "textarea" },
                    {
                      key: "requestId",
                      label: "معرف عملية لإعادة المحاولة الآمنة (اختياري)",
                      placeholder: "VAC-END-2026-10-24-01",
                    },
                  ]}
                  submitLabel="إنهاء السجل"
                  onSubmit={values => endVacancy(row, values)}
                />
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
