import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import type { PropertyMediaDescriptor } from "@shared/property-media-types";
import {
  addLettingSlot,
  attachLettingDocument,
  bookLettingAppointment,
  completeLettingApplication,
  createLettingApplication,
  decideLettingApplication,
  evaluateLettingRecommendation,
  getLettingCase,
  getLettingChequeSchedule,
  getLettingContract,
  listAvailableLettingTargets,
  reviewLettingApplication,
  submitLettingHandover,
  submitLettingReturns,
  updateLettingProfile,
} from "./letting-engine";

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
      meta: {
        rentalMode: "units",
        propertyNumber: "P-100",
        electricityNumber: "E-100",
        type: "شقة",
      },
    }),
    entity({
      id: "property-b",
      title: "عقار ب",
      propertyId: "property-b",
      portfolioId: "portfolio-b",
      meta: { rentalMode: "units", type: "شقة" },
    }),
  ];
  entities.units = [
    entity({ id: "unit-a", title: "وحدة أ", status: "شاغرة" }),
    entity({
      id: "unit-b",
      title: "وحدة ب",
      propertyId: "property-b",
      portfolioId: "portfolio-b",
      status: "شاغرة",
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
      scenarioDate: "2026-10-24",
    },
  };
}

function descriptor(
  id: string,
  mime: PropertyMediaDescriptor["mime"] = "application/pdf"
): PropertyMediaDescriptor {
  return {
    id,
    name: `${id}.${mime === "application/pdf" ? "pdf" : "jpg"}`,
    mime,
    size: 1_024,
  };
}

function createIndividual(initial = state()) {
  return createLettingApplication(initial, {
    requestId: "intake-1",
    messageId: "message-1",
    applicantKind: "individual",
    propertyId: "property-a",
    unitId: "unit-a",
    name: "أحمد علي",
    email: "ahmad@example.test",
    phone: "+97450000000",
    offerMinor: 200_000,
    startDate: "2026-10-25",
    endDate: "2026-12-25",
    message: "طلب محلي",
  });
}

function individualProfile() {
  return {
    name: "أحمد علي",
    email: "ahmad@example.test",
    phone: "+97450000000",
    identityNumber: "ID-123",
    companyName: "",
    companyNumber: "",
    establishmentNumber: "",
    companyAddress: "",
    companyWebsite: "",
    authorizedName: "",
  };
}

function readyForDecision(initial = state()) {
  const created = createIndividual(initial);
  const profile = updateLettingProfile(
    created.state,
    created.result.id,
    individualProfile()
  );
  const identity = attachLettingDocument(profile.state, {
    requestId: "identity-1",
    applicationId: created.result.id,
    kind: "identity",
    descriptor: descriptor("identity-1"),
  });
  const credit = attachLettingDocument(identity.state, {
    requestId: "credit-1",
    applicationId: created.result.id,
    kind: "credit",
    descriptor: descriptor("credit-1"),
  });
  const review = reviewLettingApplication(credit.state, {
    requestId: "review-1",
    applicationId: created.result.id,
    minimumRentMinor: 200_000,
    minimumCreditScore: 0,
    creditScore: 0,
    scoreScaleMax: 100,
    creditReportDate: "2026-10-24",
    creditSourceReviewed: true,
    creditSource: "تقرير مقدم من المتقدم للمراجعة الداخلية",
    documentsReviewed: true,
    maximumReportAgeDays: 30,
  });
  return { created, profile, identity, credit, review };
}

function contractIssued(initial = state()) {
  const flow = readyForDecision(initial);
  const decision = decideLettingApplication(flow.review.state, {
    requestId: "decision-1",
    applicationId: flow.created.result.id,
    decision: "approve",
    reason: "موافقة الموظف بعد مراجعة داخلية",
    propertyNumber: "P-100",
    electricityNumber: "E-100",
  });
  return { ...flow, decision };
}

describe("letting engine · state-only workflow", () => {
  it("offers only rental units from a mixed property and blocks a manually selected sale unit", () => {
    const mixed = state();
    mixed.entities.units = [
      entity({
        id: "unit-rent",
        title: "وحدة للإيجار",
        meta: {
          unitProfile: JSON.stringify({ v: 1, purpose: "rent" }),
        },
      }),
      entity({
        id: "unit-sale",
        title: "وحدة للبيع",
        meta: {
          unitProfile: JSON.stringify({ v: 1, purpose: "sale" }),
        },
      }),
      entity({
        id: "unit-unassigned",
        title: "وحدة لم يحدد هدفها",
        meta: { unitProfile: JSON.stringify({ v: 1 }) },
      }),
    ];
    mixed.entities.properties[0] = {
      ...mixed.entities.properties[0],
      meta: {
        ...mixed.entities.properties[0].meta,
        propertyProfile: JSON.stringify({ v: 1, purpose: "mixed" }),
      },
    };
    const before = {
      leases: mixed.entities.leases,
      receivables: mixed.entities.receivables,
      collections: mixed.entities.collections,
    };

    expect(
      listAvailableLettingTargets(mixed.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-rent"]);
    expect(() =>
      createLettingApplication(mixed, {
        requestId: "mixed-sale-intake",
        messageId: "mixed-sale-message",
        applicantKind: "individual",
        propertyId: "property-a",
        unitId: "unit-sale",
        name: "أحمد علي",
        email: "ahmad@example.test",
        phone: "+97450000000",
        offerMinor: 200_000,
        startDate: "2026-10-25",
        endDate: "2026-12-25",
        message: "طلب محلي",
      })
    ).toThrow("لا تمثل هدفًا صالحًا");
    expect(mixed.entities.leases).toBe(before.leases);
    expect(mixed.entities.receivables).toBe(before.receivables);
    expect(mixed.entities.collections).toBe(before.collections);
  });

  it("retains legacy unspecified rental targets while a property purpose excludes only new rental offers", () => {
    const legacy = state();
    expect(
      listAvailableLettingTargets(legacy.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-a", "unit-b"]);

    const sale = state();
    sale.entities.properties[0] = {
      ...sale.entities.properties[0],
      meta: {
        ...sale.entities.properties[0].meta,
        propertyProfile: JSON.stringify({ v: 1, purpose: "sale" }),
      },
    };
    const activeLease = entity({
      id: "legacy-active-lease",
      title: "عقد تاريخي نافذ",
      status: "نافذ",
      date: "2026-01-01",
      meta: {
        unitId: "unit-a",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        lifecycleActivated: true,
      },
    });
    sale.entities.leases = [activeLease];
    sale.entities.receivables = [
      entity({ id: "legacy-due", title: "ذمة تاريخية", amountMinor: 200_000 }),
    ];
    sale.entities.collections = [
      entity({ id: "legacy-cash", title: "تحصيل تاريخي", amountMinor: 50_000 }),
    ];
    const financialBefore = {
      leases: sale.entities.leases,
      receivables: sale.entities.receivables,
      collections: sale.entities.collections,
    };

    expect(
      listAvailableLettingTargets(sale.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).not.toContain("unit-a");
    expect(sale.entities.leases).toBe(financialBefore.leases);
    expect(sale.entities.receivables).toBe(financialBefore.receivables);
    expect(sale.entities.collections).toBe(financialBefore.collections);
  });

  it("keeps the canonical whole-property target available for a mixed asset without a virtual unit", () => {
    const wholeMixed = state();
    wholeMixed.entities.properties = [
      entity({
        id: "whole-mixed-property",
        propertyId: "whole-mixed-property",
        title: "العقار كاملًا",
        meta: {
          rentalMode: "whole",
          propertyProfile: JSON.stringify({ v: 1, purpose: "mixed" }),
        },
      }),
    ];
    wholeMixed.entities.units = [
      entity({
        id: "whole-mixed-target",
        propertyId: "whole-mixed-property",
        title: "الهدف الداخلي للعقار",
        meta: { wholeProperty: true },
      }),
    ];

    expect(
      listAvailableLettingTargets(wholeMixed.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["whole-mixed-target"]);
    expect(wholeMixed.entities.units).toHaveLength(1);
  });

  it("runs an individual case through activation and stores cheque receipts as received, never cash", () => {
    const issued = contractIssued();
    const applicationId = issued.created.result.id;
    const contract = getLettingContract(
      issued.decision.state.entities,
      applicationId
    );
    expect(contract?.lease.amountMinor).toBe(200_000);
    expect(contract?.content).toContain("غير معتمدة قانونيًا");
    expect(contract?.document.meta.termsReviewRequired).toBe(true);
    expect(contract?.content).not.toContain("معتمد قانونيًا");

    const schedule = getLettingChequeSchedule(
      issued.decision.state.entities,
      applicationId
    );
    expect(schedule).toEqual([
      { dueDate: "2026-10-25", amountMinor: 200_000 },
      { dueDate: "2026-11-25", amountMinor: 200_000 },
      { dueDate: "2026-12-25", amountMinor: 200_000 },
    ]);

    const signed = attachLettingDocument(issued.decision.state, {
      requestId: "signed-1",
      applicationId,
      kind: "signed-contract",
      descriptor: descriptor("signed-1"),
    });
    const chequeImage = attachLettingDocument(signed.state, {
      requestId: "cheque-image-1",
      applicationId,
      kind: "cheque-image",
      descriptor: descriptor("cheque-image-1", "image/jpeg"),
    });
    const returns = submitLettingReturns(chequeImage.state, {
      requestId: "returns-1",
      applicationId,
      cheques: schedule.map((row, index) => ({
        number: `CH-${index + 1}`,
        bank: "بنك الاختبار",
        amountMinor: row.amountMinor,
        dueDate: row.dueDate,
      })),
    });
    expect(returns.state.entities.collections).toHaveLength(0);
    expect(
      getLettingCase(returns.state.entities, applicationId).cheques
    ).toHaveLength(3);

    const slot = addLettingSlot(returns.state, {
      requestId: "slot-1",
      employee: "موظف التسليم",
      start: "2026-10-25T10:00:00+03:00",
      end: "2026-10-25T11:00:00+03:00",
      portfolioId: "portfolio-a",
    });
    const booked = bookLettingAppointment(slot.state, {
      requestId: "book-1",
      applicationId,
      slotId: slot.result.id,
    });
    // Advance the declared scenario only when the scheduled handover day arrives.
    const handoverDay = {
      ...booked.state,
      settings: { ...booked.state.settings, scenarioDate: "2026-10-25" },
    };
    const photo = attachLettingDocument(handoverDay, {
      requestId: "photo-1",
      applicationId,
      kind: "handover-photo",
      descriptor: descriptor("photo-1", "image/jpeg"),
    });
    const handover = submitLettingHandover(photo.state, {
      requestId: "handover-1",
      applicationId,
      date: "2026-10-25",
      conditionNotes: "حالة العقار موثقة بصور المستأجر.",
      tenantDeclaration: true,
    });
    const completed = completeLettingApplication(handover.state, {
      requestId: "complete-1",
      applicationId,
      originalContractReceived: true,
      originalChequesReceived: true,
      receivedDate: "2026-10-25",
    });

    expect(getLettingCase(completed.state.entities, applicationId).stage).toBe(
      "completed"
    );
    expect(completed.state.entities.receivables).toHaveLength(3);
    expect(completed.state.entities.collections).toHaveLength(3);
    expect(
      completed.state.entities.collections.every(row => row.status === "مستلم")
    ).toBe(true);
    expect(
      completed.state.entities.collections.every(
        row => row.meta.method === "شيك"
      )
    ).toBe(true);
    expect(
      completed.state.entities.collections.every(row => !row.meta.cleared)
    ).toBe(true);
    expect(
      completed.state.entities.collections.every(row => row.meta.chequeNumber)
    ).toBe(true);
    expect(
      completed.state.entities.collections.some(
        row => row.meta.method === "نقد"
      )
    ).toBe(false);

    const retry = completeLettingApplication(completed.state, {
      requestId: "complete-1",
      applicationId,
      originalContractReceived: true,
      originalChequesReceived: true,
      receivedDate: "2026-10-25",
    });
    expect(retry.state).toBe(completed.state);
    expect(retry.result).toBe(completed.result);
  });

  it("keeps missing score policy as needs-review rather than manufacturing zero values or OCR claims", () => {
    const created = createIndividual();
    const profile = updateLettingProfile(
      created.state,
      created.result.id,
      individualProfile()
    );
    const identity = attachLettingDocument(profile.state, {
      requestId: "identity-missing-score",
      applicationId: created.result.id,
      kind: "identity",
      descriptor: descriptor("identity-missing-score"),
    });
    const credit = attachLettingDocument(identity.state, {
      requestId: "credit-missing-score",
      applicationId: created.result.id,
      kind: "credit",
      descriptor: descriptor("credit-missing-score"),
    });
    const review = reviewLettingApplication(credit.state, {
      requestId: "review-missing-score",
      applicationId: created.result.id,
      minimumRentMinor: null,
      minimumCreditScore: null,
      creditScore: null,
      scoreScaleMax: null,
      creditReportDate: "",
      creditSourceReviewed: false,
      creditSource: "",
      documentsReviewed: false,
      maximumReportAgeDays: null,
    });
    const recommendation = evaluateLettingRecommendation(
      review.state.entities,
      created.result.id
    );
    expect(recommendation.outcome).toBe("needs-review");
    expect(recommendation.missing).toContain("حد الإيجار الأدنى المهيأ");
    expect(recommendation.missing).toContain("درجة الكردت");
    expect(review.result.meta.label).toContain("لا تحقق ائتماني رسمي أو OCR");
    expect(JSON.stringify(review.result.meta).toLowerCase()).not.toContain(
      "verified"
    );
  });

  it("enforces the complete company profile, four documents, and mandatory authorized representative", () => {
    const created = createLettingApplication(state(), {
      requestId: "company-intake",
      messageId: "company-message",
      applicantKind: "company",
      propertyId: "property-a",
      unitId: "unit-a",
      name: "جهة الاتصال",
      email: "contact@example.test",
      phone: "+97451111111",
      offerMinor: 200_000,
      startDate: "2026-10-25",
      endDate: "2026-12-25",
      message: "",
    });
    expect(() =>
      updateLettingProfile(created.state, created.result.id, {
        ...individualProfile(),
        name: "جهة الاتصال",
        email: "contact@example.test",
        phone: "+97451111111",
        companyName: "شركة الاختبار",
        companyNumber: "CR-1",
        establishmentNumber: "EST-1",
        companyAddress: "الدوحة",
        companyWebsite: "https://example.test",
        authorizedName: "",
      })
    ).toThrow("المفوض");

    const completeProfile = updateLettingProfile(
      created.state,
      created.result.id,
      {
        ...individualProfile(),
        name: "جهة الاتصال",
        email: "contact@example.test",
        phone: "+97451111111",
        identityNumber: "",
        companyName: "شركة الاختبار",
        companyNumber: "CR-1",
        establishmentNumber: "EST-1",
        companyAddress: "الدوحة",
        companyWebsite: "https://example.test",
        authorizedName: "المفوض بالتوقيع",
      }
    );
    let current = completeProfile.state;
    for (const kind of [
      "identity",
      "credit",
      "commercial",
      "establishment",
    ] as const) {
      current = attachLettingDocument(current, {
        requestId: `company-${kind}`,
        applicationId: created.result.id,
        kind,
        descriptor: descriptor(`company-${kind}`),
      }).state;
    }
    const reviewed = reviewLettingApplication(current, {
      requestId: "company-review",
      applicationId: created.result.id,
      minimumRentMinor: 100_000,
      minimumCreditScore: 10,
      creditScore: 50,
      scoreScaleMax: 100,
      creditReportDate: "2026-10-24",
      creditSourceReviewed: true,
      creditSource: "مصدر داخلي موثق للمراجعة",
      documentsReviewed: true,
      maximumReportAgeDays: 30,
    });
    expect(
      evaluateLettingRecommendation(reviewed.state.entities, created.result.id)
        .outcome
    ).toBe("recommend-approve");
  });

  it("records a terminal employee rejection with an audit trail and no financial side effects", () => {
    const ready = readyForDecision();
    const rejected = decideLettingApplication(ready.review.state, {
      requestId: "reject-1",
      applicationId: ready.created.result.id,
      decision: "reject",
      reason: "العرض لا يطابق سياسة التأجير الحالية.",
      propertyNumber: "",
      electricityNumber: "",
    });
    expect(
      getLettingCase(rejected.state.entities, ready.created.result.id).stage
    ).toBe("rejected");
    expect(rejected.state.entities.leases).toHaveLength(0);
    expect(rejected.state.entities.receivables).toHaveLength(0);
    expect(rejected.state.entities.collections).toHaveLength(0);
    expect(rejected.state.audit[0]?.title).toBe("رفض طلب تأجير");

    const retry = decideLettingApplication(rejected.state, {
      requestId: "reject-1",
      applicationId: ready.created.result.id,
      decision: "reject",
      reason: "العرض لا يطابق سياسة التأجير الحالية.",
      propertyNumber: "",
      electricityNumber: "",
    });
    expect(retry.state).toBe(rejected.state);
  });

  it("rejects duplicate cheques, reserves approved selections without treating them as occupied, and leaves failed work unchanged", () => {
    const issued = contractIssued();
    const applicationId = issued.created.result.id;
    const beforeDuplicate = JSON.stringify(issued.decision.state);
    const signed = attachLettingDocument(issued.decision.state, {
      requestId: "signed-duplicate",
      applicationId,
      kind: "signed-contract",
      descriptor: descriptor("signed-duplicate"),
    });
    const chequeImage = attachLettingDocument(signed.state, {
      requestId: "image-duplicate",
      applicationId,
      kind: "cheque-image",
      descriptor: descriptor("image-duplicate"),
    });
    const schedule = getLettingChequeSchedule(
      chequeImage.state.entities,
      applicationId
    );
    const before = JSON.stringify(chequeImage.state);
    expect(() =>
      submitLettingReturns(chequeImage.state, {
        requestId: "returns-duplicate",
        applicationId,
        cheques: [
          {
            number: "D-1",
            bank: "بنك",
            amountMinor: 100_000,
            dueDate: schedule[0].dueDate,
          },
          {
            number: "D-1",
            bank: "بنك",
            amountMinor: 100_000,
            dueDate: schedule[0].dueDate,
          },
        ],
      })
    ).toThrow("مكرران");
    expect(JSON.stringify(chequeImage.state)).toBe(before);
    expect(beforeDuplicate).not.toBe("");

    // The current application remains a reservation after decision, while no
    // lease has been activated and therefore unitOccupancyAt still reports vacant.
    expect(
      listAvailableLettingTargets(
        issued.decision.state.entities,
        "2026-10-24"
      ).map(row => row.id)
    ).toEqual(["unit-b"]);
    expect(issued.decision.state.entities.units[0].status).toBe("شاغرة");
  });

  it("makes employee slots globally disjoint across portfolios and keeps mail records preview-only", () => {
    const initial = state();
    const first = addLettingSlot(initial, {
      requestId: "global-slot-a",
      employee: "الموظف المشترك",
      start: "2026-10-25T09:00:00+03:00",
      end: "2026-10-25T10:00:00+03:00",
      portfolioId: "portfolio-a",
    });
    expect(() =>
      addLettingSlot(first.state, {
        requestId: "global-slot-b",
        employee: "الموظف المشترك",
        start: "2026-10-25T09:30:00+03:00",
        end: "2026-10-25T10:30:00+03:00",
        portfolioId: "portfolio-b",
      })
    ).toThrow("متداخل");

    const created = createIndividual();
    const mail = created.state.entities.notifications[0];
    expect(mail.meta.from).toBe("suhaim@qissatec.com");
    expect(mail.meta.delivery).toBe("preview-only");
    expect(String(mail.meta.body).length).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(created.state.entities.notifications)).not.toMatch(
      /smtp|gmail|https?:\/\//i
    );
  });
});

describe("letting engine · initial tenancy declarations", () => {
  it("fails closed for current and future declarations, restores expired vacancies, and lets an explicitly vacant split unit remain available", () => {
    const declaration = (value: Record<string, string>) =>
      JSON.stringify({ v: 1, ...value });
    const withParentDeclaration = (value: Record<string, string>) => {
      const next = state();
      next.entities.properties[0] = {
        ...next.entities.properties[0],
        meta: {
          ...next.entities.properties[0].meta,
          tenancyDeclaration: declaration(value),
        },
      };
      return next;
    };

    expect(
      listAvailableLettingTargets(
        withParentDeclaration({
          status: "rented",
          startDate: "2026-10-01",
          endDate: "2026-11-01",
        }).entities,
        "2026-10-24"
      ).map(unit => unit.id)
    ).toEqual(["unit-b"]);
    expect(
      listAvailableLettingTargets(
        withParentDeclaration({
          status: "rented",
          startDate: "2026-10-25",
          endDate: "2026-12-31",
        }).entities,
        "2026-10-24"
      ).map(unit => unit.id)
    ).toEqual(["unit-b"]);

    const expired = withParentDeclaration({
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2026-10-23",
    });
    expect(
      listAvailableLettingTargets(expired.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-a", "unit-b"]);

    const split = withParentDeclaration({
      status: "rented",
      startDate: "2026-10-01",
      endDate: "2026-11-01",
    });
    const parentDeclaration = split.entities.properties[0].meta.tenancyDeclaration;
    split.entities.units[0] = {
      ...split.entities.units[0],
      meta: { tenancyDeclaration: declaration({ status: "vacant" }) },
    };
    expect(
      listAvailableLettingTargets(split.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-a", "unit-b"]);
    expect(split.entities.properties[0].meta.tenancyDeclaration).toBe(
      parentDeclaration
    );

    const malformed = state();
    malformed.entities.properties[0] = {
      ...malformed.entities.properties[0],
      meta: {
        ...malformed.entities.properties[0].meta,
        tenancyDeclaration: "{invalid-json",
      },
    };
    expect(
      listAvailableLettingTargets(malformed.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-b"]);
  });

  it("rejects direct intake for a declared rented target without changing finance, and never applies another property's declaration", () => {
    const blocked = state();
    blocked.entities.properties[0] = {
      ...blocked.entities.properties[0],
      meta: {
        ...blocked.entities.properties[0].meta,
        tenancyDeclaration: JSON.stringify({
          v: 1,
          status: "rented",
          startDate: "2026-10-01",
          endDate: "2026-11-01",
        }),
      },
    };
    const financialBefore = {
      leases: blocked.entities.leases,
      receivables: blocked.entities.receivables,
      collections: blocked.entities.collections,
    };
    expect(() => createIndividual(blocked)).toThrow("ليست شاغرة");
    expect(blocked.entities.leases).toBe(financialBefore.leases);
    expect(blocked.entities.receivables).toBe(financialBefore.receivables);
    expect(blocked.entities.collections).toBe(financialBefore.collections);

    const isolated = state();
    isolated.entities.properties[1] = {
      ...isolated.entities.properties[1],
      meta: {
        ...isolated.entities.properties[1].meta,
        tenancyDeclaration: JSON.stringify({
          v: 1,
          status: "rented",
          startDate: "2026-10-01",
          endDate: "2026-11-01",
        }),
      },
    };
    expect(
      listAvailableLettingTargets(isolated.entities, "2026-10-24").map(
        unit => unit.id
      )
    ).toEqual(["unit-a"]);
    expect(createIndividual(isolated).result.propertyId).toBe("property-a");
  });
});
