// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  AssetTransitionError,
  PrototypeProvider,
  usePrototype,
} from "./PrototypeContext";
import { createDemoState } from "@/lib/demo-data";
import { normalizePrototype } from "@/lib/prototype-normalize";
import {
  prototypeWorkspaceMetadataKey,
  prototypeWorkspaceRecoveryKey,
  prototypeWorkspaceSelectionKey,
  prototypeWorkspaceStorageKey,
  writePrototypeWorkspace,
} from "@/lib/prototype-workspace-storage";
import type { PrototypeState } from "@shared/prototype";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof usePrototype>;
const guestScope = { userId: null, identityState: "guest" as const };
const accountScope = (userId: number) => ({
  userId,
  identityState: "authenticated" as const,
});
function Harness() {
  api = usePrototype();
  return <div>{api.storage.kind}</div>;
}
async function render(
  identity?: React.ComponentProps<typeof PrototypeProvider>["identity"]
) {
  await act(async () => {
    root.render(
      <PrototypeProvider identity={identity}>
        <Harness />
      </PrototypeProvider>
    );
  });
}
async function mount(identity?: React.ComponentProps<typeof PrototypeProvider>["identity"]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(identity);
}

function assetPropertyTransition(title: string) {
  return (current: PrototypeState) => {
    const source = current.entities.properties[0]!;
    const id = `asset-${title}`;
    return {
      state: {
        ...current,
        entities: {
          ...current.entities,
          properties: [
            ...current.entities.properties,
            {
              ...source,
              id,
              propertyId: id,
              title,
              meta: { ...source.meta },
            },
          ],
        },
      },
      result: id,
    };
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

describe("PrototypeProvider storage safety", () => {
  it("does not overwrite corrupt JSON on mount and exposes recovery", async () => {
    const raw = "{not-json";
    const key = prototypeWorkspaceStorageKey(guestScope);
    localStorage.setItem(key, raw);

    await mount();

    expect(api.storage.kind).toBe("recovery-required");
    expect(api.canEdit).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(localStorage.getItem(prototypeWorkspaceRecoveryKey(guestScope))).toBe(raw);
  });

  it("does not overwrite a >1000 row invalid snapshot on mount", async () => {
    const invalid = normalizePrototype(createDemoState());
    invalid.entities.portfolios = Array.from({ length: 1_001 }, (_, index) => ({
      ...invalid.entities.portfolios[0],
      id: `too-many-${index}`,
      portfolioId: `too-many-${index}`,
    }));
    const raw = JSON.stringify(invalid);
    const key = prototypeWorkspaceStorageKey(guestScope);
    localStorage.setItem(key, raw);

    await mount();

    expect(api.storage.kind).toBe("recovery-required");
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("keeps edits in memory and exportable after quota failure", async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (key.startsWith("sunnaa-full-prototype-v2"))
        throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });
    await mount();

    await act(async () => {
      api.add("tasks", { title: "يبقى في الذاكرة", portfolioId: "family" });
    });

    expect(api.storage.kind).toBe("memory-only");
    expect(api.state.entities.tasks.some(row => row.title === "يبقى في الذاكرة")).toBe(true);
    expect(api.exportWorkspace()).toContain("يبقى في الذاكرة");
  });

  it("isolates two authenticated account scopes in one browser", async () => {
    const first = normalizePrototype(createDemoState());
    first.entities.portfolios[0].title = "مساحة الحساب الأول";
    localStorage.setItem(
      prototypeWorkspaceStorageKey(accountScope(1)),
      JSON.stringify(first)
    );
    await mount({ status: "authenticated", userId: 2 });

    expect(api.identity.userId).toBe(2);
    expect(api.state.entities.portfolios.some(row => row.title === "مساحة الحساب الأول")).toBe(false);
    expect(localStorage.getItem(prototypeWorkspaceStorageKey(accountScope(1)))).toContain(
      "مساحة الحساب الأول"
    );
  });

  it("blocks writes after another tab changes the scoped local metadata", async () => {
    await mount();
    const beforeTitle = api.state.entities.portfolios[0].title;
    const key = prototypeWorkspaceMetadataKey(guestScope);
    // Compatibility listener still protects against an old v2 tab completing
    // its legacy metadata write; P10 itself no longer emits this key.
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, generation: 99, cloudBaseRevision: null })
    );
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });

    expect(api.storage.kind).toBe("external-change");
    expect(api.state.entities.portfolios[0].title).toBe(beforeTitle);
    expect(() =>
      api.add("tasks", { title: "لا يكتب فوق تبويب آخر", portfolioId: "family" })
    ).toThrow();
  });

  it("keeps cloud base R1 when R2 is only observed, and binds R2 only after explicit load", async () => {
    await mount({ status: "authenticated", userId: 7 });
    const source = normalizePrototype(createDemoState());
    await act(async () => {
      expect(await api.adoptCloudWorkspace(source, 1)).toBe(true);
    });
    expect(api.cloudBaseline.revision).toBe(1);
    // A CloudWorkspace refresh passes an observed R2 through this rule; it must
    // not call an adoption/binding method and therefore cannot change the base.
    expect(api.cloudBaseline.revision).toBe(1);
    await act(async () => {
      expect(await api.adoptCloudWorkspace(source, 2)).toBe(true);
    });
    expect(api.cloudBaseline.revision).toBe(2);
  });

  it("restores validated JSON to a new selected workspace without replacing the previous scope", async () => {
    await mount({ status: "authenticated", userId: 9 });
    await act(async () => {
      const portfolio = api.add("portfolios", { title: "محفظة الحساب 9" });
      api.add("tasks", { title: "يبقى في المساحة السابقة", portfolioId: portfolio.id });
      await api.retryLocalPersistence();
    });
    const previousKey = api.identity.storageKey;
    const previousRaw = localStorage.getItem(previousKey);
    const restored = normalizePrototype(createDemoState());
    restored.entities.portfolios[0].title = "هوية مستعادة بلا تغيير";
    const portfolioId = restored.entities.portfolios[0].id;

    await act(async () => {
      expect(await api.restoreExportToNewWorkspace(restored)).toBe(true);
    });

    expect(api.identity.storageKey).not.toBe(previousKey);
    expect(api.state.entities.portfolios[0]).toMatchObject({
      id: portfolioId,
      title: "هوية مستعادة بلا تغيير",
    });
    expect(localStorage.getItem(previousKey)).toBe(previousRaw);
    expect(localStorage.getItem(prototypeWorkspaceSelectionKey(accountScope(9)))).toContain(
      api.identity.localWorkspaceId
    );
  });

  it("rejects generic all-scope writes instead of selecting the first portfolio", async () => {
    await mount();
    expect(() => api.add("tasks", { title: "نطاق غير محدد" })).toThrow("اختر محفظة");
    expect(() =>
      api.add("tasks", { title: "نطاق all غير صالح", portfolioId: "all" })
    ).toThrow("اختر محفظة");
  });

  it("commits an asset transition to durable storage before exposing it and reloads it after remount", async () => {
    await mount();
    let savedId = "";

    await act(async () => {
      savedId = await api.commitAssetTransition(
        assetPropertyTransition("عقار محفوظ دائمًا")
      );
    });

    expect(api.state.entities.properties.some(row => row.id === savedId)).toBe(true);
    const storageKey = api.identity.storageKey;
    const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as {
      snapshot?: PrototypeState;
      metadata?: { generation?: number };
    };
    expect(envelope.snapshot?.entities.properties.some(row => row.id === savedId)).toBe(true);
    expect(envelope.metadata?.generation).toBeGreaterThan(0);

    await act(async () => root.unmount());
    host.remove();
    await mount();

    expect(api.state.entities.properties.some(row => row.id === savedId)).toBe(true);
  });

  it("keeps the asset form transition out of memory when local quota persistence fails", async () => {
    await mount();
    await act(async () => {
      await api.retryLocalPersistence();
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (key.startsWith("sunnaa-full-prototype-v2"))
        throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });

    const pending = api.commitAssetTransition(
      assetPropertyTransition("لن يحفظ بسبب السعة")
    );

    let caught: unknown;
    await act(async () => {
      try {
        await pending;
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toMatchObject({
      name: "AssetTransitionError",
      code: "write-failed",
      assetCommitted: false,
    });
    expect(
      api.state.entities.properties.some(row => row.title === "لن يحفظ بسبب السعة")
    ).toBe(false);
    expect(api.storage.kind).toBe("memory-only");
  });

  it("denies durable asset commits in a read-only role without changing state", async () => {
    await mount();
    await act(async () => {
      api.setSetting("role", "owner");
    });

    const pending = api.commitAssetTransition(
      assetPropertyTransition("لا يحفظ للقارئ")
    );

    await expect(pending).rejects.toBeInstanceOf(AssetTransitionError);
    await expect(pending).rejects.toMatchObject({
      code: "not-permitted",
      assetCommitted: false,
    });
    expect(api.state.entities.properties.some(row => row.title === "لا يحفظ للقارئ")).toBe(
      false
    );
  });

  it("serializes two asset commits so the second transition evaluates against the first durable result", async () => {
    await mount();
    let results: string[] = [];

    await act(async () => {
      results = await Promise.all([
        api.commitAssetTransition(assetPropertyTransition("الأصل الأول")),
        api.commitAssetTransition(assetPropertyTransition("الأصل الثاني")),
      ]);
    });

    expect(results).toEqual(["asset-الأصل الأول", "asset-الأصل الثاني"]);
    expect(
      api.state.entities.properties.map(row => row.title)
    ).toEqual(expect.arrayContaining(["الأصل الأول", "الأصل الثاني"]));
    const envelope = JSON.parse(
      localStorage.getItem(api.identity.storageKey) ?? "{}"
    ) as { snapshot?: PrototypeState };
    expect(envelope.snapshot?.entities.properties.map(row => row.title)).toEqual(
      expect.arrayContaining(["الأصل الأول", "الأصل الثاني"])
    );
  });

  it("marks a successful durable write as assetCommitted if a role update blocks acknowledgement", async () => {
    await mount();
    await act(async () => {
      await api.retryLocalPersistence();
    });
    let changedRole = false;
    vi.stubGlobal("navigator", {
      userAgent: "jsdom",
      locks: {
        request: async <T,>(
          _name: string,
          _options: LockOptions,
          callback: () => T | Promise<T>
        ) => {
          const result = await callback();
          // This happens after the atomic local replacement but before the
          // asset promise can acknowledge it in React.
          if (!changedRole) {
            changedRole = true;
            api.setSetting("role", "owner");
          }
          return result;
        },
      },
    });

    let caught: unknown;
    await act(async () => {
      try {
        await api.commitAssetTransition(
          assetPropertyTransition("مرجع ملف لا يحذف")
        );
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(AssetTransitionError);
    expect(caught).toMatchObject({
      code: "acknowledgement-blocked",
      assetCommitted: true,
    });
    expect(
      api.state.entities.properties.some(row => row.title === "مرجع ملف لا يحذف")
    ).toBe(false);
  });

  it("does not persist a queued asset snapshot after a newer generic memory transition wins", async () => {
    await mount();
    await act(async () => {
      await api.retryLocalPersistence();
    });
    let runFirstLockedWrite: (() => void) | undefined;
    let requests = 0;
    vi.stubGlobal("navigator", {
      userAgent: "jsdom",
      locks: {
        request: <T,>(
          _name: string,
          _options: LockOptions,
          callback: () => T | Promise<T>
        ): Promise<T> => {
          requests += 1;
          if (requests !== 1) return Promise.resolve(callback());
          return new Promise<T>(resolve => {
            runFirstLockedWrite = () => resolve(callback());
          });
        },
      },
    });

    const pending = api.commitAssetTransition(
      assetPropertyTransition("لقطة قديمة لا تكتب")
    );
    await act(flushMicrotasks);
    expect(runFirstLockedWrite).toBeTypeOf("function");

    await act(async () => {
      api.commitTransition(assetPropertyTransition("تعديل ذاكرة أحدث"));
      runFirstLockedWrite?.();
      await flushMicrotasks();
    });

    await expect(pending).rejects.toMatchObject({
      code: "stale-source",
      assetCommitted: false,
    });
    await act(async () => {
      await api.retryLocalPersistence();
    });
    const envelope = JSON.parse(
      localStorage.getItem(api.identity.storageKey) ?? "{}"
    ) as { snapshot?: PrototypeState };
    expect(
      envelope.snapshot?.entities.properties.some(
        row => row.title === "لقطة قديمة لا تكتب"
      )
    ).toBe(false);
    expect(
      envelope.snapshot?.entities.properties.some(
        row => row.title === "تعديل ذاكرة أحدث"
      )
    ).toBe(true);
  });

  it("rejects a generation conflict without adding the asset transition to memory", async () => {
    await mount();
    await act(async () => {
      await api.retryLocalPersistence();
    });
    const external = assetPropertyTransition("نسخة تبويب آخر")(api.state).state;
    expect(
      writePrototypeWorkspace(
        localStorage,
        guestScope,
        external,
        api.storage.generation
      )
    ).toMatchObject({ ok: true });

    const pending = api.commitAssetTransition(
      assetPropertyTransition("لا يتجاوز تعارض الجيل")
    );

    let caught: unknown;
    await act(async () => {
      try {
        await pending;
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toMatchObject({
      code: "generation-conflict",
      assetCommitted: false,
    });
    expect(
      api.state.entities.properties.some(row => row.title === "لا يتجاوز تعارض الجيل")
    ).toBe(false);
    expect(api.storage.kind).toBe("external-change");
  });

  it("rejects a queued asset transition on workspace switch before any old-scope write", async () => {
    await mount({ status: "authenticated", userId: 31 });
    await act(async () => {
      const portfolio = api.add("portfolios", { title: "محفظة الحساب 31" });
      api.add("properties", { title: "عقار الحساب 31", portfolioId: portfolio.id });
      await api.retryLocalPersistence();
    });
    const oldScopeKey = api.identity.storageKey;
    let runFirstLockedWrite: (() => void) | undefined;
    let requests = 0;
    vi.stubGlobal("navigator", {
      userAgent: "jsdom",
      locks: {
        request: <T,>(
          _name: string,
          _options: LockOptions,
          callback: () => T | Promise<T>
        ): Promise<T> => {
          requests += 1;
          if (requests !== 1) return Promise.resolve(callback());
          return new Promise(resolve => {
            runFirstLockedWrite = () => resolve(callback());
          });
        },
      },
    });

    const pending = api.commitAssetTransition(
      assetPropertyTransition("لا ينقل بين المساحات")
    );
    await act(flushMicrotasks);
    expect(runFirstLockedWrite).toBeTypeOf("function");

    await render({ status: "authenticated", userId: 32 });
    runFirstLockedWrite?.();

    await expect(pending).rejects.toMatchObject({
      code: "scope-changed",
      assetCommitted: false,
    });
    expect(localStorage.getItem(oldScopeKey)).not.toContain("لا ينقل بين المساحات");
  });
});
