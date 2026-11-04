// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import {
  loadPropertyMedia,
  loadPropertyMediaById,
  parsePropertyMedia,
  serializePropertyMedia,
  storePropertyMedia,
} from "@/lib/property-media";
import { PropertiesPage } from "./PortfolioPropertyPages";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MEDIA_DB = "sunnaa-property-media-v1";
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
let objectUrlSequence = 0;

class FakeIndexedDbFile extends NodeBlob {
  readonly name: string;

  constructor(parts: ArrayBuffer[], name: string, type: string) {
    super(parts, { type });
    this.name = name;
  }
}

function Capture() {
  api = usePrototype();
  return <PropertiesPage />;
}

function validPng(name: string) {
  return new FakeIndexedDbFile(
    [PNG_BYTES.buffer],
    name,
    "image/png"
  ) as unknown as File;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function rowFor(title: string) {
  const row = [...host.querySelectorAll<HTMLTableRowElement>("tbody tr")].find(
    candidate => candidate.textContent?.includes(title)
  );
  expect(row).toBeTruthy();
  return row!;
}

function savedProperty(id: string) {
  const property = api.state.entities.properties.find(row => row.id === id);
  expect(property).toBeTruthy();
  return property!;
}

function waitForTurn() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

async function settle() {
  for (let round = 0; round < 8; round += 1) {
    await Promise.resolve();
    await waitForTurn();
  }
}

async function clearMediaDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(MEDIA_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function openEdit(title: string) {
  const row = rowFor(title);
  const edit = [...row.querySelectorAll<HTMLButtonElement>("button")].find(
    button => button.textContent?.trim() === "تعديل العقار"
  );
  expect(edit).toBeTruthy();
  await act(async () => edit!.click());
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).toBeTruthy();
  return dialog!;
}

async function selectPhoto(dialog: HTMLElement, file: File) {
  const input = dialog.querySelector<HTMLInputElement>(
    '[aria-label="اختيار صور العقار"]'
  );
  expect(input).toBeTruthy();
  await act(async () => {
    Object.defineProperty(input!, "files", {
      configurable: true,
      value: [file],
    });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
  });
  expect(dialog.textContent).toContain(file.name);
}

async function submit(dialog: HTMLElement) {
  await act(async () => {
    dialog
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  });
}

async function createExistingProperty(title: string) {
  const existingPhoto = await storePropertyMedia(
    api.identity.storageKey,
    "photo",
    validPng("الصورة السابقة.png")
  );
  const propertyMedia = serializePropertyMedia({
    v: 1,
    photo: existingPhoto,
  });
  let id = "";
  await act(async () => {
    id = api.createRentalProperty({
      title,
      portfolioId: "family",
      assetType: "villa",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "whole",
      unitCount: "1",
      propertyMedia,
    }).id;
    await settle();
  });
  return { id, existingPhoto, propertyMedia };
}

beforeEach(async () => {
  localStorage.clear();
  await clearMediaDatabase();
  objectUrlSequence = 0;
  // fake-indexeddb structured-clones JSDOM File slices into Node Blob values.
  // The production reader checks `instanceof Blob`, so this fixture uses the
  // constructor associated with the persisted fake-IDB value.
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:property-photo-${++objectUrlSequence}`),
    revokeObjectURL: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PrototypeProvider>
        <Capture />
      </PrototypeProvider>
    );
    await settle();
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await clearMediaDatabase();
});

describe("property photo save through the real property dialog", () => {
  it("keeps prepared PNG references on an edited property and loads the local file after reopening", async () => {
    const original = await createExistingProperty("مجمع أم العمد");
    const dialog = await openEdit("مجمع أم العمد");
    const newPhoto = validPng("واجهة مجمع أم العمد.png");

    await act(async () => {
      setInput(
        dialog.querySelector<HTMLInputElement>('[name="title"]')!,
        "مجمع أم العمد المحدّث"
      );
    });
    await selectPhoto(dialog, newPhoto);
    await submit(dialog);

    const property = savedProperty(original.id);
    expect(property.title).toBe("مجمع أم العمد المحدّث");
    const manifest = parsePropertyMedia(property.meta.propertyMedia);
    expect(manifest.photo).toEqual(original.existingPhoto);
    expect(manifest.photoIds).toHaveLength(1);
    const freshPhotoId = manifest.photoIds![0];
    expect(property.meta.propertyMedia).toContain(freshPhotoId);
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    const reopened = await openEdit("مجمع أم العمد المحدّث");
    await act(async () => settle());
    expect(reopened.textContent).toContain(newPhoto.name);
    expect(
      reopened.querySelectorAll('img[alt="صورة العقار للعقار"]')
    ).toHaveLength(2);

    const stored = await loadPropertyMediaById(
      api.identity.storageKey,
      freshPhotoId,
      "photo"
    );
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(
      Array.from(PNG_BYTES)
    );
  });

  it("rolls back only a freshly prepared photo when the property commit fails", async () => {
    const original = await createExistingProperty("مجمع أم العمد · فشل الحفظ");
    const dialog = await openEdit("مجمع أم العمد · فشل الحفظ");
    await selectPhoto(dialog, validPng("صورة لا تعتمد.png"));

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key.startsWith("sunnaa-full-prototype-v2"))
        throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });

    await submit(dialog);

    const property = savedProperty(original.id);
    expect(property.meta.propertyMedia).toBe(original.propertyMedia);
    expect(
      await loadPropertyMedia(
        api.identity.storageKey,
        original.existingPhoto,
        "photo"
      )
    ).toBeInstanceOf(Blob);
    expect(dialog.textContent).toContain("تعذر الحفظ المحلي للعقار أو الوحدة");
  });
});
