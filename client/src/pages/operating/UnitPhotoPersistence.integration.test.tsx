// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { loadPropertyPhotoById } from "@/lib/property-media";
import { parsePhotoGallery } from "@/lib/property-photo-gallery";
import { updateDescribedUnit } from "@/lib/unit-profile";
import { UnitDetailsDialog } from "./UnitDetailsDialog";

const IDENTITY = {
  status: "guest" as const,
  userId: null,
  localWorkspaceId: "unit-photo-persistence-integration",
};
const MEDIA_DB = "sunnaa-property-media-v1";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | undefined;
let api: ReturnType<typeof usePrototype>;

function UnitDialogs() {
  api = usePrototype();
  const property = api.find("properties", "building")!;
  const unit = api.find("units", "u-b1")!;
  return (
    <>
      <UnitDetailsDialog
        mode="details"
        property={property}
        unit={unit}
        canEdit={api.canEdit}
        trigger={<button type="button">فتح صور الوحدة</button>}
      />
    </>
  );
}

function buttonWith(text: string, within: ParentNode = host): HTMLButtonElement {
  const button = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    candidate => candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`زر غير موجود: ${text}`);
  return button;
}

function dialogFor(text: string): HTMLElement {
  const dialog = [...host.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
    candidate => candidate.textContent?.includes(text)
  );
  if (!dialog) throw new Error(`نافذة غير موجودة: ${text}`);
  return dialog;
}

function inputFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  }
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (caught) {
      lastError = caught;
      await act(async () => settle(1));
    }
  }
  throw lastError;
}

function validPng(): File {
  // fake-indexeddb uses Node structuredClone under jsdom. A jsdom Blob is
  // downgraded to a plain object there, unlike a browser's single Blob realm.
  // This native Blob keeps this fixture's real IDB round trip byte-backed.
  const file = new NodeBlob(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    { type: "image/png" }
  );
  Object.defineProperty(file, "name", { value: "unit-photo.png" });
  return file as unknown as File;
}

async function deleteMediaDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(MEDIA_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("تعذر تنظيف قاعدة وسائط الاختبار."));
  });
}

async function mount() {
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <PrototypeProvider identity={IDENTITY}>
        <UnitDialogs />
      </PrototypeProvider>
    );
  });
}

beforeEach(async () => {
  localStorage.clear();
  await deleteMediaDatabase();
  vi.stubGlobal("Blob", NodeBlob);
  let url = 0;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:unit-photo-${++url}`),
    revokeObjectURL: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  await mount();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host.remove();
  root = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  await deleteMediaDatabase();
});

describe("unit photo durability through descriptive saves", () => {
  it("keeps the first local unit photo after updateDescribedUnit and a context reload", async () => {
    await act(async () => buttonWith("فتح صور الوحدة").click());
    const details = dialogFor("تفاصيل الوحدة");
    const fileInput = details.querySelector<HTMLInputElement>(
      'input[type="file"]'
    )!;

    await act(async () => {
      inputFiles(fileInput, [validPng()]);
      await settle();
    });
    await waitFor(() => {
      expect(
        parsePhotoGallery(api.find("units", "u-b1")?.meta.photoGallery).ids
      ).toHaveLength(1);
    });
    const photoId = parsePhotoGallery(
      api.find("units", "u-b1")?.meta.photoGallery
    ).ids[0]!;
    const storageKey = api.identity.storageKey;
    const stored = await loadPropertyPhotoById(storageKey, photoId);
    expect(stored).toBeInstanceOf(Blob);
    expect(stored).toMatchObject({ size: 9, type: "image/png" });

    await act(async () => buttonWith("إغلاق", details).click());
    await act(async () => {
      await api.commitAssetTransition(current =>
        updateDescribedUnit(current, "u-b1", {
          description: "وصف محفوظ بجانب الصورة المحلية",
        })
      );
    });
    await waitFor(() => {
      expect(api.find("units", "u-b1")?.meta.description).toBe(
        "وصف محفوظ بجانب الصورة المحلية"
      );
    });
    expect(
      parsePhotoGallery(api.find("units", "u-b1")?.meta.photoGallery).ids
    ).toEqual([photoId]);

    const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as {
      snapshot?: {
        entities?: {
          units?: Array<{
            id: string;
            meta?: { photoGallery?: unknown };
          }>;
        };
      };
    };
    const durableUnit = envelope.snapshot?.entities?.units?.find(
      row => row.id === "u-b1"
    );
    expect(parsePhotoGallery(durableUnit?.meta?.photoGallery).ids).toEqual([
      photoId,
    ]);

    await act(async () => root!.unmount());
    root = undefined;
    await mount();
    await act(async () => buttonWith("فتح صور الوحدة").click());
    const reopened = dialogFor("تفاصيل الوحدة");
    await waitFor(() => {
      expect(
        parsePhotoGallery(api.find("units", "u-b1")?.meta.photoGallery).ids
      ).toEqual([photoId]);
      expect(reopened.querySelector("img")?.getAttribute("src")).toMatch(
        /^blob:unit-photo-\d+$/
      );
    });
    expect(reopened.textContent).toContain("unit-photo.png");
  });
});
