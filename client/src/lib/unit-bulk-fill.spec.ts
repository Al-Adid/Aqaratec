import { describe, expect, it } from "vitest";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import { entityEditToken } from "./prototype-edit-concurrency";
import { createRentalProperty } from "./prototype-rental";
import { parseUnitProfile, updateDescribedUnit } from "./unit-profile";
import {
  updateDescribedUnitsBulk,
  type UnitBulkFillRequest,
} from "./unit-bulk-fill";

function complexFixture() {
  const created = createRentalProperty(createDemoState(), {
    title: "مجمع التعبئة الجماعية",
    portfolioId: "family",
    assetType: "villa_complex",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "36",
    propertyNumber: "BULK-36",
    electricityNumber: "METER-BULK-36",
  });
  const units = created.state.entities.units.filter(
    unit => unit.propertyId === created.property.id
  );
  expect(units).toHaveLength(36);
  return { state: created.state, property: created.property, units };
}

function tokens(units: readonly DemoEntity[]): Record<string, string> {
  return Object.fromEntries(units.map(unit => [unit.id, entityEditToken(unit)]));
}

function request(
  propertyId: string,
  units: readonly DemoEntity[],
  overrides: Partial<UnitBulkFillRequest> = {}
): UnitBulkFillRequest {
  return {
    propertyId,
    unitIds: units.map(unit => unit.id),
    values: { description: "وصف جماعي صريح" },
    appliedKeys: ["description"],
    expectedTokens: tokens(units),
    ...overrides,
  };
}

function financialContext(state: PrototypeState) {
  return {
    leases: structuredClone(state.entities.leases),
    receivables: structuredClone(state.entities.receivables),
    collections: structuredClone(state.entities.collections),
    expenses: structuredClone(state.entities.expenses),
  };
}

describe("updateDescribedUnitsBulk", () => {
  it("applies rent, area, furnishing, and description to an exact 36-unit subset without changing financial context or media", () => {
    const { state, property, units } = complexFixture();
    const selected = [units[0]!, units[17]!, units[35]!];
    const photosBefore = units.map(unit => [unit.id, unit.meta.photoGallery]);
    const financeBefore = financialContext(state);

    const outcome = updateDescribedUnitsBulk(
      state,
      request(property.id, selected, {
        values: {
          monthlyRent: "١٬٢٣٤٫٥٠",
          unitArea: "88.25",
          furnishing: "furnished",
          description: "وصف دفعة واحد واضح",
        },
        appliedKeys: [
          "monthlyRent",
          "unitArea",
          "furnishing",
          "description",
        ],
      })
    );

    expect(outcome.result.updates.map(update => update.unitId)).toEqual(
      selected.map(unit => unit.id)
    );
    for (const unit of selected) {
      const saved = outcome.state.entities.units.find(row => row.id === unit.id)!;
      expect(saved.meta.monthlyRentMinor).toBe(123_450);
      expect(saved.meta.description).toBe("وصف دفعة واحد واضح");
      expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
        areaM2: 88.25,
        furnishing: "furnished",
      });
    }
    const untouched = outcome.state.entities.units.find(row => row.id === units[1]!.id)!;
    expect(untouched.meta.monthlyRentMinor).toBeUndefined();
    expect(untouched.meta.description).toBeUndefined();
    expect(financialContext(outcome.state)).toEqual(financeBefore);
    expect(
      outcome.state.entities.units
        .filter(unit => unit.propertyId === property.id)
        .map(unit => [unit.id, unit.meta.photoGallery])
    ).toEqual(photosBefore);
  });

  it("keeps select-all exact: all 36 IDs are returned once and no property or serial fields change", () => {
    const { state, property, units } = complexFixture();
    const beforeIdentity = units.map(unit => ({
      id: unit.id,
      title: unit.title,
      code: unit.meta.unitCode,
      propertyId: unit.propertyId,
      portfolioId: unit.portfolioId,
    }));

    const outcome = updateDescribedUnitsBulk(
      state,
      request(property.id, units, {
        values: { electricityNumber: "METER-BULK-OVERRIDE" },
        appliedKeys: ["electricityNumber"],
      })
    );

    expect(outcome.result.updates).toHaveLength(36);
    expect(new Set(outcome.result.updates.map(update => update.unitId)).size).toBe(36);
    expect(
      outcome.state.entities.units
        .filter(unit => unit.propertyId === property.id)
        .map(unit => ({
          id: unit.id,
          title: unit.title,
          code: unit.meta.unitCode,
          propertyId: unit.propertyId,
          portfolioId: unit.portfolioId,
        }))
    ).toEqual(beforeIdentity);
  });

  it("does not silently clear: an empty selected field needs its own clear checkbox", () => {
    const { state, property, units } = complexFixture();
    const before = structuredClone(state);
    expect(() =>
      updateDescribedUnitsBulk(
        state,
        request(property.id, [units[0]!], {
          values: { description: "" },
          appliedKeys: ["description"],
        })
      )
    ).toThrow("القيمة الفارغة لا تُمسح تلقائيًا");
    expect(state).toEqual(before);

    const cleared = updateDescribedUnitsBulk(
      state,
      request(property.id, [units[0]!], {
        values: { description: "" },
        appliedKeys: ["description"],
        clearKeys: ["description"],
      })
    );
    expect(cleared.result.updates[0]?.appliedKeys).toEqual(["description"]);
  });

  it("rejects duplicate IDs, a foreign property unit, read-only role, zero rent, stale member, and a 32-meta member without a partial state", () => {
    const { state, property, units } = complexFixture();
    const another = createRentalProperty(state, {
      title: "عقار نطاق آخر",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
    });
    const foreign = another.state.entities.units.find(
      unit => unit.propertyId === another.property.id
    )!;

    const cases: Array<{ label: string; state: PrototypeState; input: UnitBulkFillRequest; match: string }> = [
      {
        label: "duplicated",
        state,
        input: request(property.id, [units[0]!, units[0]!]),
        match: "أكثر من مرة",
      },
      {
        label: "foreign",
        state: another.state,
        input: request(property.id, [units[0]!, foreign]),
        match: "العقار والمحفظة نفسيهما",
      },
      {
        label: "readonly",
        state: { ...state, settings: { ...state.settings, role: "owner" } },
        input: request(property.id, [units[0]!]),
        match: "الموظف",
      },
      {
        label: "zero rent",
        state,
        input: request(property.id, [units[0]!], {
          values: { monthlyRent: "0" },
          appliedKeys: ["monthlyRent"],
        }),
        match: "إيجار الوحدة الشهري",
      },
      {
        label: "stale final member",
        state,
        input: request(property.id, [units[0]!, units[1]!], {
          expectedTokens: {
            [units[0]!.id]: entityEditToken(units[0]!),
            [units[1]!.id]: "edit-stale",
          },
        }),
        match: "تعارض تعديل",
      },
    ];

    const saturatedUnit = {
      ...units[1]!,
      meta: Object.fromEntries(
        Array.from({ length: 32 }, (_, index) => [`preserved-${index}`, "x"])
      ),
    };
    const saturatedState: PrototypeState = {
      ...state,
      entities: {
        ...state.entities,
        units: state.entities.units.map(unit =>
          unit.id === saturatedUnit.id ? saturatedUnit : unit
        ),
      },
    };
    cases.push({
      label: "metadata cap",
      state: saturatedState,
      input: request(property.id, [units[0]!, saturatedUnit], {
        expectedTokens: tokens([units[0]!, saturatedUnit]),
      }),
      match: "سعة 32 حقل",
    });

    for (const testCase of cases) {
      const before = structuredClone(testCase.state);
      expect(() => updateDescribedUnitsBulk(testCase.state, testCase.input), testCase.label).toThrow(testCase.match);
      expect(testCase.state, testCase.label).toEqual(before);
    }
  });

  it("rejects the hidden whole-property rental target and setting asking rent on an effective sale unit until rent is selected", () => {
    const whole = createRentalProperty(createDemoState(), {
      title: "تأجير كامل",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "whole",
      monthlyRent: "2400",
    });
    const wholeTarget = whole.state.entities.units.find(
      unit => unit.propertyId === whole.property.id
    )!;
    const wholeBefore = structuredClone(whole.state);
    expect(() =>
      updateDescribedUnitsBulk(
        whole.state,
        request(whole.property.id, [wholeTarget], {
          values: { description: "لا يطبق" },
        })
      )
    ).toThrow("العقار بالكامل الداخلي");
    expect(whole.state).toEqual(wholeBefore);

    const { state, property, units } = complexFixture();
    const saleState: PrototypeState = {
      ...state,
      entities: {
        ...state.entities,
        properties: state.entities.properties.map(row =>
          row.id === property.id
            ? { ...row, meta: { ...row.meta, propertyProfile: JSON.stringify({ v: 1, purpose: "sale" }) } }
            : row
        ),
      },
    };
    expect(() =>
      updateDescribedUnitsBulk(
        saleState,
        request(property.id, [units[0]!], {
          values: { monthlyRent: "2500" },
          appliedKeys: ["monthlyRent"],
        })
      )
    ).toThrow("هدفها الفعّال بيع");

    const rented = updateDescribedUnitsBulk(
      saleState,
      request(property.id, [units[0]!], {
        values: { unitPurpose: "rent", monthlyRent: "2500" },
        appliedKeys: ["unitPurpose", "monthlyRent"],
      })
    );
    expect(rented.result.updates[0]?.after.meta.monthlyRentMinor).toBe(250_000);
  });

  it("keeps lease, receivable, collection and expense records byte-for-byte identical after each successful update", () => {
    const { state, property, units } = complexFixture();
    const seeded = updateDescribedUnit(state, units[0]!.id, {
      category: "office",
      monthlyRent: "900",
    }).state;
    const before = financialContext(seeded);
    const currentUnits = seeded.entities.units.filter(unit => unit.propertyId === property.id);

    const outcome = updateDescribedUnitsBulk(
      seeded,
      request(property.id, currentUnits.slice(0, 2), {
        values: { description: "سجل وصفي فقط" },
      })
    );
    expect(financialContext(outcome.state)).toEqual(before);
  });
});
