import { describe, it, expect } from "vitest";
import { scenarioDate, validScenarioDate } from "./prototype-clock";
import { createDemoState } from "../client/src/lib/demo-data";
import { prototypeStateSchema } from "./prototype-validation";
describe("P05 declared scenario clock", () => {
  it("preserves old snapshots and injects a date independent of the actual wallclock", () => {
    const s = createDemoState();
    expect(scenarioDate(s)).toBe("2026-10-24");
    s.settings.scenarioDate = "2027-01-01";
    expect(scenarioDate(s)).toBe("2027-01-01");
    expect(prototypeStateSchema.safeParse(s).success).toBe(true);
    s.settings.scenarioDate = "2027-02-30";
    expect(prototypeStateSchema.safeParse(s).success).toBe(false);
    expect(() => scenarioDate(s)).toThrow();
  });
  it("validates calendar dates not only the ISO pattern", () => {
    expect(validScenarioDate("2028-02-29")).toBe(true);
    expect(validScenarioDate("2027-02-29")).toBe(false);
  });
});
