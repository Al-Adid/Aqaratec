import { describe, expect, it } from "vitest";
import { createDemoState } from "../client/src/lib/demo-data";
import { normalizePrototype } from "../client/src/lib/prototype-normalize";
import {
  MAX_META_ENTRIES,
  MAX_META_NUMBER,
  MAX_SNAPSHOT_BYTES,
  serializedPrototypeBytes,
  validatePrototypeState,
} from "./prototype-validation";

describe("shared prototype snapshot validation", () => {
  it("applies the 32-key, 1024-char, and 1e12 metadata bounds", () => {
    const state = normalizePrototype(createDemoState());
    const row = state.entities.portfolios[0];
    row.meta = Object.fromEntries(
      Array.from({ length: MAX_META_ENTRIES + 1 }, (_, index) => [`k${index}`, index])
    );
    expect(validatePrototypeState(state).success).toBe(false);

    row.meta = { note: "x".repeat(1_025) };
    expect(validatePrototypeState(state).success).toBe(false);
    row.meta = { amount: MAX_META_NUMBER + 1 };
    expect(validatePrototypeState(state).success).toBe(false);
  });

  it("measures the JSON body with TextEncoder-compatible UTF-8 bytes", () => {
    const state = normalizePrototype(createDemoState());
    state.entities.portfolios[0].subtitle = "ع".repeat(MAX_SNAPSHOT_BYTES);
    expect(serializedPrototypeBytes(state)).toBeGreaterThan(MAX_SNAPSHOT_BYTES);
    expect(validatePrototypeState(state).success).toBe(false);
  });
});
