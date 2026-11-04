import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FilePlus2,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  Badge,
  DemoNotice,
  EmptyState,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { LeaseDocumentPreview } from "@/components/app/LeaseDocumentPreview";
import {
  getLeaseTemplateView,
  getTemplateLeaseView,
  listLeaseTemplates,
} from "@/lib/lease-template-engine";
import { readTemplateFile } from "@/lib/template-file-import";
import { assetTypeLabel } from "@/lib/property-fields";
import { electricityNumberForRentalTarget } from "@/lib/prototype-rental";
import { scenarioDate } from "@shared/prototype-clock";
import { toMinor, type DemoEntity, type EntityMap } from "@shared/prototype";
import type {
  GenerateTemplateLeaseInput,
  LeaseTemplateView,
  SaveLeaseTemplateInput,
  TemplateLeaseView,
} from "@shared/lease-template-types";
import "./contracts.css";

const TOKENS = ["الاسم", "رقم_العقار", "رقم_الكهرباء", "نوع_العقار"] as const;

type TemplateEditorTarget = "new" | LeaseTemplateView;
type RentalMode = "whole" | "units" | "unknown";

function createRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function textMeta(entity: DemoEntity | undefined, key: string): string {
  if (!entity) return "";
  const value = entity.meta[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function propertyNumberFor(property: DemoEntity | undefined): string {
  if (!property) return "";
  // Only use an explicit business identifier; an entity ID or incidental code is
  // never presented as an official property number.
  return textMeta(property, "propertyNumber");
}

function propertyTypeFor(property: DemoEntity | undefined): string {
  if (!property) return "";
  const raw = textMeta(property, "assetType") || textMeta(property, "type");
  return raw ? assetTypeLabel(raw) : "";
}

function rentalModeFor(property: DemoEntity | undefined): RentalMode {
  const value = textMeta(property, "rentalMode").toLowerCase();
  if (value === "whole") return "whole";
  if (value === "units") return "units";
  return "unknown";
}

function templateScopeLabel(
  view: LeaseTemplateView,
  portfolios: DemoEntity[]
): string {
  if (!view.template.portfolioId) return "جميع المحافظ";
  return (
    portfolios.find(portfolio => portfolio.id === view.template.portfolioId)
      ?.title ?? "محفظة محفوظة"
  );
}

function isTemplateLease(lease: DemoEntity): boolean {
  const source = String(lease.meta.source ?? "");
  return Boolean(lease.meta.templateId) || /template|قالب/i.test(source);
}

function numberInputFromMinor(value: number): string {
  return value > 0 && Number.isSafeInteger(value) ? String(value / 100) : "";
}

function parseOptionalRent(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return toMinor(trimmed);
}

function parseOptionalTerm(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      "المدة الافتراضية يجب أن تكون عددًا صحيحًا من الأشهر أو تترك فارغة."
    );
  }
  const term = Number(trimmed);
  if (!Number.isSafeInteger(term) || term < 0 || term > 120) {
    throw new Error("المدة الافتراضية يجب أن تكون بين 0 و120 شهرًا.");
  }
  return term;
}

function FocusDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));

    const firstInput = dialogRef.current?.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)"
    );
    (firstInput ?? focusable()[0] ?? dialogRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="contract-templates-dialog-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="contract-templates-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="contract-templates-dialog__heading">
          <div>
            <span className="eyebrow">قوالب عقود تجريبية</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {description && (
          <p className="muted small contract-templates-dialog__description">
            {description}
          </p>
        )}
        {children}
      </section>
    </div>,
    document.body
  );
}

function TemplateEditorDialog({
  template,
  onClose,
  onSave,
}: {
  template?: LeaseTemplateView;
  onClose: () => void;
  onSave: (input: SaveLeaseTemplateInput) => void;
}) {
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [requestId] = useState(createRequestId);
  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [fileName, setFileName] = useState(template?.fileName ?? "");
  const [defaultRent, setDefaultRent] = useState(
    numberInputFromMinor(template?.defaultRentMinor ?? 0)
  );
  const [defaultTerm, setDefaultTerm] = useState(
    template?.defaultTermMonths ? String(template.defaultTermMonths) : ""
  );
  const [importNotice, setImportNotice] = useState("");
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isInformationalDraft, setIsInformationalDraft] = useState(false);

  const insertToken = (token: (typeof TOKENS)[number]) => {
    const field = contentRef.current;
    const start = field?.selectionStart ?? content.length;
    const end = field?.selectionEnd ?? content.length;
    const inserted = `{{${token}}}`;
    setContent(
      previous => `${previous.slice(0, start)}${inserted}${previous.slice(end)}`
    );
    window.requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(
        start + inserted.length,
        start + inserted.length
      );
    });
  };

  const loadIllustrativeText = () => {
    setName("نص توضيحي · غير معتمد قانونيًا");
    setContent(
      "نص توضيحي غير معتمد قانونيًا للاستخدام التجريبي فقط.\n\nالاسم: {{الاسم}}\nرقم العقار: {{رقم_العقار}}\nرقم الكهرباء: {{رقم_الكهرباء}}\nنوع العقار: {{نوع_العقار}}\n\nتُراجع هذه المسودة وتُعتمد بصورة مستقلة قبل أي استخدام."
    );
    setFileName("");
    setIsInformationalDraft(true);
    setError("");
  };

  const importTemplate = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setImportNotice("");
    setIsImporting(true);
    try {
      const result = await readTemplateFile(file);
      setContent(result.content);
      setFileName(result.fileName);
      setImportNotice(result.warning);
      setIsInformationalDraft(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر قراءة الملف. استخدم TXT أو DOCX فقط."
      );
    } finally {
      setIsImporting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      if (!name.trim()) throw new Error("اسم القالب مطلوب.");
      if (!content.trim()) throw new Error("نص القالب مطلوب.");
      onSave({
        templateId: template?.template.id,
        requestId,
        name: name.trim(),
        content: content.trim(),
        fileName: fileName.trim() || undefined,
        defaultRentMinor: parseOptionalRent(defaultRent),
        defaultTermMonths: parseOptionalTerm(defaultTerm),
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حفظ القالب.");
    }
  };

  return (
    <FocusDialog
      title={template ? `إصدار جديد من «${template.name}»` : "إضافة قالب عقد"}
      description={
        template
          ? "لا يُعدل الإصدار المحفوظ؛ سيُنشأ إصدار أحدث مستقل عند الحفظ."
          : "احفظ النص وقيمه الافتراضية داخل النموذج. لا يمثل ذلك اعتمادًا قانونيًا أو توقيعًا."
      }
      onClose={onClose}
    >
      <form className="contract-templates-form" onSubmit={submit}>
        {error && (
          <p className="contract-templates-form__error" role="alert">
            {error}
          </p>
        )}
        {importNotice && (
          <p className="contract-templates-form__notice" role="status">
            {importNotice}
          </p>
        )}
        {isInformationalDraft && (
          <p className="contract-templates-form__warning">
            هذه مسودة نص توضيحي وليست معتمدة قانونيًا.
          </p>
        )}

        <label className="form-label">
          <span>
            اسم القالب <i className="required-mark">*</i>
          </span>
          <input
            className="field"
            value={name}
            maxLength={160}
            required
            onChange={event => setName(event.target.value)}
            placeholder="مثال: عقد إيجار سكني"
          />
        </label>

        <div className="contract-templates-upload-row">
          <label className="btn-secondary contract-templates-upload-button">
            <Upload size={16} aria-hidden="true" />
            {isImporting ? "جارٍ قراءة الملف…" : "استيراد TXT أو DOCX"}
            <input
              type="file"
              accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={isImporting}
              onChange={event => void importTemplate(event.target.files?.[0])}
            />
          </label>
          <span className="muted small">
            PDF غير مدعوم هنا؛ لا نحاكي قراءة PDF أو تصديره.
          </span>
          {fileName && (
            <span className="contract-templates-file-name">{fileName}</span>
          )}
        </div>

        <div
          className="contract-templates-token-bar"
          aria-label="متغيرات القالب"
        >
          <span>إدراج متغير:</span>
          {TOKENS.map(token => (
            <button
              type="button"
              className="contract-templates-token"
              key={token}
              onClick={() => insertToken(token)}
            >
              {`{{${token}}}`}
            </button>
          ))}
          <button
            type="button"
            className="contract-templates-example"
            onClick={loadIllustrativeText}
          >
            نص توضيحي
          </button>
        </div>

        <label className="form-label">
          <span>
            نص القالب <i className="required-mark">*</i>
          </span>
          <textarea
            ref={contentRef}
            className="field contract-templates-content-field"
            value={content}
            required
            rows={12}
            maxLength={16000}
            onChange={event => {
              setContent(event.target.value);
              setIsInformationalDraft(false);
            }}
            placeholder="اكتب النص أو استورده، ثم أدرج المتغيرات عند موضعها."
          />
        </label>

        <details className="contract-templates-advanced">
          <summary>القيم الافتراضية الاختيارية</summary>
          <div className="contract-templates-advanced__grid">
            <label className="form-label">
              <span>الإيجار الافتراضي (ر.ق)</span>
              <input
                className="field"
                inputMode="decimal"
                value={defaultRent}
                onChange={event => setDefaultRent(event.target.value)}
                placeholder="غير معروف"
              />
            </label>
            <label className="form-label">
              <span>المدة الافتراضية (شهر)</span>
              <input
                className="field"
                inputMode="numeric"
                value={defaultTerm}
                onChange={event => setDefaultTerm(event.target.value)}
                placeholder="غير معروفة"
              />
            </label>
          </div>
          <p className="muted small">
            إن تُركت فارغة تُحفظ كصفر/غير معروف، ولا تُطلب عند إنشاء مسودة
            العقد.
          </p>
        </details>

        <footer className="modal-footer contract-templates-dialog__footer">
          <button type="submit" className="btn-primary">
            <FilePlus2 size={16} aria-hidden="true" />
            {template ? "حفظ إصدار جديد" : "حفظ القالب"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
        </footer>
      </form>
    </FocusDialog>
  );
}

function GenerationDialog({
  templates,
  properties,
  units,
  entities,
  asOf,
  initialPropertyId,
  onClose,
  onGenerate,
}: {
  templates: LeaseTemplateView[];
  properties: DemoEntity[];
  units: DemoEntity[];
  entities: EntityMap;
  asOf: string;
  initialPropertyId: string;
  onClose: () => void;
  onGenerate: (input: GenerateTemplateLeaseInput) => void;
}) {
  const [requestId] = useState(createRequestId);
  const [templateId, setTemplateId] = useState(templates[0]?.template.id ?? "");
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [unitId, setUnitId] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [propertyNumber, setPropertyNumber] = useState(() =>
    propertyNumberFor(
      properties.find(property => property.id === initialPropertyId)
    )
  );
  const [electricityNumber, setElectricityNumber] = useState(() =>
    electricityNumberForRentalTarget(entities, initialPropertyId)
  );
  const [propertyType, setPropertyType] = useState(() =>
    propertyTypeFor(
      properties.find(property => property.id === initialPropertyId)
    )
  );
  const [error, setError] = useState("");

  const property = properties.find(row => row.id === propertyId);
  const linkedUnits = useMemo(
    () => units.filter(unit => unit.propertyId === propertyId),
    [propertyId, units]
  );
  const selectedUnit = linkedUnits.find(unit => unit.id === unitId);
  const mode = rentalModeFor(property);
  const needsUnit =
    mode === "units" || (mode === "unknown" && linkedUnits.length > 0);
  const isWholeProperty = mode === "whole";

  const selectProperty = (nextPropertyId: string) => {
    const nextProperty = properties.find(row => row.id === nextPropertyId);
    setPropertyId(nextPropertyId);
    setUnitId("");
    setPropertyNumber(propertyNumberFor(nextProperty));
    setElectricityNumber(
      electricityNumberForRentalTarget(entities, nextPropertyId)
    );
    setPropertyType(propertyTypeFor(nextProperty));
  };

  const selectUnit = (nextUnitId: string) => {
    const nextUnit = linkedUnits.find(unit => unit.id === nextUnitId);
    setUnitId(nextUnitId);
    setElectricityNumber(
      electricityNumberForRentalTarget(entities, propertyId, nextUnit?.id)
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      if (!templateId) throw new Error("اختر قالبًا محفوظًا لإنشاء المسودة.");
      if (!property) throw new Error("اختر عقارًا قائمًا ضمن النطاق الحالي.");
      if (mode === "units" && !linkedUnits.length) {
        throw new Error(
          "هذا العقار مضبوط على نظام الوحدات، لكن لا توجد وحدة متاحة للاختيار."
        );
      }
      if (needsUnit && !selectedUnit) {
        throw new Error("اختر الوحدة التابعة للعقار قبل إنشاء المسودة.");
      }
      if (!tenantName.trim()) throw new Error("اسم المستأجر مطلوب للمسودة.");
      onGenerate({
        requestId,
        templateId,
        propertyId: property.id,
        unitId: isWholeProperty ? "" : (selectedUnit?.id ?? ""),
        tenantName: tenantName.trim(),
        propertyNumber: propertyNumber.trim(),
        electricityNumber: electricityNumber.trim(),
        propertyType: propertyType.trim(),
        startDate: asOf,
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "تعذر إنشاء مسودة العقد."
      );
    }
  };

  return (
    <FocusDialog
      title="إنشاء مسودة عقد من قالب"
      description={`تاريخ البداية حسب ساعة السيناريو المعلنة: ${asOf}. لا ينشئ هذا الإجراء ذممًا أو تحصيلات نقدية.`}
      onClose={onClose}
    >
      <form className="contract-templates-form" onSubmit={submit}>
        {error && (
          <p className="contract-templates-form__error" role="alert">
            {error}
          </p>
        )}
        <div className="form-grid contract-templates-generation-grid">
          <label className="form-label span-all">
            <span>
              القالب <i className="required-mark">*</i>
            </span>
            <select
              className="field"
              value={templateId}
              required
              onChange={event => setTemplateId(event.target.value)}
            >
              <option value="">اختر قالبًا محفوظًا</option>
              {templates.map(template => (
                <option key={template.template.id} value={template.template.id}>
                  {template.name} · إصدار {template.version}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label span-all">
            <span>
              سياق العقار <i className="required-mark">*</i>
            </span>
            <select
              className="field"
              value={propertyId}
              required
              onChange={event => selectProperty(event.target.value)}
            >
              <option value="">اختر العقار</option>
              {properties.map(propertyRow => (
                <option key={propertyRow.id} value={propertyRow.id}>
                  {propertyRow.title}
                </option>
              ))}
            </select>
          </label>

          {property &&
            (isWholeProperty ? (
              <div className="contract-templates-context-field span-all">
                <span>نطاق الإيجار</span>
                <strong>العقار كاملاً</strong>
              </div>
            ) : needsUnit ? (
              <label className="form-label span-all">
                <span>
                  الوحدة التابعة للعقار <i className="required-mark">*</i>
                </span>
                <select
                  className="field"
                  value={unitId}
                  required
                  onChange={event => selectUnit(event.target.value)}
                >
                  <option value="">اختر الوحدة</option>
                  {linkedUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
                </select>
                {mode === "unknown" && (
                  <small className="muted">
                    عقار تاريخي بلا وضع تأجير محدد؛ نعرض وحداته دون تغيير
                    بياناته.
                  </small>
                )}
              </label>
            ) : (
              <div className="contract-templates-context-field span-all">
                <span>نطاق الإيجار</span>
                <strong>عقار تاريخي بلا وحدة مسجلة</strong>
              </div>
            ))}

          <label className="form-label span-all">
            <span>
              اسم المستأجر <i className="required-mark">*</i>
            </span>
            <input
              className="field"
              value={tenantName}
              required
              maxLength={200}
              onChange={event => setTenantName(event.target.value)}
              placeholder="اسم المستأجر في هذه المسودة"
            />
          </label>
          <label className="form-label">
            <span>
              رقم العقار <i className="required-mark">*</i>
            </span>
            <input
              className="field"
              value={propertyNumber}
              required
              maxLength={80}
              onChange={event => setPropertyNumber(event.target.value)}
              placeholder="أدخل رقم العقار إذا لم يكن محفوظًا"
            />
          </label>
          <label className="form-label">
            <span>
              رقم الكهرباء <i className="required-mark">*</i>
            </span>
            <input
              className="field"
              value={electricityNumber}
              required
              maxLength={80}
              onChange={event => setElectricityNumber(event.target.value)}
              placeholder="أدخل رقم الكهرباء إذا لم يكن محفوظًا"
            />
          </label>
          <label className="form-label span-all">
            <span>نوع العقار</span>
            <select
              className="field"
              value={propertyType}
              required
              onChange={event => setPropertyType(event.target.value)}
            >
              <option value="">اختر نوع العقار</option>
              {Array.from(
                new Set(
                  [
                    propertyTypeFor(property),
                    "فيلا",
                    "بناية",
                    "برج",
                    "أرض",
                    "عقار قيد التطوير",
                    "شقة",
                    "محل",
                    "مكتب",
                    "مستودع",
                  ].filter(Boolean)
                )
              ).map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <small className="muted">
              يلزم تطابق النوع مع سجل العقار؛ صحح بيانات الأصل أولًا إذا اختلف.
            </small>
          </label>
        </div>

        <p className="contract-templates-generation-note">
          تُملأ أربعة متغيرات عمل فقط: الاسم، رقم العقار، رقم الكهرباء، ونوع
          العقار. لا يُستخدم معرّف النظام كرقم رسمي عند غياب البيانات.
        </p>
        <footer className="modal-footer contract-templates-dialog__footer">
          <button type="submit" className="btn-primary">
            <Sparkles size={16} aria-hidden="true" /> إنشاء المسودة
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
        </footer>
      </form>
    </FocusDialog>
  );
}

function GeneratedLeaseTable({
  leases,
  templates,
  properties,
  onPreview,
}: {
  leases: DemoEntity[];
  templates: LeaseTemplateView[];
  properties: DemoEntity[];
  onPreview: (lease: DemoEntity) => void;
}) {
  if (!leases.length) {
    return (
      <EmptyState
        title="لا توجد مسودات مولدة بالقوالب بعد"
        description="احفظ قالبًا ثم أنشئ مسودة مرتبطة بعقار ووحدة عند الحاجة."
      />
    );
  }

  const templateName = (lease: DemoEntity) => {
    const id = String(lease.meta.templateId ?? "");
    return (
      templates.find(template => template.template.id === id)?.name ??
      String(lease.meta.templateName ?? "قالب محفوظ")
    );
  };

  return (
    <div className="table-wrap">
      <table className="data-table contract-templates-table">
        <thead>
          <tr>
            <th scope="col">المسودة / المستأجر</th>
            <th scope="col">القالب</th>
            <th scope="col">العقار</th>
            <th scope="col">الحالة</th>
            <th scope="col">إجراء</th>
          </tr>
        </thead>
        <tbody>
          {leases.map(lease => (
            <tr key={lease.id}>
              <td>
                <strong>{lease.title}</strong>
                <span className="contract-templates-table__sub">
                  {String(
                    lease.meta.tenantName ?? lease.subtitle ?? "مستأجر غير محدد"
                  )}
                </span>
              </td>
              <td>
                {templateName(lease)}
                <span className="contract-templates-table__sub">
                  إصدار {String(lease.meta.templateVersion ?? "-")}
                </span>
              </td>
              <td>
                {properties.find(property => property.id === lease.propertyId)
                  ?.title ?? "العقار المرتبط"}
              </td>
              <td>
                <Badge tone="amber">{lease.status || "مسودة"}</Badge>
              </td>
              <td>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onPreview(lease)}
                >
                  <FileText size={15} aria-hidden="true" /> معاينة / طباعة
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContractTemplatesPage() {
  const {
    state,
    filtered,
    list,
    canEdit,
    saveLeaseTemplate,
    generateTemplateLease,
  } = usePrototype();
  const [editorTarget, setEditorTarget] = useState<TemplateEditorTarget | null>(
    null
  );
  const [isGenerationOpen, setIsGenerationOpen] = useState(false);
  const [pendingLeaseId, setPendingLeaseId] = useState("");
  const [preview, setPreview] = useState<TemplateLeaseView | null>(null);
  const [feedback, setFeedback] = useState("");

  const portfolios = list("portfolios");
  const properties = filtered("properties");
  const units = filtered("units");
  const templateViews = useMemo<LeaseTemplateView[]>(
    () =>
      listLeaseTemplates(state.entities).flatMap(template => {
        try {
          return [getLeaseTemplateView(state.entities, template.id)];
        } catch {
          // A damaged historical template must not prevent the rest of the
          // prototype library from rendering.
          return [];
        }
      }),
    [state.entities]
  );
  const visibleTemplates = useMemo(() => {
    const selectedPortfolioId = state.settings.portfolioId;
    return templateViews.filter(view => {
      if (selectedPortfolioId === "all") return !view.template.portfolioId;
      return (
        !view.template.portfolioId ||
        view.template.portfolioId === selectedPortfolioId
      );
    });
  }, [state.settings.portfolioId, templateViews]);
  const availableLeases = filtered("leases");
  const generatedLeases = availableLeases.filter(isTemplateLease);
  const legacyLeases = availableLeases.filter(lease => !isTemplateLease(lease));
  const asOf = scenarioDate(state);
  const queryPropertyId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("property") ?? "";
  }, []);
  const initialPropertyId = properties.some(
    property => property.id === queryPropertyId
  )
    ? queryPropertyId
    : "";

  useEffect(() => {
    if (!pendingLeaseId) return;
    try {
      const nextPreview = getTemplateLeaseView(state.entities, pendingLeaseId);
      if (!nextPreview) return;
      setPreview(nextPreview);
      setPendingLeaseId("");
      setFeedback("أنشئت المسودة محليًا ويمكن معاينتها أو طباعتها من المتصفح.");
    } catch (caught) {
      setPendingLeaseId("");
      setFeedback(
        caught instanceof Error
          ? caught.message
          : "تم إنشاء المسودة لكن تعذرت معاينتها."
      );
    }
  }, [pendingLeaseId, state.entities]);

  const saveTemplate = (input: SaveLeaseTemplateInput) => {
    const saved = saveLeaseTemplate(input);
    const version =
      typeof saved.meta.version === "number" ? saved.meta.version : "جديد";
    setFeedback(`حُفظ «${saved.title}» بإصدار ${version} داخل النطاق الحالي.`);
  };

  const generateLease = (input: GenerateTemplateLeaseInput) => {
    const lease = generateTemplateLease(input);
    setPendingLeaseId(lease.id);
    setFeedback("جارٍ إعداد معاينة المسودة الجديدة…");
  };

  const previewLease = (lease: DemoEntity) => {
    try {
      const view = getTemplateLeaseView(state.entities, lease.id);
      if (!view) throw new Error("لا تتوفر وثيقة القالب لهذه المسودة.");
      setPreview(view);
      setFeedback("");
    } catch (caught) {
      setFeedback(
        caught instanceof Error ? caught.message : "تعذر فتح معاينة المسودة."
      );
    }
  };

  return (
    <div className="section-stack contract-templates-page">
      <PageHeader
        eyebrow="القوالب والعقود"
        title="قوالب عقود الإيجار"
        description="مكتبة نصية محلية لإنشاء مسودات قابلة للمعاينة؛ التوقيع والإجراءات الحكومية منفصلان عن هذه الشاشة."
      >
        <button
          type="button"
          className="btn-primary"
          disabled={!canEdit}
          onClick={() => setEditorTarget("new")}
        >
          <Plus size={16} aria-hidden="true" /> إضافة قالب
        </button>
      </PageHeader>

      <DemoNotice mode="interactive">
        المسودة المطبوعة غير موقعة وغير مسجلة. لا تنشئ هذه الشاشة عقدًا حكوميًا
        أو توقيعًا أو قيدًا، ولا تضيف استحقاقًا أو قبضًا نقديًا.
      </DemoNotice>

      {!canEdit && (
        <p className="contract-templates-readonly" role="status">
          المعاينة الحالية للقراءة فقط: يمكنك فتح المسودات وطباعتها، أما الحفظ
          والإنشاء فمتاحان للمشغّل فقط.
        </p>
      )}
      {feedback && (
        <p className="contract-templates-feedback" role="status">
          {feedback}
        </p>
      )}

      <Panel
        title="مكتبة القوالب"
        description={`النطاق: ${state.settings.portfolioId === "all" ? "جميع المحافظ (قوالب عامة)" : "المحفظة الحالية مع القوالب العامة"}. يحفظ المحرك نطاق القالب؛ لا توجد محفظة إضافية في هذا النموذج.`}
        action={
          <button
            type="button"
            className="btn-secondary"
            disabled={!canEdit}
            onClick={() => setEditorTarget("new")}
          >
            <Plus size={16} aria-hidden="true" /> قالب جديد
          </button>
        }
      >
        {visibleTemplates.length ? (
          <div className="contract-templates-library">
            {visibleTemplates.map(template => (
              <article
                key={template.template.id}
                className="contract-templates-card"
              >
                <div className="contract-templates-card__top">
                  <Badge tone="blue">إصدار {template.version}</Badge>
                  <span className="contract-templates-card__scope">
                    {templateScopeLabel(template, portfolios)}
                  </span>
                </div>
                <h3>{template.name}</h3>
                <p className="contract-templates-card__excerpt">
                  {template.content || "نص القالب غير متاح"}
                </p>
                <dl className="contract-templates-card__meta">
                  <div>
                    <dt>الإيجار الافتراضي</dt>
                    <dd>
                      {template.defaultRentMinor
                        ? `${template.defaultRentMinor / 100} ر.ق`
                        : "غير معروف"}
                    </dd>
                  </div>
                  <div>
                    <dt>المدة</dt>
                    <dd>
                      {template.defaultTermMonths
                        ? `${template.defaultTermMonths} شهر`
                        : "غير معروفة"}
                    </dd>
                  </div>
                  <div>
                    <dt>المصدر</dt>
                    <dd>{template.fileName || "نص مكتوب"}</dd>
                  </div>
                </dl>
                <div className="contract-templates-card__actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!canEdit}
                    onClick={() => setEditorTarget(template)}
                  >
                    <Pencil size={15} aria-hidden="true" /> تعديل كإصدار جديد
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!canEdit}
                    onClick={() => setIsGenerationOpen(true)}
                  >
                    <Sparkles size={15} aria-hidden="true" /> إنشاء مسودة
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="لا توجد قوالب في هذا النطاق"
            description="أضف قالبًا نصيًا أو بدّل نطاق المحفظة لرؤية القوالب المحفوظة."
          />
        )}
      </Panel>

      <Panel
        title="مسودات مولدة بالقوالب"
        description="تُعرض هنا المسودات التي تحمل مرجع قالب أو مصدر قالب. افتح المعاينة للطباعة أو حفظ PDF من نافذة المتصفح فقط."
        action={
          <button
            type="button"
            className="btn-primary"
            disabled={
              !canEdit || !visibleTemplates.length || !properties.length
            }
            onClick={() => setIsGenerationOpen(true)}
          >
            <Sparkles size={16} aria-hidden="true" /> إنشاء مسودة
          </button>
        }
      >
        {!properties.length && visibleTemplates.length > 0 && (
          <p className="contract-templates-inline-note">
            لا توجد عقارات في نطاق المحفظة الحالي لاختيار سياق للمسودة.
          </p>
        )}
        <GeneratedLeaseTable
          leases={generatedLeases}
          templates={templateViews}
          properties={properties}
          onPreview={previewLease}
        />
      </Panel>

      <Panel
        title="العقود القائمة خارج القوالب"
        description="تظل العقود السابقة ظاهرة ولا تُدمج تلقائيًا مع مسودات القوالب. افتح شاشة العقود لإدارتها عبر سير العمل القديم."
      >
        {legacyLeases.length ? (
          <div className="table-wrap">
            <table className="data-table contract-templates-table">
              <thead>
                <tr>
                  <th scope="col">العقد</th>
                  <th scope="col">المستأجر</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">تاريخ البداية</th>
                </tr>
              </thead>
              <tbody>
                {legacyLeases.map(lease => (
                  <tr key={lease.id}>
                    <td>{lease.title}</td>
                    <td>
                      {String(lease.meta.tenantName ?? lease.subtitle ?? "-")}
                    </td>
                    <td>{lease.status || "-"}</td>
                    <td>{String(lease.meta.startDate ?? lease.date ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">لا توجد عقود سابقة في النطاق الحالي.</p>
        )}
      </Panel>

      {editorTarget && (
        <TemplateEditorDialog
          template={editorTarget === "new" ? undefined : editorTarget}
          onClose={() => setEditorTarget(null)}
          onSave={saveTemplate}
        />
      )}
      {isGenerationOpen && (
        <GenerationDialog
          templates={visibleTemplates}
          properties={properties}
          units={units}
          entities={state.entities}
          asOf={asOf}
          initialPropertyId={initialPropertyId}
          onClose={() => setIsGenerationOpen(false)}
          onGenerate={generateLease}
        />
      )}
      {preview && (
        <LeaseDocumentPreview view={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

export default ContractTemplatesPage;
