// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
const media = vi.hoisted(() => ({ legacy: vi.fn(), gallery: vi.fn() }));
vi.mock("@/lib/property-media", async importOriginal => ({
  ...(await importOriginal<any>()),
  loadPropertyMedia: media.legacy,
  loadPropertyPhotoById: media.gallery,
}));
import { PropertyCover } from "./PropertyCover";
import { saveTargetPhotoGallery } from "@/lib/property-photo-gallery";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  host: HTMLDivElement,
  api: ReturnType<typeof usePrototype>,
  id = "";
let assetKind: "properties" | "units" = "properties";
function Fixture() {
  api = usePrototype();
  const p = api.state.entities[assetKind].find(p => p.id === id);
  return p ? <PropertyCover property={p} kind={assetKind} /> : null;
}
beforeEach(async () => {
  assetKind = "properties";
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  media.legacy.mockResolvedValue(null);
  media.gallery.mockResolvedValue(null);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:cover-local"),
    revokeObjectURL: vi.fn(),
  });
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Fixture />
      </PrototypeProvider>
    )
  );
  await act(async () => {
    id = api.createRentalProperty({
      title: "غلاف محلي",
      inputMethod: "يدوي",
      portfolioId: "family",
      assetType: "villa",
      usageType: "residential",
      rentalMode: "whole",
      unitCount: "1",
    }).id;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  id = "";
  let assetKind: "properties" | "units" = "properties";
});
async function setRefs() {
  await act(async () =>
    api.commitTransition(s => ({
      state: {
        ...s,
        entities: {
          ...s.entities,
          properties: s.entities.properties.map(p =>
            p.id === id
              ? {
                  ...p,
                  meta: {
                    ...p.meta,
                    propertyMedia: JSON.stringify({
                      v: 1,
                      photo: {
                        id: "media-legacy-12345678",
                        name: "old.png",
                        mime: "image/png",
                        size: 12,
                      },
                    }),
                    photoGallery: JSON.stringify({
                      v: 1,
                      ids: ["media-gallery-12345678"],
                    }),
                  },
                }
              : p
          ),
        },
      },
      result: null,
    }))
  );
}
it("falls back to a readable gallery image after a missing legacy blob", async () => {
  media.gallery.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  await setRefs();
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:cover-local"
  );
  expect(media.legacy).toHaveBeenCalled();
  expect(media.gallery).toHaveBeenCalled();
  expect(host.textContent).not.toContain("تخيلية");
});
it("shows missing status when both saved references are unreadable and never follows URLs", async () => {
  await setRefs();
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("الملف غير متاح");
  await act(async () => api.setSetting("portfolioId", "growth"));
  expect(host.textContent).toContain("خارج نطاق");
});

it("loads a new manifest photo ID as the cover without legacy or separate gallery references", async () => {
  media.gallery.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  await act(async () =>
    api.commitTransition(s => ({
      state: {
        ...s,
        entities: {
          ...s.entities,
          properties: s.entities.properties.map(p =>
            p.id === id
              ? {
                  ...p,
                  meta: {
                    ...p.meta,
                    propertyMedia: JSON.stringify({
                      v: 1,
                      photoIds: ["media-manifest-12345678"],
                    }),
                  },
                }
              : p
          ),
        },
      },
      result: null,
    }))
  );
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:cover-local"
  );
  expect(media.gallery).toHaveBeenCalledWith(
    api.identity.storageKey,
    "media-manifest-12345678"
  );
  expect(media.legacy).not.toHaveBeenCalled();
});

it("shows a saved unit gallery photo in the same guarded cover and hides it outside portfolio scope", async () => {
  let propertyId = "";
  await act(async () => {
    propertyId = api.createRentalProperty({
      title: "وحدات مصورة",
      inputMethod: "يدوي",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      rentalMode: "units",
      unitCount: "2",
    }).id;
  });
  id = api.state.entities.units.find(u => u.propertyId === propertyId)!.id;
  assetKind = "units";
  media.gallery.mockResolvedValue(
    new Blob(["unit-photo"], { type: "image/png" })
  );
  await act(async () => {
    await api.commitAssetTransition(current =>
      saveTargetPhotoGallery(current, "units", id, ["unit-cover-photo"])
    );
  });
  expect(host.querySelector("img")?.alt).toContain("صورة الوحدة");
  expect(media.gallery).toHaveBeenCalledWith(
    api.identity.storageKey,
    "unit-cover-photo"
  );
  await act(async () => api.setSetting("portfolioId", "growth"));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("خارج نطاق المحفظة");
});
