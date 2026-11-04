import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  brokerIdsForCampaign,
  campaignTargetsForPreview,
  listBrokerTargets,
  saveBrokerCampaignBatches,
  simulateBrokerCampaignBatches,
} from "./broker-marketing";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "property-a",
    status: "شاغرة",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function blankState(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    entity({ id: "portfolio-a", title: "محفظة الاختبار", propertyId: "" }),
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

const long = (prefix: string, length: number) =>
  `${prefix}-${"س".repeat(Math.max(0, length - prefix.length - 1))}`;

/** Eleven separate properties and twenty-one eligible brokers. */
function largeSelectionState(): PrototypeState {
  const state = blankState();
  state.entities.properties = Array.from({ length: 11 }, (_, index) => {
    const n = index + 1;
    return entity({
      id: `property-${n}`,
      propertyId: `property-${n}`,
      title: long(`عقار-${n}`, 250),
      amountMinor: 99_999_999,
      meta: {
        rentalMode: "units",
        propertyNumber: long(`P-${n}`, 60),
        location: long("الدوحة", 180),
        propertyType: "شقة",
      },
    });
  });
  state.entities.units = Array.from({ length: 11 }, (_, index) => {
    const n = index + 1;
    return entity({
      id: `unit-${n}`,
      propertyId: `property-${n}`,
      title: long(`وحدة-${n}`, 250),
      amountMinor: 88_888_888,
      meta: { unitCode: long(`U-${n}`, 60) },
    });
  });
  state.entities.vendors = Array.from({ length: 21 }, (_, index) => {
    const n = index + 1;
    return entity({
      id: `broker-${n}`,
      title: long(`شركة-${n}`, 80),
      propertyId: "",
      portfolioId: "",
      status: "جهة اتصال تجريبية",
      meta: {
        recordType: "broker-contact",
        active: true,
        contactName: long(`مسؤول-${n}`, 80),
        email: `broker-${n}-${"x".repeat(190)}@example.test`,
      },
    });
  });
  return state;
}

function batchInput(state: PrototypeState, requestId = "large-batch-request") {
  const targets = listBrokerTargets(state);
  return {
    requestId,
    title: "فرص نوفمبر للوحدات المتاحة",
    content: "معاينة محلية فقط، ولا توجد أي رسالة أو قناة إرسال خارجية.",
    targetIds: targets.map(target => target.id),
    brokerIds: state.entities.vendors.map(row => row.id),
    targetRentsMinor: Object.fromEntries(
      targets.map((target, index) => [target.id, 300_000 + index * 1_000])
    ),
  };
}

describe("broker marketing batches, complete, bounded, and atomic", () => {
  it("covers all 11 properties × 21 brokers with adaptive metadata splitting and stable retries", () => {
    const initial = largeSelectionState();
    const input = batchInput(initial);
    const saved = saveBrokerCampaignBatches(initial, input);

    expect(saved.result.length).toBeGreaterThan(4);
    expect(saved.state.entities.documents).toHaveLength(saved.result.length);
    expect(saved.result.every(row => row.title.includes("الدفعة"))).toBe(true);
    expect(
      saved.result.every(row => Object.keys(row.meta).length <= 32)
    ).toBe(true);
    expect(
      saved.result.every(row => Number(row.meta.targetCount) <= 10)
    ).toBe(true);
    expect(
      saved.result.every(row => Number(row.meta.brokerCount) <= 20)
    ).toBe(true);

    const actualPairs = new Set<string>();
    for (const campaign of saved.result) {
      for (const target of campaignTargetsForPreview(campaign)) {
        for (const brokerId of brokerIdsForCampaign(campaign))
          actualPairs.add(`${target.targetId}|${brokerId}`);
      }
    }
    expect(actualPairs).toHaveLength(11 * 21);
    expect(actualPairs).toEqual(
      new Set(
        input.targetIds.flatMap(targetId =>
          input.brokerIds.map(brokerId => `${targetId}|${brokerId}`)
        )
      )
    );

    const retry = saveBrokerCampaignBatches(saved.state, input);
    expect(retry.state).toBe(saved.state);
    expect(retry.result.map(row => row.id)).toEqual(
      saved.result.map(row => row.id)
    );
    expect(() =>
      saveBrokerCampaignBatches(saved.state, {
        ...input,
        title: "بيانات مختلفة تحت نفس معرف المحاولة",
      })
    ).toThrow("بيانات مختلفة");
  });

  it("rejects a state-capacity failure completely rather than saving a prefix of batches", () => {
    const initial = largeSelectionState();
    const filler = Array.from({ length: 498 }, (_, index) =>
      entity({
        id: `existing-document-${index}`,
        title: "وثيقة قائمة",
        propertyId: "",
        portfolioId: "",
        meta: { recordType: "unrelated-document" },
      })
    );
    const constrained: PrototypeState = {
      ...initial,
      entities: { ...initial.entities, documents: filler },
    };
    const beforeDocuments = constrained.entities.documents;

    expect(() => saveBrokerCampaignBatches(constrained, batchInput(constrained))).toThrow(
      "سعة الحالة"
    );
    expect(constrained.entities.documents).toBe(beforeDocuments);
    expect(constrained.entities.documents).toHaveLength(498);
  });

  it("simulates all saved batches atomically and is stable on repeated click", () => {
    const saved = saveBrokerCampaignBatches(
      largeSelectionState(),
      batchInput(largeSelectionState(), "simulation-source")
    );
    const simulationInput = {
      requestId: "simulate-all-large-batches",
      campaignIds: saved.result.map(row => row.id),
    };
    const simulated = simulateBrokerCampaignBatches(saved.state, simulationInput);
    expect(simulated.result).toHaveLength(saved.result.length);
    expect(
      simulated.result.every(row => row.status === "simulated-not-sent")
    ).toBe(true);
    const retry = simulateBrokerCampaignBatches(simulated.state, simulationInput);
    expect(retry.state).toBe(simulated.state);
    expect(retry.result.map(row => row.id)).toEqual(
      simulated.result.map(row => row.id)
    );

    const paused: PrototypeState = {
      ...saved.state,
      entities: {
        ...saved.state.entities,
        vendors: saved.state.entities.vendors.map((row, index) =>
          index === 0 ? { ...row, meta: { ...row.meta, active: false } } : row
        ),
      },
    };
    const beforeDocuments = paused.entities.documents;
    expect(() => simulateBrokerCampaignBatches(paused, simulationInput)).toThrow(
      "موقوفة"
    );
    expect(paused.entities.documents).toBe(beforeDocuments);
  });
});

describe("broker marketing prices · explicit rent metadata only", () => {
  it("prioritizes named rents, confirms contract sources, and never mistakes asset amounts for rent", () => {
    const state = blankState();
    state.entities.properties = [
      entity({
        id: "direct-property",
        propertyId: "direct-property",
        title: "عقار إيجار الوحدة",
        amountMinor: 9_000_000,
        meta: { rentalMode: "units" },
      }),
      entity({
        id: "prior-property",
        propertyId: "prior-property",
        title: "عقار العقد السابق",
        amountMinor: 8_000_000,
        meta: { rentalMode: "units" },
      }),
      entity({
        id: "expiring-property",
        propertyId: "expiring-property",
        title: "عقار العقد النافذ",
        meta: { rentalMode: "units" },
      }),
      entity({
        id: "whole-property",
        propertyId: "whole-property",
        title: "فيلا كاملة",
        amountMinor: 7_000_000,
        meta: { rentalMode: "whole", monthlyRentMinor: 900_000 },
      }),
      entity({
        id: "default-property",
        propertyId: "default-property",
        title: "مبنى مقسم",
        meta: { rentalMode: "units", unitMonthlyRentMinor: 800_000 },
      }),
      entity({
        id: "ambiguous-property",
        propertyId: "ambiguous-property",
        title: "عقار قيمة أصل فقط",
        amountMinor: 6_000_000,
        meta: { rentalMode: "units", monthlyRentMinor: 1_500_000 },
      }),
    ];
    state.entities.units = [
      entity({
        id: "direct-unit",
        propertyId: "direct-property",
        amountMinor: 5_000_000,
        meta: { monthlyRentMinor: 700_000 },
      }),
      entity({ id: "prior-unit", propertyId: "prior-property" }),
      entity({ id: "expiring-unit", propertyId: "expiring-property" }),
      entity({
        id: "whole-unit",
        propertyId: "whole-property",
        amountMinor: 4_000_000,
        meta: { wholeProperty: true },
      }),
      entity({ id: "default-unit", propertyId: "default-property" }),
      entity({
        id: "ambiguous-unit",
        propertyId: "ambiguous-property",
        amountMinor: 3_000_000,
      }),
    ];
    state.entities.leases = [
      entity({
        id: "prior-lease",
        propertyId: "prior-property",
        status: "منتهٍ",
        date: "2026-01-01",
        meta: {
          unitId: "prior-unit",
          startDate: "2026-01-01",
          endDate: "2026-10-20",
          lifecycleActivated: true,
          rentMinor: 600_000,
        },
      }),
      entity({
        id: "expiring-lease",
        propertyId: "expiring-property",
        status: "نافذ",
        date: "2026-01-01",
        meta: {
          unitId: "expiring-unit",
          startDate: "2026-01-01",
          endDate: "2026-11-10",
          lifecycleActivated: true,
          rentMinor: 500_000,
        },
      }),
      entity({
        id: "draft-not-source",
        propertyId: "ambiguous-property",
        status: "مسودة",
        date: "2026-01-01",
        meta: {
          unitId: "ambiguous-unit",
          startDate: "2026-01-01",
          endDate: "2026-10-20",
          lifecycleActivated: true,
          rentMinor: 2_000_000,
        },
      }),
    ];

    const targets = new Map(
      listBrokerTargets(state, {
        includeExpiring: true,
        expiringWithinDays: 30,
      }).map(target => [target.id, target])
    );
    expect(targets.get("direct-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 700_000,
      rentSource: "unit-monthly-rent",
    });
    expect(targets.get("prior-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 600_000,
      rentSource: "prior-contract-rent",
      rentSourceLabel: "إيجار العقد السابق",
      rentSourceDate: "2026-10-20",
    });
    expect(targets.get("expiring-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 500_000,
      rentSource: "active-contract-rent",
      rentSourceLabel: "إيجار العقد النافذ",
      rentSourceDate: "2026-11-10",
    });
    expect(targets.get("whole-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 900_000,
      rentSource: "whole-property-monthly-rent",
    });
    expect(targets.get("default-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 800_000,
      rentSource: "property-unit-default-monthly-rent",
    });
    expect(targets.get("ambiguous-unit")).toMatchObject({
      suggestedMonthlyRentMinor: 0,
    });
    expect(targets.get("ambiguous-unit")).not.toHaveProperty("rentSource");
  });
});
