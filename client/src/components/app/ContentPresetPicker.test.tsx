// @vitest-environment jsdom
import React, { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  PrototypeProvider,
  usePrototype,
  type PrototypeWorkspaceIdentity,
} from "@/contexts/PrototypeContext";
import { ContentPresetPicker } from "./ContentPresetPicker";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
let parentSubmits = 0;

function Harness() {
  const [value, setValue] = useState("");
  api = usePrototype();
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        parentSubmits += 1;
      }}
    >
      <ContentPresetPicker
        label="محتويات الوحدة"
        value={value}
        onChange={setValue}
      />
    </form>
  );
}

async function mount(identity?: PrototypeWorkspaceIdentity) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PrototypeProvider identity={identity}>
        <Harness />
      </PrototypeProvider>
    );
  });
}

async function remount(identity?: PrototypeWorkspaceIdentity) {
  await act(async () => root.unmount());
  host.remove();
  await mount(identity);
}

function input(): HTMLInputElement {
  const field = host.querySelector<HTMLInputElement>("input");
  expect(field).toBeTruthy();
  return field!;
}

function select(): HTMLSelectElement {
  const field = host.querySelector<HTMLSelectElement>("select");
  expect(field).toBeTruthy();
  return field!;
}

function saveButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    item => item.textContent?.includes("إضافة وحفظ الخيار")
  );
  expect(button).toBeTruthy();
  return button!;
}

function setInput(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  parentSubmits = 0;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  localStorage.clear();
});

describe("ContentPresetPicker", () => {
  it("saves a custom choice into the current workspace, reuses it after a remount, and never submits its parent form", async () => {
    await mount();
    const field = input();
    await act(async () => setInput(field, "  غرفة غسيل خاصة  "));

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => field.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(parentSubmits).toBe(0);

    expect(saveButton().type).toBe("button");
    await act(async () => {
      saveButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(parentSubmits).toBe(0);
    expect(api.state.settings.contentPresets).toEqual(["غرفة غسيل خاصة"]);
    expect(select().value).toBe("غرفة غسيل خاصة");
    expect(host.textContent).toContain("لا يحفظ العقار أو الوحدة");

    await remount();
    expect(
      [...select().options].map(option => option.value)
    ).toContain("غرفة غسيل خاصة");
  });

  it("surfaces input validation and keeps a trimmed duplicate out of the saved list", async () => {
    await mount();
    await act(async () => setInput(input(), "   "));
    await act(async () => saveButton().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("غير فارغ");

    await act(async () => setInput(input(), "و".repeat(161)));
    await act(async () => saveButton().click());
    expect(host.textContent).toContain("160");
    expect(api.state.settings.contentPresets).toBeUndefined();

    await act(async () => setInput(input(), " مستودع داخلي "));
    await act(async () => saveButton().click());
    await act(async () => setInput(input(), "مستودع داخلي"));
    await act(async () => saveButton().click());
    expect(api.state.settings.contentPresets).toEqual(["مستودع داخلي"]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "مكرر"
    );
  });

  it("disables in a read-only role and does not leak a saved choice to a different workspace identity", async () => {
    const firstIdentity: PrototypeWorkspaceIdentity = {
      status: "authenticated",
      userId: 101,
      localWorkspaceId: "contents-a",
    };
    await mount(firstIdentity);
    await act(async () => setInput(input(), "غرفة ألعاب"));
    await act(async () => {
      saveButton().click();
      await Promise.resolve();
    });
    expect(api.state.settings.contentPresets).toEqual(["غرفة ألعاب"]);

    const secondIdentity: PrototypeWorkspaceIdentity = {
      status: "authenticated",
      userId: 202,
      localWorkspaceId: "contents-b",
    };
    await remount(secondIdentity);
    expect([...select().options].some(option => option.value === "غرفة ألعاب")).toBe(
      false
    );

    await act(async () => api.setSetting("role", "owner"));
    expect(select().disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });
});
