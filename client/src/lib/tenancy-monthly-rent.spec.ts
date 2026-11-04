import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import { updateDescribedUnit } from "./unit-profile";
import {
  getTenancyFormValues,
  getTenancySummary,
  makeTenancyDeclaration,
} from "./tenancy-information";

function fixture() {
  const initial = createDemoState();
  initial.settings.role = "operator";
  initial.settings.portfolioId = "all";
  const created = createRentalProperty(initial, {
    title: "مجمع اختبار المبلغ",
    portfolioId: initial.entities.portfolios[0].id,
    assetType: "villa_complex",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "2",
    inputMethod: "يدوي",
  });
  const unit = created.state.entities.units.find(
    row =>
      row.propertyId === created.property.id && row.meta.wholeProperty !== true
  )!;
  return { state: created.state, property: created.property, unit };
}

const dates = {
  tenancyStatus: "rented",
  tenancyStartDate: "2026-01-01",
  tenancyEndDate: "2026-12-31",
};

describe("current monthly rent declaration and contract source", () => {
  it("stores Arabic monthly rent in minor units and preserves it on a partial date update", () => {
    const raw = makeTenancyDeclaration({
      ...dates,
      tenancyMonthlyRent: "٣٬٥٠٠٫٧٥",
    })!;
    expect(JSON.parse(raw).monthlyRentMinor).toBe(350075);
    expect(
      getTenancyFormValues({ meta: { tenancyDeclaration: raw } })
        .tenancyMonthlyRent
    ).toBe("3500.75");
    const updated = makeTenancyDeclaration(
      { tenancyEndDate: "2027-01-31" },
      raw
    )!;
    expect(JSON.parse(updated)).toMatchObject({
      monthlyRentMinor: 350075,
      endDate: "2027-01-31",
    });
    const cleared = makeTenancyDeclaration({ tenancyStatus: "vacant" }, raw)!;
    expect(JSON.parse(cleared)).toEqual({ v: 1, status: "vacant" });
  });

  it("rejects invalid, negative, zero, three-decimal, unsafe and malformed separator amounts without rounding", () => {
    for (const tenancyMonthlyRent of [
      "0",
      "-1",
      "1.234",
      "1,2",
      "١٫٢٣٤",
      "99999999999999999999",
      "abc",
    ]) {
      expect(() =>
        makeTenancyDeclaration({ ...dates, tenancyMonthlyRent })
      ).toThrow("الإيجار الشهري الحالي");
    }
    expect(() =>
      makeTenancyDeclaration({
        tenancyStatus: "vacant",
        tenancyMonthlyRent: "3500",
      })
    ).toThrow("مؤجر");
  });

  it("saves a current rent independently from asking price and preserves financial arrays", () => {
    const { state, property, unit } = fixture();
    const financial = {
      leases: state.entities.leases,
      receivables: state.entities.receivables,
      collections: state.entities.collections,
      expenses: state.entities.expenses,
    };
    const changed = updateDescribedUnit(state, unit.id, {
      ...dates,
      tenancyMonthlyRent: "٤٥٠٠٫٥٠",
    });
    expect(
      changed.state.entities.units.find(row => row.id === unit.id)!.meta
        .monthlyRentMinor
    ).toBe(unit.meta.monthlyRentMinor);
    expect(
      getTenancySummary(
        changed.state.entities,
        property,
        changed.state.entities.units.find(row => row.id === unit.id)!,
        "2026-10-27"
      )
    ).toMatchObject({ source: "declaration", monthlyRentMinor: 450050 });
    const next = updateDescribedUnit(changed.state, unit.id, {
      tenancyMonthlyRent: "٥٠٠٠",
    });
    expect(
      getTenancyFormValues(
        next.state.entities.units.find(row => row.id === unit.id)!
      )
    ).toMatchObject({ ...dates, tenancyMonthlyRent: "5000" });
    for (const key of [
      "leases",
      "receivables",
      "collections",
      "expenses",
    ] as const)
      expect(next.state.entities[key]).toEqual(financial[key]);
  });

  it("prefers monthly rent and currency from the registered lease over an earlier declaration", () => {
    const { state, property, unit } = fixture();
    unit.meta.tenancyDeclaration = makeTenancyDeclaration({
      ...dates,
      tenancyMonthlyRent: "9999",
    })!;
    state.entities.leases.push({
      ...unit,
      id: "current-rent-lease",
      status: "نافذ",
      amountMinor: 1200000,
      currency: "QAR",
      meta: {
        lifecycleActivated: true,
        unitId: unit.id,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        rentMinor: 650050,
      },
    });
    const before = JSON.stringify(state);
    expect(
      getTenancySummary(state.entities, property, unit, "2026-10-27")
    ).toMatchObject({
      source: "lease",
      locked: true,
      monthlyRentMinor: 650050,
      monthlyRentCurrency: "QAR",
    });
    expect(() =>
      updateDescribedUnit(state, unit.id, {
        ...dates,
        tenancyMonthlyRent: "1234",
      })
    ).toThrow("عقد");
    expect(JSON.stringify(state)).toBe(before);
  });
});
