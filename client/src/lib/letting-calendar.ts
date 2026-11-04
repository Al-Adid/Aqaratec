import type { DemoEntity } from "@shared/prototype";

const SUMMARY = "موعد تسليم التأجير التجريبي";
const DESCRIPTION =
  "موعد تجريبي داخل نموذج التأجير المحلي؛ لا يُرسل إلى تقويم خارجي.";
const PROD_ID = "-//Sunnaa//Letting Prototype//AR";

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}

function parseOffsetDate(value: unknown, field: string) {
  const text = requiredString(value, `وقت ${field} للموعد غير متاح.`).trim();
  // Date.parse accepts many browser-dependent forms. Calendar slots must retain
  // an explicit offset (or Z) so a date-only/local value cannot silently move.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text
    )
  )
    throw new Error(`وقت ${field} يجب أن يكون ISO 8601 مع منطقة زمنية صريحة.`);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp))
    throw new Error(`وقت ${field} للموعد غير صالح.`);
  return new Date(timestamp);
}

function two(value: number) {
  return String(value).padStart(2, "0");
}

function icsUtc(date: Date) {
  return `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(
    date.getUTCDate()
  )}T${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(
    date.getUTCSeconds()
  )}Z`;
}

/** RFC 5545 recommends physical lines of at most 75 octets. Continuations
 * start with exactly one whitespace character, without modifying the logical
 * field value a calendar reader receives. */
function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (bytes && bytes + characterBytes > limit) {
      parts.push(current);
      current = ` ${character}`;
      bytes = 1 + characterBytes;
      limit = 75;
    } else {
      current += character;
      bytes += characterBytes;
    }
  }
  if (current || !parts.length) parts.push(current);
  return parts.join("\r\n");
}

/** RFC 5545 TEXT escaping. Line separators are normalized to spaces before
 * escaping, which blocks a CRLF value from introducing a calendar property. */
export function escapeLettingCalendarText(value: string) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** A deterministic FNV-1a UID segment keeps the two non-PII record IDs out of
 * the exported file while remaining stable for the same slot/application pair. */
function stableUidSegment(slotId: string, applicationId: string) {
  const source = `${slotId}\u001f${applicationId}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

function stableUid(slot: DemoEntity, application: DemoEntity) {
  const slotId = requiredString(slot.id, "تعذر إنشاء معرف الموعد.");
  const applicationId = requiredString(
    application.id,
    "تعذر إنشاء معرف طلب التأجير."
  );
  return `letting-${stableUidSegment(slotId, applicationId)}@sunnaa.local`;
}

/**
 * Builds an offline .ics representation only. It neither sends an invite nor
 * creates an event in a device or third-party calendar. Exact slot start/end
 * values are required; it never invents a default duration.
 */
export function buildLettingCalendarInvite(
  slot: DemoEntity,
  application: DemoEntity
): string {
  const start = parseOffsetDate(slot.meta.start, "بداية");
  const end = parseOffsetDate(slot.meta.end, "نهاية");
  if (end.getTime() <= start.getTime())
    throw new Error("يجب أن تكون نهاية الموعد بعد بدايته.");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `PRODID:${PROD_ID}`,
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${stableUid(slot, application)}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escapeLettingCalendarText(SUMMARY)}`,
    `DESCRIPTION:${escapeLettingCalendarText(DESCRIPTION)}`,
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Downloads an invite locally. The browser remains the sole caller that may
 * offer import; this helper never opens or writes to an external calendar. */
export function downloadLettingCalendarInvite(
  slot: DemoEntity,
  application: DemoEntity
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const data = buildLettingCalendarInvite(slot, application);
  const blob = new Blob([data], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "letting-handover-appointment.ics";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
