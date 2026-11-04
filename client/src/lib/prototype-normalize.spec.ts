import { describe, expect, it } from "vitest";
import { createDemoState } from "./demo-data";
import {
  isExplicitGlobalTemplateRecord,
  normalizePrototype,
  resolvePortfolio,
} from "./prototype-normalize";

describe("shared prototype compatibility", () => {
  it("expresses ownership in basis points for one portfolio", () => {
    const state = normalizePrototype(createDemoState());
    const family = state.entities.owners.filter(
      row => row.portfolioId === "family"
    );
    expect(family.reduce((n, row) => n + Number(row.meta.shareBps), 0)).toBe(
      10000
    );
    expect(family.every(row => Boolean(row.meta.effectiveDate))).toBe(true);
  });

  it("does not mistake floor area for a market region", () => {
    const state = normalizePrototype(createDemoState());
    expect(
      state.entities.comparables.every(row => typeof row.meta.area === "string")
    ).toBe(true);
    expect(
      state.entities.comparables.every(row => Boolean(row.meta.evidenceType))
    ).toBe(true);
  });

  it("rejects all and unknown portfolio ids without a property relation", () => {
    const state = createDemoState();
    expect(() => resolvePortfolio(state.entities, "all")).toThrow("اختر محفظة");
    expect(() => resolvePortfolio(state.entities, "unknown", "", "family")).toThrow(
      "معرف المحفظة غير معروف"
    );
    expect(() => resolvePortfolio(state.entities, "", "")).toThrow("اختر محفظة");
  });

  it("derives scope only from a demonstrated property when one is supplied", () => {
    const state = createDemoState();
    expect(resolvePortfolio(state.entities, "all", "tower", "family")).toBe(
      "growth"
    );
    expect(() => resolvePortfolio(state.entities, "family", "missing-property")).toThrow(
      "العقار المرتبط غير موجود"
    );
  });

  it("allows an unscoped record only when it is explicitly a shared lease template", () => {
    const state = createDemoState();
    const template = {
      id: "template",
      title: "قالب عام",
      subtitle: "",
      portfolioId: "",
      propertyId: "",
      status: "محفوظ",
      date: "2026-10-24",
      amountMinor: 0,
      currency: "QAR" as const,
      meta: { recordType: "lease-template" },
    };
    expect(isExplicitGlobalTemplateRecord("documents", template)).toBe(true);
    expect(
      resolvePortfolio(state.entities, "", "", "all", {
        allowExplicitGlobalTemplate: true,
      })
    ).toBe("");
    expect(
      isExplicitGlobalTemplateRecord("documents", {
        ...template,
        meta: {},
      })
    ).toBe(false);
  });
});
