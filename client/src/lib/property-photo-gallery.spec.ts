import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import {
  assignUnitPhotoGroup,
  parsePhotoGallery,
  saveTargetPhotoGallery,
} from "./property-photo-gallery";
import {
  discardPropertyMedia,
  loadPropertyPhotoById,
  lookupPropertyMedia,
  storePropertyMedia,
} from "./property-media";

const png = (name = "gallery.png") =>
  new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    name,
    { type: "image/png" }
  );

const id = (suffix: string) => `photo-gallery-${suffix}`;
const manifest = (ids: string[]) => JSON.stringify({ v: 1, ids });

describe("property photo gallery", () => {
  it("accepts only the bounded ID-only manifest", () => {
    expect(parsePhotoGallery("")).toEqual({ v: 1, ids: [] });
    expect(parsePhotoGallery(manifest([id("one")]))).toEqual({
      v: 1,
      ids: [id("one")],
    });
    expect(() => parsePhotoGallery('{"v":1,"ids":["https://bad"]}')).toThrow(
      "غير صالحة"
    );
    expect(() => parsePhotoGallery('{"v":1,"url":"blob:bad","ids":[]}')).toThrow(
      "غير صالحة"
    );
    expect(() => parsePhotoGallery(manifest(Array(21).fill(id("same"))))).toThrow(
      "غير صالحة"
    );
  });

  it("looks up a descriptor and byte-backed photo only in its current workspace", async () => {
    const descriptor = await storePropertyMedia("guest:gallery-a", "photo", png());
    await expect(lookupPropertyMedia("guest:gallery-a", descriptor.id)).resolves.toEqual(
      descriptor
    );
    await expect(lookupPropertyMedia("guest:gallery-b", descriptor.id)).resolves.toBeNull();
    await expect(loadPropertyPhotoById("guest:gallery-b", descriptor.id)).resolves.toBeNull();
    const bytes = new Uint8Array(
      await (await loadPropertyPhotoById("guest:gallery-a", descriptor.id))!.arrayBuffer()
    );
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    await discardPropertyMedia("guest:gallery-a", descriptor.id);
  });

  it("replaces one target's final references without deleting an older local blob", async () => {
    const scope = "guest:gallery-replace";
    const oldFile = await storePropertyMedia(scope, "photo", png("old.png"));
    const state = createDemoState();
    const villa = state.entities.properties.find(row => row.id === "villa")!;
    villa.meta.photoGallery = manifest([oldFile.id]);

    const saved = saveTargetPhotoGallery(state, "properties", villa.id, [id("new")]);
    expect(parsePhotoGallery(saved.result.meta.photoGallery).ids).toEqual([id("new")]);
    // Metadata-only unlinking deliberately leaves older bytes usable by a
    // different target or a previous local snapshot.
    expect(await loadPropertyPhotoById(scope, oldFile.id)).not.toBeNull();
    await discardPropertyMedia(scope, oldFile.id);
  });

  it("atomically merges group photos with each unit's old references and records one idempotent document", () => {
    const state = createDemoState();
    const first = state.entities.units.find(row => row.id === "u-b1")!;
    const second = state.entities.units.find(row => row.id === "u-b2")!;
    first.meta.photoGallery = manifest([id("old-unit")]);

    const input = {
      requestId: "photo-group-1",
      propertyId: "building",
      unitIds: [first.id, second.id],
      photoIds: [id("shared-a"), id("shared-b")],
      title: "صور شقق المها",
    };
    const saved = assignUnitPhotoGroup(state, input);
    const nextFirst = saved.state.entities.units.find(row => row.id === first.id)!;
    const nextSecond = saved.state.entities.units.find(row => row.id === second.id)!;
    expect(parsePhotoGallery(nextFirst.meta.photoGallery).ids).toEqual([
      id("old-unit"),
      id("shared-a"),
      id("shared-b"),
    ]);
    expect(parsePhotoGallery(nextSecond.meta.photoGallery).ids).toEqual([
      id("shared-a"),
      id("shared-b"),
    ]);
    expect(saved.result.meta.requestId).toBe("photo-group-1");
    expect(saved.result.meta.photoIds1).toBe(manifest(input.photoIds).replace('{"v":1,"ids":', "").slice(0, -1));

    const retried = assignUnitPhotoGroup(saved.state, input);
    expect(retried.state).toBe(saved.state);
    expect(retried.result.id).toBe(saved.result.id);
    expect(retried.state.entities.documents).toHaveLength(
      saved.state.entities.documents.length
    );
  });

  it("rejects cross-property selections and capacity overflow without partial state", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    expect(() =>
      assignUnitPhotoGroup(state, {
        requestId: "photo-cross-property",
        propertyId: "building",
        unitIds: ["u-b1", "u-t1"],
        photoIds: [id("shared")],
      })
    ).toThrow("العقار والمحفظة نفسها");
    expect(state).toEqual(before);

    const saturated = createDemoState();
    const unit = saturated.entities.units.find(row => row.id === "u-b1")!;
    unit.meta.photoGallery = manifest(
      Array.from({ length: 20 }, (_, index) => id(`full-${index}`))
    );
    const beforeCapacity = structuredClone(saturated);
    expect(() =>
      assignUnitPhotoGroup(saturated, {
        requestId: "photo-capacity",
        propertyId: "building",
        unitIds: [unit.id],
        photoIds: [id("overflow")],
      })
    ).toThrow("20 صورة");
    expect(saturated).toEqual(beforeCapacity);
  });
});
