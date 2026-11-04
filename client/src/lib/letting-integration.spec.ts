import { describe, it, expect } from "vitest";
import { createDemoState } from "./demo-data";
import { ENTITY_KINDS, type PrototypeState } from "@shared/prototype";
import { assertPrototypeState } from "@shared/prototype-validation";
import { financialSummary } from "./prototype-finance";
import { unitOccupancyAt } from "./prototype-lease-lifecycle";
import {
  createLettingApplication,
  updateLettingProfile,
  attachLettingDocument,
  reviewLettingApplication,
  decideLettingApplication,
  submitLettingReturns,
  addLettingSlot,
  bookLettingAppointment,
  submitLettingHandover,
  completeLettingApplication,
  getLettingCase,
  getLettingContract,
  getLettingChequeSchedule,
  evaluateLettingRecommendation,
  listAvailableLettingTargets,
} from "./letting-engine";
function setup() {
  const seed = createDemoState();
  const property = structuredClone(
    seed.entities.properties.find(x => x.id === "villa")!
  );
  const unit = structuredClone(
    seed.entities.units.find(x => x.propertyId === property.id)!
  );
  unit.status = "شاغرة";
  unit.amountMinor = 0;
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(k => [k, []])
  ) as unknown as PrototypeState["entities"];
  entities.portfolios = [
    structuredClone(
      seed.entities.portfolios.find(x => x.id === property.portfolioId)!
    ),
  ];
  entities.properties = [property];
  entities.units = [unit];
  const state: PrototypeState = {
    ...seed,
    entities,
    audit: [],
    settings: {
      ...seed.settings,
      role: "operator",
      portfolioId: "all",
      period: "all",
      scenarioDate: "2026-10-25",
    },
  };
  return { state, property, unit };
}
function paperwork(state: PrototypeState, id: string) {
  state = updateLettingProfile(state, id, {
    name: "شركة اختبار",
    email: "applicant@example.test",
    phone: "55000000",
    identityNumber: "TEST-100",
    companyName: "شركة اختبار",
    companyNumber: "CR-TEST-001",
    establishmentNumber: "EST-TEST-001",
    companyAddress: "عنوان مصطنع للاختبار",
    companyWebsite: "https://company.example.test",
    authorizedName: "مفوض اختبار",
  }).state;
  for (const kind of [
    "identity",
    "credit",
    "commercial",
    "establishment",
  ] as const)
    state = attachLettingDocument(state, {
      requestId: crypto.randomUUID(),
      applicationId: id,
      kind,
      descriptor: {
        id: crypto.randomUUID(),
        name: `${kind}-test.pdf`,
        mime: "application/pdf",
        size: 100,
      },
    }).state;
  return state;
}
describe("letting journey uses the shared asset and financial state", () => {
  it("links an intake to the chosen one of nine vacant units in the same building", () => {
    const { state, property, unit } = setup();
    state.entities.properties = [
      {
        ...property,
        meta: { ...property.meta, rentalMode: "units", unitCount: 9 },
      },
    ];
    state.entities.units = Array.from({ length: 9 }, (_, index) => ({
      ...unit,
      id: `nine-unit-${index + 1}`,
      title: `وحدة ${index + 1}`,
      meta: { ...unit.meta, wholeProperty: false, unitCode: String(index + 1) },
    }));
    const targets = listAvailableLettingTargets(state.entities, "2026-10-25");
    expect(targets).toHaveLength(9);
    const result = createLettingApplication(state, {
      requestId: "nine-unit-intake",
      messageId: "nine-unit-email",
      applicantKind: "individual",
      propertyId: property.id,
      unitId: "nine-unit-7",
      name: "متقدم اختبار",
      email: "nine@example.test",
      phone: "55000000",
      offerMinor: 200000,
      startDate: "2026-10-25",
      endDate: "2027-10-24",
      message: "طلب وحدة رقم 7",
    });
    expect(result.result.propertyId).toBe(property.id);
    expect(result.result.meta.unitId).toBe("nine-unit-7");
    expect(result.state.entities.units).toHaveLength(9);
    expect(result.state.entities.leases).toHaveLength(0);
  });
  it("company approval to handover creates dues and received cheques once, without cash", () => {
    let { state, property, unit } = setup();
    const cashBefore = financialSummary(
      state.entities,
      "all",
      "all",
      "2026-10-25"
    ).cashMinor;
    const received = createLettingApplication(state, {
      requestId: "intake-comp",
      messageId: "mail-test-1",
      applicantKind: "company",
      propertyId: property.id,
      unitId: unit.id,
      name: "شركة اختبار",
      email: "applicant@example.test",
      phone: "55000000",
      offerMinor: 400000,
      startDate: "2026-10-25",
      endDate: "2026-11-24",
      message: "أرغب في تأجير هذا العقار - اختبار فقط",
    });
    state = paperwork(received.state, received.result.id);
    const id = received.result.id;
    state = reviewLettingApplication(state, {
      requestId: "review-comp",
      applicationId: id,
      minimumRentMinor: 350000,
      minimumCreditScore: 600,
      creditScore: 720,
      scoreScaleMax: 1000,
      creditReportDate: "2026-10-24",
      creditSourceReviewed: true,
      creditSource: "تقرير مصطنع راجعه الموظف للاختبار",
      documentsReviewed: true,
      maximumReportAgeDays: 30,
    }).state;
    expect(evaluateLettingRecommendation(state.entities, id).outcome).toBe(
      "recommend-approve"
    );
    state = decideLettingApplication(state, {
      requestId: "approve-comp",
      applicationId: id,
      decision: "approve",
      reason: "راجعت بيانات المثال وشروط المسودة التجريبية وأوافق",
      propertyNumber: "000101",
      electricityNumber: "000202",
    }).state;
    const contractText = getLettingContract(state.entities, id)!.content;
    for (const expected of [
      "CR-TEST-001",
      "EST-TEST-001",
      "مفوض اختبار",
      "applicant@example.test",
      "55000000",
      "عنوان مصطنع للاختبار",
      "https://company.example.test",
      "TEST-100",
      "000101",
      "000202",
      "مدة العقد:",
      "نوع العقار:",
    ])
      expect(contractText).toContain(expected);
    expect(state.entities.receivables).toHaveLength(0);
    expect(unitOccupancyAt(state.entities, unit.id, "2026-10-25")).not.toBe(
      "occupied"
    );
    for (const kind of ["signed-contract", "cheque-image"] as const)
      state = attachLettingDocument(state, {
        requestId: kind,
        applicationId: id,
        kind,
        descriptor: {
          id: crypto.randomUUID(),
          name: `${kind}-test.pdf`,
          mime: "application/pdf",
          size: 100,
        },
      }).state;
    const checks = getLettingChequeSchedule(state.entities, id).map((x, i) => ({
      number: `TEST-CH-${i}`,
      bank: "بنك اختبار",
      amountMinor: x.amountMinor,
      dueDate: x.dueDate,
    }));
    state = submitLettingReturns(state, {
      requestId: "returns-comp",
      applicationId: id,
      cheques: checks,
    }).state;
    const slot = addLettingSlot(state, {
      requestId: "slot-comp",
      employee: "موظف اختبار",
      portfolioId: property.portfolioId,
      start: "2026-10-25T09:00:00+03:00",
      end: "2026-10-25T10:00:00+03:00",
    });
    state = bookLettingAppointment(slot.state, {
      requestId: "book-comp",
      applicationId: id,
      slotId: slot.result.id,
    }).state;
    state = attachLettingDocument(state, {
      requestId: "photo-comp",
      applicationId: id,
      kind: "handover-photo",
      descriptor: {
        id: crypto.randomUUID(),
        name: "condition-test.png",
        mime: "image/png",
        size: 90,
      },
    }).state;
    const earlierScenario = {
      ...state,
      settings: { ...state.settings, scenarioDate: "2026-10-24" },
    };
    expect(() =>
      submitLettingHandover(earlierScenario, {
        requestId: "future-handover",
        applicationId: id,
        date: "2026-10-25",
        conditionNotes: "تاريخ لم يقع بعد",
        tenantDeclaration: true,
      })
    ).toThrow(/مستقبلي/);
    state = submitLettingHandover(state, {
      requestId: "handover-comp",
      applicationId: id,
      date: "2026-10-25",
      conditionNotes: "صور حالة قبل السكن؛ اختبار فقط",
      tenantDeclaration: true,
    }).state;
    const finalInput = {
      requestId: "complete-comp",
      applicationId: id,
      originalContractReceived: true,
      originalChequesReceived: true,
      receivedDate: "2026-10-25",
    };
    expect(() =>
      completeLettingApplication(state, {
        ...finalInput,
        requestId: "future-complete",
        receivedDate: "2026-10-26",
      })
    ).toThrow(/مستقبلي/);
    state = {
      ...state,
      settings: { ...state.settings, scenarioDate: "2026-10-26" },
    };
    state = completeLettingApplication(state, finalInput).state;
    expect(getLettingCase(state.entities, id).lease!.meta.activatedAt).toBe(
      "2026-10-25"
    );
    expect(getLettingCase(state.entities, id).stage).toBe("completed");
    expect(unitOccupancyAt(state.entities, unit.id, "2026-10-25")).toBe(
      "occupied"
    );
    expect(state.entities.receivables.length).toBeGreaterThan(0);
    expect(state.entities.collections).toHaveLength(checks.length);
    expect(
      state.entities.collections.every(
        x => x.status === "مستلم" && x.meta.method === "شيك"
      )
    ).toBe(true);
    expect(
      financialSummary(state.entities, "all", "all", "2026-10-25").cashMinor
    ).toBe(cashBefore);
    const afterRetry = completeLettingApplication(state, finalInput).state;
    expect(afterRetry.entities.leases).toHaveLength(
      state.entities.leases.length
    );
    expect(afterRetry.entities.receivables).toHaveLength(
      state.entities.receivables.length
    );
    expect(afterRetry.entities.collections).toHaveLength(
      state.entities.collections.length
    );
    expect(afterRetry.entities.notifications).toHaveLength(
      state.entities.notifications.length
    );
    expect(assertPrototypeState(afterRetry)).toBeDefined();
  });
  it("intake retry creates one request and one preview email, never a lease or income", () => {
    const { state, property, unit } = setup();
    const input = {
      requestId: "intake-ind",
      messageId: "msg-id-unique",
      applicantKind: "individual" as const,
      propertyId: property.id,
      unitId: unit.id,
      name: "فرد اختبار",
      email: "person@example.test",
      phone: "55000001",
      offerMinor: 400000,
      startDate: "2026-10-25",
      endDate: "2026-11-24",
      message: "طلب اختبار",
    };
    const a = createLettingApplication(state, input);
    const b = createLettingApplication(a.state, input);
    expect(b.state.entities.applications).toHaveLength(1);
    expect(b.state.entities.notifications).toHaveLength(1);
    expect(b.state.entities.leases).toHaveLength(0);
    expect(b.state.entities.collections).toHaveLength(0);
    expect(
      evaluateLettingRecommendation(b.state.entities, a.result.id).outcome
    ).toBe("needs-review");
    expect(b.state.entities.notifications[0].meta.from).toBe(
      "suhaim@qissatec.com"
    );
    expect(b.state.entities.notifications[0].meta.delivery).toBe(
      "preview-only"
    );
  });
});
