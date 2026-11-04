import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
  type PrototypeState,
} from "@shared/prototype";
import { entityEditToken } from "./prototype-edit-concurrency";
import {
  createRentalProperty,
  updateRentalProperty,
} from "./prototype-rental";
import {
  unitProfileFormValues,
  updateDescribedUnit,
} from "./unit-profile";

function row(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row-1",
    title: "سجل",
    subtitle: "",
    portfolioId: "portfolio-a",
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

function values(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    title: "فيلا الاختبار",
    portfolioId: "portfolio-a",
    assetType: "villa",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "2",
    ...overrides,
  };
}

function withReferences(created: ReturnType<typeof createRentalProperty>): PrototypeState {
  const target = created.state.entities.units[0];
  const lease = row({
    id: "lease-a",
    propertyId: created.property.id,
    meta: { unitId: target.id },
  });
  const receivable = row({
    id: "due-a",
    propertyId: created.property.id,
    amountMinor: 25_000,
    meta: { unitId: target.id, leaseId: lease.id },
  });
  return {
    ...created.state,
    entities: {
      ...created.state.entities,
      leases: [lease],
      receivables: [receivable],
    },
  };
}

describe("entity edit concurrency", () => {
  it("is deterministic across metadata insertion order and rejects stale property edits after role/scope checks", () => {
    const first = row({ meta: { b: "2", a: "1" } });
    const sameFacts = row({ meta: { a: "1", b: "2" } });
    expect(entityEditToken(first)).toBe(entityEditToken(sameFacts));

    const created = createRentalProperty(state(), values());
    const stale = entityEditToken(created.property);
    const once = updateRentalProperty(created.state, created.property.id, {
      ...values({ description: "تعديل أحدث" }),
      _changedFields: '["description"]',
      _expectedEntityToken: stale,
    });
    const before = structuredClone(once.state);
    expect(() =>
      updateRentalProperty(once.state, once.property.id, {
        ...values({ description: "محاولة قديمة" }),
        _changedFields: '["description"]',
        _expectedEntityToken: stale,
      })
    ).toThrow("تعارض تعديل");
    expect(once.state).toEqual(before);

    expect(() =>
      updateRentalProperty(
        {
          ...once.state,
          settings: { ...once.state.settings, role: "owner" },
        },
        once.property.id,
        { ...values(), _expectedEntityToken: "invalid" }
      )
    ).toThrow("الموظف");
  });

  it("rejects stale unit edits and preserves optional text floors exactly", () => {
    const created = createRentalProperty(state(), values());
    const unit = created.state.entities.units[0];
    const stale = entityEditToken(unit);
    const withFloor = updateDescribedUnit(created.state, unit.id, {
      _expectedEntityToken: stale,
      floor: "قبو-٠٠١",
    });
    expect(unitProfileFormValues(withFloor.result).floor).toBe("قبو-٠٠١");
    const before = structuredClone(withFloor.state);
    expect(() =>
      updateDescribedUnit(withFloor.state, unit.id, {
        _expectedEntityToken: stale,
        floor: "2",
      })
    ).toThrow("تعارض تعديل");
    expect(withFloor.state).toEqual(before);
  });
});

describe("non-destructive structural property guards", () => {
  it("blocks a mode change whenever targets, leases, or other references exist without modifying finance", () => {
    const created = createRentalProperty(state(), values());
    const referenced = withReferences(created);
    const before = structuredClone(referenced);
    expect(() =>
      updateRentalProperty(referenced, created.property.id, {
        ...values({ rentalMode: "whole", unitCount: "1" }),
        _changedFields: '["rentalMode"]',
      })
    ).toThrow("طريقة التأجير");
    expect(referenced).toEqual(before);
  });

  it("blocks an actually changed split count when it differs from real targets", () => {
    const created = createRentalProperty(state(), values());
    const before = structuredClone(created.state);
    expect(() =>
      updateRentalProperty(created.state, created.property.id, {
        ...values({ unitCount: "3" }),
        _changedFields: '["unitCount"]',
      })
    ).toThrow("عدد الوحدات");
    expect(created.state).toEqual(before);
  });

  it("blocks a type change that would invalidate described units or an existing lease", () => {
    const created = createRentalProperty(state(), values());
    const described = updateDescribedUnit(
      created.state,
      created.state.entities.units[0].id,
      { category: "villa", villaArrangement: "detached" }
    );
    const beforeDescriptionBlock = structuredClone(described.state);
    expect(() =>
      updateRentalProperty(described.state, created.property.id, {
        ...values({ assetType: "land", usageType: "residential" }),
        _changedFields: '["assetType"]',
      })
    ).toThrow("أوصاف الوحدات");
    expect(described.state).toEqual(beforeDescriptionBlock);

    const referenced = withReferences(created);
    const beforeLeaseBlock = structuredClone(referenced);
    expect(() =>
      updateRentalProperty(referenced, created.property.id, {
        ...values({ assetType: "land", usageType: "residential" }),
        _changedFields: '["assetType"]',
      })
    ).toThrow("عقود مرتبطة");
    expect(referenced).toEqual(beforeLeaseBlock);
  });

  it("allows a benign descriptive edit while retaining units, leases, and financial references unchanged", () => {
    const created = createRentalProperty(state(), values());
    const referenced = withReferences(created);
    const units = structuredClone(referenced.entities.units);
    const leases = structuredClone(referenced.entities.leases);
    const receivables = structuredClone(referenced.entities.receivables);
    const changed = updateRentalProperty(referenced, created.property.id, {
      ...values({ description: "وصف محايد جديد" }),
      _changedFields: '["description"]',
    });
    expect(changed.property.meta.description).toBe("وصف محايد جديد");
    expect(changed.state.entities.units).toEqual(units);
    expect(changed.state.entities.leases).toEqual(leases);
    expect(changed.state.entities.receivables).toEqual(receivables);
  });
});
