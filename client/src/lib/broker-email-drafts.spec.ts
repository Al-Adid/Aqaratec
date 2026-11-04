import { describe, expect, it } from "vitest";
import {
  brokerBriefText,
  brokerEmailDraftText,
  brokerMailtoLink,
} from "./broker-email-drafts";
import type { BrokerRecipientBrief } from "./broker-marketing";

const brief = {
  subject: "موجز عقارات للتأجير · صُنّاع الفرص",
  body: "فيلا الاختبار · رقم العقار P-009\nالإيجار 12,000 ر.ق شهريًا\nمتاح متوقع من 2026-12-01، وليس شاغرًا اليوم.",
  asOf: "2026-10-24",
};
const recipient: BrokerRecipientBrief = {
  brokerId: "broker-test-1",
  companyName: "شركة وساطة اختبار",
  contactName: "المسؤول التجريبي",
  email: "agent@example.test",
  phone: "+97400000000",
};

describe("broker email draft · local file only", () => {
  it("opens one-recipient draft without CC/BCC or silent truncation", () => {
    const url = brokerMailtoLink(brief, recipient)!;
    expect(url.startsWith("mailto:agent%40example.test?")).toBe(true);
    const parameters = new URLSearchParams(url.split("?")[1]);
    expect(parameters.get("subject")).toBe(brief.subject);
    expect(parameters.get("body")).toContain(brief.body);
    expect(parameters.has("cc")).toBe(false);
    expect(parameters.has("bcc")).toBe(false);
    expect(
      brokerMailtoLink({ ...brief, body: "عقار ".repeat(1000) }, recipient)
    ).toBeUndefined();
    expect(() =>
      brokerMailtoLink(brief, {
        ...recipient,
        email: "a@example.test?bcc=b@example.test",
      })
    ).toThrow();
  });

  it("creates a UTF-8 readable brief with date and an explicit unsent notice", () => {
    const text = brokerBriefText(brief);
    expect(text).toContain(brief.subject);
    expect(text).toContain("2026-10-24");
    expect(text).toContain("ليس شاغرًا اليوم");
    expect(text).toContain("لا يرسل رسالة بريد");
  });
  it("creates a single-recipient unsent MIME file without a fictitious sender or CC/BCC", () => {
    const eml = brokerEmailDraftText(brief, recipient);
    expect(eml).toContain("To: agent@example.test\r\n");
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(eml).not.toMatch(/^(From|Cc|Bcc):/m);
    const body64 = eml.split("\r\n\r\n")[1].replace(/\s/g, "");
    expect(Buffer.from(body64, "base64").toString("utf8")).toContain(
      brief.body
    );
    expect(Buffer.from(body64, "base64").toString("utf8")).toContain(
      recipient.contactName
    );
  });
  it("rejects attempts to inject recipients in either the subject or address", () => {
    expect(() =>
      brokerEmailDraftText(
        { ...brief, subject: "title\r\nBcc: other@example.test" },
        recipient
      )
    ).toThrow(/سطرًا واحدًا/);
    expect(() =>
      brokerEmailDraftText(brief, {
        ...recipient,
        email: "agent@example.test\r\nCc: other@example.test",
      })
    ).toThrow(/غير صالح/);
  });
  it("rejects empty or unbounded draft input without any side effect", () => {
    expect(() => brokerBriefText({ ...brief, body: "" })).toThrow(
      /جهّز الموجز/
    );
    expect(() =>
      brokerBriefText({ ...brief, body: "a".repeat(60_001) })
    ).toThrow(/حجم/);
  });
  it("preserves sale asking price and factual tenancy in every unsent draft format", () => {
    const saleBrief = {
      subject: "فرص بيع جاهزة للمراجعة",
      body: "مجمع بيع تجريبي · العقار كاملًا\nسعر البيع المطلوب: 2,500,000 ر.ق\nحالة التأجير: مؤجر\nمحاكاة فقط؛ لم يُرسل بريد.",
      asOf: "2026-10-28",
    };
    const txt = brokerBriefText(saleBrief);
    const eml = brokerEmailDraftText(saleBrief, recipient);
    const body64 = eml.split("\r\n\r\n")[1].replace(/\s/g, "");
    const decoded = Buffer.from(body64, "base64").toString("utf8");
    const url = brokerMailtoLink(saleBrief, recipient)!;
    const mailBody = new URLSearchParams(url.split("?")[1]).get("body")!;
    for (const body of [txt, decoded, mailBody]) {
      expect(body).toContain(saleBrief.body);
      expect(body).not.toContain("الإيجار المطلوب");
      expect(body).not.toContain("شهريًا");
      expect(body).not.toContain("شاغر الآن");
    }
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).not.toMatch(/^(From|Cc|Bcc):/m);
    expect(eml).not.toContain("Content-Disposition: attachment");
  });
});
