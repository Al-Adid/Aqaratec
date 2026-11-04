// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrototypeState } from "@shared/prototype";
import { createDemoState } from "@/lib/demo-data";
import { parseUnitProfile, updateDescribedUnit } from "@/lib/unit-profile";
import { createRentalProperty } from "@/lib/prototype-rental";
import {
  saveTargetPhotoGallery,
  parsePhotoGallery,
} from "@/lib/property-photo-gallery";
import type { LocalPhotoAvailability } from "@/components/app/PhotoGallery";

const fixture = vi.hoisted(() => ({
  state: null as PrototypeState | null,
  scope: "unit-wizard-scope-a",
  canEdit: true,
  commits: 0,
  refresh: null as (() => void) | null,
  localAvailableCount: 0,
  assetCommitGate: null as Promise<void> | null,
  assetCommitFailure: null as Error | null,
  afterCommit: null as (() => void) | null,
  lastMatchResult: undefined as boolean | undefined,
}));

const matchingFiles = vi.hoisted(() => ({ available: [] as string[] }));
vi.mock("@/lib/photo-match-readability", () => ({
  readMatchingPhotoIds: async (_scope: string, ids: readonly string[]) => {
    const available = ids.filter(id => matchingFiles.available.includes(id));
    return { ids: available, missingCount: ids.length - available.length };
  },
}));

vi.mock("@/contexts/PrototypeContext", () => ({
  usePrototype: () => ({
    state: fixture.state,
    identity: { storageKey: fixture.scope },
    canEdit: fixture.canEdit,
    commitAssetTransition: async <T,>(
      transition: (current: PrototypeState) => {
        state: PrototypeState;
        result: T;
      }
    ): Promise<T> => {
      fixture.commits += 1;
      if (fixture.assetCommitGate) await fixture.assetCommitGate;
      if (fixture.assetCommitFailure) throw fixture.assetCommitFailure;
      const outcome = transition(fixture.state!);
      fixture.state = outcome.state;
      fixture.refresh?.();
      if (fixture.afterCommit) {
        fixture.afterCommit();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return outcome.result;
    },
  }),
}));

vi.mock("@/pages/operating/UnitBulkFillPanel", async importOriginal => {
  const actual = await importOriginal<typeof import("./UnitBulkFillPanel")>();
  return {
    ...actual,
    UnitBulkFillPanel: (
      props: import("./UnitBulkFillPanel").UnitBulkFillPanelProps
    ) => (
      <actual.UnitBulkFillPanel
        {...props}
        onApply={async request => {
          const result = await props.onApply(request);
          fixture.lastMatchResult = result;
          return result;
        }}
      />
    ),
  };
});

vi.mock("@/components/app/PhotoGallery", () => ({
  AssetPhotoGallery: ({
    id,
    onLocalAvailabilityChange,
    onCommittedChange,
  }: {
    id: string;
    onLocalAvailabilityChange?: (availability: LocalPhotoAvailability) => void;
    onCommittedChange?: (payload: {
      kind: string;
      id: string;
      scopeKey: string;
      before: any;
      after: any;
    }) => void;
  }) => {
    const raw = fixture.state?.entities.units.find(unit => unit.id === id)?.meta
      .photoGallery;
    const galleryKey =
      typeof raw === "string"
        ? (JSON.parse(raw).ids as string[]).join("|")
        : "";
    React.useEffect(() => {
      onLocalAvailabilityChange?.({
        kind: "units",
        id,
        scopeKey: fixture.scope,
        galleryKey,
        availableCount: galleryKey ? fixture.localAvailableCount : 0,
      });
    }, [
      id,
      galleryKey,
      fixture.scope,
      fixture.localAvailableCount,
      onLocalAvailabilityChange,
    ]);
    return (
      <section aria-label="معرض الصور">
        <h2>معرض الصور</h2>
        <button
          type="button"
          onClick={() => {
            const before = fixture.state!.entities.units.find(
              unit => unit.id === id
            )!;
            fixture.state = {
              ...fixture.state!,
              entities: {
                ...fixture.state!.entities,
                units: fixture.state!.entities.units.map(unit =>
                  unit.id === id
                    ? {
                        ...unit,
                        meta: {
                          ...unit.meta,
                          photoGallery: JSON.stringify({
                            v: 1,
                            ids: ["local-photo"],
                          }),
                        },
                      }
                    : unit
                ),
              },
            };
            const after = fixture.state!.entities.units.find(
              unit => unit.id === id
            )!;
            onCommittedChange?.({
              kind: "units",
              id,
              scopeKey: fixture.scope,
              before,
              after,
            });
            fixture.refresh?.();
          }}
        >
          محاكاة تحديث الصورة المحلية
        </button>
      </section>
    );
  },
}));

import { UnitSetupWizard } from "./UnitSetupWizard";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let reopen: (() => void) | null = null;

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextArea(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputFor(label: string): HTMLInputElement {
  const field = [...host.querySelectorAll<HTMLLabelElement>("label")].find(
    item => item.querySelector("span")?.textContent?.includes(label)
  );
  expect(field).toBeTruthy();
  const input = field!.querySelector<HTMLInputElement>("input");
  expect(input).toBeTruthy();
  return input!;
}

function textAreaFor(label: string): HTMLTextAreaElement {
  const field = [...host.querySelectorAll<HTMLLabelElement>("label")].find(
    item => item.querySelector("span")?.textContent?.includes(label)
  );
  expect(field).toBeTruthy();
  const textarea = field!.querySelector<HTMLTextAreaElement>("textarea");
  expect(textarea).toBeTruthy();
  return textarea!;
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )!.set!.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectFor(label: string): HTMLSelectElement {
  const field = [...host.querySelectorAll<HTMLLabelElement>("label")].find(
    item => item.querySelector("span")?.textContent?.includes(label)
  );
  expect(field).toBeTruthy();
  const select = field!.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  return select!;
}

function click(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent?.includes(label)
  );
  expect(button).toBeTruthy();
  return button!;
}

function financialRecords() {
  const entities = fixture.state!.entities;
  return {
    leases: structuredClone(entities.leases),
    receivables: structuredClone(entities.receivables),
    collections: structuredClone(entities.collections),
  };
}

function createSplitFixture() {
  const created = createRentalProperty(createDemoState(), {
    title: "عمارة مرحلة الوحدات",
    portfolioId: "family",
    assetType: "building",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "2",
    propertyNumber: "00041",
    electricityNumber: "00029",
  });
  const first = created.state.entities.units.find(
    unit => unit.propertyId === created.property.id
  )!;
  const described = updateDescribedUnit(created.state, first.id, {
    category: "villa",
    villaArrangement: "detached",
    furnishing: "furnished",
    monthlyRent: "2500",
  });
  fixture.state = described.state;
  return {
    propertyId: created.property.id,
    firstUnitId: first.id,
    firstRent: described.result.meta.monthlyRentMinor,
  };
}

function createLargeVillaComplexFixture() {
  const created = createRentalProperty(createDemoState(), {
    title: "مجمع فلل مرحلة الوحدات الكبير",
    portfolioId: "family",
    assetType: "villa_complex",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "36",
    propertyNumber: "VC-00036",
    electricityNumber: "VC-METER-36",
  });
  fixture.state = created.state;
  return {
    propertyId: created.property.id,
    units: fixture.state.entities.units.filter(
      unit => unit.propertyId === created.property.id
    ),
  };
}

function WizardHost({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(true);
  const [, setVersion] = useState(0);
  fixture.refresh = () => setVersion(version => version + 1);
  reopen = () => setOpen(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        فتح مرحلة الوحدات
      </button>
      {open && (
        <UnitSetupWizard
          propertyId={propertyId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

beforeEach(() => {
  fixture.afterCommit = null;
  fixture.lastMatchResult = undefined;
  matchingFiles.available = [];
  fixture.scope = `unit-wizard-${crypto.randomUUID()}`;
  fixture.canEdit = true;
  fixture.commits = 0;
  fixture.refresh = null;
  fixture.localAvailableCount = 0;
  fixture.assetCommitGate = null;
  fixture.assetCommitFailure = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  fixture.state = null;
  fixture.refresh = null;
  reopen = null;
  fixture.assetCommitGate = null;
  fixture.assetCommitFailure = null;
});

describe("UnitSetupWizard", () => {
  it("groups all unit inputs and saves independent area, meter, furnishing, tenancy, and description through reopening", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    expect(host.querySelector("#unit-basic-fields")).toBeTruthy();
    expect(host.querySelector("#unit-description-fields")).toBeTruthy();
    expect(host.querySelector("#unit-tenancy-fields")).toBeTruthy();
    expect(host.querySelector("#unit-pricing-fields")).toBeTruthy();
    expect(host.querySelector("#unit-references-fields")).toBeTruthy();
    expect(
      host.querySelector('[aria-label="انتقال سريع بين بيانات الوحدة"]')
        ?.textContent
    ).toContain("الأساسية");
    expect(inputFor("رقم الكهرباء").name).toBe("electricityNumber");
    expect(inputFor("مساحة الوحدة").name).toBe("unitArea");
    expect(textAreaFor("وصف الوحدة").name).toBe("description");
    expect(selectFor("نوع الوحدة").name).toBe("category");
    expect(selectFor("توزيع الشقة").name).toBe("roomLayout");
    expect(selectFor("التأثيث").name).toBe("furnishing");
    expect(selectFor("حالة التأجير")).toBeTruthy();
    expect(inputFor("تاريخ بداية العقد")).toBeTruthy();
    expect(inputFor("تاريخ نهاية العقد")).toBeTruthy();
    expect(selectFor("هدف الوحدة").name).toBe("unitPurpose");
    expect(
      host.querySelector<HTMLInputElement>('[name="monthlyRent"]')
    ).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[name="salePrice"]')
    ).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[name="propertyNumber"]')
    ).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[name="planNumber"]')
    ).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[name="waterNumber"]')
    ).toBeTruthy();
    expect(host.textContent).toContain("محتويات الوحدة / توزيعها");
    expect(host.textContent).toContain("معرض الصور");

    await act(async () => {
      setInput(inputFor("رقم الكهرباء"), "METER-UNIT-7");
      setInput(inputFor("مساحة الوحدة"), "١٢٠٫٥٠");
      setTextArea(textAreaFor("وصف الوحدة"), "وصف وحدة مستقل محفوظ");
      setSelect(selectFor("التأثيث"), "furnished");
      setSelect(selectFor("حالة التأجير"), "rented");
    });
    await act(async () => {
      setInput(inputFor("تاريخ بداية العقد"), "2026-01-01");
      setInput(inputFor("تاريخ نهاية العقد"), "2026-12-31");
      setInput(inputFor("الإيجار الشهري الحالي"), "٣٥٠٠");
    });
    await act(async () => click("حفظ ومتابعة").click());

    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(saved.meta.electricityNumber).toBe("METER-UNIT-7");
    expect(saved.meta.electricityNumberSource).toBe("unit");
    expect(saved.meta.description).toBe("وصف وحدة مستقل محفوظ");
    expect(saved.meta.tenancyDeclaration).toBe(
      JSON.stringify({
        v: 1,
        status: "rented",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyRentMinor: 350000,
      })
    );
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      areaM2: 120.5,
      furnishing: "furnished",
    });
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () => click("إكمال لاحقًا").click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => reopen?.());
    expect(inputFor("رقم الكهرباء").value).toBe("METER-UNIT-7");
    expect(inputFor("مساحة الوحدة").value).toBe("120.5");
    expect(textAreaFor("وصف الوحدة").value).toBe("وصف وحدة مستقل محفوظ");
    expect(selectFor("التأثيث").value).toBe("furnished");
    expect(selectFor("حالة التأجير").value).toBe("rented");
    expect(inputFor("تاريخ بداية العقد").value).toBe("2026-01-01");
    expect(inputFor("تاريخ نهاية العقد").value).toBe("2026-12-31");
    expect(inputFor("الإيجار الشهري الحالي").value).toBe("3500");
  });

  it("keeps all 36 villa complex unit forms reachable while collapsed missing evidence stays in the wizard body", async () => {
    const { propertyId, units } = createLargeVillaComplexFixture();
    expect(units).toHaveLength(36);
    const unitIdentityBefore = units.map(unit => ({
      id: unit.id,
      serial: unit.meta.unitCode,
      propertyId: unit.propertyId,
    }));
    const financialBefore = financialRecords();

    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(
      dialog.querySelector(".unit-setup-wizard__progress h3")?.textContent
    ).toContain("الوحدة 1 من 36");

    const body = dialog.querySelector<HTMLElement>(".unit-setup-wizard__body");
    const form = body?.querySelector<HTMLFormElement>("form");
    const evidence = body?.querySelector<HTMLDetailsElement>(
      "details.unit-setup-wizard__evidence"
    );
    const unitPicker = body?.querySelector<HTMLSelectElement>(
      '[aria-label="انتقل إلى الوحدة"]'
    );
    const actions = dialog.querySelector<HTMLElement>(
      ".unit-setup-wizard__actions"
    );
    expect(body).toBeTruthy();
    expect(body?.querySelectorAll(".unit-setup-wizard__progress")).toHaveLength(
      1
    );
    expect(form).toBeTruthy();
    expect(evidence).toBeTruthy();
    expect(unitPicker).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(body?.contains(form!)).toBe(true);
    expect(body?.contains(evidence!)).toBe(true);
    expect(body?.contains(actions!)).toBe(false);
    expect(evidence?.open).toBe(false);
    expect(evidence?.hasAttribute("open")).toBe(false);
    expect(evidence?.textContent).toContain("معلومات لا تزال ناقصة");
    expect(evidence?.textContent).toContain("صورة واحدة على الأقل");
    expect(evidence?.querySelectorAll("li")).toHaveLength(36);

    expect(inputFor("مساحة الوحدة").name).toBe("unitArea");
    expect(inputFor("رقم الكهرباء").name).toBe("electricityNumber");
    expect(textAreaFor("وصف الوحدة").name).toBe("description");
    expect(selectFor("التأثيث").name).toBe("furnishing");
    expect(selectFor("هدف الوحدة").name).toBe("unitPurpose");
    expect(
      host.querySelector<HTMLInputElement>('[name="monthlyRent"]')
    ).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[name="salePrice"]')
    ).toBeTruthy();

    const firstSave = click("حفظ ومتابعة");
    expect(firstSave.form).toBe(form);
    expect(firstSave.getAttribute("form")).toBe(form?.id);
    expect(form?.contains(firstSave)).toBe(false);
    expect(actions?.contains(firstSave)).toBe(true);
    await act(async () => {
      setInput(inputFor("مساحة الوحدة"), "210.75");
      setInput(inputFor("رقم الكهرباء"), "VILLA-METER-01");
      setTextArea(textAreaFor("وصف الوحدة"), "وصف محفوظ للوحدة الأولى");
      setSelect(selectFor("التأثيث"), "furnished");
      firstSave.click();
    });

    expect(
      dialog.querySelector(".unit-setup-wizard__progress h3")?.textContent
    ).toContain("الوحدة 2 من 36");
    const firstSaved = fixture.state!.entities.units.find(
      unit => unit.id === units[0]!.id
    )!;
    expect(firstSaved.meta.electricityNumber).toBe("VILLA-METER-01");
    expect(firstSaved.meta.description).toBe("وصف محفوظ للوحدة الأولى");
    expect(parseUnitProfile(firstSaved.meta.unitProfile)).toMatchObject({
      areaM2: 210.75,
      furnishing: "furnished",
    });

    await act(async () => setSelect(unitPicker!, units[35]!.id));

    expect(
      dialog.querySelector(".unit-setup-wizard__progress h3")?.textContent
    ).toContain("الوحدة 36 من 36");
    const lastForm = dialog.querySelector<HTMLFormElement>("form");
    const lastSave = click("حفظ وإنهاء");
    expect(lastSave.form).toBe(lastForm);
    await act(async () => lastSave.click());

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
      fixture
        .state!.entities.units.filter(unit => unit.propertyId === propertyId)
        .map(unit => ({
          id: unit.id,
          serial: unit.meta.unitCode,
          propertyId: unit.propertyId,
        }))
    ).toEqual(unitIdentityBefore);
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () => reopen?.());
    expect(host.textContent).toContain("الوحدة 1 من 36");
    expect(inputFor("مساحة الوحدة").value).toBe("210.75");
    expect(inputFor("رقم الكهرباء").value).toBe("VILLA-METER-01");
    expect(textAreaFor("وصف الوحدة").value).toBe("وصف محفوظ للوحدة الأولى");
    expect(selectFor("التأثيث").value).toBe("furnished");
    expect(
      fixture
        .state!.entities.units.filter(unit => unit.propertyId === propertyId)
        .map(unit => ({
          id: unit.id,
          serial: unit.meta.unitCode,
          propertyId: unit.propertyId,
        }))
    ).toEqual(unitIdentityBefore);
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("keeps a physical unit's layout, furnishing, meter, and area fields visible when a historical parent says whole", async () => {
    const { propertyId } = createSplitFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        properties: fixture.state!.entities.properties.map(property =>
          property.id === propertyId
            ? {
                ...property,
                meta: { ...property.meta, rentalMode: "whole" },
              }
            : property
        ),
      },
    };

    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    expect(selectFor("التأثيث").value).toBe("furnished");
    expect(inputFor("رقم الكهرباء")).toBeTruthy();
    expect(inputFor("مساحة الوحدة")).toBeTruthy();
    expect(textAreaFor("وصف الوحدة")).toBeTruthy();
  });

  it("suggests the parent description only for a fresh untyped draft and reopens discarded work from saved data", async () => {
    const { propertyId } = createSplitFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        properties: fixture.state!.entities.properties.map(property =>
          property.id === propertyId
            ? {
                ...property,
                meta: {
                  ...property.meta,
                  propertyProfile: JSON.stringify({
                    v: 1,
                    unitComposition: "apartments",
                  }),
                },
              }
            : property
        ),
      },
    };
    const unitsBefore = structuredClone(fixture.state.entities.units);
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    expect(selectFor("نوع الوحدة").value).toBe("villa");
    expect(selectFor("ترتيب الفيلا").value).toBe("detached");
    await act(async () => click("تخطي الوحدة").click());
    expect(selectFor("نوع الوحدة").value).toBe("apartment");
    expect(selectFor("توزيع الشقة").value).toBe("");
    expect(fixture.state!.entities.units).toEqual(unitsBefore);
    expect(fixture.commits).toBe(0);
    await act(async () => setSelect(selectFor("نوع الوحدة"), "office"));
    await act(async () => click("إكمال لاحقًا").click());
    expect(host.textContent).toContain("لديك تعديلات غير محفوظة");
    await act(async () => click("تجاهل التعديلات").click());
    await act(async () => reopen?.());
    await act(async () => click("تخطي الوحدة").click());
    expect(selectFor("نوع الوحدة").value).toBe("apartment");
    expect(fixture.state!.entities.units).toEqual(unitsBefore);
    expect(fixture.commits).toBe(0);
  });

  it("walks existing serialized units, preserves profile/rent, and never creates or renumbers a unit", async () => {
    const { propertyId, firstUnitId, firstRent } = createSplitFixture();
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("إكمال بيانات الوحدات");
    expect(dialog.textContent).toContain("المرحلة 2 من 2");
    expect(dialog.textContent).toContain("الوحدة 1 من 2");
    expect(dialog.textContent).toContain("U-01");
    expect(dialog.textContent).toContain("معلومات لا تزال ناقصة");
    expect(dialog.textContent).toContain("رقم المخطط");
    expect(dialog.textContent).toContain("صورة واحدة على الأقل");

    await act(async () =>
      setInput(inputFor("رقم العقار الخاص بالوحدة"), "U-00041")
    );
    await act(async () => setInput(inputFor("رقم المخطط"), "P-0001"));
    await act(async () => setInput(inputFor("رقم الكهرباء"), "E-0001"));
    await act(async () =>
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    expect(host.textContent).toContain("الوحدة 2 من 2");
    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "detached",
      furnishing: "furnished",
      propertyNumber: "U-00041",
      planNumber: "P-0001",
    });
    expect(saved.meta.monthlyRentMinor).toBe(firstRent);
    const propertyUnits = fixture.state!.entities.units.filter(
      unit => unit.propertyId === propertyId
    );
    expect(propertyUnits).toHaveLength(2);
    expect(propertyUnits.map(unit => unit.meta.unitCode)).toEqual([
      "U-01",
      "U-02",
    ]);
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () => click("السابق").click());
    expect(inputFor("رقم المخطط").value).toBe("P-0001");
    await act(async () => click("تخطي الوحدة").click());
    await act(async () => click("إكمال لاحقًا").click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
      fixture.state!.entities.units.filter(
        unit => unit.propertyId === propertyId
      )
    ).toHaveLength(2);

    await act(async () => reopen?.());
    expect(host.textContent).toContain("الوحدة 1 من 2");
    expect(host.textContent).toContain("U-01");
    expect(
      fixture.state!.entities.units.filter(
        unit => unit.propertyId === propertyId
      )
    ).toHaveLength(2);
  });

  it("round-trips two unit types and editable display codes without changing financial records", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    expect(selectFor("نوع الوحدة").value).toBe("villa");
    expect(
      host.querySelector('[aria-label="ملخص البيانات الناقصة"]')?.textContent
    ).toContain("نوع الوحدة");
    await act(async () => setInput(inputFor("رمز الوحدة"), "V-01"));
    await act(async () => click("حفظ ومتابعة").click());

    expect(host.textContent).toContain("الوحدة 2 من 2");
    await act(async () => setSelect(selectFor("نوع الوحدة"), "office"));
    await act(async () => setInput(inputFor("رمز الوحدة"), "O-01"));
    await act(async () => click("حفظ وإنهاء").click());

    const units = fixture.state!.entities.units.filter(
      unit => unit.propertyId === propertyId
    );
    const first = units.find(unit => unit.id === firstUnitId)!;
    const second = units.find(unit => unit.id !== firstUnitId)!;
    expect(first.meta.unitCode).toBe("V-01");
    expect(first.meta.code).toBe("V-01");
    expect(parseUnitProfile(first.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "detached",
    });
    expect(second.meta.unitCode).toBe("O-01");
    expect(second.meta.code).toBe("O-01");
    expect(parseUnitProfile(second.meta.unitProfile)).toMatchObject({
      category: "office",
    });
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () => reopen?.());
    expect(host.textContent).toContain("V-01");
    expect(inputFor("رمز الوحدة").value).toBe("V-01");
    await act(async () => click("تخطي الوحدة").click());
    expect(selectFor("نوع الوحدة").value).toBe("office");
    expect(inputFor("رمز الوحدة").value).toBe("O-01");
  });

  it("requires an explicit villa arrangement and applies apartment preset counts only after layout selection", async () => {
    const created = createRentalProperty(createDemoState(), {
      title: "عمارة أنواع صريحة",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
      propertyNumber: "00044",
      electricityNumber: "00049",
    });
    fixture.state = created.state;
    const units = fixture.state.entities.units.filter(
      unit => unit.propertyId === created.property.id
    );
    const financialBefore = financialRecords();
    await act(async () =>
      root.render(<WizardHost propertyId={created.property.id} />)
    );

    await act(async () => setSelect(selectFor("نوع الوحدة"), "villa"));
    const arrangement = selectFor("ترتيب الفيلا");
    expect(arrangement.required).toBe(true);
    expect(arrangement.value).toBe("");
    await act(async () => setSelect(arrangement, "detached"));
    await act(async () => click("حفظ ومتابعة").click());

    await act(async () => setSelect(selectFor("نوع الوحدة"), "apartment"));
    const layout = selectFor("توزيع الشقة");
    expect(layout.required).toBe(true);
    expect(layout.value).toBe("");
    await act(async () => setSelect(layout, "1-living"));
    await act(async () => click("حفظ وإنهاء").click());

    const first = fixture.state!.entities.units.find(
      unit => unit.id === units[0]!.id
    )!;
    const second = fixture.state!.entities.units.find(
      unit => unit.id === units[1]!.id
    )!;
    expect(parseUnitProfile(first.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "detached",
    });
    expect(parseUnitProfile(second.meta.unitProfile)).toMatchObject({
      category: "apartment",
      apartmentLayout: "1-living",
      bedrooms: 1,
      livingRooms: 1,
    });
    expect(financialRecords()).toEqual(financialBefore);

    await act(async () => reopen?.());
    await act(async () => click("تخطي الوحدة").click());
    await act(async () => setSelect(selectFor("توزيع الشقة"), "custom"));
    expect(inputFor("عدد الغرف").value).toBe("1");
    expect(inputFor("عدد الصالات").value).toBe("1");
  });

  it("shows the universal layout for an unclassified unit and round-trips its counts, furnishing, and custom choice", async () => {
    const created = createRentalProperty(createDemoState(), {
      title: "عمارة تكوين عام",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "units",
      unitCount: "2",
    });
    fixture.state = created.state;
    const [first, second] = fixture.state.entities.units.filter(
      unit => unit.propertyId === created.property.id
    );
    const financialBefore = financialRecords();
    await act(async () =>
      root.render(<WizardHost propertyId={created.property.id} />)
    );

    expect(selectFor("نوع الوحدة").value).toBe("");
    const layout = selectFor("توزيع الشقة");
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
    expect(inputFor("عدد الغرف").required).toBe(false);
    expect(inputFor("عدد الصالات").required).toBe(false);

    await act(async () => setSelect(layout, "2-living"));
    expect(selectFor("نوع الوحدة").value).toBe("");
    expect(inputFor("عدد الغرف")).toMatchObject({
      value: "2",
      disabled: true,
    });
    expect(inputFor("عدد الصالات")).toMatchObject({
      value: "1",
      disabled: true,
    });
    await act(async () => {
      setInput(inputFor("عدد الحمامات"), "2");
      setInput(inputFor("عدد المطابخ"), "1");
      setSelect(selectFor("التأثيث"), "furnished");
    });
    await act(async () => click("حفظ ومتابعة").click());

    await act(async () => click("السابق").click());
    await act(async () => setSelect(selectFor("توزيع الشقة"), "custom"));
    expect(inputFor("عدد الغرف").value).toBe("2");
    expect(inputFor("عدد الصالات").value).toBe("1");
    await act(async () => {
      setInput(inputFor("عدد الغرف"), "4");
      setInput(inputFor("عدد الصالات"), "2");
    });
    await act(async () => click("حفظ ومتابعة").click());
    await act(async () => click("إكمال لاحقًا").click());
    await act(async () => reopen?.());

    expect(selectFor("توزيع الشقة").value).toBe("custom");
    expect(inputFor("عدد الغرف").value).toBe("4");
    expect(inputFor("عدد الصالات").value).toBe("2");
    expect(inputFor("عدد الحمامات").value).toBe("2");
    expect(inputFor("عدد المطابخ").value).toBe("1");
    expect(selectFor("التأثيث").value).toBe("furnished");
    const savedFirst = fixture.state!.entities.units.find(
      unit => unit.id === first!.id
    )!;
    expect(parseUnitProfile(savedFirst.meta.unitProfile)).toMatchObject({
      roomLayout: "custom",
      bedrooms: 4,
      livingRooms: 2,
      bathrooms: 2,
      kitchens: 1,
      furnishing: "furnished",
    });
    expect(
      fixture.state!.entities.units.find(unit => unit.id === second!.id)?.meta
        .unitProfile
    ).toBeUndefined();
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("keeps a native rejected blank code draft without committing a change", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const before = structuredClone(fixture.state!.entities.units);
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    const code = inputFor("رمز الوحدة");
    await act(async () => setInput(code, ""));
    expect(code.validity.valueMissing).toBe(true);
    await act(async () =>
      host
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );

    expect(fixture.commits).toBe(0);
    expect(inputFor("رمز الوحدة").value).toBe("");
    expect(
      fixture.state!.entities.units.find(unit => unit.id === firstUnitId)!.meta
        .unitCode
    ).toBe("U-01");
    expect(fixture.state!.entities.units).toEqual(before);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("rejects a malformed historical profile category edit without changing state", () => {
    const { firstUnitId } = createSplitFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        units: fixture.state!.entities.units.map(unit =>
          unit.id === firstUnitId
            ? {
                ...unit,
                meta: {
                  ...unit.meta,
                  code: "LEG-001",
                  unitCode: "LEG-001",
                  unitProfile: "{profile-is-malformed",
                },
              }
            : unit
        ),
      },
    };
    const before = structuredClone(fixture.state);

    expect(() =>
      updateDescribedUnit(fixture.state!, firstUnitId, { category: "office" })
    ).toThrow("بيانات وصف الوحدة غير صالحة");
    expect(fixture.state).toEqual(before);
  });

  it("rejects Arabic-digit and case-normalized duplicate codes atomically and retains the draft", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        units: fixture.state!.entities.units.map(unit =>
          unit.id === firstUnitId
            ? unit
            : {
                ...unit,
                meta: {
                  ...unit.meta,
                  code: "شقة-A02",
                  unitCode: "شقة-A02",
                },
              }
        ),
      },
    };
    const unitsBefore = structuredClone(fixture.state!.entities.units);
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    await act(async () => setInput(inputFor("رمز الوحدة"), "شقة-a٠٢"));
    await act(async () => click("حفظ ومتابعة").click());

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "رقم/رمز الوحدة مكرر"
    );
    expect(inputFor("رمز الوحدة").value).toBe("شقة-a٠٢");
    expect(fixture.state!.entities.units).toEqual(unitsBefore);
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("clears only an incompatible subtype after an explicit category switch", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    expect(selectFor("ترتيب الفيلا").value).toBe("detached");
    await act(async () => setSelect(selectFor("نوع الوحدة"), "office"));
    expect(inputFor("اسم الوحدة")).toBeTruthy();
    expect(
      [...host.querySelectorAll<HTMLLabelElement>("label")].some(label =>
        label.textContent?.includes("ترتيب الفيلا")
      )
    ).toBe(false);
    await act(async () => click("حفظ ومتابعة").click());

    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      category: "office",
    });
    expect(
      parseUnitProfile(saved.meta.unitProfile).villaArrangement
    ).toBeUndefined();
    expect(saved.meta.unitCode).toBe("U-01");
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("does not auto-change a code when the type changes and preserves physical, tenancy, photo, and financial data", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const secondUnit = fixture.state!.entities.units.find(
      unit => unit.propertyId === propertyId && unit.id !== firstUnitId
    )!;
    fixture.state = updateDescribedUnit(fixture.state!, secondUnit.id, {
      category: "shop",
      bedrooms: "3",
      livingRooms: "1",
      bathrooms: "2",
      kitchens: "1",
      contents: "محتوى محفوظ",
      unitArea: "88.5",
      salePrice: "350000",
      monthlyRent: "2600",
      tenancyStatus: "vacant",
    }).state;
    fixture.state = {
      ...fixture.state,
      entities: {
        ...fixture.state.entities,
        units: fixture.state.entities.units.map(unit =>
          unit.id === secondUnit.id
            ? {
                ...unit,
                meta: {
                  ...unit.meta,
                  photoGallery: JSON.stringify({ v: 1, ids: ["type-photo"] }),
                },
              }
            : unit
        ),
      },
    };
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => click("تخطي الوحدة").click());

    expect(inputFor("رمز الوحدة").value).toBe("U-02");
    expect(selectFor("نوع الوحدة").value).toBe("shop");
    await act(async () => setSelect(selectFor("نوع الوحدة"), "office"));
    await act(async () => click("حفظ وإنهاء").click());

    const saved = fixture.state!.entities.units.find(
      unit => unit.id === secondUnit.id
    )!;
    expect(saved.meta.unitCode).toBe("U-02");
    expect(saved.meta.photoGallery).toBe(
      JSON.stringify({ v: 1, ids: ["type-photo"] })
    );
    expect(saved.meta.monthlyRentMinor).toBe(260_000);
    expect(saved.meta.tenancyDeclaration).toBeTruthy();
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      category: "office",
      bedrooms: 3,
      livingRooms: 1,
      bathrooms: 2,
      kitchens: 1,
      contents: "محتوى محفوظ",
      areaM2: 88.5,
      salePriceMinor: 35_000_000,
    });
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("rejects a stale save when any current unit field changed and retains the plan draft", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const secondUnit = fixture.state!.entities.units.find(
      unit => unit.propertyId === propertyId && unit.id !== firstUnitId
    )!;
    fixture.state = updateDescribedUnit(fixture.state!, secondUnit.id, {
      category: "shop",
    }).state;
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => click("تخطي الوحدة").click());
    await act(async () => setInput(inputFor("رقم المخطط"), "00027"));
    await act(async () => {
      fixture.state = updateDescribedUnit(fixture.state!, secondUnit.id, {
        category: "office",
        unitCode: "O-009",
      }).state;
      fixture.refresh?.();
    });
    await act(async () => click("حفظ وإنهاء").click());

    const current = fixture.state!.entities.units.find(
      unit => unit.id === secondUnit.id
    )!;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "تعارض تعديل"
    );
    expect(inputFor("رقم المخطط").value).toBe("00027");
    expect(current.meta.unitCode).toBe("O-009");
    expect(current.meta.code).toBe("O-009");
    expect(parseUnitProfile(current.meta.unitProfile)).toMatchObject({
      category: "office",
    });
    expect(financialRecords()).toEqual(financialBefore);
  });

  it("retains a validation-rejected draft while open through photo state changes, then discards it on close", async () => {
    const { propertyId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));

    await act(async () => setInput(inputFor("اسم الوحدة"), "عنوان المسودة"));
    await act(async () => setInput(inputFor("رقم المخطط"), "X".repeat(81)));
    await act(async () =>
      host
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "رقم مخطط"
    );
    expect(inputFor("اسم الوحدة").value).toBe("عنوان المسودة");
    expect(inputFor("رقم المخطط").value).toHaveLength(81);

    await act(async () => click("محاكاة تحديث الصورة المحلية").click());
    expect(inputFor("اسم الوحدة").value).toBe("عنوان المسودة");
    expect(inputFor("رقم المخطط").value).toHaveLength(81);

    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(host.textContent).toContain("لديك تعديلات غير محفوظة");
    await act(async () => click("تجاهل التعديلات").click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => reopen?.());
    expect(inputFor("اسم الوحدة").value).not.toBe("عنوان المسودة");
    expect(inputFor("رقم المخطط").value).toBe("");
  });

  it("rejects a stale stage-two identifier save without altering newer layout attributes", async () => {
    const { propertyId, firstUnitId, firstRent } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => setInput(inputFor("رقم المخطط"), "00027"));
    await act(async () => {
      fixture.state = updateDescribedUnit(fixture.state!, firstUnitId, {
        roomLayout: "custom",
        bedrooms: "4",
        livingRooms: "2",
        furnishing: "unfurnished",
        contents: "وصف أحدث خارج المرحلة الثانية",
        bathrooms: "4",
        kitchens: "3",
      }).state;
      fixture.refresh?.();
    });
    await act(async () => click("حفظ ومتابعة").click());
    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "تعارض تعديل"
    );
    expect(inputFor("رقم المخطط").value).toBe("00027");
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      roomLayout: "custom",
      bedrooms: 4,
      livingRooms: 2,
      furnishing: "unfurnished",
      contents: "وصف أحدث خارج المرحلة الثانية",
      bathrooms: 4,
      kitchens: 3,
    });
    expect(saved.meta.monthlyRentMinor).toBe(firstRent);
    expect(saved.meta.unitCode).toBe("U-01");
  });

  it("rejects a stale area save and retains current identifiers without partial changes", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const finances = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => setInput(inputFor("مساحة الوحدة"), "٧٧٫٥٠"));
    await act(async () => {
      fixture.state = updateDescribedUnit(fixture.state!, firstUnitId, {
        title: "اسم أحدث محفوظ",
        propertyNumber: "00073",
        planNumber: "00088",
        electricityNumber: "00099",
        waterNumber: "00066",
      }).state;
      fixture.refresh?.();
    });
    await act(async () => click("حفظ ومتابعة").click());
    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "تعارض تعديل"
    );
    expect(inputFor("مساحة الوحدة").value).toBe("٧٧٫٥٠");
    expect(saved.title).toBe("اسم أحدث محفوظ");
    expect(saved.meta.electricityNumber).toBe("00099");
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      propertyNumber: "00073",
      planNumber: "00088",
      waterNumber: "00066",
    });
    expect(financialRecords()).toEqual(finances);
  });

  it("keeps a referenced but locally missing photo incomplete until the gallery verifies readable local bytes", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    fixture.state = updateDescribedUnit(fixture.state!, firstUnitId, {
      planNumber: "00027",
    }).state;
    fixture.state = {
      ...fixture.state,
      entities: {
        ...fixture.state.entities,
        units: fixture.state.entities.units.map(unit =>
          unit.id === firstUnitId
            ? {
                ...unit,
                meta: {
                  ...unit.meta,
                  photoGallery: JSON.stringify({
                    v: 1,
                    ids: ["media-missing-photo-12345678"],
                  }),
                },
              }
            : unit
        ),
      },
    };
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    const firstEvidence = () =>
      host.querySelector('[aria-label="ملخص البيانات الناقصة"] li')!
        .textContent;
    expect(firstEvidence()).toContain("صورة واحدة على الأقل");
    expect(firstEvidence()).not.toContain("لا توجد عناصر ناقصة");
    await act(async () => {
      fixture.localAvailableCount = 1;
      fixture.refresh?.();
    });
    expect(firstEvidence()).toContain("لا توجد عناصر ناقصة");
    await act(async () => {
      fixture.localAvailableCount = 0;
      fixture.refresh?.();
    });
    expect(firstEvidence()).toContain("صورة واحدة على الأقل");
  });

  it("stores distinct Arabic monthly asking rents inside each unit and restores them after reopening", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        properties: fixture.state!.entities.properties.map(property =>
          property.id === propertyId
            ? {
                ...property,
                meta: {
                  ...property.meta,
                  propertyProfile: JSON.stringify({ v: 1, purpose: "rent" }),
                },
              }
            : property
        ),
      },
    };
    const financialBefore = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    expect(host.textContent).not.toContain("سعر بيع الوحدة المطلوب");
    await act(async () =>
      setInput(inputFor("إيجار الوحدة الشهري"), "١٬٢٣٤٫٥٠")
    );
    await act(async () => click("حفظ ومتابعة").click());
    await act(async () => setInput(inputFor("إيجار الوحدة الشهري"), "٧٬٥٠٠"));
    await act(async () => click("حفظ وإنهاء").click());
    const units = fixture.state!.entities.units.filter(
      unit => unit.propertyId === propertyId
    );
    expect(
      units.find(unit => unit.id === firstUnitId)!.meta.monthlyRentMinor
    ).toBe(123_450);
    expect(
      units.find(unit => unit.id !== firstUnitId)!.meta.monthlyRentMinor
    ).toBe(750_000);
    expect(financialRecords()).toEqual(financialBefore);
    await act(async () => reopen?.());
    expect(inputFor("إيجار الوحدة الشهري").value).toBe("1234.50");
  });

  it("omits an invalid hidden sale draft after changing goal and keeps the saved opposite price", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    fixture.state = updateDescribedUnit(fixture.state!, firstUnitId, {
      salePrice: "150000",
    }).state;
    const setPurpose = (purpose: "rent" | "sale") => {
      fixture.state = {
        ...fixture.state!,
        entities: {
          ...fixture.state!.entities,
          properties: fixture.state!.entities.properties.map(property =>
            property.id === propertyId
              ? {
                  ...property,
                  meta: {
                    ...property.meta,
                    propertyProfile: JSON.stringify({ v: 1, purpose }),
                  },
                }
              : property
          ),
        },
      };
    };
    setPurpose("sale");
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () =>
      setInput(inputFor("سعر بيع الوحدة المطلوب"), "1.234")
    );
    await act(async () => {
      setPurpose("rent");
      fixture.refresh?.();
    });
    await act(async () => setInput(inputFor("إيجار الوحدة الشهري"), "3050"));
    await act(async () => click("حفظ ومتابعة").click());
    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(saved.meta.monthlyRentMinor).toBe(305_000);
    expect(parseUnitProfile(saved.meta.unitProfile).salePriceMinor).toBe(
      15_000_000
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("rejects a stale identifier save without changing newer asking prices", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => {
      fixture.state = updateDescribedUnit(fixture.state!, firstUnitId, {
        monthlyRent: "4500",
        salePrice: "650000",
      }).state;
      fixture.refresh?.();
    });
    await act(async () => setInput(inputFor("رقم المخطط"), "00075"));
    await act(async () => click("حفظ ومتابعة").click());
    const saved = fixture.state!.entities.units.find(
      unit => unit.id === firstUnitId
    )!;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "تعارض تعديل"
    );
    expect(inputFor("رقم المخطط").value).toBe("00075");
    expect(saved.meta.monthlyRentMinor).toBe(450_000);
    expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
      salePriceMinor: 65_000_000,
    });
  });

  it("awaits durable storage before navigating and blocks next or Escape while that save is pending", async () => {
    const { propertyId } = createSplitFixture();
    let releaseCommit!: () => void;
    fixture.assetCommitGate = new Promise<void>(resolve => {
      releaseCommit = resolve;
    });
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => setInput(inputFor("رقم المخطط"), "P-DURABLE"));
    await act(async () => {
      click("حفظ ومتابعة").click();
      await Promise.resolve();
    });
    expect(host.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(fixture.commits).toBe(1);
    expect(host.textContent).toContain("الوحدة 1 من 2");

    await act(async () => click("تخطي الوحدة").click());
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(host.textContent).toContain("الوحدة 1 من 2");
    expect(host.textContent).not.toContain("لديك تعديلات غير محفوظة");

    await act(async () => {
      releaseCommit();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("الوحدة 2 من 2");
    expect(
      parseUnitProfile(
        fixture.state!.entities.units.find(
          unit => unit.propertyId === propertyId
        )!.meta.unitProfile
      ).planNumber
    ).toBe("P-DURABLE");
  });

  it("retains wizard inputs and stays open when durable storage rejects a save", async () => {
    const { propertyId } = createSplitFixture();
    fixture.assetCommitFailure = new Error("تعذر تأكيد الحفظ المحلي");
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => setInput(inputFor("رقم المخطط"), "P-RETRY"));
    await act(async () => click("حفظ ومتابعة").click());

    expect(fixture.commits).toBe(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "تعذر تأكيد الحفظ المحلي"
    );
    expect(inputFor("رقم المخطط").value).toBe("P-RETRY");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("الوحدة 1 من 2");
  });

  it("blocks a changed workspace before it can save/cache the previous workspace draft", async () => {
    const { propertyId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () =>
      setInput(inputFor("اسم الوحدة"), "مسودة النطاق الأول")
    );

    fixture.scope = `other-workspace-${crypto.randomUUID()}`;
    await act(async () => fixture.refresh?.());
    expect(host.textContent).toContain("تغيّر نطاق مساحة العمل");
    expect(host.querySelector("input")).toBeNull();

    await act(async () => click("إغلاق").click());
    expect(fixture.commits).toBe(0);
    await act(async () => reopen?.());
    expect(inputFor("اسم الوحدة").value).not.toBe("مسودة النطاق الأول");
    expect(host.textContent).toContain("لا تعتبر الوحدة مكتملة");
  });

  it("accepts its own acknowledged photo change while saving floor without losing the photo", async () => {
    const { propertyId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    const before = financialRecords();
    const id =
      fixture.state!.entities.units.find(
        u => u.propertyId === fixture.state!.entities.properties.at(-1)!.id
      )?.id ?? fixture.state!.entities.units.at(-1)!.id;
    const currentProperty = fixture.state!.entities.properties.find(
      p => p.id === propertyId
    )!;
    const unit = fixture.state!.entities.units.find(
      u => u.propertyId === currentProperty.id
    )!;
    await act(async () => setInput(inputFor("الدور"), "٠٠٣"));
    await act(async () => click("محاكاة تحديث الصورة المحلية").click());
    await act(async () =>
      host
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    const saved = fixture.state!.entities.units.find(u => u.id === unit.id)!;
    expect(saved.meta.floor).toBe("٠٠٣");
    expect(String(saved.meta.photoGallery)).toContain("local-photo");
    expect(financialRecords()).toEqual(before);
  });

  it("does not acknowledge an unrelated newer edit merely because a gallery changed afterwards", async () => {
    const { propertyId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    const property = fixture.state!.entities.properties.find(
      p => p.id === propertyId
    )!;
    const unit = fixture.state!.entities.units.find(
      u => u.propertyId === property.id
    )!;
    await act(async () => setInput(inputFor("الدور"), "٠٠٤"));
    await act(async () => {
      fixture.state = updateDescribedUnit(fixture.state!, unit.id, {
        title: "اسم أحدث خارج النافذة",
      }).state;
      fixture.refresh?.();
    });
    await act(async () => click("محاكاة تحديث الصورة المحلية").click());
    await act(async () =>
      host
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(host.textContent).toContain("تعارض");
    expect(
      fixture.state!.entities.units.find(u => u.id === unit.id)?.title
    ).toBe("اسم أحدث خارج النافذة");
    expect(inputFor("الدور").value).toBe("٠٠٤");
  });

  const matchToggle = () =>
    host.querySelector<HTMLInputElement>(
      'input[aria-label="مطابقة الوحدة بوحدات أخرى"]'
    )!;
  const matchApply = () =>
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".unit-bulk-fill-panel button"
      ),
    ].find(button => button.textContent?.trim() === "إضافة")!;

  it("matches a filled current unit to selected others from the footer in one commit, then continues without extra value fields", async () => {
    const { propertyId, units } = createLargeVillaComplexFixture();
    fixture.state = {
      ...fixture.state!,
      entities: {
        ...fixture.state!.entities,
        units: fixture.state!.entities.units.map(unit =>
          units.some(u => u.id === unit.id)
            ? {
                ...unit,
                meta: {
                  ...unit.meta,
                  photoGallery: JSON.stringify({
                    v: 1,
                    ids: [`picture-${unit.id}`],
                  }),
                },
              }
            : unit
        ),
      },
    };
    const originalUnits = fixture.state.entities.units.filter(
      unit => unit.propertyId === propertyId
    );
    const beforeFinancial = financialRecords();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeNull();
    expect(matchToggle().closest(".unit-setup-wizard__actions")).toBeTruthy();
    await act(async () => {
      const picker = selectFor("انتقل إلى الوحدة");
      setSelect(picker, units[1]!.id);
    });
    await act(async () =>
      setInput(inputFor("رقم المخطط"), "مسودة مخطط مستقلة")
    );
    await act(async () =>
      setSelect(selectFor("انتقل إلى الوحدة"), units[0]!.id)
    );
    await act(async () => {
      setSelect(selectFor("نوع الوحدة"), "villa");
    });
    await act(async () => setSelect(selectFor("ترتيب الفيلا"), "detached"));
    await act(async () => {
      setSelect(selectFor("هدف الوحدة"), "rent");
      setInput(inputFor("مساحة الوحدة"), "١٣٦٫٥٠");
      setInput(inputFor("إيجار الوحدة الشهري"), "١٬٢٣٤٫٥٠");
      setInput(inputFor("الدور"), "٠٠٣");
      setInput(inputFor("رقم الكهرباء"), "٠٠٧٧");
      setTextArea(textAreaFor("وصف الوحدة"), "وصف المصدر المكتوب مرة واحدة");
    });
    await act(async () => matchToggle().click());
    const panel = host.querySelector<HTMLElement>(".unit-bulk-fill-panel")!;
    expect(panel).toBeTruthy();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(
      panel.querySelectorAll('textarea, select, input:not([type="checkbox"])')
    ).toHaveLength(0);
    expect(
      host.querySelector("form")!.compareDocumentPosition(panel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const choices = panel.querySelectorAll<HTMLInputElement>(
      ".unit-bulk-fill-panel__unit-list input"
    );
    expect(choices).toHaveLength(35);
    expect([...choices].every(input => !input.checked)).toBe(true);
    await act(async () => {
      choices[0]!.click();
      choices[16]!.click();
    });
    expect(panel.textContent).toContain("1234.50");
    await act(async () => {
      matchApply().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fixture.commits).toBe(1);
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeNull();
    expect(matchToggle().checked).toBe(false);
    expect(host.textContent).toContain("الوحدة 1 من 36");
    const savedUnits = fixture.state!.entities.units.filter(
      unit => unit.propertyId === propertyId
    );
    for (const id of [units[0]!.id, units[1]!.id, units[17]!.id]) {
      const saved = savedUnits.find(unit => unit.id === id)!;
      expect(saved.meta.monthlyRentMinor).toBe(123450);
      expect(parseUnitProfile(saved.meta.unitProfile)).toMatchObject({
        category: "villa",
        villaArrangement: "detached",
        areaM2: 136.5,
      });
      expect(saved.meta.description).toBe("وصف المصدر المكتوب مرة واحدة");
    }
    expect(
      savedUnits.map(unit => [
        unit.id,
        unit.title,
        unit.meta.unitCode,
        unit.meta.photoGallery,
      ])
    ).toEqual(
      originalUnits.map(unit => [
        unit.id,
        unit.title,
        unit.meta.unitCode,
        unit.meta.photoGallery,
      ])
    );
    expect(
      savedUnits.find(unit => unit.id === units[1]!.id)!.meta.electricityNumber
    ).toEqual(originalUnits[1]!.meta.electricityNumber);
    expect(
      savedUnits.find(unit => unit.id === units[1]!.id)!.meta.floor
    ).toEqual(originalUnits[1]!.meta.floor);
    expect(savedUnits.find(unit => unit.id === units[2]!.id)).toEqual(
      originalUnits[2]
    );
    expect(financialRecords()).toEqual(beforeFinancial);
    await act(async () => click("حفظ ومتابعة").click());
    expect(host.textContent).toContain("الوحدة 2 من 36");
    expect(inputFor("رقم المخطط").value).toBe("مسودة مخطط مستقلة");
    expect(inputFor("إيجار الوحدة الشهري").value).toBe("1234.50");
  });

  it("retains current source and target choices when matching storage fails, and cancellation does not save", async () => {
    const { propertyId } = createSplitFixture();
    fixture.assetCommitFailure = new Error("تعذر تأكيد الحفظ الجماعي المحلي");
    const before = fixture.state;
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () =>
      setTextArea(textAreaFor("وصف الوحدة"), "قيمة تعاد المحاولة بها")
    );
    await act(async () => matchToggle().click());
    const choice = host.querySelector<HTMLInputElement>(
      ".unit-bulk-fill-panel__unit-list input"
    )!;
    await act(async () => choice.click());
    await act(async () => {
      matchApply().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fixture.commits).toBe(1);
    expect(fixture.state).toBe(before);
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeTruthy();
    expect(choice.checked).toBe(true);
    expect(textAreaFor("وصف الوحدة").value).toBe("قيمة تعاد المحاولة بها");
    expect(host.textContent).toContain("تعذر تأكيد الحفظ الجماعي المحلي");
    expect(host.textContent).not.toContain("حُفظت الوحدة الحالية");
    await act(async () => matchToggle().click());
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeNull();
    expect(fixture.commits).toBe(1);
    expect(fixture.state).toBe(before);
    expect(textAreaFor("وصف الوحدة").value).toBe("قيمة تعاد المحاولة بها");
  });

  it("freezes source and next during matching review and keeps changes when review is cancelled", async () => {
    const { propertyId } = createSplitFixture();
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => setInput(inputFor("مساحة الوحدة"), "121.25"));
    await act(async () => matchToggle().click());
    expect(
      host.querySelector<HTMLFieldSetElement>(
        ".unit-setup-wizard__source-fields"
      )!.disabled
    ).toBe(true);
    expect(click("حفظ ومتابعة").disabled).toBe(true);
    expect(selectFor("انتقل إلى الوحدة").disabled).toBe(true);
    await act(async () => setInput(inputFor("مساحة الوحدة"), "999"));
    expect(inputFor("مساحة الوحدة").value).toBe("121.25");
    expect(fixture.commits).toBe(0);
    await act(async () => matchToggle().click());
    expect(
      host.querySelector<HTMLFieldSetElement>(
        ".unit-setup-wizard__source-fields"
      )!.disabled
    ).toBe(false);
    expect(inputFor("مساحة الوحدة").value).toBe("121.25");
    expect(fixture.commits).toBe(0);
  });

  it("matches existing saved source information without editing it again", async () => {
    const { propertyId, firstUnitId } = createSplitFixture();
    const target = fixture.state!.entities.units.find(
      unit => unit.propertyId === propertyId && unit.id !== firstUnitId
    )!;
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => matchToggle().click());
    expect(host.querySelector(".unit-bulk-fill-panel")!.textContent).toContain(
      "2500 ر.ق"
    );
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(
          ".unit-bulk-fill-panel__unit-list input"
        )!
        .click()
    );
    expect(matchApply().disabled).toBe(false);
    await act(async () => matchApply().click());
    expect(fixture.commits).toBe(1);
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeNull();
    expect(
      fixture.state!.entities.units.find(unit => unit.id === target.id)!.meta
        .monthlyRentMinor
    ).toBe(250000);
    expect(host.textContent).toContain("الوحدة 1 من 2");
  });
  it("matches a saved photo-only source and keeps the target's existing photo in one commit", async () => {
    const { propertyId } = createSplitFixture();
    const units = fixture.state!.entities.units.filter(
      u => u.propertyId === propertyId
    );
    fixture.state = saveTargetPhotoGallery(
      fixture.state!,
      "units",
      units[0]!.id,
      ["source-readable"]
    ).state;
    fixture.state = saveTargetPhotoGallery(
      fixture.state!,
      "units",
      units[1]!.id,
      ["target-existing"]
    ).state;
    matchingFiles.available = ["source-readable"];
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => matchToggle().click());
    expect(host.textContent).toContain("صور المصدر المتاحة: 1");
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(
          ".unit-bulk-fill-panel__unit-list input"
        )!
        .click()
    );
    await act(async () => matchApply().click());
    expect(fixture.commits).toBe(1);
    const target = fixture.state!.entities.units.find(
      u => u.id === units[1]!.id
    )!;
    expect(parsePhotoGallery(target.meta.photoGallery).ids).toEqual([
      "target-existing",
      "source-readable",
    ]);
    expect(host.querySelector(".unit-bulk-fill-panel")).toBeNull();
  });

  it("does not commit information or photos if a reviewed photo becomes unreadable", async () => {
    const { propertyId } = createSplitFixture();
    const units = fixture.state!.entities.units.filter(
      u => u.propertyId === propertyId
    );
    fixture.state = saveTargetPhotoGallery(
      fixture.state!,
      "units",
      units[0]!.id,
      ["source-readable"]
    ).state;
    matchingFiles.available = ["source-readable"];
    const before = structuredClone(fixture.state);
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => matchToggle().click());
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(
          ".unit-bulk-fill-panel__unit-list input"
        )!
        .click()
    );
    matchingFiles.available = [];
    await act(async () => matchApply().click());
    expect(fixture.commits).toBe(0);
    expect(fixture.state).toEqual(before);
    expect(host.textContent).toContain("تعذرت قراءة صورة");
    expect(host.querySelector(".unit-bulk-fill-panel")).not.toBeNull();
  });
  it("truthfully acknowledges a committed match even if workspace changes immediately afterwards", async () => {
    const { propertyId } = createSplitFixture();
    const units = fixture.state!.entities.units.filter(
      u => u.propertyId === propertyId
    );
    fixture.state = updateDescribedUnit(fixture.state!, units[0]!.id, {
      description: "مصدر محفوظ",
    }).state;
    await act(async () => root.render(<WizardHost propertyId={propertyId} />));
    await act(async () => matchToggle().click());
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(
          ".unit-bulk-fill-panel__unit-list input"
        )!
        .click()
    );
    fixture.afterCommit = () => {
      fixture.scope = "workspace-after-commit";
      fixture.refresh?.();
    };
    await act(async () => matchApply().click());
    expect(
      fixture.state!.entities.units.find(u => u.id === units[1]!.id)!.meta
        .description
    ).toBe("مصدر محفوظ");
    expect(fixture.lastMatchResult).toBe(true);
    expect(host.textContent).not.toContain("لم تُضف المطابقة");
  });
});
