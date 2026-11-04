import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import { normalizePrototype } from "./prototype-normalize";
import {
  addContentPreset,
  MAX_CONTENT_PRESET_LENGTH,
  MAX_CONTENT_PRESETS,
} from "./content-presets";
import { validatePrototypeState } from "@shared/prototype-validation";

function demoState() {
  return normalizePrototype(createDemoState());
}

describe("content presets", () => {
  it("normalizes valid JSON labels while accepting snapshots created before the optional setting", () => {
    const legacy = demoState();
    delete legacy.settings.contentPresets;
    expect(validatePrototypeState(legacy).success).toBe(true);

    const withWhitespace = JSON.parse(JSON.stringify(demoState())) as typeof legacy;
    withWhitespace.settings.contentPresets = ["  غرفة غسيل خاصة  "];
    const parsed = validatePrototypeState(withWhitespace);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.message);
    expect(parsed.data.settings.contentPresets).toEqual(["غرفة غسيل خاصة"]);

    const duplicateAfterTrim = JSON.parse(JSON.stringify(demoState())) as typeof legacy;
    duplicateAfterTrim.settings.contentPresets = ["خيار", " خيار "];
    expect(validatePrototypeState(duplicateAfterTrim).success).toBe(false);
  });

  it("adds an operator choice without changing financial or other entity records, and is idempotent", () => {
    const initial = demoState();
    const financialRecords = JSON.stringify({
      receivables: initial.entities.receivables,
      collections: initial.entities.collections,
      expenses: initial.entities.expenses,
      journal: initial.entities.journal,
    });
    const added = addContentPreset(initial, "  غرفة خادمة  ");

    expect(added.result).toMatchObject({ kind: "added", value: "غرفة خادمة" });
    expect(added.state.settings.contentPresets).toEqual(["غرفة خادمة"]);
    expect(added.state.settings.role).toBe(initial.settings.role);
    expect(added.state.settings.portfolioId).toBe(initial.settings.portfolioId);
    expect(added.state.entities).toBe(initial.entities);
    expect(added.state.audit).toBe(initial.audit);
    expect(
      JSON.stringify({
        receivables: added.state.entities.receivables,
        collections: added.state.entities.collections,
        expenses: added.state.entities.expenses,
        journal: added.state.entities.journal,
      })
    ).toBe(financialRecords);

    const duplicate = addContentPreset(added.state, "غرفة خادمة");
    expect(duplicate.result.kind).toBe("existing");
    expect(duplicate.state).toBe(added.state);
    expect(duplicate.state.settings.contentPresets).toEqual(["غرفة خادمة"]);
  });

  it("rejects empty, overlong, read-only, and over-capacity additions", () => {
    const initial = demoState();
    expect(() => addContentPreset(initial, "   ")).toThrow("غير فارغ");
    expect(() =>
      addContentPreset(initial, "م".repeat(MAX_CONTENT_PRESET_LENGTH + 1))
    ).toThrow(String(MAX_CONTENT_PRESET_LENGTH));
    expect(() =>
      addContentPreset(
        { ...initial, settings: { ...initial.settings, role: "owner" } },
        "خيار قراءة"
      )
    ).toThrow("القراءة");

    let full = initial;
    for (let index = 0; index < MAX_CONTENT_PRESETS; index += 1) {
      full = addContentPreset(full, `خيار مخصص ${index + 1}`).state;
    }
    expect(full.settings.contentPresets).toHaveLength(MAX_CONTENT_PRESETS);
    expect(() => addContentPreset(full, "خيار زائد")).toThrow(
      String(MAX_CONTENT_PRESETS)
    );
    expect(validatePrototypeState(full).success).toBe(true);
  });
});
