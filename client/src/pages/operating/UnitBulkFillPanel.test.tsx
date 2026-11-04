// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { createDemoState } from "@/lib/demo-data";
import type { UnitMatchRequest } from "@/lib/unit-match-fill";

vi.mock("@/lib/unit-match-fill", () => ({
  previewMatchedUnits: (
    state: PrototypeState,
    request: {
      sourceUnitId: string;
      sourceChanges: Record<string, string>;
      unitIds: string[];
    }
  ) => {
    const source = state.entities.units.find(
      unit => unit.id === request.sourceUnitId
    );
    if (!source) throw new Error("وحدة المصدر غير موجودة.");
    const description =
      request.sourceChanges.description?.trim() ??
      (typeof source.meta.description === "string"
        ? source.meta.description
        : "");
    const matchedSource = description
      ? { ...source, meta: { ...source.meta, description } }
      : source;
    return {
      state,
      result: {
        source: matchedSource,
        updates: request.unitIds.flatMap(unitId => {
          const before = state.entities.units.find(unit => unit.id === unitId);
          if (!before) return [];
          return [
            {
              before,
              appliedKeys: description ? ["description"] : [],
              after: description
                ? { ...before, meta: { ...before.meta, description } }
                : before,
            },
          ];
        }),
      },
    };
  },
}));

import { UnitBulkFillPanel } from "./UnitBulkFillPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function unit(
  id: string,
  code: string,
  propertyId = "property-a",
  meta: DemoEntity["meta"] = {}
): DemoEntity {
  return {
    id,
    title: `وحدة ${code}`,
    subtitle: "",
    portfolioId: "family",
    propertyId,
    status: "نشط",
    date: "2026-10-27",
    amountMinor: 0,
    currency: "QAR",
    meta: { code, unitCode: code, ...meta },
  };
}

function panelFixture() {
  const source = unit("source", "S-01");
  const targetA = unit("target-a", "A-01");
  const targetB = unit("target-b", "B-01");
  const internalWhole = unit("whole", "WHOLE", "property-a", {
    wholeProperty: true,
  });
  const foreign = unit("foreign", "F-01", "property-b");
  const state = createDemoState();
  state.entities.units = [source, targetA, targetB, internalWhole, foreign];
  return {
    state,
    source,
    targetA,
    targetB,
    internalWhole,
    foreign,
    units: state.entities.units,
    openedTokens: Object.fromEntries(
      state.entities.units.map(current => [current.id, `token-${current.id}`])
    ),
  };
}

function renderPanel(
  fixture: ReturnType<typeof panelFixture>,
  options: {
    onApply?: (request: UnitMatchRequest) => Promise<boolean>;
    onCancel?: () => void;
    sourceChanges?: Record<string, string>;
  } = {}
) {
  return root.render(
    <UnitBulkFillPanel
      state={fixture.state}
      propertyId="property-a"
      propertyTitle="عمارة المطابقة"
      units={fixture.units}
      sourceUnit={fixture.source}
      sourceChanges={options.sourceChanges ?? { description: "وصف موحّد" }}
      sourceToken="token-source"
      openedTokens={fixture.openedTokens}
      onApply={options.onApply ?? (async () => true)}
      onCancel={options.onCancel ?? (() => {})}
    />
  );
}

function checkboxFor(text: string): HTMLInputElement {
  const label = [...host.querySelectorAll<HTMLLabelElement>("label")].find(
    item => item.textContent?.includes(text)
  );
  expect(label).toBeTruthy();
  const input = label!.querySelector<HTMLInputElement>(
    'input[type="checkbox"]'
  );
  expect(input).toBeTruthy();
  return input!;
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    current => current.textContent?.trim() === text
  );
  expect(button).toBeTruthy();
  return button!;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("UnitBulkFillPanel", () => {
  it("renders a checkbox-only matcher, excludes source/internal/foreign units, and previews only selected targets", async () => {
    const fixture = panelFixture();
    await act(async () => renderPanel(fixture));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(
      0
    );
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("0 من 2 وحدة مؤهلة");
    expect(host.textContent).toContain("A-01");
    expect(host.textContent).toContain("B-01");
    expect(host.textContent).not.toContain(fixture.internalWhole.meta.unitCode);
    expect(host.textContent).not.toContain(fixture.foreign.meta.unitCode);

    await act(async () => checkboxFor("اختيار الكل").click());
    expect(host.textContent).toContain("2 من 2 وحدة مؤهلة");
    await act(async () => checkboxFor("B-01").click());

    const preview = host.querySelector<HTMLElement>(
      '[aria-label="معاينة المطابقة"]'
    )!;
    expect(preview.textContent).toContain("A-01");
    expect(preview.textContent).not.toContain("B-01");
    expect(preview.textContent).toContain("وصف الوحدة");
    expect(preview.textContent).toContain("وصف موحّد");
  });

  it("sends the selected valid targets once while an async add is pending and retains them after failure", async () => {
    const fixture = panelFixture();
    let resolveApply!: (value: boolean) => void;
    const onApply = vi.fn<(request: UnitMatchRequest) => Promise<boolean>>(
      _request => new Promise<boolean>(resolve => (resolveApply = resolve))
    );
    await act(async () => renderPanel(fixture, { onApply }));

    await act(async () => checkboxFor("A-01").click());
    const add = buttonWithText("إضافة");
    await act(async () => {
      add.click();
      add.click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({
      propertyId: "property-a",
      sourceUnitId: fixture.source.id,
      sourceChanges: { description: "وصف موحّد" },
      sourceToken: "token-source",
      unitIds: [fixture.targetA.id],
      expectedTokens: fixture.openedTokens,
    });
    expect(checkboxFor("A-01").disabled).toBe(true);

    await act(async () => resolveApply(false));
    expect(host.textContent).toContain("لم تُضف المطابقة");
    expect(host.textContent).toContain("1 من 2 وحدة مؤهلة");
    expect(checkboxFor("A-01").checked).toBe(true);
  });

  it("cancels without invoking the durable add callback", async () => {
    const fixture = panelFixture();
    const onApply = vi.fn(async () => true);
    const onCancel = vi.fn();
    await act(async () => renderPanel(fixture, { onApply, onCancel }));

    await act(async () => buttonWithText("إلغاء").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("allows matching already saved source facts without entering a new common draft value", async () => {
    const fixture = panelFixture();
    fixture.source.meta.description = "وصف محفوظ سابقًا";
    const onApply = vi.fn<(request: UnitMatchRequest) => Promise<boolean>>(
      async () => true
    );
    await act(async () => renderPanel(fixture, { onApply, sourceChanges: {} }));
    expect(host.textContent).toContain("وصف محفوظ سابقًا");
    await act(async () => checkboxFor("A-01").click());
    expect(buttonWithText("إضافة").disabled).toBe(false);
    await act(async () => buttonWithText("إضافة").click());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0].sourceChanges).toEqual({});
  });
});
