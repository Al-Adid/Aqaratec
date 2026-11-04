import { it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import {
  unitDisplayReference,
  updateUnitIdentifier,
  nextUnitIdentifier,
  assertUnitIdentifierAvailable,
} from "./prototype-unit-identifiers";
it("generates nine linked codes and skips a manually assigned next code", () => {
  const made = createRentalProperty(createDemoState(), {
    title: "فيلا الصخامة 1",
    portfolioId: "family",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "9",
  });
  const units = made.state.entities.units.filter(
    u => u.propertyId === made.property.id
  );
  expect(units).toHaveLength(9);
  expect(units.map(u => u.meta.unitCode)).toEqual(
    Array.from({ length: 9 }, (_, i) => `U-${String(i + 1).padStart(2, "0")}`)
  );
  expect(unitDisplayReference(made.state.entities, units[8].id)).toBe(
    "فيلا الصخامة 1 · U-09"
  );
  const changed = updateUnitIdentifier(made.state, units[0].id, "U-10").state;
  expect(nextUnitIdentifier(changed.entities, made.property.id)).toBe("U-01");
  expect(() =>
    assertUnitIdentifierAvailable(changed.entities, made.property.id, "u-١٠")
  ).toThrow("مكرر");
  expect(
    assertUnitIdentifierAvailable(changed.entities, made.property.id, "0011")
  ).toBe("0011");
});
