// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import type { SaleMarketingGroup } from "@/lib/broker-sale-inventory";
import { SaleMarketingInventoryPanel } from "./SaleMarketingInventoryPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

const saleGroup: SaleMarketingGroup = {
  propertyId: "property-sale-1",
  portfolioId: "portfolio-1",
  propertyTitle: "برج اللؤلؤة",
  propertyNumber: "SALE-101",
  propertyType: "برج سكني",
  location: "اللؤلؤة، الدوحة",
  propertyPurpose: "sale",
  rentalMode: "units",
  tenancyLabel: "مؤجر حاليًا",
  salePriceMinor: 9_500_000,
  units: [
    {
      id: "sale-unit-1",
      title: "شقة 11",
      unitCode: "A-11",
      categoryLabel: "شقة بغرفتين",
      areaM2: 128.5,
      salePriceMinor: 1_850_000,
      tenancyLabel: "مؤجرة بعقد قائم",
    },
    {
      id: "sale-unit-2",
      title: "شقة 12",
      unitCode: "A-12",
      categoryLabel: "شقة بثلاث غرف",
      areaM2: 167,
      salePriceMinor: 2_250_000,
      tenancyLabel: "شاغرة",
    },
  ],
};

async function render(groups: SaleMarketingGroup[]) {
  await act(async () => {
    root.render(
      <Router hook={() => ["/marketing", () => undefined]}>
        <SaleMarketingInventoryPanel groups={groups} />
      </Router>
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("SaleMarketingInventoryPanel", () => {
  it("يظهر أسعار الوحدات فقط للأصل الإيجاري أو المختلط المقسم ولو استقبل سعرًا تاريخيًا للأصل", async () => {
    await render([
      { ...saleGroup, propertyPurpose: "mixed", salePriceMinor: 900_000_000 },
    ]);
    expect(
      document.querySelector(
        '[data-testid="sale-property-price-property-sale-1"]'
      )?.textContent
    ).toBe("أسعار الوحدات أدناه");
    expect(document.body.textContent).toContain("وحدات للبيع ضمن العقار");
    expect(document.body.textContent).not.toContain("9,000,000 ر.ق");
    expect(
      document.querySelector('[data-testid="sale-unit-price-sale-unit-1"]')
        ?.textContent
    ).toBe("18,500 ر.ق");
    await render([{ ...saleGroup, salePriceMinor: 0, units: [] }]);
    expect(
      document.querySelector(
        '[data-testid="sale-property-price-property-sale-1"]'
      )?.textContent
    ).toBe("غير مسجل");
  });

  it("يعرض سعر طلب العقار من مصدر العقار لا من أسعار وحداته", async () => {
    await render([saleGroup]);

    expect(
      document.querySelector(
        '[data-testid="sale-property-price-property-sale-1"]'
      )?.textContent
    ).toBe("95,000 ر.ق");
    expect(
      document.querySelector('[data-testid="sale-unit-price-sale-unit-1"]')
        ?.textContent
    ).toBe("18,500 ر.ق");
  });

  it("يعرض غير مسجل عند غياب سعر البيع ولا يحوله إلى صفر", async () => {
    const withoutPrice = {
      ...saleGroup,
      propertyId: "property-without-price",
      salePriceMinor: undefined,
      units: [],
    };
    await render([withoutPrice]);

    expect(
      document.querySelector(
        '[data-testid="sale-property-price-property-without-price"]'
      )?.textContent
    ).toBe("غير مسجل");
    expect(document.body.textContent).not.toContain("0 ر.ق");
  });

  it("يحافظ على وصف الإشغال المؤجر ولا يستبدله بحالة شاغر", async () => {
    await render([saleGroup]);

    expect(document.body.textContent).toContain("مؤجر حاليًا");
    expect(document.body.textContent).not.toContain("شاغر الآن");
  });

  it("يفتح جدول الوحدات بأسعارها المستقلة وروابط العقار", async () => {
    await render([saleGroup]);
    const details = document.querySelector("details")!;

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(
      document.querySelector('[data-testid="sale-unit-price-sale-unit-1"]')
        ?.textContent
    ).toBe("18,500 ر.ق");
    expect(
      document.querySelector('[data-testid="sale-unit-price-sale-unit-2"]')
        ?.textContent
    ).toBe("22,500 ر.ق");
    expect(
      document.querySelectorAll('a[href="/properties/property-sale-1"]')
    ).toHaveLength(3);
  });

  it("يبقى للقراءة فقط ولا يغير مجموعات البيع الواردة", async () => {
    const groups = structuredClone([saleGroup]);
    const original = structuredClone(groups);
    await render(groups);

    expect(
      document.querySelectorAll("input, select, textarea, button")
    ).toHaveLength(0);
    expect(
      [...document.querySelectorAll("a")].some(link =>
        /mailto:|campaign|send/i.test(link.getAttribute("href") ?? "")
      )
    ).toBe(false);
    expect(groups).toStrictEqual(original);
  });
});
