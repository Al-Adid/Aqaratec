// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { createDemoState } from "@/lib/demo-data";
import { normalizePrototype } from "@/lib/prototype-normalize";
import { createRentalProperty } from "@/lib/prototype-rental";
import {
  writePrototypeWorkspaceGuarded,
  type PrototypeWorkspaceScope,
} from "@/lib/prototype-workspace-storage";
import { trpc } from "@/lib/trpc";
import { assertPrototypeState } from "@shared/prototype-validation";
import { ApplicationEntryGate, EXPLICIT_DEMO_SESSION_KEY } from "./ApplicationEntryGate";
import { WorkspaceIdentityBoundary } from "./WorkspaceIdentityBoundary";
import { PropertyDetailPage } from "@/pages/operating/PortfolioPropertyPages";

const notFoundRedirect = vi.hoisted(() => vi.fn());

// The production component redirects the full page from an effect. This narrow
// replacement lets the test observe that irreversible branch without allowing
// JSDOM navigation to obscure the preceding identity lifecycle.
vi.mock("@/pages/NotFound", () => ({
  default: () => {
    notFoundRedirect();
    return <div data-not-found-redirect="true" />;
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type FetchPlan = () => Promise<Response>;
type DeferredResponse = { resolve: () => void; reject: (error: Error) => void };

type PersistedProperty = {
  id: string;
  title: string;
  unitTitles: string[];
};

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;
let trpcClient: ReturnType<typeof trpc.createClient>;
let fetchPlans: FetchPlan[];
let fetchMock: ReturnType<typeof vi.fn>;

function nullAuthResponse() {
  return new Response(
    JSON.stringify([{ result: { data: { json: null } } }]),
    { headers: { "content-type": "application/json" } }
  );
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
  attempts = 50
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

async function persistThirtySixVillaComplex(): Promise<PersistedProperty> {
  const initial = assertPrototypeState(normalizePrototype(createDemoState()));
  const created = createRentalProperty(initial, {
    title: "مجمع فلل دورة الهوية · 36",
    portfolioId: "family",
    assetType: "villa_complex",
    usageType: "residential",
    inputMethod: "يدوي",
    rentalMode: "units",
    unitCount: "36",
    monthlyRent: "3500",
    description: "لقطة ضيف محفوظة قبل تحقق الهوية الثاني",
    propertyNumber: "VC-36",
    electricityNumber: "ELEC-36",
    requestId: "identity-lifecycle-36-villa-complex",
  });
  const scope: PrototypeWorkspaceScope = {
    userId: null,
    identityState: "guest",
    localWorkspaceId: "default",
  };
  const written = await writePrototypeWorkspaceGuarded(
    window.localStorage,
    scope,
    created.state,
    0
  );

  expect(written.ok).toBe(true);
  expect(initial.entities.properties.some(row => row.id === created.property.id)).toBe(
    false
  );

  return {
    id: created.property.id,
    title: created.property.title,
    unitTitles: created.state.entities.units
      .filter(unit => unit.propertyId === created.property.id)
      .map(unit => unit.title),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubEnv("VITE_EXPLICIT_LOCAL_GUEST", "0");
  notFoundRedirect.mockReset();
  fetchPlans = [];
  fetchMock = vi.fn(() => {
    const next = fetchPlans.shift();
    if (!next) return Promise.reject(new Error("Unexpected auth.me request"));
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
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PropertyDetailPage identity query lifecycle", () => {
  it("does not take a persisted guest villa complex to NotFound while its first and child auth checks settle", async () => {
    const persisted = await persistThirtySixVillaComplex();
    const firstAuth = queueDeferredAuthResponse();
    const childAuth = queueDeferredAuthResponse();
    window.sessionStorage.setItem(EXPLICIT_DEMO_SESSION_KEY, "1");

    await render(
      <ApplicationEntryGate>
        <WorkspaceIdentityBoundary>
          <PropertyDetailPage id={persisted.id} />
        </WorkspaceIdentityBoundary>
      </ApplicationEntryGate>
    );

    await waitForExpectation(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain("جارٍ التحقق من الجلسة");
      expect(host.textContent).not.toContain(persisted.title);
      expect(notFoundRedirect).not.toHaveBeenCalled();
    });

    firstAuth.resolve();

    await waitForExpectation(() => {
      // Mounting WorkspaceIdentityBoundary adds its own observer. With stale
      // data it must not create a temporary pending/demo provider for this id.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(notFoundRedirect).not.toHaveBeenCalled();
    });

    childAuth.resolve();

    await waitForExpectation(() => {
      expect(notFoundRedirect).not.toHaveBeenCalled();
      expect(host.textContent).toContain(persisted.title);
      expect(host.textContent).toContain("كل الوحدات: 36");
      expect(host.querySelectorAll("tbody tr")).toHaveLength(36);
      for (const unitTitle of persisted.unitTitles) {
        expect(host.textContent).toContain(unitTitle);
      }
    });
  });
});
