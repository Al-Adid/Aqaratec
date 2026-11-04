import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTITY_KINDS, type PrototypeState } from "@shared/prototype";
import { validatePrototypeState } from "@shared/prototype-validation";
import { createDemoState } from "./demo-data";
import { normalizePrototype } from "./prototype-normalize";
import {
  LEGACY_PROTOTYPE_STORAGE_KEY,
  loadPrototypeWorkspace,
  prototypeWorkspaceMetadataKey,
  prototypeWorkspaceRecoveryKey,
  prototypeWorkspaceSelectionKey,
  prototypeWorkspaceStorageKey,
  readSelectedLocalWorkspace,
  retainCloudBaseOnRemoteObservation,
  WORKSPACE_ENVELOPE_VERSION,
  writePrototypeWorkspace,
  writePrototypeWorkspaceGuarded,
  writeSelectedLocalWorkspace,
  type BrowserStorage,
} from "./prototype-workspace-storage";

class MemoryStorage implements BrowserStorage {
  readonly values = new Map<string, string>();
  writes: Array<{ key: string; value: string }> = [];
  failWrites = false;
  failOnWrite: number | null = null;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes.push({ key, value });
    if (this.failWrites || this.failOnWrite === this.writes.length)
      throw new Error("QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const scope = (userId: number, localWorkspaceId = "default") => ({
  userId,
  identityState: "authenticated" as const,
  localWorkspaceId,
});
const validState = () => normalizePrototype(createDemoState());
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const row = (id: string) => ({
  ...validState().entities.portfolios[0],
  id,
  portfolioId: id,
});
const compactRow = (id: string) => ({
  id,
  title: "x",
  subtitle: "",
  portfolioId: id,
  propertyId: "",
  status: "x",
  date: "x",
  amountMinor: 0,
  currency: "QAR" as const,
  meta: {},
});

function stateWithRows(kind: keyof PrototypeState["entities"], count: number) {
  const state = validState();
  for (const entityKind of ENTITY_KINDS) state.entities[entityKind] = [];
  state.entities[kind] = Array.from({ length: count }, (_, index) =>
    row(`${String(kind)}-${index}`)
  );
  return state;
}

afterEach(() => vi.unstubAllGlobals());

describe("prototype workspace scoped storage", () => {
  it("preserves corrupt JSON and blocks instead of replacing it with demo data", () => {
    const storage = new MemoryStorage();
    const key = prototypeWorkspaceStorageKey(scope(10));
    const raw = "{corrupt-local-json";
    storage.setItem(key, raw);

    const result = loadPrototypeWorkspace(storage, scope(10));

    expect(result).toMatchObject({ kind: "recovery-required", raw });
    expect(storage.getItem(key)).toBe(raw);
    expect(storage.getItem(prototypeWorkspaceRecoveryKey(scope(10)))).toBe(raw);
  });

  it("enforces 500 per kind and 2000 total using the same contract as the server", () => {
    expect(validatePrototypeState(stateWithRows("portfolios", 500)).success).toBe(true);
    expect(validatePrototypeState(stateWithRows("portfolios", 501)).success).toBe(false);

    const atTotalLimit = validState();
    for (const kind of ENTITY_KINDS) atTotalLimit.entities[kind] = [];
    const kinds = ENTITY_KINDS.slice(0, 4);
    for (const kind of kinds) {
      atTotalLimit.entities[kind] = Array.from({ length: 500 }, (_, index) =>
        compactRow(`${kind}-${index}`)
      );
    }
    expect(validatePrototypeState(atTotalLimit).success).toBe(true);
    atTotalLimit.entities[ENTITY_KINDS[4]].push(compactRow("over-total"));
    expect(validatePrototypeState(atTotalLimit).success).toBe(false);
  });

  it("writes snapshot and metadata in one atomic envelope, never the old metadata key", () => {
    const storage = new MemoryStorage();
    const result = writePrototypeWorkspace(storage, scope(10), validState(), 0, {
      cloudBaseRevision: 4,
    });

    expect(result).toMatchObject({ ok: true, metadata: { generation: 1, cloudBaseRevision: 4 } });
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0].key).toBe(prototypeWorkspaceStorageKey(scope(10)));
    expect(storage.getItem(prototypeWorkspaceMetadataKey(scope(10)))).toBeNull();
    expect(JSON.parse(storage.writes[0].value)).toMatchObject({
      format: "sunnaa-prototype-workspace",
      version: WORKSPACE_ENVELOPE_VERSION,
      scope: { userId: "10", localWorkspaceId: "default", identityState: "authenticated" },
      metadata: { version: 1, generation: 1, cloudBaseRevision: 4 },
      snapshot: validState(),
    });
  });

  it("has no failure window between snapshot and metadata writes", () => {
    const storage = new MemoryStorage();
    const first = writePrototypeWorkspace(storage, scope(10), validState(), 0);
    expect(first.ok).toBe(true);
    const before = storage.getItem(prototypeWorkspaceStorageKey(scope(10)));
    storage.failOnWrite = storage.writes.length + 1;

    const changed = clone(validState());
    changed.entities.portfolios[0].title = "لن تحفظ كتابة جزئية";
    const second = writePrototypeWorkspace(storage, scope(10), changed, 1);

    expect(second).toMatchObject({ ok: false, reason: "storage-unavailable" });
    expect(storage.getItem(prototypeWorkspaceStorageKey(scope(10)))).toBe(before);
    expect(storage.getItem(prototypeWorkspaceMetadataKey(scope(10)))).toBeNull();
    expect(loadPrototypeWorkspace(storage, scope(10))).toMatchObject({
      kind: "ready",
      metadata: { generation: 1 },
    });
  });

  it("reads old v2 snapshot plus metadata without an automatic rewrite", () => {
    const storage = new MemoryStorage();
    const oldState = validState();
    const key = prototypeWorkspaceStorageKey(scope(10));
    const raw = JSON.stringify(oldState);
    storage.setItem(key, raw);
    storage.setItem(
      prototypeWorkspaceMetadataKey(scope(10)),
      JSON.stringify({ version: 1, generation: 7, cloudBaseRevision: 3 })
    );
    const writeCountBeforeRead = storage.writes.length;

    const loaded = loadPrototypeWorkspace(storage, scope(10));

    expect(loaded).toMatchObject({
      kind: "ready",
      source: "legacy-v2",
      metadata: { generation: 7, cloudBaseRevision: 3 },
    });
    expect(storage.getItem(key)).toBe(raw);
    expect(storage.writes).toHaveLength(writeCountBeforeRead);
  });

  it("refuses an envelope attributed to another identity and keeps its original raw value", () => {
    const storage = new MemoryStorage();
    expect(writePrototypeWorkspace(storage, scope(1), validState(), 0).ok).toBe(true);
    const foreignRaw = storage.getItem(prototypeWorkspaceStorageKey(scope(1)))!;
    const targetKey = prototypeWorkspaceStorageKey(scope(2));
    storage.setItem(targetKey, foreignRaw);

    const loaded = loadPrototypeWorkspace(storage, scope(2));

    expect(loaded).toMatchObject({ kind: "recovery-required", reason: "identity-mismatch" });
    expect(storage.getItem(targetKey)).toBe(foreignRaw);
    expect(storage.getItem(prototypeWorkspaceRecoveryKey(scope(2)))).toBe(foreignRaw);
  });

  it("requires expected generation so stale direct writers cannot overwrite", () => {
    const storage = new MemoryStorage();
    const first = writePrototypeWorkspace(storage, scope(10), validState(), 0);
    expect(first.ok).toBe(true);
    const before = storage.getItem(prototypeWorkspaceStorageKey(scope(10)));
    const secondSnapshot = clone(validState());
    secondSnapshot.entities.portfolios[0].title = "تعديل التبويب الثاني";
    const second = writePrototypeWorkspace(storage, scope(10), secondSnapshot, 0);

    expect(second).toMatchObject({ ok: false, reason: "generation-conflict" });
    expect(storage.getItem(prototypeWorkspaceStorageKey(scope(10)))).toBe(before);
  });

  it("uses the browser Web Lock guarded writer for two-tab QA and lets only one stale generation win", async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: async <T,>(
          name: string,
          _options: LockOptions,
          callback: () => T | Promise<T>
        ) => {
          requests.push(name);
          return callback();
        },
      },
    });
    const firstSnapshot = validState();
    const secondSnapshot = clone(firstSnapshot);
    secondSnapshot.entities.portfolios[0].title = "تبويب ثانٍ";

    const [first, second] = await Promise.all([
      writePrototypeWorkspaceGuarded(storage, scope(10), firstSnapshot, 0),
      writePrototypeWorkspaceGuarded(storage, scope(10), secondSnapshot, 0),
    ]);

    expect(requests).toHaveLength(2);
    expect(first).toMatchObject({ ok: true, metadata: { generation: 1 } });
    expect(second).toMatchObject({ ok: false, reason: "generation-conflict" });
    expect(loadPrototypeWorkspace(storage, scope(10))).toMatchObject({
      kind: "ready",
      metadata: { generation: 1 },
    });
  });

  it("keeps selected local workspaces isolated by identity", () => {
    const storage = new MemoryStorage();
    expect(writeSelectedLocalWorkspace(storage, scope(1), "local-a")).toEqual({ ok: true });
    expect(readSelectedLocalWorkspace(storage, scope(1))).toBe("local-a");
    expect(readSelectedLocalWorkspace(storage, scope(2))).toBeNull();
    expect(prototypeWorkspaceSelectionKey(scope(1))).not.toBe(
      prototypeWorkspaceSelectionKey(scope(2))
    );
  });

  it("does not cross account or local-workspace namespaces and never assigns legacy data", () => {
    const storage = new MemoryStorage();
    const first = validState();
    first.entities.portfolios[0].title = "حساب ١";
    expect(writePrototypeWorkspace(storage, scope(1), first, 0).ok).toBe(true);
    storage.setItem(LEGACY_PROTOTYPE_STORAGE_KEY, JSON.stringify(validState()));

    expect(loadPrototypeWorkspace(storage, scope(2))).toMatchObject({
      kind: "legacy-warning",
    });
    expect(loadPrototypeWorkspace(storage, scope(1, "separate"))).toMatchObject({
      kind: "legacy-warning",
    });
    const firstAccount = loadPrototypeWorkspace(storage, scope(1));
    expect(firstAccount.kind).toBe("ready");
    if (firstAccount.kind === "ready")
      expect(firstAccount.state.entities.portfolios[0].title).toBe("حساب ١");
  });

  it("never treats an observed remote revision as the local cloud baseline", () => {
    expect(retainCloudBaseOnRemoteObservation(1, 2)).toBe(1);
    expect(retainCloudBaseOnRemoteObservation(null, 7)).toBeNull();
  });
});
