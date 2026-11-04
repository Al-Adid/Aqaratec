import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, ShieldCheck } from "lucide-react";
import {
  PROPERTY_MEDIA_SECTIONS,
  MediaKindIcon,
  PropertyMediaPreview,
} from "./PropertyMediaGalleryParts";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  loadPropertyMedia,
  loadPropertyMediaById,
  lookupPropertyMedia,
  parsePropertyMedia,
} from "@/lib/property-media";
import type {
  PropertyMediaDescriptor,
  PropertyMediaKind,
  PropertyMediaManifest,
} from "@shared/property-media-types";

export interface PropertyMediaDisplayProps {
  value: unknown;
  title: string;
}

type SavedReference = {
  key: string;
  kind: PropertyMediaKind;
  id: string;
  source: "descriptor" | "id";
  descriptor?: PropertyMediaDescriptor;
};
type DisplayAsset = {
  reference: SavedReference;
  scopeKey: string;
  status: "loading" | "available" | "missing";
  url?: string;
};

function readManifest(value: unknown): {
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

function descriptorKey(descriptor: PropertyMediaDescriptor) {
  return `${descriptor.id}:${descriptor.name}:${descriptor.mime}:${descriptor.size}`;
}

function labelFor(kind: PropertyMediaKind) {
  if (kind === "photo") return "صورة العقار";
  if (kind === "plan") return "مخطط أو خريطة";
  return "فيديو العقار";
}

function safeRevoke(url: string | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Releasing a local URL must not interrupt the property reader.
  }
}

function referencesFor(manifest: PropertyMediaManifest): SavedReference[] {
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

/**
 * Displays only current-scope byte-backed local files. Descriptors and opaque
 * IDs remain visible when the local blob is missing, but no remote fallback is
 * guessed. The optional video URL is a user-clicked link, never auto-fetched.
 */
export function PropertyMediaDisplay({
  value,
  title,
}: PropertyMediaDisplayProps) {
  const { identity } = usePrototype();
  const parsed = useMemo(() => readManifest(value), [value]);
  const references = useMemo(
    () => referencesFor(parsed.manifest),
    [parsed.manifest]
  );
  const [assets, setAssets] = useState<Record<string, DisplayAsset>>({});
  const mountedRef = useRef(true);
  const scopeRef = useRef(identity.storageKey);
  const urlsRef = useRef<string[]>([]);

  scopeRef.current = identity.storageKey;

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

  const referencesKey = references.map(reference => reference.key).join("|");
  useEffect(() => {
    let cancelled = false;
    const expectedScope = identity.storageKey;
    const snapshot = references;
    clearUrls();
    setAssets(
      Object.fromEntries(
        snapshot.map(reference => [
          reference.key,
          { reference, scopeKey: expectedScope, status: "loading" as const },
        ])
      )
    );
    const current = () =>
      !cancelled && mountedRef.current && scopeRef.current === expectedScope;
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
        setAssets(previous => ({
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
      urlsRef.current.push(url);
      setAssets(previous => ({
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
  }, [clearUrls, identity.storageKey, references, referencesKey]);

  const hasMedia = Boolean(references.length || parsed.manifest.videoUrl);

  return (
    <section
      className="property-media-display"
     
      aria-label={`مرفقات ${title}`}
    >
      <p className="property-media-notice">
        <ShieldCheck size={19} aria-hidden="true" />
        <span>
          المرفقات محفوظة في هذا المتصفح فقط؛ الحفظ السحابي وتصدير JSON لا
          ينقلان الملفات.
        </span>
      </p>
      {parsed.error && (
        <p className="property-media-error" role="alert">
          {parsed.error}
        </p>
      )}
      {!parsed.error && !hasMedia && <p>لا توجد مرفقات لهذا العقار.</p>}

      {PROPERTY_MEDIA_SECTIONS.map(({ kind, title: sectionTitle }) => {
        const saved = references.filter(reference => reference.kind === kind);
        return (
          <section
            className="property-media-slot"
            key={kind}
            aria-label={sectionTitle}
          >
            <div className="property-media-slot-heading">
              <span className="property-media-kind-icon">
                <MediaKindIcon kind={kind} />
              </span>
              <div className="property-media-slot-heading-text">
                <h4>{sectionTitle}</h4>
              </div>
              <span className="property-media-count">{saved.length} ملف</span>
            </div>
            {!saved.length && (
              <p className="property-media-empty">
                لا توجد ملفات مرفقة في هذا القسم.
              </p>
            )}
            <div className="property-media-grid">
              {saved.map(reference => {
                const candidate = assets[reference.key];
                const asset =
                  candidate?.scopeKey === identity.storageKey
                    ? candidate
                    : undefined;
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
                        alt={`${labelFor(kind)}: ${title}`}
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
                        {descriptor?.name ?? "مرجع ملف محلي"}
                      </strong>
                      {descriptor && (
                        <span className="property-media-file-size">{`${Math.ceil(descriptor.size / 1024)} كيلوبايت`}</span>
                      )}
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
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {kind === "video" && parsed.manifest.videoUrl && (
              <p className="property-media-external-link">
                <a
                  className="property-media-action-link"
                  href={parsed.manifest.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  فتح رابط الفيديو الاختياري
                </a>{" "}
               ، لا يُجلب تلقائيًا.
              </p>
            )}
          </section>
        );
      })}
    </section>
  );
}
