import type { DemoEntity, PrototypeState } from "./prototype";

export type PropertyPurpose = "rent" | "sale" | "mixed";
export type UnitPurpose = "rent" | "sale";
export type PropertyMortgageStatus = "free" | "mortgaged";
export type PropertyUnitComposition = "apartments" | "villas" | "coded_units";
export type ApartmentLayout =
  | "studio"
  | "1-living"
  | "2-living"
  | "3-living"
  | "4-living"
  | "5-living"
  | "custom";
export type VillaArrangement = "attached" | "detached";
export type FurnishingStatus = "furnished" | "unfurnished";
/**
 * Optional, category-independent physical accommodation facts. It deliberately
 * contains neither pricing, identifiers, nor a category; those remain on their
 * respective profile fields.
 */
export interface AccommodationProfile {
  roomLayout?: ApartmentLayout;
  bedrooms?: number;
  livingRooms?: number;
  bathrooms?: number;
  kitchens?: number;
  furnishing?: FurnishingStatus;
  villaArrangement?: VillaArrangement;
}
export interface PropertyProfile {
  v: 1;
  purpose?: PropertyPurpose;
  mortgageStatus?: PropertyMortgageStatus;
  /** The lender for an active mortgage; separate from a collection account bank. */
  mortgageBank?: string;
  /** Optional requested sale price in exact QAR minor units. */
  salePriceMinor?: number;
  /** Optional descriptive contents or layout text, stored with the property profile. */
  contents?: string;
  /** Optional explicit unit-composition choice; never inferred for legacy rows. */
  unitComposition?: PropertyUnitComposition;
  /** Optional physical accommodation facts, independent of composition or text. */
  accommodation?: AccommodationProfile;
}
export type UnitCategory = "villa" | "apartment" | "shop" | "office" | "other";
export interface UnitProfile {
  v: 1;
  /** Optional explicit purpose. A single-purpose parent may be inherited at read time. */
  purpose?: UnitPurpose;
  category?: UnitCategory;
  villaArrangement?: VillaArrangement;
  /** Universal physical layout; it does not imply that this unit is an apartment. */
  roomLayout?: ApartmentLayout;
  /** Legacy apartment-only compatibility field, retained for existing records. */
  apartmentLayout?: ApartmentLayout;
  bedrooms?: number;
  livingRooms?: number;
  bathrooms?: number;
  kitchens?: number;
  furnishing?: FurnishingStatus;
  contents?: string;
  /** Optional unit-specific property number; when absent, the current parent applies. */
  propertyNumber?: string;
  planNumber?: string;
  waterNumber?: string;
  /** Optional requested unit sale price in exact QAR minor units. */
  salePriceMinor?: number;
  /** Optional physical unit area in square metres; never inferred from its parent. */
  areaM2?: number;
}
export type UnitProfileInput = Record<string, string>;
export type UnitProfileTransition = {
  state: PrototypeState;
  result: DemoEntity;
};
