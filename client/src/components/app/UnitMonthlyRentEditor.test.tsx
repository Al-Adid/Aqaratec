// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { UnitMonthlyRentEditor } from "./UnitMonthlyRentEditor";

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
  return unit ? (
    <UnitMonthlyRentEditor unit={unit} inheritedMonthlyRentMinor={90_000} />
  ) : null;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent?.includes(label)
  );
  expect(found).toBeTruthy();
  return found!;
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
      title: "عمارة محرر الإيجار",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
      monthlyRent: "900",
      requestId: "unit-monthly-rent-editor-test",
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

describe("UnitMonthlyRentEditor", () => {
  it("saves an Arabic QAR override, shows validation errors, then clears back to inheritance", async () => {
    await act(async () => button("تعديل الإيجار الشهري").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("900 ر.ق");
    const input = dialog.querySelector<HTMLInputElement>("input")!;

    await act(async () => setInput(input, "0"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "موجب"
    );

    await act(async () => setInput(input, "١٬٢٣٤٫٥٠"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      api.state.entities.units.find(row => row.id === unitId)?.meta
        .monthlyRentMinor
    ).toBe(123_450);

    await act(async () => button("تعديل الإيجار الشهري").click());
    const clearDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const clearInput = clearDialog.querySelector<HTMLInputElement>("input")!;
    await act(async () => setInput(clearInput, ""));
    await act(async () =>
      clearDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      api.state.entities.units.find(row => row.id === unitId)?.meta
        .monthlyRentMinor
    ).toBeUndefined();
    expect(
      api.state.entities.properties.find(row => row.id === propertyId)?.meta
        .unitMonthlyRentMinor
    ).toBe(90_000);
  });

  it("disables the editor for a read-only role", async () => {
    await act(async () => api.setSetting("role", "owner"));
    expect(button("تعديل الإيجار الشهري").disabled).toBe(true);
  });
});
