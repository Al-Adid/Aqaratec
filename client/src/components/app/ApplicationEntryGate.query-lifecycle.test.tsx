// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { AccountEntryPage } from "@/pages/public/AccountEntryPage";
import { ApplicationEntryGate } from "./ApplicationEntryGate";

const startLogin = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/const", () => ({ startLogin }));
vi.mock("wouter", () => ({ useLocation: () => ["/login", navigate] }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type FetchPlan = () => Promise<Response>;

type DeferredResponse = {
  resolve: () => void;
  reject: (error: Error) => void;
};

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;
let trpcClient: ReturnType<typeof trpc.createClient>;
let fetchPlans: FetchPlan[];
let fetchMock: ReturnType<typeof vi.fn>;
let workspaceMounts: number;

function nullAuthResponse() {
  return new Response(
    JSON.stringify([{ result: { data: { json: null } } }]),
    { headers: { "content-type": "application/json" } }
  );
}

function queueNullAuthResponse() {
  fetchPlans.push(() => Promise.resolve(nullAuthResponse()));
}

function queueDeferredAuthResponse(): DeferredResponse {
  let settle: ((response: Response) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const response = new Promise<Response>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  fetchPlans.push(() => response);
  return {
    resolve: () => settle?.(nullAuthResponse()),
    reject: error => fail?.(error),
  };
}

async function render(ui: React.ReactNode) {
  await act(async () => {
    root.render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </trpc.Provider>
    );
    await Promise.resolve();
  });
}

async function waitForExpectation(
  assertion: () => void,
  attempts = 40
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  throw lastError;
}

async function settleTurns(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function authMeQueryKey() {
  return getQueryKey(trpc.auth.me, undefined, "query");
}

function StatefulWorkspace() {
  const [mount] = React.useState(() => ++workspaceMounts);
  const [draft, setDraft] = React.useState("مسودة أولى");

  return (
    <section data-stateful-workspace="true">
      <p>تركيب مساحة العمل: {mount}</p>
      <p>حالة المسودة: {draft}</p>
      <button type="button" onClick={() => setDraft("مسودة محفوظة")}>
        احفظ المسودة المحلية
      </button>
    </section>
  );
}

function buttonContaining(text: string) {
  return Array.from(host.querySelectorAll("button")).find(node =>
    node.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  window.sessionStorage.clear();
  fetchPlans = [];
  workspaceMounts = 0;
  startLogin.mockReset();
  navigate.mockReset();
  fetchMock = vi.fn(() => {
    const next = fetchPlans.shift();
    if (!next) {
      return Promise.reject(new Error("Unexpected auth.me request"));
    }
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);

  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
      },
    },
  });
  trpcClient = trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://trpc.test/api/trpc",
        transformer: superjson,
      }),
    ],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  host.remove();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApplicationEntryGate real auth query lifecycle", () => {
  it("settles a null auth result once before offering an explicit guest choice", async () => {
    queueNullAuthResponse();

    await render(
      <ApplicationEntryGate>
        <StatefulWorkspace />
      </ApplicationEntryGate>
    );

    await waitForExpectation(() => {
      expect(host.textContent).toContain("تجربة بدون حساب");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await settleTurns();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-stateful-workspace]")).toBeNull();
    expect(workspaceMounts).toBe(0);
  });

  it("hides but preserves the granted guest workspace through invalidation, error, and recovery", async () => {
    queueNullAuthResponse();

    await render(
      <ApplicationEntryGate>
        <StatefulWorkspace />
      </ApplicationEntryGate>
    );
    await waitForExpectation(() => {
      expect(host.textContent).toContain("تجربة بدون حساب");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const demo = buttonContaining("تجربة بدون حساب");
    expect(demo).toBeDefined();
    await act(async () => {
      demo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const originalWorkspace = host.querySelector<HTMLElement>(
      "[data-stateful-workspace]"
    );
    expect(originalWorkspace).not.toBeNull();
    expect(workspaceMounts).toBe(1);

    const saveDraft = buttonContaining("احفظ المسودة المحلية");
    expect(saveDraft).toBeDefined();
    await act(async () => {
      saveDraft?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("مسودة محفوظة");

    const delayedAuth = queueDeferredAuthResponse();
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: authMeQueryKey() });
      await Promise.resolve();
    });
    await waitForExpectation(() => {
      const suspended = host.querySelector<HTMLElement>(
        "[data-application-entry-content=suspended]"
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(suspended?.hidden).toBe(true);
      expect(suspended?.getAttribute("aria-hidden")).toBe("true");
      expect(suspended?.getAttribute("inert")).not.toBeNull();
      expect(host.querySelector("[role=status]")?.textContent).toContain(
        "جارٍ إعادة التحقق"
      );
      expect(host.querySelector("[data-stateful-workspace]")).toBe(
        originalWorkspace
      );
    });

    delayedAuth.reject(new Error("auth.me offline"));
    await waitForExpectation(() => {
      expect(host.querySelector("[role=alert]")?.textContent).toContain(
        "تعذر إعادة التحقق من الهوية"
      );
      expect(
        host.querySelector("[data-application-entry-content=suspended]")?.hasAttribute(
          "hidden"
        )
      ).toBe(true);
      expect(host.querySelector("[data-stateful-workspace]")).toBe(
        originalWorkspace
      );
    });

    queueNullAuthResponse();
    const retry = buttonContaining("إعادة التحقق");
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForExpectation(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        host.querySelector("[data-application-entry-content=ready]")
      ).not.toBeNull();
      expect(host.querySelector("[data-stateful-workspace]")).toBe(
        originalWorkspace
      );
      expect(host.textContent).toContain("مسودة محفوظة");
    });

    expect(workspaceMounts).toBe(1);
  });

  it("keeps a standalone AccountEntryPage responsible for its own fresh auth check", async () => {
    queueNullAuthResponse();

    await render(<AccountEntryPage mode="login" />);

    await waitForExpectation(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(host.querySelector("form")).not.toBeNull();
      expect(host.textContent).toContain("تسجيل الدخول");
    });
    await settleTurns();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("تجربة بدون حساب");
  });
});
