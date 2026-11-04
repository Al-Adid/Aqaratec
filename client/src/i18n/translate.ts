/**
 * Pure Arabic -> English text translation using a phrase dictionary.
 *
 * Keys are the exact Arabic strings the interface renders. A key may contain
 * `{n}` where a number appears in the rendered text (digits are normalised, so
 * "3 استحقاقات" matches the key "{n} استحقاقات"). In the English value, `{n}`
 * takes the numbers in order, or `{1}`, `{2}` pick a specific one.
 *
 * Nothing here touches application state: data values stay Arabic in storage,
 * only what is drawn on screen changes.
 */

export type Dictionary = Readonly<Record<string, string>>;
export type Translator = (text: string) => string | null;

const ARABIC = /[؀-ۿ]/;
const ARABIC_DIGITS = /[٠-٩]/g;
const NUMBER =
  /(?<![A-Za-z0-9_])[0-9٠-٩]+(?:[.,٫٬][0-9٠-٩]+)*/g;

const PUNCT_MAP: Record<string, string> = {
  "؟": "?",
  "،": ",",
  "؛": ";",
  "…": "...",
};


/**
 * Sentence patterns whose variable part (usually a field name) is translated
 * on its own, e.g. "اسم العقار مطلوب." becomes "Property name is required.".
 * `$` entries take the translated variable parts in order; `#` takes a number.
 */
const RULES: Array<[RegExp, string]> = [
  [/^مرشح المحفظة الموروث: (.+)$/, "Inherited portfolio filter: $1"],
  [/^مصدر القيمة: (.+)$/, "Value source: $1"],
  [/^(.+?) غير صالح\.$/, "$1 is not valid."],
  [/^(.+?) مطلوب\.$/, "$1 is required."],
  [/^(.+?) يتجاوز ([0-9]+) حرفًا\.$/, "$1 exceeds #2 characters."],
  [/^(.+?) يتجاوز الحد الآمن لميتاداتا نسخة التجربة\.$/, "$1 exceeds the safe metadata limit of the demo copy."],
  [/^(.+?) يتجاوز الحد المسموح\.$/, "$1 exceeds the allowed limit."],
  [/^(.+?) يتضمن الحقل نفسه أكثر من مرة\.$/, "$1 contains the same field more than once."],
  [/^(.+?) يتضمن حقل تعبئة جماعية غير مسموح\.$/, "$1 contains a bulk fill field that is not allowed."],
  [/^(.+?) يجب أن تكون رقمًا موجبًا أو صفرًا\.$/, "$1 must be a positive number or zero."],
  [/^(.+?) يجب أن يكون عددًا صحيحًا بين 0 و20\.$/, "$1 must be a whole number between 0 and 20."],
  [/^(.+?) يجب أن يكون مبلغًا موجبًا بعملة ر\.ق وبحد أقصى منزلتين عشريتين\.$/, "$1 must be a positive QAR amount with at most two decimal places."],
  [/^(.+?) يجب أن يكون مبلغًا موجبًا بعملة ر\.ق\.$/, "$1 must be a positive QAR amount."],
  [/^(.+?): (.+?)\. اضغط للفرز$/, "$1: $2. Press to sort"],
  [/^(.+?): أدخل قيمة صحيحة ضمن الحدود الموضحة\.$/, "$1: enter a valid value within the limits shown."],
  [/^أدخل قيمة حقل «(.+?)» أو اختر مسحه صراحةً\.$/, "Enter a value for the field \"$1\" or choose to clear it explicitly."],
  [/^وحدات ([A-Za-z].*)$/, "Units of $1"],
  [/^عقار #(.+)$/, "Property #$1"],
  [/^(.+?) صف ([0-9]+)$/, "$1 row #2"],
  [/^إزالة ارتباط الصورة من (.+)$/, "Remove the photo link from $1"],
  [/^صورة غلاف (.+)$/, "Cover photo of $1"],
  [/^معرض صور (.+)$/, "Photo gallery of $1"],
  [/^اختيار صور (.+)$/, "Select photos of $1"],
  [/^عرض وحدات (.+) \(([0-9]+)\)$/, "Show units of $1 (#2)"],
  [/^إخفاء وحدات (.+) \(([0-9]+)\)$/, "Hide units of $1 (#2)"],
  [/^إسناد صور لوحدات (.+)$/, "Assign photos to $1 units"],
  [/^عدد ملفات (.+?): ([0-9]+) من ([0-9]+)$/, "$1: #2 of #3 files"],
  [/^حذف (.+?): (.+)$/, "Delete $1: $2"],
  [/^تعديل (?:الوحدة|وحدة): (.+)$/, "Edit unit: $1"],
  [/^إضافة وحدة: (.+)$/, "Add a unit: $1"],
  [/^تفاصيل الوحدة: (.+)$/, "Unit details: $1"],
  [/^فتح (.+)$/, "Open $1"],
  [/^معاينة (.+)$/, "Preview $1"],
  [/^اختيار (.+)$/, "Select $1"],
];

const SEPARATORS = [" • ", " · ", " | ", " / ", "، ", "؛ ", " - "];

export const hasArabic = (s: string) => ARABIC.test(s);

const latinDigits = (s: string) =>
  s.replace(ARABIC_DIGITS, d => String(d.charCodeAt(0) - 0x0660));

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function fill(template: string, numbers: string[]): string {
  let next = 0;
  return template.replace(/\{(\d*|n)\}/g, (_m, id: string) => {
    if (id === "n" || id === "") return numbers[next++] ?? "";
    return numbers[Number(id) - 1] ?? "";
  });
}

export function createTranslator(dictionary: Dictionary): Translator {
  const exact = new Map<string, string>();
  for (const [k, v] of Object.entries(dictionary)) exact.set(squash(k), v);

  const lookup = (core: string): string | null => {
    const hit = exact.get(core);
    if (hit !== undefined) return hit;

    // number-normalised key
    const numbers: string[] = [];
    const normalised = core.replace(NUMBER, m => {
      numbers.push(latinDigits(m));
      return "{n}";
    });
    if (numbers.length) {
      const t = exact.get(normalised);
      if (t !== undefined) return fill(t, numbers);
      // a rendered number followed by "ر.ق" is money
      const money = /^\{n\}\s*ر\.ق$/.exec(normalised);
      if (money) return `QAR ${numbers[0]}`;
    }
    return null;
  };

  const translateCore = (core: string, depth = 0): string | null => {
    const direct = lookup(core);
    if (direct !== null) return direct;
    if (depth > 2) return null;

    // sentence patterns with a translatable variable part
    for (const [re, out] of RULES) {
      const m = re.exec(core);
      if (!m) continue;
      let ok = true;
      const parts = m.slice(1).map(p => {
        if (!hasArabic(p)) return p;
        const r = translateCore(p.trim(), depth + 1);
        if (r === null) ok = false;
        return r ?? "";
      });
      if (!ok) continue;
      return out.replace(/#(\d)|\$(\d)/g, (_x, n, v) => parts[Number(n ?? v) - 1] ?? "");
    }

    // trailing punctuation: "الحالة:" , "هل تريد المتابعة؟"
    const tail = /^(.*?)([:؟?!.…،؛]+)$/.exec(core);
    if (tail && tail[1]) {
      const inner = translateCore(tail[1].trim(), depth + 1);
      if (inner !== null) {
        const mapped = tail[2].replace(/./g, c => PUNCT_MAP[c] ?? c);
        return inner + mapped;
      }
    }

    // composite strings: "عقارات • وحدات"
    for (const sep of SEPARATORS) {
      if (!core.includes(sep)) continue;
      const parts = core.split(sep);
      const out: string[] = [];
      let ok = true;
      for (const part of parts) {
        const p = part.trim();
        if (!p) {
          out.push(part);
          continue;
        }
        if (!hasArabic(p)) {
          out.push(p);
          continue;
        }
        const r = translateCore(p, depth + 1);
        if (r === null) {
          ok = false;
          break;
        }
        out.push(r);
      }
      if (ok) {
        const joiner = sep === "، " ? ", " : sep === "؛ " ? "; " : sep;
        return out.join(joiner);
      }
    }
    return null;
  };

  return (text: string): string | null => {
    if (!ARABIC.test(text)) return null;
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text)![0];
    const core = squash(text);
    if (!core) return null;
    const out = translateCore(core);
    if (out === null) return null;
    return lead + out + trail;
  };
}
