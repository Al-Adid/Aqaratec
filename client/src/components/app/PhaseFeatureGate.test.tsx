// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { PhaseFeatureGate } from "./PhaseFeatureGate";
import {
  PHASE_FEATURES,
  phaseFeature,
  phaseFeatureCounts,
} from "@shared/phase1-features";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe("P01 centralized stage gate", () => {
  it("never mounts any deferred functional subtree or effects on direct route", async () => {
    let writes = 0;
    function Dangerous() {
      useEffect(() => {
        writes++;
      }, []);
      return <button>إجراء مؤجل</button>;
    }
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    for (const feature of PHASE_FEATURES.filter(
      f => f.state === "coming-soon"
    )) {
      await act(async () =>
        root.render(
          <PhaseFeatureGate path={feature.path}>
            <Dangerous />
          </PhaseFeatureGate>
        )
      );
      expect(node.textContent).toContain("قريبًا");
      expect(node.textContent).not.toContain("إجراء مؤجل");
    }
    expect(writes).toBe(0);
    await act(async () => root.unmount());
    node.remove();
  });
  it("keeps active property detail and derives counts without fixed34", () => {
    expect(phaseFeature("/properties/test-fixture")?.state).toBe("active");
    const counts = phaseFeatureCounts();
    expect(counts.total).toBe(PHASE_FEATURES.length);
    expect(counts.active + counts.deferred).toBe(counts.total);
    expect(new Set(PHASE_FEATURES.map(f => f.path)).size).toBe(counts.total);
  });
});
