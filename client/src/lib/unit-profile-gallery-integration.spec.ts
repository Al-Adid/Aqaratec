import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { assertPrototypeState } from "@shared/prototype-validation";
import { createDemoState } from "./demo-data";
import { createRentalProperty } from "./prototype-rental";
import {
  parsePropertyProfile,
  parseUnitProfile,
  createDescribedUnit,
  updateDescribedUnit,
} from "./unit-profile";
import {
  parsePhotoGallery,
  saveTargetPhotoGallery,
  assignUnitPhotoGroup,
} from "./property-photo-gallery";
import { storePropertyMedia, loadPropertyMedia } from "./property-media";

function fixture() {
  return createRentalProperty(createDemoState(), {
    requestId: crypto.randomUUID(),
    title: "عمارة اختبار وصف الوحدات",
    portfolioId: "family",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "9",
    inputMethod: "يدوي",
    propertyNumber: "00042",
    electricityNumber: "000900",
    propertyProfile: JSON.stringify({
      v: 1,
      purpose: "sale",
      mortgageStatus: "mortgaged",
    }),
  });
}
const image = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], name, {
    type: "image/png",
  });

describe("property profile, unit descriptions and shared photo galleries", () => {
  it("retains a sale/mortgaged property and nine serials; edits a unit without posting finance or changing old contracts", () => {
    const initial = fixture();
    expect(parsePropertyProfile(initial.property.meta.propertyProfile)).toEqual(
      { v: 1, purpose: "sale", mortgageStatus: "mortgaged" }
    );
    const units = initial.state.entities.units.filter(
      u => u.propertyId === initial.property.id
    );
    expect(units).toHaveLength(9);
    expect(units.map(u => u.meta.unitCode)).toEqual(
      Array.from({ length: 9 }, (_, i) => `U-${String(i + 1).padStart(2, "0")}`)
    );
    const current = updateDescribedUnit(initial.state, units[0].id, {
      title: "شقة غرفتين وصالة",
      unitCode: "U-01",
      category: "apartment",
      apartmentLayout: "2-living",
      bedrooms: "2",
      livingRooms: "1",
      bathrooms: "2",
      kitchens: "1",
      furnishing: "furnished",
      planNumber: "٠٠١-م",
      waterNumber: "000125",
      electricityNumber: "000678",
      contents: "شرفة وموقف سيارة",
    });
    const profile = parseUnitProfile(current.result.meta.unitProfile);
    expect(profile).toMatchObject({
      category: "apartment",
      apartmentLayout: "2-living",
      bedrooms: 2,
      livingRooms: 1,
      furnishing: "furnished",
      planNumber: "٠٠١-م",
      waterNumber: "000125",
    });
    expect(current.result.meta.electricityNumber).toBe("000678");
    expect(current.result.meta.electricityNumberSource).toBe("unit");
    const tenth = createDescribedUnit(current.state, initial.property.id, {
      requestId: "new-unit-profile-10",
      title: "فيلا منفصلة",
      category: "villa",
      villaArrangement: "detached",
      bedrooms: "4",
      furnishing: "unfurnished",
    });
    expect(tenth.result.meta.unitCode).toBe("U-10");
    expect(
      parseUnitProfile(tenth.result.meta.unitProfile).villaArrangement
    ).toBe("detached");
    for (const kind of [
      "leases",
      "receivables",
      "collections",
      "expenses",
    ] as const)
      expect(tenth.state.entities[kind]).toEqual(initial.state.entities[kind]);
    expect(() => assertPrototypeState(tenth.state)).not.toThrow();
  });

  it("assigns shared image references to only the chosen units and preserves their individual pictures and the shared blob", async () => {
    const initial = fixture();
    const units = initial.state.entities.units.filter(
      u => u.propertyId === initial.property.id
    );
    const scope = "guest:unit-gallery-integration";
    const individual = await storePropertyMedia(
      scope,
      "photo",
      image("صورة فردية.png")
    );
    const shared = await storePropertyMedia(
      scope,
      "photo",
      image("صورة مشتركة.png")
    );
    const personal = saveTargetPhotoGallery(
      initial.state,
      "units",
      units[0].id,
      [individual.id]
    );
    const input = {
      requestId: "unit-gallery-group-qa",
      propertyId: initial.property.id,
      unitIds: [units[0].id, units[1].id],
      photoIds: [shared.id],
      title: "صور الدور الأول",
    };
    const grouped = assignUnitPhotoGroup(personal.state, input);
    const u1 = grouped.state.entities.units.find(u => u.id === units[0].id)!;
    const u2 = grouped.state.entities.units.find(u => u.id === units[1].id)!;
    expect(parsePhotoGallery(u1.meta.photoGallery).ids).toEqual(
      expect.arrayContaining([individual.id, shared.id])
    );
    expect(parsePhotoGallery(u2.meta.photoGallery).ids).toEqual([shared.id]);
    expect(
      parsePhotoGallery(
        grouped.state.entities.units.find(u => u.id === units[2].id)!.meta
          .photoGallery
      ).ids
    ).toEqual([]);
    const repeated = assignUnitPhotoGroup(grouped.state, input);
    expect(repeated.state.entities.units).toEqual(grouped.state.entities.units);
    expect(repeated.state.entities.documents.length).toBe(
      grouped.state.entities.documents.length
    );
    const removed = saveTargetPhotoGallery(grouped.state, "units", u1.id, [
      individual.id,
    ]);
    expect(
      parsePhotoGallery(
        removed.state.entities.units.find(u => u.id === u2.id)!.meta
          .photoGallery
      ).ids
    ).toEqual([shared.id]);
    expect(await loadPropertyMedia(scope, shared, "photo")).not.toBeNull();
    expect(
      await loadPropertyMedia(
        "guest:another-gallery-workspace",
        shared,
        "photo"
      )
    ).toBeNull();
    expect(removed.state.entities.receivables).toEqual(
      initial.state.entities.receivables
    );
    expect(removed.state.entities.collections).toEqual(
      initial.state.entities.collections
    );
    expect(() => assertPrototypeState(removed.state)).not.toThrow();
    expect(JSON.stringify(removed.state)).not.toContain("data:image");
  });

  it("rejects read-only and cross-property group attachment without partial changes", () => {
    const initial = fixture();
    const units = initial.state.entities.units.filter(
      u => u.propertyId === initial.property.id
    );
    const otherUnit = initial.state.entities.units.find(
      u => u.propertyId !== initial.property.id
    )!;
    const input = {
      requestId: "unit-group-forbidden",
      propertyId: initial.property.id,
      unitIds: [units[0].id, otherUnit.id],
      photoIds: [crypto.randomUUID()],
    };
    expect(() => assignUnitPhotoGroup(initial.state, input)).toThrow();
    expect(() =>
      updateDescribedUnit(
        {
          ...initial.state,
          settings: { ...initial.state.settings, role: "owner" },
        },
        units[0].id,
        { category: "villa" }
      )
    ).toThrow();
    expect(
      initial.state.entities.units.find(u => u.id === units[0].id)!.meta
        .photoGallery
    ).toBeUndefined();
  });
});

it("assigns a shared gallery atomically to all fifty units of one property", () => {
  const initial = createRentalProperty(createDemoState(), {
    requestId: "fifty-photo-unit-property",
    title: "عقار اختبار خمسين وحدة",
    portfolioId: "family",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount: "50",
    inputMethod: "يدوي",
  });
  const units = initial.state.entities.units.filter(
    unit => unit.propertyId === initial.property.id
  );
  expect(units).toHaveLength(50);
  const photoId = crypto.randomUUID();
  const grouped = assignUnitPhotoGroup(initial.state, {
    requestId: "fifty-photo-group",
    propertyId: initial.property.id,
    unitIds: units.map(unit => unit.id),
    photoIds: [photoId],
  });
  expect(
    grouped.state.entities.units
      .filter(unit => unit.propertyId === initial.property.id)
      .every(unit =>
        parsePhotoGallery(unit.meta.photoGallery).ids.includes(photoId)
      )
  ).toBe(true);
  expect(grouped.state.entities.documents.length).toBe(
    initial.state.entities.documents.length + 1
  );
  expect(grouped.state.entities.receivables).toEqual(
    initial.state.entities.receivables
  );
  expect(() => assertPrototypeState(grouped.state)).not.toThrow();
});
