import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { validatePrototypeState } from "@shared/prototype-validation";
import { createRentalProperty, updateRentalProperty } from "./prototype-rental";
import {
  createBrokerContact,
  getBrokerCampaignBrief,
  listBrokerTargets,
  saveBrokerCampaignBatches,
  simulateBrokerCampaignBatches,
} from "./broker-marketing";

function row(id: string, title: string): DemoEntity {
  return {
    id,
    title,
    subtitle: "",
    portfolioId: "",
    propertyId: "",
    status: "نشط",
    date: "2026-10-26",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
  };
}
function empty(): PrototypeState {
  const entities = {} as EntityMap;
  for (const kind of ENTITY_KINDS) entities[kind] = [];
  entities.portfolios = [row("bulk-family", "محفظة اختبار مستقلة")];
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "bulk-family",
      period: "all",
      language: "ar",
      scenarioDate: "2026-10-26",
    },
  };
}
function fixture(properties = 12, brokers = 21) {
  let state = empty();
  for (let i = 0; i < properties; i++) {
    state = createRentalProperty(state, {
      requestId: `rent-bulk-property-${i}`,
      title: `فيلا اختبار ${i + 1}`,
      portfolioId: "bulk-family",
      assetType: "villa",
      usageType: "residential",
      rentalMode: "whole",
      propertyNumber: `B-${i + 1}`,
      unitCount: "1",
      inputMethod: "يدوي",
      monthlyRent: "١٬٢٥٠٫٥٠",
    }).state;
  }
  for (let i = 0; i < brokers; i++) {
    state = createBrokerContact(state, {
      requestId: `rent-bulk-broker-${i}`,
      companyName: `شركة اختبار ${i + 1}`,
      email: `broker-${i + 1}@example.test`,
      contactName: "مسؤول اختبار",
    }).state;
  }
  return state;
}

describe("property rent to bulk marketing integration", () => {
  it("keeps every selected property × broker pair, frozen prices, one simulation per part, and no cash effects", () => {
    const state = fixture();
    const targets = listBrokerTargets(state);
    expect(targets).toHaveLength(12);
    expect(
      targets.every(target => target.suggestedMonthlyRentMinor === 125050)
    ).toBe(true);
    const input = {
      requestId: "whole-bulk-integration",
      title: "موجز كل العقارات المختارة",
      content: "",
      targetIds: targets.map(t => t.id),
      brokerIds: state.entities.vendors.map(b => b.id),
      targetRentsMinor: Object.fromEntries(
        targets.map(t => [t.id, t.suggestedMonthlyRentMinor])
      ),
    };
    const saved = saveBrokerCampaignBatches(state, input);
    expect(saved.result.length).toBeGreaterThanOrEqual(4);
    const pairs = new Set<string>();
    for (const campaign of saved.result) {
      const brief = getBrokerCampaignBrief(saved.state, campaign);
      for (const target of brief.targets) {
        expect(target.monthlyRentMinor).toBe(125050);
        for (const recipient of brief.recipients)
          pairs.add(`${target.targetId}|${recipient.brokerId}`);
      }
    }
    expect(pairs.size).toBe(12 * 21);
    expect(validatePrototypeState(saved.state).success).toBe(true);
    expect(saved.state.entities.leases).toEqual(state.entities.leases);
    expect(saved.state.entities.receivables).toEqual(
      state.entities.receivables
    );
    expect(saved.state.entities.collections).toEqual(
      state.entities.collections
    );
    expect(saved.state.entities.units).toEqual(state.entities.units);
    const retried = saveBrokerCampaignBatches(saved.state, input);
    expect(retried.result.map(c => c.id)).toEqual(saved.result.map(c => c.id));
    expect(retried.state.entities.documents).toHaveLength(
      saved.state.entities.documents.length
    );
    const simulated = simulateBrokerCampaignBatches(saved.state, {
      campaignIds: saved.result.map(c => c.id),
      requestId: "bulk-simulate-1",
    });
    const repeat = simulateBrokerCampaignBatches(simulated.state, {
      campaignIds: saved.result.map(c => c.id),
      requestId: "bulk-simulate-1",
    });
    expect(repeat.state.entities.documents).toHaveLength(
      simulated.state.entities.documents.length
    );
    expect(simulated.result.every(d => d.status === "simulated-not-sent")).toBe(
      true
    );
    expect(simulated.state.entities.receivables).toEqual(
      state.entities.receivables
    );
    expect(simulated.state.entities.collections).toEqual(
      state.entities.collections
    );
    expect(simulated.state.entities.units).toEqual(state.entities.units);
  });

  it("reflects an intentionally edited property rent in new target views without changing an old brief or tenant debt", () => {
    const state = fixture(1, 1);
    const target = listBrokerTargets(state)[0];
    const saved = saveBrokerCampaignBatches(state, {
      requestId: "rent-edit-old-brief",
      title: "السعر المحفوظ",
      content: "",
      targetIds: [target.id],
      brokerIds: [state.entities.vendors[0].id],
      targetRentsMinor: { [target.id]: target.suggestedMonthlyRentMinor },
    });
    const property = saved.state.entities.properties[0];
    const next = updateRentalProperty(saved.state, property.id, {
      title: property.title,
      portfolioId: property.portfolioId,
      assetType: "villa",
      usageType: "residential",
      rentalMode: "whole",
      monthlyRent: "٢٬٣٠٠",
      unitCount: "1",
    }).state;
    expect(listBrokerTargets(next)[0].suggestedMonthlyRentMinor).toBe(230000);
    expect(
      getBrokerCampaignBrief(next, saved.result[0]).targets[0].monthlyRentMinor
    ).toBe(125050);
    expect(next.entities.receivables).toEqual(state.entities.receivables);
    expect(next.entities.collections).toEqual(state.entities.collections);
  });
});
