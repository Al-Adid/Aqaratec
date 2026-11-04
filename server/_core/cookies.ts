import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(req: Request): CookieOptions {
  // `req.secure` is true behind Express's own TLS termination; `x-forwarded-proto`
  // covers a reverse proxy (Manus preview, a load balancer) terminating TLS in
  // front of a plain-HTTP origin. Only in that case is the request actually
  // HTTPS end to end, which `Secure; SameSite=None` requires — a browser drops
  // a `Secure` cookie outright over plain `http://localhost`, so a genuine
  // local `pnpm dev` run (and any other all-HTTP deployment) needs the
  // non-Secure, `Lax` pair instead or the session cookie never survives the
  // next request.
  const isHttps =
    req.secure ||
    req.protocol === "https" ||
    req.headers["x-forwarded-proto"] === "https";
  return isHttps
    ? { httpOnly: true, path: "/", sameSite: "none", secure: true }
    : { httpOnly: true, path: "/", sameSite: "lax", secure: false };
}
