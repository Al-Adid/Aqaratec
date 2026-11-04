import { useMemo, useState } from "react";
import { BellRing, BriefcaseBusiness, CalendarClock, CheckCheck, Gavel, ListTodo, SendHorizonal, ShieldAlert, UserRoundCheck } from "lucide-react";
import { type DemoEntity } from "@shared/prototype";
import { DemoNotice, EntityTable, FormDialog, Metric, PageHeader, Panel, TabBar } from "@/components/app/Primitives";
import { ActionResult, dateText, metadataText, money, parseAmount, StatusBadge, TODAY, useServiceActions } from "./shared";

export function DisputesService() {
  const actions = useServiceActions("النزاعات F19");
  const disputes = actions.filtered("disputes");
  const [detail, setDetail] = useState("اختر قضية لعرض الموعد والأثر المحتمل بشكل منفصل.");
  const potential = useMemo(() => disputes.reduce((sum, dispute) => sum + dispute.amountMinor, 0), [disputes]);

  const addDispute = (values: Record<string, string>) => {
    const dispute = actions.add("disputes", values.title, {
      subtitle: "قضية نموذجية لا تمثل ملفًا قانونيًا أو استشارة",
      status: "مفتوح",
      date: values.hearing || TODAY,
      amountMinor: parseAmount(values.impact),
      meta: { parties: values.parties, lawyer: values.lawyer || "غير مسند", hearing: values.hearing || "غير مجدول", attachments: "بيانات وصفية فقط", impactType: "أثر محتمل · ليس التزامًا مؤكدًا" },
    });
    if (dispute) setDetail(`تم فتح «${dispute.title}» في النموذج. لا يمثل ذلك قيدًا قانونيًا أو ماليًا فعليًا.`);
  };
  const schedule = (dispute: DemoEntity) => {
    const hearing = dispute.date || "2026-11-02";
    actions.patch("disputes", dispute.id, { status: "موعد مجدول", meta: { ...dispute.meta, hearing } }, `حُدد موعد تجريبي للقضية «${dispute.title}» في ${dateText(hearing)}.`);
    setDetail(`موعد تجريبي: ${dateText(hearing)} · المحامي: ${metadataText(dispute, "lawyer")}. الأثر ${money(dispute.amountMinor)} محتمل ومنفصل عن النقد والذمم.`);
  };
  const close = (dispute: DemoEntity) => {
    actions.status("disputes", dispute.id, "قيد المراجعة القانونية", `حُدثت حالة «${dispute.title}» للمراجعة؛ لم تُغلق قضية فعلية.`);
  };

  return <div className="section-stack">
    <PageHeader eyebrow="F19 · أثر محتمل منفصل" title="النزاعات والمواعيد" description="قضية ومحام وموعد وبيانات مرفقات وصفية، مع أثر محتمل لا يختلط بالنقد أو الالتزام المؤكد.">
      <FormDialog title="تسجيل قضية نموذجية" description="لا يرسل هذا النموذج مراسلات أو مرفقات، ولا يعد استشارة قانونية." trigger={<button type="button" className="btn-primary"><Gavel size={16} /> قضية جديدة</button>} fields={[
        { key: "title", label: "عنوان القضية", required: true, placeholder: "اعتراض على بند صيانة · مثال" },
        { key: "parties", label: "الأطراف النموذجية", required: true },
        { key: "lawyer", label: "المحامي / المسؤول", placeholder: "اسم تجريبي" },
        { key: "hearing", label: "الموعد", type: "date" },
        { key: "impact", label: "الأثر المحتمل (ر.ق)", type: "number", placeholder: "0" },
      ]} submitLabel="حفظ محلي" onSubmit={addDispute} />
    </PageHeader>
    <DemoNotice mode="interactive">سجل النزاع للتجربة فقط؛ الأثر المحتمل ليس قيدًا محاسبيًا ولا قيمة يمكن تحصيلها أو دفعها.</DemoNotice>
    <div className="stats-grid"><Metric label="قضايا في النطاق" value={String(disputes.length)} detail="ملفات نموذجية" icon={<BriefcaseBusiness size={18} />} /><Metric label="أثر محتمل" value={money(potential)} detail="منفصل عن النقد والالتزامات" icon={<ShieldAlert size={18} />} /><Metric label="مواعيد ظاهرة" value={String(disputes.filter((d) => metadataText(d, "hearing") !== "غير مجدول").length)} detail="غير مرتبطة بتقويم خارجي" icon={<CalendarClock size={18} />} /></div>
    <div className="split-layout"><Panel title="سجل القضايا"><EntityTable rows={disputes} columns={[
      { key: "title", label: "القضية" }, { key: "lawyer", label: "المحامي", render: (row: DemoEntity) => metadataText(row, "lawyer") }, { key: "hearing", label: "الموعد", render: (row: DemoEntity) => dateText(metadataText(row, "hearing")) }, { key: "impact", label: "أثر محتمل", render: (row: DemoEntity) => money(row.amountMinor) }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "action", label: "إجراء", render: (row: DemoEntity) => <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => schedule(row)}>موعد</button><button type="button" className="btn-ghost" onClick={() => close(row)}>مراجعة</button></div> },
    ]} onRow={schedule} empty="لا توجد قضايا ضمن النطاق." /></Panel><Panel title="ملخص منفصل"><p>{detail}</p><p className="muted">المرفقات هنا أسماء وصفية فقط؛ لا تُرفع أو تُفتح مستندات قانونية.</p></Panel></div>
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}

export function TasksService() {
  const actions = useServiceActions("المهام F20");
  const tasks = actions.filtered("tasks");
  const [tab, setTab] = useState("list");
  const [summary, setSummary] = useState("لا توجد موجزات مولدة خارج بيانات التجربة.");
  const dueSoon = tasks.filter((task) => task.date && task.date <= "2026-10-31" && task.status !== "منجز").length;

  const addTask = (values: Record<string, string>) => {
    actions.add("tasks", values.title, { subtitle: "مهمة تشغيلية محلية", status: "مفتوح", date: values.due || TODAY, meta: { owner: values.owner, urgency: values.urgency, brief: values.brief || "لا موجز بعد", escalated: false } });
  };
  const complete = (task: DemoEntity) => {
    actions.status("tasks", task.id, "منجز", `أُنجزت المهمة «${task.title}» داخل النموذج.`);
  };
  const escalate = (task: DemoEntity) => {
    actions.patch("tasks", task.id, { status: "مصعّد", meta: { ...task.meta, escalated: true, escalationAt: TODAY } }, `صُعّدت «${task.title}» مع ظهور ذلك في الحالة والموجز.`);
  };
  const buildBrief = () => {
    const open = tasks.filter((task) => task.status !== "منجز");
    const text = `موجز اليوم محليًا: ${open.length} مهمة مفتوحة، منها ${open.filter((task) => task.status === "مصعّد").length} مصعّدة و${dueSoon} موعدها قريب. لا نرسل هذا الموجز لأي قناة.`;
    setSummary(text);
    actions.show("تم إنشاء موجز محلي من المهام الظاهرة.", "F20");
  };

  return <div className="section-stack">
    <PageHeader eyebrow="F20 · متابعة تشغيلية" title="المهام والموجز" description="مسؤول وموجز وتقويم وحالة وتصعيد، مع نتيجة مرئية لكل تحديث.">
      <FormDialog title="مهمة جديدة" description="لا تسند المهمة إلى مستخدم فعلي ولا ترسل إشعارًا خارجيًا." trigger={<button type="button" className="btn-primary"><ListTodo size={16} /> مهمة جديدة</button>} fields={[
        { key: "title", label: "عنوان المهمة", required: true }, { key: "owner", label: "المسؤول النموذجي", required: true }, { key: "due", label: "موعد الاستحقاق", type: "date" }, { key: "urgency", label: "الأولوية", type: "select", required: true, options: [{ value: "عالية", label: "عالية" }, { value: "عادية", label: "عادية" }, { value: "منخفضة", label: "منخفضة" }] }, { key: "brief", label: "ملاحظة موجزة", type: "textarea" },
      ]} submitLabel="إضافة محلية" onSubmit={addTask} />
    </PageHeader>
    <DemoNotice mode="interactive">المسؤولون والتقويم محاكاة داخل المتصفح ولا تمثل عضوية أو إشعارًا أو حجز وقت حقيقي.</DemoNotice>
    <div className="stats-grid"><Metric label="المهام المفتوحة" value={String(tasks.filter((t) => t.status !== "منجز").length)} detail="في نطاق المحفظة" icon={<ListTodo size={18} />} /><Metric label="قريبة الاستحقاق" value={String(dueSoon)} detail="حتى 31 أكتوبر 2026" icon={<CalendarClock size={18} />} /><Metric label="مصعّدة" value={String(tasks.filter((t) => t.status === "مصعّد").length)} detail="تظهر في الموجز" icon={<ShieldAlert size={18} />} /></div>
    <TabBar items={[{ key: "list", label: "قائمة العمل" }, { key: "calendar", label: "تقويم تجريبي" }, { key: "brief", label: "الموجز" }]} value={tab} onChange={setTab} />
    {tab === "list" && <Panel title="قائمة المهام"><EntityTable rows={tasks} columns={[
      { key: "title", label: "المهمة" }, { key: "owner", label: "المسؤول", render: (row: DemoEntity) => metadataText(row, "owner") }, { key: "date", label: "الاستحقاق", render: (row: DemoEntity) => dateText(row.date) }, { key: "urgency", label: "الأولوية", render: (row: DemoEntity) => metadataText(row, "urgency") }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "action", label: "إجراء", render: (row: DemoEntity) => <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => complete(row)}>إنجاز</button><button type="button" className="btn-ghost" onClick={() => escalate(row)}>تصعيد</button></div> },
    ]} empty="لا توجد مهام في النطاق الحالي." /></Panel>}
    {tab === "calendar" && <Panel title="تقويم الاستحقاقات" description="عرض محلي مختصر، لا ينشئ دعوات أو حجزًا."><div className="section-stack">{tasks.length ? tasks.slice().sort((a, b) => a.date.localeCompare(b.date)).map((task) => <div key={task.id} className="flex justify-between gap-3"><span>{dateText(task.date)} · {task.title}</span><StatusBadge status={task.status} /></div>) : <p className="muted">لا توجد استحقاقات للعرض.</p>}</div></Panel>}
    {tab === "brief" && <Panel title="الموجز اليومي" action={<button type="button" className="btn-secondary" onClick={buildBrief}><CheckCheck size={16} /> توليد موجز محلي</button>}><p>{summary}</p></Panel>}
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}

export function NotificationsService() {
  const actions = useServiceActions("التنبيهات F21");
  const notifications = actions.filtered("notifications");
  const [tab, setTab] = useState("outbox");
  const [delivery, setDelivery] = useState("لا يوجد سجل تسليم معروض.");

  const addNotification = (values: Record<string, string>) => {
    actions.add("notifications", values.title, { subtitle: "رسالة نموذجية بانتظار الموافقة", status: "بانتظار موافقة", date: TODAY, meta: { channel: values.channel, template: values.template, consent: values.consent, preference: values.preference, sent: false, costMinor: 0, delivery: "لم تحاكَ بعد" } });
  };
  const approve = (notice: DemoEntity) => {
    actions.status("notifications", notice.id, "معتمد للمحاكاة", `اعتمدت الرسالة «${notice.title}» داخل التجربة دون إرسال.`);
    setDelivery(`الموافقة ظاهرة للرسالة «${notice.title}». لم تستخدم أي قناة خارجية.`);
  };
  const sendSimulation = (notice: DemoEntity) => {
    if (metadataText(notice, "sent", "false") === "true") {
      actions.show("مُنعت محاكاة التكرار: السجل يحمل حالة مُرسل بالفعل.", notice.id);
      setDelivery(`منع تكرار ظاهر: «${notice.title}» سبق أن حاكى الإرسال.`);
      return;
    }
    if (notice.status !== "معتمد للمحاكاة") {
      actions.show("يلزم اعتماد مستقل قبل محاكاة الإرسال.", notice.id);
      setDelivery(`لم تُحاكَ الرسالة «${notice.title}» لأنها بانتظار اعتماد.`);
      return;
    }
    actions.patch("notifications", notice.id, { status: "تمت محاكاة الإرسال", meta: { ...notice.meta, sent: true, delivery: "تم التسليم التجريبي", deliveredAt: `${TODAY} 10:00`, costMinor: 0 } }, `تمت محاكاة تسليم «${notice.title}» عبر ${metadataText(notice, "channel")}; لم تُرسل رسالة.`);
    setDelivery(`سجل تسليم تجريبي: ${notice.title} · ${metadataText(notice, "channel")} · ${TODAY} 10:00 · تكلفة 0 ر.ق · لا قناة فعلية.`);
  };

  return <div className="section-stack">
    <PageHeader eyebrow="F21 · موافقة قبل المحاكاة" title="التنبيهات والتفضيلات" description="قناة وقالب وموافقة وتفضيل وسجل تسليم، مع منع تكرار واضح ومحاكاة لا إرسال خارجي.">
      <FormDialog title="إعداد تنبيه" description="لن تُرسل رسالة؛ ستبقى في سجل محلي بانتظار اعتماد." trigger={<button type="button" className="btn-primary"><BellRing size={16} /> تنبيه جديد</button>} fields={[
        { key: "title", label: "عنوان التنبيه", required: true }, { key: "channel", label: "القناة", type: "select", required: true, options: [{ value: "رسالة نصية · محاكاة", label: "رسالة نصية · محاكاة" }, { value: "بريد · محاكاة", label: "بريد · محاكاة" }, { value: "داخل التطبيق", label: "داخل التطبيق" }] }, { key: "template", label: "القالب", type: "select", required: true, options: [{ value: "تذكير استحقاق", label: "تذكير استحقاق" }, { value: "تحديث صيانة", label: "تحديث صيانة" }, { value: "موعد معاينة", label: "موعد معاينة" }] }, { key: "consent", label: "الموافقة", type: "select", required: true, options: [{ value: "موافقة نموذجية موثقة", label: "موافقة نموذجية موثقة" }, { value: "تحتاج تأكيدًا", label: "تحتاج تأكيدًا" }] }, { key: "preference", label: "التفضيل", type: "select", required: true, options: [{ value: "قناة مفضلة", label: "قناة مفضلة" }, { value: "لا إرسال ليلي", label: "لا إرسال ليلي" }] },
      ]} submitLabel="حفظ محلي" onSubmit={addNotification} />
    </PageHeader>
    <DemoNotice mode="simulation">الإرسال الخارجي غير متصل. «تمت محاكاة الإرسال» تعني تغيير الحالة وسجل تسليم محليين فقط.</DemoNotice>
    <div className="stats-grid"><Metric label="بانتظار موافقة" value={String(notifications.filter((n) => n.status === "بانتظار موافقة").length)} detail="قرار منفصل قبل المحاكاة" icon={<UserRoundCheck size={18} />} /><Metric label="محاكاة مسلمة" value={String(notifications.filter((n) => n.status === "تمت محاكاة الإرسال").length)} detail="لا دليل على تسليم فعلي" icon={<SendHorizonal size={18} />} /><Metric label="تكلفة تجريبية" value="0 ر.ق" detail="لا مزود ولا فوترة" icon={<BellRing size={18} />} /></div>
    <TabBar items={[{ key: "outbox", label: "السجل والموافقة" }, { key: "preferences", label: "التفضيلات والقوالب" }]} value={tab} onChange={setTab} />
    {tab === "outbox" ? <div className="split-layout"><Panel title="سجل التنبيهات"><EntityTable rows={notifications} columns={[
      { key: "title", label: "التنبيه" }, { key: "channel", label: "القناة", render: (row: DemoEntity) => metadataText(row, "channel") }, { key: "template", label: "القالب", render: (row: DemoEntity) => metadataText(row, "template") }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "action", label: "إجراء", render: (row: DemoEntity) => <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => approve(row)}>اعتماد</button><button type="button" className="btn-ghost" onClick={() => sendSimulation(row)}>محاكاة إرسال</button></div> },
    ]} empty="لا توجد تنبيهات محلية بعد." /></Panel><Panel title="سجل التسليم"><p>{delivery}</p></Panel></div> : <Panel title="القوالب والتفضيلات"><div className="section-stack"><p><strong>تذكير استحقاق:</strong> يُراجع قبل المحاكاة ويحترم التفضيل المسجل في المثال.</p><p><strong>تحديث صيانة:</strong> لا يراسل موردًا أو مستأجرًا حقيقيًا.</p><p className="muted">الموافقة والتفضيلات هنا سجلات نموذجية وليست دليلًا على موافقة تسويقية حقيقية.</p></div></Panel>}
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}
