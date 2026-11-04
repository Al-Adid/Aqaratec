import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityKind,
  type PrototypeState,
} from "@shared/prototype";
import { assertPrototypeState } from "@shared/prototype-validation";
export type RemovableAssetKind = "properties" | "portfolios";
export interface AssetRemovalCheck {
  allowed: boolean;
  reason: string;
  unitCount: number;
}
function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === "string") {
    if (ids.has(value.trim())) return true;
    if (/^[\[{]/.test(value.trim())) {
      try {
        return references(JSON.parse(value), ids);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(v => references(v, ids));
  if (value && typeof value === "object")
    return Object.values(value).some(v => references(v, ids));
  return false;
}
const LABELS: Partial<Record<EntityKind, string>> = {
  properties: "عقارات",
  units: "وحدات",
  tenants: "مستأجرين",
  leases: "عقود",
  receivables: "مستحقات",
  collections: "تحصيلات",
  expenses: "مصروفات",
  documents: "مستندات",
  maintenance: "صيانة",
  payments: "مدفوعات",
  losses: "خسائر",
  journal: "دفتر مالي",
};
export function checkAssetRemoval(
  state: PrototypeState,
  kind: RemovableAssetKind,
  id: string
): AssetRemovalCheck {
  const target = state.entities[kind].find(row => row.id === id);
  if (!target)
    return { allowed: false, reason: "السجل المطلوب غير موجود.", unitCount: 0 };
  if (
    state.settings.portfolioId !== "all" &&
    (kind === "portfolios" ? target.id : target.portfolioId) !==
      state.settings.portfolioId
  )
    return {
      allowed: false,
      reason: "السجل خارج نطاق المحفظة الحالية.",
      unitCount: 0,
    };
  if (
    target.amountMinor !== 0 ||
    Object.entries(target.meta).some(
      ([key, value]) =>
        /balance|cash|debt|liability|deposit|reserve/i.test(key) &&
        Number(value) > 0
    )
  ) {
    return {
      allowed: false,
      reason:
        "السجل يحمل رصيدًا أو مبلغًا افتتاحيًا؛ لا يمكن حذفه بهذه الطريقة.",
      unitCount: 0,
    };
  }
  const children =
    kind === "properties"
      ? state.entities.units.filter(u => u.propertyId === id)
      : [];
  const ids = new Set([id, ...children.map(u => u.id)]);
  for (const entityKind of ENTITY_KINDS) {
    for (const row of state.entities[entityKind]) {
      if (entityKind === kind && row.id === id) continue;
      if (kind === "properties" && entityKind === "units" && ids.has(row.id))
        continue;
      const linked =
        kind === "portfolios"
          ? row.portfolioId === id ||
            row.propertyId === id ||
            references(row.meta, ids)
          : ids.has(row.propertyId) || references(row.meta, ids);
      if (linked)
        return {
          allowed: false,
          reason: `لا يمكن الحذف: توجد ${LABELS[entityKind] ?? "سجلات محفوظة"} مرتبطة بالسجل (${row.title}). يبقى التاريخ المالي محفوظًا.`,
          unitCount: children.length,
        };
    }
  }
  if (
    children.some(
      u =>
        !["متاحة", "شاغرة", "قيد التجهيز", "جديد"].includes(u.status) ||
        u.amountMinor !== 0 ||
        references(
          Object.fromEntries(
            Object.entries(u.meta).filter(([key]) =>
              /lease|tenant|occup|opening/i.test(key)
            )
          ),
          new Set(["true", "occupied", "مشغولة", "مؤجرة"])
        ) ||
        Object.keys(u.meta).some(
          k =>
            /openingOccupancy|openingLease|tenantId|leaseId/i.test(k) &&
            Boolean(u.meta[k])
        )
    )
  )
    return {
      allowed: false,
      reason:
        "توجد وحدة ذات إشغال أو رصيد أو علاقة إيجار محفوظة؛ لا تُحذف من هذا الإجراء.",
      unitCount: children.length,
    };
  return {
    allowed: true,
    reason:
      kind === "properties"
        ? `يحذف العقار وأهدافه/وحداته غير المستخدمة (${children.length}) فقط؛ لا توجد سجلات أخرى مرتبطة.`
        : "المحفظة خالية من السجلات ويمكن حذفها.",
    unitCount: children.length,
  };
}
export function removeUnusedAsset(
  state: PrototypeState,
  kind: RemovableAssetKind,
  id: string
): { state: PrototypeState; result: DemoEntity } {
  if (state.settings.role !== "operator")
    throw new Error("الحذف متاح لمعاينة الموظف فقط.");
  const check = checkAssetRemoval(state, kind, id);
  if (!check.allowed) throw new Error(check.reason);
  const target = state.entities[kind].find(row => row.id === id)!;
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      [kind]: state.entities[kind].filter(row => row.id !== id),
      ...(kind === "properties"
        ? { units: state.entities.units.filter(row => row.propertyId !== id) }
        : {}),
    },
    settings: {
      ...state.settings,
      ...(kind === "portfolios" && state.settings.portfolioId === id
        ? { portfolioId: "all" }
        : {}),
    },
    audit: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        title: `حذف ${kind === "properties" ? "عقار غير مرتبط" : "محفظة خالية"}: ${target.title}`,
        detail: check.reason,
      },
      ...state.audit,
    ].slice(0, 300),
  };
  return { state: assertPrototypeState(next), result: target };
}
