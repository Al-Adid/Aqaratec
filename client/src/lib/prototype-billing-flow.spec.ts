import { describe, it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import {
  issueBillingDocument,
  getBillingView,
  getBillingReceiptView,
} from "./prototype-billing";
import {
  applyPropertyMonthCollection,
  getMonthlyPropertyCollections,
} from "./prototype-payments";
import { outstandingFor } from "./prototype-finance";
import type { BillingInput } from "@shared/billing-types";
describe("invoice with pre-existing monthly collection flows", () => {
  it("reuses a due once and reflects the monthly dashboard collection and a confirmed receipt", () => {
    const state = createDemoState();
    state.settings.portfolioId = "all";
    state.settings.role = "operator";
    const due = state.entities.receivables.find(
      r =>
        outstandingFor(state.entities, r.id) > 0 &&
        r.meta.leaseId &&
        r.meta.unitId &&
        !state.entities.losses.some(l => l.meta.receivableId === r.id)
    )!;
    const lease = state.entities.leases.find(l => l.id === due.meta.leaseId)!;
    const tenant = state.entities.tenants.find(
      t => t.id === lease.meta.tenantId
    )!;
    const date = String(due.meta.due ?? due.date);
    const input: BillingInput = {
      kind: "invoice",
      requestId: "legacy-wrap-1",
      portfolioId: due.portfolioId,
      propertyId: due.propertyId,
      unitId: String(due.meta.unitId),
      leaseId: lease.id,
      existingReceivableId: due.id,
      partyName: tenant.title,
      issuerName: "نموذج الشركة",
      vendorId: "",
      issueDate: date,
      dueDate: date,
      lines: [
        {
          description: due.title,
          quantity: 1,
          unitPriceMinor: due.amountMinor,
        },
      ],
      feeMinor: 0,
      discountMinor: 0,
      notes: "",
    };
    const issued = issueBillingDocument(state, input);
    expect(issued.state.entities.receivables).toEqual(
      state.entities.receivables
    );
    const repeated = issueBillingDocument(issued.state, input);
    expect(repeated.state).toBe(issued.state);
    expect(repeated.document.id).toBe(issued.document.id);
    const changed = { ...input, partyName: "طرف مختلف" };
    expect(() => issueBillingDocument(issued.state, changed)).toThrow(
      "بيانات مختلفة"
    );
    const target = getMonthlyPropertyCollections(
      issued.state.entities,
      "all",
      date.slice(0, 7)
    ).find(p => p.property.id === due.propertyId)!;
    const paid = applyPropertyMonthCollection(
      issued.state,
      due.propertyId,
      date.slice(0, 7),
      "نقد",
      "2026-10-24",
      target.remainingMinor
    );
    expect(paid.entities.receivables).toHaveLength(
      state.entities.receivables.length
    );
    const view = getBillingView(paid.entities, issued.document);
    expect(view.status).toBe("مدفوع");
    expect(view.remainingMinor).toBe(0);
    const lastReceipt = view.receipts.at(-1)!;
    expect(
      getBillingReceiptView(paid.entities, lastReceipt.id).documentNumber
    ).toBe(view.number);
  });
});
