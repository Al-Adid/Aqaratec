// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { PrototypeProvider } from "@/contexts/PrototypeContext";
vi.mock("./CloudWorkspace", () => ({ CloudWorkspace: () => null }));
vi.mock("./WorkspaceStorageBanner", () => ({
  WorkspaceStorageBanner: () => null,
}));
import { AppFrame } from "./AppFrame";
describe("P01 stage1 shell", () => {
  it("renders primary navigation, deferred badges and declared clock without any scope ReferenceError", () => {
    const queryClient = new QueryClient();
    const trpcClient = trpc.createClient({
      links: [
        httpBatchLink({
          url: "http://127.0.0.1:3000/api/trpc",
          transformer: superjson,
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <PrototypeProvider>
            <AppFrame>
              <div>محتوى اختبار مصطنع</div>
            </AppFrame>
          </PrototypeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    );
    expect(html).toContain("المرحلة الأولى");
    expect(html).toContain("قريبًا");
    expect(html).toContain("تاريخ السيناريو");
    expect(html).toContain("2026-10-24");
    expect(html).toContain("محتوى اختبار مصطنع");
  });
});
