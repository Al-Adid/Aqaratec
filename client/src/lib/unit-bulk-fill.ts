import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { entityEditToken } from "./prototype-edit-concurrency";
import {
  parsePropertyProfile,
  resolveUnitPurpose,
  updateDescribedUnit,
} from "./unit-profile";

/**
 * These are the only descriptive fields that can be copied to an explicit set
 * of physical units. Identity, status, links, counters, media and financial
 * records are intentionally absent.
 */
export const UNIT_BULK_FILL_FIELDS = [
  "unitArea",
  "electricityNumber",
  "waterNumber",
  "planNumber",
  "propertyNumber",
  "description",
  "category",
  "villaArrangement",
  "roomLayout",
  "apartmentLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "contents",
  "unitPurpose",
  "monthlyRent",
  "salePrice",
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const;

export type UnitBulkFillField = (typeof UNIT_BULK_FILL_FIELDS)[number];
export type UnitBulkFillValues = Partial<Record<UnitBulkFillField, string>>;

export type UnitBulkFillRequest = {
  /** The one parent property that owns every selected physical unit. */
  propertyId: string;
  /** Each target occurs once and is capped at the property workflow limit. */
  unitIds: readonly string[];
  /** Only keys in appliedKeys are passed to the underlying domain transition. */
  values: UnitBulkFillValues;
  /** Explicit fields to apply; omission always means no change. */
  appliedKeys: readonly UnitBulkFillField[];
  /** A blank value only clears when the same field appears here. */
  clearKeys?: readonly UnitBulkFillField[];
  /** Opening tokens, one required optimistic-concurrency token per unit. */
  expectedTokens: Readonly<Record<string, string | undefined>>;
};

export type UnitBulkFillUpdate = {
  unitId: string;
  before: DemoEntity;
  after: DemoEntity;
  /** Actual submitted fields, suitable for a wizard acknowledgement patch. */
  appliedKeys: readonly UnitBulkFillField[];
};

export type UnitBulkFillTransition = {
  state: PrototypeState;
  result: {
    propertyId: string;
    updates: UnitBulkFillUpdate[];
  };
};

const MAX_BULK_UNITS = 50;
const DECLARATION_KEYS = [
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const satisfies readonly UnitBulkFillField[];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFieldSet(
  values: readonly UnitBulkFillField[],
  label: string
): Set<UnitBulkFillField> {
  const result = new Set<UnitBulkFillField>();
  for (const key of values) {
    if (!UNIT_BULK_FILL_FIELDS.includes(key))
      throw new Error(`${label} يتضمن حقل تعبئة جماعية غير مسموح.`);
    if (result.has(key)) throw new Error(`${label} يتضمن الحقل نفسه أكثر من مرة.`);
    result.add(key);
  }
  return result;
}

function selectedValues(
  request: UnitBulkFillRequest,
  applied: Set<UnitBulkFillField>,
  clears: Set<UnitBulkFillField>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of applied) {
    const value = request.values[key];
    if (typeof value !== "string")
      throw new Error(`أدخل قيمة حقل «${key}» أو اختر مسحه صراحةً.`);
    if (!text(value) && !clears.has(key))
      throw new Error(
        "القيمة الفارغة لا تُمسح تلقائيًا؛ فعّل خيار «مسح القيمة الحالية» للحقل المقصود."
      );
    if (clears.has(key) && text(value))
      throw new Error("لا تجمع بين قيمة جديدة وخيار مسح القيمة الحالية للحقل نفسه.");
    values[key] = value;
  }
  return values;
}

/** A declaration is compound in the existing domain and cannot be half-written. */
function validateDeclarationSelection(
  values: Record<string, string>,
  applied: Set<UnitBulkFillField>
): void {
  const selected = DECLARATION_KEYS.filter(key => applied.has(key));
  if (!selected.length) return;
  if (!applied.has("tenancyStatus"))
    throw new Error(
      "لتعديل تواريخ أو إيجار إعلان التأجير، اختر حالة التأجير معها صراحةً."
    );

  const status = text(values.tenancyStatus);
  if (!status) return; // Explicit status clear deletes the one declaration.
  if (status === "rented") {
    if (
      !applied.has("tenancyStartDate") ||
      !applied.has("tenancyEndDate")
    ) {
      throw new Error(
        "حالة «مؤجر» تحتاج اختيار تاريخ البداية وتاريخ النهاية في التعبئة الجماعية."
      );
    }
    return;
  }
  if (status === "vacant") {
    if (
      applied.has("tenancyStartDate") ||
      applied.has("tenancyEndDate") ||
      applied.has("tenancyMonthlyRent")
    ) {
      throw new Error(
        "حالة «غير مؤجر» لا تستقبل تاريخًا أو إيجارًا حاليًا في الإعلان."
      );
    }
    return;
  }
  throw new Error("حالة التأجير غير صالحة.");
}

function submittedPurpose(
  unit: DemoEntity,
  property: DemoEntity,
  values: Record<string, string>,
  applied: Set<UnitBulkFillField>
): "rent" | "sale" | undefined {
  if (applied.has("unitPurpose")) {
    const requested = text(values.unitPurpose);
    if (requested === "rent" || requested === "sale") return requested;
    if (requested) throw new Error("هدف الوحدة غير صالح.");
  }
  return resolveUnitPurpose(unit, property);
}

/**
 * Uses updateDescribedUnit repeatedly only against a local working state. If a
 * late target is invalid, stale, inaccessible, locked, or metadata-saturated,
 * its throw prevents this function from returning any state for a commit.
 */
export function updateDescribedUnitsBulk(
  state: PrototypeState,
  request: UnitBulkFillRequest
): UnitBulkFillTransition {
  const unitIds = [...request.unitIds];
  if (!unitIds.length) throw new Error("اختر وحدة واحدة على الأقل للتعبئة الجماعية.");
  if (unitIds.length > MAX_BULK_UNITS)
    throw new Error("يمكن تعبئة 50 وحدة كحد أقصى في العملية الواحدة.");
  if (new Set(unitIds).size !== unitIds.length)
    throw new Error("لا يمكن اختيار الوحدة نفسها أكثر من مرة في التعبئة الجماعية.");

  const applied = asFieldSet(request.appliedKeys, "قائمة الحقول المحددة");
  if (!applied.size)
    throw new Error("اختر حقلًا واحدًا على الأقل لتطبيقه على الوحدات.");
  const clears = asFieldSet(request.clearKeys ?? [], "قائمة الحقول المراد مسحها");
  for (const key of clears) {
    if (!applied.has(key))
      throw new Error("لا يمكن مسح حقل لم يُحدد للتعبئة الجماعية.");
  }

  const values = selectedValues(request, applied, clears);
  validateDeclarationSelection(values, applied);

  if (state.settings.role !== "operator")
    throw new Error("الإجراء متاح لمعاينة الموظف فقط");
  const property = state.entities.properties.find(
    row => row.id === request.propertyId
  );
  if (!property) throw new Error("العقار المحدد غير موجود.");
  if (!property.portfolioId)
    throw new Error("العقار لا يتبع محفظة صالحة؛ لم يُحفظ أي تعديل.");
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== property.portfolioId
  ) {
    throw new Error("العقار المحدد خارج المحفظة المختارة؛ لم يُحفظ أي تعديل.");
  }

  const parentPurpose = parsePropertyProfile(property.meta.propertyProfile).purpose;
  let working = state;
  const updates: UnitBulkFillUpdate[] = [];

  for (const unitId of unitIds) {
    const before = working.entities.units.find(row => row.id === unitId);
    if (!before)
      throw new Error("إحدى الوحدات المحددة لم تعد متاحة؛ لم يُحفظ أي تعديل.");
    if (
      before.propertyId !== property.id ||
      before.portfolioId !== property.portfolioId
    ) {
      throw new Error(
        "كل الوحدات يجب أن تتبع العقار والمحفظة نفسيهما؛ لم يُحفظ أي تعديل."
      );
    }
    if (before.meta.wholeProperty === true) {
      throw new Error(
        "هدف تأجير العقار بالكامل الداخلي لا يقبل تعبئة جماعية للوحدات."
      );
    }

    const expectedToken = request.expectedTokens[unitId];
    if (!expectedToken || typeof expectedToken !== "string")
      throw new Error(
        "تعذر التحقق من نسخة إحدى الوحدات المفتوحة؛ أعد فتح مرحلة إكمال الوحدات قبل التعبئة الجماعية."
      );
    if (expectedToken !== entityEditToken(before)) {
      throw new Error(
        "تعارض تعديل: تغيّر سجل ضمن المجموعة. حدّث البيانات ثم أعد المحاولة؛ لم يُحفظ أي تعديل."
      );
    }

    const effectivePurpose = submittedPurpose(before, property, values, applied);
    if (parentPurpose === "mixed" && !effectivePurpose)
      throw new Error("حدّد هدف الوحدة للبيع أو الإيجار قبل الحفظ.");
    if (
      applied.has("monthlyRent") &&
      text(values.monthlyRent) &&
      effectivePurpose === "sale"
    ) {
      throw new Error(
        "لا يمكن وضع إيجار شهري لوحدة هدفها الفعّال بيع؛ اختر هدف «إيجار» صراحةً ضمن الحقول المحددة أولًا."
      );
    }
    if (
      applied.has("salePrice") &&
      text(values.salePrice) &&
      effectivePurpose === "rent"
    ) {
      throw new Error(
        "لا يمكن وضع سعر بيع لوحدة هدفها الفعّال إيجار؛ اختر هدف «بيع» صراحةً ضمن الحقول المحددة أولًا."
      );
    }

    const outcome = updateDescribedUnit(working, unitId, {
      ...values,
      _expectedEntityToken: expectedToken,
    });
    working = outcome.state;
    updates.push({
      unitId,
      before,
      after: outcome.result,
      appliedKeys: [...applied],
    });
  }

  return {
    state: working,
    result: { propertyId: property.id, updates },
  };
}

/** A preview is the same pure guarded transition and never commits its state. */
export const previewDescribedUnitsBulk = updateDescribedUnitsBulk;
