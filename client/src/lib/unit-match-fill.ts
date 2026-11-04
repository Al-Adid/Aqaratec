import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { entityEditToken } from "./prototype-edit-concurrency";
import {
  type UnitBulkFillField,
  type UnitBulkFillUpdate,
  updateDescribedUnitsBulk,
} from "./unit-bulk-fill";
import {
  resolveUnitPurpose,
  unitProfileFormValues,
  unitProfileFromEntity,
  updateDescribedUnit,
} from "./unit-profile";
import { getTenancySummary } from "./tenancy-information";
import {
  parsePhotoGallery,
  saveTargetPhotoGallery,
} from "./property-photo-gallery";

export type UnitMatchRequest = {
  propertyId: string;
  sourceUnitId: string;
  sourceChanges: Record<string, string>;
  sourceToken: string;
  unitIds: readonly string[];
  expectedTokens: Readonly<Record<string, string | undefined>>;
  /** Current-source references verified as readable in the caller's local scope. */
  photoIds?: readonly string[];
};

export type UnitMatchUpdate = UnitBulkFillUpdate & {
  matchedPhotoIds?: readonly string[];
};

type MatchTransition = {
  state: PrototypeState;
  result: { source: DemoEntity; updates: UnitMatchUpdate[] };
};

type CommonValues = {
  values: Partial<Record<UnitBulkFillField, string>>;
  appliedKeys: UnitBulkFillField[];
  category: string;
};

type InitialDeclaration = Partial<Record<UnitBulkFillField, string>>;

const MAX_MATCHED_UNITS = 50;
const DECLARATION_FIELDS = [
  "tenancyStatus",
  "tenancyStartDate",
  "tenancyEndDate",
  "tenancyMonthlyRent",
] as const satisfies readonly UnitBulkFillField[];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requirePhysicalUnit(unit: DemoEntity, message: string): void {
  if (unit.meta.wholeProperty === true) throw new Error(message);
}

/** Checks every member before starting the source transition. */
function validateRequest(
  state: PrototypeState,
  request: UnitMatchRequest
): { property: DemoEntity; source: DemoEntity; targets: DemoEntity[] } {
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

  const source = state.entities.units.find(
    row => row.id === request.sourceUnitId
  );
  if (!source)
    throw new Error("الوحدة المصدر لم تعد متاحة؛ لم يُحفظ أي تعديل.");
  if (
    source.propertyId !== property.id ||
    source.portfolioId !== property.portfolioId
  ) {
    throw new Error("الوحدة المصدر لا تتبع العقار والمحفظة نفسيهما.");
  }
  requirePhysicalUnit(
    source,
    "هدف تأجير العقار بالكامل الداخلي لا يقبل مطابقة الوحدات."
  );
  if (!text(request.sourceToken))
    throw new Error(
      "تعذر التحقق من نسخة الوحدة المصدر؛ أعد فتحها ثم حاول مرة أخرى."
    );
  if (request.sourceToken !== entityEditToken(source)) {
    throw new Error(
      "تعارض تعديل: تغيّرت الوحدة المصدر لدى مستخدم آخر. حدّث البيانات ثم أعد المحاولة؛ لم يُحفظ أي تعديل."
    );
  }

  const unitIds = [...request.unitIds];
  if (!unitIds.length)
    throw new Error("اختر وحدة مماثلة واحدة على الأقل لإضافتها.");
  if (unitIds.length > MAX_MATCHED_UNITS)
    throw new Error("يمكن مطابقة 50 وحدة كحد أقصى في العملية الواحدة.");
  if (new Set(unitIds).size !== unitIds.length)
    throw new Error("لا يمكن اختيار الوحدة نفسها أكثر من مرة للمطابقة.");
  if (unitIds.includes(source.id))
    throw new Error("لا يمكن إضافة الوحدة المصدر ضمن الوحدات المطابقة.");

  const targets = unitIds.map(unitId => {
    const target = state.entities.units.find(row => row.id === unitId);
    if (!target)
      throw new Error("إحدى الوحدات المحددة لم تعد متاحة؛ لم يُحفظ أي تعديل.");
    if (
      target.propertyId !== property.id ||
      target.portfolioId !== property.portfolioId
    ) {
      throw new Error(
        "كل الوحدات يجب أن تتبع العقار والمحفظة نفسيهما؛ لم يُحفظ أي تعديل."
      );
    }
    requirePhysicalUnit(
      target,
      "هدف تأجير العقار بالكامل الداخلي لا يقبل مطابقة الوحدات."
    );

    // Presence is intentional: a token from a previous screen cannot be
    // replaced by a token calculated after the source has been edited.
    if (
      !owns(request.expectedTokens, target.id) ||
      !text(request.expectedTokens[target.id])
    ) {
      throw new Error(
        "تعذر التحقق من نسخة إحدى الوحدات المفتوحة؛ أعد فتح مرحلة المطابقة قبل الحفظ."
      );
    }
    if (request.expectedTokens[target.id] !== entityEditToken(target)) {
      throw new Error(
        "تعارض تعديل: تغيّر سجل ضمن المجموعة. حدّث البيانات ثم أعد المحاولة؛ لم يُحفظ أي تعديل."
      );
    }
    return target;
  });

  return { property, source, targets };
}

function addNonblank(
  common: CommonValues,
  key: UnitBulkFillField,
  value: unknown
): void {
  if (!text(value) || common.appliedKeys.includes(key)) return;
  common.values[key] = value as string;
  common.appliedKeys.push(key);
}

/**
 * Reads only copy-safe values from the canonical result of the source update.
 * Identity, scope, floor, all identifiers/meters and hidden metadata never
 * enter this allowlist. Photo references are handled separately below.
 */
function commonValues(source: DemoEntity, property: DemoEntity): CommonValues {
  const form = unitProfileFormValues(source);
  const profile = unitProfileFromEntity(source);
  const common: CommonValues = { values: {}, appliedKeys: [], category: "" };

  common.category = text(form.category);
  addNonblank(common, "category", form.category);
  if (profile.category === "villa")
    addNonblank(common, "villaArrangement", form.villaArrangement);

  // roomLayout is universal, while apartmentLayout is the compatibility field
  // expected by legacy apartment profiles. Both are supplied when canonical.
  addNonblank(common, "roomLayout", form.roomLayout);
  addNonblank(common, "apartmentLayout", form.apartmentLayout);
  for (const key of [
    "bedrooms",
    "livingRooms",
    "bathrooms",
    "kitchens",
  ] as const)
    addNonblank(common, key, form[key]); // "0" remains a real submitted count.

  for (const key of [
    "furnishing",
    "contents",
    "description",
    "unitArea",
  ] as const)
    addNonblank(common, key, form[key]);

  const purpose = resolveUnitPurpose(source, property);
  if (purpose) addNonblank(common, "unitPurpose", purpose);

  // A source with no resolvable purpose can carry both independent asking
  // values. Otherwise only the active purpose's price is a common value.
  if (!purpose || purpose === "rent")
    addNonblank(common, "monthlyRent", form.monthlyRent);
  if (!purpose || purpose === "sale")
    addNonblank(common, "salePrice", form.salePrice);

  return common;
}

/**
 * Category is a relational profile field. We only clear a target's incompatible
 * subtype when a known source category makes that clear explicit; no other blank
 * source field is ever turned into a target clear.
 */
function incompatibleSubtypeClears(
  target: DemoEntity,
  category: string
): UnitBulkFillField[] {
  if (!category) return [];
  const targetProfile = unitProfileFromEntity(target);
  const clearKeys: UnitBulkFillField[] = [];
  if (category !== "villa" && targetProfile.villaArrangement !== undefined)
    clearKeys.push("villaArrangement");
  if (category !== "apartment" && targetProfile.apartmentLayout !== undefined)
    clearKeys.push("apartmentLayout");
  return clearKeys;
}

/** Only a valid complete initial declaration is eligible for copying. */
function initialDeclaration(
  state: PrototypeState,
  property: DemoEntity,
  source: DemoEntity
): InitialDeclaration {
  const summary = getTenancySummary(
    state.entities,
    property,
    source,
    scenarioDate(state)
  );
  const form = unitProfileFormValues(source);
  const status = text(form.tenancyStatus);
  if (summary.locked || !status) return {};
  if (status === "vacant") return { tenancyStatus: status };
  if (
    status !== "rented" ||
    !text(form.tenancyStartDate) ||
    !text(form.tenancyEndDate)
  ) {
    return {};
  }
  return {
    tenancyStatus: status,
    tenancyStartDate: form.tenancyStartDate,
    tenancyEndDate: form.tenancyEndDate,
    ...(text(form.tenancyMonthlyRent)
      ? { tenancyMonthlyRent: form.tenancyMonthlyRent }
      : {}),
  };
}

function targetAllowsInitialDeclaration(
  state: PrototypeState,
  property: DemoEntity,
  target: DemoEntity
): boolean {
  return !getTenancySummary(
    state.entities,
    property,
    target,
    scenarioDate(state)
  ).locked;
}

function addDeclaration(
  values: Partial<Record<UnitBulkFillField, string>>,
  appliedKeys: UnitBulkFillField[],
  declaration: InitialDeclaration
): void {
  for (const key of DECLARATION_FIELDS) {
    const value = declaration[key];
    if (!text(value) || appliedKeys.includes(key)) continue;
    values[key] = value;
    appliedKeys.push(key);
  }
}

/**
 * Saves the currently edited source first, then applies its canonical copy-safe
 * common values to explicit sibling targets against the same local state. It is
 * a single pure transition: a failure returns no state for a durable commit.
 */
export function updateMatchedUnits(
  state: PrototypeState,
  request: UnitMatchRequest
): MatchTransition {
  const {
    property,
    source: openingSource,
    targets,
  } = validateRequest(state, request);

  const photoIds = parsePhotoGallery(
    JSON.stringify({ v: 1, ids: request.photoIds ?? [] })
  ).ids;
  if (photoIds.length) {
    const sourceIds = parsePhotoGallery(openingSource.meta.photoGallery).ids;
    if (photoIds.some(id => !sourceIds.includes(id)))
      throw new Error(
        "صورة مطابقة لا تتبع معرض الوحدة المصدر؛ أعد فتح المطابقة."
      );
    for (const target of targets) {
      const currentIds = parsePhotoGallery(target.meta.photoGallery).ids;
      if (new Set([...currentIds, ...photoIds]).size > 20)
        throw new Error(
          "صور إحدى الوحدات المختارة ستتجاوز حد 20 صورة؛ لم يُحفظ أي تعديل."
        );
    }
  }

  const sourceTransition = updateDescribedUnit(state, openingSource.id, {
    ...request.sourceChanges,
    _expectedEntityToken: request.sourceToken,
  });
  let working = sourceTransition.state;
  const source = sourceTransition.result;
  const common = commonValues(source, property);
  const declaration = initialDeclaration(working, property, source);
  const updates: UnitMatchUpdate[] = [];

  for (const selectedTarget of targets) {
    const target = working.entities.units.find(
      row => row.id === selectedTarget.id
    );
    if (!target)
      throw new Error("إحدى الوحدات المحددة لم تعد متاحة؛ لم يُحفظ أي تعديل.");

    const values = { ...common.values };
    const appliedKeys = [...common.appliedKeys];
    const clearKeys = incompatibleSubtypeClears(target, common.category);
    for (const key of clearKeys) {
      values[key] = "";
      if (!appliedKeys.includes(key)) appliedKeys.push(key);
    }

    if (
      Object.keys(declaration).length &&
      targetAllowsInitialDeclaration(working, property, target)
    ) {
      addDeclaration(values, appliedKeys, declaration);
    }

    // A locked target can intentionally have no applicable declaration. It is
    // skipped only when there is no other common field to apply.
    if (!appliedKeys.length && !photoIds.length) continue;
    let update: UnitMatchUpdate;
    if (appliedKeys.length) {
      const transition = updateDescribedUnitsBulk(working, {
        propertyId: property.id,
        unitIds: [target.id],
        values,
        appliedKeys,
        ...(clearKeys.length ? { clearKeys } : {}),
        expectedTokens: { [target.id]: request.expectedTokens[target.id] },
      });
      working = transition.state;
      update = transition.result.updates[0]!;
    } else {
      update = {
        unitId: target.id,
        before: target,
        after: target,
        appliedKeys: [],
      };
    }
    if (photoIds.length) {
      const currentIds = parsePhotoGallery(update.after.meta.photoGallery).ids;
      const transition = saveTargetPhotoGallery(working, "units", target.id, [
        ...new Set([...currentIds, ...photoIds]),
      ]);
      working = transition.state;
      update = {
        ...update,
        after: transition.result,
        matchedPhotoIds: photoIds,
      };
    }
    updates.push(update);
  }

  if (!updates.length) {
    throw new Error(
      "لا توجد بيانات مشتركة مكتملة لنسخها إلى الوحدات المختارة؛ أكمل وصف الوحدة المصدر أولًا."
    );
  }

  return { state: working, result: { source, updates } };
}

/** A preview follows the same guarded, pure transition and is never committed here. */
export const previewMatchedUnits = updateMatchedUnits;
