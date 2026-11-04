// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import {
  prototypeWorkspaceBackupKey,
  prototypeWorkspaceMetadataKey,
  prototypeWorkspaceRecoveryKey,
  prototypeWorkspaceStorageKey,
} from "@/lib/prototype-workspace-storage";

vi.mock("@/components/app/AdvisorExplanation", () => ({
  AdvisorExplanation: () => null,
}));

import { OpportunityHunterPage } from "./OpportunityHunterPage";
import { RealEstateAdvisorPage } from "./RealEstateAdvisorPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Mounted = { root: Root; host: HTMLDivElement };
let mounted: Mounted | null = null;
let api: ReturnType<typeof usePrototype>;
const TEST_IDENTITY = {
  status: "guest" as const,
  userId: null,
  localWorkspaceId: "advisor-ui-regression",
};

function clearTestWorkspace() {
  localStorage.removeItem(prototypeWorkspaceStorageKey(TEST_IDENTITY));
  localStorage.removeItem(prototypeWorkspaceMetadataKey(TEST_IDENTITY));
  localStorage.removeItem(prototypeWorkspaceRecoveryKey(TEST_IDENTITY));
  localStorage.removeItem(prototypeWorkspaceBackupKey(TEST_IDENTITY));
}

function AdvisorHarness() {
  api = usePrototype();
  return <RealEstateAdvisorPage />;
}

function HunterHarness() {
  api = usePrototype();
  return <OpportunityHunterPage />;
}

function inputFor(labelText: string): HTMLInputElement {
  const label = [...document.querySelectorAll("label")].find(label =>
    label.textContent?.includes(labelText)
  );
  const input = label?.querySelector("input");
  if (!(input instanceof HTMLInputElement))
    throw new Error(`Missing input: ${labelText}`);
  return input;
}

async function change(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
    input,
    value
  );
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(button =>
    button.textContent?.includes(label)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

async function mount(child: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () =>
    root.render(
      <PrototypeProvider identity={TEST_IDENTITY}>{child}</PrototypeProvider>
    )
  );
  return host;
}

beforeEach(clearTestWorkspace);
afterEach(async () => {
  if (mounted) await act(async () => mounted?.root.unmount());
  mounted?.host.remove();
  mounted = null;
  clearTestWorkspace();
});

describe("advisory invalid draft render regression", () => {
  it("keeps the real-estate calculator mounted and marks invalid duration, decimal duration, and loan drafts", async () => {
    const host = await mount(<AdvisorHarness />);
    const portfolio = document.querySelector<HTMLSelectElement>("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      portfolio,
      "family"
    );
    await act(async () => portfolio.dispatchEvent(new Event("change", { bubbles: true })));
    await click("خطتك");

    await change(inputFor("مدة البناء"), "0");
    await change(inputFor("مدة التسويق"), "0");
    expect(host.textContent).toContain("يجب أن تكون مدة البناء أو التسويق");
    expect(inputFor("مدة البناء").value).toBe("0");
    expect(
      host.textContent?.includes("النتيجة السابقة") ||
        host.textContent?.includes("أصلح الحقول")
    ).toBe(true);

    await change(inputFor("مدة البناء"), "1.5");
    expect(host.textContent).toContain("عددًا صحيحًا");
    expect(inputFor("مدة البناء").value).toBe("1.5");

    await change(inputFor("مدة البناء"), "12");
    await change(inputFor("مدة التسويق"), "6");
    await change(inputFor("أصل الدين عند الخروج"), "9999999");
    expect(host.textContent).toContain("أصل التمويل لا يمكن أن يتجاوز");
    expect(inputFor("أصل الدين عند الخروج").value).toBe("9999999");
  });

  it("keeps the hunter comparison mounted for a 101% stress draft, hides invalid output, and disables persistence", async () => {
    const host = await mount(<HunterHarness />);
    await click("محاكاة المسح");
    await click("اختيار");
    await click("المقارنة والحساسية");
    await change(inputFor("هبوط سعر البيع"), "101");

    expect(host.textContent).toContain("بين 0 و100");
    expect(inputFor("هبوط سعر البيع").value).toBe("101");
    expect(host.textContent).toContain("احتفظنا بالمسودة");
    expect(host.querySelector(".hunter-comparison-table")).toBeNull();
    expect(
      api.state.entities.plans.filter(row => row.meta.recordType === "hunter-brief")
    ).toHaveLength(0);
  });

  it("shows the actual operating window, zero-month coverage, and risk inputs without assuming sustainable income", async () => {
    const host = await mount(<AdvisorHarness />);
    const portfolio = document.querySelector<HTMLSelectElement>("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      portfolio,
      "family"
    );
    await act(async () => portfolio.dispatchEvent(new Event("change", { bubbles: true })));
    await change(inputFor("بداية نافذة التشغيل"), "2026-01");
    await change(inputFor("نهاية نافذة التشغيل"), "2026-12");
    await click("وضعك");

    expect(host.textContent).toContain("نافذة القياس الفعلية");
    expect(host.textContent).toContain("2026-01 إلى 2026-12");
    expect(host.textContent).toContain("الأشهر الصفرية/المرصودة");
    expect(host.textContent).toContain("مدخلات المخاطر");
    expect(host.textContent).toContain("لا يُفترض دخل مستدام");
  });

  it("shows separate confirmed and potential funding with the recorded source and missing verification date", async () => {
    const host = await mount(<HunterHarness />);
    await click("محاكاة المسح");

    expect(host.textContent).toContain("مصدر: 2026-10-20");
    expect(host.textContent).toContain("تحقق: غير مسجل");
    expect(host.textContent).toContain("مصادر التمويل المؤكدة");
    expect(host.textContent).toContain("تمويل محتمل مشروط");
    expect(host.textContent).toContain("العجز المؤكد (نقد + اعتماد فقط)");
    expect(host.textContent).toContain("الملاءمة الاقتصادية لهدف");
  });
});
