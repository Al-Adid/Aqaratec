import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import type { BillingInput } from "@shared/billing-types";
import {
  activateLease,
  createLease,
  createLeaseVacancy,
  correctLeaseTermination,
  renewLease,
  terminateLease,
} from "./prototype-lease-lifecycle";
import * as leaseLifecycle from "./prototype-lease-lifecycle";
import {
  electricityNumberForRentalTarget,
  createRentalProperty,
  updateRentalProperty,
} from "./prototype-rental";
import {
  generateTemplateLease,
  refreshRenewalTemplateSnapshot,
  getTemplateLeaseView,
  saveLeaseTemplate,
} from "./lease-template-engine";
import {
  collectBillingDocument,
  getBillingReceiptView,
  issueBillingDocument,
} from "./prototype-billing";
import { applyCollectionEntries } from "./prototype-payments";
import * as finance from "./prototype-finance";
import { ledgerFromRecords } from "../pages/operating/FinancePages";
import {
  approveMaintenanceRequest,
  completeMaintenanceWork,
  createMaintenanceRequest,
  linkMaintenanceCost,
  materializeMaintenanceExpense,
  payMaintenanceExpense,
  submitMaintenanceForReview,
} from "./prototype-maintenance";
import {
  loadPrototypeWorkspace,
  writePrototypeWorkspace,
  writePrototypeWorkspaceGuarded,
  type BrowserStorage,
} from "./prototype-workspace-storage";

const SCENARIO_DATE = "2026-10-24";
const OCTOBER = "2026-10";
const QAR_400 = 40_000;
const QAR_600 = 60_000;
const QAR_1000 = 100_000;
const QAR_1200 = 120_000;

type Transition<T> = { state: PrototypeState; result: T };
type OccupancyAt = (
  entities: EntityMap,
  unitId: string,
  asOf: string
) => "occupied" | "vacant" | "reserved" | "unavailable";
type FinancialSummaryAt = (
  entities: EntityMap,
  portfolioId: string,
  period: string,
  asOf: string
) => {
  incomeMinor: number;
  accrualIncomeMinor: number;
  periodClosingAsOf: string;
  periodClosingOutstandingMinor: number;
  currentAsOf: string;
  currentAsOfOutstandingMinor: number;
};

function emptyEntityMap(): EntityMap {
  return Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
}

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار رحلة المرحلة الأولى",
    subtitle: "",
    portfolioId: "",
    propertyId: "",
    status: "نشط",
    date: SCENARIO_DATE,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function initialState(): PrototypeState {
  const entities = emptyEntityMap();
  entities.portfolios = [
    row({
      id: "portfolio-a",
      title: "محفظة ألف",
      portfolioId: "portfolio-a",
      meta: { openingMinor: 0 },
    }),
    row({
      id: "portfolio-b",
      title: "محفظة باء",
      portfolioId: "portfolio-b",
      meta: { openingMinor: 0 },
    }),
  ];
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "all",
      period: "all",
      language: "ar",
      scenarioDate: SCENARIO_DATE,
    },
  };
}

function propertyInput(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "فيلا الاختبار الكاملة",
    portfolioId: "portfolio-a",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "whole",
    unitCount: "1",
    propertyNumber: "001",
    electricityNumber: "00129",
    ...overrides,
  };
}

function addTenant(
  state: PrototypeState,
  id: string,
  title: string,
  propertyId: string,
  unitId: string
): PrototypeState {
  return {
    ...state,
    entities: {
      ...state.entities,
      tenants: [
        ...state.entities.tenants,
        row({
          id,
          title,
          portfolioId: "portfolio-b",
          propertyId,
          status: "نشط",
          meta: { unitId },
        }),
      ],
    },
  };
}

function createAndActivate(
  state: PrototypeState,
  values: Record<string, string>
): Transition<DemoEntity> {
  const draft = createLease(state, values);
  return activateLease(draft.state, draft.result.id, SCENARIO_DATE);
}

function requiredExport<T>(module: object, name: string): T {
  const candidate = (module as Record<string, unknown>)[name];
  expect(candidate, `يلزم تصدير ${name} لرحلة قبول المرحلة الأولى`).toBeTypeOf(
    "function"
  );
  return candidate as T;
}

class MemoryStorage implements BrowserStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface Journey {
  state: PrototypeState;
  wholeProperty: DemoEntity;
  wholeUnit: DemoEntity;
  splitProperty: DemoEntity;
  correctedUnit: DemoEntity;
  invoiceUnit: DemoEntity;
  futureLease: DemoEntity;
  originalLease: DemoEntity;
  originalLeaseBeforeRenewal: DemoEntity;
  originalSnapshot: ReturnType<typeof getTemplateLeaseView>;
  renewedLease: DemoEntity;
  renewedLeaseRetry: DemoEntity;
  terminationCorrectedLease: DemoEntity;
  vacancy: DemoEntity;
  invoice: DemoEntity;
  firstReceipt: DemoEntity;
  secondReceipt: DemoEntity;
  bouncedReceipt: DemoEntity;
  invoiceReceivable: DemoEntity;
  bouncedReceivable: DemoEntity;
  newSnapshot: ReturnType<typeof getTemplateLeaseView>;
}

/**
 * The only fixture in this file. It begins with an empty entity map and executes
 * the real pure transitions in their business order. Every P case rebuilds it,
 * so an earlier test cannot leave hidden state for a later one.
 */
function runJourney(): Journey {
  const whole = createRentalProperty(initialState(), propertyInput());
  const split = createRentalProperty(
    whole.state,
    propertyInput({
      title: "عمارة الاختبار المقسمة",
      portfolioId: "portfolio-b",
      assetType: "building",
      usageType: "residential",
      rentalMode: "units",
      unitCount: "3",
      propertyNumber: "B-003",
      electricityNumber: "B-129",
      requestId: "p01-split-property",
    })
  );
  const wholeUnit = split.state.entities.units.find(
    unit =>
      unit.propertyId === whole.property.id && unit.meta.wholeProperty === true
  );
  const splitUnits = split.state.entities.units.filter(
    unit => unit.propertyId === split.property.id
  );
  if (!wholeUnit || splitUnits.length !== 3) {
    throw new Error("لم تنشئ P01 أهداف التأجير المطلوبة للرحلة");
  }

  const template = saveLeaseTemplate(split.state, {
    requestId: "p01-template",
    name: "قالب رحلة المرحلة الأولى",
    content:
      "المستأجر {{الاسم}}؛ العقار {{رقم_العقار}}؛ الكهرباء {{رقم_الكهرباء}}؛ النوع {{نوع_العقار}}",
    fileName: "phase1-journey.txt",
    defaultRentMinor: QAR_1000,
    defaultTermMonths: 12,
  });
  const generatedOriginal = generateTemplateLease(template.state, {
    requestId: "p02-original-template-lease",
    templateId: template.template.id,
    propertyId: whole.property.id,
    unitId: "",
    tenantName: "مستأجر العقد الأصلي",
    propertyNumber: "001",
    electricityNumber: electricityNumberForRentalTarget(
      template.state.entities,
      whole.property.id,
      wholeUnit.id
    ),
    propertyType: "فيلا",
    startDate: "2026-01-01",
  });
  const originalSnapshot = getTemplateLeaseView(
    generatedOriginal.state.entities,
    generatedOriginal.lease.id
  );
  const activatedOriginal = activateLease(
    generatedOriginal.state,
    generatedOriginal.lease.id,
    SCENARIO_DATE
  );
  const withOriginalProof: PrototypeState = {
    ...activatedOriginal.state,
    entities: {
      ...activatedOriginal.state.entities,
      leases: activatedOriginal.state.entities.leases.map(lease =>
        lease.id === generatedOriginal.lease.id
          ? {
              ...lease,
              meta: {
                ...lease.meta,
                registrationStatus: "مسجل",
                registrationNumber: "OLD-123",
                signedStatus: "موقع",
                signatureProof: "OLD-SIGNATURE",
              },
            }
          : lease
      ),
    },
  };
  const originalLeaseBeforeRenewal = structuredClone(
    withOriginalProof.entities.leases.find(
      lease => lease.id === generatedOriginal.lease.id
    )!
  );

  const renewalTemplate = saveLeaseTemplate(withOriginalProof, {
    templateId: template.template.id,
    requestId: "p05-renewal-template-v2",
    name: "نموذج مصطنع لتجديد1200",
    content:
      "تجديد مصطنع: {{الاسم}} · {{رقم_العقار}} · {{رقم_الكهرباء}} · {{نوع_العقار}}. إيجار1200لمدة12شهرًا، من2026-07-01إلى2027-06-30.",
    defaultRentMinor: QAR_1200,
    defaultTermMonths: 12,
  });
  const renewed = renewLease(
    renewalTemplate.state,
    generatedOriginal.lease.id,
    {
      title: "تجديد مبكر بإيجار جديد",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rent: "1200",
      terminatePrevious: "confirm",
      newTemplateStep: "confirm",
      requestId: "p05-early-renewal",
    }
  );
  const renewedRetry = renewLease(renewed.state, generatedOriginal.lease.id, {
    title: "تجديد مبكر بإيجار جديد",
    startDate: "2026-07-01",
    endDate: "2027-06-30",
    rent: "1200",
    terminatePrevious: "confirm",
    newTemplateStep: "confirm",
    requestId: "p05-early-renewal",
  });
  const renewedSnapshot = refreshRenewalTemplateSnapshot(
    renewed.state,
    renewed.result.id,
    renewalTemplate.template.id,
    "p05-early-renewal-snapshot"
  );
  const activeRenewal = activateLease(
    renewedSnapshot.state,
    renewed.result.id,
    SCENARIO_DATE
  );

  let state = addTenant(
    activeRenewal.state,
    "tenant-correction",
    "مستأجر تصحيح الإنهاء",
    split.property.id,
    splitUnits[0].id
  );
  const activeForCorrection = createAndActivate(state, {
    title: "عقد تصحيح الإنهاء",
    propertyId: split.property.id,
    unitId: splitUnits[0].id,
    tenantId: "tenant-correction",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    rent: "1000",
    requestId: "p06-original",
  });
  const endedInJuly = terminateLease(
    activeForCorrection.state,
    activeForCorrection.result.id,
    {
      effectiveDate: "2026-07-01",
      asOf: SCENARIO_DATE,
      reason: "موعد خروج أولي",
      requestId: "p06-end-july",
    }
  );
  const correctedInOctober = correctLeaseTermination(
    endedInJuly.state,
    activeForCorrection.result.id,
    {
      effectiveDate: "2026-10-01",
      asOf: SCENARIO_DATE,
      reason: "تصحيح موعد الخروج",
      requestId: "p06-correct-october",
    }
  );

  state = addTenant(
    correctedInOctober.state,
    "tenant-future",
    "مستأجر عقد مستقبلي",
    split.property.id,
    splitUnits[0].id
  );
  const futureDraft = createLease(state, {
    title: "عقد يبدأ في يناير 2027",
    propertyId: split.property.id,
    unitId: splitUnits[0].id,
    tenantId: "tenant-future",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
    rent: "1000",
    requestId: "p07-future-lease",
  });
  const activatedFuture = activateLease(
    futureDraft.state,
    futureDraft.result.id,
    SCENARIO_DATE
  );

  state = addTenant(
    activatedFuture.state,
    "tenant-invoice",
    "مستأجر الفاتورة",
    split.property.id,
    splitUnits[2].id
  );
  const activeForInvoice = createAndActivate(state, {
    title: "عقد الفاتورة والتحصيل",
    propertyId: split.property.id,
    unitId: splitUnits[2].id,
    tenantId: "tenant-invoice",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    rent: "1000",
    requestId: "p03-invoice-lease",
  });
  const invoiceReceivable = activeForInvoice.state.entities.receivables.find(
    receivable =>
      receivable.meta.leaseId === activeForInvoice.result.id &&
      String(receivable.meta.due ?? receivable.date) === "2026-10-01"
  );
  const bouncedReceivable = activeForInvoice.state.entities.receivables.find(
    receivable =>
      receivable.meta.leaseId === activeForInvoice.result.id &&
      String(receivable.meta.due ?? receivable.date) === "2026-11-01"
  );
  if (!invoiceReceivable || !bouncedReceivable) {
    throw new Error("لم ينتج تفعيل العقد استحقاقات أكتوبر ونوفمبر المطلوبة");
  }

  const invoiceInput: BillingInput = {
    kind: "invoice",
    requestId: "p03-existing-ar-invoice",
    portfolioId: "portfolio-b",
    propertyId: split.property.id,
    unitId: splitUnits[2].id,
    leaseId: activeForInvoice.result.id,
    existingReceivableId: invoiceReceivable.id,
    partyName: "مستأجر الفاتورة",
    issuerName: "جهة صورية لا تمثل مطالبة فعلية",
    vendorId: "",
    issueDate: "2026-10-01",
    dueDate: "2026-10-01",
    lines: [
      {
        description: invoiceReceivable.title,
        quantity: 1,
        unitPriceMinor: QAR_1000,
      },
    ],
    feeMinor: 0,
    discountMinor: 0,
    notes: "فاتورة محلية مرتبطة بالاستحقاق القائم فقط",
  };
  const issued = issueBillingDocument(activeForInvoice.state, invoiceInput);
  const issuedRetry = issueBillingDocument(issued.state, invoiceInput);
  const firstCollection = collectBillingDocument(issued.state, {
    documentId: issued.document.id,
    amountMinor: QAR_400,
    method: "نقد",
    collectionDate: "2026-10-15",
    expectedRemainingMinor: QAR_1000,
  });
  const secondCollection = collectBillingDocument(firstCollection.state, {
    documentId: issued.document.id,
    amountMinor: QAR_600,
    method: "تحويل",
    collectionDate: "2026-11-02",
    expectedRemainingMinor: QAR_600,
  });
  const bounced = applyCollectionEntries(
    secondCollection.state,
    [{ receivableId: bouncedReceivable.id, amountMinor: QAR_1000 }],
    {
      method: "شيك",
      status: "مرتجع",
      collectionDate: "2026-11-03",
    }
  );
  const bouncedReceipt = bounced.entities.collections.at(-1);
  if (!bouncedReceipt) throw new Error("لم يسجل الشيك المرتجع في الرحلة");

  const scheduledVacancy = createLeaseVacancy(bounced, {
    title: "شغور مجدول في يناير 2027",
    propertyId: split.property.id,
    unitId: splitUnits[2].id,
    startDate: "2027-01-01",
    expectedReadyDate: "2027-01-31",
    reason: "تجهيز بعد نهاية العقد",
    lostIncome: "1000",
    requestId: "p07-january-vacancy",
  });

  const updatedProperty = updateRentalProperty(
    scheduledVacancy.state,
    whole.property.id,
    propertyInput({ electricityNumber: "00999" })
  );
  const newMeter = electricityNumberForRentalTarget(
    updatedProperty.state.entities,
    whole.property.id,
    wholeUnit.id
  );
  const generatedAfterCorrection = generateTemplateLease(
    updatedProperty.state,
    {
      requestId: "p08-template-after-meter-correction",
      templateId: template.template.id,
      propertyId: whole.property.id,
      unitId: "",
      tenantName: "مستأجر وثيقة جديدة",
      propertyNumber: "001",
      electricityNumber: newMeter,
      propertyType: "فيلا",
      startDate: "2027-07-01",
    }
  );

  return {
    state: generatedAfterCorrection.state,
    wholeProperty: whole.property,
    wholeUnit,
    splitProperty: split.property,
    correctedUnit: splitUnits[0],
    invoiceUnit: splitUnits[2],
    futureLease: activatedFuture.result,
    originalLease: generatedOriginal.lease,
    originalLeaseBeforeRenewal,
    originalSnapshot,
    renewedLease: renewedSnapshot.state.entities.leases.find(
      lease => lease.id === renewed.result.id
    )!,
    renewedLeaseRetry: renewedRetry.result,
    terminationCorrectedLease: correctedInOctober.result,
    vacancy: scheduledVacancy.result,
    invoice: issued.document,
    firstReceipt: firstCollection.receipt,
    secondReceipt: secondCollection.receipt,
    bouncedReceipt,
    invoiceReceivable,
    bouncedReceivable,
    newSnapshot: getTemplateLeaseView(
      generatedAfterCorrection.state.entities,
      generatedAfterCorrection.lease.id
    ),
  };
}

describe("رحلة قبول المرحلة الأولى P01-P11 · بيانات صورية فقط", () => {
  it("P01 ينشئ من emptyEntityMap محفظتين وعقارًا كاملاً وعقارًا مقسمًا إلى 3 وحدات", () => {
    const journey = runJourney();
    expect(
      journey.state.entities.portfolios.map(portfolio => portfolio.id)
    ).toEqual(["portfolio-a", "portfolio-b"]);
    expect(
      journey.state.entities.units.filter(
        unit => unit.propertyId === journey.wholeProperty.id
      )
    ).toMatchObject([
      { id: journey.wholeUnit.id, meta: { wholeProperty: true } },
    ]);
    expect(
      journey.state.entities.units
        .filter(unit => unit.propertyId === journey.splitProperty.id)
        .map(unit => unit.meta.unitCode)
    ).toEqual(["U-01", "U-02", "U-03"]);
  });

  it("P02 ينشئ عقدًا من القالب ثم يفعله دون قبض، ويحتفظ بعقد مستقبلي منفصل", () => {
    const journey = runJourney();
    const original = journey.state.entities.leases.find(
      lease => lease.id === journey.originalLease.id
    )!;
    const future = journey.state.entities.leases.find(
      lease => lease.id === journey.futureLease.id
    )!;
    expect(original.meta.lifecycleActivated).toBe(true);
    expect(
      journey.state.entities.receivables.filter(
        receivable => receivable.meta.leaseId === original.id
      )
    ).toHaveLength(12);
    expect(
      journey.state.entities.collections.filter(
        collection => collection.meta.leaseId === original.id
      )
    ).toHaveLength(0);
    expect(future.meta.lifecycleActivated).toBe(true);
    expect(future.meta.startDate).toBe("2027-01-01");
  });

  it("P03 يربط فاتورة باستحقاق قائم مرة واحدة ويحفظ سند 400 برصيد 600 ثم سند 600 برصيد صفر", () => {
    const journey = runJourney();
    const retriedInvoice = issueBillingDocument(journey.state, {
      kind: "invoice",
      requestId: "p03-existing-ar-invoice",
      portfolioId: "portfolio-b",
      propertyId: journey.splitProperty.id,
      unitId: journey.invoiceUnit.id,
      leaseId: journey.invoiceReceivable.meta.leaseId as string,
      existingReceivableId: journey.invoiceReceivable.id,
      partyName: "مستأجر الفاتورة",
      issuerName: "جهة صورية لا تمثل مطالبة فعلية",
      vendorId: "",
      issueDate: "2026-10-01",
      dueDate: "2026-10-01",
      lines: [
        {
          description: journey.invoiceReceivable.title,
          quantity: 1,
          unitPriceMinor: QAR_1000,
        },
      ],
      feeMinor: 0,
      discountMinor: 0,
      notes: "فاتورة محلية مرتبطة بالاستحقاق القائم فقط",
    });
    expect(retriedInvoice.state).toBe(journey.state);
    expect(retriedInvoice.document.id).toBe(journey.invoice.id);
    expect(
      getBillingReceiptView(journey.state.entities, journey.firstReceipt.id)
    ).toMatchObject({
      amountMinor: QAR_400,
      remainingMinor: QAR_600,
      balanceKind: "historical",
    });
    expect(
      getBillingReceiptView(journey.state.entities, journey.secondReceipt.id)
    ).toMatchObject({
      amountMinor: QAR_600,
      remainingMinor: 0,
      balanceKind: "historical",
    });
    expect(
      journey.state.entities.receivables.filter(
        receivable => receivable.id === journey.invoiceReceivable.id
      )
    ).toHaveLength(1);
  });

  it("P04 يسجل الشيك المرتجع كسجل غير نقدي ويبقي ذمته قائمة", () => {
    const journey = runJourney();
    const beforeBouncedChequeCash = finance.financialSummary(
      journey.state.entities,
      "portfolio-b",
      "all"
    ).cashMinor;
    const withoutBouncedCheque: EntityMap = {
      ...journey.state.entities,
      collections: journey.state.entities.collections.filter(
        collection => collection.id !== journey.bouncedReceipt.id
      ),
    };
    expect(finance.confirmed(journey.bouncedReceipt)).toBe(false);
    expect(journey.bouncedReceipt.status).toBe("مرتجع");
    expect(
      finance.outstandingFor(
        journey.state.entities,
        journey.bouncedReceivable.id
      )
    ).toBe(QAR_1000);
    expect(beforeBouncedChequeCash).toBe(
      finance.financialSummary(withoutBouncedCheque, "portfolio-b", "all")
        .cashMinor
    );
  });

  it("P05 يمنع تضاعف ذمة أكتوبر في التجديد المبكر ويحفظ هوية العقد السابق ويدعم إعادة المحاولة", () => {
    const journey = runJourney();
    const october = journey.state.entities.receivables
      .filter(
        receivable =>
          receivable.meta.leaseId === journey.originalLease.id ||
          receivable.meta.leaseId === journey.renewedLease.id
      )
      .filter(
        receivable =>
          String(receivable.meta.due ?? receivable.date) === "2026-10-01"
      );
    expect(
      october.filter(receivable => finance.isActiveReceivable(receivable))
    ).toMatchObject([
      { amountMinor: QAR_1200, meta: { leaseId: journey.renewedLease.id } },
    ]);
    expect(
      october
        .filter(receivable => finance.isActiveReceivable(receivable))
        .reduce((total, receivable) => total + receivable.amountMinor, 0)
    ).toBe(QAR_1200);
    expect(journey.renewedLeaseRetry.id).toBe(journey.renewedLease.id);
    const originalAfterRenewal = journey.state.entities.leases.find(
      lease => lease.id === journey.originalLease.id
    )!;
    expect(originalAfterRenewal.meta.registrationNumber).toBe(
      journey.originalLeaseBeforeRenewal.meta.registrationNumber
    );
    expect(originalAfterRenewal.meta.signatureProof).toBe(
      journey.originalLeaseBeforeRenewal.meta.signatureProof
    );
    const originalSnapshotAfterRenewal = getTemplateLeaseView(
      journey.state.entities,
      journey.originalLease.id
    );
    expect(originalSnapshotAfterRenewal.document.id).toBe(
      journey.originalSnapshot.document.id
    );
    expect(originalSnapshotAfterRenewal.content).toBe(
      journey.originalSnapshot.content
    );
    expect(originalSnapshotAfterRenewal.electricityNumber).toBe("00129");
    expect(journey.renewedLease.meta).toMatchObject({
      priorLeaseId: journey.originalLease.id,
      historicalLeaseRef: journey.originalLease.id,
      registrationStatus: "غير متحقق",
      signedStatus: "مسودة غير موقعة",
    });
    expect(journey.renewedLease.meta.registrationNumber).toBeUndefined();
    expect(journey.renewedLease.meta.signatureProof).toBeUndefined();
    expect(journey.renewedLease.meta.snapshotDocumentId).toBeTruthy();
    expect(journey.renewedLease.meta.snapshotDocumentId).not.toBe(
      journey.originalSnapshot.document.id
    );
  });

  it("P06 يعيد ذمم يوليو-سبتمبر عند تصحيح الإنهاء من يوليو إلى أكتوبر بلا حذف التاريخ", () => {
    const journey = runJourney();
    const restored = journey.state.entities.receivables.filter(
      receivable =>
        receivable.meta.leaseId === journey.terminationCorrectedLease.id &&
        String(receivable.meta.due ?? receivable.date) >= "2026-07-01" &&
        String(receivable.meta.due ?? receivable.date) < "2026-10-01"
    );
    expect(restored).toHaveLength(3);
    expect(
      restored.every(receivable => finance.isActiveReceivable(receivable))
    ).toBe(true);
    expect(restored.every(receivable => receivable.status === "مستحق")).toBe(
      true
    );
    expect(
      journey.terminationCorrectedLease.meta.terminationEffectiveDate
    ).toBe("2026-10-01");
  });

  it("P07 يشتق إشغال أكتوبر من التاريخ: العقد المستقبلي محجوز والشغور في يناير لا يفرغ عقد أكتوبر", () => {
    const journey = runJourney();
    const unitOccupancyAt = requiredExport<OccupancyAt>(
      leaseLifecycle,
      "unitOccupancyAt"
    );
    expect(
      unitOccupancyAt(
        journey.state.entities,
        journey.correctedUnit.id,
        SCENARIO_DATE
      )
    ).toBe("reserved");
    expect(
      unitOccupancyAt(
        journey.state.entities,
        journey.invoiceUnit.id,
        SCENARIO_DATE
      )
    ).toBe("occupied");
    expect(
      unitOccupancyAt(
        journey.state.entities,
        journey.invoiceUnit.id,
        "2027-01-01"
      )
    ).toBe("vacant");
    expect(
      journey.state.entities.units.find(
        unit => unit.id === journey.invoiceUnit.id
      )?.status
    ).toBe("مؤجرة");
  });

  it("P08 يولد وثيقة جديدة بالكهرباء 00999 ولا يغير لقطة العقد/الوثيقة القديمة 00129", () => {
    const journey = runJourney();
    expect(
      electricityNumberForRentalTarget(
        journey.state.entities,
        journey.wholeProperty.id,
        journey.wholeUnit.id
      )
    ).toBe("00999");
    expect(journey.originalSnapshot.electricityNumber).toBe("00129");
    expect(journey.originalSnapshot.content).toContain("الكهرباء 00129");
    expect(journey.newSnapshot.electricityNumber).toBe("00999");
    expect(journey.newSnapshot.content).toContain("الكهرباء 00999");
  });

  it("P09 يقارن الملخص والذمم الحالية وكشف المالك التاريخي والدفتر من أحداث المصدر نفسها", () => {
    const journey = runJourney();
    const financialSummaryAt = finance.financialSummary as FinancialSummaryAt;
    const summary = financialSummaryAt(
      journey.state.entities,
      "portfolio-b",
      OCTOBER,
      "2026-11-30"
    );
    const historicalClosing = finance.periodClosingOutstanding(
      journey.state.entities,
      "portfolio-b",
      OCTOBER,
      "2026-11-30"
    );
    const currentAR = finance.currentAsOfOutstanding(
      journey.state.entities,
      "portfolio-b",
      OCTOBER,
      "2026-11-30"
    );
    const ledger = ledgerFromRecords({
      receivables: journey.state.entities.receivables.filter(
        receivable => receivable.portfolioId === "portfolio-b"
      ),
      collections: journey.state.entities.collections.filter(
        collection => collection.portfolioId === "portfolio-b"
      ),
      expenses: journey.state.entities.expenses.filter(
        expense => expense.portfolioId === "portfolio-b"
      ),
      losses: journey.state.entities.losses.filter(
        loss => loss.portfolioId === "portfolio-b"
      ),
      journal: journey.state.entities.journal.filter(
        entry => entry.portfolioId === "portfolio-b"
      ),
    });

    expect(summary).toMatchObject({
      incomeMinor: QAR_400,
      accrualIncomeMinor: QAR_1000,
      periodClosingAsOf: "2026-10-31",
      periodClosingOutstandingMinor: QAR_600,
      currentAsOf: "2026-11-30",
      currentAsOfOutstandingMinor: 0,
    });
    expect(summary.periodClosingAsOf).toBe(
      finance.periodClosingDate(OCTOBER, "2026-11-30")
    );
    expect(summary.periodClosingOutstandingMinor).toBe(historicalClosing);
    expect(summary.currentAsOfOutstandingMinor).toBe(currentAR);
    expect(currentAR).toBe(0);
    expect(
      ledger
        .filter(line => line.source === "تحصيل مؤكد")
        .map(line => line.amountMinor)
    ).toEqual([QAR_600, QAR_400]);
    expect(
      ledger
        .filter(line => line.source === "تحصيل مؤكد")
        .reduce((total, line) => total + line.amountMinor, 0)
    ).toBe(QAR_1000);
    expect(
      ledger.some(
        line =>
          line.amountMinor === journey.bouncedReceipt.amountMinor &&
          line.source === "تحصيل مؤكد"
      )
    ).toBe(false);
  });

  it("P10 يربط الصيانة بعقار/وحدة باء وينشئ مصروفًا واحدًا غير مسدد بلا دفعة", () => {
    const journey = runJourney();
    const basicExpense = row({
      id: "p10-basic-expense",
      title: "مصروف أساسي مستقل",
      portfolioId: "portfolio-b",
      propertyId: journey.splitProperty.id,
      status: "مسدد",
      date: SCENARIO_DATE,
      amountMinor: QAR_400,
      meta: {
        classification: "تشغيلي",
        category: "خدمة أساسية",
        sourceEventId: "p10-basic-expense",
      },
    });
    const withBasicExpense: PrototypeState = {
      ...journey.state,
      entities: {
        ...journey.state.entities,
        expenses: [...journey.state.entities.expenses, basicExpense],
      },
    };
    const created = createMaintenanceRequest(withBasicExpense, {
      requestId: "p10-maintenance-b",
      title: "إصلاح كهرباء وحدة الفاتورة",
      propertyId: journey.splitProperty.id,
      unitId: journey.invoiceUnit.id,
      priority: "عالية",
      capMinor: QAR_1000,
    });
    const retry = createMaintenanceRequest(created.state, {
      requestId: "p10-maintenance-b",
      title: "إصلاح كهرباء وحدة الفاتورة",
      propertyId: journey.splitProperty.id,
      unitId: journey.invoiceUnit.id,
      priority: "عالية",
      capMinor: QAR_1000,
    });
    expect(retry.state).toBe(created.state);
    expect(retry.result).toMatchObject({
      created: false,
      request: { id: "p10-maintenance-b" },
    });

    const forReview = submitMaintenanceForReview(
      created.state,
      "p10-maintenance-b"
    );
    const approved = approveMaintenanceRequest(
      {
        ...forReview.state,
        settings: { ...forReview.state.settings, role: "owner" },
      },
      "p10-maintenance-b"
    );
    const operatorApproved: PrototypeState = {
      ...approved.state,
      settings: { ...approved.state.settings, role: "operator" },
    };
    const costLinked = linkMaintenanceCost(operatorApproved, {
      maintenanceId: "p10-maintenance-b",
      costMinor: QAR_600,
      expenseDate: SCENARIO_DATE,
      classification: "تشغيلي",
      category: "صيانة كهربائية",
    });
    const complete = completeMaintenanceWork(
      costLinked.state,
      "p10-maintenance-b"
    );
    const materialized = materializeMaintenanceExpense(
      complete.state,
      "p10-maintenance-b"
    );
    const materializedRetry = materializeMaintenanceExpense(
      materialized.state,
      "p10-maintenance-b"
    );

    expect(materialized.result).toMatchObject({
      created: true,
      expense: {
        portfolioId: "portfolio-b",
        propertyId: journey.splitProperty.id,
        status: "غير مسدد",
        amountMinor: QAR_600,
        meta: {
          maintenanceId: "p10-maintenance-b",
          unitId: journey.invoiceUnit.id,
          paymentStatus: "غير مسدد",
        },
      },
    });
    expect(materialized.state.entities.payments).toHaveLength(
      journey.state.entities.payments.length
    );
    expect(
      materialized.state.entities.expenses.find(
        expense => expense.id === basicExpense.id
      )
    ).toEqual(basicExpense);
    expect(materializedRetry.state).toBe(materialized.state);
    expect(materializedRetry.result).toMatchObject({
      created: false,
      expense: { id: materialized.result.expense.id },
    });
    expect(
      materialized.state.entities.expenses.filter(
        expense => expense.meta.maintenanceId === "p10-maintenance-b"
      )
    ).toHaveLength(1);
  });

  it("P10b يسدد مصروف الصيانة مرة واحدة بإجراء صريح مستقل على الرحلة نفسها بلا تحويل خارجي", () => {
    const j = runJourney();
    const created = createMaintenanceRequest(j.state, {
      requestId: "p10b-local-payment",
      title: "صيانة QA مصطنعة",
      propertyId: j.splitProperty.id,
      unitId: j.invoiceUnit.id,
      priority: "عادية",
      capMinor: QAR_1000,
    });
    const submitted = submitMaintenanceForReview(
      created.state,
      created.result.request.id
    );
    const approved = approveMaintenanceRequest(
      {
        ...submitted.state,
        settings: { ...submitted.state.settings, role: "owner" },
      },
      created.result.request.id
    );
    const linked = linkMaintenanceCost(
      {
        ...approved.state,
        settings: { ...approved.state.settings, role: "operator" },
      },
      {
        maintenanceId: created.result.request.id,
        costMinor: QAR_600,
        expenseDate: SCENARIO_DATE,
        classification: "تشغيلي",
        category: "صيانة",
      }
    );
    const done = completeMaintenanceWork(
      linked.state,
      created.result.request.id
    );
    const materialized = materializeMaintenanceExpense(
      done.state,
      created.result.request.id
    );
    const paid = payMaintenanceExpense(
      materialized.state,
      materialized.result.expense.id,
      "2026-11-05",
      "نقد",
      "p10b-payment"
    );
    const retry = payMaintenanceExpense(
      paid.state,
      materialized.result.expense.id,
      "2026-11-05",
      "نقد",
      "p10b-payment"
    );
    expect(retry.state).toBe(paid.state);
    expect(paid.state.entities.payments).toHaveLength(
      j.state.entities.payments.length + 1
    );
    expect(paid.result.payment.meta.externalTransfer).toBe(false);
    expect(
      finance.financialSummary(
        paid.state.entities,
        "portfolio-b",
        OCTOBER,
        "2026-10-31"
      ).expenseMinor
    ).toBe(0);
    expect(
      finance.financialSummary(
        paid.state.entities,
        "portfolio-b",
        "2026-11",
        "2026-11-30"
      ).expenseMinor
    ).toBe(QAR_600);
  });

  it("P11 يستعيد لقطة التخزين الذرية نفسها في مساحة جديدة ويرفض سباق الجيل الثاني", async () => {
    const journey = runJourney();
    const storage = new MemoryStorage();
    const scope = {
      userId: "phase1-journey",
      identityState: "authenticated" as const,
      localWorkspaceId: "restore-target",
    };
    const saved = writePrototypeWorkspace(storage, scope, journey.state, 0);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const restored = loadPrototypeWorkspace(storage, scope);
    expect(restored.kind).toBe("ready");
    if (restored.kind !== "ready") return;
    expect(restored.state).toEqual(journey.state);
    expect(restored.metadata.generation).toBe(1);

    const stale = await writePrototypeWorkspaceGuarded(
      storage,
      scope,
      structuredClone(journey.state),
      0
    );
    expect(stale).toMatchObject({ ok: false, reason: "generation-conflict" });
  });

  it.skip(
    "P11b الرحلة الكاملة نفسها داخل UI واحد غير منفذة هنا؛ ملف WorkspaceStorageControls.test.tsx يثبت التصدير والملف والمعاينة والتأكيد الحقيقيين بfixture مستقل، وليس حسابين أو جهازين حيين"
  );
});
