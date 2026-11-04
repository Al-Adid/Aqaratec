import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { listBrokerTargets } from "./broker-marketing";

function entity(id: string, meta: DemoEntity["meta"] = {}): DemoEntity {
  return {
    id,
    title: id,
    subtitle: "",
    portfolioId: "legacy-portfolio",
    propertyId: "legacy-property",
    date: "2026-01-01",
    status: "متاحة",
    currency: "QAR",
    amountMinor: 0,
    meta,
  };
}
function fixture(): PrototypeState {
  const entities = {} as EntityMap;
  for (const kind of ENTITY_KINDS) entities[kind] = [];
  entities.portfolios = [entity("legacy-portfolio")];
  entities.properties = [
    entity("legacy-property", { rentalMode: "units", propertyNumber: "P-1" }),
  ];
  entities.units = [entity("legacy-unit", { unitCode: "U-1" })];
  entities.leases = [
    {
      ...entity("legacy-lease", {
        unitId: "legacy-unit",
        start: "2026-01-01",
        end: "2026-09-30",
        method: "شهري",
        lifecycleActivated: true,
      }),
      status: "منتهي",
      amountMinor: 450_000,
    },
  ];
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "legacy-portfolio",
      period: "all",
      language: "ar",
      scenarioDate: "2026-10-26",
    },
  };
}

describe("monthly rental amount of a historical lease", () => {
  it("reads the explicitly monthly lease amount without reading the asset acquisition values", () => {
    const state = fixture();
    state.entities.properties[0].amountMinor = 100_000_000;
    state.entities.units[0].amountMinor = 50_000_000;
    const target = listBrokerTargets(state)[0];
    expect(target.suggestedMonthlyRentMinor).toBe(450_000);
    expect(target.rentSourceLabel).toContain("إيجار العقد السابق");
    expect(target.rentSourceLabel).toContain("مبلغ شهري محفوظ");
    expect(target.rentSourceDate).toBe("2026-09-30");
  });
  it("does not guess an unmarked lease period or replace an invalid named rent", () => {
    const state = fixture();
    delete state.entities.leases[0].meta.method;
    expect(listBrokerTargets(state)[0].suggestedMonthlyRentMinor).toBe(0);
    state.entities.leases[0].meta.method = "شهري";
    state.entities.leases[0].meta.rentMinor = 0;
    expect(listBrokerTargets(state)[0].suggestedMonthlyRentMinor).toBe(0);
  });
});
