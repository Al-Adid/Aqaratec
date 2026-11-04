import { money, type DemoEntity } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import { scenarioDate } from "@shared/prototype-clock";
import { getTenancySummary } from "@/lib/tenancy-information";

/** Display-only tenancy information; never creates a lease or a ledger entry. */
export function TenancyReadout({
  property,
  unit,
}: {
  property: DemoEntity;
  unit?: DemoEntity;
}) {
  const { state } = usePrototype();
  const currentProperty = state.entities.properties.find(
    row => row.id === property.id
  );
  const currentUnit = unit
    ? state.entities.units.find(row => row.id === unit.id)
    : undefined;
  if (!currentProperty || (unit && !currentUnit))
    return <span className="muted small">السجل لم يعد متاحًا</span>;
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== currentProperty.portfolioId
  )
    return <span className="muted small">خارج نطاق المحفظة الحالية</span>;
  try {
    const tenancy = getTenancySummary(
      state.entities,
      currentProperty,
      currentUnit,
      scenarioDate(state)
    );
    const source =
      tenancy.source === "lease"
        ? "من العقد المسجل"
        : tenancy.source === "declaration"
          ? "إدخال أولي · غير مرتبط بعقد مسجل"
          : tenancy.source === "units"
            ? "ملخص عقود وبيانات الوحدات"
            : "لا يوجد عقد مسجل لهذا الهدف";
    return (
      <div className="property-unit-reference">
        <strong>{tenancy.label}</strong>
        <small className="muted">{source}</small>
        {tenancy.startDate && (
          <span className="small">
            بداية العقد: <bdi>{tenancy.startDate}</bdi>
          </span>
        )}
        {tenancy.endDate && (
          <span className="small">
            نهاية العقد: <bdi>{tenancy.endDate}</bdi>
          </span>
        )}
        {tenancy.monthlyRentMinor !== undefined && (
          <span className="small">
            الإيجار الشهري المسجل:{" "}
            <bdi>
              {money(
                tenancy.monthlyRentMinor,
                tenancy.monthlyRentCurrency ?? "QAR"
              )}
            </bdi>
          </span>
        )}
        {tenancy.source === "units" && (
          <small className="muted">تواريخ كل وحدة موضحة على حدة.</small>
        )}
        {tenancy.leaseId && (
          <a className="small" href="/leases">
            مراجعة العقد المسجل
          </a>
        )}
      </div>
    );
  } catch (error) {
    return (
      <span className="property-form-error small" role="alert">
        {error instanceof Error ? error.message : "تعذر قراءة معلومات التأجير"}
      </span>
    );
  }
}
