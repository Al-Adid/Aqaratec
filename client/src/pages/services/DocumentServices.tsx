import { useMemo, useState } from "react";
import { FileCheck2, FileClock, FilePlus2, Languages, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { DemoNotice, EntityTable, FormDialog, Metric, PageHeader, Panel, TabBar } from "@/components/app/Primitives";
import type { DemoEntity } from "@shared/prototype";
import { ActionResult, dateText, metadataText, StatusBadge, TODAY, useServiceActions } from "./shared";

function documentColumns(onVersion: (document: DemoEntity) => void, onRestore: (document: DemoEntity) => void) {
  return [
    { key: "title", label: "الملف" },
    { key: "category", label: "الفئة", render: (row: DemoEntity) => metadataText(row, "category", metadataText(row, "type", "وثيقة")) },
    { key: "version", label: "الإصدار", render: (row: DemoEntity) => `v${metadataText(row, "version", "1")}` },
    { key: "expiry", label: "الانتهاء", render: (row: DemoEntity) => dateText(metadataText(row, "expiry", metadataText(row, "expires"))) },
    { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> },
    {
      key: "actions", label: "إجراء", render: (row: DemoEntity) => (
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn-ghost" onClick={() => onVersion(row)}>إصدار</button>
          <button type="button" className="btn-ghost" onClick={() => onRestore(row)}>استعادة</button>
        </div>
      ),
    },
  ];
}

export function DocumentsService() {
  const actions = useServiceActions("الوثائق F13");
  const [tab, setTab] = useState("files");
  const [preview, setPreview] = useState("اختر ملفًا لإظهار معاينة بياناته الوصفية فقط.");
  const documents = actions.filtered("documents").filter(row => !String(row.meta.recordType ?? "").startsWith("lease-template"));
  const expiring = useMemo(() => documents.filter((document) => metadataText(document, "expiry", metadataText(document, "expires", "9999-12-31")) <= "2026-12-31").length, [documents]);

  const addDocument = (values: Record<string, string>) => {
    const record = actions.add("documents", values.title, {
      subtitle: "بيانات وصفية لملف نموذجي؛ لا يوجد رفع حقيقي",
      status: "مراجعة البيانات الوصفية",
      date: TODAY,
      meta: { category: values.category, version: 1, expiry: values.expiry || "غير محدد", retention: values.retention || "7 سنوات", source: "نموذج محلي" },
    });
    if (record) setPreview(`تمت إضافة «${record.title}» كبيانات وصفية محلية. لم يُرفع أو يُقرأ أي ملف.`);
  };

  const addVersion = (document: DemoEntity) => {
    const current = Number(metadataText(document, "version", "1"));
    actions.patch("documents", document.id, { status: "إصدار أحدث", meta: { ...document.meta, version: current + 1, supersedes: `v${current}` } }, `أنشئ الإصدار v${current + 1} محليًا للوثيقة «${document.title}».`);
    setPreview(`معاينة سجل الإصدار: v${current + 1} يحل محل v${current}. لا توجد نسخة ملف أو تخزين خارجي.`);
  };

  const restore = (document: DemoEntity) => {
    setPreview(`محاكاة استعادة «${document.title}» من سجل الاحتفاظ: سيظهر الإصدار v${metadataText(document, "version", "1")} فقط داخل النموذج. لم يُسترجع ملف فعلي.`);
    actions.show("أُنشئت معاينة استعادة محلية للوثيقة؛ لم يُسترجع أي ملف.", document.id);
  };

  return (
    <div className="section-stack">
      <PageHeader eyebrow="F13 · بيانات وصفية آمنة" title="مكتبة الوثائق" description="إصدارات وانتهاء واحتفاظ واستعادة توضيحية، من دون رفع أو فتح مستندات حقيقية.">
        <FormDialog
          title="تسجيل وثيقة نموذجية"
          description="يسجل هذا النموذج بيانات وصفية محلية فقط؛ لا توجد خانة رفع ولا إرسال."
          trigger={<button type="button" className="btn-primary"><FilePlus2 size={16} /> تسجيل وثيقة</button>}
          fields={[
            { key: "title", label: "اسم الوثيقة", required: true, placeholder: "مثال: شهادة دفاع مدني" },
            { key: "category", label: "الفئة", type: "select", required: true, options: [{ value: "امتثال", label: "امتثال" }, { value: "عقد", label: "عقد" }, { value: "صيانة", label: "صيانة" }] },
            { key: "expiry", label: "تاريخ الانتهاء", type: "date" },
            { key: "retention", label: "مدة الاحتفاظ", type: "select", options: [{ value: "سنتان", label: "سنتان" }, { value: "7 سنوات", label: "7 سنوات" }, { value: "دائم", label: "دائم" }] },
          ]}
          submitLabel="تسجيل محلي"
          onSubmit={addDocument}
        />
      </PageHeader>
      <p className="muted"><a href="/contract-templates" className="btn-ghost">نماذج العقود ونصوصها المحفوظة موجودة في مكتبة العقود</a></p>
      <DemoNotice mode="simulation">هذه المكتبة تمثل فهرسًا تجريبيًا: لا ترفع ملفات، ولا تفحص مرفقات، ولا تعيد مستندًا محفوظًا.</DemoNotice>
      <div className="stats-grid">
        <Metric label="وثائق النطاق" value={String(documents.length)} detail="محلية ومفلترة حسب المحفظة" icon={<FileCheck2 size={18} />} />
        <Metric label="تحتاج متابعة" value={String(expiring)} detail="وفق تاريخ انتهاء نموذجـي" icon={<FileClock size={18} />} />
        <Metric label="سجل الاستعادة" value="محاكاة" detail="لا يتصل بأرشيف خارجي" icon={<RotateCcw size={18} />} />
      </div>
      <TabBar items={[{ key: "files", label: "الفهرس والإصدارات" }, { key: "policy", label: "قواعد الاحتفاظ" }]} value={tab} onChange={setTab} />
      {tab === "files" ? (
        <div className="split-layout">
          <Panel title="فهرس الوثائق" description="إصدار واحد أو أكثر لكل سجل، مع ظهور الأثر في الجدول.">
            <EntityTable rows={documents} columns={documentColumns(addVersion, restore)} onRow={(row) => setPreview(`معاينة «${row.title}»: الفئة ${metadataText(row, "category", metadataText(row, "type"))}, الإصدار v${metadataText(row, "version", "1")}, الاحتفاظ ${metadataText(row, "retention", "غير محدد")}.`)} empty="لا توجد وثائق ضمن نطاق المحفظة المختارة." />
          </Panel>
          <Panel title="معاينة آمنة" action={<StatusBadge status="محاكاة" />}>
            <p>{preview}</p>
            <button type="button" className="btn-secondary" onClick={() => { setPreview("تمت معاينة قاعدة التنبيه: يظل الملف في الفهرس وتحتاج الجهة البشرية إلى تجديده؛ لا يجري تمديد تلقائي."); actions.show("أُظهرت قاعدة انتهاء توضيحية؛ لم تتغير وثيقة.", "F13"); }}>فحص قاعدة الانتهاء</button>
          </Panel>
        </div>
      ) : (
        <Panel title="سياسة الاحتفاظ النموذجية" description="قاعدة العرض لا تتخذ قرار حذف أو استعادة على بيانات حقيقية.">
          <div className="section-stack">
            <p><strong>العقد:</strong> يحتفظ بالسجل الوصفي وفق المدة المختارة، ويظهر الانتهاء كتذكير لا كإثبات امتثال.</p>
            <p><strong>الاستعادة:</strong> تنشئ معاينة لسجل الإصدار، ولا تتصل بمخزن أو ملف أو نظام إدارة مستندات.</p>
          </div>
        </Panel>
      )}
      <ActionResult>{actions.feedback}</ActionResult>
    </div>
  );
}

function signatureColumns(onSend: (signature: DemoEntity) => void, onSign: (signature: DemoEntity) => void) {
  return [
    { key: "title", label: "القالب / الاتفاق" },
    { key: "language", label: "اللغة", render: (row: DemoEntity) => metadataText(row, "language", "العربية") },
    { key: "parties", label: "الأطراف", render: (row: DemoEntity) => metadataText(row, "parties", "-") },
    { key: "status", label: "الحالة", render: (row: DemoEntity) => <StatusBadge status={row.status} /> },
    { key: "actions", label: "الإجراء", render: (row: DemoEntity) => <div className="flex gap-2 flex-wrap"><button type="button" className="btn-ghost" onClick={() => onSend(row)}>إرسال محاكى</button><button type="button" className="btn-ghost" onClick={() => onSign(row)}>توقيع محاكى</button></div> },
  ];
}

export function SignaturesService() {
  const actions = useServiceActions("التوقيعات F26");
  const [language, setLanguage] = useState("ar");
  const [certificate, setCertificate] = useState("لم تُنشأ شهادة بعد.");
  const signatures = actions.filtered("signatures");

  const createSignature = (values: Record<string, string>) => {
    const signature = actions.add("signatures", values.title, {
      subtitle: "مسار توقيع تجريبي منفصل عن التسجيل",
      status: "مسودة",
      meta: { language: values.language, parties: values.parties, template: values.language === "ar" ? "قالب إيجار عربي" : "English lease template", officialRegistration: false },
    });
    if (signature) setCertificate(`تمت تهيئة «${signature.title}» كمسودة؛ لا توجد شهادة أو توقيع رسمي.`);
  };

  const send = (signature: DemoEntity) => {
    actions.status("signatures", signature.id, "مرسل للمراجعة", `تمت محاكاة إرسال «${signature.title}» للأطراف؛ لم يُرسل بريد أو رابط.`);
    setCertificate(`سجل الإرسال التجريبي: ${signature.title} → ${metadataText(signature, "parties")}. لا توجد قناة خارجية.`);
  };

  const sign = (signature: DemoEntity) => {
    actions.status("signatures", signature.id, "موقّع تجريبيًا", `تم تحديث حالة «${signature.title}» إلى توقيع تجريبي محلي.`);
    setCertificate(`شهادة نموذجية #DEMO-${signature.id.slice(-5).toUpperCase()}، الحالة: توقيع محاكى؛ التسجيل الرسمي غير منفذ ولا يُستدل عليه من هذه الشهادة.`);
  };

  return (
    <div className="section-stack">
      <PageHeader eyebrow="F26 · توقيع تجريبي" title="قوالب واتفاقات للتوقيع" description="نُنشئ مسارًا عربيًا أو English، ونعرض حالة الأطراف وشهادة نموذجية فقط.">
        <FormDialog title="بدء مسار توقيع" description="لا يُرسل اتفاق أو يُنشأ توقيع ملزم. ستظهر النتيجة كسجل محلي." trigger={<button type="button" className="btn-primary"><Send size={16} /> بدء مسار</button>} fields={[
          { key: "title", label: "اسم الاتفاق", required: true, placeholder: "تجديد عقد الوحدة A-12" },
          { key: "language", label: "لغة القالب", type: "select", required: true, options: [{ value: "العربية", label: "العربية" }, { value: "English", label: "English" }] },
          { key: "parties", label: "الأطراف", required: true, placeholder: "المالك النموذجي، المستأجر النموذجي" },
        ]} submitLabel="إنشاء مسودة" onSubmit={createSignature} />
      </PageHeader>
      <DemoNotice mode="simulation">التوقيع والشهادة هنا محاكاة صريحة؛ لا تسجيل عقد، ولا تحقق هوية، ولا مقدم خدمة توقيع متصل.</DemoNotice>
      <TabBar items={[{ key: "ar", label: "قالب عربي" }, { key: "en", label: "English template" }]} value={language} onChange={setLanguage} />
      <div className="split-layout">
        <Panel title={language === "ar" ? "قالب الإيجار العربي" : "English lease template"} description="معاينة بنود مختصرة لا تمثل نصًا قانونيًا أو اتفاقًا قابلاً للتنفيذ.">
          <div className="section-stack">
            <p><strong>{language === "ar" ? "الأطراف:" : "Parties:"}</strong> {language === "ar" ? "مالك نموذجي ومقيم نموذجـي" : "Demo owner and demo resident"}</p>
            <p><strong>{language === "ar" ? "الحالة:" : "Status:"}</strong> {language === "ar" ? "مسودة قابلة للمراجعة" : "Reviewable draft"}</p>
            <p className="muted">{language === "ar" ? "يحتاج التسجيل والالتزامات القانونية إلى إجراء مستقل خارج هذا البروتوتايب." : "Official registration and legal obligations remain a separate process outside this prototype."}</p>
          </div>
        </Panel>
        <Panel title="شهادة نموذجية" action={<ShieldCheck size={18} />}><p>{certificate}</p></Panel>
      </div>
      <Panel title="سجل مسارات التوقيع" description="كل زر يحدث الحالة أو شهادة النموذج داخل المتصفح.">
        <EntityTable rows={signatures} columns={signatureColumns(send, sign)} empty="لا توجد مسارات توقيع ضمن النطاق." />
      </Panel>
      <ActionResult>{actions.feedback}</ActionResult>
    </div>
  );
}
