// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { OpportunityHunterPage } from "./OpportunityHunterPage";
import { HUNTER_RECORD_TYPE } from "@/lib/hunter-demo";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;

function Harness() {
  api = usePrototype();
  return <OpportunityHunterPage />;
}

function action(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    button => button.textContent?.includes(label) && !button.disabled
  );
}

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

describe("OpportunityHunterPage", () => {
  it("imports the fixed local fixtures once, removes a stable duplicate on repeat scan, and never creates a purchase", async () => {
    const before = {
      opportunities: api.state.entities.opportunities.length,
      payments: api.state.entities.payments.length,
      collections: api.state.entities.collections.length,
      tasks: api.state.entities.tasks.length,
    };

    await act(async () => {
      action("محاكاة المسح")!.click();
    });

    const hunterRows = api.state.entities.opportunities.filter(
      row => row.meta.recordType === HUNTER_RECORD_TYPE
    );
    expect(hunterRows).toHaveLength(6);
    expect(api.state.entities.opportunities).toHaveLength(
      before.opportunities + 6
    );
    expect(container.textContent).toContain("رُصد");
    expect(container.textContent).toContain("مكرر");
    expect(container.textContent).toContain("قديم/غير متاح");
    expect(container.textContent).toContain("يحتاج بيانات");
    expect(container.textContent).toContain("دخل الفرز");
    expect(container.textContent).toContain("لا يوجد بحث سوق حي");

    await act(async () => {
      action("محاكاة المسح")!.click();
    });

    expect(
      api.state.entities.opportunities.filter(
        row => row.meta.recordType === HUNTER_RECORD_TYPE
      )
    ).toHaveLength(6);
    expect(api.state.entities.payments).toHaveLength(before.payments);
    expect(api.state.entities.collections).toHaveLength(before.collections);
    expect(api.state.entities.tasks).toHaveLength(before.tasks);
    expect(container.textContent).toContain(
      "لا يوجد بحث سوق حي أو شراء أو تمويل أو تحويل أموال تلقائي"
    );
  });

  it("keeps destructive workflow actions disabled in the read-only role", async () => {
    await act(async () => {
      api.setSetting("role", "owner");
    });
    const scan = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(button => button.textContent?.includes("محاكاة المسح"));
    expect(scan?.disabled).toBe(true);
    expect(container.textContent).toContain("قراءة فقط");
  });
});
