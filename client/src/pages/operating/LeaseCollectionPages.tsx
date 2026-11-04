import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  HandCoins,
  Plus,
  RefreshCw,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
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
import {
  activateLease,
  correctLeaseTermination,
  createLease,
  refreshLeaseCalendar,
  renewLease,
  terminateLease,
  undoLeaseTermination,
} from "@/lib/prototype-lease-lifecycle";
import { listLeaseTemplates } from "@/lib/lease-template-engine";

type Feedback = { tone: "ok" | "error"; text: string };
const REGISTRATION_STATES = [
  "غير متحقق",
  "غير مسجل",
  "طلب قيد الإجراء",
  "مسجل",
];

function requireEditPermission(canEdit: boolean) {
  if (!canEdit)
    throw new Error(
      "هذه الواجهة للقراءة فقط في الدور الحالي؛ لا يمكن حفظ تغيير محلي."
    );
}

/** Same lease decision + same fields always receives the same idempotency key. */
function lifecycleRequestId(
  leaseId: string,
  decision: string,
  values: Record<string, string>
): string {
  const canonical = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join("&");
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lease-ui-${leaseId.slice(0, 48)}-${decision}-${(hash >>> 0).toString(36)}`;
}

export function LeasesPage() {
  const {
    state,
    filtered,
    list,
    patch,
    commitTransition,
    refreshRenewalTemplateSnapshot,
    canEdit,
  } = usePrototype();
  const scenarioAsOf = scenarioDate(state);
  const portfolios = list("portfolios");
  const properties = filtered("properties");
  const units = filtered("units");
  const tenants = filtered("tenants");
  const leases = scopedRows(filtered("leases"), state.settings, "leases");
  const [registrationFilter, setRegistrationFilter] = useState("الكل");
  const [message, setMessage] = useState(
    "تسجيل العقد مستقل عن التوقيع وعن صورة العقد داخل هذا النموذج."
  );

  const visibleLeases = useMemo(
    () =>
      registrationFilter === "الكل"
        ? leases
        : leases.filter(
            lease =>
              entityMeta(lease, "registrationStatus", "غير متحقق") ===
              registrationFilter
          ),
    [leases, registrationFilter]
  );
  const propertyOptions = selectOptions(properties, "اختر العقار");
  const unitOptions = selectOptions(units, "اختر الوحدة (اختياري)");
  const tenantOptions = selectOptions(
    tenants,
    "اختر مستأجرًا قائمًا أو أنشئ الاسم في العقد"
  );
  const latestTemplates = useMemo(
    () => listLeaseTemplates(state.entities),
    [state.entities]
  );

  const addLease = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const created = commitTransition(previous => createLease(previous, values));
    setMessage(
      `أضيف العقد «${created.title}» كمسودة صحيحة محليًا. لا تشغل الوحدة ولا تنشئ استحقاقًا أو قبضًا حتى تفعيله صراحة.`
    );
  };

  const changeRegistration = (
    leaseId: string,
    values: Record<string, string>
  ) => {
    requireEditPermission(canEdit);
    const lease = leases.find(row => row.id === leaseId);
    if (!lease)
      throw new Error("تعذر العثور على العقد المحدد ضمن النطاق الحالي.");
    const next = value(values, "registrationStatus", "غير متحقق");
    if (
      next === "مسجل" &&
      (!value(values, "registrationNumber") ||
        !value(values, "registrationDate") ||
        !value(values, "registrationEvidence"))
    ) {
      throw new Error(
        "حالة «مسجل» تحتاج رقم التسجيل وتاريخه ووصف إثبات مستقل."
      );
    }
    patch("leases", lease.id, {
      meta: {
        ...lease.meta,
        registrationStatus: next,
        registrationNumber: value(values, "registrationNumber"),
        registrationDate: value(values, "registrationDate"),
        registrationEvidence: value(values, "registrationEvidence"),
        registrationNote: value(values, "registrationNote"),
      },
    });
    setMessage(
      next === "مسجل"
        ? `تم وسم «${lease.title}» مسجلًا محليًا برقم وتاريخ وإثبات وصفي. لا يعكس ذلك تسجيلًا حكوميًا حقيقيًا.`
        : `تم تحديث حالة التسجيل إلى «${next}» دون افتراض غرامة أو قاعدة قانونية.`
    );
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F04 + F05 / العقد والتسجيل"
        title="العقود والتجديد"
        description="إنشاء عقد وإصدار وجدول تجريبي، مع فصل صريح بين توقيع العقد وحالة تسجيله."
      >
        <a href="/contract-templates" className="btn-primary">
          <FileCheck2 size={16} /> نماذج العقود وتعبئتها
        </a>
        <FormDialog
          title="تحديث تقويم العقود"
          description="تحديث صريح كما في تاريخ محدد لحالة الإشغال فقط؛ لا توجد مهمة مجدولة أو تحصيل نقدي تلقائي."
          trigger={
            <button className="btn-secondary" disabled={!canEdit}>
              <CalendarClock size={16} /> تحديث التقويم
            </button>
          }
          fields={[
            {
              key: "asOf",
              label: "كما في التاريخ",
              type: "date",
              required: true,
              defaultValue: scenarioAsOf,
            },
          ]}
          submitLabel="تحديث محلي"
          onSubmit={values => {
            requireEditPermission(canEdit);
            const changed = commitTransition(previous =>
              refreshLeaseCalendar(
                previous,
                value(values, "asOf", scenarioAsOf)
              )
            );
            setMessage(
              changed
                ? `حُدّث تقويم العقود كما في ${value(values, "asOf", scenarioAsOf)}؛ تغيرت حالة ${changed} سجلًا.`
                : "تقويم العقود محدث بالفعل كما في التاريخ المختار."
            );
          }}
        />
      </PageHeader>
      <DemoNotice mode="interactive">
        لا يرسل النموذج أي عقد أو طلب تسجيل. الرقم والتاريخ والإثبات أوصاف
        تجريبية ولا تكفي صورة أو توقيع وحدهما لتسجيل العقد.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="عقود السجل"
          value={String(leases.length)}
          detail="ضمن المحفظة المختارة؛ لا تختفي العقود القائمة بتغيير شهر التحصيل"
          icon={<FileCheck2 size={18} />}
        />
        <Metric
          label="مسجلة"
          value={String(
            leases.filter(
              row =>
                entityMeta(row, "registrationStatus", "غير متحقق") === "مسجل"
            ).length
          )}
          detail="بحالة تسجيل منفصلة"
          icon={<BadgeCheck size={18} />}
        />
        <Metric
          label="قيد الإجراء"
          value={String(
            leases.filter(
              row =>
                entityMeta(row, "registrationStatus", "") === "طلب قيد الإجراء"
            ).length
          )}
          detail="لا تعني تسجيلًا نهائيًا"
          icon={<CalendarClock size={18} />}
        />
        <Metric
          label="قيمة دورية صورية"
          value={money(sumMinor(leases))}
          detail="ليست تحصيلًا نقديًا"
          icon={<CircleDollarSign size={18} />}
        />
      </div>
      <Panel
        title="سجل العقود"
        description="ينتج كل عقد كمسودة محلية. التفعيل الصريح ينشئ الاستحقاقات الدورية مرة واحدة بلا قبض، ويشتق إشغال الوحدة من تاريخ النفاذ."
        action={
          <FormDialog
            title="إنشاء عقد تجريبي"
            description="ينشئ مسودة صحيحة فقط؛ يجب أن يطابق المستأجر والوحدة العقار والمحفظة. لا يمكن استخدام سجل مستأجر غير مرتبط حتى يصحح ربطه."
            trigger={
              <button className="btn-primary" disabled={!canEdit}>
                <Plus size={16} /> إنشاء عقد
              </button>
            }
            fields={[
              {
                key: "title",
                label: "مرجع العقد",
                required: true,
                placeholder: "عقد إيجار 2026-01",
              },
              {
                key: "tenantName",
                label: "اسم المستأجر الصوري (لإنشاء مستأجر جديد)",
              },
              {
                key: "tenantId",
                label: "سجل المستأجر (اختياري)",
                type: "select",
                options: tenantOptions,
              },
              {
                key: "propertyId",
                label: "العقار",
                type: "select",
                options: propertyOptions,
                required: true,
              },
              {
                key: "unitId",
                label: "الوحدة (من العقار نفسه؛ مطلوبة للعقار المقسم)",
                type: "select",
                options: unitOptions,
              },
              {
                key: "startDate",
                label: "تاريخ البداية",
                type: "date",
                required: true,
                defaultValue: scenarioAsOf,
              },
              {
                key: "endDate",
                label: "تاريخ النهاية",
                type: "date",
                required: true,
              },
              {
                key: "rent",
                label: "قيمة دورية (ر.ق)",
                type: "number",
                required: true,
                placeholder: "4500",
              },
            ]}
            submitLabel="إنشاء مسودة محلية"
            onSubmit={addLease}
          />
        }
      >
        <p className="muted">{message}</p>
        <TabBar
          items={[
            { key: "الكل", label: "كل الحالات" },
            ...REGISTRATION_STATES.map(status => ({
              key: status,
              label: status,
            })),
          ]}
          value={registrationFilter}
          onChange={setRegistrationFilter}
        />
        <EntityTable
          rows={visibleLeases}
          empty="لا توجد عقود تطابق حالة التسجيل والمحفظة المختارتين."
          columns={[
            {
              key: "lease",
              label: "العقد / المستأجر",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "tenantName", row.subtitle)}
                  </span>
                </>
              ),
            },
            {
              key: "portfolio",
              label: "المحفظة",
              render: row => portfolioName(portfolios, row.portfolioId),
            },
            {
              key: "term",
              label: "المدة",
              render: row =>
                `${entityMeta(row, "startDate")} ← ${entityMeta(row, "endDate")}`,
            },
            {
              key: "registration",
              label: "التسجيل",
              render: row => (
                <StatusBadge
                  status={entityMeta(row, "registrationStatus", "غير متحقق")}
                />
              ),
            },
            {
              key: "rent",
              label: "القيمة",
              render: row => money(row.amountMinor),
            },
            {
              key: "actions",
              label: "إجراء",
              render: row => (
                <div className="button-row">
                  <FormDialog
                    title={`تسجيل / مراجعة: ${row.title}`}
                    description="الحالات الأربع مع رقم وتاريخ وإثبات وصفي منفصل عن التوقيع. لا توجد قواعد مهلة أو غرامة معتمدة في النموذج."
                    trigger={
                      <button className="btn-ghost" disabled={!canEdit}>
                        تحديث التسجيل
                      </button>
                    }
                    initialValues={{
                      registrationStatus: entityMeta(
                        row,
                        "registrationStatus",
                        "غير متحقق"
                      ),
                      registrationNumber: entityMeta(
                        row,
                        "registrationNumber",
                        ""
                      ),
                      registrationDate: entityMeta(row, "registrationDate", ""),
                      registrationEvidence: entityMeta(
                        row,
                        "registrationEvidence",
                        ""
                      ),
                    }}
                    fields={[
                      {
                        key: "registrationStatus",
                        label: "حالة التسجيل",
                        type: "select",
                        options: REGISTRATION_STATES.map(status => ({
                          value: status,
                          label: status,
                        })),
                        required: true,
                      },
                      {
                        key: "registrationNumber",
                        label: "رقم التسجيل (مطلوب للعرض عند المسجل)",
                        placeholder: "رقم تجريبي",
                      },
                      {
                        key: "registrationDate",
                        label: "تاريخ التسجيل",
                        type: "date",
                      },
                      {
                        key: "registrationEvidence",
                        label: "وصف الإثبات",
                        placeholder: "مرجع إثبات تجريبي، لا رفع ملف",
                      },
                      {
                        key: "registrationNote",
                        label: "ملاحظة مراجعة",
                        type: "textarea",
                      },
                    ]}
                    submitLabel="تحديث محلي"
                    onSubmit={values => changeRegistration(row.id, values)}
                  />
                  {row.status === "مسودة" ? (
                    entityMeta(row, "priorLeaseId") ? (
                      <FormDialog
                        title={`توليد وثيقة التجديد: ${row.title}`}
                        description="ينشئ لقطة مستقلة لشروط التجديد الحالية من القالب المختار. لا يفعّل العقد ولا ينشئ ذممًا أو قبضًا؛ يظل التسجيل والتوقيع غير متحققين."
                        trigger={
                          <button
                            className="btn-ghost"
                            disabled={
                              !canEdit ||
                              !latestTemplates.some(
                                template =>
                                  !template.portfolioId ||
                                  template.portfolioId === row.portfolioId
                              )
                            }
                          >
                            <FileCheck2 size={14} /> توليد وثيقة التجديد
                          </button>
                        }
                        fields={[
                          {
                            key: "templateId",
                            label: "قالب التجديد (أحدث إصدار متاح)",
                            type: "select",
                            required: true,
                            options: latestTemplates
                              .filter(
                                template =>
                                  !template.portfolioId ||
                                  template.portfolioId === row.portfolioId
                              )
                              .map(template => ({
                                value: template.id,
                                label: `${entityMeta(template, "name", template.title)} · إصدار ${entityMeta(template, "version", "-")}`,
                              })),
                          },
                        ]}
                        submitLabel="توليد لقطة مستقلة"
                        onSubmit={values => {
                          requireEditPermission(canEdit);
                          const templateId = value(values, "templateId");
                          const changed = refreshRenewalTemplateSnapshot(
                            row.id,
                            templateId,
                            lifecycleRequestId(row.id, "renewal-snapshot", {
                              templateId,
                            })
                          );
                          setMessage(
                            changed
                              ? `أُنشئت وثيقة تجديد مستقلة لـ«${row.title}» بالقالب المختار. لم يُفعّل العقد ولم تُنشأ ذمم أو قبض.`
                              : `وثيقة التجديد المطابقة موجودة بالفعل لـ«${row.title}»؛ لم تُنشأ وثيقة أو ذمة إضافية.`
                          );
                        }}
                      />
                    ) : null
                  ) : null}
                  {row.status === "مسودة" ? (
                    <FormDialog
                      title={`تفعيل العقد: ${row.title}`}
                      description="يتحقق التفعيل من المستأجر والمدة والإيجار وعدم التداخل، ثم ينشئ استحقاقات الأشهر المستحقة مرة واحدة. لا يسجل قبضًا أو حركة نقدية."
                      trigger={
                        <button className="btn-secondary" disabled={!canEdit}>
                          <CheckCircle2 size={14} /> تفعيل
                        </button>
                      }
                      fields={[
                        {
                          key: "asOf",
                          label: "كما في التاريخ",
                          type: "date",
                          required: true,
                          defaultValue: scenarioAsOf,
                        },
                      ]}
                      submitLabel="تفعيل محلي"
                      onSubmit={values => {
                        requireEditPermission(canEdit);
                        const started = commitTransition(previous =>
                          activateLease(
                            previous,
                            row.id,
                            value(values, "asOf", scenarioAsOf)
                          )
                        );
                        setMessage(
                          `فُعّل «${started.title}» محليًا دون قبض. راجع تقويم العقود عند تقدم تاريخ النموذج.`
                        );
                      }}
                    />
                  ) : null}
                  <FormDialog
                    title={`تجديد / إنهاء / تصحيح: ${row.title}`}
                    description="الإنهاء والتصحيح والعكس عمليات مؤرخة مستقلة بسبب موثق. التجديد يسوي الذمم المفتوحة فقط ويرفض القبض أو الفاتورة أو الخسارة إلى تسوية صريحة؛ لا يحذف التاريخ أو يغير سندًا."
                    trigger={
                      <button className="btn-ghost" disabled={!canEdit}>
                        <RefreshCw size={14} /> تجديد / إنهاء
                      </button>
                    }
                    fields={[
                      {
                        key: "decision",
                        label: "القرار",
                        type: "select",
                        options: [
                          { value: "renew", label: "إنشاء إصدار تجديد" },
                          { value: "terminate", label: "إنهاء العقد" },
                          {
                            value: "correct-termination",
                            label: "تصحيح تاريخ إنهاء مسجل",
                          },
                          {
                            value: "undo-termination",
                            label: "عكس إنهاء مسجل",
                          },
                        ],
                      },
                      {
                        key: "effectiveDate",
                        label: "تاريخ أثر الإنهاء (لخيار الإنهاء)",
                        type: "date",
                        defaultValue: scenarioAsOf,
                      },
                      {
                        key: "asOf",
                        label: "تاريخ الأثر في سيناريو التجربة",
                        type: "date",
                        defaultValue: scenarioAsOf,
                      },
                      {
                        key: "startDate",
                        label: "بداية الإصدار الجديد (للتجديد)",
                        type: "date",
                      },
                      {
                        key: "endDate",
                        label: "نهاية الإصدار الجديد (للتجديد)",
                        type: "date",
                      },
                      {
                        key: "rent",
                        label:
                          "إيجار الإصدار الجديد (اختياري؛ للاحتفاظ بالقيمة الحالية اتركه فارغًا)",
                        type: "number",
                      },
                      {
                        key: "terminatePrevious",
                        label: "إنهاء العقد السابق عند بداية الإصدار الجديد",
                        type: "select",
                        options: [
                          {
                            value: "",
                            label: "ليس مطلوبًا إذا انتهت المدة قبل البداية",
                          },
                          {
                            value: "confirm",
                            label:
                              "أؤكد تاريخ الإنهاء الصريح عند بداية الإصدار الجديد",
                          },
                        ],
                      },
                      {
                        key: "newTemplateStep",
                        label:
                          "خطوة القالب الجديدة (فقط إذا كانت وثيقة السابق من قالب)",
                        type: "select",
                        options: [
                          {
                            value: "",
                            label: "اختر خطوة صريحة عند وجود قالب سابق",
                          },
                          {
                            value: "confirm",
                            label:
                              "أؤكد إنشاء لقطة شروط جديدة من «نماذج العقود»؛ لا أستعمل الوثيقة القديمة",
                          },
                        ],
                      },
                      {
                        key: "reason",
                        label: "السبب الموثق (إلزامي للإنهاء/التصحيح/العكس)",
                        type: "textarea",
                      },
                    ]}
                    submitLabel="تسجيل القرار"
                    onSubmit={values => {
                      requireEditPermission(canEdit);
                      const decision = value(values, "decision", "renew");
                      const operationValues = {
                        ...values,
                        requestId: lifecycleRequestId(row.id, decision, values),
                      };
                      if (decision === "terminate") {
                        const ended = commitTransition(previous =>
                          terminateLease(previous, row.id, operationValues)
                        );
                        setMessage(
                          `سُجل إنهاء «${ended.title}» بتاريخ ${value(values, "effectiveDate", scenarioAsOf)}؛ لم تُلغَ إلا الذمم غير المرتبطة بتسوية ولم يُحذف تاريخ.`
                        );
                        return;
                      }
                      if (decision === "correct-termination") {
                        const corrected = commitTransition(previous =>
                          correctLeaseTermination(
                            previous,
                            row.id,
                            operationValues
                          )
                        );
                        setMessage(
                          `صُحح إنهاء «${corrected.title}» بتاريخ ${value(values, "effectiveDate", scenarioAsOf)} عبر عملية مستقلة؛ أعيدت الذمم غير المسوّاة المناسبة فقط.`
                        );
                        return;
                      }
                      if (decision === "undo-termination") {
                        const restored = commitTransition(previous =>
                          undoLeaseTermination(
                            previous,
                            row.id,
                            operationValues
                          )
                        );
                        setMessage(
                          `عُكس إنهاء «${restored.title}» عبر عملية مستقلة؛ لم تُعدّل أي تحصيلات أو وثائق صادرة.`
                        );
                        return;
                      }
                      const renewed = commitTransition(previous =>
                        renewLease(previous, row.id, operationValues)
                      );
                      setMessage(
                        `أُنشئ «${renewed.title}» كمسودة تجديد مستقلة بلا توقيع أو تسجيل أو وثيقة السابق. إن كان السابق من قالب، أنشئ لقطة شروط جديدة من صفحة «نماذج العقود» قبل اعتماده.`
                      );
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

export function CollectionsPage() {
  const {
    state,
    filtered,
    list,
    add,
    recordCollection,
    recordLoss,
    recordRecovery,
    outstanding,
    canEdit,
  } = usePrototype();
  const portfolios = list("portfolios");
  const properties = filtered("properties");
  const units = filtered("units");
  const leases = filtered("leases");
  const receivables = scopedRows(filtered("receivables"), state.settings);
  const collections = scopedRows(filtered("collections"), state.settings);
  const losses = scopedRows(filtered("losses"), state.settings);
  const [feedback, setFeedback] = useState<Feedback>({
    tone: "ok",
    text: "التحصيلات والخسائر والاستردادات في هذا العرض تسجل محليًا فقط.",
  });
  const outstandingTotal = receivables.reduce(
    (total, row) => total + outstanding(row.id),
    0
  );
  const receivableOptions = receivables.map(row => ({
    value: row.id,
    label: `${row.title} · المتبقي ${money(outstanding(row.id))}`,
  }));
  const remainingLoss = (loss: (typeof losses)[number]) =>
    Math.max(
      0,
      loss.amountMinor -
        collections
          .filter(
            row =>
              entityMeta(row, "recoveryParent", "") === loss.id &&
              /محص|مسو/.test(row.status)
          )
          .reduce((total, row) => total + row.amountMinor, 0)
    );
  const lossOptions = losses.map(row => ({
    value: row.id,
    label: `${row.title} · المتبقي ${money(remainingLoss(row))}`,
  }));

  const recordReceipt = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const receivableId = value(values, "receivableId");
    const amount = formMinor(values, "amount");
    const balance = outstanding(receivableId);
    if (amount === null || amount <= 0)
      return setFeedback({
        tone: "error",
        text: "أدخل مبلغًا موجبًا صحيحًا بمنزلتين عشريتين كحد أقصى.",
      });
    if (amount > balance)
      return setFeedback({
        tone: "error",
        text: `المبلغ أكبر من الرصيد القائم (${money(balance)}).`,
      });
    const method = value(values, "method", "تحويل تجريبي");
    const status = value(values, "status", "محصّل");
    recordCollection(receivableId, amount, method, status);
    setFeedback({
      tone: "ok",
      text: `سُجل ${status} بقيمة ${money(amount)} على الاستحقاق. ${status === "محصّل" ? "سيظهر أثره في الأرصدة المشتقة." : "لا يعد نقدًا محصلًا قبل حالة «محصّل»."}`,
    });
  };

  const createReceivable = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const amount = formMinor(values, "amount");
    if (amount === null || amount <= 0)
      throw new Error("أدخل قيمة استحقاق صالحة.");
    const propertyId = value(values, "propertyId");
    const property = properties.find(row => row.id === propertyId);
    const leaseId = value(values, "leaseId");
    const lease = leaseId ? leases.find(row => row.id === leaseId) : undefined;
    if (!property)
      throw new Error(
        "اختر عقارًا قائمًا ضمن نطاق المحفظة الحالي قبل إصدار الذمة."
      );
    if (
      state.settings.portfolioId !== "all" &&
      property.portfolioId !== state.settings.portfolioId
    )
      throw new Error("العقار المختار خارج نطاق المحفظة الحالي.");
    let unitId = "";
    let portfolioId = property.portfolioId;
    if (leaseId) {
      if (!lease) throw new Error("اختر عقدًا قائمًا ضمن نطاق المحفظة الحالي.");
      if (
        lease.propertyId !== property.id ||
        lease.portfolioId !== property.portfolioId
      )
        throw new Error("العقد المختار يجب أن يتبع العقار والمحفظة نفسيهما.");
      unitId = entityMeta(lease, "unitId", "");
      if (unitId) {
        const unit = units.find(row => row.id === unitId);
        if (
          !unit ||
          unit.propertyId !== lease.propertyId ||
          unit.portfolioId !== lease.portfolioId
        )
          throw new Error(
            "وحدة العقد لا تتبع العقار والمحفظة نفسيهما؛ صحح العقد قبل إصدار الذمة."
          );
      }
      portfolioId = lease.portfolioId;
    }
    const created = add(
      "receivables",
      entityInput(value(values, "title"), {
        subtitle: value(values, "dueDate", "استحقاق تجريبي"),
        portfolioId,
        propertyId: property.id,
        status: "مستحق",
        date: value(values, "dueDate", DEMO_DATE),
        amountMinor: amount,
        meta: {
          dueDate: value(values, "dueDate"),
          leaseId,
          unitId,
          source: "إصدار يدوي تجريبي",
        },
      })
    );
    setFeedback({
      tone: "ok",
      text: `أضيف الاستحقاق «${created.title}» بقيمة ${money(amount)}${lease ? " وربط بالعقد ووحدته" : ""}؛ لا يُحتسب نقدًا حتى تحصيل مؤكد.`,
    });
  };

  const registerLoss = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const receivableId = value(values, "receivableId");
    const amount = formMinor(values, "amount");
    const balance = outstanding(receivableId);
    if (amount === null || amount <= 0 || amount > balance)
      return setFeedback({
        tone: "error",
        text: "مبلغ الخسارة يجب أن يكون موجبًا ولا يتجاوز الرصيد القائم.",
      });
    recordLoss(
      receivableId,
      amount,
      value(values, "reason", "تعذر تحصيل تجريبي")
    );
    setFeedback({
      tone: "ok",
      text: `سُجلت خسارة ${money(amount)} مباشرة بسبب موثق داخل النموذج. لا يلزم اعتماد مالك أو مرفق في هذا السيناريو.`,
    });
  };

  const registerRecovery = (values: Record<string, string>) => {
    requireEditPermission(canEdit);
    const lossId = value(values, "lossId");
    const amount = formMinor(values, "amount");
    const loss = losses.find(row => row.id === lossId);
    if (!loss || amount === null || amount <= 0 || amount > remainingLoss(loss))
      return setFeedback({
        tone: "error",
        text: "اختر خسارة ومبلغ استرداد صالحًا لا يتجاوز رصيدها المتبقي بعد الاستردادات السابقة.",
      });
    recordRecovery(lossId, amount);
    setFeedback({
      tone: "ok",
      text: `سُجل استرداد جديد ${money(amount)} مربوط بالخسارة «${loss.title}». لم يُفتح الاستحقاق القديم ولم تُنشأ ذمة مكررة.`,
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F06 / التحصيل والشيكات"
        title="التحصيل والخسائر"
        description="سجل استلام المبلغ هنا؛ إصدار الفاتورة أو مطالبة الدفع في صفحة الفواتير والمستحقات."
      >
        <a href="/billing" className="btn-primary">
          <Plus size={16} /> إصدار فاتورة / مطالبة
        </a>
      </PageHeader>
      <DemoNotice mode="interactive">
        الشيك المستلم أو المودع لا يمثل نقدًا. لا تحويل مصرفي أو قراءة كشف أو
        تحصيل حقيقي داخل البروتوتايب.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="ذمم قائمة"
          value={money(outstandingTotal)}
          detail="محسوبة عبر outstanding()"
          icon={<HandCoins size={18} />}
        />
        <Metric
          label="تحصيلات في الفترة"
          value={money(sumMinor(collections))}
          detail="السجل يشمل حالات التجربة"
          icon={<CheckCircle2 size={18} />}
        />
        <Metric
          label="خسائر مسجلة"
          value={money(sumMinor(losses))}
          detail="مباشرة للمشغّل المخول"
          icon={<ShieldAlert size={18} />}
        />
        <Metric
          label="استحقاقات"
          value={String(receivables.length)}
          detail="ضمن النطاق والفترة"
          icon={<CircleDollarSign size={18} />}
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
          title="إصدار استحقاق"
          description="يضيف ذمة محلية؛ لا ينشئ إيرادًا نقديًا تلقائيًا."
        >
          <FormDialog
            title="إصدار استحقاق تجريبي"
            trigger={
              <button className="btn-secondary" disabled={!canEdit}>
                <Plus size={16} /> إضافة استحقاق
              </button>
            }
            fields={[
              { key: "title", label: "مرجع الاستحقاق", required: true },
              {
                key: "propertyId",
                label: "العقار",
                type: "select",
                options: selectOptions(properties, "اختر العقار"),
                required: true,
              },
              {
                key: "leaseId",
                label: "العقد (اختياري؛ من العقار نفسه)",
                type: "select",
                options: selectOptions(leases, "اختر العقد"),
              },
              {
                key: "dueDate",
                label: "تاريخ الاستحقاق",
                type: "date",
                required: true,
                defaultValue: DEMO_DATE,
              },
              {
                key: "amount",
                label: "المبلغ (ر.ق)",
                type: "number",
                required: true,
              },
            ]}
            submitLabel="إصدار محلي"
            onSubmit={createReceivable}
          />
        </Panel>
        <Panel
          title="تحصيل أو شيك"
          description="اختر «محصّل» للأثر على الرصيد؛ المستلم والمودع لا يعدان نقدًا."
        >
          <FormDialog
            title="تسجيل تحصيل أو حدث شيك"
            trigger={
              <button className="btn-primary" disabled={!canEdit}>
                <CheckCircle2 size={16} /> تسجيل حدث
              </button>
            }
            fields={[
              {
                key: "receivableId",
                label: "الاستحقاق",
                type: "select",
                options: receivableOptions,
                required: true,
              },
              {
                key: "amount",
                label: "المبلغ (ر.ق)",
                type: "number",
                required: true,
              },
              {
                key: "method",
                label: "الوسيلة",
                type: "select",
                options: [
                  { value: "تحويل تجريبي", label: "تحويل تجريبي" },
                  { value: "شيك", label: "شيك" },
                  { value: "نقدية مؤكدة", label: "نقدية مؤكدة" },
                ],
              },
              {
                key: "status",
                label: "الحالة",
                type: "select",
                options: [
                  { value: "محصّل", label: "محصّل" },
                  { value: "مستلم", label: "شيك مستلم" },
                  { value: "مودع", label: "شيك مودع" },
                  { value: "مرتجع", label: "شيك مرتجع" },
                ],
              },
              { key: "reference", label: "مرجع صوري للشيك/السند" },
            ]}
            submitLabel="تسجيل محلي"
            onSubmit={recordReceipt}
          />
        </Panel>
      </div>
      <div className="split-layout">
        <Panel
          title="خسارة ذمة"
          description="يسجلها المشغّل المخول مباشرة مع السبب؛ لا توجد موافقة مالك أو مرفق إلزامي في السيناريو."
        >
          <FormDialog
            title="تسجيل خسارة عدم تحصيل"
            trigger={
              <button className="btn-secondary" disabled={!canEdit}>
                <ShieldAlert size={16} /> تسجيل خسارة
              </button>
            }
            fields={[
              {
                key: "receivableId",
                label: "الاستحقاق",
                type: "select",
                options: receivableOptions,
                required: true,
              },
              {
                key: "amount",
                label: "المبلغ (ر.ق)",
                type: "number",
                required: true,
              },
              {
                key: "reason",
                label: "سبب موثق",
                type: "textarea",
                required: true,
                placeholder: "وصف داخلي تجريبي",
              },
            ]}
            submitLabel="سجل الخسارة مباشرة"
            onSubmit={registerLoss}
          />
        </Panel>
        <Panel
          title="استرداد خسارة"
          description="سند جديد مربوط بالخسارة؛ لا يعيد فتح الذمة ولا ينسخ الاستحقاق."
        >
          <FormDialog
            title="تسجيل استرداد"
            trigger={
              <button className="btn-secondary" disabled={!canEdit}>
                <Undo2 size={16} /> تسجيل استرداد
              </button>
            }
            fields={[
              {
                key: "lossId",
                label: "الخسارة الأم",
                type: "select",
                options: lossOptions,
                required: true,
              },
              {
                key: "amount",
                label: "المبلغ المسترد (ر.ق)",
                type: "number",
                required: true,
              },
            ]}
            submitLabel="سجل الاسترداد"
            onSubmit={registerRecovery}
          />
        </Panel>
      </div>
      <Panel
        title="سجل التحصيل والشيكات"
        description="السجل أدناه مشتق من السندات التجريبية. لا يدّعي أنه كشف بنك أو حركة مزود دفع."
      >
        <EntityTable
          rows={collections}
          empty="لا توجد تحصيلات أو أحداث شيك في النطاق والفترة الحاليين."
          columns={[
            {
              key: "event",
              label: "السند/الحدث",
              render: row => (
                <>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {entityMeta(row, "method", row.subtitle)}
                  </span>
                </>
              ),
            },
            {
              key: "status",
              label: "الحالة",
              render: row => <StatusBadge status={row.status} />,
            },
            {
              key: "amount",
              label: "المبلغ",
              render: row => money(row.amountMinor),
            },
            { key: "date", label: "التاريخ", render: row => row.date },
            {
              key: "portfolio",
              label: "المحفظة",
              render: row => portfolioName(portfolios, row.portfolioId),
            },
          ]}
        />
      </Panel>
      <Panel
        title="سجل الخسائر"
        description="يبقى السبب مرئيًا، والاسترداد يعرض كسند جديد منفصل في السجل المالي."
      >
        <EntityTable
          rows={losses}
          empty="لا توجد خسائر مسجلة في النطاق الحالي."
          columns={[
            { key: "loss", label: "الخسارة", render: row => row.title },
            {
              key: "reason",
              label: "السبب",
              render: row => entityMeta(row, "reason", row.subtitle),
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
          ]}
        />
      </Panel>
    </div>
  );
}
