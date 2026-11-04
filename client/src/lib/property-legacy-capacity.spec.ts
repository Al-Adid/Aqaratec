import { it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import { updateRentalProperty } from "./prototype-rental";
import { assertPrototypeState } from "@shared/prototype-validation";
it("updates only changed title on a 32-key historical property without losing any metadata", () => {
  const state = createDemoState();
  const property = state.entities.properties[0];
  property.meta = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [`old${i}`, `قيمة ${i}`])
  );
  const next = updateRentalProperty(state, property.id, {
    title: "اسم محدث",
    portfolioId: property.portfolioId,
    assetType: "villa",
    usageType: "residential",
    unitCount: "1",
    planNumber: "",
    propertyMedia: "",
    _changedFields: '["title"]',
  });
  expect(next.property.meta).toEqual(property.meta);
  expect(next.property.title).toBe("اسم محدث");
  expect(() => assertPrototypeState(next.state)).not.toThrow();
  expect(() =>
    updateRentalProperty(state, property.id, {
      title: property.title,
      portfolioId: property.portfolioId,
      assetType: "villa",
      unitCount: "1",
      planNumber: "001",
      _changedFields: '["planNumber"]',
    })
  ).toThrow("سعة 32");
  expect(Object.keys(property.meta)).toHaveLength(32);
});
it("preserves a legacy plan reference longer than 80 characters within the shared 1024 limit", () => {
  const state = createDemoState();
  const property = state.entities.properties[0];
  const ref = "0".repeat(81) + "-A";
  property.meta.planRef = ref;
  const next = updateRentalProperty(state, property.id, {
    title: property.title,
    portfolioId: property.portfolioId,
    assetType: "villa",
    unitCount: "1",
    planNumber: ref,
  });
  expect(next.property.meta.planNumber).toBe(ref);
  expect(next.property.meta.planRef).toBe(ref);
  expect(() => assertPrototypeState(next.state)).not.toThrow();
});
