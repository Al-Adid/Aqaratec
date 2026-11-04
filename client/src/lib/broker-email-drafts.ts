import type { BrokerRecipientBrief } from "./broker-marketing";

/** Downloading a draft never calls a mail provider and never marks it sent. */
export type DownloadableBrokerBrief = {
  subject: string;
  body: string;
  asOf: string;
};

function safeFilename(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .trim()
      .slice(0, 70) || "موجز-التسويق"
  );
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodedSubject(value: string): string {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (new TextEncoder().encode(chunk + character).length > 42) {
      chunks.push(chunk);
      chunk = character;
    } else chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${utf8Base64(part)}?=`).join("\r\n ");
}

function assertBrief(brief: DownloadableBrokerBrief): void {
  if (!brief.subject.trim() || !brief.body.trim()) {
    throw new Error("جهّز الموجز أولًا قبل تنزيل مسودة البريد.");
  }
  if (brief.subject.length > 256 || brief.body.length > 60_000) {
    throw new Error("يتجاوز الموجز حجم المسودة المسموح.");
  }
  if (/[\r\n\u0000]/.test(brief.subject)) {
    throw new Error("عنوان الموجز يجب أن يكون سطرًا واحدًا.");
  }
}

export function brokerBriefText(brief: DownloadableBrokerBrief): string {
  assertBrief(brief);
  return [
    "صُنّاع الفرص · موجز تسويق عقاري",
    brief.subject,
    `تاريخ البيانات المعلن: ${brief.asOf}`,
    "",
    brief.body,
    "",
    "هذا ملف موجز للتجهيز والمراجعة. تنزيله لا يرسل رسالة بريد.",
  ].join("\n");
}

/** RFC MIME draft for one recipient. Sender is supplied by the user's mail app. */
export function brokerEmailDraftText(
  brief: DownloadableBrokerBrief,
  recipient: BrokerRecipientBrief
): string {
  assertBrief(brief);
  const email = recipient.email.trim();
  if (
    !/^[^\s@<>,;:\u0000\r\n]+@[^\s@<>,;:\u0000\r\n]+\.[^\s@<>,;:\u0000\r\n]+$/.test(
      email
    )
  ) {
    throw new Error("بريد شركة الوساطة غير صالح لمسودة البريد.");
  }
  const greeting = recipient.contactName
    ? `السيد/السيدة ${recipient.contactName}،\n${recipient.companyName}\n\n`
    : `${recipient.companyName}\n\n`;
  const body = utf8Base64(greeting + brief.body);
  const wrappedBody = body.match(/.{1,76}/g)?.join("\r\n") ?? "";
  return [
    `To: ${email}`,
    `Subject: ${encodedSubject(brief.subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrappedBody,
    "",
  ].join("\r\n");
}

/** Opens the user's mail application only; a human must review and send. */
export function brokerMailtoLink(
  brief: DownloadableBrokerBrief,
  recipient: BrokerRecipientBrief
): string | undefined {
  // Reuse exactly the same recipient/subject checks as the downloadable file.
  brokerEmailDraftText(brief, recipient);
  const greeting = recipient.contactName
    ? `السيد/السيدة ${recipient.contactName}،\n${recipient.companyName}\n\n`
    : `${recipient.companyName}\n\n`;
  const address = encodeURIComponent(recipient.email.trim());
  const subject = encodeURIComponent(brief.subject);
  const body = encodeURIComponent(greeting + brief.body);
  const url = `mailto:${address}?subject=${subject}&body=${body}`;
  // Do not silently truncate property details when a native mail URL is too long.
  // Client support still varies; EML and copy remain the reliable fallbacks.
  return url.length <= 8000 ? url : undefined;
}

function download(content: string, name: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke only after the browser has had an opportunity to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBrokerBrief(brief: DownloadableBrokerBrief): void {
  download(
    "\uFEFF" + brokerBriefText(brief),
    `${safeFilename(brief.subject)}.txt`,
    "text/plain;charset=utf-8"
  );
}

export function downloadBrokerEmailDraft(
  brief: DownloadableBrokerBrief,
  recipient: BrokerRecipientBrief
): void {
  download(
    brokerEmailDraftText(brief, recipient),
    `${safeFilename(brief.subject)}-${safeFilename(recipient.companyName)}.eml`,
    "message/rfc822"
  );
}
