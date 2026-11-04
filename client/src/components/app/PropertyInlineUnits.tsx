import { useCallback, useMemo, useState } from "react";
import type { DemoEntity } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import { TenancyReadout } from "@/components/app/TenancyReadout";
import { PropertyCover } from "@/components/app/PropertyCover";
import { updateDescribedUnit, parseUnitProfile } from "@/lib/unit-profile";
import { unitDisplayReference } from "@/lib/prototype-unit-identifiers";
import { UnitDetailsDialog } from "@/pages/operating/UnitDetailsDialog";

export type InlineUnitValues = Record<string, string>;

export interface PropertyInlineUnitsProps {
  property: DemoEntity;
  /** Mirrors a durable parent action when one is already provided by the page. */
  onUpdateUnit?: (
    unit: DemoEntity,
    values: InlineUnitValues
  ) => void | Promise<void>;
  /** Must match the property registry's outer table column count. */
  parentColumnCount?: number;
}

type UnitDisplay = {
  category: string;
  area: string;
  reference: string;
};

function unitDisplay(
  unit: DemoEntity,
  entities: ReturnType<typeof usePrototype>["state"]["entities"]
): UnitDisplay {
  let category = "غير مسجل";
  let area = "غير مسجلة";
  try {
    const profile = parseUnitProfile(unit.meta.unitProfile);
    category =
      profile.category === "villa"
        ? "فيلا"
        : profile.category === "apartment"
          ? "شقة"
          : profile.category === "shop"
            ? "محل"
            : profile.category === "office"
              ? "مكتب"
              : profile.category === "other"
                ? "أخرى"
                : "غير مسجل";
    const profileArea = profile.areaM2;
    const legacyArea = unit.meta.area;
    const savedArea =
      profileArea ??
      (typeof legacyArea === "number" &&
      Number.isFinite(legacyArea) &&
      legacyArea > 0
        ? legacyArea
        : undefined);
    if (savedArea !== undefined) area = `${savedArea} م²`;
  } catch {
    // A malformed historical profile remains explicitly unknown in display.
  }

  let reference = "";
  try {
    reference = unitDisplayReference(entities, unit.id);
  } catch {
    reference = "";
  }
  return { category, area, reference };
}

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Shows only physical units from current state. The component never follows a
 * passed object into another portfolio, and its edit fallback performs the
 * existing domain transition inside the active PrototypeContext scope.
 */
export function PropertyInlineUnits({
  property,
  onUpdateUnit,
  parentColumnCount = 11,
}: PropertyInlineUnitsProps) {
  const { state, canEdit, commitAssetTransition } = usePrototype();
  const [updateMessage, setUpdateMessage] = useState("");
  const currentProperty = state.entities.properties.find(
    row => row.id === property.id
  );
  const inScope = Boolean(
    currentProperty &&
      (state.settings.portfolioId === "all" ||
        state.settings.portfolioId === currentProperty.portfolioId)
  );
  const units = useMemo(() => {
    if (!currentProperty || !inScope) return [];
    return state.entities.units.filter(
      unit =>
        unit.propertyId === currentProperty.id &&
        unit.portfolioId === currentProperty.portfolioId &&
        unit.meta.wholeProperty !== true
    );
  }, [currentProperty, inScope, state.entities.units]);

  const updateUnit = useCallback(
    async (unit: DemoEntity, values: InlineUnitValues) => {
      if (!canEdit) throw new Error("المعاينة الحالية للقراءة فقط.");
      const current = state.entities.units.find(row => row.id === unit.id);
      if (
        !current ||
        !currentProperty ||
        current.propertyId !== currentProperty.id ||
        current.portfolioId !== currentProperty.portfolioId ||
        !inScope ||
        current.meta.wholeProperty === true
      ) {
        throw new Error("الوحدة لم تعد ضمن العقار والمحفظة الحاليين.");
      }

      setUpdateMessage("");
      try {
        if (onUpdateUnit) await onUpdateUnit(current, values);
        else
          await commitAssetTransition(snapshot =>
            updateDescribedUnit(snapshot, current.id, values)
          );
      } catch (error) {
        setUpdateMessage(
          "تعذر حفظ تعديل الوحدة؛ بقيت مدخلاتك للتصحيح وإعادة المحاولة."
        );
        throw error;
      }
    },
    [
      canEdit,
      commitAssetTransition,
      currentProperty,
      inScope,
      onUpdateUnit,
      state.entities.units,
    ]
  );

  const columnCount =
    Number.isSafeInteger(parentColumnCount) && parentColumnCount > 0
      ? parentColumnCount
      : 11;

  if (!currentProperty || !inScope) {
    return (
      <section className="property-inline-units" aria-live="polite">
        <p className="property-inline-units__empty">
          الوحدات لم تعد ضمن نطاق المحفظة الحالية.
        </p>
      </section>
    );
  }

  return (
    <section
      className="property-inline-units"
      id={`property-inline-units-${currentProperty.id}`}
      aria-label={`وحدات ${currentProperty.title}`}
    >
      <table className="property-inline-units__table">
        <thead>
          <tr>
            <th colSpan={columnCount} scope="colgroup">
              الوحدات الفعلية المرتبطة بـ {currentProperty.title}
            </th>
          </tr>
        </thead>
        <tbody>
          {!units.length ? (
            <tr>
              <td colSpan={columnCount}>
                <p className="property-inline-units__empty">
                  لا توجد وحدات فعلية مرتبطة بهذا العقار بعد.
                </p>
              </td>
            </tr>
          ) : (
            units.map(unit => {
              const display = unitDisplay(unit, state.entities);
              return (
                <tr key={unit.id}>
                  <td colSpan={columnCount}>
                    <article className="property-inline-units__card">
                      <div className="property-inline-units__identity">
                        <PropertyCover
                          property={unit}
                          kind="units"
                          className="property-cover--unit"
                        />
                        <strong>
                          {unit.title || display.reference || "وحدة غير مسماة"}
                        </strong>
                        {display.reference && (
                          <span className="muted small">
                            {display.reference}
                          </span>
                        )}
                      </div>
                      <dl className="property-inline-units__facts">
                        <div>
                          <dt>النوع</dt>
                          <dd>{display.category}</dd>
                        </div>
                        <div>
                          <dt>المساحة</dt>
                          <dd>{display.area}</dd>
                        </div>
                      </dl>
                      <div className="property-inline-units__tenancy">
                        <TenancyReadout
                          property={currentProperty}
                          unit={unit}
                        />
                      </div>
                      <div className="property-inline-units__actions">
                        <UnitDetailsDialog
                          mode="details"
                          property={currentProperty}
                          unit={unit}
                          canEdit={canEdit}
                          trigger={
                            <button type="button" className="btn-ghost">
                              عرض الوحدة
                            </button>
                          }
                        />
                        {canEdit && (
                          <UnitDetailsDialog
                            mode="edit"
                            property={currentProperty}
                            unit={unit}
                            canEdit={canEdit}
                            onSubmit={values => updateUnit(unit, values)}
                            trigger={
                              <button type="button" className="btn-secondary">
                                تعديل الوحدة
                              </button>
                            }
                          />
                        )}
                      </div>
                    </article>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {updateMessage && (
        <p className="property-inline-units__error" role="alert">
          {updateMessage}
        </p>
      )}
    </section>
  );
}
