import { useId, useMemo } from "react";
import { money, type DemoEntity } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { usePrototype } from "@/contexts/PrototypeContext";
import { getTenancySummary } from "@/lib/tenancy-information";

export type TenancyFieldsProps = {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  property?: DemoEntity;
  unit?: DemoEntity;
  disabled?: boolean;
};

function value(values: Record<string, string>, key: string): string {
  return typeof values[key] === "string" ? values[key] : "";
}

/**
 * Declaration-only form fields. Registered leases are deliberately shown as
 * read-only because their lifecycle has its own guarded transitions.
 */
export function TenancyFields({
  values,
  onChange,
  property,
  unit,
  disabled = false,
}: TenancyFieldsProps) {
  const { state } = usePrototype();
  const statusId = useId();
  const startId = useId();
  const endId = useId();
  const rentId = useId();
  const summary = useMemo(
    () =>
      property
        ? getTenancySummary(state.entities, property, unit, scenarioDate(state))
        : undefined,
    [property, state, unit]
  );

  if (summary?.locked) {
    const leaseHref = summary.leaseId
      ? `/leases?lease=${encodeURIComponent(summary.leaseId)}`
      : "/leases";
    return (
      <section className="tenancy-fields" aria-label="حالة التأجير">
        <div className="form-label property-readonly-field">
          <span>حالة التأجير</span>
          <strong>{summary.label}</strong>
          <small className="muted">مصدر الحالة: عقد مسجل</small>
        </div>
        <div className="form-grid">
          <div className="form-label property-readonly-field">
            <span>تاريخ بداية العقد</span>
            <strong>{summary.startDate ?? "غير مسجل"}</strong>
          </div>
          <div className="form-label property-readonly-field">
            <span>تاريخ نهاية العقد</span>
            <strong>{summary.endDate ?? "غير مسجل"}</strong>
          </div>
        </div>
        {summary.source !== "units" && (
          <div className="form-label property-readonly-field">
            <span>الإيجار الشهري المسجل</span>
            <strong>
              {summary.monthlyRentMinor === undefined
                ? "غير مسجل"
                : money(
                    summary.monthlyRentMinor,
                    summary.monthlyRentCurrency ?? "QAR"
                  )}
            </strong>
            <small className="muted">من العقد؛ تعديله من قسم العقود فقط.</small>
          </div>
        )}
        <p className="muted small">
          العقد المسجل هو المصدر الأول لحالة التأجير وتواريخه؛ لا تُعدّل هذه
          البيانات من وصف العقار أو الوحدة.
        </p>
        <a className="btn-secondary" href={leaseHref}>
          فتح العقد المسجل
        </a>
      </section>
    );
  }

  const tenancyStatus = value(values, "tenancyStatus");
  const isRented = tenancyStatus === "rented";
  const changeStatus = (nextStatus: string) => {
    if (disabled) return;
    onChange("tenancyStatus", nextStatus);
    if (nextStatus !== "rented") {
      onChange("tenancyStartDate", "");
      onChange("tenancyEndDate", "");
      onChange("tenancyMonthlyRent", "");
    }
  };

  return (
    <section className="tenancy-fields" aria-label="حالة التأجير">
      <div className="form-grid">
        <label className="form-label" htmlFor={statusId}>
          <span>حالة التأجير</span>
          <select
            id={statusId}
            className="field"
            value={tenancyStatus}
            disabled={disabled}
            onChange={event => changeStatus(event.target.value)}
          >
            <option value="">غير محدد</option>
            <option value="rented">مؤجر</option>
            <option value="vacant">غير مؤجر</option>
          </select>
        </label>
        <label className="form-label" htmlFor={startId}>
          <span>
            تاريخ بداية العقد {isRented && <i className="required-mark">*</i>}
          </span>
          <input
            id={startId}
            className="field"
            type="date"
            value={value(values, "tenancyStartDate")}
            required={isRented}
            disabled={disabled || !isRented}
            onChange={event => onChange("tenancyStartDate", event.target.value)}
          />
        </label>
        <label className="form-label" htmlFor={endId}>
          <span>
            تاريخ نهاية العقد {isRented && <i className="required-mark">*</i>}
          </span>
          <input
            id={endId}
            className="field"
            type="date"
            value={value(values, "tenancyEndDate")}
            required={isRented}
            disabled={disabled || !isRented}
            onChange={event => onChange("tenancyEndDate", event.target.value)}
          />
        </label>
      </div>
      {isRented && (
        <label className="form-label" htmlFor={rentId}>
          <span>الإيجار الشهري الحالي (ر.ق)</span>
          <input
            id={rentId}
            name="tenancyMonthlyRent"
            className="field"
            inputMode="decimal"
            maxLength={26}
            placeholder="مثال: ٣٥٠٠ · اختياري إذا لم تتوفر القيمة"
            value={value(values, "tenancyMonthlyRent")}
            disabled={disabled}
            onChange={event =>
              onChange("tenancyMonthlyRent", event.target.value)
            }
          />
          <small className="muted">
            قيمة التأجير الحالي في الإدخال الأولي، مستقلة عن سعر البيع أو
            الإيجار المطلوب. لا تُنشئ قيدًا ماليًا.
          </small>
        </label>
      )}
      <p className="muted small" role="note">
        إدخال أولي، غير مرتبط بعقد مسجل. لا ينشئ هذا الإدخال عقدًا أو ذممًا أو
        تحصيلًا أو تغييرًا للإشغال المالي.
      </p>
    </section>
  );
}

export default TenancyFields;
