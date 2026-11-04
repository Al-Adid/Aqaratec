import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AuditEvent,
  DemoEntity,
  EntityKind,
  isMinorAmount,
  NewEntity,
  PrototypeState,
} from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  assertPrototypeState,
  validatePrototypeState,
} from "@shared/prototype-validation";
import { createDemoState } from "@/lib/demo-data";
import { financialSummary, outstandingFor } from "@/lib/prototype-finance";
import { assertUnitIdentifierAvailable } from "@/lib/prototype-unit-identifiers";
import {
  applyCollectionEntries,
  applyPropertyMonthCollection,
} from "@/lib/prototype-payments";
import {
  isExplicitGlobalTemplateRecord,
  normalizePrototype,
  resolvePortfolio,
} from "@/lib/prototype-normalize";
import type { BillingInput, CollectBillingInput } from "@shared/billing-types";
import {
  issueBillingDocument as applyBillingIssue,
  collectBillingDocument as applyBillingCollection,
} from "@/lib/prototype-billing";
import type {
  SaveLeaseTemplateInput,
  GenerateTemplateLeaseInput,
} from "@shared/lease-template-types";
import {
  saveLeaseTemplate as applySaveTemplate,
  generateTemplateLease as applyTemplateLease,
  refreshRenewalTemplateSnapshot as applyRenewalTemplateSnapshot,
} from "@/lib/lease-template-engine";
import { payMaintenanceExpense as applyMaintenancePayment } from "@/lib/prototype-maintenance";
import {
  createRentalProperty as applyRentalProperty,
  importRentalProperties as applyRentalBatch,
} from "@/lib/prototype-rental";
import {
  backupPrototypeWorkspace,
  DEFAULT_LOCAL_WORKSPACE_ID,
  loadPrototypeWorkspace,
  prototypeWorkspaceStorageKey,
  readSelectedLocalWorkspace,
  readLegacyRaw,
  readRecoveryRaw,
  resolvePrototypeWorkspaceScope,
  type BrowserStorage,
  type PrototypeWorkspaceScope,
  type WorkspaceIdentityState,
  type WorkspaceMetadata,
  writePrototypeWorkspaceGuarded,
  writeSelectedLocalWorkspace,
} from "@/lib/prototype-workspace-storage";

export type PrototypeWorkspaceIdentity = {
  /** pending intentionally neither reads nor writes a personal local namespace */
  status: WorkspaceIdentityState;
  userId: string | number | null;
  name?: string | null;
  localWorkspaceId?: string;
  /** Auth lookup failure keeps the scope locked rather than falling back to guest. */
  verificationError?: string;
  /** Retain the already-verified namespace in memory, but block writes during a background check. */
  verificationPending?: boolean;
};

export type PrototypeStorageKind =
  | "ready"
  | "identity-pending"
  | "recovery-required"
  | "legacy-warning"
  | "memory-only"
  | "external-change";

export type PrototypeStorageStatus = {
  kind: PrototypeStorageKind;
  message?: string;
  generation: number;
  cloudBaseRevision: number | null;
  storageKey: string;
  localWorkspaceId: string;
  canPersist: boolean;
  hasRawRecovery: boolean;
};

export type PrototypeCloudBaseline = {
  revision: number | null;
  localGeneration: number;
};

/**
 * A property/unit transition reaches memory only after its exact local envelope
 * has been written under the guarded workspace lock. Callers may safely show a
 * saved acknowledgement only after the returned promise resolves.
 */
export type AssetTransitionFailureCode =
  | "not-permitted"
  | "durability-unavailable"
  | "invalid-transition"
  | "transition-rejected"
  | "stale-source"
  | "scope-changed"
  | "generation-conflict"
  | "write-failed"
  | "acknowledgement-blocked";

/**
 * `assetCommitted` distinguishes an ordinary rejected form submit from the
 * narrow case where a durable envelope did succeed but the provider could no
 * longer safely acknowledge it in React (for example, scope/role changed).
 * Prepared media must be rolled back only when this flag is false.
 */
export class AssetTransitionError extends Error {
  readonly assetCommitted: boolean;
  readonly code: AssetTransitionFailureCode;

  constructor(
    message: string,
    code: AssetTransitionFailureCode,
    assetCommitted = false
  ) {
    super(message);
    this.name = "AssetTransitionError";
    this.code = code;
    this.assetCommitted = assetCommitted;
  }
}

/** Complex settings have dedicated transitions; generic UI settings stay scalar. */
type ScalarPrototypeSettingKey = Exclude<
  keyof PrototypeState["settings"],
  "contentPresets"
>;

interface PrototypeContextValue {
  state: PrototypeState;
  list: (kind: EntityKind) => DemoEntity[];
  filtered: (kind: EntityKind) => DemoEntity[];
  find: (kind: EntityKind, id: string) => DemoEntity | undefined;
  add: (kind: EntityKind, input: NewEntity) => DemoEntity;
  patch: (kind: EntityKind, id: string, input: Partial<DemoEntity>) => void;
  setStatus: (kind: EntityKind, id: string, status: string) => void;
  log: (title: string, detail?: string) => void;
  setSetting: (key: ScalarPrototypeSettingKey, value: string) => void;
  reset: () => void;
  replaceState: (value: PrototypeState) => void;
  canEdit: boolean;
  issueBillingDocument: (input: BillingInput) => DemoEntity;
  collectBillingDocument: (input: CollectBillingInput) => DemoEntity;
  saveLeaseTemplate: (input: SaveLeaseTemplateInput) => DemoEntity;
  generateTemplateLease: (input: GenerateTemplateLeaseInput) => DemoEntity;
  refreshRenewalTemplateSnapshot: (
    leaseId: string,
    templateId: string,
    requestId: string
  ) => boolean;
  payMaintenanceExpense: (
    expenseId: string,
    date: string,
    method: string,
    requestId: string
  ) => DemoEntity;
  createRentalProperty: (values: Record<string, string>) => DemoEntity;
  importRentalProperties: (
    rows: Record<string, string>[],
    requestId: string
  ) => DemoEntity[];
  commitTransition: <T>(
    transition: (current: PrototypeState) => {
      state: PrototypeState;
      result: T;
    }
  ) => T;
  /**
   * Reserved for property/unit forms that may reference freshly prepared local
   * media. Unlike `commitTransition`, this waits for guarded local durability
   * before exposing the state change in memory.
   */
  commitAssetTransition: <T>(
    transition: (current: PrototypeState) => {
      state: PrototypeState;
      result: T;
    }
  ) => Promise<T>;
  recordCollection: (
    receivableId: string,
    amountMinor: number,
    method: string,
    status: string,
    collectionDate?: string
  ) => void;
  recordPropertyMonthCollection: (
    propertyId: string,
    month: string,
    method: string,
    collectionDate: string,
    expectedRemainingMinor: number
  ) => void;
  recordLoss: (
    receivableId: string,
    amountMinor: number,
    reason: string
  ) => void;
  recordRecovery: (lossId: string, amountMinor: number) => void;
  outstanding: (id: string) => number;
  financials: ReturnType<typeof financialSummary>;
  /** Scope and persistence state consumed by cloud/recovery controls. */
  identity: PrototypeWorkspaceIdentity & { storageKey: string };
  storage: PrototypeStorageStatus;
  cloudBaseline: PrototypeCloudBaseline;
  exportWorkspace: () => string;
  exportRecoveryRaw: () => string | null;
  repairLocalWorkspace: () => Promise<boolean>;
  retryLocalPersistence: () => Promise<boolean>;
  createSeparateLocalWorkspace: () => boolean;
  /** Validated export is written to a new workspace; the current scope remains untouched. */
  restoreExportToNewWorkspace: (snapshot: PrototypeState) => Promise<boolean>;
  loadLatestLocalWorkspace: () => Promise<boolean>;
  /** Explicit, confirmed cloud load: backs up local state, writes it, then commits. */
  adoptCloudWorkspace: (
    snapshot: PrototypeState,
    revision: number
  ) => Promise<boolean>;
  /** R0 is safe to bind only after an explicit empty-server observation. */
  initializeEmptyCloudBaseline: (
    revision: number,
    hasSnapshot: boolean
  ) => Promise<boolean>;
  /** Binds a revision only when the exact submitted local snapshot succeeded. */
  markCloudSaveSuccess: (
    revision: number,
    savedSnapshot: PrototypeState,
    expectedStorageKey: string
  ) => Promise<boolean>;
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

const DEFAULT_IDENTITY: PrototypeWorkspaceIdentity = {
  status: "guest",
  userId: null,
  localWorkspaceId: DEFAULT_LOCAL_WORKSPACE_ID,
};

const auditEvent = (title: string, detail = ""): AuditEvent => ({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  title,
  detail,
});

function browserStorage(): BrowserStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserBroadcastChannel(): typeof BroadcastChannel | undefined {
  if (typeof window === "undefined") return undefined;
  // JSDOM exposes Node's channel implementation, whose MessageEvent belongs to
  // another EventTarget realm. DOM tests retain StorageEvent coverage; real
  // browser tabs use their native BroadcastChannel below.
  if (window.navigator.userAgent.toLowerCase().includes("jsdom"))
    return undefined;
  return window.BroadcastChannel;
}

function freshDemoState(): PrototypeState {
  return assertPrototypeState(normalizePrototype(createDemoState()));
}

function randomWorkspaceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `local-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function rawFor(snapshot: PrototypeState): string {
  return JSON.stringify(assertPrototypeState(snapshot));
}

function metadataStatus(
  kind: PrototypeStorageKind,
  scope: PrototypeWorkspaceScope,
  metadata: WorkspaceMetadata,
  options?: {
    message?: string;
    canPersist?: boolean;
    hasRawRecovery?: boolean;
  }
): PrototypeStorageStatus {
  return {
    kind,
    message: options?.message,
    generation: metadata.generation,
    cloudBaseRevision: metadata.cloudBaseRevision,
    storageKey: prototypeWorkspaceStorageKey(scope),
    localWorkspaceId:
      scope.localWorkspaceId?.trim() || DEFAULT_LOCAL_WORKSPACE_ID,
    canPersist: options?.canPersist ?? kind === "ready",
    hasRawRecovery: options?.hasRawRecovery ?? false,
  };
}

function mayChangeMemory(status: PrototypeStorageStatus): boolean {
  return ![
    "identity-pending",
    "recovery-required",
    "legacy-warning",
    "external-change",
  ].includes(status.kind);
}

type InitialWorkspace = {
  state: PrototypeState;
  status: PrototypeStorageStatus;
  raw: string | null;
};

function initialWorkspace(
  identity: PrototypeWorkspaceIdentity,
  scope: PrototypeWorkspaceScope,
  storage: BrowserStorage | null
): InitialWorkspace {
  const demo = freshDemoState();
  const emptyMetadata: WorkspaceMetadata = {
    version: 1,
    generation: 0,
    cloudBaseRevision: null,
  };
  if (identity.status === "pending") {
    return {
      state: demo,
      raw: null,
      status: metadataStatus("identity-pending", scope, emptyMetadata, {
        message:
          identity.verificationError ??
          "جارٍ التحقق من الهوية. لا نقرأ أو نحفظ مساحة شخصية قبل اكتمال التحقق.",
        canPersist: false,
      }),
    };
  }
  if (!storage) {
    return {
      state: demo,
      raw: null,
      status: metadataStatus("memory-only", scope, emptyMetadata, {
        message:
          "تخزين المتصفح غير متاح. ستبقى بياناتك في الذاكرة ويمكنك تصديرها.",
        canPersist: false,
      }),
    };
  }

  const loaded = loadPrototypeWorkspace(storage, scope);
  switch (loaded.kind) {
    case "ready": {
      const normalized = assertPrototypeState(normalizePrototype(loaded.state));
      return {
        state: normalized,
        raw: loaded.raw,
        status: metadataStatus("ready", scope, loaded.metadata),
      };
    }
    case "empty":
      return {
        state: demo,
        raw: null,
        status: metadataStatus("ready", scope, loaded.metadata),
      };
    case "recovery-required":
      return {
        state: demo,
        raw: null,
        status: metadataStatus("recovery-required", scope, loaded.metadata, {
          message: loaded.message,
          canPersist: false,
          hasRawRecovery: true,
        }),
      };
    case "legacy-warning":
      return {
        state: demo,
        raw: null,
        status: metadataStatus("legacy-warning", scope, loaded.metadata, {
          message: loaded.message,
          canPersist: false,
          hasRawRecovery: true,
        }),
      };
    case "unavailable":
      return {
        state: demo,
        raw: null,
        status: metadataStatus("memory-only", scope, loaded.metadata, {
          message: loaded.message,
          canPersist: false,
        }),
      };
  }
}

function IdentityScopedPrototypeProvider({
  children,
  identity,
}: {
  children: ReactNode;
  identity: PrototypeWorkspaceIdentity;
}) {
  const [localWorkspaceId, setLocalWorkspaceId] = useState(() => {
    const requested = identity.localWorkspaceId?.trim();
    // static-demo is an explicit runtime namespace, never a remembered account
    // choice. Pending identity does not read any local selection.
    if (requested && requested !== DEFAULT_LOCAL_WORKSPACE_ID) return requested;
    if (identity.status === "pending")
      return requested || DEFAULT_LOCAL_WORKSPACE_ID;
    const local = browserStorage();
    return (
      (local &&
        readSelectedLocalWorkspace(local, {
          userId: identity.userId,
          identityState: identity.status,
        })) ||
      requested ||
      DEFAULT_LOCAL_WORKSPACE_ID
    );
  });
  const scope: PrototypeWorkspaceScope = {
    userId: identity.userId,
    identityState: identity.status,
    localWorkspaceId,
  };
  const scopeKey = prototypeWorkspaceStorageKey(scope);
  return (
    <PrototypeProviderInstance
      key={scopeKey}
      identity={{ ...identity, localWorkspaceId }}
      scope={scope}
      onCreateSeparateWorkspace={() => {
        const next = randomWorkspaceId();
        const local = browserStorage();
        if (!local) return false;
        const saved = writeSelectedLocalWorkspace(
          local,
          { userId: identity.userId, identityState: identity.status },
          next
        );
        if (!saved.ok) return false;
        setLocalWorkspaceId(next);
        return true;
      }}
      onRestoreToNewWorkspace={async snapshot => {
        const local = browserStorage();
        if (!local) return false;
        const next = randomWorkspaceId();
        const nextScope: PrototypeWorkspaceScope = {
          userId: identity.userId,
          identityState: identity.status,
          localWorkspaceId: next,
        };
        const saved = await writePrototypeWorkspaceGuarded(
          local,
          nextScope,
          snapshot,
          0,
          { cloudBaseRevision: null }
        );
        if (!saved.ok) return false;
        const selected = writeSelectedLocalWorkspace(
          local,
          { userId: identity.userId, identityState: identity.status },
          next
        );
        if (!selected.ok) return false;
        setLocalWorkspaceId(next);
        return true;
      }}
    >
      {children}
    </PrototypeProviderInstance>
  );
}

function PrototypeProviderInstance({
  children,
  identity,
  scope,
  onCreateSeparateWorkspace,
  onRestoreToNewWorkspace,
}: {
  children: ReactNode;
  identity: PrototypeWorkspaceIdentity;
  scope: PrototypeWorkspaceScope;
  onCreateSeparateWorkspace: () => boolean;
  onRestoreToNewWorkspace: (snapshot: PrototypeState) => Promise<boolean>;
}) {
  const localStorageRef = useRef<BrowserStorage | null>(browserStorage());
  const initialRef = useRef<InitialWorkspace | null>(null);
  if (!initialRef.current)
    initialRef.current = initialWorkspace(
      identity,
      scope,
      localStorageRef.current
    );
  const initial = initialRef.current;
  const resolvedScope = resolvePrototypeWorkspaceScope(scope);
  const [state, updateState] = useState<PrototypeState>(initial.state);
  const stateRef = useRef(state);
  const [storage, updateStorage] = useState<PrototypeStorageStatus>(
    initial.status
  );
  const storageRef = useRef(storage);
  const generationRef = useRef(initial.status.generation);
  const lastPersistedRawRef = useRef(initial.raw);
  const tabIdRef = useRef(randomWorkspaceId());
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const memoryRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const identityRef = useRef(identity);
  const scopeKeyRef = useRef(resolvedScope.storageKey);

  // These refs update during render so an async asset commit cannot make a
  // decision with identity or scope values captured by an earlier render.
  identityRef.current = identity;
  scopeKeyRef.current = resolvedScope.storageKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setStorage = useCallback((next: PrototypeStorageStatus) => {
    storageRef.current = next;
    generationRef.current = next.generation;
    updateStorage(next);
  }, []);

  const setStorageFromMetadata = useCallback(
    (
      metadata: WorkspaceMetadata,
      kind: PrototypeStorageKind = "ready",
      options?: {
        message?: string;
        canPersist?: boolean;
        hasRawRecovery?: boolean;
      }
    ) => setStorage(metadataStatus(kind, scope, metadata, options)),
    [scope, setStorage]
  );

  const markPersistenceFailure = useCallback(
    (message: string, kind: PrototypeStorageKind = "memory-only") => {
      const current = storageRef.current;
      setStorage({
        ...current,
        kind,
        message,
        canPersist: false,
      });
    },
    [setStorage]
  );

  const announceLocalWrite = useCallback(
    (metadata: WorkspaceMetadata) => {
      const BrowserBroadcastChannel = browserBroadcastChannel();
      if (!BrowserBroadcastChannel) return;
      try {
        const channel = new BrowserBroadcastChannel(
          "sunnaa-prototype-workspace"
        );
        channel.postMessage({
          type: "workspace-write",
          storageKey: resolvedScope.storageKey,
          generation: metadata.generation,
          source: tabIdRef.current,
        });
        channel.close();
      } catch {}
    },
    [resolvedScope.storageKey]
  );

  /** All local envelope replacements in this provider share one FIFO queue. */
  const enqueuePersistence = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const scheduled = persistenceQueueRef.current.then(task, task);
    // A rejected asset submit must not poison later generic/effect writes.
    persistenceQueueRef.current = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }, []);

  /**
   * Direct persistence used only for explicit repair/load/save-baseline steps.
   * Normal transitions use the effect below, so React still batches visual updates.
   * A state-bound call is checked again under Web Locks so a delayed effect cannot
   * overwrite a newer in-memory snapshot.
   */
  const persistExact = useCallback(
    (
      snapshot: PrototypeState,
      options?: {
        cloudBaseRevision?: number | null;
        allowExplicitRecoveryOverwrite?: boolean;
      },
      stateBound = false
    ): Promise<boolean> => {
      const expectedScopeKey = resolvedScope.storageKey;
      return enqueuePersistence(async (): Promise<boolean> => {
        const browser = localStorageRef.current;
        if (!browser) {
          markPersistenceFailure(
            "تخزين المتصفح غير متاح؛ بقيت النسخة في الذاكرة ويمكن تصديرها."
          );
          return false;
        }
        const write = await writePrototypeWorkspaceGuarded(
          browser,
          scope,
          snapshot,
          generationRef.current,
          {
            ...options,
            shouldWrite: () =>
              scopeKeyRef.current === expectedScopeKey &&
              (!stateBound || stateRef.current === snapshot),
          }
        );
        if (!write.ok) {
          // A newer state render will schedule its own guarded persistence. This
          // is not a browser-storage failure and must not disable editing.
          if (write.reason === "guard-rejected") return false;
          markPersistenceFailure(
            write.message,
            write.reason === "generation-conflict"
              ? "external-change"
              : "memory-only"
          );
          return false;
        }
        lastPersistedRawRef.current = write.raw;
        if (
          mountedRef.current &&
          scopeKeyRef.current === expectedScopeKey
        ) {
          setStorageFromMetadata(write.metadata);
          announceLocalWrite(write.metadata);
        }
        return true;
      });
    },
    [
      announceLocalWrite,
      enqueuePersistence,
      markPersistenceFailure,
      resolvedScope.storageKey,
      scope,
      setStorageFromMetadata,
    ]
  );

  // Every state transition is checked before stateRef or React receives it.
  const setState = (
    update: PrototypeState | ((previous: PrototypeState) => PrototypeState)
  ) => {
    const candidate =
      typeof update === "function" ? update(stateRef.current) : update;
    const validation = validatePrototypeState(candidate);
    if (!validation.success)
      throw new Error(`لم يُعتمد التغيير: ${validation.message}`);
    stateRef.current = validation.data;
    memoryRevisionRef.current += 1;
    updateState(validation.data);
  };

  const assertWorkspaceMutable = () => {
    const currentIdentity = identityRef.current;
    if (currentIdentity.verificationPending || currentIdentity.verificationError)
      throw new Error(
        currentIdentity.verificationError ??
          "التعديل موقوف مؤقتًا حتى يكتمل التحقق من الهوية؛ لم نتخلص من نسختك الحالية"
      );
    if (!mayChangeMemory(storageRef.current)) {
      throw new Error(
        storageRef.current.message ??
          "الحفظ المحلي موقوف لحماية النسخة الحالية حتى تختار إصلاحًا صريحًا"
      );
    }
  };

  const permit = () => {
    assertWorkspaceMutable();
    if (stateRef.current.settings.role !== "operator")
      throw new Error(
        "أنت في معاينة دور للقراءة؛ اختر معاينة الموظف لتجربة التسجيل"
      );
  };

  const permitDurableAssetCommit = () => {
    permit();
    if (!storageRef.current.canPersist)
      throw new Error(
        storageRef.current.message ??
          "لا يمكن تأكيد حفظ العقار أو الوحدة لأن التخزين المحلي غير متاح. لم يُحفظ أي سجل جديد."
      );
    if (!localStorageRef.current)
      throw new Error(
        "تخزين المتصفح غير متاح؛ لم يُحفظ العقار أو الوحدة. احتفظ بمدخلات النموذج وأعد المحاولة في متصفح يدعم التخزين المحلي."
      );
  };

  // Persist only valid, non-recovery state. A corrupt/oversize raw value never
  // reaches this path, so demo data cannot overwrite it after mount.
  useEffect(() => {
    const currentStorage = storageRef.current;
    const browser = localStorageRef.current;
    if (!browser || !currentStorage.canPersist) return;
    let raw: string;
    try {
      raw = rawFor(state);
    } catch (error) {
      markPersistenceFailure(
        `تعذر التحقق من النسخة قبل الحفظ المحلي. ${error instanceof Error ? error.message : ""}`
      );
      return;
    }
    if (raw === lastPersistedRawRef.current) return;
    // If another memory transition wins before this queued effect acquires the
    // Web Lock, its own effect persists the newer snapshot instead.
    void persistExact(state, undefined, true);
  }, [markPersistenceFailure, persistExact, state]);

  // Another tab can never auto-load or overwrite this tab. It merely blocks
  // persistence and asks the user to export or explicitly load the latest copy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== resolvedScope.storageKey &&
        event.key !== `${resolvedScope.storageKey}:metadata`
      )
        return;
      const metadata = localStorageRef.current
        ? loadPrototypeWorkspace(localStorageRef.current, scope).metadata
        : {
            version: 1 as const,
            generation: generationRef.current,
            cloudBaseRevision: storageRef.current.cloudBaseRevision,
          };
      setStorageFromMetadata(metadata, "external-change", {
        canPersist: false,
        message:
          "رُصد تعديل في تبويب آخر. لم نستبدل بياناتك؛ صدّر نسختك أو حمّل النسخة المحلية الأحدث صراحةً.",
      });
    };
    window.addEventListener("storage", onStorage);

    let channel: BroadcastChannel | null = null;
    const BrowserBroadcastChannel = browserBroadcastChannel();
    if (BrowserBroadcastChannel) {
      try {
        channel = new BrowserBroadcastChannel("sunnaa-prototype-workspace");
        channel.onmessage = event => {
          const message = event.data as {
            type?: string;
            storageKey?: string;
            source?: string;
          };
          if (
            message.type === "workspace-write" &&
            message.storageKey === resolvedScope.storageKey &&
            message.source !== tabIdRef.current
          ) {
            onStorage(
              new StorageEvent("storage", { key: resolvedScope.storageKey })
            );
          }
        };
      } catch {}
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [resolvedScope.storageKey, scope, setStorageFromMetadata]);

  const log = (title: string, detail = "") => {
    assertWorkspaceMutable();
    setState(prev => ({
      ...prev,
      audit: [auditEvent(title, detail), ...prev.audit].slice(0, 300),
    }));
  };

  const add = (kind: EntityKind, input: NewEntity): DemoEntity => {
    permit();
    const amountMinor = input.amountMinor ?? 0;
    if (
      kind === "tasks" &&
      typeof input.meta?.sourceIdeaId === "string" &&
      stateRef.current.entities.tasks.some(
        row => row.meta.sourceIdeaId === input.meta?.sourceIdeaId
      )
    ) {
      throw new Error(
        "توجد مهمة مراجعة لهذه الفكرة بالفعل؛ لن تُنشأ نسخة مكررة"
      );
    }
    if (!isMinorAmount(amountMinor))
      throw new Error(
        "المبلغ يجب أن يكون عددًا صحيحًا آمنًا بوحدة العملة الأصغر"
      );
    if (!input.title.trim()) throw new Error("العنوان مطلوب");
    const meta = input.meta ?? {};
    const propertyId = input.propertyId ?? "";
    const requestedPortfolioId = input.portfolioId ?? "";
    const row: DemoEntity = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      subtitle: input.subtitle ?? "",
      portfolioId: "",
      propertyId,
      status: input.status ?? "جديد",
      date: input.date ?? scenarioDate(stateRef.current),
      amountMinor,
      currency: "QAR",
      meta,
    };
    row.portfolioId =
      kind === "portfolios"
        ? row.id
        : isExplicitGlobalTemplateRecord(kind, row)
          ? ""
          : resolvePortfolio(
              stateRef.current.entities,
              requestedPortfolioId,
              propertyId,
              stateRef.current.settings.portfolioId
            );
    if (kind === "properties") row.propertyId = row.id;
    if (kind === "units") {
      const property = stateRef.current.entities.properties.find(
        p => p.id === propertyId
      );
      if (!property || row.portfolioId !== property.portfolioId)
        throw new Error("الوحدة والعقار يجب أن يتبعا المحفظة نفسها.");
      if (
        stateRef.current.settings.portfolioId !== "all" &&
        property.portfolioId !== stateRef.current.settings.portfolioId
      )
        throw new Error("العقار خارج نطاق المحفظة الحالية.");
      if (
        property.meta.rentalMode === "whole" &&
        stateRef.current.entities.units.some(u => u.propertyId === propertyId)
      )
        throw new Error("العقار الكامل لا يقبل هدف تأجير ثانٍ.");
      const code = assertUnitIdentifierAvailable(
        stateRef.current.entities,
        propertyId,
        String(meta.unitCode ?? meta.code ?? "")
      );
      row.meta = { ...meta, code, unitCode: code };
    }
    setState(prev => ({
      ...prev,
      entities: { ...prev.entities, [kind]: [...prev.entities[kind], row] },
      audit: [
        auditEvent(`إضافة: ${row.title}`, "سجل صوري داخل البروتوتايب"),
        ...prev.audit,
      ].slice(0, 300),
    }));
    toast.success(
      `أضيف سجل التجربة إلى ${state.entities.portfolios.find(p => p.id === row.portfolioId)?.title ?? row.title}`
    );
    return row;
  };

  const patch = (kind: EntityKind, id: string, input: Partial<DemoEntity>) => {
    assertWorkspaceMutable();
    const ownerApproval =
      state.settings.role === "owner" &&
      ["maintenance", "distributions", "approvals", "leases"].includes(kind) &&
      Object.keys(input).every(k => k === "status") &&
      ["معتمد", "مرفوض", "موافق عليه", "مجدد", "بانتظار التنفيذ"].includes(
        input.status ?? ""
      );
    if (!ownerApproval) permit();
    if (input.amountMinor !== undefined && !isMinorAmount(input.amountMinor))
      throw new Error("مبلغ غير صالح");
    const source = stateRef.current.entities[kind].find(row => row.id === id);
    if (!source) throw new Error("السجل غير موجود");
    if (
      kind === "expenses" &&
      source.meta.maintenanceId &&
      (input.status === "مسدد" || input.meta?.paymentStatus === "مسدد")
    )
      throw new Error(
        "مصروف الصيانة يُسدّد من إجراء التسوية المحلية الصريح، لا من تغيير الحالة"
      );
    if (
      kind === "collections" &&
      input.status &&
      ["محصّل", "محصل", "مسوّى"].includes(input.status) &&
      !["محصّل", "محصل", "مسوّى"].includes(source.status) &&
      source.meta.receivableId
    ) {
      const remaining = outstandingFor(
        stateRef.current.entities,
        String(source.meta.receivableId)
      );
      if (source.amountMinor > remaining)
        throw new Error("قيمة التحصيل تتجاوز المتبقي بعد المدفوعات الأخرى");
    }
    setState(prev => ({
      ...prev,
      entities: {
        ...prev.entities,
        [kind]: prev.entities[kind].map(row => {
          if (row.id !== id) return row;
          const next: DemoEntity = {
            ...row,
            ...input,
            id: row.id,
            currency: row.currency,
            meta: input.meta ? { ...row.meta, ...input.meta } : row.meta,
          };
          next.portfolioId =
            kind === "portfolios"
              ? row.id
              : isExplicitGlobalTemplateRecord(kind, next)
                ? ""
                : resolvePortfolio(
                    prev.entities,
                    next.portfolioId,
                    next.propertyId,
                    row.portfolioId
                  );
          return next;
        }),
      },
      audit: [
        auditEvent(
          `تحديث: ${source.title}`,
          input.status
            ? `الحالة: ${input.status} · محاكاة محلية`
            : "تعديل محفوظ في نموذج التجربة"
        ),
        ...prev.audit,
      ].slice(0, 300),
    }));
    toast.success("حُدّثت بيانات التجربة");
  };

  const setStatus = (kind: EntityKind, id: string, status: string) =>
    patch(kind, id, { status });

  const issueBillingDocument = (input: BillingInput): DemoEntity => {
    permit();
    const previous = stateRef.current;
    const result = applyBillingIssue(previous, input);
    if (result.state === previous) return result.document;
    setState({
      ...result.state,
      audit: [
        auditEvent(
          `إصدار: ${result.document.title}`,
          "إصدار محلي دون قبض أو تحويل أموال"
        ),
        ...result.state.audit,
      ].slice(0, 300),
    });
    toast.success(
      input.kind === "lpo"
        ? "حُفظ أمر الشراء التجريبي دون تسجيل مصروف أو دفع"
        : "صدرت الوثيقة وربطت باستحقاق واحد؛ لم يُسجل قبض"
    );
    return result.document;
  };

  const collectBillingDocument = (input: CollectBillingInput): DemoEntity => {
    permit();
    const result = applyBillingCollection(stateRef.current, input);
    setState(result.state);
    toast.success("سُجل السداد وسند القبض مرة واحدة وتحدث المتبقي");
    return result.receipt;
  };

  const saveLeaseTemplate = (input: SaveLeaseTemplateInput): DemoEntity => {
    permit();
    const result = applySaveTemplate(stateRef.current, input);
    setState(result.state);
    toast.success("حُفظ نموذج العقد وإصداره في التجربة");
    return result.template;
  };

  const generateTemplateLease = (
    input: GenerateTemplateLeaseInput
  ): DemoEntity => {
    permit();
    const result = applyTemplateLease(stateRef.current, input);
    setState(result.state);
    toast.success("تعبئت مسودة العقد؛ لم يُسجل تحصيل أو توقيع أو تسجيل حكومي");
    return result.lease;
  };

  const createRentalProperty = (values: Record<string, string>): DemoEntity => {
    permit();
    const result = applyRentalProperty(stateRef.current, values);
    setState(result.state);
    toast.success("حُفظ العقار وطريقة تأجيره ووحداته معًا");
    return result.property;
  };

  const importRentalProperties = (
    rows: Record<string, string>[],
    requestId: string
  ): DemoEntity[] => {
    permit();
    const result = applyRentalBatch(stateRef.current, rows, requestId);
    setState(result.state);
    toast.success("حُفظت دفعة العقارات كلها؛ لا حفظ جزئي للصفوف");
    return result.properties;
  };

  const commitTransition = <T,>(
    transition: (current: PrototypeState) => {
      state: PrototypeState;
      result: T;
    }
  ): T => {
    permit();
    const result = transition(stateRef.current);
    setState(result.state);
    return result.result;
  };

  const commitAssetTransition = <T,>(
    transition: (current: PrototypeState) => {
      state: PrototypeState;
      result: T;
    }
  ): Promise<T> => {
    const failure = (
      message: string,
      code: AssetTransitionFailureCode,
      assetCommitted = false
    ) => new AssetTransitionError(message, code, assetCommitted);
    const messageFor = (caught: unknown, fallback: string) =>
      caught instanceof Error && caught.message ? caught.message : fallback;
    const requestScopeKey = scopeKeyRef.current;
    const requestIdentity = identityRef.current;
    const requestIdentityToken = [
      requestScopeKey,
      requestIdentity.status,
      requestIdentity.userId ?? "",
      requestIdentity.localWorkspaceId ?? "",
      requestIdentity.verificationPending ? "pending" : "verified",
      requestIdentity.verificationError ?? "",
    ].join("\u0000");
    const hasFreshIdentity = () => {
      const current = identityRef.current;
      const currentToken = [
        scopeKeyRef.current,
        current.status,
        current.userId ?? "",
        current.localWorkspaceId ?? "",
        current.verificationPending ? "pending" : "verified",
        current.verificationError ?? "",
      ].join("\u0000");
      return (
        mountedRef.current &&
        scopeKeyRef.current === requestScopeKey &&
        currentToken === requestIdentityToken
      );
    };
    const staleSourceFailure = () =>
      failure(
        "تغيّرت بيانات مساحة العمل قبل اعتماد الحفظ المحلي؛ لم يُحفظ تعديل قديم. أبقِ مدخلات النموذج وأعد المراجعة.",
        "stale-source"
      );
    const scopeFailure = () =>
      failure(
        "تغيّر الحساب أو مساحة العمل أثناء الحفظ؛ لم ننقل التعديل إلى النطاق الجديد. أبقِ مدخلات النموذج وافتحه من المساحة الحالية.",
        "scope-changed"
      );

    // Fail before queueing when the form was already read-only/unpersistable.
    // The caller keeps its values and can roll back only freshly prepared media.
    try {
      if (!hasFreshIdentity()) throw scopeFailure();
      permitDurableAssetCommit();
    } catch (caught) {
      return Promise.reject(
        caught instanceof AssetTransitionError
          ? caught
          : failure(messageFor(caught, "تعذر بدء الحفظ المحلي."), "not-permitted")
      );
    }

    return enqueuePersistence(async () => {
      if (!hasFreshIdentity()) throw scopeFailure();
      try {
        permitDurableAssetCommit();
      } catch (caught) {
        throw failure(
          messageFor(caught, "لا يمكن تأكيد الحفظ المحلي."),
          storageRef.current.canPersist ? "not-permitted" : "durability-unavailable"
        );
      }

      // Evaluate only when this FIFO job reaches the front. A second asset save
      // therefore sees a preceding successful save instead of a stale render.
      const source = stateRef.current;
      const sourceRevision = memoryRevisionRef.current;
      let transitionResult: { state: PrototypeState; result: T };
      try {
        transitionResult = transition(source);
      } catch (caught) {
        throw failure(
          messageFor(caught, "تعذر التحقق من تعديل العقار أو الوحدة."),
          "transition-rejected"
        );
      }
      const validation = validatePrototypeState(transitionResult.state);
      if (!validation.success)
        throw failure(
          `لم يُعتمد تعديل العقار أو الوحدة: ${validation.message}`,
          "invalid-transition"
        );

      const expectedGeneration = generationRef.current;
      const sourceIsCurrent = () =>
        hasFreshIdentity() &&
        stateRef.current === source &&
        memoryRevisionRef.current === sourceRevision;
      const canWriteExactAssetSnapshot = () => {
        if (
          !sourceIsCurrent() ||
          generationRef.current !== expectedGeneration
        )
          return false;
        try {
          permitDurableAssetCommit();
          return true;
        } catch {
          return false;
        }
      };
      const canAcknowledgeAssetCommit = () => {
        if (!sourceIsCurrent()) return false;
        try {
          permitDurableAssetCommit();
          return true;
        } catch {
          return false;
        }
      };

      if (!hasFreshIdentity()) throw scopeFailure();
      if (
        stateRef.current !== source ||
        memoryRevisionRef.current !== sourceRevision
      )
        throw staleSourceFailure();
      try {
        permitDurableAssetCommit();
      } catch (caught) {
        throw failure(
          messageFor(caught, "لا يمكن تأكيد الحفظ المحلي."),
          storageRef.current.canPersist ? "not-permitted" : "durability-unavailable"
        );
      }

      const browser = localStorageRef.current;
      if (!browser)
        throw failure(
          "تخزين المتصفح غير متاح؛ لم يُحفظ العقار أو الوحدة ولم نغيّر الذاكرة.",
          "durability-unavailable"
        );
      const write = await writePrototypeWorkspaceGuarded(
        browser,
        scope,
        validation.data,
        expectedGeneration,
        { shouldWrite: canWriteExactAssetSnapshot }
      );
      if (!write.ok) {
        if (write.reason === "guard-rejected") {
          if (!hasFreshIdentity()) throw scopeFailure();
          if (
            stateRef.current !== source ||
            memoryRevisionRef.current !== sourceRevision
          )
            throw staleSourceFailure();
          try {
            permitDurableAssetCommit();
          } catch (caught) {
            throw failure(
              messageFor(caught, "لا يمكن تأكيد الحفظ المحلي."),
              storageRef.current.canPersist
                ? "not-permitted"
                : "durability-unavailable"
            );
          }
          throw staleSourceFailure();
        }
        const message =
          write.reason === "generation-conflict"
            ? write.message
            : `تعذر الحفظ المحلي للعقار أو الوحدة؛ لم يُعتمد التعديل ولم نغيّر الذاكرة. ${write.message}`;
        markPersistenceFailure(
          message,
          write.reason === "generation-conflict"
            ? "external-change"
            : "memory-only"
        );
        throw failure(
          message,
          write.reason === "generation-conflict"
            ? "generation-conflict"
            : "write-failed"
        );
      }

      // The raw snapshot is now durable. Do not roll back fresh local media if
      // the provider becomes stale before React can acknowledge this result.
      lastPersistedRawRef.current = write.raw;
      if (
        mountedRef.current &&
        scopeKeyRef.current === requestScopeKey
      ) {
        setStorageFromMetadata(write.metadata);
        announceLocalWrite(write.metadata);
      }
      if (!canAcknowledgeAssetCommit()) {
        throw failure(
          "اكتمل حفظ محلي محروس، لكن تغيّر السياق قبل تأكيد النموذج. لا تحذف الملفات المجهزة؛ راجع السجل في مساحة العمل الصحيحة.",
          "acknowledgement-blocked",
          true
        );
      }

      setState(validation.data);
      return transitionResult.result;
    });
  };

  const recordCollection = (
    id: string,
    amountMinor: number,
    method: string,
    status: string,
    collectionDate = scenarioDate(stateRef.current)
  ) => {
    permit();
    const next = applyCollectionEntries(
      stateRef.current,
      [{ receivableId: id, amountMinor }],
      {
        method,
        status,
        collectionDate,
      }
    );
    setState(next);
    toast.success("سُجل التحصيل وتحدث المبلغ المتبقي في النموذج");
  };

  const recordPropertyMonthCollection = (
    propertyId: string,
    month: string,
    method: string,
    collectionDate: string,
    expectedRemainingMinor: number
  ) => {
    permit();
    const next = applyPropertyMonthCollection(
      stateRef.current,
      propertyId,
      month,
      method,
      collectionDate,
      expectedRemainingMinor
    );
    setState(next);
    toast.success(
      "تم تسجيل تحصيل إيجار الشهر لهذا العقار؛ لن يُكرر الجزء المحصل سابقًا"
    );
  };

  const recordLoss = (id: string, amountMinor: number, reason: string) => {
    permit();
    const source = stateRef.current.entities.receivables.find(
      row => row.id === id
    );
    if (!source || !reason.trim())
      throw new Error("الاستحقاق وسبب الخسارة مطلوبان");
    if (
      !isMinorAmount(amountMinor) ||
      amountMinor === 0 ||
      amountMinor > outstandingFor(stateRef.current.entities, id)
    )
      throw new Error("قيمة الخسارة تتجاوز المتبقي أو غير صالحة");
    add("losses", {
      title: `خسارة • ${source.title}`,
      portfolioId: source.portfolioId,
      propertyId: source.propertyId,
      amountMinor,
      status: "مسجلة",
      meta: {
        receivableId: id,
        reason,
        recordedBy: "موظف النموذج",
        waiver: false,
      },
    });
  };

  const recordRecovery = (lossId: string, amountMinor: number) => {
    permit();
    const source = stateRef.current.entities.losses.find(
      row => row.id === lossId
    );
    if (!source) throw new Error("سجل الخسارة غير موجود");
    const paid = stateRef.current.entities.collections
      .filter(
        row =>
          row.meta.recoveryParent === lossId &&
          ["محصّل", "محصل", "مسوّى"].includes(row.status)
      )
      .reduce((n, row) => n + row.amountMinor, 0);
    if (
      !isMinorAmount(amountMinor) ||
      amountMinor === 0 ||
      amountMinor > source.amountMinor - paid
    )
      throw new Error("الاسترداد يتجاوز المتبقي من الخسارة");
    add("collections", {
      title: `استرداد • ${source.title}`,
      amountMinor,
      portfolioId: source.portfolioId,
      propertyId: source.propertyId,
      status: "محصّل",
      meta: { recoveryParent: lossId, method: "تحويل", type: "استرداد" },
    });
  };

  const exportWorkspace = () => rawFor(stateRef.current);
  const exportRecoveryRaw = () => {
    const browser = localStorageRef.current;
    if (!browser) return null;
    return (
      readRecoveryRaw(browser, scope) ??
      (storageRef.current.kind === "legacy-warning"
        ? readLegacyRaw(browser)
        : null)
    );
  };

  const restoreExportToNewWorkspace = async (
    snapshot: PrototypeState
  ): Promise<boolean> => {
    if (identity.verificationPending || identity.verificationError) {
      throw new Error(
        identity.verificationError ??
          "لا يمكن استعادة التصدير قبل اكتمال التحقق من الهوية."
      );
    }
    const validation = validatePrototypeState(snapshot);
    if (!validation.success)
      throw new Error(`ملف التصدير غير صالح: ${validation.message}`);
    // A validated restore must preserve ids, relations, balances, and audit
    // history exactly; it is deliberately not normalized or regenerated here.
    return onRestoreToNewWorkspace(validation.data);
  };

  const repairLocalWorkspace = async (): Promise<boolean> => {
    const next = freshDemoState();
    if (
      !(await persistExact(next, {
        cloudBaseRevision: null,
        allowExplicitRecoveryOverwrite: true,
      }))
    )
      return false;
    setState(next);
    toast.success("أُنشئت نسخة تجريبية جديدة بعد الاحتفاظ بنسخة الاسترداد");
    return true;
  };

  const retryLocalPersistence = async (): Promise<boolean> => {
    if (!mayChangeMemory(storageRef.current)) return false;
    return persistExact(stateRef.current);
  };

  const loadLatestLocalWorkspace = async (): Promise<boolean> => {
    const browser = localStorageRef.current;
    if (!browser) return false;
    const loaded = loadPrototypeWorkspace(browser, scope);
    if (loaded.kind !== "ready") {
      markPersistenceFailure(
        loaded.kind === "empty"
          ? "لا توجد نسخة محلية أحدث للتحميل."
          : loaded.message,
        loaded.kind === "recovery-required" || loaded.kind === "legacy-warning"
          ? loaded.kind
          : "memory-only"
      );
      return false;
    }
    const backup = backupPrototypeWorkspace(browser, scope, stateRef.current);
    if (!backup.ok) {
      markPersistenceFailure(backup.message);
      return false;
    }
    const next = assertPrototypeState(normalizePrototype(loaded.state));
    lastPersistedRawRef.current = loaded.raw;
    setStorageFromMetadata(loaded.metadata);
    setState(next);
    return true;
  };

  const adoptCloudWorkspace = (
    snapshot: PrototypeState,
    revision: number
  ): Promise<boolean> => {
    return (async () => {
      if (!Number.isInteger(revision) || revision < 0)
        throw new Error("إصدار النسخة السحابية غير صالح");
      const validation = validatePrototypeState(snapshot);
      if (!validation.success)
        throw new Error(`تعذر تحميل النسخة السحابية: ${validation.message}`);
      const browser = localStorageRef.current;
      if (!browser) {
        markPersistenceFailure(
          "لا يمكن تحميل السحابة قبل إنشاء نسخة محلية احتياطية؛ التخزين غير متاح."
        );
        return false;
      }
      const backup = backupPrototypeWorkspace(browser, scope, stateRef.current);
      if (!backup.ok) {
        markPersistenceFailure(backup.message);
        return false;
      }
      const next = assertPrototypeState(normalizePrototype(validation.data));
      if (!(await persistExact(next, { cloudBaseRevision: revision })))
        return false;
      setState(next);
      return true;
    })();
  };

  const initializeEmptyCloudBaseline = (
    revision: number,
    hasSnapshot: boolean
  ): Promise<boolean> => {
    return (async () => {
      if (
        revision !== 0 ||
        hasSnapshot ||
        storageRef.current.cloudBaseRevision !== null
      )
        return false;
      // The server explicitly proved that no cloud row exists (R0); it is the
      // only observed revision that may seed a fresh local baseline.
      return persistExact(stateRef.current, { cloudBaseRevision: 0 });
    })();
  };

  const markCloudSaveSuccess = (
    revision: number,
    savedSnapshot: PrototypeState,
    expectedStorageKey: string
  ): Promise<boolean> => {
    return (async () => {
      if (
        expectedStorageKey !== resolvedScope.storageKey ||
        !Number.isInteger(revision) ||
        revision < 1
      )
        return false;
      // A newer local edit after the request is deliberately not rebound to the
      // server result. Retrying from the old base will conflict rather than claim
      // that unsubmitted data was built on the new remote revision.
      if (rawFor(stateRef.current) !== rawFor(savedSnapshot)) return false;
      return persistExact(stateRef.current, { cloudBaseRevision: revision });
    })();
  };

  const financials = useMemo(
    () =>
      financialSummary(
        state.entities,
        state.settings.portfolioId,
        state.settings.period,
        scenarioDate(state)
      ),
    [
      state.entities,
      state.settings.portfolioId,
      state.settings.period,
      state.settings.scenarioDate,
    ]
  );

  const value: PrototypeContextValue = {
    state,
    canEdit:
      state.settings.role === "operator" &&
      mayChangeMemory(storage) &&
      !identity.verificationPending &&
      !identity.verificationError,
    financials,
    add,
    patch,
    setStatus,
    log,
    issueBillingDocument,
    collectBillingDocument,
    saveLeaseTemplate,
    refreshRenewalTemplateSnapshot: (leaseId, templateId, requestId) => {
      commitTransition(current =>
        applyRenewalTemplateSnapshot(current, leaseId, templateId, requestId)
      );
      return true;
    },
    payMaintenanceExpense: (expenseId, date, method, requestId) =>
      commitTransition(current => {
        const next = applyMaintenancePayment(
          current,
          expenseId,
          date,
          method,
          requestId
        );
        return { state: next.state, result: next.result.payment };
      }),
    generateTemplateLease,
    createRentalProperty,
    importRentalProperties,
    commitTransition,
    commitAssetTransition,
    recordCollection,
    recordPropertyMonthCollection,
    recordLoss,
    recordRecovery,
    list: kind => state.entities[kind],
    filtered: kind =>
      state.entities[kind].filter(
        row =>
          state.settings.portfolioId === "all" ||
          row.portfolioId === state.settings.portfolioId
      ),
    find: (kind, id) => state.entities[kind].find(row => row.id === id),
    outstanding: id => outstandingFor(state.entities, id),
    setSetting: (key, value) => {
      assertWorkspaceMutable();
      setState(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          [key]: value,
        } as PrototypeState["settings"],
      }));
    },
    reset: () => {
      assertWorkspaceMutable();
      setState(freshDemoState());
      toast.success("أعيدت بيانات التجربة الأصلية في مساحة العمل الحالية فقط");
    },
    replaceState: snapshot => {
      assertWorkspaceMutable();
      setState(assertPrototypeState(normalizePrototype(snapshot)));
      toast.success("حُملت نسخة التجربة الخاصة بك");
    },
    identity: { ...identity, storageKey: resolvedScope.storageKey },
    storage,
    cloudBaseline: {
      revision: storage.cloudBaseRevision,
      localGeneration: storage.generation,
    },
    exportWorkspace,
    exportRecoveryRaw,
    repairLocalWorkspace,
    retryLocalPersistence,
    createSeparateLocalWorkspace: onCreateSeparateWorkspace,
    restoreExportToNewWorkspace,
    loadLatestLocalWorkspace,
    adoptCloudWorkspace,
    initializeEmptyCloudBaseline,
    markCloudSaveSuccess,
  };

  return (
    <PrototypeContext.Provider value={value}>
      {children}
    </PrototypeContext.Provider>
  );
}

/**
 * Direct usage is deliberately a known, scoped guest workspace for SSR and
 * focused DOM tests. Production identity selection belongs in
 * WorkspaceIdentityBoundary, outside this provider.
 */
export function PrototypeProvider({
  children,
  identity = DEFAULT_IDENTITY,
}: {
  children: ReactNode;
  identity?: PrototypeWorkspaceIdentity;
}) {
  const identityKey = `${identity.status}:${identity.userId ?? "guest"}`;
  return (
    <IdentityScopedPrototypeProvider key={identityKey} identity={identity}>
      {children}
    </IdentityScopedPrototypeProvider>
  );
}

export function usePrototype(): PrototypeContextValue {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error("PrototypeProvider مطلوب");
  return value;
}
