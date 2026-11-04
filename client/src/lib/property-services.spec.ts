import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { MAX_PROPERTY_FIELD_LENGTH } from "./property-fields";
import { createRentalProperty, updateRentalProperty } from "./prototype-rental";

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

function state(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-a", title: "المحفظة أ", propertyId: "" }),
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
    },
  };
}

function propertyValues(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "عقار خدمات عامة",
    portfolioId: "portfolio-a",
    assetType: "building",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "whole",
    unitCount: "1",
    ...overrides,
  };
}

describe("property available services domain", () => {
  it.each([
    { rentalMode: "whole", unitCount: "1" },
    { rentalMode: "units", unitCount: "2" },
  ] as const)(
    "stores one trimmed general field for $rentalMode properties without copying it into units",
    mode => {
      const created = createRentalProperty(
        state(),
        propertyValues({
          ...mode,
          availableServices: "  مواقف، حراسة، مسبح، مصعد  ",
        })
      );

      expect(created.property.meta.availableServices).toBe(
        "مواقف، حراسة، مسبح، مصعد"
      );
      expect(
        created.state.entities.units.every(
          unit => unit.meta.availableServices === undefined
        )
      ).toBe(true);
    }
  );

  it("updates, preserves when omitted, and explicitly clears only available services without changing linked records", () => {
    const created = createRentalProperty(
      state(),
      propertyValues({ availableServices: "مواقف، حراسة" })
    );
    const linked: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        leases: [
          row({
            id: "lease-1",
            title: "عقد مرتبط",
            portfolioId: created.property.portfolioId,
            propertyId: created.property.id,
          }),
        ],
        receivables: [
          row({
            id: "receivable-1",
            title: "ذمة مرتبطة",
            portfolioId: created.property.portfolioId,
            propertyId: created.property.id,
          }),
        ],
        collections: [
          row({
            id: "collection-1",
            title: "تحصيل مرتبط",
            portfolioId: created.property.portfolioId,
            propertyId: created.property.id,
          }),
        ],
        expenses: [
          row({
            id: "expense-1",
            title: "مصروف مرتبط",
            portfolioId: created.property.portfolioId,
            propertyId: created.property.id,
          }),
        ],
      },
    };

    const updated = updateRentalProperty(linked, created.property.id, {
      ...propertyValues({ availableServices: "  مواقف، أمن، مصعد  " }),
      _changedFields: '["availableServices"]',
    });
    expect(updated.property.meta.availableServices).toBe("مواقف، أمن، مصعد");
    expect(updated.state.entities.units).toBe(linked.entities.units);
    expect(updated.state.entities.leases).toBe(linked.entities.leases);
    expect(updated.state.entities.receivables).toBe(
      linked.entities.receivables
    );
    expect(updated.state.entities.collections).toBe(
      linked.entities.collections
    );
    expect(updated.state.entities.expenses).toBe(linked.entities.expenses);

    const omitted = updateRentalProperty(updated.state, created.property.id, {
      ...propertyValues(),
      _changedFields: '["title"]',
    });
    expect(omitted.property.meta.availableServices).toBe("مواقف، أمن، مصعد");

    const cleared = updateRentalProperty(omitted.state, created.property.id, {
      ...propertyValues({ availableServices: "   " }),
      _changedFields: '["availableServices"]',
    });
    expect(cleared.property.meta.availableServices).toBeUndefined();
    expect(cleared.state.entities.units).toBe(linked.entities.units);
    expect(cleared.state.entities.leases).toBe(linked.entities.leases);
    expect(cleared.state.entities.receivables).toBe(
      linked.entities.receivables
    );
    expect(cleared.state.entities.collections).toBe(
      linked.entities.collections
    );
    expect(cleared.state.entities.expenses).toBe(linked.entities.expenses);
  });

  it("rejects overlong create and update values before any state change", () => {
    const initial = state();
    const overlong = "خ".repeat(MAX_PROPERTY_FIELD_LENGTH + 1);
    expect(() =>
      createRentalProperty(
        initial,
        propertyValues({ availableServices: overlong })
      )
    ).toThrow("قيمة «availableServices» تتجاوز 1024 حرفًا");
    expect(initial.entities.properties).toHaveLength(0);

    const created = createRentalProperty(state(), propertyValues());
    const before = structuredClone(created.state);
    expect(() =>
      updateRentalProperty(created.state, created.property.id, {
        ...propertyValues({ availableServices: overlong }),
        _changedFields: '["availableServices"]',
      })
    ).toThrow("قيمة «availableServices» تتجاوز 1024 حرفًا");
    expect(created.state).toEqual(before);
  });

  it("fails at metadata capacity atomically without dropping existing property facts", () => {
    const created = createRentalProperty(state(), propertyValues());
    const fullMeta: DemoEntity["meta"] = { ...created.property.meta };
    let index = 0;
    while (Object.keys(fullMeta).length < 32) {
      fullMeta[`legacy-${index++}`] = `قيمة محفوظة ${index}`;
    }
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
        ...propertyValues({ availableServices: "مواقف وحراسة" }),
        _changedFields: '["availableServices"]',
      })
    ).toThrow("سعة 32");
    expect(full).toEqual(before);
  });
});
