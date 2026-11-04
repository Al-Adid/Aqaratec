import type { RentalMode } from "@shared/lease-template-types";
import type { PropertyProfile } from "@shared/unit-profile-types";
import type {
  PropertyAssetType,
  PropertyUsageType,
} from "./property-fields";

/**
 * One policy for property form visibility, validation, persistence, and display.
 * It deliberately imports the field-domain types only, so property-fields can use
 * this policy at runtime without creating a runtime import cycle.
 */
export interface PropertyFieldPolicy {
  allowedUsages: readonly PropertyUsageType[];
  supportsBuildingYear: boolean;
  supportsBuildingArea: boolean;
  supportsAccommodation: boolean;
  supportsRoomLayout: boolean;
  supportsVillaArrangement: boolean;
  supportsFurnishing: boolean;
  supportsUnitComposition: boolean;
}

export interface PropertyApplicabilityScope {
  assetType?: PropertyAssetType;
  usageType?: PropertyUsageType;
  rentalMode?: RentalMode;
}

const ALL_USAGES: readonly PropertyUsageType[] = [
  "residential",
  "commercial",
  "mixed",
];

const ALLOWED_USAGES: Record<PropertyAssetType, readonly PropertyUsageType[]> = {
  villa: ["residential"],
  villa_complex: ["residential"],
  building: ["residential", "commercial", "mixed"],
  apartment: ["residential"],
  land: ["residential", "commercial", "mixed"],
  shop: ["commercial"],
  office: ["commercial"],
  mixed: ["mixed"],
};

function knownAssetType(value: unknown): value is PropertyAssetType {
  return typeof value === "string" && value in ALLOWED_USAGES;
}

function knownUsageType(value: unknown): value is PropertyUsageType {
  return ALL_USAGES.includes(value as PropertyUsageType);
}

/**
 * Returns the exact allowed uses for each of the eight supported asset types and
 * the active property fields for the supplied scope. An incomplete scope stays
 * intentionally permissive to avoid deleting facts from historical records.
 */
export function getPropertyFieldPolicy(
  assetType?: PropertyAssetType,
  usageType?: PropertyUsageType,
  rentalMode?: RentalMode
): PropertyFieldPolicy {
  const assetKnown = knownAssetType(assetType);
  const usageKnown = knownUsageType(usageType);
  const allowedUsages = assetKnown ? ALLOWED_USAGES[assetType] : ALL_USAGES;
  const activeUsage = usageKnown
    ? usageType
    : assetKnown
      ? allowedUsages[0]
      : undefined;
  // A legacy row with no persisted mode must remain display-compatible. Only an
  // explicit split mode suppresses parent accommodation facts.
  const wholeOrUnspecified = rentalMode !== "units";
  const built = !assetKnown || assetType !== "land";
  const commercialOnly = assetKnown && (assetType === "shop" || assetType === "office");
  const residentialOrMixed =
    !activeUsage || activeUsage === "residential" || activeUsage === "mixed";

  return {
    allowedUsages,
    supportsBuildingYear: built,
    supportsBuildingArea: built,
    supportsAccommodation: built && wholeOrUnspecified,
    // Shop and office still have common bathrooms/kitchens/furnishing, but no
    // residential bedrooms/living-room layout at the parent-property level.
    supportsRoomLayout:
      built && wholeOrUnspecified && !commercialOnly && residentialOrMixed,
    supportsVillaArrangement:
      wholeOrUnspecified && (!assetKnown || assetType === "villa"),
    supportsFurnishing: built && wholeOrUnspecified,
    // Composition is optional descriptive data for either a whole built asset
    // or a split one. It is not a lease-target instruction, and land has no
    // built/unit-composition descriptor. An unknown historical type stays safe.
    supportsUnitComposition: built,
  };
}

/**
 * Returns a new profile containing only facts that apply to the current property
 * scope. It never mutates a caller's profile and preserves all neutral fields.
 */
export function filterPropertyProfileForType(
  profile: PropertyProfile,
  assetType?: PropertyAssetType,
  usageType?: PropertyUsageType,
  rentalMode?: RentalMode
): PropertyProfile {
  const policy = getPropertyFieldPolicy(assetType, usageType, rentalMode);
  const next: PropertyProfile = { ...profile, v: 1 };

  if (!policy.supportsUnitComposition) delete next.unitComposition;

  const accommodation = profile.accommodation;
  if (!accommodation || !policy.supportsAccommodation) {
    delete next.accommodation;
    return next;
  }

  const activeAccommodation = { ...accommodation };
  if (!policy.supportsRoomLayout) {
    delete activeAccommodation.roomLayout;
    delete activeAccommodation.bedrooms;
    delete activeAccommodation.livingRooms;
  }
  if (!policy.supportsVillaArrangement)
    delete activeAccommodation.villaArrangement;
  if (!policy.supportsFurnishing) delete activeAccommodation.furnishing;

  if (Object.keys(activeAccommodation).length) {
    next.accommodation = activeAccommodation;
  } else {
    delete next.accommodation;
  }
  return next;
}

const ACCOMMODATION_FORM_KEYS = [
  "accommodation",
  "roomLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "villaArrangement",
] as const;

/**
 * Produces a validation/persistence copy of the active form values. The UI owns
 * its original draft, so switching mode/type can retain inactive draft values
 * locally without allowing them to fail validation or become active metadata.
 */
export function activePropertyFormValues(
  values: Record<string, string>
): Record<string, string> {
  const assetType = knownAssetType(values.assetType)
    ? values.assetType
    : undefined;
  const usageType = knownUsageType(values.usageType)
    ? values.usageType
    : undefined;
  const rentalMode =
    values.rentalMode === "whole" || values.rentalMode === "units"
      ? values.rentalMode
      : undefined;
  const policy = getPropertyFieldPolicy(assetType, usageType, rentalMode);
  const active = { ...values };

  const empty = (key: string) => {
    if (key in active) active[key] = "";
  };
  const maskAccommodationJSON = () => {
    if (!("accommodation" in active)) return;
    if (!policy.supportsAccommodation) {
      active.accommodation = "";
      return;
    }
    const raw = active.accommodation.trim();
    if (!raw) return;
    try {
      const decoded: unknown = JSON.parse(raw);
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        return;
      const nested = decoded as Record<string, unknown>;
      const masked: Record<string, unknown> = { ...nested };
      if (!policy.supportsRoomLayout) {
        delete masked.roomLayout;
        delete masked.bedrooms;
        delete masked.livingRooms;
      }
      if (!policy.supportsVillaArrangement) delete masked.villaArrangement;
      if (!policy.supportsFurnishing) delete masked.furnishing;
      active.accommodation = Object.keys(masked).length
        ? JSON.stringify(masked)
        : "";
    } catch {
      // Keep an invalid active payload for the existing validator to report.
    }
  };

  if (!policy.supportsBuildingYear) empty("buildingYear");
  if (!policy.supportsBuildingArea) empty("buildingArea");
  if (!policy.supportsUnitComposition) empty("unitComposition");

  if (!policy.supportsAccommodation) {
    ACCOMMODATION_FORM_KEYS.forEach(empty);
    return active;
  }
  if (!policy.supportsRoomLayout) {
    empty("roomLayout");
    empty("bedrooms");
    empty("livingRooms");
  }
  if (!policy.supportsVillaArrangement) empty("villaArrangement");
  if (!policy.supportsFurnishing) empty("furnishing");
  maskAccommodationJSON();
  return active;
}
