import {
  FormEvent,
  ReactNode,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowUpLeft, FlaskConical, Info, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { DemoEntity } from "@shared/prototype";

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && !/F\d{2}/.test(eyebrow) && (
          <span className="eyebrow">{eyebrow}</span>
        )}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Panel({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted small">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "gray";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        {icon && <span className="metric-icon">{icon}</span>}
      </div>
      <strong className="metric-value">{value}</strong>
      {detail && <span className="metric-detail">{detail}</span>}
    </div>
  );
}
export interface TableColumn {
  key: string;
  label: string;
  render?: (row: DemoEntity) => ReactNode;
}
export function EntityTable({
  rows,
  columns,
  onRow,
  empty = "لا توجد سجلات في هذا النطاق",
}: {
  rows: DemoEntity[];
  columns: TableColumn[];
  onRow?: (row: DemoEntity) => void;
  empty?: string;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title={empty}
        description="جرّب محفظة أخرى أو أضف سجلًا تجريبيًا."
      />
    );
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.id}
              onClick={() => onRow?.(row)}
              className={onRow ? "clickable-row" : ""}
            >
              {columns.map(column => (
                <td key={column.key}>
                  {column.render
                    ? column.render(row)
                    : String(
                        (row as unknown as Record<string, unknown>)[
                          column.key
                        ] ??
                          row.meta[column.key] ??
                          "-"
                      )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export interface FormField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}
export function FormDialog({
  title,
  description,
  trigger,
  disabled = false,
  fields,
  initialValues = {},
  onSubmit,
  submitLabel = "حفظ في النموذج",
}: {
  title: string;
  description?: string;
  trigger: ReactNode;
  disabled?: boolean;
  fields: FormField[];
  initialValues?: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const triggerDisabled =
    disabled ||
    (isValidElement<{ disabled?: boolean }>(trigger) &&
      Boolean(trigger.props.disabled));
  useEffect(() => {
    if (!open) return;
    setValues(
      Object.fromEntries(
        fields.map(field => [
          field.key,
          initialValues[field.key] ??
            field.defaultValue ??
            (field.type === "select" ? field.options?.[0]?.value : "") ??
            "",
        ])
      )
    );
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
        ) ?? []
      );
    const firstField = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, textarea"
    );
    (firstField ?? focusable()[0])?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      returnFocusRef.current?.focus();
    };
  }, [open]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (triggerDisabled) return;
    try {
      onSubmit(values);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ السجل");
    }
  };
  return (
    <>
      <span
        className="dialog-trigger"
        aria-disabled={triggerDisabled}
        onClick={() => {
          if (!triggerDisabled) {
            returnFocusRef.current = document.activeElement as HTMLElement;
            setOpen(true);
          }
        }}
      >
        {trigger}
      </span>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">إجراء تجريبي</span>
                <h2>{title}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>
            {description && <p className="muted small">{description}</p>}
            <form onSubmit={submit}>
              <div className="form-grid">
                {fields.map(field => (
                  <label
                    className={
                      field.type === "textarea"
                        ? "form-label span-all"
                        : "form-label"
                    }
                    key={field.key}
                  >
                    <span>
                      {field.label}
                      {field.required && <i className="required-mark"> *</i>}
                    </span>
                    {field.type === "select" ? (
                      <select
                        className="field"
                        value={values[field.key] ?? ""}
                        required={field.required}
                        onChange={event =>
                          setValues(prev => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      >
                        {field.options?.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        className="field"
                        rows={3}
                        value={values[field.key] ?? ""}
                        placeholder={field.placeholder}
                        required={field.required}
                        onChange={event =>
                          setValues(prev => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      <input
                        className="field"
                        type={field.type ?? "text"}
                        min={field.type === "number" ? "0" : undefined}
                        step={field.type === "number" ? "0.01" : undefined}
                        value={values[field.key] ?? ""}
                        placeholder={field.placeholder}
                        required={field.required}
                        onChange={event =>
                          setValues(prev => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn-primary">
                  <Plus size={16} />
                  {submitLabel}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setOpen(false)}
                >
                  إلغاء
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
export function DemoNotice({
  mode = "interactive",
  children,
}: {
  mode?: "interactive" | "simulation" | "external";
  children?: ReactNode;
}) {
  const copy =
    mode === "external"
      ? "التكامل الخارجي غير مفعّل. يمكنك تجربة دورة الخدمة بالمحاكاة فقط؛ لن تُرسل بيانات أو أموال."
      : mode === "simulation"
        ? "محاكاة داخل البروتوتايب، النتائج والبيانات توضيحية، وليست خدمة موصولة أو توصية فعلية."
        : "تجربة تفاعلية ببيانات خيالية. التغييرات محفوظة محليًا في هذا المتصفح، وليست سجلات مالية حقيقية.";
  return (
    <div className={`demo-notice ${mode === "external" ? "notice-amber" : ""}`}>
      <FlaskConical size={16} />
      <span>{children ?? copy}</span>
    </div>
  );
}
export function TabBar({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tab-bar" role="tablist">
      {items.map(item => (
        <button
          role="tab"
          aria-selected={value === item.key}
          className={value === item.key ? "tab-active" : ""}
          key={item.key}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <Info size={24} />
      <h3>{title}</h3>
      {description && <p className="muted small">{description}</p>}
    </div>
  );
}
export function SectionLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <a href={href} className="link-button">
      {children}
      <ArrowUpLeft size={15} />
    </a>
  );
}
