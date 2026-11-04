// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { PropertiesPage } from "./PortfolioPropertyPages";
import { getPropertyFieldPolicy } from "@/lib/property-applicability";
import { PROPERTY_ASSET_TYPES } from "@/lib/property-fields";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, api: ReturnType<typeof usePrototype>;
function Capture() {
  api = usePrototype();
  return <PropertiesPage />;
}
async function render() {
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Capture />
      </PrototypeProvider>
    )
  );
}
function button(text: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    b => b.textContent?.trim() === text
  );
  expect(b).toBeTruthy();
  return b!;
}
function field(name: string) {
  const f = host.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(`[role=dialog] [name="${name}"]`);
  expect(f).toBeTruthy();
  return f!;
}
async function value(name: string, v: string) {
  await act(async () => {
    const f = field(name);
    if (f instanceof HTMLSelectElement) {
      f.value = v;
      f.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(
        f instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(f, v);
      f.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
async function save() {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>("[role=dialog] form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});
describe("property service actual React form acceptance", () => {
  it("prevents post-submit edits while waiting for a durable property write", async () => {
    await act(async () => button("إضافة عقار").click());
    await value("title", "اسم عند بدء الحفظ");
    await value("portfolioId", "family");
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.stubGlobal("navigator", {
      userAgent: "jsdom",
      locks: {
        request: async (
          _name: string,
          _options: LockOptions,
          callback: () => unknown
        ) => {
          await gate;
          return callback();
        },
      },
    });
    try {
      await act(async () => {
        host
          .querySelector<HTMLFormElement>('[role="dialog"] form')!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          );
        await Promise.resolve();
      });
      expect(field("title").matches(":disabled")).toBe(true);
      expect(field("rentalMode").matches(":disabled")).toBe(true);
      expect(field("propertyPurpose").matches(":disabled")).toBe(true);
      await value("title", "لا يجوز إدخال اسم أثناء الحفظ");
      await value("rentalMode", "units");
      expect(field("title").value).toBe("اسم عند بدء الحفظ");
      expect(field("rentalMode").value).toBe("whole");
      await act(async () => {
        release();
        await gate;
      });
      expect(
        api.state.entities.properties.find(p => p.title === "اسم عند بدء الحفظ")
      ).toBeTruthy();
      expect(
        api.state.entities.properties.some(
          p => p.title === "لا يجوز إدخال اسم أثناء الحفظ"
        )
      ).toBe(false);
    } finally {
      release();
      vi.unstubAllGlobals();
    }
  });
  it("saves a partial complex then enters and restores each independent unit's key data from the registry", async () => {
    const before = JSON.stringify({
      leases: api.state.entities.leases,
      receivables: api.state.entities.receivables,
      collections: api.state.entities.collections,
      expenses: api.state.entities.expenses,
    });
    await act(async () => button("إضافة عقار").click());
    await value("rentalMode", "units");
    await value("title", "مجمع كامل بيانات الوحدات");
    await value("portfolioId", "family");
    await value("assetType", "villa_complex");
    await value("propertyPurpose", "rent");
    await value("unitCount", "2");
    await value("availableServices", "مسبح مشترك وأمن ومواقف");
    await value("landArea", "١٠٠٠٫٥");
    await value("buildingArea", "٧٥٠٫٥");
    expect(button("حفظ العقار وإكمال معلومات الوحدات")).toBeTruthy();
    await save();
    const p = api.state.entities.properties.find(
      p => p.title === "مجمع كامل بيانات الوحدات"
    )!;
    expect(p).toBeTruthy();
    const setup = host.querySelector<HTMLElement>(
      '[aria-label="إكمال بيانات الوحدات"]'
    )!;
    expect(setup).toBeTruthy();
    for (const key of [
      "unitArea",
      "electricityNumber",
      "description",
      "furnishing",
      "category",
      "roomLayout",
    ])
      expect(field(key)).toBeTruthy();
    const tenancy = (label: string) =>
      [...setup.querySelectorAll("label")]
        .find(l => l.querySelector("span")?.textContent?.includes(label))!
        .querySelector<HTMLInputElement | HTMLSelectElement>("input,select")!;
    const tenancyValue = async (label: string, value: string) => {
      await act(async () => {
        const f = tenancy(label);
        if (f instanceof HTMLSelectElement) {
          f.value = value;
          f.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )!.set!.call(f, value);
          f.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    };
    await value("category", "villa");
    await value("villaArrangement", "detached");
    await value("roomLayout", "4-living");
    await value("furnishing", "furnished");
    await value("unitArea", "١٢٠٫٥");
    await value("electricityNumber", "٠٠٧٧");
    await value("description", "فيلا مفروشة بأربع غرف وصالة");
    await value("monthlyRent", "٤٢٠٠");
    await tenancyValue("حالة التأجير", "rented");
    await tenancyValue("تاريخ بداية العقد", "2026-01-01");
    await tenancyValue("تاريخ نهاية العقد", "2026-12-31");
    await save();
    const units = api.state.entities.units.filter(u => u.propertyId === p.id);
    expect(units).toHaveLength(2);
    expect(units[0].meta.electricityNumber).toBe("٠٠٧٧");
    expect(units[0].meta.description).toBe("فيلا مفروشة بأربع غرف وصالة");
    expect(JSON.parse(String(units[0].meta.unitProfile))).toMatchObject({
      areaM2: 120.5,
      furnishing: "furnished",
      roomLayout: "4-living",
    });
    expect(JSON.parse(String(units[0].meta.tenancyDeclaration))).toMatchObject({
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    await act(async () => button("إكمال لاحقًا").click());
    expect(
      host.querySelector('[aria-label="إكمال بيانات الوحدات"]')
    ).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    const row = [...host.querySelectorAll("tbody tr")].find(row =>
      row.textContent?.includes(p.title)
    )!;
    const reopen = [...row.querySelectorAll<HTMLButtonElement>("button")].find(
      b => b.textContent?.trim() === "إكمال معلومات الوحدات"
    )!;
    await act(async () => reopen.click());
    expect(field("unitArea").value).toBe("120.5");
    expect(field("electricityNumber").value).toBe("٠٠٧٧");
    expect(field("furnishing").value).toBe("furnished");
    expect(field("description").value).toBe("فيلا مفروشة بأربع غرف وصالة");
    expect(
      JSON.stringify({
        leases: api.state.entities.leases,
        receivables: api.state.entities.receivables,
        collections: api.state.entities.collections,
        expenses: api.state.entities.expenses,
      })
    ).toBe(before);
  });
  for (const asset of PROPERTY_ASSET_TYPES)
    for (const mode of ["whole", "units"] as const) {
      for (const purpose of ["rent", "sale", "mixed"] as const)
        for (const mortgage of ["free", "mortgaged"] as const)
          it(`saves and reopens ${asset}/${mode}/${purpose}/${mortgage} through the real form`, async () => {
            const before = JSON.stringify({
              leases: api.state.entities.leases,
              receivables: api.state.entities.receivables,
              collections: api.state.entities.collections,
            });
            await act(async () => button("إضافة عقار").click());
            expect(
              field("rentalMode").closest("section")?.getAttribute("aria-label")
            ).toBe("العقار كامل أم جزئي");
            expect(
              [...(field("rentalMode") as HTMLSelectElement).options].map(
                o => o.textContent
              )
            ).toEqual([
              "كامل · بيع أو تأجير العقار بالكامل",
              "جزئي · وحدات مستقلة",
            ]);
            await value("title", `اختبار ${asset} ${mode}`);
            await value("portfolioId", "family");
            await value("assetType", asset);
            const expectedUse = getPropertyFieldPolicy(asset).allowedUsages;
            expect(
              [...(field("usageType") as HTMLSelectElement).options].map(
                o => o.value
              )
            ).toEqual([...expectedUse]);
            await value("rentalMode", mode);
            await value("propertyPurpose", purpose);
            await value("mortgageStatus", mortgage);
            if (mortgage === "mortgaged")
              await value("mortgageBank", "بنك اختبار فقط");
            await value("propertyNumber", "٠٠١٢");
            await value("electricityNumber", "٠٠٠٣");
            await value("landArea", "٢٥٠٫٥٠");
            await value("availableServices", "مواقف وأمن وصيانة مشتركة");
            if (mode === "whole") {
              if (purpose !== "rent") await value("salePrice", "١٢٣٤٫٥٠");
              if (purpose !== "sale") await value("monthlyRent", "٢٣٤٥٫٦٧");
            } else await value("unitCount", "٢");
            if (asset === "land") {
              expect((field("buildingYear") as HTMLInputElement).disabled).toBe(
                true
              );
              expect(field("buildingYear").value).toBe("");
            }
            await save();
            const p = api.state.entities.properties.find(
              p => p.title === `اختبار ${asset} ${mode}`
            )!;
            expect(p).toBeTruthy();
            expect(p.meta.propertyNumber).toBe("٠٠١٢");
            expect(p.meta.landArea).toBe(250.5);
            expect(p.meta.availableServices).toBe("مواقف وأمن وصيانة مشتركة");
            const unitSetup = host.querySelector(
              '[aria-label="إكمال بيانات الوحدات"]'
            );
            if (mode === "whole") expect(unitSetup).toBeNull();
            else expect(unitSetup).not.toBeNull();
            const units = api.state.entities.units.filter(
              u => u.propertyId === p.id
            );
            expect(units).toHaveLength(mode === "whole" ? 1 : 2);
            expect(
              JSON.stringify({
                leases: api.state.entities.leases,
                receivables: api.state.entities.receivables,
                collections: api.state.entities.collections,
              })
            ).toBe(before);
            const id = p.id;
            await act(async () => root.unmount());
            root = createRoot(host);
            await render();
            expect(
              api.state.entities.properties.find(p => p.id === id)?.title
            ).toBe(`اختبار ${asset} ${mode}`);
            expect(
              api.state.entities.properties.find(p => p.id === id)?.meta
                .availableServices
            ).toBe("مواقف وأمن وصيانة مشتركة");
            expect(
              api.state.entities.units.filter(u => u.propertyId === id)
            ).toHaveLength(units.length);
          });
    }
  it("warns before hiding invalid full-room drafts, then saves split without them", async () => {
    await act(async () => button("إضافة عقار").click());
    await value("title", "مسودة مخفية");
    await value("portfolioId", "family");
    await value("accommodation.roomLayout", "custom");
    await value("accommodation.bedrooms", "ليس رقما");
    await value("rentalMode", "units");
    expect(host.textContent).toContain("لن تحفظ");
    await act(async () => button("متابعة التغيير").click());
    await save();
    const p = api.state.entities.properties.find(
      p => p.title === "مسودة مخفية"
    )!;
    expect(p).toBeTruthy();
    expect(
      JSON.parse(String(p.meta.propertyProfile)).accommodation
    ).toBeUndefined();
  });
  it("shows the shared 256 bound and rejects longer programmatic input without losing it", async () => {
    await act(async () => button("إضافة عقار").click());
    expect((field("title") as HTMLInputElement).maxLength).toBe(256);
    await value("portfolioId", "family");
    await value("title", "ع".repeat(257));
    await save();
    expect(field("title").value).toHaveLength(257);
    expect(host.textContent).toContain("256");
    await value("title", "ع".repeat(256));
    await save();
    expect(
      api.state.entities.properties.some(p => p.title === "ع".repeat(256))
    ).toBe(true);
    expect(api.state.entities.units.every(u => u.title.length <= 256)).toBe(
      true
    );
  });
});
