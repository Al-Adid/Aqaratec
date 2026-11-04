import {
  DemoEntity,
  ENTITY_KINDS,
  EntityKind,
  EntityMap,
  PrototypeState,
} from "@shared/prototype";

export type PortfolioResolutionOptions = {
  /** Only records explicitly marked as shared lease templates may be unscoped. */
  allowExplicitGlobalTemplate?: boolean;
};

const GLOBAL_TEMPLATE_RECORD_TYPES = new Set([
  "lease-template",
  "lease-template-chunk",
]);

export function isExplicitGlobalTemplateRecord(
  kind: EntityKind,
  record: Pick<DemoEntity, "portfolioId" | "propertyId" | "meta">
): boolean {
  return (
    kind === "documents" &&
    record.portfolioId === "" &&
    record.propertyId === "" &&
    GLOBAL_TEMPLATE_RECORD_TYPES.has(String(record.meta.recordType ?? ""))
  );
}

/**
 * Resolves only demonstrated scopes. In particular, `all`, a virtual route, or
 * an unknown id never silently becomes the first portfolio. A property relation
 * is authoritative and therefore supplies the one permitted implicit scope.
 */
export function resolvePortfolio(
  entities: EntityMap,
  preferred = "",
  propertyId = "",
  fallback = "",
  options: PortfolioResolutionOptions = {}
): string {
  if (propertyId) {
    const property = entities.properties.find(row => row.id === propertyId);
    if (!property)
      throw new Error("العقار المرتبط غير موجود؛ اختر محفظة وعقارًا صحيحين قبل الحفظ");
    if (!entities.portfolios.some(row => row.id === property.portfolioId))
      throw new Error("العقار المرتبط لا يتبع محفظة صالحة");
    return property.portfolioId;
  }
  if (entities.portfolios.some(row => row.id === preferred)) return preferred;
  // A supplied virtual/unknown value is an invalid request, even if a caller
  // happens to hold an older valid fallback. Falling back here would hide an
  // accidental cross-portfolio write during generic patch/add.
  if (preferred && preferred !== "all")
    throw new Error("معرف المحفظة غير معروف؛ اختر محفظة صريحة قبل الحفظ");
  if (entities.portfolios.some(row => row.id === fallback)) return fallback;
  if (
    options.allowExplicitGlobalTemplate &&
    (preferred === "" || preferred === "all") &&
    (fallback === "" || fallback === "all")
  )
    return "";
  throw new Error(
    "اختر محفظة صريحة. لا يمكن حفظ سجل عام أو بمعرف غير معروف دون عقار يحدد نطاقه."
  );
}

/**
 * Historic normalization is deliberately non-destructive: it corrects only
 * proven portfolio self-ids and preserves an already-invalid scope for explicit
 * recovery instead of assigning it to the first portfolio.
 */
export function normalizePrototype(input: PrototypeState): PrototypeState {
  const entities = { ...input.entities };
  entities.portfolios = entities.portfolios.map(row => ({
    ...row,
    portfolioId: row.id,
  }));
  for (const kind of ENTITY_KINDS) {
    if (kind === "portfolios") continue;
    entities[kind] = entities[kind].map(row => {
      const meta = { ...row.meta };
      if (kind === "owners") {
        if (meta.shareBps === undefined && meta.share !== undefined)
          meta.shareBps = Math.round(Number(meta.share) * 100);
        if (meta.effectiveDate === undefined)
          meta.effectiveDate = String(meta.effective ?? row.date);
      }
      if (kind === "maintenance" && meta.quoteCount === undefined) {
        meta.quoteCount =
          Number(Boolean(meta.quote1Minor)) + Number(Boolean(meta.quote2Minor));
      }
      if (kind === "opportunities") {
        if (meta.kind === undefined)
          meta.kind = String(meta.type ?? "فرصة نموذجية");
        if (meta.freshness === undefined) meta.freshness = "لقطة نموذجية مؤرخة";
        if (meta.match === undefined)
          meta.match =
            meta.score === undefined
              ? "يحتاج مراجعة"
              : `توافق نموذجي ${meta.score}%`;
        if (meta.evidence === undefined)
          meta.evidence = "أرقام مفترضة للنموذج، وليست دليل سوق حقيقي";
      }
      if (kind === "comparables") {
        if (typeof meta.area === "number" && typeof meta.region === "string") {
          meta.areaSqm = meta.area;
          meta.area = meta.region;
        }
        if (meta.evidenceType === undefined)
          meta.evidenceType = String(meta.evidence ?? "إعلان");
        if (meta.rights === undefined)
          meta.rights = "بيانات مصطنعة للنموذج فقط";
      }
      const updated = { ...row, meta } as DemoEntity;
      if (isExplicitGlobalTemplateRecord(kind, updated)) return updated;
      try {
        return {
          ...updated,
          portfolioId: resolvePortfolio(
            entities,
            updated.portfolioId,
            updated.propertyId
          ),
        } as DemoEntity;
      } catch {
        // Never guess the first portfolio for a malformed legacy record.
        return updated;
      }
    });
  }
  const portfolioId =
    input.settings.portfolioId === "all" ||
    entities.portfolios.some(row => row.id === input.settings.portfolioId)
      ? input.settings.portfolioId
      : "all";
  return { ...input, entities, settings: { ...input.settings, portfolioId } };
}
