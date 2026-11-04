import { describe, expect, it } from "vitest";
import type { DemoEntity } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import { updateDescribedUnit, unitProfileSummary } from "./unit-profile";
import {
  compositionCategory,
  compositionCategoryLabel,
  physicalCompositionUnits,
  propertyUnitComposition,
} from "./unit-composition";

function fixture() {
  const created = createRentalProperty(createDemoState(), {
    title: "أصل تصنيف الوحدات",
    portfolioId: "family",
    assetType: "villa_complex",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "3",
    inputMethod: "يدوي",
    requestId: "unit-composition-test",
  });
  return {
    state: created.state,
    property: created.property,
    units: created.state.entities.units.filter(
      unit => unit.propertyId === created.property.id
    ),
  };
}

describe("physical property unit composition", () => {
  it("counts explicit apartments, villas and unclassified units without guessing from contents or parent title", () => {
    let { state, property, units } = fixture();
    state = updateDescribedUnit(state, units[0].id, {
      category: "apartment",
      apartmentLayout: "4-living",
      bedrooms: "4",
      livingRooms: "1",
      unitCode: "A-01",
      contents: "أربع غرف وصالة",
    }).state;
    state = updateDescribedUnit(state, units[1].id, {
      category: "villa",
      villaArrangement: "detached",
      unitCode: "V-01",
    }).state;
    units = state.entities.units.filter(
      unit => unit.propertyId === property.id
    );
    const before = structuredClone(state);
    const composed = propertyUnitComposition(property, units);
    expect(composed.total).toBe(3);
    expect(
      composed.groups.find(group => group.value === "apartment")?.count
    ).toBe(1);
    expect(composed.groups.find(group => group.value === "villa")?.count).toBe(
      1
    );
    expect(
      composed.groups.find(group => group.value === "unclassified")?.count
    ).toBe(1);
    expect(compositionCategory(units[2])).toBe("unclassified");
    expect(compositionCategoryLabel(units[0])).toBe("شقة");
    expect(unitProfileSummary(units[1])).toBe("فيلا منفصلة");
    expect(state).toEqual(before);
  });

  it("excludes internal whole targets, mismatched scope, mismatched parent and duplicate input ids", () => {
    const { property, units } = fixture();
    const samples: DemoEntity[] = [
      units[0],
      { ...units[1], meta: { ...units[1].meta, wholeProperty: true } },
      { ...units[2], portfolioId: "outside-portfolio" },
      { ...units[2], propertyId: "outside-property" },
      units[0],
    ];
    expect(
      physicalCompositionUnits(property, samples).map(unit => unit.id)
    ).toEqual([units[0].id]);
    expect(propertyUnitComposition(property, samples).total).toBe(1);
  });
});
