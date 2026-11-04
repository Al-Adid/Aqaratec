// @vitest-environment jsdom
import { prototypeWorkspaceStorageKey } from "@/lib/prototype-workspace-storage";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import MonthlyCollectionPanel from "@/components/app/MonthlyCollectionPanel";
import { getMonthlyPropertyCollections } from "./prototype-payments";
import { createDemoState } from "./demo-data";
import { PROTOTYPE_DATE } from "@shared/prototype";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
function Harness() {
  api = usePrototype();
  return <MonthlyCollectionPanel />;
}
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    row => row.textContent?.trim() === label && !row.disabled
  );

beforeEach(async () => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    );
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("monthly collection interactive UI", () => {
  it("shows every property with its due day and collects through the actual button", async () => {
    const expected = getMonthlyPropertyCollections(
      api.state.entities,
      "all",
      "2026-10"
    ).find(row => row.property.id === "building")!;
    expect(container.textContent).toContain("موعد التحصيل:");
    expect(container.textContent).toContain("يوم 1 (2026-10-01)");
    expect(container.textContent).toContain(expected.property.title);
    const originalCount = api.state.entities.collections.length;
    await act(async () => {
      button("تم تحصيل إيجار الشهر")!.click();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLFormElement>('[role="dialog"] form')!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const after = getMonthlyPropertyCollections(
      api.state.entities,
      "all",
      "2026-10"
    ).find(row => row.property.id === "building")!;
    expect(after.remainingMinor).toBe(0);
    expect(api.state.entities.collections.length).toBe(
      originalCount + expected.dues.filter(row => row.remainingMinor > 0).length
    );
    expect(container.textContent).toContain("إيجار الشهر محصّل");
    const saved = JSON.parse(
      localStorage.getItem(prototypeWorkspaceStorageKey())!
    );
    expect(saved.snapshot.entities.collections.length).toBe(
      api.state.entities.collections.length
    );
  });
  it("rejects a second synchronous collection before React re-renders", async () => {
    const before = getMonthlyPropertyCollections(
      api.state.entities,
      "all",
      "2026-10"
    ).find(row => row.property.id === "building")!;
    const oldApi = api;
    await act(async () => {
      oldApi.recordPropertyMonthCollection(
        "building",
        "2026-10",
        "تحويل",
        PROTOTYPE_DATE,
        before.remainingMinor
      );
      expect(() =>
        oldApi.recordPropertyMonthCollection(
          "building",
          "2026-10",
          "تحويل",
          PROTOTYPE_DATE,
          before.remainingMinor
        )
      ).toThrow("سبق");
    });
    expect(
      getMonthlyPropertyCollections(api.state.entities, "all", "2026-10").find(
        row => row.property.id === "building"
      )!.remainingMinor
    ).toBe(0);
  });
  it("disables recording for reader roles without turning the role preview into fake login", async () => {
    await act(async () => {
      api.setSetting("role", "owner");
    });
    expect(button("تم تحصيل إيجار الشهر")).toBeUndefined();
    const trigger = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(row => row.textContent?.includes("تم تحصيل إيجار الشهر"))!;
    expect(trigger.disabled).toBe(true);
    await act(async () => {
      trigger
        .closest("span")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("changes monthly scope without hiding existing properties or calling an empty month paid", async () => {
    await act(async () => {
      api.setSetting("period", "2026-11");
    });
    expect(container.textContent).toContain("لا توجد استحقاقات في هذا الشهر");
    expect(container.textContent).not.toContain("إيجار الشهر محصّل");
    expect(container.querySelectorAll(".monthly-property-panel").length).toBe(
      createDemoState().entities.properties.length
    );
  });
});
