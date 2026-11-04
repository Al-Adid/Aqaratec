import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  createRentalProperty,
  electricityNumberForRentalTarget,
} from "./prototype-rental";
import {
  createDescribedUnit,
  makeUnitProfile,
  mortgageStatusLabel,
  parsePropertyProfile,
  parseUnitProfile,
  propertyPurposeLabel,
  serializePropertyProfile,
  unitProfileFormValues,
  unitProfileSummary,
  updateDescribedUnit,
} from "./unit-profile";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-1",
    propertyId: "",
    status: "نشط",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function emptyState(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-1", title: "المحفظة الأولى", propertyId: "" }),
    row({
      id: "portfolio-2",
      title: "المحفظة الثانية",
      portfolioId: "portfolio-2",
      propertyId: "",
    }),
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

function splitProperty(unitCount = "2") {
  return createRentalProperty(emptyState(), {
    title: "عمارة الوصف",
    portfolioId: "portfolio-1",
    assetType: "building",
    usageType: "residential",
    rentalMode: "units",
    unitCount,
    inputMethod: "يدوي",
    electricityNumber: "000900",
  });
}

describe("property and unit profile values", () => {
  it("keeps missing historical values unspecified and labels direct enums", () => {
    expect(parsePropertyProfile(undefined)).toEqual({ v: 1 });
    expect(parseUnitProfile(undefined)).toEqual({ v: 1 });
    expect(propertyPurposeLabel("rent")).toBe("إيجار");
    expect(propertyPurposeLabel("sale")).toBe("بيع");
    expect(mortgageStatusLabel("free")).toBe("حر");
    expect(mortgageStatusLabel("mortgaged")).toBe("مرهون");
    expect(propertyPurposeLabel("unknown")).toBe("غير مسجل");
    expect(
      parsePropertyProfile(
        serializePropertyProfile({
          v: 1,
          purpose: "sale",
          mortgageStatus: "mortgaged",
        })
      )
    ).toEqual({ v: 1, purpose: "sale", mortgageStatus: "mortgaged" });
    expect(() => parsePropertyProfile('{"v":1,"loan":"x"}')).toThrow();
  });

  it("validates villa, studio, standard apartment, and Arabic custom distributions", () => {
    expect(
      makeUnitProfile({
        category: "villa",
        villaArrangement: "attached",
        bedrooms: "4",
        bathrooms: "٣",
        kitchens: "1",
        planNumber: "0001-A",
        waterNumber: "00002",
      })
    ).toMatchObject({
      category: "villa",
      villaArrangement: "attached",
      bedrooms: 4,
      bathrooms: 3,
      planNumber: "0001-A",
      waterNumber: "00002",
    });
    expect(
      makeUnitProfile({
        category: "apartment",
        apartmentLayout: "studio",
        bedrooms: "٠",
        livingRooms: "0",
      })
    ).toMatchObject({ apartmentLayout: "studio", bedrooms: 0, livingRooms: 0 });
    expect(
      makeUnitProfile({
        category: "apartment",
        apartmentLayout: "custom",
        bedrooms: "١",
        livingRooms: "٢",
        bathrooms: "٣",
        kitchens: "١",
      })
    ).toMatchObject({ bedrooms: 1, livingRooms: 2, bathrooms: 3, kitchens: 1 });
    expect(() =>
      makeUnitProfile({
        category: "apartment",
        apartmentLayout: "2-living",
        bedrooms: "2",
        livingRooms: "0",
      })
    ).toThrow("لا يطابق");
    expect(
      makeUnitProfile({
        category: "apartment",
        apartmentLayout: "custom",
        bedrooms: "1",
        livingRooms: "1",
      })
    ).toMatchObject({ apartmentLayout: "custom", bedrooms: 1, livingRooms: 1 });
    expect(() =>
      makeUnitProfile({
        category: "villa",
        villaArrangement: "detached",
        bedrooms: "21",
      })
    ).toThrow("0 و20");
  });

  it("preserves zeros in plan and water text and rejects a unit-profile JSON overflow", () => {
    const profile = makeUnitProfile({
      category: "villa",
      villaArrangement: "detached",
      planNumber: "٠٠١-م",
      waterNumber: "000125",
    });
    const parsed = parseUnitProfile(JSON.stringify(profile));
    expect(parsed.planNumber).toBe("٠٠١-م");
    expect(parsed.waterNumber).toBe("000125");
    expect(() =>
      parseUnitProfile(JSON.stringify({ v: 1, contents: "و".repeat(1025) }))
    ).toThrow();
  });
});

describe("described unit transitions", () => {
  it("creates U-10 after nine initial targets, stores one unitProfile field, and retries idempotently", () => {
    const property = splitProperty("9");
    const input = {
      requestId: "described-u10",
      title: "فيلا منفصلة",
      category: "villa",
      villaArrangement: "detached",
      bedrooms: "4",
      furnishing: "unfurnished",
    };
    const created = createDescribedUnit(
      property.state,
      property.property.id,
      input
    );
    expect(created.result.meta.unitCode).toBe("U-10");
    expect(
      Object.keys(created.result.meta).filter(key => key === "unitProfile")
    ).toHaveLength(1);
    expect(parseUnitProfile(created.result.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "detached",
      bedrooms: 4,
    });
    const retry = createDescribedUnit(
      created.state,
      property.property.id,
      input
    );
    expect(retry.state).toBe(created.state);
    expect(retry.result).toBe(created.result);
    expect(() =>
      createDescribedUnit(created.state, property.property.id, {
        ...input,
        title: "بيانات مختلفة",
      })
    ).toThrow("بيانات مختلفة");
  });

  it("updates only submitted description fields and never changes rent, status, contracts, or finance", () => {
    const base = splitProperty();
    const created = createDescribedUnit(base.state, base.property.id, {
      title: "فيلا الأصل",
      category: "villa",
      villaArrangement: "attached",
      bedrooms: "3",
      electricityNumber: "000678",
      monthlyRent: "1200.50",
      planNumber: "0001",
    });
    const unit = created.result;
    const lease = row({
      id: "lease-1",
      propertyId: base.property.id,
      meta: { unitId: unit.id },
    });
    const receivable = row({
      id: "receivable-1",
      propertyId: base.property.id,
      amountMinor: 12300,
    });
    const before: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        leases: [lease],
        receivables: [receivable],
      },
    };
    const changed = updateDescribedUnit(before, unit.id, {
      title: "فيلا الوصف المحدث",
      contents: "حديقة وموقف",
      waterNumber: "000125",
    });

    expect(changed.result.title).toBe("فيلا الوصف المحدث");
    expect(changed.result.status).toBe(unit.status);
    expect(changed.result.amountMinor).toBe(unit.amountMinor);
    expect(changed.result.meta.monthlyRentMinor).toBe(120_050);
    expect(changed.result.meta.electricityNumber).toBe("000678");
    expect(parseUnitProfile(changed.result.meta.unitProfile)).toMatchObject({
      category: "villa",
      villaArrangement: "attached",
      planNumber: "0001",
      waterNumber: "000125",
      contents: "حديقة وموقف",
    });
    expect(changed.state.entities.leases).toEqual([lease]);
    expect(changed.state.entities.receivables).toEqual([receivable]);
    expect(unitProfileSummary(changed.result)).toContain("فيلا متلاصقة");
  });

  it("honors optional clears: a blank meter restores inheritance and blank rent removes only its override", () => {
    const base = splitProperty();
    const created = createDescribedUnit(base.state, base.property.id, {
      title: "وحدة عداد خاص",
      category: "villa",
      villaArrangement: "detached",
      electricityNumber: "000678",
      monthlyRent: "900",
    });
    const clearedMeter = updateDescribedUnit(created.state, created.result.id, {
      electricityNumber: "",
    });
    expect(clearedMeter.result.meta.electricityNumber).toBeUndefined();
    expect(clearedMeter.result.meta.electricityNumberSource).toBe("property");
    expect(
      electricityNumberForRentalTarget(
        clearedMeter.state.entities,
        base.property.id,
        created.result.id
      )
    ).toBe("000900");
    const clearedRent = updateDescribedUnit(
      clearedMeter.state,
      created.result.id,
      {
        monthlyRent: "",
      }
    );
    expect(clearedRent.result.meta.monthlyRentMinor).toBeUndefined();
    expect(
      clearedRent.state.entities.properties[0].meta.electricityNumber
    ).toBe("000900");
  });

  it("returns form values without exposing inherited meters and retains local display codes", () => {
    const base = splitProperty();
    const created = createDescribedUnit(base.state, base.property.id, {
      title: "فيلا نموذجية",
      unitCode: "00009",
      category: "villa",
      villaArrangement: "detached",
      bedrooms: "4",
      planNumber: "0001",
    });
    expect(unitProfileFormValues(created.result)).toMatchObject({
      title: "فيلا نموذجية",
      unitCode: "00009",
      electricityNumber: "",
      bedrooms: "4",
      planNumber: "0001",
    });
  });

  it("rejects readonly, out-of-scope, broken relations, duplicate codes, a second whole target, and metadata overflow atomically", () => {
    const base = splitProperty();
    const unit = base.state.entities.units[0];
    expect(() =>
      updateDescribedUnit(
        { ...base.state, settings: { ...base.state.settings, role: "owner" } },
        unit.id,
        { contents: "ممنوع" }
      )
    ).toThrow("الموظف");
    expect(() =>
      createDescribedUnit(
        {
          ...base.state,
          settings: { ...base.state.settings, portfolioId: "portfolio-2" },
        },
        base.property.id,
        { title: "خارج النطاق" }
      )
    ).toThrow("خارج المحفظة");

    const broken = structuredClone(base.state);
    broken.entities.units[0].portfolioId = "portfolio-2";
    expect(() =>
      updateDescribedUnit(broken, broken.entities.units[0].id, {})
    ).toThrow("لا يتبعان المحفظة نفسها");
    expect(() =>
      createDescribedUnit(base.state, base.property.id, {
        title: "رمز مكرر",
        unitCode: String(unit.meta.unitCode),
      })
    ).toThrow("مكرر");

    const whole = createRentalProperty(emptyState(), {
      title: "عقار كامل",
      portfolioId: "portfolio-1",
      assetType: "villa",
      usageType: "residential",
      rentalMode: "whole",
      unitCount: "1",
      inputMethod: "يدوي",
    });
    expect(() =>
      createDescribedUnit(whole.state, whole.property.id, { title: "هدف ثانٍ" })
    ).toThrow("هدف تأجير واحد");

    const saturated = structuredClone(base.state);
    saturated.entities.units[0].meta = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        index === 0 ? "unitCode" : `historical${index}`,
        index === 0 ? "U-01" : "قيمة",
      ])
    );
    const before = structuredClone(saturated);
    expect(() =>
      updateDescribedUnit(saturated, saturated.entities.units[0].id, {
        contents: "يوصف الآن",
      })
    ).toThrow("سعة 32");
    expect(saturated).toEqual(before);
  });
});
