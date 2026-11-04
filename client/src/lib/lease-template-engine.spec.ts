import { describe, expect, it } from "vitest";
import { prototypeStateSchema } from "../../../server/modules/prototype";
import type {
  GenerateTemplateLeaseInput,
  SaveLeaseTemplateInput,
} from "@shared/lease-template-types";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import {
  generateTemplateLease,
  getLeaseTemplateView,
  getTemplateLeaseView,
  listLeaseTemplates,
  saveLeaseTemplate,
} from "./lease-template-engine";

const CONTENT =
  "المستأجر: {{الاسم}} | العقار: {{رقم_العقار}} | الكهرباء: {{رقم_الكهرباء}} | النوع: {{نوع_العقار}}";

function templateInput(
  requestId: string,
  overrides: Partial<SaveLeaseTemplateInput> = {}
): SaveLeaseTemplateInput {
  return {
    requestId,
    name: "القالب الأساسي",
    content: CONTENT,
    fileName: "lease.txt",
    defaultRentMinor: 450_000,
    defaultTermMonths: 12,
    ...overrides,
  };
}

function generationInput(
  templateId: string,
  requestId: string,
  overrides: Partial<GenerateTemplateLeaseInput> = {}
): GenerateTemplateLeaseInput {
  return {
    requestId,
    templateId,
    propertyId: "building",
    unitId: "u-b6",
    tenantName: "مستأجر اختبار",
    propertyNumber: "B-21",
    electricityNumber: "EL-55",
    propertyType: "عمارة",
    startDate: "2026-11-01",
    ...overrides,
  };
}

function entity(
  id: string,
  title: string,
  portfolioId: string,
  propertyId: string,
  meta: DemoEntity["meta"] = {}
): DemoEntity {
  return {
    id,
    title,
    subtitle: "",
    portfolioId,
    propertyId,
    status: "نشط",
    date: "2026-10-24",
    amountMinor: 0,
    currency: "QAR",
    meta,
  };
}

function counts(state: PrototypeState) {
  return {
    tenants: state.entities.tenants.length,
    leases: state.entities.leases.length,
    receivables: state.entities.receivables.length,
    collections: state.entities.collections.length,
    documents: state.entities.documents.length,
    audit: state.audit.length,
  };
}

describe("lease template engine", () => {
  it("requires exactly the four supported tokens and respects content limits", () => {
    const state = createDemoState();
    const saved = saveLeaseTemplate(state, templateInput("save-token-1"));
    expect(
      getLeaseTemplateView(saved.state.entities, saved.template.id)
    ).toMatchObject({
      name: "القالب الأساسي",
      content: CONTENT,
      version: 1,
      defaultRentMinor: 450_000,
      defaultTermMonths: 12,
    });

    expect(() =>
      saveLeaseTemplate(
        state,
        templateInput("save-token-2", {
          content: CONTENT.replace("{{نوع_العقار}}", "{{رمز_غير_معروف}}"),
        })
      )
    ).toThrow("غير معروف");
    expect(() =>
      saveLeaseTemplate(
        state,
        templateInput("save-token-3", {
          content: "x".repeat(16_001),
        })
      )
    ).toThrow("يتجاوز");
    expect(() =>
      saveLeaseTemplate(
        state,
        templateInput("save-token-4", {
          content: "{{الاسم}} {{رقم_العقار}} {{رقم_الكهرباء}}",
        })
      )
    ).toThrow("مطلوب");
  });

  it("creates immutable versions and lists only the latest document per root", () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    const first = saveLeaseTemplate(state, templateInput("version-1"));
    const second = saveLeaseTemplate(
      first.state,
      templateInput("version-2", {
        templateId: first.template.id,
        name: "القالب المعدل",
        content: CONTENT.replace("المستأجر", "اسم المستأجر"),
      })
    );

    expect(first.template.id).not.toBe(second.template.id);
    expect(first.template.meta.version).toBe(1);
    expect(second.template.meta).toMatchObject({
      rootId: first.template.meta.rootId,
      version: 2,
    });
    expect(
      getLeaseTemplateView(second.state.entities, first.template.id).content
    ).toBe(CONTENT);
    expect(
      getLeaseTemplateView(second.state.entities, second.template.id).name
    ).toBe("القالب المعدل");
    expect(listLeaseTemplates(second.state.entities)).toEqual([
      second.template,
    ]);
  });

  it("is idempotent for saves and generated leases, and snapshots render only once", () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    const saved = saveLeaseTemplate(state, templateInput("idempotent-save"));
    const savedRetry = saveLeaseTemplate(
      saved.state,
      templateInput("idempotent-save")
    );
    expect(savedRetry.state).toBe(saved.state);
    expect(savedRetry.template.id).toBe(saved.template.id);
    expect(() =>
      saveLeaseTemplate(
        saved.state,
        templateInput("idempotent-save", { name: "مختلف" })
      )
    ).toThrow("بيانات مختلفة");

    const input = generationInput(saved.template.id, "idempotent-generate", {
      tenantName: "{{رقم_العقار}}",
    });
    const generated = generateTemplateLease(saved.state, input);
    expect(generated.state.entities.tenants).toHaveLength(
      saved.state.entities.tenants.length + 1
    );
    expect(generated.state.entities.leases).toHaveLength(
      saved.state.entities.leases.length + 1
    );
    expect(
      getTemplateLeaseView(generated.state.entities, generated.lease.id).content
    ).toContain("المستأجر: {{رقم_العقار}} | العقار: B-21");

    const retry = generateTemplateLease(generated.state, input);
    expect(retry.state).toBe(generated.state);
    expect(retry.lease.id).toBe(generated.lease.id);
    expect(retry.document.id).toBe(generated.document.id);
    expect(() =>
      generateTemplateLease(generated.state, {
        ...input,
        tenantName: "مستأجر مختلف",
      })
    ).toThrow("بيانات مختلفة");

    const newerTemplate = saveLeaseTemplate(
      generated.state,
      templateInput("after-snapshot", {
        templateId: saved.template.id,
        content: CONTENT.replace("العقار", "رقم العقار"),
      })
    );
    expect(newerTemplate.template.meta.version).toBe(2);
    expect(
      getTemplateLeaseView(newerTemplate.state.entities, generated.lease.id)
        .content
    ).toContain("المستأجر: {{رقم_العقار}} | العقار: B-21");
  });

  it("rejects readonly, cross-scope, and invalid relationship requests without side effects", () => {
    const readonly = createDemoState();
    readonly.settings.role = "owner";
    const beforeReadonly = counts(readonly);
    expect(() =>
      saveLeaseTemplate(readonly, templateInput("readonly"))
    ).toThrow("الموظف");
    expect(counts(readonly)).toEqual(beforeReadonly);

    const state = createDemoState();
    state.settings.portfolioId = "family";
    const saved = saveLeaseTemplate(
      state,
      templateInput("relationship-template")
    );
    const before = counts(saved.state);
    expect(() =>
      generateTemplateLease(
        saved.state,
        generationInput(saved.template.id, "wrong-unit", { unitId: "u-t3" })
      )
    ).toThrow("الوحدة غير موجودة");
    expect(counts(saved.state)).toEqual(before);

    expect(() =>
      generateTemplateLease(
        saved.state,
        generationInput(saved.template.id, "wrong-scope", {
          propertyId: "tower",
          unitId: "u-t3",
          propertyType: "شقق",
        })
      )
    ).toThrow("خارج المحفظة");
    expect(counts(saved.state)).toEqual(before);
  });

  it("uses the internal whole-property target, split targets, and a neutral legacy property draft", () => {
    const state = createDemoState();
    state.settings.portfolioId = "all";
    state.entities.properties.push(
      entity("whole-p", "فيلا كاملة", "family", "whole-p", {
        assetType: "villa",
        type: "فيلا",
        rentalMode: "whole",
      }),
      entity("split-p", "مبنى مقسم", "family", "split-p", {
        assetType: "building",
        type: "عمارة",
        rentalMode: "units",
      }),
      entity("legacy-p", "عقار تاريخي", "family", "legacy-p", {
        assetType: "villa",
        type: "فيلا",
      })
    );
    state.entities.units.push(
      entity("whole-unit", "العقار بالكامل", "family", "whole-p", {
        wholeProperty: true,
      }),
      entity("split-unit", "شقة مقسمة", "family", "split-p")
    );

    const saved = saveLeaseTemplate(
      state,
      templateInput("rental-mode-template", {
        defaultRentMinor: 0,
        defaultTermMonths: 0,
      })
    );
    const whole = generateTemplateLease(
      saved.state,
      generationInput(saved.template.id, "whole-request", {
        propertyId: "whole-p",
        unitId: "",
        propertyType: "فيلا",
      })
    );
    expect(whole.lease.meta).toMatchObject({
      unitId: "whole-unit",
      rentalMode: "whole",
      registrationStatus: "غير متحقق",
      signedStatus: "مسودة غير موقعة",
    });
    expect(whole.lease.meta.endDate).toBeUndefined();

    const split = generateTemplateLease(
      whole.state,
      generationInput(saved.template.id, "split-request", {
        propertyId: "split-p",
        unitId: "split-unit",
        propertyType: "عمارة",
      })
    );
    expect(split.lease.meta).toMatchObject({
      unitId: "split-unit",
      rentalMode: "units",
    });
    expect(() =>
      generateTemplateLease(
        split.state,
        generationInput(saved.template.id, "split-missing-unit", {
          propertyId: "split-p",
          unitId: "",
          propertyType: "عمارة",
        })
      )
    ).toThrow("وحدة صالحة");

    const beforeLegacy = counts(split.state);
    const legacy = generateTemplateLease(
      split.state,
      generationInput(saved.template.id, "legacy-request", {
        propertyId: "legacy-p",
        unitId: "",
        propertyType: "فيلا",
      })
    );
    expect(legacy.lease.amountMinor).toBe(0);
    expect(legacy.lease.meta).toMatchObject({
      unitId: "",
      rentalMode: "property",
    });
    expect(legacy.state.entities.receivables).toHaveLength(
      beforeLegacy.receivables
    );
    expect(legacy.state.entities.collections).toHaveLength(
      beforeLegacy.collections
    );
  });

  it("produces a prototype-schema-compatible state without false financial records", () => {
    const state = createDemoState();
    state.settings.portfolioId = "family";
    const before = counts(state);
    const saved = saveLeaseTemplate(state, templateInput("schema-template"));
    const generated = generateTemplateLease(
      saved.state,
      generationInput(saved.template.id, "schema-generate")
    );

    expect(prototypeStateSchema.safeParse(generated.state).success).toBe(true);
    expect(generated.lease.meta).toMatchObject({
      tenantId: generated.state.entities.tenants.at(-1)?.id,
      tenantName: "مستأجر اختبار",
      tenant: "مستأجر اختبار",
      templateId: saved.template.id,
      templateVersion: 1,
      snapshotDocumentId: generated.document.id,
      rentMinor: 450_000,
      rentSource: "template-default",
      startDate: "2026-11-01",
      endDate: "2027-10-31",
    });
    expect(generated.state.entities.receivables).toHaveLength(
      before.receivables
    );
    expect(generated.state.entities.collections).toHaveLength(
      before.collections
    );
    expect(generated.state.entities.units).toHaveLength(
      state.entities.units.length
    );
    expect(
      getTemplateLeaseView(generated.state.entities, generated.lease.id)
    ).toMatchObject({
      document: generated.document,
      rentalMode: "units",
      unitTitle: "شقة M-06",
    });
  });
});
