import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import superjson from "superjson";
import { trpc } from "./trpc";
import App from "../App";
import routes from "../../public/manus-routes.json";
import { allNavigation, PRIMARY_PATHS } from "./navigation";
import { phaseFeatureActive } from "@shared/phase1-features";
import { siteMetadata } from "@shared/site-metadata";

const render = (path: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  });
  queryClient.setQueryData(getQueryKey(trpc.auth.me, undefined, "query"), {
    id: 900001,
    name: "Fixture account",
    email: "fixture@example.invalid",
    role: "user",
  });
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://127.0.0.1:3000/api/trpc",
        transformer: superjson,
      }),
    ],
  });
  return renderToString(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Router ssrPath={path}>
          <App />
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
};

describe("complete prototype route surfaces", () => {
  for (const route of routes.routes) {
    const path = route.path.replace(":id", "villa");
    it(`renders ${route.title} (${path})`, () => {
      const html = render(path);
      if (path === "/") {
        expect(html).toContain("/register");
        expect(html).not.toContain("app-main");
      } else if (["/login", "/register"].includes(path)) {
        expect(html).not.toContain("app-main");
      } else {
        expect(html).toContain("app-main");
        expect(html).toContain("بروتوتايب تجريبي");
      }
      expect(html).not.toContain("Something went wrong");
      expect(html).not.toContain("Page Not Found");
    });
  }
  it("has every feature F01 to F34 on the roadmap", () => {
    const html = render("/roadmap");
    for (let id = 1; id <= 34; id++)
      expect(html).toContain(`F${String(id).padStart(2, "0")}`);
  });
  it("makes sale units a standalone active primary section with private metadata", () => {
    expect(PRIMARY_PATHS).toContain("/sale-units");
    expect(allNavigation.find(item => item.path === "/sale-units")?.label).toBe(
      "وحدات للبيع"
    );
    expect(phaseFeatureActive("/sale-units")).toBe(true);
    expect(
      routes.routes.find(route => route.path === "/sale-units")?.title
    ).toBe("وحدات للبيع");
    expect(siteMetadata("/sale-units").title).toContain("وحدات للبيع");
    expect(siteMetadata("/sale-units").robots).toBe("noindex,nofollow");
    const html = render("/sale-units");
    expect(html).toContain('data-testid="sale-units-page"');
    expect(html).not.toContain("هذه الخدمة غير مفعلة الآن");
  });
  it("shows asset counts, due days, and monthly collection actions on the dashboard", () => {
    const html = render("/dashboard");
    expect(html).toContain("عدد العقارات");
    expect(html).toContain("عدد الوحدات");
    expect(html).toContain("موعد التحصيل:");
    expect(html).toContain("تم تحصيل إيجار الشهر");
  });
  it("shows invoicing and due-payment actions separately from cash collection", () => {
    const html = render("/billing");
    expect(html).toContain("الفواتير والمستحقات");
    expect(html).toContain("إصدار فاتورة");
    expect(html).toContain("مطالبة بالدفع");
    expect(html).toContain("LPO");
    expect(render("/dashboard")).toContain("إصدار فاتورة");
    expect(render("/collections")).toContain("/billing");
  });
  it("separates portfolio suggestions from the service catalog", () => {
    const html = render("/insights");
    expect(html.replace(/<!--.*?-->/g, "")).toContain(
      "التحليل والاقتراحات · قريبًا"
    );
    expect(html).toContain("هذه الخدمة غير مفعلة الآن");
    expect(html).not.toContain("أفكار المراجعة القابلة للتفسير");
    expect(html).not.toContain("/insights/roadmap");
  });
});
