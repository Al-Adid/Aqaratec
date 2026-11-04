import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import { entityEditToken } from "./prototype-edit-concurrency";
import {
  parsePhotoGallery,
  saveTargetPhotoGallery,
} from "./property-photo-gallery";
import { updateMatchedUnits } from "./unit-match-fill";

function fixture() {
  const created = createRentalProperty(createDemoState(), {
    title: "مجمع صور المطابقة",
    portfolioId: "family",
    assetType: "villa_complex",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "3",
  });
  const ids = created.state.entities.units
    .filter(u => u.propertyId === created.property.id)
    .map(u => u.id);
  let state = saveTargetPhotoGallery(created.state, "units", ids[0]!, [
    "source-photo",
    "shared-photo",
  ]).state;
  state = saveTargetPhotoGallery(state, "units", ids[1]!, [
    "target-existing",
    "shared-photo",
  ]).state;
  const source = state.entities.units.find(u => u.id === ids[0])!;
  const target = state.entities.units.find(u => u.id === ids[1])!;
  const request = {
    propertyId: created.property.id,
    sourceUnitId: source.id,
    sourceChanges: {},
    sourceToken: entityEditToken(source),
    unitIds: [target.id],
    expectedTokens: { [target.id]: entityEditToken(target) },
    photoIds: ["source-photo", "shared-photo"],
  };
  return { state, source, target, ids, request };
}

describe("photo-aware unit matching", () => {
  it("matches a photo-only saved source, merges without duplicate/loss, preserves finance and identities", () => {
    const { state, source, target, ids, request } = fixture();
    const original = structuredClone(state);
    const result = updateMatchedUnits(state, request);
    expect(
      parsePhotoGallery(result.result.updates[0]!.after.meta.photoGallery).ids
    ).toEqual(["target-existing", "shared-photo", "source-photo"]);
    expect(result.result.updates[0]!.matchedPhotoIds).toEqual(request.photoIds);
    expect(result.result.updates[0]!.appliedKeys).toEqual([]);
    expect(result.result.source.meta.photoGallery).toBe(
      source.meta.photoGallery
    );
    expect(result.result.updates[0]!.after).toMatchObject({
      id: target.id,
      title: target.title,
      portfolioId: target.portfolioId,
      propertyId: target.propertyId,
    });
    expect(result.result.updates[0]!.after.meta.unitCode).toBe(
      target.meta.unitCode
    );
    expect(result.state.entities.units.find(u => u.id === ids[2])).toEqual(
      state.entities.units.find(u => u.id === ids[2])
    );
    for (const kind of [
      "leases",
      "receivables",
      "collections",
      "expenses",
    ] as const)
      expect(result.state.entities[kind]).toEqual(state.entities[kind]);
    expect(state).toEqual(original);
    expect(
      parsePhotoGallery(
        JSON.parse(JSON.stringify(result.state)).entities.units.find(
          (u: { id: string }) => u.id === target.id
        ).meta.photoGallery
      ).ids
    ).toContain("source-photo");
  });
  it("saves unsaved source information and images together", () => {
    const { state, request } = fixture();
    const result = updateMatchedUnits(state, {
      ...request,
      sourceChanges: { description: "وصف وصورة مرة واحدة", unitArea: "88.25" },
    });
    expect(result.result.source.meta.description).toBe("وصف وصورة مرة واحدة");
    expect(result.result.updates[0]!.after.meta.description).toBe(
      "وصف وصورة مرة واحدة"
    );
    expect(
      parsePhotoGallery(result.result.updates[0]!.after.meta.photoGallery).ids
    ).toHaveLength(3);
  });
  it("rejects photo overflow atomically before saving source information", () => {
    const f = fixture();
    const state = saveTargetPhotoGallery(
      f.state,
      "units",
      f.target.id,
      Array.from({ length: 20 }, (_, i) => `existing-${i}`)
    ).state;
    const target = state.entities.units.find(u => u.id === f.target.id)!;
    const before = structuredClone(state);
    expect(() =>
      updateMatchedUnits(state, {
        ...f.request,
        sourceChanges: { description: "لا يحفظ" },
        expectedTokens: { [target.id]: entityEditToken(target) },
      })
    ).toThrow("20 صورة");
    expect(state).toEqual(before);
  });
  it("rejects unrelated photo injection and stale gallery snapshots", () => {
    const f = fixture();
    const before = structuredClone(f.state);
    expect(() =>
      updateMatchedUnits(f.state, {
        ...f.request,
        photoIds: ["target-existing"],
      })
    ).toThrow("المصدر");
    const newer = saveTargetPhotoGallery(f.state, "units", f.source.id, [
      "source-photo",
      "shared-photo",
      "new-photo",
    ]).state;
    expect(() => updateMatchedUnits(newer, f.request)).toThrow("المصدر");
    expect(f.state).toEqual(before);
  });
  it("preserves role guards for photo-only matching", () => {
    const f = fixture();
    const state = {
      ...f.state,
      settings: { ...f.state.settings, role: "owner" as const },
    };
    expect(() => updateMatchedUnits(state, f.request)).toThrow("الموظف");
  });
});
