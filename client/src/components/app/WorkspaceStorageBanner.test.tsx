// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { PrototypeProvider } from "@/contexts/PrototypeContext";
import { prototypeWorkspaceStorageKey } from "@/lib/prototype-workspace-storage";
import { WorkspaceStorageBanner } from "./WorkspaceStorageBanner";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe("R08visible recovery withoutcloudpopover", () => {
  it("showsrecoveryoptions preservingcorruptoriginal onmount", async () => {
    localStorage.clear();
    const key = prototypeWorkspaceStorageKey();
    localStorage.setItem(key, "{BROKEN_UNTOUCHED");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <WorkspaceStorageBanner />
        </PrototypeProvider>
      )
    );
    expect(host.textContent).toContain("تنبيه الحفظ والاسترداد");
    expect(host.textContent).toContain("تصدير النسخة الخام");
    expect(localStorage.getItem(key)).toBe("{BROKEN_UNTOUCHED");
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  });
});
