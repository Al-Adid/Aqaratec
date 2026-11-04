const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 16000;
export interface ImportedTemplateFile {
  content: string;
  fileName: string;
  warning: string;
}
/** Inspect central-directory lengths before a DOCX decompressor sees an upload. */
export function preflightTemplateDocx(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (
    bytes.length < 22 ||
    bytes.length > MAX_FILE_BYTES ||
    view.getUint32(0, true) !== 0x04034b50
  )
    throw new Error("ملف Word غير صالح أو يتجاوز 2MB.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("تعذر قراءة أرشيف Word.");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true),
    size = view.getUint32(end + 12, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    count === 0 ||
    count > 500 ||
    offset + size > end
  )
    throw new Error("أرشيف Word متعدد الأجزاء أو كبير غير مدعوم.");
  let cursor = offset,
    total = 0,
    hasDocument = false;
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("بنية ملف Word غير سليمة.");
    const flags = view.getUint16(cursor + 8, true),
      compressed = view.getUint32(cursor + 20, true),
      uncompressed = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extra + comment;
    if (
      next > end ||
      (flags & 1) !== 0 ||
      uncompressed > 10 * 1024 * 1024 ||
      (compressed === 0 && uncompressed > 0) ||
      (compressed > 0 && uncompressed / compressed > 200)
    )
      throw new Error(
        "الملف محمي أو يحتوي ضغطًا غير آمن أو بيانات أكبر من المسموح."
      );
    total += uncompressed;
    if (total > 10 * 1024 * 1024)
      throw new Error("المحتوى المفكوك يتجاوز الحد المسموح.");
    const name = decoder.decode(
      bytes.slice(cursor + 46, cursor + 46 + nameLength)
    );
    if (
      name.includes("..") ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /vbaProject\.bin$/i.test(name)
    )
      throw new Error("محتوى Word غير مدعوم.");
    if (name === "word/document.xml") hasDocument = true;
    cursor = next;
  }
  if (!hasDocument || cursor > offset + size)
    throw new Error("الملف ليس نموذج DOCX نصيًا صالحًا.");
}
export async function readTemplateFile(
  file: File
): Promise<ImportedTemplateFile> {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error("اختر ملفًا غير فارغ بحجم لا يتجاوز 2MB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension !== "txt" && extension !== "docx")
    throw new Error(
      "ندعم TXT وWord بصيغة DOCX فقط. PDF والصور وDOC القديم غير مدعومة؛ انسخ النص أو حوّله إلى DOCX."
    );
  const buffer = await file.arrayBuffer();
  let content = "",
    warning = "";
  if (extension === "txt") {
    try {
      content = new TextDecoder("utf-8", { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, "");
    } catch {
      throw new Error("ملف TXT يجب أن يكون بترميز UTF-8.");
    }
  } else {
    preflightTemplateDocx(buffer);
    try {
      const module = await import("mammoth/mammoth.browser");
      const reader = module.default ?? module;
      const result = await reader.extractRawText({ arrayBuffer: buffer });
      content = result.value;
    } catch {
      throw new Error(
        "تعذر استخراج النص من Word؛ قد يكون الملف تالفًا أو محميًا. لم يُحفظ النموذج."
      );
    }
    warning =
      "استوردنا النص فقط. تنسيق Word والصور والتواقيع لا تنتقل؛ راجع النص وأضف حقول التعبئة قبل الحفظ.";
  }
  content = content.replace(/\r\n?/g, "\n").trim();
  if (!content) throw new Error("لا يوجد نص قابل للاستخراج في الملف.");
  if (content.length > MAX_TEXT)
    throw new Error("نص النموذج يتجاوز 16000 حرف؛ اختصره قبل الحفظ.");
  return {
    content,
    fileName: file.name.slice(0, 120),
    warning:
      warning ||
      "الاستيراد محلي ولم يرسل الملف إلى أي جهة؛ أضف حقول التعبئة وراجع النص.",
  };
}
