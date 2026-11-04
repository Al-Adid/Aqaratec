// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { FinancePage } from "./FinancePages";
import { ReportsPage, VacancyPage } from "./ReportsVacancyPages";
import { createDemoState } from "@/lib/demo-data";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
const nativeBroadcastChannel = globalThis.BroadcastChannel;

function Harness({ page }: { page: "reports" | "finance" | "vacancy" }) {
  api = usePrototype();
  return page === "reports" ? (
    <ReportsPage />
  ) : page === "finance" ? (
    <FinancePage />
  ) : (
    <VacancyPage />
  );
}

function entity(
  id: string,
  amountMinor: number,
  overrides: Partial<DemoEntity> = {}
): DemoEntity {
  return {
    id,
    title: id,
    subtitle: "",
    portfolioId: "family",
    propertyId: "building",
    status: "مسدد",
    date: "2026-10-10",
    amountMinor,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

async function render(
  page: "reports" | "finance" | "vacancy",
  state?: PrototypeState
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PrototypeProvider>
        <Harness page={page} />
      </PrototypeProvider>
    );
  });
  if (state) {
    await act(async () => {
      api.replaceState(state);
    });
  }
}

async function openStatementTab() {
  const tab = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    button => button.textContent?.trim() === "كشف وإقفال"
  )!;
  await act(async () => {
    tab.click();
  });
}

function setInput(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: undefined,
  });
});
afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  container?.remove();
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: nativeBroadcastChannel,
  });
});

describe("reports budget and marker UI", () => {
  it("shows distinct scoped actuals and a signed تجاوز variance instead of the same total in each budget row", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "all";
    state.settings.period = "2026-10";
    state.entities.budgets = [
      entity("budget-a", 10_000, {
        title: "ميزانية أ",
        meta: { category: "تشغيل", period: "2026-10" },
      }),
      entity("budget-b", 20_000, {
        title: "ميزانية ب",
        portfolioId: "growth",
        propertyId: "tower",
        meta: { category: "تشغيل", period: "2026-10" },
      }),
    ];
    state.entities.expenses = [
      entity("expense-a", 13_000, { meta: { category: "تشغيلي" } }),
      entity("expense-b", 20_000, {
        portfolioId: "growth",
        propertyId: "tower",
        meta: { category: "تشغيلي" },
      }),
    ];
    await render("reports", state);

    expect(container.textContent).toContain("130 ر.ق");
    expect(container.textContent).toContain("200 ر.ق");
    expect(container.textContent).toContain("تجاوز 30 ر.ق");
    expect(container.textContent).toContain("الفرق الموقّع: -30 ر.ق");
  });

  it("does not expose a cross-portfolio marker or closing action in all-portfolios view", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "all";
    state.settings.period = "2026-10";
    state.entities.journal = [
      entity("family-marker", 0, {
        status: "علامة متابعة فترة تجريبية",
        meta: { period: "2026-10", closeMarker: "prototype_period_followup" },
      }),
    ];
    await render("reports", state);
    await openStatementTab();
    const markerButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(button => button.textContent?.includes("وضع علامة متابعة"))!;

    expect(container.textContent).toContain("اختر محفظة صريحة أولًا");
    expect(markerButton.disabled).toBe(true);
    expect(container.textContent).not.toContain("علامة متابعة موجودة");
  });

  it("shows a marker only in its own portfolio and leaves the other portfolio unmarked", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    state.settings.period = "month";
    state.entities.journal = [
      entity("family-marker", 0, {
        status: "علامة متابعة فترة تجريبية",
        meta: { period: "2026-10", closeMarker: "prototype_period_followup" },
      }),
    ];
    await render("reports", state);
    await openStatementTab();
    expect(container.textContent).toContain("علامة متابعة موجودة");

    await act(async () => {
      api.setSetting("portfolioId", "growth");
    });
    expect(container.textContent).toContain("بلا علامة متابعة");
    expect(container.textContent).not.toContain("علامة متابعة موجودة");
  });

  it("labels incomeMinor as cash and accrualIncomeMinor as receivables without changing their values", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    state.settings.period = "2026-10";
    state.entities.receivables = [
      entity("ar-1000", 100_000, { status: "مستحق" }),
    ];
    state.entities.collections = [
      entity("cash-400", 40_000, {
        status: "محصّل",
        meta: { receivableId: "ar-1000" },
      }),
    ];
    await render("finance", state);

    expect(container.textContent).toContain("تحصيل نقدي مؤكد");
    expect(container.textContent).toContain("دخل على أساس الاستحقاق");
    expect(container.textContent).toContain("400 ر.ق");
    expect(container.textContent).toContain("1,000 ر.ق");
    expect(container.textContent).toContain(
      "رصيد نهاية الفترة للاستحقاقات (2026-10-31)"
    );
    expect(container.textContent).toContain(
      "المتبقي الحالي لاستحقاقات الفترة، كما في 2026-10-24"
    );
    expect(container.textContent).toContain("600 ر.ق");
  });

  it("shows the linked 100 interest expense and explanatory journal as one prototype-ledger event", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    state.settings.period = "2026-10";
    state.entities.receivables = [];
    state.entities.collections = [];
    state.entities.losses = [];
    state.entities.expenses = [
      entity("interest-expense", 10_000, {
        title: "فائدة 100",
        status: "معتمد",
        meta: {
          classification: "مصروف فائدة",
          sourceEventId: "interest-event-100",
        },
      }),
    ];
    state.entities.journal = [
      entity("interest-journal", 10_000, {
        title: "فائدة 100",
        status: "مراجَع",
        meta: {
          debitAccount: "مصروف فائدة",
          creditAccount: "ذمم/نقد تجريبي",
          sourceEventId: "interest-event-100",
        },
      }),
    ];
    await render("finance", state);

    expect(container.textContent).toContain(
      "المدين 100 ر.ق = الدائن 100 ر.ق"
    );
  });

  it("creates vacancy from all portfolios by deriving its portfolio from the chosen property", async () => {
    const state = createDemoState();
    state.settings.portfolioId = "all";
    state.settings.period = "2026-10";
    state.entities.vacancies = [];
    await render("vacancy", state);

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => button.textContent?.includes("إضافة شغور"))!
        .click();
    });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>("input");
    const selects = dialog.querySelectorAll<HTMLSelectElement>("select");
    await act(async () => {
      setInput(inputs[0], "شغور اختباري من كل المحافظ");
      selects[0].value = "building";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
      selects[1].value = "u-b6";
      selects[1].dispatchEvent(new Event("change", { bubbles: true }));
      setInput(inputs[1], "2026-10-24");
      setInput(inputs[3], "0");
    });
    await act(async () => {
      dialog
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
    });

    const vacancy = api.state.entities.vacancies.find(
      row => row.title === "شغور اختباري من كل المحافظ"
    )!;
    expect(vacancy).toMatchObject({
      portfolioId: "family",
      propertyId: "building",
    });
    expect(vacancy.meta.unitId).toBe("u-b6");
    expect(
      api.state.entities.units.find(row => row.id === "u-b6")?.status
    ).toBe("شاغرة");
  });
});
