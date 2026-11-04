import {
  CONTRACT_TEMPLATE_TOKENS,
  type GenerateTemplateLeaseInput,
  type GenerateTemplateLeaseResult,
  type LeaseTemplateView,
  type SaveLeaseTemplateInput,
  type SaveLeaseTemplateResult,
  type TemplateLeaseView,
} from "@shared/lease-template-types";
import {
  PROTOTYPE_DATE,
  type DemoEntity,
  type EntityMap,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { assetTypeFromMeta, assetTypeLabel } from "./property-fields";
import { electricityNumberForRentalTarget } from "./prototype-rental";

const TEMPLATE_RECORD_TYPE = "lease-template";
const TEMPLATE_CHUNK_RECORD_TYPE = "lease-template-chunk";
const INSTANCE_RECORD_TYPE = "lease-template-instance";
const INSTANCE_CHUNK_RECORD_TYPE = "lease-template-instance-chunk";

const MAX_META_KEYS = 32;
const MAX_META_KEY_LENGTH = 64;
const MAX_META_STRING = 1024;
const MAX_META_NUMBER = 1_000_000_000_000;
const MAX_CONTENT = 16_000;
const MAX_ID = 128;
const MAX_NAME = 256;
const MAX_REQUEST_ID = 128;
const MAX_TERM_MONTHS = 120;
const TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g;

type LeaseTemplateRecord = DemoEntity & {
  meta: DemoEntity["meta"] & { recordType: typeof TEMPLATE_RECORD_TYPE };
};

type RenderValues = Record<(typeof CONTRACT_TEMPLATE_TOKENS)[number], string>;

interface NormalizedSaveInput {
  requestId: string;
  templateId: string;
  name: string;
  content: string;
  fileName: string;
  defaultRentMinor: number;
  defaultTermMonths: number;
}

interface NormalizedGenerateInput {
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

interface LeaseTarget {
  unit?: DemoEntity;
  rentalMode: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(
  value: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof value !== "string") throw new Error(`${label} مطلوب`);
  const result = value.trim();
  if (!result) throw new Error(`${label} مطلوب`);
  if (result.length > maxLength)
    throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number
): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} غير صالح`);
  const result = value.trim();
  if (result.length > maxLength)
    throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function requiredIdentifier(value: unknown, label: string): string {
  return requiredText(value, label, MAX_ID);
}

function optionalIdentifier(value: unknown, label: string): string {
  return optionalText(value, label, MAX_ID);
}

function assertOperator(state: PrototypeState): void {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function assertSelectedScope(state: PrototypeState, portfolioId: string): void {
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== portfolioId
  ) {
    throw new Error("السجل خارج المحفظة المختارة");
  }
}

function selectedTemplateScope(state: PrototypeState): string {
  if (state.settings.portfolioId === "all") return "";
  if (
    !state.entities.portfolios.some(
      portfolio => portfolio.id === state.settings.portfolioId
    )
  ) {
    throw new Error("المحفظة المختارة غير موجودة");
  }
  return state.settings.portfolioId;
}

function assertMetadata(meta: Record<string, MetaValue>): void {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_KEYS)
    throw new Error("بيانات السجل تتجاوز الحد المسموح");

  for (const [key, value] of entries) {
    if (!key || key.length > MAX_META_KEY_LENGTH)
      throw new Error("اسم حقل البيانات غير صالح");
    if (typeof value === "string") {
      if (value.length > MAX_META_STRING)
        throw new Error("قيمة بيانات السجل تتجاوز الحد المسموح");
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_META_NUMBER)
        throw new Error("رقم بيانات السجل غير صالح");
      continue;
    }
    if (typeof value !== "boolean") throw new Error("بيانات السجل غير صالحة");
  }
}

function metadataString(
  meta: DemoEntity["meta"],
  key: string,
  fallback = ""
): string {
  const value = meta[key];
  return typeof value === "string" ? value : fallback;
}

function boundedTitle(value: string): string {
  const normalized = value.trim().slice(0, MAX_NAME);
  return normalized || "سجل عقد";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertDate(value: unknown, label: string): string {
  const date = requiredText(value, label, 10);
  if (!validDate(date)) throw new Error(`${label} غير صحيح`);
  return date;
}

function assertDefaultRentMinor(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_META_NUMBER
  ) {
    throw new Error("الإيجار الافتراضي غير صالح أو يتجاوز الحد المسموح");
  }
  return value;
}

function assertDefaultTermMonths(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TERM_MONTHS
  ) {
    throw new Error("مدة العقد الافتراضية يجب أن تكون بين 0 و120 شهرًا");
  }
  return value;
}

/** Validates the only placeholders this engine can render. */
function assertTemplateContent(content: string): void {
  if (!content) throw new Error("محتوى القالب مطلوب");
  if (content.length > MAX_CONTENT)
    throw new Error("محتوى القالب يتجاوز الحد المسموح");

  const seen = new Set<string>();
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!CONTRACT_TEMPLATE_TOKENS.includes(token as never)) {
      throw new Error(`رمز القالب غير معروف: {{${token}}}`);
    }
    seen.add(token);
  }

  // Do not silently preserve malformed placeholder syntax as ordinary content.
  const withoutCompleteTokens = content.replace(TOKEN_PATTERN, "");
  if (
    withoutCompleteTokens.includes("{{") ||
    withoutCompleteTokens.includes("}}")
  ) {
    throw new Error("صيغة رمز القالب غير صحيحة");
  }

  for (const required of CONTRACT_TEMPLATE_TOKENS) {
    if (!seen.has(required))
      throw new Error(`رمز القالب مطلوب: {{${required}}}`);
  }
}

function splitContent(content: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += MAX_META_STRING) {
    chunks.push(content.slice(index, index + MAX_META_STRING));
  }
  return chunks;
}

function contentFromChunks(
  entities: EntityMap,
  parentId: string,
  recordType:
    | typeof TEMPLATE_CHUNK_RECORD_TYPE
    | typeof INSTANCE_CHUNK_RECORD_TYPE
): string {
  const chunks = entities.documents
    .filter(
      row =>
        row.meta.recordType === recordType && row.meta.parentId === parentId
    )
    .map(row => ({
      index: row.meta.index,
      content: row.meta.content,
    }));

  if (!chunks.length) throw new Error("أجزاء المستند غير موجودة");
  const indexes = new Set<number>();
  const ordered = chunks
    .map(chunk => {
      if (
        typeof chunk.index !== "number" ||
        !Number.isSafeInteger(chunk.index) ||
        chunk.index < 0
      )
        throw new Error("ترتيب جزء المستند غير صالح");
      if (
        typeof chunk.content !== "string" ||
        chunk.content.length > MAX_META_STRING
      )
        throw new Error("محتوى جزء المستند غير صالح");
      if (indexes.has(chunk.index)) throw new Error("أجزاء المستند مكررة");
      indexes.add(chunk.index);
      return { index: chunk.index, content: chunk.content };
    })
    .sort((left, right) => left.index - right.index);

  if (ordered.some((chunk, index) => chunk.index !== index))
    throw new Error("أجزاء المستند غير مكتملة");

  const content = ordered.map(chunk => chunk.content).join("");
  if (content.length > MAX_CONTENT)
    throw new Error("محتوى المستند يتجاوز الحد المسموح");
  return content;
}

function templateRows(entities: EntityMap): LeaseTemplateRecord[] {
  return entities.documents.filter(
    (row): row is LeaseTemplateRecord =>
      row.meta.recordType === TEMPLATE_RECORD_TYPE
  );
}

function rootIdOf(template: DemoEntity): string {
  const rootId = metadataString(template.meta, "rootId");
  const result = rootId || template.id;
  if (result.length > MAX_ID) throw new Error("مرجع أصل القالب غير صالح");
  return result;
}

function versionOf(template: DemoEntity): number {
  const value = template.meta.version;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_META_NUMBER
  ) {
    throw new Error("إصدار القالب غير صالح");
  }
  return value;
}

function templateNameOf(template: DemoEntity): string {
  const name = metadataString(template.meta, "name", template.title).trim();
  if (!name || name.length > MAX_NAME) throw new Error("اسم القالب غير صالح");
  return name;
}

function templateDefaults(template: DemoEntity): {
  defaultRentMinor: number;
  defaultTermMonths: number;
} {
  return {
    defaultRentMinor: assertDefaultRentMinor(template.meta.defaultRentMinor),
    defaultTermMonths: assertDefaultTermMonths(template.meta.defaultTermMonths),
  };
}

function findTemplate(
  entities: EntityMap,
  templateId: string
): LeaseTemplateRecord {
  const template = entities.documents.find(row => row.id === templateId);
  if (!template || template.meta.recordType !== TEMPLATE_RECORD_TYPE)
    throw new Error("قالب العقد غير موجود");
  return template as LeaseTemplateRecord;
}

function nextTemplateVersion(entities: EntityMap, rootId: string): number {
  let greatest = 0;
  for (const template of templateRows(entities)) {
    if (rootIdOf(template) !== rootId) continue;
    greatest = Math.max(greatest, versionOf(template));
  }
  if (greatest >= MAX_META_NUMBER)
    throw new Error("تعذر تخصيص إصدار جديد للقالب");
  return greatest + 1;
}

function templateChunks(
  parent: DemoEntity,
  content: string,
  recordType:
    | typeof TEMPLATE_CHUNK_RECORD_TYPE
    | typeof INSTANCE_CHUNK_RECORD_TYPE
): DemoEntity[] {
  return splitContent(content).map((part, index) => {
    const meta: Record<string, MetaValue> = {
      recordType,
      parentId: parent.id,
      index,
      content: part,
    };
    assertMetadata(meta);
    return {
      id: crypto.randomUUID(),
      title: boundedTitle(`جزء ${index + 1} من ${parent.title}`),
      subtitle: "",
      portfolioId: parent.portfolioId,
      propertyId: parent.propertyId,
      status: parent.status,
      date: parent.date,
      amountMinor: 0,
      currency: "QAR",
      meta,
    };
  });
}

function appendAudit(
  state: PrototypeState,
  title: string,
  detail: string
): PrototypeState["audit"] {
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    title: boundedTitle(title),
    detail: detail.slice(0, MAX_META_STRING),
  };
  return [event, ...state.audit].slice(0, 500);
}

function normalizeSaveInput(
  input: SaveLeaseTemplateInput
): NormalizedSaveInput {
  if (!input || typeof input !== "object")
    throw new Error("بيانات القالب غير صالحة");
  const content = requiredText(input.content, "محتوى القالب", MAX_CONTENT);
  assertTemplateContent(content);
  return {
    requestId: requiredText(input.requestId, "معرف العملية", MAX_REQUEST_ID),
    templateId: optionalIdentifier(input.templateId, "معرف القالب"),
    name: requiredText(input.name, "اسم القالب", MAX_NAME),
    content,
    fileName: optionalText(input.fileName, "اسم الملف", MAX_META_STRING),
    defaultRentMinor: assertDefaultRentMinor(input.defaultRentMinor),
    defaultTermMonths: assertDefaultTermMonths(input.defaultTermMonths),
  };
}

function normalizeGenerateInput(
  input: GenerateTemplateLeaseInput
): NormalizedGenerateInput {
  if (!input || typeof input !== "object")
    throw new Error("بيانات إنشاء العقد غير صالحة");
  return {
    requestId: requiredText(input.requestId, "معرف العملية", MAX_REQUEST_ID),
    templateId: requiredIdentifier(input.templateId, "قالب العقد"),
    propertyId: requiredIdentifier(input.propertyId, "العقار"),
    unitId: optionalIdentifier(input.unitId, "الوحدة"),
    // The title field has a stricter platform bound than meta strings.
    tenantName: requiredText(input.tenantName, "اسم المستأجر", MAX_NAME),
    propertyNumber: requiredText(
      input.propertyNumber,
      "رقم العقار",
      MAX_META_STRING
    ),
    electricityNumber: requiredText(
      input.electricityNumber,
      "رقم الكهرباء",
      MAX_META_STRING
    ),
    propertyType: requiredText(
      input.propertyType,
      "نوع العقار",
      MAX_META_STRING
    ),
    startDate: assertDate(input.startDate, "تاريخ بداية العقد"),
  };
}

function sameSaveRequest(
  entities: EntityMap,
  template: DemoEntity,
  input: NormalizedSaveInput
): boolean {
  const view = getLeaseTemplateView(entities, template.id);
  return (
    metadataString(template.meta, "sourceTemplateId") === input.templateId &&
    view.name === input.name &&
    view.content === input.content &&
    view.fileName === input.fileName &&
    view.defaultRentMinor === input.defaultRentMinor &&
    view.defaultTermMonths === input.defaultTermMonths
  );
}

function findProperty(entities: EntityMap, propertyId: string): DemoEntity {
  const property = entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار غير موجود");
  return property;
}

function unitFor(
  entities: EntityMap,
  property: DemoEntity,
  unitId: string
): DemoEntity | undefined {
  if (!unitId) return undefined;
  const unit = entities.units.find(row => row.id === unitId);
  if (
    !unit ||
    unit.portfolioId !== property.portfolioId ||
    unit.propertyId !== property.id
  ) {
    throw new Error("الوحدة غير موجودة أو لا تتبع العقار والمحفظة");
  }
  return unit;
}

/**
 * Resolves the lease target from only the saved rentalMode metadata. It does not
 * infer a mode from a property's current number of units.
 */
function resolveLeaseTarget(
  entities: EntityMap,
  property: DemoEntity,
  requestedUnitId: string
): LeaseTarget {
  const propertyUnits = entities.units.filter(
    row =>
      row.portfolioId === property.portfolioId && row.propertyId === property.id
  );
  const rentalMode = metadataString(property.meta, "rentalMode");

  if (rentalMode === "whole") {
    const wholeUnits = propertyUnits.filter(
      row => row.meta.wholeProperty === true
    );
    if (wholeUnits.length !== 1)
      throw new Error("العقار المؤجر بالكامل يحتاج وحدة داخلية واحدة صالحة");
    const wholeUnit = wholeUnits[0];
    if (requestedUnitId && requestedUnitId !== wholeUnit.id)
      throw new Error("الوحدة المختارة لا تمثل العقار المؤجر بالكامل");
    return { unit: wholeUnit, rentalMode: "whole" };
  }

  if (rentalMode === "units") {
    if (!requestedUnitId)
      throw new Error("اختر وحدة صالحة للعقار المقسم إلى وحدات");
    return {
      unit: unitFor(entities, property, requestedUnitId),
      rentalMode: "units",
    };
  }

  // Historical records carry no rentalMode. They remain usable without creating
  // a synthetic unit, but selecting a real unit remains mandatory when units exist.
  if (requestedUnitId) {
    return {
      unit: unitFor(entities, property, requestedUnitId),
      rentalMode: "units",
    };
  }
  if (propertyUnits.length)
    throw new Error("اختر وحدة صالحة للعقار قبل إنشاء مسودة العقد");
  return { rentalMode: "property" };
}

function leaseEndDate(
  startDate: string,
  termMonths: number
): string | undefined {
  if (termMonths === 0) return undefined;
  const [year, month, day] = startDate.split("-").map(Number);
  const targetMonth = month - 1 + termMonths;
  const targetYear = year + Math.floor(targetMonth / 12);
  const targetMonthIndex = ((targetMonth % 12) + 12) % 12;
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0)
  ).getUTCDate();
  const anniversary = new Date(
    Date.UTC(targetYear, targetMonthIndex, Math.min(day, daysInTargetMonth))
  );
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  const result = anniversary.toISOString().slice(0, 10);
  if (!validDate(result)) throw new Error("تعذر احتساب تاريخ نهاية العقد");
  return result;
}

function renderTemplate(content: string, values: RenderValues): string {
  // Replacement callbacks operate over the original string only. If a supplied
  // value itself contains {{...}}, it remains literal text and cannot execute a token.
  return content.replace(
    TOKEN_PATTERN,
    (_match, token: string) => values[token as keyof RenderValues]
  );
}

function sameGenerateRequest(
  document: DemoEntity,
  input: NormalizedGenerateInput
): boolean {
  return (
    document.propertyId === input.propertyId &&
    metadataString(document.meta, "templateId") === input.templateId &&
    metadataString(document.meta, "requestedUnitId") === input.unitId &&
    metadataString(document.meta, "tenantName") === input.tenantName &&
    metadataString(document.meta, "propertyNumber") === input.propertyNumber &&
    metadataString(document.meta, "electricityNumber") ===
      input.electricityNumber &&
    metadataString(document.meta, "propertyType") === input.propertyType &&
    metadataString(document.meta, "startDate") === input.startDate
  );
}

function renewalTerms(lease: DemoEntity): {
  startDate: string;
  endDate: string;
  rentMinor: number;
} {
  const startDate = assertDate(
    metadataString(lease.meta, "startDate"),
    "تاريخ بداية التجديد"
  );
  const endDate = assertDate(
    metadataString(lease.meta, "endDate"),
    "تاريخ نهاية التجديد"
  );
  if (endDate < startDate)
    throw new Error("تاريخ نهاية التجديد لا يمكن أن يسبق تاريخ البداية");
  const rentMinor = lease.meta.rentMinor;
  if (
    typeof rentMinor !== "number" ||
    !Number.isSafeInteger(rentMinor) ||
    rentMinor <= 0 ||
    rentMinor > MAX_META_NUMBER
  ) {
    throw new Error("إيجار التجديد الحالي غير صالح");
  }
  return { startDate, endDate, rentMinor };
}

function sameRenewalSnapshotRequest(
  document: DemoEntity,
  lease: DemoEntity,
  template: DemoEntity,
  requestId: string
): boolean {
  return (
    document.meta.recordType === INSTANCE_RECORD_TYPE &&
    metadataString(document.meta, "leaseId") === lease.id &&
    metadataString(document.meta, "templateId") === template.id &&
    document.meta.templateVersion === versionOf(template) &&
    metadataString(document.meta, "requestId") === requestId &&
    metadataString(document.meta, "snapshotKind") === "renewal" &&
    metadataString(document.meta, "startDate") ===
      metadataString(lease.meta, "startDate") &&
    metadataString(document.meta, "endDate") ===
      metadataString(lease.meta, "endDate") &&
    document.meta.rentMinor === lease.meta.rentMinor
  );
}

/**
 * Saves a new immutable template version. A specific portfolio scopes a template
 * to that portfolio; selecting "all" saves it in the shared operator library.
 */
export function saveLeaseTemplate(
  state: PrototypeState,
  input: SaveLeaseTemplateInput
): SaveLeaseTemplateResult {
  assertOperator(state);
  const normalized = normalizeSaveInput(input);
  const scope = selectedTemplateScope(state);

  const previous = templateRows(state.entities).find(
    row => metadataString(row.meta, "requestId") === normalized.requestId
  );
  if (previous) {
    if (previous.portfolioId !== scope)
      throw new Error("العملية السابقة خارج المحفظة المختارة");
    if (!sameSaveRequest(state.entities, previous, normalized)) {
      throw new Error(
        "سبق حفظ هذه العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    }
    return { state, template: previous };
  }

  let rootId: string;
  let version: number;
  if (normalized.templateId) {
    const source = findTemplate(state.entities, normalized.templateId);
    if (source.portfolioId !== scope)
      throw new Error("القالب خارج المحفظة المختارة");
    // Validate stored source chunks before deriving an immutable successor.
    getLeaseTemplateView(state.entities, source.id);
    rootId = rootIdOf(source);
    version = nextTemplateVersion(state.entities, rootId);
  } else {
    rootId = crypto.randomUUID();
    version = 1;
  }

  const templateId = normalized.templateId ? crypto.randomUUID() : rootId;
  const meta: Record<string, MetaValue> = {
    recordType: TEMPLATE_RECORD_TYPE,
    rootId,
    version,
    name: normalized.name,
    fileName: normalized.fileName,
    defaultRentMinor: normalized.defaultRentMinor,
    defaultTermMonths: normalized.defaultTermMonths,
    requestId: normalized.requestId,
    sourceTemplateId: normalized.templateId,
  };
  assertMetadata(meta);
  const template: DemoEntity = {
    id: templateId,
    title: normalized.name,
    subtitle: "قالب عقد إيجار محلي",
    portfolioId: scope,
    propertyId: "",
    status: "محفوظ",
    date: scenarioDate(state),
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
  const chunks = templateChunks(
    template,
    normalized.content,
    TEMPLATE_CHUNK_RECORD_TYPE
  );

  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      documents: [...state.entities.documents, template, ...chunks],
    },
    audit: appendAudit(
      state,
      "حفظ قالب عقد",
      `${normalized.name} • الإصدار ${version} • حفظ محلي للبروتوتايب`
    ),
  };
  return { state: nextState, template };
}

/**
 * Produces a tenant, a draft lease, and an immutable rendered snapshot. It never
 * creates receivables, cash collections, or occupancy side effects.
 */
export function generateTemplateLease(
  state: PrototypeState,
  input: GenerateTemplateLeaseInput
): GenerateTemplateLeaseResult {
  assertOperator(state);
  const normalized = normalizeGenerateInput(input);
  const property = findProperty(state.entities, normalized.propertyId);
  assertSelectedScope(state, property.portfolioId);

  const template = findTemplate(state.entities, normalized.templateId);
  if (
    template.portfolioId !== "" &&
    template.portfolioId !== property.portfolioId
  ) {
    throw new Error("قالب العقد لا يتبع محفظة العقار");
  }
  const templateView = getLeaseTemplateView(state.entities, template.id);

  const expectedPropertyType = assetTypeLabel(
    assetTypeFromMeta(property.meta) ?? ""
  );
  if (
    expectedPropertyType === "غير مسجل" ||
    normalized.propertyType !== expectedPropertyType
  ) {
    throw new Error("نوع العقار لا يطابق نوع الأصل المسجل");
  }
  const target = resolveLeaseTarget(
    state.entities,
    property,
    normalized.unitId
  );

  const previousDocument = state.entities.documents.find(
    row =>
      row.meta.recordType === INSTANCE_RECORD_TYPE &&
      metadataString(row.meta, "requestId") === normalized.requestId
  );
  if (previousDocument) {
    if (!sameGenerateRequest(previousDocument, normalized)) {
      throw new Error(
        "سبق إنشاء هذه العملية ببيانات مختلفة؛ استخدم معرف عملية جديدًا"
      );
    }
    const leaseId = metadataString(previousDocument.meta, "leaseId");
    const lease = state.entities.leases.find(row => row.id === leaseId);
    if (!lease) throw new Error("نتيجة العملية السابقة غير مكتملة");
    return { state, lease, document: previousDocument };
  }

  const renderedContent = renderTemplate(templateView.content, {
    الاسم: normalized.tenantName,
    رقم_العقار: normalized.propertyNumber,
    رقم_الكهرباء: normalized.electricityNumber,
    نوع_العقار: normalized.propertyType,
  });
  if (renderedContent.length > MAX_CONTENT)
    throw new Error("المستند الناتج يتجاوز الحد المسموح");

  const tenantId = crypto.randomUUID();
  const leaseId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const endDate = leaseEndDate(
    normalized.startDate,
    templateView.defaultTermMonths
  );
  const unitId = target.unit?.id ?? "";
  const unitTitle = target.unit?.title ?? property.title;

  const tenantMeta: Record<string, MetaValue> = { unitId };
  assertMetadata(tenantMeta);
  const tenant: DemoEntity = {
    id: tenantId,
    title: normalized.tenantName,
    subtitle: "مستأجر مسودة عقد",
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: normalized.startDate,
    amountMinor: 0,
    currency: "QAR",
    meta: tenantMeta,
  };

  const leaseMeta: Record<string, MetaValue> = {
    tenantId,
    tenantName: normalized.tenantName,
    tenant: normalized.tenantName,
    unitId,
    templateId: template.id,
    templateVersion: templateView.version,
    snapshotDocumentId: documentId,
    rentalMode: target.rentalMode,
    propertyNumber: normalized.propertyNumber,
    electricityNumber: normalized.electricityNumber,
    propertyType: normalized.propertyType,
    rentMinor: templateView.defaultRentMinor,
    rentSource: "template-default",
    startDate: normalized.startDate,
    registrationStatus: "غير متحقق",
    signedStatus: "مسودة غير موقعة",
  };
  if (endDate) leaseMeta.endDate = endDate;
  assertMetadata(leaseMeta);
  const lease: DemoEntity = {
    id: leaseId,
    title: boundedTitle(`عقد ${property.title}`),
    subtitle: normalized.tenantName,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: normalized.startDate,
    amountMinor: templateView.defaultRentMinor,
    currency: "QAR",
    meta: leaseMeta,
  };

  const documentMeta: Record<string, MetaValue> = {
    recordType: INSTANCE_RECORD_TYPE,
    leaseId,
    templateId: template.id,
    templateName: templateView.name,
    templateVersion: templateView.version,
    requestId: normalized.requestId,
    requestedUnitId: normalized.unitId,
    tenantName: normalized.tenantName,
    propertyNumber: normalized.propertyNumber,
    electricityNumber: normalized.electricityNumber,
    propertyType: normalized.propertyType,
    rentalMode: target.rentalMode,
    unitTitle,
    startDate: normalized.startDate,
  };
  if (endDate) documentMeta.endDate = endDate;
  assertMetadata(documentMeta);
  const document: DemoEntity = {
    id: documentId,
    title: boundedTitle(`نسخة عقد ${property.title}`),
    subtitle: normalized.tenantName,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: normalized.startDate,
    amountMinor: 0,
    currency: "QAR",
    meta: documentMeta,
  };
  const chunks = templateChunks(
    document,
    renderedContent,
    INSTANCE_CHUNK_RECORD_TYPE
  );

  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      tenants: [...state.entities.tenants, tenant],
      leases: [...state.entities.leases, lease],
      documents: [...state.entities.documents, document, ...chunks],
    },
    audit: appendAudit(
      state,
      "إنشاء مسودة عقد من قالب",
      `${templateView.name} • ${property.title} • ${normalized.tenantName}`
    ),
  };
  return { state: nextState, lease, document };
}

/**
 * Renders an immutable, current-template snapshot for an existing draft renewal.
 * It intentionally never creates a tenant, lease, receivable, collection, or
 * occupancy effect; the lifecycle transition remains responsible for activation.
 */
export function refreshRenewalTemplateSnapshot(
  state: PrototypeState,
  leaseId: string,
  templateId: string,
  requestId: string
): { state: PrototypeState; result: DemoEntity } {
  assertOperator(state);
  const normalizedLeaseId = requiredIdentifier(leaseId, "عقد التجديد");
  const normalizedTemplateId = requiredIdentifier(templateId, "قالب العقد");
  const normalizedRequestId = requiredText(
    requestId,
    "معرف العملية",
    MAX_REQUEST_ID
  );
  const lease = state.entities.leases.find(row => row.id === normalizedLeaseId);
  if (!lease) throw new Error("مسودة التجديد غير موجودة");
  if (!metadataString(lease.meta, "priorLeaseId"))
    throw new Error("إنشاء لقطة القالب متاح لإصدار التجديد فقط");
  if (!/مسودة|مقترح|بانتظار/.test(lease.status))
    throw new Error("لا يمكن تغيير لقطة إصدار تجديد غير مسودة");

  const property = findProperty(state.entities, lease.propertyId);
  assertSelectedScope(state, property.portfolioId);
  if (lease.portfolioId !== property.portfolioId)
    throw new Error("ربط مسودة التجديد بالعقار والمحفظة غير متسق");
  const template = findTemplate(state.entities, normalizedTemplateId);
  if (
    template.portfolioId !== "" &&
    template.portfolioId !== property.portfolioId
  ) {
    throw new Error("قالب العقد لا يتبع محفظة التجديد");
  }
  const templateView = getLeaseTemplateView(state.entities, template.id);
  const terms = renewalTerms(lease);
  if (
    templateView.defaultRentMinor !== terms.rentMinor ||
    leaseEndDate(terms.startDate, templateView.defaultTermMonths) !==
      terms.endDate
  ) {
    throw new Error(
      "القالب المختار لا يطابق إيجار أو مدة التجديد الحالية؛ عدّل نموذج التجديد مرة واحدة ثم أنشئ لقطة جديدة"
    );
  }

  const previousRequest = state.entities.documents.find(
    row =>
      row.meta.recordType === INSTANCE_RECORD_TYPE &&
      metadataString(row.meta, "requestId") === normalizedRequestId
  );
  if (previousRequest) {
    if (
      !sameRenewalSnapshotRequest(
        previousRequest,
        lease,
        template,
        normalizedRequestId
      )
    ) {
      throw new Error(
        "سبق استخدام معرف العملية لنسخة مختلفة؛ استخدم معرف عملية جديدًا"
      );
    }
    // Validate chunks before treating an idempotent retry as successful.
    contentFromChunks(
      state.entities,
      previousRequest.id,
      INSTANCE_CHUNK_RECORD_TYPE
    );
    const snapshotId = metadataString(lease.meta, "snapshotDocumentId");
    if (snapshotId && snapshotId !== previousRequest.id) {
      throw new Error(
        "مسودة التجديد تشير إلى لقطة مختلفة؛ راجع النموذج مرة واحدة"
      );
    }
    return { state, result: previousRequest };
  }

  const target = resolveLeaseTarget(
    state.entities,
    property,
    metadataString(lease.meta, "unitId")
  );
  const tenantName = requiredText(
    metadataString(lease.meta, "tenantName") ||
      metadataString(lease.meta, "tenant") ||
      lease.subtitle,
    "اسم المستأجر",
    MAX_NAME
  );
  const propertyNumber = requiredText(
    metadataString(property.meta, "propertyNumber"),
    "رقم العقار في بيانات العقار",
    MAX_META_STRING
  );
  const propertyType = assetTypeLabel(assetTypeFromMeta(property.meta) ?? "");
  if (propertyType === "غير مسجل")
    throw new Error("نوع الأصل في بيانات العقار مطلوب قبل توليد لقطة التجديد");
  const electricityNumber = requiredText(
    electricityNumberForRentalTarget(
      state.entities,
      property.id,
      target.unit?.id
    ),
    "رقم الكهرباء الحالي",
    MAX_META_STRING
  );
  const renderedContent = renderTemplate(templateView.content, {
    الاسم: tenantName,
    رقم_العقار: propertyNumber,
    رقم_الكهرباء: electricityNumber,
    نوع_العقار: propertyType,
  });
  if (renderedContent.length > MAX_CONTENT)
    throw new Error("محتوى نسخة التجديد يتجاوز الحد المسموح");

  const document: DemoEntity = {
    id: crypto.randomUUID(),
    title: boundedTitle(`نسخة تجديد عقد ${property.title}`),
    subtitle: tenantName,
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "مسودة",
    date: terms.startDate,
    amountMinor: 0,
    currency: "QAR",
    meta: {
      recordType: INSTANCE_RECORD_TYPE,
      snapshotKind: "renewal",
      leaseId: lease.id,
      templateId: template.id,
      templateName: templateView.name,
      templateVersion: templateView.version,
      requestId: normalizedRequestId,
      requestedUnitId: target.unit?.id ?? "",
      tenantName,
      propertyNumber,
      electricityNumber,
      propertyType,
      rentalMode: target.rentalMode,
      unitTitle: target.unit?.title ?? property.title,
      startDate: terms.startDate,
      endDate: terms.endDate,
      rentMinor: terms.rentMinor,
    },
  };
  assertMetadata(document.meta);
  const chunks = templateChunks(
    document,
    renderedContent,
    INSTANCE_CHUNK_RECORD_TYPE
  );
  const {
    newTemplateSnapshotRequired: _newTemplateSnapshotRequired,
    snapshotDocumentId: _oldSnapshotDocumentId,
    templateId: _oldTemplateId,
    templateVersion: _oldTemplateVersion,
    ...preservedMeta
  } = lease.meta;
  const refreshedLease: DemoEntity = {
    ...lease,
    meta: {
      ...preservedMeta,
      templateId: template.id,
      templateVersion: templateView.version,
      snapshotDocumentId: document.id,
      templateSnapshotRefreshedAt: scenarioDate(state),
    },
  };
  assertMetadata(refreshedLease.meta);
  const nextState: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      leases: state.entities.leases.map(row =>
        row.id === lease.id ? refreshedLease : row
      ),
      documents: [...state.entities.documents, document, ...chunks],
    },
    audit: appendAudit(
      state,
      "توليد لقطة تجديد من قالب",
      `${templateView.name} • ${lease.title} • لا تفعيل ولا ذمم أو قبض`
    ),
  };
  return { state: nextState, result: document };
}

/** Returns the stored source content for an exact immutable template version. */
export function getLeaseTemplateView(
  entities: EntityMap,
  templateId: string
): LeaseTemplateView {
  const template = findTemplate(
    entities,
    requiredIdentifier(templateId, "قالب العقد")
  );
  const content = contentFromChunks(
    entities,
    template.id,
    TEMPLATE_CHUNK_RECORD_TYPE
  );
  assertTemplateContent(content);
  const defaults = templateDefaults(template);
  const fileName = metadataString(template.meta, "fileName");
  if (fileName.length > MAX_META_STRING)
    throw new Error("اسم ملف القالب غير صالح");

  return {
    template,
    name: templateNameOf(template),
    content,
    version: versionOf(template),
    defaultRentMinor: defaults.defaultRentMinor,
    defaultTermMonths: defaults.defaultTermMonths,
    fileName,
  };
}

/**
 * Reads the exact generated snapshot, never re-rendering from a potentially newer
 * template version or from mutable property/tenant data.
 */
export function getTemplateLeaseView(
  entities: EntityMap,
  leaseId: string
): TemplateLeaseView {
  const normalizedLeaseId = requiredIdentifier(leaseId, "عقد الإيجار");
  const lease = entities.leases.find(row => row.id === normalizedLeaseId);
  if (!lease) throw new Error("عقد الإيجار غير موجود");

  const snapshotId = requiredIdentifier(
    metadataString(lease.meta, "snapshotDocumentId"),
    "نسخة العقد"
  );
  const document = entities.documents.find(row => row.id === snapshotId);
  if (!document || document.meta.recordType !== INSTANCE_RECORD_TYPE)
    throw new Error("نسخة العقد غير موجودة");
  if (metadataString(document.meta, "leaseId") !== lease.id)
    throw new Error("نسخة العقد لا تتبع العقد المحدد");

  const content = contentFromChunks(
    entities,
    document.id,
    INSTANCE_CHUNK_RECORD_TYPE
  );
  const templateVersion = document.meta.templateVersion;
  if (
    typeof templateVersion !== "number" ||
    !Number.isSafeInteger(templateVersion) ||
    templateVersion < 1 ||
    templateVersion > MAX_META_NUMBER
  ) {
    throw new Error("إصدار القالب في نسخة العقد غير صالح");
  }

  const requiredSnapshotText = (key: string, label: string): string =>
    requiredText(document.meta[key], label, MAX_META_STRING);

  return {
    lease,
    document,
    templateName: requiredSnapshotText("templateName", "اسم القالب"),
    templateVersion,
    content,
    tenantName: requiredSnapshotText("tenantName", "اسم المستأجر"),
    propertyNumber: requiredSnapshotText("propertyNumber", "رقم العقار"),
    electricityNumber: requiredSnapshotText(
      "electricityNumber",
      "رقم الكهرباء"
    ),
    propertyType: requiredSnapshotText("propertyType", "نوع العقار"),
    rentalMode: requiredSnapshotText("rentalMode", "نمط التأجير"),
    unitTitle: requiredSnapshotText("unitTitle", "اسم الوحدة"),
  };
}

/** Lists one newest immutable version per template root across all stored scopes. */
export function listLeaseTemplates(entities: EntityMap): DemoEntity[] {
  const latest = new Map<string, DemoEntity>();
  for (const template of templateRows(entities)) {
    let rootId: string;
    let version: number;
    try {
      rootId = rootIdOf(template);
      version = versionOf(template);
    } catch {
      // A corrupted historical row is not a usable template listing entry.
      continue;
    }
    const current = latest.get(rootId);
    if (
      !current ||
      version > versionOf(current) ||
      (version === versionOf(current) &&
        template.id.localeCompare(current.id) > 0)
    ) {
      latest.set(rootId, template);
    }
  }
  return [...latest.values()].sort((left, right) => {
    const nameOrder = templateNameOf(left).localeCompare(
      templateNameOf(right),
      "ar"
    );
    return nameOrder || left.id.localeCompare(right.id);
  });
}
