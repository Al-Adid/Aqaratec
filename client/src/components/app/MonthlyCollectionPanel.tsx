import {
  AlertTriangle,
  ArrowUpLeft,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Landmark,
  ReceiptText,
} from "lucide-react";
import { Link } from "wouter";
import { isMinorAmount, money, toMinor } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import { scenarioDate } from "@shared/prototype-clock";
import { getMonthlyPropertyCollections } from "@/lib/prototype-payments";
import { Badge, FormDialog, Panel } from "./Primitives";

const validMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);
const defaultMonth = (value: string, date: string) =>
  validMonth(value) ? value : date.substring(0, 7);
const minorInput = (minor: number) => {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
};

function dueTone(due: {
  collectedMinor: number;
  lossMinor: number;
  remainingMinor: number;
  receivable?: { amountMinor: number };
}) {
  if (due.receivable?.amountMinor === 0)
    return { label: "استحقاق دون مبلغ", tone: "gray" as const };
  if (due.remainingMinor === 0 && due.lossMinor > 0) {
    return { label: "عولج بخسارة", tone: "red" as const };
  }
  if (due.remainingMinor === 0) {
    return { label: "تم التحصيل", tone: "green" as const };
  }
  if (due.collectedMinor > 0 || due.lossMinor > 0) {
    return { label: "معالجة جزئية", tone: "amber" as const };
  }
  return { label: "قيد المتابعة", tone: "gray" as const };
}

export default function MonthlyCollectionPanel() {
  const {
    state,
    canEdit,
    recordCollection,
    recordPropertyMonthCollection,
    setSetting,
  } = usePrototype();
  const asOf = scenarioDate(state);
  const month = defaultMonth(state.settings.period, asOf);
  const propertyCollections = getMonthlyPropertyCollections(
    state.entities,
    state.settings.portfolioId,
    month
  );

  const recordDueCollection = (
    receivableId: string,
    remainingMinor: number,
    values: Record<string, string>
  ) => {
    const amountMinor = toMinor(values.amount);
    if (!isMinorAmount(amountMinor) || amountMinor <= 0) {
      throw new Error("أدخل مبلغًا موجبًا صالحًا.");
    }
    if (amountMinor > remainingMinor) {
      throw new Error("المبلغ يتجاوز المتبقي من هذا الاستحقاق.");
    }
    recordCollection(
      receivableId,
      amountMinor,
      values.method,
      "محصّل",
      values.collectionDate
    );
  };

  return (
    <section
      className="monthly-collection-section"
      aria-labelledby="monthly-collection-title"
    >
      <Panel
        title="تحصيل إيجار الشهر"
        description="هذه دفعات مستحقات الشهر حتى آخر حركة مسجلة، وقد قُبضت في أشهر أخرى. حركة نقد الفترة وكشفها الختامي منفصلان في التقارير؛ الخسارة والشيك غير المحصّل ليسا نقدًا."
        action={
          <label className="month-field">
            <span>شهر التحصيل</span>
            <input
              type="month"
              value={month}
              onChange={event =>
                setSetting("period", event.target.value || asOf.substring(0, 7))
              }
              aria-label="اختيار شهر التحصيل"
            />
          </label>
        }
      >
        <div className="monthly-collection-overview">
          <div>
            <CalendarDays size={17} />
            <span>الشهر المعروض</span>
            <strong dir="ltr">{month}</strong>
          </div>
          <p>
            هذا سجل محاسبي صوري داخل المتصفح، وليس حسابًا بنكيًا أو أمر تحويل
            فعليًا.
          </p>
          <Link href="/collections" className="link-button">
            سجل التحصيل والخسائر <ArrowUpLeft size={15} />
          </Link>
        </div>
      </Panel>

      <div className="monthly-property-grid">
        {propertyCollections.map(summary => {
          const disabled =
            !canEdit ||
            summary.dues.length === 0 ||
            summary.remainingMinor === 0;
          return (
            <Panel
              key={summary.property.id}
              className="monthly-property-panel"
              title={summary.property.title}
              description={
                summary.dues.length
                  ? `${summary.dues.length} استحقاق/استحقاقات ضمن ${month}`
                  : "لا توجد استحقاقات في هذا الشهر؛ لا يُعد العقار مسددًا."
              }
              action={
                <div className="monthly-property-actions">
                  <Link
                    href={`/properties/${summary.property.id}`}
                    className="link-button"
                  >
                    ملف العقار <ArrowUpLeft size={14} />
                  </Link>
                  <FormDialog
                    title={`تحصيل إيجار الشهر · ${summary.property.title}`}
                    description={`سيسجل المتبقي المعروض (${money(summary.remainingMinor)}) كتحصيل مؤكد موزع على استحقاقات هذا العقار. هذا حساب بيانات صورية وليس حساب بنك حقيقي.`}
                    trigger={
                      <button className="btn-primary" disabled={disabled}>
                        <CheckCircle2 size={15} />{" "}
                        {summary.dues.length === 0 ||
                        summary.expectedMinor === 0
                          ? "لا مبلغ مستحق"
                          : summary.remainingMinor === 0
                            ? summary.lossMinor > 0
                              ? "تمت المعالجة بخسارة"
                              : "إيجار الشهر محصّل"
                            : "تم تحصيل إيجار الشهر"}
                      </button>
                    }
                    disabled={disabled}
                    fields={[
                      {
                        key: "method",
                        label: "طريقة التحصيل",
                        type: "select",
                        options: [
                          { value: "تحويل", label: "تحويل" },
                          { value: "نقد", label: "نقد" },
                        ],
                        required: true,
                      },
                      {
                        key: "collectionDate",
                        label: "تاريخ التحصيل",
                        type: "date",
                        defaultValue: asOf,
                        required: true,
                      },
                    ]}
                    submitLabel="تسجيل التحصيل المحلي"
                    onSubmit={values =>
                      recordPropertyMonthCollection(
                        summary.property.id,
                        month,
                        values.method,
                        values.collectionDate,
                        summary.remainingMinor
                      )
                    }
                  />
                </div>
              }
            >
              {summary.dues.length > 0 && (
                <div className="monthly-due-days">
                  <CalendarDays size={17} />
                  <strong>موعد التحصيل:</strong>
                  <span>
                    {[...new Set(summary.dues.map(due => due.dueDate))]
                      .map(date => `يوم ${Number(date.slice(8, 10))} (${date})`)
                      .join(" • ")}
                  </span>
                </div>
              )}
              <div className="monthly-property-totals">
                <div>
                  <span>مستحق</span>
                  <strong>{money(summary.expectedMinor)}</strong>
                </div>
                <div className="is-collected">
                  <span>محصّل</span>
                  <strong>{money(summary.collectedMinor)}</strong>
                </div>
                <div className="is-loss">
                  <span>خسارة معالجة</span>
                  <strong>{money(summary.lossMinor)}</strong>
                </div>
                <div className="is-remaining">
                  <span>متبقي</span>
                  <strong>{money(summary.remainingMinor)}</strong>
                </div>
              </div>

              {summary.dues.length === 0 ? (
                <div className="monthly-no-dues">
                  <ReceiptText size={20} />
                  <div>
                    <strong>لا يوجد استحقاق لهذا العقار في {month}</strong>
                    <span>
                      غياب الاستحقاق لا يعني أن الإيجار حُصّل أو سُدّد.
                    </span>
                  </div>
                </div>
              ) : (
                <details className="collection-details">
                  <summary>
                    تفاصيل الاستحقاقات والتحصيل الجزئي ({summary.dues.length})
                  </summary>
                  <div className="monthly-due-list">
                    <div className="monthly-due-heading" aria-hidden="true">
                      <span>الوحدة / المستأجر</span>
                      <span>الاستحقاق</span>
                      <span>المبالغ</span>
                      <span>إجراء</span>
                    </div>
                    {summary.dues.map(due => {
                      const status = dueTone(due);
                      const dueDate =
                        due.dueDate ||
                        String(due.receivable.meta.due ?? due.receivable.date);
                      const dueDisabled = !canEdit || due.remainingMinor === 0;
                      return (
                        <article
                          className="monthly-due-row"
                          key={due.receivable.id}
                        >
                          <div className="monthly-due-person">
                            <strong>{due.unitTitle}</strong>
                            <span>{due.tenantName || "مستأجر غير محدد"}</span>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </div>
                          <div className="monthly-due-date">
                            <span>موعد الاستحقاق</span>
                            <strong dir="ltr">{dueDate}</strong>
                            {due.collectedDates.length > 0 && (
                              <small>
                                آخر تحصيل: {due.collectedDates.at(-1)}
                              </small>
                            )}
                          </div>
                          <div className="monthly-due-money">
                            <span>
                              المستحق {money(due.receivable.amountMinor)}
                            </span>
                            <span>المحصّل {money(due.collectedMinor)}</span>
                            {due.lossMinor > 0 && (
                              <span className="loss-copy">
                                خسارة {money(due.lossMinor)}
                              </span>
                            )}
                            <strong>المتبقي {money(due.remainingMinor)}</strong>
                          </div>
                          <div className="monthly-due-action">
                            {due.pendingMinor > 0 && (
                              <div className="pending-check-note">
                                <AlertTriangle size={14} />
                                شيك غير محصّل: {money(due.pendingMinor)}
                              </div>
                            )}
                            <FormDialog
                              title={`تحصيل استحقاق · ${due.unitTitle}`}
                              description={`يسجل تحصيلًا مؤكدًا على هذا الاستحقاق فقط. المتبقي الآن ${money(due.remainingMinor)}؛ الشيكات غير المحصّلة لا تتحول تلقائيًا إلى نقد.`}
                              trigger={
                                <button
                                  className="btn-secondary"
                                  disabled={dueDisabled}
                                >
                                  <CheckCircle2 size={15} />{" "}
                                  {due.remainingMinor === 0
                                    ? due.lossMinor > 0
                                      ? "معالج بخسارة"
                                      : "تم التحصيل"
                                    : "تسجيل تحصيل"}
                                </button>
                              }
                              disabled={dueDisabled}
                              initialValues={{
                                amount: minorInput(due.remainingMinor),
                              }}
                              fields={[
                                {
                                  key: "amount",
                                  label: "المبلغ (ر.ق)",
                                  type: "number",
                                  required: true,
                                },
                                {
                                  key: "method",
                                  label: "طريقة التحصيل",
                                  type: "select",
                                  options: [
                                    { value: "تحويل", label: "تحويل" },
                                    { value: "نقد", label: "نقد" },
                                  ],
                                  required: true,
                                },
                                {
                                  key: "collectionDate",
                                  label: "تاريخ التحصيل",
                                  type: "date",
                                  defaultValue: asOf,
                                  required: true,
                                },
                              ]}
                              submitLabel="تسجيل محصّل محليًا"
                              onSubmit={values =>
                                recordDueCollection(
                                  due.receivable.id,
                                  due.remainingMinor,
                                  values
                                )
                              }
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </details>
              )}
            </Panel>
          );
        })}
      </div>

      {propertyCollections.length === 0 && (
        <div className="monthly-no-properties">
          <CircleDollarSign size={21} />
          لا توجد عقارات في المحفظة المحددة لعرض تحصيل هذا الشهر.
        </div>
      )}
    </section>
  );
}
