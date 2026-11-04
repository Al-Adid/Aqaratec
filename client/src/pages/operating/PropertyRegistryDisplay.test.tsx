// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { PropertiesPage } from "./PortfolioPropertyPages";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

function Capture({ children }: { children: React.ReactNode }) {
  api = usePrototype();
  return <>{children}</>;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function expansionButton(title: string): HTMLButtonElement {
  const button = [
    ...host.querySelectorAll<HTMLButtonElement>("button[aria-controls]"),
  ].find(candidate => candidate.getAttribute("aria-label")?.includes(title));
  expect(button).toBeTruthy();
  return button!;
}

function physicalUnits(propertyId: string) {
  return api.state.entities.units.filter(
    unit => unit.propertyId === propertyId && unit.meta.wholeProperty !== true
  );
}

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PrototypeProvider>
        <Capture>
          <PropertiesPage />
        </Capture>
      </PrototypeProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("property registry inline physical units", () => {
  it("keeps independently expanded split properties stable through keyboard, search, sort, edit, and read-only state", async () => {
    let splitA = "";
    let splitB = "";
    let splitEmpty = "";
    let whole = "";

    await act(async () => {
      splitA = api.createRentalProperty({
        requestId: "registry-split-a",
        title: "مبنى توسعة ألف",
        portfolioId: "family",
        assetType: "building",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "units",
        unitCount: "2",
      }).id;
      splitB = api.createRentalProperty({
        requestId: "registry-split-b",
        title: "مبنى توسعة باء",
        portfolioId: "family",
        assetType: "building",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "units",
        unitCount: "2",
      }).id;
      splitEmpty = api.createRentalProperty({
        requestId: "registry-split-empty",
        title: "مبنى بلا وحدات",
        portfolioId: "family",
        assetType: "building",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "units",
        unitCount: "2",
      }).id;
      whole = api.createRentalProperty({
        requestId: "registry-whole",
        title: "فيلا تأجير كامل",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "whole",
        unitCount: "1",
      }).id;

      api.commitTransition(current => ({
        state: {
          ...current,
          entities: {
            ...current.entities,
            units: current.entities.units
              .filter(unit => unit.propertyId !== splitEmpty)
              .map(unit => {
                if (unit.propertyId !== splitA && unit.propertyId !== splitB)
                  return unit;
                const index = unit.propertyId === splitA ? "أ" : "ب";
                return {
                  ...unit,
                  title: `وحدة ${index} ${unit.meta.unitCode}`,
                  meta: {
                    ...unit.meta,
                    unitProfile: JSON.stringify({
                      v: 1,
                      category: "office",
                      areaM2: unit.propertyId === splitA ? 55 : 72.5,
                    }),
                  },
                };
              }),
          },
        },
        result: null,
      }));
    });

    const splitAUnits = physicalUnits(splitA);
    const splitBUnits = physicalUnits(splitB);
    expect(splitAUnits).toHaveLength(2);
    expect(splitBUnits).toHaveLength(2);
    expect(physicalUnits(whole)).toHaveLength(0);

    const aToggle = expansionButton("مبنى توسعة ألف");
    const bToggle = expansionButton("مبنى توسعة باء");
    const emptyToggle = expansionButton("مبنى بلا وحدات");
    expect(
      [
        ...host.querySelectorAll<HTMLButtonElement>("button[aria-controls]"),
      ].some(button =>
        button.getAttribute("aria-label")?.includes("فيلا تأجير كامل")
      )
    ).toBe(false);

    await act(async () => aToggle.click());
    await act(async () => bToggle.click());
    expect(aToggle.getAttribute("aria-expanded")).toBe("true");
    expect(bToggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain(splitAUnits[0].title);
    expect(host.textContent).toContain(splitBUnits[0].title);

    await act(async () =>
      aToggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    );
    expect(aToggle.getAttribute("aria-expanded")).toBe("false");
    expect(bToggle.getAttribute("aria-expanded")).toBe("true");

    await act(async () => emptyToggle.click());
    expect(host.textContent).toContain(
      "لا توجد وحدات فعلية مرتبطة بهذا العقار بعد."
    );

    const search = host.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!;
    await act(async () => setInput(search, "مبنى توسعة باء"));
    expect(bToggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => setInput(search, ""));
    expect(bToggle.getAttribute("aria-expanded")).toBe("true");

    const unitsSort = [
      ...host.querySelectorAll<HTMLButtonElement>(".property-sort-button"),
    ].find(button => button.textContent?.includes("الوحدات"))!;
    await act(async () => unitsSort.click());
    expect(
      expansionButton("مبنى توسعة باء").getAttribute("aria-expanded")
    ).toBe("true");

    const openB = host.querySelector<HTMLElement>(
      `#property-inline-units-${splitB}`
    )!;
    const edit = [...openB.querySelectorAll<HTMLButtonElement>("button")].find(
      button => button.textContent?.trim() === "تعديل الوحدة"
    )!;
    await act(async () => edit.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const title = dialog.querySelector<HTMLInputElement>("input")!;
    await act(async () => setInput(title, "وحدة باء بعد التعديل"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      api.state.entities.units.find(unit => unit.id === splitBUnits[0].id)
        ?.title
    ).toBe("وحدة باء بعد التعديل");
    expect(
      expansionButton("مبنى توسعة باء").getAttribute("aria-expanded")
    ).toBe("true");
    expect(host.textContent).toContain("وحدة باء بعد التعديل");

    await act(async () => api.setSetting("role", "owner"));
    const readonlyInline = host.querySelector<HTMLElement>(
      `#property-inline-units-${splitB}`
    )!;
    expect(
      [...readonlyInline.querySelectorAll<HTMLButtonElement>("button")].some(
        button => button.textContent?.trim() === "تعديل الوحدة"
      )
    ).toBe(false);
    expect(
      [...readonlyInline.querySelectorAll<HTMLButtonElement>("button")].some(
        button => button.textContent?.trim() === "عرض الوحدة"
      )
    ).toBe(true);
  });
});

it("keeps an inline unit editor and its draft open after durable storage failure", async () => {
  let id = "";
  await act(async () => {
    id = api.createRentalProperty({
      title: "فشل حفظ محلي",
      inputMethod: "يدوي",
      portfolioId: "family",
      assetType: "building",
      usageType: "commercial",
      rentalMode: "units",
      unitCount: "2",
    }).id;
  });
  await act(async () => expansionButton("فشل حفظ محلي").click());
  const inline = host.querySelector<HTMLElement>(
    `#property-inline-units-${id}`
  )!;
  const editButton = [
    ...inline.querySelectorAll<HTMLButtonElement>("button"),
  ].find(b => b.textContent?.trim() === "تعديل الوحدة")!;
  await act(async () => editButton.click());
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  const name = [...dialog.querySelectorAll<HTMLLabelElement>("label")]
    .find(l => l.querySelector("span")?.textContent?.includes("اسم الوحدة"))!
    .querySelector<HTMLInputElement>("input")!;
  await act(async () => setInput(name, "مسودة تبقى عند الفشل"));
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  try {
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
  } finally {
    write.mockRestore();
  }
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(name.value).toBe("مسودة تبقى عند الفشل");
  expect(dialog.querySelector('[role="alert"]')).not.toBeNull();
  expect(physicalUnits(id).some(u => u.title === "مسودة تبقى عند الفشل")).toBe(
    false
  );
  expect(expansionButton("فشل حفظ محلي").getAttribute("aria-expanded")).toBe(
    "true"
  );
});
