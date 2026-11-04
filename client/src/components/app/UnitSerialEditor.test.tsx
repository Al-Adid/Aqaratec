// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { UnitSerialEditor } from "./UnitSerialEditor";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
let unitId = "";
let propertyId = "";

function Harness() {
  api = usePrototype();
  const unit = api.state.entities.units.find(row => row.id === unitId);
  return unit ? <UnitSerialEditor unit={unit} /> : null;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  localStorage.clear();
  unitId = "";
  propertyId = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    );
  });
  await act(async () => {
    const property = api.createRentalProperty({
      title: "فيلا الصخامة 1",
      portfolioId: "family",
      assetType: "villa",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
      propertyNumber: "V-001",
      requestId: "unit-serial-editor-test",
    });
    propertyId = property.id;
  });
  await act(async () => {
    unitId = api.state.entities.units.find(
      unit => unit.propertyId === propertyId
    )!.id;
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("UnitSerialEditor", () => {
  it("prefills and saves a local serial through commitTransition while explaining its limits", async () => {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      row => row.textContent?.includes("تعديل رقم/رمز الوحدة")
    )!;
    expect(button).toBeTruthy();
    expect(host.textContent).not.toContain("فيلا الصخامة 1 · U-01");

    await act(async () => button.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("V-001 · U-01");
    expect(dialog.textContent).toContain("ليس رقمًا حكوميًا");
    expect(dialog.textContent).toContain("المستندات التاريخية الصادرة");

    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe("U-01");
    await act(async () => setInput(input, "  0009  "));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    const updated = api.state.entities.units.find(row => row.id === unitId)!;
    expect(updated.meta).toMatchObject({ unitCode: "0009", code: "0009" });
    expect(api.state.audit[0].title).toContain("V-001 · 0009");
  });

  it("is disabled for a read-only preview", async () => {
    await act(async () => api.setSetting("role", "owner"));
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      row => row.textContent?.includes("تعديل رقم/رمز الوحدة")
    )!;
    expect(button.disabled).toBe(true);
  });
});
