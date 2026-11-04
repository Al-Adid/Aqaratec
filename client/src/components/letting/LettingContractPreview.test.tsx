// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider } from "@/contexts/PrototypeContext";

const engine = vi.hoisted(() => ({ getContract: vi.fn() }));
vi.mock("@/lib/letting-engine", () => ({
  getLettingContract: engine.getContract,
}));

import { LettingContractPreview } from "./LettingContractPreview";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  engine.getContract.mockReturnValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("LettingContractPreview", () => {
  it("states that printing is unavailable when core has not issued a contract", async () => {
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <LettingContractPreview applicationId="app-12345678" />
        </PrototypeProvider>
      );
    });
    expect(host.textContent).toContain("لا يتوفر عقد للطباعة");
    expect(host.querySelector("button")).toBeNull();
  });

  it("renders core contract content as text rather than raw HTML", async () => {
    engine.getContract.mockReturnValue({
      document: { title: "عقد تجريبي" },
      lease: {},
      content: "بيانات المستأجر\n<img src=x onerror=alert(1)>",
    });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await act(async () => {
      root.render(
        <PrototypeProvider>
          <LettingContractPreview applicationId="app-12345678" />
        </PrototypeProvider>
      );
    });
    const open = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("معاينة العقد")
    )!;
    await act(async () => open.click());

    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("ليست عقدًا قانونيًا معتمدًا");
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find(button => button.textContent?.includes("طباعة / حفظ PDF"))!
        .click();
    });
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
