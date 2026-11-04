import {
  AuditEvent,
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

export interface ReceivableCollectionDetails {
  receivable: DemoEntity;
  unitTitle: string;
  tenantName: string;
  dueDate: string;
  collectedMinor: number;
  lossMinor: number;
  remainingMinor: number;
  collectedDates: string[];
  pendingMinor: number;
}
export interface MonthlyPropertyCollection {
  property: DemoEntity;
  dues: ReceivableCollectionDetails[];
  expectedMinor: number;
  collectedMinor: number;
  lossMinor: number;
  remainingMinor: number;
}

function sum(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (!isMinorAmount(total)) throw new Error("الإجمالي يتجاوز حد الحساب الآمن");
  return total;
}
export function validCollectionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
  );
}
export function validCollectionMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function getReceivableCollectionDetails(
  entities: EntityMap,
  receivable: DemoEntity
): ReceivableCollectionDetails {
  const receipts = entities.collections.filter(
    row => row.meta.receivableId === receivable.id
  );
  const cleared = receipts.filter(confirmed);
  const unit = entities.units.find(row => row.id === receivable.meta.unitId);
  const lease = entities.leases.find(row => row.id === receivable.meta.leaseId);
  const tenant = entities.tenants.find(
    row =>
      row.id === receivable.meta.tenantId || row.id === lease?.meta.tenantId
  );
  const due = String(receivable.meta.due ?? receivable.date);
  return {
    receivable,
    unitTitle: unit?.title ?? String(lease?.meta.unitId ?? receivable.title),
    tenantName:
      tenant?.title ??
      String(receivable.meta.tenant ?? receivable.subtitle ?? "-"),
    dueDate: validCollectionDate(due) ? due : receivable.date,
    collectedMinor: sum(cleared.map(row => row.amountMinor)),
    lossMinor: sum(
      entities.losses
        .filter(row => row.meta.receivableId === receivable.id)
        .map(row => row.amountMinor)
    ),
    remainingMinor: outstandingFor(entities, receivable.id),
    collectedDates: [
      ...new Set(cleared.map(row => String(row.meta.cleared || row.date))),
    ].sort(),
    pendingMinor: sum(
      receipts
        .filter(
          row => !confirmed(row) && ["مستلم", "مودع"].includes(row.status)
        )
        .map(row => row.amountMinor)
    ),
  };
}

export function getMonthlyPropertyCollections(
  entities: EntityMap,
  portfolioId: string,
  month: string
): MonthlyPropertyCollection[] {
  if (!validCollectionMonth(month)) return [];
  return entities.properties
    .filter(row => portfolioId === "all" || row.portfolioId === portfolioId)
    .map(property => {
      const dues = entities.receivables
        .filter(
          row =>
            row.propertyId === property.id &&
            row.portfolioId === property.portfolioId &&
            isActiveReceivable(row)
        )
        .map(row => getReceivableCollectionDetails(entities, row))
        .filter(row => row.dueDate.slice(0, 7) === month)
        .sort(
          (a, b) =>
            a.dueDate.localeCompare(b.dueDate) ||
            a.unitTitle.localeCompare(b.unitTitle)
        );
      return {
        property,
        dues,
        expectedMinor: sum(dues.map(row => row.receivable.amountMinor)),
        collectedMinor: sum(dues.map(row => row.collectedMinor)),
        lossMinor: sum(dues.map(row => row.lossMinor)),
        remainingMinor: sum(dues.map(row => row.remainingMinor)),
      };
    });
}

export interface ReceiptEntry {
  receivableId: string;
  amountMinor: number;
}
export interface ReceiptOptions {
  method: string;
  status: string;
  collectionDate: string;
}

/** Pure, atomic local ledger transition. No network request or bank verification. */
export function applyCollectionEntries(
  state: PrototypeState,
  entries: ReceiptEntry[],
  options: ReceiptOptions
): PrototypeState {
  if (state.settings.role !== "operator")
    throw new Error("التسجيل متاح لمعاينة الموظف فقط");
  if (!entries.length) throw new Error("لا يوجد مبلغ متبقٍ لتسجيل تحصيله");
  if (!validCollectionDate(options.collectionDate))
    throw new Error("أدخل تاريخ تحصيل صحيحًا");
  if (!options.method.trim()) throw new Error("حدد طريقة التحصيل");
  if (
    !["محصّل", "محصل", "مسوّى", "مستلم", "مودع", "مرتجع"].includes(
      options.status
    )
  )
    throw new Error("حالة التحصيل غير صحيحة");
  if (new Set(entries.map(row => row.receivableId)).size !== entries.length)
    throw new Error("الاستحقاق مكرر في العملية");

  const receipts: DemoEntity[] = entries.map(entry => {
    const source = state.entities.receivables.find(
      row => row.id === entry.receivableId
    );
    if (!source) throw new Error("الاستحقاق غير موجود");
    if (
      state.settings.portfolioId !== "all" &&
      source.portfolioId !== state.settings.portfolioId
    )
      throw new Error("الاستحقاق خارج المحفظة المختارة");
    if (
      !isMinorAmount(entry.amountMinor) ||
      entry.amountMinor <= 0 ||
      entry.amountMinor > outstandingFor(state.entities, source.id)
    ) {
      throw new Error("المبلغ يتجاوز المتبقي أو سبق تسجيل تحصيله");
    }
    const receipt: DemoEntity = {
      id: crypto.randomUUID(),
      title: `تحصيل • ${source.title}`,
      subtitle: source.subtitle,
      portfolioId: source.portfolioId,
      propertyId: source.propertyId,
      status: options.status,
      date: options.collectionDate,
      amountMinor: entry.amountMinor,
      currency: "QAR",
      meta: {
        receivableId: source.id,
        method: options.method,
        received: options.collectionDate,
        cleared: ["محصّل", "محصل", "مسوّى"].includes(options.status)
          ? options.collectionDate
          : "",
        ...(["محصّل", "محصل", "مسوّى"].includes(options.status)
          ? {
              remainingAfterCollectionMinor:
                outstandingFor(state.entities, source.id) - entry.amountMinor,
            }
          : {}),
        source: "تسجيل يدوي من البروتوتايب",
      },
    };
    return receipt;
  });
  sum(receipts.map(row => row.amountMinor));
  const entities = {
    ...state.entities,
    collections: [...state.entities.collections, ...receipts],
  };
  const affected = new Set(entries.map(entry => entry.receivableId));
  entities.receivables = entities.receivables.map(row => {
    if (
      !affected.has(row.id) ||
      !["محصّل", "محصل", "مسوّى"].includes(options.status)
    )
      return row;
    const detail = getReceivableCollectionDetails(entities, row);
    const status =
      detail.remainingMinor > 0
        ? "محصّل جزئيًا"
        : detail.lossMinor > 0
          ? "معالج بخسارة"
          : "محصّل";
    return { ...row, status };
  });
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    title:
      receipts.length === 1 ? receipts[0].title : "تسجيل تحصيل إيجار الشهر",
    detail: `${receipts.length} استحقاق • ${options.collectionDate} • ${options.method} • تسجيل محلي وليس تأكيدًا بنكيًا`,
  };
  return { ...state, entities, audit: [event, ...state.audit].slice(0, 300) };
}

export function applyPropertyMonthCollection(
  state: PrototypeState,
  propertyId: string,
  month: string,
  method: string,
  collectionDate = PROTOTYPE_DATE,
  expectedRemainingMinor?: number
): PrototypeState {
  if (!validCollectionMonth(month)) throw new Error("اختر شهرًا صحيحًا");
  const target = getMonthlyPropertyCollections(
    state.entities,
    state.settings.portfolioId,
    month
  ).find(row => row.property.id === propertyId);
  if (!target) throw new Error("العقار خارج المحفظة المختارة أو غير موجود");
  if (!target.dues.length)
    throw new Error("لا توجد استحقاقات مسجلة لهذا العقار في الشهر المختار");
  if (target.remainingMinor <= 0)
    throw new Error("سبق تحصيل أو معالجة كل مبلغ هذا الشهر");
  if (
    expectedRemainingMinor !== undefined &&
    target.remainingMinor !== expectedRemainingMinor
  ) {
    throw new Error(
      "تغير المبلغ المتبقي؛ أغلق النافذة وراجع المبلغ المحدث قبل التأكيد"
    );
  }
  return applyCollectionEntries(
    state,
    target.dues
      .filter(row => row.remainingMinor > 0)
      .map(row => ({
        receivableId: row.receivable.id,
        amountMinor: row.remainingMinor,
      })),
    {
      method,
      status: "محصّل",
      collectionDate,
    }
  );
}
