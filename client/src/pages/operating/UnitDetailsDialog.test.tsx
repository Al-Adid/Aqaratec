// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "@/lib/demo-data";
import { parseUnitProfile, updateDescribedUnit } from "@/lib/unit-profile";
import { createRentalProperty } from "@/lib/prototype-rental";
import { getTenancySummary } from "@/lib/tenancy-information";
import { UnitDetailsDialog } from "./UnitDetailsDialog";

const fixture = vi.hoisted(() => ({
  state: null as PrototypeState | null,
  canEdit: true,
  storageKey: "unit-details-dialog-test",
}));
vi.mock("@/contexts/PrototypeContext", () => ({
  usePrototype: () => ({
    state: fixture.state,
    canEdit: fixture.canEdit,
    identity: { storageKey: fixture.storageKey },
    commitTransition: (transition: (current: PrototypeState) => unknown) =>
      transition(fixture.state!),
  }),
}));
vi.mock("@/components/app/PhotoGallery", () => ({
  AssetPhotoGallery: () => null,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  fixture.state = null;
  fixture.canEdit = true;
  fixture.storageKey = "unit-details-dialog-test";
});

function selectByLabel(dialog: Element, label: string) {
  const element = [...dialog.querySelectorAll("label")]
    .find(item => item.querySelector("span")?.textContent?.includes(label))
    ?.querySelector("select");
  if (!element) throw new Error(`لم يوجد حقل ${label}`);
  return element as HTMLSelectElement;
}

function inputByLabel(dialog: Element, label: string) {
  const element = [...dialog.querySelectorAll("label")]
    .find(item => item.querySelector("span")?.textContent?.includes(label))
    ?.querySelector("input");
  if (!element) throw new Error(`لم يوجد حقل ${label}`);
  return element as HTMLInputElement;
}

function textareaByLabel(dialog: Element, label: string) {
  const element = [...dialog.querySelectorAll("label")]
    .find(item => item.textContent?.includes(label))
    ?.querySelector("textarea");
  if (!element) throw new Error(`لم يوجد حقل ${label}`);
  return element as HTMLTextAreaElement;
}

function setInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit(dialog: Element) {
  dialog
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type ParentPurpose = "rent" | "sale" | "mixed" | undefined;

function withPurpose(
  property: DemoEntity,
  purpose: ParentPurpose,
  extra: Record<string, unknown> = {}
): DemoEntity {
  const meta = { ...property.meta };
  if (purpose)
    meta.propertyProfile = JSON.stringify({ v: 1, purpose, ...extra });
  else delete meta.propertyProfile;
  return { ...property, meta };
}

function replacePropertyInState(property: DemoEntity) {
  fixture.state = {
    ...fixture.state!,
    entities: {
      ...fixture.state!.entities,
      properties: fixture.state!.entities.properties.map(row =>
        row.id === property.id ? property : row
      ),
    },
  };
}

function replaceUnitInState(unit: DemoEntity) {
  fixture.state = {
    ...fixture.state!,
    entities: {
      ...fixture.state!.entities,
      units: fixture.state!.entities.units.map(row =>
        row.id === unit.id ? unit : row
      ),
    },
  };
}

function financialRecords() {
  const entities = fixture.state!.entities;
  return JSON.parse(
    JSON.stringify({
      leases: entities.leases,
      receivables: entities.receivables,
      collections: entities.collections,
      expenses: entities.expenses,
    })
  );
}

function unitBusinessState() {
  return fixture.state!.entities.units.map(unit => ({
    id: unit.id,
    amountMinor: unit.amountMinor,
    status: unit.status,
  }));
}

function createSplitFixture(purpose: ParentPurpose = "mixed") {
  const created = createRentalProperty(createDemoState(), {
    title: "عقار اختبار هدف الوحدة",
    portfolioId: "family",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "2",
    inputMethod: "يدوي",
  });
  fixture.state = created.state;
  const property = withPurpose(created.property, purpose);
  replacePropertyInState(property);
  const units = fixture.state!.entities.units.filter(
    item => item.propertyId === property.id
  );
  return { property, units, unit: units[0]! };
}

async function renderDialog(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

async function openDialog(triggerText: string) {
  const trigger = [
    ...container!.querySelectorAll<HTMLButtonElement>("button"),
  ].find(button => button.textContent?.includes(triggerText));
  if (!trigger) throw new Error(`لم يوجد زر ${triggerText}`);
  await act(async () => trigger.click());
  const dialog = container!.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("لم تفتح النافذة");
  return dialog;
}

describe("unit layout and independent prices in UnitDetailsDialog", () => {
  it("preserves a legacy apartment's visible composition when the user explicitly changes its physical category", async () => {
    const { property, unit } = createSplitFixture("rent");
    const legacy = {
      ...unit,
      meta: {
        ...unit.meta,
        monthlyRentMinor: 250000,
        unitProfile: JSON.stringify({
          v: 1,
          category: "apartment",
          apartmentLayout: "1-living",
          bedrooms: 1,
          livingRooms: 1,
        }),
      },
    };
    replaceUnitInState(legacy);
    const before = financialRecords();
    const handler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        legacy.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={legacy}
        canEdit
        onSubmit={handler}
        trigger={<button>تعديل النوع التاريخي</button>}
      />
    );
    const dialog = await openDialog("تعديل النوع التاريخي");
    expect(selectByLabel(dialog, "تكوين الوحدة").value).toBe("1-living");
    await act(async () =>
      setSelect(selectByLabel(dialog, "فئة الوحدة"), "office")
    );
    await act(async () => submit(dialog));
    expect(
      handler,
      dialog.querySelector('[role="alert"]')?.textContent ?? dialog.textContent
    ).toHaveBeenCalledOnce();
    const result = fixture.state!.entities.units.find(
      row => row.id === legacy.id
    )!;
    expect(parseUnitProfile(result.meta.unitProfile)).toMatchObject({
      category: "office",
      roomLayout: "1-living",
      bedrooms: 1,
      livingRooms: 1,
    });
    expect(
      parseUnitProfile(result.meta.unitProfile).apartmentLayout
    ).toBeUndefined();
    expect(result.meta.monthlyRentMinor).toBe(250000);
    expect(financialRecords()).toEqual(before);
  });

  it.each(["2-living", "studio"] as const)(
    "keeps a historical %s layout's numbers and independent rent when changed to custom",
    async layout => {
      const { property, unit } = createSplitFixture("rent");
      const described = updateDescribedUnit(fixture.state!, unit.id, {
        category: "apartment",
        apartmentLayout: layout,
        bedrooms: layout === "studio" ? "0" : "2",
        livingRooms: layout === "studio" ? "0" : "1",
        monthlyRent: "2500",
      });
      fixture.state = described.state;
      const financialBefore = financialRecords();
      const submitHandler = vi.fn((values: Record<string, string>) => {
        fixture.state = updateDescribedUnit(
          fixture.state!,
          unit.id,
          values
        ).state;
      });

      await renderDialog(
        <UnitDetailsDialog
          mode="edit"
          property={property}
          unit={described.result}
          canEdit
          onSubmit={submitHandler}
          trigger={<button>تعديل توزيع QA</button>}
        />
      );
      const dialog = await openDialog("تعديل توزيع QA");
      await act(async () =>
        setSelect(selectByLabel(dialog, "توزيع الشقة"), "custom")
      );
      await act(async () => submit(dialog));

      expect(submitHandler).toHaveBeenCalledOnce();
      expect(submitHandler.mock.calls[0][0]).toMatchObject({
        apartmentLayout: "custom",
        roomLayout: "custom",
      });
      expect(submitHandler.mock.calls[0][0]._expectedEntityToken).toMatch(
        /^edit-/
      );
      const result = fixture.state!.entities.units.find(
        item => item.id === unit.id
      )!;
      expect(parseUnitProfile(result.meta.unitProfile)).toMatchObject({
        apartmentLayout: "custom",
        bedrooms: layout === "studio" ? 0 : 2,
        livingRooms: layout === "studio" ? 0 : 1,
      });
      expect(result.meta.monthlyRentMinor).toBe(
        described.result.meta.monthlyRentMinor
      );
      expect(financialRecords()).toEqual(financialBefore);
    }
  );

  it("shows the universal layout without a category, saves its facts, and reads them back", async () => {
    const { property, unit } = createSplitFixture("rent");
    const financialBefore = financialRecords();
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>تكوين عام غير مصنف QA</button>}
      />
    );

    const dialog = await openDialog("تكوين عام غير مصنف QA");
    expect(selectByLabel(dialog, "فئة الوحدة").value).toBe("");
    const layout = selectByLabel(dialog, "توزيع الشقة");
    expect([...layout.options].map(option => option.value)).toEqual([
      "",
      "studio",
      "1-living",
      "2-living",
      "3-living",
      "4-living",
      "5-living",
      "custom",
    ]);
    expect(layout.required).toBe(false);
    await act(async () => setSelect(layout, "3-living"));
    expect(selectByLabel(dialog, "فئة الوحدة").value).toBe("");
    expect(inputByLabel(dialog, "عدد الغرف")).toMatchObject({
      value: "3",
      disabled: true,
    });
    expect(inputByLabel(dialog, "عدد الصالات")).toMatchObject({
      value: "1",
      disabled: true,
    });
    await act(async () => {
      setInput(inputByLabel(dialog, "عدد الحمامات"), "2");
      setInput(inputByLabel(dialog, "عدد المطابخ"), "1");
      setSelect(selectByLabel(dialog, "التأثيث"), "unfurnished");
    });
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(submitHandler.mock.calls[0][0]).toMatchObject({
      roomLayout: "3-living",
      bedrooms: "3",
      livingRooms: "1",
      bathrooms: "2",
      kitchens: "1",
      furnishing: "unfurnished",
    });
    expect(submitHandler.mock.calls[0][0]._expectedEntityToken).toMatch(
      /^edit-/
    );
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      roomLayout: "3-living",
      bedrooms: 3,
      livingRooms: 1,
      bathrooms: 2,
      kitchens: 1,
      furnishing: "unfurnished",
    });
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={saved}
          canEdit
          trigger={<button>قراءة تكوين عام QA</button>}
        />
      )
    );
    const details = await openDialog("قراءة تكوين عام QA");
    expect(details.textContent).toContain("تكوين الوحدة / توزيع الشقة");
    expect(details.textContent).toContain("3 غرف وصالة");
    expect(details.textContent).toContain("2");
    expect(details.textContent).toContain("غير مفروشة");
  });

  it("inherits a single parent goal while allowing an explicit physical-unit override", async () => {
    const { property, unit } = createSplitFixture("sale");
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>وراثة هدف البيع QA</button>}
      />
    );

    const dialog = await openDialog("وراثة هدف البيع QA");
    expect(selectByLabel(dialog, "هدف الوحدة").value).toBe("");
    expect(dialog.textContent).toContain("سعر بيع الوحدة المطلوب (ر.ق)");
    expect(dialog.textContent).not.toContain("إيجار الوحدة الشهري (ر.ق)");
    await act(async () =>
      setSelect(selectByLabel(dialog, "هدف الوحدة"), "rent")
    );
    expect(dialog.textContent).toContain("إيجار الوحدة الشهري (ر.ق)");
    expect(dialog.textContent).not.toContain("سعر بيع الوحدة المطلوب (ر.ق)");
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(submitHandler.mock.calls[0][0]).toMatchObject({
      unitPurpose: "rent",
    });
    expect(
      parseUnitProfile(
        fixture.state!.entities.units.find(row => row.id === unit.id)!.meta
          .unitProfile
      ).purpose
    ).toBe("rent");
  });
});

describe("mixed property unit goals", () => {
  it("requires a mixed parent unit to choose a goal, then saves rent and sale units independently", async () => {
    const { property, units, unit } = createSplitFixture("mixed");
    const financialBefore = financialRecords();
    const lifecycleBefore = unitBusinessState();
    const rentSave = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={rentSave}
        trigger={<button>هدف إيجار مختلط QA</button>}
      />
    );

    const rentDialog = await openDialog("هدف إيجار مختلط QA");
    expect(rentDialog.textContent).toContain("اختر هدفًا مستقلًا");
    await act(async () => submit(rentDialog));
    expect(rentSave).not.toHaveBeenCalled();
    expect(rentDialog.querySelector('[role="alert"]')?.textContent).toContain(
      "حدّد هدف الوحدة"
    );
    expect(rentDialog.textContent).not.toContain("إيجار الوحدة الشهري (ر.ق)");
    expect(rentDialog.textContent).not.toContain(
      "سعر بيع الوحدة المطلوب (ر.ق)"
    );

    await act(async () =>
      setSelect(selectByLabel(rentDialog, "هدف الوحدة"), "rent")
    );
    expect(rentDialog.textContent).toContain("إيجار الوحدة الشهري (ر.ق)");
    await act(async () =>
      setInput(inputByLabel(rentDialog, "إيجار الوحدة الشهري (ر.ق)"), "١٬٥٠٠")
    );
    await act(async () => submit(rentDialog));

    expect(rentSave).toHaveBeenCalledOnce();
    expect(rentSave.mock.calls[0][0]).toMatchObject({
      unitPurpose: "rent",
      monthlyRent: "١٬٥٠٠",
    });
    expect(rentSave.mock.calls[0][0]).not.toHaveProperty("salePrice");

    const saleUnit = units[1]!;
    const saleSave = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        saleUnit.id,
        values
      ).state;
    });
    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="edit"
          property={property}
          unit={saleUnit}
          canEdit
          onSubmit={saleSave}
          trigger={<button>هدف بيع مختلط QA</button>}
        />
      )
    );
    const saleDialog = await openDialog("هدف بيع مختلط QA");
    await act(async () =>
      setSelect(selectByLabel(saleDialog, "هدف الوحدة"), "sale")
    );
    await act(async () =>
      setInput(
        inputByLabel(saleDialog, "سعر بيع الوحدة المطلوب (ر.ق)"),
        "٢٬٢٠٠٬٠٠٠"
      )
    );
    await act(async () => submit(saleDialog));

    expect(saleSave).toHaveBeenCalledOnce();
    expect(saleSave.mock.calls[0][0]).toMatchObject({
      unitPurpose: "sale",
      salePrice: "٢٬٢٠٠٬٠٠٠",
    });
    expect(saleSave.mock.calls[0][0]).not.toHaveProperty("monthlyRent");
    const savedRent = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    const savedSale = fixture.state!.entities.units.find(
      row => row.id === saleUnit.id
    )!;
    expect(parseUnitProfile(savedRent.meta.unitProfile).purpose).toBe("rent");
    expect(savedRent.meta.monthlyRentMinor).toBe(150_000);
    expect(parseUnitProfile(savedSale.meta.unitProfile)).toMatchObject({
      purpose: "sale",
      salePriceMinor: 220_000_000,
    });
    expect(savedSale.meta.monthlyRentMinor).toBeUndefined();
    expect(financialRecords()).toEqual(financialBefore);
    expect(unitBusinessState()).toEqual(lifecycleBefore);
  });

  it("strips a newly hidden rent before validation and preserves that historical price when switching to sale", async () => {
    const { property, unit } = createSplitFixture("mixed");
    const described = updateDescribedUnit(fixture.state!, unit.id, {
      unitPurpose: "rent",
      monthlyRent: "1200",
      salePrice: "900000",
    });
    fixture.state = described.state;
    const financialBefore = financialRecords();
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={described.result}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>تبديل هدف مختلط QA</button>}
      />
    );

    const dialog = await openDialog("تبديل هدف مختلط QA");
    expect(dialog.textContent).toContain("إيجار الوحدة الشهري (ر.ق)");
    await act(async () =>
      setSelect(selectByLabel(dialog, "هدف الوحدة"), "sale")
    );
    expect(dialog.textContent).not.toContain("إيجار الوحدة الشهري (ر.ق)");
    expect(dialog.textContent).toContain("سعر بيع الوحدة المطلوب (ر.ق)");
    await act(async () =>
      setInput(
        inputByLabel(dialog, "سعر بيع الوحدة المطلوب (ر.ق)"),
        "٢٬٥٠٠٬٠٠٠٫٢٥"
      )
    );
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(submitHandler.mock.calls[0][0]).toMatchObject({
      unitPurpose: "sale",
      salePrice: "٢٬٥٠٠٬٠٠٠٫٢٥",
    });
    expect(submitHandler.mock.calls[0][0]).not.toHaveProperty("monthlyRent");
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(saved.meta.monthlyRentMinor).toBe(120_000);
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      purpose: "sale",
      salePriceMinor: 250_000_025,
    });
    expect(financialRecords()).toEqual(financialBefore);
  });
});

describe("resolved details and whole-property targets", () => {
  it("shows a physical unit's own resolved sale purpose and price, not its historical rent", async () => {
    const { property, unit } = createSplitFixture("mixed");
    const described = updateDescribedUnit(fixture.state!, unit.id, {
      unitPurpose: "sale",
      monthlyRent: "1200",
      salePrice: "2500000",
    });
    fixture.state = described.state;
    await renderDialog(
      <UnitDetailsDialog
        mode="details"
        property={property}
        unit={described.result}
        canEdit
        trigger={<button>تفاصيل بيع مستقل QA</button>}
      />
    );

    const details = await openDialog("تفاصيل بيع مستقل QA");
    expect(details.textContent).toContain("هدف الوحدة");
    expect(details.textContent).toContain("بيع · محدد للوحدة");
    expect(details.textContent).toContain("سعر بيع الوحدة المطلوب");
    expect(details.textContent).toContain("2,500,000 ر.ق");
    expect(details.textContent).not.toContain("إيجار الوحدة الشهري");
  });

  it("keeps a mixed whole-property target read-only and displays both property prices", async () => {
    const created = createRentalProperty(createDemoState(), {
      title: "عقار كامل مختلط",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      rentalMode: "whole",
      unitCount: "1",
      inputMethod: "يدوي",
    });
    fixture.state = created.state;
    const property = {
      ...withPurpose(created.property, "mixed", {
        salePriceMinor: 250_000_000,
        accommodation: {
          roomLayout: "4-living",
          bedrooms: 4,
          livingRooms: 1,
          bathrooms: 3,
          kitchens: 1,
          furnishing: "furnished",
        },
      }),
      meta: {
        ...withPurpose(created.property, "mixed", {
          salePriceMinor: 250_000_000,
          accommodation: {
            roomLayout: "4-living",
            bedrooms: 4,
            livingRooms: 1,
            bathrooms: 3,
            kitchens: 1,
            furnishing: "furnished",
          },
        }).meta,
        monthlyRentMinor: 350_000,
        buildingArea: 420.5,
        description: "وصف حر محفوظ للعقار الكامل",
      },
    };
    replacePropertyInState(property);
    const wholeTarget = fixture.state!.entities.units.find(
      unit => unit.propertyId === property.id
    )!;
    const misleadingWholeTarget: DemoEntity = {
      ...wholeTarget,
      meta: {
        ...wholeTarget.meta,
        unitProfile: JSON.stringify({
          v: 1,
          roomLayout: "studio",
          bedrooms: 0,
          livingRooms: 0,
          bathrooms: 9,
          contents: "محتوى الوحدة الداخلي لا يظهر",
        }),
      },
    };

    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={misleadingWholeTarget}
        canEdit
        onSubmit={vi.fn()}
        trigger={<button>تعديل العقار الكامل QA</button>}
      />
    );
    const editDialog = await openDialog("تعديل العقار الكامل QA");
    expect(
      [...editDialog.querySelectorAll("label")].some(label =>
        label.textContent?.includes("هدف الوحدة")
      )
    ).toBe(false);
    expect(
      [...editDialog.querySelectorAll("label")].some(label =>
        label.textContent?.includes("مساحة الوحدة (م²)")
      )
    ).toBe(false);
    expect(editDialog.textContent).toContain("إيجار وبيع · من معلومات العقار");
    expect(editDialog.querySelector("form")).toBeNull();
    expect(editDialog.textContent).toContain("4 غرف وصالة");
    expect(editDialog.textContent).toContain("وصف حر محفوظ للعقار الكامل");
    expect(
      editDialog.querySelector(`a[href="/properties/${property.id}"]`)
    ).not.toBeNull();

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={misleadingWholeTarget}
          canEdit
          trigger={<button>تفاصيل العقار الكامل QA</button>}
        />
      )
    );
    const details = await openDialog("تفاصيل العقار الكامل QA");
    expect(details.textContent).toContain("إيجار العقار الشهري");
    expect(details.textContent).toContain("3,500 ر.ق");
    expect(details.textContent).toContain("سعر بيع العقار المطلوب");
    expect(details.textContent).toContain("2,500,000 ر.ق");
    expect(details.textContent).not.toContain("هدف الوحدة");
    expect(details.textContent).toContain("مساحة العقار / البناء (م²)");
    expect(details.textContent).toContain("420.5 م² · للعقار بالكامل");
    expect(details.textContent).not.toContain("مساحة الوحدة (م²)");
    expect(details.textContent).toContain("مواصفات العقار الكامل · يتكوّن من");
    expect(details.textContent).toContain("4 غرف وصالة");
    expect(details.textContent).toContain("3");
    expect(details.textContent).toContain("مفروشة");
    expect(details.textContent).toContain("وصف حر محفوظ للعقار الكامل");
    expect(details.textContent).not.toContain("محتوى الوحدة الداخلي لا يظهر");
    expect(
      details.querySelector(`a[href="/properties/${property.id}"]`)
    ).not.toBeNull();
  });
});

describe("unit description and contents presets", () => {
  it("round-trips an independent description and selected real preset without wiping an unknown old contents value or custom layout", async () => {
    const { property, unit } = createSplitFixture("rent");
    const described = updateDescribedUnit(fixture.state!, unit.id, {
      category: "apartment",
      apartmentLayout: "custom",
      bedrooms: "3",
      livingRooms: "2",
      description: "وصف قديم مستقل",
      contents: "توزيع قديم غير محفوظ",
    });
    fixture.state = {
      ...described.state,
      settings: {
        ...described.state.settings,
        contentPresets: ["مجلس وصالة", "مطبخ مجهز"],
      },
    };
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={fixture.state.entities.units.find(row => row.id === unit.id)!}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>وصف ومحتويات QA</button>}
      />
    );

    const dialog = await openDialog("وصف ومحتويات QA");
    const presetPicker = selectByLabel(dialog, "محتويات الوحدة / توزيعها");
    // This is the actual shared picker: it keeps historical unknown text as a
    // selectable value instead of forcing an unrequested layout conversion.
    expect(presetPicker.value).toBe("توزيع قديم غير محفوظ");
    expect([...presetPicker.options].map(option => option.value)).toContain(
      "توزيع قديم غير محفوظ"
    );
    await act(async () => {
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "وصف جديد مستقل");
      setSelect(presetPicker, "مجلس وصالة");
    });
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(submitHandler.mock.calls[0][0]).toMatchObject({
      description: "وصف جديد مستقل",
      contents: "مجلس وصالة",
    });
    expect(submitHandler.mock.calls[0][0]._expectedEntityToken).toMatch(
      /^edit-/
    );
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(saved.meta.description).toBe("وصف جديد مستقل");
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      contents: "مجلس وصالة",
      apartmentLayout: "custom",
      bedrooms: 3,
      livingRooms: 2,
    });

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={saved}
          canEdit
          trigger={<button>تفاصيل الوصف QA</button>}
        />
      )
    );
    const details = await openDialog("تفاصيل الوصف QA");
    expect(details.textContent).toContain("وصف الوحدة");
    expect(details.textContent).toContain("وصف جديد مستقل");
    expect(details.textContent).toContain("محتويات الوحدة / توزيعها");
    expect(details.textContent).toContain("مجلس وصالة");
  });
});

describe("unit tenancy declarations and physical area", () => {
  it("requires valid declaration dates, saves an initial rented declaration, and shows its non-contract source", async () => {
    const { property, unit } = createSplitFixture("rent");
    const financialBefore = financialRecords();
    const lifecycleBefore = unitBusinessState();
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={save}
        trigger={<button>تصريح تأجير أولي QA</button>}
      />
    );

    const dialog = await openDialog("تصريح تأجير أولي QA");
    await act(async () =>
      setSelect(selectByLabel(dialog, "حالة التأجير"), "rented")
    );
    const start = inputByLabel(dialog, "تاريخ بداية العقد");
    const end = inputByLabel(dialog, "تاريخ نهاية العقد");
    const form = dialog.querySelector("form")!;
    expect(start.required).toBe(true);
    expect(end.required).toBe(true);
    expect(form.checkValidity()).toBe(false);

    const missingDatesState = fixture.state;
    await act(async () => submit(dialog));
    expect(save).not.toHaveBeenCalled();
    expect(fixture.state).toBe(missingDatesState);

    await act(async () => {
      setInput(start, "2026-12-31");
      setInput(end, "2026-01-01");
    });
    const invalidRangeState = fixture.state;
    await act(async () => submit(dialog));
    expect(save).toHaveBeenCalledOnce();
    expect(fixture.state).toBe(invalidRangeState);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "تاريخ نهاية العقد لا يمكن أن يسبق"
    );

    await act(async () => {
      setInput(start, "2026-01-01");
      setInput(end, "2026-12-31");
    });
    await act(async () => submit(dialog));

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      tenancyStatus: "rented",
      tenancyStartDate: "2026-01-01",
      tenancyEndDate: "2026-12-31",
    });
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(JSON.parse(String(saved.meta.tenancyDeclaration))).toEqual({
      v: 1,
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(
      getTenancySummary(fixture.state!.entities, property, saved, "2026-06-01")
    ).toMatchObject({
      status: "rented",
      source: "declaration",
      locked: false,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(financialRecords()).toEqual(financialBefore);
    expect(unitBusinessState()).toEqual(lifecycleBefore);

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={saved}
          canEdit
          trigger={<button>تفاصيل تصريح أولي QA</button>}
        />
      )
    );
    const details = await openDialog("تفاصيل تصريح أولي QA");
    expect(details.textContent).toContain("مؤجر · إدخال أولي");
    expect(details.textContent).toContain("مصدر حالة التأجير");
    expect(details.textContent).toContain("إدخال أولي · غير مرتبط بعقد مسجل");
    expect(details.textContent).toContain("2026-01-01");
    expect(details.textContent).toContain("2026-12-31");
  });

  it("reads a recognized legacy area, round-trips an Arabic decimal physical area, and keeps finance unchanged", async () => {
    const { property, unit } = createSplitFixture("rent");
    const legacy = {
      ...unit,
      meta: { ...unit.meta, area: 75.25 },
    };
    replaceUnitInState(legacy);
    const financialBefore = financialRecords();
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={legacy}
        canEdit
        onSubmit={save}
        trigger={<button>مساحة الوحدة QA</button>}
      />
    );

    const dialog = await openDialog("مساحة الوحدة QA");
    const area = inputByLabel(dialog, "مساحة الوحدة (م²)");
    expect(area.value).toBe("75.25");
    await act(async () => setInput(area, "١٢٠٫٥"));
    await act(async () => submit(dialog));

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ unitArea: "١٢٠٫٥" });
    expect(save.mock.calls[0][0]._expectedEntityToken).toMatch(/^edit-/);
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(parseUnitProfile(saved.meta.unitProfile).areaM2).toBe(120.5);
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="edit"
          property={property}
          unit={saved}
          canEdit
          onSubmit={save}
          trigger={<button>إعادة فتح مساحة الوحدة QA</button>}
        />
      )
    );
    const reopened = await openDialog("إعادة فتح مساحة الوحدة QA");
    expect(inputByLabel(reopened, "مساحة الوحدة (م²)").value).toBe("120.5");

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={saved}
          canEdit
          trigger={<button>تفاصيل مساحة الوحدة QA</button>}
        />
      )
    );
    const details = await openDialog("تفاصيل مساحة الوحدة QA");
    expect(details.textContent).toContain("مساحة الوحدة (م²)");
    expect(details.textContent).toContain("120.5 م²");
  });

  it("renders actual lease dates as read-only and omits stale declaration fields from the submission", async () => {
    const { property, unit } = createSplitFixture("rent");
    const declared = updateDescribedUnit(fixture.state!, unit.id, {
      tenancyStatus: "rented",
      tenancyStartDate: "2026-01-01",
      tenancyEndDate: "2026-12-31",
    });
    const lease: DemoEntity = {
      id: "lease actual date QA",
      title: "عقد مسجل فعلي",
      subtitle: "مستأجر تجريبي",
      portfolioId: property.portfolioId,
      propertyId: property.id,
      status: "نافذ",
      date: "2026-02-01",
      amountMinor: 0,
      currency: "QAR",
      meta: {
        unitId: unit.id,
        lifecycleActivated: true,
        startDate: "2026-02-01",
        endDate: "2026-11-30",
      },
    };
    fixture.state = {
      ...declared.state,
      entities: {
        ...declared.state.entities,
        leases: [...declared.state.entities.leases, lease],
      },
    };
    const financialBefore = financialRecords();
    const currentUnit = fixture.state.entities.units.find(
      row => row.id === unit.id
    )!;
    const declarationBefore = currentUnit.meta.tenancyDeclaration;
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={currentUnit}
        canEdit
        onSubmit={save}
        trigger={<button>عقد مسجل للقراءة QA</button>}
      />
    );

    const dialog = await openDialog("عقد مسجل للقراءة QA");
    expect(dialog.textContent).toContain("مؤجر بعقد مسجل");
    expect(dialog.textContent).toContain("مصدر الحالة: عقد مسجل");
    expect(dialog.textContent).toContain("2026-02-01");
    expect(dialog.textContent).toContain("2026-11-30");
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
    expect(
      [...dialog.querySelectorAll("label")].some(label =>
        label.textContent?.includes("حالة التأجير")
      )
    ).toBe(false);
    expect(
      dialog.querySelector('a[href="/leases?lease=lease%20actual%20date%20QA"]')
    ).not.toBeNull();

    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "تعديل وصفي آمن")
    );
    await act(async () => submit(dialog));

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({
      description: "تعديل وصفي آمن",
    });
    expect(save.mock.calls[0][0]._expectedEntityToken).toMatch(/^edit-/);
    const saved = fixture.state!.entities.units.find(
      row => row.id === unit.id
    )!;
    expect(saved.meta.tenancyDeclaration).toBe(declarationBefore);
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () =>
      root!.render(
        <UnitDetailsDialog
          mode="details"
          property={property}
          unit={saved}
          canEdit
          trigger={<button>تفاصيل العقد المسجل QA</button>}
        />
      )
    );
    const details = await openDialog("تفاصيل العقد المسجل QA");
    expect(details.textContent).toContain("مؤجر بعقد مسجل");
    expect(details.textContent).toContain("عقد مسجل");
    expect(details.textContent).toContain("2026-02-01");
    expect(details.textContent).toContain("2026-11-30");
  });
});

describe("current domain guards", () => {
  it("keeps the operator guard current when a dialog submit reaches the domain", async () => {
    const { property, unit } = createSplitFixture("rent");
    fixture.state = {
      ...fixture.state!,
      settings: { ...fixture.state!.settings, role: "owner" },
    };
    const before = fixture.state;
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>حارس الموظف QA</button>}
      />
    );

    const dialog = await openDialog("حارس الموظف QA");
    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "لا يجب حفظه")
    );
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "الإجراء متاح لمعاينة الموظف فقط"
    );
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.state).toBe(before);
  });

  it("keeps the active portfolio-scope guard current when a dialog submit reaches the domain", async () => {
    const { property, unit } = createSplitFixture("rent");
    const submitHandler = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(
        fixture.state!,
        unit.id,
        values
      ).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={submitHandler}
        trigger={<button>حارس النطاق QA</button>}
      />
    );

    const dialog = await openDialog("حارس النطاق QA");
    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "لا يجب حفظه")
    );
    fixture.state = {
      ...fixture.state!,
      settings: { ...fixture.state!.settings, portfolioId: "other-scope" },
    };
    const before = fixture.state;
    await act(async () => submit(dialog));

    expect(submitHandler).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "خارج المحفظة المختارة"
    );
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.state).toBe(before);
  });
});

describe("durable unit dialog safeguards", () => {
  it("keeps text floors exactly, enforces code uniqueness, caps the title, and leaves finance untouched", async () => {
    const { property, units, unit } = createSplitFixture("rent");
    const financialBefore = financialRecords();
    const before = structuredClone(fixture.state!.entities.units);
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(fixture.state!, unit.id, values).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={save}
        trigger={<button>دور ورمز QA</button>}
      />
    );

    const dialog = await openDialog("دور ورمز QA");
    expect(inputByLabel(dialog, "اسم الوحدة").maxLength).toBe(256);
    expect(inputByLabel(dialog, "رمز الوحدة").maxLength).toBe(80);
    expect(inputByLabel(dialog, "الدور").maxLength).toBe(80);
    await act(async () => {
      setInput(inputByLabel(dialog, "الدور"), "قبو-٠٠١");
      setInput(inputByLabel(dialog, "رمز الوحدة"), String(units[1]!.meta.unitCode));
      submit(dialog);
    });
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "مكرر"
    );
    expect(inputByLabel(dialog, "الدور").value).toBe("قبو-٠٠١");
    expect(inputByLabel(dialog, "رمز الوحدة").value).toBe(
      String(units[1]!.meta.unitCode)
    );
    expect(fixture.state!.entities.units).toEqual(before);

    await act(async () => {
      setInput(inputByLabel(dialog, "رمز الوحدة"), "B-قبو-٠٠١");
      submit(dialog);
    });
    const saved = fixture.state!.entities.units.find(row => row.id === unit.id)!;
    expect(saved.meta.floor).toBe("قبو-٠٠١");
    expect(saved.meta.unitCode).toBe("B-قبو-٠٠١");
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("rejects an edit token captured before another unit change and retains the draft", async () => {
    const { property, unit } = createSplitFixture("rent");
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(fixture.state!, unit.id, values).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={save}
        trigger={<button>تعارض الرمز QA</button>}
      />
    );
    const dialog = await openDialog("تعارض الرمز QA");
    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "مسودة متعارضة")
    );
    fixture.state = updateDescribedUnit(fixture.state!, unit.id, {
      floor: "B2",
    }).state;

    await act(async () => submit(dialog));
    expect(save).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "تعارض تعديل"
    );
    expect(textareaByLabel(dialog, "وصف الوحدة").value).toBe("مسودة متعارضة");
    expect(
      fixture.state!.entities.units.find(row => row.id === unit.id)?.meta.floor
    ).toBe("B2");
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("checks the current role at submit time and shows the unsaved-change review on Escape", async () => {
    const { property, unit } = createSplitFixture("rent");
    const save = vi.fn((values: Record<string, string>) => {
      fixture.state = updateDescribedUnit(fixture.state!, unit.id, values).state;
    });
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={save}
        trigger={<button>دور حالي وخروج QA</button>}
      />
    );
    const dialog = await openDialog("دور حالي وخروج QA");
    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "تعديل قبل تغيير الدور")
    );
    fixture.state = {
      ...fixture.state!,
      settings: { ...fixture.state!.settings, role: "owner" },
    };
    await act(async () => submit(dialog));
    expect(save).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "الموظف"
    );
    expect(textareaByLabel(dialog, "وصف الوحدة").value).toBe(
      "تعديل قبل تغيير الدور"
    );

    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(dialog.textContent).toContain("لديك تعديلات غير محفوظة");
    const discard = [...dialog.querySelectorAll("button")].find(button =>
      button.textContent?.includes("تجاهل التغييرات")
    );
    expect(discard).toBeTruthy();
    await act(async () => discard!.click());
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog and inputs open while an async submit is pending or rejects", async () => {
    const { property, unit } = createSplitFixture("rent");
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    await renderDialog(
      <UnitDetailsDialog
        mode="edit"
        property={property}
        unit={unit}
        canEdit
        onSubmit={save}
        trigger={<button>فشل الحفظ المؤجل QA</button>}
      />
    );
    const dialog = await openDialog("فشل الحفظ المؤجل QA");
    await act(async () =>
      setInput(textareaByLabel(dialog, "وصف الوحدة"), "مسودة الحفظ المؤجل")
    );
    await act(async () => {
      submit(dialog);
      await Promise.resolve();
    });
    expect(dialog.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(dialog.textContent).not.toContain("لديك تعديلات غير محفوظة");
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      pending.reject(new Error("تعذر تأكيد الحفظ المحلي"));
      await Promise.resolve();
    });
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "تعذر تأكيد الحفظ المحلي"
    );
    expect(textareaByLabel(dialog, "وصف الوحدة").value).toBe(
      "مسودة الحفظ المؤجل"
    );
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
