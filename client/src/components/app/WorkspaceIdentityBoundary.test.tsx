// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { WorkspaceIdentityBoundary } from "./WorkspaceIdentityBoundary";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  STATIC_LOCAL_WORKSPACE_ID,
  prototypeWorkspaceStorageKey,
} from "@/lib/prototype-workspace-storage";
import { createDemoState } from "@/lib/demo-data";
import { normalizePrototype } from "@/lib/prototype-normalize";

const query = vi.hoisted(() => ({
  data: { id: 41, name: "A" } as { id: number; name: string } | null,
  isLoading: false,
  isFetching: false,
  error: null as Error | null,
  calls: [] as unknown[][],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (...args: unknown[]) => {
          query.calls.push(args);
          return query;
        },
      },
    },
  },
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, api: ReturnType<typeof usePrototype>;
const harnessRendered = vi.fn();
function Harness() {
  harnessRendered();
  api = usePrototype();
  return <div>test</div>;
}
async function render() {
  await act(async () =>
    root.render(
      <WorkspaceIdentityBoundary>
        <Harness />
      </WorkspaceIdentityBoundary>
    )
  );
}
beforeEach(async () => {
  localStorage.clear();
  vi.unstubAllEnvs();
  query.calls = [];
  query.data = { id: 41, name: "A" };
  query.isLoading = false;
  query.isFetching = false;
  query.error = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});
describe("R08 identity background recheck", () => {
  it("does not mount record pages before the first verified namespace exists", async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    harnessRendered.mockClear();
    query.isFetching = true;
    query.data = null;
    await render();
    expect(harnessRendered).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "الهوية"
    );
    query.isFetching = false;
    query.error = new Error("offline");
    await render();
    expect(harnessRendered).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "الهوية"
    );
    query.error = null;
    await render();
    expect(harnessRendered).toHaveBeenCalled();
    expect(api.identity.status).toBe("guest");
  });

  it("keeps quota-only changes through refetch and network failure but never gives to B", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await act(async () =>
      api.add("tasks", {
        title: "Only A volatile marker",
        portfolioId: "family",
      })
    );
    expect(api.storage.kind).toBe("memory-only");
    query.isFetching = true;
    await render();
    expect(
      api.state.entities.tasks.some(r => r.title === "Only A volatile marker")
    ).toBe(true);
    expect(api.canEdit).toBe(false);
    expect(() =>
      api.add("tasks", { title: "blocked", portfolioId: "family" })
    ).toThrow("الهوية");
    query.isFetching = false;
    query.error = new Error("offline");
    await render();
    expect(api.exportWorkspace()).toContain("Only A volatile marker");
    query.error = null;
    await render();
    expect(api.canEdit).toBe(true);
    query.data = { id: 42, name: "B" };
    await render();
    expect(
      api.state.entities.tasks.some(r => r.title === "Only A volatile marker")
    ).toBe(false);
    expect(api.identity.userId).toBe(42);
  });

  it("requires explicit static guest opt-in and disables auth.me before reading static-demo", async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.stubEnv("VITE_EXPLICIT_LOCAL_GUEST", "1");
    const saved = normalizePrototype(createDemoState());
    saved.entities.portfolios[0].title = "مساحة ثابتة سابقة";
    localStorage.setItem(
      prototypeWorkspaceStorageKey({
        userId: null,
        identityState: "guest",
        localWorkspaceId: STATIC_LOCAL_WORKSPACE_ID,
      }),
      JSON.stringify(saved)
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    query.calls = [];
    harnessRendered.mockClear();

    await render();

    expect((query.calls.at(-1)?.[1] as { enabled?: boolean }).enabled).toBe(
      false
    );
    expect(harnessRendered).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("مساحة ثابتة سابقة");
    const button = Array.from(host.querySelectorAll("button")).find(button =>
      button.textContent?.includes("فتح مساحة الضيف المحلية")
    );
    expect(button).toBeTruthy();

    await act(async () =>
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(api.identity).toMatchObject({
      status: "guest",
      localWorkspaceId: STATIC_LOCAL_WORKSPACE_ID,
    });
    expect(
      api.state.entities.portfolios.some(
        row => row.title === "مساحة ثابتة سابقة"
      )
    ).toBe(true);
  });
});
