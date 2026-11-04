import { describe, expect, it } from "vitest";
import {
  parseDelimited,
  previewPropertyImport,
  preflightXlsx,
} from "./property-import";
describe("property Excel preview", () => {
  it("reads Arabic CSV and quoted newlines", () => {
    expect(parseDelimited('اسم,منطقة\r\n"عقار، أول","سطر\nثاني"')).toEqual([
      ["اسم", "منطقة"],
      ["عقار، أول", "سطر\nثاني"],
    ]);
  });
  it("marks duplicate titles without replacement", () => {
    const rows = previewPropertyImport(
      [
        ["فيلا ألف", "فيلا", "2020", "1"],
        ["فيلا ألف", "فيلا", "2020", "1"],
        ["عمارة باء", "عمارة", "2021", "8"],
      ],
      { title: 0, assetType: 1, buildingYear: 2, unitCount: 3 },
      ["فيلا ألف"],
      2026
    );
    expect(rows[0].errors).toContain("موجود في المحفظة: لن نستبدله");
    expect(rows[1].errors).toContain("مكرر داخل الملف");
    expect(rows[2].errors).toEqual([]);
  });
  it("refuses future years, bad units and formula values", () => {
    const rows = previewPropertyImport(
      [["=NOW()", "فيلا", "2030", "-1"]],
      { title: 0, assetType: 1, buildingYear: 2, unitCount: 3 },
      [],
      2026
    );
    expect(rows[0].errors.length).toBe(3);
  });
  it("allows unknown construction year but not unknown type", () => {
    expect(
      previewPropertyImport(
        [["أرض أ", "أرض", "", "0"]],
        { title: 0, assetType: 1, buildingYear: 2, unitCount: 3 },
        [],
        2026
      )[0].errors
    ).toEqual([]);
  });
  it("uses the shared rental-mode validator for optional Excel columns", () => {
    const mapping = {
      title: 0,
      assetType: 1,
      buildingYear: 2,
      unitCount: 3,
      rentalMode: 4,
      propertyNumber: 5,
      electricityNumber: 6,
    };
    const valid = previewPropertyImport(
      [["فيلا كاملة", "فيلا", "2020", "50", "whole", "0007", "00129"]],
      mapping,
      [],
      2026
    );
    expect(valid[0].errors).toEqual([]);
    expect(valid[0].values).toMatchObject({
      rentalMode: "whole",
      propertyNumber: "0007",
      electricityNumber: "00129",
    });

    const invalid = previewPropertyImport(
      [["عمارة مقسمة", "عمارة", "2020", "1", "units", "", ""]],
      mapping,
      [],
      2026
    );
    expect(invalid[0].errors.join(" ")).toContain("التقسيم إلى وحدات");
  });
  it("validates the optional monthly-rent column with Arabic QAR input", () => {
    const mapping = {
      title: 0,
      assetType: 1,
      buildingYear: 2,
      unitCount: 3,
      rentalMode: 4,
      monthlyRent: 5,
    };
    const valid = previewPropertyImport(
      [["عمارة الإيجار", "عمارة", "2020", "2", "units", "١٬٢٣٤٫٥٠"]],
      mapping,
      [],
      2026
    );
    expect(valid[0].errors).toEqual([]);
    expect(valid[0].values.monthlyRent).toBe("١٬٢٣٤٫٥٠");

    const zero = previewPropertyImport(
      [["عمارة صفر", "عمارة", "2020", "2", "units", "0"]],
      mapping,
      [],
      2026
    );
    expect(zero[0].errors.join(" ")).toContain("موجب");

    const unknownMode = previewPropertyImport(
      [["سجل قديم", "عمارة", "2020", "2", "", "900"]],
      mapping,
      [],
      2026
    );
    expect(unknownMode[0].errors.join(" ")).toContain("حدّد طريقة التأجير");
  });
  it("rejects non XLSX archives before parse", () => {
    expect(() => preflightXlsx(new ArrayBuffer(22))).toThrow("غير صالح");
  });
});
