import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  approveMaintenanceRequest,
  completeMaintenanceWork,
  createMaintenanceRequest,
  createPreventiveSchedule,
  linkMaintenanceCost,
  materializeMaintenanceExpense,
  payMaintenanceExpense,
  submitMaintenanceForReview,
} from "./prototype-maintenance";
import { financialSummary } from "./prototype-finance";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختباري",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "",
    status: "نشط",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

/** A deliberately small two-portfolio fixture; the current selector is all. */
function twoPortfolioState(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    entity({
      id: "portfolio-a",
      title: "المحفظة أ",
      portfolioId: "portfolio-a",
    }),
    entity({
      id: "portfolio-b",
      title: "المحفظة ب",
      portfolioId: "portfolio-b",
    }),
  ];
  entities.properties = [
    entity({
      id: "property-a",
      title: "عقار أ",
      portfolioId: "portfolio-a",
      propertyId: "property-a",
    }),
    entity({
      id: "property-b",
      title: "عقار ب",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
    }),
  ];
  entities.units = [
    entity({
      id: "unit-a",
      title: "وحدة أ",
      portfolioId: "portfolio-a",
      propertyId: "property-a",
    }),
    entity({
      id: "unit-b",
      title: "وحدة ب",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
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
      scenarioDate: "2026-11-05",
    },
  };
}

function requestInput(
  overrides: Partial<Parameters<typeof createMaintenanceRequest>[1]> = {}
) {
  return {
    requestId: "maintenance-b-1",
    title: "إصلاح تسرب في وحدة ب",
    propertyId: "property-b",
    unitId: "unit-b",
    priority: "عاجلة",
    capMinor: 125_000,
    ...overrides,
  };
}

function approvedCostedAndCompleted() {
  const request = createMaintenanceRequest(twoPortfolioState(), requestInput());
  const review = submitMaintenanceForReview(
    request.state,
    request.result.request.id
  );
  const approved = approveMaintenanceRequest(
    {
      ...review.state,
      settings: { ...review.state.settings, role: "owner" },
    },
    request.result.request.id
  );
  const operatorState: PrototypeState = {
    ...approved.state,
    settings: { ...approved.state.settings, role: "operator" },
  };
  const linked = linkMaintenanceCost(operatorState, {
    maintenanceId: request.result.request.id,
    costMinor: 120_000,
    expenseDate: "2026-11-06",
    classification: "تشغيلي",
    category: "صيانة سباكة",
  });
  return completeMaintenanceWork(linked.state, request.result.request.id);
}

describe("P09 maintenance stage-one atomic workflow", () => {
  it("green: selecting property B while all portfolios are visible derives portfolio B without a fallback", () => {
    const initial = twoPortfolioState();
    const result = createMaintenanceRequest(initial, requestInput());

    expect(initial.entities.maintenance).toHaveLength(0);
    expect(result.result.request).toMatchObject({
      id: "maintenance-b-1",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
      date: "2026-11-05",
      meta: { unitId: "unit-b", capMinor: 125_000 },
    });
    expect(result.state.audit).toHaveLength(1);
    expect(result.state.audit[0].at).toMatch(/Z$/);
    expect(new Date(result.state.audit[0].at).toISOString()).toBe(
      result.state.audit[0].at
    );
  });

  it("red regression / green: rejects a unit from portfolio A for property B without partial writes", () => {
    const initial = twoPortfolioState();
    const before = structuredClone(initial);

    expect(() =>
      createMaintenanceRequest(initial, requestInput({ unitId: "unit-a" }))
    ).toThrow("الوحدة يجب أن تتبع العقار والمحفظة");
    expect(initial).toEqual(before);
  });

  it("rejects a direct property outside a selected portfolio while retaining the all-portfolios path", () => {
    const selected = twoPortfolioState();
    selected.settings.portfolioId = "portfolio-a";
    const before = structuredClone(selected);

    expect(() => createMaintenanceRequest(selected, requestInput())).toThrow(
      "خارج المحفظة المختارة"
    );
    expect(selected).toEqual(before);
  });

  it("requires an owner-only approval and an immutable approved cost before work completion", () => {
    const created = createMaintenanceRequest(
      twoPortfolioState(),
      requestInput()
    );
    const review = submitMaintenanceForReview(created.state, "maintenance-b-1");

    expect(() =>
      approveMaintenanceRequest(review.state, "maintenance-b-1")
    ).toThrow("دور المالك");
    expect(() =>
      completeMaintenanceWork(review.state, "maintenance-b-1")
    ).toThrow("اعتماد المالك");

    const approved = approveMaintenanceRequest(
      {
        ...review.state,
        settings: { ...review.state.settings, role: "owner" },
      },
      "maintenance-b-1"
    );
    const linked = linkMaintenanceCost(
      {
        ...approved.state,
        settings: { ...approved.state.settings, role: "operator" },
      },
      {
        maintenanceId: "maintenance-b-1",
        costMinor: 120_000,
        expenseDate: "2026-11-06",
        classification: "رأسمالي",
        category: "تحسين شبكة المياه",
      }
    );

    expect(linked.state.entities.expenses).toHaveLength(0);
    expect(linked.state.entities.payments).toHaveLength(0);
    expect(linked.result.meta).toMatchObject({
      costMinor: 120_000,
      expenseDate: "2026-11-06",
      classification: "رأسمالي",
      category: "تحسين شبكة المياه",
      capex: true,
      opex: false,
      sourceEventId: "maintenance-expense:maintenance-b-1",
    });
    expect(() =>
      linkMaintenanceCost(linked.state, {
        maintenanceId: "maintenance-b-1",
        costMinor: 119_999,
        expenseDate: "2026-11-06",
        classification: "رأسمالي",
        category: "تحسين شبكة المياه",
      })
    ).toThrow("مرتبطة بالفعل");
  });

  it("red regression / green: materializes one consistently linked unpaid expense even on a retry, with no cash movement", () => {
    const completed = approvedCostedAndCompleted();
    const first = materializeMaintenanceExpense(
      completed.state,
      "maintenance-b-1"
    );
    const retry = materializeMaintenanceExpense(first.state, "maintenance-b-1");

    expect(first.result.created).toBe(true);
    expect(first.result.request.status).toBe("مصروف مستحق");
    expect(first.result.expense).toMatchObject({
      id: "expense-maintenance-b-1",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
      status: "غير مسدد",
      date: "2026-11-06",
      amountMinor: 120_000,
      meta: {
        maintenanceId: "maintenance-b-1",
        sourceEventId: "maintenance-expense:maintenance-b-1",
        expenseDate: "2026-11-06",
        classification: "تشغيلي",
        category: "صيانة سباكة",
        capex: false,
        opex: true,
        paymentStatus: "غير مسدد",
      },
    });
    expect(first.state.entities.expenses).toHaveLength(1);
    expect(first.state.entities.payments).toHaveLength(0);
    expect(first.state.entities.collections).toHaveLength(0);
    expect(first.state.entities.expenses[0].status).not.toBe("مسدد");
    expect(
      financialSummary(first.state.entities, "portfolio-b", "all").expenseMinor
    ).toBe(0);

    expect(retry.result.created).toBe(false);
    expect(retry.state).toBe(first.state);
    expect(retry.state.entities.expenses).toHaveLength(1);
    expect(retry.state.entities.payments).toHaveLength(0);
  });

  it("settles a maintenance expense only through an explicit, local, idempotent payment operation", () => {
    const materialized = materializeMaintenanceExpense(
      approvedCostedAndCompleted().state,
      "maintenance-b-1"
    );
    const settled = payMaintenanceExpense(
      materialized.state,
      materialized.result.expense.id,
      "2026-11-07",
      "تحويل محلي مسجل",
      "settlement-b-1"
    );
    const retry = payMaintenanceExpense(
      settled.state,
      materialized.result.expense.id,
      "2026-11-07",
      "تحويل محلي مسجل",
      "settlement-b-1"
    );

    expect(settled.result.created).toBe(true);
    expect(settled.result.expense).toMatchObject({
      id: materialized.result.expense.id,
      status: "مسدد",
      meta: {
        maintenanceId: "maintenance-b-1",
        sourceEventId: "maintenance-expense:maintenance-b-1",
        paymentStatus: "مسدد",
        paidDate: "2026-11-07",
        paymentMethod: "تحويل محلي مسجل",
      },
    });
    expect(settled.result.payment).toMatchObject({
      id: "payment-settlement-b-1",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
      status: "تسوية محلية مسجلة",
      date: "2026-11-07",
      amountMinor: 120_000,
      meta: {
        expenseId: materialized.result.expense.id,
        maintenanceId: "maintenance-b-1",
        requestId: "settlement-b-1",
        sourceEventId: `maintenance-payment:${materialized.result.expense.id}`,
        externalTransfer: false,
      },
    });
    expect(settled.state.entities.expenses).toHaveLength(1);
    expect(settled.state.entities.payments).toHaveLength(1);
    expect(settled.state.entities.collections).toHaveLength(0);
    expect(retry.result.created).toBe(false);
    expect(retry.state).toBe(settled.state);
  });

  it("rejects a stale or corrupted maintenance settlement without creating a second payment", () => {
    const materialized = materializeMaintenanceExpense(
      approvedCostedAndCompleted().state,
      "maintenance-b-1"
    );
    const before = structuredClone(materialized.state);
    expect(() =>
      payMaintenanceExpense(
        materialized.state,
        materialized.result.expense.id,
        "2026-02-30",
        "تحويل محلي",
        "settlement-invalid-date"
      )
    ).toThrow("تاريخ السداد غير صالح");
    expect(materialized.state).toEqual(before);

    const corrupted: PrototypeState = {
      ...materialized.state,
      entities: {
        ...materialized.state.entities,
        expenses: materialized.state.entities.expenses.map(expense =>
          expense.id === materialized.result.expense.id
            ? {
                ...expense,
                meta: { ...expense.meta, sourceEventId: "wrong-event" },
              }
            : expense
        ),
      },
    };
    expect(() =>
      payMaintenanceExpense(
        corrupted,
        materialized.result.expense.id,
        "2026-11-07",
        "تحويل محلي",
        "settlement-wrong-event"
      )
    ).toThrow("حدث الصيانة غير مكتملة أو مكررة");
    expect(corrupted.entities.payments).toHaveLength(0);
  });

  it("rejects a pre-existing partial expense relation rather than repairing it with a duplicate", () => {
    const completed = approvedCostedAndCompleted();
    const partial: PrototypeState = {
      ...completed.state,
      entities: {
        ...completed.state.entities,
        expenses: [
          entity({
            id: "rogue-expense",
            title: "مصروف مرتبط جزئيًا",
            portfolioId: "portfolio-b",
            propertyId: "property-b",
            status: "غير مسدد",
            amountMinor: 120_000,
            date: "2026-11-06",
            meta: { maintenanceId: "maintenance-b-1" },
          }),
        ],
      },
    };
    const before = structuredClone(partial);

    expect(() =>
      materializeMaintenanceExpense(partial, "maintenance-b-1")
    ).toThrow("غير مكتملة أو مكررة");
    expect(partial).toEqual(before);
  });

  it("applies the same explicit property/unit relationship rule to preventive schedules", () => {
    const initial = twoPortfolioState();
    expect(() =>
      createPreventiveSchedule(initial, {
        requestId: "preventive-b-1",
        title: "فحص مضخة ب",
        propertyId: "property-b",
        unitId: "unit-a",
        cadence: "شهري",
      })
    ).toThrow("الوحدة يجب أن تتبع العقار والمحفظة");

    const schedule = createPreventiveSchedule(initial, {
      requestId: "preventive-b-1",
      title: "فحص مضخة ب",
      propertyId: "property-b",
      unitId: "unit-b",
      cadence: "شهري",
    });
    expect(schedule.result.schedule).toMatchObject({
      portfolioId: "portfolio-b",
      propertyId: "property-b",
      date: "2026-11-05",
      meta: { unitId: "unit-b", cadence: "شهري" },
    });
  });
});
