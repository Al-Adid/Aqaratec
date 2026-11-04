import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { listSaleMarketingInventory } from "./broker-sale-inventory";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "",
    status: "نشط",
    date: "2026-10-28",
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
    row({ id: "portfolio-a", title: "المحفظة أ" }),
    row({
      id: "portfolio-b",
      title: "المحفظة ب",
      portfolioId: "portfolio-b",
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
      scenarioDate: "2026-10-28",
      ...settings,
    },
  };
}

function property(
  id: string,
  meta: DemoEntity["meta"],
  overrides: Partial<DemoEntity> = {}
): DemoEntity {
  return row({
    id,
    propertyId: id,
    title: `عقار ${id}`,
    meta: { assetType: "building", ...meta },
    ...overrides,
  });
}

function unit(
  id: string,
  propertyId: string,
  meta: DemoEntity["meta"],
  overrides: Partial<DemoEntity> = {}
): DemoEntity {
  return row({
    id,
    propertyId,
    title: `وحدة ${id}`,
    meta,
    ...overrides,
  });
}

function propertyProfile(
  purpose: "rent" | "sale" | "mixed",
  salePriceMinor?: number
): string {
  return JSON.stringify({
    v: 1,
    purpose,
    ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
  });
}

function unitProfile(
  values: {
    purpose?: "rent" | "sale";
    category?: "villa" | "apartment" | "shop" | "office" | "other";
    salePriceMinor?: number;
    areaM2?: number;
  } = {}
): string {
  return JSON.stringify({ v: 1, ...values });
}

describe("sale marketing inventory", () => {
  it("shows the new whole-sale Festival property as one root option, never exposing its internal target", () => {
    const initial = state();
    initial.entities.properties = [
      property(
        "festival",
        {
          assetType: "villa_complex",
          rentalMode: "whole",
          propertyNumber: "FST-01",
          location: "اللؤلؤة",
          propertyProfile: propertyProfile("sale", 95_000_000),
        },
        { title: "مجمع فستفال" }
      ),
    ];
    initial.entities.units = [
      unit("festival-whole-target", "festival", {
        wholeProperty: true,
        unitCode: "WHOLE",
      }),
    ];

    const inventory = listSaleMarketingInventory(initial);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      propertyId: "festival",
      portfolioId: "portfolio-a",
      propertyTitle: "مجمع فستفال",
      propertyNumber: "FST-01",
      propertyType: "مجمع فلل",
      location: "اللؤلؤة",
      propertyPurpose: "sale",
      rentalMode: "whole",
      salePriceMinor: 95_000_000,
      units: [],
    });
  });

  it("groups a 36-unit split sale property exactly once and keeps each unit price independent", () => {
    const initial = state();
    initial.entities.properties = [
      property("split-sale", {
        rentalMode: "units",
        propertyProfile: propertyProfile("sale", 360_000_000),
      }),
    ];
    initial.entities.units = Array.from({ length: 36 }, (_, index) =>
      unit(`split-${index + 1}`, "split-sale", {
        unitCode: `S-${String(index + 1).padStart(2, "0")}`,
        unitProfile: unitProfile({
          category: "office",
          ...(index === 0
            ? { salePriceMinor: 10_000_000, areaM2: 101.25 }
            : {}),
          ...(index === 1 ? { salePriceMinor: 11_000_000 } : {}),
        }),
      })
    );

    const inventory = listSaleMarketingInventory(initial);
    const group = inventory[0]!;

    expect(inventory).toHaveLength(1);
    expect(group.propertyId).toBe("split-sale");
    expect(group.salePriceMinor).toBe(360_000_000);
    expect(group.units).toHaveLength(36);
    expect(group.units[0]).toMatchObject({
      id: "split-1",
      unitCode: "S-01",
      categoryLabel: "مكتب",
      salePriceMinor: 10_000_000,
      areaM2: 101.25,
    });
    expect(group.units[1]).toMatchObject({
      id: "split-2",
      salePriceMinor: 11_000_000,
    });
    expect(group.units[2]).not.toHaveProperty("salePriceMinor");
  });

  it("includes only explicit sale physical units for mixed splits and keeps a mixed whole parent as a root option", () => {
    const initial = state();
    initial.entities.properties = [
      property("mixed-split", {
        rentalMode: "units",
        propertyProfile: propertyProfile("mixed", 80_000_000),
      }),
      property("mixed-whole", {
        rentalMode: "whole",
        propertyProfile: propertyProfile("mixed", 120_000_000),
      }),
    ];
    initial.entities.units = [
      unit("mixed-sale-unit", "mixed-split", {
        unitCode: "MS-1",
        unitProfile: unitProfile({ purpose: "sale", category: "shop" }),
      }),
      unit("mixed-rent-unit", "mixed-split", {
        unitCode: "MR-1",
        unitProfile: unitProfile({ purpose: "rent", category: "shop" }),
      }),
      unit("mixed-unassigned-unit", "mixed-split", {
        unitCode: "MU-1",
        unitProfile: unitProfile({ category: "shop" }),
      }),
      unit("mixed-whole-target", "mixed-whole", {
        wholeProperty: true,
        unitCode: "WHOLE",
      }),
    ];

    const inventory = listSaleMarketingInventory(initial);
    const split = inventory.find(group => group.propertyId === "mixed-split")!;
    const whole = inventory.find(group => group.propertyId === "mixed-whole")!;

    expect(inventory).toHaveLength(2);
    expect(split).toMatchObject({
      propertyPurpose: "mixed",
      rentalMode: "units",
    });
    expect(split).not.toHaveProperty("salePriceMinor");
    expect(split.units.map(item => item.id)).toEqual(["mixed-sale-unit"]);
    expect(whole).toMatchObject({
      propertyPurpose: "mixed",
      rentalMode: "whole",
      salePriceMinor: 120_000_000,
      units: [],
    });
    expect(whole.units.map(item => item.id)).not.toContain(
      "mixed-whole-target"
    );
  });

  it("creates a group for an otherwise rental parent only when a linked physical unit explicitly offers sale", () => {
    const initial = state();
    initial.entities.properties = [
      property("rent-parent", {
        rentalMode: "units",
        propertyProfile: propertyProfile("rent", 90_000_000),
      }),
    ];
    initial.entities.units = [
      unit("sale-exception", "rent-parent", {
        unitProfile: unitProfile({
          purpose: "sale",
          category: "office",
          salePriceMinor: 7_000_000,
        }),
      }),
      unit("rent-sibling", "rent-parent", {
        unitProfile: unitProfile({ purpose: "rent", category: "office" }),
      }),
    ];

    const inventory = listSaleMarketingInventory(initial);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      propertyId: "rent-parent",
      propertyPurpose: "rent",
    });
    expect(inventory[0]).not.toHaveProperty("salePriceMinor");
    expect(inventory[0]!.units.map(item => item.id)).toEqual([
      "sale-exception",
    ]);
    expect(inventory[0]!.units[0]!.salePriceMinor).toBe(7_000_000);
  });

  it("keeps an incomplete split sale visible even when it has no physical units yet", () => {
    const initial = state();
    initial.entities.properties = [
      property("incomplete-sale", {
        rentalMode: "units",
        propertyProfile: propertyProfile("sale"),
      }),
    ];

    const inventory = listSaleMarketingInventory(initial);

    expect(inventory).toEqual([
      expect.objectContaining({
        propertyId: "incomplete-sale",
        rentalMode: "units",
        propertyPurpose: "sale",
        units: [],
      }),
    ]);
  });

  it("keeps a rented-for-sale unit visible with its factual tenancy and does not mutate lease data", () => {
    const initial = state();
    initial.entities.properties = [
      property("rented-sale", {
        rentalMode: "units",
        propertyProfile: propertyProfile("sale", 50_000_000),
      }),
    ];
    initial.entities.units = [
      unit("rented-sale-unit", "rented-sale", {
        unitProfile: unitProfile({
          category: "office",
          salePriceMinor: 5_000_000,
        }),
      }),
    ];
    initial.entities.leases = [
      row({
        id: "sale-unit-lease",
        propertyId: "rented-sale",
        status: "نافذ",
        date: "2026-01-01",
        meta: {
          unitId: "rented-sale-unit",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          lifecycleActivated: true,
        },
      }),
    ];
    const before = structuredClone(initial);

    const inventory = listSaleMarketingInventory(initial);

    expect(inventory[0]!.units).toEqual([
      expect.objectContaining({
        id: "rented-sale-unit",
        tenancyLabel: "مؤجر بعقد مسجل",
        salePriceMinor: 5_000_000,
      }),
    ]);
    expect(initial).toEqual(before);
  });

  it("isolates the selected portfolio and fails safely for corrupt profiles or invalid parent-unit linkage", () => {
    const initial = state({ portfolioId: "portfolio-a" });
    initial.entities.properties = [
      property("visible-sale", {
        rentalMode: "units",
        propertyProfile: propertyProfile("sale"),
      }),
      property(
        "other-portfolio-sale",
        {
          rentalMode: "units",
          propertyProfile: propertyProfile("sale"),
        },
        { portfolioId: "portfolio-b" }
      ),
      property("corrupt-sale", {
        rentalMode: "units",
        propertyProfile: "{invalid-json",
      }),
    ];
    initial.entities.units = [
      unit("visible-unit", "visible-sale", {
        unitProfile: unitProfile({ category: "office" }),
      }),
      unit(
        "other-unit",
        "other-portfolio-sale",
        { unitProfile: unitProfile({ category: "office" }) },
        { portfolioId: "portfolio-b" }
      ),
      unit(
        "wrong-portfolio-link",
        "visible-sale",
        {
          unitProfile: unitProfile({ purpose: "sale", category: "office" }),
        },
        { portfolioId: "portfolio-b" }
      ),
      unit("corrupt-unit", "corrupt-sale", {
        unitProfile: "{invalid-json",
      }),
    ];

    expect(() => listSaleMarketingInventory(initial)).not.toThrow();
    const inventory = listSaleMarketingInventory(initial);

    expect(inventory.map(group => group.propertyId)).toEqual(["visible-sale"]);
    expect(inventory[0]!.units.map(item => item.id)).toEqual(["visible-unit"]);
  });

  it("leaves missing sale prices missing and never reads rent, amount, cost, or summed unit prices as an asking price", () => {
    const initial = state();
    initial.entities.properties = [
      property(
        "price-isolation",
        {
          rentalMode: "units",
          monthlyRentMinor: 999_999_999_999,
          unitMonthlyRentMinor: 888_888_888_888,
          lastMaintenanceCostMinor: 777_777_777_777,
          propertyProfile: propertyProfile("sale"),
        },
        { amountMinor: 666_666_666_666 }
      ),
    ];
    initial.entities.units = [
      unit(
        "no-price-unit",
        "price-isolation",
        {
          monthlyRentMinor: 555_555_555_555,
          rentMinor: 444_444_444_444,
          unitProfile: unitProfile({ purpose: "sale", category: "office" }),
        },
        { amountMinor: 333_333_333_333 }
      ),
      unit("independently-priced-unit", "price-isolation", {
        monthlyRentMinor: 222_222_222_222,
        unitProfile: unitProfile({
          purpose: "sale",
          category: "office",
          salePriceMinor: 12_345_678,
        }),
      }),
    ];

    const group = listSaleMarketingInventory(initial)[0]!;
    const withoutPrice = group.units.find(item => item.id === "no-price-unit")!;
    const independentlyPriced = group.units.find(
      item => item.id === "independently-priced-unit"
    )!;

    expect(group).not.toHaveProperty("salePriceMinor");
    expect(withoutPrice).not.toHaveProperty("salePriceMinor");
    expect(independentlyPriced.salePriceMinor).toBe(12_345_678);
    expect(group.units.map(item => item.salePriceMinor)).not.toContain(
      12_345_678 * 2
    );
  });
});
