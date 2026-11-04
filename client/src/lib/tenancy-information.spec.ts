import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  type DemoEntity,
  type EntityMap,
} from "@shared/prototype";
import {
  getTenancyFormValues,
  getTenancySummary,
  makeTenancyDeclaration,
} from "./tenancy-information";

function entity(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return {
    id: "row",
    title: "سجل اختبار",
    subtitle: "",
    portfolioId: "portfolio-a",
    propertyId: "property-a",
    status: "نشط",
    date: "2026-01-01",
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...overrides,
  };
}

function entities(): EntityMap {
  const result = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as EntityMap;
  result.properties = [
    entity({
      id: "property-a",
      title: "العقار أ",
      meta: { rentalMode: "units" },
    }),
  ];
  result.units = [
    entity({ id: "unit-a", title: "وحدة أ" }),
    entity({ id: "unit-b", title: "وحدة ب" }),
    entity({
      id: "whole-a",
      title: "هدف العقار كاملاً",
      meta: { wholeProperty: true },
    }),
  ];
  return result;
}

function property(rows: EntityMap): DemoEntity {
  return rows.properties[0];
}

function unit(rows: EntityMap, id = "unit-a"): DemoEntity {
  return rows.units.find(row => row.id === id)!;
}

function lease(overrides: Partial<DemoEntity> = {}): DemoEntity {
  return entity({
    id: "lease-a",
    title: "عقد اختبار",
    status: "نافذ",
    meta: {
      lifecycleActivated: true,
      unitId: "unit-a",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
    ...overrides,
  });
}

describe("tenancy declarations", () => {
  it("serializes only valid versioned declarations and clears dates for vacant or blank status", () => {
    expect(makeTenancyDeclaration({ tenancyStatus: "" })).toBeUndefined();
    expect(
      makeTenancyDeclaration({
        tenancyStatus: "vacant",
        tenancyStartDate: "2026-01-01",
        tenancyEndDate: "2026-12-31",
      })
    ).toBe('{"v":1,"status":"vacant"}');
    expect(
      makeTenancyDeclaration({
        tenancyStatus: "rented",
        tenancyStartDate: "2026-02-01",
        tenancyEndDate: "2026-12-31",
      })
    ).toBe(
      '{"v":1,"status":"rented","startDate":"2026-02-01","endDate":"2026-12-31"}'
    );
    expect(() =>
      makeTenancyDeclaration({
        tenancyStatus: "rented",
        tenancyStartDate: "2026-02-30",
        tenancyEndDate: "2026-12-31",
      })
    ).toThrow("بداية");
    expect(() =>
      makeTenancyDeclaration({
        tenancyStatus: "rented",
        tenancyStartDate: "2026-12-31",
        tenancyEndDate: "2026-02-01",
      })
    ).toThrow("لا يمكن أن يسبق");
  });

  it("reads only valid bounded declaration JSON", () => {
    expect(
      getTenancyFormValues(
        entity({
          meta: {
            tenancyDeclaration:
              '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-12-31"}',
          },
        })
      )
    ).toEqual({
      tenancyStatus: "rented",
      tenancyStartDate: "2026-01-01",
      tenancyEndDate: "2026-12-31",
    });
    expect(
      getTenancyFormValues(
        entity({
          meta: {
            tenancyDeclaration: "{not-json}",
          },
        })
      )
    ).toEqual({
      tenancyStatus: "",
      tenancyStartDate: "",
      tenancyEndDate: "",
    });
    expect(
      getTenancyFormValues(
        entity({
          meta: { tenancyDeclaration: "x".repeat(1025) },
        })
      )
    ).toEqual({
      tenancyStatus: "",
      tenancyStartDate: "",
      tenancyEndDate: "",
    });
  });
});

describe("getTenancySummary", () => {
  it("uses current, future, and ended activated leases as the authoritative display source", () => {
    const currentRows = entities();
    currentRows.leases = [lease()];
    expect(
      getTenancySummary(currentRows, property(currentRows), unit(currentRows), "2026-06-01")
    ).toMatchObject({
      status: "rented",
      source: "lease",
      locked: true,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      leaseId: "lease-a",
    });

    const futureRows = entities();
    futureRows.leases = [
      lease({
        meta: {
          lifecycleActivated: true,
          unitId: "unit-a",
          startDate: "2026-11-01",
          endDate: "2027-01-31",
        },
      }),
    ];
    expect(
      getTenancySummary(futureRows, property(futureRows), unit(futureRows), "2026-06-01")
    ).toMatchObject({ status: "reserved", source: "lease", locked: true });

    const endedRows = entities();
    endedRows.leases = [
      lease({
        status: "منتهٍ",
        meta: {
          unitId: "unit-a",
          startDate: "2025-01-01",
          endDate: "2025-12-31",
        },
      }),
    ];
    const ended = getTenancySummary(
      endedRows,
      property(endedRows),
      unit(endedRows),
      "2026-06-01"
    );
    expect(ended).toMatchObject({
      status: "vacant",
      source: "lease",
      locked: true,
      endDate: "2025-12-31",
    });
    expect(ended.label).toContain("عقد مسجل");
  });

  it("uses lifecycle termination as the effective end and never resurrects an old declaration", () => {
    const rows = entities();
    rows.units[0] = {
      ...rows.units[0],
      meta: {
        tenancyDeclaration:
          '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-12-31"}',
      },
    };
    rows.leases = [
      lease({
        meta: {
          lifecycleActivated: true,
          unitId: "unit-a",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          terminationEffectiveDate: "2026-05-01",
        },
      }),
    ];
    expect(
      getTenancySummary(rows, property(rows), unit(rows), "2026-06-01")
    ).toMatchObject({
      status: "vacant",
      source: "lease",
      locked: true,
      endDate: "2026-04-30",
    });
  });

  it("does not treat drafts or wrong-scope records as lease authority", () => {
    const rows = entities();
    rows.units[0] = {
      ...rows.units[0],
      meta: {
        tenancyDeclaration:
          '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-12-31"}',
      },
    };
    rows.leases = [
      lease({ status: "مسودة", meta: { unitId: "unit-a" } }),
      lease({
        id: "wrong-scope",
        portfolioId: "portfolio-b",
        meta: {
          lifecycleActivated: true,
          unitId: "unit-a",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      }),
    ];
    expect(
      getTenancySummary(rows, property(rows), unit(rows), "2026-06-01")
    ).toMatchObject({ status: "rented", source: "declaration", locked: false });
  });

  it("aggregates split-unit evidence without inventing a property contract range", () => {
    const rows = entities();
    rows.properties[0] = {
      ...rows.properties[0],
      meta: {
        rentalMode: "units",
        tenancyDeclaration:
          '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-12-31"}',
      },
    };
    rows.units[0] = {
      ...rows.units[0],
      meta: {
        tenancyDeclaration:
          '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-06-30"}',
      },
    };
    rows.units[1] = {
      ...rows.units[1],
      meta: { tenancyDeclaration: '{"v":1,"status":"vacant"}' },
    };
    const summary = getTenancySummary(rows, property(rows), undefined, "2026-03-01");
    expect(summary).toMatchObject({
      status: "partial",
      source: "units",
      locked: false,
    });
    expect(summary.startDate).toBeUndefined();
    expect(summary.endDate).toBeUndefined();
  });

  it("does not inherit a parent declaration into a physical unit, but allows its canonical whole target to resolve it", () => {
    const rows = entities();
    rows.properties[0] = {
      ...rows.properties[0],
      meta: {
        rentalMode: "units",
        tenancyDeclaration:
          '{"v":1,"status":"rented","startDate":"2026-01-01","endDate":"2026-12-31"}',
      },
    };
    expect(
      getTenancySummary(rows, property(rows), unit(rows), "2026-06-01")
    ).toMatchObject({ status: "vacant", source: "none", locked: false });
    expect(
      getTenancySummary(rows, property(rows), unit(rows, "whole-a"), "2026-06-01")
    ).toMatchObject({ status: "rented", source: "declaration", locked: false });
  });

  it("recognizes a canonical whole-property lease for physical units", () => {
    const rows = entities();
    rows.leases = [
      lease({
        meta: {
          lifecycleActivated: true,
          unitId: "whole-a",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      }),
    ];
    expect(
      getTenancySummary(rows, property(rows), unit(rows), "2026-06-01")
    ).toMatchObject({ status: "rented", source: "lease", locked: true });
  });
});
