import type { DemoEntity, MetaValue } from "@shared/prototype";

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function sortedMeta(meta: Record<string, MetaValue>): Record<string, MetaValue> {
  return Object.fromEntries(
    Object.entries(meta).sort(([left], [right]) => left.localeCompare(right))
  );
}

/**
 * A deterministic UI concurrency token for one saved entity. It is not a
 * permission or security credential: normal role and portfolio guards must run
 * before an edit token is considered.
 */
export function entityEditToken(entity: DemoEntity): string {
  return `edit-${hash(
    JSON.stringify({
      id: entity.id,
      title: entity.title,
      subtitle: entity.subtitle,
      portfolioId: entity.portfolioId,
      propertyId: entity.propertyId,
      status: entity.status,
      date: entity.date,
      amountMinor: entity.amountMinor,
      currency: entity.currency,
      meta: sortedMeta(entity.meta),
    })
  )}`;
}

/** Throws before a transition is constructed, leaving the supplied state intact. */
export function assertExpectedEntityToken(
  entity: DemoEntity,
  expected: unknown
): void {
  if (expected === undefined || expected === "") return;
  if (typeof expected !== "string" || expected !== entityEditToken(entity)) {
    throw new Error(
      "تعارض تعديل: تغيّر السجل لدى مستخدم آخر. حدّث البيانات ثم أعد المحاولة؛ لم يُحفظ أي تعديل."
    );
  }
}
