import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  activateLease,
  correctLeaseTermination,
  createLease,
  createLeaseVacancy,
  endLeaseVacancy,
  refreshLeaseCalendar,
  renewLease,
  terminateLease,
  undoLeaseTermination,
  unitOccupancyAt,
} from "./prototype-lease-lifecycle";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "property-a",
    status: "نشط",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function state(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    entity({ id: "portfolio-a", title: "محفظة أ", propertyId: "" }),
    entity({
      id: "portfolio-b",
      title: "محفظة ب",
      portfolioId: "portfolio-b",
      propertyId: "",
    }),
  ];
  entities.properties = [
    entity({
      id: "property-a",
      title: "عقار أ",
      propertyId: "property-a",
      meta: { rentalMode: "units" },
    }),
    entity({
      id: "property-b",
      title: "عقار ب",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
    }),
  ];
  entities.units = [
    entity({ id: "unit-a", title: "وحدة أ", status: "شاغرة" }),
    entity({ id: "unit-b", title: "وحدة ب", status: "شاغرة" }),
    entity({
      id: "unit-other",
      title: "وحدة أخرى",
      portfolioId: "portfolio-b",
      propertyId: "property-b",
      status: "شاغرة",
    }),
  ];
  entities.tenants = [
    entity({
      id: "tenant-a",
      title: "مستأجر أ",
      meta: { unitId: "unit-a" },
    }),
    entity({
      id: "tenant-b",
      title: "مستأجر ب",
      meta: { unitId: "unit-b" },
    }),
    entity({
      id: "tenant-other",
      title: "مستأجر آخر",
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
    },
  };
}

function leaseValues(overrides: Record<string, string> = {}) {
  return {
    title: "عقد اختبار",
    propertyId: "property-a",
    unitId: "unit-a",
    tenantId: "tenant-a",
    startDate: "2026-10-24",
    endDate: "2026-12-24",
    rent: "4500",
    requestId: "create-a",
    ...overrides,
  };
}

describe("prototype lease lifecycle · R09", () => {
  it("keeps a manually created lease as a draft, then starts it once with dated UTC receivables and no cash", () => {
    const initial = state();
    const created = createLease(initial, leaseValues());

    const createRetry = createLease(created.state, leaseValues());
    expect(createRetry.state).toBe(created.state);
    expect(createRetry.result).toBe(created.result);

    expect(created.result.status).toBe("مسودة");
    expect(
      created.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("شاغرة");
    expect(created.state.entities.receivables).toHaveLength(0);
    expect(created.state.entities.collections).toHaveLength(0);

    const started = activateLease(
      created.state,
      created.result.id,
      "2026-10-24"
    );
    expect(started.result.status).toBe("نافذ");
    expect(
      started.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("مؤجرة");
    expect(started.state.entities.receivables).toHaveLength(3);
    expect(
      started.state.entities.receivables.map(row => row.meta.leaseCycleKey)
    ).toEqual([
      `${created.result.id}:2026-10`,
      `${created.result.id}:2026-11`,
      `${created.result.id}:2026-12`,
    ]);
    expect(started.state.entities.collections).toHaveLength(0);

    const retry = activateLease(started.state, created.result.id, "2026-10-24");
    expect(retry.state).toBe(started.state);
    expect(retry.result).toBe(started.result);
    expect(retry.state.entities.receivables).toHaveLength(3);
  });

  it("marks an activated future lease reserved, not occupied, until a deliberate refresh reaches its start", () => {
    const created = createLease(
      state(),
      leaseValues({ startDate: "2026-11-01", endDate: "2027-01-31" })
    );
    const started = activateLease(
      created.state,
      created.result.id,
      "2026-10-24"
    );

    expect(
      unitOccupancyAt(started.state.entities, "unit-a", "2026-10-24")
    ).toBe("reserved");
    expect(
      started.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("محجوزة");
    const refreshed = refreshLeaseCalendar(started.state, "2026-11-01");
    expect(refreshed.result).toBeGreaterThan(0);
    expect(
      refreshed.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("مؤجرة");
  });

  it("rejects reverse dates and an overlapping effective lease before any write", () => {
    const initial = state();
    expect(() =>
      createLease(
        initial,
        leaseValues({ endDate: "2026-10-23", requestId: "reverse-date" })
      )
    ).toThrow("النهاية");
    expect(initial.entities.leases).toHaveLength(0);

    const firstDraft = createLease(initial, leaseValues());
    const first = activateLease(
      firstDraft.state,
      firstDraft.result.id,
      "2026-10-24"
    );
    const secondTenantBoundToUnit = {
      ...first.state,
      entities: {
        ...first.state.entities,
        tenants: first.state.entities.tenants.map(row =>
          row.id === "tenant-b"
            ? { ...row, meta: { ...row.meta, unitId: "unit-a" } }
            : row
        ),
      },
    };
    const second = createLease(
      secondTenantBoundToUnit,
      leaseValues({
        title: "عقد متداخل",
        tenantId: "tenant-b",
        requestId: "overlap",
        startDate: "2026-11-01",
        endDate: "2027-01-31",
      })
    );
    expect(() =>
      activateLease(second.state, second.result.id, "2026-10-24")
    ).toThrow("متداخل");
    expect(second.state.entities.receivables).toHaveLength(
      secondTenantBoundToUnit.entities.receivables.length
    );
  });

  it("requires a correctly bound tenant and refuses template-only metadata without an actual document", () => {
    expect(() =>
      createLease(
        state(),
        leaseValues({ tenantId: "tenant-other", requestId: "wrong-tenant" })
      )
    ).toThrow("المستأجر");

    const generated = state();
    generated.entities.leases.push(
      entity({
        id: "template-draft",
        title: "مسودة من قالب",
        subtitle: "مستأجر أ",
        status: "مسودة",
        amountMinor: 450_000,
        date: "2026-10-24",
        meta: {
          tenantId: "tenant-a",
          tenantName: "مستأجر أ",
          unitId: "unit-a",
          templateId: "template-1",
          startDate: "2026-10-24",
          endDate: "2026-12-23",
          rentMinor: 450_000,
        },
      })
    );
    expect(() =>
      activateLease(generated, "template-draft", "2026-10-24")
    ).toThrow("وثيقة");
    expect(generated.entities.receivables).toHaveLength(0);
    expect(generated.entities.collections).toHaveLength(0);
  });

  it("rejects a pre-settled termination, then creates an idempotent new renewal version without erasing history", () => {
    const created = createLease(
      state(),
      leaseValues({ endDate: "2026-12-31", requestId: "prior" })
    );
    const active = activateLease(
      created.state,
      created.result.id,
      "2026-10-24"
    );
    const december = active.state.entities.receivables.find(
      row => row.meta.leaseCycleKey === `${created.result.id}:2026-12`
    )!;
    const withPartial = {
      ...active.state,
      entities: {
        ...active.state.entities,
        collections: [
          ...active.state.entities.collections,
          entity({
            id: "partial-december",
            title: "تحصيل جزئي",
            amountMinor: 10_000,
            status: "محصّل",
            meta: { receivableId: december.id },
          }),
        ],
      },
    };
    expect(() =>
      terminateLease(withPartial, created.result.id, {
        effectiveDate: "2026-11-01",
        asOf: "2026-10-24",
        reason: "خروج مستأجر",
        requestId: "terminate-pre-settled",
      })
    ).toThrow("تسوية صريحة");
    expect(withPartial.entities.collections).toHaveLength(1);

    const terminated = terminateLease(active.state, created.result.id, {
      effectiveDate: "2026-11-01",
      asOf: "2026-10-24",
      reason: "خروج مستأجر",
      requestId: "terminate-prior",
    });
    const cancelledNovember = terminated.state.entities.receivables.find(
      row => row.meta.leaseCycleKey === `${created.result.id}:2026-11`
    );
    const cancelledDecember = terminated.state.entities.receivables.find(
      row => row.id === december.id
    );
    expect(cancelledNovember?.status).toBe("ملغى");
    expect(cancelledDecember?.status).toBe("ملغى");
    expect(terminated.state.entities.collections).toHaveLength(0);
    expect(terminated.state.entities.leases).toHaveLength(1);
    const terminationRetry = terminateLease(
      terminated.state,
      created.result.id,
      {
        effectiveDate: "2026-11-01",
        asOf: "2026-10-24",
        reason: "خروج مستأجر",
        requestId: "terminate-prior",
      }
    );
    expect(terminationRetry.state).toBe(terminated.state);
    expect(terminationRetry.result).toBe(terminated.result);

    const renewed = renewLease(terminated.state, created.result.id, {
      title: "عقد اختبار · إصدار جديد",
      startDate: "2026-11-01",
      endDate: "2027-10-31",
      rent: "4700",
      requestId: "renew-1",
    });
    expect(renewed.result.id).not.toBe(created.result.id);
    expect(renewed.result.meta.priorLeaseId).toBe(created.result.id);
    expect(renewed.state.entities.leases).toHaveLength(2);
    expect(
      renewed.state.entities.leases.find(row => row.id === created.result.id)
        ?.meta.endDate
    ).toBe("2026-12-31");
    const renewalRetry = renewLease(renewed.state, created.result.id, {
      title: "عقد اختبار · إصدار جديد",
      startDate: "2026-11-01",
      endDate: "2027-10-31",
      rent: "4700",
      requestId: "renew-1",
    });
    expect(renewalRetry.state).toBe(renewed.state);
    expect(renewalRetry.result).toBe(renewed.result);
  });
});

describe("prototype lease vacancy transitions · R12", () => {
  it("resolves all-portfolio ownership from the property, preserves vacancy history, and derives ending status from an actual lease", () => {
    const future = createLease(
      state(),
      leaseValues({ startDate: "2026-11-01", endDate: "2026-12-31" })
    );
    const activeFuture = activateLease(
      future.state,
      future.result.id,
      "2026-10-24"
    );
    const vacancy = createLeaseVacancy(activeFuture.state, {
      title: "شغور قبل البدء",
      propertyId: "property-a",
      unitId: "unit-a",
      startDate: "2026-10-25",
      expectedReadyDate: "2026-10-31",
      reason: "تجهيز",
      preparation: "دهان",
      lostIncome: "4500",
      requestId: "vacancy-1",
    });
    expect(vacancy.result.portfolioId).toBe("portfolio-a");
    expect(
      unitOccupancyAt(vacancy.state.entities, "unit-a", "2026-10-24")
    ).toBe("reserved");
    expect(
      vacancy.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("محجوزة");
    const retry = createLeaseVacancy(vacancy.state, {
      title: "شغور قبل البدء",
      propertyId: "property-a",
      unitId: "unit-a",
      startDate: "2026-10-25",
      expectedReadyDate: "2026-10-31",
      reason: "تجهيز",
      preparation: "دهان",
      lostIncome: "4500",
      requestId: "vacancy-1",
    });
    expect(retry.state).toBe(vacancy.state);
    expect(retry.result.id).toBe(vacancy.result.id);

    const ended = endLeaseVacancy(vacancy.state, vacancy.result.id, {
      endDate: "2026-11-02",
      note: "جاهزة",
      requestId: "end-vacancy-1",
    });
    expect(ended.result.status).toBe("منتهٍ");
    expect(
      ended.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("محجوزة");
    expect(unitOccupancyAt(ended.state.entities, "unit-a", "2026-11-02")).toBe(
      "occupied"
    );
    expect(ended.state.entities.vacancies).toHaveLength(1);
  });

  it("refuses a vacancy that contradicts an active lease and validates selected relationships", () => {
    const created = createLease(state(), leaseValues());
    const active = activateLease(
      created.state,
      created.result.id,
      "2026-10-24"
    );
    const before = active.state.entities.vacancies.length;
    expect(() =>
      createLeaseVacancy(active.state, {
        title: "شغور متعارض",
        propertyId: "property-a",
        unitId: "unit-a",
        startDate: "2026-10-24",
        lostIncome: "0",
        requestId: "contradiction",
      })
    ).toThrow("عقد نافذ");
    expect(active.state.entities.vacancies).toHaveLength(before);
    expect(() =>
      createLeaseVacancy(active.state, {
        title: "علاقة خاطئة",
        propertyId: "property-a",
        unitId: "unit-other",
        startDate: "2026-10-24",
        lostIncome: "0",
        requestId: "wrong-relationship",
      })
    ).toThrow("الوحدة");
  });

  it("treats the internal whole-property target as the same occupancy subject for overlap checks", () => {
    const initial = state();
    initial.entities.units[0] = {
      ...initial.entities.units[0],
      id: "whole-unit",
      meta: { wholeProperty: true },
    };
    initial.entities.tenants[0] = {
      ...initial.entities.tenants[0],
      meta: { unitId: "whole-unit" },
    };
    initial.entities.units[1] = {
      ...initial.entities.units[1],
      propertyId: "property-a",
      portfolioId: "portfolio-a",
    };
    initial.entities.tenants[1] = {
      ...initial.entities.tenants[1],
      meta: { unitId: "unit-b" },
    };
    const wholeDraft = createLease(
      initial,
      leaseValues({ unitId: "whole-unit", requestId: "whole-lease" })
    );
    const whole = activateLease(
      wholeDraft.state,
      wholeDraft.result.id,
      "2026-10-24"
    );
    const unitDraft = createLease(
      whole.state,
      leaseValues({
        unitId: "unit-b",
        tenantId: "tenant-b",
        requestId: "unit-inside-whole",
      })
    );
    expect(() =>
      activateLease(unitDraft.state, unitDraft.result.id, "2026-10-24")
    ).toThrow("متداخل");
  });
});

describe("phase1 lifecycle corrections · red regression P02-P05", () => {
  function activeAnnualLease() {
    const created = createLease(
      state(),
      leaseValues({
        title: "عقد 2026 الأصلي",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        rent: "1000",
        requestId: "phase1-original",
      })
    );
    return activateLease(created.state, created.result.id, "2026-01-01");
  }

  it("P02 settles affected outgoing future AR atomically, so October has only the 1200 renewal", () => {
    const prior = activeAnnualLease();
    const renewal = renewLease(prior.state, prior.result.id, {
      title: "عقد 2026-2027 المجدد",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rent: "1200",
      terminatePrevious: "confirm",
      requestId: "phase1-early-renewal",
    });
    const activeRenewal = activateLease(
      renewal.state,
      renewal.result.id,
      "2026-10-24"
    );
    const october = activeRenewal.state.entities.receivables.filter(row =>
      String(row.meta.due || row.date).startsWith("2026-10")
    );

    expect(october).toHaveLength(2);
    expect(october.filter(row => row.status !== "ملغى")).toMatchObject([
      { amountMinor: 120_000, meta: { leaseId: renewal.result.id } },
    ]);
    expect(
      october.reduce(
        (total, row) => total + (row.status === "ملغى" ? 0 : row.amountMinor),
        0
      )
    ).toBe(120_000);
  });

  it("P03 gives a renewal an unproved draft identity and only a separate historic lease reference", () => {
    const prior = activeAnnualLease();
    const withOldProof = {
      ...prior.state,
      entities: {
        ...prior.state.entities,
        leases: prior.state.entities.leases.map(row =>
          row.id === prior.result.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  registrationStatus: "مسجل",
                  registrationNumber: "OLD-123",
                  registrationEvidence: "OLD-PROOF",
                  signedStatus: "موقع",
                  signatureProof: "OLD-SIGNATURE",
                  snapshotDocumentId: "OLD-DOC",
                  templateId: "OLD-TEMPLATE",
                },
              }
            : row
        ),
      },
    };
    const renewal = renewLease(withOldProof, prior.result.id, {
      title: "إصدار بلا إثبات قديم",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rent: "1200",
      terminatePrevious: "confirm",
      newTemplateStep: "confirm",
      requestId: "phase1-proof-reset",
    });

    expect(renewal.result.meta).toMatchObject({
      priorLeaseId: prior.result.id,
      historicalLeaseRef: prior.result.id,
      registrationStatus: "غير متحقق",
      signedStatus: "مسودة غير موقعة",
    });
    expect(renewal.result.meta.registrationNumber).toBeUndefined();
    expect(renewal.result.meta.registrationEvidence).toBeUndefined();
    expect(renewal.result.meta.signatureProof).toBeUndefined();
    expect(renewal.result.meta.snapshotDocumentId).toBeUndefined();
    expect(renewal.result.meta.templateId).toBeUndefined();
  });

  it("P04 does not leave unpaid AR cancelled when a termination is corrected later", () => {
    const prior = activeAnnualLease();
    const endedInJuly = terminateLease(prior.state, prior.result.id, {
      effectiveDate: "2026-07-01",
      asOf: "2026-10-24",
      reason: "موعد خروج أولي",
      requestId: "phase1-terminate-july",
    });
    const correctedInOctober = correctLeaseTermination(
      endedInJuly.state,
      prior.result.id,
      {
        effectiveDate: "2026-10-01",
        asOf: "2026-10-24",
        reason: "تصحيح موعد الخروج",
        requestId: "phase1-correct-october",
      }
    );
    const julyThroughSeptember =
      correctedInOctober.state.entities.receivables.filter(
        row =>
          row.meta.leaseId === prior.result.id &&
          String(row.meta.due || row.date) >= "2026-07-01" &&
          String(row.meta.due || row.date) < "2026-10-01"
      );

    expect(julyThroughSeptember).toHaveLength(3);
    expect(julyThroughSeptember.every(row => row.status === "مستحق")).toBe(
      true
    );
  });

  it("P05 does not let a scheduled January vacancy change October occupancy", () => {
    const prior = activeAnnualLease();
    const scheduled = createLeaseVacancy(prior.state, {
      title: "شغور مجدول بعد العقد",
      propertyId: "property-a",
      unitId: "unit-a",
      startDate: "2027-01-01",
      expectedReadyDate: "2027-01-31",
      reason: "تجهيز 2027",
      lostIncome: "1000",
      requestId: "phase1-future-vacancy",
    });

    expect(
      scheduled.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("مؤجرة");
  });

  it("P02 refuses an early renewal before any write when outgoing AR has an advance collection, loss, or issued invoice", () => {
    const prior = activeAnnualLease();
    const july = prior.state.entities.receivables.find(
      row => row.meta.leaseCycleKey === `${prior.result.id}:2026-07`
    )!;
    const blocked = {
      ...prior.state,
      entities: {
        ...prior.state.entities,
        collections: [
          ...prior.state.entities.collections,
          entity({
            id: "advance-july",
            status: "محصّل",
            amountMinor: 10_000,
            meta: { receivableId: july.id },
          }),
        ],
        losses: [
          ...prior.state.entities.losses,
          entity({
            id: "loss-july",
            status: "مسجل",
            amountMinor: 10_000,
            meta: { receivableId: july.id },
          }),
        ],
        documents: [
          ...prior.state.entities.documents,
          entity({
            id: "invoice-july",
            status: "صادر",
            amountMinor: 100_000,
            meta: {
              recordType: "billing-document",
              kind: "invoice",
              receivableId: july.id,
            },
          }),
        ],
      },
    };
    const before = JSON.stringify(blocked.entities);

    expect(() =>
      renewLease(blocked, prior.result.id, {
        title: "تجديد محظور حتى التسوية",
        startDate: "2026-07-01",
        endDate: "2027-06-30",
        rent: "1200",
        terminatePrevious: "confirm",
        requestId: "phase1-blocked-renewal",
      })
    ).toThrow("تسوية صريحة");
    expect(JSON.stringify(blocked.entities)).toBe(before);
  });

  it("P04 corrects a termination backward and forward, retries safely, then undoes it without deleting history", () => {
    const prior = activeAnnualLease();
    const endedInOctober = terminateLease(prior.state, prior.result.id, {
      effectiveDate: "2026-10-01",
      asOf: "2026-10-24",
      reason: "موعد خروج أولي",
      requestId: "phase1-termination-october",
    });
    const correctedBackward = correctLeaseTermination(
      endedInOctober.state,
      prior.result.id,
      {
        effectiveDate: "2026-07-01",
        asOf: "2026-10-24",
        reason: "تصحيح تقديم الخروج",
        requestId: "phase1-correct-backward",
      }
    );
    const july = correctedBackward.state.entities.receivables.find(
      row => row.meta.leaseCycleKey === `${prior.result.id}:2026-07`
    );
    expect(july?.status).toBe("ملغى");

    const correctedForward = correctLeaseTermination(
      correctedBackward.state,
      prior.result.id,
      {
        effectiveDate: "2026-10-01",
        asOf: "2026-10-24",
        reason: "تصحيح تأخير الخروج",
        requestId: "phase1-correct-forward",
      }
    );
    const julyThroughSeptember =
      correctedForward.state.entities.receivables.filter(
        row =>
          row.meta.leaseId === prior.result.id &&
          String(row.meta.due || row.date) >= "2026-07-01" &&
          String(row.meta.due || row.date) < "2026-10-01"
      );
    expect(julyThroughSeptember.every(row => row.status === "مستحق")).toBe(
      true
    );
    const correctionRetry = correctLeaseTermination(
      correctedForward.state,
      prior.result.id,
      {
        effectiveDate: "2026-10-01",
        asOf: "2026-10-24",
        reason: "تصحيح تأخير الخروج",
        requestId: "phase1-correct-forward",
      }
    );
    expect(correctionRetry.state).toBe(correctedForward.state);

    const undone = undoLeaseTermination(
      correctedForward.state,
      prior.result.id,
      {
        asOf: "2026-10-24",
        reason: "إلغاء الخروج بعد مراجعة",
        requestId: "phase1-undo-termination",
      }
    );
    expect(undone.result.status).toBe("نافذ");
    expect(
      undone.state.entities.receivables
        .filter(row => row.meta.leaseId === prior.result.id)
        .every(row => row.status === "مستحق")
    ).toBe(true);
    expect(undone.state.audit[0]).toMatchObject({ title: "عكس إنهاء عقد" });
    expect(undone.state.audit[0].at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it("P04 rejects a correction or undo before mutation when a cancelled AR has a payment or issued invoice", () => {
    const prior = activeAnnualLease();
    const ended = terminateLease(prior.state, prior.result.id, {
      effectiveDate: "2026-07-01",
      asOf: "2026-10-24",
      reason: "خروج",
      requestId: "phase1-paid-termination",
    });
    const july = ended.state.entities.receivables.find(
      row => row.meta.leaseCycleKey === `${prior.result.id}:2026-07`
    )!;
    const settledLegacy = {
      ...ended.state,
      entities: {
        ...ended.state.entities,
        collections: [
          ...ended.state.entities.collections,
          entity({
            id: "payment-after-cancel",
            amountMinor: 1_000,
            status: "محصّل",
            meta: { receivableId: july.id },
          }),
        ],
        documents: [
          ...ended.state.entities.documents,
          entity({
            id: "invoice-after-cancel",
            status: "صادر محليًا",
            meta: {
              recordType: "billing-document",
              kind: "invoice",
              receivableId: july.id,
            },
          }),
        ],
      },
    };
    const before = JSON.stringify(settledLegacy.entities);
    expect(() =>
      correctLeaseTermination(settledLegacy, prior.result.id, {
        effectiveDate: "2026-10-01",
        asOf: "2026-10-24",
        reason: "تصحيح محظور",
        requestId: "phase1-paid-correction",
      })
    ).toThrow("تسوية صريحة");
    expect(() =>
      undoLeaseTermination(settledLegacy, prior.result.id, {
        asOf: "2026-10-24",
        reason: "عكس محظور",
        requestId: "phase1-paid-undo",
      })
    ).toThrow("تسوية صريحة");
    expect(JSON.stringify(settledLegacy.entities)).toBe(before);
  });

  it("P05 exports date-effective occupancy and closing a vacancy cannot claim a lease that does not exist", () => {
    const noLease = state();
    const vacancy = createLeaseVacancy(noLease, {
      title: "شغور بلا عقد",
      propertyId: "property-a",
      unitId: "unit-a",
      startDate: "2026-10-24",
      lostIncome: "0",
      requestId: "phase1-close-no-lease",
    });
    const ended = endLeaseVacancy(vacancy.state, vacancy.result.id, {
      endDate: "2026-10-24",
      note: "جاهزة بلا عقد",
      requestId: "phase1-close-no-lease-end",
    });
    expect(unitOccupancyAt(ended.state.entities, "unit-a", "2026-10-24")).toBe(
      "vacant"
    );
    expect(
      ended.state.entities.units.find(row => row.id === "unit-a")?.status
    ).toBe("شاغرة");
    expect(
      unitOccupancyAt(ended.state.entities, "missing-unit", "2026-10-24")
    ).toBe("unavailable");
  });

  it("uses settings.scenarioDate for empty domain dates while audit events remain real UTC instants", () => {
    const initial = state();
    initial.settings.scenarioDate = "2026-11-01";
    const future = createLease(
      initial,
      leaseValues({
        startDate: "2026-11-01",
        endDate: "2026-12-31",
        requestId: "phase1-scenario-clock",
      })
    );
    const started = activateLease(future.state, future.result.id, "");
    expect(started.result.meta.activatedAt).toBe("2026-11-01");
    expect(
      unitOccupancyAt(started.state.entities, "unit-a", "2026-11-01")
    ).toBe("occupied");
    const refreshed = refreshLeaseCalendar(started.state);
    expect(refreshed.result).toBe(0);
    expect(started.state.audit[0].at).not.toBe("2026-11-01T00:00:00.000Z");
  });
});
