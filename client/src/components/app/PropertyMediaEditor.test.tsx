// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import type {
  PropertyMediaDescriptor,
  PropertyMediaManifest,
} from "@shared/property-media-types";

const media = vi.hoisted(() => ({
  validate: vi.fn<() => Promise<void>>(),
  store: vi.fn(),
  load: vi.fn(),
  loadById: vi.fn(),
  lookup: vi.fn(),
  discard: vi.fn<() => Promise<void>>(),
  createId: vi.fn(),
  makeDescriptor: vi.fn(),
}));

vi.mock("@/lib/property-media", () => ({
  parsePropertyMedia(value: unknown): PropertyMediaManifest {
    if (!value) return { v: 1 };
    return JSON.parse(String(value)) as PropertyMediaManifest;
  },
  serializePropertyMedia(manifest: PropertyMediaManifest) {
    return manifest.photo ||
      manifest.plan ||
      manifest.photoIds?.length ||
      manifest.planIds?.length ||
      manifest.video ||
      manifest.videoUrl
      ? JSON.stringify(manifest)
      : "";
  },
  validatePropertyMediaFile: media.validate,
  storePropertyMedia: media.store,
  loadPropertyMedia: media.load,
  loadPropertyMediaById: media.loadById,
  lookupPropertyMedia: media.lookup,
  discardPropertyMedia: media.discard,
  createPropertyMediaId: media.createId,
  makePropertyMediaDescriptor: media.makeDescriptor,
  isPropertyMediaImage: (mime: string) => /^image\//.test(mime),
}));

import {
  PropertyMediaEditor,
  type PropertyMediaEditorHandle,
} from "./PropertyMediaEditor";
import { PropertyMediaDisplay } from "./PropertyMediaDisplay";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let createUrl: ReturnType<typeof vi.fn>;
let idSequence = 0;

function descriptor(
  overrides: Partial<PropertyMediaDescriptor> = {}
): PropertyMediaDescriptor {
  return {
    id: "media-12345678",
    name: "villa.png",
    mime: "image/png",
    size: 4,
    ...overrides,
  } as PropertyMediaDescriptor;
}

function descriptorFor(
  id: string,
  file: File,
  kind: "photo" | "plan" | "video"
): PropertyMediaDescriptor {
  return descriptor({
    id,
    name: file.name,
    mime:
      kind === "video"
        ? (file.type as "video/mp4" | "video/webm")
        : kind === "plan" && file.type === "application/pdf"
          ? "application/pdf"
          : "image/png",
    size: file.size,
  });
}

function select(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const MEDIA_INPUTS = {
  photo: "اختيار صور العقار",
  plan: "اختيار المخططات والخرائط",
  video: "اختيار فيديو العقار",
} as const;

const ADD_MEDIA_BUTTONS = {
  photo: "إضافة صور العقار",
  plan: "إضافة مخططات وخرائط",
  video: "إضافة فيديو العقار",
} as const;

function inputFor(kind: keyof typeof MEDIA_INPUTS): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="${MEDIA_INPUTS[kind]}"]`
  );
  if (!input) throw new Error(`لم يوجد مدخل ${MEDIA_INPUTS[kind]}`);
  return input;
}

function slotFor(kind: keyof typeof MEDIA_INPUTS): HTMLElement {
  const slot = inputFor(kind).closest<HTMLElement>(".property-media-slot");
  if (!slot) throw new Error(`لم توجد بطاقة ${kind}`);
  return slot;
}

async function settleMediaSelection() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  idSequence = 0;
  media.validate.mockResolvedValue(undefined);
  media.createId.mockImplementation(() => `pending-media-${++idSequence}`);
  media.makeDescriptor.mockImplementation(descriptorFor);
  media.store.mockImplementation(
    (
      _scope: string,
      kind: "photo" | "plan" | "video",
      file: File,
      id: string
    ) => Promise.resolve(descriptorFor(id, file, kind))
  );
  media.load.mockResolvedValue(null);
  media.loadById.mockResolvedValue(null);
  media.lookup.mockResolvedValue(null);
  media.discard.mockResolvedValue(undefined);
  createUrl = vi.fn(() => `blob:property-media-test-${idSequence}`);
  vi.stubGlobal("URL", {
    createObjectURL: createUrl,
    revokeObjectURL: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Property media components", () => {
  it("delegates each labelled add button to its hidden file input without submitting its form", async () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <form onSubmit={onSubmit}>
            <PropertyMediaEditor value="" onChange={vi.fn()} />
          </form>
        </PrototypeProvider>
      );
    });

    for (const kind of ["photo", "plan", "video"] as const) {
      const input = inputFor(kind);
      const button = Array.from(host.querySelectorAll("button")).find(
        candidate => candidate.textContent?.trim() === ADD_MEDIA_BUTTONS[kind]
      );
      expect(button).toBeTruthy();
      expect(button?.type).toBe("button");
      expect(input.hidden).toBe(true);

      const click = vi.spyOn(input, "click");
      await act(async () => button!.click());
      expect(click).toHaveBeenCalledOnce();
      click.mockRestore();
    }

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the required accept and multiple contracts in the three empty media cards", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor value="" onChange={vi.fn()} />
        </PrototypeProvider>
      );
    });

    const photo = inputFor("photo");
    const plan = inputFor("plan");
    const video = inputFor("video");
    expect(photo.accept).toBe(
      ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
    );
    expect(plan.accept).toBe(
      ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
    );
    expect(video.accept).toBe(".mp4,.webm,video/mp4,video/webm");
    expect(photo.multiple).toBe(true);
    expect(plan.multiple).toBe(true);
    expect(video.multiple).toBe(false);

    expect(host.querySelectorAll(".property-media-slot")).toHaveLength(3);
    for (const kind of ["photo", "plan", "video"] as const) {
      const slot = slotFor(kind);
      expect(slot.querySelector(".property-media-count")?.textContent).toMatch(
        /(?:0|صفر)/
      );
      expect(slot.querySelector(".property-media-empty")).not.toBeNull();
    }
    expect(slotFor("video").querySelector('input[type="url"]')).not.toBeNull();
  });

  it("does not allow adding media when disabled or in owner preview mode", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor disabled value="" onChange={vi.fn()} />
        </PrototypeProvider>
      );
    });
    for (const kind of ["photo", "plan", "video"] as const) {
      expect(inputFor(kind).disabled).toBe(true);
      const button = Array.from(host.querySelectorAll("button")).find(
        candidate => candidate.textContent?.trim() === ADD_MEDIA_BUTTONS[kind]
      );
      expect(button?.disabled).toBe(true);
    }
    await act(async () => {
      select(inputFor("photo"), [
        new File(["disabled"], "disabled.png", { type: "image/png" }),
      ]);
      await settleMediaSelection();
    });
    expect(media.validate).not.toHaveBeenCalled();
    expect(media.store).not.toHaveBeenCalled();

    let prototype: ReturnType<typeof usePrototype>;
    function OwnerCapture() {
      prototype = usePrototype();
      return <PropertyMediaEditor value="" onChange={vi.fn()} />;
    }
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <OwnerCapture />
        </PrototypeProvider>
      );
    });
    await act(async () => {
      prototype!.setSetting("role", "owner");
      await Promise.resolve();
    });

    expect(inputFor("photo").disabled).toBe(true);
    const ownerButton = Array.from(host.querySelectorAll("button")).find(
      candidate => candidate.textContent?.trim() === ADD_MEDIA_BUTTONS.photo
    );
    expect(ownerButton?.disabled).toBe(true);
    await act(async () => {
      select(inputFor("photo"), [
        new File(["owner"], "owner.png", { type: "image/png" }),
      ]);
      await settleMediaSelection();
    });
    expect(media.validate).not.toHaveBeenCalled();
    expect(media.store).not.toHaveBeenCalled();
  });

  it("shows pending image, PDF, and MP4 previews without writing media before prepare", async () => {
    const ref = { current: null as PropertyMediaEditorHandle | null };
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor ref={ref} value="" onChange={onChange} />
        </PrototypeProvider>
      );
    });

    await act(async () => {
      select(inputFor("photo"), [
        new File(["photo"], "preview.png", { type: "image/png" }),
      ]);
      select(inputFor("plan"), [
        new File(["plan"], "plan.pdf", { type: "application/pdf" }),
      ]);
      select(inputFor("video"), [
        new File(["video"], "tour.mp4", { type: "video/mp4" }),
      ]);
      await settleMediaSelection();
    });

    expect(media.validate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "preview.png" }),
      "photo"
    );
    expect(media.validate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "plan.pdf" }),
      "plan"
    );
    expect(media.validate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tour.mp4" }),
      "video"
    );
    expect(media.store).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain("بانتظار الحفظ");
    expect(host.querySelector("img.property-media-preview")?.getAttribute("src")).toContain(
      "blob:"
    );
    const pdfPreview = Array.from(host.querySelectorAll("a")).find(anchor =>
      anchor.textContent?.includes("PDF")
    );
    expect(pdfPreview?.getAttribute("href")).toContain("blob:");
    expect(host.querySelector("video.property-media-preview")?.getAttribute("src")).toContain(
      "blob:"
    );
    expect(ref.current).not.toBeNull();
  });

  it.each(["photo", "plan"] as const)(
    "counts a legacy %s when rejecting an additional full-cap group",
    async kind => {
      const onChange = vi.fn();
      const legacy = descriptor({
        id: `legacy-${kind}-12345678`,
        name: kind === "photo" ? "old.png" : "old.pdf",
        mime: kind === "photo" ? "image/png" : "application/pdf",
      });
      await act(async () =>
        root.render(
          <PrototypeProvider>
            <PropertyMediaEditor
              value={JSON.stringify({ v: 1, [kind]: legacy })}
              onChange={onChange}
            />
          </PrototypeProvider>
        )
      );
      const inputs =
        host.querySelectorAll<HTMLInputElement>('input[type="file"]');
      const count = kind === "photo" ? 20 : 10;
      const files = Array.from(
        { length: count },
        (_, index) =>
          new File(
            ["fixture"],
            `${index}.${kind === "photo" ? "png" : "pdf"}`,
            { type: kind === "photo" ? "image/png" : "application/pdf" }
          )
      );
      await act(async () => select(inputs[kind === "photo" ? 0 : 1], files));
      expect(media.validate).not.toHaveBeenCalled();
      expect(media.store).not.toHaveBeenCalled();
      expect(media.discard).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(host.textContent).toContain("لم يتغير الاختيار");
      expect(host.textContent).toContain(legacy.name);
    }
  );

  it("keeps selected multi-files in RAM until prepare, then rolls back only its fresh opaque descriptors", async () => {
    const ref = { current: null as PropertyMediaEditorHandle | null };
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor ref={ref} value="" onChange={onChange} />
        </PrototypeProvider>
      );
    });
    const inputs =
      host.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const photos = [
      new File(["png-a"], "new-villa-a.png", { type: "image/png" }),
      new File(["png-b"], "new-villa-b.png", { type: "image/png" }),
    ];
    await act(async () => {
      select(inputs[0], photos);
      await Promise.resolve();
    });

    expect(media.validate).toHaveBeenCalledWith(photos[0], "photo");
    expect(media.validate).toHaveBeenCalledWith(photos[1], "photo");
    expect(media.store).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain("new-villa-a.png");
    expect(host.textContent).toContain("new-villa-b.png");

    let prepared = "";
    await act(async () => {
      prepared = await ref.current!.prepare();
    });
    const parsed = JSON.parse(prepared) as PropertyMediaManifest;
    expect(media.store).toHaveBeenCalledTimes(2);
    expect(parsed.photoIds).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      await ref.current!.rollback();
    });
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      parsed.photoIds![0]
    );
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      parsed.photoIds![1]
    );
  });

  it("cancels one pending item in a selected group without writing any IDB bytes", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor value="" onChange={vi.fn()} />
        </PrototypeProvider>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      select(input, [
        new File(["one"], "one.png", { type: "image/png" }),
        new File(["two"], "two.png", { type: "image/png" }),
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });
    const cancel = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("إلغاء هذا الملف")
    )!;
    await act(async () => cancel.click());
    expect(host.textContent).not.toContain("one.png");
    expect(host.textContent).toContain("two.png");
    expect(media.store).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("does not discard an incoming legacy cover when rolling back a fresh selection", async () => {
    const ref = { current: null as PropertyMediaEditorHandle | null };
    const incoming = descriptor({
      id: "incoming-cover-123456",
      name: "cover.png",
    });
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor
            ref={ref}
            value={JSON.stringify({ v: 1, photo: incoming })}
            onChange={vi.fn()}
          />
        </PrototypeProvider>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      select(input, [new File(["new"], "new.png", { type: "image/png" })]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await ref.current!.prepare();
      await ref.current!.rollback();
    });
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "pending-media-1"
    );
    expect(media.discard).not.toHaveBeenCalledWith(
      expect.any(String),
      incoming.id
    );
  });

  it("discards fresh files when a later plan cannot be stored, without partial metadata", async () => {
    const ref = { current: null as PropertyMediaEditorHandle | null };
    media.store
      .mockImplementationOnce(
        (
          _scope: string,
          kind: "photo" | "plan" | "video",
          file: File,
          id: string
        ) => Promise.resolve(descriptorFor(id, file, kind))
      )
      .mockRejectedValueOnce(new Error("تعذر حفظ المخطط."));
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaEditor ref={ref} value="" onChange={vi.fn()} />
        </PrototypeProvider>
      );
    });
    const inputs =
      host.querySelectorAll<HTMLInputElement>('input[type="file"]');
    await act(async () => {
      select(inputs[0], [
        new File(["photo"], "photo.png", { type: "image/png" }),
      ]);
      select(inputs[1], [
        new File(["plan"], "plan.pdf", { type: "application/pdf" }),
      ]);
      await Promise.resolve();
    });
    await act(async () => {
      await expect(ref.current!.prepare()).rejects.toThrow("تعذر حفظ المخطط.");
    });
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "pending-media-1"
    );
  });

  it("cleans a new local descriptor when edit permission is lost while storage is pending", async () => {
    const ref = { current: null as PropertyMediaEditorHandle | null };
    let api: ReturnType<typeof usePrototype>;
    let resolveStore!: () => void;
    media.store.mockImplementationOnce(
      (
        _scope: string,
        kind: "photo" | "plan" | "video",
        file: File,
        id: string
      ) =>
        new Promise<PropertyMediaDescriptor>(resolve => {
          resolveStore = () => resolve(descriptorFor(id, file, kind));
        })
    );
    function Capture() {
      api = usePrototype();
      return <PropertyMediaEditor ref={ref} value="" onChange={vi.fn()} />;
    }
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture />
        </PrototypeProvider>
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      select(input, [new File(["png"], "pending.png", { type: "image/png" })]);
      await Promise.resolve();
    });
    let operation!: Promise<string>;
    await act(async () => {
      operation = ref.current!.prepare();
      void operation.catch(() => {});
      await Promise.resolve();
    });
    await act(async () => {
      api!.setSetting("role", "owner");
    });
    await act(async () => {
      resolveStore();
      await expect(operation).rejects.toThrow("تغيّر");
    });
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "pending-media-1"
    );
  });

  it("walks multi-file opaque IDs and a local video in the shared reader without inventing remote files", async () => {
    const photoId = "photo-array-12345678";
    const planId = "plan-array-12345678";
    const video = descriptor({
      id: "video-file-12345678",
      name: "tour.webm",
      mime: "video/webm",
      size: 12,
    });
    media.lookup.mockImplementation(
      (_scope: string, id: string, kind: "photo" | "plan" | "video") =>
        Promise.resolve(
          descriptor({
            id,
            name: `${kind}-${id}.png`,
            mime: kind === "plan" ? "application/pdf" : "image/png",
            size: 12,
          })
        )
    );
    media.loadById.mockResolvedValue(
      new Blob(["local"], { type: "image/png" })
    );
    media.load.mockResolvedValue(new Blob(["video"], { type: "video/webm" }));
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaDisplay
            title="عقار الاختبار"
            value={JSON.stringify({
              v: 1,
              photoIds: [photoId],
              planIds: [planId],
              video,
              videoUrl: "https://videos.example.test/optional",
            })}
          />
        </PrototypeProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(media.lookup).toHaveBeenCalledWith(
      expect.any(String),
      photoId,
      "photo"
    );
    expect(media.lookup).toHaveBeenCalledWith(
      expect.any(String),
      planId,
      "plan"
    );
    expect(media.load).toHaveBeenCalledWith(expect.any(String), video, "video");
    expect(host.querySelector("video")?.getAttribute("src")).toContain("blob:");
    expect(host.textContent).toContain("لا يُجلب تلقائيًا");
  });

  it("uses the three media cards in the saved reader and states missing local blobs without fake previews", async () => {
    const photo = descriptor({
      id: "saved-photo-12345678",
      name: "old-photo.png",
      mime: "image/png",
    });
    const plan = descriptor({
      id: "saved-plan-12345678",
      name: "old-plan.pdf",
      mime: "application/pdf",
    });
    const video = descriptor({
      id: "saved-video-12345678",
      name: "old-tour.mp4",
      mime: "video/mp4",
    });
    const value = JSON.stringify({ v: 1, photo, plan, video });
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <PropertyMediaDisplay value={value} title="فيلا الاختبار" />
        </PrototypeProvider>
      );
      await settleMediaSelection();
    });
    expect(media.load).toHaveBeenCalledWith(expect.any(String), photo, "photo");
    expect(media.load).toHaveBeenCalledWith(expect.any(String), plan, "plan");
    expect(media.load).toHaveBeenCalledWith(expect.any(String), video, "video");
    expect(host.querySelectorAll(".property-media-slot")).toHaveLength(3);
    expect(host.textContent).toContain("old-photo.png");
    expect(host.textContent).toContain("old-plan.pdf");
    expect(host.textContent).toContain("old-tour.mp4");
    expect(host.querySelectorAll(".property-media-missing")).toHaveLength(3);
    expect(host.textContent).toContain("الملف غير متاح في هذا المتصفح؛ أعد إرفاقه");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
  });
});
