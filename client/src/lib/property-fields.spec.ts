import { describe, expect, it } from "vitest";
import {
  derivePropertyAge,
  makePropertyDraft,
  parseMonthlyRentMinor,
  parseBuildingYear,
  parseUnitCount,
} from "./property-fields";

describe("property field validation", () => {
  it("derives age only from a valid building year, never from record insertion", () => {
    expect(derivePropertyAge({ buildingYear: 2018 }, "villa")).toMatchObject({
      kind: "buildingYear",
      years: 8,
    });
    expect(derivePropertyAge({}, "villa")).toEqual({ kind: "unknown" });
    expect(derivePropertyAge({ age: 12 }, "villa")).toMatchObject({
      kind: "stated",
      years: 12,
    });
  });

  it("keeps land out of building-age calculations", () => {
    expect(derivePropertyAge({ buildingYear: 2018 }, "land")).toEqual({
      kind: "notApplicable",
    });
    expect(() => parseBuildingYear("2018", "land")).toThrow(
      "الأرض لا تسجل سنة بناء"
    );
  });

  it("accepts an unknown blank building year but rejects invalid years", () => {
    expect(parseBuildingYear("", "building")).toBeUndefined();
    expect(() => parseBuildingYear("1799", "building")).toThrow();
    expect(() => parseBuildingYear("2027", "building")).toThrow();
  });

  it("rejects a negative or non-integer unit count before creating rows", () => {
    expect(() => parseUnitCount("-1")).toThrow("عدد الوحدات");
    expect(() => parseUnitCount("1.5")).toThrow("عدد الوحدات");
    expect(() =>
      makePropertyDraft({
        title: "عقار اختبار",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        unitCount: "-3",
      })
    ).toThrow("عدد الوحدات");
  });

  it("normalizes the Arabic Excel template type and preserves compatible legacy keys", () => {
    const draft = makePropertyDraft(
      {
        title: "فيلا مستوردة",
        portfolioId: "family",
        assetType: "فيلا",
        buildingYear: "2020",
        unitCount: "2",
        collectionAccount: "حساب إيجار تجريبي",
        inputMethod: "Excel",
      },
      { requireInputMethod: true }
    );

    expect(draft).toMatchObject({
      assetType: "villa",
      usageType: "residential",
      unitCount: 2,
    });
    expect(draft.meta).toMatchObject({
      buildingYear: 2020,
      year: 2020,
      collectionAccount: "حساب إيجار تجريبي",
      account: "حساب إيجار تجريبي",
      source: "Excel",
    });
  });

  it("uses one lease target for whole-property leasing and preserves text identifiers", () => {
    const draft = makePropertyDraft({
      title: "فيلا كاملة",
      portfolioId: "family",
      assetType: "villa",
      usageType: "residential",
      inputMethod: "يدوي",
      rentalMode: "whole",
      unitCount: "50",
      propertyNumber: "0007",
      electricityNumber: "00129",
    });

    expect(draft.unitCount).toBe(1);
    expect(draft).toMatchObject({
      rentalMode: "whole",
      propertyNumber: "0007",
      electricityNumber: "00129",
    });
    expect(draft.meta).toMatchObject({
      rentalMode: "whole",
      propertyNumber: "0007",
      electricityNumber: "00129",
    });
  });

  it("requires two through fifty targets only for an explicit split mode", () => {
    const base = {
      title: "عمارة اختبار",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      inputMethod: "Excel",
    };
    expect(() =>
      makePropertyDraft({ ...base, rentalMode: "units", unitCount: "1" })
    ).toThrow("التقسيم إلى وحدات");
    expect(
      makePropertyDraft({ ...base, rentalMode: "units", unitCount: "2" })
        .unitCount
    ).toBe(2);
    const historical = makePropertyDraft({ ...base, unitCount: "0" });
    expect(historical.rentalMode).toBeUndefined();
    expect(historical.unitCount).toBe(0);
  });

  it("limits optional property and electricity identifiers to 80 characters", () => {
    expect(() =>
      makePropertyDraft({
        title: "عقار اختبار",
        portfolioId: "family",
        assetType: "villa",
        usageType: "residential",
        propertyNumber: "0".repeat(81),
      })
    ).toThrow("رقم العقار");
  });

  it("stores Arabic QAR monthly rent under the explicitly selected rental mode", () => {
    const whole = makePropertyDraft({
      title: "فيلا بإيجار",
      portfolioId: "family",
      assetType: "villa",
      usageType: "residential",
      rentalMode: "whole",
      unitCount: "1",
      monthlyRent: "١٬٢٣٤٫٥٠",
    });
    const split = makePropertyDraft({
      title: "عمارة بإيجار افتراضي",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      rentalMode: "units",
      unitCount: "2",
      monthlyRent: "2,000.25",
    });

    expect(whole.meta.monthlyRentMinor).toBe(123_450);
    expect(whole.meta.unitMonthlyRentMinor).toBeUndefined();
    expect(split.meta.unitMonthlyRentMinor).toBe(200_025);
    expect(split.meta.monthlyRentMinor).toBeUndefined();
  });

  it("requires an explicit mode for a new legacy rent and clears only a submitted mode-specific rent", () => {
    const legacy = {
      title: "سجل قديم",
      portfolioId: "family",
      assetType: "building",
      usageType: "residential",
      unitCount: "2",
    };
    expect(() => makePropertyDraft({ ...legacy, monthlyRent: "1000" })).toThrow(
      "حدّد طريقة التأجير"
    );
    expect(
      makePropertyDraft({ ...legacy, monthlyRent: "" }).clearMetaKeys
    ).toEqual([]);
    expect(
      makePropertyDraft({
        ...legacy,
        rentalMode: "units",
        monthlyRent: "",
      }).clearMetaKeys
    ).toContain("unitMonthlyRentMinor");
  });

  it("rejects zero, invalid fractions, and rents above the shared metadata limit", () => {
    expect(() => parseMonthlyRentMinor("٠")).toThrow("موجب");
    expect(() => parseMonthlyRentMinor("١٫٢٣٤")).toThrow("منزلتين");
    expect(() => parseMonthlyRentMinor("10000000000.01")).toThrow("ميتاداتا");
  });
});
