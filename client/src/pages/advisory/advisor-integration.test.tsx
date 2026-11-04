// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/app/AdvisorExplanation", () => ({
  AdvisorExplanation: () => <p>شرح اختياري معزول</p>,
}));
import { PrototypeProvider, usePrototype } from "@/contexts/PrototypeContext";
import { RealEstateAdvisorPage } from "./RealEstateAdvisorPage";
import { diagnoseAdvisor, profileFromEntity } from "@shared/advisor-engine";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, api: ReturnType<typeof usePrototype>;
function Harness() {
  api = usePrototype();
  return <RealEstateAdvisorPage />;
}
beforeEach(async () => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <PrototypeProvider>
        <Harness />
      </PrototypeProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});
const click = async (label: string) => {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(b => b.textContent?.includes(label))!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
const change = async (
  input: HTMLInputElement | HTMLSelectElement,
  value: string
) => {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  await act(async () =>
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    )
  );
};
const choose = () =>
  change(container.querySelector<HTMLSelectElement>("select")!, "family");
describe("actual advisor calculation and persistence journey", () => {
  it("does not choose another portfolio or calculate all by default", async () => {
    expect(container.textContent).toContain("اختر محفظة مستقلة أولاً");
    await click("خطتك");
    expect(container.textContent).not.toContain("ثلاثة مسارات استباقية");
    expect(
      api.state.entities.plans.some(
        p => p.meta.recordType === "advisor-profile"
      )
    ).toBe(false);
  });
  it("preserves original target and archives a reasoned change", async () => {
    await choose();
    await click("وضعك");
    await click("حفظ التشخيص");
    const old = api.state.entities.plans.find(
      p => p.meta.recordType === "advisor-profile"
    )!;
    const originalTarget = Number(old.meta.targetMinor);
    await click("هدفك");
    const label = [...container.querySelectorAll("label")].find(l =>
      l.textContent?.includes("صافي الثروة المستهدفة")
    )!;
    await change(
      label.querySelector("input")!,
      String((originalTarget * 2) / 100)
    );
    expect(label.querySelector("input")?.value).toBe(
      String((originalTarget * 2) / 100)
    );
    await click("وضعك");
    await click("حفظ التشخيص");
    expect(container.textContent).toContain("سبب إنشاء إصدار الخطة مطلوب");
    expect(
      api.state.entities.plans.some(
        p => p.meta.recordType === "advisor-profile-version"
      )
    ).toBe(false);
    const reason = [...container.querySelectorAll("label")].find(l =>
      l.textContent?.includes("سبب تعديل التشخيص")
    )!;
    await change(
      reason.querySelector("input")!,
      "زاد الهدف بعد مراجعة الموارد"
    );
    expect(reason.querySelector("input")?.value).toBe(
      "زاد الهدف بعد مراجعة الموارد"
    );
    await click("حفظ التشخيص");
    expect(container.textContent).toContain("حُفظ إصدار جديد وتاريخ المراجعة");
    const updated = api.state.entities.plans.find(
      p => p.meta.recordType === "advisor-profile"
    )!;
    expect(updated.id).not.toBe(old.id);
    expect(updated.meta.originalTargetMinor).toBe(originalTarget);
    expect(updated.meta.targetMinor).toBe(originalTarget * 2);
    const archive = api.state.entities.plans.find(
      p => p.id === old.id && p.meta.recordType === "advisor-profile-version"
    )!;
    expect(archive.amountMinor).toBe(originalTarget);
    expect(archive.meta.targetMinor).toBe(originalTarget);
    expect(updated.meta.changeReason).toContain("زاد الهدف");
    expect(updated.meta.supersedesId).toBe(archive.id);
    const review = api.state.entities.reviews.find(
      r =>
        r.meta.priorProfileId === archive.id && r.meta.profileId === updated.id
    )!;
    expect(review.meta.reason).toContain("زاد الهدف");
    expect(review.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(archive.meta).length).toBeLessThanOrEqual(32);
  });
  it("uses actual plan liquidity for a new search and displays returned feedback", async () => {
    await choose();
    await click("وضعك");
    await click("حفظ التشخيص");
    const profileRow = api.state.entities.plans.find(
      p => p.meta.recordType === "advisor-profile"
    )!;
    const expected = diagnoseAdvisor(
      profileFromEntity(profileRow),
      api.state.entities
    ).investableCashMinor;
    const collectionCount = api.state.entities.collections.length;
    await click("المتابعة");
    await click("إنشاء موجز للقناص");
    const brief = api.state.entities.plans.find(
      p => p.meta.recordType === "hunter-brief"
    )!;
    expect(brief.meta.cashBudgetMinor).toBe(expected);
    expect(brief.meta.sourcePlanId).toBe(profileRow.id);
    expect(api.state.entities.collections.length).toBe(collectionCount);
    await act(async () =>
      api.add("reviews", {
        title: "ملاحظة القناص",
        portfolioId: "family",
        meta: {
          recordType: "hunter-feedback",
          profileId: profileRow.id,
          sourcePlanId: profileRow.id,
          reason: "رفع تكلفة الفرصة للمراجعة",
          opportunityId: "op1",
        },
      })
    );
    expect(container.textContent).toContain("رفع تكلفة الفرصة للمراجعة");
  });
});
