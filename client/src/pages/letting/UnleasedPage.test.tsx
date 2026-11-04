// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { UnleasedPage } from "./UnleasedPage";

const calendar = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/letting-calendar", () => ({
  downloadLettingCalendarInvite: calendar.download,
}));

vi.mock("@/components/letting/LettingAttachments", () => ({
  LettingAttachments: ({ kinds }: { kinds: string[] }) => (
    <div data-testid="letting-attachments">{kinds.join(",")}</div>
  ),
}));
vi.mock("@/components/letting/LettingContractPreview", () => ({
  LettingContractPreview: () => <div>معاينة العقد</div>,
}));
vi.mock("@/lib/letting-engine", () => {
  const documents = (kind: string) =>
    kind === "company"
      ? ["identity", "credit", "commercial", "establishment"]
      : ["identity", "credit"];
  return {
    listAvailableLettingTargets: (entities: PrototypeState["entities"]) =>
      entities.units.filter(unit => unit.status === "متاحة"),
    createLettingApplication: (
      state: PrototypeState,
      input: Record<string, unknown>
    ) => {
      const property = state.entities.properties.find(
        row => row.id === input.propertyId
      );
      const unit = state.entities.units.find(row => row.id === input.unitId);
      const application: DemoEntity = {
        id: `app-${String(input.requestId)}`,
        title: String(input.name),
        subtitle: "طلب تأجير",
        portfolioId: property?.portfolioId ?? "family",
        propertyId: String(input.propertyId),
        status: "جديد",
        date: String(input.startDate),
        amountMinor: Number(input.offerMinor),
        currency: "QAR",
        meta: {
          recordType: "letting-application",
          stage: "documents-requested",
          applicantKind: String(input.applicantKind),
          unitId: String(input.unitId),
          unitTitle: unit?.title ?? "هدف التأجير",
          name: String(input.name),
          email: String(input.email),
          phone: String(input.phone),
          startDate: String(input.startDate),
          endDate: String(input.endDate),
        },
      };
      return {
        state: {
          ...state,
          entities: {
            ...state.entities,
            applications: [...state.entities.applications, application],
          },
        },
        result: application,
      };
    },
    getLettingCase: (
      entities: PrototypeState["entities"],
      applicationId: string
    ) => {
      const application = entities.applications.find(
        row => row.id === applicationId
      )!;
      return {
        application,
        profile: undefined,
        stage: application.meta.stage,
        documents: [],
        emails: [],
        review: undefined,
        lease: undefined,
        slot: entities.tasks.find(row => row.id === application.meta.slotId),
        cheques: [],
      };
    },
    requiredLettingDocuments: documents,
    evaluateLettingRecommendation: () => ({
      outcome: "needs-review",
      reasons: [],
      missing: [],
    }),
    getLettingContract: () => undefined,
    getLettingChequeSchedule: () => [],
    getLeaseTemplates: () => [],
    updateLettingProfile: (state: PrototypeState) => ({ state, result: null }),
    reviewLettingApplication: (state: PrototypeState) => ({
      state,
      result: null,
    }),
    decideLettingApplication: (state: PrototypeState) => ({
      state,
      result: null,
    }),
    submitLettingReturns: (state: PrototypeState) => ({ state, result: null }),
    addLettingSlot: (state: PrototypeState) => ({ state, result: null }),
    bookLettingAppointment: (state: PrototypeState) => ({
      state,
      result: null,
    }),
    submitLettingHandover: (state: PrototypeState) => ({ state, result: null }),
    completeLettingApplication: (state: PrototypeState) => ({
      state,
      result: null,
    }),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

function Harness() {
  api = usePrototype();
  return <UnleasedPage />;
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function click(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(item => item.textContent?.includes(text));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

async function fill(label: string, value: string) {
  const fieldLabel = [
    ...document.querySelectorAll<HTMLLabelElement>("[role=dialog] label"),
  ].find(item =>
    item.querySelector("span")?.textContent?.trim().startsWith(label)
  );
  expect(fieldLabel).toBeTruthy();
  const field = fieldLabel!.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea")!;
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  await act(async () =>
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    )
  );
}

async function addTarget() {
  await act(async () => {
    api.createRentalProperty({
      requestId: "letting-page-target",
      title: "فيلا اختبار التأجير",
      portfolioId: "family",
      assetType: "villa",
      rentalMode: "whole",
      unitCount: "1",
      inputMethod: "يدوي",
      propertyNumber: "P-12",
      electricityNumber: "E-44",
    });
  });
  return api.state.entities.units.at(-1)!;
}

async function createApplicant(kind: "individual" | "company") {
  const target = await addTarget();
  await click("طلب جديد");
  await fill("العقار / هدف التأجير الشاغر", target.id);
  await fill("نوع المتقدم", kind);
  await fill("الاسم", kind === "company" ? "شركة اختبار" : "فرد اختبار");
  await fill("البريد الإلكتروني", "letting@example.test");
  await fill("الهاتف", "+97450000000");
  await fill("عرض الإيجار", "1200");
  await fill("تاريخ البدء المقترح", "2026-10-25");
  await fill("تاريخ النهاية المقترح", "2027-10-24");
  const form = document.querySelector<HTMLFormElement>("[role=dialog] form")!;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  await click("متابعة");
}

describe("UnleasedPage UI", () => {
  it("downloads the local calendar invite for the exact booked slot and application", async () => {
    await createApplicant("individual");
    const application = api.state.entities.applications.at(-1)!;
    const slot: DemoEntity = {
      id: "slot-test-ics",
      title: "موعد اختبار",
      subtitle: "",
      portfolioId: application.portfolioId,
      propertyId: application.propertyId,
      status: "محجوز",
      date: "2026-10-25",
      amountMinor: 0,
      currency: "QAR",
      meta: {
        recordType: "letting-slot",
        start: "2026-10-25T09:00:00+03:00",
        end: "2026-10-25T10:00:00+03:00",
        reservedFor: application.id,
        employee: "موظف اختبار",
      },
    };
    await act(async () =>
      api.commitTransition(current => ({
        state: {
          ...current,
          entities: {
            ...current.entities,
            tasks: [...current.entities.tasks, slot],
            applications: current.entities.applications.map(row =>
              row.id === application.id
                ? {
                    ...row,
                    meta: {
                      ...row.meta,
                      stage: "appointment-booked",
                      slotId: slot.id,
                    },
                  }
                : row
            ),
          },
        },
        result: slot,
      }))
    );
    await click("تنزيل دعوة الموعد ICS");
    expect(calendar.download).toHaveBeenCalledWith(
      slot,
      expect.objectContaining({ id: application.id })
    );
    expect(document.body.textContent).toContain("تنزيل محلي فقط");
  });
  it("renders its empty initial state without an error", () => {
    expect(document.body.textContent).toContain("لا توجد أهداف تأجير شاغرة");
    expect(document.body.textContent).toContain("لا توجد طلبات تأجير بعد");
    expect(document.body.textContent).not.toContain("حدث خطأ");
  });

  it("shows identity and credit requirements only for an individual", async () => {
    await createApplicant("individual");
    expect(
      document.querySelector("[data-testid=letting-attachments]")?.textContent
    ).toBe("identity,credit");
    expect(document.body.textContent).not.toContain("السجل التجاري");
  });

  it("shows the four individual and corporate requirement kinds for a company", async () => {
    await createApplicant("company");
    expect(
      document.querySelector("[data-testid=letting-attachments]")?.textContent
    ).toBe("identity,credit,commercial,establishment");
    expect(document.body.textContent).toContain("رقم قيد المنشأة");
  });
});
