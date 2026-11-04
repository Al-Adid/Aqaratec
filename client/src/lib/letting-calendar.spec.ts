import { describe, expect, it } from "vitest";
import type { DemoEntity } from "@shared/prototype";
import { buildLettingCalendarInvite } from "./letting-calendar";

function entity(
  id: string,
  meta: Record<string, string | number | boolean> = {}
): DemoEntity {
  return {
    id,
    title: "اسم لا يجب أن يظهر في ملف التقويم",
    subtitle: "",
    portfolioId: "portfolio-test",
    propertyId: "property-test",
    status: "",
    date: "2026-10-25",
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
}

function utcIcs(value: string) {
  const date = new Date(Date.parse(value));
  const two = (number: number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(
    date.getUTCDate()
  )}T${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(
    date.getUTCSeconds()
  )}Z`;
}

describe("letting calendar invite", () => {
  it("uses JavaScript UTC conversion for the exact explicit-offset slot times", () => {
    const start = "2026-10-25T10:15:30+03:00";
    const end = "2026-10-25T11:45:00+03:00";
    const invite = buildLettingCalendarInvite(
      entity("slot-87654321", { start, end }),
      entity("application-12345678")
    );

    expect(invite).toContain(`DTSTART:${utcIcs(start)}`);
    expect(invite).toContain(`DTEND:${utcIcs(end)}`);
    expect(invite).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(invite).toContain("SUMMARY:موعد تسليم التأجير التجريبي");
    expect(invite).toContain("BEGIN:VCALENDAR\r\n");
    expect(invite.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("produces a stable non-PII UID and never emits slot/application IDs or titles", () => {
    const slot = entity("slot-id-with-private-reference", {
      start: "2026-10-25T10:00:00+03:00",
      end: "2026-10-25T10:30:00+03:00",
      employee: "موظف\r\nATTENDEE:attacker@example.test",
    });
    const application = entity("application-id-with-private-reference");
    const one = buildLettingCalendarInvite(slot, application);
    const two = buildLettingCalendarInvite(slot, application);
    const uidOne = one.match(/^UID:(.+)$/m)?.[1];
    const uidTwo = two.match(/^UID:(.+)$/m)?.[1];

    expect(uidOne).toBe(uidTwo);
    expect(uidOne).toMatch(/^letting-[a-z0-9]+@sunnaa\.local$/);
    expect(one).not.toContain(slot.id);
    expect(one).not.toContain(application.id);
    expect(one).not.toContain(slot.title);
    expect(one).not.toContain("ATTENDEE:");
  });

  it("requires an explicit valid end time and does not invent a one-hour duration", () => {
    const application = entity("application-12345678");
    expect(() =>
      buildLettingCalendarInvite(
        entity("slot-12345678", { start: "2026-10-25T10:00:00+03:00" }),
        application
      )
    ).toThrow("نهاية");
    expect(() =>
      buildLettingCalendarInvite(
        entity("slot-12345678", {
          start: "2026-10-25T10:00:00+03:00",
          end: "2026-10-25T10:00:00+03:00",
        }),
        application
      )
    ).toThrow("نهاية الموعد");
    expect(() =>
      buildLettingCalendarInvite(
        entity("slot-12345678", {
          start: "2026-10-25T10:00:00",
          end: "2026-10-25T11:00:00+03:00",
        }),
        application
      )
    ).toThrow("منطقة زمنية");
  });
});
