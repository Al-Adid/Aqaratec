import { useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  HardHat,
  ReceiptText,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Link } from "wouter";
import {
  BRAND_ASSETS,
  type DemoEntity,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  DemoNotice,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import {
  completeMaintenanceWork,
  createMaintenanceRequest,
  createPreventiveSchedule,
  linkMaintenanceCost,
  materializeMaintenanceExpense,
  submitMaintenanceForReview,
} from "@/lib/prototype-maintenance";
import {
  ActionResult,
  dateText,
  metadataText,
  money,
  parseAmount,
  scopedForm,
  StatusBadge,
  useServiceActions,
} from "./shared";

function maintenanceColumns(onAction: (item: DemoEntity) => void) {
  return [
    { key: "title", label: "الطلب" },
    {
      key: "priority",
      label: "الأولوية",
      render: (row: DemoEntity) => metadataText(row, "priority", "عادية"),
    },
    {
      key: "vendor",
      label: "المورد",
      render: (row: DemoEntity) =>
        metadataText(
          row,
          "vendor",
          metadataText(row, "assignedTo", "غير مسند")
        ),
    },
    {
      key: "amount",
      label: "السقف / التكلفة",
      render: (row: DemoEntity) => money(row.amountMinor),
    },
    {
      key: "status",
      label: "الحالة",
      render: (row: DemoEntity) => <StatusBadge status={row.status} />,
    },
    {
      key: "action",
      label: "نقلة",
      render: (row: DemoEntity) => (
        <button
          type="button"
          className="btn-ghost"
          onClick={event => {
            event.stopPropagation();
            onAction(row);
          }}
        >
          عرض الدورة
        </button>
      ),
    },
  ];
}

export function MaintenanceService() {
  const actions = useServiceActions("الصيانة والوقاية F15/F16");
  const [tab, setTab] = useState("requests");
  const [activeId, setActiveId] = useState<string | undefined>();
  const maintenance = actions.filtered("maintenance");
  const preventive = actions.filtered("preventive");
  const properties = actions
    .list("properties")
    .filter(
      property =>
        actions.state.settings.portfolioId === "all" ||
        property.portfolioId === actions.state.settings.portfolioId
    );
  const units = actions
    .list("units")
    .filter(unit =>
      properties.some(property => property.id === unit.propertyId)
    );
  const scopeFields = scopedForm(properties, units);
  const active = maintenance.find(item => item.id === activeId);
  const openCount = maintenance.filter(item => item.status !== "مغلق").length;
  const pendingApproval = maintenance.filter(
    item =>
      item.status === "بانتظار اعتماد" || item.status === "بانتظار الموافقة"
  ).length;

  const addRequest = (values: Record<string, string>) => {
    const result = actions.commitTransition(state =>
      createMaintenanceRequest(state, {
        requestId: crypto.randomUUID(),
        title: values.title,
        propertyId: values.propertyId,
        unitId: values.unitId,
        priority: values.priority,
        capMinor: parseAmount(values.cap, -1),
      })
    );
    setActiveId(result.request.id);
    actions.show(
      "أنشئ طلب صيانة مرتبط بالعقار المختار في محفظته المستخلصة؛ لم يُنشأ مصروف أو دفع.",
      result.request.id
    );
  };

  const runOperatorTransition = <T,>(
    transition: (state: PrototypeState) => { state: PrototypeState; result: T },
    message: string,
    detail: string
  ): T | undefined => {
    try {
      const result = actions.commitTransition(transition);
      actions.show(message, detail);
      return result;
    } catch (error) {
      actions.show(
        error instanceof Error ? error.message : "تعذر إكمال عملية الصيانة.",
        detail
      );
      return undefined;
    }
  };

  const addPreventive = (values: Record<string, string>) => {
    const result = actions.commitTransition(state =>
      createPreventiveSchedule(state, {
        requestId: crypto.randomUUID(),
        title: values.title,
        propertyId: values.propertyId,
        unitId: values.unitId,
        cadence: values.cadence,
        nextDate: values.date,
        warranty: values.warranty,
      })
    );
    actions.show(
      "حُفظت الدورية الوقائية ضمن العقار المختار؛ لا تؤكد زيارة أو ضمانًا فعليًا.",
      result.schedule.id
    );
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F15/F16 · تشغيل موثق"
        title="الصيانة والوقاية"
        description="طلب مرتبط بعقار ووحدة، مراجعة واعتماد مالك وتكلفة ثم إنجاز ومصروف مستحق منفصل عن السداد، مع سجل وقاية وضمان."
      >
        <FormDialog
          title="طلب صيانة"
          description="اختر العقار صراحةً؛ تُستخلص محفظته منه. لا يرسل الطلب بلاغًا لمورد ولا ينشئ مصروفًا أو دفعًا."
          trigger={
            <button
              type="button"
              className="btn-primary"
              disabled={!actions.canEdit}
            >
              <Wrench size={16} /> طلب صيانة
            </button>
          }
          fields={[
            {
              key: "title",
              label: "وصف الطلب",
              required: true,
              placeholder: "مثال: تسرب في حمام الوحدة",
            },
            {
              key: "priority",
              label: "الأولوية",
              type: "select",
              required: true,
              options: [
                { value: "", label: "اختر الأولوية" },
                { value: "عاجلة", label: "عاجلة" },
                { value: "عادية", label: "عادية" },
                { value: "منخفضة", label: "منخفضة" },
              ],
            },
            ...scopeFields,
            {
              key: "cap",
              label: "سقف التكلفة (ر.ق)",
              type: "number",
              required: true,
              placeholder: "2500",
            },
          ]}
          submitLabel="إنشاء طلب محلي"
          onSubmit={addRequest}
        />
      </PageHeader>
      <DemoNotice mode="interactive">
        الدورة محلية وقابلة للتجربة: طلب ثم مراجعة واعتماد مالك وتكلفة وإنجاز ثم
        مصروف مستحق. إنشاء المصروف لا ينشئ فاتورة أو دفعًا أو حركة نقدية.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="طلبات مفتوحة"
          value={String(openCount)}
          detail="ضمن نطاق المحفظة"
          icon={<Wrench size={18} />}
        />
        <Metric
          label="بانتظار اعتماد"
          value={String(pendingApproval)}
          detail="قرار مستقل ظاهر"
          icon={<ShieldAlert size={18} />}
        />
        <Metric
          label="وقاية مجدولة"
          value={String(preventive.length)}
          detail="أصل وضمان ودورية"
          icon={<CalendarDays size={18} />}
        />
      </div>
      <TabBar
        items={[
          { key: "requests", label: "طلبات الصيانة" },
          { key: "preventive", label: "الوقاية والضمان" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "requests" ? (
        <>
          <div className="split-layout">
            <Panel
              title="لوحة الطلبات"
              description="اختيار السجل لا يغير حالته؛ كل انتقال له شرط وسجل تدقيق منفصل."
            >
              <EntityTable
                rows={maintenance}
                columns={maintenanceColumns(item => setActiveId(item.id))}
                onRow={row => setActiveId(row.id)}
                empty="لا توجد طلبات صيانة في هذا النطاق."
              />
            </Panel>
            <Panel
              title="دورة الطلب المحدد"
              description={active ? active.title : "اختر طلبًا من الجدول"}
            >
              {active ? (
                <div className="section-stack">
                  <p>
                    <StatusBadge status={active.status} />
                  </p>
                  {actions.state.settings.role === "owner" &&
                    ["بانتظار الموافقة", "بانتظار اعتماد"].includes(
                      active.status
                    ) && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          try {
                            actions.approveMaintenance(active.id);
                          } catch (error) {
                            actions.show(
                              error instanceof Error
                                ? error.message
                                : "تعذر تسجيل اعتماد المالك.",
                              active.id
                            );
                          }
                        }}
                      >
                        اعتماد مستقل لصاحب القرار
                      </button>
                    )}
                  <p className="muted">
                    العقار:{" "}
                    {properties.find(
                      property => property.id === active.propertyId
                    )?.title ?? "العقار المرتبط"}{" "}
                    · الوحدة: {metadataText(active, "unitId", "بدون وحدة")} ·
                    السقف: {money(active.amountMinor)} · التكلفة المرتبطة:{" "}
                    {money(Number(active.meta.costMinor ?? 0))} · المورد:{" "}
                    {metadataText(
                      active,
                      "vendor",
                      metadataText(active, "assignedTo", "غير مسند")
                    )}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {["طلب جديد", "جديد"].includes(active.status) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={!actions.canEdit}
                        onClick={() =>
                          runOperatorTransition(
                            state =>
                              submitMaintenanceForReview(state, active.id),
                            "أحيل طلب الصيانة إلى اعتماد المالك؛ لم تُربط تكلفة أو دفعة.",
                            active.id
                          )
                        }
                      >
                        طلب اعتماد المالك
                      </button>
                    )}
                    {active.status === "معتمد" && (
                      <FormDialog
                        title="ربط تكلفة معتمدة"
                        description="يسجل تكلفة العمل وتاريخ استحقاقها فقط. لا ينشئ هذا الإجراء مصروفًا أو سدادًا."
                        disabled={!actions.canEdit}
                        trigger={
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={!actions.canEdit}
                          >
                            ربط تكلفة معتمدة
                          </button>
                        }
                        fields={[
                          {
                            key: "cost",
                            label: "التكلفة المعتمدة (ر.ق)",
                            type: "number",
                            required: true,
                          },
                          {
                            key: "expenseDate",
                            label: "تاريخ استحقاق المصروف",
                            type: "date",
                            required: true,
                            defaultValue: scenarioDate(actions.state),
                          },
                          {
                            key: "classification",
                            label: "طبيعة التكلفة",
                            type: "select",
                            required: true,
                            options: [
                              {
                                value: "",
                                label: "اختر تشغيليًا أو رأسماليًا",
                              },
                              { value: "تشغيلي", label: "تشغيلي (OPEX)" },
                              { value: "رأسمالي", label: "رأسمالي (CAPEX)" },
                            ],
                          },
                          {
                            key: "category",
                            label: "فئة التكلفة",
                            required: true,
                            placeholder: "مثال: صيانة سباكة",
                          },
                        ]}
                        submitLabel="ربط تكلفة فقط"
                        onSubmit={values => {
                          const result = actions.commitTransition(state =>
                            linkMaintenanceCost(state, {
                              maintenanceId: active.id,
                              costMinor: parseAmount(values.cost, -1),
                              expenseDate: values.expenseDate,
                              classification: values.classification as
                                | "تشغيلي"
                                | "رأسمالي",
                              category: values.category,
                            })
                          );
                          actions.show(
                            `رُبطت تكلفة ${money(Number(result.meta.costMinor))} دون إنشاء مصروف أو دفع.`,
                            active.id
                          );
                        }}
                      />
                    )}
                    {active.status === "معتمد" &&
                      Number(active.meta.costMinor ?? 0) > 0 && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={!actions.canEdit}
                          onClick={() =>
                            runOperatorTransition(
                              state =>
                                completeMaintenanceWork(state, active.id),
                              "سُجل إنجاز العمل المحلي؛ لم يُنشأ مصروف أو سداد بعد.",
                              active.id
                            )
                          }
                        >
                          إثبات إنجاز العمل
                        </button>
                      )}
                    {["منجز", "مصروف مستحق"].includes(active.status) && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!actions.canEdit}
                        onClick={() => {
                          const result = runOperatorTransition(
                            state =>
                              materializeMaintenanceExpense(state, active.id),
                            "سُجل مصروف صيانة مستحق منفصل؛ لم تُسجل أي دفعة أو حركة نقدية.",
                            active.id
                          );
                          if (result) setActiveId(result.request.id);
                        }}
                      >
                        {active.status === "منجز"
                          ? "إنشاء مصروف مستحق"
                          : "التحقق من المصروف المرتبط"}
                      </button>
                    )}
                    {active.status === "مصروف مستحق" && (
                      <Link href="/expenses" className="btn-secondary">
                        انتقل إلى المصروفات لتسجيل سداد مستقل
                      </Link>
                    )}
                  </div>
                  <p className="muted small">
                    لا توجد فاتورة INV تجريبية ولا سداد تلقائي هنا. يبقى المصروف
                    غير مسدد حتى قرار مستقل في صفحة المصروفات.
                  </p>
                </div>
              ) : (
                <p className="muted">لا يوجد طلب محدد.</p>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <div className="split-layout">
          <Panel
            title="جدول الوقاية"
            description="مرتبط بعقار ووحدة بالمعرفات عند الإنشاء؛ لا ينفذ زيارة أو يؤكد صلاحية ضمان حقيقية."
          >
            <EntityTable
              rows={preventive}
              columns={[
                { key: "title", label: "الأصل" },
                {
                  key: "cadence",
                  label: "الدورية",
                  render: (row: DemoEntity) =>
                    metadataText(
                      row,
                      "cadence",
                      metadataText(row, "frequency")
                    ),
                },
                {
                  key: "next",
                  label: "الموعد",
                  render: (row: DemoEntity) =>
                    dateText(
                      metadataText(row, "nextDate", metadataText(row, "next"))
                    ),
                },
                {
                  key: "warranty",
                  label: "الضمان",
                  render: (row: DemoEntity) => metadataText(row, "warranty"),
                },
                {
                  key: "status",
                  label: "الحالة",
                  render: (row: DemoEntity) => (
                    <StatusBadge status={row.status} />
                  ),
                },
              ]}
              empty="لا توجد دوريات وقاية ضمن النطاق."
            />
          </Panel>
          <Panel title="إضافة وقاية">
            <FormDialog
              title="إضافة دورية وقائية"
              description="اختر العقار صراحةً؛ الوصف النصي ليس رابط الأصل أو الوحدة."
              trigger={
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!actions.canEdit}
                >
                  جدولة دورية
                </button>
              }
              fields={[
                {
                  key: "title",
                  label: "وصف الدورية",
                  required: true,
                  placeholder: "مثال: فحص مضخة المبنى",
                },
                ...scopeFields,
                {
                  key: "cadence",
                  label: "التكرار",
                  type: "select",
                  required: true,
                  options: [
                    { value: "", label: "اختر التكرار" },
                    { value: "شهري", label: "شهري" },
                    { value: "ربع سنوي", label: "ربع سنوي" },
                    { value: "سنوي", label: "سنوي" },
                  ],
                },
                {
                  key: "date",
                  label: "الموعد التالي",
                  type: "date",
                  defaultValue: scenarioDate(actions.state),
                },
                {
                  key: "warranty",
                  label: "مرجع الضمان",
                  placeholder: "W-EXAMPLE-2026",
                },
              ]}
              submitLabel="حفظ محلي"
              onSubmit={addPreventive}
            />
          </Panel>
        </div>
      )}
      <ActionResult>{actions.feedback}</ActionResult>
    </div>
  );
}

export function VendorsService() {
  const actions = useServiceActions("الموردون F17");
  const vendors = actions.filtered("vendors");
  const [sample, setSample] = useState(
    "اختر موردًا لعرض مؤشرات العينة، وهي ليست تقييمًا خارجيًا."
  );
  const averageCompletion = useMemo(
    () =>
      vendors.length
        ? Math.round(
            vendors.reduce(
              (sum, vendor) =>
                sum +
                Number(
                  metadataText(
                    vendor,
                    "completion",
                    metadataText(vendor, "completionRate", "0")
                  )
                ),
              0
            ) / vendors.length
          )
        : 0,
    [vendors]
  );

  const addVendor = (values: Record<string, string>) => {
    actions.add("vendors", values.title, {
      subtitle: "ملف مورد نموذجي بلا تحقق أو تواصل خارجي",
      status: "نشط تجريبيًا",
      meta: {
        skill: values.skill,
        coverage: values.coverage,
        availability: values.availability,
        sampleSize: 0,
        completion: 0,
        responseHours: "غير مقاس",
      },
    });
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F17 · شبكة موردين نموذجية"
        title="الموردون والمهارات"
        description="مهارة ونطاق وتوفر ومؤشرات لا تُقرأ إلا بحجم عينة معلن."
      >
        <FormDialog
          title="إضافة مورد نموذجي"
          description="لا تتحقق المنصة من الهوية أو الرخص ولا تراسل المورد."
          trigger={
            <button type="button" className="btn-primary">
              <HardHat size={16} /> إضافة مورد
            </button>
          }
          fields={[
            { key: "title", label: "اسم المورد النموذجي", required: true },
            {
              key: "skill",
              label: "المهارة",
              required: true,
              placeholder: "تكييف، سباكة…",
            },
            {
              key: "coverage",
              label: "النطاق",
              required: true,
              placeholder: "الدوحة - مثال",
            },
            {
              key: "availability",
              label: "التوفر",
              type: "select",
              required: true,
              options: [
                { value: "متاح هذا الأسبوع", label: "متاح هذا الأسبوع" },
                { value: "متاح لاحقًا", label: "متاح لاحقًا" },
                { value: "غير مؤكد", label: "غير مؤكد" },
              ],
            },
          ]}
          submitLabel="إضافة محلية"
          onSubmit={addVendor}
        />
      </PageHeader>
      <DemoNotice mode="simulation">
        هذه قائمة أمثلة لعلاقات تشغيلية محدودة؛ لا تُعد توصية، ولا تدل على تحقق
        أو توفر فعلي.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="موردون في النطاق"
          value={String(vendors.length)}
          detail="بيانات تجريبية"
          icon={<HardHat size={18} />}
        />
        <Metric
          label="متوسط الإكمال"
          value={`${averageCompletion}%`}
          detail="لا يظهر كتقييم دون عينة"
          icon={<CheckCircle2 size={18} />}
        />
        <Metric
          label="ضبط العينة"
          value="ظاهر"
          detail="المؤشر يوضح حجم السجل"
          icon={<ClipboardCheck size={18} />}
        />
      </div>
      <div className="split-layout">
        <Panel title="دليل الموردين">
          <EntityTable
            rows={vendors}
            columns={[
              { key: "title", label: "المورد" },
              {
                key: "skill",
                label: "المهارة",
                render: (row: DemoEntity) => metadataText(row, "skill"),
              },
              {
                key: "coverage",
                label: "النطاق",
                render: (row: DemoEntity) =>
                  metadataText(row, "coverage", metadataText(row, "area")),
              },
              {
                key: "availability",
                label: "التوفر",
                render: (row: DemoEntity) => (
                  <StatusBadge
                    status={metadataText(
                      row,
                      "availability",
                      metadataText(row, "available") === "true"
                        ? "متاح هذا الأسبوع"
                        : "غير مؤكد"
                    )}
                  />
                ),
              },
              {
                key: "sample",
                label: "العينة",
                render: (row: DemoEntity) =>
                  metadataText(
                    row,
                    "sampleSize",
                    metadataText(row, "jobs", "0")
                  ),
              },
            ]}
            onRow={row =>
              setSample(
                `«${row.title}»: إكمال ${metadataText(row, "completion", metadataText(row, "completionRate", "0"))}% من عينة حجمها ${metadataText(row, "sampleSize", metadataText(row, "jobs", "0"))}. لا يكفي ذلك لاتخاذ توصية آلية.`
              )
            }
            empty="لا يوجد موردون ضمن نطاق المحفظة."
          />
        </Panel>
        <Panel title="قراءة العينة" action={<ReceiptText size={18} />}>
          <p>{sample}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              actions.show(
                "تم إظهار تنبيه حجم العينة؛ لم يتغير تقييم مورد.",
                "F17"
              )
            }
          >
            تذكير بحدود المؤشر
          </button>
        </Panel>
      </div>
      <ActionResult>{actions.feedback}</ActionResult>
    </div>
  );
}

export function InspectionsService() {
  const actions = useServiceActions("المعاينات F18");
  const inspections = actions.filtered("inspections");
  const [comparison, setComparison] = useState(
    "اختر محضر دخول أو خروج لمقارنة بنود نموذجية."
  );
  const [decision, setDecision] = useState("لم يصدر قرار تسوية تأمين.");

  const addInspection = (values: Record<string, string>) => {
    actions.add("inspections", `${values.type}: ${values.unit}`, {
      subtitle: "محضر تجريبي بقائمة صور موسومة مثالًا",
      status: "مسودة محضر",
      meta: {
        type: values.type,
        unit: values.unit,
        checklist: values.checklist || "مطبخ، حمام، مفاتيح",
        media: "صور عقار خيالية للاختبار",
        defects: "لا توجد عيوب مؤكدة",
      },
    });
  };
  const compare = (inspection: DemoEntity) => {
    setComparison(
      `مقارنة نموذجية لمحضر «${inspection.title}»: قائمة الدخول والخروج تقارن يدويًا بندًا ببند. العيب لا يتحول لخصم أو صيانة إلا باختيار بشري.`
    );
    actions.show("أُنشئت معاينة مقارنة محلية للمحضر.", inspection.id);
  };
  const convertDefect = (inspection: DemoEntity) => {
    const request = actions.add("maintenance", `عيب من ${inspection.title}`, {
      subtitle: "محوّل يدويًا من محضر معاينة",
      status: "طلب جديد",
      meta: {
        sourceInspection: inspection.id,
        priority: "عادية",
        vendor: "غير مسند",
      },
    });
    if (request)
      actions.patch(
        "inspections",
        inspection.id,
        {
          status: "حُوّل عيب للصيانة",
          meta: { ...inspection.meta, maintenanceId: request.id },
        },
        `حُوّل عيب «${inspection.title}» إلى طلب صيانة مستقل.`
      );
  };
  const insuranceDecision = (inspection: DemoEntity, outcome: string) => {
    actions.patch(
      "inspections",
      inspection.id,
      {
        status: "قرار بشري مسجل",
        meta: {
          ...inspection.meta,
          insuranceDecision: outcome,
          photoBasis: false,
        },
      },
      `سُجل قرار تأمين بشري «${outcome}» دون خصم تلقائي أو اعتماد على صورة.`
    );
    setDecision(
      `قرار بشري للمحضر «${inspection.title}»: ${outcome}. هذا لا ينفذ خصمًا أو تسوية مالية.`
    );
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F18 · محاضر ومقارنة"
        title="معاينات الدخول والخروج"
        description="محاضر وقوائم وصور خيالية موسومة، مقارنة يدوية وتحويل عيب لصيانة وقرار تأمين غير آلي."
      >
        <FormDialog
          title="إعداد محضر"
          description="لا يجمع الموقع صورًا أو بيانات عقار حقيقية؛ تصف السجل فقط."
          trigger={
            <button type="button" className="btn-primary">
              <Camera size={16} /> محضر جديد
            </button>
          }
          fields={[
            {
              key: "type",
              label: "نوع المحضر",
              type: "select",
              required: true,
              options: [
                { value: "دخول", label: "دخول" },
                { value: "خروج", label: "خروج" },
              ],
            },
            {
              key: "unit",
              label: "الوحدة النموذجية",
              required: true,
              placeholder: "A-12",
            },
            {
              key: "checklist",
              label: "القائمة",
              type: "textarea",
              placeholder: "مطبخ، حمام، مفاتيح",
            },
          ]}
          submitLabel="حفظ محضر محلي"
          onSubmit={addInspection}
        />
      </PageHeader>
      <DemoNotice mode="simulation">
        الصورة أدناه مثال عقار خيالي موسوم لأغراض المحضر؛ لا تمثل مالكًا أو
        مستأجرًا حقيقيًا، ولا تكفي لقرار التأمين.
      </DemoNotice>
      <div className="split-layout">
        <Panel title="سجل المحاضر">
          <EntityTable
            rows={inspections}
            columns={[
              { key: "title", label: "المحضر" },
              {
                key: "type",
                label: "النوع",
                render: (row: DemoEntity) => metadataText(row, "type"),
              },
              {
                key: "checklist",
                label: "القائمة",
                render: (row: DemoEntity) => metadataText(row, "checklist"),
              },
              {
                key: "status",
                label: "الحالة",
                render: (row: DemoEntity) => (
                  <StatusBadge status={row.status} />
                ),
              },
              {
                key: "actions",
                label: "إجراء",
                render: (row: DemoEntity) => (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => compare(row)}
                    >
                      مقارنة
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => convertDefect(row)}
                    >
                      تحويل عيب
                    </button>
                  </div>
                ),
              },
            ]}
            onRow={compare}
            empty="لا توجد محاضر ضمن النطاق."
          />
        </Panel>
        <Panel title="معاينة المحضر" action={<Camera size={18} />}>
          <img
            src={BRAND_ASSETS.apartments}
            alt="صورة عقار خيالية موسومة كمثال لمحضر معاينة"
          />
          <p className="mini-label">
            صورة مثال خيالية لمحضر تجريبي، ليست دليلًا ولا تمثل مالكًا حقيقيًا.
          </p>
          <p>{comparison}</p>
        </Panel>
      </div>
      <Panel
        title="تسوية التأمين: قرار بشري مستقل"
        description="لا يستنتج النظام خصمًا من الصور أو المقارنة."
      >
        <div className="flex gap-2 flex-wrap">
          {inspections.slice(0, 1).map(inspection => (
            <div key={inspection.id} className="inline-actions">
              <button
                key={`${inspection.id}-approve`}
                type="button"
                className="btn-secondary"
                onClick={() =>
                  insuranceDecision(inspection, "تحتاج مراجعة وتسوية خارجية")
                }
              >
                تسجيل قرار مراجعة
              </button>
              <button
                key={`${inspection.id}-none`}
                type="button"
                className="btn-secondary"
                onClick={() => insuranceDecision(inspection, "لا خصم تلقائي")}
              >
                لا خصم تلقائي
              </button>
            </div>
          ))}
        </div>
        <p className="muted">{decision}</p>
      </Panel>
      <ActionResult>{actions.feedback}</ActionResult>
    </div>
  );
}
