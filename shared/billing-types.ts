import type { DemoEntity, EntityMap, PrototypeState } from "./prototype";
export type BillingKind = "invoice" | "payment-request" | "lpo";
export interface BillingLine {
  description: string;
  quantity: number;
  unitPriceMinor: number;
}
export interface BillingInput {
  kind: BillingKind;
  portfolioId: string;
  propertyId: string;
  requestId?: string;
  unitId: string;
  leaseId: string;
  existingReceivableId: string;
  partyName: string;
  issuerName: string;
  vendorId: string;
  issueDate: string;
  dueDate: string;
  lines: BillingLine[];
  feeMinor: number;
  discountMinor: number;
  notes: string;
}
export interface BillingTotals {
  subtotalMinor: number;
  feeMinor: number;
  discountMinor: number;
  totalMinor: number;
}
export interface BillingView {
  document: DemoEntity;
  kind: BillingKind;
  number: string;
  issuerName: string;
  partyName: string;
  issueDate: string;
  dueDate: string;
  propertyTitle: string;
  unitTitle: string;
  leaseTitle: string;
  lines: BillingLine[];
  totals: BillingTotals;
  collectedMinor: number;
  lossMinor: number;
  remainingMinor: number;
  status: string;
  notes: string;
  receivableId: string;
  receipts: DemoEntity[];
}
export interface BillingReceiptView {
  receipt: DemoEntity;
  number: string;
  documentNumber: string;
  issuerName: string;
  partyName: string;
  propertyTitle: string;
  unitTitle: string;
  date: string;
  method: string;
  amountMinor: number;
  remainingMinor: number;
  balanceKind: "historical" | "current";
  balanceAsOf: string;
}
export interface IssueBillingResult {
  state: PrototypeState;
  document: DemoEntity;
}
export interface CollectBillingInput {
  documentId: string;
  amountMinor: number;
  method: "نقد" | "تحويل";
  collectionDate: string;
  expectedRemainingMinor: number;
}
export interface CollectBillingResult {
  state: PrototypeState;
  receipt: DemoEntity;
}
export type BillingEntities = EntityMap;
