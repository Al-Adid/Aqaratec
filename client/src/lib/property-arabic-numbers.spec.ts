import { describe, it, expect } from "vitest";
import {
  makePropertyDraft,
  parseUnitCount,
  normalizePropertyNumericInput,
} from "./property-fields";
import { createDemoState } from "./demo-data";
import { importRentalProperties } from "./prototype-rental";
const input = {
  title: "عقار صوري بالأرقام العربية",
  portfolioId: "family",
  assetType: "building",
  unitCount: "٢",
  rentalMode: "units",
  propertyNumber: "٠٠١٢",
  electricityNumber: "000004",
  buildingYear: "٢٠١٢",
  landArea: "١٬٢٥٠٫٥",
  inputMethod: "Excel",
};
describe("R13Arabic numerals and atomic validation", () => {
  it("accepts Arabicnumericfields butdoesnotnormalize identifierleadingzeros", () => {
    const draft = makePropertyDraft(input);
    expect(draft.unitCount).toBe(2);
    expect(draft.meta.buildingYear).toBe(2012);
    expect(draft.meta.landArea).toBe(1250.5);
    expect(draft.propertyNumber).toBe("٠٠١٢");
    expect(draft.electricityNumber).toBe("000004");
    expect(normalizePropertyNumericInput("1,250.50")).toBe("1250.50");
    expect(() => parseUnitCount("٢٫٥")).toThrow("عددًا صحيحًا");
  });
  it("rejects entire batch beforecommit andretainsstate onrepeatofbadbatch", () => {
    const state = createDemoState();
    state.settings.role = "operator";
    state.settings.portfolioId = "all";
    const original = JSON.stringify(state);
    for (let n = 0; n < 2; n++)
      expect(() =>
        importRentalProperties(
          state,
          [
            input,
            { ...input, title: "صف نوعه غير مدعوم", assetType: "unsupported" },
          ],
          "arabic-retry"
        )
      ).toThrow("2");
    expect(JSON.stringify(state)).toBe(original);
  });
});
