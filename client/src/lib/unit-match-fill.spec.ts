import { describe, expect, it } from "vitest";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import { entityEditToken } from "./prototype-edit-concurrency";
import { createRentalProperty } from "./prototype-rental";
import { parseUnitProfile, updateDescribedUnit } from "./unit-profile";
import {
  previewMatchedUnits,
  updateMatchedUnits,
  type UnitMatchRequest,
} from "./unit-match-fill";

function fixture(unitCount = "36") {
  const created = createRentalProperty(createDemoState(), {
    title: "مجمع الوحدات المتشابهة",
    portfolioId: "family",
    assetType: "building",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount,
    propertyNumber: "MATCH-36",
    electricityNumber: "PROPERTY-METER",
  });
  const units = created.state.entities.units.filter(
    unit => unit.propertyId === created.property.id
  );
  expect(units).toHaveLength(Number(unitCount));
  return { state: created.state, property: created.property, units };
}

function tokens(units: readonly DemoEntity[]): Record<string, string> {
  return Object.fromEntries(units.map(unit => [unit.id, entityEditToken(unit)]));
}

function request(
  propertyId: string,
  source: DemoEntity,
  targets: readonly DemoEntity[],
  sourceChanges: Record<string, string>,
  overrides: Partial<UnitMatchRequest> = {}
): UnitMatchRequest {
  return {
    propertyId,
    sourceUnitId: source.id,
    sourceChanges,
    sourceToken: entityEditToken(source),
    unitIds: targets.map(unit => unit.id),
    expectedTokens: tokens(targets),
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

function activeLease(unit: DemoEntity): DemoEntity {
  return {
    ...unit,
    id: `lease-${unit.id}`,
    title: `عقد ${unit.title}`,
    status: "نافذ",
    meta: {
      lifecycleActivated: true,
      unitId: unit.id,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rentMinor: 555_000,
    },
  };
}

describe("updateMatchedUnits", () => {
  it("first saves an unsaved source then copies only canonical common values to an exact 36-unit selection", () => {
    const { state, property, units } = fixture();
    const meteredState: PrototypeState = {
      ...state,
      entities: {
        ...state.entities,
        units: state.entities.units.map((unit, index) => ({
          ...unit,
          meta: {
            ...unit.meta,
            electricityNumber: `UNIT-METER-${index + 1}`,
            electricityNumberSource: "unit",
          },
        })),
      },
    };
    const meteredUnits = meteredState.entities.units.filter(
      unit => unit.propertyId === property.id
    );
    const source = meteredUnits[0]!;
    const selected = [meteredUnits[1]!, meteredUnits[17]!, meteredUnits[35]!];
    const excluded = meteredUnits[2]!;
    const identities = meteredState.entities.units.map(unit => ({
      id: unit.id,
      title: unit.title,
      propertyId: unit.propertyId,
      portfolioId: unit.portfolioId,
      code: unit.meta.unitCode,
      electricityNumber: unit.meta.electricityNumber,
    }));
    expect(new Set(identities.map(unit => unit.electricityNumber)).size).toBe(
      identities.length
    );
    const financeBefore = financialContext(meteredState);

    const outcome = updateMatchedUnits(
      meteredState,
      request(property.id, source, selected, {
        category: "apartment",
        apartmentLayout: "studio",
        bedrooms: "0",
        livingRooms: "0",
        bathrooms: "0",
        kitchens: "0",
        furnishing: "furnished",
        contents: "أثاث جديد",
        description: "وصف المصدر المحفوظ أولًا",
        unitArea: "88.25",
        unitPurpose: "rent",
        monthlyRent: "١٬٢٣٤٫٥٠",
      })
    );

    expect(previewMatchedUnits).toBe(updateMatchedUnits);
    expect(outcome.result.source.id).toBe(source.id);
    expect(outcome.result.updates.map(update => update.unitId)).toEqual(
      selected.map(unit => unit.id)
    );
    for (const selectedUnit of selected) {
      const saved = outcome.state.entities.units.find(
        row => row.id === selectedUnit.id
      )!;
      expect(saved.meta.monthlyRentMinor).toBe(123_450);
      expect(saved.meta.description).toBe("وصف المصدر المحفوظ أولًا");
      expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
        category: "apartment",
        apartmentLayout: "studio",
        roomLayout: "studio",
        bedrooms: 0,
        livingRooms: 0,
        bathrooms: 0,
        kitchens: 0,
        furnishing: "furnished",
        contents: "أثاث جديد",
        areaM2: 88.25,
        purpose: "rent",
      });
    }
    expect(
      outcome.state.entities.units.find(row => row.id === excluded.id)
    ).toEqual(excluded);
    expect(
      outcome.state.entities.units.map(unit => ({
        id: unit.id,
        title: unit.title,
        propertyId: unit.propertyId,
        portfolioId: unit.portfolioId,
        code: unit.meta.unitCode,
        electricityNumber: unit.meta.electricityNumber,
      }))
    ).toEqual(identities);
    expect(
      new Set(
        outcome.state.entities.units.map(unit => unit.meta.electricityNumber)
      ).size
    ).toBe(identities.length);
    expect(financialContext(outcome.state)).toEqual(financeBefore);
  });

  it("does not treat blank source fields as clears, but exposes the explicit incompatible subtype clear", () => {
    const { state, property, units } = fixture("3");
    const seededSource = updateDescribedUnit(state, units[0]!.id, {
      category: "apartment",
      apartmentLayout: "studio",
      bedrooms: "0",
      livingRooms: "0",
      description: "وصف مشترك",
    }).state;
    const seededTarget = updateDescribedUnit(seededSource, units[1]!.id, {
      category: "villa",
      villaArrangement: "detached",
      furnishing: "furnished",
      contents: "يبقى المحتوى",
    }).state;
    const source = seededTarget.entities.units.find(row => row.id === units[0]!.id)!;
    const target = seededTarget.entities.units.find(row => row.id === units[1]!.id)!;

    const outcome = updateMatchedUnits(
      seededTarget,
      request(property.id, source, [target], { description: "وصف أحدث" })
    );
    const copied = outcome.result.updates[0]!;
    const profile = parseUnitProfile(copied.after.meta.unitProfile);
    expect(copied.appliedKeys).toContain("villaArrangement");
    expect(profile).toMatchObject({
      category: "apartment",
      apartmentLayout: "studio",
      roomLayout: "studio",
      bedrooms: 0,
      livingRooms: 0,
      furnishing: "furnished",
      contents: "يبقى المحتوى",
    });
    expect(profile.villaArrangement).toBeUndefined();
  });

  it("copies only the active asking price, retaining the inactive target price", () => {
    const { state, property, units } = fixture("4");
    const saleSourceState = updateDescribedUnit(state, units[0]!.id, {
      unitPurpose: "sale",
      salePrice: "500000",
      monthlyRent: "999",
    }).state;
    const saleTargetState = updateDescribedUnit(saleSourceState, units[1]!.id, {
      monthlyRent: "1111",
      salePrice: "222222",
    }).state;
    const saleSource = saleTargetState.entities.units.find(row => row.id === units[0]!.id)!;
    const saleTarget = saleTargetState.entities.units.find(row => row.id === units[1]!.id)!;
    const saleOutcome = updateMatchedUnits(
      saleTargetState,
      request(property.id, saleSource, [saleTarget], { description: "سعر بيع فقط" })
    );
    const saleCopied = saleOutcome.result.updates[0]!.after;
    expect(parseUnitProfile(saleCopied.meta.unitProfile).salePriceMinor).toBe(50_000_000);
    expect(saleCopied.meta.monthlyRentMinor).toBe(111_100);

    const rentSource = saleOutcome.state.entities.units.find(row => row.id === units[0]!.id)!;
    const rentTarget = saleOutcome.state.entities.units.find(row => row.id === units[2]!.id)!;
    const rentSeeded = updateDescribedUnit(saleOutcome.state, rentTarget.id, {
      salePrice: "777777",
    }).state;
    const currentRentSource = rentSeeded.entities.units.find(row => row.id === rentSource.id)!;
    const currentRentTarget = rentSeeded.entities.units.find(row => row.id === rentTarget.id)!;
    const rentOutcome = updateMatchedUnits(
      rentSeeded,
      request(property.id, currentRentSource, [currentRentTarget], {
        unitPurpose: "rent",
        monthlyRent: "2222",
      })
    );
    const rentCopied = rentOutcome.result.updates[0]!.after;
    expect(rentCopied.meta.monthlyRentMinor).toBe(222_200);
    expect(parseUnitProfile(rentCopied.meta.unitProfile).salePriceMinor).toBe(77_777_700);
  });

  it("copies a complete unlocked initial declaration but never overwrites a registered lease target", () => {
    const { state, property, units } = fixture("3");
    const source = units[0]!;
    const unlocked = units[1]!;
    const locked = units[2]!;
    const stateWithLease: PrototypeState = {
      ...state,
      entities: { ...state.entities, leases: [activeLease(locked)] },
    };
    const beforeLeases = structuredClone(stateWithLease.entities.leases);

    const outcome = updateMatchedUnits(
      stateWithLease,
      request(property.id, source, [unlocked, locked], {
        description: "ينسخ الوصف حتى للوحدة المؤجرة بعقد",
        tenancyStatus: "rented",
        tenancyStartDate: "2026-02-01",
        tenancyEndDate: "2026-12-31",
        tenancyMonthlyRent: "3210",
      })
    );
    const savedUnlocked = outcome.result.updates.find(
      update => update.unitId === unlocked.id
    )!.after;
    const savedLocked = outcome.result.updates.find(
      update => update.unitId === locked.id
    )!.after;
    expect(savedUnlocked.meta.tenancyDeclaration).toBe(
      '{"v":1,"status":"rented","startDate":"2026-02-01","endDate":"2026-12-31","monthlyRentMinor":321000}'
    );
    expect(savedLocked.meta.tenancyDeclaration).toBeUndefined();
    expect(savedLocked.meta.description).toBe(
      "ينسخ الوصف حتى للوحدة المؤجرة بعقد"
    );
    expect(outcome.state.entities.leases).toEqual(beforeLeases);
  });

  it("does not return a partial state for stale, wrong-scope, owner, whole-target, or over-limit requests", () => {
    const { state, property, units } = fixture("3");
    const other = createRentalProperty(state, {
      title: "عقار نطاق آخر",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
    });
    const source = units[0]!;
    const lastTarget = units[2]!;
    const wholeTarget: DemoEntity = {
      ...units[1]!,
      id: "whole-target",
      meta: { ...units[1]!.meta, wholeProperty: true },
    };
    const wholeState: PrototypeState = {
      ...state,
      entities: { ...state.entities, units: [...state.entities.units, wholeTarget] },
    };
    const foreignTarget = other.state.entities.units.find(
      unit => unit.propertyId === other.property.id
    )!;

    const cases: Array<{
      label: string;
      state: PrototypeState;
      input: UnitMatchRequest;
      message: string;
    }> = [
      {
        label: "stale source",
        state,
        input: request(property.id, source, [units[1]!], { description: "x" }, { sourceToken: "edit-stale" }),
        message: "الوحدة المصدر",
      },
      {
        label: "stale last target",
        state,
        input: request(property.id, source, [units[1]!, lastTarget], { description: "x" }, {
          expectedTokens: {
            [units[1]!.id]: entityEditToken(units[1]!),
            [lastTarget.id]: "edit-stale",
          },
        }),
        message: "تعارض تعديل",
      },
      {
        label: "wrong scope",
        state: other.state,
        input: request(property.id, source, [foreignTarget], { description: "x" }),
        message: "العقار والمحفظة نفسيهما",
      },
      {
        label: "owner",
        state: { ...state, settings: { ...state.settings, role: "owner" } },
        input: request(property.id, source, [units[1]!], { description: "x" }),
        message: "الموظف",
      },
      {
        label: "whole target",
        state: wholeState,
        input: request(property.id, source, [wholeTarget], { description: "x" }),
        message: "العقار بالكامل الداخلي",
      },
      {
        label: "limit",
        state,
        input: request(
          property.id,
          source,
          [units[1]!],
          { description: "x" },
          { unitIds: Array.from({ length: 51 }, (_, index) => `unit-${index}`) }
        ),
        message: "50 وحدة",
      },
    ];

    for (const testCase of cases) {
      const before = structuredClone(testCase.state);
      expect(
        () => updateMatchedUnits(testCase.state, testCase.input),
        testCase.label
      ).toThrow(testCase.message);
      expect(testCase.state, testCase.label).toEqual(before);
    }
  });

  it("requires an actual common source value rather than copying an empty source over selected targets", () => {
    const { state, property, units } = fixture("2");
    const before = structuredClone(state);
    expect(() =>
      updateMatchedUnits(
        state,
        request(property.id, units[0]!, [units[1]!], { title: "اسم المصدر فقط" })
      )
    ).toThrow("لا توجد بيانات مشتركة مكتملة");
    expect(state).toEqual(before);
  });
});
