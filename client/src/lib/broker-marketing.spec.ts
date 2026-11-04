import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  money,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  createBrokerContact,
  getBrokerCampaignBrief,
  listBrokerTargets,
  saveBrokerCampaign,
  simulateBrokerCampaignDispatch,
  updateBrokerContact,
} from "./broker-marketing";
import { brokerEmailDraftText } from "./broker-email-drafts";

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
    entity({ id: "portfolio-a", title: "محفظة الاختبار", propertyId: "" }),
  ];
  entities.properties = [
    entity({
      id: "property-a",
      title: "عمارة اختبار الوسطاء",
      propertyId: "property-a",
      meta: {
        rentalMode: "units",
        propertyNumber: "P-901",
        monthlyRentMinor: 430_000,
      },
    }),
  ];
  entities.units = Array.from({ length: 9 }, (_, index) =>
    entity({
      id: `unit-${index + 1}`,
      title: `وحدة ${index + 1}`,
      propertyId: "property-a",
      status: "شاغرة",
      amountMinor: 430_000,
      meta: { unitCode: `U-${String(index + 1).padStart(2, "0")}` },
    })
  );
  entities.leases = [
    entity({
      id: "active-lease",
      title: "عقد نافذ",
      propertyId: "property-a",
      status: "نافذ",
      date: "2026-01-01",
      meta: {
        unitId: "unit-1",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        lifecycleActivated: true,
      },
    }),
  ];
  entities.applications = [
    entity({
      id: "booked-application",
      title: "طلب مؤكد",
      propertyId: "property-a",
      status: "موافق عليه",
      meta: {
        recordType: "letting-application",
        stage: "contract-issued",
        unitId: "unit-2",
      },
    }),
  ];
  entities.collections = [
    entity({ id: "cash-unchanged", title: "تحصيل", amountMinor: 120_000 }),
  ];
  entities.receivables = [
    entity({ id: "due-unchanged", title: "استحقاق", amountMinor: 430_000 }),
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

function withBroker(initial: PrototypeState) {
  return createBrokerContact(initial, {
    requestId: "broker-contact-1",
    companyName: "شركة وسيط تجريبية",
    email: "suhaim@qissatec.com",
    contactName: "جهة اتصال تجريبية",
  });
}

function activeLease(
  id: string,
  unitId: string,
  endDate: string,
  startDate = "2026-01-01"
): DemoEntity {
  return entity({
    id,
    title: `عقد ${id}`,
    propertyId: "property-a",
    status: "نافذ",
    date: startDate,
    meta: { unitId, startDate, endDate, lifecycleActivated: true },
  });
}

describe("broker marketing · local unsent previews", () => {
  it("lists only seven of nine units when one has an active lease and one is reserved by an approved application", () => {
    const targets = listBrokerTargets(state());
    expect(targets).toHaveLength(7);
    expect(targets.map(target => target.id)).not.toContain("unit-1");
    expect(targets.map(target => target.id)).not.toContain("unit-2");
    expect(targets[0]).toMatchObject({
      propertyNumber: "P-901",
      unitCode: "U-03",
    });
  });

  it("markets only explicitly rental units in a mixed property without changing active or financial history", () => {
    const mixed = state();
    mixed.entities.leases = [];
    mixed.entities.applications = [];
    mixed.entities.properties[0] = {
      ...mixed.entities.properties[0],
      meta: {
        ...mixed.entities.properties[0].meta,
        propertyProfile: JSON.stringify({ v: 1, purpose: "mixed" }),
      },
    };
    mixed.entities.units = [
      entity({
        id: "unit-rent",
        title: "وحدة للإيجار",
        propertyId: "property-a",
        meta: {
          unitCode: "R-1",
          unitProfile: JSON.stringify({ v: 1, purpose: "rent" }),
        },
      }),
      entity({
        id: "unit-sale",
        title: "وحدة للبيع",
        propertyId: "property-a",
        meta: {
          unitCode: "S-1",
          unitProfile: JSON.stringify({ v: 1, purpose: "sale" }),
        },
      }),
      entity({
        id: "unit-unassigned",
        title: "وحدة مختلطة غير مخصصة",
        propertyId: "property-a",
        meta: { unitCode: "U-1", unitProfile: JSON.stringify({ v: 1 }) },
      }),
    ];
    const financialBefore = {
      leases: mixed.entities.leases,
      receivables: mixed.entities.receivables,
      collections: mixed.entities.collections,
    };

    expect(listBrokerTargets(mixed).map(target => target.id)).toEqual([
      "unit-rent",
    ]);
    expect(mixed.entities.leases).toBe(financialBefore.leases);
    expect(mixed.entities.receivables).toBe(financialBefore.receivables);
    expect(mixed.entities.collections).toBe(financialBefore.collections);

    const broker = withBroker(mixed);
    expect(() =>
      saveBrokerCampaign(broker.state, {
        requestId: "mixed-sale-campaign",
        title: "عرض لا يصلح للإيجار",
        content: "معاينة محلية فقط",
        targetIds: ["unit-sale"],
        brokerIds: [broker.result.id],
        targetRentsMinor: { "unit-sale": 430_000 },
      })
    ).toThrow("لم يعد شاغرًا");
    expect(broker.state.entities.leases).toBe(financialBefore.leases);
    expect(broker.state.entities.receivables).toBe(
      financialBefore.receivables
    );
    expect(broker.state.entities.collections).toBe(financialBefore.collections);
  });

  it("keeps a mixed whole-property rental target eligible without inventing another unit", () => {
    const wholeMixed = state();
    wholeMixed.entities.properties = [
      entity({
        id: "whole-mixed-property",
        propertyId: "whole-mixed-property",
        title: "أصل كامل للبيع والإيجار",
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
        title: "العقار كاملًا",
        meta: { wholeProperty: true, unitCode: "WHOLE" },
      }),
    ];
    wholeMixed.entities.leases = [];
    wholeMixed.entities.applications = [];

    expect(listBrokerTargets(wholeMixed).map(target => target.id)).toEqual([
      "whole-mixed-target",
    ]);
    expect(wholeMixed.entities.units).toHaveLength(1);
  });

  it("never prefills marketing rent from an asset value or a building's aggregate rent", () => {
    const initial = state();
    initial.entities.properties[0].meta.monthlyRentMinor = 27_000_000;
    initial.entities.units.forEach(unit => {
      unit.amountMinor = 240_000_000;
    });
    const targets = listBrokerTargets(initial);
    expect(targets).toHaveLength(7);
    expect(
      targets.every(target => target.suggestedMonthlyRentMinor === 0)
    ).toBe(true);
    const contact = withBroker(initial);
    expect(() =>
      saveBrokerCampaign(contact.state, {
        requestId: "must-enter-rent",
        title: "حملة اختبار",
        content: "معاينة فقط",
        targetIds: [targets[0].id],
        brokerIds: [contact.result.id],
        targetRentsMinor: {},
      })
    ).toThrow(/الإيجار الشهري/);
  });

  it("does not market a whole property twice when malformed data contains two whole-property units", () => {
    const whole = state();
    whole.entities.properties = [
      entity({
        id: "whole-property",
        propertyId: "whole-property",
        title: "فيلا كاملة",
        meta: { rentalMode: "whole", propertyNumber: "W-1" },
      }),
    ];
    whole.entities.units = [
      entity({
        id: "whole-one",
        propertyId: "whole-property",
        title: "العقار كاملًا",
        meta: { wholeProperty: true, unitCode: "W-1" },
      }),
      entity({
        id: "whole-two",
        propertyId: "whole-property",
        title: "نسخة هدف غير صالحة",
        meta: { wholeProperty: true, unitCode: "W-1B" },
      }),
    ];
    whole.entities.leases = [];
    whole.entities.applications = [];
    expect(listBrokerTargets(whole)).toEqual([]);
  });

  it("rejects a case-insensitive duplicate broker email without adding another vendor", () => {
    const first = withBroker(state());
    expect(() =>
      createBrokerContact(first.state, {
        requestId: "broker-contact-2",
        companyName: "شركة مختلفة",
        email: "SUHAIM@QISSATEC.COM",
        contactName: "جهة اتصال أخرى",
      })
    ).toThrow("بنفس البريد الإلكتروني");
    expect(first.state.entities.vendors).toHaveLength(1);
    expect(first.state.entities.vendors[0].meta.recordType).toBe(
      "broker-contact"
    );
  });

  it("rejects a negative campaign rent before committing any document", () => {
    const contact = withBroker(state());
    expect(() =>
      saveBrokerCampaign(contact.state, {
        requestId: "campaign-negative-rent",
        title: "معاينة إيجار أكتوبر",
        content: "نص معاينة محلي فقط.",
        targetIds: ["unit-3"],
        brokerIds: [contact.result.id],
        targetRentsMinor: { "unit-3": -1 },
      })
    ).toThrow("موجب");
    expect(contact.state.entities.documents).toHaveLength(0);
  });

  it("revalidates availability, preserves all financial entities, and remains unsent", () => {
    const contact = withBroker(state());
    const financeBefore = {
      leases: contact.state.entities.leases,
      units: contact.state.entities.units,
      receivables: contact.state.entities.receivables,
      collections: contact.state.entities.collections,
      payments: contact.state.entities.payments,
      bank: contact.state.entities.bankTransactions,
    };
    const saved = saveBrokerCampaign(contact.state, {
      requestId: "campaign-save-1",
      title: "معاينة وحدات شاغرة",
      content: "هذه معاينة محلية فقط، ولا توجد رسالة خارجية أو مرفق.",
      targetIds: ["unit-3", "unit-4"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "unit-3": 430_000, "unit-4": 440_000 },
    });

    expect(saved.result.status).toBe("معاينة غير مرسلة");
    expect(saved.result.meta.recordType).toBe("broker-campaign");
    expect(String(saved.result.meta.targetsJSON).length).toBeLessThanOrEqual(
      1024
    );
    expect(saved.state.entities.leases).toBe(financeBefore.leases);
    expect(saved.state.entities.units).toBe(financeBefore.units);
    expect(saved.state.entities.receivables).toBe(financeBefore.receivables);
    expect(saved.state.entities.collections).toBe(financeBefore.collections);
    expect(saved.state.entities.payments).toBe(financeBefore.payments);
    expect(saved.state.entities.bankTransactions).toBe(financeBefore.bank);
  });

  it("blocks a target that becomes reserved before the latest-state save", () => {
    const contact = withBroker(state());
    const reservedLatest: PrototypeState = {
      ...contact.state,
      entities: {
        ...contact.state.entities,
        applications: [
          ...contact.state.entities.applications,
          entity({
            id: "parallel-approved",
            title: "حجز موازٍ",
            propertyId: "property-a",
            status: "معتمد",
            meta: {
              recordType: "letting-application",
              stage: "contract-issued",
              unitId: "unit-3",
            },
          }),
        ],
      },
    };
    expect(() =>
      saveBrokerCampaign(reservedLatest, {
        requestId: "campaign-race",
        title: "حملة متأخرة",
        content: "معاينة محلية فقط.",
        targetIds: ["unit-3"],
        brokerIds: [contact.result.id],
        targetRentsMinor: { "unit-3": 430_000 },
      })
    ).toThrow("لم يعد شاغرًا");
  });

  it("uses requestId idempotently so a repeated click cannot create a second campaign", () => {
    const contact = withBroker(state());
    const input = {
      requestId: "campaign-double-click",
      title: "حملة الحفظ المكرر",
      content: "نص معاينة قابل للحفظ محليًا فقط.",
      targetIds: ["unit-3"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "unit-3": 430_000 },
    };
    const first = saveBrokerCampaign(contact.state, input);
    const second = saveBrokerCampaign(first.state, input);
    expect(second.state).toBe(first.state);
    expect(second.result.id).toBe(first.result.id);
    expect(second.state.entities.documents).toHaveLength(1);
  });
});

describe("broker marketing, expiring contracts, frozen briefs, and simulation", () => {
  it("uses inclusive UTC 30/60/90-day windows, with today still expiring rather than vacant", () => {
    const initial = state();
    initial.entities.leases = [
      activeLease("end-30", "unit-3", "2026-11-23"),
      activeLease("end-31", "unit-4", "2026-11-24"),
      activeLease("end-60", "unit-5", "2026-12-23"),
      activeLease("end-61", "unit-6", "2026-12-24"),
      activeLease("end-90", "unit-7", "2027-01-22"),
      activeLease("end-91", "unit-8", "2027-01-23"),
      activeLease("end-today", "unit-9", "2026-10-24"),
    ];

    expect(
      listBrokerTargets(initial).every(row => row.availability === "vacant")
    ).toBe(true);
    const at30 = listBrokerTargets(initial, {
      includeExpiring: true,
      expiringWithinDays: 30,
    });
    expect(
      at30.filter(row => row.availability === "expiring").map(row => row.id)
    ).toEqual(["unit-3", "unit-9"]);
    expect(at30.find(row => row.id === "unit-3")).toMatchObject({
      daysToExpiry: 30,
      contractEndDate: "2026-11-23",
      availableFrom: "2026-11-24",
    });
    expect(at30.find(row => row.id === "unit-9")).toMatchObject({
      daysToExpiry: 0,
      contractEndDate: "2026-10-24",
      availableFrom: "2026-10-25",
    });
    expect(
      listBrokerTargets(initial, {
        includeExpiring: true,
        expiringWithinDays: 60,
      })
        .filter(row => row.availability === "expiring")
        .map(row => row.id)
    ).toEqual(["unit-3", "unit-4", "unit-5", "unit-9"]);
    expect(
      listBrokerTargets(initial, {
        includeExpiring: true,
        expiringWithinDays: 90,
      })
        .filter(row => row.availability === "expiring")
        .map(row => row.id)
    ).toEqual(["unit-3", "unit-4", "unit-5", "unit-6", "unit-7", "unit-9"]);
    expect(() =>
      listBrokerTargets(initial, {
        includeExpiring: true,
        expiringWithinDays: 31,
      })
    ).toThrow("30 أو 60 أو 90");
  });

  it("does not advertise an expiring target when a renewal or approved hold removes its availability", () => {
    const initial = state();
    initial.entities.leases = [
      activeLease("ending", "unit-3", "2026-11-23"),
      activeLease("renewal", "unit-3", "2026-12-31", "2026-11-24"),
      activeLease("ending-held", "unit-4", "2026-11-23"),
    ];
    initial.entities.applications.push(
      entity({
        id: "approved-after-end",
        title: "حجز معتمد",
        propertyId: "property-a",
        status: "معتمد",
        meta: {
          recordType: "letting-application",
          stage: "approved-reserved",
          unitId: "unit-4",
        },
      })
    );
    const expiring = listBrokerTargets(initial, {
      includeExpiring: true,
      expiringWithinDays: 60,
    });
    expect(expiring.map(row => row.id)).not.toContain("unit-3");
    expect(expiring.map(row => row.id)).not.toContain("unit-4");
  });

  it("updates a broker idempotently, lets empty optional values clear fields, and excludes a paused broker", () => {
    const created = createBrokerContact(state(), {
      requestId: "full-contact",
      companyName: "شركة تفاصيل",
      email: "contact@example.test",
      contactName: "المسؤول الأول",
      phone: "+974 5000 0000",
      website: "https://example.test",
      address: "الدوحة",
      notes: "تفضّل الواتساب",
    });
    const input = {
      brokerId: created.result.id,
      requestId: "pause-contact",
      companyName: "شركة تفاصيل المحدثة",
      email: "UPDATED@EXAMPLE.TEST",
      contactName: "المسؤول المحدث",
      phone: "",
      website: "",
      address: "",
      notes: "",
      active: false,
    };
    const updated = updateBrokerContact(created.state, input);
    expect(updated.result.id).toBe(created.result.id);
    expect(updated.result.subtitle).toBe("مسؤول: المسؤول المحدث");
    expect(updated.result.meta).toMatchObject({
      email: "updated@example.test",
      active: false,
      updatedBrokerId: created.result.id,
    });
    expect(updated.result.meta.phone).toBeUndefined();
    expect(updated.result.meta.website).toBeUndefined();
    expect(updated.result.meta.address).toBeUndefined();
    expect(updated.result.meta.notes).toBeUndefined();
    const retry = updateBrokerContact(updated.state, input);
    expect(retry.state).toBe(updated.state);
    expect(retry.result.id).toBe(updated.result.id);
    expect(() =>
      saveBrokerCampaign(updated.state, {
        requestId: "paused-recipient",
        title: "حملة موقوفة",
        content: "محاكاة فقط",
        targetIds: ["unit-3"],
        brokerIds: [updated.result.id],
        targetRentsMinor: { "unit-3": 430_000 },
      })
    ).toThrow("موقوفة");
  });

  it("rejects multi-address, control-character, and angle-bracket email input", () => {
    for (const email of [
      "one@example.test,two@example.test",
      "one@example.test;two@example.test",
      "<one@example.test>",
      "one@example.test\r\nBcc: two@example.test",
      "one@example.test\n",
    ]) {
      expect(() =>
        createBrokerContact(state(), {
          requestId: `invalid-email-${email.length}`,
          companyName: "شركة بريد",
          email,
          contactName: "مسؤول",
        })
      ).toThrow("البريد الإلكتروني غير صحيح");
    }
  });

  it("freezes a brief without tenant or image data, retries a saved campaign after later leasing, and revalidates new simulations", () => {
    const seeded = state();
    seeded.entities.properties[0] = {
      ...seeded.entities.properties[0],
      meta: {
        ...seeded.entities.properties[0].meta,
        propertyType: "شقة",
        location: "الدوحة",
        area: 120,
        image: "https://private.example.test/asset.jpg",
      },
    };
    seeded.entities.units[2] = {
      ...seeded.entities.units[2],
      meta: { ...seeded.entities.units[2].meta, area: 120 },
    };
    const contact = createBrokerContact(seeded, {
      requestId: "freeze-contact",
      companyName: "شركة اللقطة",
      email: "frozen@example.test",
      contactName: "مسؤول اللقطة",
      phone: "+97450000000",
    });
    const input = {
      requestId: "freeze-campaign",
      title: "فرصة شقة",
      content: "وحدة قابلة للمعاينة محليًا فقط.",
      targetIds: ["unit-3"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "unit-3": 430_000 },
    };
    const saved = saveBrokerCampaign(contact.state, input);
    const brief = getBrokerCampaignBrief(saved.state, saved.result);
    expect(brief).toMatchObject({
      subject: "فرصة شقة",
      recipients: [
        {
          brokerId: contact.result.id,
          companyName: "شركة اللقطة",
          email: "frozen@example.test",
        },
      ],
      targets: [
        {
          targetId: "unit-3",
          propertyType: "شقة",
          location: "الدوحة",
          area: 120,
        },
      ],
    });
    expect(JSON.stringify(brief)).not.toContain("tenant");
    expect(JSON.stringify(brief)).not.toContain("private.example.test");

    for (const detail of [
      "P-901",
      "U-03",
      "شقة",
      "الدوحة",
      money(430_000),
      "2026-10-24",
    ]) {
      expect(brief.body).toContain(detail);
    }
    const eml = brokerEmailDraftText(brief, brief.recipients[0]);
    const emailBody = Buffer.from(
      eml.split("\r\n\r\n")[1].replace(/\s/g, ""),
      "base64"
    ).toString("utf8");
    expect(emailBody).toContain("P-901");
    expect(emailBody).toContain("U-03");
    expect(emailBody).toContain(money(430_000));

    const laterLeased: PrototypeState = {
      ...saved.state,
      entities: {
        ...saved.state.entities,
        leases: [
          ...saved.state.entities.leases,
          activeLease("later-lease", "unit-3", "2027-01-31"),
        ],
      },
    };
    const retry = saveBrokerCampaign(laterLeased, input);
    expect(retry.result.id).toBe(saved.result.id);
    expect(retry.state).toBe(laterLeased);
    expect(() =>
      simulateBrokerCampaignDispatch(laterLeased, {
        campaignId: saved.result.id,
        requestId: "simulation-after-lease",
      })
    ).toThrow("لم يعد شاغرًا");
  });

  it("records only a local simulated-not-sent dispatch and keeps a frozen recipient after contact edits", () => {
    const contact = createBrokerContact(state(), {
      requestId: "dispatch-contact",
      companyName: "شركة الإرسال",
      email: "dispatch@example.test",
      contactName: "مسؤول الإرسال",
    });
    const saved = saveBrokerCampaign(contact.state, {
      requestId: "dispatch-campaign",
      title: "تجربة محلية",
      content: "لن يتم الإرسال.",
      targetIds: ["unit-3"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "unit-3": 430_000 },
    });
    const edited = updateBrokerContact(saved.state, {
      brokerId: contact.result.id,
      requestId: "edit-after-freeze",
      companyName: "شركة تغيرت",
      email: "changed@example.test",
      contactName: "مسؤول تغير",
    });
    const frozen = getBrokerCampaignBrief(edited.state, saved.result);
    expect(frozen.recipients[0]).toMatchObject({
      companyName: "شركة الإرسال",
      email: "dispatch@example.test",
    });
    const dispatch = simulateBrokerCampaignDispatch(edited.state, {
      campaignId: saved.result.id,
      requestId: "simulate-once",
    });
    expect(dispatch.result.status).toBe("simulated-not-sent");
    expect(dispatch.result.meta.dispatchStatus).toBe("simulated-not-sent");
    expect(dispatch.result.meta.recipientJSON).toContain(
      "dispatch@example.test"
    );
    expect(dispatch.state.entities.leases).toBe(edited.state.entities.leases);
    expect(dispatch.state.entities.collections).toBe(
      edited.state.entities.collections
    );
    const retry = simulateBrokerCampaignDispatch(dispatch.state, {
      campaignId: saved.result.id,
      requestId: "simulate-once",
    });
    expect(retry.state).toBe(dispatch.state);
    expect(retry.result.id).toBe(dispatch.result.id);
  });

  it("marks legacy campaigns as current references, never invents a target, and rejects a campaign outside scope", () => {
    const contact = withBroker(state());
    const legacy = entity({
      id: "legacy-campaign",
      title: "معاينة قديمة",
      propertyId: "",
      status: "معاينة غير مرسلة",
      meta: {
        recordType: "broker-campaign",
        content: "محتوى قديم",
        targetsJSON: JSON.stringify([["unit-3", 430_000]]),
        brokerIdsChunkCount: 1,
        brokerIdsChunk0: JSON.stringify([contact.result.id]),
      },
    });
    const legacyState: PrototypeState = {
      ...contact.state,
      entities: { ...contact.state.entities, documents: [legacy] },
    };
    expect(getBrokerCampaignBrief(legacyState, legacy).body).toContain(
      "بلا لقطة موجز مجمدة"
    );
    const missingTarget = {
      ...legacyState,
      entities: {
        ...legacyState.entities,
        units: legacyState.entities.units.filter(row => row.id !== "unit-3"),
      },
    };
    expect(getBrokerCampaignBrief(missingTarget, legacy).targets).toEqual([]);

    const scoped: PrototypeState = {
      ...contact.state,
      settings: { ...contact.state.settings, portfolioId: "portfolio-a" },
    };
    const campaign = saveBrokerCampaign(scoped, {
      requestId: "scoped-campaign",
      title: "حملة محفظة أ",
      content: "محاكاة فقط",
      targetIds: ["unit-3"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "unit-3": 430_000 },
    });
    const otherScope: PrototypeState = {
      ...campaign.state,
      settings: { ...campaign.state.settings, portfolioId: "portfolio-b" },
    };
    expect(() =>
      simulateBrokerCampaignDispatch(otherScope, {
        campaignId: campaign.result.id,
        requestId: "wrong-scope",
      })
    ).toThrow("خارج نطاق المحفظة");
  });
});

describe("broker marketing · initial tenancy declarations", () => {
  it("fails closed for current, future, and malformed parent declarations, but lets an expired declaration and an explicit vacant physical unit through", () => {
    const initial = state();
    initial.entities.leases = [];
    initial.entities.applications = [];
    const declaration = (value: Record<string, string>) =>
      JSON.stringify({ v: 1, ...value });
    const withParentDeclaration = (value: Record<string, string>) => {
      const next = state();
      next.entities.leases = [];
      next.entities.applications = [];
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
      listBrokerTargets(
        withParentDeclaration({
          status: "rented",
          startDate: "2026-10-01",
          endDate: "2026-11-01",
        })
      )
    ).toEqual([]);
    expect(
      listBrokerTargets(
        withParentDeclaration({
          status: "rented",
          startDate: "2026-10-25",
          endDate: "2026-12-31",
        })
      )
    ).toEqual([]);

    const expired = withParentDeclaration({
      status: "rented",
      startDate: "2026-01-01",
      endDate: "2026-10-23",
    });
    expect(listBrokerTargets(expired).map(target => target.id)).toEqual(
      expired.entities.units.map(unit => unit.id)
    );

    const split = withParentDeclaration({
      status: "rented",
      startDate: "2026-10-01",
      endDate: "2026-11-01",
    });
    const parentDeclaration = split.entities.properties[0].meta.tenancyDeclaration;
    split.entities.units[2] = {
      ...split.entities.units[2],
      meta: {
        ...split.entities.units[2].meta,
        tenancyDeclaration: declaration({ status: "vacant" }),
      },
    };
    expect(listBrokerTargets(split).map(target => target.id)).toEqual(
      split.entities.units.map(unit => unit.id)
    );
    expect(split.entities.properties[0].meta.tenancyDeclaration).toBe(
      parentDeclaration
    );

    const malformed = state();
    malformed.entities.leases = [];
    malformed.entities.applications = [];
    malformed.entities.properties[0] = {
      ...malformed.entities.properties[0],
      meta: {
        ...malformed.entities.properties[0].meta,
        tenancyDeclaration: "{invalid-json",
      },
    };
    expect(listBrokerTargets(malformed)).toEqual([]);
  });

  it("rejects a direct campaign save for an effective declaration without changing finance, while another property's declaration cannot leak across scope", () => {
    const blocked = state();
    blocked.entities.leases = [];
    blocked.entities.applications = [];
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
    const contact = withBroker(blocked);
    const financialBefore = {
      leases: contact.state.entities.leases,
      receivables: contact.state.entities.receivables,
      collections: contact.state.entities.collections,
    };
    expect(() =>
      saveBrokerCampaign(contact.state, {
        requestId: "declared-rented-campaign",
        title: "حملة ينبغي منعها",
        content: "معاينة محلية فقط",
        targetIds: ["unit-3"],
        brokerIds: [contact.result.id],
        targetRentsMinor: { "unit-3": 430_000 },
      })
    ).toThrow("لم يعد شاغرًا");
    expect(contact.state.entities.leases).toBe(financialBefore.leases);
    expect(contact.state.entities.receivables).toBe(financialBefore.receivables);
    expect(contact.state.entities.collections).toBe(financialBefore.collections);

    const isolated = state();
    isolated.entities.leases = [];
    isolated.entities.applications = [];
    isolated.entities.properties.push(
      entity({
        id: "property-b",
        title: "عقار ب",
        propertyId: "property-b",
        portfolioId: "portfolio-b",
        meta: {
          rentalMode: "units",
          tenancyDeclaration: JSON.stringify({
            v: 1,
            status: "rented",
            startDate: "2026-10-01",
            endDate: "2026-11-01",
          }),
        },
      })
    );
    isolated.entities.units.push(
      entity({
        id: "unit-b",
        title: "وحدة ب",
        propertyId: "property-b",
        portfolioId: "portfolio-b",
        meta: { unitCode: "B-1" },
      })
    );
    isolated.settings = { ...isolated.settings, portfolioId: "portfolio-a" };
    expect(listBrokerTargets(isolated).map(target => target.id)).toEqual(
      isolated.entities.units.slice(0, 9).map(unit => unit.id)
    );
  });
});
