import { describe, expect, it } from "vitest";
import type { BillingInput } from "@shared/billing-types";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import {
  calculateBillingTotals,
  collectBillingDocument,
  getBillingReceiptView,
  getBillingView,
  issueBillingDocument,
} from "./prototype-billing";

function newInvoice(overrides: Partial<BillingInput> = {}): BillingInput {
  const state = createDemoState();
  const tenant = state.entities.tenants.find(row => row.id === "tenant-1")!;
  return {
    kind: "invoice",
    portfolioId: "family",
    propertyId: "villa",
    unitId: "u-v1",
    leaseId: "lease-1",
    existingReceivableId: "",
    partyName: tenant.title,
    issuerName: "شركة سناء النموذجية",
    vendorId: "",
    issueDate: "2026-10-24",
    dueDate: "2026-10-31",
    lines: [
      { description: "إيجار تجريبي", quantity: 1, unitPriceMinor: 10_000 },
    ],
    feeMinor: 0,
    discountMinor: 0,
    notes: "سجل محلي للاختبار",
    ...overrides,
  };
}

function existingReceivableInvoice(receivableId: string): BillingInput {
  const state = createDemoState();
  const receivable = state.entities.receivables.find(
    row => row.id === receivableId
  )!;
  const lease = state.entities.leases.find(
    row => row.id === receivable.meta.leaseId
  )!;
  const unit = state.entities.units.find(
    row => row.id === receivable.meta.unitId
  )!;
  const tenant = state.entities.tenants.find(
    row => row.id === lease.meta.tenantId
  )!;
  return newInvoice({
    portfolioId: receivable.portfolioId,
    propertyId: receivable.propertyId,
    unitId: unit.id,
    leaseId: lease.id,
    existingReceivableId: receivable.id,
    partyName: tenant.title,
    issueDate: receivable.date,
    dueDate: String(receivable.meta.due ?? receivable.date),
    lines: [
      {
        description: "استحقاق قائم",
        quantity: 1,
        unitPriceMinor: receivable.amountMinor,
      },
    ],
  });
}

function appendLoss(
  state: PrototypeState,
  receivable: DemoEntity
): PrototypeState {
  const loss: DemoEntity = {
    ...receivable,
    id: "loss-for-billing-spec",
    amountMinor: receivable.amountMinor,
    status: "مسجلة",
    meta: { receivableId: receivable.id, reason: "اختبار تسوية" },
  };
  return {
    ...state,
    entities: { ...state.entities, losses: [...state.entities.losses, loss] },
  };
}

describe("prototype billing", () => {
  it("issues exactly one receivable and one local document without moving cash", () => {
    const state = createDemoState();
    const before = {
      receivables: state.entities.receivables.length,
      documents: state.entities.documents.length,
      collections: state.entities.collections.length,
      expenses: state.entities.expenses.length,
      payments: state.entities.payments.length,
    };

    const result = issueBillingDocument(state, newInvoice());

    expect(result.state.entities.receivables).toHaveLength(
      before.receivables + 1
    );
    expect(result.state.entities.documents).toHaveLength(before.documents + 1);
    expect(result.state.entities.collections).toHaveLength(before.collections);
    expect(result.state.entities.expenses).toHaveLength(before.expenses);
    expect(result.state.entities.payments).toHaveLength(before.payments);
    expect(result.document.meta.recordType).toBe("billing-document");
    expect(result.document.meta.number).toBe("INV-2026-0001");
    expect(result.document.date).toBe("2026-10-24");
    expect(result.state.entities.receivables.at(-1)!.date).toBe("2026-10-31");
    expect(result.state.entities.receivables.at(-1)!.meta.due).toBe(
      "2026-10-31"
    );
  });

  it("wraps an existing receivable without duplicating it and blocks a second active document", () => {
    const state = createDemoState();
    const input = existingReceivableInvoice("r-1");
    const first = issueBillingDocument(state, input);

    expect(first.state.entities.receivables).toHaveLength(
      state.entities.receivables.length
    );
    expect(first.document.meta.receivableId).toBe("r-1");
    expect(() => issueBillingDocument(first.state, input)).toThrow(
      "وثيقة فوترة نشطة"
    );
  });

  it("rejects out-of-scope or mismatched relationships atomically", () => {
    const state = createDemoState();
    state.settings.portfolioId = "growth";
    const before = structuredClone(state.entities);
    expect(() => issueBillingDocument(state, newInvoice())).toThrow("المحفظة");
    expect(state.entities).toEqual(before);

    const all = createDemoState();
    const wrongUnit = newInvoice({ propertyId: "building", unitId: "u-v1" });
    expect(() => issueBillingDocument(all, wrongUnit)).toThrow(/الوحدة|العقد/);
    expect(all.entities.documents).toHaveLength(3);
  });

  it("requires the operator preview role for issuance and collection", () => {
    const state = createDemoState();
    state.settings.role = "owner";
    expect(() => issueBillingDocument(state, newInvoice())).toThrow("الموظف");

    const issued = issueBillingDocument(createDemoState(), newInvoice());
    issued.state.settings.role = "tenant";
    expect(() =>
      collectBillingDocument(issued.state, {
        documentId: issued.document.id,
        amountMinor: 1,
        method: "نقد",
        collectionDate: "2026-10-24",
        expectedRemainingMinor: 10_000,
      })
    ).toThrow("الموظف");
  });

  it("keeps an LPO neutral to receivables, expenses, and cash collections", () => {
    const state = createDemoState();
    const result = issueBillingDocument(
      state,
      newInvoice({
        kind: "lpo",
        propertyId: "",
        unitId: "",
        leaseId: "",
        existingReceivableId: "",
        partyName: "مورد النموذج أ",
        vendorId: "vendor1",
        lines: [
          { description: "صيانة تجريبية", quantity: 2, unitPriceMinor: 500 },
        ],
      })
    );

    expect(result.document.meta.kind).toBe("lpo");
    expect(result.document.meta.number).toBe("LPO-2026-0001");
    expect(result.state.entities.receivables).toHaveLength(
      state.entities.receivables.length
    );
    expect(result.state.entities.expenses).toHaveLength(
      state.entities.expenses.length
    );
    expect(result.state.entities.collections).toHaveLength(
      state.entities.collections.length
    );
  });

  it("records partial then full confirmed cash collection and rejects stale duplicate confirmation", () => {
    const issued = issueBillingDocument(createDemoState(), newInvoice());
    const partial = collectBillingDocument(issued.state, {
      documentId: issued.document.id,
      amountMinor: 4_000,
      method: "نقد",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 10_000,
    });
    const partialView = getBillingView(partial.state.entities, issued.document);

    expect(partial.receipt.meta.receiptNumber).toBe("RCP-2026-0001");
    expect(partial.receipt.meta.documentId).toBe(issued.document.id);
    expect(partialView.status).toBe("مدفوع جزئيًا");
    expect(() =>
      collectBillingDocument(partial.state, {
        documentId: issued.document.id,
        amountMinor: 4_000,
        method: "نقد",
        collectionDate: "2026-10-24",
        expectedRemainingMinor: 10_000,
      })
    ).toThrow("تغير المبلغ المتبقي");

    const complete = collectBillingDocument(partial.state, {
      documentId: issued.document.id,
      amountMinor: 6_000,
      method: "تحويل",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 6_000,
    });
    expect(
      getBillingView(complete.state.entities, issued.document).status
    ).toBe("مدفوع");
    expect(complete.receipt.meta.receiptNumber).toBe("RCP-2026-0002");
  });

  it("excludes pending cheques and does not print a receipt for them", () => {
    const state = createDemoState();
    const issued = issueBillingDocument(
      state,
      existingReceivableInvoice("r-7")
    );
    const view = getBillingView(
      issued.state.entities,
      issued.document,
      "2026-10-24"
    );

    expect(view.collectedMinor).toBe(0);
    expect(view.remainingMinor).toBe(650_000);
    expect(view.status).toBe("متأخر");
    expect(() =>
      getBillingReceiptView(issued.state.entities, "check-pending")
    ).toThrow("غير مؤكد");
  });

  it("marks a loss-settled document as loss settled, never paid", () => {
    const issued = issueBillingDocument(createDemoState(), newInvoice());
    const receivable = issued.state.entities.receivables.at(-1)!;
    const settled = appendLoss(issued.state, receivable);
    const view = getBillingView(settled.entities, issued.document);

    expect(view.remainingMinor).toBe(0);
    expect(view.lossMinor).toBe(10_000);
    expect(view.status).toBe("مسوّى بخسارة");
    expect(view.status).not.toBe("مدفوع");
  });

  it("resolves a dashboard receipt through its receivable and gives it a stable fallback number", () => {
    const state = createDemoState();
    const issued = issueBillingDocument(
      state,
      existingReceivableInvoice("r-1")
    );
    const receipt = getBillingReceiptView(issued.state.entities, "c-1");

    expect(receipt.documentNumber).toBe("INV-2026-0001");
    expect(receipt.number).toBe("RCP-2026-c-1");
    expect(receipt.amountMinor).toBe(1_200_000);
  });

  it("uses safe arithmetic, rejects excess discount, overflow, and prototype-meta totals", () => {
    expect(
      calculateBillingTotals(
        [{ description: "بند", quantity: 2, unitPriceMinor: 500 }],
        200,
        100
      )
    ).toEqual({
      subtotalMinor: 1000,
      feeMinor: 200,
      discountMinor: 100,
      totalMinor: 1100,
    });
    expect(() =>
      calculateBillingTotals(
        [{ description: "بند", quantity: 1, unitPriceMinor: 100 }],
        0,
        101
      )
    ).toThrow("الخصم");
    expect(() =>
      calculateBillingTotals(
        [
          {
            description: "كبير",
            quantity: 1,
            unitPriceMinor: 1_000_000_000_001,
          },
        ],
        0,
        0
      )
    ).toThrow("البروتوتايب");
    expect(() =>
      calculateBillingTotals(
        [
          {
            description: "غير آمن",
            quantity: 10_000,
            unitPriceMinor: Number.MAX_SAFE_INTEGER,
          },
        ],
        0,
        0
      )
    ).toThrow("الحد الآمن");
  });

  it("enforces bounded lines, notes, and scalar metadata on every issued document", () => {
    const state = createDemoState();
    expect(() =>
      issueBillingDocument(state, newInvoice({ notes: "ن".repeat(513) }))
    ).toThrow("الملاحظات");
    expect(() =>
      issueBillingDocument(
        state,
        newInvoice({
          lines: Array.from({ length: 6 }, (_, index) => ({
            description: `بند ${index}`,
            quantity: 1,
            unitPriceMinor: 1,
          })),
        })
      )
    ).toThrow("خمسة");

    const issued = issueBillingDocument(state, newInvoice());
    const values = Object.values(issued.document.meta);
    expect(values.length).toBeLessThanOrEqual(32);
    expect(
      values.every(value =>
        ["string", "number", "boolean"].includes(typeof value)
      )
    ).toBe(true);
    expect(
      values.every(value => typeof value !== "string" || value.length <= 1024)
    ).toBe(true);
    expect(
      values.every(
        value =>
          typeof value !== "number" || Math.abs(value) <= 1_000_000_000_000
      )
    ).toBe(true);
    expect(String(issued.document.meta.lines).length).toBeLessThanOrEqual(1024);
  });
});
