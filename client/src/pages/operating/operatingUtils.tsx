import type {
  DemoEntity,
  EntityKind,
  NewEntity,
  PrototypeState,
} from "@shared/prototype";
import { money, metadata, toMinor } from "@shared/prototype";
import { Badge } from "@/components/app/Primitives";
import { inPrototypePeriod } from "@/lib/prototype-period";

export const DEMO_DATE = "2026-10-24";

export function value(
  values: Record<string, string>,
  key: string,
  fallback = ""
): string {
  return values[key]?.trim() || fallback;
}

/** Converts a form amount into integer minor units without ever storing a float. */
export function formMinor(
  values: Record<string, string>,
  key: string
): number | null {
  try {
    return toMinor(value(values, key));
  } catch {
    return null;
  }
}

const ASSET_KINDS = new Set<EntityKind>([
  "portfolios",
  "properties",
  "units",
  "tenants",
  "leases",
]);

export function currentPeriodRows(
  rows: DemoEntity[],
  period: string,
  kind?: EntityKind
): DemoEntity[] {
  if (kind && ASSET_KINDS.has(kind)) return rows;
  return rows.filter(row => inPrototypePeriod(row.date, period));
}

export function entityInput(
  title: string,
  overrides: Partial<DemoEntity> = {}
): NewEntity {
  return {
    title,
    subtitle: "سجل تجريبي محلي",
    portfolioId: "",
    propertyId: "",
    status: "مسودة",
    date: DEMO_DATE,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

export function labelForEntity(entity: DemoEntity, fallback = "-"): string {
  return entity.title || entity.subtitle || fallback;
}

export function entityMeta(
  entity: DemoEntity,
  key: string,
  fallback = "-"
): string {
  const candidate = metadata(entity, key, "");
  return candidate || fallback;
}

export function statusTone(
  status: string
): "green" | "amber" | "red" | "blue" | "gray" {
  const normalized = status.toLowerCase();
  if (/(محص|مسجل|نشط|مدفوع|مغلق|مكتمل|مسو|مقبول|مصف)/.test(normalized))
    return "green";
  if (/(متأخر|مرتجع|مرفوض|خسارة|استثناء|غير مطابق|ملغي)/.test(normalized))
    return "red";
  if (/(معلق|مسودة|مستلم|مودع|تفويض|مراجعة|جزئي|شاغر|طلب)/.test(normalized))
    return "amber";
  if (/(محاك|مقترح|قيد|مرسل)/.test(normalized)) return "blue";
  return "gray";
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

export function portfolioName(portfolios: DemoEntity[], id: string): string {
  return (
    portfolios.find(portfolio => portfolio.id === id)?.title ||
    "محفظة غير محددة"
  );
}

export function amountCell(entity: DemoEntity): string {
  return money(entity.amountMinor, entity.currency);
}

export function sumMinor(rows: DemoEntity[]): number {
  return rows.reduce((total, row) => total + row.amountMinor, 0);
}

export function scopedRows(
  rows: DemoEntity[],
  settings: PrototypeState["settings"],
  kind?: EntityKind
): DemoEntity[] {
  return currentPeriodRows(rows, settings.period, kind);
}

export function selectOptions(
  rows: DemoEntity[],
  blank = "اختر من القائمة"
): Array<{ value: string; label: string }> {
  return [
    { value: "", label: blank },
    ...rows.map(row => ({ value: row.id, label: row.title })),
  ];
}

export function kindLabel(kind: EntityKind): string {
  const labels: Partial<Record<EntityKind, string>> = {
    portfolios: "محفظة",
    properties: "عقار",
    units: "وحدة",
    leases: "عقد",
    receivables: "استحقاق",
    collections: "تحصيل",
    losses: "خسارة",
    expenses: "مصروف",
    bankTransactions: "سطر كشف",
    payments: "دفعة",
    budgets: "ميزانية",
    reserves: "احتياطي",
    liabilities: "التزام",
    journal: "قيد",
    vacancies: "شغور",
  };
  return labels[kind] || kind;
}

export function idSuffix(id: string): string {
  return id.slice(-6).toUpperCase();
}
