import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Clock3,
  Download,
  ExternalLink,
  Link2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  PROPERTY_MEDIA_SECTIONS,
  MediaKindIcon,
  PropertyMediaPreview,
} from "./PropertyMediaGalleryParts";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  createPropertyMediaId,
  discardPropertyMedia,
  loadPropertyMedia,
  loadPropertyMediaById,
  lookupPropertyMedia,
  makePropertyMediaDescriptor,
  parsePropertyMedia,
  serializePropertyMedia,
  storePropertyMedia,
  validatePropertyMediaFile,
} from "@/lib/property-media";
import {
  MAX_PROPERTY_MEDIA_PHOTOS,
  MAX_PROPERTY_MEDIA_PLANS,
  type PropertyMediaDescriptor,
  type PropertyMediaKind,
  type PropertyMediaManifest,
} from "@shared/property-media-types";

export interface PropertyMediaEditorHandle {
  prepare(): Promise<string>;
  rollback(): Promise<void>;
}

export interface PropertyMediaEditorProps {
  /** Legacy controlled metadata value: it is both source and current draft. */
  value?: string;
  /** Optional saved/source metadata when a parent separates source from draft. */
  source?: string;
  /** Optional current draft metadata. It takes precedence over source/value. */
  draft?: string;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
}

type PendingMedia = {
  file: File;
  url: string;
  pendingKey: string;
  selectionId: number;
  scopeKey: string;
};
type PendingByKind = Partial<Record<PropertyMediaKind, PendingMedia[]>>;
type WrittenMedia = { scopeKey: string; kind: PropertyMediaKind; id: string };
type SavedReference = {
  key: string;
  kind: PropertyMediaKind;
  id: string;
  source: "descriptor" | "id";
  descriptor?: PropertyMediaDescriptor;
};
type LoadedMedia = {
  reference: SavedReference;
  scopeKey: string;
  status: "loading" | "available" | "missing";
  url?: string;
};

const KINDS: PropertyMediaKind[] = ["photo", "plan", "video"];

function cloneManifest(manifest: PropertyMediaManifest): PropertyMediaManifest {
  return {
    v: 1,
    ...(manifest.photo ? { photo: manifest.photo } : {}),
    ...(manifest.plan ? { plan: manifest.plan } : {}),
    ...(manifest.photoIds?.length ? { photoIds: [...manifest.photoIds] } : {}),
    ...(manifest.planIds?.length ? { planIds: [...manifest.planIds] } : {}),
    ...(manifest.video ? { video: manifest.video } : {}),
    ...(manifest.videoUrl ? { videoUrl: manifest.videoUrl } : {}),
  };
}

function parsedManifest(value: string): {
  manifest: PropertyMediaManifest;
  error: string | null;
} {
  try {
    return { manifest: parsePropertyMedia(value), error: null };
  } catch (error) {
    return {
      manifest: { v: 1 },
      error:
        error instanceof Error ? error.message : "تعذّر قراءة بيانات المرفقات.",
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "تعذّر إتمام عملية المرفق. حاول مرة أخرى.";
}

function safeRevoke(url: string | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // URL revocation is best-effort and must not interrupt form editing.
  }
}

function kindLabel(kind: PropertyMediaKind, plural = false): string {
  if (kind === "photo") return plural ? "صور العقار" : "صورة العقار";
  if (kind === "plan") return plural ? "المخططات والخرائط" : "مخطط أو خريطة";
  return "فيديو العقار";
}

function acceptFor(kind: PropertyMediaKind) {
  if (kind === "photo")
    return ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
  if (kind === "plan")
    return ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
  return ".mp4,.webm,video/mp4,video/webm";
}

function limitFor(kind: PropertyMediaKind) {
  if (kind === "photo")
    return `JPG أو PNG أو WebP · حتى ${MAX_PROPERTY_MEDIA_PHOTOS} صورة، 5 ميغابايت لكل صورة`;
  if (kind === "plan")
    return `JPG أو PNG أو WebP أو PDF · حتى ${MAX_PROPERTY_MEDIA_PLANS} ملفات، 10 ميغابايت لكل ملف`;
  return "MP4 أو WebM · ملف واحد حتى 50 ميغابايت";
}

function descriptorKey(descriptor: PropertyMediaDescriptor) {
  return `${descriptor.id}:${descriptor.name}:${descriptor.mime}:${descriptor.size}`;
}

function sameDescriptor(
  left: PropertyMediaDescriptor,
  right: PropertyMediaDescriptor
): boolean {
  return descriptorKey(left) === descriptorKey(right);
}

function savedReferences(manifest: PropertyMediaManifest): SavedReference[] {
  const references: SavedReference[] = [];
  if (manifest.photo)
    references.push({
      key: `photo:descriptor:${descriptorKey(manifest.photo)}`,
      kind: "photo",
      id: manifest.photo.id,
      source: "descriptor",
      descriptor: manifest.photo,
    });
  for (const id of manifest.photoIds ?? [])
    references.push({ key: `photo:id:${id}`, kind: "photo", id, source: "id" });
  if (manifest.plan)
    references.push({
      key: `plan:descriptor:${descriptorKey(manifest.plan)}`,
      kind: "plan",
      id: manifest.plan.id,
      source: "descriptor",
      descriptor: manifest.plan,
    });
  for (const id of manifest.planIds ?? [])
    references.push({ key: `plan:id:${id}`, kind: "plan", id, source: "id" });
  if (manifest.video)
    references.push({
      key: `video:descriptor:${descriptorKey(manifest.video)}`,
      kind: "video",
      id: manifest.video.id,
      source: "descriptor",
      descriptor: manifest.video,
    });
  return references;
}

function copyWithoutReference(
  current: PropertyMediaManifest,
  reference: SavedReference
): PropertyMediaManifest {
  const next = cloneManifest(current);
  if (reference.source === "descriptor") {
    if (reference.kind === "photo") delete next.photo;
    if (reference.kind === "plan") delete next.plan;
    if (reference.kind === "video") delete next.video;
    return next;
  }
  if (reference.kind === "photo") {
    const ids = (next.photoIds ?? []).filter(id => id !== reference.id);
    if (ids.length) next.photoIds = ids;
    else delete next.photoIds;
  }
  if (reference.kind === "plan") {
    const ids = (next.planIds ?? []).filter(id => id !== reference.id);
    if (ids.length) next.planIds = ids;
    else delete next.planIds;
  }
  return next;
}

/**
 * Keeps selected files in this component until the form owner explicitly calls
 * prepare(). The incoming source/draft is only opaque metadata; no selection
 * writes IndexedDB or emits a descriptor before successful preparation.
 */
export const PropertyMediaEditor = forwardRef<
  PropertyMediaEditorHandle,
  PropertyMediaEditorProps
>(function PropertyMediaEditor(
  {
    value,
    source,
    draft,
    onChange,
    onBusyChange,
    onDirtyChange,
    disabled = false,
  },
  ref
) {
  const { identity, canEdit } = usePrototype();
  const incomingValue = draft ?? value ?? source ?? "";
  const incoming = useMemo(
    () => parsedManifest(incomingValue),
    [incomingValue]
  );
  const [manifest, setManifest] = useState<PropertyMediaManifest>(
    incoming.manifest
  );
  const [manifestError, setManifestError] = useState<string | null>(
    incoming.error
  );
  const [pending, setPending] = useState<PendingByKind>({});
  const [loaded, setLoaded] = useState<Record<string, LoadedMedia>>({});
  const [selectionError, setSelectionError] = useState<
    Partial<Record<PropertyMediaKind | "videoUrl", string>>
  >({});
  const [videoUrlDraft, setVideoUrlDraft] = useState(
    incoming.manifest.videoUrl ?? ""
  );
  const [busyCount, setBusyCount] = useState(0);
  const [preparedLocked, setPreparedLocked] = useState(false);

  const mountedRef = useRef(true);
  const scopeRef = useRef(identity.storageKey);
  const canEditRef = useRef(canEdit);
  const manifestRef = useRef(manifest);
  const manifestErrorRef = useRef<string | null>(incoming.error);
  const pendingRef = useRef<PendingByKind>({});
  const writtenRef = useRef<WrittenMedia[]>([]);
  const loadedUrlsRef = useRef<string[]>([]);
  const selectionIdsRef = useRef<Record<PropertyMediaKind, number>>({
    photo: 0,
    plan: 0,
    video: 0,
  });
  const preparePromiseRef = useRef<Promise<string> | null>(null);
  const preparedResultRef = useRef<string | null>(null);
  const priorScopeRef = useRef(identity.storageKey);
  const fileInputId = useId();
  const fileInputsRef = useRef<
    Partial<Record<PropertyMediaKind, HTMLInputElement | null>>
  >({});

  // Update during render so an asynchronous continuation never uses stale scope or
  // permission values from the event that originally started it.
  scopeRef.current = identity.storageKey;
  canEditRef.current = canEdit;

  const isCurrentScope = useCallback(
    (expectedScope: string) =>
      mountedRef.current && scopeRef.current === expectedScope,
    []
  );
  const isCurrentEditor = useCallback(
    (expectedScope: string) =>
      isCurrentScope(expectedScope) && canEditRef.current,
    [isCurrentScope]
  );

  const clearLoadedUrls = useCallback(() => {
    loadedUrlsRef.current.forEach(safeRevoke);
    loadedUrlsRef.current = [];
  }, []);

  const replacePending = useCallback(
    (kind: PropertyMediaKind, next: PendingMedia[]) => {
      const previous = pendingRef.current[kind] ?? [];
      const retained = new Set(next);
      previous.forEach(item => {
        if (!retained.has(item)) safeRevoke(item.url);
      });
      const nextPending = { ...pendingRef.current };
      if (next.length) nextPending[kind] = next;
      else delete nextPending[kind];
      pendingRef.current = nextPending;
      if (mountedRef.current) setPending(nextPending);
    },
    []
  );

  const setManifestAndNotify = useCallback(
    (next: PropertyMediaManifest) => {
      const serialized = serializePropertyMedia(next);
      manifestRef.current = next;
      manifestErrorRef.current = null;
      setManifest(next);
      setManifestError(null);
      onChange(serialized);
    },
    [onChange]
  );

  useEffect(() => {
    manifestRef.current = incoming.manifest;
    manifestErrorRef.current = incoming.error;
    setManifest(incoming.manifest);
    setManifestError(incoming.error);
    setVideoUrlDraft(incoming.manifest.videoUrl ?? "");
    // A parent only supplies the exact prepared metadata after its surrounding
    // property transition succeeds. At that point the new bytes are referenced:
    // clear UI-only pending state without rolling back any persisted blob.
    if (preparedResultRef.current === incomingValue) {
      KINDS.forEach(kind => replacePending(kind, []));
      writtenRef.current = [];
      preparedResultRef.current = null;
      preparePromiseRef.current = null;
      setPreparedLocked(false);
    }
  }, [incoming, incomingValue, replacePending]);

  useEffect(() => {
    if (priorScopeRef.current === identity.storageKey) return;
    priorScopeRef.current = identity.storageKey;
    KINDS.forEach(kind => (selectionIdsRef.current[kind] += 1));
    KINDS.forEach(kind => replacePending(kind, []));
    preparedResultRef.current = null;
    preparePromiseRef.current = null;
    setPreparedLocked(false);
    setSelectionError({});
  }, [identity.storageKey, replacePending]);

  useEffect(() => {
    onBusyChange?.(busyCount > 0);
  }, [busyCount, onBusyChange]);

  useEffect(() => {
    onDirtyChange?.(Object.values(pending).some(items => items?.length));
  }, [onDirtyChange, pending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      Object.values(pendingRef.current).forEach(items =>
        items?.forEach(item => safeRevoke(item.url))
      );
      pendingRef.current = {};
      clearLoadedUrls();
      onBusyChange?.(false);
    };
  }, [clearLoadedUrls, onBusyChange]);

  const references = useMemo(() => savedReferences(manifest), [manifest]);
  const manifestKey = references.map(reference => reference.key).join("|");

  useEffect(() => {
    let cancelled = false;
    const expectedScope = identity.storageKey;
    const snapshot = references;

    clearLoadedUrls();
    setLoaded(
      Object.fromEntries(
        snapshot.map(reference => [
          reference.key,
          { reference, scopeKey: expectedScope, status: "loading" as const },
        ])
      )
    );

    const current = () =>
      !cancelled && isCurrentScope(expectedScope) && mountedRef.current;
    const load = async (reference: SavedReference) => {
      if (!current()) return;
      let descriptor: PropertyMediaDescriptor | null | undefined =
        reference.descriptor;
      let blob: Blob | null = null;
      try {
        if (reference.source === "id") {
          descriptor = await lookupPropertyMedia(
            expectedScope,
            reference.id,
            reference.kind
          );
          if (descriptor && current())
            blob = await loadPropertyMediaById(
              expectedScope,
              reference.id,
              reference.kind
            );
        } else if (descriptor) {
          blob = await loadPropertyMedia(
            expectedScope,
            descriptor,
            reference.kind
          );
        }
      } catch {
        descriptor = null;
        blob = null;
      }
      if (!current()) return;
      if (!descriptor || !blob) {
        setLoaded(previous => ({
          ...previous,
          [reference.key]: {
            reference,
            scopeKey: expectedScope,
            status: "missing",
          },
        }));
        return;
      }
      const url = URL.createObjectURL(blob);
      if (!current()) {
        safeRevoke(url);
        return;
      }
      loadedUrlsRef.current.push(url);
      setLoaded(previous => ({
        ...previous,
        [reference.key]: {
          reference: { ...reference, descriptor },
          scopeKey: expectedScope,
          status: "available",
          url,
        },
      }));
    };

    snapshot.forEach(reference => void load(reference));
    return () => {
      cancelled = true;
    };
  }, [
    clearLoadedUrls,
    identity.storageKey,
    isCurrentScope,
    manifestKey,
    references,
  ]);

  const beginBusy = useCallback(() => {
    if (mountedRef.current) setBusyCount(count => count + 1);
  }, []);
  const endBusy = useCallback(() => {
    if (mountedRef.current) setBusyCount(count => Math.max(0, count - 1));
  }, []);

  const chooseFiles = useCallback(
    async (kind: PropertyMediaKind, files: File[]) => {
      if (!files.length || disabled || !canEditRef.current || preparedLocked) {
        return;
      }
      const expectedScope = scopeRef.current;
      const selectionId = ++selectionIdsRef.current[kind];
      setSelectionError(current => ({ ...current, [kind]: undefined }));
      const savedIds =
        kind === "photo"
          ? (manifestRef.current.photoIds ?? [])
          : kind === "plan"
            ? (manifestRef.current.planIds ?? [])
            : [];
      const legacy =
        kind === "photo"
          ? manifestRef.current.photo
          : kind === "plan"
            ? manifestRef.current.plan
            : undefined;
      const existing =
        new Set([...savedIds, ...(legacy ? [legacy.id] : [])]).size +
        (pendingRef.current[kind]?.length ?? 0);
      const maximum =
        kind === "photo"
          ? MAX_PROPERTY_MEDIA_PHOTOS
          : kind === "plan"
            ? MAX_PROPERTY_MEDIA_PLANS
            : 1;
      if (existing + files.length > maximum) {
        setSelectionError(current => ({
          ...current,
          [kind]: `يمكن اختيار ${maximum} ${kind === "photo" ? "صورة" : kind === "plan" ? "ملفات مخطط" : "فيديو"} كحد أقصى؛ لم يتغير الاختيار.`,
        }));
        return;
      }
      beginBusy();
      try {
        if (!isCurrentEditor(expectedScope)) return;
        // Validate the complete newly selected group before allocating a single
        // object URL. This makes rejection/cancel paths all-or-nothing.
        await Promise.all(
          files.map(file => validatePropertyMediaFile(file, kind))
        );
        if (
          !isCurrentEditor(expectedScope) ||
          selectionIdsRef.current[kind] !== selectionId
        ) {
          return;
        }
        const selected = files.map((file, index) => ({
          file,
          url: URL.createObjectURL(file),
          pendingKey: `${selectionId}:${index}:${file.name}`,
          selectionId,
          scopeKey: expectedScope,
        }));
        if (
          !isCurrentEditor(expectedScope) ||
          selectionIdsRef.current[kind] !== selectionId
        ) {
          selected.forEach(item => safeRevoke(item.url));
          return;
        }
        const previous = pendingRef.current[kind] ?? [];
        replacePending(
          kind,
          kind === "video" ? selected : [...previous, ...selected]
        );
      } catch (error) {
        if (
          isCurrentEditor(expectedScope) &&
          selectionIdsRef.current[kind] === selectionId
        ) {
          setSelectionError(current => ({
            ...current,
            [kind]: errorMessage(error),
          }));
        }
      } finally {
        endBusy();
      }
    },
    [
      beginBusy,
      disabled,
      endBusy,
      isCurrentEditor,
      preparedLocked,
      replacePending,
    ]
  );

  const removePending = useCallback(
    (kind: PropertyMediaKind, pendingKey: string) => {
      if (disabled || !canEditRef.current || preparedLocked) return;
      replacePending(
        kind,
        (pendingRef.current[kind] ?? []).filter(
          item => item.pendingKey !== pendingKey
        )
      );
    },
    [disabled, preparedLocked, replacePending]
  );

  const removeSaved = useCallback(
    (reference: SavedReference) => {
      if (disabled || !canEditRef.current || preparedLocked) return;
      setManifestAndNotify(
        copyWithoutReference(manifestRef.current, reference)
      );
    },
    [disabled, preparedLocked, setManifestAndNotify]
  );

  const updateVideoUrl = useCallback(
    (raw: string) => {
      setVideoUrlDraft(raw);
      if (disabled || !canEditRef.current || preparedLocked) return;
      try {
        const next = cloneManifest(manifestRef.current);
        if (raw) next.videoUrl = raw;
        else delete next.videoUrl;
        setManifestAndNotify(next);
        setSelectionError(current => ({ ...current, videoUrl: undefined }));
      } catch (error) {
        setSelectionError(current => ({
          ...current,
          videoUrl: errorMessage(error),
        }));
      }
    },
    [disabled, preparedLocked, setManifestAndNotify]
  );

  const discardFreshWrites = useCallback(
    async (expectedScope: string) => {
      const writes = writtenRef.current.filter(
        written => written.scopeKey === expectedScope
      );
      writtenRef.current = writtenRef.current.filter(
        written => written.scopeKey !== expectedScope
      );
      for (const written of writes) {
        // Do not cross a workspace boundary just to clean an old namespace.
        if (!isCurrentScope(expectedScope)) return;
        try {
          await discardPropertyMedia(expectedScope, written.id);
        } catch {
          // Keep attempting known fresh writes; incoming saved files are never here.
        }
        if (!isCurrentScope(expectedScope)) return;
      }
    },
    [isCurrentScope]
  );

  const rollback = useCallback(async () => {
    const scopes = [...new Set(writtenRef.current.map(item => item.scopeKey))];
    preparedResultRef.current = null;
    preparePromiseRef.current = null;
    if (mountedRef.current) setPreparedLocked(false);
    for (const expectedScope of scopes) await discardFreshWrites(expectedScope);
  }, [discardFreshWrites]);

  const performPrepare = useCallback(async (): Promise<string> => {
    const expectedScope = scopeRef.current;
    if (!isCurrentEditor(expectedScope))
      throw new Error("لا يمكن حفظ المرفقات في المعاينة الحالية.");
    if (manifestErrorRef.current) throw new Error(manifestErrorRef.current);

    beginBusy();
    try {
      const next = cloneManifest(manifestRef.current);
      const usedIds = new Set(
        savedReferences(next).map(reference => reference.id)
      );
      const planned: Array<{
        pending: PendingMedia;
        kind: PropertyMediaKind;
        descriptor: PropertyMediaDescriptor;
      }> = [];
      for (const kind of KINDS) {
        for (const selected of pendingRef.current[kind] ?? []) {
          if (selected.scopeKey !== expectedScope) continue;
          let id = createPropertyMediaId();
          while (usedIds.has(id)) id = createPropertyMediaId();
          usedIds.add(id);
          planned.push({
            pending: selected,
            kind,
            descriptor: makePropertyMediaDescriptor(id, selected.file, kind),
          });
        }
      }
      const photoDescriptors = planned.filter(item => item.kind === "photo");
      const planDescriptors = planned.filter(item => item.kind === "plan");
      const videoDescriptor = planned.find(
        item => item.kind === "video"
      )?.descriptor;
      if (photoDescriptors.length) {
        next.photoIds = [
          ...(next.photoIds ?? []),
          ...photoDescriptors.map(item => item.descriptor.id),
        ];
      }
      if (planDescriptors.length) {
        next.planIds = [
          ...(next.planIds ?? []),
          ...planDescriptors.map(item => item.descriptor.id),
        ];
      }
      if (videoDescriptor) next.video = videoDescriptor;

      // Validate the exact future source JSON before the first IndexedDB write.
      // No cap failure can truncate references or leave a new orphaned blob.
      serializePropertyMedia(next);
      if (!isCurrentEditor(expectedScope))
        throw new Error("تغيّر سياق الحفظ قبل اكتمال المرفقات.");

      for (const item of planned) {
        const stored = await storePropertyMedia(
          expectedScope,
          item.kind,
          item.pending.file,
          item.descriptor.id
        );
        // Register every fresh write before any later context check so rollback
        // can remove only it if the form transition does not commit.
        writtenRef.current.push({
          scopeKey: expectedScope,
          kind: item.kind,
          id: stored.id,
        });
        if (!sameDescriptor(stored, item.descriptor)) {
          throw new Error("تعذر تأكيد مرجع الملف المحلي؛ لم يتغير العقار.");
        }
        if (
          !isCurrentEditor(expectedScope) ||
          !(pendingRef.current[item.kind] ?? []).includes(item.pending)
        ) {
          throw new Error("تغيّر المرفق قبل اكتمال الحفظ.");
        }
      }
      if (!isCurrentEditor(expectedScope))
        throw new Error("تغيّر سياق الحفظ قبل اكتمال المرفقات.");
      const result = serializePropertyMedia(next);
      preparedResultRef.current = result;
      if (mountedRef.current) setPreparedLocked(true);
      return result;
    } catch (error) {
      await discardFreshWrites(expectedScope);
      throw error;
    } finally {
      endBusy();
    }
  }, [beginBusy, discardFreshWrites, endBusy, isCurrentEditor]);

  const prepare = useCallback((): Promise<string> => {
    if (preparedResultRef.current !== null)
      return Promise.resolve(preparedResultRef.current);
    if (preparePromiseRef.current) return preparePromiseRef.current;
    const promise = performPrepare();
    preparePromiseRef.current = promise;
    void promise.then(
      () => {
        if (preparePromiseRef.current === promise)
          preparePromiseRef.current = null;
      },
      () => {
        if (preparePromiseRef.current === promise)
          preparePromiseRef.current = null;
      }
    );
    return promise;
  }, [performPrepare]);

  useImperativeHandle(ref, () => ({ prepare, rollback }), [prepare, rollback]);

  const controlsDisabled = disabled || !canEdit || preparedLocked;
  const loadedFor = (reference: SavedReference) => {
    const candidate = loaded[reference.key];
    return candidate?.scopeKey === identity.storageKey ? candidate : undefined;
  };

  return (
    <section
      className="property-media-editor"
     
      aria-label="مرفقات العقار"
    >
      <p className="property-media-notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <span>
          المرفقات محفوظة في هذا المتصفح فقط؛ الحفظ السحابي وتصدير JSON لا
          ينقلان الملفات.
        </span>
      </p>
      <p className="property-media-save-hint">
        اختر الملفات وراجع معاينتها، ثم اضغط «حفظ العقار» أو «حفظ التعديل» أسفل
        النافذة لتثبيتها.
      </p>
      {manifestError && (
        <p className="property-media-error" role="alert">
          {manifestError}
        </p>
      )}

      {PROPERTY_MEDIA_SECTIONS.map(({ kind, title, action, empty }) => {
        const selected = pending[kind] ?? [];
        const saved = references.filter(reference => reference.kind === kind);
        const count = saved.length + selected.length;
        const maximum =
          kind === "photo"
            ? MAX_PROPERTY_MEDIA_PHOTOS
            : kind === "plan"
              ? MAX_PROPERTY_MEDIA_PLANS
              : 1;
        return (
          <fieldset className="property-media-slot" key={kind}>
            <legend className="property-media-sr-only">{title}</legend>
            <div className="property-media-slot-heading">
              <span className="property-media-kind-icon">
                <MediaKindIcon kind={kind} />
              </span>
              <div className="property-media-slot-heading-text">
                <h4>{title}</h4>
                <p className="property-media-limit">{limitFor(kind)}</p>
              </div>
              <span
                className="property-media-count"
                aria-label={`عدد ملفات ${title}: ${count} من ${maximum}`}
                dir="ltr"
              >
                {count} / {maximum}
              </span>
            </div>
            <button
              type="button"
              className="btn-primary property-media-add"
              aria-controls={`${fileInputId}-${kind}`}
              disabled={controlsDisabled}
              onClick={() => fileInputsRef.current[kind]?.click()}
            >
              <MediaKindIcon kind={kind} />
              {action}
            </button>
            <input
              id={`${fileInputId}-${kind}`}
              ref={node => {
                fileInputsRef.current[kind] = node;
              }}
              hidden
              aria-label={`اختيار ${kindLabel(kind, kind !== "video")}`}
              type="file"
              accept={acceptFor(kind)}
              multiple={kind !== "video"}
              disabled={controlsDisabled}
              onChange={event => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void chooseFiles(kind, files);
              }}
            />
            {selectionError[kind] && (
              <p className="property-media-error" role="alert">
                {selectionError[kind]}
              </p>
            )}

            {!count && <p className="property-media-empty">{empty}</p>}
            <div className="property-media-grid" aria-live="polite">
              {selected.map(item => (
                <article className="property-media-item" key={item.pendingKey}>
                  <PropertyMediaPreview
                    kind={kind}
                    mime={item.file.type}
                    url={item.url}
                    alt={`${kindLabel(kind)} جديد`}
                  />
                  <div className="property-media-item-body">
                    <strong className="property-media-filename" dir="auto">
                      {item.file.name}
                    </strong>
                    <span className="property-media-status property-media-status--pending">
                      <Clock3 size={14} aria-hidden="true" />
                      ملف محلي بانتظار الحفظ
                    </span>
                    <div className="property-media-actions">
                      {item.file.type === "application/pdf" &&
                        kind === "plan" && (
                          <a
                            className="property-media-action-link"
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink size={15} aria-hidden="true" />
                            معاينة ملف PDF المحلي
                          </a>
                        )}
                      <button
                        className="btn-ghost property-media-remove"
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => removePending(kind, item.pendingKey)}
                      >
                        <X size={15} aria-hidden="true" />
                        إلغاء هذا الملف
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              {saved.map(reference => {
                const asset = loadedFor(reference);
                const descriptor =
                  asset?.reference.descriptor ?? reference.descriptor;
                const url =
                  asset?.status === "available" ? asset.url : undefined;
                return (
                  <article className="property-media-item" key={reference.key}>
                    {url && descriptor ? (
                      <PropertyMediaPreview
                        kind={kind}
                        mime={descriptor.mime}
                        url={url}
                        alt={`${kindLabel(kind)} للعقار`}
                      />
                    ) : (
                      <div className="property-media-file-preview">
                        <MediaKindIcon kind={kind} />
                        <span>
                          {!asset || asset.status === "loading"
                            ? "جارٍ تحميل الملف المحلي…"
                            : "الملف غير متاح في هذا المتصفح"}
                        </span>
                      </div>
                    )}
                    <div className="property-media-item-body">
                      <strong className="property-media-filename" dir="auto">
                        {descriptor?.name ?? `مرجع ${kindLabel(kind)}`}
                      </strong>
                      {url && (
                        <span className="property-media-status property-media-status--saved">
                          <ShieldCheck size={14} aria-hidden="true" />
                          ملف محفوظ محليًا
                        </span>
                      )}
                      {asset?.status === "missing" && (
                        <p className="property-media-missing" role="status">
                          الملف غير متاح في هذا المتصفح؛ أعد إرفاقه
                        </p>
                      )}
                      <div className="property-media-actions">
                        {url && descriptor?.mime === "application/pdf" && (
                          <a
                            className="property-media-action-link"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink size={15} aria-hidden="true" />
                            فتح ملف PDF المحلي
                          </a>
                        )}
                        {url && descriptor && (
                          <a
                            className="property-media-action-link"
                            href={url}
                            download={descriptor.name}
                          >
                            <Download size={15} aria-hidden="true" />
                            تنزيل الملف المحلي
                          </a>
                        )}
                        <button
                          className="btn-ghost property-media-remove"
                          type="button"
                          disabled={controlsDisabled}
                          onClick={() => removeSaved(reference)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          إزالة المرجع
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {kind === "video" && (
              <div className="property-media-video-link-section">
                <label className="form-label property-media-video-url">
                  <span>
                    <Link2 size={16} aria-hidden="true" />
                    رابط فيديو اختياري
                  </span>
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={512}
                    placeholder="https://example.test/video"
                    value={videoUrlDraft}
                    disabled={controlsDisabled}
                    onChange={event => updateVideoUrl(event.target.value)}
                  />
                  <small>
                    HTTP أو HTTPS فقط دون بيانات دخول؛ لا يُجلب الرابط تلقائيًا.
                  </small>
                </label>
                {selectionError.videoUrl && (
                  <p className="property-media-error" role="alert">
                    {selectionError.videoUrl}
                  </p>
                )}
                {manifest.videoUrl && (
                  <a
                    href={manifest.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="property-media-action-link property-media-external-link"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                    فتح رابط الفيديو الذي أدخلته
                  </a>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
});

PropertyMediaEditor.displayName = "PropertyMediaEditor";
