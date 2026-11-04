import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import {
  AssetTransitionError,
  usePrototype,
} from "@/contexts/PrototypeContext";
import {
  discardPropertyMedia,
  loadPropertyPhotoById,
  lookupPropertyMedia,
  storePropertyMedia,
  validatePropertyMediaFile,
} from "@/lib/property-media";
import {
  assignUnitPhotoGroup,
  parsePhotoGallery,
  saveTargetPhotoGallery,
} from "@/lib/property-photo-gallery";
import {
  MAX_GALLERY_PHOTOS,
  MAX_PHOTO_GROUP_UNITS,
  type PhotoGalleryTargetKind,
} from "@shared/photo-gallery-types";
import type { DemoEntity, PrototypeState } from "@shared/prototype";
import "./PhotoGallery.css";

export interface LocalPhotoAvailability {
  kind: PhotoGalleryTargetKind;
  id: string;
  scopeKey: string;
  galleryKey: string;
  availableCount: number;
}

export type GalleryCommittedChange = {
  kind: PhotoGalleryTargetKind;
  id: string;
  scopeKey: string;
  before: DemoEntity;
  after: DemoEntity;
};

export interface AssetPhotoGalleryProps {
  kind: PhotoGalleryTargetKind;
  id: string;
  title: string;
  onLocalAvailabilityChange?: (availability: LocalPhotoAvailability) => void;
  onCommittedChange?: (payload: GalleryCommittedChange) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export interface GroupUnitPhotoGalleryProps {
  propertyId: string;
}

type LoadedPhoto = {
  id: string;
  name?: string;
  url?: string;
  status: "loading" | "available" | "missing";
  scopeKey: string;
};

type PendingPhoto = { file: File; url: string };

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "تعذر إتمام عملية الصور.";
}

function assetWasCommitted(error: unknown): boolean {
  return error instanceof AssetTransitionError && error.assetCommitted;
}

function safeRevoke(url: string | undefined): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Object URL cleanup must never interrupt the local-only gallery flow.
  }
}

function readGallery(value: unknown): { ids: string[]; error: string | null } {
  try {
    return { ids: parsePhotoGallery(value).ids, error: null };
  } catch (error) {
    return { ids: [], error: errorMessage(error) };
  }
}

function entityFor(
  state: PrototypeState,
  kind: PhotoGalleryTargetKind,
  id: string
): DemoEntity | undefined {
  return state.entities[kind].find(row => row.id === id);
}

function freshRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `gallery_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function PhotoNotice() {
  return (
    <p className="photo-gallery-notice">
      الصور محفوظة في هذا المتصفح ولا تنتقل مع JSON أو الحفظ السحابي.
    </p>
  );
}

/**
 * A local-only gallery for a property or one unit. The state snapshot holds
 * opaque IDs only; byte-backed image data is looked up in the current browser
 * namespace after every scope check.
 */
export function AssetPhotoGallery({
  kind,
  id,
  title,
  onLocalAvailabilityChange,
  onCommittedChange,
  onBusyChange,
  disabled: externallyDisabled = false,
}: AssetPhotoGalleryProps) {
  const { state, identity, canEdit, commitAssetTransition } = usePrototype();
  const entity = entityFor(state, kind, id);
  const parsed = useMemo(
    () => readGallery(entity?.meta.photoGallery),
    [entity?.meta.photoGallery]
  );
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const scopeRef = useRef(identity.storageKey);
  const canEditRef = useRef(canEdit);
  const externallyDisabledRef = useRef(externallyDisabled);
  const targetRef = useRef(`${kind}:${id}`);
  const onCommittedChangeRef = useRef(onCommittedChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const urlsRef = useRef<string[]>([]);

  // Update during render so pending continuations never use a stale identity,
  // role, or target from the event that originally started the operation.
  scopeRef.current = identity.storageKey;
  canEditRef.current = canEdit;
  externallyDisabledRef.current = externallyDisabled;
  targetRef.current = `${kind}:${id}`;
  onCommittedChangeRef.current = onCommittedChange;
  onBusyChangeRef.current = onBusyChange;

  const currentScope = useCallback(
    (expectedScope: string) =>
      mountedRef.current && scopeRef.current === expectedScope,
    []
  );
  const currentEditor = useCallback(
    (expectedScope: string, expectedTarget: string) =>
      currentScope(expectedScope) &&
      canEditRef.current &&
      !externallyDisabledRef.current &&
      targetRef.current === expectedTarget,
    [currentScope]
  );
  const clearUrls = useCallback(() => {
    urlsRef.current.forEach(safeRevoke);
    urlsRef.current = [];
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearUrls();
    };
  }, [clearUrls]);

  const galleryKey = parsed.ids.join("|");
  useEffect(() => {
    let cancelled = false;
    const expectedScope = identity.storageKey;
    clearUrls();
    setPhotos(
      parsed.ids.map(photoId => ({
        id: photoId,
        status: "loading",
        scopeKey: expectedScope,
      }))
    );
    const isCurrent = () => !cancelled && currentScope(expectedScope);

    const load = async (photoId: string) => {
      if (!isCurrent()) return;
      let descriptor: Awaited<ReturnType<typeof lookupPropertyMedia>>;
      try {
        descriptor = await lookupPropertyMedia(expectedScope, photoId);
      } catch {
        descriptor = null;
      }
      if (!isCurrent()) return;
      if (!descriptor) {
        setPhotos(previous =>
          previous.map(photo =>
            photo.id === photoId
              ? { ...photo, status: "missing", scopeKey: expectedScope }
              : photo
          )
        );
        return;
      }
      let blob: Blob | null;
      try {
        blob = await loadPropertyPhotoById(expectedScope, photoId);
      } catch {
        blob = null;
      }
      if (!isCurrent()) return;
      if (!blob) {
        setPhotos(previous =>
          previous.map(photo =>
            photo.id === photoId
              ? { ...photo, status: "missing", scopeKey: expectedScope }
              : photo
          )
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      if (!isCurrent()) {
        safeRevoke(url);
        return;
      }
      urlsRef.current.push(url);
      setPhotos(previous =>
        previous.map(photo =>
          photo.id === photoId
            ? {
                ...photo,
                name: descriptor.name,
                url,
                status: "available",
                scopeKey: expectedScope,
              }
            : photo
        )
      );
    };

    parsed.ids.forEach(photoId => void load(photoId));
    return () => {
      cancelled = true;
      clearUrls();
    };
  }, [clearUrls, currentScope, galleryKey, identity.storageKey, parsed.ids]);

  useEffect(() => {
    // Loading/missing references never count as evidence. A report is bound to
    // both the workspace and current reference set, so a parent cannot reuse
    // results from another unit, restored snapshot, or account.
    onLocalAvailabilityChange?.({
      kind,
      id,
      scopeKey: identity.storageKey,
      galleryKey,
      availableCount: photos.filter(
        photo =>
          photo.scopeKey === identity.storageKey &&
          photo.status === "available" &&
          Boolean(photo.url) &&
          parsed.ids.includes(photo.id)
      ).length,
    });
  }, [
    kind,
    id,
    identity.storageKey,
    galleryKey,
    parsed.ids,
    photos,
    onLocalAvailabilityChange,
  ]);

  const cleanupFresh = useCallback(async (scopeKey: string, ids: string[]) => {
    for (const photoId of ids) {
      try {
        await discardPropertyMedia(scopeKey, photoId);
      } catch {
        // Only records created by this unfinished click are candidates. Continue
        // cleanup if the browser refuses one of them.
      }
    }
  }, []);

  const beginBusy = useCallback(() => {
    busyRef.current = true;
    setBusy(true);
    onBusyChangeRef.current?.(true);
  }, []);
  const finishBusy = useCallback(() => {
    busyRef.current = false;
    // A scope change must not leave the wizard blocked after this request ends.
    if (!mountedRef.current) return;
    setBusy(false);
    onBusyChangeRef.current?.(false);
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || busyRef.current) return;
      const expectedScope = scopeRef.current;
      const expectedTarget = `${kind}:${id}`;
      if (!currentEditor(expectedScope, expectedTarget)) return;
      const savedIds: string[] = [];
      let committed = false;
      beginBusy();
      setError(null);
      setMessage(null);
      try {
        if (parsed.error) throw new Error(parsed.error);
        if (!entity)
          throw new Error("الهدف لم يعد متاحًا في مساحة العمل الحالية.");
        if (parsed.ids.length + files.length > MAX_GALLERY_PHOTOS)
          throw new Error(`يمكن ربط ${MAX_GALLERY_PHOTOS} صورة كحد أقصى.`);

        // Validate every selection before storing the first byte, so invalid
        // batches fail before any fresh record needs a rollback.
        for (const file of files) {
          await validatePropertyMediaFile(file, "photo");
          if (!currentEditor(expectedScope, expectedTarget))
            throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل اكتمال الصور.");
        }
        for (const file of files) {
          if (!currentEditor(expectedScope, expectedTarget))
            throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل اكتمال الصور.");
          const descriptor = await storePropertyMedia(
            expectedScope,
            "photo",
            file
          );
          // Record first, then test currentness. A scope/role transition while
          // IndexedDB resolved must still release this fresh and unlinked Blob.
          savedIds.push(descriptor.id);
          if (!currentEditor(expectedScope, expectedTarget))
            throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل اكتمال الصور.");
        }
        if (!currentEditor(expectedScope, expectedTarget))
          throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل حفظ المراجع.");
        const saved = await commitAssetTransition(current => {
          const latest = entityFor(current, kind, id);
          if (!latest)
            throw new Error("الهدف لم يعد متاحًا في مساحة العمل الحالية.");
          const existing = parsePhotoGallery(latest.meta.photoGallery).ids;
          const next = saveTargetPhotoGallery(current, kind, id, [
            ...existing,
            ...savedIds,
          ]);
          return {
            state: next.state,
            result: { before: latest, after: next.result },
          };
        });
        committed = true;
        onCommittedChangeRef.current?.({
          kind,
          id,
          scopeKey: expectedScope,
          before: saved.before,
          after: saved.after,
        });
        if (currentScope(expectedScope))
          setMessage("أضيفت الصور وربطت بهذا السجل محليًا.");
      } catch (caught) {
        if (!committed && !assetWasCommitted(caught))
          await cleanupFresh(expectedScope, savedIds);
        if (currentScope(expectedScope)) setError(errorMessage(caught));
      } finally {
        finishBusy();
      }
    },
    [
      beginBusy,
      cleanupFresh,
      commitAssetTransition,
      currentEditor,
      currentScope,
      entity,
      finishBusy,
      id,
      kind,
      parsed.error,
      parsed.ids,
    ]
  );

  const removeReference = useCallback(
    async (photoId: string) => {
      const expectedScope = scopeRef.current;
      const expectedTarget = `${kind}:${id}`;
      if (busyRef.current || !currentEditor(expectedScope, expectedTarget))
        return;
      beginBusy();
      setError(null);
      setMessage(null);
      try {
        if (parsed.error) throw new Error(parsed.error);
        const saved = await commitAssetTransition(current => {
          const latest = entityFor(current, kind, id);
          if (!latest)
            throw new Error("الهدف لم يعد متاحًا في مساحة العمل الحالية.");
          const latestIds = parsePhotoGallery(latest.meta.photoGallery).ids;
          const next = saveTargetPhotoGallery(
            current,
            kind,
            id,
            latestIds.filter(existing => existing !== photoId)
          );
          return {
            state: next.state,
            result: { before: latest, after: next.result },
          };
        });
        onCommittedChangeRef.current?.({
          kind,
          id,
          scopeKey: expectedScope,
          before: saved.before,
          after: saved.after,
        });
        if (currentScope(expectedScope))
          setMessage("أزيل ارتباط الصورة فقط؛ بقي الملف المحلي لأي هدف آخر.");
      } catch (caught) {
        if (currentScope(expectedScope)) setError(errorMessage(caught));
      } finally {
        finishBusy();
      }
    },
    [
      beginBusy,
      commitAssetTransition,
      currentEditor,
      currentScope,
      finishBusy,
      id,
      kind,
      parsed.error,
    ]
  );

  const controlsDisabled =
    busy || externallyDisabled || !canEdit || !entity || Boolean(parsed.error);

  return (
    <section
      className="panel photo-gallery"
     
      aria-label={`معرض صور ${title}`}
    >
      <div className="panel-heading">
        <div>
          <h2>معرض الصور</h2>
          <p className="muted small">
            حتى {MAX_GALLERY_PHOTOS} صورة، 5 ميغابايت لكل صورة.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={controlsDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} />
          {busy ? "جارٍ الحفظ…" : "إضافة صور"}
        </button>
      </div>
      <PhotoNotice />
      <input
        ref={fileInputRef}
        className="photo-gallery-file-input"
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        aria-label={`اختيار صور ${title}`}
        disabled={controlsDisabled}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void addFiles(files);
        }}
      />
      {parsed.error && (
        <p className="photo-gallery-error" role="alert">
          {parsed.error}
        </p>
      )}
      {error && (
        <p className="photo-gallery-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="photo-gallery-message" role="status">
          {message}
        </p>
      )}
      {!parsed.error && !parsed.ids.length && (
        <p className="photo-gallery-empty">
          لا توجد صور مرتبطة بهذا السجل بعد.
        </p>
      )}
      <div className="photo-gallery-grid" aria-live="polite">
        {parsed.ids.map(photoId => {
          const photo = photos.find(candidate => candidate.id === photoId);
          const available =
            photo?.scopeKey === identity.storageKey &&
            photo.status === "available";
          return (
            <article className="photo-gallery-card" key={photoId}>
              {available && photo?.url ? (
                <img src={photo.url} alt={photo.name ?? `صورة ${title}`} />
              ) : (
                <div className="photo-gallery-placeholder">
                  {photo?.status === "loading"
                    ? "جارٍ قراءة الصورة المحلية…"
                    : "الصورة غير متاحة في هذا المتصفح"}
                </div>
              )}
              <div className="photo-gallery-card-footer">
                <span>{photo?.name ?? "صورة محفوظة محليًا"}</span>
                <button
                  type="button"
                  className="btn-ghost photo-gallery-remove"
                  disabled={controlsDisabled}
                  onClick={() => removeReference(photoId)}
                  aria-label={`إزالة ارتباط الصورة من ${title}`}
                >
                  <Trash2 size={15} /> إزالة الارتباط
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function fitGroup(
  state: PrototypeState,
  propertyId: string,
  unitIds: string[],
  additions: number
): void {
  const property = state.entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار المحدد غير موجود.");
  if (!unitIds.length) throw new Error("اختر وحدة واحدة على الأقل.");
  if (!additions) throw new Error("اختر صورة واحدة على الأقل.");
  if (unitIds.length > MAX_PHOTO_GROUP_UNITS || additions > MAX_GALLERY_PHOTOS)
    throw new Error(
      `الحد الأقصى هو ${MAX_PHOTO_GROUP_UNITS} وحدة و${MAX_GALLERY_PHOTOS} صورة.`
    );
  if (new Set(unitIds).size !== unitIds.length)
    throw new Error("لا يمكن تكرار الوحدة في المجموعة.");
  for (const unitId of unitIds) {
    const unit = state.entities.units.find(row => row.id === unitId);
    if (
      !unit ||
      unit.propertyId !== property.id ||
      unit.portfolioId !== property.portfolioId
    ) {
      throw new Error("كل الوحدات المختارة يجب أن تتبع العقار والمحفظة نفسها.");
    }
    const existing = parsePhotoGallery(unit.meta.photoGallery).ids;
    if (new Set([...existing]).size + additions > MAX_GALLERY_PHOTOS)
      throw new Error(
        `لا تتسع ${unit.title} لأكثر من ${MAX_GALLERY_PHOTOS} صورة.`
      );
  }
}

/**
 * Stages several local files in memory, previews them, then writes and assigns
 * them to selected units through exactly one idempotent state transition.
 */
export function GroupUnitPhotoGallery({
  propertyId,
}: GroupUnitPhotoGalleryProps) {
  const { state, identity, canEdit, commitAssetTransition } = usePrototype();
  const property = state.entities.properties.find(row => row.id === propertyId);
  const units = useMemo(
    () =>
      property
        ? state.entities.units.filter(
            unit =>
              unit.propertyId === property.id &&
              unit.portfolioId === property.portfolioId
          )
        : [],
    [property, state.entities.units]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(true);
  const scopeRef = useRef(identity.storageKey);
  const canEditRef = useRef(canEdit);
  const stateRef = useRef(state);
  const propertyRef = useRef(propertyId);
  const selectedRef = useRef(selectedIds);
  const pendingRef = useRef(pending);
  const requestIdRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  scopeRef.current = identity.storageKey;
  canEditRef.current = canEdit;
  stateRef.current = state;
  propertyRef.current = propertyId;
  selectedRef.current = selectedIds;
  pendingRef.current = pending;

  const currentScope = useCallback(
    (expectedScope: string) =>
      mountedRef.current && scopeRef.current === expectedScope,
    []
  );
  const currentEditor = useCallback(
    (expectedScope: string, expectedPropertyId: string) =>
      currentScope(expectedScope) &&
      canEditRef.current &&
      propertyRef.current === expectedPropertyId,
    [currentScope]
  );
  const replacePending = useCallback((next: PendingPhoto[]) => {
    const retain = new Set(next.map(item => item.url));
    pendingRef.current.forEach(item => {
      if (!retain.has(item.url)) safeRevoke(item.url);
    });
    pendingRef.current = next;
    if (mountedRef.current) setPending(next);
  }, []);
  const clearPending = useCallback(() => replacePending([]), [replacePending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current.forEach(item => safeRevoke(item.url));
      pendingRef.current = [];
    };
  }, []);

  useEffect(() => {
    // A staged file has no durable descriptor. On an identity or property switch
    // it is merely released from RAM and can never be accidentally assigned.
    clearPending();
    setSelectedIds([]);
    selectedRef.current = [];
    requestIdRef.current = null;
    setError(null);
    setMessage(null);
    setReviewOpen(false);
  }, [clearPending, identity.storageKey, propertyId]);

  useEffect(() => {
    if (!reviewOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
        ) ?? []
      );
    const timer = window.setTimeout(() => focusable()[0]?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setReviewOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [busy, reviewOpen]);

  const cleanupFresh = useCallback(async (scopeKey: string, ids: string[]) => {
    for (const photoId of ids) {
      try {
        await discardPropertyMedia(scopeKey, photoId);
      } catch {
        // Continue: all ids are known fresh writes from this failed action only.
      }
    }
  }, []);

  const chooseFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || busy) return;
      const expectedScope = scopeRef.current;
      const expectedProperty = propertyRef.current;
      if (!currentEditor(expectedScope, expectedProperty)) return;
      const initial = pendingRef.current;
      if (initial.length + files.length > MAX_GALLERY_PHOTOS) {
        setError(`يمكن اختيار ${MAX_GALLERY_PHOTOS} صورة كحد أقصى للمجموعة.`);
        return;
      }
      const created: PendingPhoto[] = [];
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        for (const file of files) {
          await validatePropertyMediaFile(file, "photo");
          if (!currentEditor(expectedScope, expectedProperty))
            throw new Error(
              "تغيّر نطاق أو صلاحية الحفظ قبل اكتمال اختيار الصور."
            );
          const url = URL.createObjectURL(file);
          if (!currentEditor(expectedScope, expectedProperty)) {
            safeRevoke(url);
            throw new Error(
              "تغيّر نطاق أو صلاحية الحفظ قبل اكتمال اختيار الصور."
            );
          }
          created.push({ file, url });
        }
        if (!currentEditor(expectedScope, expectedProperty))
          throw new Error(
            "تغيّر نطاق أو صلاحية الحفظ قبل اكتمال اختيار الصور."
          );
        replacePending([...initial, ...created]);
      } catch (caught) {
        created.forEach(item => safeRevoke(item.url));
        if (currentScope(expectedScope)) setError(errorMessage(caught));
      } finally {
        if (currentScope(expectedScope)) setBusy(false);
      }
    },
    [busy, currentEditor, currentScope, replacePending]
  );

  const toggleUnit = useCallback(
    (unitId: string) => {
      if (busy || !canEditRef.current) return;
      setSelectedIds(previous =>
        previous.includes(unitId)
          ? previous.filter(id => id !== unitId)
          : previous.length >= MAX_PHOTO_GROUP_UNITS
            ? previous
            : [...previous, unitId]
      );
    },
    [busy]
  );

  const removePending = useCallback(
    (index: number) => {
      if (busy) return;
      const next = pendingRef.current.filter(
        (_, itemIndex) => itemIndex !== index
      );
      replacePending(next);
    },
    [busy, replacePending]
  );

  const assign = useCallback(async () => {
    if (busy) return;
    const expectedScope = scopeRef.current;
    const expectedProperty = propertyRef.current;
    if (!currentEditor(expectedScope, expectedProperty)) return;
    const unitIds = [...selectedRef.current];
    const staged = [...pendingRef.current];
    const savedIds: string[] = [];
    const requestId = requestIdRef.current ?? freshRequestId();
    requestIdRef.current = requestId;
    let committed = false;
    setBusy(true);
    setError(null);
    try {
      fitGroup(stateRef.current, expectedProperty, unitIds, staged.length);
      if (!currentEditor(expectedScope, expectedProperty))
        throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل إسناد المجموعة.");
      for (const stagedPhoto of staged) {
        await validatePropertyMediaFile(stagedPhoto.file, "photo");
        if (!currentEditor(expectedScope, expectedProperty))
          throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل إسناد المجموعة.");
      }
      for (const stagedPhoto of staged) {
        if (!currentEditor(expectedScope, expectedProperty))
          throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل إسناد المجموعة.");
        const descriptor = await storePropertyMedia(
          expectedScope,
          "photo",
          stagedPhoto.file
        );
        savedIds.push(descriptor.id);
        if (!currentEditor(expectedScope, expectedProperty))
          throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل إسناد المجموعة.");
      }
      if (!currentEditor(expectedScope, expectedProperty))
        throw new Error("تغيّر نطاق أو صلاحية الحفظ قبل حفظ مراجع المجموعة.");
      await commitAssetTransition(current =>
        assignUnitPhotoGroup(current, {
          requestId,
          propertyId: expectedProperty,
          unitIds,
          photoIds: savedIds,
          title: `إسناد صور لوحدات ${
            current.entities.properties.find(row => row.id === expectedProperty)
              ?.title ?? "مختارة"
          }`,
        })
      );
      committed = true;
      requestIdRef.current = null;
      if (currentScope(expectedScope)) {
        clearPending();
        setSelectedIds([]);
        selectedRef.current = [];
        setReviewOpen(false);
        setMessage("حُفظت المجموعة وربطت بالوحدات المختارة في عملية واحدة.");
      }
    } catch (caught) {
      if (!committed && !assetWasCommitted(caught))
        await cleanupFresh(expectedScope, savedIds);
      if (currentScope(expectedScope)) setError(errorMessage(caught));
    } finally {
      if (currentScope(expectedScope)) setBusy(false);
    }
  }, [
    busy,
    cleanupFresh,
    clearPending,
    commitAssetTransition,
    currentEditor,
    currentScope,
  ]);

  const controlsDisabled = busy || !canEdit || !property;
  const canReview =
    !controlsDisabled && selectedIds.length > 0 && pending.length > 0;

  return (
    <section
      className="panel photo-gallery photo-gallery-group"
     
      aria-label="مجموعة صور وحدات"
    >
      <div className="panel-heading">
        <div>
          <h2>إسناد مجموعة صور للوحدات</h2>
          <p className="muted small">
            اختر حتى {MAX_PHOTO_GROUP_UNITS} وحدة و{MAX_GALLERY_PHOTOS} صورة
            للمجموعة.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={controlsDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} />
          {busy ? "جارٍ التجهيز…" : "إضافة صور للمجموعة"}
        </button>
      </div>
      <PhotoNotice />
      <input
        ref={fileInputRef}
        className="photo-gallery-file-input"
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        aria-label="اختيار صور مجموعة الوحدات"
        disabled={controlsDisabled}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void chooseFiles(files);
        }}
      />
      {!property && (
        <p className="photo-gallery-error" role="alert">
          العقار المحدد غير متاح.
        </p>
      )}
      {error && (
        <p className="photo-gallery-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="photo-gallery-message" role="status">
          {message}
        </p>
      )}
      {property && (
        <>
          <fieldset
            className="photo-gallery-unit-list"
            disabled={controlsDisabled}
          >
            <legend>الوحدات التابعة لـ {property.title}</legend>
            {!units.length && (
              <p className="photo-gallery-empty">
                لا توجد وحدات صالحة لهذا العقار.
              </p>
            )}
            {units.map(unit => (
              <label className="photo-gallery-unit-choice" key={unit.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(unit.id)}
                  onChange={() => toggleUnit(unit.id)}
                />
                <span>{unit.title}</span>
                <small>{unit.status}</small>
              </label>
            ))}
          </fieldset>
          <div className="photo-gallery-staged" aria-live="polite">
            {!pending.length && (
              <p className="photo-gallery-empty">
                أضف الصور ثم راجع المجموعة قبل الإسناد.
              </p>
            )}
            {pending.map((item, index) => (
              <article className="photo-gallery-card" key={item.url}>
                <img src={item.url} alt={`معاينة ${item.file.name}`} />
                <div className="photo-gallery-card-footer">
                  <span>{item.file.name}</span>
                  <button
                    type="button"
                    className="btn-ghost photo-gallery-remove"
                    disabled={busy}
                    onClick={() => removePending(index)}
                  >
                    <X size={15} /> إزالة من المجموعة
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="photo-gallery-group-actions">
            <span>
              {selectedIds.length} وحدة مختارة · {pending.length} صورة جاهزة
              للمراجعة
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={!canReview}
              onClick={() => setReviewOpen(true)}
            >
              مراجعة المجموعة
            </button>
          </div>
        </>
      )}
      {reviewOpen && (
        <div
          className="modal-backdrop photo-gallery-backdrop"
          onMouseDown={event => {
            if (event.currentTarget === event.target && !busy)
              setReviewOpen(false);
          }}
        >
          <section
            className="modal photo-gallery-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="مراجعة مجموعة الصور"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">مراجعة محلية</span>
                <h2>مراجعة مجموعة الصور</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label="إغلاق المراجعة"
                onClick={() => setReviewOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              سيجري ربط {pending.length} صورة بـ {selectedIds.length} وحدة في
              عملية واحدة.
            </p>
            <ul className="photo-gallery-review-list">
              {units
                .filter(unit => selectedIds.includes(unit.id))
                .map(unit => (
                  <li key={unit.id}>{unit.title}</li>
                ))}
            </ul>
            <PhotoNotice />
            <div className="modal-footer">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void assign()}
              >
                <ImagePlus size={16} />
                {busy ? "جارٍ الإسناد…" : "إسناد الصور للوحدات المختارة"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setReviewOpen(false)}
              >
                رجوع
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
