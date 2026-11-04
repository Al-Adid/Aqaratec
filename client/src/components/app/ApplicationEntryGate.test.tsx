// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  data: null as { id: number; name: string } | null,
  isLoading: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
  calls: [] as unknown[][],
}));
const startLogin = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (...args: unknown[]) => {
          auth.calls.push(args);
          return auth;
        },
      },
      register: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      login: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
  },
}));
vi.mock("@/const", () => ({ startLogin }));
vi.mock("wouter", () => ({ useLocation: () => ["/login", navigate] }));

import {
  ApplicationEntryGate,
  EXPLICIT_DEMO_SESSION_KEY,
} from "./ApplicationEntryGate";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let workspaceMounts: number;

function Workspace() {
  const [mount] = React.useState(() => ++workspaceMounts);
  return <div>مساحة المستخدم الداخلية ({mount})</div>;
}

function StatefulWorkspace() {
  const [mount] = React.useState(() => ++workspaceMounts);
  const [draft, setDraft] = React.useState("مسودة محلية أولى");
  return (
    <section data-stateful-workspace="true">
      <p>تركيب مساحة العمل: {mount}</p>
      <p>حالة محلية: {draft}</p>
      <button type="button" onClick={() => setDraft("مسودة محلية معدّلة")}>
        عدّل الحالة المحلية
      </button>
    </section>
  );
}

async function render(
  forceDemo = false,
  children: React.ReactNode = <Workspace />
) {
  await act(async () =>
    root.render(
      <ApplicationEntryGate forceDemo={forceDemo}>
        {children}
      </ApplicationEntryGate>
    )
  );
}

function queryOptions(call: unknown[] | undefined) {
  return call?.[1] as { enabled?: boolean } | undefined;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
  auth.data = null;
  auth.isLoading = false;
  auth.isFetching = false;
  auth.error = null;
  auth.refetch.mockReset();
  auth.calls = [];
  startLogin.mockReset();
  navigate.mockReset();
  workspaceMounts = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ApplicationEntryGate", () => {
  it("does not mount the workspace while the auth query is loading", async () => {
    auth.isLoading = true;
    await render();

    expect(host.textContent).toContain("جارٍ التحقق من الجلسة");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
    expect(workspaceMounts).toBe(0);
  });

  it("does not honor an explicit demo marker while identity verification has failed", async () => {
    window.sessionStorage.setItem(EXPLICIT_DEMO_SESSION_KEY, "1");
    auth.error = new Error("offline");
    await render();

    expect(host.textContent).toContain("تعذر التحقق من الهوية");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
    expect(workspaceMounts).toBe(0);

    const retry = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("إعادة التحقق")
    );
    await act(async () =>
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(auth.refetch).toHaveBeenCalledTimes(1);
  });

  it("opens a guest workspace only after the visitor explicitly chooses the demo", async () => {
    await render();

    expect(host.textContent).toContain("تجربة بدون حساب");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
    expect(startLogin).not.toHaveBeenCalled();

    const demo = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("تجربة بدون حساب")
    );
    await act(async () =>
      demo?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(window.sessionStorage.getItem(EXPLICIT_DEMO_SESSION_KEY)).toBe("1");
    expect(host.textContent).toContain("مساحة المستخدم الداخلية");
    expect(workspaceMounts).toBe(1);
  });

  it("keeps an in-memory explicit demo choice when sessionStorage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await render();
    const demo = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("تجربة بدون حساب")
    );

    await act(async () =>
      demo?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(host.textContent).toContain("مساحة المستخدم الداخلية");
    expect(workspaceMounts).toBe(1);
  });

  it("explains that a direct demo is local and uses dummy files", async () => {
    await render(true);

    expect(host.textContent).toContain("ملفات وبيانات وهمية");
    expect(host.textContent).toContain("تجربة بدون حساب");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
  });

  it("clears a prior demo marker for a verified account so logout returns to login", async () => {
    window.sessionStorage.setItem(EXPLICIT_DEMO_SESSION_KEY, "1");
    auth.data = { id: 2, name: "مالك" };
    await render();

    expect(host.textContent).toContain("مساحة المستخدم الداخلية");
    expect(window.sessionStorage.getItem(EXPLICIT_DEMO_SESSION_KEY)).toBeNull();

    auth.data = null;
    await render();

    expect(host.textContent).toContain("سجّل الدخول");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
    expect(host.querySelector("[data-application-entry-content=suspended]")).toBeNull();
  });

  it("preserves the same mounted child and local state through refetch, error, and recovery", async () => {
    auth.data = { id: 8, name: "مالك" };
    await render(false, <StatefulWorkspace />);

    const edit = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("عدّل الحالة المحلية")
    );
    await act(async () =>
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(host.textContent).toContain("مسودة محلية معدّلة");
    expect(workspaceMounts).toBe(1);

    auth.isFetching = true;
    await render(false, <StatefulWorkspace />);

    let retained = host.querySelector<HTMLElement>(
      "[data-application-entry-content=suspended]"
    );
    expect(retained).not.toBeNull();
    expect(retained?.hidden).toBe(true);
    expect(retained?.getAttribute("inert")).not.toBeNull();
    expect(retained?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "جارٍ إعادة التحقق"
    );
    expect(host.textContent).toContain("مسودة محلية معدّلة");
    expect(workspaceMounts).toBe(1);

    auth.isFetching = false;
    auth.error = new Error("offline");
    await render(false, <StatefulWorkspace />);

    retained = host.querySelector<HTMLElement>(
      "[data-application-entry-content=suspended]"
    );
    expect(retained?.hidden).toBe(true);
    expect(retained?.getAttribute("inert")).not.toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "تعذر إعادة التحقق"
    );
    expect(host.textContent).toContain("مسودة محلية معدّلة");
    expect(workspaceMounts).toBe(1);

    auth.error = null;
    await render(false, <StatefulWorkspace />);

    const ready = host.querySelector<HTMLElement>(
      "[data-application-entry-content=ready]"
    );
    expect(ready?.hidden).toBe(false);
    expect(host.textContent).toContain("مسودة محلية معدّلة");
    expect(workspaceMounts).toBe(1);
  });

  it("disables auth.me in explicit local-guest runtime without granting a fake account", async () => {
    vi.stubEnv("VITE_EXPLICIT_LOCAL_GUEST", "1");
    auth.data = { id: 13, name: "لا ينبغي أن تمنح جلسة" };
    auth.isLoading = true;
    await render();

    expect(auth.calls.length).toBeGreaterThan(0);
    expect(auth.calls.every(call => queryOptions(call)?.enabled === false)).toBe(
      true
    );
    expect(host.textContent).toContain("تجربة بدون حساب");
    expect(host.textContent).not.toContain("مساحة المستخدم الداخلية");
    expect(navigate).not.toHaveBeenCalled();

    const demo = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("تجربة بدون حساب")
    );
    await act(async () =>
      demo?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(host.textContent).toContain("مساحة المستخدم الداخلية");
    expect(workspaceMounts).toBe(1);
  });
});
