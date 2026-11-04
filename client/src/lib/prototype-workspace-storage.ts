import type { PrototypeState } from "@shared/prototype";
import {
  assertPrototypeState,
  validatePrototypeState,
} from "@shared/prototype-validation";

export const LEGACY_PROTOTYPE_STORAGE_KEY = "sunnaa-full-prototype-v1";
export const PROTOTYPE_STORAGE_PREFIX = "sunnaa-full-prototype-v2";
export const DEFAULT_LOCAL_WORKSPACE_ID = "default";
export const STATIC_LOCAL_WORKSPACE_ID = "static-demo";
export const DEFAULT_GUEST_ID = "guest";
export const WORKSPACE_ENVELOPE_VERSION = 2 as const;

export type WorkspaceIdentityState = "pending" | "guest" | "authenticated";

export type PrototypeWorkspaceScope = {
  /** A server user id only when identity state is authenticated. */
  userId: string | number | null;
  localWorkspaceId?: string;
  identityState?: WorkspaceIdentityState;
};

export type ResolvedPrototypeWorkspaceScope = {
  userId: string;
  localWorkspaceId: string;
  identityState: WorkspaceIdentityState;
  storageKey: string;
};

export type WorkspaceMetadata = {
  version: 1;
  generation: number;
  /**
   * The cloud revision on which this local snapshot is actually based. It is
   * never the latest revision merely observed by a refetch.
   */
  cloudBaseRevision: number | null;
};

/**
 * Snapshot and metadata intentionally share one localStorage value. Browser
 * localStorage.setItem replaces that value atomically; we never depend on a
 * second metadata write succeeding afterwards.
 */
export type PrototypeWorkspaceEnvelope = {
  format: "sunnaa-prototype-workspace";
  version: typeof WORKSPACE_ENVELOPE_VERSION;
  scope: Pick<
    ResolvedPrototypeWorkspaceScope,
    "userId" | "localWorkspaceId" | "identityState"
  >;
  snapshot: PrototypeState;
  metadata: WorkspaceMetadata;
};

export type LocalWorkspaceLoad =
  | {
      kind: "ready";
      state: PrototypeState;
      /** JSON of the state body, stable for React's no-op persistence check. */
      raw: string;
      metadata: WorkspaceMetadata;
      source: "envelope" | "legacy-v2";
    }
  | { kind: "empty"; metadata: WorkspaceMetadata }
  | {
      kind: "recovery-required";
      reason:
        | "corrupt-json"
        | "invalid-snapshot"
        | "oversized-json"
        | "identity-mismatch";
      raw: string;
      message: string;
      metadata: WorkspaceMetadata;
    }
  | {
      kind: "legacy-warning";
      raw: string;
      message: string;
      metadata: WorkspaceMetadata;
    }
  | { kind: "unavailable"; message: string; metadata: WorkspaceMetadata };

export type LocalWorkspaceWrite =
  | { ok: true; raw: string; metadata: WorkspaceMetadata }
  | {
      ok: false;
      reason:
        | "generation-conflict"
        | "guard-rejected"
        | "validation"
        | "storage-unavailable"
        | "lock-unavailable";
      message: string;
    };

export type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WorkspaceWriteOptions = {
  cloudBaseRevision?: number | null;
  /** Used only by a confirmed recovery UI after preserving the original raw. */
  allowExplicitRecoveryOverwrite?: boolean;
  /**
   * Runs only in the guarded async writer, while it holds the exclusive lock
   * and immediately before it reads the current generation. It is an
   * in-memory freshness check and is never serialized into the envelope.
   */
  shouldWrite?: () => boolean;
};

const encoded = (value: string) => encodeURIComponent(value);

export function resolvePrototypeWorkspaceScope(
  scope: PrototypeWorkspaceScope = { userId: null }
): ResolvedPrototypeWorkspaceScope {
  const identityState =
    scope.identityState ?? (scope.userId === null ? "guest" : "authenticated");
  const userId =
    identityState === "authenticated" && scope.userId !== null
      ? String(scope.userId)
      : DEFAULT_GUEST_ID;
  const localWorkspaceId =
    scope.localWorkspaceId?.trim() || DEFAULT_LOCAL_WORKSPACE_ID;
  return {
    userId,
    localWorkspaceId,
    identityState,
    storageKey: `${PROTOTYPE_STORAGE_PREFIX}:user:${encoded(userId)}:workspace:${encoded(localWorkspaceId)}`,
  };
}

/** Exported for fixtures and direct-provider tests; it is never the legacy key. */
export function prototypeWorkspaceStorageKey(scope?: PrototypeWorkspaceScope): string {
  return resolvePrototypeWorkspaceScope(scope).storageKey;
}

/**
 * Compatibility-only key used by v2 snapshots written before the atomic
 * envelope. New code never writes it, so a failed save cannot leave snapshot
 * and metadata out of sync.
 */
export function prototypeWorkspaceMetadataKey(
  scope?: PrototypeWorkspaceScope
): string {
  return `${prototypeWorkspaceStorageKey(scope)}:metadata`;
}

/** The selected workspace is identity-scoped, never a browser-global choice. */
export function prototypeWorkspaceSelectionKey(
  scope?: PrototypeWorkspaceScope
): string {
  const resolved = resolvePrototypeWorkspaceScope({
    userId: scope?.userId ?? null,
    identityState: scope?.identityState,
    localWorkspaceId: DEFAULT_LOCAL_WORKSPACE_ID,
  });
  return `${PROTOTYPE_STORAGE_PREFIX}:user:${encoded(resolved.userId)}:selected-workspace`;
}

export function prototypeWorkspaceRecoveryKey(
  scope?: PrototypeWorkspaceScope
): string {
  return `${prototypeWorkspaceStorageKey(scope)}:recovery`;
}

export function prototypeWorkspaceBackupKey(scope?: PrototypeWorkspaceScope): string {
  return `${prototypeWorkspaceStorageKey(scope)}:backup`;
}

export function emptyWorkspaceMetadata(): WorkspaceMetadata {
  return { version: 1, generation: 0, cloudBaseRevision: null };
}

function isMetadata(value: unknown): value is WorkspaceMetadata {
  const candidate = value as {
    version?: unknown;
    generation?: unknown;
    cloudBaseRevision?: unknown;
  };
  const revision = candidate.cloudBaseRevision;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.version === 1 &&
    Number.isInteger(candidate.generation) &&
    typeof candidate.generation === "number" &&
    candidate.generation >= 0 &&
    (revision === null ||
      (typeof revision === "number" &&
        Number.isInteger(revision) &&
        revision >= 0))
  );
}

function scopeMatchesEnvelope(
  scope: ResolvedPrototypeWorkspaceScope,
  candidate: unknown
): candidate is PrototypeWorkspaceEnvelope["scope"] {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Partial<PrototypeWorkspaceEnvelope["scope"]>;
  return (
    value.userId === scope.userId &&
    value.localWorkspaceId === scope.localWorkspaceId &&
    value.identityState === scope.identityState
  );
}

function isEnvelopeForScope(
  parsed: unknown,
  scope: ResolvedPrototypeWorkspaceScope
): parsed is PrototypeWorkspaceEnvelope {
  if (typeof parsed !== "object" || parsed === null) return false;
  const candidate = parsed as Partial<PrototypeWorkspaceEnvelope>;
  return (
    candidate.format === "sunnaa-prototype-workspace" &&
    candidate.version === WORKSPACE_ENVELOPE_VERSION &&
    scopeMatchesEnvelope(scope, candidate.scope) &&
    isMetadata(candidate.metadata)
  );
}

function isEnvelopeShape(parsed: unknown): parsed is {
  format?: unknown;
  version?: unknown;
  scope?: unknown;
  snapshot?: unknown;
  metadata?: unknown;
} {
  return typeof parsed === "object" && parsed !== null;
}

/**
 * Reads envelope metadata first. The old side key remains read-only migration
 * input so an already-saved v2 state is not rewritten merely by opening it.
 */
export function readWorkspaceMetadata(
  storage: BrowserStorage,
  scope?: PrototypeWorkspaceScope
): WorkspaceMetadata {
  try {
    const resolved = resolvePrototypeWorkspaceScope(scope);
    const raw = storage.getItem(resolved.storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isEnvelopeForScope(parsed, resolved)) return parsed.metadata;
    }
    const legacyRaw = storage.getItem(prototypeWorkspaceMetadataKey(scope));
    if (!legacyRaw) return emptyWorkspaceMetadata();
    const parsed = JSON.parse(legacyRaw) as unknown;
    return isMetadata(parsed) ? parsed : emptyWorkspaceMetadata();
  } catch {
    return emptyWorkspaceMetadata();
  }
}

function saveOriginalRecoveryCopy(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  raw: string
) {
  const key = prototypeWorkspaceRecoveryKey(scope);
  // First bad raw is the forensic original. Never replace it with a later bad raw.
  if (!storage.getItem(key)) storage.setItem(key, raw);
}

function recovery(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  raw: string,
  reason: Extract<LocalWorkspaceLoad, { kind: "recovery-required" }>["reason"],
  message: string,
  metadata: WorkspaceMetadata
): LocalWorkspaceLoad {
  try {
    saveOriginalRecoveryCopy(storage, scope, raw);
  } catch {
    // The original is still left in its active key; never replace it on failure.
  }
  return { kind: "recovery-required", reason, raw, message, metadata };
}

export function loadPrototypeWorkspace(
  storage: BrowserStorage,
  scope?: PrototypeWorkspaceScope
): LocalWorkspaceLoad {
  const resolved = resolvePrototypeWorkspaceScope(scope);
  const legacyMetadata = readWorkspaceMetadata(storage, scope);
  try {
    const storedRaw = storage.getItem(resolved.storageKey);
    if (storedRaw === null) {
      const legacyRaw = storage.getItem(LEGACY_PROTOTYPE_STORAGE_KEY);
      if (legacyRaw !== null) {
        return {
          kind: "legacy-warning",
          raw: legacyRaw,
          metadata: legacyMetadata,
          message:
            "عُثر على مساحة محلية قديمة غير مربوطة بحساب. لن ننسبها تلقائيًا للحساب الحالي؛ صدّرها أو أصلحها بقرار صريح.",
        };
      }
      return { kind: "empty", metadata: legacyMetadata };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(storedRaw);
    } catch {
      return recovery(
        storage,
        scope,
        storedRaw,
        "corrupt-json",
        "تعذر قراءة النسخة المحلية. احتفظنا بالنص الأصلي ولم نستبدله ببيانات تجريبية.",
        legacyMetadata
      );
    }

    if (
      isEnvelopeShape(parsed) &&
      (parsed.format === "sunnaa-prototype-workspace" || parsed.version === WORKSPACE_ENVELOPE_VERSION)
    ) {
      if (!scopeMatchesEnvelope(resolved, parsed.scope)) {
        return recovery(
          storage,
          scope,
          storedRaw,
          "identity-mismatch",
          "الغلاف المحلي لا يطابق هوية هذه المساحة. لم نقرأه أو ننسبه للحساب الحالي ولم نكتب فوقه.",
          emptyWorkspaceMetadata()
        );
      }
      if (!isEnvelopeForScope(parsed, resolved)) {
        return recovery(
          storage,
          scope,
          storedRaw,
          "invalid-snapshot",
          "غلاف مساحة العمل غير صالح. احتفظنا بالنص الأصلي ولم نستبدله ببيانات تجريبية.",
          emptyWorkspaceMetadata()
        );
      }
      const validation = validatePrototypeState(parsed.snapshot);
      if (!validation.success) {
        return recovery(
          storage,
          scope,
          storedRaw,
          validation.message.includes("512 KiB") || storedRaw.length > 512 * 1024
            ? "oversized-json"
            : "invalid-snapshot",
          "النسخة المحلية لا تطابق حدود البروتوتايب. احتفظنا بالنص الأصلي ولم نكتب فوقه.",
          parsed.metadata
        );
      }
      return {
        kind: "ready",
        state: validation.data,
        raw: JSON.stringify(validation.data),
        metadata: parsed.metadata,
        source: "envelope",
      };
    }

    // v2 before P10 stored only the PrototypeState under the scoped key and
    // metadata in a second key. Read it as-is, but do not auto-migrate/write.
    const validation = validatePrototypeState(parsed);
    if (!validation.success) {
      return recovery(
        storage,
        scope,
        storedRaw,
        validation.message.includes("512 KiB") || storedRaw.length > 512 * 1024
          ? "oversized-json"
          : "invalid-snapshot",
        "النسخة المحلية لا تطابق حدود البروتوتايب. احتفظنا بالنص الأصلي ولم نكتب فوقه.",
        legacyMetadata
      );
    }
    return {
      kind: "ready",
      state: validation.data,
      raw: JSON.stringify(validation.data),
      metadata: legacyMetadata,
      source: "legacy-v2",
    };
  } catch (error) {
    return {
      kind: "unavailable",
      metadata: legacyMetadata,
      message: `تعذر الوصول إلى تخزين المتصفح: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
    };
  }
}

function makeEnvelope(
  scope: PrototypeWorkspaceScope | undefined,
  snapshot: PrototypeState,
  metadata: WorkspaceMetadata
): PrototypeWorkspaceEnvelope {
  const resolved = resolvePrototypeWorkspaceScope(scope);
  return {
    format: "sunnaa-prototype-workspace",
    version: WORKSPACE_ENVELOPE_VERSION,
    scope: {
      userId: resolved.userId,
      localWorkspaceId: resolved.localWorkspaceId,
      identityState: resolved.identityState,
    },
    snapshot,
    metadata,
  };
}

/**
 * Synchronous compatibility writer. It stores the complete envelope with one
 * setItem call, but callers that can run in a browser tab must use the guarded
 * async writer below so their read/check/write sequence is serialized.
 */
export function writePrototypeWorkspace(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  snapshot: PrototypeState,
  expectedGeneration: number,
  options?: WorkspaceWriteOptions
): LocalWorkspaceWrite {
  const validation = validatePrototypeState(snapshot);
  if (!validation.success) {
    return { ok: false, reason: "validation", message: validation.message };
  }

  let raw: string;
  try {
    raw = JSON.stringify(validation.data);
  } catch {
    return {
      ok: false,
      reason: "validation",
      message: "تعذر تحويل لقطة البروتوتايب إلى JSON صالح",
    };
  }

  try {
    const resolved = resolvePrototypeWorkspaceScope(scope);
    const existingRaw = storage.getItem(resolved.storageKey);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as unknown;
        if (
          isEnvelopeShape(existing) &&
          (existing.format === "sunnaa-prototype-workspace" ||
            existing.version === WORKSPACE_ENVELOPE_VERSION) &&
          !scopeMatchesEnvelope(resolved, existing.scope) &&
          !options?.allowExplicitRecoveryOverwrite
        ) {
          return {
            ok: false,
            reason: "validation",
            message:
              "الغلاف المحلي منسوب لهوية أخرى. لم نكتب فوقه؛ صدّره أو نفّذ إصلاحًا صريحًا بعد المراجعة.",
          };
        }
      } catch {
        // Corrupt data is handled by the caller's recovery state; setItem still
        // remains all-or-nothing when an explicit repair is confirmed.
      }
    }
    const current = readWorkspaceMetadata(storage, scope);
    if (current.generation !== expectedGeneration) {
      return {
        ok: false,
        reason: "generation-conflict",
        message:
          "رُصد تعديل محلي من تبويب آخر. لم نكتب فوقه؛ راجع أو حمّل النسخة صراحةً.",
      };
    }
    const metadata: WorkspaceMetadata = {
      version: 1,
      generation: expectedGeneration + 1,
      cloudBaseRevision:
        options?.cloudBaseRevision === undefined
          ? current.cloudBaseRevision
          : options.cloudBaseRevision,
    };
    // This is deliberately the only active-state persistence operation.
    storage.setItem(
      prototypeWorkspaceStorageKey(scope),
      JSON.stringify(makeEnvelope(scope, validation.data, metadata))
    );
    return { ok: true, raw, metadata };
  } catch (error) {
    return {
      ok: false,
      reason: "storage-unavailable",
      message: `تعذر الحفظ المحلي؛ بقيت التغييرات في الذاكرة ويمكن تصديرها. ${error instanceof Error ? error.message : ""}`.trim(),
    };
  }
}

type LockManagerLike = Pick<LockManager, "request">;
const inProcessLocks = new Map<string, Promise<void>>();

function browserLockManager(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  return navigator.locks ?? null;
}

function isJSDOMOrNonBrowser(): boolean {
  if (typeof window === "undefined") return true;
  return window.navigator.userAgent.toLowerCase().includes("jsdom");
}

async function withinProcessLock<T>(name: string, action: () => T | Promise<T>): Promise<T> {
  const previous = inProcessLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  inProcessLocks.set(name, previous.then(() => current));
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (inProcessLocks.get(name) === current) inProcessLocks.delete(name);
  }
}

/**
 * Browser-tab writer for P10. `navigator.locks` serializes the metadata read,
 * generation comparison, and one-value envelope replacement across tabs. In
 * real browsers without Web Locks we reject persistence rather than pretend a
 * localStorage compare-and-set is transactional. The small process lock exists
 * only for SSR/JSDOM deterministic tests where there are no independent tabs.
 */
export async function writePrototypeWorkspaceGuarded(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  snapshot: PrototypeState,
  expectedGeneration: number,
  options?: WorkspaceWriteOptions
): Promise<LocalWorkspaceWrite> {
  const name = `sunnaa-prototype-workspace:${prototypeWorkspaceStorageKey(scope)}`;
  const action = () => {
    // This check shares the lock with the generation comparison below. An async
    // caller therefore cannot write a snapshot that became stale while queued.
    if (options?.shouldWrite && !options.shouldWrite()) {
      return {
        ok: false as const,
        reason: "guard-rejected" as const,
        message:
          "تغيّرت البيانات أو مساحة العمل قبل الكتابة المحلية؛ لم نكتب لقطة قديمة.",
      };
    }
    return writePrototypeWorkspace(storage, scope, snapshot, expectedGeneration, options);
  };
  const locks = browserLockManager();
  if (locks) return locks.request(name, { mode: "exclusive" }, action);
  if (isJSDOMOrNonBrowser()) return withinProcessLock(name, action);
  return {
    ok: false,
    reason: "lock-unavailable",
    message:
      "لا يدعم هذا المتصفح قفل التبويبات المطلوب للحفظ الآمن. بقيت التغييرات في الذاكرة ويمكن تصديرها.",
  };
}

export type SelectedWorkspaceRecord = {
  version: 1;
  userId: string;
  identityState: "guest" | "authenticated";
  localWorkspaceId: string;
};

function isSelectedWorkspaceRecord(
  value: unknown,
  scope: ResolvedPrototypeWorkspaceScope
): value is SelectedWorkspaceRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SelectedWorkspaceRecord>;
  return (
    candidate.version === 1 &&
    candidate.userId === scope.userId &&
    candidate.identityState === scope.identityState &&
    typeof candidate.localWorkspaceId === "string" &&
    candidate.localWorkspaceId.trim().length > 0
  );
}

/** Reads only a record explicitly bound to the current verified identity. */
export function readSelectedLocalWorkspace(
  storage: BrowserStorage,
  scope?: PrototypeWorkspaceScope
): string | null {
  const resolved = resolvePrototypeWorkspaceScope(scope);
  if (resolved.identityState === "pending") return null;
  try {
    const raw = storage.getItem(prototypeWorkspaceSelectionKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSelectedWorkspaceRecord(parsed, resolved)
      ? parsed.localWorkspaceId.trim()
      : null;
  } catch {
    return null;
  }
}

/** Persists a selection only inside the active identity namespace. */
export function writeSelectedLocalWorkspace(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  localWorkspaceId: string
): { ok: true } | { ok: false; message: string } {
  const resolved = resolvePrototypeWorkspaceScope(scope);
  const selected = localWorkspaceId.trim();
  if (resolved.identityState === "pending" || !selected) {
    return {
      ok: false,
      message: "لا يمكن حفظ اختيار مساحة محلية قبل اكتمال التحقق من الهوية.",
    };
  }
  try {
    const record: SelectedWorkspaceRecord = {
      version: 1,
      userId: resolved.userId,
      identityState: resolved.identityState as "guest" | "authenticated",
      localWorkspaceId: selected,
    };
    storage.setItem(prototypeWorkspaceSelectionKey(scope), JSON.stringify(record));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `تعذر حفظ اختيار مساحة العمل. ${error instanceof Error ? error.message : ""}`.trim(),
    };
  }
}

/** Stores a confirmed pre-load local copy separately from the active state. */
export function backupPrototypeWorkspace(
  storage: BrowserStorage,
  scope: PrototypeWorkspaceScope | undefined,
  snapshot: PrototypeState
): { ok: true } | { ok: false; message: string } {
  try {
    const valid = assertPrototypeState(snapshot);
    storage.setItem(prototypeWorkspaceBackupKey(scope), JSON.stringify(valid));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `تعذر إنشاء نسخة محلية قبل التحميل. ${error instanceof Error ? error.message : ""}`.trim(),
    };
  }
}

export function readRecoveryRaw(
  storage: BrowserStorage,
  scope?: PrototypeWorkspaceScope
): string | null {
  try {
    return storage.getItem(prototypeWorkspaceRecoveryKey(scope));
  } catch {
    return null;
  }
}

export function readLegacyRaw(storage: BrowserStorage): string | null {
  try {
    return storage.getItem(LEGACY_PROTOTYPE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * An observed remote revision must never become a base revision. This small
 * helper is intentionally explicit and is used by cloud UI/tests to make the
 * R07 rule easy to audit.
 */
export function retainCloudBaseOnRemoteObservation(
  cloudBaseRevision: number | null,
  _observedRemoteRevision: number
): number | null {
  return cloudBaseRevision;
}
