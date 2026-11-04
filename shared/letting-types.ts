import type { DemoEntity, EntityMap, PrototypeState } from "./prototype";
import type { PropertyMediaDescriptor } from "./property-media-types";
export const LETTING_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const LETTING_TEST_EMAIL = "suhaim@qissatec.com";
export type ApplicantKind = "individual" | "company";
export type LettingStage =
  | "documents-requested"
  | "review"
  | "rejected"
  | "contract-issued"
  | "returns-received"
  | "appointment-booked"
  | "handover-submitted"
  | "completed";
export type LettingDocumentKind =
  | "identity"
  | "credit"
  | "commercial"
  | "establishment"
  | "signed-contract"
  | "cheque-image"
  | "handover-photo";
export const LETTING_STAGE_LABELS: Record<LettingStage, string> = {
  "documents-requested": "بانتظار المعلومات والمستندات",
  review: "المراجعة وقرار الموظف",
  rejected: "مرفوض بقرار الموظف",
  "contract-issued": "بانتظار توقيع العقد وصور الشيكات",
  "returns-received": "اختيار موعد التسليم",
  "appointment-booked": "بانتظار تصوير الحالة وإقرار الاستلام",
  "handover-submitted": "تأكيد الموظف لاستلام الأصول",
  completed: "اكتمل التأجير",
};
export const LETTING_DOCUMENT_LABELS: Record<LettingDocumentKind, string> = {
  identity: "البطاقة الشخصية",
  credit: "تقرير الكردت بيرو",
  commercial: "السجل التجاري",
  establishment: "قيد المنشأة",
  "signed-contract": "العقد الموقع",
  "cheque-image": "صور الشيكات",
  "handover-photo": "صور حالة العقار من المستأجر",
};
export interface LettingProfileInput {
  name: string;
  email: string;
  phone: string;
  identityNumber: string;
  companyName: string;
  companyNumber: string;
  establishmentNumber: string;
  companyAddress: string;
  companyWebsite: string;
  authorizedName: string;
}
export interface LettingIntakeInput {
  requestId: string;
  messageId: string;
  applicantKind: ApplicantKind;
  propertyId: string;
  unitId: string;
  name: string;
  email: string;
  phone: string;
  offerMinor: number;
  startDate: string;
  endDate: string;
  message: string;
}
export interface LettingDocumentInput {
  requestId: string;
  applicationId: string;
  kind: LettingDocumentKind;
  descriptor: PropertyMediaDescriptor;
}
export interface LettingReviewInput {
  requestId: string;
  applicationId: string;
  minimumRentMinor: number | null;
  minimumCreditScore: number | null;
  creditScore: number | null;
  scoreScaleMax: number | null;
  creditReportDate: string;
  creditSourceReviewed: boolean;
  creditSource: string;
  documentsReviewed: boolean;
  maximumReportAgeDays: number | null;
}
export interface LettingDecisionInput {
  requestId: string;
  applicationId: string;
  decision: "approve" | "reject";
  reason: string;
  templateId?: string;
  propertyNumber: string;
  electricityNumber: string;
}
export interface LettingChequeInput {
  number: string;
  bank: string;
  amountMinor: number;
  dueDate: string;
}
export interface LettingReturnsInput {
  requestId: string;
  applicationId: string;
  cheques: LettingChequeInput[];
}
export interface LettingSlotInput {
  requestId: string;
  employee: string;
  start: string;
  end: string;
  portfolioId: string;
}
export interface LettingBookingInput {
  requestId: string;
  applicationId: string;
  slotId: string;
}
export interface LettingHandoverInput {
  requestId: string;
  applicationId: string;
  date: string;
  conditionNotes: string;
  tenantDeclaration: boolean;
}
export interface LettingCompleteInput {
  requestId: string;
  applicationId: string;
  originalContractReceived: boolean;
  originalChequesReceived: boolean;
  receivedDate: string;
}
export interface LettingRecommendation {
  outcome: "recommend-approve" | "recommend-reject" | "needs-review";
  reasons: string[];
  missing: string[];
  review?: DemoEntity;
}
export interface LettingContractView {
  document: DemoEntity;
  lease: DemoEntity;
  content: string;
}
export interface LettingCaseView {
  application: DemoEntity;
  profile: DemoEntity | undefined;
  stage: LettingStage;
  documents: DemoEntity[];
  emails: DemoEntity[];
  review: DemoEntity | undefined;
  lease: DemoEntity | undefined;
  slot: DemoEntity | undefined;
  cheques: DemoEntity[];
}
export interface LettingTransition<T = DemoEntity> {
  state: PrototypeState;
  result: T;
}
export type LettingEntities = EntityMap;
