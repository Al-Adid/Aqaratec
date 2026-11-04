import {
  makePropertyDraft,
  normalizePropertyNumericInput,
} from "./property-fields";

export const IMPORT_FIELDS = [
  {
    key: "title",
    label: "اسم العقار",
    aliases: ["اسم العقار", "العقار", "name", "property"],
  },
  {
    key: "assetType",
    label: "نوع العقار",
    aliases: ["نوع العقار", "النوع", "assetType", "type"],
  },
  {
    key: "buildingYear",
    label: "سنة البناء",
    aliases: ["سنة البناء", "year", "buildingYear"],
  },
  {
    key: "unitCount",
    label: "عدد الوحدات",
    aliases: ["عدد الوحدات", "الوحدات", "units", "unitCount"],
  },
  {
    key: "rentalMode",
    label: "طريقة التأجير",
    aliases: [
      "طريقة التأجير",
      "نمط التأجير",
      "طريقة الإيجار",
      "rentalMode",
      "rental mode",
    ],
  },
  {
    key: "monthlyRent",
    label: "الإيجار الشهري (ر.ق)",
    aliases: [
      "الإيجار الشهري",
      "الإيجار الشهري (ر.ق)",
      "monthlyRent",
      "monthly rent",
    ],
  },
  {
    key: "propertyNumber",
    label: "رقم العقار",
    aliases: ["رقم العقار", "رقم الأصل", "propertyNumber", "property number"],
  },
  {
    key: "electricityNumber",
    label: "رقم الكهرباء",
    aliases: [
      "رقم الكهرباء",
      "رقم العداد",
      "electricityNumber",
      "electricity number",
      "meterNumber",
    ],
  },
  {
    key: "location",
    label: "المنطقة / الموقع",
    aliases: ["المنطقة", "الموقع", "location", "area"],
  },
  {
    key: "collectionAccount",
    label: "حساب التحصيل (اسم فقط)",
    aliases: ["حساب التحصيل", "account", "collectionAccount"],
  },
] as const;
export function normalizePropertyTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("صيغة الاقتباس في الملف غير مكتملة");
  if (cell || row.length) {
    row.push(cell);
    if (row.some(v => v.trim())) rows.push(row);
  }
  return rows;
}
export interface PropertyImportRow {
  index: number;
  values: Record<string, string>;
  errors: string[];
}
export function previewPropertyImport(
  rows: string[][],
  mapping: Record<string, number>,
  existingTitles: string[],
  referenceYear: number
): PropertyImportRow[] {
  const existing = new Set(existingTitles.map(normalizePropertyTitle));
  const seen = new Set<string>();
  return rows.map((cells, index) => {
    const values: Record<string, string> = { inputMethod: "Excel" };
    for (const f of IMPORT_FIELDS)
      values[f.key] =
        mapping[f.key] === undefined || mapping[f.key] < 0
          ? ""
          : String(cells[mapping[f.key]] ?? "").trim();
    const errors: string[] = [];
    const title = normalizePropertyTitle(values.title);
    if (!title) errors.push("اسم العقار مطلوب");
    if (existing.has(title)) errors.push("موجود في المحفظة: لن نستبدله");
    if (seen.has(title) && title) errors.push("مكرر داخل الملف");
    seen.add(title);
    if (Object.values(values).some(v => v.startsWith("=") || v === "[معادلة]"))
      errors.push("لا نعتمد خلايا المعادلات؛ أدخل القيمة فقط");
    if (Object.values(values).some(v => v.length > 256))
      errors.push("الخلية طويلة جدًا");
    const numericYear = normalizePropertyNumericInput(values.buildingYear);
    const numericCount = normalizePropertyNumericInput(values.unitCount);
    if (
      values.buildingYear &&
      (!/^\d{4}$/.test(numericYear) ||
        Number(numericYear) < 1800 ||
        Number(numericYear) > referenceYear)
    )
      errors.push("سنة البناء غير صحيحة");
    if (
      values.unitCount &&
      (!/^\d+$/.test(numericCount) || Number(numericCount) > 50)
    )
      errors.push("عدد الوحدات عدد صحيح من صفر إلى خمسين");
    if (!values.assetType) errors.push("نوع العقار مطلوب");
    // Valid import rows go through the exact same validator used by manual
    // creation. Existing lightweight messages above intentionally remain so a
    // row can show all independent CSV/XLSX problems at once.
    if (!errors.length) {
      try {
        makePropertyDraft(
          { ...values, portfolioId: "import-preview" },
          {
            requireInputMethod: true,
            referenceDate: `${referenceYear}-12-31`,
          }
        );
      } catch (caught) {
        errors.push(
          caught instanceof Error ? caught.message : "بيانات العقار غير صالحة"
        );
      }
    }
    return { index: index + 2, values, errors };
  });
}
// Guard ZIP central directory before decompressing untrusted XLSX in the browser.
export function preflightXlsx(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  )
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ملف الإكسل غير صالح");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (count > 2000 || offset >= buffer.byteLength)
    throw new Error("ملف الإكسل كبير أو غير مدعوم");
  let pos = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (
      pos + 46 > buffer.byteLength ||
      view.getUint32(pos, true) !== 0x02014b50
    )
      throw new Error("ملف الإكسل غير صالح");
    const size = view.getUint32(pos + 24, true);
    total += size;
    if (size === 0xffffffff || total > 20 * 1024 * 1024)
      throw new Error("محتوى الملف يتجاوز حد القراءة الآمنة");
    pos +=
      46 +
      view.getUint16(pos + 28, true) +
      view.getUint16(pos + 30, true) +
      view.getUint16(pos + 32, true);
  }
}
