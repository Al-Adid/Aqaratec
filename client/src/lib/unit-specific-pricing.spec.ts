import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { createRentalProperty } from "./prototype-rental";
import {
  createDescribedUnit,
  makeUnitProfile,
  parseUnitProfile,
  serializeUnitProfile,
  unitProfileFormValues,
  updateDescribedUnit,
} from "./unit-profile";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "",
    status: "نشط",
    date: "2026-10-26",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function state(
  settings: Partial<PrototypeState["settings"]> = {}
): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-a", title: "المحفظة أ", propertyId: "" }),
    row({
      id: "portfolio-b",
      title: "المحفظة ب",
      portfolioId: "portfolio-b",
      propertyId: "",
    }),
  ];
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "all",
      period: "all",
      language: "ar",
      ...settings,
    },
  };
}

function splitProperty(initial = state()) {
  return createRentalProperty(initial, {
    title: "عمارة تسعير الوحدات",
    portfolioId: "portfolio-a",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "2",
    inputMethod: "يدوي",
  });
}

describe("unit-specific pricing domain", () => {
  it("stores independent Arabic rent and requested sale prices for different units", () => {
    const base = splitProperty();
    const first = createDescribedUnit(base.state, base.property.id, {
      title: "شقة السعر الأول",
      monthlyRent: "٩٥٠٫٢٥",
      salePrice: "١٬٢٣٤٬٥٦٧٫٨٩",
    });
    const second = createDescribedUnit(first.state, base.property.id, {
      title: "شقة السعر الثاني",
      monthlyRent: "١٬١٠٠",
      salePrice: "٢٬٠٠٠٬٠٠٠٫٠١",
    });

    expect(first.result.meta.monthlyRentMinor).toBe(95_025);
    expect(second.result.meta.monthlyRentMinor).toBe(110_000);
    expect(parseUnitProfile(first.result.meta.unitProfile).salePriceMinor).toBe(
      123_456_789
    );
    expect(
      parseUnitProfile(second.result.meta.unitProfile).salePriceMinor
    ).toBe(200_000_001);
    expect(unitProfileFormValues(first.result).salePrice).toBe("1234567.89");
    expect(unitProfileFormValues(second.result).salePrice).toBe("2000000.01");
    expect(first.result.amountMinor).toBe(0);
    expect(second.result.amountMinor).toBe(0);
    expect(base.property.amountMinor).toBe(0);
  });

  it("preserves omitted prices and clears only the explicitly submitted active price", () => {
    const base = splitProperty();
    const created = createDescribedUnit(base.state, base.property.id, {
      title: "وحدة بسعرين مستقلين",
      monthlyRent: "900.50",
      salePrice: "1000000.25",
    });

    const descriptiveOnly = updateDescribedUnit(
      created.state,
      created.result.id,
      {
        contents: "مواصفات محدثة دون تسعير",
      }
    );
    expect(descriptiveOnly.result.meta.monthlyRentMinor).toBe(90_050);
    expect(
      parseUnitProfile(descriptiveOnly.result.meta.unitProfile).salePriceMinor
    ).toBe(100_000_025);

    const saleCleared = updateDescribedUnit(
      descriptiveOnly.state,
      created.result.id,
      { salePrice: "" }
    );
    expect(saleCleared.result.meta.monthlyRentMinor).toBe(90_050);
    expect(
      parseUnitProfile(saleCleared.result.meta.unitProfile).salePriceMinor
    ).toBeUndefined();

    const repriced = updateDescribedUnit(saleCleared.state, created.result.id, {
      salePrice: "٧٧٧٫٠٥",
    });
    const rentCleared = updateDescribedUnit(repriced.state, created.result.id, {
      monthlyRent: "",
    });
    expect(rentCleared.result.meta.monthlyRentMinor).toBeUndefined();
    expect(
      parseUnitProfile(rentCleared.result.meta.unitProfile).salePriceMinor
    ).toBe(77_705);
    expect(unitProfileFormValues(rentCleared.result).salePrice).toBe("777.05");
  });

  it("accepts legacy profiles and rejects invalid sale-price types, limits, and fractions", () => {
    expect(parseUnitProfile('{"v":1,"planNumber":"0007"}')).toEqual({
      v: 1,
      planNumber: "0007",
    });
    expect(
      parseUnitProfile(
        JSON.stringify({ v: 1, salePriceMinor: Number.MAX_SAFE_INTEGER })
      ).salePriceMinor
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseUnitProfile('{"v":1,"salePriceMinor":0}')).toThrow();
    expect(() => parseUnitProfile('{"v":1,"salePriceMinor":1.5}')).toThrow();
    expect(() =>
      parseUnitProfile(
        JSON.stringify({ v: 1, salePriceMinor: Number.MAX_SAFE_INTEGER + 1 })
      )
    ).toThrow();
    expect(() => makeUnitProfile({ salePrice: "٠" })).toThrow("موجب");
    expect(() => makeUnitProfile({ salePrice: "١٫٢٣٤" })).toThrow("منزلتين");
    expect(() =>
      serializeUnitProfile({
        v: 1,
        contents: "و".repeat(1000),
        salePriceMinor: 1,
      })
    ).toThrow("1024");
  });

  it("keeps role, scope, occupancy, and financial records isolated from a sale-price update", () => {
    const base = splitProperty();
    const created = createDescribedUnit(base.state, base.property.id, {
      title: "وحدة محروسة",
      monthlyRent: "1250",
      salePrice: "750000",
    });
    const lease = row({
      id: "lease-1",
      propertyId: base.property.id,
      meta: { unitId: created.result.id },
    });
    const receivable = row({
      id: "receivable-1",
      propertyId: base.property.id,
      amountMinor: 125_000,
    });
    const collection = row({
      id: "collection-1",
      propertyId: base.property.id,
      amountMinor: 100_000,
    });
    const before: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        leases: [lease],
        receivables: [receivable],
        collections: [collection],
      },
    };

    expect(() =>
      updateDescribedUnit(
        { ...before, settings: { ...before.settings, role: "owner" } },
        created.result.id,
        { salePrice: "800000" }
      )
    ).toThrow("الموظف");
    expect(() =>
      updateDescribedUnit(
        {
          ...before,
          settings: { ...before.settings, portfolioId: "portfolio-b" },
        },
        created.result.id,
        { salePrice: "800000" }
      )
    ).toThrow("خارج المحفظة");

    const updated = updateDescribedUnit(before, created.result.id, {
      salePrice: "800000",
    });
    expect(
      parseUnitProfile(updated.result.meta.unitProfile).salePriceMinor
    ).toBe(80_000_000);
    expect(updated.result.meta.monthlyRentMinor).toBe(125_000);
    expect(updated.result.status).toBe(created.result.status);
    expect(updated.result.amountMinor).toBe(created.result.amountMinor);
    expect(updated.state.entities.units).toHaveLength(
      before.entities.units.length
    );
    expect(updated.state.entities.leases).toEqual([lease]);
    expect(updated.state.entities.receivables).toEqual([receivable]);
    expect(updated.state.entities.collections).toEqual([collection]);
  });
});
