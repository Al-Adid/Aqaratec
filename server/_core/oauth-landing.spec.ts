import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encodeOAuthState,
  OAUTH_STATE_COOKIE,
  COOKIE_NAME,
} from "../../shared/const";
vi.mock("../db", () => ({ upsertUser: vi.fn(async () => undefined) }));
vi.mock("./sdk", () => ({
  sdk: {
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: "fixture-access",
    })),
    getUserInfo: vi.fn(async () => ({
      openId: "fixture-user",
      name: "اسم اختبار",
      email: "fixture@example.invalid",
    })),
    createSessionToken: vi.fn(async () => "fixture-session"),
  },
}));
vi.mock("./cookies", () => ({
  getSessionCookieOptions: () => ({
    secure: true,
    sameSite: "none",
    httpOnly: true,
    path: "/",
  }),
}));
import { registerOAuthRoutes } from "./oauth";
import { sdk } from "./sdk";
describe("homepage registration uses the real existing OAuth callback contract", () => {
  beforeEach(() => vi.clearAllMocks());
  const callback = () => {
    let handler: Function = () => {};
    registerOAuthRoutes({
      get: (_path: string, fn: Function) => {
        handler = fn;
      },
    } as never);
    return handler;
  };
  const response = () => {
    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
      clearCookie: vi.fn(() => res),
      cookie: vi.fn(() => res),
      redirect: vi.fn(() => res),
    };
    return res;
  };
  it("rejects forged state before token exchange", async () => {
    const res = response();
    await callback()(
      {
        query: {
          code: "code",
          state: encodeOAuthState({
            redirectUri: "https://fixture.example/api/oauth/callback",
            nonce: "wrong",
          }),
        },
        headers: { cookie: `${OAUTH_STATE_COOKIE}=expected` },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sdk.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
  it("sets the unchanged secure session and returns only to the fixed dashboard", async () => {
    const res = response();
    await callback()(
      {
        query: {
          code: "code",
          next: "https://evil.invalid/",
          state: encodeOAuthState({
            redirectUri: "https://fixture.example/api/oauth/callback",
            nonce: "same",
          }),
        },
        headers: { cookie: `${OAUTH_STATE_COOKIE}=same` },
      },
      res
    );
    expect(res.cookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      "fixture-session",
      expect.objectContaining({
        secure: true,
        sameSite: "none",
        httpOnly: true,
      })
    );
    expect(res.redirect).toHaveBeenCalledWith(302, "/dashboard");
  });
});
