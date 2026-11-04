// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { MaintenanceExpenseSettlement } from "./MaintenanceExpenseSettlement";
import {
  createMaintenanceRequest,
  submitMaintenanceForReview,
  approveMaintenanceRequest,
  linkMaintenanceCost,
  completeMaintenanceWork,
  materializeMaintenanceExpense,
} from "@/lib/prototype-maintenance";
import { financialSummary } from "@/lib/prototype-finance";
import { ledgerFromRecords } from "@/pages/operating/FinancePages";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  host: HTMLDivElement,
  api: ReturnType<typeof usePrototype>,
  expenseId: string;
function Harness() {
  api = usePrototype();
  const expense = api.state.entities.expenses.find(x => x.id === expenseId);
  return expense ? <MaintenanceExpenseSettlement expense={expense} /> : null;
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
    const p = api.state.entities.properties.find(x => x.id === "tower")!;
    api.commitTransition(s => {
      let t = createMaintenanceRequest(s, {
        requestId: "qa-maintenance-ui",
        title: "طلب مصطنع للتسوية",
        propertyId: p.id,
        unitId: "",
        priority: "عادية",
        capMinor: 100000,
      });
      const review = submitMaintenanceForReview(t.state, t.result.request.id);
      let a = approveMaintenanceRequest(
        {
          ...review.state,
          settings: { ...review.state.settings, role: "owner" },
        },
        t.result.request.id
      );
      let linked = linkMaintenanceCost(
        { ...a.state, settings: { ...a.state.settings, role: "operator" } },
        {
          maintenanceId: t.result.request.id,
          costMinor: 60000,
          expenseDate: "2026-10-24",
          classification: "تشغيلي",
          category: "صيانة",
        }
      );
      let done = completeMaintenanceWork(linked.state, t.result.request.id);
      let result = materializeMaintenanceExpense(
        done.state,
        t.result.request.id
      );
      expenseId = result.result.expense.id;
      return { state: result.state, result: result.result.expense };
    });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  expenseId = "";
});
it("uses a separate confirmed UI settlement, no cash beforehand, one payment and no generic paid patch", async () => {
  const before = api.state.entities.payments.length;
  expect(() => api.patch("expenses", expenseId, { status: "مسدد" })).toThrow(
    "التسوية"
  );
  const trigger = [...host.querySelectorAll("button")].find(b =>
    b.textContent?.includes("تسجيل سداد محلي")
  )!;
  await act(async () => trigger.click());
  const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
  const confirm =
    form.querySelector<HTMLSelectElement>('[name="confirm"]') ??
    [...form.querySelectorAll("select")].at(-1)!;
  await act(async () => {
    confirm.value = "confirm";
    confirm.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const date = form.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(date, "2026-11-15");
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(api.state.entities.payments.length).toBe(before);
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(api.state.entities.payments.length).toBe(before + 1);
  const expense = api.state.entities.expenses.find(x => x.id === expenseId)!;
  expect(expense.status).toBe("مسدد");
  expect(expense.meta.paidDate).toBe("2026-11-15");
  const p = api.state.entities.payments.find(
    x => x.meta.expenseId === expenseId
  )!;
  expect(p.meta.externalTransfer).toBe(false);
  const isolated = {
    ...api.state.entities,
    expenses: [expense],
    payments: [p],
  };
  expect(
    financialSummary(isolated, "growth", "2026-10", "2026-10-31").expenseMinor
  ).toBe(0);
  expect(
    financialSummary(isolated, "growth", "2026-11", "2026-11-30").expenseMinor
  ).toBe(60000);
  const l = ledgerFromRecords({ ...api.state.entities });
  expect(
    l.filter(x => x.source === "تسوية مصروف" && x.amountMinor === 60000)
  ).toHaveLength(1);
  expect(document.body.textContent).toContain("مسدد محليًا");
});
