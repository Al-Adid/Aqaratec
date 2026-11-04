import { type FormEvent, useState } from "react";
import { Plus, X } from "lucide-react";
import { money, type DemoEntity } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import { patchUnitMonthlyRent } from "@/lib/prototype-rental";

function minorToInput(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value / 100)
    : "";
}

/**
 * Edits only the explicit unit-rent metadata. Leaving the field empty removes
 * the override and allows the current split-property default to be inherited.
 */
export function UnitMonthlyRentEditor({
  unit,
  inheritedMonthlyRentMinor,
}: {
  unit: DemoEntity;
  inheritedMonthlyRentMinor?: number;
}) {
  const { canEdit, commitTransition } = usePrototype();
  const [open, setOpen] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState("");
  const [error, setError] = useState("");

  const openDialog = () => {
    if (!canEdit) return;
    setMonthlyRent(minorToInput(unit.meta.monthlyRentMinor));
    setError("");
    setOpen(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) {
      setError("المعاينة الحالية للقراءة فقط.");
      return;
    }
    try {
      commitTransition(current =>
        patchUnitMonthlyRent(current, unit.id, { monthlyRent })
      );
      setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "تعذر حفظ إيجار الوحدة."
      );
    }
  };

  const inheritedNote =
    typeof inheritedMonthlyRentMinor === "number" &&
    Number.isSafeInteger(inheritedMonthlyRentMinor) &&
    inheritedMonthlyRentMinor > 0
      ? `عند ترك الحقل فارغًا، ترث الوحدة الافتراضي الحالي للعقار: ${money(inheritedMonthlyRentMinor)} شهريًا.`
      : "عند ترك الحقل فارغًا، يُمسح override هذه الوحدة؛ لا يوجد افتراضي شهري مسجل للعقار حاليًا.";

  return (
    <>
      <button
        className="btn-secondary"
        type="button"
        disabled={!canEdit}
        onClick={openDialog}
      >
        تعديل الإيجار الشهري
      </button>
      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="modal property-unit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="تعديل الإيجار الشهري للوحدة"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">وحدة مرتبطة بالعقار</span>
                <h2>تعديل الإيجار الشهري</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted small">
              {inheritedNote} لا يغيّر هذا الإجراء قيمة العقود أو الذمم أو النقد
              أو amountMinor التاريخي للوحدة.
            </p>
            {error && (
              <p className="property-form-error" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={submit}>
              <div className="form-grid">
                <label className="form-label">
                  <span>إيجار الوحدة الشهري (ر.ق)</span>
                  <input
                    className="field"
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={monthlyRent}
                    placeholder="اختياري · مثال ١٬٢٣٤٫٥٠"
                    aria-label="إيجار الوحدة الشهري (ر.ق)"
                    onChange={event => setMonthlyRent(event.target.value)}
                  />
                  <small className="muted">
                    اتركه فارغًا لمسح السعر الخاص واستعادة الوراثة، إن وجدت.
                  </small>
                </label>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn-primary">
                  <Plus size={16} /> حفظ الإيجار الشهري
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

export default UnitMonthlyRentEditor;
