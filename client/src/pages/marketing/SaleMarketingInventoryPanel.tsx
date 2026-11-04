import { Link } from "wouter";
import { money } from "@shared/prototype";
import { EmptyState, Panel } from "@/components/app/Primitives";
import type { SaleMarketingGroup } from "@/lib/broker-sale-inventory";
import "./SaleMarketingInventoryPanel.css";

export interface SaleMarketingInventoryPanelProps {
  groups: SaleMarketingGroup[];
}

function textOrUnrecorded(value: string | undefined): string {
  return value?.trim() || "غير مسجل";
}

function salePrice(value: number | undefined): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? money(value)
    : "غير مسجل";
}

function area(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("en-QA")} م²`
    : "غير مسجل";
}

/** Read-only inventory; the caller supplies only the already-resolved sale rows. */
export function SaleMarketingInventoryPanel({
  groups,
}: SaleMarketingInventoryPanelProps) {
  return (
    <Panel
      title="عقارات ووحدات للبيع"
      description="بيان مرجعي لأسعار الطلب وحالة الإشغال الحالية، دون اختيار أو تعديل."
      className="sale-marketing-inventory"
    >
      <p className="sale-marketing-inventory__notice" role="status">
        عرض البيع فقط حاليًا؛ تجهيز وإرسال عروض البيع ودورتها سيضافان لاحقًا،
        ولا تدخل هذه العقارات في حملات الإيجار.
      </p>

      {groups.length ? (
        <div className="sale-marketing-inventory__list">
          {groups.map(group => {
            const propertyTitle = textOrUnrecorded(group.propertyTitle);
            const propertyHref = `/properties/${group.propertyId}`;
            const units = group.units ?? [];
            const rootSaleOffer =
              group.propertyPurpose === "sale" ||
              (group.propertyPurpose === "mixed" &&
                group.rentalMode === "whole");

            return (
              <article
                className="sale-marketing-inventory__card"
                key={group.propertyId}
                aria-label={`عقار للبيع: ${propertyTitle}`}
              >
                <header className="sale-marketing-inventory__card-header">
                  <div>
                    <span className="sale-marketing-inventory__eyebrow">
                      {!rootSaleOffer
                        ? "وحدات للبيع ضمن العقار"
                        : group.propertyPurpose === "mixed" &&
                            group.rentalMode === "whole"
                          ? "للبيع أو الإيجار"
                          : "للبيع"}
                    </span>
                    <h3>{propertyTitle}</h3>
                    <p className="sale-marketing-inventory__location">
                      {textOrUnrecorded(group.location)}
                    </p>
                  </div>
                  <Link
                    className="sale-marketing-inventory__property-link"
                    href={propertyHref}
                  >
                    فتح العقار
                  </Link>
                </header>

                <dl className="sale-marketing-inventory__facts">
                  <div>
                    <dt>رقم العقار</dt>
                    <dd className="sale-marketing-inventory__number">
                      {textOrUnrecorded(group.propertyNumber)}
                    </dd>
                  </div>
                  <div>
                    <dt>النوع</dt>
                    <dd>{textOrUnrecorded(group.propertyType)}</dd>
                  </div>
                  <div>
                    <dt>
                      {!rootSaleOffer
                        ? "أسعار الوحدات للبيع"
                        : "سعر البيع المسجل للأصل"}
                    </dt>
                    <dd
                      className="sale-marketing-inventory__price"
                      data-testid={`sale-property-price-${group.propertyId}`}
                    >
                      {rootSaleOffer
                        ? salePrice(group.salePriceMinor)
                        : "أسعار الوحدات أدناه"}
                    </dd>
                  </div>
                  <div>
                    <dt>حالة الإشغال</dt>
                    <dd>{textOrUnrecorded(group.tenancyLabel)}</dd>
                  </div>
                </dl>

                {units.length > 0 && (
                  <details className="sale-marketing-inventory__units">
                    <summary>
                      عرض وحدات البيع ({units.length.toLocaleString("en-QA")})
                    </summary>
                    <div className="sale-marketing-inventory__unit-table-wrap">
                      <table className="sale-marketing-inventory__unit-table">
                        <thead>
                          <tr>
                            <th>رمز الوحدة</th>
                            <th>الفئة</th>
                            <th>المساحة</th>
                            <th>سعر الطلب للبيع</th>
                            <th>حالة الإشغال</th>
                            <th>العقار</th>
                          </tr>
                        </thead>
                        <tbody>
                          {units.map(unit => (
                            <tr key={unit.id}>
                              <td className="sale-marketing-inventory__number">
                                {textOrUnrecorded(unit.unitCode)}
                              </td>
                              <td>{textOrUnrecorded(unit.categoryLabel)}</td>
                              <td>{area(unit.areaM2)}</td>
                              <td
                                className="sale-marketing-inventory__price"
                                data-testid={`sale-unit-price-${unit.id}`}
                              >
                                {salePrice(unit.salePriceMinor)}
                              </td>
                              <td>{textOrUnrecorded(unit.tenancyLabel)}</td>
                              <td>
                                <Link
                                  className="sale-marketing-inventory__unit-link"
                                  href={propertyHref}
                                >
                                  فتح العقار
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="لا توجد عقارات أو وحدات للبيع في النطاق الحالي"
          description="ستظهر هنا العقارات المصنّفة للبيع أو للبيع والإيجار عند توفرها."
        />
      )}
    </Panel>
  );
}
