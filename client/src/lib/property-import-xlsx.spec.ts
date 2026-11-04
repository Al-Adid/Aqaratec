import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { preflightXlsx } from "./property-import";
describe("valid XLSX local reader", () => {
  it("accepts a valid workbook and retains Arabic cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("عقارات");
    sheet.addRow(["اسم العقار", "سنة البناء"]);
    sheet.addRow(["فيلا تجريبية", 2020]);
    const buffer = await workbook.xlsx.writeBuffer();
    const view = new Uint8Array(buffer);
    const bytes = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    );
    expect(() => preflightXlsx(bytes)).not.toThrow();
    const reader = new ExcelJS.Workbook();
    await reader.xlsx.load(buffer);
    expect(reader.worksheets[0].getCell("A2").value).toBe("فيلا تجريبية");
    expect(reader.worksheets[0].getCell("B2").value).toBe(2020);
  });
});
