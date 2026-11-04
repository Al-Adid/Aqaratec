// @vitest-environment jsdom
import { prototypeWorkspaceStorageKey } from "@/lib/prototype-workspace-storage";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { BillingPage } from "./BillingPage";
import { getBillingView } from "@/lib/prototype-billing";
import { toMinor } from "@shared/prototype";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, api: ReturnType<typeof usePrototype>;
function Harness() {
  api = usePrototype();
  return <BillingPage />;
}
beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(window, "print").mockImplementation(() => {});
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
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(b =>
    b.textContent?.includes(label)
  )!;
async function click(label: string) {
  expect(button(label)).toBeTruthy();
  await act(async () => button(label).click());
}
function field(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label'),
  ].find(l => l.querySelector("span")?.textContent?.trim().startsWith(label));
  expect(found).toBeTruthy();
  return found!.querySelector<HTMLInputElement | HTMLSelectElement>(
    "input,select"
  )!;
}
async function set(label: string, value: string) {
  const f = field(label);
  const proto =
    f instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(f, value);
  await act(async () =>
    f.dispatchEvent(
      new Event(f instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    )
  );
}
async function closePreview() {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="إغلاق المعاينة"]')
      ?.click()
  );
}
async function newInvoice() {
  await click("إصدار فاتورة");
  await set("المحفظة", "family");
  await set("العقار", "villa");
  await set("الطرف", "مستأجر صوري");
  await set("الوصف", "إيجار تجريبي");
  await set("سعر الوحدة", "500");
}
describe("billing issue and cash payment real UI", () => {
  it("issues one due invoice on double submit, then a partial cash receipt and print", async () => {
    const arBefore = api.state.entities.receivables.length;
    const cashBefore = api.state.entities.collections.length;
    await newInvoice();
    const form = document.querySelector<HTMLFormElement>(
      '[role="dialog"] form'
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    const docs = api.state.entities.documents.filter(
      d => d.meta.recordType === "billing-document"
    );
    expect(docs).toHaveLength(1);
    expect(api.state.entities.receivables).toHaveLength(arBefore + 1);
    expect(api.state.entities.collections).toHaveLength(cashBefore);
    expect(document.body.textContent).toContain("مستحق الدفع");
    expect(
      api.state.audit.filter(a => a.title.startsWith("إصدار:"))
    ).toHaveLength(1);
    await click("طباعة / حفظ PDF");
    expect(window.print).toHaveBeenCalledTimes(1);
    await closePreview();
    await click("تسجيل سداد");
    await set("مبلغ السداد", "100");
    await set("الوسيلة", "نقد");
    await click("تسجيل السداد محليًا");
    const view = getBillingView(api.state.entities, docs[0]);
    expect(view.collectedMinor).toBe(toMinor("100"));
    expect(view.remainingMinor).toBe(toMinor("500") - toMinor("100"));
    expect(view.status).toBe("مدفوع جزئيًا");
    expect(api.state.entities.collections).toHaveLength(cashBefore + 1);
    expect(document.body.textContent).toContain("سند قبض RCP");
    expect(
      JSON.parse(
        localStorage.getItem(prototypeWorkspaceStorageKey())!
      ).snapshot.entities.documents.some((d: { id: string }) => d.id === docs[0].id)
    ).toBe(true);
  });
  it("issues an LPO without any cash, expense, or tenant receivable", async () => {
    const ar = api.state.entities.receivables.length,
      expenses = api.state.entities.expenses.length,
      cash = api.state.entities.collections.length;
    const vendor = api.state.entities.vendors[0];
    await click("أمر شراء LPO");
    await set("المحفظة", vendor.portfolioId);
    await set("المورد", vendor.id);
    await set("الوصف", "طلب عرض صوري");
    await set("سعر الوحدة", "250");
    const form = document.querySelector<HTMLFormElement>(
      '[role="dialog"] form'
    )!;
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    );
    expect(api.state.entities.documents.some(d => d.meta.kind === "lpo")).toBe(
      true
    );
    expect(api.state.entities.receivables).toHaveLength(ar);
    expect(api.state.entities.expenses).toHaveLength(expenses);
    expect(api.state.entities.collections).toHaveLength(cash);
    expect(document.body.textContent).toContain("أمر شراء LPO");
  });
  it("allows reading but blocks issue and settlement in owner preview", async () => {
    await act(async () => api.setSetting("role", "owner"));
    expect(button("إصدار فاتورة").disabled).toBe(true);
    expect(button("مطالبة بالدفع").disabled).toBe(true);
    expect(button("أمر شراء LPO").disabled).toBe(true);
    expect(document.body.textContent).toContain("للقراءة والطباعة فقط");
  });
});
