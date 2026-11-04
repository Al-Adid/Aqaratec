import { describe, expect, it } from "vitest";
import {
  MAX_PROPERTY_TITLE_LENGTH,
  PROPERTY_ASSET_TYPES,
  makePropertyDraft,
  parsePropertyProfile,
} from "./property-fields";
import {
  activePropertyFormValues,
  filterPropertyProfileForType,
  getPropertyFieldPolicy,
} from "./property-applicability";
import { generatedUnitTitle } from "./prototype-rental";

const allowed = {
  villa: ["residential"],
  villa_complex: ["residential"],
  building: ["residential", "commercial", "mixed"],
  apartment: ["residential"],
  land: ["residential", "commercial", "mixed"],
  shop: ["commercial"],
  office: ["commercial"],
  mixed: ["mixed"],
} as const;

function draftValues(
  assetType: (typeof PROPERTY_ASSET_TYPES)[number],
  rentalMode: "whole" | "units",
  purpose: "rent" | "sale" | "mixed"
): Record<string, string> {
  return {
    title: `${assetType}-${rentalMode}-${purpose}`,
    portfolioId: "portfolio-a",
    assetType,
    usageType: allowed[assetType][0],
    rentalMode,
    unitCount: rentalMode === "whole" ? "1" : "2",
    propertyPurpose: purpose,
    mortgageStatus: "mortgaged",
    mortgageBank: "بنك الاختبار",
    salePrice: purpose === "rent" ? "" : "1000.50",
    buildingYear: "2020",
    buildingArea: "250",
    unitComposition: "apartments",
    accommodation: JSON.stringify({
      roomLayout: "2-living",
      bedrooms: "2",
      livingRooms: "1",
      bathrooms: "2",
      kitchens: "1",
      furnishing: "furnished",
      villaArrangement: "detached",
    }),
  };
}

describe("unified property applicability", () => {
  it("covers all eight types across whole/units modes and rent/sale/mixed mortgage goals", () => {
    for (const assetType of PROPERTY_ASSET_TYPES) {
      expect(getPropertyFieldPolicy(assetType).allowedUsages).toEqual(
        allowed[assetType]
      );
      for (const rentalMode of ["whole", "units"] as const) {
        for (const purpose of ["rent", "sale", "mixed"] as const) {
          const draft = makePropertyDraft(
            draftValues(assetType, rentalMode, purpose)
          );
          const profile = parsePropertyProfile(draft.meta.propertyProfile);
          expect(draft.assetType).toBe(assetType);
          expect(draft.rentalMode).toBe(rentalMode);
          expect(draft.unitCount).toBe(rentalMode === "whole" ? 1 : 2);
          expect(profile).toMatchObject({
            purpose,
            mortgageStatus: "mortgaged",
            mortgageBank: "بنك الاختبار",
          });
          if (purpose === "sale" || purpose === "mixed") {
            expect(profile.salePriceMinor).toBe(100_050);
          } else {
            expect(profile.salePriceMinor).toBeUndefined();
          }
          if (rentalMode === "units") {
            expect(profile.accommodation).toBeUndefined();
            expect(profile.unitComposition).toBe(
              assetType === "land" ? undefined : "apartments"
            );
          }
        }
      }
    }
  });

  it("masks hidden invalid rooms before validation when switching a whole property to units", () => {
    const raw = draftValues("villa", "units", "rent");
    raw.accommodation =
      '{"roomLayout":"not-a-layout","bedrooms":"not-a-number","livingRooms":"bad"}';
    const active = activePropertyFormValues(raw);
    expect(active.accommodation).toBe("");
    expect(makePropertyDraft(raw).meta.propertyProfile).toBeDefined();
    expect(
      parsePropertyProfile(makePropertyDraft(raw).meta.propertyProfile)
        .accommodation
    ).toBeUndefined();
  });

  it("keeps office/shop common amenities while removing residential layouts and villa-only arrangement", () => {
    const raw = draftValues("shop", "whole", "rent");
    const active = activePropertyFormValues(raw);
    expect(active.accommodation).toBe(
      JSON.stringify({
        bathrooms: "2",
        kitchens: "1",
        furnishing: "furnished",
      })
    );
    const profile = parsePropertyProfile(makePropertyDraft(raw).meta.propertyProfile);
    expect(profile.accommodation).toEqual({
      bathrooms: 2,
      kitchens: 1,
      furnishing: "furnished",
    });
    expect(getPropertyFieldPolicy("office", "commercial", "whole")).toMatchObject({
      supportsRoomLayout: false,
      supportsFurnishing: true,
    });
  });

  it("filters historical facts only for display/save scope and never mutates the source profile", () => {
    const historical = {
      v: 1 as const,
      contents: "وصف حر محفوظ",
      unitComposition: "villas" as const,
      accommodation: {
        roomLayout: "2-living" as const,
        bedrooms: 2,
        livingRooms: 1,
        bathrooms: 2,
        kitchens: 1,
        furnishing: "furnished" as const,
        villaArrangement: "detached" as const,
      },
    };
    const land = filterPropertyProfileForType(
      historical,
      "land",
      "residential",
      "whole"
    );
    const shop = filterPropertyProfileForType(
      historical,
      "shop",
      "commercial",
      "whole"
    );
    const units = filterPropertyProfileForType(
      historical,
      "villa",
      "residential",
      "units"
    );

    expect(historical.accommodation?.villaArrangement).toBe("detached");
    expect(land).toEqual({ v: 1, contents: "وصف حر محفوظ" });
    expect(shop).toEqual({
      v: 1,
      contents: "وصف حر محفوظ",
      unitComposition: "villas",
      accommodation: { bathrooms: 2, kitchens: 1, furnishing: "furnished" },
    });
    expect(units).toEqual({
      v: 1,
      contents: "وصف حر محفوظ",
      unitComposition: "villas",
    });
  });

  it("uses one exact 256-character title bound and never truncates a property title for generated units", () => {
    const base = draftValues("villa", "units", "rent");
    for (const length of [255, 256]) {
      expect(
        makePropertyDraft({ ...base, title: "ع".repeat(length) }).title
      ).toHaveLength(length);
    }
    expect(() =>
      makePropertyDraft({ ...base, title: "ع".repeat(257) })
    ).toThrow(`اسم العقار يتجاوز ${MAX_PROPERTY_TITLE_LENGTH}`);
    expect(generatedUnitTitle(1, "ع".repeat(256))).toBe("وحدة 1");
    expect(generatedUnitTitle(1, "فيلا اللؤلؤة")).toBe(
      "وحدة 1 · فيلا اللؤلؤة"
    );
  });

  it("excludes operation controls from the 32 raw field limit while retaining the persisted limit", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 28 }, (_, index) => [`field${index}`, "x"])
    );
    const result = makePropertyDraft({
      ...fields,
      title: "عقار",
      portfolioId: "portfolio-a",
      assetType: "villa",
      usageType: "residential",
      _expectedEntityToken: "edit-preview",
      _changedFields: '["title"]',
      requestId: "request-1",
    });
    expect(result.title).toBe("عقار");
  });
});
