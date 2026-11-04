// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import type { PropertyMediaDescriptor } from "@shared/property-media-types";
import type { DemoEntity } from "@shared/prototype";

const media = vi.hoisted(() => ({
  validate: vi.fn<() => Promise<void>>(),
  store: vi.fn(),
  load: vi.fn(),
  discard: vi.fn<() => Promise<void>>(),
  parse: vi.fn(),
}));
const engine = vi.hoisted(() => ({
  attach: vi.fn(),
  getCase: vi.fn(),
}));

vi.mock("@/lib/property-media", () => ({
  validatePropertyMediaFile: media.validate,
  storePropertyMedia: media.store,
  loadPropertyMedia: media.load,
  discardPropertyMedia: media.discard,
  parsePropertyMedia: media.parse,
}));
vi.mock("@/lib/letting-engine", () => ({
  attachLettingDocument: engine.attach,
  getLettingCase: engine.getCase,
}));

import { LettingAttachments } from "./LettingAttachments";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function descriptor(
  overrides: Partial<PropertyMediaDescriptor> = {}
): PropertyMediaDescriptor {
  return {
    id: "fresh-file-12345678",
    name: "test-document.pdf",
    mime: "application/pdf",
    size: 10,
    ...overrides,
  } as PropertyMediaDescriptor;
}

function emptyCase() {
  return { documents: [] };
}

function attachmentDocument(): DemoEntity {
  return {
    id: "document-12345678",
    title: "مرفق تجريبي",
    subtitle: "",
    portfolioId: "portfolio",
    propertyId: "property",
    status: "",
    date: "2026-10-25",
    amountMinor: 0,
    currency: "QAR",
    meta: {
      kind: "identity",
      mediaKind: "plan",
      fileManifest: JSON.stringify({ v: 1, plan: descriptor() }),
    },
  };
}

function select(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  media.validate.mockResolvedValue(undefined);
  media.store.mockResolvedValue(descriptor());
  media.load.mockResolvedValue(null);
  media.discard.mockResolvedValue(undefined);
  media.parse.mockImplementation((value: unknown) => JSON.parse(String(value)));
  engine.getCase.mockImplementation(emptyCase);
  engine.attach.mockImplementation((state: unknown) => ({ state, result: {} }));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:letting-attachment"),
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

describe("LettingAttachments", () => {
  it("rejects files above the common 5 MiB limit before validation or storage", async () => {
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <LettingAttachments applicationId="app-12345678" kinds={["credit"]} />
        </PrototypeProvider>
      )
    );
    const file = new File(["pdf"], "large-test.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
    await act(async () => {
      select(file);
      await Promise.resolve();
    });
    expect(host.textContent).toContain("5 ميغابايت");
    expect(media.validate).not.toHaveBeenCalled();
    expect(media.store).not.toHaveBeenCalled();
    expect(engine.attach).not.toHaveBeenCalled();
  });
  it("keeps a selected document pending until the user explicitly saves it", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <LettingAttachments
            applicationId="app-12345678"
            kinds={["identity"]}
          />
        </PrototypeProvider>
      );
    });
    const file = new File(["pdf"], "identity-test.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      select(file);
      await Promise.resolve();
    });

    expect(media.validate).toHaveBeenCalledWith(file, "plan");
    expect(media.store).not.toHaveBeenCalled();
    expect(engine.attach).not.toHaveBeenCalled();
    expect(host.textContent).toContain("استخدم مستندات تجريبية فقط");
    expect(host.textContent).toContain("identity-test.pdf");

    const save = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("حفظ المرفق")
    )!;
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(media.store).toHaveBeenCalledWith(expect.any(String), "plan", file);
    expect(engine.attach).toHaveBeenCalledWith(expect.anything(), {
      requestId: expect.stringContaining(
        "letting-attachment-app-12345678-identity"
      ),
      applicationId: "app-12345678",
      kind: "identity",
      descriptor: descriptor(),
    });
    expect(media.discard).not.toHaveBeenCalled();
  });

  it("cleans only the fresh descriptor when core attachment validation rejects it", async () => {
    engine.attach.mockImplementationOnce(() => {
      throw new Error("رفض المحرك المرفق التجريبي");
    });
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <LettingAttachments
            applicationId="app-12345678"
            kinds={["identity"]}
          />
        </PrototypeProvider>
      );
    });
    await act(async () => {
      select(
        new File(["pdf"], "identity-test.pdf", { type: "application/pdf" })
      );
      await Promise.resolve();
    });
    const save = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("حفظ المرفق")
    )!;
    await act(async () => {
      save.click();
      await Promise.resolve();
    });

    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "fresh-file-12345678"
    );
    expect(host.textContent).toContain("رفض المحرك");
  });

  it("cleans a new local descriptor when permission is lost while storage is pending", async () => {
    let resolveStore!: (value: PropertyMediaDescriptor) => void;
    media.store.mockImplementationOnce(
      () =>
        new Promise<PropertyMediaDescriptor>(resolve => {
          resolveStore = resolve;
        })
    );
    let api: ReturnType<typeof usePrototype>;
    function Capture() {
      api = usePrototype();
      return (
        <LettingAttachments applicationId="app-12345678" kinds={["identity"]} />
      );
    }
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture />
        </PrototypeProvider>
      );
    });
    await act(async () => {
      select(
        new File(["pdf"], "identity-test.pdf", { type: "application/pdf" })
      );
      await Promise.resolve();
    });
    const save = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("حفظ المرفق")
    )!;
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await act(async () => {
      api!.setSetting("role", "owner");
    });
    await act(async () => {
      resolveStore(descriptor({ id: "permission-lost-12345678" }));
      await Promise.resolve();
    });

    expect(engine.attach).not.toHaveBeenCalled();
    expect(media.discard).toHaveBeenCalledWith(
      expect.any(String),
      "permission-lost-12345678"
    );
  });

  it("retains a filename but states plainly when this device has no matching local blob", async () => {
    engine.getCase.mockReturnValue({ documents: [attachmentDocument()] });
    media.load.mockResolvedValue(null);
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <LettingAttachments
            applicationId="app-12345678"
            kinds={["identity"]}
          />
        </PrototypeProvider>
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("test-document.pdf");
    expect(host.textContent).toContain("الملف غير متاح في هذا المتصفح");
    expect(host.querySelector("img")).toBeNull();
  });
});
