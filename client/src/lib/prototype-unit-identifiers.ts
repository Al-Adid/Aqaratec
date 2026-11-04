import type {
  AuditEvent,
  DemoEntity,
  EntityMap,
  PrototypeState,
} from "@shared/prototype";
import { validatePrototypeState } from "@shared/prototype-validation";

const MAX_UNIT_IDENTIFIER_LENGTH = 80;
const AUDIT_LIMIT = 300;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `unit-identifier-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function identifierFrom(unit: DemoEntity): string {
  return text(unit.meta.unitCode) || text(unit.meta.code);
}

/**
 * Canonicalizes only for duplicate detection. The stored identifier is always
 * kept exactly as entered after trimming, including any leading zeroes.
 */
function comparableIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .toLocaleLowerCase("ar");
}

function unitAndProperty(
  entities: EntityMap,
  unitId: string
): { unit: DemoEntity; property: DemoEntity; portfolio: DemoEntity } {
  const unit = entities.units.find(row => row.id === unitId);
  if (!unit) throw new Error("الوحدة المطلوبة غير موجودة.");
  if (!unit.propertyId)
    throw new Error("الوحدة لا تحمل ربطًا بعقار؛ لم يُحفظ أي تعديل.");

  const property = entities.properties.find(row => row.id === unit.propertyId);
  if (!property)
    throw new Error("العقار المرتبط بالوحدة غير موجود؛ لم يُحفظ أي تعديل.");
  if (!property.portfolioId || unit.portfolioId !== property.portfolioId)
    throw new Error(
      "الوحدة والعقار لا يتبعان المحفظة نفسها؛ لم يُحفظ أي تعديل."
    );

  const portfolio = entities.portfolios.find(
    row => row.id === property.portfolioId
  );
  if (!portfolio)
    throw new Error("العقار لا يتبع محفظة صالحة؛ لم يُحفظ أي تعديل.");

  return { unit, property, portfolio };
}

export function assertUnitIdentifierAvailable(
  entities: EntityMap,
  propertyId: string,
  rawCode: string,
  ignoreUnitId?: string
): string {
  if (!entities.properties.some(p => p.id === propertyId))
    throw new Error("العقار المرتبط بالوحدة غير موجود.");
  if (typeof rawCode !== "string" || !rawCode.trim())
    throw new Error("رقم/رمز الوحدة مطلوب.");
  const code = rawCode.trim();
  if (code.length > MAX_UNIT_IDENTIFIER_LENGTH)
    throw new Error("رقم/رمز الوحدة يتجاوز 80 حرفًا.");
  if (
    entities.units.some(
      u =>
        u.propertyId === propertyId &&
        u.id !== ignoreUnitId &&
        comparableIdentifier(identifierFrom(u)) === comparableIdentifier(code)
    )
  )
    throw new Error("رقم/رمز الوحدة مكرر ضمن العقار نفسه؛ لم يُحفظ أي تعديل.");
  return code;
}

export function nextUnitIdentifier(
  entities: EntityMap,
  propertyId: string
): string {
  const taken = new Set(
    entities.units
      .filter(u => u.propertyId === propertyId)
      .map(u => comparableIdentifier(identifierFrom(u)))
  );
  for (let n = 1; n <= 1000; n++) {
    const code = `U-${String(n).padStart(2, "0")}`;
    if (!taken.has(comparableIdentifier(code))) return code;
  }
  throw new Error("لا يوجد رقم وحدة متاح ضمن سعة التجربة.");
}

/**
 * A human-facing local reference for a unit. It deliberately never exposes a
 * storage UUID and does not claim to be an official/government identifier.
 */
export function unitDisplayReference(
  entities: EntityMap,
  unitId: string
): string {
  const unit = entities.units.find(row => row.id === unitId);
  if (!unit) return "";
  const property = entities.properties.find(row => row.id === unit.propertyId);
  if (!property) return "";

  const propertyReference =
    text(property.meta.propertyNumber) || text(property.title);
  const unitIdentifier = identifierFrom(unit);
  return [propertyReference, unitIdentifier].filter(Boolean).join(" · ");
}

export interface UpdateUnitIdentifierResult {
  state: PrototypeState;
  result: DemoEntity;
}

/**
 * Replaces only a unit's local display code. Lease and document snapshots are
 * intentionally not derived or rewritten by this transition.
 */
export function updateUnitIdentifier(
  state: PrototypeState,
  unitId: string,
  rawCode: string
): UpdateUnitIdentifierResult {
  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  if (typeof rawCode !== "string") throw new Error("رقم/رمز الوحدة غير صالح.");

  const code = rawCode.trim();
  if (!code) throw new Error("رقم/رمز الوحدة مطلوب.");
  if (code.length > MAX_UNIT_IDENTIFIER_LENGTH)
    throw new Error("رقم/رمز الوحدة يتجاوز 80 حرفًا.");

  const { unit, property } = unitAndProperty(state.entities, unitId);
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== property.portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة؛ لم يُحفظ أي تعديل.");
  }

  const comparable = comparableIdentifier(code);
  const duplicate = state.entities.units.find(
    row =>
      row.id !== unit.id &&
      row.propertyId === property.id &&
      comparableIdentifier(identifierFrom(row)) === comparable
  );
  if (duplicate)
    throw new Error("رقم/رمز الوحدة مكرر ضمن العقار نفسه؛ لم يُحفظ أي تعديل.");

  const nextUnit: DemoEntity = {
    ...unit,
    meta: { ...unit.meta, unitCode: code, code },
  };
  const units = state.entities.units.map(row =>
    row.id === unit.id ? nextUnit : row
  );
  const audit: AuditEvent = {
    id: newId(),
    at: new Date().toISOString(),
    title: `تعديل رقم/رمز الوحدة: ${
      unitDisplayReference({ ...state.entities, units }, unit.id) ||
      property.title
    }`,
    detail:
      "تغيّر رمز العرض المحلي للوحدة فقط؛ لا تتغير العقود أو المستندات التاريخية الصادرة.",
  };
  const nextState: PrototypeState = {
    ...state,
    entities: { ...state.entities, units },
    audit: [audit, ...state.audit].slice(0, AUDIT_LIMIT),
  };

  // Validate the entire candidate before returning it. This catches malformed
  // metadata, invalid financial fields, and snapshot limits without exposing a
  // partial update to the caller.
  const validation = validatePrototypeState(nextState);
  if (!validation.success)
    throw new Error(`لم يُعتمد تعديل رمز الوحدة: ${validation.message}`);

  return { state: nextState, result: nextUnit };
}
