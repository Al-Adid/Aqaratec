// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import {
  createBrokerContact,
  listBrokerTargets,
  saveBrokerCampaignBatches,
} from "@/lib/broker-marketing";
import { money } from "@shared/prototype";
import { BrokerMarketingPage } from "./BrokerMarketingPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

function Harness() {
  api = usePrototype();
  return <BrokerMarketingPage />;
}

function propertyValues(index: number, title: string, monthlyRent = "3850") {
  return {
    requestId: `marketing-ui-property-${index}`,
    title,
    portfolioId: "family",
    assetType: "villa",
    rentalMode: "whole",
    unitCount: "1",
    inputMethod: "يدوي",
    propertyNumber: `MK-${index}`,
    electricityNumber: `EL-${index}`,
    monthlyRent,
  };
}

async function addBroker(index: number, active = true) {
  await act(async () => {
    api.commitTransition(current =>
      createBrokerContact(current, {
        requestId: `marketing-ui-broker-${index}`,
        companyName:
          index === 1 ? "شركة ألف" : index === 2 ? "شركة باء" : `شركة ${index}`,
        email: `broker-${index}@example.test`,
        contactName: `مسؤول ${index}`,
        active,
      })
    );
  });
}

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    )
  );
  await act(async () => {
    api.createRentalProperty(propertyValues(1, "فيلا الإيجار الافتراضي"));
    api.createRentalProperty(propertyValues(2, "فيلا المرشح الثاني", "4100"));
    api.createRentalProperty(propertyValues(3, "فيلا المرشح الثالث", "4300"));
  });
  await addBroker(1);
  await addBroker(2);
  await addBroker(3, false);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

function setValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector
  )!;
  expect(field).toBeTruthy();
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  return act(async () =>
    field.dispatchEvent(new Event("input", { bubbles: true }))
  );
}

function setSelect(selector: string, value: string) {
  const field = document.querySelector<HTMLSelectElement>(selector)!;
  expect(field).toBeTruthy();
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )!.set!.call(field, value);
  return act(async () =>
    field.dispatchEvent(new Event("change", { bubbles: true }))
  );
}

function button(label: string): HTMLButtonElement {
  const match = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(item => item.textContent?.includes(label));
  expect(match).toBeTruthy();
  return match!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

function campaignRows() {
  return api.state.entities.documents.filter(
    row => row.meta.recordType === "broker-campaign"
  );
}

function dispatchRows() {
  return api.state.entities.documents.filter(
    row => row.meta.recordType === "broker-campaign-dispatch"
  );
}

describe("BrokerMarketingPage", () => {
  it.each(["rent", "sale"] as const)(
    "discards a %s price draft and selection when the same physical unit changes purpose",
    async initialPurpose => {
      let propertyId = "";
      let unitId = "";
      await act(async () => {
        propertyId = api.createRentalProperty({
          ...propertyValues(45, "وحدة تبديل الهدف"),
          rentalMode: "units",
          unitCount: "2",
          propertyProfile: JSON.stringify({ v: 1, purpose: "mixed" }),
        }).id;
      });
      unitId = api.state.entities.units.find(
        unit => unit.propertyId === propertyId
      )!.id;
      await act(async () => {
        api.commitTransition(current => ({
          state: {
            ...current,
            entities: {
              ...current.entities,
              units: current.entities.units.map(unit =>
                unit.id === unitId
                  ? {
                      ...unit,
                      meta: {
                        ...unit.meta,
                        unitCode: "SWITCH",
                        monthlyRentMinor: 385000,
                        unitProfile: JSON.stringify({
                          v: 1,
                          category: "villa",
                          villaArrangement: "detached",
                          purpose: initialPurpose,
                          salePriceMinor: 90000000,
                        }),
                      },
                    }
                  : unit
              ),
            },
          },
          result: undefined,
        }));
      });
      const targetBefore = listBrokerTargets(api.state, {
        includeSale: true,
      }).find(target => target.id === unitId)!;
      expect(targetBefore).toBeTruthy();
      const targetLabel = `${targetBefore.propertyTitle} · ${targetBefore.unitCode === "غير مسجل" ? targetBefore.unitTitle : targetBefore.unitCode}`;
      const toggleSelector = `[aria-label="اختيار ${targetLabel}"]`;
      expect(
        document.querySelector(toggleSelector),
        [...document.querySelectorAll('input[aria-label^="اختيار "]')]
          .map(input => input.getAttribute("aria-label"))
          .join(" | ")
      ).toBeTruthy();
      await act(async () =>
        document.querySelector<HTMLInputElement>(toggleSelector)!.click()
      );
      const oldLabel =
        initialPurpose === "sale" ? "سعر البيع المطلوب" : "الإيجار الشهري";
      const oldDraft = initialPurpose === "sale" ? "950000" : "4200";
      await setValue(`[aria-label="${oldLabel} ${targetLabel}"]`, oldDraft);
      const nextPurpose = initialPurpose === "sale" ? "rent" : "sale";
      await act(async () => {
        api.commitTransition(current => ({
          state: {
            ...current,
            entities: {
              ...current.entities,
              units: current.entities.units.map(unit =>
                unit.id === unitId
                  ? {
                      ...unit,
                      meta: {
                        ...unit.meta,
                        unitProfile: JSON.stringify({
                          v: 1,
                          category: "villa",
                          villaArrangement: "detached",
                          purpose: nextPurpose,
                          salePriceMinor: 90000000,
                        }),
                      },
                    }
                  : unit
              ),
            },
          },
          result: undefined,
        }));
      });
      expect(
        listBrokerTargets(api.state, { includeSale: true }).find(
          target => target.id === unitId
        )!.id
      ).toBe(targetBefore.id);
      expect(
        document.querySelector<HTMLInputElement>(toggleSelector)!.checked
      ).toBe(false);
      const newLabel =
        nextPurpose === "sale" ? "سعر البيع المطلوب" : "الإيجار الشهري";
      const newPrice = document.querySelector<HTMLInputElement>(
        `[aria-label="${newLabel} ${targetLabel}"]`
      )!;
      expect(newPrice.disabled).toBe(true);
      expect(newPrice.value).toBe(nextPurpose === "sale" ? "900000" : "3850");
      expect(newPrice.value).not.toBe(oldDraft);
      expect(document.body.textContent).toContain("أعد تحديده قبل التجهيز");
      expect(campaignRows()).toHaveLength(0);
    }
  );
  it("shows a rented sale offer as a selectable unified target without changing records", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(40, "مجمع فستفال", ""),
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "sale",
          salePriceMinor: 280000000,
        }),
        tenancyStatus: "rented",
        tenancyStartDate: "2026-01-01",
        tenancyEndDate: "2027-12-31",
      });
    });
    const before = JSON.stringify(api.state);
    const saleTarget = listBrokerTargets(api.state, { includeSale: true }).find(
      row => row.propertyTitle === "مجمع فستفال"
    )!;
    expect(saleTarget).toMatchObject({
      purpose: "sale",
      availability: "sale",
      suggestedSalePriceMinor: 280000000,
    });
    const toggle = document.querySelector<HTMLInputElement>(
      '[aria-label="اختيار مجمع فستفال · ROOT"]'
    )!;
    const row = toggle.closest("tr")!;
    expect(row.textContent).toContain("للبيع");
    expect(row.textContent).toContain("مؤجر");
    expect(row.textContent).not.toContain("شاغر الآن");
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="سعر البيع المطلوب مجمع فستفال · ROOT"]'
      )?.value
    ).toBe("2800000");
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(true);
    expect(
      listBrokerTargets(api.state).some(
        row => row.propertyTitle === "مجمع فستفال"
      )
    ).toBe(false);
    expect(
      document.querySelector('[data-testid="sale-marketing-inventory"]')
    ).toBeNull();
    expect(JSON.stringify(api.state)).toBe(before);
  });

  it("uses the shared search, type, availability, goal, and select-all controls for sale targets", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(41, "مجمع فستفال", ""),
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "sale",
          salePriceMinor: 99000000,
        }),
      });
    });
    await setValue(
      'input[placeholder="عقار، رقم، وحدة، نوع أو موقع"]',
      "فستفال"
    );
    expect(
      document.querySelector('[data-excel-table="broker-targets"]')?.textContent
    ).toContain("مجمع فستفال");
    await setSelect('[aria-label="نوع العقار"]', "فيلا");
    expect(
      document.querySelector('[aria-label="اختيار مجمع فستفال · ROOT"]')
    ).toBeTruthy();
    await setSelect('[aria-label="توافر الإيجار"]', "vacant");
    await setSelect('[aria-label="هدف التسويق"]', "sale");
    expect(
      document.querySelector('[aria-label="اختيار مجمع فستفال · ROOT"]')
    ).toBeTruthy();
    const selectAll = document.querySelector<HTMLInputElement>(
      '[data-testid="select-all-targets"]'
    )!;
    await act(async () => selectAll.click());
    expect(selectAll.checked).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="اختيار مجمع فستفال · ROOT"]'
      )?.checked
    ).toBe(true);
    await setSelect('[aria-label="هدف التسويق"]', "rent");
    expect(
      document.querySelector('[data-testid="target-selection-count"]')
        ?.textContent
    ).toContain("الأهداف المختارة: 1");
  });

  it("keeps sale targets scoped in the unified table without deleting their assets", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(42, "مجمع فستفال", ""),
        propertyProfile: JSON.stringify({ v: 1, purpose: "sale" }),
      });
      api.setSetting("portfolioId", "work");
    });
    expect(document.body.textContent).not.toContain("مجمع فستفال");
    expect(
      api.state.entities.properties.some(row => row.title === "مجمع فستفال")
    ).toBe(true);
  });

  it("blocks a missing sale price, then prepares, simulates, and reopens an editable sale brief without changing the offer asset", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(43, "عرض بلا سعر", ""),
        propertyProfile: JSON.stringify({ v: 1, purpose: "sale" }),
      });
    });
    const propertyBefore = JSON.stringify(
      api.state.entities.properties.find(row => row.title === "عرض بلا سعر")
    );
    await setSelect('[aria-label="هدف التسويق"]', "sale");
    const toggle = document.querySelector<HTMLInputElement>(
      '[aria-label="اختيار عرض بلا سعر · ROOT"]'
    )!;
    await act(async () => toggle.click());
    const price = document.querySelector<HTMLInputElement>(
      '[aria-label="سعر البيع المطلوب عرض بلا سعر · ROOT"]'
    )!;
    expect(price.value).toBe("");
    expect(price.disabled).toBe(false);
    await click("شركات الوساطة");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="اختيار شركة ألف"]')!
        .click()
    );
    await click("التالي: مراجعة الموجز");
    await click("تجهيز لقطات الموجز للمراجعة");
    expect(document.body.textContent).toContain("سعر بيع مطلوبًا موجبًا");
    expect(campaignRows()).toHaveLength(0);

    await click("العقارات");
    await setValue(
      '[aria-label="سعر البيع المطلوب عرض بلا سعر · ROOT"]',
      "950000"
    );
    expect(
      JSON.stringify(
        api.state.entities.properties.find(row => row.title === "عرض بلا سعر")
      )
    ).toBe(propertyBefore);
    await click("شركات الوساطة");
    await click("التالي: مراجعة الموجز");
    expect(document.body.textContent).toContain("سعر البيع المطلوب");
    await click("تجهيز لقطات الموجز للمراجعة");
    expect(campaignRows()).toHaveLength(1);
    const prepared = document.querySelector(
      '[data-testid="prepared-batches"]'
    )!;
    expect(prepared.textContent).toContain("سعر البيع المطلوب");
    expect(prepared.textContent).toContain("مسودة EML");
    expect(prepared.querySelector('a[href^="mailto:"]')).toBeTruthy();

    await click("إرسال الموجز للشركات المختارة · تجريبي");
    await click("تأكيد المحاكاة · لم يُرسل بريد");
    expect(dispatchRows()).toHaveLength(1);
    await click("فتح اللقطة");
    const history = document.querySelector(".broker-saved-preview")!;
    expect(history.textContent).toContain("سعر البيع المطلوب");
    expect(history.textContent).not.toContain("شهريًا");
  });

  it("prepares mixed selections as separate sale and rental batches with their own price labels", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(44, "فيلا للبيع والايجار", ""),
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "sale",
          salePriceMinor: 135000000,
        }),
      });
    });
    await act(async () =>
      document
        .querySelector<HTMLInputElement>(
          '[aria-label="اختيار فيلا الإيجار الافتراضي · WHOLE"]'
        )!
        .click()
    );
    await act(async () =>
      document
        .querySelector<HTMLInputElement>(
          '[aria-label="اختيار فيلا للبيع والايجار · ROOT"]'
        )!
        .click()
    );
    await click("شركات الوساطة");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('[aria-label="اختيار شركة ألف"]')!
        .click()
    );
    await click("التالي: مراجعة الموجز");
    await click("تجهيز لقطات الموجز للمراجعة");
    expect(campaignRows()).toHaveLength(2);
    const prepared = document.querySelector(
      '[data-testid="prepared-batches"]'
    )!;
    expect(prepared.textContent).toContain("سعر البيع المطلوب");
    expect(prepared.textContent).toContain("شهريًا");
  });

  it("hides an all-portfolios campaign and its recipient drafts after narrowing the portfolio", async () => {
    await act(async () => {
      api.setSetting("portfolioId", "all");
    });
    await act(async () => {
      const target = listBrokerTargets(api.state, {
        includeExpiring: true,
        expiringWithinDays: 60,
      })[0];
      const broker = api.state.entities.vendors.find(
        row => row.meta.recordType === "broker-contact"
      )!;
      api.commitTransition(current =>
        saveBrokerCampaignBatches(current, {
          requestId: "global-scope-campaign",
          title: "SCOPE-GLOBAL-PRIVATE",
          content: "اختبار نطاق مستقل",
          targetIds: [target.id],
          brokerIds: [broker.id],
          targetRentsMinor: { [target.id]: 500000 },
          expiringWithinDays: 60,
        })
      );
    });
    await click("الموجز والمراجعة");
    expect(document.body.textContent).toContain("SCOPE-GLOBAL-PRIVATE");
    await click("فتح اللقطة");
    expect(document.querySelector(".broker-saved-preview")).toBeTruthy();
    await act(async () => api.setSetting("portfolioId", "family"));
    expect(document.body.textContent).not.toContain("SCOPE-GLOBAL-PRIVATE");
    expect(document.querySelector(".broker-saved-preview")).toBeNull();
    expect(document.querySelector(".broker-recipient-drafts")).toBeNull();
    expect(
      campaignRows().some(row => row.title === "SCOPE-GLOBAL-PRIVATE")
    ).toBe(true);
  });

  it("selects every filtered target and every eligible broker without the legacy 10/20 truncation", async () => {
    await act(async () => {
      for (let index = 4; index <= 11; index += 1) {
        api.createRentalProperty(
          propertyValues(index, `فيلا تحديد ${index}`, String(3000 + index))
        );
      }
    });
    for (let index = 4; index <= 22; index += 1) await addBroker(index);
    const targetTotal = listBrokerTargets(api.state, {
      includeExpiring: true,
      expiringWithinDays: 60,
    }).length;
    const eligibleBrokerTotal = api.state.entities.vendors.filter(
      row =>
        row.meta.recordType === "broker-contact" &&
        row.meta.active !== false &&
        Boolean(row.meta.email) &&
        Boolean(row.meta.contactName) &&
        !row.propertyId
    ).length;
    expect(targetTotal).toBeGreaterThan(10);
    expect(eligibleBrokerTotal).toBeGreaterThan(20);

    await setValue(
      'input[placeholder="عقار، رقم، وحدة، نوع أو موقع"]',
      "الإيجار الافتراضي"
    );
    const targetAll = document.querySelector<HTMLInputElement>(
      '[data-testid="select-all-targets"]'
    )!;
    expect(targetAll.checked).toBe(false);
    await act(async () => targetAll.click());
    expect(
      document.querySelector('[data-testid="target-selection-count"]')
        ?.textContent
    ).toContain(`1 من ${targetTotal}`);

    await setValue('input[placeholder="عقار، رقم، وحدة، نوع أو موقع"]', "");
    expect(targetAll.indeterminate).toBe(true);
    await act(async () => targetAll.click());
    expect(
      document.querySelector('[data-testid="target-selection-count"]')
        ?.textContent
    ).toContain(`${targetTotal} من ${targetTotal}`);

    await click("شركات الوساطة");
    const brokerAll = document.querySelector<HTMLInputElement>(
      '[data-testid="select-all-brokers"]'
    )!;
    await act(async () => brokerAll.click());
    expect(
      document.querySelector('[data-testid="broker-selection-count"]')
        ?.textContent
    ).toContain(`${eligibleBrokerTotal} من ${eligibleBrokerTotal}`);
    expect(document.body.textContent).toContain("ستفصلها الدفعات في المحرك");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="اختيار شركة 3"]')
        ?.disabled
    ).toBe(true);
  });

  it("shows the stored rent before selection, preserves an explicit edit, and simulates only the selected recipient after confirmation", async () => {
    const propertyTitle = "فيلا الإيجار الافتراضي";
    const targetToggle = document.querySelector<HTMLInputElement>(
      `[aria-label="اختيار ${propertyTitle} · WHOLE"]`
    )!;
    const rent = document.querySelector<HTMLInputElement>(
      `[aria-label="الإيجار الشهري ${propertyTitle} · WHOLE"]`
    )!;
    expect(targetToggle.disabled).toBe(false);
    expect(rent.value).toBe("3850");
    expect(rent.disabled).toBe(true);
    expect(document.body.textContent).toContain("الإيجار الشهري للعقار كاملًا");

    await act(async () => targetToggle.click());
    expect(rent.disabled).toBe(false);
    await setValue(
      `[aria-label="الإيجار الشهري ${propertyTitle} · WHOLE"]`,
      "4200"
    );
    await act(async () => targetToggle.click());
    await act(async () => targetToggle.click());
    expect(rent.value).toBe("4200");

    await click("شركات الوساطة");
    const alpha = document.querySelector<HTMLInputElement>(
      '[aria-label="اختيار شركة ألف"]'
    )!;
    await act(async () => alpha.click());
    await click("التالي: مراجعة الموجز");
    await setValue('[aria-label="عنوان الحملة"]', "معاينة دفعات واجهة محلية");
    await setValue(
      '[aria-label="نص المعاينة"]',
      "هذه معاينة فقط ولا توجد رسالة خارجية."
    );

    const beforeFinance = {
      leases: api.state.entities.leases,
      units: api.state.entities.units,
      collections: api.state.entities.collections,
      receivables: api.state.entities.receivables,
    };
    await act(async () => {
      const prepare = button("تجهيز لقطات الموجز للمراجعة");
      prepare.click();
      prepare.click();
    });

    expect(campaignRows()).toHaveLength(1);
    expect(
      document.querySelector('[data-testid="prepared-batches"]')?.textContent
    ).toContain("شركة ألف");
    expect(
      document.querySelector('[data-testid="prepared-batches"]')?.textContent
    ).not.toContain("شركة باء");
    expect(button("إرسال الموجز للشركات المختارة · تجريبي").disabled).toBe(
      false
    );

    await click("إرسال الموجز للشركات المختارة · تجريبي");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "شركة ألف"
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent
    ).not.toContain("شركة باء");
    await act(async () => {
      const confirm = button("تأكيد المحاكاة · لم يُرسل بريد");
      confirm.click();
      confirm.click();
    });

    expect(dispatchRows()).toHaveLength(1);
    expect(dispatchRows()[0].status).toBe("simulated-not-sent");
    const results = document.querySelector(
      '[data-testid="simulation-results"]'
    )?.textContent;
    expect(results).toContain("شركة ألف");
    expect(results).not.toContain("شركة باء");
    expect(results).toContain("لم يُرسل بريد");
    expect(api.state.entities.leases).toStrictEqual(beforeFinance.leases);
    expect(api.state.entities.units).toStrictEqual(beforeFinance.units);
    expect(api.state.entities.collections).toStrictEqual(
      beforeFinance.collections
    );
    expect(api.state.entities.receivables).toStrictEqual(
      beforeFinance.receivables
    );
  });

  it("keeps selection, editing, preparation, and confirmation unavailable to a read-only role while historical batches remain viewable", async () => {
    await act(async () => {
      api.createRentalProperty({
        ...propertyValues(45, "عرض قراءة فقط", ""),
        propertyProfile: JSON.stringify({
          v: 1,
          purpose: "sale",
          salePriceMinor: 75000000,
        }),
      });
      const target = listBrokerTargets(api.state, {
        includeExpiring: true,
        expiringWithinDays: 60,
      })[0]!;
      const broker = api.state.entities.vendors.find(
        row => row.meta.recordType === "broker-contact"
      )!;
      api.commitTransition(current =>
        saveBrokerCampaignBatches(current, {
          requestId: "readonly-marketing-campaign",
          title: "لقطة القراءة",
          content: "موجز محفوظ للمراجعة فقط.",
          targetIds: [target.id],
          brokerIds: [broker.id],
          targetRentsMinor: { [target.id]: 385000 },
          expiringWithinDays: 60,
        })
      );
      api.setSetting("role", "owner");
    });

    expect(document.body.textContent).toContain("هذه معاينة قراءة فقط");
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-testid="select-all-targets"]'
      )?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="اختيار عرض قراءة فقط · ROOT"]'
      )?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="سعر البيع المطلوب عرض قراءة فقط · ROOT"]'
      )?.disabled
    ).toBe(true);
    await click("شركات الوساطة");
    expect(button("إضافة شركة وساطة").disabled).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        '[data-testid="select-all-brokers"]'
      )?.disabled
    ).toBe(true);
    await click("الموجز والمراجعة");
    expect(button("تجهيز لقطات الموجز للمراجعة").disabled).toBe(true);
    await click("فتح اللقطة");
    expect(document.body.textContent).toContain("لقطة تاريخية للقراءة");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(item =>
        item.textContent?.includes("إرسال الموجز للشركات المختارة")
      )
    ).toBeUndefined();
  });
});
