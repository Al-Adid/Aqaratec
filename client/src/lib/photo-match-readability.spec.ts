import "fake-indexeddb/auto";
import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { storePropertyMedia, loadPropertyPhotoById } from "./property-media";
import { readMatchingPhotoIds } from "./photo-match-readability";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("sunnaa-property-media-v1");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
describe("local matching photo readability", () => {
  it("returns only byte-backed photos in the requested workspace, leaving files intact", async () => {
    const file = new NodeFile([png], "photo.png", {
      type: "image/png",
    }) as unknown as File;
    const descriptor = await storePropertyMedia(
      "scope-photo-test",
      "photo",
      file
    );
    expect(
      await readMatchingPhotoIds("scope-photo-test", [
        descriptor.id,
        "missing-photo",
      ])
    ).toEqual({ ids: [descriptor.id], missingCount: 1 });
    expect(
      await readMatchingPhotoIds("scope-other-test", [descriptor.id])
    ).toEqual({ ids: [], missingCount: 1 });
    expect(
      (await loadPropertyPhotoById("scope-photo-test", descriptor.id))?.size
    ).toBe(file.size);
  });
  it("does not treat a same-scope plan as a photograph", async () => {
    const file = new NodeFile([png], "plan.png", {
      type: "image/png",
    }) as unknown as File;
    const descriptor = await storePropertyMedia(
      "scope-plan-test",
      "plan",
      file
    );
    expect(
      await readMatchingPhotoIds("scope-plan-test", [descriptor.id])
    ).toEqual({ ids: [], missingCount: 1 });
  });
  it("bounds references before reading", async () => {
    await expect(
      readMatchingPhotoIds(
        "scope-test",
        Array.from({ length: 21 }, (_, i) => `photo-${i}`)
      )
    ).rejects.toThrow("غير صالحة");
    expect(await readMatchingPhotoIds("scope-test", [])).toEqual({
      ids: [],
      missingCount: 0,
    });
  });
});
