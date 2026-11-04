// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { AssetRemovalButton } from "./AssetRemovalButton";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, api: ReturnType<typeof usePrototype>;
function Capture() {
  api = usePrototype();
  const p = api.list("portfolios").find(r => r.title === "محفظة اختبار فارغة");
  return p ? (
    <AssetRemovalButton kind="portfolios" id={p.id} title={p.title} />
  ) : null;
}
beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Capture />
      </PrototypeProvider>
    )
  );
  await act(async () => {
    api.add("portfolios", {
      title: "محفظة اختبار فارغة",
      subtitle: "",
      portfolioId: "",
      propertyId: "",
      status: "نشطة",
      date: "2026-10-25",
      amountMinor: 0,
      currency: "QAR",
      meta: {},
    });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});
it("requires exact typed confirmation before atomic deletion", async () => {
  const id = api
    .list("portfolios")
    .find(p => p.title === "محفظة اختبار فارغة")!.id;
  await act(async () =>
    document.querySelector<HTMLButtonElement>("button")!.click()
  );
  const input = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input'
  )!;
  const change = (v: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => change("خطأ"));
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(api.find("portfolios", id)).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining("الاسم لا يطابق")
  );
  await act(async () => change("محفظة اختبار فارغة"));
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(api.find("portfolios", id)).toBeUndefined();
  expect(api.state.audit[0].title).toContain("حذف");
});
it("disables deletion in read-only role", async () => {
  await act(async () => api.setSetting("role", "owner"));
  expect(document.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
    true
  );
});
