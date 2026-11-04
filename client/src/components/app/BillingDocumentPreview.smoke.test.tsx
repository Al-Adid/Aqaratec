// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingDocumentPreview } from "./BillingDocumentPreview";
import type { BillingView } from "@shared/billing-types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const view: BillingView = {
  document: {
    id: "doc-1",
    title: "فاتورة",
    subtitle: "",
    portfolioId: "p",
    propertyId: "prop",
    status: "صادر",
    date: "2026-10-24",
    amountMinor: 12500,
    currency: "QAR",
    meta: { purchaseRequest: "PR-17" },
  },
  kind: "invoice",
  number: "INV-20261024-001",
  issuerName: "صُنّاع الفرص",
  partyName: "مستأجر <مجرّب>",
  issueDate: "2026-10-24",
  dueDate: "2026-10-31",
  propertyTitle: "العقار",
  unitTitle: "U-1",
  leaseTitle: "العقد",
  lines: [{ description: "خدمة <آمنة>", quantity: 1, unitPriceMinor: 12500 }],
  totals: {
    subtotalMinor: 12500,
    feeMinor: 0,
    discountMinor: 0,
    totalMinor: 12500,
  },
  collectedMinor: 5000,
  lossMinor: 0,
  remainingMinor: 7500,
  status: "صادر",
  notes: "نص <لا يتحول إلى HTML>",
  receivableId: "r",
  receipts: [],
};

let root: Root;
let host: HTMLDivElement;
const close = vi.fn();

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  host = document.createElement("div");
  document.getElementById("root")!.append(host);
  root = createRoot(host);
  close.mockReset();
  vi.stubGlobal("print", vi.fn());
  await act(async () =>
    root.render(<BillingDocumentPreview view={view} onClose={close} />)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("BillingDocumentPreview", () => {
  it("portals an escaped accessible dialog and handles print and Escape", async () => {
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.body.textContent).toContain("خدمة <آمنة>");
    expect(document.body.querySelector("script")).toBeNull();
    const printButton = [...document.body.querySelectorAll("button")].find(
      button => button.textContent?.includes("طباعة / حفظ PDF")
    );
    await act(async () => printButton?.click());
    expect(window.print).toHaveBeenCalledTimes(1);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
