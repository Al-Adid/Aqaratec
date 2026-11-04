import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  accommodationFormValues,
  accommodationSummary,
  makeAccommodationProfile,
  parseAccommodationProfile,
  ROOM_LAYOUT_OPTIONS,
  roomLayoutLabel,
} from "./room-layout";
import {
  makePropertyProfile,
  parsePropertyProfile,
  serializePropertyProfile,
} from "./property-fields";
import { createRentalProperty, updateRentalProperty } from "./prototype-rental";
import {
  makeUnitProfile,
  parseUnitProfile,
  unitProfileFormValues,
  unitProfileSummary,
  updateDescribedUnit,
} from "./unit-profile";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "",
    status: "نشط",
    date: "2026-10-26",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function state(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-a", title: "المحفظة أ", propertyId: "" }),
  ];
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "all",
      period: "all",
      language: "ar",
    },
  };
}

function wholePropertyValues(
  purpose: "rent" | "sale" | "mixed",
  accommodation: Record<string, string>
): Record<string, string> {
  return {
    title: `عقار كامل ${purpose}`,
    portfolioId: "portfolio-a",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "whole",
    unitCount: "1",
    propertyPurpose: purpose,
    salePrice: purpose === "rent" ? "" : "2500000.50",
    contents: "وصف عقار محفوظ مستقل عن توزيع الغرف",
    accommodation: JSON.stringify(accommodation),
  };
}

describe("pure room-layout accommodation contract", () => {
  it("uses shared layout labels, returns every form key, and never fabricates omitted facts", () => {
    expect(ROOM_LAYOUT_OPTIONS.map(option => option.value)).toEqual([
      "studio",
      "1-living",
      "2-living",
      "3-living",
      "4-living",
      "5-living",
      "custom",
    ]);
    expect(roomLayoutLabel("2-living")).toBe("غرفتان وصالة");
    expect(roomLayoutLabel("unknown")).toBe("غير محدد");
    expect(accommodationFormValues()).toEqual({
      roomLayout: "",
      bedrooms: "",
      livingRooms: "",
      bathrooms: "",
      kitchens: "",
      furnishing: "",
      villaArrangement: "",
    });
    expect(
      accommodationSummary({ bathrooms: 2, furnishing: "furnished" })
    ).toBe("2 حمام · مفروش");
  });

  it("accepts an unspecified layout with facts, but requires matching explicit counts for selected layouts", () => {
    expect(
      makeAccommodationProfile({
        bedrooms: "٤",
        bathrooms: "2",
        furnishing: "furnished",
      })
    ).toEqual({ bedrooms: 4, bathrooms: 2, furnishing: "furnished" });
    expect(makeAccommodationProfile({})).toBeUndefined();
    expect(
      makeAccommodationProfile({
        roomLayout: "studio",
        bedrooms: "0",
        livingRooms: "0",
      })
    ).toEqual({ roomLayout: "studio", bedrooms: 0, livingRooms: 0 });
    expect(
      makeAccommodationProfile({
        roomLayout: "custom",
        bedrooms: "4",
        livingRooms: "1",
      })
    ).toEqual({ roomLayout: "custom", bedrooms: 4, livingRooms: 1 });
    expect(() => makeAccommodationProfile({ roomLayout: "custom" })).toThrow(
      "حدّد عدد الغرف"
    );
    expect(() =>
      makeAccommodationProfile({
        roomLayout: "4-living",
        bedrooms: "4",
        livingRooms: "2",
      })
    ).toThrow("لا يطابق");
    expect(() =>
      makeAccommodationProfile({
        roomLayout: "studio",
        bedrooms: "1",
        livingRooms: "0",
      })
    ).toThrow("الاستوديو");
  });

  it("rejects bad persisted count types, unknown keys, negative, decimal, and over-limit drafts", () => {
    expect(
      parseAccommodationProfile({
        roomLayout: "2-living",
        bedrooms: 2,
        livingRooms: 1,
        kitchens: 0,
      })
    ).toEqual({
      roomLayout: "2-living",
      bedrooms: 2,
      livingRooms: 1,
      kitchens: 0,
    });
    expect(() => parseAccommodationProfile({ bedrooms: "2" })).toThrow();
    expect(() => parseAccommodationProfile({ bedrooms: -1 })).toThrow();
    expect(() => parseAccommodationProfile({ unknown: true })).toThrow();
    for (const count of ["-1", "1.5", "21"]) {
      expect(() => makeAccommodationProfile({ bedrooms: count })).toThrow(
        "0 و20"
      );
    }
  });
});

describe("universal unit room layouts", () => {
  it("keeps a generic or villa room layout independent from the unit category", () => {
    const generic = makeUnitProfile({
      roomLayout: "2-living",
      bedrooms: "2",
      livingRooms: "1",
    });
    expect(generic).toEqual({
      v: 1,
      roomLayout: "2-living",
      bedrooms: 2,
      livingRooms: 1,
    });
    expect(
      makeUnitProfile({
        category: "villa",
        villaArrangement: "attached",
        roomLayout: "custom",
        bedrooms: "4",
        livingRooms: "1",
      })
    ).toMatchObject({
      category: "villa",
      villaArrangement: "attached",
      roomLayout: "custom",
      bedrooms: 4,
      livingRooms: 1,
    });
    const genericEntity = row({
      meta: { unitProfile: JSON.stringify(generic) },
    });
    expect(unitProfileFormValues(genericEntity).roomLayout).toBe("2-living");
    expect(unitProfileSummary(genericEntity)).toContain("غرفتان وصالة");
  });

  it("synchronizes selected apartment layouts but parses old apartment records without a roomLayout", () => {
    const selected = makeUnitProfile({
      category: "apartment",
      roomLayout: "studio",
      bedrooms: "0",
      livingRooms: "0",
    });
    expect(selected).toMatchObject({
      roomLayout: "studio",
      apartmentLayout: "studio",
      bedrooms: 0,
      livingRooms: 0,
    });
    expect(
      makeUnitProfile({
        category: "apartment",
        apartmentLayout: "custom",
        bedrooms: "4",
        livingRooms: "1",
      })
    ).toMatchObject({ roomLayout: "custom", apartmentLayout: "custom" });
    expect(
      parseUnitProfile(
        '{"v":1,"category":"apartment","apartmentLayout":"1-living","bedrooms":1,"livingRooms":1}'
      )
    ).toMatchObject({ apartmentLayout: "1-living" });
    expect(
      parseUnitProfile(
        '{"v":1,"category":"apartment","apartmentLayout":"1-living","bedrooms":1,"livingRooms":1}'
      )
    ).not.toHaveProperty("roomLayout");
    expect(
      parseUnitProfile(
        '{"v":1,"category":"apartment","roomLayout":"2-living","bedrooms":2,"livingRooms":1}'
      )
    ).toMatchObject({ roomLayout: "2-living", apartmentLayout: "2-living" });
    expect(() =>
      parseUnitProfile(
        '{"v":1,"category":"apartment","roomLayout":"1-living","apartmentLayout":"2-living","bedrooms":1,"livingRooms":1}'
      )
    ).toThrow();
  });
});

describe("whole-property accommodation profiles", () => {
  it("keeps the property profile as the only new room-layout source for its internal lease target", () => {
    const created = createRentalProperty(
      state(),
      wholePropertyValues("rent", {
        roomLayout: "4-living",
        bedrooms: "4",
        livingRooms: "1",
      })
    );
    const target = created.state.entities.units[0];
    expect(() =>
      updateDescribedUnit(created.state, target.id, {
        roomLayout: "custom",
        bedrooms: "4",
        livingRooms: "1",
      })
    ).toThrow("بيانات العقار");
    expect(() =>
      updateDescribedUnit(created.state, target.id, {
        unitProfile:
          '{"v":1,"roomLayout":"custom","bedrooms":4,"livingRooms":1}',
      })
    ).toThrow("بيانات العقار");

    const before = structuredClone(created.state);
    expect(() =>
      updateDescribedUnit(created.state, target.id, {
        unitProfile: JSON.stringify({
          v: 1,
          category: "apartment",
          apartmentLayout: "1-living",
          bedrooms: 1,
          livingRooms: 1,
        }),
      })
    ).toThrow("بيانات العقار");
    expect(created.state).toEqual(before);

    const legacy = updateDescribedUnit(created.state, target.id, {
      title: "هدف التأجير الداخلي",
      roomLayout: "",
      bedrooms: "4",
    });
    expect(legacy.result.title).toBe("هدف التأجير الداخلي");
    expect(parseUnitProfile(legacy.result.meta.unitProfile)).toEqual({
      v: 1,
      bedrooms: 4,
    });
    expect(
      parsePropertyProfile(
        legacy.state.entities.properties[0].meta.propertyProfile
      )
    ).toMatchObject({
      accommodation: { roomLayout: "4-living", bedrooms: 4, livingRooms: 1 },
    });
  });

  it("persists rent, sale, and mixed layouts with profile text and prices without creating finance or extra units", () => {
    const fixtures: {
      purpose: "rent" | "sale" | "mixed";
      accommodation: Record<string, string>;
    }[] = [
      {
        purpose: "sale" as const,
        accommodation: {
          roomLayout: "studio",
          bedrooms: "0",
          livingRooms: "0",
        },
      },
      {
        purpose: "rent" as const,
        accommodation: {
          roomLayout: "4-living",
          bedrooms: "4",
          livingRooms: "1",
        },
      },
      {
        purpose: "mixed" as const,
        accommodation: {
          roomLayout: "2-living",
          bedrooms: "2",
          livingRooms: "1",
          bathrooms: "2",
          kitchens: "1",
          furnishing: "furnished",
          villaArrangement: "attached",
        },
      },
    ];

    for (const fixture of fixtures) {
      const created = createRentalProperty(
        state(),
        wholePropertyValues(fixture.purpose, fixture.accommodation)
      );
      const profile = parsePropertyProfile(
        created.property.meta.propertyProfile
      );
      expect(profile).toMatchObject({
        purpose: fixture.purpose,
        contents: "وصف عقار محفوظ مستقل عن توزيع الغرف",
      });
      expect(profile.accommodation).toEqual(
        makeAccommodationProfile(fixture.accommodation)
      );
      if (fixture.purpose === "sale" || fixture.purpose === "mixed") {
        expect(profile.salePriceMinor).toBe(250_000_050);
      } else {
        expect(profile.salePriceMinor).toBeUndefined();
      }
      expect(created.state.entities.units).toHaveLength(1);
      expect(created.state.entities.units[0].meta.wholeProperty).toBe(true);
      expect(created.state.entities.leases).toEqual([]);
      expect(created.state.entities.receivables).toEqual([]);
      expect(created.state.entities.collections).toEqual([]);
      expect(created.state.entities.expenses).toEqual([]);

      const updated = updateRentalProperty(created.state, created.property.id, {
        title: `${created.property.title} بعد تعديل نصي`,
        portfolioId: "portfolio-a",
        assetType: "villa",
        usageType: "residential",
        inputMethod: "يدوي",
        rentalMode: "whole",
        unitCount: "1",
        description: "تعديل لا يرسل حقول الملف المخفية",
        _changedFields: '["description"]',
      });
      expect(
        parsePropertyProfile(updated.property.meta.propertyProfile)
      ).toEqual(profile);
      expect(updated.state.entities.units).toEqual(
        created.state.entities.units
      );
      expect(updated.state.entities.leases).toEqual([]);
      expect(updated.state.entities.receivables).toEqual([]);
      expect(updated.state.entities.collections).toEqual([]);
      expect(updated.state.entities.expenses).toEqual([]);
    }
  });

  it("accepts only a string-only accommodation JSON draft, validates persisted numbers, and remains within the profile cap", () => {
    const draft = JSON.stringify({
      roomLayout: "2-living",
      bedrooms: "2",
      livingRooms: "1",
      bathrooms: "2",
      kitchens: "1",
      furnishing: "furnished",
      villaArrangement: "attached",
    });
    const profile = makePropertyProfile({
      propertyPurpose: "mixed",
      salePrice: "1500000",
      accommodation: draft,
    });
    expect(profile.accommodation).toEqual({
      roomLayout: "2-living",
      bedrooms: 2,
      livingRooms: 1,
      bathrooms: 2,
      kitchens: 1,
      furnishing: "furnished",
      villaArrangement: "attached",
    });
    const serialized = serializePropertyProfile(profile);
    expect(serialized.length).toBeLessThanOrEqual(1024);
    expect(parsePropertyProfile(serialized)).toEqual(profile);
    expect(() =>
      makePropertyProfile({ accommodation: '{"bedrooms":2}' })
    ).toThrow("بيانات السكن");
    expect(() =>
      parsePropertyProfile(
        '{"v":1,"accommodation":{"roomLayout":"2-living","bedrooms":"2","livingRooms":1}}'
      )
    ).toThrow();
    expect(() =>
      parsePropertyProfile(
        '{"v":1,"accommodation":{"roomLayout":"studio","bedrooms":0,"livingRooms":1}}'
      )
    ).toThrow();
  });
});
