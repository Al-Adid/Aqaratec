import { describe, it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import {
  checkAssetRemoval,
  removeUnusedAsset,
} from "./prototype-asset-removal";
import { assertPrototypeState } from "@shared/prototype-validation";
const raw = {
  title: "فيلا حذف غير مستخدمة",
  portfolioId: "family",
  assetType: "villa",
  usageType: "residential",
  inputMethod: "يدوي",
  rentalMode: "units",
  unitCount: "9",
};
describe("safe asset removal", () => {
  it("removes exactly one unused property and its nine unleased units, no financial records", () => {
    const made = createRentalProperty(createDemoState(), raw);
    const before = structuredClone(made.state.entities.receivables);
    const otherUnits = made.state.entities.units.filter(
      u => u.propertyId !== made.property.id
    );
    expect(
      checkAssetRemoval(made.state, "properties", made.property.id).unitCount
    ).toBe(9);
    const removed = removeUnusedAsset(
      made.state,
      "properties",
      made.property.id
    );
    expect(
      removed.state.entities.properties.some(p => p.id === made.property.id)
    ).toBe(false);
    expect(removed.state.entities.units).toEqual(otherUnits);
    expect(removed.state.entities.receivables).toEqual(before);
    expect(removed.state.audit[0].title).toContain("حذف");
    expect(() => assertPrototypeState(removed.state)).not.toThrow();
    expect(
      made.state.entities.properties.some(p => p.id === made.property.id)
    ).toBe(true);
  });
  it("blocks existing property with historical contracts, empty portfolio iff truly empty, and roles/scopes", () => {
    const state = createDemoState();
    expect(checkAssetRemoval(state, "properties", "villa").allowed).toBe(false);
    expect(() => removeUnusedAsset(state, "portfolios", "family")).toThrow(
      "رصيد"
    );
    const noOpening = structuredClone(state);
    noOpening.entities.portfolios.find(p => p.id === "family")!.meta = {};
    noOpening.entities.portfolios.find(p => p.id === "family")!.amountMinor = 0;
    expect(() => removeUnusedAsset(noOpening, "portfolios", "family")).toThrow(
      "مرتبطة"
    );
    const port = {
      ...state.entities.portfolios[0],
      id: "empty-portfolio",
      portfolioId: "empty-portfolio",
      title: "خالية",
      amountMinor: 0,
      meta: {},
    };
    state.entities.portfolios.push(port);
    state.settings.portfolioId = port.id;
    const next = removeUnusedAsset(state, "portfolios", port.id).state;
    expect(next.settings.portfolioId).toBe("all");
    state.settings.role = "owner";
    expect(() => removeUnusedAsset(state, "portfolios", port.id)).toThrow(
      "الموظف"
    );
  });
  it("blocks a relationship on the unit even when its propertyId is absent on the linked row", () => {
    const made = createRentalProperty(createDemoState(), raw);
    const unit = made.state.entities.units.find(
      u => u.propertyId === made.property.id
    )!;
    const source = made.state.entities.tasks[0];
    made.state.entities.tasks.push({
      ...source,
      id: "linked-unit-task",
      propertyId: "",
      meta: { unitId: unit.id },
    });
    const rawBefore = JSON.stringify(made.state);
    expect(() =>
      removeUnusedAsset(made.state, "properties", made.property.id)
    ).toThrow("مرتبطة");
    expect(JSON.stringify(made.state)).toBe(rawBefore);
  });
});
