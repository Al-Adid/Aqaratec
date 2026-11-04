import type {
  BillingEntities,
  BillingInput,
  BillingKind,
  BillingLine,
  BillingReceiptView,
  BillingTotals,
  BillingView,
  CollectBillingInput,
  CollectBillingResult,
  IssueBillingResult,
} from "@shared/billing-types";
import {
  DemoEntity,
  EntityMap,
  isMinorAmount,
  PROTOTYPE_DATE,
  PrototypeState,
} from "@shared/prototype";
import {
  confirmed,
  outstandingFor,
  isActiveReceivable,
} from "./prototype-finance";
import {
  applyCollectionEntries,
  validCollectionDate,
} from "./prototype-payments";

const MAX_MINOR = Number.MAX_SAFE_INTEGER;
// Prototype metadata is deliberately bounded more tightly than JS money math.
// Document amountMinor may remain a safe integer, while every numeric meta value
// must fit the shared prototype scalar contract.
const MAX_META_MINOR = 1_000_000_000_000;
const BILLING_RECORD_TYPE = "billing-document";
const MAX_META_VALUES = 32;
const MAX_META_STRING = 1024;
const MAX_LINES_JSON = 1024;
const MAX_LINES = 5;
const MAX_DESCRIPTION = 100;
const MAX_PARTY_NAME = 120;
const MAX_NOTES = 512;

const NUMBER_PREFIX: Record<BillingKind, string> = {
  invoice: "INV",
  "payment-request": "REQ",
  lpo: "LPO",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(
  value: unknown,
  label: string,
  maxLength: number
): string {
  const result = text(value);
  if (!result) throw new Error(`${label} مطلوب`);
  if (result.length > maxLength)
    throw new Error(`${label} يتجاوز الحد المسموح`);
  return result;
}

function idText(value: unknown, label: string): string {
  return requiredText(value, label, 1024);
}

function safeAdd(left: number, right: number): number {
  if (!isMinorAmount(left) || !isMinorAmount(right) || left > MAX_MINOR - right)
    throw new Error("الإجمالي يتجاوز حد الحساب الآمن");
  return left + right;
}

function safeMultiply(quantity: number, unitPriceMinor: number): number {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > 10_000 ||
    !isMinorAmount(unitPriceMinor) ||
    (unitPriceMinor > 0 && quantity > Math.floor(MAX_MINOR / unitPriceMinor))
  ) {
    throw new Error("قيمة بند الفاتورة غير صحيحة أو تتجاوز الحد الآمن");
  }
  return quantity * unitPriceMinor;
}

function checkedSum(values: number[]): number {
  return values.reduce((total, value) => safeAdd(total, value), 0);
}

function validateLines(lines: BillingLine[]): BillingLine[] {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES)
    throw new Error("يلزم إدخال من بند واحد إلى خمسة بنود");

  return lines.map((line, index) => {
    if (!line || typeof line !== "object")
      throw new Error(`بند الفاتورة ${index + 1} غير صحيح`);
    const description = requiredText(
      line.description,
      "وصف البند",
      MAX_DESCRIPTION
    );
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity > 10_000
    )
      throw new Error(
        "كمية البند يجب أن تكون عددًا صحيحًا موجبًا لا يتجاوز 10000"
      );
    if (!isMinorAmount(line.unitPriceMinor))
      throw new Error("سعر البند غير صحيح أو يتجاوز الحد الآمن");
    safeMultiply(line.quantity, line.unitPriceMinor);
    return {
      description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
    };
  });
}

/** Calculates a tax-free billing total in minor QAR units without unsafe arithmetic. */
export function calculateBillingTotals(
  lines: BillingLine[],
  feeMinor: number = 0,
  discountMinor: number = 0
): BillingTotals {
  const validatedLines = validateLines(lines);
  if (!isMinorAmount(feeMinor) || !isMinorAmount(discountMinor))
    throw new Error("الرسم أو الخصم غير صحيح أو يتجاوز الحد الآمن");

  const subtotalMinor = checkedSum(
    validatedLines.map(line => safeMultiply(line.quantity, line.unitPriceMinor))
  );
  const beforeDiscount = safeAdd(subtotalMinor, feeMinor);
  if (discountMinor > beforeDiscount)
    throw new Error("الخصم لا يمكن أن يتجاوز إجمالي البنود والرسوم");
  if (
    subtotalMinor > MAX_META_MINOR ||
    feeMinor > MAX_META_MINOR ||
    discountMinor > MAX_META_MINOR ||
    beforeDiscount - discountMinor > MAX_META_MINOR
  ) {
    throw new Error("إجمالي وثيقة البروتوتايب يتجاوز الحد المسموح");
  }

  return {
    subtotalMinor,
    feeMinor,
    discountMinor,
    totalMinor: beforeDiscount - discountMinor,
  };
}

function assertDate(value: unknown, label: string): string {
  const date = requiredText(value, label, 10);
  if (!validCollectionDate(date)) throw new Error(`${label} غير صحيح`);
  return date;
}

function assertOperator(state: PrototypeState): void {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function findPortfolio(entities: EntityMap, portfolioId: string): DemoEntity {
  const portfolio = entities.portfolios.find(row => row.id === portfolioId);
  if (!portfolio) throw new Error("المحفظة غير موجودة");
  return portfolio;
}

function assertSelectedScope(state: PrototypeState, portfolioId: string): void {
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== portfolioId
  ) {
    throw new Error("السجل خارج المحفظة المختارة");
  }
}

function findProperty(
  entities: EntityMap,
  portfolioId: string,
  propertyId: string,
  required = true
): DemoEntity | undefined {
  const normalizedId = text(propertyId);
  if (!normalizedId) {
    if (required) throw new Error("العقار مطلوب");
    return undefined;
  }
  const property = entities.properties.find(row => row.id === normalizedId);
  if (!property || property.portfolioId !== portfolioId)
    throw new Error("العقار غير موجود أو لا يتبع المحفظة");
  return property;
}

interface LeaseContext {
  property: DemoEntity;
  unit?: DemoEntity;
  lease?: DemoEntity;
  tenant?: DemoEntity;
  partyName: string;
}

function findLeaseContext(
  entities: EntityMap,
  input: BillingInput,
  portfolioId: string,
  property: DemoEntity,
  partyName: string
): LeaseContext {
  const leaseId = text(input.leaseId);
  const lease = leaseId
    ? entities.leases.find(row => row.id === leaseId)
    : undefined;
  if (
    leaseId &&
    (!lease ||
      lease.portfolioId !== portfolioId ||
      lease.propertyId !== property.id)
  )
    throw new Error("العقد لا يتبع العقار أو المحفظة المحددة");
  const recordedUnitId = text(lease?.meta.unitId);
  const explicitUnitId = text(input.unitId);
  if (lease && explicitUnitId && recordedUnitId !== explicitUnitId)
    throw new Error("العقد لا يتبع الوحدة المحددة");
  const unitId = explicitUnitId || recordedUnitId;
  const unit = unitId
    ? entities.units.find(row => row.id === unitId)
    : undefined;
  if (
    unitId &&
    (!unit ||
      unit.portfolioId !== portfolioId ||
      unit.propertyId !== property.id)
  )
    throw new Error("الوحدة غير موجودة أو لا تتبع العقار");
  const tenantId = text(lease?.meta.tenantId);
  const tenant = tenantId
    ? entities.tenants.find(row => row.id === tenantId)
    : undefined;
  if (
    lease &&
    (!tenant ||
      tenant.portfolioId !== portfolioId ||
      tenant.propertyId !== property.id ||
      (text(tenant.meta.unitId) && text(tenant.meta.unitId) !== unitId))
  )
    throw new Error("المستأجر لا يتبع العقد أو الوحدة المحددة");
  const recordedParty =
    text(lease?.meta.tenantName) ||
    text(lease?.meta.tenant) ||
    text(lease?.subtitle);
  if (lease && partyName !== tenant?.title && partyName !== recordedParty)
    throw new Error("اسم الطرف لا يطابق دليل المستأجر في العقد");
  return { property, unit, lease, tenant, partyName };
}

function assertMeta(meta: DemoEntity["meta"]): void {
  const entries = Object.entries(meta);
  if (entries.length > MAX_META_VALUES)
    throw new Error("بيانات الوثيقة تتجاوز الحد المسموح");
  for (const [, value] of entries) {
    if (
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean") ||
      (typeof value === "number" &&
        (!Number.isFinite(value) || Math.abs(value) > MAX_META_MINOR)) ||
      (typeof value === "string" && value.length > MAX_META_STRING)
    ) {
      throw new Error("بيانات الوثيقة غير صالحة");
    }
  }
}

function isBillingDocument(row: DemoEntity): boolean {
  return (
    row.meta.recordType === BILLING_RECORD_TYPE && isBillingKind(row.meta.kind)
  );
}

function isBillingKind(value: unknown): value is BillingKind {
  return value === "invoice" || value === "payment-request" || value === "lpo";
}

function isActiveBillingDocument(row: DemoEntity): boolean {
  const status = text(row.status).toLowerCase();
  return !["ملغى", "ملغية", "cancelled", "canceled"].includes(status);
}

function nextNumber(
  rows: DemoEntity[],
  prefix: string,
  year: string,
  key: "number" | "receiptNumber"
): string {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let greatest = 0;
  rows.forEach(row => {
    const match = pattern.exec(text(row.meta[key]));
    if (!match) return;
    const parsed = Number(match[1]);
    if (Number.isSafeInteger(parsed) && parsed > greatest) greatest = parsed;
  });
  if (greatest >= 9_999_999)
    throw new Error("تعذر تخصيص رقم محلي فريد للوثيقة");
  return `${prefix}-${year}-${String(greatest + 1).padStart(4, "0")}`;
}

function billingNumber(
  entities: EntityMap,
  kind: BillingKind,
  issueDate: string
): string {
  return nextNumber(
    entities.documents,
    NUMBER_PREFIX[kind],
    issueDate.slice(0, 4),
    "number"
  );
}

function receiptNumber(entities: EntityMap, collectionDate: string): string {
  return nextNumber(
    entities.collections,
    "RCP",
    collectionDate.slice(0, 4),
    "receiptNumber"
  );
}

function serializeLines(lines: BillingLine[]): string {
  const encoded = JSON.stringify(lines);
  if (encoded.length > MAX_LINES_JSON)
    throw new Error("تفاصيل البنود تتجاوز الحد المسموح للوثيقة");
  return encoded;
}

function assertExistingReceivable(
  entities: EntityMap,
  input: BillingInput,
  totals: BillingTotals,
  leaseContext: LeaseContext
): DemoEntity | undefined {
  const receivableId = text(input.existingReceivableId);
  if (!receivableId) return undefined;

  const receivable = entities.receivables.find(row => row.id === receivableId);
  if (!receivable) throw new Error("الاستحقاق المرتبط غير موجود");
  if (!isActiveReceivable(receivable))
    throw new Error("الاستحقاق ملغى ولا يقبل فاتورة أو مطالبة جديدة");
  const recordedDue =
    text(receivable.meta.dueDate) || text(receivable.meta.due);
  const dueDate = recordedDue || receivable.date;
  const receiverParty =
    text(receivable.meta.tenantName) ||
    text(receivable.meta.tenant) ||
    text(leaseContext.lease?.meta.tenantName) ||
    text(leaseContext.lease?.meta.tenant) ||
    text(leaseContext.tenant?.title);
  if (
    receivable.portfolioId !== input.portfolioId ||
    receivable.propertyId !== leaseContext.property.id ||
    text(receivable.meta.unitId) !== (leaseContext.unit?.id ?? "") ||
    text(receivable.meta.leaseId) !== (leaseContext.lease?.id ?? "") ||
    receivable.amountMinor !== totals.totalMinor ||
    receivable.date !== input.dueDate ||
    dueDate !== input.dueDate ||
    (recordedDue !== "" && recordedDue !== receivable.date) ||
    (receiverParty !== "" && receiverParty !== leaseContext.partyName)
  ) {
    throw new Error(
      "بيانات الاستحقاق المرتبط لا تطابق مبلغ أو تاريخ أو طرف الوثيقة"
    );
  }
  if (
    entities.documents.some(
      row =>
        isBillingDocument(row) &&
        isActiveBillingDocument(row) &&
        text(row.meta.receivableId) === receivable.id
    )
  ) {
    throw new Error("توجد وثيقة فوترة نشطة لهذا الاستحقاق بالفعل");
  }
  return receivable;
}

function newReceivable(
  input: BillingInput,
  totals: BillingTotals,
  leaseContext: LeaseContext
): DemoEntity {
  const meta: DemoEntity["meta"] = {
    leaseId: leaseContext.lease?.id ?? "",
    unitId: leaseContext.unit?.id ?? "",
    tenantId: leaseContext.tenant?.id ?? "",
    tenant: leaseContext.partyName,
    due: input.dueDate,
    issueDate: input.issueDate,
    source: "وثيقة فوترة محلية في البروتوتايب",
  };
  assertMeta(meta);
  return {
    id: crypto.randomUUID(),
    title: `استحقاق ${leaseContext.unit?.title ?? leaseContext.property.title} · نموذج`,
    subtitle: leaseContext.partyName,
    portfolioId: input.portfolioId,
    propertyId: leaseContext.property.id,
    status: "مستحق",
    date: input.dueDate,
    amountMinor: totals.totalMinor,
    currency: "QAR",
    meta,
  };
}

function newDocument(
  input: BillingInput,
  totals: BillingTotals,
  linesJson: string,
  number: string,
  propertyId: string,
  receivableId: string,
  tenantId: string,
  vendorId: string
): DemoEntity {
  const meta: DemoEntity["meta"] = {
    recordType: BILLING_RECORD_TYPE,
    requestId: text(input.requestId),
    requestSourceReceivableId: text(input.existingReceivableId),
    kind: input.kind,
    number,
    issuerName: input.issuerName,
    partyName: input.partyName,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    lines: linesJson,
    subtotalMinor: totals.subtotalMinor,
    feeMinor: totals.feeMinor,
    discountMinor: totals.discountMinor,
    totalMinor: totals.totalMinor,
    taxMinor: 0,
    notes: input.notes,
    receivableId,
    unitId: input.unitId,
    leaseId: input.leaseId,
    tenantId,
    vendorId,
    prototype: true,
    source: "إصدار محلي تجريبي، لا يمثل مستندًا حقيقيًا أو مطالبة فعلية",
  };
  assertMeta(meta);

  const kindTitle =
    input.kind === "invoice"
      ? "فاتورة"
      : input.kind === "payment-request"
        ? "طلب دفع"
        : "أمر شراء";
  return {
    id: crypto.randomUUID(),
    title: `${kindTitle} ${number} · نموذج`,
    subtitle: "سجل محلي للبروتوتايب فقط",
    portfolioId: input.portfolioId,
    propertyId,
    status: "صادر محليًا · نموذج غير حقيقي",
    date: input.issueDate,
    amountMinor: totals.totalMinor,
    currency: "QAR",
    meta,
  };
}

/**
 * Issues a local prototype billing document. The transition is atomic: all
 * validation completes before the document or (for a new invoice/request)
 * exactly one receivable is appended.
 */
export function issueBillingDocument(
  state: PrototypeState,
  input: BillingInput
): IssueBillingResult {
  assertOperator(state);
  if (!input || !isBillingKind(input.kind))
    throw new Error("نوع الوثيقة غير صحيح");

  const portfolioId = idText(input.portfolioId, "المحفظة");
  findPortfolio(state.entities, portfolioId);
  assertSelectedScope(state, portfolioId);

  const issueDate = assertDate(input.issueDate, "تاريخ الإصدار");
  const dueDate = assertDate(input.dueDate, "تاريخ الاستحقاق");
  if (dueDate < issueDate)
    throw new Error("تاريخ الاستحقاق لا يسبق تاريخ الإصدار");

  const issuerName = requiredText(
    input.issuerName,
    "اسم الجهة المصدرة",
    MAX_PARTY_NAME
  );
  const partyName = requiredText(input.partyName, "اسم الطرف", MAX_PARTY_NAME);
  const notes = text(input.notes);
  if (notes.length > MAX_NOTES)
    throw new Error("الملاحظات تتجاوز الحد المسموح");
  const lines = validateLines(input.lines);
  const totals = calculateBillingTotals(
    lines,
    input.feeMinor ?? 0,
    input.discountMinor ?? 0
  );
  if (totals.totalMinor <= 0)
    throw new Error("إجمالي الوثيقة يجب أن يكون موجبًا");
  const linesJson = serializeLines(lines);

  // Keep normalized values in the generated record without mutating caller input.
  const normalizedInput: BillingInput = {
    ...input,
    portfolioId,
    issueDate,
    dueDate,
    issuerName,
    partyName,
    notes,
    lines,
    feeMinor: totals.feeMinor,
    discountMinor: totals.discountMinor,
  };

  const requestId = text(input.requestId);
  if (requestId.length > 128) throw new Error("معرف عملية الإصدار غير صالح");
  const previousRequest = requestId
    ? state.entities.documents.find(
        row => isBillingDocument(row) && row.meta.requestId === requestId
      )
    : undefined;
  if (previousRequest) {
    if (
      previousRequest.portfolioId !== portfolioId ||
      previousRequest.propertyId !== text(input.propertyId) ||
      previousRequest.meta.kind !== input.kind ||
      previousRequest.meta.partyName !== partyName ||
      previousRequest.meta.issuerName !== issuerName ||
      previousRequest.meta.issueDate !== issueDate ||
      previousRequest.meta.dueDate !== dueDate ||
      previousRequest.meta.lines !== linesJson ||
      previousRequest.meta.feeMinor !== totals.feeMinor ||
      previousRequest.meta.discountMinor !== totals.discountMinor ||
      previousRequest.meta.notes !== notes ||
      text(previousRequest.meta.requestSourceReceivableId) !==
        text(input.existingReceivableId) ||
      (text(input.unitId) &&
        text(previousRequest.meta.unitId) !== text(input.unitId)) ||
      text(previousRequest.meta.leaseId) !== text(input.leaseId) ||
      text(previousRequest.meta.vendorId) !== text(input.vendorId)
    )
      throw new Error(
        "سبق إصدار هذه العملية ببيانات مختلفة؛ افتح إصدارًا جديدًا"
      );
    return { state, document: previousRequest };
  }

  if (normalizedInput.kind === "lpo") {
    if (text(normalizedInput.existingReceivableId))
      throw new Error("أمر الشراء لا يمكن ربطه باستحقاق إيجاري");
    if (text(normalizedInput.unitId) || text(normalizedInput.leaseId))
      throw new Error("أمر الشراء لا يرتبط بوحدة أو عقد إيجار");

    const property = findProperty(
      state.entities,
      portfolioId,
      normalizedInput.propertyId,
      false
    );
    const vendorId = idText(normalizedInput.vendorId, "المورد");
    const vendor = state.entities.vendors.find(row => row.id === vendorId);
    if (!vendor || vendor.portfolioId !== portfolioId)
      throw new Error("المورد غير موجود أو لا يتبع المحفظة");
    if (partyName !== vendor.title)
      throw new Error("اسم الطرف لا يطابق المورد المحدد");

    const document = newDocument(
      normalizedInput,
      totals,
      linesJson,
      billingNumber(state.entities, normalizedInput.kind, issueDate),
      property?.id ?? "",
      "",
      "",
      vendor.id
    );
    return {
      state: {
        ...state,
        entities: {
          ...state.entities,
          documents: [...state.entities.documents, document],
        },
      },
      document,
    };
  }

  if (text(normalizedInput.vendorId))
    throw new Error("المورد يخص أمر الشراء فقط");
  const property = findProperty(
    state.entities,
    portfolioId,
    normalizedInput.propertyId
  )!;
  const leaseContext = findLeaseContext(
    state.entities,
    normalizedInput,
    portfolioId,
    property,
    partyName
  );
  normalizedInput.unitId = leaseContext.unit?.id ?? "";
  normalizedInput.leaseId = leaseContext.lease?.id ?? "";
  const existingReceivable = assertExistingReceivable(
    state.entities,
    normalizedInput,
    totals,
    leaseContext
  );
  const receivable =
    existingReceivable ?? newReceivable(normalizedInput, totals, leaseContext);
  const document = newDocument(
    normalizedInput,
    totals,
    linesJson,
    billingNumber(state.entities, normalizedInput.kind, issueDate),
    property.id,
    receivable.id,
    leaseContext.tenant?.id ?? "",
    ""
  );

  return {
    state: {
      ...state,
      entities: {
        ...state.entities,
        receivables: existingReceivable
          ? state.entities.receivables
          : [...state.entities.receivables, receivable],
        documents: [...state.entities.documents, document],
      },
    },
    document,
  };
}

function validConfirmedCollection(
  row: DemoEntity,
  receivable: DemoEntity
): boolean {
  return (
    confirmed(row) &&
    isMinorAmount(row.amountMinor) &&
    row.amountMinor > 0 &&
    text(row.meta.receivableId) === receivable.id &&
    row.portfolioId === receivable.portfolioId &&
    row.propertyId === receivable.propertyId
  );
}

function associatedReceivable(
  entities: EntityMap,
  document: DemoEntity
): DemoEntity | undefined {
  const receivableId = text(document.meta.receivableId);
  if (!receivableId) return undefined;
  return entities.receivables.find(row => row.id === receivableId);
}

/** Records a confirmed cash/transfer collection against an invoice or payment request. */
export function collectBillingDocument(
  state: PrototypeState,
  input: CollectBillingInput
): CollectBillingResult {
  assertOperator(state);
  const documentId = idText(input?.documentId, "الوثيقة");
  const document = state.entities.documents.find(row => row.id === documentId);
  if (!document || !isBillingDocument(document))
    throw new Error("وثيقة الفوترة غير موجودة");
  if (document.meta.kind === "lpo")
    throw new Error("أمر الشراء لا يقبل تحصيلًا");
  assertSelectedScope(state, document.portfolioId);
  if (input.method !== "نقد" && input.method !== "تحويل")
    throw new Error("طريقة التحصيل يجب أن تكون نقدًا أو تحويلًا");
  if (!validCollectionDate(input.collectionDate))
    throw new Error("أدخل تاريخ تحصيل صحيحًا");
  if (!isMinorAmount(input.amountMinor) || input.amountMinor <= 0)
    throw new Error("مبلغ التحصيل غير صحيح");
  if (!isMinorAmount(input.expectedRemainingMinor))
    throw new Error("المبلغ المتبقي المتوقع غير صحيح");

  const receivable = associatedReceivable(state.entities, document);
  if (!receivable || receivable.portfolioId !== document.portfolioId)
    throw new Error("الاستحقاق المرتبط بالوثيقة غير موجود");
  const remainingMinor = outstandingFor(state.entities, receivable.id);
  if (input.expectedRemainingMinor !== remainingMinor)
    throw new Error("تغير المبلغ المتبقي؛ راجع البيانات قبل تأكيد التحصيل");
  if (input.amountMinor > remainingMinor)
    throw new Error("المبلغ يتجاوز المتبقي أو سبق تسجيل تحصيله");

  // applyCollectionEntries owns the confirmed-ledger status transition.
  const collected = applyCollectionEntries(
    state,
    [{ receivableId: receivable.id, amountMinor: input.amountMinor }],
    {
      method: input.method,
      status: "محصّل",
      collectionDate: input.collectionDate,
    }
  );
  const created = collected.entities.collections.at(-1);
  if (!created) throw new Error("تعذر إنشاء إيصال التحصيل المحلي");

  const number = receiptNumber(state.entities, input.collectionDate);
  const sourceView = getBillingView(state.entities, document);
  const receipt: DemoEntity = {
    ...created,
    meta: {
      ...created.meta,
      documentId: document.id,
      receiptNumber: number,
      remainingAfterCollectionMinor: remainingMinor - input.amountMinor,
      receiptIssuerName: sourceView.issuerName,
      receiptPartyName: sourceView.partyName,
      receiptPropertyTitle: sourceView.propertyTitle,
      receiptUnitTitle: sourceView.unitTitle,
      receiptDocumentNumber: sourceView.number,
      source: "تحصيل محلي مؤكد في البروتوتايب · ليس تأكيدًا بنكيًا",
    },
  };
  assertMeta(receipt.meta);
  const collections = [...collected.entities.collections];
  collections[collections.length - 1] = receipt;

  return {
    state: {
      ...collected,
      entities: { ...collected.entities, collections },
    },
    receipt,
  };
}

function parseLines(document: DemoEntity): BillingLine[] {
  const raw = document.meta.lines;
  if (typeof raw !== "string" || raw.length > MAX_LINES_JSON) return [];
  try {
    return validateLines(JSON.parse(raw));
  } catch {
    return [];
  }
}

function storedMinor(
  document: DemoEntity,
  key: string,
  fallback: number
): number {
  const value = document.meta[key];
  return isMinorAmount(value) ? value : fallback;
}

function documentTotals(
  document: DemoEntity,
  lines: BillingLine[]
): BillingTotals {
  const subtotalFallback = lines.reduce((sum, line) => {
    try {
      return safeAdd(sum, safeMultiply(line.quantity, line.unitPriceMinor));
    } catch {
      return sum;
    }
  }, 0);
  const subtotalMinor = storedMinor(
    document,
    "subtotalMinor",
    subtotalFallback
  );
  const feeMinor = storedMinor(document, "feeMinor", 0);
  const discountMinor = storedMinor(document, "discountMinor", 0);
  const totalFallback =
    feeMinor <= MAX_MINOR - subtotalMinor &&
    discountMinor <= subtotalMinor + feeMinor
      ? subtotalMinor + feeMinor - discountMinor
      : document.amountMinor;
  return {
    subtotalMinor,
    feeMinor,
    discountMinor,
    totalMinor: storedMinor(document, "totalMinor", totalFallback),
  };
}

function sumValidAmounts(rows: DemoEntity[]): number {
  let result = 0;
  for (const row of rows) {
    if (!isMinorAmount(row.amountMinor) || row.amountMinor <= 0) continue;
    if (result > MAX_MINOR - row.amountMinor) return MAX_MINOR;
    result += row.amountMinor;
  }
  return result;
}

function paymentStatus(
  receivable: DemoEntity | undefined,
  collectedMinor: number,
  lossMinor: number,
  remainingMinor: number,
  today: string
): string {
  if (!receivable) return "لا ينطبق على أمر الشراء";
  if (!isActiveReceivable(receivable)) return "استحقاق ملغى";
  if (remainingMinor <= 0) {
    if (lossMinor > 0) return "مسوّى بخسارة";
    return "مدفوع";
  }
  if (collectedMinor > 0) return "مدفوع جزئيًا";
  const dueDate = text(receivable.meta.due) || receivable.date;
  if (validCollectionDate(today) && dueDate < today) return "متأخر";
  return "مستحق الدفع";
}

function documentNumber(document: DemoEntity): string {
  const number = text(document.meta.number);
  return number || `DOC-${document.id}`;
}

/** Builds a read-only, derived billing document view; it performs no ledger mutation. */
export function getBillingView(
  entities: BillingEntities,
  document: DemoEntity,
  today = PROTOTYPE_DATE
): BillingView {
  if (!isBillingDocument(document)) throw new Error("مستند الفوترة غير صالح");
  const kind = document.meta.kind;
  if (!isBillingKind(kind)) throw new Error("نوع مستند الفوترة غير صالح");
  const lines = parseLines(document);
  const totals = documentTotals(document, lines);
  const receivable = associatedReceivable(entities, document);
  const receipts = receivable
    ? entities.collections.filter(row =>
        validConfirmedCollection(row, receivable)
      )
    : [];
  const losses = receivable
    ? entities.losses.filter(
        row =>
          text(row.meta.receivableId) === receivable.id &&
          isMinorAmount(row.amountMinor) &&
          row.amountMinor > 0
      )
    : [];
  const collectedMinor = sumValidAmounts(receipts);
  const lossMinor = sumValidAmounts(losses);
  const remainingMinor = receivable
    ? outstandingFor(entities, receivable.id)
    : 0;
  const property = entities.properties.find(
    row => row.id === document.propertyId
  );
  const unitId = text(document.meta.unitId) || text(receivable?.meta.unitId);
  const leaseId = text(document.meta.leaseId) || text(receivable?.meta.leaseId);
  const unit = entities.units.find(row => row.id === unitId);
  const lease = entities.leases.find(row => row.id === leaseId);

  return {
    document,
    kind,
    number: documentNumber(document),
    issuerName: text(document.meta.issuerName),
    partyName: text(document.meta.partyName),
    issueDate: text(document.meta.issueDate) || document.date,
    dueDate:
      text(document.meta.dueDate) ||
      text(receivable?.meta.due) ||
      receivable?.date ||
      "",
    propertyTitle: property?.title ?? "-",
    unitTitle: unit?.title ?? "-",
    leaseTitle: lease?.title ?? "-",
    lines,
    totals,
    collectedMinor,
    lossMinor,
    remainingMinor,
    status: paymentStatus(
      receivable,
      collectedMinor,
      lossMinor,
      remainingMinor,
      today
    ),
    notes: text(document.meta.notes),
    receivableId: receivable?.id ?? "",
    receipts,
  };
}

function fallbackReceiptNumber(receipt: DemoEntity): string {
  const year = validCollectionDate(receipt.date)
    ? receipt.date.slice(0, 4)
    : PROTOTYPE_DATE.slice(0, 4);
  return `RCP-${year}-${receipt.id}`;
}

function relatedDocument(
  entities: EntityMap,
  receipt: DemoEntity,
  receivable: DemoEntity
): DemoEntity | undefined {
  const directId = text(receipt.meta.documentId);
  const direct = entities.documents.find(
    row =>
      row.id === directId && isBillingDocument(row) && row.meta.kind !== "lpo"
  );
  if (direct && text(direct.meta.receivableId) === receivable.id) return direct;
  return entities.documents.find(
    row =>
      isBillingDocument(row) &&
      row.meta.kind !== "lpo" &&
      isActiveBillingDocument(row) &&
      text(row.meta.receivableId) === receivable.id
  );
}

/** Returns a printable receipt only for a confirmed, internally valid collection. */
export function getBillingReceiptView(
  entities: BillingEntities,
  collectionId: string,
  asOfDate = new Date().toISOString().slice(0, 10)
): BillingReceiptView {
  const receipt = entities.collections.find(row => row.id === collectionId);
  if (!receipt) throw new Error("إيصال التحصيل غير موجود");
  const receivableId = text(receipt.meta.receivableId);
  const receivable = entities.receivables.find(row => row.id === receivableId);
  if (!receivable || !validConfirmedCollection(receipt, receivable))
    throw new Error("لا يمكن طباعة إيصال لتحصيل غير مؤكد أو غير صالح");
  const document = relatedDocument(entities, receipt, receivable);
  if (!document) throw new Error("لا توجد وثيقة فوترة مرتبطة بهذا التحصيل");

  const view = getBillingView(entities, document);
  const cleared = text(receipt.meta.cleared);
  const date = validCollectionDate(cleared)
    ? cleared
    : validCollectionDate(receipt.date)
      ? receipt.date
      : "";
  const historicalBalance = receipt.meta.remainingAfterCollectionMinor;
  const hasHistoricalBalance = isMinorAmount(historicalBalance);
  return {
    receipt,
    number: text(receipt.meta.receiptNumber) || fallbackReceiptNumber(receipt),
    documentNumber: text(receipt.meta.receiptDocumentNumber) || view.number,
    issuerName: text(receipt.meta.receiptIssuerName) || view.issuerName,
    partyName: text(receipt.meta.receiptPartyName) || view.partyName,
    propertyTitle:
      text(receipt.meta.receiptPropertyTitle) || view.propertyTitle,
    unitTitle: text(receipt.meta.receiptUnitTitle) || view.unitTitle,
    date,
    method: text(receipt.meta.method),
    amountMinor: receipt.amountMinor,
    remainingMinor: hasHistoricalBalance
      ? historicalBalance
      : outstandingFor(entities, receivable.id),
    balanceKind: hasHistoricalBalance ? "historical" : "current",
    balanceAsOf: hasHistoricalBalance ? date : asOfDate,
  };
}
