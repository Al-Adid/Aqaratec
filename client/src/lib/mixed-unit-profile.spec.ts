import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  assetTypeFromMeta,
  assetTypeLabel,
  makePropertyDraft,
  makePropertyProfile,
  parsePropertyProfile,
  serializePropertyProfile,
} from "./property-fields";
import { createRentalProperty } from "./prototype-rental";
import {
  createDescribedUnit,
  makeUnitProfile,
  parseUnitProfile,
  propertyPurposeLabel,
  resolveUnitPurpose,
  unitProfileFormValues,
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

function memoryState(
  overrides: Partial<PrototypeState["settings"]> = {}
): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    row({ id: "portfolio-a", title: "المحفظة أ", propertyId: "" }),
    row({
      id: "portfolio-b",
      title: "المحفظة ب",
      portfolioId: "portfolio-b",
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
      ...overrides,
    },
  };
}

function mixedProperty() {
  return createRentalProperty(memoryState(), {
    title: "مجمع فلل مختلط",
    portfolioId: "portfolio-a",
    assetType: "مجمع فيلل",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "2",
    propertyPurpose: "mixed",
    monthlyRent: "١٬٢٠٠٫٥٠",
    salePrice: "٩٠٠٬٠٠٠",
    contents: "أربع غرف وصالة وحمام",
  });
}

describe("mixed property and unit profile domain", () => {
  it("stores a mixed villa complex with independent rent, sale, and contents values", () => {
    const created = mixedProperty();
    const profile = parsePropertyProfile(created.property.meta.propertyProfile);

    expect(created.property.meta.assetType).toBe("villa_complex");
    expect(created.property.meta.usageType).toBe("residential");
    expect(created.property.meta.unitMonthlyRentMinor).toBe(120_050);
    expect(profile).toMatchObject({
      purpose: "mixed",
      salePriceMinor: 90_000_000,
      contents: "أربع غرف وصالة وحمام",
    });
    expect(created.state.entities.units).toHaveLength(2);
    expect(
      parseUnitProfile(created.state.entities.units[0].meta.unitProfile)
    ).toEqual({
      v: 1,
    });
    expect(assetTypeFromMeta({ type: "مجمع فلل قديم" })).toBe("villa_complex");
    expect(assetTypeFromMeta({ type: "مجمع فيلات" })).toBe("villa_complex");
    expect(assetTypeLabel("مجمع فلل")).toBe("مجمع فلل");
    expect(propertyPurposeLabel("mixed")).toBe("بيع وإيجار");
  });

  it("keeps property descriptions independent from notes and bounds compact contents", () => {
    const base = {
      title: "عقار الوصف",
      portfolioId: "portfolio-a",
      assetType: "villa",
      usageType: "residential",
      unitCount: "0",
    };
    const explicit = makePropertyDraft({
      ...base,
      notes: "ملاحظة تشغيلية",
      description: "وصف مستقل للعقار",
    });
    const legacy = makePropertyDraft({ ...base, notes: "وصف السجل القديم" });
    const blankNotes = makePropertyDraft({ ...base, notes: "" });
    const clearDescription = makePropertyDraft({ ...base, description: "" });
    const contents = "م".repeat(512);
    const profile = makePropertyProfile({ contents });

    expect(explicit.meta).toMatchObject({
      notes: "ملاحظة تشغيلية",
      description: "وصف مستقل للعقار",
    });
    expect(legacy.meta.description).toBe("وصف السجل القديم");
    expect(blankNotes.clearMetaKeys).toContain("notes");
    expect(blankNotes.clearMetaKeys).not.toContain("description");
    expect(clearDescription.clearMetaKeys).toContain("description");
    expect(parsePropertyProfile(serializePropertyProfile(profile))).toEqual(
      profile
    );
    expect(() => makePropertyProfile({ contents: "م".repeat(513) })).toThrow(
      "512"
    );
    expect(() =>
      parsePropertyProfile(JSON.stringify({ v: 1, contents: "م".repeat(513) }))
    ).toThrow();
  });

  it("keeps rent and sale unit values distinct when the explicit purpose changes", () => {
    const created = mixedProperty();
    const stub = created.state.entities.units[0];
    expect(resolveUnitPurpose(stub, created.property)).toBeUndefined();

    const rented = updateDescribedUnit(created.state, stub.id, {
      unitPurpose: "rent",
      monthlyRent: "١٬٢٠٠٫٥٠",
      salePrice: "٩٠٠٬٠٠٠",
      contents: "حديقة وموقف",
      description: "وصف الوحدة المستقل",
    });
    expect(rented.result.meta.monthlyRentMinor).toBe(120_050);
    expect(parseUnitProfile(rented.result.meta.unitProfile)).toMatchObject({
      purpose: "rent",
      salePriceMinor: 90_000_000,
      contents: "حديقة وموقف",
    });
    expect(unitProfileFormValues(rented.result)).toMatchObject({
      unitPurpose: "rent",
      salePrice: "900000",
      description: "وصف الوحدة المستقل",
    });

    const sold = updateDescribedUnit(rented.state, rented.result.id, {
      unitPurpose: "sale",
    });
    expect(sold.result.meta.monthlyRentMinor).toBe(120_050);
    expect(parseUnitProfile(sold.result.meta.unitProfile)).toMatchObject({
      purpose: "sale",
      salePriceMinor: 90_000_000,
      contents: "حديقة وموقف",
    });
    expect(resolveUnitPurpose(sold.result, created.property)).toBe("sale");

    const unspecified = updateDescribedUnit(sold.state, sold.result.id, {
      unitPurpose: "",
    });
    expect(unspecified.result.meta.monthlyRentMinor).toBe(120_050);
    expect(parseUnitProfile(unspecified.result.meta.unitProfile)).toMatchObject(
      {
        salePriceMinor: 90_000_000,
        contents: "حديقة وموقف",
      }
    );
    expect(
      resolveUnitPurpose(unspecified.result, created.property)
    ).toBeUndefined();
  });

  it("requires an explicit goal only for manually described units under mixed parents", () => {
    const created = mixedProperty();
    expect(() =>
      createDescribedUnit(created.state, created.property.id, {
        title: "وحدة بلا هدف",
      })
    ).toThrow("هدف الوحدة");

    const manual = createDescribedUnit(created.state, created.property.id, {
      title: "وحدة للبيع",
      unitPurpose: "sale",
      description: "وحدة مادية جديدة",
    });
    expect(parseUnitProfile(manual.result.meta.unitProfile).purpose).toBe(
      "sale"
    );
    expect(manual.result.meta.description).toBe("وحدة مادية جديدة");
    expect(() => makeUnitProfile({ unitPurpose: "mixed" })).toThrow(
      "هدف الوحدة"
    );
    expect(() => parseUnitProfile('{"v":1,"purpose":"mixed"}')).toThrow();
  });

  it("inherits only single-purpose parents and leaves scope and financial rows unchanged", () => {
    const rentProperty = row({
      id: "property-rent",
      propertyId: "property-rent",
      meta: {
        propertyProfile: serializePropertyProfile({ v: 1, purpose: "rent" }),
      },
    });
    const mixedParent = row({
      id: "property-mixed",
      propertyId: "property-mixed",
      meta: {
        propertyProfile: serializePropertyProfile({ v: 1, purpose: "mixed" }),
      },
    });
    const explicitSale = row({
      id: "unit-sale",
      propertyId: rentProperty.id,
      meta: { unitProfile: '{"v":1,"purpose":"sale"}' },
    });
    expect(resolveUnitPurpose(undefined, rentProperty)).toBe("rent");
    expect(resolveUnitPurpose(explicitSale, rentProperty)).toBe("sale");
    expect(resolveUnitPurpose(undefined, mixedParent)).toBeUndefined();

    const created = mixedProperty();
    const target = created.state.entities.units[0];
    const lease = row({
      id: "lease-unchanged",
      propertyId: created.property.id,
      meta: { unitId: target.id },
    });
    const receivable = row({
      id: "receivable-unchanged",
      propertyId: created.property.id,
      amountMinor: 25_000,
    });
    const before: PrototypeState = {
      ...created.state,
      entities: {
        ...created.state.entities,
        leases: [lease],
        receivables: [receivable],
      },
    };
    const changed = updateDescribedUnit(before, target.id, {
      unitPurpose: "rent",
      description: "وصف لا يغير المال",
    });
    expect(changed.state.entities.leases).toEqual([lease]);
    expect(changed.state.entities.receivables).toEqual([receivable]);
    expect(changed.result.amountMinor).toBe(target.amountMinor);

    const outOfScope: PrototypeState = {
      ...before,
      settings: { ...before.settings, portfolioId: "portfolio-b" },
    };
    const snapshot = structuredClone(outOfScope);
    expect(() =>
      updateDescribedUnit(outOfScope, target.id, { unitPurpose: "sale" })
    ).toThrow("خارج المحفظة");
    expect(outOfScope).toEqual(snapshot);
    expect(() =>
      updateDescribedUnit(
        { ...before, settings: { ...before.settings, role: "owner" } },
        target.id,
        { unitPurpose: "sale" }
      )
    ).toThrow("الموظف");
  });
});
