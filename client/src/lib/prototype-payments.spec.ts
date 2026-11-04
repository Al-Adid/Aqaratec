import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import { financialSummary } from "./prototype-finance";
import {
  applyCollectionEntries,
  applyPropertyMonthCollection,
  getMonthlyPropertyCollections,
  getReceivableCollectionDetails,
} from "./prototype-payments";
import { PROTOTYPE_DATE, toMinor } from "@shared/prototype";

const month = "2026-10";
const options = {
  method: "تحويل",
  status: "محصّل",
  collectionDate: PROTOTYPE_DATE,
};

describe("monthly collection ledger", () => {
  it("shows every scoped property with its real due dates, not its creation month", () => {
    const state = createDemoState();
    const rows = getMonthlyPropertyCollections(state.entities, "all", month);
    expect(rows).toHaveLength(state.entities.properties.length);
    expect(rows.every(row => row.dues.length > 0)).toBe(true);
    expect(
      rows.flatMap(row => row.dues).every(row => row.dueDate === "2026-10-01")
    ).toBe(true);
    expect(
      getMonthlyPropertyCollections(state.entities, "family", month).every(
        row => row.property.portfolioId === "family"
      )
    ).toBe(true);
  });
  it("does not pretend a property with no recorded monthly dues has been paid", () => {
    const state = createDemoState();
    const rows = getMonthlyPropertyCollections(
      state.entities,
      "all",
      "2026-11"
    );
    expect(rows).toHaveLength(state.entities.properties.length);
    expect(
      rows.every(row => row.dues.length === 0 && row.expectedMinor === 0)
    ).toBe(true);
    expect(() =>
      applyPropertyMonthCollection(state, rows[0].property.id, "2026-11", "نقد")
    ).toThrow("لا توجد استحقاقات");
  });
  it("collects only the outstanding amount, keeps prior partial receipts, and updates income once", () => {
    const state = createDemoState();
    const before = getMonthlyPropertyCollections(
      state.entities,
      "all",
      month
    ).find(row => row.property.id === "building")!;
    const partial = before.dues.find(row => row.receivable.id === "r-6")!;
    expect(partial.collectedMinor).toBe(toMinor("2000"));
    const next = applyPropertyMonthCollection(
      state,
      before.property.id,
      month,
      "تحويل",
      PROTOTYPE_DATE,
      before.remainingMinor
    );
    const after = getMonthlyPropertyCollections(
      next.entities,
      "all",
      month
    ).find(row => row.property.id === before.property.id)!;
    expect(after.remainingMinor).toBe(0);
    expect(after.collectedMinor).toBe(after.expectedMinor);
    expect(
      next.entities.collections.length - state.entities.collections.length
    ).toBe(before.dues.filter(row => row.remainingMinor > 0).length);
    expect(financialSummary(next.entities, "all", month).incomeMinor).toBe(
      financialSummary(state.entities, "all", month).incomeMinor +
        before.remainingMinor
    );
    expect(
      state.entities.collections.find(row => row.id === "c-partial")!
        .amountMinor
    ).toBe(toMinor("2000"));
    expect(() =>
      applyPropertyMonthCollection(next, before.property.id, month, "تحويل")
    ).toThrow("سبق");
  });
  it("stores the entered actual collection date, independent of the due date", () => {
    const state = createDemoState();
    const next = applyCollectionEntries(
      state,
      [{ receivableId: "r-6", amountMinor: toMinor("500") }],
      { ...options, collectionDate: "2026-10-19" }
    );
    const receipt = next.entities.collections.at(-1)!;
    expect(receipt.date).toBe("2026-10-19");
    expect(receipt.meta.cleared).toBe("2026-10-19");
    expect(
      getReceivableCollectionDetails(
        next.entities,
        next.entities.receivables.find(row => row.id === "r-6")!
      ).collectedDates
    ).toContain("2026-10-19");
    expect(() =>
      applyCollectionEntries(state, [{ receivableId: "r-6", amountMinor: 1 }], {
        ...options,
        collectionDate: "2026-02-30",
      })
    ).toThrow("تاريخ");
  });
  it("never counts deposited cheques as collected cash", () => {
    const state = createDemoState();
    const due = getReceivableCollectionDetails(
      state.entities,
      state.entities.receivables.find(row => row.id === "r-7")!
    );
    expect(due.collectedMinor).toBe(0);
    expect(due.pendingMinor).toBeGreaterThan(0);
    const next = applyCollectionEntries(
      state,
      [{ receivableId: "r-7", amountMinor: due.remainingMinor }],
      options
    );
    expect(
      next.entities.collections.find(row => row.id === "check-pending")!.status
    ).toBe("مودع");
    expect(
      getReceivableCollectionDetails(
        next.entities,
        state.entities.receivables.find(row => row.id === "r-7")!
      ).remainingMinor
    ).toBe(0);
  });
  it("keeps recorded losses separate from collection and recovers only the remaining claim", () => {
    const state = createDemoState();
    const receivable = state.entities.receivables.find(
      row => row.id === "r-8"
    )!;
    state.entities.losses.push({
      ...receivable,
      id: "monthly-loss",
      amountMinor: toMinor("1000"),
      meta: { receivableId: receivable.id, reason: "فرض اختبار" },
    });
    const before = getMonthlyPropertyCollections(
      state.entities,
      "all",
      month
    ).find(row => row.property.id === receivable.propertyId)!;
    const next = applyPropertyMonthCollection(
      state,
      receivable.propertyId,
      month,
      "نقد",
      PROTOTYPE_DATE,
      before.remainingMinor
    );
    const after = getMonthlyPropertyCollections(
      next.entities,
      "all",
      month
    ).find(row => row.property.id === receivable.propertyId)!;
    expect(after.remainingMinor).toBe(0);
    expect(after.lossMinor).toBe(toMinor("1000"));
    expect(after.collectedMinor).toBe(after.expectedMinor - after.lossMinor);
    expect(
      next.entities.receivables.find(row => row.id === receivable.id)!.status
    ).toBe("معالج بخسارة");
  });
  it("rejects a stale monthly confirmation after another partial receipt", () => {
    const state = createDemoState();
    const before = getMonthlyPropertyCollections(
      state.entities,
      "all",
      month
    ).find(row => row.property.id === "building")!;
    const next = applyCollectionEntries(
      state,
      [{ receivableId: "r-6", amountMinor: toMinor("500") }],
      options
    );
    expect(() =>
      applyPropertyMonthCollection(
        next,
        "building",
        month,
        "نقد",
        PROTOTYPE_DATE,
        before.remainingMinor
      )
    ).toThrow("تغير المبلغ");
  });
  it("rejects duplicated entries, overpayments, and recording from a reader role or another scope", () => {
    const state = createDemoState();
    expect(() =>
      applyCollectionEntries(
        state,
        [
          { receivableId: "r-6", amountMinor: 1 },
          { receivableId: "r-6", amountMinor: 1 },
        ],
        options
      )
    ).toThrow("مكرر");
    expect(() =>
      applyCollectionEntries(
        state,
        [{ receivableId: "r-6", amountMinor: Number.MAX_SAFE_INTEGER }],
        options
      )
    ).toThrow("يتجاوز");
    const reader = structuredClone(state);
    reader.settings.role = "owner";
    expect(() =>
      applyPropertyMonthCollection(reader, "building", month, "نقد")
    ).toThrow("الموظف");
    const limited = structuredClone(state);
    limited.settings.portfolioId = "growth";
    expect(() =>
      applyPropertyMonthCollection(limited, "building", month, "نقد")
    ).toThrow("المحفظة");
  });
});
