// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
    .set!
    .call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LandingPage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("LandingPage public SSR", () => {
  it("renders without application providers and includes every F01-F34 service", () => {
    const html = renderToString(<LandingPage />);

    for (let number = 1; number <= 34; number += 1) {
      const id = `F${String(number).padStart(2, "0")}`;
      expect(html).toContain(`data-service-id=\"${id}\"`);
    }

    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/demo"');
  });
});

describe("LandingPage service directory", () => {
  it("searches services and combines availability and category filters in an isolated ReactDOM tree", async () => {
    const search = host.querySelector<HTMLInputElement>("#sf-service-search")!;

    await act(async () => setInputValue(search, "خزنة الوثائق"));
    expect(host.querySelector('[data-service-id="F13"]')).toBeTruthy();
    expect(host.querySelector('[data-service-id="F01"]')).toBeNull();

    await act(async () => setInputValue(search, ""));
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-availability-filter="upcoming"]')!
        .click()
    );
    expect(host.querySelector('[data-service-id="F16"]')).toBeTruthy();
    expect(host.querySelector('[data-service-id="F02"]')).toBeNull();

    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-availability-filter="all"]')!
        .click()
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[data-service-category="الماليات والتقارير"]'
        )!
        .click()
    );

    expect(host.querySelector('[data-service-id="F06"]')).toBeTruthy();
    expect(host.querySelector('[data-service-id="F02"]')).toBeNull();
  });

  it("shows a clear accessible no-results message and can reset filters", async () => {
    const search = host.querySelector<HTMLInputElement>("#sf-service-search")!;
    await act(async () => setInputValue(search, "خدمة غير موجودة تمامًا"));

    expect(host.textContent).toContain("لا توجد خدمات مطابقة للبحث أو التصفية الحالية.");
    const reset = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      button => button.textContent?.includes("إعادة ضبط البحث والفلاتر")
    );
    expect(reset).toBeTruthy();

    await act(async () => reset!.click());
    expect(host.querySelector('[data-service-id="F01"]')).toBeTruthy();
  });
});
