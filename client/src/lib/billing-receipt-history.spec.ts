import { describe, it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import {
  issueBillingDocument,
  collectBillingDocument,
  getBillingReceiptView,
} from "./prototype-billing";
import type { BillingInput } from "@shared/billing-types";
function fixture() {
  const state = createDemoState();
  state.settings.portfolioId = "all";
  state.settings.role = "operator";
  const property = state.entities.properties[0];
  const input: BillingInput = {
    kind: "invoice",
    portfolioId: property.portfolioId,
    propertyId: property.id,
    requestId: "history-invoice",
    unitId: "",
    leaseId: "",
    existingReceivableId: "",
    partyName: "مستأجر صوري",
    issuerName: "شركة صورية",
    vendorId: "",
    issueDate: "2026-10-24",
    dueDate: "2026-10-24",
    lines: [
      { description: "مستحق تجريبي", quantity: 1, unitPriceMinor: 100000 },
    ],
    feeMinor: 0,
    discountMinor: 0,
    notes: "",
  };
  return issueBillingDocument(state, input);
}
describe("R14 historical receipt balance", () => {
  it("keeps600 afterfirst400 evenafterthelast600 payment", () => {
    const issue = fixture();
    const first = collectBillingDocument(issue.state, {
      documentId: issue.document.id,
      amountMinor: 40000,
      method: "نقد",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 100000,
    });
    const second = collectBillingDocument(first.state, {
      documentId: issue.document.id,
      amountMinor: 60000,
      method: "تحويل",
      collectionDate: "2026-10-25",
      expectedRemainingMinor: 60000,
    });
    expect(
      getBillingReceiptView(second.state.entities, first.receipt.id)
        .remainingMinor
    ).toBe(60000);
    expect(
      getBillingReceiptView(second.state.entities, second.receipt.id)
        .remainingMinor
    ).toBe(0);
    expect(
      second.state.entities.collections.find(r => r.id === first.receipt.id)!
        .amountMinor
    ).toBe(40000);
  });
  it("labels a legacy receipt ascurrentbalance nothistorical andpreserves itsstored record", () => {
    const issued = fixture();
    const paid = collectBillingDocument(issued.state, {
      documentId: issued.document.id,
      amountMinor: 40000,
      method: "نقد",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 100000,
    });
    const legacy = structuredClone(paid.state.entities);
    delete legacy.collections.at(-1)!.meta.remainingAfterCollectionMinor;
    const raw = JSON.stringify(legacy);
    const view = getBillingReceiptView(legacy, paid.receipt.id, "2026-10-26");
    expect(view.balanceKind).toBe("current");
    expect(view.balanceAsOf).toBe("2026-10-26");
    expect(view.remainingMinor).toBe(60000);
    expect(JSON.stringify(legacy)).toBe(raw);
  });
  it("keeps the receipt party and balance snapshot when invoice labels laterchange", () => {
    const issued = fixture();
    const paid = collectBillingDocument(issued.state, {
      documentId: issued.document.id,
      amountMinor: 40000,
      method: "نقد",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 100000,
    });
    const later = structuredClone(paid.state.entities);
    later.documents.find(d => d.id === issued.document.id)!.meta.partyName =
      "اسم معدل لاحقًا";
    const view = getBillingReceiptView(later, paid.receipt.id);
    expect(view.partyName).toBe("مستأجر صوري");
    expect(view.remainingMinor).toBe(60000);
    expect(view.balanceKind).toBe("historical");
  });
});
