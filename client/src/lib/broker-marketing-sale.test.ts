import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  campaignTargetsForPreview,
  createBrokerContact,
  getBrokerCampaignBrief,
  listBrokerTargets,
  saveBrokerCampaign,
  saveBrokerCampaignBatches,
  simulateBrokerCampaignBatches,
  simulateBrokerCampaignDispatch,
} from "./broker-marketing";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "",
    status: "نشط",
    date: "2026-10-28",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function profile(
  purpose: "rent" | "sale" | "mixed",
  salePriceMinor?: number
): string {
  return JSON.stringify({
    v: 1,
    purpose,
    ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
  });
}

function unitProfile(
  purpose?: "rent" | "sale",
  salePriceMinor?: number
): string {
  return JSON.stringify({
    v: 1,
    category: "office",
    ...(purpose === undefined ? {} : { purpose }),
    ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
  });
}

function property(
  id: string,
  purpose: "rent" | "sale" | "mixed",
  rentalMode: "whole" | "units" | "legacy",
  salePriceMinor?: number
): DemoEntity {
  return row({
    id,
    propertyId: id,
    title: `عقار ${id}`,
    meta: {
      rentalMode,
      propertyNumber: `P-${id}`,
      location: "الدوحة",
      assetType: "building",
      propertyProfile: profile(purpose, salePriceMinor),
    },
  });
}

function unit(
  id: string,
  propertyId: string,
  purpose?: "rent" | "sale",
  salePriceMinor?: number,
  meta: DemoEntity["meta"] = {}
): DemoEntity {
  return row({
    id,
    propertyId,
    title: `وحدة ${id}`,
    meta: {
      unitCode: `U-${id}`,
      ...(purpose === undefined && salePriceMinor === undefined
        ? {}
        : { unitProfile: unitProfile(purpose, salePriceMinor) }),
      ...meta,
    },
  });
}

function state(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-a", title: "المحفظة أ" }),
    row({ id: "portfolio-b", portfolioId: "portfolio-b", title: "المحفظة ب" }),
  ];
  entities.properties = [
    property("rent", "rent", "units"),
    property("whole-sale", "sale", "whole", 90_000_000),
    property("split-sale", "sale", "units", 80_000_000),
    property("mixed", "mixed", "units", 70_000_000),
    property("occupied-sale", "sale", "units", 60_000_000),
    property("missing-price", "sale", "units", 50_000_000),
  ];
  entities.units = [
    unit("rent-unit", "rent", "rent"),
    row({
      id: "whole-sale-internal",
      propertyId: "whole-sale",
      title: "هدف داخلي لا يعرض",
      meta: { wholeProperty: true, unitCode: "WHOLE" },
    }),
    // The omitted unit purpose inherits the parent sale purpose.
    unit("split-sale-unit", "split-sale", undefined, 8_000_000, {
      monthlyRentMinor: 900_000,
    }),
    unit("mixed-sale-unit", "mixed", "sale", 7_000_000),
    unit("mixed-rent-unit", "mixed", "rent"),
    unit("occupied-sale-unit", "occupied-sale", undefined, 6_000_000),
    // These deliberately tempting values must never become a sale price.
    unit("no-price-sale-unit", "missing-price", "sale", undefined, {
      monthlyRentMinor: 999_999_999,
      rentMinor: 888_888_888,
    }),
  ];
  entities.units.find(item => item.id === "no-price-sale-unit")!.amountMinor =
    777_777_777;
  entities.leases = [
    row({
      id: "occupied-sale-lease",
      propertyId: "occupied-sale",
      title: "عقد نافذ للوحدة المعروضة للبيع",
      status: "نافذ",
      date: "2026-01-01",
      meta: {
        unitId: "occupied-sale-unit",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        lifecycleActivated: true,
      },
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
      scenarioDate: "2026-10-28",
    },
  };
}

function withBroker(initial: PrototypeState) {
  return createBrokerContact(initial, {
    requestId: "sale-domain-broker",
    companyName: "وسيط بيع تجريبي",
    contactName: "مسؤول البيع",
    email: "sale-broker@example.test",
  });
}

describe("broker marketing sale campaigns · domain only", () => {
  it("adds whole, inherited, mixed, and occupied sale targets only when requested without creating a fake unit or price fallback", () => {
    const initial = state();
    const defaultTargets = listBrokerTargets(initial);
    const targets = listBrokerTargets(initial, { includeSale: true });
    const saleTargets = targets.filter(target => target.purpose === "sale");
    const byId = new Map(saleTargets.map(target => [target.id, target]));

    expect(defaultTargets.every(target => target.purpose !== "sale")).toBe(true);
    expect(saleTargets.map(target => target.id)).toEqual(
      expect.arrayContaining([
        "split-sale-unit",
        "mixed-sale-unit",
        "occupied-sale-unit",
        "no-price-sale-unit",
      ])
    );
    expect(saleTargets.map(target => target.id)).not.toContain("mixed-rent-unit");
    expect(saleTargets.map(target => target.id)).not.toContain("whole-sale-internal");

    const root = saleTargets.find(target => target.propertyId === "whole-sale");
    expect(root).toMatchObject({
      purpose: "sale",
      availability: "sale",
      suggestedMonthlyRentMinor: 0,
      suggestedSalePriceMinor: 90_000_000,
      availableFrom: "",
    });
    expect(root?.id).not.toBe("whole-sale-internal");
    expect(root?.id).toMatch(/^sale-root-/);
    expect(saleTargets.filter(target => target.propertyId === "split-sale")).toEqual([
      expect.objectContaining({ id: "split-sale-unit" }),
    ]);
    expect(byId.get("split-sale-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 0,
      suggestedSalePriceMinor: 8_000_000,
    });
    expect(byId.get("occupied-sale-unit")).toMatchObject({
      availability: "sale",
      tenancyLabel: "مؤجر بعقد مسجل",
      suggestedSalePriceMinor: 6_000_000,
    });
    expect(byId.get("no-price-sale-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 0,
    });
    expect(byId.get("no-price-sale-unit")).not.toHaveProperty(
      "suggestedSalePriceMinor"
    );
  });

  it("requires an explicit sale ask, freezes a sale-only TXT-ready brief, and never mutates occupancy or financial rows", () => {
    const contact = withBroker(state());
    const financeBefore = {
      leases: contact.state.entities.leases,
      collections: contact.state.entities.collections,
      receivables: contact.state.entities.receivables,
      units: contact.state.entities.units,
    };

    expect(() =>
      saveBrokerCampaign(contact.state, {
        requestId: "sale-price-required",
        title: "فرص تأجير جاهزة للمراجعة",
        content: "معاينة محلية فقط.",
        targetIds: ["no-price-sale-unit"],
        brokerIds: [contact.result.id],
        targetRentsMinor: {},
        targetSalePricesMinor: {},
      })
    ).toThrow("سعر البيع المطلوب");

    const saved = saveBrokerCampaign(contact.state, {
      requestId: "occupied-sale-brief",
      title: "فرص تأجير جاهزة للمراجعة",
      content: "فرصة بيع محلية للمراجعة.",
      targetIds: ["occupied-sale-unit"],
      brokerIds: [contact.result.id],
      targetRentsMinor: {},
      targetSalePricesMinor: { "occupied-sale-unit": 6_500_000 },
    });
    const snapshot = campaignTargetsForPreview(saved.result);
    const brief = getBrokerCampaignBrief(saved.state, saved.result);

    expect(saved.result.title).toBe("فرص بيع جاهزة للمراجعة");
    expect(snapshot).toEqual([
      {
        targetId: "occupied-sale-unit",
        purpose: "sale",
        monthlyRentMinor: 0,
        salePriceMinor: 6_500_000,
      },
    ]);
    expect(brief.targets[0]).toMatchObject({
      purpose: "sale",
      monthlyRentMinor: 0,
      salePriceMinor: 6_500_000,
      availability: "sale",
      tenancyLabel: "مؤجر بعقد مسجل",
      availableFrom: "",
    });
    expect(brief.body).toContain("سعر البيع المطلوب");
    expect(brief.body).toContain("مؤجر بعقد مسجل");
    expect(brief.body).not.toContain("شهريًا");
    expect(brief.body).not.toContain("شاغر وفق السجل");
    expect(brief.body).not.toContain("متاح من");
    expect(brief.body).not.toContain("نهاية العقد");
    expect(saved.state.entities.leases).toBe(financeBefore.leases);
    expect(saved.state.entities.collections).toBe(financeBefore.collections);
    expect(saved.state.entities.receivables).toBe(financeBefore.receivables);
    expect(saved.state.entities.units).toBe(financeBefore.units);

    expect(() =>
      saveBrokerCampaign(saved.state, {
        requestId: "occupied-sale-brief",
        title: "فرص تأجير جاهزة للمراجعة",
        content: "فرصة بيع محلية للمراجعة.",
        targetIds: ["occupied-sale-unit"],
        brokerIds: [contact.result.id],
        targetRentsMinor: {},
        targetSalePricesMinor: { "occupied-sale-unit": 6_600_000 },
      })
    ).toThrow("بيانات مختلفة");
  });

  it("splits a mixed batch by purpose and revalidates stale purpose, scope, and broker state before local simulation", () => {
    const contact = withBroker(state());
    const saved = saveBrokerCampaignBatches(contact.state, {
      requestId: "mixed-sale-rent-batch",
      title: "فرص تأجير جاهزة للمراجعة",
      content: "موجز محلي فقط.",
      targetIds: ["rent-unit", "split-sale-unit"],
      brokerIds: [contact.result.id],
      targetRentsMinor: { "rent-unit": 450_000 },
      targetSalePricesMinor: { "split-sale-unit": 8_500_000 },
    });
    const saleCampaign = saved.result.find(
      campaign => campaign.meta.campaignPurpose === "sale"
    )!;
    const rentCampaign = saved.result.find(
      campaign => campaign.meta.campaignPurpose === "rent"
    )!;

    expect(saved.result).toHaveLength(2);
    expect(saleCampaign.title).toContain("فرص بيع جاهزة للمراجعة");
    expect(rentCampaign.title).toContain("فرص تأجير جاهزة للمراجعة");
    expect(campaignTargetsForPreview(saleCampaign)).toEqual([
      expect.objectContaining({
        targetId: "split-sale-unit",
        purpose: "sale",
        monthlyRentMinor: 0,
        salePriceMinor: 8_500_000,
      }),
    ]);
    expect(campaignTargetsForPreview(rentCampaign)).toEqual([
      expect.objectContaining({
        targetId: "rent-unit",
        purpose: "rent",
        monthlyRentMinor: 450_000,
      }),
    ]);

    const simulated = simulateBrokerCampaignBatches(saved.state, {
      requestId: "simulate-mixed-purpose-batches",
      campaignIds: saved.result.map(campaign => campaign.id),
    });
    expect(simulated.result).toHaveLength(2);
    expect(simulated.result.every(row => row.status === "simulated-not-sent")).toBe(
      true
    );

    const changedGoal: PrototypeState = {
      ...saved.state,
      entities: {
        ...saved.state.entities,
        properties: saved.state.entities.properties.map(item =>
          item.id === "split-sale"
            ? {
                ...item,
                meta: {
                  ...item.meta,
                  propertyProfile: profile("rent"),
                },
              }
            : item
        ),
      },
    };
    expect(() =>
      simulateBrokerCampaignDispatch(changedGoal, {
        requestId: "reject-changed-sale-purpose",
        campaignId: saleCampaign.id,
      })
    ).toThrow("تغيّر هدف");

    const narrowedScope: PrototypeState = {
      ...saved.state,
      settings: { ...saved.state.settings, portfolioId: "portfolio-b" },
    };
    expect(() =>
      simulateBrokerCampaignDispatch(narrowedScope, {
        requestId: "reject-sale-wrong-scope",
        campaignId: saleCampaign.id,
      })
    ).toThrow("خارج نطاق المحفظة");

    const pausedBroker: PrototypeState = {
      ...saved.state,
      entities: {
        ...saved.state.entities,
        vendors: saved.state.entities.vendors.map(item =>
          item.id === contact.result.id
            ? { ...item, meta: { ...item.meta, active: false } }
            : item
        ),
      },
    };
    expect(() =>
      simulateBrokerCampaignDispatch(pausedBroker, {
        requestId: "reject-paused-sale-broker",
        campaignId: saleCampaign.id,
      })
    ).toThrow("موقوفة");
  });

  it("keeps a historical rent-only snapshot parsable without a purpose field", () => {
    const contact = withBroker(state());
    const legacy = row({
      id: "legacy-rent-campaign",
      title: "موجز إيجار تاريخي",
      status: "معاينة غير مرسلة",
      meta: {
        recordType: "broker-campaign",
        content: "محتوى قديم",
        targetsJSON: JSON.stringify([["rent-unit", 400_000]]),
        brokerIdsChunkCount: 1,
        brokerIdsChunk0: JSON.stringify([contact.result.id]),
      },
    });
    const legacyState: PrototypeState = {
      ...contact.state,
      entities: {
        ...contact.state.entities,
        documents: [legacy],
      },
    };

    expect(campaignTargetsForPreview(legacy)).toEqual([
      { targetId: "rent-unit", monthlyRentMinor: 400_000 },
    ]);
    const brief = getBrokerCampaignBrief(legacyState, legacy);
    expect(brief.targets[0]).toMatchObject({
      targetId: "rent-unit",
      monthlyRentMinor: 400_000,
    });
    expect(brief.targets[0]?.purpose).not.toBe("sale");
    expect(brief.body).toContain("بلا لقطة موجز مجمدة");
  });
});
