// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { LeasesPage } from "./LeaseCollectionPages";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe("R09lease stocknotstartmonthflow", () => {
  it("showsJunelease inOctober with its actions andnoleaktootherportfolio", async () => {
    localStorage.clear();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let api: ReturnType<typeof usePrototype>;
    function Harness() {
      api = usePrototype();
      return <LeasesPage />;
    }
    await act(async () =>
      root.render(
        <PrototypeProvider>
          <Harness />
        </PrototypeProvider>
      )
    );
    await act(async () => {
      api.setSetting("period", "2026-10");
      api.setSetting("portfolioId", "family");
      api.add("leases", {
        title: "عقد بدأ يونيو ونافذ أكتوبر",
        portfolioId: "family",
        propertyId: "villa",
        status: "نشط",
        date: "2026-06-01",
        amountMinor: 10000,
        meta: {
          startDate: "2026-06-01",
          endDate: "2026-12-31",
          unitId: "villa1",
        },
      });
    });
    expect(host.textContent).toContain("عقد بدأ يونيو ونافذ أكتوبر");
    expect(
      [...host.querySelectorAll("button")].some(b =>
        b.textContent?.includes("تجديد")
      )
    ).toBe(true);
    await act(async () => api.setSetting("portfolioId", "growth"));
    expect(host.textContent).not.toContain("عقد بدأ يونيو ونافذ أكتوبر");
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  });
});
