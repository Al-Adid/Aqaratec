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
const registerMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const loginMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const setAuthData = vi.hoisted(() => vi.fn());
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
      register: { useMutation: () => registerMutation },
      login: { useMutation: () => loginMutation },
    },
    useUtils: () => ({ auth: { me: { setData: setAuthData } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/login", navigate] }));

import { AccountEntryPage } from "./AccountEntryPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

async function render(mode: "login" | "register" = "login") {
  await act(async () => root.render(<AccountEntryPage mode={mode} />));
}

async function type(input: Element | null, value: string) {
  if (!input) throw new Error("input not found");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  auth.data = null;
  auth.isLoading = false;
  auth.isFetching = false;
  auth.error = null;
  auth.refetch.mockReset();
  auth.calls = [];
  registerMutation.mutate.mockReset();
  registerMutation.isPending = false;
  loginMutation.mutate.mockReset();
  loginMutation.isPending = false;
  setAuthData.mockReset();
  navigate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AccountEntryPage", () => {
  it("subscribes without refetching when the entry gate owns verification", async () => {
    await act(async () =>
      root.render(<AccountEntryPage mode="login" onTryDemo={() => {}} />)
    );
    const options = auth.calls.at(-1)?.[1] as { enabled?: boolean };
    expect(options.enabled).toBe(false);
    expect(host.textContent).toContain("تجربة بدون حساب");
  });

  it("still checks identity when mounted as a standalone account page", async () => {
    await render();
    const options = auth.calls.at(-1)?.[1] as { enabled?: boolean };
    expect(options.enabled).toBe(true);
  });

  it("renders a real email/password login form", async () => {
    await render("login");

    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("input[type=email]")).not.toBeNull();
    expect(host.querySelector("input[type=password]")).not.toBeNull();
    // Only login needs one password field, no confirmation.
    expect(host.querySelectorAll("input[type=password]")).toHaveLength(1);
    expect(host.textContent).toContain("صُنّاع الفرص");
  });

  it("renders name + confirm-password on the register form", async () => {
    await render("register");

    expect(host.querySelector("input[name=name]")).not.toBeNull();
    expect(host.querySelectorAll("input[type=password]")).toHaveLength(2);
  });

  it("submits the login form with trimmed email and the typed password", async () => {
    await render("login");

    await type(host.querySelector("input[name=email]"), "  owner@example.com ");
    await type(host.querySelector("input[name=password]"), "s3cret-pass");
    await act(async () =>
      host.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    );

    expect(loginMutation.mutate).toHaveBeenCalledTimes(1);
    expect(loginMutation.mutate.mock.calls[0][0]).toEqual({
      email: "owner@example.com",
      password: "s3cret-pass",
    });
  });

  it("blocks registration client-side when the passwords do not match", async () => {
    await render("register");

    await type(host.querySelector("input[name=name]"), "Owner");
    await type(host.querySelector("input[name=email]"), "owner@example.com");
    await type(host.querySelector("input[name=password]"), "password123");
    await type(host.querySelector("input[name=confirmPassword]"), "different123");
    await act(async () =>
      host.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    );

    expect(registerMutation.mutate).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "غير متطابقتين"
    );
  });

  it("submits registration and writes the result into the auth.me cache on success", async () => {
    await render("register");
    registerMutation.mutate.mockImplementation((_input, opts) => {
      opts.onSuccess({ id: 1, name: "Owner" });
    });

    await type(host.querySelector("input[name=name]"), "Owner");
    await type(host.querySelector("input[name=email]"), "owner@example.com");
    await type(host.querySelector("input[name=password]"), "password123");
    await type(host.querySelector("input[name=confirmPassword]"), "password123");
    await act(async () =>
      host.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      )
    );

    expect(registerMutation.mutate).toHaveBeenCalledTimes(1);
    expect(setAuthData).toHaveBeenCalledWith(undefined, { id: 1, name: "Owner" });
    expect(navigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("offers session retry on an identity error without offering an automatic guest", async () => {
    auth.error = new Error("offline");
    await render();
    const retry = Array.from(host.querySelectorAll("button")).find(node =>
      node.textContent?.includes("إعادة التحقق")
    );

    await act(async () =>
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(auth.refetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("لم نفتح تجربة ضيف تلقائيًا");
  });

  it("redirects a verified session only to the fixed dashboard route", async () => {
    auth.data = { id: 7, name: "مستخدم" };
    await render();

    expect(navigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("disables auth.me and does not turn stale query data into a local login", async () => {
    vi.stubEnv("VITE_EXPLICIT_LOCAL_GUEST", "1");
    auth.data = { id: 99, name: "بيانات لا تُستخدم" };
    auth.isLoading = true;
    auth.error = new Error("offline");
    await render();

    const options = auth.calls.at(-1)?.[1] as { enabled?: boolean } | undefined;
    expect(options?.enabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(host.querySelector("form")).not.toBeNull();
  });
});
