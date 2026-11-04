import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  discardPropertyMedia,
  loadPropertyMedia,
  loadPropertyMediaById,
  lookupPropertyMedia,
  parsePropertyMedia,
  serializePropertyMedia,
  storePropertyMedia,
  validatePropertyMediaFile,
} from "./property-media";
import { createDemoState } from "./demo-data";
import { createRentalProperty, updateRentalProperty } from "./prototype-rental";
import { assertPrototypeState } from "@shared/prototype-validation";

const png = (name = "صورة الفيلا.png") =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], name, {
    type: "image/png",
  });
const pdf = (name = "مخطط.pdf") =>
  new File(["%PDF-1.7\nfixture"], name, { type: "application/pdf" });
const mp4 = (name = "جولة.mp4") =>
  new File(
    [new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 105, 115, 111, 109])],
    name,
    { type: "video/mp4" }
  );
const webm = (name = "جولة.webm") =>
  new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0])], name, {
    type: "video/webm",
  });
const draft = {
  title: "عقار المرفقات",
  portfolioId: "family",
  assetType: "villa",
  usageType: "residential",
  rentalMode: "whole",
  inputMethod: "يدوي",
  unitCount: "1",
  planNumber: "٠٠١-A",
};

describe("property media bytes and metadata", () => {
  it("counts legacy files and grouped IDs together against total attachment caps", () => {
    const photo = {
      id: "legacy-photo-12345678",
      name: "old.png",
      mime: "image/png" as const,
      size: 9,
    };
    const plan = {
      id: "legacy-plan-12345678",
      name: "old.pdf",
      mime: "application/pdf" as const,
      size: 20,
    };
    const photoIds = Array.from(
      { length: 20 },
      (_, index) => `media-photo-${index}`
    );
    const planIds = Array.from(
      { length: 10 },
      (_, index) => `media-plan-${index}`
    );
    expect(() => serializePropertyMedia({ v: 1, photo, photoIds })).toThrow();
    expect(() => serializePropertyMedia({ v: 1, plan, planIds })).toThrow();
    expect(
      parsePropertyMedia(
        serializePropertyMedia({ v: 1, photo, photoIds: photoIds.slice(0, 19) })
      ).photo
    ).toEqual(photo);
    expect(
      parsePropertyMedia(
        serializePropertyMedia({ v: 1, plan, planIds: planIds.slice(0, 9) })
      ).plan
    ).toEqual(plan);
  });

  it("persists real bytes after another database open, not a dataURL; never exposes another workspace", async () => {
    const desc = await storePropertyMedia("guest:test-one", "photo", png());
    const blob = await loadPropertyMedia("guest:test-one", desc, "photo");
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10, 0,
    ]);
    expect(await loadPropertyMedia("guest:test-two", desc, "photo")).toBeNull();
    expect(await loadPropertyMedia("guest:test-one", desc, "plan")).toBeNull();
    await discardPropertyMedia("guest:test-two", desc.id);
    expect(
      await loadPropertyMedia("guest:test-one", desc, "photo")
    ).not.toBeNull();
    await discardPropertyMedia("guest:test-one", desc.id);
    expect(await loadPropertyMedia("guest:test-one", desc, "photo")).toBeNull();
  });

  it("accepts a PDF plan but not a photo PDF, spoofed type, SVG or oversized file", async () => {
    await expect(
      validatePropertyMediaFile(pdf(), "plan")
    ).resolves.toBeUndefined();
    await expect(validatePropertyMediaFile(pdf(), "photo")).rejects.toThrow(
      "JPG"
    );
    await expect(
      validatePropertyMediaFile(
        new File(["fake png"], "file.png", { type: "image/png" }),
        "photo"
      )
    ).rejects.toThrow("محتوى");
    await expect(
      validatePropertyMediaFile(
        new File(["<svg/>"], "file.svg", { type: "image/svg+xml" }),
        "photo"
      )
    ).rejects.toThrow("JPG");
    await expect(
      validatePropertyMediaFile(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
          type: "image/png",
        }),
        "photo"
      )
    ).rejects.toThrow("حجم");
  });

  it("keeps legacy descriptors compatible while adding bounded opaque multi-plan and photo IDs", async () => {
    const scope = "guest:multi-property-media";
    const photo = await storePropertyMedia(scope, "photo", png("cover.png"));
    const extraPhoto = await storePropertyMedia(
      scope,
      "photo",
      png("rear.png")
    );
    const plan = await storePropertyMedia(scope, "plan", pdf("old-plan.pdf"));
    const map = await storePropertyMedia(scope, "plan", png("map.png"));
    const pdfPlan = await storePropertyMedia(
      scope,
      "plan",
      pdf("new-plan.pdf")
    );
    const video = await storePropertyMedia(scope, "video", mp4());
    const propertyMedia = serializePropertyMedia({
      v: 1,
      photo,
      plan,
      photoIds: [extraPhoto.id],
      planIds: [map.id, pdfPlan.id],
      video,
      videoUrl: "https://videos.example.test/property-tour",
    });

    const parsed = parsePropertyMedia(propertyMedia);
    expect(parsed.photo).toEqual(photo);
    expect(parsed.plan).toEqual(plan);
    expect(parsed.photoIds).toEqual([extraPhoto.id]);
    expect(parsed.planIds).toEqual([map.id, pdfPlan.id]);
    expect(parsed.video).toEqual(video);
    expect(propertyMedia.length).toBeLessThanOrEqual(1024);
    expect(propertyMedia).not.toContain("data:");
    expect(propertyMedia).not.toContain("bytes");

    expect(await lookupPropertyMedia(scope, map.id, "plan")).toEqual(map);
    expect(await lookupPropertyMedia(scope, map.id)).toBeNull();
    expect(
      await loadPropertyMediaById(scope, pdfPlan.id, "plan")
    ).toBeInstanceOf(Blob);
    expect(
      await loadPropertyMediaById(scope, video.id, "video")
    ).toBeInstanceOf(Blob);
    expect(await lookupPropertyMedia("guest:other", map.id, "plan")).toBeNull();
  });

  it("validates MP4 ftyp and WebM EBML signatures, MIME and the 50 MiB video cap", async () => {
    await expect(
      validatePropertyMediaFile(mp4(), "video")
    ).resolves.toBeUndefined();
    await expect(
      validatePropertyMediaFile(webm(), "video")
    ).resolves.toBeUndefined();
    await expect(
      validatePropertyMediaFile(
        new File(
          [new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112])],
          "spoof.mp4",
          {
            type: "video/webm",
          }
        ),
        "video"
      )
    ).rejects.toThrow("محتوى");
    await expect(
      validatePropertyMediaFile(
        new File(["video"], "wrong.mov", { type: "video/quicktime" }),
        "video"
      )
    ).rejects.toThrow("MP4 أو WebM");
    const oversized = mp4("large.mp4");
    Object.defineProperty(oversized, "size", {
      value: 50 * 1024 * 1024 + 1,
    });
    await expect(validatePropertyMediaFile(oversized, "video")).rejects.toThrow(
      "50 ميجابايت"
    );
  });

  it("keeps both legacy manifest descriptors in the shared snapshot but no bytes and preserves fields on unrelated edit", async () => {
    const photo = await storePropertyMedia("guest:snapshot", "photo", png());
    const plan = await storePropertyMedia("guest:snapshot", "plan", pdf());
    const propertyMedia = serializePropertyMedia({ v: 1, photo, plan });
    expect(propertyMedia.length).toBeLessThan(1024);
    const created = createRentalProperty(createDemoState(), {
      ...draft,
      propertyMedia,
    });
    const p = created.property;
    expect(p.meta.planNumber).toBe("٠٠١-A");
    expect(p.meta.planRef).toBe("٠٠١-A");
    expect(parsePropertyMedia(String(p.meta.propertyMedia)).photo).toEqual(
      photo
    );
    expect(JSON.stringify(created.state)).not.toMatch(/data:|"bytes"/);
    expect(() => assertPrototypeState(created.state)).not.toThrow();
    const updated = updateRentalProperty(created.state, p.id, {
      title: p.title,
      portfolioId: p.portfolioId,
      assetType: "villa",
      unitCount: "1",
    });
    expect(updated.property.meta.propertyMedia).toBe(propertyMedia);
    expect(updated.property.meta.planNumber).toBe("٠٠١-A");
    const cleared = updateRentalProperty(updated.state, p.id, {
      ...draft,
      propertyMedia: "",
      planNumber: "",
    });
    expect(cleared.property.meta.propertyMedia).toBeUndefined();
    expect(cleared.property.meta.planNumber).toBeUndefined();
    expect(cleared.property.meta.planRef).toBeUndefined();
    expect(
      await loadPropertyMedia("guest:snapshot", photo, "photo")
    ).not.toBeNull();
  });

  it("rejects unsafe video URLs, bytes/data URL fields, repeated IDs and over-cap source JSON without truncating", () => {
    expect(() =>
      parsePropertyMedia(
        JSON.stringify({
          v: 1,
          videoUrl: "https://user:secret@videos.example.test/a.mp4",
        })
      )
    ).toThrow();
    expect(() =>
      parsePropertyMedia('{"v":1,"video":{"bytes":"no"}}')
    ).toThrow();
    expect(() =>
      parsePropertyMedia('{"v":1,"photoIds":["media-id-0001","media-id-0001"]}')
    ).toThrow();
    const longIds = Array.from(
      { length: 20 },
      (_, index) => `${index}`.padStart(2, "0") + "x".repeat(98)
    );
    expect(() => serializePropertyMedia({ v: 1, photoIds: longIds })).toThrow(
      "1024"
    );
  });

  it("reports missing IndexedDB clearly instead of claiming local file persistence", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(
      storePropertyMedia("guest:no-indexed-db", "video", mp4())
    ).rejects.toThrow("تخزين الملفات غير متاح");
    vi.unstubAllGlobals();
  });

  it("rejects injection, data URLs and malformed references", () => {
    expect(parsePropertyMedia("")).toEqual({ v: 1 });
    expect(() =>
      parsePropertyMedia(
        '{"v":1,"photo":{"id":"https://evil.com","name":"x","mime":"image/png","size":1}}'
      )
    ).toThrow();
    expect(() =>
      parsePropertyMedia('{"v":1,"url":"data:image/png;base64,x"}')
    ).toThrow();
    expect(() => parsePropertyMedia("blob:fake")).toThrow();
  });
});
