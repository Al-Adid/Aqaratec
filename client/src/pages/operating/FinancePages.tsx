import { MaintenanceExpenseSettlement } from "@/components/app/MaintenanceExpenseSettlement";
import { useMemo, useState } from "react";
import {
  Banknote,
  BookOpenCheck,
  Calculator,
  CheckCheck,
  CircleDollarSign,
  FileScan,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  confirmed,
  financialSummary,
  isActiveReceivable,
  isCancelledFinancialRecord,
  sourceEventId,
  sourceEventReference,
} from "@/lib/prototype-finance";
import {
  DemoNotice,
  EmptyState,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import type { DemoEntity } from "@shared/prototype";
import { money } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  DEMO_DATE,
  StatusBadge,
  entityInput,
  entityMeta,
  formMinor,
  idSuffix,
  portfolioName,
  scopedRows,
  selectOptions,
  sumMinor,
  value,
} from "./operatingUtils";

type Feedback = { tone: "ok" | "error"; text: string };
type LedgerLine = {
  id: string;
  date: string;
  ref: string;
  label: string;
  debit: string;
  credit: string;
  amountMinor: number;
  portfolioId: string;
  source: string;
};

/** The demo ledger is an explanatory, balanced projection of local records — never a bank or accounting-system source. */
export function ledgerFromRecords(records: {
  receivables: DemoEntity[];
  collections: DemoEntity[];
  expenses: DemoEntity[];
  losses: DemoEntity[];
  journal: DemoEntity[];
  payments?: DemoEntity[];
}): LedgerLine[] {
  const lines: LedgerLine[] = [];
  const emittedEvents = new Set<string>();
  const pushPair = (
    source: DemoEntity,
    label: string,
    debit: string,
    credit: string,
    kind: string
  ) => {
    const eventId = sourceEventId(source, kind);
    if (emittedEvents.has(eventId)) return;
    emittedEvents.add(eventId);
    lines.push({
      id: `ledger-${eventId}`,
      date: source.date,
      ref: sourceEventReference(source, idSuffix(source.id)),
      label,
      debit,
      credit,
      amountMinor: source.amountMinor,
      portfolioId: source.portfolioId,
      source: kind,
    });
  };
  // The classified journal is the canonical display when it mirrors another
  // local record under the same sourceEventId.
  records.journal
    .filter(row => !isCancelledFinancialRecord(row))
    .forEach(row =>
      pushPair(
        row,
        row.title,
        entityMeta(row, "debitAccount", "حساب مدين"),
        entityMeta(row, "creditAccount", "حساب دائن"),
        "قيد مصنف"
      )
    );
  records.receivables
    .filter(isActiveReceivable)
    .forEach(row =>
      pushPair(row, row.title, "ذمم مدينة", "إيراد إيجار مستحق", "استحقاق")
    );
  records.collections
    .filter(confirmed)
    .forEach(row =>
      pushPair(row, row.title, "نقد/بنك تجريبي", "ذمم مدينة", "تحصيل مؤكد")
    );
  records.expenses
    .filter(row => row.status !== "مرفوض" && !isCancelledFinancialRecord(row))
    .forEach(row => {
      const category = entityMeta(
        row,
        "classification",
        entityMeta(row, "category", "مصروف تشغيلي")
      );
      if (category !== "رأسمالي")
        pushPair(
          row,
          row.title,
          category,
          entityMeta(row, "settlement", "ذمم موردين"),
          "مصروف"
        );
    });
  (records.payments ?? [])
    .filter(
      row =>
        row.meta.expenseId &&
        row.meta.externalTransfer === false &&
        !isCancelledFinancialRecord(row)
    )
    .forEach(row =>
      pushPair(row, row.title, "ذمم موردين", "نقد/بنك تجريبي", "تسوية مصروف")
    );
  records.losses
    .filter(row => !isCancelledFinancialRecord(row))
    .forEach(row =>
      pushPair(row, row.title, "خسارة ذمم", "ذمم مدينة", "خسارة")
    );
  return lines.sort((a, b) => b.date.localeCompare(a.date));
}

export function FinancePage() {
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
    [asOf, state.entities, state.settings.period, state.settings.portfolioId]
  );
  const portfolios = list("portfolios");
  const receivables = scopedRows(filtered("receivables"), state.settings);
  const collections = scopedRows(filtered("collections"), state.settings);
  const expenses = scopedRows(filtered("expenses"), state.settings);
  const losses = scopedRows(filtered("losses"), state.settings);
  const journal = scopedRows(filtered("journal"), state.settings);
  const payments = scopedRows(filtered("payments"), state.settings);
  const liabilities = scopedRows(filtered("liabilities"), state.settings);
  const ledger = useMemo(
    () =>
      ledgerFromRecords({
        receivables,
        collections,
        expenses,
        losses,
        journal,
        payments,
      }),
    [receivables, collections, expenses, losses, journal, payments]
  );
  const totalDebit = ledger.reduce((total, row) => total + row.amountMinor, 0);
  const totalCredit = ledger.reduce((total, row) => total + row.amountMinor, 0);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "الدفتر أدناه شرح متوازن مشتق من سجلات التجربة، وليس مصدرًا محاسبيًا فعليًا.",
  });

  const addClassification = (values: Record<string, string>) => {
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({
        tone: "error",
        text: "أدخل مبلغًا صحيحًا موجبًا بوحدة ر.ق.",
      });
    const classification = value(values, "classification", "فائدة");
    const portfolioId =
      value(values, "portfolioId") || state.settings.portfolioId;
    const title = value(values, "title", `${classification} تجريبي`);
    const date = value(values, "date", asOf);
    const eventRef = `FIN-${Date.now().toString(36).toUpperCase()}`;
    const eventId = `financial-${eventRef}`;
    const account =
      classification === "قرض مستلم"
        ? ["نقد/بنك تجريبي", "التزام قرض"]
        : classification === "سداد أصل قرض"
          ? ["التزام قرض", "نقد/بنك تجريبي"]
          : classification === "فائدة"
            ? ["مصروف فائدة", "ذمم/نقد تجريبي"]
            : classification === "تأمين مستأجر"
              ? ["نقد مقيد تجريبي", "تأمينات مستردة"]
              : classification === "مقدم إيجار"
                ? ["نقد/ذمم تجريبي", "إيراد مؤجل"]
                : ["أصل رأسمالي", "ذمم موردين"];

    if (
      classification === "قرض مستلم" ||
      classification === "سداد أصل قرض" ||
      classification === "تأمين مستأجر" ||
      classification === "مقدم إيجار"
    ) {
      add(
        "liabilities",
        entityInput(title, {
          subtitle: classification,
          portfolioId,
          status: classification === "سداد أصل قرض" ? "سدد جزئيًا" : "مفتوح",
          date,
          amountMinor: amount,
          meta: {
            classification,
            note: value(values, "note"),
            treatment: "التزام مستقل · لا يعد إيرادًا أو مصروف تشغيل",
          },
        })
      );
    }
    if (classification === "فائدة") {
      add(
        "expenses",
        entityInput(title, {
          subtitle: "مصروف فائدة تجريبي",
          portfolioId,
          status: "معتمد",
          date,
          amountMinor: amount,
          meta: {
            classification: "مصروف فائدة",
            settlement: "ذمم/نقد تجريبي",
            sourceEventId: eventId,
            sourceEventRef: eventRef,
            note: value(values, "note"),
          },
        })
      );
    }
    add(
      "journal",
      entityInput(title, {
        subtitle: "قيد شرح تجريبي متوازن",
        portfolioId,
        status: "مراجَع",
        date,
        amountMinor: amount,
        meta: {
          classification,
          debitAccount: account[0],
          creditAccount: account[1],
          note: value(values, "note"),
          source: "تصنيف مالي محلي",
          sourceEventId: eventId,
          sourceEventRef: eventRef,
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `أضيف تصنيف «${classification}» وقيد شرح متوازن بقيمة ${money(amount)}. ${classification === "رأسمالي" ? "لم يُسجل كمصروف تشغيلي." : "التصنيف محلي ولا يمثل ترحيلًا رسميًا."}`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F07 / الدفتر والتصنيف"
        title="المالية والدفتر"
        description="فصل محلي بين الاستحقاق والنقد والتزام القرض والتأمين والإيراد المؤجل والرأسمالي وفق تاريخ سيناريو معلن."
      />
      <DemoNotice mode="simulation">
        هذا دفتر شرح تجريبي. كل سطر يعرض زوجًا متوازنًا مشتقًا من سجلات النموذج،
        ولا يثبت مصدر بنك أو نظام محاسبي حقيقي.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label={`لقطة نقد مؤكدة كما في ${financials.currentAsOf}`}
          value={money(financials.cashAsOfMinor)}
          detail="لا يتضمن شيكًا مستلمًا/مودعًا ولا يمثل رصيد بنك"
          icon={<Banknote size={18} />}
        />
        <Metric
          label="تحصيل نقدي مؤكد"
          value={money(financials.incomeMinor)}
          detail="incomeMinor: تحصيلات مؤكدة فقط، لا استحقاقات"
          icon={<BookOpenCheck size={18} />}
        />
        <Metric
          label="دخل على أساس الاستحقاق"
          value={money(financials.accrualIncomeMinor)}
          detail="accrualIncomeMinor: استحقاقات الإيجار ضمن الفترة"
          icon={<CircleDollarSign size={18} />}
        />
        <Metric
          label="مصروف تشغيلي مسدد خلال الفترة"
          value={money(financials.expenseMinor)}
          detail={`لا يشمل رأسماليًا مسددًا ${money(financials.capitalExpenseMinor)}`}
          icon={<ReceiptText size={18} />}
        />
        <Metric
          label="نقد حر"
          value={money(financials.freeCashMinor)}
          detail="بعد الحجوزات غير المتداخلة"
          icon={<WalletCards size={18} />}
        />
      </div>
      <Panel
        title="إدخال تصنيف مالي"
        description="القرض ليس إيرادًا، أصل القرض ليس مصروفًا، والتأمين/المقدم التزامات. التحسين الرأسمالي لا يختبئ ضمن الصيانة."
      >
        <p
          className={
            feedback.tone === "error"
              ? "form-feedback form-feedback--error"
              : "form-feedback"
          }
        >
          {feedback.text}
        </p>
        <FormDialog
          title="إضافة معالجة مالية تجريبية"
          description="ينشئ سجل تصنيف وقيد شرح متوازن محليًا؛ لا يحرك بنكًا ولا ينفذ دفعًا."
          trigger={
            <button className="btn-primary" disabled={!canEdit}>
              <Plus size={16} /> إضافة معالجة
            </button>
          }
          fields={[
            {
              key: "title",
              label: "المرجع",
              required: true,
              placeholder: "مثال: قسط قرض أكتوبر",
            },
            {
              key: "portfolioId",
              label: "المحفظة",
              type: "select",
              options: selectOptions(portfolios, "المحفظة الحالية"),
            },
            {
              key: "classification",
              label: "التصنيف",
              type: "select",
              options: [
                { value: "قرض مستلم", label: "قرض مستلم · التزام لا إيراد" },
                {
                  value: "سداد أصل قرض",
                  label: "سداد أصل قرض · خفض التزام لا مصروف",
                },
                { value: "فائدة", label: "فائدة · مصروف منفصل" },
                {
                  value: "تأمين مستأجر",
                  label: "تأمين مستأجر · نقد مقيد/التزام",
                },
                { value: "مقدم إيجار", label: "مقدم إيجار · إيراد مؤجل" },
                { value: "رأسمالي", label: "تحسين رأسمالي · أصل لا صيانة" },
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
              label: "تاريخ الأثر",
              type: "date",
              defaultValue: asOf,
            },
            { key: "note", label: "ملاحظة معالجة", type: "textarea" },
          ]}
          submitLabel="إضافة محلية"
          onSubmit={addClassification}
        />
      </Panel>
      <div className="split-layout">
        <Panel
          title="نقد مقابل استحقاق"
          description="الاستحقاق ينشأ قبل الدفع، والتحصيل المؤكد فقط ينعكس كنقد في النموذج."
        >
          <div className="summary-list">
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
              خسائر مسجلة: <strong>{money(financials.lossMinor)}</strong>
            </span>
            <span>
              استردادات: <strong>{money(financials.recoveryMinor)}</strong>
            </span>
            <span>
              تأمينات/حجوزات: <strong>{money(financials.depositMinor)}</strong>
            </span>
          </div>
        </Panel>
        <Panel
          title="التزامات مصنفة"
          description="لا تحول هذه القائمة الالتزام إلى نقد أو مصروف دون حالة تسوية واضحة."
        >
          <EntityTable
            rows={liabilities}
            empty="لا توجد التزامات مصنفة في الفترة الحالية."
            columns={[
              { key: "item", label: "البند", render: row => row.title },
              {
                key: "class",
                label: "التصنيف",
                render: row => entityMeta(row, "classification", row.subtitle),
              },
              {
                key: "amount",
                label: "القيمة",
                render: row => money(row.amountMinor),
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
        title="دفتر الشرح المتوازن"
        description={`المدين ${money(totalDebit)} = الدائن ${money(totalCredit)}. كل sourceEventId يمثل حدثًا واحدًا؛ الدفتر بروتوتايب تفسيري وليس GL إنتاجيًا أو تقريرًا رسميًا.`}
      >
        <EntityTable
          rows={ledger as unknown as DemoEntity[]}
          empty="لا توجد سجلات مالية مشتقة في النطاق الحالي."
          columns={[
            {
              key: "date",
              label: "التاريخ",
              render: row => (row as unknown as LedgerLine).date,
            },
            {
              key: "ref",
              label: "مرجع",
              render: row => (row as unknown as LedgerLine).ref,
            },
            {
              key: "label",
              label: "الوصف",
              render: row => (row as unknown as LedgerLine).label,
            },
            {
              key: "debit",
              label: "مدين",
              render: row => (
                <>
                  {(row as unknown as LedgerLine).debit}
                  <br />
                  <strong>
                    {money((row as unknown as LedgerLine).amountMinor)}
                  </strong>
                </>
              ),
            },
            {
              key: "credit",
              label: "دائن",
              render: row => (
                <>
                  {(row as unknown as LedgerLine).credit}
                  <br />
                  <strong>
                    {money((row as unknown as LedgerLine).amountMinor)}
                  </strong>
                </>
              ),
            },
            {
              key: "source",
              label: "مصدر النموذج",
              render: row => (row as unknown as LedgerLine).source,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

export function ExpensesPage() {
  const { state, filtered, list, add, patch, canEdit } = usePrototype();
  const asOf = scenarioDate(state);
  const portfolios = list("portfolios");
  const expenses = scopedRows(filtered("expenses"), state.settings);
  const properties = filtered("properties");
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "يمكن إدخال اقتراح استخراج صوري ومراجعته قبل أن ينشئ أي مصروف.",
  });

  const saveExpense = (values: Record<string, string>, origin: string) => {
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({
        tone: "error",
        text: "المبلغ غير صالح؛ لم يُنشأ مصروف.",
      });
    const propertyId = value(values, "propertyId");
    const property = properties.find(row => row.id === propertyId);
    const classification = value(values, "classification", "تشغيلي");
    const item = add(
      "expenses",
      entityInput(value(values, "title"), {
        subtitle: `${classification} · ${origin}`,
        portfolioId:
          property?.portfolioId ||
          value(values, "portfolioId") ||
          state.settings.portfolioId,
        propertyId,
        status: "قيد المراجعة",
        date: value(values, "date", DEMO_DATE),
        amountMinor: amount,
        meta: {
          classification,
          category: classification,
          vendor: value(values, "vendor"),
          invoiceReference: value(values, "invoiceReference"),
          extractionOrigin: origin,
          settlement: "ذمم موردين",
          note: value(values, "note"),
        },
      })
    );
    setPreview(null);
    setFeedback({
      tone: "ok",
      text: `أضيف المصروف «${item.title}» للمراجعة بقيمة ${money(amount)}. لن ينشأ قيد من اقتراح الاستخراج وحده.`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F08 / الإيصالات والمصروفات"
        title="المصروفات واستخراج الإيصال"
        description="المعاينة الصورية تقترح حقولًا فقط؛ الاعتماد المحلي هو الذي ينشئ مصروفًا للتجربة."
      />
      <DemoNotice mode="simulation">
        لا رفع مستند حقيقي ولا OCR متصل. لا تتحول أي قراءة صورية إلى قيد أو دفع
        من تلقاء نفسها.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="مصروفات الفترة"
          value={money(sumMinor(expenses))}
          detail="تشمل سجلات محلية فقط"
          icon={<ReceiptText size={18} />}
        />
        <Metric
          label="قيد المراجعة"
          value={String(
            expenses.filter(row => row.status === "قيد المراجعة").length
          )}
          detail="تحتاج قرارًا يدويًا"
          icon={<ScanLine size={18} />}
        />
        <Metric
          label="مصنفة رأسماليًا"
          value={String(
            expenses.filter(
              row => entityMeta(row, "classification", "") === "رأسمالي"
            ).length
          )}
          detail="لا تعامل كصيانة دورية"
          icon={<Landmark size={18} />}
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
      <div className="split-layout">
        <Panel
          title="استخراج إيصال AI · قريبًا"
          description="استخراج OCR/AI مؤجل؛ لا توجد معالجة صورة أو ملف أو إنشاء مصروف من هذا المسار في المرحلة الأولى."
        >
          <FormDialog
            title="إنشاء اقتراح استخراج"
            trigger={
              <button
                className="btn-secondary"
                disabled
                title="استخراج OCR/AI مؤجل إلى مرحلة لاحقة."
              >
                <FileScan size={16} /> استخراج AI · قريبًا
              </button>
            }
            fields={[
              {
                key: "title",
                label: "وصف مقترح",
                required: true,
                placeholder: "صيانة مضخة · اقتراح",
              },
              {
                key: "amount",
                label: "مبلغ مقترح (ر.ق)",
                type: "number",
                required: true,
              },
              {
                key: "date",
                label: "تاريخ مقترح",
                type: "date",
                defaultValue: asOf,
              },
              { key: "vendor", label: "مورد مقترح" },
              { key: "invoiceReference", label: "رقم فاتورة مقترح" },
              {
                key: "classification",
                label: "تصنيف مقترح",
                type: "select",
                options: [
                  { value: "تشغيلي", label: "تشغيلي" },
                  { value: "مصروف فائدة", label: "فائدة" },
                  { value: "رأسمالي", label: "رأسمالي" },
                ],
              },
            ]}
            submitLabel="عرض الاقتراح"
            onSubmit={values => setPreview(values)}
          />
          {preview ? (
            <div className="preview-box">
              <span className="mini-label">اقتراح غير معتمد</span>
              <strong>{value(preview, "title")}</strong>
              <p className="muted">
                {value(preview, "vendor", "مورد غير محدد")} ·{" "}
                {value(preview, "amount")} ر.ق ·{" "}
                {value(preview, "classification", "تشغيلي")}
              </p>
              <FormDialog
                title="مراجعة واعتماد الاقتراح"
                description="راجع الحقول يدويًا؛ الاعتماد هنا ينشئ مصروفًا محليًا ولا يرحّل قيدًا رسميًا."
                trigger={
                  <button className="btn-primary" disabled={!canEdit}>
                    اعتماد بعد المراجعة
                  </button>
                }
                initialValues={preview}
                fields={[
                  { key: "title", label: "الوصف", required: true },
                  {
                    key: "amount",
                    label: "المبلغ (ر.ق)",
                    type: "number",
                    required: true,
                  },
                  { key: "date", label: "التاريخ", type: "date" },
                  {
                    key: "propertyId",
                    label: "العقار",
                    type: "select",
                    options: selectOptions(properties, "بدون ربط عقار"),
                  },
                  { key: "vendor", label: "المورد" },
                  { key: "invoiceReference", label: "مرجع الفاتورة" },
                  {
                    key: "classification",
                    label: "التصنيف",
                    type: "select",
                    options: [
                      { value: "تشغيلي", label: "تشغيلي" },
                      { value: "مصروف فائدة", label: "فائدة" },
                      { value: "رأسمالي", label: "رأسمالي" },
                    ],
                  },
                  { key: "note", label: "قرار المراجع", type: "textarea" },
                ]}
                submitLabel="إنشاء مصروف محلي"
                onSubmit={values =>
                  saveExpense(values, "اقتراح استخراج صوري مراجَع")
                }
              />
              <button className="btn-ghost" onClick={() => setPreview(null)}>
                رفض الاقتراح
              </button>
            </div>
          ) : (
            <p className="muted">لا يوجد اقتراح معلق.</p>
          )}
        </Panel>
        <Panel
          title="مصروف يدوي"
          description="إدخال يدوي بديل لا يدعي وجود فاتورة أو تسوية بنكية."
        >
          <FormDialog
            title="إضافة مصروف يدوي"
            trigger={
              <button className="btn-primary" disabled={!canEdit}>
                <Plus size={16} /> إضافة مصروف
              </button>
            }
            fields={[
              { key: "title", label: "الوصف", required: true },
              {
                key: "portfolioId",
                label: "المحفظة",
                type: "select",
                options: selectOptions(portfolios, "المحفظة الحالية"),
              },
              {
                key: "propertyId",
                label: "العقار",
                type: "select",
                options: selectOptions(properties, "بدون ربط عقار"),
              },
              {
                key: "amount",
                label: "المبلغ (ر.ق)",
                type: "number",
                required: true,
              },
              {
                key: "date",
                label: "التاريخ",
                type: "date",
                defaultValue: DEMO_DATE,
              },
              {
                key: "classification",
                label: "التصنيف",
                type: "select",
                options: [
                  { value: "تشغيلي", label: "تشغيلي" },
                  { value: "مصروف فائدة", label: "فائدة" },
                  { value: "رأسمالي", label: "رأسمالي" },
                ],
              },
              { key: "vendor", label: "المورد الصوري" },
              { key: "invoiceReference", label: "مرجع صوري" },
              { key: "note", label: "ملاحظة", type: "textarea" },
            ]}
            submitLabel="إضافة للمراجعة"
            onSubmit={values => saveExpense(values, "إدخال يدوي")}
          />
        </Panel>
      </div>
      <Panel
        title="سجل المصروفات"
        description="تحويل حالة السجل إجراء محلي ظاهر؛ الدفع الفعلي غير منفذ."
      >
        <EntityTable
          rows={expenses}
          empty="لا توجد مصروفات داخل النطاق والفترة الحاليين."
          columns={[
            {
              key: "expense",
              label: "المصروف",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "vendor", row.subtitle)}
                  </span>
                </>
              ),
            },
            {
              key: "classification",
              label: "التصنيف",
              render: row =>
                entityMeta(
                  row,
                  "classification",
                  entityMeta(row, "category", "تشغيلي")
                ),
            },
            {
              key: "amount",
              label: "المبلغ",
              render: row => money(row.amountMinor),
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <StatusBadge status={row.status} />,
            },
            {
              key: "action",
              label: "قرار",
              render: row =>
                row.meta.maintenanceId ? (
                  <MaintenanceExpenseSettlement expense={row} />
                ) : (
                  <FormDialog
                    title={`مراجعة: ${row.title}`}
                    trigger={
                      <button className="btn-ghost" disabled={!canEdit}>
                        تغيير الحالة
                      </button>
                    }
                    initialValues={{
                      status: row.status,
                      note: entityMeta(row, "reviewNote", ""),
                    }}
                    fields={[
                      {
                        key: "status",
                        label: "الحالة",
                        type: "select",
                        options: [
                          { value: "قيد المراجعة", label: "قيد المراجعة" },
                          { value: "معتمد", label: "معتمد" },
                          { value: "مسدد", label: "مسدد في النموذج" },
                          { value: "مرفوض", label: "مرفوض" },
                        ],
                      },
                      { key: "note", label: "قرار المراجعة", type: "textarea" },
                    ]}
                    submitLabel="حفظ الحالة"
                    onSubmit={values => {
                      patch("expenses", row.id, {
                        status: value(values, "status", row.status),
                        meta: {
                          ...row.meta,
                          reviewNote: value(values, "note"),
                        },
                      });
                      setFeedback({
                        tone: "ok",
                        text: `تم تحديث حالة «${row.title}» محليًا؛ لا ينفذ ذلك دفعًا خارجيًا.`,
                      });
                    }}
                  />
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

export function ReconciliationPage() {
  const { state, filtered, add, patch, canEdit } = usePrototype();
  const bankTransactions = scopedRows(
    filtered("bankTransactions"),
    state.settings
  );
  const collections = scopedRows(filtered("collections"), state.settings);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "استيراد كشف البنك هنا محاكاة يدوية؛ لا نقرأ ملفًا ولا نصل إلى بنك.",
  });

  const addStatementLine = (values: Record<string, string>) => {
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({ tone: "error", text: "المبلغ المقترح غير صالح." });
    add(
      "bankTransactions",
      entityInput(value(values, "title"), {
        subtitle: "سطر كشف صوري مستورد",
        portfolioId: state.settings.portfolioId,
        status: value(values, "flag", "غير مطابق"),
        date: value(values, "date", DEMO_DATE),
        amountMinor: amount,
        meta: {
          reference: value(values, "reference"),
          importMode: "محاكاة كشف يدوي",
          duplicateHint: value(values, "duplicateHint"),
        },
      })
    );
    setPreview(null);
    setFeedback({
      tone: "ok",
      text: `أضيف سطر كشف صوري بقيمة ${money(amount)} للمراجعة؛ لم يُنشأ تحصيل أو قيد جديد.`,
    });
  };

  const matchLine = (line: DemoEntity, values: Record<string, string>) => {
    const matchAmount = formMinor(values, "matchAmount");
    if (
      matchAmount === null ||
      matchAmount <= 0 ||
      matchAmount > line.amountMinor
    )
      return setFeedback({
        tone: "error",
        text: "مبلغ المطابقة يجب أن يكون موجبًا ولا يتجاوز قيمة سطر الكشف.",
      });
    const status = matchAmount === line.amountMinor ? "مطابق" : "مطابق جزئيًا";
    patch("bankTransactions", line.id, {
      status,
      meta: {
        ...line.meta,
        collectionId: value(values, "collectionId"),
        matchAmountMinor: matchAmount,
        matchMode: value(values, "matchMode", "واحد إلى واحد"),
        reviewedAt: DEMO_DATE,
      },
    });
    setFeedback({
      tone: "ok",
      text: `حُفظت مطابقة ${status} بقيمة ${money(matchAmount)} كربط مراجعة فقط؛ لم يُنشأ إيصال أو رصيد جديد.`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F09 / المطابقة"
        title="مطابقة كشف صوري"
        description="استيراد يدوي ومحاكاة مطابقة كاملة أو جزئية أو متعددة، مع إبقاء السند الأصلي دون تكرار."
      />
      <DemoNotice mode="simulation">
        لا رفع CSV/Excel حقيقي ولا قراءة بنك. السطور المستوردة هنا أمثلة محلية
        ولا تغير الرصيد قبل مراجعة صريحة.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="سطور كشف"
          value={String(bankTransactions.length)}
          detail="مستوردة تجريبيًا"
          icon={<Landmark size={18} />}
        />
        <Metric
          label="مطابقة"
          value={String(
            bankTransactions.filter(row => row.status === "مطابق").length
          )}
          detail="روابط مراجعة"
          icon={<CheckCheck size={18} />}
        />
        <Metric
          label="جزئية/استثناء"
          value={String(
            bankTransactions.filter(row => row.status !== "مطابق").length
          )}
          detail="تحتاج قرارًا بشريًا"
          icon={<ShieldCheck size={18} />}
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
        title="إدخال سطر كشف للمعاينة"
        description="يماثل مرحلة استيراد ملف دون ملف فعلي. راجع السطر ثم أضفه إلى قائمة المطابقة."
      >
        <FormDialog
          title="محاكاة صف كشف"
          trigger={
            <button className="btn-secondary" disabled={!canEdit}>
              <Plus size={16} /> صف كشف جديد
            </button>
          }
          fields={[
            { key: "title", label: "وصف السطر", required: true },
            {
              key: "date",
              label: "التاريخ",
              type: "date",
              defaultValue: DEMO_DATE,
            },
            {
              key: "amount",
              label: "المبلغ (ر.ق)",
              type: "number",
              required: true,
            },
            { key: "reference", label: "مرجع صوري" },
            {
              key: "flag",
              label: "علامة أولية",
              type: "select",
              options: [
                { value: "غير مطابق", label: "غير مطابق" },
                { value: "مكرر محتمل", label: "مكرر محتمل" },
                { value: "عكس محتمل", label: "عكس محتمل" },
              ],
            },
            { key: "duplicateHint", label: "ملاحظة استثناء", type: "textarea" },
          ]}
          submitLabel="عرض المعاينة"
          onSubmit={setPreview}
        />
        {preview ? (
          <div className="preview-box">
            <span className="mini-label">معاينة استيراد غير معتمدة</span>
            <strong>{value(preview, "title")}</strong>
            <p className="muted">
              {value(preview, "date")} · {value(preview, "amount")} ر.ق ·{" "}
              {value(preview, "flag", "غير مطابق")}
            </p>
            <button
              className="btn-primary"
              onClick={() => addStatementLine(preview)}
            >
              اعتماد السطر محليًا
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              إلغاء
            </button>
          </div>
        ) : null}
      </Panel>
      <Panel
        title="طابور المطابقة"
        description="يمكن ربط سطر بسند واحد أو تسجيل مطابقة جزئية/متعددة بصيغة وصفية؛ لا تنشئ المطابقة تحصيلًا ثانيًا."
      >
        <EntityTable
          rows={bankTransactions}
          empty="لا توجد سطور كشف صورية في النطاق والفترة الحاليين."
          columns={[
            {
              key: "line",
              label: "سطر الكشف",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "reference", "بلا مرجع")}
                  </span>
                </>
              ),
            },
            {
              key: "amount",
              label: "القيمة",
              render: row => money(row.amountMinor),
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <StatusBadge status={row.status} />,
            },
            {
              key: "match",
              label: "المطابقة",
              render: row => (
                <FormDialog
                  title={`مطابقة: ${row.title}`}
                  description="هذا ربط مراجعة فقط، ولا يخلق إيصالًا أو قيدًا جديدًا."
                  trigger={
                    <button className="btn-ghost" disabled={!canEdit}>
                      <RefreshCw size={14} /> مراجعة
                    </button>
                  }
                  fields={[
                    {
                      key: "collectionId",
                      label: "سند موجود",
                      type: "select",
                      options: selectOptions(collections, "اختر سندًا قائمًا"),
                    },
                    {
                      key: "matchAmount",
                      label: "مبلغ الربط (ر.ق)",
                      type: "number",
                      required: true,
                    },
                    {
                      key: "matchMode",
                      label: "نمط المطابقة",
                      type: "select",
                      options: [
                        { value: "واحد إلى واحد", label: "واحد إلى واحد" },
                        { value: "جزئية", label: "جزئية" },
                        {
                          value: "متعددة · وصف فقط",
                          label: "متعددة · وصف فقط",
                        },
                      ],
                    },
                    { key: "note", label: "ملاحظة استثناء", type: "textarea" },
                  ]}
                  submitLabel="حفظ الربط"
                  onSubmit={values => matchLine(row, values)}
                />
              ),
            },
            {
              key: "exception",
              label: "استثناء",
              render: row => (
                <FormDialog
                  title={`تمييز استثناء: ${row.title}`}
                  trigger={
                    <button className="btn-ghost" disabled={!canEdit}>
                      استثناء
                    </button>
                  }
                  fields={[
                    {
                      key: "status",
                      label: "الحالة",
                      type: "select",
                      options: [
                        { value: "غير مطابق", label: "غير مطابق" },
                        { value: "مكرر محتمل", label: "مكرر محتمل" },
                        { value: "عكس محتمل", label: "عكس محتمل" },
                      ],
                    },
                    {
                      key: "note",
                      label: "سبب المراجعة",
                      type: "textarea",
                      required: true,
                    },
                  ]}
                  submitLabel="حفظ الاستثناء"
                  onSubmit={values => {
                    patch("bankTransactions", row.id, {
                      status: value(values, "status", row.status),
                      meta: {
                        ...row.meta,
                        exceptionNote: value(values, "note"),
                      },
                    });
                    setFeedback({
                      tone: "ok",
                      text: `وُسم السطر «${row.title}» كاستثناء محليًا دون تغيير أرصدة.`,
                    });
                  }}
                />
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

export function PaymentsPage() {
  const { state, filtered, add, patch, canEdit } = usePrototype();
  const payments = scopedRows(filtered("payments"), state.settings);
  const receivables = scopedRows(filtered("receivables"), state.settings);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "دورة الدفع التالية محاكاة محلية ولا تفتح Checkout ولا تجمع بيانات بطاقة.",
  });
  const [tab, setTab] = useState("إيجار");
  const visiblePayments = payments.filter(
    row => entityMeta(row, "paymentType", "إيجار") === tab
  );

  const createPayment = (values: Record<string, string>) => {
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      return setFeedback({ tone: "error", text: "أدخل مبلغ تفويض صالحًا." });
    const paymentType = value(values, "paymentType", "إيجار");
    const created = add(
      "payments",
      entityInput(value(values, "title"), {
        subtitle: `${paymentType} · تفويض محاكى`,
        portfolioId: state.settings.portfolioId,
        status: "تفويض محاكى",
        date: DEMO_DATE,
        amountMinor: amount,
        meta: {
          paymentType,
          receivableId: value(values, "receivableId"),
          providerReference: value(
            values,
            "providerReference",
            `SIM-${Date.now().toString().slice(-6)}`
          ),
          feesMinor: 0,
          flow: "لا مزود ولا بطاقة ولا تحويل",
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `أنشئ تفويض محاكى «${created.title}» بقيمة ${money(amount)}. لا يعد تحصيلًا أو رصيد بنك.`,
    });
  };

  const updatePayment = (
    payment: DemoEntity,
    values: Record<string, string>
  ) => {
    const action = value(values, "action");
    const fee = formMinor(values, "fee") ?? 0;
    const status =
      action === "تسوية"
        ? "مُسوّى لدى مزود محاكى"
        : action === "رد"
          ? "رد محاكى"
          : "ملغي محاكاة";
    patch("payments", payment.id, {
      status,
      meta: {
        ...payment.meta,
        feesMinor: fee,
        settlementReference: value(values, "reference"),
        actionNote: value(values, "note"),
        bankTransfer: "غير منفذ · محاكاة فقط",
      },
    });
    setFeedback({
      tone: "ok",
      text: `${status} للدفع ${payment.title}. ${action === "تسوية" ? "تظهر الرسوم منفصلة ولا يعني ذلك تحويلًا للبنك." : "لم يرسل النموذج ردًا أو إلغاءً خارجيًا."}`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F10 / دورة دفع محاكاة"
        title="روابط الدفع والتسوية"
        description="تفويض وتسوية ورسوم ورد محاكى مع فصل إيجار العقار عن اشتراك المنصة."
      />
      <DemoNotice mode="external">
        لا يوجد Checkout أو مزود دفع أو بطاقة أو تحويل. كل زر يغيّر سجلًا محليًا
        مرئيًا فقط، ولا يعني حالة خارجية.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="تفويضات محاكاة"
          value={String(
            payments.filter(row => row.status === "تفويض محاكى").length
          )}
          detail="ليست تحصيلًا"
          icon={<WalletCards size={18} />}
        />
        <Metric
          label="تسويات مزود محاكاة"
          value={String(
            payments.filter(row => row.status === "مُسوّى لدى مزود محاكى")
              .length
          )}
          detail="لا تعني تحويل بنك"
          icon={<CheckCheck size={18} />}
        />
        <Metric
          label="رسوم ظاهرة"
          value={money(
            payments.reduce(
              (total, row) =>
                total + Number(row.meta.feesMinor ?? row.meta.feeMinor ?? 0),
              0
            )
          )}
          detail="من سجلات المحاكاة"
          icon={<Calculator size={18} />}
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
        title="إنشاء رابط دفع محاكى"
        description="نوع «اشتراك منصة» منفصل تمامًا عن أموال الإيجار ولا يختلط بهما."
      >
        <FormDialog
          title="تفويض دفع محاكى"
          trigger={
            <button className="btn-primary" disabled={!canEdit}>
              <Plus size={16} /> إنشاء محاكاة
            </button>
          }
          fields={[
            { key: "title", label: "وصف الرابط", required: true },
            {
              key: "paymentType",
              label: "نوع المبلغ",
              type: "select",
              options: [
                { value: "إيجار", label: "إيجار عقار" },
                { value: "اشتراك منصة", label: "اشتراك منصة · منفصل" },
              ],
            },
            {
              key: "receivableId",
              label: "استحقاق إيجار (إن وجد)",
              type: "select",
              options: selectOptions(receivables, "لا يوجد/اشتراك منصة"),
            },
            {
              key: "amount",
              label: "المبلغ (ر.ق)",
              type: "number",
              required: true,
            },
            { key: "providerReference", label: "مرجع محاكاة" },
          ]}
          submitLabel="إنشاء تفويض محلي"
          onSubmit={createPayment}
        />
      </Panel>
      <TabBar
        items={[
          { key: "إيجار", label: "إيجار" },
          { key: "اشتراك منصة", label: "اشتراك منصة منفصل" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Panel
        title="سجل دورة الدفع"
        description="التسوية والرد أدناه لا ينشئان تحصيلًا ولا ينقلان نقدًا. سجّل التحصيل الفعلي التجريبي من صفحة التحصيل فقط."
      >
        <EntityTable
          rows={visiblePayments}
          empty={`لا توجد مدفوعات ${tab} في الفترة الحالية.`}
          columns={[
            {
              key: "payment",
              label: "المرجع",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "providerReference", "SIM")}
                  </span>
                </>
              ),
            },
            {
              key: "amount",
              label: "المبلغ",
              render: row => money(row.amountMinor),
            },
            {
              key: "fee",
              label: "الرسوم",
              render: row =>
                money(Number(row.meta.feesMinor ?? row.meta.feeMinor ?? 0)),
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <StatusBadge status={row.status} />,
            },
            {
              key: "action",
              label: "محاكاة",
              render: row => (
                <FormDialog
                  title={`تحديث محاكاة: ${row.title}`}
                  trigger={
                    <button className="btn-ghost" disabled={!canEdit}>
                      <RefreshCw size={14} /> انتقال
                    </button>
                  }
                  fields={[
                    {
                      key: "action",
                      label: "الإجراء",
                      type: "select",
                      options: [
                        {
                          value: "تسوية",
                          label: "تسوية لدى المزود (لا تحويل بنك)",
                        },
                        { value: "رد", label: "رد محاكى" },
                        { value: "إلغاء", label: "إلغاء محاكى" },
                      ],
                    },
                    {
                      key: "fee",
                      label: "رسوم محاكاة (ر.ق)",
                      type: "number",
                      defaultValue: "0",
                    },
                    { key: "reference", label: "مرجع تسوية/رد صوري" },
                    { key: "note", label: "ملاحظة", type: "textarea" },
                  ]}
                  submitLabel="حفظ المحاكاة"
                  onSubmit={values => updatePayment(row, values)}
                />
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
