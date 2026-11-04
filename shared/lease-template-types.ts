import type { DemoEntity, PrototypeState, EntityMap } from "./prototype";
export type RentalMode = "whole" | "units";
export const CONTRACT_TEMPLATE_TOKENS = [
  "الاسم",
  "رقم_العقار",
  "رقم_الكهرباء",
  "نوع_العقار",
] as const;
export interface SaveLeaseTemplateInput {
  templateId?: string;
  requestId: string;
  name: string;
  content: string;
  fileName?: string;
  defaultRentMinor: number;
  defaultTermMonths: number;
}
export interface SaveLeaseTemplateResult {
  state: PrototypeState;
  template: DemoEntity;
}
export interface GenerateTemplateLeaseInput {
  requestId: string;
  templateId: string;
  propertyId: string;
  unitId: string;
  tenantName: string;
  propertyNumber: string;
  electricityNumber: string;
  propertyType: string;
  startDate: string;
}
export interface GenerateTemplateLeaseResult {
  state: PrototypeState;
  lease: DemoEntity;
  document: DemoEntity;
}
export interface LeaseTemplateView {
  template: DemoEntity;
  name: string;
  content: string;
  version: number;
  defaultRentMinor: number;
  defaultTermMonths: number;
  fileName: string;
}
export interface TemplateLeaseView {
  lease: DemoEntity;
  document: DemoEntity;
  templateName: string;
  templateVersion: number;
  content: string;
  tenantName: string;
  propertyNumber: string;
  electricityNumber: string;
  propertyType: string;
  rentalMode: string;
  unitTitle: string;
}
export interface CreateRentalPropertyResult {
  state: PrototypeState;
  property: DemoEntity;
}
export type TemplateEntities = EntityMap;
