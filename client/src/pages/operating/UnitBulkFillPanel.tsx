import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { unitProfileFormValues } from "@/lib/unit-profile";
import {
  previewMatchedUnits,
  type UnitMatchRequest,
} from "@/lib/unit-match-fill";
import "./UnitBulkFillPanel.css";

const MATCHED_FIELDS = [
  "unitArea",
  "category",
  "villaArrangement",
  "roomLayout",
  "apartmentLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "description",
  "contents",
  "unitPurpose",
  "monthlyRent",
  "salePrice",
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const;

type MatchedField = (typeof MATCHED_FIELDS)[number];
type FormValues = Record<string, string>;
type MatchFact = { key: MatchedField; before: string; after: string };

const FIELD_LABELS: Record<MatchedField, string> = {
  unitArea: "مساحة الوحدة",
  category: "نوع الوحدة",
  villaArrangement: "ترتيب الفيلا",
  roomLayout: "توزيع الغرف",
  apartmentLayout: "توزيع الشقة",
  bedrooms: "عدد الغرف",
  livingRooms: "عدد الصالات",
  bathrooms: "عدد الحمامات",
  kitchens: "عدد المطابخ",
  furnishing: "التأثيث",
  description: "وصف الوحدة",
  contents: "محتويات الوحدة",
  unitPurpose: "هدف الوحدة",
  monthlyRent: "الإيجار الشهري المطلوب",
  salePrice: "سعر البيع المطلوب",
  tenancyStatus: "حالة إعلان التأجير الأولي",
  tenancyStartDate: "بداية إعلان التأجير",
  tenancyEndDate: "نهاية إعلان التأجير",
  tenancyMonthlyRent: "إيجار إعلان التأجير الشهري",
};

const VALUE_LABELS: Record<string, string> = {
  apartment: "شقة",
  villa: "فيلا",
  shop: "محل",
  office: "مكتب",
  other: "وحدة أخرى",
  attached: "متلاصقة",
  detached: "منفصلة",
  studio: "استوديو",
  "1-living": "غرفة وصالة",
  "2-living": "غرفتان وصالة",
  "3-living": "3 غرف وصالة",
  "4-living": "4 غرف وصالة",
  "5-living": "5 غرف وصالة",
  custom: "توزيع مخصص",
  furnished: "مفروشة",
  unfurnished: "غير مفروشة",
  rent: "إيجار",
  sale: "بيع",
  rented: "مؤجر",
  vacant: "غير مؤجر",
};

function serialFor(unit: DemoEntity): string {
  const code = unit.meta.unitCode ?? unit.meta.code;
  return typeof code === "string" && code.trim() ? code.trim() : "غير مسجل";
}

function factsBetween(before: DemoEntity, after: DemoEntity): MatchFact[] {
  const previous = unitProfileFormValues(before) as FormValues;
  const next = unitProfileFormValues(after) as FormValues;
  return MATCHED_FIELDS.flatMap(key =>
    previous[key] === next[key]
      ? []
      : [{ key, before: previous[key] ?? "", after: next[key] ?? "" }]
  );
}

function humanValue(key: MatchedField, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "غير محدد";
  if (key === "unitArea") return `${trimmed} م²`;
  if (
    key === "monthlyRent" ||
    key === "salePrice" ||
    key === "tenancyMonthlyRent"
  )
    return `${trimmed} ر.ق`;
  return VALUE_LABELS[trimmed] ?? trimmed;
}

export type UnitBulkFillPanelProps = {
  /** Current immutable state used only by the pure matching preview. */
  state: PrototypeState;
  propertyId: string;
  propertyTitle: string;
  units: readonly DemoEntity[];
  sourceUnit: DemoEntity;
  sourceChanges: Record<string, string>;
  sourceToken: string;
  openedTokens: Readonly<Record<string, string | undefined>>;
  photoIds?: readonly string[];
  unavailablePhotoCount?: number;
  disabled?: boolean;
  /** The parent owns the sole durable source-to-target transition. */
  onApply: (request: UnitMatchRequest) => Promise<boolean>;
  onCancel: () => void;
};

/**
 * Inline matcher content for the existing unit editor dialog. It deliberately
 * has no modal role or source-value editor: the parent remains the only dialog
 * and the source unit remains immutable while this selector is open.
 */
export function UnitBulkFillPanel({
  state,
  propertyId,
  propertyTitle,
  units,
  sourceUnit,
  sourceChanges,
  sourceToken,
  openedTokens,
  photoIds,
  unavailablePhotoCount = 0,
  disabled = false,
  onApply,
  onCancel,
}: UnitBulkFillPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const busyRef = useRef(false);

  const targetUnits = useMemo(() => {
    const ids = new Set<string>();
    return units.filter(unit => {
      const valid =
        unit.id !== sourceUnit.id &&
        unit.propertyId === propertyId &&
        unit.propertyId === sourceUnit.propertyId &&
        unit.portfolioId === sourceUnit.portfolioId &&
        unit.meta.wholeProperty !== true &&
        !ids.has(unit.id);
      if (valid) ids.add(unit.id);
      return valid;
    });
  }, [
    propertyId,
    sourceUnit.id,
    sourceUnit.portfolioId,
    sourceUnit.propertyId,
    units,
  ]);

  useEffect(() => {
    const validIds = new Set(targetUnits.map(unit => unit.id));
    setSelectedIds(previous => previous.filter(id => validIds.has(id)));
  }, [targetUnits]);

  const request = useMemo<UnitMatchRequest>(
    () => ({
      propertyId,
      sourceUnitId: sourceUnit.id,
      sourceChanges,
      sourceToken,
      unitIds: selectedIds,
      expectedTokens: openedTokens,
      photoIds,
    }),
    [
      openedTokens,
      photoIds,
      propertyId,
      selectedIds,
      sourceChanges,
      sourceToken,
      sourceUnit.id,
    ]
  );

  const preview = useMemo(() => {
    if (!selectedIds.length) return { result: undefined, error: "" };
    try {
      return { result: previewMatchedUnits(state, request), error: "" };
    } catch (caught) {
      return {
        result: undefined,
        error:
          caught instanceof Error
            ? caught.message
            : "تعذرت معاينة مطابقة الوحدات.",
      };
    }
  }, [request, selectedIds.length, state]);

  const effectiveSource = preview.result?.result.source;
  const sourceFacts = useMemo(() => {
    const before = unitProfileFormValues(sourceUnit) as FormValues;
    const current = effectiveSource
      ? (unitProfileFormValues(effectiveSource) as FormValues)
      : { ...before, ...sourceChanges };
    const applied = preview.result
      ? new Set(
          preview.result.result.updates.flatMap(update => update.appliedKeys)
        )
      : undefined;
    return MATCHED_FIELDS.flatMap(key => {
      const after = current[key]?.trim() ?? "";
      return after && (!applied || applied.has(key))
        ? [{ key, before: before[key] ?? "", after }]
        : [];
    });
  }, [effectiveSource, preview.result, sourceChanges, sourceUnit]);
  const selectedUpdates = (preview.result?.result.updates ?? []).filter(
    update => selectedIds.includes(update.after.id)
  );
  // Existing saved facts are eligible too: no new draft change is required.
  const hasCopyableSource = selectedUpdates.length > 0;
  const controlsDisabled = disabled || busy;
  const allSelected =
    targetUnits.length > 0 && selectedIds.length === targetUnits.length;

  const toggleUnit = (unitId: string) => {
    if (controlsDisabled) return;
    setSubmitError("");
    setSelectedIds(previous =>
      previous.includes(unitId)
        ? previous.filter(id => id !== unitId)
        : [...previous, unitId]
    );
  };

  const toggleAll = () => {
    if (controlsDisabled) return;
    setSubmitError("");
    setSelectedIds(previous =>
      previous.length === targetUnits.length
        ? []
        : targetUnits.map(unit => unit.id)
    );
  };

  const submit = async () => {
    if (
      controlsDisabled ||
      busyRef.current ||
      !selectedIds.length ||
      !hasCopyableSource ||
      preview.error
    )
      return;

    busyRef.current = true;
    setBusy(true);
    setSubmitError("");
    try {
      const saved = await onApply(request);
      if (!saved)
        setSubmitError(
          "لم تُضف المطابقة. حدّث المعاينة ثم أعد المحاولة؛ بقي اختيار الوحدات كما هو."
        );
    } catch (caught) {
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ مطابقة الوحدات. بقي اختيار الوحدات كما هو."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      className="unit-bulk-fill-panel"
      aria-label="مطابقة مواصفات الوحدات"
      aria-busy={controlsDisabled}
    >
      <div className="unit-bulk-fill-panel__heading">
        <div>
          <span className="eyebrow">مطابقة من الوحدة الحالية</span>
          <h3>أضف مواصفات هذه الوحدة إلى وحدات أخرى</h3>
          <p className="muted small">
            العقار: {propertyTitle}. راجع المصدر أدناه ثم اختر الوحدات المستهدفة
            فقط.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          disabled={controlsDisabled}
          onClick={onCancel}
        >
          إلغاء والعودة للوحدة
        </button>
      </div>

      <section
        className="unit-bulk-fill-panel__source"
        aria-labelledby="match-source-heading"
      >
        <div className="unit-bulk-fill-panel__section-heading">
          <div>
            <h4 id="match-source-heading">مصدر المطابقة</h4>
            <p className="muted small">
              <strong>{sourceUnit.title}</strong> · رمز الوحدة{" "}
              <b dir="ltr">{serialFor(sourceUnit)}</b>
            </p>
          </div>
        </div>
        {preview.error ? (
          <p className="property-form-error" role="alert">
            {preview.error}
          </p>
        ) : sourceFacts.length ? (
          <dl className="unit-bulk-fill-panel__facts unit-bulk-fill-panel__source-facts">
            {sourceFacts.map(fact => (
              <div key={fact.key}>
                <dt>{FIELD_LABELS[fact.key]}</dt>
                <dd>{humanValue(fact.key, fact.after)}</dd>
              </div>
            ))}
          </dl>
        ) : !photoIds?.length ? (
          <p className="muted small">
            لا توجد قيمة مصدر مؤهلة للنسخ الآن. الحقول الفارغة لا تُطابق وحدات
            أخرى.
          </p>
        ) : null}
        {!!photoIds?.length && (
          <p className="muted small">
            صور المصدر المتاحة: {photoIds.length} · ستُضاف للوحدات المختارة مع
            الحفاظ على صورها الحالية.
          </p>
        )}
        {unavailablePhotoCount > 0 && (
          <p role="status" className="muted small">
            {unavailablePhotoCount} من مراجع الصور غير متاحة في هذا المتصفح ولن
            تُنسخ؛ أعد إرفاق الملفات إذا أردت مطابقتها.
          </p>
        )}
        <p className="unit-bulk-fill-panel__scope-note" role="note">
          ستتطابق المواصفات المشتركة والمساحة والتأثيث والوصف والمحتويات والهدف
          والسعر المطلوب، وإعلان التأجير الأولي المؤهل، وصور المصدر المتاحة
          محليًا. لا تتغير الرموز أو العدادات أو الطابق أو أرقام المخطط/العقار
          أو العقود أو السجلات المالية.
        </p>
      </section>

      <section
        className="unit-bulk-fill-panel__units"
        aria-labelledby="match-units-heading"
      >
        <div className="unit-bulk-fill-panel__section-heading">
          <div>
            <h4 id="match-units-heading">الوحدات المطابقة</h4>
            <p className="muted small">
              {selectedIds.length} من {targetUnits.length} وحدة مؤهلة
            </p>
          </div>
          <label className="unit-bulk-fill-panel__check">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={controlsDisabled || !targetUnits.length}
              onChange={toggleAll}
              aria-label="اختيار كل الوحدات المؤهلة"
            />
            اختيار الكل
          </label>
        </div>
        {targetUnits.length ? (
          <div className="unit-bulk-fill-panel__unit-list">
            {targetUnits.map(unit => (
              <label key={unit.id} className="unit-bulk-fill-panel__check">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(unit.id)}
                  disabled={controlsDisabled}
                  onChange={() => toggleUnit(unit.id)}
                />
                <span>
                  رمز الوحدة <b dir="ltr">{serialFor(unit)}</b>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="muted small">
            لا توجد وحدة أخرى مؤهلة للمطابقة ضمن هذا العقار.
          </p>
        )}
      </section>

      <section
        className="unit-bulk-fill-panel__preview"
        aria-live="polite"
        aria-label="معاينة المطابقة"
      >
        <h4>معاينة قبل الإضافة</h4>
        {!selectedIds.length ? (
          <p className="muted small">اختر وحدة واحدة على الأقل لعرض التغيير.</p>
        ) : preview.error ? (
          <p className="property-form-error" role="alert">
            {preview.error}
          </p>
        ) : selectedUpdates.length ? (
          <ul>
            {selectedUpdates.map(update => {
              const facts = factsBetween(update.before, update.after);
              return (
                <li key={update.after.id}>
                  <details>
                    <summary>
                      <strong>
                        رمز الوحدة{" "}
                        <span dir="ltr">{serialFor(update.after)}</span>
                      </strong>
                      <span className="muted small">عرض قبل/بعد</span>
                    </summary>
                    {!!update.matchedPhotoIds?.length && (
                      <p className="muted small">
                        مطابقة {update.matchedPhotoIds.length} صورة من المصدر
                        دون حذف صور هذه الوحدة أو تكرار مراجعها.
                      </p>
                    )}
                    {facts.length ? (
                      <dl className="unit-bulk-fill-panel__facts">
                        {facts.map(fact => (
                          <div key={fact.key}>
                            <dt>{FIELD_LABELS[fact.key]}</dt>
                            <dd>
                              <s>{humanValue(fact.key, fact.before)}</s>
                              <span aria-hidden="true"> ← </span>
                              <b>{humanValue(fact.key, fact.after)}</b>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : !update.matchedPhotoIds?.length ? (
                      <p className="muted small">
                        لا يوجد تغيير فعّال لهذه الوحدة.
                      </p>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">
            لا يوجد تغيير فعّال في الوحدات المختارة.
          </p>
        )}
      </section>

      {submitError && (
        <p className="property-form-error" role="alert" aria-live="assertive">
          {submitError}
        </p>
      )}

      <div className="unit-bulk-fill-panel__actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={controlsDisabled}
          onClick={onCancel}
        >
          إلغاء
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={
            controlsDisabled ||
            !selectedIds.length ||
            !hasCopyableSource ||
            Boolean(preview.error)
          }
          onClick={submit}
        >
          {busy ? "جارٍ الإضافة…" : "إضافة"}
        </button>
      </div>
    </section>
  );
}

export default UnitBulkFillPanel;
