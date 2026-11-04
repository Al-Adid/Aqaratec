import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import {
  unitDisplayReference,
  updateUnitIdentifier,
} from "./prototype-unit-identifiers";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
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

function state(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  entities.portfolios = [
    entity({
      id: "portfolio-1",
      title: "المحفظة الأولى",
      portfolioId: "portfolio-1",
    }),
    entity({
      id: "portfolio-2",
      title: "المحفظة الثانية",
      portfolioId: "portfolio-2",
    }),
  ];
  entities.properties = [
    entity({
      id: "property-1",
      title: "فيلا الصخامة 1",
      propertyId: "property-1",
      meta: { propertyNumber: "V-001" },
    }),
  ];
  entities.units = [
    entity({
      id: "unit-1",
      title: "وحدة 1",
      propertyId: "property-1",
      meta: { unitCode: "U-01", code: "U-01" },
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

describe("unitDisplayReference", () => {
  it("uses the human property number and local code, never storage IDs", () => {
    const initial = state();

    expect(unitDisplayReference(initial.entities, "unit-1")).toBe(
      "V-001 · U-01"
    );
    initial.entities.properties[0].meta = {};
    initial.entities.units[0].meta = { code: "0007" };
    expect(unitDisplayReference(initial.entities, "unit-1")).toBe(
      "فيلا الصخامة 1 · 0007"
    );
    expect(unitDisplayReference(initial.entities, "missing-unit")).toBe("");
  });
});

describe("updateUnitIdentifier", () => {
  it("trims and preserves leading zeros while replacing only local code metadata", () => {
    const initial = state();
    const property = initial.entities.properties[0];
    const lease = entity({
      id: "lease-issued",
      title: "عقد صادر",
      propertyId: "property-1",
      meta: { unitId: "unit-1", documentId: "issued-doc" },
    });
    const document = entity({
      id: "issued-doc",
      title: "وثيقة صادرة",
      propertyId: "property-1",
      meta: { snapshotUnitCode: "U-01" },
    });
    initial.entities.leases = [lease];
    initial.entities.documents = [document];

    const updated = updateUnitIdentifier(initial, "unit-1", "  0007  ");

    expect(updated.result.meta).toMatchObject({
      unitCode: "0007",
      code: "0007",
    });
    expect(updated.state.entities.units[0].id).toBe("unit-1");
    expect(updated.state.entities.units[0].propertyId).toBe("property-1");
    expect(updated.state.entities.properties[0]).toBe(property);
    expect(updated.state.entities.leases).toBe(initial.entities.leases);
    expect(updated.state.entities.documents).toBe(initial.entities.documents);
    expect(updated.state.entities.leases[0]).toBe(lease);
    expect(updated.state.entities.documents[0]).toBe(document);
    expect(updated.state.audit).toHaveLength(1);
    expect(updated.state.audit[0].detail).toContain(
      "العقود أو المستندات التاريخية"
    );
    expect(initial.entities.units[0].meta.unitCode).toBe("U-01");
  });

  it("rejects blank, overlong, and normalized duplicate identifiers without mutation", () => {
    const initial = state();
    initial.entities.units.push(
      entity({
        id: "unit-2",
        title: "وحدة 2",
        propertyId: "property-1",
        meta: { unitCode: "شقة-۱۲" },
      })
    );
    const before = structuredClone(initial);

    expect(() => updateUnitIdentifier(initial, "unit-1", "   ")).toThrow(
      "مطلوب"
    );
    expect(() =>
      updateUnitIdentifier(initial, "unit-1", "x".repeat(81))
    ).toThrow("80");
    expect(() => updateUnitIdentifier(initial, "unit-1", "شقة-١٢")).toThrow(
      "مكرر"
    );
    expect(initial).toEqual(before);
  });

  it("enforces operator and selected-portfolio scope before any update", () => {
    const initial = state();
    const before = structuredClone(initial);

    initial.settings.role = "owner";
    expect(() => updateUnitIdentifier(initial, "unit-1", "U-02")).toThrow(
      "الموظف"
    );
    expect(initial.entities.units[0].meta.unitCode).toBe(
      before.entities.units[0].meta.unitCode
    );

    initial.settings.role = "operator";
    initial.settings.portfolioId = "portfolio-2";
    expect(() => updateUnitIdentifier(initial, "unit-1", "U-02")).toThrow(
      "خارج المحفظة"
    );
    expect(initial.entities.units[0].meta.unitCode).toBe(
      before.entities.units[0].meta.unitCode
    );
  });

  it("fails atomically for missing relations, malformed metadata, or an invalid financial row", () => {
    const missingRelation = state();
    missingRelation.entities.properties = [];
    const missingBefore = structuredClone(missingRelation);
    expect(() =>
      updateUnitIdentifier(missingRelation, "unit-1", "U-02")
    ).toThrow("العقار المرتبط");
    expect(missingRelation).toEqual(missingBefore);

    const metadataOverflow = state();
    metadataOverflow.entities.units[0].meta = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        index === 0 ? "unitCode" : `field${index}`,
        index === 0 ? "U-01" : "x",
      ])
    );
    const metadataBefore = structuredClone(metadataOverflow);
    expect(() =>
      updateUnitIdentifier(metadataOverflow, "unit-1", "U-02")
    ).toThrow("لم يُعتمد");
    expect(metadataOverflow).toEqual(metadataBefore);

    const financialInvalid = state();
    financialInvalid.entities.receivables = [
      entity({ id: "bad-receivable", amountMinor: -1 }),
    ];
    const financialBefore = structuredClone(financialInvalid);
    expect(() =>
      updateUnitIdentifier(financialInvalid, "unit-1", "U-02")
    ).toThrow("لم يُعتمد");
    expect(financialInvalid).toEqual(financialBefore);
  });
});
