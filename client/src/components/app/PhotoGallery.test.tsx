// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import {
  parsePhotoGallery,
  saveTargetPhotoGallery,
} from "@/lib/property-photo-gallery";
import type { PropertyMediaDescriptor } from "@shared/property-media-types";

const media = vi.hoisted(() => ({
  validate: vi.fn<() => Promise<void>>(),
  store: vi.fn(),
  discard: vi.fn<() => Promise<void>>(),
  lookup: vi.fn(),
  loadById: vi.fn(),
}));

vi.mock("@/lib/property-media", () => ({
  validatePropertyMediaFile: media.validate,
  storePropertyMedia: media.store,
  discardPropertyMedia: media.discard,
  lookupPropertyMedia: media.lookup,
  loadPropertyPhotoById: media.loadById,
}));

import { AssetPhotoGallery, GroupUnitPhotoGallery } from "./PhotoGallery";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof usePrototype>;

function descriptor(
  id = "media-gallery-new-12345678"
): PropertyMediaDescriptor {
  return { id, name: "gallery.png", mime: "image/png", size: 9 };
}

function Capture({ children }: { children: React.ReactNode }) {
  api = usePrototype();
  return <>{children}</>;
}

function inputFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonWith(
  text: string,
  within: ParentNode = host
): HTMLButtonElement {
  const button = Array.from(within.querySelectorAll("button")).find(candidate =>
    candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`زر غير موجود: ${text}`);
  return button;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  media.validate.mockResolvedValue(undefined);
  media.store.mockResolvedValue(descriptor());
  media.discard.mockResolvedValue(undefined);
  media.lookup.mockResolvedValue(null);
  media.loadById.mockResolvedValue(null);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:photo-gallery-test"),
    revokeObjectURL: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PhotoGallery components", () => {
  it("stores fresh individual photos, reads by local ID, and unlinks without deleting the Blob", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="فيلا الروضة"
            />
          </Capture>
        </PrototypeProvider>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["png"], "new.png", { type: "image/png" });
    await act(async () => {
      inputFiles(input, [file]);
      await flush();
    });

    expect(media.store).toHaveBeenCalledWith(expect.any(String), "photo", file);
    const property = api.find("properties", "villa")!;
    expect(parsePhotoGallery(property.meta.photoGallery).ids).toEqual([
      "media-gallery-new-12345678",
    ]);
    expect(media.lookup).toHaveBeenCalledWith(
      expect.any(String),
      "media-gallery-new-12345678"
    );

    await act(async () => {
      buttonWith("إزالة الارتباط").click();
      await flush();
    });
    expect(
      parsePhotoGallery(api.find("properties", "villa")!.meta.photoGallery).ids
    ).toEqual([]);
    expect(media.discard).not.toHaveBeenCalled();
  });

  it("reviews then assigns one uploaded set to selected units in one transition", async () => {
    media.store.mockResolvedValue(descriptor("media-group-new-12345678"));
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <GroupUnitPhotoGallery propertyId="building" />
          </Capture>
        </PrototypeProvider>
      );
    });
    const choices = host.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    await act(async () => {
      choices[0].click();
      choices[1].click();
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      inputFiles(input, [
        new File(["png"], "group.png", { type: "image/png" }),
      ]);
      await flush();
    });
    expect(host.textContent).toContain("group.png");
    await act(async () => buttonWith("مراجعة المجموعة").click());
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("2 وحدة");
    await act(async () => {
      buttonWith("إسناد الصور للوحدات المختارة", dialog).click();
      await flush();
    });
    const first = api.find("units", "u-b1")!;
    const second = api.find("units", "u-b2")!;
    expect(parsePhotoGallery(first.meta.photoGallery).ids).toEqual([
      "media-group-new-12345678",
    ]);
    expect(parsePhotoGallery(second.meta.photoGallery).ids).toEqual([
      "media-group-new-12345678",
    ]);
    expect(
      api.state.entities.documents.some(row => row.meta.photoGalleryRequestId)
    ).toBe(true);
  });

  it("cleans only a fresh unlinked Blob if edit permission is lost while IndexedDB is pending", async () => {
    let resolveStore!: (value: PropertyMediaDescriptor) => void;
    media.store.mockImplementationOnce(
      () =>
        new Promise<PropertyMediaDescriptor>(resolve => {
          resolveStore = resolve;
        })
    );
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="فيلا الروضة"
            />
          </Capture>
        </PrototypeProvider>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      inputFiles(input, [
        new File(["png"], "pending.png", { type: "image/png" }),
      ]);
      await flush();
    });
    await act(async () => api.setSetting("role", "owner"));
    await act(async () => {
      resolveStore(descriptor("media-role-lost-12345678"));
      await flush();
    });

    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "media-role-lost-12345678"
    );
    expect(api.find("properties", "villa")!.meta.photoGallery).toBeUndefined();
  });

  it("reports zero for metadata-only photos and counts only a readable scoped Blob", async () => {
    const availability = vi.fn();
    const photoId = "media-availability-12345678";
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="تحقق الصور"
              onLocalAvailabilityChange={availability}
            />
          </Capture>
        </PrototypeProvider>
      )
    );
    await act(async () => {
      api.commitTransition(current =>
        saveTargetPhotoGallery(current, "properties", "villa", [photoId])
      );
      await flush();
    });
    expect(host.textContent).toContain("الصورة غير متاحة في هذا المتصفح");
    expect(availability.mock.lastCall?.[0]).toMatchObject({
      kind: "properties",
      id: "villa",
      galleryKey: photoId,
      availableCount: 0,
    });
    media.lookup.mockResolvedValue(descriptor(photoId));
    media.loadById.mockResolvedValue(
      new Blob(["local-bytes"], { type: "image/png" })
    );
    await act(async () => {
      api.commitTransition(current =>
        saveTargetPhotoGallery(current, "properties", "villa", [])
      );
      await flush();
    });
    await act(async () => {
      api.commitTransition(current =>
        saveTargetPhotoGallery(current, "properties", "villa", [photoId])
      );
      await flush();
    });
    expect(availability.mock.lastCall?.[0]).toMatchObject({
      galleryKey: photoId,
      availableCount: 1,
    });
    expect(availability.mock.lastCall?.[0].scopeKey).toBe(
      api.identity.storageKey
    );
    await act(async () => {
      api.commitTransition(current =>
        saveTargetPhotoGallery(current, "properties", "villa", [])
      );
      await flush();
    });
    expect(availability.mock.lastCall?.[0]).toMatchObject({
      galleryKey: "",
      availableCount: 0,
    });
  });

  it("cleans a fresh Blob when the real browser localStorage rejects the durable gallery write", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="فيلا التخزين"
            />
          </Capture>
        </PrototypeProvider>
      );
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (key.startsWith("sunnaa-full-prototype-v2"))
        throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });

    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      inputFiles(input, [
        new File(["png"], "quota.png", { type: "image/png" }),
      ]);
      await flush();
    });

    expect(media.discard).toHaveBeenCalledWith(
      api.identity.storageKey,
      "media-gallery-new-12345678"
    );
    expect(api.find("properties", "villa")!.meta.photoGallery).toBeUndefined();
    expect(host.textContent).toContain("تعذر الحفظ المحلي");
  });

  it("acknowledges only its exact durable gallery entity before and after the write", async () => {
    const onCommittedChange = vi.fn();
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="فيلا الإقرار"
              onCommittedChange={onCommittedChange}
            />
          </Capture>
        </PrototypeProvider>
      );
    });
    const before = api.find("properties", "villa")!;
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      inputFiles(input, [
        new File(["png"], "acknowledged.png", { type: "image/png" }),
      ]);
      await flush();
    });

    expect(onCommittedChange).toHaveBeenCalledTimes(1);
    const payload = onCommittedChange.mock.calls[0]?.[0];
    const after = api.find("properties", "villa")!;
    expect(payload).toEqual({
      kind: "properties",
      id: "villa",
      scopeKey: api.identity.storageKey,
      before,
      after,
    });
    const envelope = JSON.parse(
      localStorage.getItem(api.identity.storageKey) ?? "{}"
    ) as {
      snapshot?: {
        entities?: {
          properties?: Array<{
            id: string;
            meta?: { photoGallery?: unknown };
          }>;
        };
      };
    };
    const persisted = envelope.snapshot?.entities?.properties?.find(
      row => row.id === "villa"
    );
    expect(parsePhotoGallery(persisted?.meta?.photoGallery).ids).toEqual([
      "media-gallery-new-12345678",
    ]);

    await act(async () => {
      buttonWith("إزالة الارتباط").click();
      await flush();
    });
    const afterRemoval = api.find("properties", "villa")!;
    expect(onCommittedChange).toHaveBeenCalledTimes(2);
    expect(onCommittedChange.mock.calls[1]?.[0]).toEqual({
      kind: "properties",
      id: "villa",
      scopeKey: api.identity.storageKey,
      before: after,
      after: afterRemoval,
    });
    expect(parsePhotoGallery(afterRemoval.meta.photoGallery).ids).toEqual([]);
  });

  it("retains fresh media and releases the parent busy lock when a durable write cannot be acknowledged", async () => {
    const onCommittedChange = vi.fn();
    const onBusyChange = vi.fn();
    let changedRole = false;
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <AssetPhotoGallery
              kind="properties"
              id="villa"
              title="فيلا إقرار محجوب"
              onCommittedChange={onCommittedChange}
              onBusyChange={onBusyChange}
            />
          </Capture>
        </PrototypeProvider>
      );
    });
    vi.stubGlobal("navigator", {
      userAgent: "jsdom",
      locks: {
        request: async <T,>(
          _name: string,
          _options: unknown,
          callback: () => T | Promise<T>
        ) => {
          const result = await callback();
          if (!changedRole) {
            changedRole = true;
            api.setSetting("role", "owner");
          }
          return result;
        },
      },
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      inputFiles(input, [
        new File(["png"], "committed.png", { type: "image/png" }),
      ]);
      await flush();
    });

    expect(media.discard).not.toHaveBeenCalled();
    expect(onCommittedChange).not.toHaveBeenCalled();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(api.find("properties", "villa")!.meta.photoGallery).toBeUndefined();
    expect(host.textContent).toContain("اكتمل حفظ محلي محروس");
  });
});
