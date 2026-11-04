// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { updateDescribedUnit } from "@/lib/unit-profile";
import { SaleUnitsPage } from "./SaleUnitsPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

type CreatedProperty = {
  id: string;
  units: string[];
};

function Harness() {
  api = usePrototype();
  return <SaleUnitsPage />;
}

function propertyValues(
  title: string,
  portfolioId: string,
  purpose: "sale" | "rent" | "mixed",
  rentalMode: "whole" | "units",
  unitCount: string,
  salePriceMinor?: number
) {
  return {
    requestId: `sale-units-${title}`,
    title,
    portfolioId,
    assetType: "building",
    usageType: "residential",
    rentalMode,
    unitCount,
    inputMethod: "يدوي",
    propertyProfile: JSON.stringify({
      v: 1,
      purpose,
      ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
    }),
  };
}

async function createProperty(
  title: string,
  portfolioId: string,
  purpose: "sale" | "rent" | "mixed",
  rentalMode: "whole" | "units",
  unitCount: string,
  salePriceMinor?: number
): Promise<CreatedProperty> {
  let id = "";
  await act(async () => {
    const property = api.createRentalProperty(
      propertyValues(
        title,
        portfolioId,
        purpose,
        rentalMode,
        unitCount,
        salePriceMinor
      )
    );
    id = property.id;
  });
  return {
    id,
    units: api.state.entities.units
      .filter(unit => unit.propertyId === id)
      .map(unit => unit.id),
  };
}

async function describeUnit(
  id: string,
  values: Record<string, string>
): Promise<void> {
  await act(async () => {
    api.commitTransition(current => updateDescribedUnit(current, id, values));
  });
}

function setInput(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  expect(input).toBeTruthy();
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  return act(async () =>
    input.dispatchEvent(new Event("input", { bubbles: true }))
  );
}

function setSelect(selector: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(selector)!;
  expect(select).toBeTruthy();
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )!.set!.call(select, value);
  return act(async () =>
    select.dispatchEvent(new Event("change", { bubbles: true }))
  );
}

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <Router hook={() => ["/sale-units", () => undefined]}>
        <PrototypeProvider>
          <Harness />
        </PrototypeProvider>
      </Router>
    )
  );
  await act(async () => api.setSetting("portfolioId", "family"));

  const inherited = await createProperty(
    "عقار الإرث للبيع",
    "family",
    "sale",
    "units",
    "2"
  );
  await describeUnit(inherited.units[0]!, {
    title: "وحدة موروثة للبيع",
    unitCode: "INH-01",
    category: "apartment",
    apartmentLayout: "1-living",
    bedrooms: "1",
    livingRooms: "1",
    unitArea: "120.5",
    salePrice: "18500",
  });
  await describeUnit(inherited.units[1]!, {
    unitPurpose: "rent",
    monthlyRent: "5000",
  });

  const mixed = await createProperty(
    "عقار مختلط",
    "family",
    "mixed",
    "units",
    "2"
  );
  await describeUnit(mixed.units[0]!, {
    title: "وحدة البيع المختلطة",
    unitCode: "MIX-SALE",
    unitPurpose: "sale",
    category: "office",
    unitArea: "95",
    salePrice: "1200000",
  });
  await describeUnit(mixed.units[1]!, {
    title: "وحدة الإيجار المختلطة",
    unitCode: "MIX-RENT",
    unitPurpose: "rent",
    category: "shop",
    monthlyRent: "6000",
  });

  const noPrice = await createProperty(
    "عقار بلا سعر وحدة",
    "family",
    "sale",
    "units",
    "2",
    99_000_000
  );
  await describeUnit(noPrice.units[0]!, {
    title: "وحدة بلا سعر",
    unitCode: "NOPRICE-01",
    category: "other",
    unitArea: "220",
  });
  await describeUnit(noPrice.units[1]!, {
    unitPurpose: "rent",
    monthlyRent: "5000",
  });

  await createProperty(
    "عقار كامل للبيع",
    "family",
    "sale",
    "whole",
    "1",
    250_000_000
  );

  const rent = await createProperty(
    "عقار للإيجار فقط",
    "family",
    "rent",
    "units",
    "2"
  );
  await describeUnit(rent.units[0]!, {
    title: "وحدة إيجار مستبعدة",
    unitCode: "RENT-01",
    unitPurpose: "rent",
    category: "apartment",
    apartmentLayout: "1-living",
    bedrooms: "1",
    livingRooms: "1",
    monthlyRent: "5000",
  });

  await act(async () => api.setSetting("portfolioId", "all"));
  const foreign = await createProperty(
    "عقار خارج النطاق",
    "growth",
    "sale",
    "units",
    "2"
  );
  await describeUnit(foreign.units[0]!, {
    title: "وحدة خارج النطاق",
    unitCode: "WORK-01",
    category: "office",
    salePrice: "7000",
  });
  await act(async () => api.setSetting("portfolioId", "family"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("SaleUnitsPage", () => {
  it("يعرض الوحدات المادية للبيع فقط، مع الوراثة والمختلط، ويستبعد الإيجار والهدف الداخلي والنطاق الأجنبي", () => {
    expect(document.querySelector("h1")?.textContent).toBe("وحدات للبيع");
    expect(
      document.querySelector('a[href="/marketing"]')?.textContent
    ).toContain("العودة إلى التسويق");
    expect(document.body.textContent).toContain("وحدة موروثة للبيع");
    expect(document.body.textContent).toContain("وحدة البيع المختلطة");
    expect(document.body.textContent).toContain("وحدة بلا سعر");
    expect(document.body.textContent).not.toContain("وحدة الإيجار المختلطة");
    expect(document.body.textContent).not.toContain("وحدة إيجار مستبعدة");
    expect(document.body.textContent).not.toContain("عقار كامل للبيع");
    expect(document.body.textContent).not.toContain("وحدة خارج النطاق");
    expect(
      document.querySelector('[data-excel-table="sale-units"] tbody')?.children
    ).toHaveLength(3);
    expect(document.body.textContent).toContain(
      "العقارات الكاملة المعروضة للبيع تظهر ضمن التسويق"
    );
  });

  it("يعرض سعر البيع الخاص بالوحدة فقط ولا يعود إلى سعر العقار أو الإيجار عند غيابه", () => {
    const noPriceUnit = api.state.entities.units.find(
      unit => unit.title === "وحدة بلا سعر"
    )!;
    expect(
      document.querySelector(
        `[data-testid="sale-unit-price-${noPriceUnit.id}"]`
      )?.textContent
    ).toBe("غير مسجل");
    expect(document.body.textContent).toContain("18,500 ر.ق");
    expect(document.body.textContent).toContain("1,200,000 ر.ق");
    expect(document.body.textContent).not.toContain("990,000 ر.ق");
    expect(document.body.textContent).not.toContain("2,500,000 ر.ق");
    expect(document.body.textContent).toContain(
      "لا يوجد بديل من العقار أو الإيجار"
    );
  });

  it("يبحث بالاسم والعقار والرمز ويصفي بالعقار والفئة", async () => {
    await setInput('[aria-label="بحث في وحدات البيع"]', "MIX-SALE");
    expect(document.body.textContent).toContain("وحدة البيع المختلطة");
    expect(document.body.textContent).not.toContain("وحدة موروثة للبيع");

    await setInput('[aria-label="بحث في وحدات البيع"]', "");
    const mixedProperty = api.state.entities.properties.find(
      property => property.title === "عقار مختلط"
    )!;
    await setSelect('[aria-label="تصفية العقار"]', mixedProperty.id);
    expect(
      document.querySelector('[data-excel-table="sale-units"] tbody')?.children
    ).toHaveLength(1);
    expect(document.body.textContent).toContain("وحدة البيع المختلطة");

    await setSelect('[aria-label="تصفية العقار"]', "all");
    await setSelect('[aria-label="تصفية الفئة"]', "شقة");
    expect(
      document.querySelector('[data-excel-table="sale-units"] tbody')?.children
    ).toHaveLength(1);
    expect(document.body.textContent).toContain("وحدة موروثة للبيع");
    expect(document.body.textContent).not.toContain("وحدة البيع المختلطة");
  });

  it("يعيد المرشحات عند تغيير المحفظة ويظهر وحدات النطاق الجديد", async () => {
    const mixedProperty = api.state.entities.properties.find(
      property => property.title === "عقار مختلط"
    )!;
    await setSelect('[aria-label="تصفية العقار"]', mixedProperty.id);
    await setSelect('[aria-label="تصفية الفئة"]', "مكتب");
    await setInput('[aria-label="بحث في وحدات البيع"]', "MIX-SALE");
    expect(document.body.textContent).toContain("وحدة البيع المختلطة");

    await act(async () => api.setSetting("portfolioId", "growth"));
    expect(document.body.textContent).toContain("وحدة خارج النطاق");
    expect(document.body.textContent).not.toContain("وحدة البيع المختلطة");
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="تصفية العقار"]')
        ?.value
    ).toBe("all");
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="تصفية الفئة"]')
        ?.value
    ).toBe("all");
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="بحث في وحدات البيع"]'
      )?.value
    ).toBe("");
  });

  it("يبين حالة فارغة عند عدم وجود وحدات بيع دون إدراج هدف العقار الكامل", async () => {
    for (const title of [
      "وحدة موروثة للبيع",
      "وحدة البيع المختلطة",
      "وحدة بلا سعر",
    ]) {
      const unit = api.state.entities.units.find(row => row.title === title)!;
      await describeUnit(unit.id, { unitPurpose: "rent" });
    }
    expect(document.body.textContent).toContain(
      "لا توجد وحدات مادية للبيع في النطاق الحالي"
    );
    expect(
      document.querySelector('[data-excel-table="sale-units"]')
    ).toBeNull();
    expect(document.querySelector('a[href="/marketing"]')).not.toBeNull();
  });

  it("يفتح تفاصيل الوحدة للقراءة فقط من دون تعديل حالة مساحة العمل", async () => {
    const before = structuredClone(api.state);
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="عرض تفاصيل وحدة البيع المختلطة"]'
    )!;
    await act(async () => trigger.click());

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("تفاصيل الوحدة: وحدة البيع المختلطة");
    expect(dialog.querySelector("form")).toBeNull();
    expect(dialog.textContent).toContain(
      "لا تعدّل عقودًا أو ذممًا أو عمليات دفع"
    );
    expect(api.state).toStrictEqual(before);
  });
});
