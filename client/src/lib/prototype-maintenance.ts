import {
  type DemoEntity,
  type EntityMap,
  isMinorAmount,
  type PrototypeState,
} from "@shared/prototype";
import { scenarioDate, validScenarioDate } from "@shared/prototype-clock";

const MAX_ID_LENGTH = 96;
const MAX_TITLE_LENGTH = 256;
const MAX_CATEGORY_LENGTH = 120;
const MAX_META_MINOR = 1_000_000_000_000;
const AUDIT_LIMIT = 300;

export type MaintenanceClassification = "تشغيلي" | "رأسمالي";

export type CreateMaintenanceRequestInput = {
  requestId: string;
  title: string;
  propertyId: string;
  unitId?: string;
  priority: string;
  capMinor: number;
};

export type LinkMaintenanceCostInput = {
  maintenanceId: string;
  costMinor: number;
  expenseDate?: string;
  classification: MaintenanceClassification;
  category: string;
};

export type CreatePreventiveScheduleInput = {
  requestId: string;
  title: string;
  propertyId: string;
  unitId?: string;
  cadence: string;
  nextDate?: string;
  warranty?: string;
};

type MaintenanceTransition<T> = {
  state: PrototypeState;
  result: T;
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

function requiredId(value: unknown, label: string): string {
  return requiredText(value, label, MAX_ID_LENGTH);
}

function assertOperator(state: PrototypeState): void {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
}

function assertOwner(state: PrototypeState): void {
  if (state.settings.role !== "owner")
    throw new Error("اعتماد طلب الصيانة متاح لمعاينة دور المالك فقط");
}

function actualUtc(): string {
  return new Date().toISOString();
}

function addAudit(
  state: PrototypeState,
  id: string,
  title: string,
  detail: string
): PrototypeState {
  return {
    ...state,
    audit: [{ id, at: actualUtc(), title, detail }, ...state.audit].slice(
      0,
      AUDIT_LIMIT
    ),
  };
}

function replaceEntity(
  state: PrototypeState,
  kind: "maintenance" | "preventive",
  id: string,
  next: DemoEntity
): PrototypeState {
  return {
    ...state,
    entities: {
      ...state.entities,
      [kind]: state.entities[kind].map(row => (row.id === id ? next : row)),
    },
  };
}

function scopeFor(
  entities: EntityMap,
  propertyId: string,
  unitId?: string
): { portfolio: DemoEntity; property: DemoEntity; unit?: DemoEntity } {
  const property = entities.properties.find(
    row => row.id === requiredId(propertyId, "العقار")
  );
  if (!property) throw new Error("العقار المحدد غير موجود");

  const portfolio = entities.portfolios.find(
    row => row.id === property.portfolioId
  );
  if (!portfolio)
    throw new Error("العقار المحدد لا يتبع محفظة صالحة؛ لم يُنشأ سجل");

  const selectedUnitId = text(unitId);
  if (!selectedUnitId) return { portfolio, property };
  const unit = entities.units.find(row => row.id === selectedUnitId);
  if (
    !unit ||
    unit.propertyId !== property.id ||
    unit.portfolioId !== property.portfolioId
  ) {
    throw new Error("الوحدة يجب أن تتبع العقار والمحفظة المستخلصين منه");
  }
  return { portfolio, property, unit };
}

function assertSelectedPortfolio(
  state: PrototypeState,
  portfolioId: string
): void {
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة");
  }
}

function maintenanceById(
  state: PrototypeState,
  maintenanceId: string
): DemoEntity {
  const id = requiredId(maintenanceId, "طلب الصيانة");
  const request = state.entities.maintenance.find(row => row.id === id);
  if (!request) throw new Error("طلب الصيانة غير موجود");
  return request;
}

function sourceEventIdFor(maintenanceId: string): string {
  return `maintenance-expense:${maintenanceId}`;
}

function expenseDateFor(state: PrototypeState, value?: string): string {
  const date = text(value) || scenarioDate(state);
  if (!validScenarioDate(date)) throw new Error("تاريخ المصروف غير صالح");
  return date;
}

function classificationFlags(classification: MaintenanceClassification) {
  if (classification !== "تشغيلي" && classification !== "رأسمالي")
    throw new Error("اختر تصنيفًا تشغيليًا أو رأسماليًا للتكلفة");
  return {
    capex: classification === "رأسمالي",
    opex: classification === "تشغيلي",
  };
}

function costFrom(request: DemoEntity): number {
  const value = request.meta.costMinor;
  if (
    typeof value !== "number" ||
    !isMinorAmount(value) ||
    value === 0 ||
    value > MAX_META_MINOR
  ) {
    throw new Error("اربط تكلفة معتمدة موجبة قبل إثبات إنجاز العمل");
  }
  return value;
}

function exactRequest(
  row: DemoEntity,
  input: CreateMaintenanceRequestInput,
  portfolioId: string,
  unitId: string
): boolean {
  return (
    row.title === input.title.trim() &&
    row.portfolioId === portfolioId &&
    row.propertyId === input.propertyId.trim() &&
    text(row.meta.unitId) === unitId &&
    text(row.meta.priority) === input.priority.trim() &&
    row.amountMinor === input.capMinor &&
    Number(row.meta.capMinor) === input.capMinor
  );
}

/**
 * Creates one local maintenance request at an explicitly selected property.
 * The portfolio is always derived from that property, never from the active
 * "all portfolios" filter or the first portfolio in the snapshot.
 */
export function createMaintenanceRequest(
  state: PrototypeState,
  input: CreateMaintenanceRequestInput
): MaintenanceTransition<{ request: DemoEntity; created: boolean }> {
  assertOperator(state);
  const requestId = requiredId(input.requestId, "معرف طلب الصيانة");
  const title = requiredText(input.title, "وصف الطلب", MAX_TITLE_LENGTH);
  const priority = requiredText(input.priority, "الأولوية", 40);
  if (
    !isMinorAmount(input.capMinor) ||
    input.capMinor === 0 ||
    input.capMinor > MAX_META_MINOR
  )
    throw new Error("سقف التكلفة يجب أن يكون مبلغًا موجبًا صالحًا");

  const scope = scopeFor(state.entities, input.propertyId, input.unitId);
  assertSelectedPortfolio(state, scope.portfolio.id);
  const unitId = scope.unit?.id ?? "";
  const existing = state.entities.maintenance.find(
    row => row.id === requestId || text(row.meta.requestId) === requestId
  );
  if (existing) {
    if (exactRequest(existing, input, scope.portfolio.id, unitId))
      return { state, result: { request: existing, created: false } };
    throw new Error("معرف طلب الصيانة مستخدم ببيانات مختلفة");
  }

  const request: DemoEntity = {
    id: requestId,
    title,
    subtitle: "طلب صيانة محلي مرتبط بمعرفات العقار؛ لا يمثل بلاغًا خارجيًا.",
    portfolioId: scope.portfolio.id,
    propertyId: scope.property.id,
    status: "طلب جديد",
    date: scenarioDate(state),
    amountMinor: input.capMinor,
    currency: "QAR",
    meta: {
      requestId,
      priority,
      capMinor: input.capMinor,
      unitId,
      vendor: "غير مسند",
    },
  };
  const next = addAudit(
    {
      ...state,
      entities: {
        ...state.entities,
        maintenance: [...state.entities.maintenance, request],
      },
    },
    `maintenance:create:${requestId}`,
    "إنشاء طلب صيانة",
    `طلب ${requestId} مرتبط بالعقار ${scope.property.id} والمحفظة ${scope.portfolio.id}${unitId ? ` والوحدة ${unitId}` : ""}.`
  );
  return { state: next, result: { request, created: true } };
}

/** Moves a newly created request to owner review without issuing any payment. */
export function submitMaintenanceForReview(
  state: PrototypeState,
  maintenanceId: string
): MaintenanceTransition<DemoEntity> {
  assertOperator(state);
  const request = maintenanceById(state, maintenanceId);
  if (request.status === "بانتظار اعتماد") return { state, result: request };
  if (!["طلب جديد", "جديد"].includes(request.status))
    throw new Error("لا يمكن طلب اعتماد إلا لطلب صيانة جديد");

  const nextRequest: DemoEntity = { ...request, status: "بانتظار اعتماد" };
  const next = addAudit(
    replaceEntity(state, "maintenance", request.id, nextRequest),
    `maintenance:review:${request.id}`,
    "إحالة طلب الصيانة للاعتماد",
    `الطلب ${request.id} بانتظار قرار المالك؛ لم يُربط دفع أو مصروف.`
  );
  return { state: next, result: nextRequest };
}

/**
 * Pure owner-only approval transition. The UI applies the resulting status via
 * the context's existing owner-status exception, which does not grant editing.
 */
export function approveMaintenanceRequest(
  state: PrototypeState,
  maintenanceId: string
): MaintenanceTransition<DemoEntity> {
  assertOwner(state);
  const request = maintenanceById(state, maintenanceId);
  if (request.status === "معتمد") return { state, result: request };
  if (!["بانتظار اعتماد", "بانتظار الموافقة"].includes(request.status))
    throw new Error("لا يمكن للمالك اعتماد طلب ليس بانتظار الاعتماد");

  const nextRequest: DemoEntity = { ...request, status: "معتمد" };
  const next = addAudit(
    replaceEntity(state, "maintenance", request.id, nextRequest),
    `maintenance:approve:${request.id}`,
    "اعتماد مالك لطلب صيانة",
    `اعتمد المالك الطلب ${request.id} فقط؛ لا ينشئ الاعتماد مصروفًا أو دفعة.`
  );
  return { state: next, result: nextRequest };
}

/**
 * Stores a reviewed cost before work completion. It never creates an expense,
 * payment, collection, or invoice and rejects a conflicting re-link attempt.
 */
export function linkMaintenanceCost(
  state: PrototypeState,
  input: LinkMaintenanceCostInput
): MaintenanceTransition<DemoEntity> {
  assertOperator(state);
  const request = maintenanceById(state, input.maintenanceId);
  if (request.status !== "معتمد")
    throw new Error("اربط التكلفة بعد اعتماد المالك وقبل إثبات إنجاز العمل");
  if (
    !isMinorAmount(input.costMinor) ||
    input.costMinor === 0 ||
    input.costMinor > MAX_META_MINOR
  )
    throw new Error("التكلفة يجب أن تكون مبلغًا موجبًا صالحًا");
  const category = requiredText(
    input.category,
    "فئة التكلفة",
    MAX_CATEGORY_LENGTH
  );
  const expenseDate = expenseDateFor(state, input.expenseDate);
  const { capex, opex } = classificationFlags(input.classification);
  const sourceEventId = sourceEventIdFor(request.id);
  const existingCost = request.meta.costMinor;
  if (typeof existingCost === "number") {
    const unchanged =
      existingCost === input.costMinor &&
      text(request.meta.expenseDate) === expenseDate &&
      text(request.meta.classification) === input.classification &&
      text(request.meta.category) === category &&
      request.meta.capex === capex &&
      request.meta.opex === opex &&
      text(request.meta.sourceEventId) === sourceEventId;
    if (unchanged) return { state, result: request };
    throw new Error("التكلفة المعتمدة مرتبطة بالفعل؛ لا تعدلها بعد الاعتماد");
  }

  const nextRequest: DemoEntity = {
    ...request,
    meta: {
      ...request.meta,
      costMinor: input.costMinor,
      expenseDate,
      classification: input.classification,
      category,
      capex,
      opex,
      sourceEventId,
    },
  };
  const next = addAudit(
    replaceEntity(state, "maintenance", request.id, nextRequest),
    `maintenance:cost:${request.id}`,
    "ربط تكلفة صيانة معتمدة",
    `ربطت تكلفة ${input.costMinor} للطلب ${request.id}; لم يُنشأ مصروف أو دفع.`
  );
  return { state: next, result: nextRequest };
}

/** Records work completion only after the approved cost link exists. */
export function completeMaintenanceWork(
  state: PrototypeState,
  maintenanceId: string
): MaintenanceTransition<DemoEntity> {
  assertOperator(state);
  const request = maintenanceById(state, maintenanceId);
  if (request.status === "منجز") return { state, result: request };
  if (request.status !== "معتمد")
    throw new Error("لا يمكن إثبات إنجاز العمل قبل اعتماد المالك");
  costFrom(request);

  const nextRequest: DemoEntity = { ...request, status: "منجز" };
  const next = addAudit(
    replaceEntity(state, "maintenance", request.id, nextRequest),
    `maintenance:complete:${request.id}`,
    "إثبات إنجاز عمل صيانة",
    `أُثبت إنجاز الطلب ${request.id}; لا يعني ذلك تسجيل مصروف أو سداد.`
  );
  return { state: next, result: nextRequest };
}

function linkedExpense(
  request: DemoEntity,
  expense: DemoEntity,
  sourceEventId: string,
  costMinor: number,
  expenseDate: string,
  classification: string,
  category: string
): boolean {
  return (
    text(expense.meta.maintenanceId) === request.id &&
    text(expense.meta.sourceEventId) === sourceEventId &&
    expense.portfolioId === request.portfolioId &&
    expense.propertyId === request.propertyId &&
    expense.amountMinor === costMinor &&
    expense.date === expenseDate &&
    text(expense.meta.expenseDate) === expenseDate &&
    text(expense.meta.classification) === classification &&
    text(expense.meta.category) === category &&
    expense.meta.capex === request.meta.capex &&
    expense.meta.opex === request.meta.opex
  );
}

/**
 * Materializes exactly one unpaid expense after work completion. This records a
 * bill/accrual only; settlement must happen as a separate action in Expenses.
 */
export function materializeMaintenanceExpense(
  state: PrototypeState,
  maintenanceId: string
): MaintenanceTransition<{
  request: DemoEntity;
  expense: DemoEntity;
  created: boolean;
}> {
  assertOperator(state);
  const request = maintenanceById(state, maintenanceId);
  const costMinor = costFrom(request);
  const expenseDate = text(request.meta.expenseDate);
  const classification = text(request.meta.classification);
  const category = text(request.meta.category);
  const sourceEventId = text(request.meta.sourceEventId);
  const expenseId = `expense-${request.id}`;
  if (
    !expenseDate ||
    !validScenarioDate(expenseDate) ||
    !classification ||
    !category ||
    !sourceEventId
  )
    throw new Error("بيانات التكلفة المرتبطة غير مكتملة؛ لم يُنشأ مصروف");
  if (sourceEventId !== sourceEventIdFor(request.id))
    throw new Error("معرف حدث تكلفة الصيانة غير متسق");

  const related = state.entities.expenses.filter(
    row =>
      text(row.meta.maintenanceId) === request.id ||
      text(row.meta.sourceEventId) === sourceEventId ||
      row.id === expenseId
  );
  const linkedExpenseId = text(request.meta.expenseId);
  if (related.length) {
    const soleExpense = related.length === 1 ? related[0] : undefined;
    if (
      soleExpense &&
      linkedExpenseId === soleExpense.id &&
      linkedExpense(
        request,
        soleExpense,
        sourceEventId,
        costMinor,
        expenseDate,
        classification,
        category
      )
    ) {
      return {
        state,
        result: { request, expense: soleExpense, created: false },
      };
    }
    throw new Error(
      "علاقة المصروف بطلب الصيانة غير مكتملة أو مكررة؛ لم يُنشأ مصروف آخر"
    );
  }
  if (linkedExpenseId || request.status === "مصروف مستحق")
    throw new Error(
      "علاقة المصروف بطلب الصيانة غير مكتملة؛ لم يُنشأ مصروف آخر"
    );
  if (request.status !== "منجز")
    throw new Error("أنشئ المصروف بعد إثبات إنجاز العمل فقط");

  const expense: DemoEntity = {
    id: expenseId,
    title: `مصروف صيانة • ${request.title}`,
    subtitle:
      "استحقاق صيانة محلي غير مسدد؛ لا يعني قبضًا أو تحويلًا أو فاتورة خارجية.",
    portfolioId: request.portfolioId,
    propertyId: request.propertyId,
    status: "غير مسدد",
    date: expenseDate,
    amountMinor: costMinor,
    currency: "QAR",
    meta: {
      maintenanceId: request.id,
      sourceEventId,
      expenseDate,
      classification,
      category,
      capex: request.meta.capex === true,
      opex: request.meta.opex === true,
      settlement: "ذمم موردين",
      paymentStatus: "غير مسدد",
      unitId: text(request.meta.unitId),
    },
  };
  const nextRequest: DemoEntity = {
    ...request,
    status: "مصروف مستحق",
    meta: {
      ...request.meta,
      expenseId: expense.id,
      expenseStatus: "غير مسدد",
    },
  };
  const withRecords: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      maintenance: state.entities.maintenance.map(row =>
        row.id === request.id ? nextRequest : row
      ),
      expenses: [...state.entities.expenses, expense],
    },
  };
  const next = addAudit(
    withRecords,
    `maintenance:expense:${request.id}`,
    "إنشاء مصروف صيانة مستحق",
    `أنشئ المصروف ${expense.id} للطلب ${request.id} بحالة غير مسدد؛ لم تُنشأ دفعة أو حركة نقدية.`
  );
  return {
    state: next,
    result: { request: nextRequest, expense, created: true },
  };
}

function paymentSourceEventIdFor(expenseId: string): string {
  return `maintenance-payment:${expenseId}`;
}

function exactMaintenancePayment(
  payment: DemoEntity,
  expense: DemoEntity,
  request: DemoEntity,
  paymentDate: string,
  paymentMethod: string,
  requestId: string
): boolean {
  return (
    payment.id === `payment-${requestId}` &&
    payment.portfolioId === expense.portfolioId &&
    payment.propertyId === expense.propertyId &&
    payment.amountMinor === expense.amountMinor &&
    payment.date === paymentDate &&
    text(payment.meta.expenseId) === expense.id &&
    text(payment.meta.maintenanceId) === request.id &&
    text(payment.meta.requestId) === requestId &&
    text(payment.meta.paymentMethod) === paymentMethod &&
    text(payment.meta.sourceEventId) === paymentSourceEventIdFor(expense.id) &&
    text(payment.meta.expenseSourceEventId) === text(expense.meta.sourceEventId)
  );
}

/**
 * Records one explicit local settlement for an already materialized maintenance
 * expense. It is not a gateway call, bank transfer, or automatic consequence
 * of a maintenance-status change. A retry with the same idempotency key returns
 * the same settled expense and local record; another payment relation is refused.
 */
export function payMaintenanceExpense(
  state: PrototypeState,
  expenseId: string,
  paymentDate: string,
  paymentMethod: string,
  requestId: string
): MaintenanceTransition<{
  request: DemoEntity;
  expense: DemoEntity;
  payment: DemoEntity;
  created: boolean;
}> {
  assertOperator(state);
  const normalizedExpenseId = requiredText(expenseId, "معرف المصروف", 128);
  const normalizedRequestId = requiredId(requestId, "معرف طلب التسوية");
  const normalizedPaymentDate = requiredText(paymentDate, "تاريخ السداد", 10);
  if (!validScenarioDate(normalizedPaymentDate))
    throw new Error("تاريخ السداد غير صالح");
  const normalizedMethod = requiredText(paymentMethod, "طريقة السداد", 80);
  const expense = state.entities.expenses.find(
    row => row.id === normalizedExpenseId
  );
  if (!expense) throw new Error("مصروف الصيانة غير موجود");

  const maintenanceId = text(expense.meta.maintenanceId);
  if (!maintenanceId)
    throw new Error("علاقة مصروف الصيانة غير مكتملة؛ لا يمكن تسجيل السداد");
  const request = maintenanceById(state, maintenanceId);
  assertSelectedPortfolio(state, expense.portfolioId);
  if (request.status !== "مصروف مستحق")
    throw new Error("لا يمكن تسجيل السداد قبل إنشاء مصروف صيانة مستحق");
  const expenseSourceEventId = text(expense.meta.sourceEventId);
  const expectedExpenseSourceEventId = sourceEventIdFor(request.id);
  const linkedExpenses = state.entities.expenses.filter(
    row =>
      row.id === expense.id ||
      text(row.meta.maintenanceId) === request.id ||
      text(row.meta.sourceEventId) === expectedExpenseSourceEventId
  );
  if (
    linkedExpenses.length !== 1 ||
    text(request.meta.expenseId) !== expense.id ||
    expenseSourceEventId !== expectedExpenseSourceEventId ||
    !linkedExpense(
      request,
      expense,
      expectedExpenseSourceEventId,
      costFrom(request),
      text(request.meta.expenseDate),
      text(request.meta.classification),
      text(request.meta.category)
    )
  ) {
    throw new Error(
      "علاقة المصروف وحدث الصيانة غير مكتملة أو مكررة؛ لا يمكن تسجيل السداد"
    );
  }

  const paymentId = `payment-${normalizedRequestId}`;
  const settlementSourceEventId = paymentSourceEventIdFor(expense.id);
  const relatedPayments = state.entities.payments.filter(
    row =>
      row.id === paymentId ||
      text(row.meta.expenseId) === expense.id ||
      text(row.meta.requestId) === normalizedRequestId ||
      text(row.meta.sourceEventId) === settlementSourceEventId
  );
  if (expense.status === "مسدد") {
    const existing =
      relatedPayments.length === 1 ? relatedPayments[0] : undefined;
    if (
      existing &&
      exactMaintenancePayment(
        existing,
        expense,
        request,
        normalizedPaymentDate,
        normalizedMethod,
        normalizedRequestId
      ) &&
      text(expense.meta.paymentId) === existing.id &&
      text(expense.meta.paidDate) === normalizedPaymentDate &&
      text(expense.meta.paymentMethod) === normalizedMethod &&
      expense.meta.paymentStatus === "مسدد" &&
      request.meta.expenseStatus === "مسدد"
    ) {
      return {
        state,
        result: { request, expense, payment: existing, created: false },
      };
    }
    throw new Error("المصروف مسدد بالفعل أو أن سجل التسوية غير مكتمل");
  }
  if (
    expense.status !== "غير مسدد" ||
    expense.meta.paymentStatus !== "غير مسدد"
  ) {
    throw new Error("لا يمكن تسجيل السداد إلا لمصروف صيانة غير مسدد");
  }
  if (relatedPayments.length)
    throw new Error(
      "توجد علاقة تسوية مكررة أو جزئية للمصروف؛ لم يُنشأ سجل آخر"
    );

  const payment: DemoEntity = {
    id: paymentId,
    title: `تسوية محلية • ${expense.title}`,
    subtitle:
      "إثبات سداد محلي داخل البروتوتايب؛ لا يرسل تحويلًا أو طلبًا إلى مزود دفع.",
    portfolioId: expense.portfolioId,
    propertyId: expense.propertyId,
    status: "تسوية محلية مسجلة",
    date: normalizedPaymentDate,
    amountMinor: expense.amountMinor,
    currency: "QAR",
    meta: {
      expenseId: expense.id,
      maintenanceId: request.id,
      requestId: normalizedRequestId,
      paymentMethod: normalizedMethod,
      sourceEventId: settlementSourceEventId,
      expenseSourceEventId,
      externalTransfer: false,
    },
  };
  const settledExpense: DemoEntity = {
    ...expense,
    status: "مسدد",
    meta: {
      ...expense.meta,
      paymentStatus: "مسدد",
      paymentId: payment.id,
      paidDate: normalizedPaymentDate,
      paymentMethod: normalizedMethod,
    },
  };
  const settledRequest: DemoEntity = {
    ...request,
    meta: {
      ...request.meta,
      expenseStatus: "مسدد",
      paymentId: payment.id,
      paidDate: normalizedPaymentDate,
    },
  };
  const withSettlement: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      maintenance: state.entities.maintenance.map(row =>
        row.id === request.id ? settledRequest : row
      ),
      expenses: state.entities.expenses.map(row =>
        row.id === expense.id ? settledExpense : row
      ),
      payments: [...state.entities.payments, payment],
    },
  };
  const next = addAudit(
    withSettlement,
    `maintenance:pay:${normalizedRequestId}`,
    "تسجيل سداد محلي لمصروف صيانة",
    `سُوي المصروف ${expense.id} صوريًا في ${normalizedPaymentDate} بطريقة ${normalizedMethod}; لا يوجد تحويل أو مزود دفع خارجي.`
  );
  return {
    state: next,
    result: {
      request: settledRequest,
      expense: settledExpense,
      payment,
      created: true,
    },
  };
}

/** Creates a preventive schedule with the same explicit property/unit scope. */
export function createPreventiveSchedule(
  state: PrototypeState,
  input: CreatePreventiveScheduleInput
): MaintenanceTransition<{ schedule: DemoEntity; created: boolean }> {
  assertOperator(state);
  const requestId = requiredId(input.requestId, "معرف الدورية الوقائية");
  const title = requiredText(input.title, "وصف الدورية", MAX_TITLE_LENGTH);
  const cadence = requiredText(input.cadence, "التكرار", 40);
  const scope = scopeFor(state.entities, input.propertyId, input.unitId);
  assertSelectedPortfolio(state, scope.portfolio.id);
  const nextDate = expenseDateFor(state, input.nextDate);
  const existing = state.entities.preventive.find(row => row.id === requestId);
  if (existing) {
    const unchanged =
      existing.title === title &&
      existing.portfolioId === scope.portfolio.id &&
      existing.propertyId === scope.property.id &&
      text(existing.meta.unitId) === (scope.unit?.id ?? "") &&
      text(existing.meta.cadence) === cadence &&
      existing.date === nextDate;
    if (unchanged)
      return { state, result: { schedule: existing, created: false } };
    throw new Error("معرف الدورية الوقائية مستخدم ببيانات مختلفة");
  }
  const schedule: DemoEntity = {
    id: requestId,
    title,
    subtitle: "دورية وقائية محلية مرتبطة بعقار محدد؛ لا تؤكد زيارة أو ضمانًا.",
    portfolioId: scope.portfolio.id,
    propertyId: scope.property.id,
    status: "مجدول",
    date: nextDate,
    amountMinor: 0,
    currency: "QAR",
    meta: {
      requestId,
      unitId: scope.unit?.id ?? "",
      cadence,
      warranty: text(input.warranty) || "غير مسجل",
      nextDate,
    },
  };
  const next = addAudit(
    {
      ...state,
      entities: {
        ...state.entities,
        preventive: [...state.entities.preventive, schedule],
      },
    },
    `maintenance:preventive:${requestId}`,
    "إنشاء دورية وقائية",
    `الدورية ${requestId} مرتبطة بالعقار ${scope.property.id} والمحفظة ${scope.portfolio.id}.`
  );
  return { state: next, result: { schedule, created: true } };
}
