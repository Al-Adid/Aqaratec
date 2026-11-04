import type { DemoEntity } from "@shared/prototype";
import type { UnitCategory } from "@shared/unit-profile-types";
import { unitProfileFromEntity } from "./unit-profile";

export type CompositionCategory = UnitCategory | "unclassified";
export const COMPOSITION_CATEGORIES: ReadonlyArray<{
  value: CompositionCategory;
  label: string;
  unitLabel: string;
}> = [
  { value: "apartment", label: "شقق", unitLabel: "شقة" },
  { value: "villa", label: "فلل", unitLabel: "فيلا" },
  { value: "shop", label: "محلات", unitLabel: "محل" },
  { value: "office", label: "مكاتب", unitLabel: "مكتب" },
  { value: "other", label: "وحدات أخرى", unitLabel: "وحدة أخرى" },
  { value: "unclassified", label: "غير مصنفة", unitLabel: "غير مصنفة" },
];

/** Reads explicit profiles only; names and free-form contents are never a type. */
export function compositionCategory(unit: DemoEntity): CompositionCategory {
  return unitProfileFromEntity(unit).category ?? "unclassified";
}

export function compositionCategoryLabel(unit: DemoEntity): string {
  return (
    COMPOSITION_CATEGORIES.find(
      item => item.value === compositionCategory(unit)
    )?.unitLabel ?? "غير مصنفة"
  );
}

/** The caller supplies authorized rows. Independently enforce the parent binding. */
export function physicalCompositionUnits(
  property: DemoEntity,
  authorizedUnits: readonly DemoEntity[]
): DemoEntity[] {
  const seen = new Set<string>();
  return authorizedUnits.filter(unit => {
    if (
      !unit.id ||
      seen.has(unit.id) ||
      unit.propertyId !== property.id ||
      unit.portfolioId !== property.portfolioId ||
      unit.meta.wholeProperty === true
    )
      return false;
    seen.add(unit.id);
    return true;
  });
}

export function propertyUnitComposition(
  property: DemoEntity,
  authorizedUnits: readonly DemoEntity[]
) {
  const physicalUnits = physicalCompositionUnits(property, authorizedUnits);
  const groups = COMPOSITION_CATEGORIES.map(item => ({
    ...item,
    count: physicalUnits.filter(
      unit => compositionCategory(unit) === item.value
    ).length,
  }));
  return { total: physicalUnits.length, groups };
}
