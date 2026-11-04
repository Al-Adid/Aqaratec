import {
  LETTING_TEST_EMAIL,
  LETTING_ATTACHMENT_MAX_BYTES,
  type ApplicantKind,
  type LettingBookingInput,
  type LettingCaseView,
  type LettingChequeInput,
  type LettingCompleteInput,
  type LettingContractView,
  type LettingDecisionInput,
  type LettingDocumentInput,
  type LettingDocumentKind,
  type LettingHandoverInput,
  type LettingIntakeInput,
  type LettingProfileInput,
  type LettingRecommendation,
  type LettingReturnsInput,
  type LettingReviewInput,
  type LettingSlotInput,
  type LettingStage,
  type LettingTransition,
} from "@shared/letting-types";
import type { PropertyMediaDescriptor } from "@shared/property-media-types";
import {
  type DemoEntity,
  type EntityMap,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  getLeaseTemplateView,
  listLeaseTemplates,
} from "./lease-template-engine";
import {
  activateLease,
  createLease,
  unitOccupancyAt,
} from "./prototype-lease-lifecycle";
import { applyCollectionEntries } from "./prototype-payments";
import {
  assetTypeFromMeta,
  assetTypeLabel,
  parsePropertyProfile,
} from "./property-fields";
import { getTenancySummary } from "./tenancy-information";
import { resolveUnitPurpose } from "./unit-profile";

/**
 * A local-only letting workflow. Every exported transition is pure: it receives
 * the latest PrototypeState and either returns one complete next state or throws
 * before any caller-visible change. It deliberately does not perform OCR,
 * uploads, mail delivery, banking, or any other network work.
 */

const MAX_ENTITIES_PER_KIND = 1000;
const MAX_META_KEYS = 32;
const MAX_META_KEY_LENGTH = 64;
const MAX_META_TEXT = 1024;
const MAX_ID = 128;
const MAX_TITLE = 256;
const MAX_CONTRACT_TEXT = 16_000;
const MAX_FILE_BYTES = LETTING_ATTACHMENT_MAX_BYTES;
const MAX_CHEQUES = 120;
const MAX_REPORT_AGE_DAYS = 3_660;
const MAX_AUDIT = 300;

const STAGES = new Set<LettingStage>([
  "documents-requested",
  "review",
  "rejected",
  "contract-issued",
  "returns-received",
  "appointment-booked",
  "handover-submitted",
  "completed",
]);

const REQUIRED_DOCUMENTS: Record<ApplicantKind, LettingDocumentKind[]> = {
  individual: ["identity", "credit"],
  company: ["identity", "credit", "commercial", "establishment"],
};

const TERMINAL_STAGES = new Set<LettingStage>(["rejected", "completed"]);
const APPROVED_RESERVATION_STAGES = new Set<LettingStage>([
  "contract-issued",
  "returns-received",
  "appointment-booked",
  "handover-submitted",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metaText(meta: Record<string, MetaValue>, key: string): string {
  return text(meta[key]);
}

function newId(prefix = "letting"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function fingerprint(value: unknown): string {
  return hash(JSON.stringify(value));
}

function requireText(
  value: unknown,
  label: string,
  max = MAX_META_TEXT
): string {
  if (typeof value !== "string") throw new Error(`${label} مطلوب`);
  const result = value.trim();
  if (!result) throw new Error(`${label} مطلوب`);
  if (result.length > max) throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function optionalText(
  value: unknown,
  label: string,
  max = MAX_META_TEXT
): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${label} غير صالح`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function requireId(value: unknown, label: string): string {
  return requireText(value, label, MAX_ID);
}

function assertMetadata(meta: Record<string, MetaValue>): void {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_KEYS)
    throw new Error("بيانات السجل تتجاوز حد 32 حقلاً في نسخة التجربة");
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_META_KEY_LENGTH)
      throw new Error("اسم حقل بيانات السجل غير صالح");
    if (typeof value === "string" && value.length > MAX_META_TEXT)
      throw new Error("قيمة بيانات السجل تتجاوز الحد المسموح");
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || !Number.isSafeInteger(value))
    )
      throw new Error("قيمة بيانات السجل غير صالحة");
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      throw new Error("قيمة بيانات السجل غير صالحة");
  }
}

function assertState(state: PrototypeState): void {
  if (!state || state.version !== 1 || !state.entities || !state.settings)
    throw new Error("حالة البروتوتايب غير صالحة");
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  for (const key of [
    "properties",
    "units",
    "applications",
    "documents",
    "notifications",
    "leases",
    "tenants",
    "tasks",
    "collections",
    "receivables",
    "portfolios",
  ] as const) {
    if (!Array.isArray(state.entities[key]))
      throw new Error("سجلات البروتوتايب غير مكتملة");
  }
}

function assertCapacity(
  state: PrototypeState,
  kind: keyof EntityMap,
  add = 1
): void {
  if (state.entities[kind].length + add > MAX_ENTITIES_PER_KIND)
    throw new Error("يتجاوز الإجراء سعة سجلات نسخة التجربة");
}

function assertDate(value: unknown, label: string): string {
  const result = requireText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${label} غير صحيح`);
  const [year, month, day] = result.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label} غير صحيح`);
  }
  return result;
}

function optionalDate(value: unknown, label: string): string {
  if (value === undefined || value === null || value === "") return "";
  return assertDate(value, label);
}

function assertDateRange(startDate: string, endDate: string): void {
  if (endDate < startDate)
    throw new Error("تاريخ النهاية لا يمكن أن يسبق تاريخ البداية");
}

function assertEmail(value: unknown): string {
  const email = requireText(value, "البريد الإلكتروني", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("البريد الإلكتروني غير صحيح");
  return email;
}

function assertPhone(value: unknown): string {
  const phone = requireText(value, "رقم التواصل", 64);
  if (phone.length < 5) throw new Error("رقم التواصل غير صحيح");
  return phone;
}

function assertPositiveMinor(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} يجب أن يكون مبلغًا موجبًا صحيحًا`);
  }
  return value;
}

function assertOptionalNonNegativeInt(
  value: unknown,
  label: string,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  ) {
    throw new Error(`${label} غير صالح`);
  }
  return value;
}

function moneyText(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  return fraction
    ? `${whole}.${String(fraction).padStart(2, "0")}`
    : String(whole);
}

function stageOf(application: DemoEntity): LettingStage {
  const stage = metaText(application.meta, "stage") as LettingStage;
  if (!STAGES.has(stage)) throw new Error("مرحلة طلب التأجير غير صالحة");
  return stage;
}

function applicantKindOf(application: DemoEntity): ApplicantKind {
  const kind = metaText(application.meta, "applicantKind") as ApplicantKind;
  if (kind !== "individual" && kind !== "company")
    throw new Error("نوع مقدم الطلب غير صالح");
  return kind;
}

function isApplication(row: DemoEntity): boolean {
  return row.meta.recordType === "letting-application";
}

function isAttachment(row: DemoEntity): boolean {
  return row.meta.recordType === "letting-attachment";
}

function assertScope(state: PrototypeState, row: DemoEntity): void {
  if (
    state.settings.portfolioId !== "all" &&
    row.portfolioId !== state.settings.portfolioId
  ) {
    throw new Error("السجل خارج نطاق المحفظة الحالية");
  }
}

function propertyFor(state: PrototypeState, propertyId: string): DemoEntity {
  const property = state.entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار غير موجود");
  assertScope(state, property);
  return property;
}

function applicationFor(state: PrototypeState, id: string): DemoEntity {
  const application = state.entities.applications.find(
    row => row.id === requireId(id, "طلب التأجير") && isApplication(row)
  );
  if (!application) throw new Error("طلب التأجير غير موجود");
  assertScope(state, application);
  propertyFor(state, application.propertyId);
  return application;
}

function applicationForEntities(entities: EntityMap, id: string): DemoEntity {
  const application = entities.applications.find(
    row => row.id === id && isApplication(row)
  );
  if (!application) throw new Error("طلب التأجير غير موجود");
  return application;
}

function propertyForEntities(entities: EntityMap, id: string): DemoEntity {
  const property = entities.properties.find(row => row.id === id);
  if (!property) throw new Error("العقار غير موجود");
  return property;
}

function validLettingUnit(entities: EntityMap, unit: DemoEntity): boolean {
  const property = entities.properties.find(row => row.id === unit.propertyId);
  if (!property || property.portfolioId !== unit.portfolioId) return false;
  const rentalMode = metaText(property.meta, "rentalMode");
  const siblings = entities.units.filter(
    row =>
      row.propertyId === property.id && row.portfolioId === property.portfolioId
  );
  if (rentalMode === "whole")
    return (
      unit.meta.wholeProperty === true &&
      siblings.filter(row => row.meta.wholeProperty === true).length === 1
    );
  if (rentalMode === "units") return unit.meta.wholeProperty !== true;
  return true;
}

/**
 * Purpose is checked when offering or newly selecting a rental target. Existing
 * applications retain their historical progression checks below.
 */
function isRentalLettingTarget(entities: EntityMap, unit: DemoEntity): boolean {
  const property = entities.properties.find(row => row.id === unit.propertyId);
  if (!property || !validLettingUnit(entities, unit)) return false;
  try {
    const purpose = resolveUnitPurpose(unit, property);
    if (purpose) return purpose === "rent";

    // Legacy purpose-less properties preserve their existing rental behavior.
    // Mixed physical units remain unavailable until assigned; the canonical
    // whole-property target still represents the property's rental intent.
    const parentPurpose = parsePropertyProfile(
      property.meta.propertyProfile
    ).purpose;
    return parentPurpose !== "mixed" || unit.meta.wholeProperty === true;
  } catch {
    return false;
  }
}

/**
 * A pre-existing initial tenancy declaration must keep a new letting offer
 * closed while it is effective as rented or reserved. It never changes the
 * lease lifecycle, and malformed declaration data fails closed for new intake.
 */
function declarationBlocksNewLettingOffer(
  entities: EntityMap,
  property: DemoEntity,
  unit: DemoEntity,
  asOf: string
): boolean {
  try {
    const unitSummary = getTenancySummary(entities, property, unit, asOf);
    if (unitSummary.source === "declaration")
      return unitSummary.status !== "vacant";
    if (
      Object.prototype.hasOwnProperty.call(unit.meta, "tenancyDeclaration") &&
      unitSummary.source !== "lease"
    ) {
      return true;
    }

    // Parent declarations apply to the canonical whole-property target. For a
    // split property they are a conservative temporary gate only until unit
    // evidence exists; source "units" means physical units keep their own
    // declared/lifecycle availability rather than inheriting the parent.
    const needsParentSummary =
      unit.meta.wholeProperty === true ||
      metaText(property.meta, "rentalMode") === "units";
    if (!needsParentSummary) return false;
    const propertySummary = getTenancySummary(entities, property, undefined, asOf);
    if (propertySummary.source === "declaration")
      return propertySummary.status !== "vacant";
    return (
      Object.prototype.hasOwnProperty.call(property.meta, "tenancyDeclaration") &&
      propertySummary.source !== "lease" &&
      propertySummary.source !== "units"
    );
  } catch {
    return true;
  }
}

function wholeTarget(entities: EntityMap, unitId: string): boolean {
  return entities.units.some(
    row => row.id === unitId && row.meta.wholeProperty === true
  );
}

function sameLettingTarget(
  entities: EntityMap,
  propertyId: string,
  unitId: string,
  otherPropertyId: string,
  otherUnitId: string
): boolean {
  if (propertyId !== otherPropertyId) return false;
  if (!unitId || !otherUnitId) return true;
  if (wholeTarget(entities, unitId) || wholeTarget(entities, otherUnitId))
    return true;
  return unitId === otherUnitId;
}

function datesOverlap(
  start: string,
  end: string,
  otherStart: string,
  otherEnd: string
): boolean {
  return start <= otherEnd && otherStart <= end;
}

function leaseDates(
  lease: DemoEntity
): { start: string; end: string } | undefined {
  const start = metaText(lease.meta, "startDate") || text(lease.date);
  const end = metaText(lease.meta, "endDate");
  try {
    if (!end) return undefined;
    const validStart = assertDate(start, "تاريخ بداية العقد");
    const validEnd = assertDate(end, "تاريخ نهاية العقد");
    assertDateRange(validStart, validEnd);
    return { start: validStart, end: validEnd };
  } catch {
    return undefined;
  }
}

function isActivatedLease(lease: DemoEntity): boolean {
  return (
    lease.meta.lifecycleActivated === true ||
    (!/مسودة|مقترح|بانتظار|منته|ملغ|مرفوض/.test(lease.status) &&
      /نافذ|نشط|مؤجر|مجد/.test(lease.status))
  );
}

function applicationReservationConflicts(
  entities: EntityMap,
  propertyId: string,
  unitId: string,
  startDate: string,
  endDate: string,
  ignoredApplicationId = ""
): boolean {
  return entities.applications.some(row => {
    if (!isApplication(row) || row.id === ignoredApplicationId) return false;
    let stage: LettingStage;
    try {
      stage = stageOf(row);
    } catch {
      return false;
    }
    if (!APPROVED_RESERVATION_STAGES.has(stage)) return false;
    const otherStart = metaText(row.meta, "startDate") || row.date;
    const otherEnd = metaText(row.meta, "endDate");
    if (!otherEnd) return false;
    return (
      sameLettingTarget(
        entities,
        propertyId,
        unitId,
        row.propertyId,
        metaText(row.meta, "unitId")
      ) && datesOverlap(startDate, endDate, otherStart, otherEnd)
    );
  });
}

function hasActivatedLeaseConflict(
  entities: EntityMap,
  propertyId: string,
  unitId: string,
  startDate: string,
  endDate: string
): boolean {
  return entities.leases.some(lease => {
    if (!isActivatedLease(lease)) return false;
    const dates = leaseDates(lease);
    if (!dates) return false;
    return (
      sameLettingTarget(
        entities,
        propertyId,
        unitId,
        lease.propertyId,
        metaText(lease.meta, "unitId")
      ) && datesOverlap(startDate, endDate, dates.start, dates.end)
    );
  });
}

function assertReservationFree(
  entities: EntityMap,
  propertyId: string,
  unitId: string,
  startDate: string,
  endDate: string,
  ignoredApplicationId = ""
): void {
  if (
    hasActivatedLeaseConflict(entities, propertyId, unitId, startDate, endDate)
  ) {
    throw new Error("يوجد عقد نافذ أو مستقبلي متداخل على الهدف المختار");
  }
  if (
    applicationReservationConflicts(
      entities,
      propertyId,
      unitId,
      startDate,
      endDate,
      ignoredApplicationId
    )
  ) {
    throw new Error(
      "الهدف محجوز بطلب موافق عليه غير مفعّل؛ اختر وحدة أو فترة أخرى"
    );
  }
}

/** Returns only real rental-unit targets vacant on the supplied business date. */
export function listAvailableLettingTargets(
  entities: EntityMap,
  asOf: string
): DemoEntity[] {
  const date = assertDate(asOf, "تاريخ إتاحة التأجير");
  return entities.units.filter(unit => {
    if (!isRentalLettingTarget(entities, unit)) return false;
    const property = entities.properties.find(row => row.id === unit.propertyId);
    if (
      !property ||
      declarationBlocksNewLettingOffer(entities, property, unit, date)
    ) {
      return false;
    }
    if (unitOccupancyAt(entities, unit.id, date) !== "vacant") return false;
    // An approved but not-yet-activated application is a selection reservation.
    // It intentionally does not alter the date-effective occupancy calculation.
    return !entities.applications.some(application => {
      if (!isApplication(application)) return false;
      try {
        if (!APPROVED_RESERVATION_STAGES.has(stageOf(application)))
          return false;
      } catch {
        return false;
      }
      return sameLettingTarget(
        entities,
        unit.propertyId,
        unit.id,
        application.propertyId,
        metaText(application.meta, "unitId")
      );
    });
  });
}

export function requiredLettingDocuments(
  kind: ApplicantKind
): LettingDocumentKind[] {
  if (kind !== "individual" && kind !== "company")
    throw new Error("نوع مقدم الطلب غير صالح");
  return [...REQUIRED_DOCUMENTS[kind]];
}

/** Read-only newest-version template list for the letting decision UI. */
export function getLeaseTemplates(entities: EntityMap): DemoEntity[] {
  return listLeaseTemplates(entities);
}

function profileForEntities(
  entities: EntityMap,
  application: DemoEntity
): DemoEntity | undefined {
  const id = metaText(application.meta, "profileId");
  return entities.documents.find(
    row => row.id === id && row.meta.recordType === "letting-profile"
  );
}

function profileField(
  profile: DemoEntity | undefined,
  key: keyof LettingProfileInput
): string {
  return profile ? metaText(profile.meta, key) : "";
}

function profileMissing(
  application: DemoEntity,
  profile: DemoEntity | undefined
): string[] {
  const common: (keyof LettingProfileInput)[] = ["name", "email", "phone"];
  const individual: (keyof LettingProfileInput)[] = ["identityNumber"];
  const company: (keyof LettingProfileInput)[] = [
    "companyName",
    "companyNumber",
    "establishmentNumber",
    "companyAddress",
    "companyWebsite",
    "authorizedName",
  ];
  const wanted = [
    ...common,
    ...(applicantKindOf(application) === "company" ? company : individual),
  ];
  return wanted.filter(key => !profileField(profile, key));
}

function assertCompleteProfile(
  application: DemoEntity,
  profile: DemoEntity | undefined
): DemoEntity {
  if (!profile) throw new Error("ملف مقدم الطلب غير موجود");
  const missing = profileMissing(application, profile);
  if (missing.length)
    throw new Error("ملف مقدم الطلب غير مكتمل قبل المراجعة أو القرار");
  return profile;
}

function applicationAttachments(
  entities: EntityMap,
  applicationId: string
): DemoEntity[] {
  return entities.documents.filter(
    row =>
      isAttachment(row) && metaText(row.meta, "applicationId") === applicationId
  );
}

function missingDocumentKinds(
  entities: EntityMap,
  application: DemoEntity,
  required = requiredLettingDocuments(applicantKindOf(application))
): LettingDocumentKind[] {
  const attached = new Set(
    applicationAttachments(entities, application.id).map(
      row => metaText(row.meta, "kind") as LettingDocumentKind
    )
  );
  return required.filter(kind => !attached.has(kind));
}

function assertRequiredDocuments(
  entities: EntityMap,
  application: DemoEntity
): void {
  const missing = missingDocumentKinds(entities, application);
  if (missing.length)
    throw new Error("المستندات المطلوبة غير مكتملة قبل المراجعة أو القرار");
}

function appendAudit(
  state: PrototypeState,
  title: string,
  detail: string
): PrototypeState["audit"] {
  return [
    {
      id: newId("letting-audit"),
      at: new Date().toISOString(),
      title: title.slice(0, MAX_TITLE),
      detail: detail.slice(0, MAX_META_TEXT),
    },
    ...state.audit,
  ].slice(0, MAX_AUDIT);
}

function transition<T>(
  state: PrototypeState,
  entities: EntityMap,
  result: T,
  title: string,
  detail: string
): LettingTransition<T> {
  return {
    state: { ...state, entities, audit: appendAudit(state, title, detail) },
    result,
  };
}

function updateApplication(
  state: PrototypeState,
  application: DemoEntity,
  changes: Record<string, MetaValue>,
  status?: string
): DemoEntity {
  const meta = { ...application.meta, ...changes };
  assertMetadata(meta);
  const next: DemoEntity = {
    ...application,
    ...(status ? { status } : {}),
    meta,
  };
  return next;
}

function replaceApplication(
  entities: EntityMap,
  application: DemoEntity
): EntityMap {
  return {
    ...entities,
    applications: entities.applications.map(row =>
      row.id === application.id ? application : row
    ),
  };
}

function profileMeta(input: LettingProfileInput): Record<string, MetaValue> {
  return {
    name: optionalText(input.name, "الاسم", MAX_TITLE),
    email: optionalText(input.email, "البريد الإلكتروني", 320).toLowerCase(),
    phone: optionalText(input.phone, "رقم التواصل", 64),
    identityNumber: optionalText(input.identityNumber, "رقم الهوية", 128),
    companyName: optionalText(input.companyName, "اسم الشركة", MAX_TITLE),
    companyNumber: optionalText(input.companyNumber, "رقم السجل التجاري", 128),
    establishmentNumber: optionalText(
      input.establishmentNumber,
      "رقم قيد المنشأة",
      128
    ),
    companyAddress: optionalText(
      input.companyAddress,
      "عنوان الشركة",
      MAX_META_TEXT
    ),
    companyWebsite: optionalText(input.companyWebsite, "موقع الشركة", 512),
    authorizedName: optionalText(input.authorizedName, "اسم المفوض", MAX_TITLE),
  };
}

function validateProfile(
  kind: ApplicantKind,
  profile: Record<string, MetaValue>
): void {
  const name = requireText(profile.name, "اسم جهة الاتصال", MAX_TITLE);
  assertEmail(profile.email);
  assertPhone(profile.phone);
  if (kind === "individual") {
    requireText(profile.identityNumber, "رقم الهوية", 128);
    return;
  }
  requireText(profile.companyName, "اسم الشركة", MAX_TITLE);
  requireText(profile.companyNumber, "رقم السجل التجاري", 128);
  requireText(profile.establishmentNumber, "رقم قيد المنشأة", 128);
  requireText(profile.companyAddress, "عنوان الشركة", MAX_META_TEXT);
  requireText(profile.companyWebsite, "موقع الشركة", 512);
  requireText(profile.authorizedName, "اسم المفوض", MAX_TITLE);
}

function normalizeDescriptor(
  descriptor: PropertyMediaDescriptor,
  kind: LettingDocumentKind
): PropertyMediaDescriptor {
  if (!descriptor || typeof descriptor !== "object")
    throw new Error("وصف الملف المحلي غير صالح");
  const id = requireId(descriptor.id, "معرف الملف المحلي");
  const name = requireText(descriptor.name, "اسم الملف", MAX_TITLE);
  const mime = descriptor.mime;
  if (
    mime !== "image/jpeg" &&
    mime !== "image/png" &&
    mime !== "image/webp" &&
    mime !== "application/pdf"
  ) {
    throw new Error("صيغة الملف المحلي غير مدعومة");
  }
  if (kind === "handover-photo" && mime === "application/pdf")
    throw new Error("صور حالة العقار يجب أن تكون صورًا وليست ملف PDF");
  if (
    typeof descriptor.size !== "number" ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size <= 0 ||
    descriptor.size > MAX_FILE_BYTES
  ) {
    throw new Error("حجم الملف المحلي غير صالح أو يتجاوز 5 ميغابايت");
  }
  // PropertyMediaDescriptor intentionally has no hash field. The engine stores a
  // local descriptor only and makes no claim that the bytes or issuer were verified.
  return { id, name, mime, size: descriptor.size };
}

function assertAttachmentAllowed(
  stage: LettingStage,
  kind: LettingDocumentKind
): void {
  if (TERMINAL_STAGES.has(stage))
    throw new Error("لا يمكن تعديل طلب تأجير نهائي");
  if (kind === "signed-contract" || kind === "cheque-image") {
    if (stage !== "contract-issued")
      throw new Error("يرفع العقد الموقع وصورة الشيك بعد إصدار العقد فقط");
    return;
  }
  if (kind === "handover-photo") {
    if (stage !== "appointment-booked")
      throw new Error("ترفع صور حالة العقار بعد حجز الموعد فقط");
    return;
  }
  if (stage !== "documents-requested" && stage !== "review")
    throw new Error("لا يمكن تعديل مستندات التقييم بعد قرار الموظف");
}

function mailPreview(
  application: DemoEntity,
  to: string,
  mailType: string,
  body: string,
  additions: Record<string, MetaValue> = {}
): DemoEntity {
  const trimmedBody = body.trim();
  if (!trimmedBody || trimmedBody.length > MAX_META_TEXT)
    throw new Error("نص معاينة البريد غير صالح");
  const meta: Record<string, MetaValue> = {
    recordType: "letting-mail",
    applicationId: application.id,
    from: LETTING_TEST_EMAIL,
    to,
    mailType,
    delivery: "preview-only",
    body: trimmedBody,
    ...additions,
  };
  assertMetadata(meta);
  return {
    id: newId("letting-mail"),
    title: `معاينة بريد التأجير • ${mailType}`.slice(0, MAX_TITLE),
    subtitle: "معاينة محلية فقط · لا إرسال خارجي",
    portfolioId: application.portfolioId,
    propertyId: application.propertyId,
    status: "معاينة فقط",
    date: scenarioDate(application.date),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
}

function profileRecipient(
  entities: EntityMap,
  application: DemoEntity
): string {
  const profile = profileForEntities(entities, application);
  const email =
    profileField(profile, "email") || metaText(application.meta, "email");
  return assertEmail(email);
}

function documentEntity(
  application: DemoEntity,
  title: string,
  status: string,
  date: string,
  meta: Record<string, MetaValue>
): DemoEntity {
  assertMetadata(meta);
  return {
    id: newId("letting-document"),
    title: title.slice(0, MAX_TITLE),
    subtitle: "سجل محلي داخل نموذج التأجير",
    portfolioId: application.portfolioId,
    propertyId: application.propertyId,
    status,
    date,
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
}

function reviewForEntities(
  entities: EntityMap,
  application: DemoEntity
): DemoEntity | undefined {
  const id = metaText(application.meta, "reviewId");
  return entities.reviews.find(
    row => row.id === id && row.meta.recordType === "letting-review"
  );
}

function reviewNumber(review: DemoEntity, key: string): number | undefined {
  const value = review.meta[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function daysBetween(later: string, earlier: string): number {
  const start = Date.parse(`${earlier}T00:00:00.000Z`);
  const end = Date.parse(`${later}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000);
}

/**
 * Computes a transparent, non-demographic recommendation. Missing configuration
 * or unreviewed evidence always remains needs-review; no unknown value becomes 0.
 */
export function evaluateLettingRecommendation(
  entities: EntityMap,
  id: string
): LettingRecommendation {
  const application = applicationForEntities(
    entities,
    requireId(id, "طلب التأجير")
  );
  const missing: string[] = [];
  const reasons: string[] = [];
  const profile = profileForEntities(entities, application);
  const incompleteProfile = profileMissing(application, profile);
  if (incompleteProfile.length) missing.push("ملف مقدم الطلب");

  const absentDocuments = missingDocumentKinds(entities, application);
  if (absentDocuments.length) missing.push("المستندات المطلوبة");

  const review = reviewForEntities(entities, application);
  if (!review) {
    missing.push("مراجعة الموظف");
    return { outcome: "needs-review", reasons, missing };
  }

  if (review.meta.documentsReviewed !== true)
    missing.push("تأكيد مراجعة المستندات");
  if (review.meta.creditSourceReviewed !== true)
    missing.push("تأكيد مراجعة مصدر التقرير");
  if (!metaText(review.meta, "creditSource")) missing.push("مصدر تقرير الكردت");

  const minimumRentMinor = reviewNumber(review, "minimumRentMinor");
  if (minimumRentMinor === undefined) missing.push("حد الإيجار الأدنى المهيأ");

  const creditScore = reviewNumber(review, "creditScore");
  const scoreScaleMax = reviewNumber(review, "scoreScaleMax");
  const minimumCreditScore = reviewNumber(review, "minimumCreditScore");
  if (creditScore === undefined) missing.push("درجة الكردت");
  if (scoreScaleMax === undefined) missing.push("حد مقياس الدرجة");
  if (minimumCreditScore === undefined) missing.push("الحد الأدنى للدرجة");

  const reportDate = metaText(review.meta, "creditReportDate");
  const maximumReportAgeDays = reviewNumber(review, "maximumReportAgeDays");
  if (!reportDate) missing.push("تاريخ تقرير الكردت");
  if (maximumReportAgeDays === undefined)
    missing.push("الحد الأقصى لعمر التقرير");

  if (missing.length)
    return { outcome: "needs-review", reasons, missing, review };

  try {
    assertDate(reportDate, "تاريخ تقرير الكردت");
  } catch {
    return {
      outcome: "needs-review",
      reasons,
      missing: ["تاريخ تقرير الكردت الصحيح"],
      review,
    };
  }

  const asOf = scenarioDate(
    metaText(review.meta, "reviewScenarioDate") || application.date
  );
  if (reportDate > asOf)
    return {
      outcome: "needs-review",
      reasons,
      missing: ["تاريخ تقرير الكردت لا يمكن أن يكون في المستقبل"],
      review,
    };

  if (
    scoreScaleMax === undefined ||
    scoreScaleMax <= 0 ||
    creditScore === undefined ||
    creditScore > scoreScaleMax ||
    minimumCreditScore === undefined ||
    minimumCreditScore > scoreScaleMax
  ) {
    return {
      outcome: "needs-review",
      reasons,
      missing: ["مقياس وحدود درجة الكردت المتسقة"],
      review,
    };
  }

  if (
    minimumRentMinor !== undefined &&
    application.amountMinor < minimumRentMinor
  )
    reasons.push("العرض أقل من حد الإيجار الأدنى المهيأ");
  if (creditScore < minimumCreditScore)
    reasons.push("درجة الكردت أقل من الحد الأدنى المهيأ");
  if (
    maximumReportAgeDays !== undefined &&
    daysBetween(asOf, reportDate) > maximumReportAgeDays
  ) {
    reasons.push("تقرير الكردت تجاوز العمر المهيأ");
  }

  return {
    outcome: reasons.length ? "recommend-reject" : "recommend-approve",
    reasons,
    missing: [],
    review,
  };
}

function templateEndDate(
  startDate: string,
  termMonths: number
): string | undefined {
  if (termMonths === 0) return undefined;
  const [year, month, day] = startDate.split("-").map(Number);
  const targetMonth = month - 1 + termMonths;
  const targetYear = year + Math.floor(targetMonth / 12);
  const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0)
  ).getUTCDate();
  const anniversary = new Date(
    Date.UTC(targetYear, targetMonthIndex, Math.min(day, lastDay))
  );
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return anniversary.toISOString().slice(0, 10);
}

function renderTemplate(
  content: string,
  values: Record<"الاسم" | "رقم_العقار" | "رقم_الكهرباء" | "نوع_العقار", string>
): string {
  return content.replace(/\{\{([^{}]*)\}\}/g, (_token, key: string) => {
    return values[key as keyof typeof values] ?? `{{${key}}}`;
  });
}

function splitContractContent(
  parent: DemoEntity,
  content: string
): DemoEntity[] {
  const chunks: DemoEntity[] = [];
  for (let index = 0; index < content.length; index += MAX_META_TEXT) {
    const meta: Record<string, MetaValue> = {
      recordType: "letting-contract-chunk",
      parentId: parent.id,
      index: chunks.length,
      content: content.slice(index, index + MAX_META_TEXT),
    };
    assertMetadata(meta);
    chunks.push({
      id: newId("letting-contract-chunk"),
      title: `جزء ${chunks.length + 1} من ${parent.title}`.slice(0, MAX_TITLE),
      subtitle: "لقطة نصية محلية غير قابلة لإعادة التوليد",
      portfolioId: parent.portfolioId,
      propertyId: parent.propertyId,
      status: parent.status,
      date: parent.date,
      amountMinor: 0,
      currency: "QAR",
      meta,
    });
  }
  if (!chunks.length) throw new Error("لا يمكن حفظ عقد فارغ");
  return chunks;
}

function contractContent(
  application: DemoEntity,
  profile: DemoEntity,
  property: DemoEntity,
  unit: DemoEntity,
  propertyNumber: string,
  electricityNumber: string,
  templateContent: string,
  templateName: string,
  termsReviewReason: string
): string {
  const tenantName =
    applicantKindOf(application) === "company"
      ? profileField(profile, "companyName")
      : profileField(profile, "name");
  const propertyType = assetTypeLabel(assetTypeFromMeta(property.meta) ?? "");
  const startDate = metaText(application.meta, "startDate");
  const endDate = metaText(application.meta, "endDate");
  const durationDays =
    Math.floor(
      (new Date(`${endDate}T00:00:00Z`).getTime() -
        new Date(`${startDate}T00:00:00Z`).getTime()) /
        86_400_000
    ) + 1;
  const companyLines =
    applicantKindOf(application) === "company"
      ? [
          `اسم الشركة: ${profileField(profile, "companyName")}`,
          `رقم الشركة / السجل التجاري: ${profileField(profile, "companyNumber")}`,
          `رقم قيد المنشأة: ${profileField(profile, "establishmentNumber")}`,
          `المفوّض بالتوقيع: ${profileField(profile, "authorizedName")}`,
          `عنوان الشركة: ${profileField(profile, "companyAddress")}`,
          `موقع الشركة: ${profileField(profile, "companyWebsite") || "غير مدخل"}`,
        ]
      : [];
  const rendered = templateContent
    ? renderTemplate(templateContent, {
        الاسم: tenantName,
        رقم_العقار: propertyNumber,
        رقم_الكهرباء: electricityNumber,
        نوع_العقار: propertyType,
      })
    : "لا يوجد قالب مختار. هذه مسودة محاكاة فقط وليست عقدًا قانونيًا معتمدًا.";
  const content = [
    "مسودة عقد تأجير محلية · غير معتمدة قانونيًا",
    "لا تمثل هذه اللقطة توقيعًا أو تسجيلًا أو تحققًا من الهوية أو من مصدر التقرير.",
    "",
    "بيانات الأطراف والعقار",
    `المستأجر: ${tenantName}`,
    `نوع مقدم الطلب: ${applicantKindOf(application) === "company" ? "شركة" : "فرد"}`,
    `اسم مقدم الطلب / جهة التواصل: ${profileField(profile, "name")}`,
    `رقم البطاقة وفق البيانات المدخلة: ${profileField(profile, "identityNumber")}`,
    `رقم التواصل: ${profileField(profile, "phone")}`,
    `البريد الإلكتروني: ${profileField(profile, "email")}`,
    ...companyLines,
    `العقار: ${property.title}`,
    `الهدف: ${unit.title}`,
    `نوع العقار: ${propertyType}`,
    `رقم العقار: ${propertyNumber}`,
    `رقم الكهرباء: ${electricityNumber}`,
    `تاريخ البداية: ${metaText(application.meta, "startDate")}`,
    `تاريخ النهاية: ${metaText(application.meta, "endDate")}`,
    `مدة العقد: ${durationDays} يومًا، شاملة تاريخي البداية والنهاية`,
    `قيمة الإيجار المعتمدة: ${moneyText(application.amountMinor)} ر.ق`,
    "",
    `مصدر النص: ${templateName || "قالب محاكاة افتراضي"}`,
    "--- نص القالب المحفوظ ---",
    rendered,
    "--- ملحق الشروط والمراجعة البشرية ---",
    "يُحفظ نص القالب أعلاه بما فيه من شروط غير معروفة دون تفسير أو ادعاء اعتماد قانوني.",
    "يلزم تحقق بشري مستقل من الشروط والأطراف قبل أي استخدام خارج النموذج.",
    termsReviewReason
      ? `إقرار مراجعة الموظف: ${termsReviewReason}`
      : "لا يوجد إقرار بشري مسجل لشروط القالب.",
  ].join("\n");
  if (content.length > MAX_CONTRACT_TEXT)
    throw new Error("لقطة العقد النصية تتجاوز الحد المسموح");
  return content;
}

function contentFromContractChunks(
  entities: EntityMap,
  document: DemoEntity
): string {
  const chunks = entities.documents
    .filter(
      row =>
        row.meta.recordType === "letting-contract-chunk" &&
        metaText(row.meta, "parentId") === document.id
    )
    .map(row => ({ index: row.meta.index, content: row.meta.content }));
  if (!chunks.length) throw new Error("أجزاء لقطة العقد غير موجودة");
  const ordered = chunks
    .map(chunk => {
      if (
        typeof chunk.index !== "number" ||
        !Number.isSafeInteger(chunk.index) ||
        chunk.index < 0 ||
        typeof chunk.content !== "string" ||
        chunk.content.length > MAX_META_TEXT
      ) {
        throw new Error("أجزاء لقطة العقد غير صالحة");
      }
      return { index: chunk.index, content: chunk.content };
    })
    .sort((left, right) => left.index - right.index);
  if (ordered.some((chunk, index) => chunk.index !== index))
    throw new Error("أجزاء لقطة العقد غير مكتملة");
  const content = ordered.map(chunk => chunk.content).join("");
  if (!content || content.length > MAX_CONTRACT_TEXT)
    throw new Error("محتوى لقطة العقد غير صالح");
  return content;
}

export function getLettingCase(
  entities: EntityMap,
  id: string
): LettingCaseView {
  const application = applicationForEntities(
    entities,
    requireId(id, "طلب التأجير")
  );
  const profile = profileForEntities(entities, application);
  const review = reviewForEntities(entities, application);
  const leaseId = metaText(application.meta, "leaseId");
  const lease = entities.leases.find(row => row.id === leaseId);
  const slotId = metaText(application.meta, "slotId");
  const slot = entities.tasks.find(
    row => row.id === slotId && row.meta.recordType === "letting-slot"
  );
  return {
    application,
    profile,
    stage: stageOf(application),
    documents: entities.documents.filter(
      row =>
        metaText(row.meta, "applicationId") === application.id &&
        ["letting-attachment", "letting-handover", "letting-contract"].includes(
          metaText(row.meta, "recordType")
        )
    ),
    emails: entities.notifications.filter(
      row =>
        row.meta.recordType === "letting-mail" &&
        metaText(row.meta, "applicationId") === application.id
    ),
    review,
    lease,
    slot,
    cheques: entities.documents.filter(
      row =>
        row.meta.recordType === "letting-cheque" &&
        metaText(row.meta, "applicationId") === application.id
    ),
  };
}

export function getLettingContract(
  entities: EntityMap,
  applicationId: string
): LettingContractView | undefined {
  const application = applicationForEntities(
    entities,
    requireId(applicationId, "طلب التأجير")
  );
  const documentId = metaText(application.meta, "contractDocumentId");
  const leaseId = metaText(application.meta, "leaseId");
  if (!documentId && !leaseId) return undefined;
  const document = entities.documents.find(
    row => row.id === documentId && row.meta.recordType === "letting-contract"
  );
  const lease = entities.leases.find(row => row.id === leaseId);
  if (!document || !lease) return undefined;
  if (
    metaText(document.meta, "applicationId") !== application.id ||
    metaText(document.meta, "leaseId") !== lease.id
  ) {
    throw new Error("لقطة العقد لا تطابق طلب التأجير أو مسودة العقد");
  }
  return {
    document,
    lease,
    content: contentFromContractChunks(entities, document),
  };
}

export function createLettingApplication(
  state: PrototypeState,
  input: LettingIntakeInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات طلب التأجير غير صالحة");
  const requestId = requireId(input.requestId, "معرف إنشاء الطلب");
  const messageId = requireId(input.messageId, "معرف رسالة الطلب");
  if (input.applicantKind !== "individual" && input.applicantKind !== "company")
    throw new Error("نوع مقدم الطلب غير صالح");
  const property = propertyFor(state, requireId(input.propertyId, "العقار"));
  const unitId = requireId(input.unitId, "وحدة التأجير");
  const unit = state.entities.units.find(row => row.id === unitId);
  if (
    !unit ||
    unit.propertyId !== property.id ||
    unit.portfolioId !== property.portfolioId ||
    !isRentalLettingTarget(state.entities, unit)
  ) {
    throw new Error(
      "وحدة التأجير المختارة لا تتبع العقار أو لا تمثل هدفًا صالحًا"
    );
  }
  const name = requireText(input.name, "اسم مقدم الطلب", MAX_TITLE);
  const email = assertEmail(input.email);
  const phone = assertPhone(input.phone);
  const offerMinor = assertPositiveMinor(input.offerMinor, "قيمة العرض");
  const startDate = assertDate(input.startDate, "تاريخ البداية");
  const endDate = assertDate(input.endDate, "تاريخ النهاية");
  assertDateRange(startDate, endDate);
  const asOf = scenarioDate(state);
  if (startDate < asOf)
    throw new Error("تاريخ بداية طلب التأجير لا يمكن أن يسبق تاريخ السيناريو");
  const message = optionalText(input.message, "رسالة الطلب", MAX_META_TEXT);
  const requestFingerprint = fingerprint({
    applicantKind: input.applicantKind,
    propertyId: property.id,
    unitId,
    name,
    email,
    phone,
    offerMinor,
    startDate,
    endDate,
    message,
    messageId,
  });
  const previous = state.entities.applications.find(
    row =>
      isApplication(row) &&
      (metaText(row.meta, "intakeRequestId") === requestId ||
        metaText(row.meta, "messageId") === messageId)
  );
  if (previous) {
    if (metaText(previous.meta, "intakeFingerprint") !== requestFingerprint)
      throw new Error("سبق تنفيذ معرف الطلب أو الرسالة ببيانات مختلفة");
    assertScope(state, previous);
    return { state, result: previous };
  }

  const available = listAvailableLettingTargets(state.entities, asOf);
  if (!available.some(row => row.id === unit.id))
    throw new Error(
      "الوحدة المختارة ليست شاغرة ومتاحة للتأجير في تاريخ السيناريو"
    );
  assertReservationFree(
    state.entities,
    property.id,
    unit.id,
    startDate,
    endDate
  );
  assertCapacity(state, "applications");
  assertCapacity(state, "documents");
  assertCapacity(state, "notifications");

  const profile = documentEntity(
    {
      id: "pending",
      title: "",
      subtitle: "",
      portfolioId: property.portfolioId,
      propertyId: property.id,
      status: "",
      date: asOf,
      amountMinor: 0,
      currency: "QAR",
      meta: {},
    },
    `ملف مقدم طلب ${name}`,
    "غير مكتمل",
    asOf,
    {
      recordType: "letting-profile",
      applicationId: "pending",
      applicantKind: input.applicantKind,
      ...profileMeta({
        name,
        email,
        phone,
        identityNumber: "",
        companyName: "",
        companyNumber: "",
        establishmentNumber: "",
        companyAddress: "",
        companyWebsite: "",
        authorizedName: "",
      }),
    }
  );
  const applicationMeta: Record<string, MetaValue> = {
    recordType: "letting-application",
    stage: "documents-requested",
    unitId: unit.id,
    applicantKind: input.applicantKind,
    profileId: profile.id,
    leaseId: "",
    contractDocumentId: "",
    reviewId: "",
    slotId: "",
    startDate,
    endDate,
    email,
    name,
    phone,
    source: "طلب تأجير محلي",
    messageId,
    intakeRequestId: requestId,
    intakeFingerprint: requestFingerprint,
  };
  assertMetadata(applicationMeta);
  const application: DemoEntity = {
    id: newId("letting-application"),
    title: `طلب تأجير • ${property.title}`.slice(0, MAX_TITLE),
    subtitle: name,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "بانتظار المستندات",
    date: startDate,
    amountMinor: offerMinor,
    currency: "QAR",
    meta: applicationMeta,
  };
  const fixedProfile: DemoEntity = {
    ...profile,
    meta: { ...profile.meta, applicationId: application.id },
  };
  assertMetadata(fixedProfile.meta);
  const docs = requiredLettingDocuments(input.applicantKind)
    .map(kind => {
      const label =
        kind === "identity"
          ? "البطاقة الشخصية"
          : kind === "credit"
            ? "تقرير الكردت"
            : kind === "commercial"
              ? "السجل التجاري"
              : "قيد المنشأة";
      return label;
    })
    .join("، ");
  const preview = mailPreview(
    application,
    email,
    "documents-requested",
    `مرحبًا ${name}، هذه معاينة محلية فقط لطلب مستندات التأجير: ${docs}. لا يوجد إرسال بريد فعلي أو تحقق من المستندات.`,
    { eventKey: `intake:${requestId}` }
  );
  const entities: EntityMap = {
    ...state.entities,
    applications: [...state.entities.applications, application],
    documents: [...state.entities.documents, fixedProfile],
    notifications: [...state.entities.notifications, preview],
  };
  return transition(
    state,
    entities,
    application,
    "إنشاء طلب تأجير",
    "أنشئ طلبًا محليًا ومطالبة مستندات بمعاينة بريد فقط؛ لا حجز أو عقد أو تحصيل."
  );
}

export function updateLettingProfile(
  state: PrototypeState,
  id: string,
  input: LettingProfileInput
): LettingTransition<DemoEntity> {
  assertState(state);
  const application = applicationFor(state, id);
  const stage = stageOf(application);
  if (stage !== "documents-requested" && stage !== "review")
    throw new Error("ملف مقدم الطلب مقفل بعد قرار الموظف");
  if (!input || typeof input !== "object")
    throw new Error("بيانات الملف غير صالحة");
  const profile = profileForEntities(state.entities, application);
  if (!profile) throw new Error("ملف مقدم الطلب غير موجود");
  const fields = profileMeta(input);
  validateProfile(applicantKindOf(application), fields);
  const meta: Record<string, MetaValue> = {
    ...profile.meta,
    ...fields,
  };
  assertMetadata(meta);
  const title =
    applicantKindOf(application) === "company"
      ? requireText(fields.companyName, "اسم الشركة", MAX_TITLE)
      : requireText(fields.name, "اسم مقدم الطلب", MAX_TITLE);
  const nextProfile: DemoEntity = {
    ...profile,
    title,
    status: "مكتمل",
    meta,
  };
  if (
    nextProfile.title === profile.title &&
    nextProfile.status === profile.status &&
    JSON.stringify(nextProfile.meta) === JSON.stringify(profile.meta)
  ) {
    return { state, result: profile };
  }
  const entities: EntityMap = {
    ...state.entities,
    documents: state.entities.documents.map(row =>
      row.id === profile.id ? nextProfile : row
    ),
  };
  return transition(
    state,
    entities,
    nextProfile,
    "تحديث ملف مقدم الطلب",
    "حُفظ الملف محليًا؛ لا يتحقق النموذج من الهوية أو بيانات الشركة."
  );
}

export function attachLettingDocument(
  state: PrototypeState,
  input: LettingDocumentInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات المرفق غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف رفع المرفق");
  const kind = input.kind;
  if (
    !REQUIRED_DOCUMENTS.company
      .concat([
        "signed-contract",
        "cheque-image",
        "handover-photo",
      ] as LettingDocumentKind[])
      .includes(kind)
  )
    throw new Error("نوع المرفق غير صالح");
  assertAttachmentAllowed(stageOf(application), kind);
  const descriptor = normalizeDescriptor(input.descriptor, kind);
  const mediaKind = kind === "handover-photo" ? "photo" : "plan";
  const manifest = JSON.stringify(
    mediaKind === "photo"
      ? { v: 1, photo: descriptor }
      : { v: 1, plan: descriptor }
  );
  const requestFingerprint = fingerprint({ kind, descriptor, mediaKind });
  const previous = state.entities.documents.find(
    row =>
      isAttachment(row) &&
      metaText(row.meta, "applicationId") === application.id &&
      metaText(row.meta, "attachmentRequestId") === requestId
  );
  if (previous) {
    if (metaText(previous.meta, "attachmentFingerprint") !== requestFingerprint)
      throw new Error("سبق استخدام معرف رفع المرفق ببيانات مختلفة");
    return { state, result: previous };
  }
  assertCapacity(state, "documents");
  const attachment = documentEntity(
    application,
    `مرفق تأجير • ${kind}`,
    "محفوظ محليًا",
    scenarioDate(state),
    {
      recordType: "letting-attachment",
      applicationId: application.id,
      kind,
      mediaKind,
      fileManifest: manifest,
      attachmentRequestId: requestId,
      attachmentFingerprint: requestFingerprint,
      source: "وصف ملف محلي؛ لا تحقق من المحتوى أو المصدر",
      ...(kind === "handover-photo"
        ? { submittedBy: "tenant-simulation" }
        : {}),
    }
  );
  const entities: EntityMap = {
    ...state.entities,
    documents: [...state.entities.documents, attachment],
  };
  return transition(
    state,
    entities,
    attachment,
    "حفظ مرفق تأجير",
    "حُفظ وصف ملف محلي فقط؛ لا OCR ولا تحقق من هوية أو مصدر أو محتوى الملف."
  );
}

export function reviewLettingApplication(
  state: PrototypeState,
  input: LettingReviewInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات المراجعة غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const stage = stageOf(application);
  if (stage !== "documents-requested" && stage !== "review")
    throw new Error("لا يمكن مراجعة طلب بعد القرار أو الإكمال");
  const requestId = requireId(input.requestId, "معرف المراجعة");
  assertCompleteProfile(
    application,
    profileForEntities(state.entities, application)
  );
  assertRequiredDocuments(state.entities, application);

  const minimumRentMinor = assertOptionalNonNegativeInt(
    input.minimumRentMinor,
    "حد الإيجار الأدنى"
  );
  const minimumCreditScore = assertOptionalNonNegativeInt(
    input.minimumCreditScore,
    "الحد الأدنى للدرجة"
  );
  const creditScore = assertOptionalNonNegativeInt(
    input.creditScore,
    "درجة الكردت"
  );
  const scoreScaleMax = assertOptionalNonNegativeInt(
    input.scoreScaleMax,
    "حد مقياس الدرجة"
  );
  const maximumReportAgeDays = assertOptionalNonNegativeInt(
    input.maximumReportAgeDays,
    "العمر الأقصى للتقرير",
    MAX_REPORT_AGE_DAYS
  );
  const creditReportDate = optionalDate(
    input.creditReportDate,
    "تاريخ تقرير الكردت"
  );
  const creditSource = optionalText(
    input.creditSource,
    "مصدر تقرير الكردت",
    256
  );
  if (creditReportDate && creditReportDate > scenarioDate(state))
    throw new Error("تاريخ تقرير الكردت لا يمكن أن يكون في المستقبل");
  if (scoreScaleMax !== undefined && scoreScaleMax === 0) {
    throw new Error("حد مقياس الدرجة يجب أن يكون موجبًا عند إدخاله");
  }
  if (
    creditScore !== undefined &&
    scoreScaleMax !== undefined &&
    creditScore > scoreScaleMax
  ) {
    throw new Error("درجة الكردت تتجاوز حد المقياس");
  }
  if (
    minimumCreditScore !== undefined &&
    scoreScaleMax !== undefined &&
    minimumCreditScore > scoreScaleMax
  ) {
    throw new Error("الحد الأدنى للدرجة يتجاوز حد المقياس");
  }
  const requestFingerprint = fingerprint({
    minimumRentMinor,
    minimumCreditScore,
    creditScore,
    scoreScaleMax,
    creditReportDate,
    creditSourceReviewed: input.creditSourceReviewed === true,
    creditSource,
    documentsReviewed: input.documentsReviewed === true,
    maximumReportAgeDays,
  });
  const previous = state.entities.reviews.find(
    row =>
      row.meta.recordType === "letting-review" &&
      metaText(row.meta, "applicationId") === application.id &&
      metaText(row.meta, "reviewRequestId") === requestId
  );
  if (previous) {
    if (metaText(previous.meta, "reviewFingerprint") !== requestFingerprint)
      throw new Error("سبق استخدام معرف المراجعة ببيانات مختلفة");
    return { state, result: previous };
  }
  assertCapacity(state, "reviews");
  const reviewMeta: Record<string, MetaValue> = {
    recordType: "letting-review",
    applicationId: application.id,
    reviewRequestId: requestId,
    reviewFingerprint: requestFingerprint,
    label: "مراجعة موظف محلية؛ لا تحقق ائتماني رسمي أو OCR",
    documentsReviewed: input.documentsReviewed === true,
    creditSourceReviewed: input.creditSourceReviewed === true,
    creditSource,
    creditReportDate,
    reviewScenarioDate: scenarioDate(state),
  };
  if (minimumRentMinor !== undefined)
    reviewMeta.minimumRentMinor = minimumRentMinor;
  if (minimumCreditScore !== undefined)
    reviewMeta.minimumCreditScore = minimumCreditScore;
  if (creditScore !== undefined) reviewMeta.creditScore = creditScore;
  if (scoreScaleMax !== undefined) reviewMeta.scoreScaleMax = scoreScaleMax;
  if (maximumReportAgeDays !== undefined)
    reviewMeta.maximumReportAgeDays = maximumReportAgeDays;
  assertMetadata(reviewMeta);
  const review: DemoEntity = {
    id: newId("letting-review"),
    title: `مراجعة طلب ${application.title}`.slice(0, MAX_TITLE),
    subtitle: "مؤشرات داخلية معلقة وليست سجلًا ائتمانيًا رسميًا",
    portfolioId: application.portfolioId,
    propertyId: application.propertyId,
    status: "قيد المراجعة",
    date: scenarioDate(state),
    amountMinor: 0,
    currency: "QAR",
    meta: reviewMeta,
  };
  const nextApplication = updateApplication(
    state,
    application,
    { stage: "review", reviewId: review.id },
    "قيد المراجعة"
  );
  const entities = replaceApplication(
    {
      ...state.entities,
      reviews: [...state.entities.reviews, review],
    },
    nextApplication
  );
  return transition(
    state,
    entities,
    review,
    "تسجيل مراجعة تأجير",
    "سُجلت مؤشرات المراجعة محليًا؛ النواقص تبقى قيد مراجعة ولا تصبح صفرًا أو تحققًا رسميًا."
  );
}

export function decideLettingApplication(
  state: PrototypeState,
  input: LettingDecisionInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات القرار غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف قرار الموظف");
  if (input.decision !== "approve" && input.decision !== "reject")
    throw new Error("قرار الموظف غير صالح");
  const reason = optionalText(input.reason, "سبب القرار", MAX_META_TEXT);
  const propertyNumber = optionalText(
    input.propertyNumber,
    "رقم العقار",
    MAX_META_TEXT
  );
  const electricityNumber = optionalText(
    input.electricityNumber,
    "رقم الكهرباء",
    MAX_META_TEXT
  );
  const templateId = optionalText(input.templateId, "قالب العقد", MAX_ID);
  const decisionFingerprint = fingerprint({
    decision: input.decision,
    reason,
    propertyNumber,
    electricityNumber,
    templateId,
  });
  const priorRequest = metaText(application.meta, "decisionRequestId");
  if (priorRequest === requestId) {
    if (
      metaText(application.meta, "decisionFingerprint") !== decisionFingerprint
    )
      throw new Error("سبق استخدام معرف القرار ببيانات مختلفة");
    return { state, result: application };
  }
  if (stageOf(application) !== "review")
    throw new Error("قرار الموظف متاح لطلب في مرحلة المراجعة فقط");

  if (input.decision === "reject") {
    if (!reason) throw new Error("سبب الرفض مطلوب");
    const rejected = updateApplication(
      state,
      application,
      {
        stage: "rejected",
        decisionRequestId: requestId,
        decisionFingerprint,
      },
      "مرفوض"
    );
    const entities = replaceApplication(state.entities, rejected);
    return transition(
      state,
      entities,
      rejected,
      "رفض طلب تأجير",
      `رفض نهائي بقرار الموظف: ${reason}`
    );
  }

  const profile = assertCompleteProfile(
    application,
    profileForEntities(state.entities, application)
  );
  assertRequiredDocuments(state.entities, application);
  const recommendation = evaluateLettingRecommendation(
    state.entities,
    application.id
  );
  if (recommendation.outcome === "needs-review")
    throw new Error("لا يمكن الموافقة قبل استكمال عناصر المراجعة المطلوبة");
  if (recommendation.outcome === "recommend-reject" && !reason)
    throw new Error("سبب تجاوز توصية الرفض مطلوب لموافقة الموظف");
  if (!propertyNumber || !electricityNumber)
    throw new Error("رقم العقار ورقم الكهرباء مطلوبان لإصدار مسودة العقد");

  const unitId = metaText(application.meta, "unitId");
  const unit = state.entities.units.find(row => row.id === unitId);
  const property = propertyFor(state, application.propertyId);
  if (
    !unit ||
    unit.propertyId !== property.id ||
    unit.portfolioId !== property.portfolioId ||
    !validLettingUnit(state.entities, unit)
  ) {
    throw new Error("هدف التأجير لم يعد صالحًا للعقار");
  }
  assertReservationFree(
    state.entities,
    property.id,
    unit.id,
    metaText(application.meta, "startDate"),
    metaText(application.meta, "endDate"),
    application.id
  );

  let templateContent = "";
  let templateName = "";
  let templateVersion = 0;
  if (templateId) {
    const template = getLeaseTemplateView(state.entities, templateId);
    if (
      template.template.portfolioId &&
      template.template.portfolioId !== property.portfolioId
    )
      throw new Error("قالب العقد خارج محفظة العقار");
    if (template.defaultRentMinor !== application.amountMinor)
      throw new Error(
        "إيجار القالب لا يطابق العرض المعتمد؛ حدّث القالب أو اختر قالبًا متسقًا"
      );
    const fixedEnd = templateEndDate(
      metaText(application.meta, "startDate"),
      template.defaultTermMonths
    );
    if (fixedEnd && fixedEnd !== metaText(application.meta, "endDate"))
      throw new Error(
        "مدة القالب لا تطابق فترة العرض؛ حدّث القالب أو اختر قالبًا متسقًا"
      );
    if (!reason)
      throw new Error("سجل سبب مراجعة بشرية صريحة لشروط القالب قبل الموافقة");
    templateContent = template.content;
    templateName = template.name;
    templateVersion = template.version;
  }

  assertCapacity(state, "documents", 2); // contract root plus at least one chunk
  assertCapacity(state, "notifications");
  const tenantName =
    applicantKindOf(application) === "company"
      ? profileField(profile, "companyName")
      : profileField(profile, "name");
  const draft = createLease(state, {
    requestId: `letting-lease-${hash(application.id)}-${hash(requestId)}`,
    title: `مسودة تأجير ${property.title}`.slice(0, MAX_TITLE),
    propertyId: property.id,
    unitId: unit.id,
    tenantName,
    startDate: metaText(application.meta, "startDate"),
    endDate: metaText(application.meta, "endDate"),
    rent: moneyText(application.amountMinor),
  });
  const lease = draft.result;
  if (lease.amountMinor !== application.amountMinor)
    throw new Error("قيمة مسودة العقد لا تطابق العرض المعتمد");
  const tenantId = metaText(lease.meta, "tenantId");
  const content = contractContent(
    application,
    profile,
    property,
    unit,
    propertyNumber,
    electricityNumber,
    templateContent,
    templateName,
    reason
  );
  const contract = documentEntity(
    application,
    `لقطة عقد تأجير • ${property.title}`,
    "مسودة للمراجعة البشرية",
    scenarioDate(state),
    {
      recordType: "letting-contract",
      applicationId: application.id,
      leaseId: lease.id,
      templateSource: templateId ? "existing-template" : "simulation-default",
      templateId,
      templateVersion,
      templateName: templateName || "قالب محاكاة افتراضي غير معتمد",
      propertyNumber,
      electricityNumber,
      startDate: metaText(application.meta, "startDate"),
      endDate: metaText(application.meta, "endDate"),
      offerMinor: application.amountMinor,
      termsReviewRequired: true,
      termsReviewReason: reason,
    }
  );
  const chunks = splitContractContent(contract, content);
  if (
    draft.state.entities.documents.length + 1 + chunks.length >
    MAX_ENTITIES_PER_KIND
  )
    throw new Error("إصدار لقطة العقد يتجاوز سعة المستندات");

  const updatedTenant = draft.state.entities.tenants.map(row => {
    if (row.id !== tenantId) return row;
    const meta: Record<string, MetaValue> = {
      ...row.meta,
      recordType: "letting-tenant",
      applicationId: application.id,
      profileId: profile.id,
      applicantKind: applicantKindOf(application),
    };
    assertMetadata(meta);
    return { ...row, meta };
  });
  const updatedLease = draft.state.entities.leases.map(row => {
    if (row.id !== lease.id) return row;
    const meta: Record<string, MetaValue> = {
      ...row.meta,
      applicationId: application.id,
      tenantProfileId: profile.id,
      contractDocumentId: contract.id,
      contractSource: templateId ? "existing-template" : "simulation-default",
    };
    assertMetadata(meta);
    return { ...row, amountMinor: application.amountMinor, meta };
  });
  const approved = updateApplication(
    draft.state,
    application,
    {
      stage: "contract-issued",
      leaseId: lease.id,
      contractDocumentId: contract.id,
      decisionRequestId: requestId,
      decisionFingerprint,
    },
    "عقد بانتظار التوقيع"
  );
  const withApplication = replaceApplication(
    {
      ...draft.state.entities,
      tenants: updatedTenant,
      leases: updatedLease,
      documents: [...draft.state.entities.documents, contract, ...chunks],
    },
    approved
  );
  const preview = mailPreview(
    approved,
    profileRecipient(withApplication, approved),
    "contract-issued",
    `هذه معاينة محلية فقط لمسودة عقد التأجير للعقار ${property.title}. يلزم رفع العقد الموقع وصور الشيكات قبل التسليم. المرفق: ${contract.id}`,
    {
      attachmentId: contract.id,
      contractDocumentId: contract.id,
      eventKey: `decision:${requestId}`,
    }
  );
  const entities: EntityMap = {
    ...withApplication,
    notifications: [...withApplication.notifications, preview],
  };
  return transition(
    draft.state,
    entities,
    approved,
    "موافقة موظف وإصدار مسودة عقد",
    templateId
      ? "أصدر الموظف مسودة مرتبطة بلقطة قالب وشروط تتطلب مراجعة بشرية؛ لا تفعيل أو ذمم أو قبض."
      : "أصدر الموظف مسودة محاكاة غير معتمدة قانونيًا؛ لا تفعيل أو ذمم أو قبض."
  );
}

function monthlyDueDates(startDate: string, endDate: string): string[] {
  const [year, month, day] = startDate.split("-").map(Number);
  const dates: string[] = [];
  for (let offset = 0; offset <= 1440; offset += 1) {
    const targetMonth = month - 1 + offset;
    const targetYear = year + Math.floor(targetMonth / 12);
    const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(
      Date.UTC(targetYear, targetMonthIndex + 1, 0)
    ).getUTCDate();
    const date = new Date(
      Date.UTC(targetYear, targetMonthIndex, Math.min(day, lastDay))
    )
      .toISOString()
      .slice(0, 10);
    if (date > endDate) break;
    dates.push(date);
  }
  if (!dates.length) throw new Error("تعذر اشتقاق مواعيد استحقاق العقد");
  return dates;
}

function normalizeCheque(
  cheque: LettingChequeInput,
  allowedDueDates: Set<string>
): LettingChequeInput {
  if (!cheque || typeof cheque !== "object")
    throw new Error("بيانات الشيك غير صالحة");
  const number = requireText(cheque.number, "رقم الشيك", 128);
  const bank = requireText(cheque.bank, "اسم البنك", MAX_TITLE);
  const amountMinor = assertPositiveMinor(cheque.amountMinor, "مبلغ الشيك");
  const dueDate = assertDate(cheque.dueDate, "تاريخ استحقاق الشيك");
  if (!allowedDueDates.has(dueDate))
    throw new Error("تاريخ الشيك يجب أن يطابق تاريخ استحقاق من جدول العقد");
  return { number, bank, amountMinor, dueDate };
}

function chequeKey(bank: string, number: string): string {
  return `${bank.trim().toLocaleLowerCase("ar")}\u0000${number.trim().toLocaleLowerCase("ar")}`;
}

function storedChequeKeys(entities: EntityMap): Set<string> {
  const keys = new Set<string>();
  for (const document of entities.documents) {
    if (document.meta.recordType !== "letting-cheque") continue;
    const bank = metaText(document.meta, "bank");
    const number = metaText(document.meta, "number");
    if (bank && number) keys.add(chequeKey(bank, number));
  }
  for (const collection of entities.collections) {
    const bank = metaText(collection.meta, "chequeBank");
    const number = metaText(collection.meta, "chequeNumber");
    if (bank && number) keys.add(chequeKey(bank, number));
  }
  return keys;
}

export function submitLettingReturns(
  state: PrototypeState,
  input: LettingReturnsInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات المرتجعات غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف استلام الشيكات");
  const chequeFingerprint = fingerprint(input.cheques);
  const priorCheques = state.entities.documents.filter(
    row =>
      row.meta.recordType === "letting-cheque" &&
      metaText(row.meta, "applicationId") === application.id &&
      metaText(row.meta, "returnsRequestId") === requestId
  );
  if (priorCheques.length) {
    if (
      metaText(priorCheques[0].meta, "returnsFingerprint") !== chequeFingerprint
    )
      throw new Error("سبق استخدام معرف استلام الشيكات ببيانات مختلفة");
    return { state, result: application };
  }
  if (stageOf(application) !== "contract-issued")
    throw new Error("تسجيل العقد والشيكات متاح بعد إصدار العقد فقط");
  const attachments = applicationAttachments(state.entities, application.id);
  if (
    !attachments.some(row => metaText(row.meta, "kind") === "signed-contract")
  )
    throw new Error("ارفع العقد الموقع قبل تسجيل الشيكات");
  if (!attachments.some(row => metaText(row.meta, "kind") === "cheque-image"))
    throw new Error("ارفع صورة شيك واحدة على الأقل قبل تسجيل الشيكات");
  if (!Array.isArray(input.cheques) || !input.cheques.length)
    throw new Error("أدخل شيكًا واحدًا صالحًا على الأقل");
  if (input.cheques.length > MAX_CHEQUES)
    throw new Error("يتجاوز الإدخال حد 120 شيكًا");
  const lease = state.entities.leases.find(
    row => row.id === metaText(application.meta, "leaseId")
  );
  if (!lease) throw new Error("مسودة العقد المرتبطة بالطلب غير موجودة");
  const allowedDueDates = new Set(
    monthlyDueDates(
      metaText(application.meta, "startDate"),
      metaText(application.meta, "endDate")
    )
  );
  const cheques = input.cheques.map(row =>
    normalizeCheque(row, allowedDueDates)
  );
  const existingKeys = storedChequeKeys(state.entities);
  const inputKeys = new Set<string>();
  const totals = new Map<string, number>();
  for (const cheque of cheques) {
    const key = chequeKey(cheque.bank, cheque.number);
    if (existingKeys.has(key) || inputKeys.has(key))
      throw new Error("رقم الشيك والبنك مكرران ولا يمكن تسجيلهما مرتين");
    inputKeys.add(key);
    const nextTotal = (totals.get(cheque.dueDate) ?? 0) + cheque.amountMinor;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > lease.amountMinor)
      throw new Error("مجموع الشيكات يتجاوز رصيد الاستحقاق المطابق");
    totals.set(cheque.dueDate, nextTotal);
  }
  assertCapacity(state, "documents", cheques.length);
  const chequeDocuments = cheques.map(cheque =>
    documentEntity(
      application,
      `شيك ${cheque.number}`,
      "مستلم بانتظار التأكيد",
      cheque.dueDate,
      {
        recordType: "letting-cheque",
        applicationId: application.id,
        leaseId: lease.id,
        number: cheque.number,
        bank: cheque.bank,
        dueDate: cheque.dueDate,
        amountMinor: cheque.amountMinor,
        returnsRequestId: requestId,
        returnsFingerprint: chequeFingerprint,
        source: "سجل شيك محلي قبل التفعيل؛ ليس قبضًا نقديًا",
      }
    )
  );
  const nextApplication = updateApplication(
    state,
    application,
    { stage: "returns-received" },
    "بانتظار الموعد"
  );
  const entities = replaceApplication(
    {
      ...state.entities,
      documents: [...state.entities.documents, ...chequeDocuments],
    },
    nextApplication
  );
  return transition(
    state,
    entities,
    nextApplication,
    "تسجيل شيكات محلية",
    "سُجلت الشيكات كمستندات قبل التفعيل؛ لا قبض نقدي ولا تحصيل مؤكد في هذه المرحلة."
  );
}

function assertQatarIso(value: unknown, label: string): string {
  const result = requireText(value, label, 40);
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+03:00$/.exec(result);
  if (!match) throw new Error(`${label} يجب أن يكون بتوقيت قطر +03:00`);
  assertDate(match[1], label);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? "0");
  if (hour > 23 || minute > 59 || second > 59)
    throw new Error(`${label} غير صحيح`);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${label} غير صحيح`);
  return result;
}

function slotOverlaps(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  return (
    Date.parse(leftStart) < Date.parse(rightEnd) &&
    Date.parse(rightStart) < Date.parse(leftEnd)
  );
}

function assertEmployeeFree(
  entities: EntityMap,
  employee: string,
  start: string,
  end: string,
  ignoredSlotId = ""
): void {
  const occupied = entities.tasks.some(row => {
    if (row.id === ignoredSlotId || row.meta.recordType !== "letting-slot")
      return false;
    if (metaText(row.meta, "employee") !== employee) return false;
    const otherStart = metaText(row.meta, "start");
    const otherEnd = metaText(row.meta, "end");
    try {
      if (!otherStart || !otherEnd) return false;
      return slotOverlaps(start, end, otherStart, otherEnd);
    } catch {
      return false;
    }
  });
  if (occupied)
    throw new Error(
      "الموظف مرتبط بموعد متداخل في محفظة أخرى أو في المحفظة نفسها"
    );
}

export function addLettingSlot(
  state: PrototypeState,
  input: LettingSlotInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات الموعد غير صالحة");
  const requestId = requireId(input.requestId, "معرف إنشاء الموعد");
  const employee = requireText(input.employee, "اسم الموظف", MAX_TITLE);
  const start = assertQatarIso(input.start, "بداية الموعد");
  const end = assertQatarIso(input.end, "نهاية الموعد");
  if (Date.parse(end) <= Date.parse(start))
    throw new Error("نهاية الموعد يجب أن تكون بعد بدايته");
  const asOf = scenarioDate(state);
  if (start.slice(0, 10) < asOf)
    throw new Error("يجب ألا يقع الموعد قبل تاريخ السيناريو");
  const portfolioId = requireId(input.portfolioId, "محفظة الموعد");
  const portfolio = state.entities.portfolios.find(
    row => row.id === portfolioId
  );
  if (!portfolio) throw new Error("محفظة الموعد غير موجودة");
  assertScope(state, portfolio);
  const slotFingerprint = fingerprint({ employee, start, end, portfolioId });
  const previous = state.entities.tasks.find(
    row =>
      row.meta.recordType === "letting-slot" &&
      metaText(row.meta, "slotRequestId") === requestId
  );
  if (previous) {
    if (metaText(previous.meta, "slotFingerprint") !== slotFingerprint)
      throw new Error("سبق استخدام معرف الموعد ببيانات مختلفة");
    return { state, result: previous };
  }
  assertEmployeeFree(state.entities, employee, start, end);
  assertCapacity(state, "tasks");
  const meta: Record<string, MetaValue> = {
    recordType: "letting-slot",
    employee,
    start,
    end,
    portfolioId,
    reservedFor: "",
    slotRequestId: requestId,
    slotFingerprint,
  };
  assertMetadata(meta);
  const slot: DemoEntity = {
    id: newId("letting-slot"),
    title: `موعد تسليم • ${employee}`.slice(0, MAX_TITLE),
    subtitle: `${start} إلى ${end}`,
    portfolioId,
    propertyId: "",
    status: "متاح",
    date: start.slice(0, 10),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const entities: EntityMap = {
    ...state.entities,
    tasks: [...state.entities.tasks, slot],
  };
  return transition(
    state,
    entities,
    slot,
    "إضافة موعد تسليم",
    "حُفظ الموعد بتوقيت قطر +03:00 بعد فحص تعارض الموظف عبر كل المحافظ."
  );
}

export function bookLettingAppointment(
  state: PrototypeState,
  input: LettingBookingInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات حجز الموعد غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف حجز الموعد");
  const slotId = requireId(input.slotId, "موعد التسليم");
  const bookingFingerprint = fingerprint({
    applicationId: application.id,
    slotId,
  });
  const previousSlot = state.entities.tasks.find(
    row =>
      row.meta.recordType === "letting-slot" &&
      metaText(row.meta, "bookingRequestId") === requestId
  );
  if (previousSlot) {
    if (
      metaText(previousSlot.meta, "bookingFingerprint") !==
        bookingFingerprint ||
      metaText(previousSlot.meta, "reservedFor") !== application.id
    ) {
      throw new Error("سبق استخدام معرف الحجز ببيانات مختلفة");
    }
    return { state, result: application };
  }
  if (stageOf(application) !== "returns-received")
    throw new Error("حجز الموعد متاح بعد استلام بيانات العقد والشيكات فقط");
  if (metaText(application.meta, "slotId"))
    throw new Error("يمكن حجز موعد واحد فقط لكل طلب تأجير");
  const slot = state.entities.tasks.find(
    row => row.id === slotId && row.meta.recordType === "letting-slot"
  );
  if (!slot) throw new Error("موعد التسليم غير موجود");
  if (slot.portfolioId !== application.portfolioId)
    throw new Error("موعد التسليم لا يتبع محفظة طلب التأجير");
  if (metaText(slot.meta, "reservedFor"))
    throw new Error("موعد التسليم محجوز بالفعل لطلب آخر");
  const start = assertQatarIso(metaText(slot.meta, "start"), "بداية الموعد");
  const end = assertQatarIso(metaText(slot.meta, "end"), "نهاية الموعد");
  if (start.slice(0, 10) < scenarioDate(state))
    throw new Error("لا يمكن حجز موعد قبل تاريخ السيناريو");
  assertEmployeeFree(
    state.entities,
    requireText(slot.meta.employee, "اسم الموظف", MAX_TITLE),
    start,
    end,
    slot.id
  );
  const slotMeta: Record<string, MetaValue> = {
    ...slot.meta,
    reservedFor: application.id,
    bookingRequestId: requestId,
    bookingFingerprint,
  };
  assertMetadata(slotMeta);
  const bookedSlot: DemoEntity = { ...slot, status: "محجوز", meta: slotMeta };
  const bookedApplication = updateApplication(
    state,
    application,
    { stage: "appointment-booked", slotId: slot.id },
    "موعد تسليم محجوز"
  );
  assertCapacity(state, "notifications");
  const interim: EntityMap = replaceApplication(
    {
      ...state.entities,
      tasks: state.entities.tasks.map(row =>
        row.id === slot.id ? bookedSlot : row
      ),
    },
    bookedApplication
  );
  const preview = mailPreview(
    bookedApplication,
    profileRecipient(interim, bookedApplication),
    "appointment-booked",
    `هذه معاينة محلية فقط لتأكيد موعد تسليم العقار: ${start}. اسم الموظف: ${metaText(slot.meta, "employee")}. لا يوجد حجز تقويم أو إرسال خارجي.`,
    { slotId: slot.id, eventKey: `booking:${requestId}` }
  );
  const entities: EntityMap = {
    ...interim,
    notifications: [...interim.notifications, preview],
  };
  return transition(
    state,
    entities,
    bookedApplication,
    "حجز موعد تسليم",
    "حُجز موعد واحد محليًا بعد فحص تعارض الموظف في جميع المحافظ؛ لا إرسال تقويم أو بريد فعلي."
  );
}

export function submitLettingHandover(
  state: PrototypeState,
  input: LettingHandoverInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات التسليم غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف إقرار التسليم");
  const date = assertDate(input.date, "تاريخ التسليم");
  const conditionNotes = requireText(
    input.conditionNotes,
    "ملاحظات حالة العقار",
    MAX_META_TEXT
  );
  const handoverFingerprint = fingerprint({
    date,
    conditionNotes,
    tenantDeclaration: input.tenantDeclaration === true,
  });
  const previous = state.entities.documents.find(
    row =>
      row.meta.recordType === "letting-handover" &&
      metaText(row.meta, "applicationId") === application.id &&
      metaText(row.meta, "handoverRequestId") === requestId
  );
  if (previous) {
    if (metaText(previous.meta, "handoverFingerprint") !== handoverFingerprint)
      throw new Error("سبق استخدام معرف إقرار التسليم ببيانات مختلفة");
    return { state, result: application };
  }
  if (stageOf(application) !== "appointment-booked")
    throw new Error("إقرار التسليم متاح بعد حجز الموعد فقط");
  if (date > scenarioDate(state))
    throw new Error(
      "لا يمكن تسجيل إقرار تسليم مستقبلي؛ حدّث تاريخ السيناريو عند وقوع الاستلام"
    );
  if (input.tenantDeclaration !== true)
    throw new Error("إقرار المستأجر بحالة العقار مطلوب قبل التسليم");
  const slot = state.entities.tasks.find(
    row =>
      row.id === metaText(application.meta, "slotId") &&
      row.meta.recordType === "letting-slot"
  );
  if (!slot || metaText(slot.meta, "reservedFor") !== application.id)
    throw new Error("موعد التسليم المحجوز غير موجود أو لا يتبع الطلب");
  if (date < slot.date)
    throw new Error("تاريخ إقرار التسليم لا يمكن أن يسبق يوم الموعد المحجوز");
  const photos = applicationAttachments(state.entities, application.id).filter(
    row =>
      metaText(row.meta, "kind") === "handover-photo" &&
      metaText(row.meta, "submittedBy") === "tenant-simulation"
  );
  if (!photos.length)
    throw new Error("صور حالة العقار المقدمة من المستأجر مطلوبة قبل التسليم");
  assertCapacity(state, "documents");
  const handover = documentEntity(
    application,
    "إقرار تسليم واستلام حالة العقار",
    "مقدم من المستأجر",
    date,
    {
      recordType: "letting-handover",
      applicationId: application.id,
      handoverRequestId: requestId,
      handoverFingerprint,
      date,
      conditionNotes,
      tenantDeclaration: true,
      photoCount: photos.length,
      source: "إقرار مستأجر محاكى؛ لا تأكيد أصول الموظف بعد",
    }
  );
  const nextApplication = updateApplication(
    state,
    application,
    { stage: "handover-submitted" },
    "بانتظار تأكيد الأصول"
  );
  const entities = replaceApplication(
    {
      ...state.entities,
      documents: [...state.entities.documents, handover],
    },
    nextApplication
  );
  return transition(
    state,
    entities,
    nextApplication,
    "تسجيل إقرار حالة العقار",
    "سُجل إقرار المستأجر وصوره محليًا؛ ما زال تأكيد أصول العقد والشيكات بيد الموظف."
  );
}

function collectionConsumesBalance(row: DemoEntity): boolean {
  return !/مرتجع|ملغ|cancel/i.test(row.status);
}

function unallocatedReceivableBalance(
  entities: EntityMap,
  receivable: DemoEntity
): number {
  const allocatedCollections = entities.collections
    .filter(
      row =>
        metaText(row.meta, "receivableId") === receivable.id &&
        collectionConsumesBalance(row)
    )
    .reduce((total, row) => total + row.amountMinor, 0);
  const allocatedLosses = entities.losses
    .filter(row => metaText(row.meta, "receivableId") === receivable.id)
    .reduce((total, row) => total + row.amountMinor, 0);
  const remaining =
    receivable.amountMinor - allocatedCollections - allocatedLosses;
  return Math.max(0, remaining);
}

function chequeDocumentsFor(
  entities: EntityMap,
  application: DemoEntity
): DemoEntity[] {
  return entities.documents.filter(
    row =>
      row.meta.recordType === "letting-cheque" &&
      metaText(row.meta, "applicationId") === application.id
  );
}

function chequeFromDocument(document: DemoEntity): LettingChequeInput {
  return {
    number: requireText(document.meta.number, "رقم الشيك", 128),
    bank: requireText(document.meta.bank, "اسم البنك", MAX_TITLE),
    amountMinor: assertPositiveMinor(document.meta.amountMinor, "مبلغ الشيك"),
    dueDate: assertDate(document.meta.dueDate, "تاريخ استحقاق الشيك"),
  };
}

/**
 * Read-only cheque prefill schedule. The month anchoring and inclusive end-date
 * logic deliberately duplicates prototype-lease-lifecycle's private dueDates
 * algorithm so a UI cannot silently assume twelve installments.
 */
export function getLettingChequeSchedule(
  entities: EntityMap,
  applicationId: string
): { dueDate: string; amountMinor: number }[] {
  const application = applicationForEntities(
    entities,
    requireId(applicationId, "طلب التأجير")
  );
  const lease = entities.leases.find(
    row => row.id === metaText(application.meta, "leaseId")
  );
  if (!lease) return [];
  const startDate = assertDate(
    metaText(lease.meta, "startDate") ||
      metaText(application.meta, "startDate"),
    "تاريخ بداية العقد"
  );
  const endDate = assertDate(
    metaText(lease.meta, "endDate") || metaText(application.meta, "endDate"),
    "تاريخ نهاية العقد"
  );
  assertDateRange(startDate, endDate);
  const amountMinor = assertPositiveMinor(
    lease.amountMinor,
    "قيمة إيجار العقد"
  );
  return monthlyDueDates(startDate, endDate).map(dueDate => ({
    dueDate,
    amountMinor,
  }));
}

export function completeLettingApplication(
  state: PrototypeState,
  input: LettingCompleteInput
): LettingTransition<DemoEntity> {
  assertState(state);
  if (!input || typeof input !== "object")
    throw new Error("بيانات إكمال التأجير غير صالحة");
  const application = applicationFor(state, input.applicationId);
  const requestId = requireId(input.requestId, "معرف إكمال التأجير");
  const receivedDate = assertDate(input.receivedDate, "تاريخ استلام الأصول");
  const completeFingerprint = fingerprint({
    originalContractReceived: input.originalContractReceived === true,
    originalChequesReceived: input.originalChequesReceived === true,
    receivedDate,
  });
  if (metaText(application.meta, "completeRequestId") === requestId) {
    if (
      metaText(application.meta, "completeFingerprint") !== completeFingerprint
    )
      throw new Error("سبق استخدام معرف إكمال التأجير ببيانات مختلفة");
    return { state, result: application };
  }
  if (stageOf(application) !== "handover-submitted")
    throw new Error("إكمال التأجير متاح بعد إقرار حالة العقار فقط");
  if (receivedDate > scenarioDate(state))
    throw new Error(
      "لا يمكن تأكيد استلام أصول بتاريخ مستقبلي بالنسبة لتاريخ السيناريو"
    );
  if (
    input.originalContractReceived !== true ||
    input.originalChequesReceived !== true
  )
    throw new Error("يلزم تأكيد استلام أصل العقد وأصل الشيكات قبل الإكمال");

  const profile = assertCompleteProfile(
    application,
    profileForEntities(state.entities, application)
  );
  void profile;
  assertRequiredDocuments(state.entities, application);
  const attachments = applicationAttachments(state.entities, application.id);
  if (
    !attachments.some(row => metaText(row.meta, "kind") === "signed-contract")
  )
    throw new Error("العقد الموقع مفقود قبل الإكمال");
  if (!attachments.some(row => metaText(row.meta, "kind") === "cheque-image"))
    throw new Error("صورة شيك واحدة على الأقل مطلوبة قبل الإكمال");
  const tenantPhotos = attachments.filter(
    row =>
      metaText(row.meta, "kind") === "handover-photo" &&
      metaText(row.meta, "submittedBy") === "tenant-simulation"
  );
  if (!tenantPhotos.length)
    throw new Error("صور حالة العقار المقدمة من المستأجر مطلوبة قبل الإكمال");
  const handover = state.entities.documents.find(
    row =>
      row.meta.recordType === "letting-handover" &&
      metaText(row.meta, "applicationId") === application.id &&
      row.meta.tenantDeclaration === true
  );
  if (!handover)
    throw new Error("إقرار المستأجر بحالة العقار مفقود قبل الإكمال");
  if (receivedDate < handover.date)
    throw new Error("تاريخ استلام الأصول لا يمكن أن يسبق إقرار التسليم");
  const slot = state.entities.tasks.find(
    row =>
      row.id === metaText(application.meta, "slotId") &&
      row.meta.recordType === "letting-slot"
  );
  if (!slot || metaText(slot.meta, "reservedFor") !== application.id)
    throw new Error("الموعد المحجوز المطلوب للإكمال غير موجود");
  const contract = getLettingContract(state.entities, application.id);
  if (!contract) throw new Error("لقطة العقد النصية أو مسودة العقد مفقودة");
  const cheques = chequeDocumentsFor(state.entities, application);
  if (!cheques.length) throw new Error("لا توجد شيكات مسجلة للطلب قبل الإكمال");
  const chequeKeys = new Set<string>();
  for (const chequeDocument of cheques) {
    const cheque = chequeFromDocument(chequeDocument);
    const key = chequeKey(cheque.bank, cheque.number);
    if (chequeKeys.has(key))
      throw new Error("رقم الشيك والبنك مكرران في السجلات المحلية");
    chequeKeys.add(key);
  }
  if (
    state.entities.collections.length + cheques.length >
    MAX_ENTITIES_PER_KIND
  )
    throw new Error("إكمال التأجير يتجاوز سعة سجل التحصيلات");

  // This activation is pure. If any later matching/allocation guard fails, the
  // original input state remains intact because no reference is mutated.
  const activated = activateLease(state, contract.lease.id, receivedDate);
  let temporary = activated.state;
  const dueByDate = new Map<string, DemoEntity>();
  for (const receivable of temporary.entities.receivables) {
    if (metaText(receivable.meta, "leaseId") !== contract.lease.id) continue;
    const dueDate = metaText(receivable.meta, "due") || receivable.date;
    dueByDate.set(dueDate, receivable);
  }
  const scheduled = new Set(
    getLettingChequeSchedule(temporary.entities, application.id).map(
      row => row.dueDate
    )
  );
  const allocations = new Map<string, number>();
  const normalizedCheques = cheques.map(document => ({
    document,
    cheque: chequeFromDocument(document),
  }));
  for (const { cheque } of normalizedCheques) {
    if (!scheduled.has(cheque.dueDate))
      throw new Error("تاريخ الشيك لا يطابق جدول استحقاق العقد");
    const receivable = dueByDate.get(cheque.dueDate);
    if (!receivable)
      throw new Error("لا يوجد استحقاق مطابق لتاريخ الشيك بعد تفعيل العقد");
    const allocated =
      (allocations.get(receivable.id) ?? 0) + cheque.amountMinor;
    if (
      !Number.isSafeInteger(allocated) ||
      allocated > unallocatedReceivableBalance(temporary.entities, receivable)
    )
      throw new Error("تخصيص الشيكات يتجاوز الرصيد المتبقي للاستحقاق المطابق");
    allocations.set(receivable.id, allocated);
  }

  const collectionIds = new Map<string, string>();
  for (const { document, cheque } of normalizedCheques) {
    const receivable = dueByDate.get(cheque.dueDate)!;
    temporary = applyCollectionEntries(
      temporary,
      [{ receivableId: receivable.id, amountMinor: cheque.amountMinor }],
      {
        method: "شيك",
        status: "مستلم",
        collectionDate: receivedDate,
      }
    );
    const created = temporary.entities.collections.at(-1);
    if (!created) throw new Error("تعذر إنشاء سجل استلام الشيك");
    const meta: Record<string, MetaValue> = {
      ...created.meta,
      applicationId: application.id,
      chequeId: document.id,
      chequeBank: cheque.bank,
      chequeNumber: cheque.number,
      dueDate: cheque.dueDate,
      source: "شيك مستلم من مسار التأجير؛ لا قبض نقدي أو تأكيد بنكي",
    };
    assertMetadata(meta);
    temporary = {
      ...temporary,
      entities: {
        ...temporary.entities,
        collections: temporary.entities.collections.map(row =>
          row.id === created.id ? { ...row, meta } : row
        ),
      },
    };
    collectionIds.set(document.id, created.id);
  }
  const documents = temporary.entities.documents.map(row => {
    const collectionId = collectionIds.get(row.id);
    if (!collectionId) return row;
    const meta: Record<string, MetaValue> = {
      ...row.meta,
      collectionId,
      receivedDate,
    };
    assertMetadata(meta);
    return { ...row, status: "مستلم", meta };
  });
  const completedApplication = updateApplication(
    temporary,
    application,
    {
      stage: "completed",
      completeRequestId: requestId,
      completeFingerprint,
      originalContractReceived: true,
      originalChequesReceived: true,
      receivedDate,
    },
    "مكتمل"
  );
  const entities = replaceApplication(
    { ...temporary.entities, documents },
    completedApplication
  );
  return transition(
    temporary,
    entities,
    completedApplication,
    "إكمال تأجير وتفعيل عقد",
    "فُعل العقد وأنشئت الذمم الدورية، وسُجل كل شيك كمستلم فقط دون قبض نقدي أو تأكيد بنكي."
  );
}
