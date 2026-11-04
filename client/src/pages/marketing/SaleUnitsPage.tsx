import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { money, type DemoEntity } from "@shared/prototype";
import {
  EmptyState,
  Metric,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { PropertyCover } from "@/components/app/PropertyCover";
import { usePrototype } from "@/contexts/PrototypeContext";
import { listSaleMarketingInventory } from "@/lib/broker-sale-inventory";
import { UnitDetailsDialog } from "@/pages/operating/UnitDetailsDialog";
import "./SaleUnitsPage.css";

type SaleUnitRow = {
  id: string;
  property: DemoEntity;
  unit: DemoEntity;
  propertyTitle: string;
  title: string;
  unitCode: string;
  categoryLabel: string;
  tenancyLabel: string;
  areaM2?: number;
  salePriceMinor?: number;
};

function recorded(value: string | undefined): string {
  return value?.trim() || "غير مسجل";
}

function salePrice(value: number | undefined): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? money(value, "QAR")
    : "غير مسجل";
}

function area(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("en-QA")} م²`
    : "غير مسجل";
}

/** A physical, unit-level sale inventory only. It intentionally never exposes parent asking prices. */
export function SaleUnitsPage() {
  const { state, identity } = usePrototype();
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    setSearch("");
    setPropertyFilter("all");
    setCategoryFilter("all");
  }, [identity.storageKey, state.settings.portfolioId]);

  const rows = useMemo<SaleUnitRow[]>(() => {
    const propertiesById = new Map(
      state.entities.properties.map(property => [property.id, property])
    );
    const unitsById = new Map(
      state.entities.units.map(unit => [unit.id, unit])
    );

    return listSaleMarketingInventory(state).flatMap(group => {
      const property = propertiesById.get(group.propertyId);
      if (!property) return [];
      return group.units.flatMap(inventoryUnit => {
        const unit = unitsById.get(inventoryUnit.id);
        if (!unit || unit.meta.wholeProperty === true) return [];
        return [
          {
            id: inventoryUnit.id,
            property,
            unit,
            propertyTitle: recorded(group.propertyTitle),
            title: recorded(inventoryUnit.title),
            unitCode: recorded(inventoryUnit.unitCode),
            categoryLabel: recorded(inventoryUnit.categoryLabel),
            tenancyLabel: recorded(inventoryUnit.tenancyLabel),
            ...(inventoryUnit.areaM2 === undefined
              ? {}
              : { areaM2: inventoryUnit.areaM2 }),
            ...(inventoryUnit.salePriceMinor === undefined
              ? {}
              : { salePriceMinor: inventoryUnit.salePriceMinor }),
          },
        ];
      });
    });
  }, [state]);

  const properties = useMemo(
    () =>
      [
        ...new Map(
          rows.map(row => [row.property.id, row.propertyTitle])
        ).entries(),
      ]
        .map(([id, title]) => ({ id, title }))
        .sort((left, right) => left.title.localeCompare(right.title, "ar")),
    [rows]
  );
  const categories = useMemo(
    () =>
      [...new Set(rows.map(row => row.categoryLabel))].sort((left, right) =>
        left.localeCompare(right, "ar")
      ),
    [rows]
  );
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ar");
    return rows.filter(row => {
      if (propertyFilter !== "all" && row.property.id !== propertyFilter)
        return false;
      if (categoryFilter !== "all" && row.categoryLabel !== categoryFilter)
        return false;
      if (!needle) return true;
      return [row.title, row.propertyTitle, row.unitCode].some(value =>
        value.toLocaleLowerCase("ar").includes(needle)
      );
    });
  }, [categoryFilter, propertyFilter, rows, search]);

  const propertyCount = new Set(rows.map(row => row.property.id)).size;
  const missingPriceCount = rows.filter(
    row => row.salePriceMinor === undefined
  ).length;
  const hasFilters =
    Boolean(search.trim()) ||
    propertyFilter !== "all" ||
    categoryFilter !== "all";

  return (
    <div
      className="section-stack sale-units-page"
      data-testid="sale-units-page"
     
    >
      <PageHeader
        eyebrow="التسويق العقاري"
        title="وحدات للبيع"
        description="سجل مرجعي لوحدات البيع المادية في المحفظة المختارة؛ لا يغيّر الأسعار أو العقود أو السجلات المالية."
      >
        <Link className="sale-units-page__marketing-link" href="/marketing">
          العودة إلى التسويق
        </Link>
      </PageHeader>

      <div className="sale-units-page__metrics" aria-label="ملخص وحدات البيع">
        <Metric
          label="وحدات للبيع"
          value={rows.length.toLocaleString("en-QA")}
          detail="وحدات مادية فقط"
        />
        <Metric
          label="العقارات"
          value={propertyCount.toLocaleString("en-QA")}
          detail="تحوي وحدات للبيع"
        />
        <Metric
          label="غير مسجل السعر"
          value={missingPriceCount.toLocaleString("en-QA")}
          detail="لا يوجد بديل من العقار أو الإيجار"
        />
      </div>

      <Panel
        title="سجل الوحدات"
        description="سعر الطلب الظاهر هو السعر الخاص بكل وحدة فقط."
        className="sale-units-page__panel"
      >
        <p className="sale-units-page__notice" role="status">
          العقارات الكاملة المعروضة للبيع تظهر ضمن التسويق؛ لا تُنشأ أو تُعد هنا
          كوحدات مادية إضافية.
        </p>

        {rows.length > 0 && (
          <div
            className="sale-units-page__filters"
            aria-label="مرشحات وحدات البيع"
          >
            <label className="sale-units-page__search">
              <span>بحث</span>
              <input
                className="field"
                aria-label="بحث في وحدات البيع"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="اسم الوحدة أو العقار أو الرمز"
              />
            </label>
            <label>
              <span>العقار</span>
              <select
                className="field"
                aria-label="تصفية العقار"
                value={propertyFilter}
                onChange={event => setPropertyFilter(event.target.value)}
              >
                <option value="all">كل العقارات</option>
                {properties.map(property => (
                  <option key={property.id} value={property.id}>
                    {property.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>الفئة</span>
              <select
                className="field"
                aria-label="تصفية الفئة"
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
              >
                <option value="all">كل الفئات</option>
                {categories.map(category => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {filteredRows.length ? (
          <div
            className="sale-units-page__table-wrap"
            data-excel-table="sale-units"
          >
            <table className="sale-units-page__table">
              <thead>
                <tr>
                  <th scope="col">الصورة</th>
                  <th scope="col">العقار</th>
                  <th scope="col">الوحدة / الرمز</th>
                  <th scope="col">الفئة</th>
                  <th scope="col">المساحة</th>
                  <th scope="col">حالة التأجير</th>
                  <th scope="col">سعر الطلب للبيع</th>
                  <th scope="col">معلومات</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.id}>
                    <td className="sale-units-page__cover-cell">
                      <PropertyCover
                        property={row.unit}
                        kind="units"
                        className="sale-units-page__cover"
                        alt={`صورة الوحدة ${row.title}`}
                      />
                    </td>
                    <td>
                      <Link
                        className="sale-units-page__property-link"
                        href={`/properties/${row.property.id}`}
                      >
                        {row.propertyTitle}
                      </Link>
                    </td>
                    <td>
                      <strong className="sale-units-page__unit-title">
                        {row.title}
                      </strong>
                      <bdi className="sale-units-page__code">
                        {row.unitCode}
                      </bdi>
                    </td>
                    <td>{row.categoryLabel}</td>
                    <td className="sale-units-page__number">
                      {area(row.areaM2)}
                    </td>
                    <td>{row.tenancyLabel}</td>
                    <td
                      className="sale-units-page__price"
                      data-testid={`sale-unit-price-${row.id}`}
                    >
                      {salePrice(row.salePriceMinor)}
                    </td>
                    <td>
                      <UnitDetailsDialog
                        mode="details"
                        unit={row.unit}
                        property={row.property}
                        canEdit={false}
                        trigger={
                          <button
                            type="button"
                            className="sale-units-page__details"
                            aria-label={`عرض تفاصيل ${row.title}`}
                          >
                            عرض التفاصيل
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : rows.length ? (
          <EmptyState
            title="لا توجد وحدات توافق المرشحات الحالية"
            description="جرّب مسح البحث أو اختيار عقار أو فئة أخرى."
          />
        ) : (
          <EmptyState
            title="لا توجد وحدات مادية للبيع في النطاق الحالي"
            description="ستظهر الوحدات التي لها هدف بيع صريح أو موروث عند توفرها. أما العقارات الكاملة للبيع فتظهر ضمن التسويق."
          />
        )}

        {hasFilters && filteredRows.length > 0 && (
          <p className="sale-units-page__result-count" role="status">
            {filteredRows.length.toLocaleString("en-QA")} نتيجة من أصل{" "}
            {rows.length.toLocaleString("en-QA")} وحدة.
          </p>
        )}
      </Panel>
    </div>
  );
}
