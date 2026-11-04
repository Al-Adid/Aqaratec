import { scenarioDate } from "@shared/prototype-clock";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import {
  assetTypeFromMeta,
  assetTypeLabel,
  parsePropertyProfile,
  rentalModeFromMeta,
} from "./property-fields";
import { getTenancySummary } from "./tenancy-information";
import { parseUnitProfile, resolveUnitPurpose } from "./unit-profile";

export type SaleMarketingUnit = {
  id: string;
  title: string;
  unitCode: string;
  categoryLabel: string;
  tenancyLabel: string;
  salePriceMinor?: number;
  areaM2?: number;
};

export type SaleMarketingGroup = {
  propertyId: string;
  portfolioId: string;
  propertyTitle: string;
  propertyNumber: string;
  propertyType: string;
  location: string;
  propertyPurpose?: "sale" | "mixed" | "rent";
  rentalMode: "whole" | "units" | "legacy";
  tenancyLabel: string;
  salePriceMinor?: number;
  units: SaleMarketingUnit[];
};

const CATEGORY_LABELS = {
  villa: "فيلا",
  apartment: "شقة",
  shop: "محل",
  office: "مكتب",
  other: "وحدة أخرى",
} as const;

const UNKNOWN_VALUE_LABEL = "غير مسجل";
const TENANCY_FALLBACK_LABEL = "تعذر تحديد حالة التأجير";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function readablePropertyProfile(property: DemoEntity) {
  try {
    return parsePropertyProfile(property.meta.propertyProfile);
  } catch {
    return undefined;
  }
}

function propertyRentalMode(
  property: DemoEntity
): SaleMarketingGroup["rentalMode"] {
  return rentalModeFromMeta(property.meta) ?? "legacy";
}

function propertyType(property: DemoEntity): string {
  const assetType = assetTypeFromMeta(property.meta);
  return assetType
    ? assetTypeLabel(assetType)
    : text(property.meta.propertyType) ||
        text(property.meta.type) ||
        UNKNOWN_VALUE_LABEL;
}

function propertyLocation(property: DemoEntity): string {
  return (
    text(property.meta.location) ||
    text(property.meta.address) ||
    text(property.meta.areaName)
  );
}

function tenancyLabel(
  state: PrototypeState,
  property: DemoEntity,
  unit?: DemoEntity
): string {
  try {
    return getTenancySummary(
      state.entities,
      property,
      unit,
      scenarioDate(state)
    ).label;
  } catch {
    return TENANCY_FALLBACK_LABEL;
  }
}

function validPhysicalUnit(property: DemoEntity, unit: DemoEntity): boolean {
  return (
    Boolean(text(property.id)) &&
    Boolean(text(property.portfolioId)) &&
    unit.propertyId === property.id &&
    unit.portfolioId === property.portfolioId &&
    unit.meta.wholeProperty !== true
  );
}

/**
 * A profile parser is deliberately used before every displayed unit fact. A
 * corrupt unit profile must not gain a guessed category, purpose, area, or
 * sale price from unrelated property or financial metadata.
 */
function saleMarketingUnit(
  state: PrototypeState,
  property: DemoEntity,
  unit: DemoEntity
): SaleMarketingUnit | undefined {
  try {
    if (resolveUnitPurpose(unit, property) !== "sale") return undefined;
    const profile = parseUnitProfile(unit.meta.unitProfile);
    const category = profile.category;
    const salePriceMinor = positiveSafeInteger(profile.salePriceMinor);
    const areaM2 = profile.areaM2;

    return {
      id: unit.id,
      title: text(unit.title) || UNKNOWN_VALUE_LABEL,
      unitCode:
        text(unit.meta.unitCode) || text(unit.meta.code) || UNKNOWN_VALUE_LABEL,
      categoryLabel: category ? CATEGORY_LABELS[category] : UNKNOWN_VALUE_LABEL,
      tenancyLabel: tenancyLabel(state, property, unit),
      ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
      ...(areaM2 === undefined ? {} : { areaM2 }),
    };
  } catch {
    return undefined;
  }
}

function inPortfolioScope(
  state: PrototypeState,
  property: DemoEntity
): boolean {
  const selectedPortfolioId = state.settings.portfolioId;
  return (
    selectedPortfolioId === "all" ||
    property.portfolioId === selectedPortfolioId
  );
}

/**
 * Lists locally readable sale options only. It is intentionally independent of
 * rental vacancy/booking eligibility: a sale opportunity remains visible while
 * its tenancy is reported factually. No amountMinor, rent, cost, or calculated
 * total can become a sale asking price.
 */
export function listSaleMarketingInventory(
  state: PrototypeState
): SaleMarketingGroup[] {
  const seenPropertyIds = new Set<string>();

  return state.entities.properties.flatMap(property => {
    const propertyId = text(property.id);
    const portfolioId = text(property.portfolioId);
    if (
      !propertyId ||
      !portfolioId ||
      !inPortfolioScope(state, property) ||
      seenPropertyIds.has(propertyId)
    ) {
      return [];
    }
    seenPropertyIds.add(propertyId);

    const profile = readablePropertyProfile(property);
    const rentalMode = propertyRentalMode(property);
    const units = state.entities.units
      .filter(unit => validPhysicalUnit(property, unit))
      .flatMap(unit => {
        const saleUnit = saleMarketingUnit(state, property, unit);
        return saleUnit ? [saleUnit] : [];
      });

    // A sale parent is a property-level option even without complete units. A
    // mixed whole-property parent is likewise a real root option, while a
    // split/legacy mixed parent needs an explicitly sale-purpose physical unit.
    const parentIsSaleOption =
      profile?.purpose === "sale" ||
      (profile?.purpose === "mixed" && rentalMode === "whole");
    if (!parentIsSaleOption && !units.length) return [];

    const salePriceMinor = parentIsSaleOption
      ? positiveSafeInteger(profile?.salePriceMinor)
      : undefined;
    return [
      {
        propertyId: property.id,
        portfolioId: property.portfolioId,
        propertyTitle: text(property.title) || UNKNOWN_VALUE_LABEL,
        propertyNumber:
          text(property.meta.propertyNumber) || UNKNOWN_VALUE_LABEL,
        propertyType: propertyType(property),
        location: propertyLocation(property),
        ...(profile?.purpose ? { propertyPurpose: profile.purpose } : {}),
        rentalMode,
        tenancyLabel: tenancyLabel(state, property),
        ...(salePriceMinor === undefined ? {} : { salePriceMinor }),
        units,
      },
    ];
  });
}
