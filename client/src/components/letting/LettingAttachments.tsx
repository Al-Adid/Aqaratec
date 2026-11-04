import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  discardPropertyMedia,
  loadPropertyMedia,
  parsePropertyMedia,
  storePropertyMedia,
  validatePropertyMediaFile,
} from "@/lib/property-media";
import { attachLettingDocument, getLettingCase } from "@/lib/letting-engine";
import {
  LETTING_DOCUMENT_LABELS,
  LETTING_ATTACHMENT_MAX_BYTES,
  type LettingDocumentKind,
} from "@shared/letting-types";
import type { DemoEntity } from "@shared/prototype";
import type {
  PropertyMediaDescriptor,
  PropertyMediaKind,
} from "@shared/property-media-types";

export interface LettingAttachmentsProps {
  applicationId: string;
  kinds: LettingDocumentKind[];
  disabled?: boolean;
}

type PendingSelection = {
  token: number;
  file: File;
  scopeKey: string;
};

type PendingByKind = Partial<Record<LettingDocumentKind, PendingSelection[]>>;

type AttachmentReference = {
  document: DemoEntity;
  kind: LettingDocumentKind;
  descriptor: PropertyMediaDescriptor;
  mediaKind: PropertyMediaKind;
};

type LocalAsset = {
  status: "loading" | "available" | "missing";
  scopeKey: string;
  url?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "تعذر حفظ المرفق المحلي. حاول مرة أخرى.";
}

function mediaKindFor(kind: LettingDocumentKind): PropertyMediaKind {
  return kind === "handover-photo" ? "photo" : "plan";
}

function acceptFor(kind: LettingDocumentKind) {
  return kind === "handover-photo"
    ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
    : ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
}

function limitFor(kind: LettingDocumentKind) {
  return kind === "handover-photo"
    ? "صور JPG أو PNG أو WebP فقط، بحد أقصى 5 ميغابايت لكل صورة."
    : "ملف PDF أو صورة JPG أو PNG أو WebP، بحد أقصى 5 ميغابايت.";
}

function isImage(mime: string) {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}

function descriptorKey(descriptor: PropertyMediaDescriptor) {
  return `${descriptor.id}:${descriptor.name}:${descriptor.mime}:${descriptor.size}`;
}

function safeRevoke(url: string | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Releasing a local preview should never interrupt the record view.
  }
}

function requestId(
  applicationId: string,
  kind: LettingDocumentKind,
  token: number
) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${token}`;
  return `letting-attachment-${applicationId.slice(0, 40)}-${kind}-${suffix}`;
}

/**
 * Decode only the precise descriptor shape emitted by attachLettingDocument.
 * A filename may remain visible when its local blob is absent, but no guessed
 * remote URL or placeholder evidence is ever produced.
 */
function referenceFromDocument(
  document: DemoEntity
): AttachmentReference | null {
  const rawKind = document.meta.kind;
  if (
    typeof rawKind !== "string" ||
    !Object.prototype.hasOwnProperty.call(LETTING_DOCUMENT_LABELS, rawKind)
  )
    return null;
  const kind = rawKind as LettingDocumentKind;
  const mediaKind = mediaKindFor(kind);
  if (document.meta.mediaKind !== mediaKind) return null;
  const rawManifest = document.meta.fileManifest;
  if (typeof rawManifest !== "string") return null;

  try {
    const manifest = parsePropertyMedia(rawManifest);
    const descriptor = mediaKind === "photo" ? manifest.photo : manifest.plan;
    if (!descriptor) return null;
    return { document, kind, descriptor, mediaKind };
  } catch {
    return null;
  }
}

function LocalAttachment({ reference }: { reference: AttachmentReference }) {
  const { identity } = usePrototype();
  const [asset, setAsset] = useState<LocalAsset>({
    status: "loading",
    scopeKey: identity.storageKey,
  });
  const mountedRef = useRef(true);
  const scopeRef = useRef(identity.storageKey);
  const urlRef = useRef<string | undefined>(undefined);

  scopeRef.current = identity.storageKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      safeRevoke(urlRef.current);
      urlRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const expectedScope = identity.storageKey;
    safeRevoke(urlRef.current);
    urlRef.current = undefined;
    setAsset({ status: "loading", scopeKey: expectedScope });

    const current = () =>
      !cancelled && mountedRef.current && scopeRef.current === expectedScope;

    void (async () => {
      if (!current()) return;
      let blob: Blob | null;
      try {
        blob = await loadPropertyMedia(
          expectedScope,
          reference.descriptor,
          reference.mediaKind
        );
      } catch {
        blob = null;
      }
      if (!current()) return;
      if (!blob) {
        setAsset({ status: "missing", scopeKey: expectedScope });
        return;
      }
      const url = URL.createObjectURL(blob);
      if (!current()) {
        safeRevoke(url);
        return;
      }
      urlRef.current = url;
      setAsset({ status: "available", scopeKey: expectedScope, url });
    })();

    return () => {
      cancelled = true;
    };
  }, [identity.storageKey, reference.mediaKind, reference.descriptor]);

  const currentAsset =
    asset.scopeKey === identity.storageKey
      ? asset
      : { status: "loading" as const };
  const url =
    currentAsset.status === "available" ? currentAsset.url : undefined;

  return (
    <article className="letting-attachment-item">
      <div>
        <strong>{LETTING_DOCUMENT_LABELS[reference.kind]}</strong>
        <p>{reference.descriptor.name}</p>
      </div>
      {currentAsset.status === "loading" && <p>جارٍ قراءة الملف المحلي…</p>}
      {currentAsset.status === "missing" && (
        <p className="letting-attachment-missing" role="status">
          الملف غير متاح في هذا المتصفح أو مساحة العمل الحالية؛ أعد إرفاقه من
          المستندات التجريبية.
        </p>
      )}
      {url && isImage(reference.descriptor.mime) && (
        <img
          className="letting-attachment-preview"
          src={url}
          alt={`معاينة ${LETTING_DOCUMENT_LABELS[reference.kind]}`}
        />
      )}
      {url && reference.descriptor.mime === "application/pdf" && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          فتح ملف PDF المحلي
        </a>
      )}
      {url && (
        <a href={url} download={reference.descriptor.name}>
          تنزيل الملف
        </a>
      )}
    </article>
  );
}

/**
 * Letting evidence stays only in the browser's scoped IndexedDB store. A file
 * is validated when selected, then written and attached only after the user
 * confirms "حفظ المرفق". The component deliberately has no network path.
 */
export function LettingAttachments({
  applicationId,
  kinds,
  disabled = false,
}: LettingAttachmentsProps) {
  const { state, identity, canEdit, commitTransition } = usePrototype();
  const [pending, setPending] = useState<PendingByKind>({});
  const [errors, setErrors] = useState<
    Partial<Record<LettingDocumentKind, string>>
  >({});
  const [saving, setSaving] = useState<
    Partial<Record<LettingDocumentKind, boolean>>
  >({});
  const mountedRef = useRef(true);
  const scopeRef = useRef(identity.storageKey);
  const canEditRef = useRef(canEdit);
  const pendingRef = useRef<PendingByKind>({});
  const selectionVersionRef = useRef<
    Partial<Record<LettingDocumentKind, number>>
  >({});
  const savingRef = useRef<Partial<Record<LettingDocumentKind, boolean>>>({});
  const previousScopeRef = useRef(identity.storageKey);

  // Intentionally refreshed while rendering so async work never acts on a
  // permission or workspace captured by a previous render.
  scopeRef.current = identity.storageKey;
  canEditRef.current = canEdit;

  const requestedKinds = useMemo(() => [...new Set(kinds)], [kinds]);
  const currentCase = useMemo(
    () => getLettingCase(state.entities, applicationId),
    [applicationId, state.entities]
  );
  const attachments = useMemo(
    () =>
      currentCase.documents
        .map(referenceFromDocument)
        .filter((reference): reference is AttachmentReference =>
          Boolean(reference)
        )
        .filter(reference => requestedKinds.includes(reference.kind)),
    [currentCase.documents, requestedKinds]
  );

  const isCurrentScope = useCallback(
    (expectedScope: string) => scopeRef.current === expectedScope,
    []
  );
  const isCurrentEditor = useCallback(
    (expectedScope: string) =>
      mountedRef.current &&
      canEditRef.current &&
      scopeRef.current === expectedScope,
    []
  );

  const replacePending = useCallback((next: PendingByKind) => {
    pendingRef.current = next;
    if (mountedRef.current) setPending(next);
  }, []);

  const removePendingToken = useCallback(
    (kind: LettingDocumentKind, token: number) => {
      const existing = pendingRef.current[kind] ?? [];
      const nextForKind = existing.filter(item => item.token !== token);
      const next = { ...pendingRef.current };
      if (nextForKind.length) next[kind] = nextForKind;
      else delete next[kind];
      replacePending(next);
    },
    [replacePending]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previousScopeRef.current === identity.storageKey) return;
    previousScopeRef.current = identity.storageKey;
    // Selected File objects were never persisted, so changing namespaces only
    // drops this in-memory draft. It never reaches back into the old namespace.
    pendingRef.current = {};
    setPending({});
    setErrors({});
    setSaving({});
    savingRef.current = {};
  }, [identity.storageKey]);

  const chooseFiles = useCallback(
    async (kind: LettingDocumentKind, files: File[]) => {
      if (!files.length || disabled || !canEditRef.current) return;
      if (files.some(file => file.size > LETTING_ATTACHMENT_MAX_BYTES)) {
        setErrors(current => ({
          ...current,
          [kind]: "حجم ملف التأجير يتجاوز الحد: 5 ميغابايت لكل ملف.",
        }));
        return;
      }
      const expectedScope = scopeRef.current;
      const version = (selectionVersionRef.current[kind] ?? 0) + 1;
      selectionVersionRef.current[kind] = version;
      setErrors(current => ({ ...current, [kind]: undefined }));

      try {
        if (!isCurrentEditor(expectedScope)) return;
        const mediaKind = mediaKindFor(kind);
        for (const file of files) {
          await validatePropertyMediaFile(file, mediaKind);
          if (
            !isCurrentEditor(expectedScope) ||
            selectionVersionRef.current[kind] !== version
          )
            return;
        }
        if (
          !isCurrentEditor(expectedScope) ||
          selectionVersionRef.current[kind] !== version
        )
          return;
        const nextSelections = files.map((file, index) => ({
          file,
          scopeKey: expectedScope,
          token: version * 1000 + index + 1,
        }));
        const next = { ...pendingRef.current, [kind]: nextSelections };
        replacePending(next);
      } catch (error) {
        if (
          isCurrentEditor(expectedScope) &&
          selectionVersionRef.current[kind] === version
        ) {
          setErrors(current => ({ ...current, [kind]: errorMessage(error) }));
        }
      }
    },
    [disabled, isCurrentEditor, replacePending]
  );

  const discardFresh = useCallback(
    async (expectedScope: string, descriptor: PropertyMediaDescriptor) => {
      // Permission can be lost during storage; cleanup is still safe in the
      // same namespace. A workspace switch must never delete an old-scope blob.
      if (!isCurrentScope(expectedScope)) return;
      try {
        await discardPropertyMedia(expectedScope, descriptor.id);
      } catch {
        // This is a best-effort cleanup of a descriptor that was never attached.
      }
    },
    [isCurrentScope]
  );

  const saveKind = useCallback(
    async (kind: LettingDocumentKind) => {
      if (disabled || savingRef.current[kind] || !canEditRef.current) return;
      const selections = pendingRef.current[kind] ?? [];
      if (!selections.length) return;
      const expectedScope = scopeRef.current;
      if (!isCurrentEditor(expectedScope)) return;

      savingRef.current[kind] = true;
      setSaving(current => ({ ...current, [kind]: true }));
      setErrors(current => ({ ...current, [kind]: undefined }));

      try {
        for (const selected of selections) {
          if (
            !isCurrentEditor(expectedScope) ||
            selected.scopeKey !== expectedScope
          )
            throw new Error("تغيّرت الصلاحية أو مساحة العمل قبل حفظ المرفق.");

          let descriptor: PropertyMediaDescriptor | null = null;
          let attached = false;
          try {
            const storedDescriptor = await storePropertyMedia(
              expectedScope,
              mediaKindFor(kind),
              selected.file
            );
            descriptor = storedDescriptor;
            if (
              !isCurrentEditor(expectedScope) ||
              !(pendingRef.current[kind] ?? []).some(
                item =>
                  item.token === selected.token &&
                  item.scopeKey === expectedScope
              )
            )
              throw new Error("تغيّرت الصلاحية أو ملف المرفق أثناء الحفظ.");

            commitTransition(current =>
              attachLettingDocument(current, {
                requestId: requestId(applicationId, kind, selected.token),
                applicationId,
                kind,
                descriptor: storedDescriptor,
              })
            );
            attached = true;
            removePendingToken(kind, selected.token);
          } finally {
            // A descriptor becomes durable only after the core transition has
            // accepted it. Failed core validation, permission loss, a selection
            // replacement, or disposal cleans that fresh descriptor in-place.
            if (descriptor && !attached)
              await discardFresh(expectedScope, descriptor);
          }
        }
      } catch (error) {
        if (mountedRef.current && isCurrentScope(expectedScope)) {
          setErrors(current => ({ ...current, [kind]: errorMessage(error) }));
        }
      } finally {
        savingRef.current[kind] = false;
        if (mountedRef.current && isCurrentScope(expectedScope)) {
          setSaving(current => ({ ...current, [kind]: false }));
        }
      }
    },
    [
      applicationId,
      disabled,
      discardFresh,
      isCurrentEditor,
      isCurrentScope,
      removePendingToken,
    ]
  );

  const controlsDisabled = disabled || !canEdit;

  return (
    <section className="letting-attachments" aria-label="مرفقات طلب التأجير">
      <p className="letting-attachments__notice">
        محاكاة رفع المتقدم. استخدم مستندات تجريبية فقط. تُحفَظ الملفات محليًا في
        هذا المتصفح ومساحة العمل الحالية فقط؛ لا ترفع بطاقة هوية حقيقية ولا تمثل
        هذه الملفات تحققًا أو موافقة أو إثباتًا رسميًا.
      </p>

      {requestedKinds.map(kind => {
        const selected = (pending[kind] ?? []).filter(
          item => item.scopeKey === identity.storageKey
        );
        const isHandover = kind === "handover-photo";
        const busy = Boolean(saving[kind]);
        return (
          <fieldset className="letting-attachments__slot" key={kind}>
            <legend>{LETTING_DOCUMENT_LABELS[kind]}</legend>
            <p>{limitFor(kind)}</p>
            <label>
              <span>{isHandover ? "اختيار صور الحالة" : "اختيار الملف"}</span>
              <input
                type="file"
                accept={acceptFor(kind)}
                multiple={isHandover}
                disabled={controlsDisabled || busy}
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void chooseFiles(kind, files);
                }}
              />
            </label>
            {selected.length > 0 && (
              <div className="letting-attachments__pending">
                <p>
                  {isHandover && selected.length > 1
                    ? `${selected.length} صور جديدة بانتظار الحفظ الفعلي.`
                    : "ملف جديد بانتظار الحفظ الفعلي."}
                </p>
                <ul>
                  {selected.map(item => (
                    <li key={item.token}>{item.file.name}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={controlsDisabled || busy}
                  onClick={() => void saveKind(kind)}
                >
                  {busy ? "جارٍ حفظ المرفق…" : "حفظ المرفق"}
                </button>
              </div>
            )}
            {errors[kind] && (
              <p className="letting-attachments__error" role="alert">
                {errors[kind]}
              </p>
            )}
          </fieldset>
        );
      })}

      <div className="letting-attachments__saved" aria-live="polite">
        <h3>المرفقات المحفوظة محليًا</h3>
        {attachments.length === 0 ? (
          <p>لا توجد مرفقات من الأنواع المطلوبة في هذه الحالة حتى الآن.</p>
        ) : (
          attachments.map(reference => (
            <LocalAttachment
              key={`${reference.document.id}:${descriptorKey(reference.descriptor)}`}
              reference={reference}
            />
          ))
        )}
      </div>
    </section>
  );
}
