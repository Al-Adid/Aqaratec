import { useMemo, useState } from "react";
import { BadgeCheck, BotMessageSquare, CalendarCheck2, CheckCircle2, ClipboardList, ExternalLink, FileText, Handshake, Megaphone, MessageCircleMore, Send, Sparkles, UserCheck, UsersRound } from "lucide-react";
import { type DemoEntity } from "@shared/prototype";
import { DemoNotice, EmptyState, EntityTable, FormDialog, Metric, PageHeader, Panel, TabBar } from "@/components/app/Primitives";
import { ActionResult, dateText, metadataText, money, StatusBadge, TODAY, useServiceActions } from "./shared";

type Conversation = { id: string; role: "user" | "assistant"; text: string };

export function PortalsService() {
  const actions = useServiceActions("البوابات F22");
  const currentRole = actions.state.settings.role;
  const leases = actions.filtered("leases");
  const maintenance = actions.filtered("maintenance");
  const ownerDecisions = actions.filtered("distributions");
  const [view, setView] = useState(currentRole);

  const chooseRole = (role: "owner" | "tenant" | "vendor" | "operator") => {
    setView(role);
    actions.setSetting("role", role);
    actions.show(`تم تغيير معاينة الدور إلى «${role}». لا يعني ذلك تسجيل دخول أو تحقق هوية.`, "F22");
  };
  const ownerApproval = () => actions.ownerApproval("قرار مالك مستقل", "موافقة منفصلة على توزيع مقترح؛ لا تغيّر عقدًا أو دفعة.");
  const pendingOwnerDecisions = ownerDecisions.filter((decision) => decision.status === "بانتظار الاعتماد");
  const vendorWork = maintenance.filter((request) => metadataText(request, "vendor", metadataText(request, "assignedTo", "غير مسند")) !== "غير مسند");

  return <div className="section-stack">
    <PageHeader eyebrow="F22 · معاينة علاقة مقيدة" title="بوابات الأطراف" description="معاينات مالك ومستأجر ومقاول بحسب علاقة المثال؛ ليست حسابات دخول ولا تحقق هوية أو تفويض خادم." />
    <DemoNotice mode="simulation">تغيير الدور يغير شكل السيناريو فقط. لا يكشف النظام محفظة أخرى ولا ينشئ صلاحية عامة أو جلسة هوية.</DemoNotice>
    <TabBar items={[{ key: "owner", label: "بوابة المالك" }, { key: "tenant", label: "بوابة المستأجر" }, { key: "vendor", label: "بوابة المقاول" }, { key: "operator", label: "المشغّل" }]} value={view} onChange={(role) => chooseRole(role as "owner" | "tenant" | "vendor" | "operator")} />
    {view === "owner" && <div className="split-layout">
      <Panel title="كشف المالك التجريبي" description="قراءة مختصرة للمحفظة المحددة فقط؛ لا توجد أدوات تعديل عامة.">
        <div className="section-stack"><p>النقد الحر في النموذج: {actions.financials.freeCashMinor ? money(actions.financials.freeCashMinor) : "غير متاح"}</p><p>عدد العقارات في النطاق: {actions.financials.propertyCount}</p><p className="muted">لرؤية زر الموافقة المستقل بدّل معاينة الدور إلى «مالك». لا يغيّر هذا الزر أي مدفوعات أو عقود.</p></div>
      </Panel>
      <Panel title="موافقة مستقلة" action={<BadgeCheck size={18} />}><p>هذه الموافقة منفصلة ومقصودة: تغير حالة قرار قائم فقط، ولا تمنح حق تحرير عام أو تنفذ دفعة.</p><button type="button" className="btn-primary" onClick={ownerApproval}>اعتماد القرار القائم</button><p className="muted">قرارات بانتظار المالك: {pendingOwnerDecisions.length}</p></Panel>
    </div>}
    {view === "tenant" && <Panel title="عقد المستأجر في السيناريو" description="نموذج عقد للعلاقة المفترضة فقط، ولا يكشف مستأجرين أو وحدات أخرى.">{leases.length ? <EntityTable rows={leases.slice(0, 1)} columns={[{ key: "title", label: "العقد" }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "date", label: "التاريخ", render: (row: DemoEntity) => dateText(row.date) }]} /> : <EmptyState title="لا يوجد عقد نموذجي ضمن النطاق" description="هذه نتيجة قراءة وليست طلب إنشاء أو تعديل عقد." />}</Panel>}
    {view === "vendor" && <Panel title="أعمال المقاول في السيناريو" description="تعرض الأعمال المسندة للمورد النموذجي فقط، بلا وصول إلى عقود أو بيانات مستأجرين.">{vendorWork.length ? <EntityTable rows={vendorWork} columns={[{ key: "title", label: "العمل" }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "date", label: "الموعد", render: (row: DemoEntity) => metadataText(row, "scheduled", metadataText(row, "due", "غير مجدول")) }]} /> : <EmptyState title="لا توجد أعمال مسندة" description="لا يمكن للمقاول إنشاء عمل أو تعديل حالة هنا." />}</Panel>}
    {view === "operator" && <Panel title="معاينة المشغّل" description="يمكن للمشغّل الرجوع إلى صفحات التشغيل حيث تتوفر الإجراءات المحلية وفق canEdit."><p>هذه البوابة لا تضيف تحريرًا جديدًا؛ إنها فقط توضح فصل تجربة كل طرف.</p></Panel>}
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}

function assistantReply(input: string) {
  const normalized = input.toLowerCase();
  if (/(استثمار|عائد|شراء|بيع)/.test(normalized)) return "لا أقدم توصية استثمارية أو توقع عائد. يمكنني تسجيل سؤال لتراجعه الجهة البشرية في النموذج.";
  if (/(دفع|حول|فاتورة|رصيد)/.test(normalized)) return "لا أؤكد دفعًا ولا أتعامل مع الأموال. يمكنني فقط إنشاء طلب متابعة تجريبي للمشغّل.";
  if (/(حجز|موعد|زيارة|معاينة)/.test(normalized)) return "يمكنني إعداد طلب حجز تجريبي؛ لا يتصل هذا النموذج بتقويم أو مزود رسائل.";
  return "هذا رد توضيحي محلي، وليس واتسابًا أو ذكاءً موصولًا. أستطيع تحويل الرسالة إلى طلب أو تصعيده للمراجعة البشرية.";
}

export function AssistantService() {
  const actions = useServiceActions("المساعد F23");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Conversation[]>([{ id: "welcome", role: "assistant", text: "مرحبًا، أنا مساعد تجريبي محلي. أوضح مسار الخدمة ولا أتصل بواتساب أو أنفذ دفعًا أو أقدم توصية استثمارية." }]);
  const [lastRequest, setLastRequest] = useState("لا يوجد طلب محول بعد.");

  const chat = (text = input) => {
    const clean = text.trim();
    if (!clean) return;
    const reply = assistantReply(clean);
    setMessages((previous) => [...previous, { id: `u-${Date.now()}`, role: "user", text: clean }, { id: `a-${Date.now()}`, role: "assistant", text: reply }]);
    setInput("");
    actions.show("أُضيف رد توضيحي محلي إلى المحادثة؛ لا توجد قناة واتساب فعلية.", "F23");
  };
  const createRequest = (kind: "طلب" | "حجز" | "تصعيد") => {
    const text = messages.filter((message) => message.role === "user").at(-1)?.text ?? "طلب من مساعد تجريبي";
    const task = actions.add("tasks", `${kind}: ${text.slice(0, 48)}`, { subtitle: "محول من مساعد محلي غير موصول", status: kind === "تصعيد" ? "مصعّد" : "مفتوح", meta: { source: "مساعد تجريبي", assistantSummary: text, requestType: kind, booking: kind === "حجز" } });
    if (task) setLastRequest(`تم إنشاء ${kind} محليًا: «${task.title}». لم يُرسل إلى واتساب أو تقويم أو طرف خارجي.`);
  };

  return <div className="section-stack">
    <PageHeader eyebrow="F23 · محادثة محلية" title="مساعد المحادثة" description="واجهة عربية/English تجريبية للإيضاح وتحويل طلب أو حجز أو تصعيد، بلا واتساب أو LLM أو قناة خارجية." />
    <DemoNotice mode="simulation">الردود قواعد توضيحية محلية محددة مسبقًا. لا توصية استثمارية، ولا تأكيد دفع، ولا كشف لمحفظة أخرى، ولا رسالة واتساب فعلية.</DemoNotice>
    <div className="split-layout">
      <Panel title="محادثة تجريبية" action={<MessageCircleMore size={18} />}>
        <div className="section-stack">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "text-start" : "muted"}><span className="mini-label">{message.role === "user" ? "أنت" : "المساعد المحلي"}</span><p>{message.text}</p></div>)}</div>
        <div className="flex gap-2"><input className="field" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); chat(); } }} placeholder="اكتب استفسارًا تجريبيًا…" /><button type="button" className="btn-primary" onClick={() => chat()}><Send size={16} /> إرسال محلي</button></div>
      </Panel>
      <Panel title="تحويل واضح" description="كل خيار ينشئ مهمة محلية، وليس تنفيذًا للخدمة."><div className="section-stack"><button type="button" className="btn-secondary" onClick={() => createRequest("طلب")}>تحويل إلى طلب</button><button type="button" className="btn-secondary" onClick={() => createRequest("حجز")}>طلب حجز تجريبي</button><button type="button" className="btn-secondary" onClick={() => createRequest("تصعيد")}>تصعيد للمراجعة البشرية</button><p>{lastRequest}</p><button type="button" className="link-button" onClick={() => chat("ما حدود هذا المساعد؟")}>ما حدود المساعد؟</button></div></Panel>
    </div>
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}

export function MarketingService() {
  const actions = useServiceActions("التسويق وطلبات التأجير F24/F25");
  const [tab, setTab] = useState("listings");
  const [preview, setPreview] = useState("اختر إعلانًا لعرض صفحة معاينة محلية.");
  const listings = actions.filtered("listings");
  const applications = actions.filtered("applications");
  const vacancies = actions.filtered("vacancies");
  const interested = applications.filter((application) => metadataText(application, "interest", "false") === "true").length;

  const addListing = (values: Record<string, string>) => {
    actions.add("listings", values.title, { subtitle: "إعلان شاغر تجريبي غير منشور خارجيًا", status: "مسودة إعلان", meta: { vacancy: values.vacancy, unit: values.unit, viewingConsent: values.viewingConsent, interested: 0, approved: false, published: false } });
  };
  const approveListing = (listing: DemoEntity) => {
    const approval = actions.add("approvals", `موافقة نشر: ${listing.title}`, { subtitle: "موافقة مستقلة لنشر محاكى", status: "تمت الموافقة", meta: { listingId: listing.id, publication: "محاكاة" } });
    if (approval) actions.patch("listings", listing.id, { status: "معتمد للنشر المحاكى", meta: { ...listing.meta, approved: true, approvalId: approval.id } }, `اعتمد إعلان «${listing.title}» للنشر المحاكى فقط.`);
  };
  const publishListing = (listing: DemoEntity) => {
    if (metadataText(listing, "approved", "false") !== "true") {
      actions.show("يتطلب الإعلان موافقة نشر مستقلة قبل المحاكاة.", listing.id);
      setPreview(`لم يُنشر «${listing.title}»: بانتظار الموافقة المستقلة.`);
      return;
    }
    actions.patch("listings", listing.id, { status: "منشور محاكى", meta: { ...listing.meta, published: true, publishedAt: TODAY } }, `تمت محاكاة نشر إعلان «${listing.title}»؛ لم ينشر في أي منصة.`);
    setPreview(`صفحة إعلان محاكية: ${listing.title} · الوحدة ${metadataText(listing, "unit")} · النشر محلي فقط ولا يستنسخ أو ينشر إعلانًا خارجيًا.`);
  };
  const addApplication = (values: Record<string, string>) => {
    actions.add("applications", values.title, { subtitle: "طلب تأجير تجريبي ببيانات وصفية فقط", status: "جديد", meta: { listing: values.listing, consent: values.consent, documents: "مستندات نموذجية غير مرفوعة", interest: values.interest === "نعم", objectiveCriteria: values.criteria || "اكتمال النموذج وموافقة المعاينة" } });
  };
  const review = (application: DemoEntity) => actions.status("applications", application.id, "قيد الفرز البشري", `بدأ فرز بشري للطلب «${application.title}» وفق معايير ظاهرة؛ لا قائمة سوداء أو فحص ائتماني.`);
  const decide = (application: DemoEntity, outcome: "مقبول مبدئيًا" | "مرفوض بعد مراجعة") => actions.patch("applications", application.id, { status: outcome, meta: { ...application.meta, decision: "بشري", decisionAt: TODAY } }, `سُجل قرار بشري «${outcome}» للطلب «${application.title}»؛ لا يبرم عقدًا تلقائيًا.`);

  return <div className="section-stack">
    <PageHeader eyebrow="F24/F25 · نشر وفرز محاكيان" title="التسويق وطلبات التأجير" description="عرض شاغر وإعلان ومهتمون وموافقة معاينة ونشر محاكى، ثم طلب وموافقة وفرز بشري وقرار واضح.">
      {tab === "listings" ? <FormDialog title="إعلان شاغر تجريبي" description="ينشئ مسودة محلية ولا ينشر في منصة أو يستنسخ إعلانًا للغير." trigger={<button type="button" className="btn-primary"><Megaphone size={16} /> إعلان جديد</button>} fields={[
        { key: "title", label: "عنوان الإعلان", required: true }, { key: "unit", label: "الوحدة النموذجية", required: true }, { key: "vacancy", label: "سجل الشاغر", type: "select", required: true, options: vacancies.map((vacancy) => ({ value: vacancy.id, label: vacancy.title })).length ? vacancies.map((vacancy) => ({ value: vacancy.id, label: vacancy.title })) : [{ value: "vacancy-demo", label: "شاغر نموذجي" }] }, { key: "viewingConsent", label: "موافقة المعاينة", type: "select", required: true, options: [{ value: "موافقة معاينة نموذجية", label: "موافقة معاينة نموذجية" }, { value: "تحتاج تأكيدًا", label: "تحتاج تأكيدًا" }] },
      ]} submitLabel="حفظ مسودة" onSubmit={addListing} /> : <FormDialog title="طلب تأجير تجريبي" description="لا يرفع مستندات حقيقية، ولا يجري فحص ائتمان أو قائمة سوداء." trigger={<button type="button" className="btn-primary"><ClipboardList size={16} /> طلب جديد</button>} fields={[
        { key: "title", label: "اسم المتقدم النموذجي", required: true }, { key: "listing", label: "الإعلان", type: "select", required: true, options: listings.map((listing) => ({ value: listing.id, label: listing.title })).length ? listings.map((listing) => ({ value: listing.id, label: listing.title })) : [{ value: "listing-demo", label: "إعلان تجريبي" }] }, { key: "consent", label: "موافقة معالجة الطلب", type: "select", required: true, options: [{ value: "موافقة نموذجية", label: "موافقة نموذجية" }, { value: "تحتاج تأكيدًا", label: "تحتاج تأكيدًا" }] }, { key: "interest", label: "مهتم بمعاينة", type: "select", required: true, options: [{ value: "نعم", label: "نعم" }, { value: "لا", label: "لا" }] }, { key: "criteria", label: "معايير فرز معلنة", placeholder: "اكتمال النموذج وموافقة المعاينة" },
      ]} submitLabel="تسجيل محلي" onSubmit={addApplication} />}
    </PageHeader>
    <DemoNotice mode="simulation">كل النشر والتواصل والفرز هنا محاكاة صريحة. لا تنتج هذه الشاشة إعلانًا خارجيًا أو عقدًا أو قرار قبول تلقائيًا.</DemoNotice>
    <div className="stats-grid"><Metric label="إعلانات في النطاق" value={String(listings.length)} detail="مسودات أو نشر محاكى" icon={<Megaphone size={18} />} /><Metric label="طلبات التأجير" value={String(applications.length)} detail="تحت قرار بشري" icon={<UsersRound size={18} />} /><Metric label="مهتمون بالمعاينة" value={String(interested)} detail="لا حجوزات خارجية" icon={<CalendarCheck2 size={18} />} /></div>
    <TabBar items={[{ key: "listings", label: "الشواغر والإعلانات" }, { key: "applications", label: "الطلبات والفرز" }]} value={tab} onChange={setTab} />
    {tab === "listings" ? <div className="split-layout"><Panel title="سجل الإعلانات"><EntityTable rows={listings} columns={[
      { key: "title", label: "الإعلان" }, { key: "unit", label: "الوحدة", render: (row: DemoEntity) => metadataText(row, "unit") }, { key: "consent", label: "موافقة المعاينة", render: (row: DemoEntity) => metadataText(row, "viewingConsent") }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "action", label: "إجراء", render: (row: DemoEntity) => <div className="flex gap-2 flex-wrap"><button type="button" className="btn-ghost" onClick={() => approveListing(row)}>موافقة نشر</button><button type="button" className="btn-ghost" onClick={() => publishListing(row)}>نشر محاكى</button></div> },
    ]} onRow={(row) => setPreview(`معاينة «${row.title}»: شاغر مرتبط ${metadataText(row, "vacancy")}, الموافقة ${metadataText(row, "viewingConsent")}.`)} empty="لا توجد إعلانات ضمن النطاق." /></Panel><Panel title="صفحة معاينة الإعلان" action={<ExternalLink size={18} />}><p>{preview}</p><p className="muted">لا توجد صفحة عامة ولا رابط خارجي لهذا الإعلان.</p></Panel></div> : <Panel title="طلبات التأجير والفرز البشري"><EntityTable rows={applications} columns={[
      { key: "title", label: "المتقدم" }, { key: "consent", label: "الموافقة", render: (row: DemoEntity) => metadataText(row, "consent") }, { key: "criteria", label: "المعايير", render: (row: DemoEntity) => metadataText(row, "objectiveCriteria") }, { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> }, { key: "action", label: "قرار", render: (row: DemoEntity) => <div className="flex gap-2 flex-wrap"><button type="button" className="btn-ghost" onClick={() => review(row)}>فرز بشري</button><button type="button" className="btn-ghost" onClick={() => decide(row, "مقبول مبدئيًا")}>قبول مبدئي</button><button type="button" className="btn-ghost" onClick={() => decide(row, "مرفوض بعد مراجعة")}>رفض</button></div> },
    ]} empty="لا توجد طلبات تأجير محلية بعد." /><p className="muted">قرار القبول أو الرفض بشري ومحدود بالسجل التجريبي؛ لا توجد قوائم سوداء أو فحص ائتمان أو توقيع تلقائي.</p></Panel>}
    <ActionResult>{actions.feedback}</ActionResult>
  </div>;
}
