// @vitest-environment jsdom
import { prototypeWorkspaceStorageKey } from "@/lib/prototype-workspace-storage";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { PropertyImport } from "@/components/app/PropertyImport";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, api: ReturnType<typeof usePrototype>;
function Harness() {
  api = usePrototype();
  return (
    <PropertyImport
      onImport={v =>
        api.add("properties", {
          title: v.title,
          portfolioId: v.portfolioId,
          meta: {
            assetType: v.assetType,
            year: v.buildingYear,
            source: v.inputMethod,
          },
        })
      }
    />
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
  await act(async () => root.unmount());
  container.remove();
});
const chooseFile = async (text: string) => {
  const input =
    container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], "example.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
};
describe("local Excel CSV preview interface", () => {
  it("previews before adding and preserves chosen portfolio", async () => {
    await chooseFile(
      "اسم العقار,نوع العقار,سنة البناء,عدد الوحدات\nملف تجربة جديد,فيلا,2020,1"
    );
    expect(
      api.state.entities.properties.some(p => p.title === "ملف تجربة جديد")
    ).toBe(false);
    const select = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "family";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(b => b.textContent?.includes("اعتماد وإضافة"))!;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    const added = api.state.entities.properties.find(
      p => p.title === "ملف تجربة جديد"
    )!;
    expect(added.portfolioId).toBe("family");
    expect(added.meta.source).toBe("Excel");
    expect(container.textContent).toContain("لن نستبدله");
    expect(
      JSON.parse(
        localStorage.getItem(prototypeWorkspaceStorageKey())!
      ).snapshot.entities.properties.some(
        (p: { title: string }) => p.title === added.title
      )
    ).toBe(true);
  });
  it("keeps reader role unable to select a file", async () => {
    await act(async () => api.setSetting("role", "owner"));
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled
    ).toBe(true);
  });
});
