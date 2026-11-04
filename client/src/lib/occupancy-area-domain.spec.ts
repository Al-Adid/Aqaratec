import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  createRentalProperty,
  updateRentalProperty,
} from "./prototype-rental";
import {
  createDescribedUnit,
  parseUnitAreaM2,
  parseUnitProfile,
  unitProfileFormValues,
  updateDescribedUnit,
} from "./unit-profile";
import { getTenancyFormValues, getTenancySummary } from "./tenancy-information";

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
      scenarioDate: "2026-10-26",
      ...settings,
    },
  };
}

function propertyValues(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "عمارة المساحات",
    portfolioId: "portfolio-a",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "2",
    inputMethod: "يدوي",
    ...overrides,
  };
}

describe("occupancy declaration and unit area domain", () => {
  it("accepts bounded Arabic/decimal physical areas and rejects invalid values", () => {
    expect(parseUnitAreaM2("80")).toBe(80);
    expect(parseUnitAreaM2("140.5")).toBe(140.5);
    expect(parseUnitAreaM2("١٤٠٫٥")).toBe(140.5);
    expect(parseUnitAreaM2("١٬٢٣٤٫٥٠")).toBe(1234.5);
    expect(parseUnitAreaM2("")).toBeUndefined();
    expect(() => parseUnitAreaM2("0")).toThrow("موجب");
    expect(() => parseUnitAreaM2("140.555")).toThrow("منزلتين");
    expect(() => parseUnitAreaM2("١٠٠٠٠٠٠٠٠٠٠٠٠٫٠١")).toThrow("الحد الآمن");
    expect(() => parseUnitAreaM2("ثمانون")).toThrow("مساحة الوحدة");
  });

  it("stores area only in the compact profile, prefers it over legacy area, and clears only recognized legacy area", () => {
    const property = createRentalProperty(state(), propertyValues());
    const unit = property.state.entities.units[0];
    const withLegacy: PrototypeState = {
      ...property.state,
      entities: {
        ...property.state.entities,
        units: property.state.entities.units.map(candidate =>
          candidate.id === unit.id
            ? {
                ...candidate,
                meta: {
                  ...candidate.meta,
                  unitProfile: JSON.stringify({ v: 1, areaM2: 140.5 }),
                  area: 110,
                  untouchedHistoricalKey: "محفوظ",
                },
              }
            : candidate
        ),
      },
    };
    const profiled = withLegacy.entities.units[0];
    expect(unitProfileFormValues(profiled).unitArea).toBe("140.5");

    const cleared = updateDescribedUnit(withLegacy, profiled.id, {
      unitArea: "",
    });
    expect(cleared.result.meta.area).toBeUndefined();
    expect(cleared.result.meta.untouchedHistoricalKey).toBe("محفوظ");
    expect(cleared.result.meta.unitProfile).toBeUndefined();

    const legacyOnly = row({ meta: { area: 145 } });
    expect(unitProfileFormValues(legacyOnly).unitArea).toBe("145");
  });

  it("writes an initial property declaration without contracts or financial side effects, and maps changed fields to only its metadata key", () => {
    const initial = state();
    const created = createRentalProperty(
      initial,
      propertyValues({
        description: "وصف محفوظ",
        monthlyRent: "1200",
        tenancyStatus: "rented",
        tenancyStartDate: "2026-01-01",
        tenancyEndDate: "2026-12-31",
      })
    );
    expect(getTenancyFormValues(created.property)).toEqual({
      tenancyStatus: "rented",
      tenancyStartDate: "2026-01-01",
      tenancyEndDate: "2026-12-31",
    });
    expect(created.state.entities.leases).toEqual([]);
    expect(created.state.entities.receivables).toEqual([]);
    expect(created.state.entities.collections).toEqual([]);
    expect(created.state.entities.units.map(unit => unit.status)).toEqual([
      "متاحة",
      "متاحة",
    ]);

    const updated = updateRentalProperty(created.state, created.property.id, {
      ...propertyValues({
        description: "يجب ألا يكتب",
        monthlyRent: "9999",
        tenancyStatus: "vacant",
        tenancyStartDate: "",
        tenancyEndDate: "",
      }),
      _changedFields:
        '["tenancyStatus","tenancyStartDate","tenancyEndDate"]',
    });
    expect(getTenancyFormValues(updated.property)).toEqual({
      tenancyStatus: "vacant",
      tenancyStartDate: "",
      tenancyEndDate: "",
    });
    expect(updated.property.meta.description).toBe("وصف محفوظ");
    expect(updated.property.meta.unitMonthlyRentMinor).toBe(120_000);
    expect(updated.state.entities.leases).toEqual([]);
    expect(updated.state.entities.receivables).toEqual([]);
  });

  it("creates and deduplicates declared physical units without changing financial state, while whole-property targets reject unit area", () => {
    const property = createRentalProperty(state(), propertyValues());
    const input = {
      requestId: "unit-area-declaration-1",
      title: "وحدة 80 متر",
      unitArea: "80",
      tenancyStatus: "rented",
      tenancyStartDate: "2026-02-01",
      tenancyEndDate: "2026-12-31",
    };
    const created = createDescribedUnit(property.state, property.property.id, input);
    expect(parseUnitProfile(created.result.meta.unitProfile).areaM2).toBe(80);
    expect(getTenancyFormValues(created.result)).toMatchObject({
      tenancyStatus: "rented",
      tenancyStartDate: "2026-02-01",
      tenancyEndDate: "2026-12-31",
    });
    expect(created.state.entities.leases).toEqual([]);
    expect(created.state.entities.receivables).toEqual([]);
    expect(created.state.entities.collections).toEqual([]);
    expect(createDescribedUnit(created.state, property.property.id, input)).toEqual({
      state: created.state,
      result: created.result,
    });

    const whole = createRentalProperty(
      state(),
      propertyValues({ rentalMode: "whole", unitCount: "1" })
    );
    expect(() =>
      updateDescribedUnit(whole.state, whole.state.entities.units[0].id, {
        unitArea: "80",
      })
    ).toThrow("ليس وحدة مادية");
  });

  it("rejects declaration changes once an activated registered lease exists, including historical leases, without resurrecting the declaration", () => {
    const property = createRentalProperty(state(), propertyValues());
    const unit = property.state.entities.units[0];
    const declared = updateDescribedUnit(property.state, unit.id, {
      tenancyStatus: "rented",
      tenancyStartDate: "2024-01-01",
      tenancyEndDate: "2024-12-31",
    });
    const historicalLease = row({
      id: "activated-ended-lease",
      title: "عقد مسجل منتهٍ",
      propertyId: property.property.id,
      portfolioId: property.property.portfolioId,
      status: "منتهٍ",
      date: "2024-01-01",
      meta: {
        unitId: unit.id,
        lifecycleActivated: true,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      },
    });
    const locked: PrototypeState = {
      ...declared.state,
      entities: {
        ...declared.state.entities,
        leases: [historicalLease],
      },
    };
    expect(
      getTenancySummary(
        locked.entities,
        locked.entities.properties[0],
        locked.entities.units[0],
        "2026-10-26"
      ).locked
    ).toBe(true);
    const before = structuredClone(locked);
    expect(() =>
      updateDescribedUnit(locked, unit.id, {
        tenancyStatus: "rented",
        tenancyStartDate: "2026-01-01",
        tenancyEndDate: "2026-12-31",
      })
    ).toThrow("العقد المسجل");
    expect(() =>
      updateRentalProperty(locked, property.property.id, {
        ...propertyValues({
          tenancyStatus: "rented",
          tenancyStartDate: "2026-01-01",
          tenancyEndDate: "2026-12-31",
        }),
        _changedFields:
          '["tenancyStatus","tenancyStartDate","tenancyEndDate"]',
      })
    ).toThrow("العقد المسجل");
    expect(locked).toEqual(before);
  });

  it("preserves role and portfolio scope guards and rejects a new declaration atomically at the 32-key metadata cap", () => {
    const created = createRentalProperty(state(), propertyValues());
    const unit = created.state.entities.units[0];
    expect(() =>
      updateDescribedUnit(
        { ...created.state, settings: { ...created.state.settings, role: "owner" } },
        unit.id,
        { unitArea: "80" }
      )
    ).toThrow("الموظف");
    expect(() =>
      updateDescribedUnit(
        {
          ...created.state,
          settings: { ...created.state.settings, portfolioId: "portfolio-b" },
        },
        unit.id,
        { unitArea: "80" }
      )
    ).toThrow("خارج المحفظة");

    const fullMeta: DemoEntity["meta"] = { ...created.property.meta };
    let index = 0;
    while (Object.keys(fullMeta).length < 32)
      fullMeta[`historical-${index++}`] = "محفوظ";
    const full: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        properties: created.state.entities.properties.map(property =>
          property.id === created.property.id
            ? { ...property, meta: fullMeta }
            : property
        ),
      },
    };
    const before = structuredClone(full);
    expect(() =>
      updateRentalProperty(full, created.property.id, {
        ...propertyValues({
          tenancyStatus: "rented",
          tenancyStartDate: "2026-01-01",
          tenancyEndDate: "2026-12-31",
        }),
        _changedFields:
          '["tenancyStatus","tenancyStartDate","tenancyEndDate"]',
      })
    ).toThrow("32");
    expect(full).toEqual(before);
  });
});
