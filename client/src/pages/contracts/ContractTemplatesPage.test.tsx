// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { ContractTemplatesPage } from "./ContractTemplatesPage";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, api: ReturnType<typeof usePrototype>;
function Harness() {
  api = usePrototype();
  return <ContractTemplatesPage />;
}
const content =
  "نص صوري للتعبئة فقط\nاسم: {{الاسم}}\nعقار: {{رقم_العقار}}\nكهرباء: {{رقم_الكهرباء}}\nنوع: {{نوع_العقار}}";
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
async function click(label: string) {
  const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    b => b.textContent?.includes(label)
  );
  expect(b).toBeTruthy();
  await act(async () => b!.click());
}
async function set(label: string, value: string) {
  const l = [
    ...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label'),
  ].find(l => l.querySelector("span")?.textContent?.trim().startsWith(label));
  expect(l).toBeTruthy();
  const f = l!.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input,select,textarea")!;
  const proto =
    f instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : f instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
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
describe("template lease actual form integration", () => {
  it("generatesoneescapedimmutablewholepropertydraft fromfour values, notARorcash", async () => {
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "فيلا صورية لقالب",
        portfolioId: "family",
        assetType: "villa",
        rentalMode: "whole",
        unitCount: "1",
        inputMethod: "يدوي",
        propertyNumber: "00001",
        electricityNumber: "000002",
        requestId: "whole-template-test",
      }).id;
      api.saveLeaseTemplate({
        requestId: "template-test",
        name: "نموذج صوري",
        content,
        defaultRentMinor: 0,
        defaultTermMonths: 0,
      });
    });
    const before = {
      dues: api.state.entities.receivables.length,
      cash: api.state.entities.collections.length,
      leases: api.state.entities.leases.length,
    };
    await click("إنشاء مسودة");
    await set("سياق العقار", propertyId);
    await set("اسم المستأجر", "اسم اختبار <script>");
    expect(document.body.textContent).toContain("العقار كاملاً");
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
    expect(api.state.entities.leases.length).toBe(before.leases + 1);
    expect(api.state.entities.receivables.length).toBe(before.dues);
    expect(api.state.entities.collections.length).toBe(before.cash);
    const lease = api.state.entities.leases.at(-1)!;
    expect(lease.meta.propertyNumber).toBe("00001");
    expect(lease.status).toBe("مسودة");
    expect(document.body.textContent).toContain("اسم اختبار <script>");
    expect(document.querySelector("script")).toBeNull();
    await click("طباعة / حفظ PDF عبر المتصفح");
    expect(window.print).toHaveBeenCalledOnce();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("cancels a template draft without addingdocuments andreadOnlycannotopenediting", async () => {
    const count = api.state.entities.documents.length;
    await click("إضافة قالب");
    await set("اسم القالب", "لم نحفظه");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(api.state.entities.documents.length).toBe(count);
    await act(async () => api.setSetting("role", "owner"));
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(b =>
        b.textContent?.includes("إضافة قالب")
      )!.disabled
    ).toBe(true);
  });
});
