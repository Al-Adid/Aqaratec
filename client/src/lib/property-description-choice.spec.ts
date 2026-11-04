import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  MAX_PROPERTY_FIELD_LENGTH,
  PROPERTY_UNIT_COMPOSITION_OPTIONS,
  makePropertyProfile,
  parsePropertyProfile,
  propertyUnitCompositionLabel,
  serializePropertyProfile,
} from "./property-fields";
import {
  createRentalProperty,
  updateRentalProperty,
} from "./prototype-rental";

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
    title: "عقار وصف الوحدات",
    portfolioId: "portfolio-a",
    assetType: "building",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "2",
    ...overrides,
  };
}

describe("property description choice domain", () => {
  it.each(PROPERTY_UNIT_COMPOSITION_OPTIONS)(
    "round-trips $label through pure create and update transitions",
    ({ value, label }) => {
      const created = createRentalProperty(
        state(),
        propertyValues({ unitComposition: value })
      );
      expect(
        parsePropertyProfile(created.property.meta.propertyProfile)
      ).toMatchObject({ v: 1, unitComposition: value });
      expect(propertyUnitCompositionLabel(value)).toBe(label);

      const updated = updateRentalProperty(created.state, created.property.id, {
        ...propertyValues({
          propertyProfile: serializePropertyProfile({
            v: 1,
            purpose: "rent",
            contents: "مواصفات تبقى مستقلة",
            unitComposition: value,
          }),
        }),
        _changedFields: '["propertyProfile"]',
      });
      expect(parsePropertyProfile(updated.property.meta.propertyProfile)).toEqual({
        v: 1,
        purpose: "rent",
        contents: "مواصفات تبقى مستقلة",
        unitComposition: value,
      });
    }
  );

  it("preserves an omitted choice and removes only an explicitly blank choice without touching text", () => {
    const created = createRentalProperty(
      state(),
      propertyValues({
        description: "وصف نصي مستقل محفوظ",
        propertyProfile: serializePropertyProfile({
          v: 1,
          purpose: "sale",
          mortgageStatus: "mortgaged",
          mortgageBank: "بنك الرهن",
          salePriceMinor: 950_000_000,
          contents: "مواصفات ومرافق محفوظة",
          unitComposition: "villas",
        }),
      })
    );

    const omitted = updateRentalProperty(created.state, created.property.id, {
      ...propertyValues(),
      _changedFields: '["description"]',
    });
    expect(parsePropertyProfile(omitted.property.meta.propertyProfile)).toEqual(
      parsePropertyProfile(created.property.meta.propertyProfile)
    );
    expect(omitted.property.meta.description).toBe("وصف نصي مستقل محفوظ");

    const cleared = updateRentalProperty(omitted.state, omitted.property.id, {
      ...propertyValues({
        propertyPurpose: "sale",
        mortgageStatus: "mortgaged",
        mortgageBank: "بنك الرهن",
        salePrice: "9500000",
        contents: "مواصفات ومرافق محفوظة",
        unitComposition: "",
      }),
      _changedFields: '["propertyProfile"]',
    });
    expect(parsePropertyProfile(cleared.property.meta.propertyProfile)).toEqual({
      v: 1,
      purpose: "sale",
      mortgageStatus: "mortgaged",
      mortgageBank: "بنك الرهن",
      salePriceMinor: 950_000_000,
      contents: "مواصفات ومرافق محفوظة",
    });
    expect(cleared.property.meta.description).toBe("وصف نصي مستقل محفوظ");
  });

  it("accepts legacy v1 keys unchanged and rejects unknown or non-text composition values atomically", () => {
    expect(parsePropertyProfile('{"v":1,"purpose":"rent"}')).toEqual({
      v: 1,
      purpose: "rent",
    });
    expect(propertyUnitCompositionLabel("unknown")).toBe("غيرمحدد");
    expect(() =>
      parsePropertyProfile('{"v":1,"unitComposition":"unknown"}')
    ).toThrow("بيانات هدف العقار");
    expect(() => parsePropertyProfile('{"v":1,"unitComposition":1}')).toThrow(
      "بيانات هدف العقار"
    );

    const created = createRentalProperty(state(), propertyValues());
    const before = structuredClone(created.state);
    expect(() =>
      updateRentalProperty(created.state, created.property.id, {
        ...propertyValues({
          propertyProfile: '{"v":1,"unitComposition":"unknown"}',
        }),
        _changedFields: '["propertyProfile"]',
      })
    ).toThrow("بيانات هدف العقار");
    expect(created.state).toEqual(before);
  });

  it("retains the 1024-character profile cap and rejects a new profile at the 32-key metadata cap without mutation", () => {
    expect(() => parsePropertyProfile("x".repeat(MAX_PROPERTY_FIELD_LENGTH + 1))).toThrow(
      "بيانات هدف العقار"
    );
    expect(makePropertyProfile({ unitComposition: "apartments" })).toEqual({
      v: 1,
      unitComposition: "apartments",
    });

    const created = createRentalProperty(state(), propertyValues());
    const meta: DemoEntity["meta"] = { ...created.property.meta };
    let index = 0;
    while (Object.keys(meta).length < 32) meta[`legacy-${index++}`] = "محفوظ";
    const full: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        properties: created.state.entities.properties.map(property =>
          property.id === created.property.id ? { ...property, meta } : property
        ),
      },
    };
    const before = structuredClone(full);

    expect(() =>
      updateRentalProperty(full, created.property.id, {
        ...propertyValues({ unitComposition: "coded_units" }),
        _changedFields: '["propertyProfile"]',
      })
    ).toThrow("32");
    expect(full).toEqual(before);
  });
});
