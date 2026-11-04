import { describe, it, expect } from "vitest";
import { prototypeStateSchema } from "./prototype";
import { createDemoState } from "../../client/src/lib/demo-data";
import {
  issueBillingDocument,
  collectBillingDocument,
  getBillingView,
} from "../../client/src/lib/prototype-billing";
import type { BillingInput } from "../../shared/billing-types";
const input = (portfolioId: string, propertyId: string): BillingInput => ({
  kind: "invoice",
  portfolioId,
  propertyId,
  unitId: "",
  leaseId: "",
  existingReceivableId: "",
  partyName: "عميل صوري",
  issuerName: "صناع الفرص · نموذج",
  vendorId: "",
  issueDate: "2026-10-24",
  dueDate: "2026-10-31",
  lines: [{ description: "إيجار أكتوبر", quantity: 1, unitPriceMinor: 250000 }],
  feeMinor: 0,
  discountMinor: 0,
  notes: "وثيقة تجريبية لاستخدام النموذج فقط",
});
describe("billing in the existing strict private snapshot", () => {
  it("retains old documents and accepts issued invoice and cash receipt", () => {
    const old = createDemoState();
    old.settings.role = "operator";
    old.settings.portfolioId = "all";
    const property = old.entities.properties[0];
    const issued = issueBillingDocument(
      old,
      input(property.portfolioId, property.id)
    );
    expect(
      issued.state.entities.documents.slice(0, old.entities.documents.length)
    ).toEqual(old.entities.documents);
    const paid = collectBillingDocument(issued.state, {
      documentId: issued.document.id,
      amountMinor: 250000,
      method: "نقد",
      collectionDate: "2026-10-24",
      expectedRemainingMinor: 250000,
    });
    const result = prototypeStateSchema.safeParse(paid.state);
    expect(
      result.success,
      result.success ? "" : JSON.stringify(result.error.issues)
    ).toBe(true);
    expect(
      getBillingView(paid.state.entities, issued.document).remainingMinor
    ).toBe(0);
  });
  it("stores an LPO without modifying AR or expenses or cash records", () => {
    const old = createDemoState();
    old.settings.role = "operator";
    old.settings.portfolioId = "all";
    const vendor = old.entities.vendors[0];
    const doc = issueBillingDocument(old, {
      ...input(vendor.portfolioId, ""),
      kind: "lpo",
      vendorId: vendor.id,
      partyName: vendor.title,
      lines: [
        { description: "عرض عمل صوري", quantity: 1, unitPriceMinor: 100000 },
      ],
    });
    expect(prototypeStateSchema.safeParse(doc.state).success).toBe(true);
    expect(doc.state.entities.receivables).toEqual(old.entities.receivables);
    expect(doc.state.entities.expenses).toEqual(old.entities.expenses);
    expect(doc.state.entities.collections).toEqual(old.entities.collections);
  });
});
