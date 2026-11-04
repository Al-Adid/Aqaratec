import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  renderPageTemplate,
  knownPagePath,
  registerPublicSeoDocuments,
} from "./public-pages";
import { getPublicServices, PUBLIC_ORIGIN } from "../shared/public-services";
const template = readFileSync(
  new URL("../client/index.html", import.meta.url),
  "utf8"
);
describe("public homepage and application response boundary", () => {
  it("puts every declared service and signup links in initial HTML with a real canonical", () => {
    const { html, status } = renderPageTemplate(template, "/?campaign=test");
    expect(status).toBe(200);
    for (const service of getPublicServices())
      expect(html).toContain(service.title);
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/login"');
    expect(html).toContain(`href="${PUBLIC_ORIGIN}/"`);
    expect(html).toContain('content="index,follow"');
    expect(html).toContain('property="og:image"');
    expect(html).not.toContain("app-main");
    expect(html).not.toContain("محفظة الأسرة");
    expect(html).not.toContain("فيلا الروضة");
  });
  it("does not embed an account or financial records in private HTML and keeps it noindex", () => {
    for (const url of [
      "/dashboard",
      "/properties/villa",
      "/login",
      "/register",
      "/marketing",
    ]) {
      const page = renderPageTemplate(template, url);
      expect(page.status).toBe(200);
      expect(page.html).toContain('content="noindex,nofollow"');
      expect(page.html).not.toContain('rel="canonical"');
      expect(page.html).toContain('<div id="root"></div>');
      expect(page.html).not.toContain("محفظة الأسرة");
    }
  });
  it("returns real404 for missing routes or assets rather than claiming a dashboard", () => {
    expect(knownPagePath("/properties/test-id")).toBe(true);
    for (const url of ["/missing-public-page", "/missing-logo.png", "/404"]) {
      const page = renderPageTemplate(template, url);
      expect(page.status).toBe(404);
      expect(page.html).toContain("noindex,nofollow");
    }
  });
  it("limits the sitemap to the public homepage and excludes private app paths in robots", () => {
    const handlers = new Map<string, Function>();
    registerPublicSeoDocuments({
      get: (path: string, handler: Function) => handlers.set(path, handler),
    } as never);
    let body = "";
    const response = {
      type: () => response,
      set: () => response,
      send: (value: string) => {
        body = value;
        return response;
      },
    };
    handlers.get("/sitemap.xml")!({}, response);
    expect(body).toContain(`${PUBLIC_ORIGIN}/</loc>`);
    expect(body).not.toContain("/properties");
    handlers.get("/robots.txt")!({}, response);
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /register");
  });
});
