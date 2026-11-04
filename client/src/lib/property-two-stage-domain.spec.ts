import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  makePropertyProfile,
  parsePropertyProfile,
  parseSalePriceMinor,
  serializePropertyProfile,
} from "./property-fields";
import {
  propertyNumberForRentalTarget,
  createRentalProperty,
  updateRentalProperty,
} from "./prototype-rental";
import {
  parseUnitProfile,
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
  overrides: Partial<PrototypeState["settings"]> = {}
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
      ...overrides,
    },
  };
}

function propertyValues(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "فيلا المرحلة الثانية",
    portfolioId: "portfolio-a",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "whole",
    unitCount: "1",
    propertyNumber: "00042",
    ...overrides,
  };
}

describe("two-stage property domain", () => {
  it("requires a mortgage bank only for an active new mortgage and drops it otherwise", () => {
    expect(() =>
      makePropertyProfile({
        propertyPurpose: "rent",
        mortgageStatus: "mortgaged",
      })
    ).toThrow("بنك الرهن مطلوب");

    expect(
      makePropertyProfile({
        propertyPurpose: "rent",
        mortgageStatus: "free",
        mortgageBank: "بنك حساب التحصيل لا يدخل هنا",
      })
    ).toEqual({ v: 1, purpose: "rent", mortgageStatus: "free" });
    expect(makePropertyProfile({ mortgageBank: "بنك متروك" })).toEqual({
      v: 1,
    });
  });

  it("stores Arabic requested sale prices in exact cents and keeps profile parsing compatible", () => {
    const profile = makePropertyProfile({
      propertyPurpose: "sale",
      mortgageStatus: "mortgaged",
      mortgageBank: "بنك الرهن التجريبي",
      salePrice: "١٬٢٣٤٬٥٦٧٫٨٩",
    });
    expect(profile).toEqual({
      v: 1,
      purpose: "sale",
      mortgageStatus: "mortgaged",
      mortgageBank: "بنك الرهن التجريبي",
      salePriceMinor: 123_456_789,
    });
    expect(parseSalePriceMinor("٩٩٩٫٠١")).toBe(99_901);
    expect(parsePropertyProfile(serializePropertyProfile(profile))).toEqual(
      profile
    );
    expect(
      parsePropertyProfile(
        '{"v":1,"purpose":"sale","mortgageStatus":"mortgaged"}'
      )
    ).toEqual({ v: 1, purpose: "sale", mortgageStatus: "mortgaged" });
  });

  it("rejects invalid profile types, unknown keys, invalid money, and profile-cap violations", () => {
    expect(() =>
      parsePropertyProfile(
        JSON.stringify({ v: 1, mortgageBank: "ب".repeat(161) })
      )
    ).toThrow();
    expect(() =>
      parsePropertyProfile('{"v":1,"salePriceMinor":1.5}')
    ).toThrow();
    expect(() => parsePropertyProfile('{"v":1,"salePriceMinor":0}')).toThrow();
    expect(() => parsePropertyProfile('{"v":1,"loan":"x"}')).toThrow();
    expect(() => parsePropertyProfile("x".repeat(1025))).toThrow();
    expect(() =>
      makePropertyProfile({ propertyPurpose: "sale", salePrice: "١٫٢٣٤" })
    ).toThrow("منزلتين");
    expect(() =>
      makePropertyProfile({ propertyPurpose: "sale", salePrice: "٠" })
    ).toThrow("موجب");
  });

  it("ignores a sale caller's rental input and preserves a historical rent during a sale profile update", () => {
    const saleProfile = serializePropertyProfile(
      makePropertyProfile({
        propertyPurpose: "sale",
        salePrice: "٢٬٥٠٠٬٠٠٠",
      })
    );
    const saleCreated = createRentalProperty(
      state(),
      propertyValues({ propertyProfile: saleProfile, monthlyRent: "9999" })
    );
    expect(saleCreated.property.meta.monthlyRentMinor).toBeUndefined();
    expect(saleCreated.property.amountMinor).toBe(0);
    expect(saleCreated.state.entities.leases).toEqual([]);

    const rented = createRentalProperty(
      state(),
      propertyValues({ monthlyRent: "١٬٢٠٠٫٥٠" })
    );
    const lease = row({
      id: "lease-historical",
      propertyId: rented.property.id,
      meta: { unitId: rented.state.entities.units[0].id },
    });
    const receivable = row({
      id: "receivable-historical",
      propertyId: rented.property.id,
      amountMinor: 120_050,
    });
    const collection = row({
      id: "collection-historical",
      propertyId: rented.property.id,
      amountMinor: 50_000,
    });
    const expense = row({
      id: "expense-historical",
      propertyId: rented.property.id,
      amountMinor: 12_500,
    });
    const before: PrototypeState = {
      ...rented.state,
      entities: {
        ...rented.state.entities,
        leases: [lease],
        receivables: [receivable],
        collections: [collection],
        expenses: [expense],
      },
    };

    const changed = updateRentalProperty(before, rented.property.id, {
      ...propertyValues({
        propertyProfile: saleProfile,
        // A hidden/empty rent field from a raw import must not delete history.
        monthlyRent: "",
      }),
      _changedFields: '["propertyProfile","monthlyRent"]',
    });

    expect(changed.property.meta.monthlyRentMinor).toBe(120_050);
    expect(
      parsePropertyProfile(changed.property.meta.propertyProfile)
    ).toMatchObject({
      purpose: "sale",
      salePriceMinor: 250_000_000,
    });
    expect(changed.property.amountMinor).toBe(rented.property.amountMinor);
    expect(changed.state.entities.leases).toEqual([lease]);
    expect(changed.state.entities.receivables).toEqual([receivable]);
    expect(changed.state.entities.collections).toEqual([collection]);
    expect(changed.state.entities.expenses).toEqual([expense]);

    const rawRentAttempt = updateRentalProperty(
      changed.state,
      rented.property.id,
      {
        ...propertyValues({ monthlyRent: "9999" }),
        _changedFields: '["monthlyRent"]',
      }
    );
    expect(rawRentAttempt.property.meta.monthlyRentMinor).toBe(120_050);
    expect(rawRentAttempt.property.amountMinor).toBe(
      rented.property.amountMinor
    );
    expect(rawRentAttempt.state.entities.leases).toEqual([lease]);
    expect(rawRentAttempt.state.entities.receivables).toEqual([receivable]);
    expect(rawRentAttempt.state.entities.collections).toEqual([collection]);
    expect(rawRentAttempt.state.entities.expenses).toEqual([expense]);
  });

  it("rejects adding an independent description at 32 metadata keys without discarding it or changing legacy notes", () => {
    const created = createRentalProperty(state(), propertyValues());
    const meta: DemoEntity["meta"] = {
      ...created.property.meta,
      notes: "ملاحظة تشغيلية مستقلة",
    };
    delete meta.description;
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
        ...propertyValues(),
        description: "وصف جديد يجب ألا يضيع",
        _changedFields: '["description"]',
      })
    ).toThrow("32");
    expect(full).toEqual(before);
    expect(full.entities.properties[0].meta.notes).toBe(
      "ملاحظة تشغيلية مستقلة"
    );
    expect(full.entities.properties[0].meta.description).toBeUndefined();
  });

  it("keeps a hidden asking sale price on a rent update but allows an explicit clear when sale is active", () => {
    const created = createRentalProperty(
      state(),
      propertyValues({
        propertyProfile: serializePropertyProfile(
          makePropertyProfile({ propertyPurpose: "sale", salePrice: "650000" })
        ),
      })
    );
    const rent = updateRentalProperty(created.state, created.property.id, {
      ...propertyValues({
        propertyProfile: serializePropertyProfile(
          makePropertyProfile({ propertyPurpose: "rent" })
        ),
        monthlyRent: "3500",
      }),
      _changedFields: '["propertyProfile","monthlyRent"]',
    });
    expect(
      parsePropertyProfile(rent.property.meta.propertyProfile)
    ).toMatchObject({
      purpose: "rent",
      salePriceMinor: parseSalePriceMinor("650000"),
    });
    expect(rent.property.meta.monthlyRentMinor).toBe(
      parseSalePriceMinor("3500")
    );
    expect(rent.state.entities.units).toEqual(created.state.entities.units);
    const clear = updateRentalProperty(rent.state, rent.property.id, {
      ...propertyValues({
        propertyProfile: serializePropertyProfile(
          makePropertyProfile({ propertyPurpose: "sale", salePrice: "" })
        ),
      }),
      _changedFields: '["propertyProfile"]',
    });
    expect(parsePropertyProfile(clear.property.meta.propertyProfile)).toEqual({
      v: 1,
      purpose: "sale",
    });
    expect(clear.property.meta.monthlyRentMinor).toBe(
      rent.property.meta.monthlyRentMinor
    );
    expect(clear.state.entities.leases).toEqual(created.state.entities.leases);
    expect(clear.state.entities.receivables).toEqual(
      created.state.entities.receivables
    );
    expect(clear.state.entities.collections).toEqual(
      created.state.entities.collections
    );
  });

  it("preserves leading-zero unit property numbers, inherits the parent, and rejects wrong parents", () => {
    const created = createRentalProperty(state(), propertyValues());
    const unit = created.state.entities.units[0];
    expect(
      propertyNumberForRentalTarget(
        created.state.entities,
        created.property.id,
        unit.id
      )
    ).toBe("00042");

    const withOverride = updateDescribedUnit(created.state, unit.id, {
      propertyNumber: "00007",
      planNumber: "00090",
    });
    expect(parseUnitProfile(withOverride.result.meta.unitProfile)).toEqual({
      v: 1,
      propertyNumber: "00007",
      planNumber: "00090",
    });
    expect(unitProfileFormValues(withOverride.result).propertyNumber).toBe(
      "00007"
    );
    expect(
      propertyNumberForRentalTarget(
        withOverride.state.entities,
        created.property.id,
        unit.id
      )
    ).toBe("00007");

    const inherited = updateDescribedUnit(withOverride.state, unit.id, {
      propertyNumber: "",
    });
    expect(parseUnitProfile(inherited.result.meta.unitProfile).planNumber).toBe(
      "00090"
    );
    expect(
      propertyNumberForRentalTarget(
        inherited.state.entities,
        created.property.id,
        unit.id
      )
    ).toBe("00042");

    const foreignUnit = row({
      id: "foreign-unit",
      propertyId: "another-property",
      meta: { unitProfile: '{"v":1,"propertyNumber":"00099"}' },
    });
    expect(
      propertyNumberForRentalTarget(
        {
          ...inherited.state.entities,
          units: [...inherited.state.entities.units, foreignUnit],
        },
        created.property.id,
        foreignUnit.id
      )
    ).toBe("00042");
  });

  it("blocks owner and out-of-scope property create or update requests before mutation", () => {
    expect(() =>
      createRentalProperty(
        state({ role: "owner" }),
        propertyValues({ monthlyRent: "1000" })
      )
    ).toThrow("الموظف");
    expect(() =>
      createRentalProperty(
        state({ portfolioId: "portfolio-b" }),
        propertyValues({ monthlyRent: "1000" })
      )
    ).toThrow("خارج نطاق");

    const created = createRentalProperty(
      state(),
      propertyValues({ monthlyRent: "1000" })
    );
    const wrongScope: PrototypeState = {
      ...created.state,
      settings: { ...created.state.settings, portfolioId: "portfolio-b" },
    };
    expect(() =>
      updateRentalProperty(
        wrongScope,
        created.property.id,
        propertyValues({ monthlyRent: "1500" })
      )
    ).toThrow("خارج المحفظة");
    expect(created.property.meta.monthlyRentMinor).toBe(100_000);
  });
});
