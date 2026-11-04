import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function fakeRequest(overrides: Partial<Request>): Request {
  return { secure: false, protocol: "http", headers: {}, ...overrides } as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses Secure + SameSite=None over a real HTTPS connection", () => {
    expect(getSessionCookieOptions(fakeRequest({ protocol: "https" }))).toMatchObject({
      secure: true,
      sameSite: "none",
    });
  });

  it("honors X-Forwarded-Proto from a TLS-terminating proxy", () => {
    expect(
      getSessionCookieOptions(
        fakeRequest({ protocol: "http", headers: { "x-forwarded-proto": "https" } })
      )
    ).toMatchObject({ secure: true, sameSite: "none" });
  });

  it("falls back to a non-Secure, Lax cookie over plain HTTP, so local dev keeps a session", () => {
    expect(getSessionCookieOptions(fakeRequest({ protocol: "http" }))).toMatchObject({
      secure: false,
      sameSite: "lax",
    });
  });
});
