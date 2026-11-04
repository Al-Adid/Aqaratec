// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { parsePropertyLocation } from "@/lib/newproperty-location";
import { parsePropertyProfile, parseUnitProfile } from "@/lib/unit-profile";
import { toMinor, money } from "@shared/prototype";
import { PropertiesPage, PropertyDetailPage } from "./PortfolioPropertyPages";

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

function findButton(label: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(candidate => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  return button!;
}

function selectWithin(dialog: HTMLElement, label: string): HTMLSelectElement {
  const field = [...dialog.querySelectorAll<HTMLLabelElement>("label")].find(
    candidate => candidate.querySelector("span")?.textContent?.includes(label)
  );
  expect(field).toBeTruthy();
  const select = field!.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  return select!;
}

function inputWithin(dialog: HTMLElement, label: string): HTMLInputElement {
  const field = [...dialog.querySelectorAll<HTMLLabelElement>("label")].find(
    candidate => candidate.querySelector("span")?.textContent?.includes(label)
  );
  expect(field).toBeTruthy();
  const input = field!.querySelector<HTMLInputElement>("input");
  expect(input).toBeTruthy();
  return input!;
}

function setSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setTextareaWithin(dialog: HTMLElement, label: string, value: string) {
  const field = [...dialog.querySelectorAll<HTMLLabelElement>("label")].find(
    candidate => candidate.textContent?.includes(label)
  )!;
  const textarea = field.querySelector<HTMLTextAreaElement>("textarea")!;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function financialRelationships() {
  const keys = ["leases", "receivables", "collections", "expenses"] as const;
  return Object.fromEntries(
    keys.map(key => [key, structuredClone(api.state.entities[key])])
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

describe("property P06/P11 dialogs and scope", () => {
  it("rejects a stale property edit and loads the latest saved accommodation before retry", async () => {
    const before = financialRelationships();
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "توزيع الأصل المخصص",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "whole",
        unitCount: "1",
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "rent",
          accommodation: {
            roomLayout: "custom",
            bedrooms: 4,
            livingRooms: 1,
            bathrooms: 2,
            kitchens: 1,
          },
        }),
      }).id;
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={propertyId} />
          </Capture>
        </PrototypeProvider>
      );
    });
    await act(async () => findButton("تعديل العقار").click());
    const edit = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(selectWithin(edit, "تكوين العقار الكامل").value).toBe("custom");
    expect(inputWithin(edit, "عدد الغرف").value).toBe("4");
    await act(async () =>
      api.commitTransition(current => ({
        state: {
          ...current,
          entities: {
            ...current.entities,
            properties: current.entities.properties.map(property =>
              property.id === propertyId
                ? {
                    ...property,
                    meta: {
                      ...property.meta,
                      propertyProfile: JSON.stringify({
                        ...parsePropertyProfile(property.meta.propertyProfile),
                        accommodation: {
                          roomLayout: "custom",
                          bedrooms: 4,
                          livingRooms: 1,
                          bathrooms: 2,
                          kitchens: 7,
                        },
                      }),
                    },
                  }
                : property
            ),
          },
        },
        result: null,
      }))
    );
    await act(async () => setInput(inputWithin(edit, "عدد الحمامات"), "3"));
    await act(async () =>
      setSelect(selectWithin(edit, "وصف العقار"), "villas")
    );
    await act(async () =>
      edit
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      parsePropertyProfile(
        api.state.entities.properties.find(
          property => property.id === propertyId
        )!.meta.propertyProfile
      ).accommodation
    ).toEqual({
      roomLayout: "custom",
      bedrooms: 4,
      livingRooms: 1,
      bathrooms: 2,
      kitchens: 7,
    });
    expect(edit.textContent).toContain("تعديل أحدث");
    expect(inputWithin(edit, "عدد الحمامات").value).toBe("3");
    await act(async () => findButton("إلغاء").click());
    await act(async () => findButton("تجاهل التغييرات والإغلاق").click());
    await act(async () => findButton("تعديل العقار").click());
    const freshEdit = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(inputWithin(freshEdit, "عدد المطابخ").value).toBe("7");
    await act(async () =>
      setInput(inputWithin(freshEdit, "عدد الحمامات"), "3")
    );
    await act(async () =>
      freshEdit
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      parsePropertyProfile(
        api.state.entities.properties.find(row => row.id === propertyId)!.meta
          .propertyProfile
      ).accommodation?.bathrooms
    ).toBe(3);

    expect(
      api.state.entities.units.filter(unit => unit.propertyId === propertyId)
    ).toHaveLength(1);
    expect(financialRelationships()).toEqual(before);
  });

  it.each([
    { goal: "sale", layout: "studio", bedrooms: 0, livingRooms: 0 },
    { goal: "rent", layout: "4-living", bedrooms: 4, livingRooms: 1 },
    { goal: "mixed", layout: "2-living", bedrooms: 2, livingRooms: 1 },
  ])(
    "saves a whole $goal property's visible layout and written description independently of unit composition",
    async ({ goal, layout, bedrooms, livingRooms }) => {
      const before = financialRelationships();
      await act(async () => findButton("إضافة عقار").click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      await act(async () =>
        setInput(inputWithin(dialog, "اسم العقار"), `عقار كامل ${goal}`)
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "المحفظة"), "family")
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "وصف العقار"), "villas")
      );
      // Description no longer forces a split: whole-asset configuration stays visible.
      expect(selectWithin(dialog, "طريقة إدارة العقار").value).toBe("whole");
      await act(async () =>
        setSelect(selectWithin(dialog, "هدف العقار"), goal)
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "تكوين العقار الكامل"), layout)
      );
      await act(async () => setInput(inputWithin(dialog, "عدد الحمامات"), "2"));
      await act(async () => setInput(inputWithin(dialog, "عدد المطابخ"), "1"));
      await act(async () =>
        setSelect(selectWithin(dialog, "التأثيث"), "furnished")
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "ترتيب الفيلا"), "attached")
      );
      await act(async () =>
        setTextareaWithin(
          dialog,
          "وصف نصي إضافي",
          "فيلا كاملة بحديقة ومدخل خاص"
        )
      );
      expect(dialog.querySelector("textarea")!.closest("details")).toBeNull();
      expect(
        [...selectWithin(dialog, "تكوين العقار الكامل").options].map(
          option => option.textContent
        )
      ).toEqual(
        expect.arrayContaining([
          "استوديو",
          "غرفة وصالة",
          "غرفتان وصالة",
          "3 غرف وصالة",
          "4 غرف وصالة",
          "5 غرف وصالة",
          "توزيع مخصص",
        ])
      );
      await act(async () =>
        dialog
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      const property = api.state.entities.properties.find(
        row => row.title === `عقار كامل ${goal}`
      )!;
      expect(property).toBeTruthy();
      const saved = parsePropertyProfile(property.meta.propertyProfile);
      expect(saved).toMatchObject({
        unitComposition: "villas",
        purpose: goal,
        accommodation: {
          roomLayout: layout,
          bedrooms,
          livingRooms,
          bathrooms: 2,
          kitchens: 1,
          furnishing: "furnished",
          villaArrangement: "attached",
        },
      });
      expect(property.meta.description).toBe("فيلا كاملة بحديقة ومدخل خاص");
      const units = api.state.entities.units.filter(
        unit => unit.propertyId === property.id
      );
      expect(units).toHaveLength(1);
      expect(units[0].meta.wholeProperty).toBe(true);
      expect(
        parseUnitProfile(units[0].meta.unitProfile).roomLayout
      ).toBeUndefined();
      expect(financialRelationships()).toEqual(before);
      await act(async () =>
        root.render(
          <PrototypeProvider>
            <Capture>
              <PropertyDetailPage id={property.id} />
            </Capture>
          </PrototypeProvider>
        )
      );
      expect(host.textContent).toContain("تكوين العقار الكامل");
      expect(host.textContent).toContain("فيلا كاملة بحديقة ومدخل خاص");
      await act(async () => findButton("تعديل العقار").click());
      const edit = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(selectWithin(edit, "تكوين العقار الكامل").value).toBe(layout);
      expect(inputWithin(edit, "عدد الحمامات").value).toBe("2");
      expect(selectWithin(edit, "التأثيث").value).toBe("furnished");
      await act(async () =>
        setInput(
          inputWithin(edit, "اسم العقار"),
          `عقار كامل ${goal} · تعديل الاسم`
        )
      );
      await act(async () =>
        edit
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      expect(
        parsePropertyProfile(
          api.state.entities.properties.find(row => row.id === property.id)!
            .meta.propertyProfile
        ).accommodation
      ).toEqual(saved.accommodation);
      expect(
        api.state.entities.units.filter(unit => unit.propertyId === property.id)
      ).toEqual(units);
      expect(financialRelationships()).toEqual(before);
    }
  );

  it.each([
    { choice: "apartments", label: "شقق", suggested: "apartment" },
    { choice: "villas", label: "فلل", suggested: "villa" },
    { choice: "coded_units", label: "وحدات ترميز", suggested: "" },
  ])(
    "stores $label in the add-property description select and restores it independently of text and units",
    async ({ choice, label, suggested }) => {
      const financialBefore = financialRelationships();
      await act(async () => findButton("إضافة عقار").click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const description = selectWithin(dialog, "وصف العقار");
      expect(description.tagName).toBe("SELECT");
      expect(
        [...description.options].map(option => option.textContent)
      ).toEqual(expect.arrayContaining(["شقق", "فلل", "وحدات ترميز"]));
      expect(
        description.closest('[data-property-section="basic"]')
      ).toBeTruthy();
      expect(
        [
          ...dialog.querySelectorAll<HTMLElement>(
            ".property-form-section[data-property-section]"
          ),
        ].map(section => section.dataset.propertySection)
      ).toEqual([
        "basic",
        "units-pricing",
        "areas-tenancy",
        "location",
        "media",
      ]);
      expect(
        dialog.querySelector('[data-property-section="extra"]')
      ).toBeTruthy();
      await act(async () =>
        setInput(inputWithin(dialog, "اسم العقار"), `وصف العقار ${label}`)
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "المحفظة"), "family")
      );
      await act(async () => setSelect(description, choice));
      expect(selectWithin(dialog, "طريقة إدارة العقار").value).toBe("whole");
      expect(
        dialog
          .querySelector<HTMLTextAreaElement>("textarea")!
          .closest('[data-property-section="basic"]')
      ).toBeTruthy();
      await act(async () =>
        setSelect(selectWithin(dialog, "طريقة إدارة العقار"), "units")
      );
      expect(inputWithin(dialog, "عدد الوحدات الأولية").value).toBe("2");
      await act(async () =>
        setTextareaWithin(
          dialog,
          "وصف نصي إضافي",
          "نص سابق محفوظ مستقل عن التصنيف"
        )
      );
      await act(async () =>
        dialog
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      const property = api.state.entities.properties.find(
        row => row.title === `وصف العقار ${label}`
      )!;
      expect(
        parsePropertyProfile(property.meta.propertyProfile).unitComposition
      ).toBe(choice);
      expect(property.meta.description).toBe("نص سابق محفوظ مستقل عن التصنيف");
      const unitsBefore = structuredClone(
        api.state.entities.units.filter(unit => unit.propertyId === property.id)
      );
      expect(unitsBefore).toHaveLength(2);
      expect(unitsBefore.map(unit => unit.meta.unitCode)).toEqual([
        "U-01",
        "U-02",
      ]);
      const setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(setup.textContent).toContain("إكمال بيانات الوحدات");
      expect(selectWithin(setup, "نوع الوحدة").value).toBe(suggested);
      expect(
        parseUnitProfile(unitsBefore[0].meta.unitProfile).category
      ).toBeUndefined();
      if (suggested === "apartment")
        expect(selectWithin(setup, "توزيع الشقة").value).toBe("");
      if (suggested === "villa")
        expect(selectWithin(setup, "ترتيب الفيلا").value).toBe("");
      await act(async () =>
        root.render(
          <PrototypeProvider>
            <Capture>
              <PropertyDetailPage id={property.id} />
            </Capture>
          </PrototypeProvider>
        )
      );
      const descriptionFact = [...host.querySelectorAll("dt")].find(
        dt => dt.textContent === "وصف العقار"
      )!;
      expect(
        descriptionFact.parentElement!.querySelector("dd")!.textContent
      ).toBe(label);
      await act(async () => findButton("تعديل العقار").click());
      const edit = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(selectWithin(edit, "وصف العقار").value).toBe(choice);
      expect(
        edit.querySelector<HTMLTextAreaElement>('[name="description"]')!.value
      ).toBe("نص سابق محفوظ مستقل عن التصنيف");
      await act(async () =>
        setSelect(
          selectWithin(edit, "وصف العقار"),
          choice === "villas" ? "apartments" : "villas"
        )
      );
      await act(async () =>
        edit
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      expect(
        api.state.entities.units.filter(unit => unit.propertyId === property.id)
      ).toEqual(unitsBefore);
      expect(
        api.state.entities.properties.find(row => row.id === property.id)!.meta
          .description
      ).toBe("نص سابق محفوظ مستقل عن التصنيف");
      expect(financialRelationships()).toEqual(financialBefore);
    }
  );

  it.each([
    { rentalMode: "whole", label: "عقار كامل" },
    { rentalMode: "units", label: "عقار جزئي" },
  ])(
    "stores and restores Arabic location identifiers and references for a $label without financial side effects",
    async ({ rentalMode, label }) => {
      const financialBefore = financialRelationships();
      await act(async () => findButton("إضافة عقار").click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      await act(async () =>
        setInput(inputWithin(dialog, "اسم العقار"), `موقع ${label}`)
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "المحفظة"), "family")
      );
      await act(async () =>
        setSelect(selectWithin(dialog, "طريقة إدارة العقار"), rentalMode)
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم السند"), "٠٠٠٧١")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم المخطط العقاري"), "٠٠٠٩١")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم العقار"), "٠٠٠٠٣")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم الكهرباء / العداد"), "٠٠٠٤٤")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "الموقع الوصفي"), "الدوحة · منطقة الخليج")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم المنطقة"), "٠٠٦")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم الشارع"), "٠٠١٢")
      );
      await act(async () =>
        setInput(inputWithin(dialog, "رقم المبنى"), "٠٠٠٨")
      );
      await act(async () =>
        setInput(
          inputWithin(dialog, "رابط الموقع"),
          "https://maps.example.com/property/0008"
        )
      );
      expect(
        inputWithin(dialog, "رقم السند").closest<HTMLElement>(
          "[data-property-section]"
        )?.dataset.propertySection
      ).toBe("basic");
      expect(
        inputWithin(dialog, "رقم المخطط العقاري").closest<HTMLElement>(
          "[data-property-section]"
        )?.dataset.propertySection
      ).toBe("basic");
      await act(async () =>
        dialog
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      const property = api.state.entities.properties.find(
        row => row.title === `موقع ${label}`
      )!;
      expect(property.meta.deedRef).toBe("٠٠٠٧١");
      expect(property.meta.planNumber).toBe("٠٠٠٩١");
      expect(property.meta.planRef).toBe("٠٠٠٩١");
      expect(property.meta.propertyNumber).toBe("٠٠٠٠٣");
      expect(property.meta.electricityNumber).toBe("٠٠٠٤٤");
      expect(property.meta.location).toBe("الدوحة · منطقة الخليج");
      expect(parsePropertyLocation(property.meta.propertyLocation)).toEqual({
        v: 1,
        zoneNumber: "٠٠٦",
        streetNumber: "٠٠١٢",
        buildingNumber: "٠٠٠٨",
        mapUrl: "https://maps.example.com/property/0008",
      });
      expect(property.meta.zoneNumber).toBeUndefined();
      expect(property.meta.streetNumber).toBeUndefined();
      expect(property.meta.buildingNumber).toBeUndefined();
      expect(property.meta.mapUrl).toBeUndefined();
      expect(financialRelationships()).toEqual(financialBefore);

      await act(async () =>
        root.render(
          <PrototypeProvider>
            <Capture>
              <PropertyDetailPage id={property.id} />
            </Capture>
          </PrototypeProvider>
        )
      );
      expect(host.textContent).toContain("رقم السند");
      expect(host.textContent).toContain("٠٠٠٧١");
      expect(host.textContent).toContain("رقم المخطط العقاري");
      expect(host.textContent).toContain("٠٠٠٩١");
      expect(host.textContent).toContain("رقم المنطقة");
      expect(host.textContent).toContain("٠٠٦");
      const mapLink = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
        link => link.textContent === "فتح رابط الموقع"
      );
      expect(mapLink?.href).toBe("https://maps.example.com/property/0008");

      await act(async () => findButton("تعديل العقار").click());
      const edit = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(inputWithin(edit, "رقم المنطقة").value).toBe("٠٠٦");
      expect(inputWithin(edit, "رقم الشارع").value).toBe("٠٠١٢");
      expect(inputWithin(edit, "رقم المبنى").value).toBe("٠٠٠٨");
      expect(inputWithin(edit, "رابط الموقع").value).toBe(
        "https://maps.example.com/property/0008"
      );
      await act(async () => setInput(inputWithin(edit, "رقم المنطقة"), "٠٠٧"));
      await act(async () =>
        edit
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          )
      );
      const updated = api.state.entities.properties.find(
        row => row.id === property.id
      )!;
      expect(parsePropertyLocation(updated.meta.propertyLocation)).toEqual({
        v: 1,
        zoneNumber: "٠٠٧",
        streetNumber: "٠٠١٢",
        buildingNumber: "٠٠٠٨",
        mapUrl: "https://maps.example.com/property/0008",
      });
      expect(updated.meta.location).toBe("الدوحة · منطقة الخليج");
      expect(financialRelationships()).toEqual(financialBefore);
    }
  );

  it("rejects a credential-bearing location URL and retains the property draft", async () => {
    const propertyCount = api.state.entities.properties.length;
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "رابط موقع غير آمن")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setInput(
        inputWithin(dialog, "رابط الموقع"),
        "https://user:secret@maps.example.com/property"
      )
    );
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.textContent).toContain(
      "رابط الموقع يجب أن يكون HTTP أو HTTPS"
    );
    expect(inputWithin(dialog, "رابط الموقع").value).toBe(
      "https://user:secret@maps.example.com/property"
    );
    expect(api.state.entities.properties).toHaveLength(propertyCount);
  });

  it("adds a sale/mortgaged property and described villa, studio, and 7-room custom units without changing financial relationships", async () => {
    const unchangedFinancialRelationships = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const propertyDialog =
      document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(
        propertyDialog.querySelector<HTMLInputElement>("input")!,
        "عمارة الوصف والبيع"
      )
    );
    await act(async () =>
      setSelect(selectWithin(propertyDialog, "المحفظة"), "family")
    );
    await act(async () =>
      setSelect(selectWithin(propertyDialog, "طريقة إدارة العقار"), "units")
    );
    await act(async () =>
      setSelect(selectWithin(propertyDialog, "هدف العقار"), "sale")
    );
    await act(async () =>
      setSelect(selectWithin(propertyDialog, "حالة الرهن"), "mortgaged")
    );
    await act(async () =>
      setInput(
        inputWithin(propertyDialog, "اسم بنك الرهن"),
        "بنك الرهن التجريبي"
      )
    );
    expect(propertyDialog.textContent).toContain(
      "يُحدد في معلومات الوحدة في المرحلة الثانية"
    );
    expect(propertyDialog.textContent).not.toContain("سعر البيع المطلوب (ر.ق)");
    expect(propertyDialog.textContent).not.toContain("الإيجار الشهري");
    await act(async () =>
      setInput(inputWithin(propertyDialog, "عدد الوحدات الأولية"), "2")
    );
    await act(async () =>
      propertyDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    const property = api.state.entities.properties.find(
      row => row.title === "عمارة الوصف والبيع"
    )!;
    expect(parsePropertyProfile(property.meta.propertyProfile)).toEqual({
      v: 1,
      purpose: "sale",
      mortgageStatus: "mortgaged",
      mortgageBank: "بنك الرهن التجريبي",
    });
    expect(property.meta.monthlyRentMinor).toBeUndefined();
    expect(property.meta.unitMonthlyRentMinor).toBeUndefined();
    expect(property.amountMinor).toBe(0);
    const setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(setup.textContent).toContain("إكمال بيانات الوحدات");
    expect(inputWithin(setup, "رقم العقار")).toBeTruthy();
    expect(inputWithin(setup, "رقم المخطط")).toBeTruthy();
    expect(inputWithin(setup, "رقم الكهرباء")).toBeTruthy();
    expect(setup.textContent).toContain("معرض الصور");
    const initialUnits = api.state.entities.units.filter(
      row => row.propertyId === property.id
    );
    expect(initialUnits).toHaveLength(2);
    expect(new Set(initialUnits.map(row => row.meta.unitCode)).size).toBe(2);
    await act(async () =>
      setInput(inputWithin(setup, "سعر بيع الوحدة المطلوب"), "٢٬٥٠٠٬٠٠٠٫٥٠")
    );
    await act(async () => findButton("حفظ ومتابعة").click());
    expect(
      parseUnitProfile(
        api.state.entities.units.find(row => row.id === initialUnits[0].id)!
          .meta.unitProfile
      ).salePriceMinor
    ).toBe(250_000_050);
    expect(
      parseUnitProfile(
        api.state.entities.units.find(row => row.id === initialUnits[1].id)!
          .meta.unitProfile
      ).salePriceMinor
    ).toBeUndefined();
    await act(async () =>
      setInput(
        inputWithin(
          document.querySelector<HTMLElement>('[role="dialog"]')!,
          "سعر بيع الوحدة المطلوب"
        ),
        "٦٥٠٬٠٠٠"
      )
    );
    await act(async () => findButton("حفظ وإنهاء").click());
    expect(
      parseUnitProfile(
        api.state.entities.units.find(row => row.id === initialUnits[1].id)!
          .meta.unitProfile
      ).salePriceMinor
    ).toBe(65_000_000);
    expect(host.textContent).toContain("بيع · مرهون");
    expect(financialRelationships()).toEqual(unchangedFinancialRelationships);

    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      );
    });
    expect(host.textContent).toContain("هدف العقار");
    expect(host.textContent).toContain("حالة الرهن");

    async function openUnitDialog() {
      await act(async () => findButton("إضافة وحدة").click());
      return document.querySelector<HTMLElement>('[role="dialog"]')!;
    }

    const villaDialog = await openUnitDialog();
    await act(async () =>
      setInput(inputWithin(villaDialog, "اسم الوحدة"), "فيلا QA منفصلة")
    );
    await act(async () =>
      setSelect(selectWithin(villaDialog, "فئة الوحدة"), "villa")
    );
    await act(async () =>
      setSelect(selectWithin(villaDialog, "ترتيب الفيلا"), "detached")
    );
    await act(async () =>
      setSelect(selectWithin(villaDialog, "التأثيث"), "furnished")
    );
    await act(async () =>
      villaDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const villa = api.state.entities.units.find(
      row => row.title === "فيلا QA منفصلة"
    )!;
    expect(parseUnitProfile(villa.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "detached",
      furnishing: "furnished",
    });

    const studioDialog = await openUnitDialog();
    await act(async () =>
      setInput(inputWithin(studioDialog, "اسم الوحدة"), "شقة QA استوديو")
    );
    await act(async () =>
      setSelect(selectWithin(studioDialog, "فئة الوحدة"), "apartment")
    );
    await act(async () =>
      setSelect(selectWithin(studioDialog, "توزيع الشقة"), "studio")
    );
    await act(async () =>
      studioDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      parseUnitProfile(
        api.state.entities.units.find(row => row.title === "شقة QA استوديو")!
          .meta.unitProfile
      )
    ).toMatchObject({
      category: "apartment",
      apartmentLayout: "studio",
      bedrooms: 0,
      livingRooms: 0,
    });

    const customDialog = await openUnitDialog();
    await act(async () =>
      setInput(inputWithin(customDialog, "اسم الوحدة"), "شقة QA مخصصة")
    );
    await act(async () =>
      setSelect(selectWithin(customDialog, "فئة الوحدة"), "apartment")
    );
    await act(async () =>
      setSelect(selectWithin(customDialog, "توزيع الشقة"), "custom")
    );
    await act(async () =>
      setInput(inputWithin(customDialog, "عدد الغرف"), "7")
    );
    await act(async () =>
      setInput(inputWithin(customDialog, "عدد الصالات"), "2")
    );
    await act(async () =>
      setInput(inputWithin(customDialog, "عدد الحمامات"), "5")
    );
    await act(async () =>
      setInput(inputWithin(customDialog, "عدد المطابخ"), "1")
    );
    await act(async () =>
      setInput(inputWithin(customDialog, "خيار محتويات جديد"), "شرفتان وموقفان")
    );
    await act(async () => findButton("إضافة وحفظ الخيار").click());
    await act(async () =>
      customDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const custom = api.state.entities.units.find(
      row => row.title === "شقة QA مخصصة"
    )!;
    expect(parseUnitProfile(custom.meta.unitProfile)).toMatchObject({
      category: "apartment",
      apartmentLayout: "custom",
      bedrooms: 7,
      livingRooms: 2,
      bathrooms: 5,
      kitchens: 1,
      contents: "شرفتان وموقفان",
    });
    expect(financialRelationships()).toEqual(unchangedFinancialRelationships);

    const customRow = [
      ...host.querySelectorAll<HTMLTableRowElement>("tbody tr"),
    ].find(row => row.textContent?.includes("شقة QA مخصصة"))!;
    await act(async () =>
      [...customRow.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => button.textContent?.includes("التفاصيل"))!
        .click()
    );
    const details = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(details.textContent).toContain("7");
    expect(details.textContent).toContain("شرفتان وموقفان");
    expect(details.textContent).toContain("معرض الصور");
  });

  it("saves Arabic QAR monthly rent for a whole property without changing its amountMinor and shows it in the registry", async () => {
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const title = dialog.querySelector<HTMLInputElement>("input")!;
    const portfolio = selectWithin(dialog, "المحفظة");
    const monthlyRent = [
      ...dialog.querySelectorAll<HTMLInputElement>("input"),
    ].find(input =>
      input.closest("label")?.textContent?.includes("الإيجار الشهري")
    )!;

    await act(async () => setInput(title, "فيلا الإيجار العربي"));
    await act(async () => {
      portfolio.value = "family";
      portfolio.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => setInput(monthlyRent, "١٬٢٣٤٫٥٠"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    const property = api.state.entities.properties.find(
      row => row.title === "فيلا الإيجار العربي"
    )!;
    expect(property.meta.monthlyRentMinor).toBe(123_450);
    expect(property.meta.unitMonthlyRentMinor).toBeUndefined();
    expect(property.amountMinor).toBe(0);
    expect(
      api.state.entities.units.find(row => row.propertyId === property.id)?.meta
        .monthlyRentMinor
    ).toBeUndefined();
    expect(host.textContent).toContain("1,234.5 ر.ق");
  });

  it("stops a property action click, keeps entered values after validation rejection, and returns focus on Escape", async () => {
    let bubbled = 0;
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <div onClick={() => (bubbled += 1)}>
              <PropertiesPage />
            </div>
          </Capture>
        </PrototypeProvider>
      );
    });
    const trigger = findButton("إضافة عقار");
    trigger.focus();
    await act(async () => trigger.click());
    expect(bubbled).toBe(0);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const title = dialog.querySelector<HTMLInputElement>(
      'input[type="text"], input'
    )!;
    await act(async () => setInput(title, "قيمة لا تضيع"));
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "محفظة"
    );
    expect(
      document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value
    ).toBe("قيمة لا تضيع");

    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(dialog.textContent).toContain("تغييرات غير محفوظة");
    await act(async () => findButton("تجاهل التغييرات والإغلاق").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the custom unit dialog with trapped focus and no manual occupied option", async () => {
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "عمارة حوار الوحدة",
        portfolioId: "family",
        assetType: "building",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "units",
        unitCount: "2",
        requestId: "unit-dialog-p11",
      }).id;
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={propertyId} />
          </Capture>
        </PrototypeProvider>
      );
    });
    const trigger = findButton("إضافة وحدة");
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("لا يمكن اختيار «مشغولة» يدويًا");
    expect(
      [...dialog.querySelectorAll<HTMLOptionElement>("option")].some(
        option => option.value === "مشغولة"
      )
    ).toBe(false);
    const focusable = dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(first);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("requires a mortgage bank only while mortgaged and never stores a hidden bank for a free property", async () => {
    const before = api.state.entities.properties.length;
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "رهن دون بنك")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setSelect(selectWithin(dialog, "حالة الرهن"), "mortgaged")
    );
    expect(inputWithin(dialog, "اسم بنك الرهن").required).toBe(true);
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(api.state.entities.properties).toHaveLength(before);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "بنك"
    );
    expect(inputWithin(dialog, "اسم العقار").value).toBe("رهن دون بنك");
    await act(async () =>
      setInput(inputWithin(dialog, "اسم بنك الرهن"), "بنك غير مستخدم")
    );
    await act(async () =>
      setSelect(selectWithin(dialog, "حالة الرهن"), "free")
    );
    expect(dialog.textContent).not.toContain("اسم بنك الرهن");
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "رهن دون بنك"
    )!;
    expect(parsePropertyProfile(property.meta.propertyProfile)).toEqual({
      v: 1,
      mortgageStatus: "free",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("replaces the rental field with a sale asking price and preserves historical rent through a purpose change", async () => {
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "تحويل الهدف دون مسح",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "whole",
        unitCount: "1",
        monthlyRent: "١٬٢٣٤٫٥٠",
        propertyProfile: JSON.stringify({ v: 1, purpose: "rent" }),
        requestId: "sale-preserve-rent",
      }).id;
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={propertyId} />
          </Capture>
        </PrototypeProvider>
      );
    });
    const financialBefore = financialRelationships();
    const unitsBefore = structuredClone(api.state.entities.units);
    await act(async () => findButton("تعديل العقار").click());
    let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(inputWithin(dialog, "الإيجار الشهري").value).toBe("1234.5");
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "sale")
    );
    expect(dialog.textContent).not.toContain("الإيجار الشهري");
    await act(async () =>
      setInput(inputWithin(dialog, "سعر البيع المطلوب"), "١٬٩٩٩٬٠٠٠٫٢٥")
    );
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.id === propertyId
    )!;
    expect(property.meta.monthlyRentMinor).toBe(123_450);
    expect(parsePropertyProfile(property.meta.propertyProfile)).toMatchObject({
      purpose: "sale",
      salePriceMinor: 199_900_025,
    });
    expect(property.amountMinor).toBe(0);
    expect(api.state.entities.units).toEqual(unitsBefore);
    expect(financialRelationships()).toEqual(financialBefore);
    expect(host.textContent).toContain("سعر البيع المطلوب");
    await act(async () => findButton("تعديل العقار").click());
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(inputWithin(dialog, "سعر البيع المطلوب").value).toBe("1999000.25");
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "rent")
    );
    expect(inputWithin(dialog, "الإيجار الشهري").value).toBe("1234.5");
    expect(dialog.textContent).not.toContain("سعر البيع المطلوب");
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const rentedAgain = api.state.entities.properties.find(
      row => row.id === propertyId
    )!;
    expect(
      parsePropertyProfile(rentedAgain.meta.propertyProfile)
    ).toMatchObject({ purpose: "rent", salePriceMinor: toMinor("1999000.25") });
    expect(rentedAgain.meta.monthlyRentMinor).toBe(toMinor("1234.50"));
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () => findButton("تعديل العقار").click());
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "sale")
    );
    expect(inputWithin(dialog, "سعر البيع المطلوب").value).toBe("1999000.25");
  });

  it("opens stage two for nine units, saves their identifiers, and resumes without recreating or renumbering units", async () => {
    const financialBefore = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "عمارة المرحلتين · تسع وحدات")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setSelect(selectWithin(dialog, "طريقة إدارة العقار"), "units")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "عدد الوحدات الأولية"), "9")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "رقم العقار"), "٠٠٠١٢٣")
    );
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "عمارة المرحلتين · تسع وحدات"
    )!;
    const initialUnits = api.state.entities.units.filter(
      row => row.propertyId === property.id
    );
    expect(initialUnits).toHaveLength(9);
    expect(initialUnits.map(row => row.meta.unitCode)).toEqual([
      "U-01",
      "U-02",
      "U-03",
      "U-04",
      "U-05",
      "U-06",
      "U-07",
      "U-08",
      "U-09",
    ]);
    const setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(setup.textContent).toContain("إكمال بيانات الوحدات");
    expect(setup.textContent).toContain("٠٠٠١٢٣");
    await act(async () =>
      setInput(inputWithin(setup, "اسم الوحدة"), "شقة المرحلة الثانية الأولى")
    );
    await act(async () => setInput(inputWithin(setup, "رقم العقار"), "٠٠٠٩٠١"));
    await act(async () => setInput(inputWithin(setup, "رقم المخطط"), "٠٠٢١"));
    await act(async () => setInput(inputWithin(setup, "رقم الكهرباء"), "٠٠٣١"));
    await act(async () => setInput(inputWithin(setup, "رقم الماء"), "٠٠٤١"));
    await act(async () =>
      setInput(inputWithin(setup, "إيجار الوحدة الشهري"), "١٬٢٣٤٫٥٠")
    );
    await act(async () =>
      setInput(inputWithin(setup, "سعر بيع الوحدة المطلوب"), "٦٥٠٬٠٠٠")
    );
    await act(async () => findButton("حفظ ومتابعة").click());
    const firstSaved = api.state.entities.units.find(
      row => row.id === initialUnits[0].id
    )!;
    expect(firstSaved.title).toBe("شقة المرحلة الثانية الأولى");
    expect(firstSaved.meta.unitCode).toBe("U-01");
    expect(firstSaved.meta.electricityNumber).toBe("٠٠٣١");
    expect(parseUnitProfile(firstSaved.meta.unitProfile)).toMatchObject({
      propertyNumber: "٠٠٠٩٠١",
      planNumber: "٠٠٢١",
      waterNumber: "٠٠٤١",
    });
    expect(firstSaved.meta.monthlyRentMinor).toBe(123_450);
    expect(parseUnitProfile(firstSaved.meta.unitProfile).salePriceMinor).toBe(
      65_000_000
    );
    expect(
      inputWithin(
        document.querySelector<HTMLElement>('[role="dialog"]')!,
        "اسم الوحدة"
      ).value
    ).toBe(initialUnits[1].title);
    await act(async () => findButton("إكمال لاحقًا").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    await act(async () => findButton("إكمال بيانات الوحدات").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "إكمال بيانات الوحدات"
    );
    expect(
      api.state.entities.units
        .filter(row => row.propertyId === property.id)
        .map(row => [row.id, row.meta.unitCode])
    ).toEqual(initialUnits.map(row => [row.id, row.meta.unitCode]));
    expect(financialRelationships()).toEqual(financialBefore);
  });

  it("persists a villa complex description and reusable content choice with different rental/sale unit goals", async () => {
    const financialBefore = financialRelationships();
    const propertyCount = api.state.entities.properties.length;
    await act(async () => findButton("إضافة عقار").click());
    const formDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(
        inputWithin(formDialog, "اسم العقار"),
        "مجمع الوصف والأهداف المختلفة"
      )
    );
    await act(async () =>
      setSelect(selectWithin(formDialog, "المحفظة"), "family")
    );
    await act(async () =>
      setSelect(selectWithin(formDialog, "نوع الأصل"), "villa_complex")
    );
    await act(async () =>
      setSelect(selectWithin(formDialog, "هدف العقار"), "mixed")
    );
    await act(async () =>
      setSelect(selectWithin(formDialog, "طريقة إدارة العقار"), "units")
    );
    await act(async () =>
      setTextareaWithin(
        formDialog,
        "وصف نصي إضافي",
        "مجمع فلل بمدخل مشترك وحديقة"
      )
    );
    await act(async () =>
      setInput(
        inputWithin(formDialog, "خيار محتويات جديد"),
        "غرفة ألعاب وحديقة خاصة"
      )
    );
    await act(async () => findButton("إضافة وحفظ الخيار").click());
    expect(api.state.settings.contentPresets).toContain(
      "غرفة ألعاب وحديقة خاصة"
    );
    expect(api.state.entities.properties).toHaveLength(propertyCount);
    await act(async () =>
      formDialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "مجمع الوصف والأهداف المختلفة"
    )!;
    expect(property.meta.assetType).toBe("villa_complex");
    expect(property.meta.description).toBe("مجمع فلل بمدخل مشترك وحديقة");
    expect(parsePropertyProfile(property.meta.propertyProfile)).toMatchObject({
      purpose: "mixed",
      contents: "غرفة ألعاب وحديقة خاصة",
    });
    const initialUnits = api.state.entities.units.filter(
      row => row.propertyId === property.id
    );
    expect(initialUnits).toHaveLength(2);
    let setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(selectWithin(setup, "هدف الوحدة").required).toBe(true);
    await act(async () =>
      setup
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(selectWithin(setup, "هدف الوحدة").validity.valueMissing).toBe(true);
    expect(setup.textContent).toContain("حدد هدف هذه الوحدة أولًا");
    await act(async () => setSelect(selectWithin(setup, "هدف الوحدة"), "rent"));
    await act(async () =>
      setInput(inputWithin(setup, "إيجار الوحدة الشهري"), "٣٬٥٠٠")
    );
    await act(async () =>
      setTextareaWithin(setup, "وصف الوحدة", "استوديو في الطابق الأرضي")
    );
    await act(async () =>
      setSelect(selectWithin(setup, "محتويات الوحدة"), "استوديو")
    );
    await act(async () => findButton("حفظ ومتابعة").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => setSelect(selectWithin(setup, "هدف الوحدة"), "sale"));
    await act(async () =>
      setInput(inputWithin(setup, "سعر بيع الوحدة المطلوب"), "٦٥٠٬٠٠٠")
    );
    await act(async () =>
      setTextareaWithin(setup, "وصف الوحدة", "فيلا بحديقة للبيع")
    );
    await act(async () =>
      setSelect(selectWithin(setup, "محتويات الوحدة"), "غرفة ألعاب وحديقة خاصة")
    );
    await act(async () => findButton("حفظ وإنهاء").click());
    const units = api.state.entities.units.filter(
      row => row.propertyId === property.id
    );
    expect(parseUnitProfile(units[0].meta.unitProfile)).toMatchObject({
      purpose: "rent",
      contents: "استوديو",
    });
    expect(units[0].meta.description).toBe("استوديو في الطابق الأرضي");
    expect(units[0].meta.monthlyRentMinor).toBe(toMinor("3500"));
    expect(parseUnitProfile(units[1].meta.unitProfile)).toMatchObject({
      purpose: "sale",
      contents: "غرفة ألعاب وحديقة خاصة",
      salePriceMinor: toMinor("650000"),
    });
    expect(units[1].meta.monthlyRentMinor).toBeUndefined();
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain("مجمع فلل");
    expect(host.textContent).toContain("مجمع فلل بمدخل مشترك وحديقة");
    expect(host.textContent).toContain(`للإيجار: ${money(toMinor("3500"))}`);
    expect(host.textContent).toContain(`للبيع: ${money(toMinor("650000"))}`);
    await act(async () => findButton("إكمال بيانات الوحدات").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(selectWithin(setup, "هدف الوحدة").value).toBe("rent");
    expect(setup.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "استوديو في الطابق الأرضي"
    );
    expect(
      [...selectWithin(setup, "محتويات الوحدة").options].some(
        option => option.value === "غرفة ألعاب وحديقة خاصة"
      )
    ).toBe(true);
    expect(
      api.state.entities.units
        .filter(row => row.propertyId === property.id)
        .map(row => row.id)
    ).toEqual(initialUnits.map(row => row.id));
  });

  it("keeps a mixed whole asset priced once at property level with rent and sale values and one internal target", async () => {
    const financialBefore = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "فيلا كاملة بيع وإيجار")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "mixed")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "الإيجار الشهري"), "١٬٢٣٤٫٥٠")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "سعر البيع المطلوب"), "٢٬٥٠٠٬٠٠٠")
    );
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "فيلا كاملة بيع وإيجار"
    )!;
    expect(property.meta.monthlyRentMinor).toBe(toMinor("1234.50"));
    expect(parsePropertyProfile(property.meta.propertyProfile)).toMatchObject({
      purpose: "mixed",
      salePriceMinor: toMinor("2500000"),
    });
    expect(
      api.state.entities.units.filter(row => row.propertyId === property.id)
    ).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain(money(toMinor("1234.50")));
    expect(host.textContent).toContain(money(toMinor("2500000")));
    expect(host.textContent).toContain("بيع وإيجار");
  });

  it("stores Arabic property/unit areas and separate initial tenancy dates, then displays partial tenancy without financial changes", async () => {
    const financialBefore = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "المساحات وحالة الوحدات")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "rent")
    );
    await act(async () =>
      setSelect(selectWithin(dialog, "طريقة إدارة العقار"), "units")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "مساحة العقار"), "٤٢٠٫٥٠")
    );
    await act(async () => setInput(inputWithin(dialog, "مساحة الأرض"), "٦٠٠"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "المساحات وحالة الوحدات"
    )!;
    expect(property.meta.buildingArea).toBe(420.5);
    expect(property.meta.landArea).toBe(600);
    let setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => setInput(inputWithin(setup, "مساحة الوحدة"), "٨٠"));
    await act(async () =>
      setSelect(selectWithin(setup, "حالة التأجير"), "rented")
    );
    await act(async () =>
      setInput(inputWithin(setup, "تاريخ بداية العقد"), "2026-01-01")
    );
    await act(async () =>
      setInput(inputWithin(setup, "تاريخ نهاية العقد"), "2027-01-01")
    );
    await act(async () => findButton("حفظ ومتابعة").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(setup, "مساحة الوحدة"), "١٤٠٫٥٠")
    );
    await act(async () =>
      setSelect(selectWithin(setup, "حالة التأجير"), "vacant")
    );
    await act(async () => findButton("حفظ وإنهاء").click());
    const units = api.state.entities.units.filter(
      row => row.propertyId === property.id
    );
    expect(parseUnitProfile(units[0].meta.unitProfile).areaM2).toBe(80);
    expect(parseUnitProfile(units[1].meta.unitProfile).areaM2).toBe(140.5);
    expect(JSON.parse(String(units[0].meta.tenancyDeclaration))).toMatchObject({
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    expect(JSON.parse(String(units[1].meta.tenancyDeclaration))).toMatchObject({
      status: "vacant",
    });
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain("تأجير جزئي");
    expect(host.textContent).toContain("2027-01-01");
    expect(host.textContent).toContain("80 م²");
    expect(host.textContent).toContain("140.5 م²");
    await act(async () => findButton("إكمال بيانات الوحدات").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(inputWithin(setup, "مساحة الوحدة").value).toBe("80");
    expect(selectWithin(setup, "حالة التأجير").value).toBe("rented");
    expect(inputWithin(setup, "تاريخ بداية العقد").value).toBe("2026-01-01");
    expect(financialRelationships()).toEqual(financialBefore);
  });

  it("captures a whole property's initial rented dates and areas without creating a lease or receivable", async () => {
    const financialBefore = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "فيلا مؤجرة بإدخال أولي")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () => setInput(inputWithin(dialog, "مساحة العقار"), "٣٠٠"));
    await act(async () => setInput(inputWithin(dialog, "مساحة الأرض"), "٥٠٠"));
    await act(async () =>
      setSelect(selectWithin(dialog, "حالة التأجير"), "rented")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "تاريخ بداية العقد"), "2026-01-01")
    );
    await act(async () =>
      setInput(inputWithin(dialog, "تاريخ نهاية العقد"), "2027-12-31")
    );
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "فيلا مؤجرة بإدخال أولي"
    )!;
    expect(JSON.parse(String(property.meta.tenancyDeclaration))).toMatchObject({
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
    });
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain("مؤجر");
    expect(host.textContent).toContain("إدخال أولي");
    expect(host.textContent).toContain("2027-12-31");
    await act(async () => findButton("تعديل العقار").click());
    const edit = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(selectWithin(edit, "حالة التأجير").value).toBe("rented");
    expect(inputWithin(edit, "مساحة العقار").value).toBe("300");
    expect(inputWithin(edit, "تاريخ بداية العقد").value).toBe("2026-01-01");
  });

  it("shows valid zero property areas and never renders an invalid legacy unit area as measured square meters", async () => {
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "مساحة صفر محفوظة",
        portfolioId: "family",
        assetType: "building",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "units",
        unitCount: "2",
        landArea: "0",
        buildingArea: "0",
        requestId: "area-validation-display",
      }).id;
      api.commitTransition(current => ({
        state: {
          ...current,
          entities: {
            ...current.entities,
            units: current.entities.units.map(unit =>
              unit.propertyId === propertyId
                ? { ...unit, meta: { ...unit.meta, area: true } }
                : unit
            ),
          },
        },
        result: null,
      }));
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={propertyId} />
          </Capture>
        </PrototypeProvider>
      );
    });
    const areaFact = (label: string) =>
      [...host.querySelectorAll("dt")]
        .find(dt => dt.textContent === label)!
        .parentElement!.querySelector("dd")!.textContent;
    expect(areaFact("مساحة الأرض")).toBe("0 م²");
    expect(areaFact("مساحة العقار / البناء")).toBe("0 م²");
    expect(host.textContent).not.toContain("true م²");
    const unitTable = [
      ...host.querySelectorAll<HTMLTableElement>("table"),
    ].find(table =>
      [...table.querySelectorAll("thead th")].some(
        th => th.textContent === "مساحة الوحدة (م²)"
      )
    )!;
    const column = [...unitTable.querySelectorAll("thead th")].findIndex(
      th => th.textContent === "مساحة الوحدة (م²)"
    );
    const unitAreaCells = [
      ...unitTable.querySelectorAll<HTMLTableRowElement>("tbody tr"),
    ].map(row => row.cells[column]);
    expect(unitAreaCells).toHaveLength(2);
    expect(unitAreaCells.every(cell => cell.textContent === "غير مسجلة")).toBe(
      true
    );
  });

  it("classifies and codes apartments and villas in stage two, groups actual units, filters the table, and restores the saved codes", async () => {
    const financialBefore = financialRelationships();
    await act(async () => findButton("إضافة عقار").click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setInput(inputWithin(dialog, "اسم العقار"), "تجميع الشقق والفلل")
    );
    await act(async () => setSelect(selectWithin(dialog, "المحفظة"), "family"));
    await act(async () =>
      setSelect(selectWithin(dialog, "هدف العقار"), "rent")
    );
    await act(async () =>
      setSelect(selectWithin(dialog, "طريقة إدارة العقار"), "units")
    );
    await act(async () => setInput(inputWithin(dialog, "عدد الوحدات"), "3"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const property = api.state.entities.properties.find(
      row => row.title === "تجميع الشقق والفلل"
    )!;
    let setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setSelect(selectWithin(setup, "نوع الوحدة"), "apartment")
    );
    await act(async () =>
      setSelect(selectWithin(setup, "توزيع الشقة"), "1-living")
    );
    await act(async () => setInput(inputWithin(setup, "رمز الوحدة"), "A-01"));
    await act(async () => findButton("حفظ ومتابعة").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () =>
      setSelect(selectWithin(setup, "نوع الوحدة"), "villa")
    );
    await act(async () =>
      setSelect(selectWithin(setup, "ترتيب الفيلا"), "detached")
    );
    await act(async () => setInput(inputWithin(setup, "رمز الوحدة"), "V-01"));
    await act(async () => findButton("حفظ ومتابعة").click());
    await act(async () => findButton("حفظ وإنهاء").click());
    const units = api.state.entities.units.filter(
      unit => unit.propertyId === property.id
    );
    expect(units).toHaveLength(3);
    expect(parseUnitProfile(units[0].meta.unitProfile).category).toBe(
      "apartment"
    );
    expect(parseUnitProfile(units[1].meta.unitProfile).category).toBe("villa");
    expect(units[0].meta.unitCode).toBe("A-01");
    expect(units[1].meta.unitCode).toBe("V-01");
    expect(units[2].meta.unitCode).toBe("U-03");
    expect(financialRelationships()).toEqual(financialBefore);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={property.id} />
          </Capture>
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain("محتويات العقار · تقسيم الوحدات");
    expect(host.textContent).toContain("شقق: 1");
    expect(host.textContent).toContain("فلل: 1");
    expect(host.textContent).toContain("غير مصنفة: 1");
    const table = () =>
      [...host.querySelectorAll<HTMLTableElement>("table")].find(table =>
        [...table.querySelectorAll("thead th")].some(
          th => th.textContent === "نوع الوحدة"
        )
      )!;
    const rows = () => [...table().querySelectorAll("tbody tr")];
    expect(rows()).toHaveLength(3);
    await act(async () =>
      setSelect(selectWithin(host, "تصنيف الوحدات المعروضة"), "apartment")
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("A-01");
    expect(rows()[0].textContent).not.toContain("V-01");
    await act(async () =>
      setSelect(selectWithin(host, "تصنيف الوحدات المعروضة"), "villa")
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("V-01");
    await act(async () =>
      setSelect(selectWithin(host, "تصنيف الوحدات المعروضة"), "all")
    );
    expect(rows()).toHaveLength(3);
    await act(async () => findButton("إكمال بيانات الوحدات").click());
    setup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(inputWithin(setup, "رمز الوحدة").value).toBe("A-01");
    expect(selectWithin(setup, "نوع الوحدة").value).toBe("apartment");
    expect(financialRelationships()).toEqual(financialBefore);
  });

  it("shows a scope restriction for an existing filtered-out property while an absent id still follows NotFound", async () => {
    let propertyId = "";
    await act(async () => {
      propertyId = api.createRentalProperty({
        title: "عقار خارج النطاق",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "whole",
        unitCount: "1",
        requestId: "restricted-property-p11",
      }).id;
      api.setSetting("portfolioId", "another-portfolio");
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id={propertyId} />
          </Capture>
        </PrototypeProvider>
      );
    });
    expect(document.body.textContent).toContain("العقار خارج النطاق الحالي");
    expect(document.body.textContent).toContain("مرشح المحفظة الحالي");

    await act(async () => {
      root.render(
        <PrototypeProvider>
          <Capture>
            <PropertyDetailPage id="absent-property-id" />
          </Capture>
        </PrototypeProvider>
      );
    });
    expect(document.body.textContent).not.toContain(
      "العقار خارج النطاق الحالي"
    );
  });
});
