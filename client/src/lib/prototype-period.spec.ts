import { describe, expect, it } from "vitest";
import type { DemoEntity } from "@shared/prototype";
import { currentPeriodRows } from "@/pages/operating/operatingUtils";
import { createDemoState } from "./demo-data";
import { financialSummary, isOccupiedUnit } from "./prototype-finance";
import { inPrototypePeriod } from "./prototype-period";

function row(id: string, date: string, status = "نشط"): DemoEntity {
  return {
    id,
    title: id,
    subtitle: "",
    portfolioId: "family",
    propertyId: "",
    status,
    date,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
  };
}

describe("prototype period filtering", () => {
  it("keeps all rows for all and an empty period", () => {
    expect(inPrototypePeriod("2026-02-30", "all")).toBe(true);
    expect(inPrototypePeriod("2026-02-30", "")).toBe(true);
  });

  it("matches an explicit month only for valid dates within its bounds", () => {
    expect(inPrototypePeriod("2026-10-01", "2026-10")).toBe(true);
    expect(inPrototypePeriod("2026-09-30", "2026-10")).toBe(false);
    expect(inPrototypePeriod("2026-10-32", "2026-10")).toBe(false);
    expect(inPrototypePeriod("2026-10-01-note", "2026-10")).toBe(false);
  });

  it("uses the scenario date for relative month and quarter boundaries", () => {
    expect(inPrototypePeriod("2026-10-01", "month")).toBe(true);
    expect(inPrototypePeriod("2026-09-30", "month")).toBe(false);
    expect(inPrototypePeriod("2026-10-01", "quarter")).toBe(true);
    expect(inPrototypePeriod("2026-12-31", "quarter")).toBe(true);
    expect(inPrototypePeriod("2026-09-30", "quarter")).toBe(false);
  });

  it("matches relative and explicit years without leaking into adjacent years", () => {
    expect(inPrototypePeriod("2026-01-01", "year")).toBe(true);
    expect(inPrototypePeriod("2027-01-01", "year")).toBe(false);
    expect(inPrototypePeriod("2026-12-31", "2026")).toBe(true);
    expect(inPrototypePeriod("2025-12-31", "2026")).toBe(false);
  });

  it("keeps assets regardless of creation date and filters movements with the helper", () => {
    const oldAsset = row("asset", "2026-01-01");
    const movements = [oldAsset, row("current", "2026-10-24")];

    for (const kind of [
      "portfolios",
      "properties",
      "units",
      "tenants",
    ] as const) {
      expect(currentPeriodRows([oldAsset], "2026-10", kind)).toEqual([
        oldAsset,
      ]);
    }
    expect(
      currentPeriodRows(movements, "2026-10", "receivables").map(
        item => item.id
      )
    ).toEqual(["current"]);
  });

  it("recognizes legacy labels but does not count manual occupancy without an effective lease or documented opening", () => {
    const state = createDemoState();
    state.entities.units = [
      row("occupied", "2026-10-01", "مشغولة"),
      row("rented", "2026-10-01", "مؤجرة"),
      row("vacant", "2026-10-01", "شاغرة"),
    ];

    expect(isOccupiedUnit(state.entities.units[0])).toBe(true);
    expect(isOccupiedUnit(state.entities.units[1])).toBe(true);
    expect(isOccupiedUnit(state.entities.units[2])).toBe(false);
    // P05: these IDs have no effective lease; labels alone cannot establish occupancy.
    expect(
      financialSummary(state.entities, "family", "2026-10").occupancy
    ).toBe(0);
  });
});
