import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import {
  createBrokerContact,
  getBrokerCampaignBrief,
  listBrokerTargets,
  saveBrokerCampaign,
} from "./broker-marketing";
import { money } from "@shared/prototype";

function fixture() {
  const state = createDemoState();
  state.settings.portfolioId = "all";
  state.settings.role = "operator";
  state.settings.scenarioDate = "2026-10-24";
  const broker = createBrokerContact(state, {
    requestId: "brief-broker",
    companyName: "وسيط اختبار المحتوى",
    contactName: "مسؤول اختبار",
    email: "broker@example.test",
  });
  const target = listBrokerTargets(broker.state)[0];
  if (!target) throw new Error("fixture has no vacant target");
  return { ...broker, target };
}

describe("generated broker brief content", () => {
  it("keeps incomplete property identifiers visible without inventing numbers or a unit area", () => {
    const f = fixture();
    expect(f.target.propertyNumber).toBe("غير مسجل");
    const changed = {
      ...f.state,
      entities: {
        ...f.state.entities,
        properties: f.state.entities.properties.map(p =>
          p.id === f.target.propertyId
            ? { ...p, meta: { ...p.meta, assetType: "office", area: 1800 } }
            : p
        ),
        units: f.state.entities.units.map(u => {
          if (u.id !== f.target.id) return u;
          const { area, ...meta } = u.meta;
          return { ...u, meta };
        }),
      },
    };
    const target = listBrokerTargets(changed).find(t => t.id === f.target.id)!;
    expect(target.propertyType).toBe("مكتب");
    expect(target.area).toBeUndefined();
  });

  it("generates a property summary even when the optional introduction is empty", () => {
    const f = fixture();
    const saved = saveBrokerCampaign(f.state, {
      requestId: "brief-empty-intro",
      title: "موجز اختبار",
      content: "",
      targetIds: [f.target.id],
      brokerIds: [f.result.id],
      targetRentsMinor: { [f.target.id]: 120_000 },
    });
    const brief = getBrokerCampaignBrief(saved.state, saved.result);
    expect(brief.body).toContain(f.target.propertyTitle);
    expect(brief.body).toContain(f.target.propertyNumber);
    expect(brief.body).toContain(f.target.unitCode);
    expect(brief.body).toContain(money(120_000));
    expect(brief.body).toContain("شاغر وفق السجل");
    const changed = {
      ...saved.state,
      entities: {
        ...saved.state.entities,
        properties: saved.state.entities.properties.map(p =>
          p.id === f.target.propertyId
            ? { ...p, title: "عنوان جديد لا يدخل اللقطة" }
            : p
        ),
      },
    };
    expect(getBrokerCampaignBrief(changed, saved.result).body).toBe(brief.body);
    expect(getBrokerCampaignBrief(changed, saved.result).body).not.toContain(
      "عنوان جديد"
    );
  });
});
