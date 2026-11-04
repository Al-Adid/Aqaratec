// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { PrototypeProvider } from "@/contexts/PrototypeContext";
vi.mock("./CloudWorkspace", () => ({ CloudWorkspace: () => null }));
vi.mock("./WorkspaceStorageBanner", () => ({
  WorkspaceStorageBanner: () => null,
}));
import { AppFrame } from "./AppFrame";
describe("P01 stage1 shell", () => {
  it("renders primary navigation, deferred badges and declared clock without any scope ReferenceError", () => {
    const html = renderToStaticMarkup(
      <PrototypeProvider>
        <AppFrame>
          <div>محتوى اختبار مصطنع</div>
        </AppFrame>
      </PrototypeProvider>
    );
    expect(html).toContain("المرحلة الأولى");
    expect(html).toContain("قريبًا");
    expect(html).toContain("تاريخ السيناريو");
    expect(html).toContain("2026-10-24");
    expect(html).toContain("محتوى اختبار مصطنع");
  });
});
