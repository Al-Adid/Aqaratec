import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  createRentalProperty,
  electricityNumberForRentalTarget,
  importRentalProperties,
  patchUnitMonthlyRent,
  updateRentalProperty,
} from "./prototype-rental";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "portfolio-1",
    title: "محفظة الاختبار",
    subtitle: "",
    portfolioId: "portfolio-1",
    propertyId: "",
    status: "نشط",
    date: "2026-10-24",
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
  entities.portfolios = [entity()];
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

function values(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "فيلا اللؤلؤة",
    portfolioId: "portfolio-1",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    unitCount: "1",
    ...overrides,
  };
}

describe("createRentalProperty", () => {
  it("atomically creates one internal whole-property lease target", () => {
    const initial = state();
    const result = createRentalProperty(
      initial,
      values({
        rentalMode: "whole",
        unitCount: "50",
        propertyNumber: "0007",
        electricityNumber: "00129",
      })
    );

    expect(initial.entities.properties).toHaveLength(0);
    expect(result.state.entities.properties).toHaveLength(1);
    expect(result.property.propertyId).toBe(result.property.id);
    expect(result.property.meta).toMatchObject({
      rentalMode: "whole",
      propertyNumber: "0007",
      electricityNumber: "00129",
    });
    expect(result.state.entities.units).toHaveLength(1);
    expect(result.state.entities.units[0]).toMatchObject({
      title: "العقار بالكامل",
      portfolioId: "portfolio-1",
      propertyId: result.property.id,
      status: "متاحة",
      currency: "QAR",
    });
    expect(result.state.entities.units[0].meta).toMatchObject({
      wholeProperty: true,
      unitCode: "WHOLE",
      electricityNumberSource: "property",
    });
    expect(
      result.state.entities.units[0].meta.electricityNumber
    ).toBeUndefined();
    expect(
      electricityNumberForRentalTarget(
        result.state.entities,
        result.property.id,
        result.state.entities.units[0].id
      )
    ).toBe("00129");
    expect(result.state.audit).toHaveLength(1);
  });

  it("creates the requested numbered unit lease targets for a split property", () => {
    const result = createRentalProperty(
      state(),
      values({ rentalMode: "units", unitCount: "3" })
    );

    expect(result.state.entities.units.map(unit => unit.meta.unitCode)).toEqual(
      ["U-01", "U-02", "U-03"]
    );
    expect(
      result.state.entities.units.every(unit => unit.currency === "QAR")
    ).toBe(true);
    expect(
      result.state.entities.units.every(unit => unit.status === "متاحة")
    ).toBe(true);
  });

  it("stores whole rent on the property and split rent as an uncopied per-unit default", () => {
    const whole = createRentalProperty(
      state(),
      values({ rentalMode: "whole", monthlyRent: "1200.50" })
    );
    expect(whole.property.meta.monthlyRentMinor).toBe(120_050);
    expect(whole.state.entities.units[0].meta.monthlyRentMinor).toBeUndefined();

    const split = createRentalProperty(
      state(),
      values({ rentalMode: "units", unitCount: "3", monthlyRent: "900" })
    );
    expect(split.property.meta.unitMonthlyRentMinor).toBe(90_000);
    expect(
      split.state.entities.units.every(
        unit => unit.meta.monthlyRentMinor === undefined
      )
    ).toBe(true);
  });

  it("preserves an unspecified historical/import mode and its 0-50 unit count", () => {
    const result = createRentalProperty(state(), values({ unitCount: "0" }));

    expect(result.property.meta.rentalMode).toBeUndefined();
    expect(result.state.entities.units).toHaveLength(0);
  });

  it("returns the original atomic result on an identical request retry", () => {
    const first = createRentalProperty(
      state(),
      values({ rentalMode: "whole", requestId: "open-dialog-1" })
    );
    const retry = createRentalProperty(
      first.state,
      values({ rentalMode: "whole", requestId: "open-dialog-1" })
    );

    expect(retry.state).toBe(first.state);
    expect(retry.property).toBe(first.property);
    expect(retry.state.entities.units).toHaveLength(1);
    expect(retry.state.audit).toHaveLength(1);
    expect(() =>
      createRentalProperty(
        first.state,
        values({
          rentalMode: "whole",
          requestId: "open-dialog-1",
          title: "بيانات مختلفة",
        })
      )
    ).toThrow("بيانات مختلفة");
  });

  it("rejects a weakly previewed invalid asset with its spreadsheet row before writes", () => {
    const initial = state();
    expect(() =>
      importRentalProperties(
        initial,
        [values({ assetType: "نوع غير معروف" })],
        "invalid-asset-batch"
      )
    ).toThrow("الصف 1: اختر نوع أصل صالح");
    expect(initial.entities.properties).toHaveLength(0);
    expect(initial.entities.units).toHaveLength(0);
    expect(initial.audit).toHaveLength(0);
  });

  it("does not commit a valid leading row when a later row fails, then retries atomically", () => {
    const initial = state();
    const good = values({
      title: "فيلا كاملة",
      rentalMode: "whole",
      unitCount: "1",
    });
    const invalidSplit = values({
      title: "عمارة غير صالحة",
      assetType: "building",
      rentalMode: "units",
      unitCount: "1",
    });
    expect(() =>
      importRentalProperties(initial, [good, invalidSplit], "batch-retry-1")
    ).toThrow("الصف 2: التقسيم إلى وحدات");
    expect(initial.entities.properties).toHaveLength(0);
    expect(initial.entities.units).toHaveLength(0);
    expect(initial.audit).toHaveLength(0);

    const completed = importRentalProperties(
      initial,
      [good, { ...invalidSplit, unitCount: "2", title: "عمارة مقسمة" }],
      "batch-retry-1"
    );
    expect(completed.properties).toHaveLength(2);
    expect(completed.state.entities.properties).toHaveLength(2);
    expect(completed.state.entities.units).toHaveLength(3);

    const retry = importRentalProperties(
      completed.state,
      [good, { ...invalidSplit, unitCount: "2", title: "عمارة مقسمة" }],
      "batch-retry-1"
    );
    expect(retry.state).toBe(completed.state);
    expect(retry.properties).toEqual(completed.properties);
    expect(retry.state.audit).toHaveLength(2);
  });

  it("updates a whole-property target through an explicit reference without changing issued snapshots or independent meters", () => {
    const created = createRentalProperty(
      state(),
      values({
        rentalMode: "whole",
        propertyNumber: "0007",
        electricityNumber: "00129",
      })
    );
    const inheritedTarget = created.state.entities.units[0];
    const independentUnit = entity({
      id: "independent-meter",
      title: "وحدة مستقلة",
      portfolioId: created.property.portfolioId,
      propertyId: created.property.id,
      meta: { electricityNumberSource: "unit", electricityNumber: "U-0008" },
    });
    const issuedLease = entity({
      id: "issued-00129",
      title: "عقد صادر قديم",
      propertyId: created.property.id,
      meta: { snapshotElectricityNumber: "00129", documentId: "OLD-DOC" },
    });
    const before = {
      ...created.state,
      entities: {
        ...created.state.entities,
        units: [...created.state.entities.units, independentUnit],
        leases: [issuedLease],
      },
    };
    const updated = updateRentalProperty(
      before,
      created.property.id,
      values({
        rentalMode: "whole",
        propertyNumber: "0007",
        electricityNumber: "00999",
      })
    );

    expect(before.entities.properties[0].meta.electricityNumber).toBe("00129");
    expect(updated.property.meta.electricityNumber).toBe("00999");
    expect(updated.state.entities.units[0]).toBe(inheritedTarget);
    expect(
      electricityNumberForRentalTarget(
        updated.state.entities,
        created.property.id,
        inheritedTarget.id
      )
    ).toBe("00999");
    expect(
      electricityNumberForRentalTarget(
        updated.state.entities,
        created.property.id,
        independentUnit.id
      )
    ).toBe("U-0008");
    expect(updated.state.entities.leases[0]).toEqual(issuedLease);
  });

  it("clears submitted optional fields but preserves optional values omitted from the edit payload", () => {
    const created = createRentalProperty(
      state(),
      values({
        rentalMode: "whole",
        propertyNumber: "0007",
        electricityNumber: "00129",
      })
    );
    const omitted = updateRentalProperty(
      created.state,
      created.property.id,
      values({ rentalMode: "whole", propertyNumber: "0007" })
    );
    expect(omitted.property.meta.electricityNumber).toBe("00129");

    const cleared = updateRentalProperty(
      omitted.state,
      created.property.id,
      values({
        rentalMode: "whole",
        propertyNumber: "0007",
        electricityNumber: "",
      })
    );
    expect(cleared.property.meta.electricityNumber).toBeUndefined();
    expect(
      electricityNumberForRentalTarget(
        cleared.state.entities,
        created.property.id,
        cleared.state.entities.units[0].id
      )
    ).toBe("");
  });

  it("saves a property profile as one changed metadata field without changing rent or title", () => {
    const created = createRentalProperty(
      state(),
      values({ rentalMode: "whole", monthlyRent: "1200" })
    );
    const updated = updateRentalProperty(created.state, created.property.id, {
      ...values({
        title: "عنوان لا ينبغي أن يتغير",
        rentalMode: "whole",
        unitCount: "1",
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "sale",
          mortgageStatus: "mortgaged",
        }),
      }),
      _changedFields: '["propertyProfile"]',
    });

    expect(updated.property.title).toBe(created.property.title);
    expect(updated.property.meta.monthlyRentMinor).toBe(120_000);
    expect(JSON.parse(String(updated.property.meta.propertyProfile))).toEqual({
      v: 1,
      purpose: "sale",
      mortgageStatus: "mortgaged",
    });
    expect(updated.state.entities.units).toEqual(created.state.entities.units);
  });

  it("updates and clears a unit rent override without changing amountMinor or the property default", () => {
    const created = createRentalProperty(
      state(),
      values({
        rentalMode: "units",
        unitCount: "2",
        monthlyRent: "900",
      })
    );
    const unit = created.state.entities.units[0];
    const withOverride = patchUnitMonthlyRent(created.state, unit.id, {
      monthlyRent: "١٬٢٣٤٫٥٠",
    });
    expect(withOverride.unit.meta.monthlyRentMinor).toBe(123_450);
    expect(withOverride.unit.amountMinor).toBe(unit.amountMinor);
    expect(
      withOverride.state.entities.properties[0].meta.unitMonthlyRentMinor
    ).toBe(90_000);

    const cleared = patchUnitMonthlyRent(withOverride.state, unit.id, {
      monthlyRent: "",
    });
    expect(cleared.unit.meta.monthlyRentMinor).toBeUndefined();
    expect(cleared.state.entities.properties[0].meta.unitMonthlyRentMinor).toBe(
      90_000
    );
    expect(cleared.state.audit[0].detail).toContain("أزيل override");
  });

  it("rejects zero or invalid unit rent and never lets a read-only role patch it", () => {
    const created = createRentalProperty(
      state(),
      values({ rentalMode: "units", unitCount: "2" })
    );
    const unitId = created.state.entities.units[0].id;
    expect(() =>
      patchUnitMonthlyRent(created.state, unitId, { monthlyRent: "0" })
    ).toThrow("موجب");
    expect(() =>
      patchUnitMonthlyRent(created.state, unitId, { monthlyRent: "12.345" })
    ).toThrow("منزلتين");
    expect(() =>
      patchUnitMonthlyRent(
        {
          ...created.state,
          settings: { ...created.state.settings, role: "owner" },
        },
        unitId,
        { monthlyRent: "900" }
      )
    ).toThrow("الموظف");
  });

  it("uses the declared scenario date for model rows and actual UTC time for audit", () => {
    const initial = state();
    initial.settings.scenarioDate = "2026-10-20";
    const created = createRentalProperty(
      initial,
      values({ rentalMode: "whole", electricityNumber: "٠٠١٢٩" })
    );
    expect(created.property.date).toBe("2026-10-20");
    expect(created.state.entities.units[0].date).toBe("2026-10-20");
    expect(created.state.audit[0].at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(created.property.meta.electricityNumber).toBe("٠٠١٢٩");
  });
});
