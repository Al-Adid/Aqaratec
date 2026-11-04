// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { WorkspaceStorageControls } from "./WorkspaceStorageControls";
import { loadPrototypeWorkspace } from "@/lib/prototype-workspace-storage";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  host: HTMLDivElement,
  api: ReturnType<typeof usePrototype>,
  download: Blob | null;
function Harness() {
  api = usePrototype();
  return <WorkspaceStorageControls />;
}
beforeEach(async () => {
  localStorage.clear();
  download = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (b: Blob) => {
      download = b;
      return "blob:qa";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("exports the real state, previews a raw JSON file, confirms into a new scope and retains original byte-for-byte", async () => {
  await act(async () => {
    api.add("tasks", { title: "صف مصطنع لحفظ المعرف", portfolioId: "family" });
    await api.retryLocalPersistence();
  });
  const oldKey = api.identity.storageKey,
    oldRaw = localStorage.getItem(oldKey),
    expected = structuredClone(api.state);
  const button = [...host.querySelectorAll("button")].find(b =>
    b.textContent?.includes("تصدير JSON")
  )!;
  await act(async () => button.click());
  expect(download).toBeTruthy();
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(download!);
  });
  expect(JSON.parse(raw)).toEqual(expected);
  const file = new File([raw], "qa-export.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => raw });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  expect(host.textContent).toContain("معاينة الاستعادة");
  expect(api.identity.storageKey).toBe(oldKey);
  const restore = [...host.querySelectorAll("button")].find(b =>
    b.textContent?.includes("تأكيد الاستعادة في مساحة جديدة")
  )!;
  await act(async () => restore.click());
  expect(api.identity.storageKey).not.toBe(oldKey);
  expect(localStorage.getItem(oldKey)).toBe(oldRaw);
  expect(api.state).toEqual(expected);
  const loaded = loadPrototypeWorkspace(localStorage, {
    userId: null,
    identityState: "guest",
    localWorkspaceId: api.identity.localWorkspaceId,
  });
  expect(loaded.kind).toBe("ready");
  if (loaded.kind !== "ready")
    throw new Error("validated restoration was not ready");
  expect(loaded.state).toEqual(expected);
});
