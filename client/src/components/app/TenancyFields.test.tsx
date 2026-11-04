// @vitest-environment jsdom
import React, { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
} from "@shared/prototype";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { TenancyFields } from "./TenancyFields";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "property-a",
    status: "نشط",
    date: "2026-01-01",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

const property = entity({
  id: "property-a",
  title: "العقار أ",
  meta: { rentalMode: "whole" },
});
const unit = entity({
  id: "whole-a",
  title: "هدف العقار كاملاً",
  meta: { wholeProperty: true },
});

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

function ControlledHarness() {
  const [values, setValues] = useState<Record<string, string>>({
    tenancyStatus: "",
    tenancyStartDate: "",
    tenancyEndDate: "",
  });
  api = usePrototype();
  return (
    <TenancyFields
      values={values}
      property={property}
      unit={unit}
      onChange={(key, nextValue) =>
        setValues(current => ({ ...current, [key]: nextValue }))
      }
    />
  );
}

function LockedHarness() {
  api = usePrototype();
  return (
    <TenancyFields
      values={{
        tenancyStatus: "vacant",
        tenancyStartDate: "",
        tenancyEndDate: "",
      }}
      property={property}
      unit={unit}
      onChange={() => {
        throw new Error("locked tenancy fields must not write form values");
      }}
    />
  );
}

async function mount(children: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<PrototypeProvider>{children}</PrototypeProvider>);
  });
}

function setSelect(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )!.set!.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  localStorage.clear();
});

describe("TenancyFields", () => {
  it("renders native select state, requires both dates only for rented, and explains its declaration-only boundary", async () => {
    await mount(<ControlledHarness />);
    const select = host.querySelector<HTMLSelectElement>("select")!;
    const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
    const initialLeaseCount = api.state.entities.leases.length;
    const initialReceivableCount = api.state.entities.receivables.length;
    expect(select.value).toBe("");
    expect(
      [...select.options].map(option => [option.value, option.textContent])
    ).toEqual([
      ["", "غير محدد"],
      ["rented", "مؤجر"],
      ["vacant", "غير مؤجر"],
    ]);
    expect(dates[0].required).toBe(false);
    expect(dates[1].required).toBe(false);
    expect(dates[0].disabled).toBe(true);
    expect(dates[1].disabled).toBe(true);
    expect(host.textContent).toContain("إدخال أولي، غير مرتبط بعقد مسجل");
    expect(host.textContent).toContain(
      "لا ينشئ هذا الإدخال عقدًا أو ذممًا أو تحصيلًا"
    );

    await act(async () => setSelect(select, "rented"));
    expect(select.value).toBe("rented");
    expect(dates[0].required).toBe(true);
    expect(dates[1].required).toBe(true);
    expect(dates[0].disabled).toBe(false);
    expect(dates[1].disabled).toBe(false);
    const rent = host.querySelector<HTMLInputElement>(
      'input[name="tenancyMonthlyRent"]'
    )!;
    expect(rent).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(rent, "٣٥٠٠٫٧٥");
      rent.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rent.value).toBe("٣٥٠٠٫٧٥");

    await act(async () => setSelect(select, "vacant"));
    expect(select.value).toBe("vacant");
    expect(host.querySelector('input[name="tenancyMonthlyRent"]')).toBeNull();
    await act(async () => setSelect(select, "rented"));
    expect(
      host.querySelector<HTMLInputElement>('input[name="tenancyMonthlyRent"]')!
        .value
    ).toBe("");
    await act(async () => setSelect(select, "vacant"));
    expect(dates[0].required).toBe(false);
    expect(dates[1].required).toBe(false);
    expect(dates[0].disabled).toBe(true);
    expect(dates[1].disabled).toBe(true);
    expect(api.state.entities.leases).toHaveLength(initialLeaseCount);
    expect(api.state.entities.receivables).toHaveLength(initialReceivableCount);
  });

  it("shows a registered lease as read-only and supplies a safely encoded lease link without calling onChange", async () => {
    await mount(<LockedHarness />);
    const rows = Object.fromEntries(
      ENTITY_KINDS.map(kind => [kind, []])
    ) as unknown as EntityMap;
    rows.properties = [property];
    rows.units = [unit];
    rows.leases = [
      entity({
        id: "lease/a?1",
        propertyId: property.id,
        status: "نافذ",
        meta: {
          lifecycleActivated: true,
          unitId: unit.id,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          rentMinor: 350075,
        },
      }),
    ];
    await act(async () => api.replaceState({ ...api.state, entities: rows }));

    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(host.textContent).toContain("مصدر الحالة: عقد مسجل");
    expect(host.textContent).toContain("2026-01-01");
    expect(host.textContent).toContain("2026-12-31");
    expect(host.textContent).toContain("الإيجار الشهري المسجل");
    expect(host.textContent).toContain("من العقد؛ تعديله من قسم العقود فقط");
    expect(host.querySelector('input[name="tenancyMonthlyRent"]')).toBeNull();
    const link = host.querySelector<HTMLAnchorElement>('a[href^="/leases"]')!;
    expect(link.textContent).toContain("فتح العقد المسجل");
    expect(link.getAttribute("href")).toBe("/leases?lease=lease%2Fa%3F1");
  });
});
