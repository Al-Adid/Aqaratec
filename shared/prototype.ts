export const ENTITY_KINDS = [
  "portfolios",
  "properties",
  "units",
  "tenants",
  "leases",
  "receivables",
  "collections",
  "losses",
  "expenses",
  "bankTransactions",
  "payments",
  "budgets",
  "reserves",
  "liabilities",
  "journal",
  "documents",
  "vacancies",
  "maintenance",
  "preventive",
  "vendors",
  "inspections",
  "disputes",
  "tasks",
  "notifications",
  "members",
  "delegations",
  "approvals",
  "owners",
  "contributions",
  "distributions",
  "applications",
  "listings",
  "signatures",
  "comparables",
  "plans",
  "reviews",
  "opportunities",
  "sources",
  "quality",
  "funding",
  "subscriptions",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export type MetaValue = string | number | boolean;
export interface DemoEntity {
  id: string;
  title: string;
  subtitle: string;
  portfolioId: string;
  propertyId: string;
  status: string;
  date: string;
  amountMinor: number;
  currency: "QAR";
  meta: Record<string, MetaValue>;
}
export type EntityMap = Record<EntityKind, DemoEntity[]>;
export type PreviewRole = "operator" | "owner" | "tenant" | "vendor";
export const MAX_CONTENT_PRESETS = 64;
export const MAX_CONTENT_PRESET_LENGTH = 160;
export interface AuditEvent {
  id: string;
  at: string;
  title: string;
  detail: string;
}
export type PrototypePeriod =
  | "all"
  | "month"
  | "quarter"
  | "year"
  | "2026-05"
  | "2026-06"
  | "2026-07"
  | "2026-08"
  | "2026-09"
  | "2026-10"
  | "2026-11"
  | "2026-12"
  | `${number}-${number}`;
export interface PrototypeState {
  version: 1;
  entities: EntityMap;
  audit: AuditEvent[];
  settings: {
    role: PreviewRole;
    portfolioId: string;
    period: PrototypePeriod;
    language: "ar" | "en";
    scenarioDate?: string;
    /** Optional so snapshots created before reusable contents choices remain valid. */
    contentPresets?: string[];
  };
}
export type NewEntity = Partial<DemoEntity> & Pick<DemoEntity, "title">;
export interface FeatureDefinition {
  id: string;
  title: string;
  description: string;
  path: string;
  mode: "interactive" | "simulation" | "external";
}
export const BRAND_ASSETS = {
  icon: "/manus-storage/async-images/GFtehVUmaym9Fk53lp2cs1/image-1.webp",
  villa: "/manus-storage/async-images/GFtehVUmaym9Fk53lp2cs1/image-2.webp",
  apartments: "/manus-storage/async-images/GFtehVUmaym9Fk53lp2cs1/image-3.webp",
  tower: "/manus-storage/async-images/GFtehVUmaym9Fk53lp2cs1/image-4.webp",
} as const;
export const PROTOTYPE_DATE = "2026-10-24";
export const CONFIRMED_COLLECTION_STATUSES = ["محصّل", "محصل", "مسوّى"];
export function isMinorAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function toMinor(value: string | number): number {
  const text = String(value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("أدخل مبلغًا موجبًا بحد أقصى منزلتين عشريتين");
  const [whole, decimals = ""] = text.split(".");
  const n = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!isMinorAmount(n)) throw new Error("المبلغ يتجاوز الحد الآمن");
  return n;
}
export function money(value: number, currency = "QAR"): string {
  return (
    new Intl.NumberFormat("en-QA", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value / 100) + (currency === "QAR" ? " ر.ق" : ` ${currency}`)
  );
}
export function metadata(
  entity: DemoEntity,
  key: string,
  fallback = ""
): string {
  return String(entity.meta[key] ?? fallback);
}
