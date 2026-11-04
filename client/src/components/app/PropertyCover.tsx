import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoEntity } from "@shared/prototype";
import type { PropertyMediaDescriptor } from "@shared/property-media-types";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  loadPropertyMedia,
  loadPropertyPhotoById,
  parsePropertyMedia,
} from "@/lib/property-media";
import { parsePhotoGallery } from "@/lib/property-photo-gallery";

type Status =
  | "empty"
  | "loading"
  | "available"
  | "missing"
  | "invalid"
  | "out-of-scope";
type Candidate =
  | { kind: "legacy"; descriptor: PropertyMediaDescriptor }
  | { kind: "gallery"; id: string };
export interface PropertyCoverProps {
  property: DemoEntity;
  kind?: "properties" | "units";
  className?: string;
  alt?: string;
}
function revoke(url?: string) {
  if (url)
    try {
      URL.revokeObjectURL(url);
    } catch {}
}
function message(status: Status, kind: "properties" | "units") {
  if (status === "loading") return "جارٍ تحميل الصورة المحلية…";
  if (status === "missing")
    return "مرجع الصورة موجود، لكن الملف غير متاح أو غير قابل للقراءة في هذا المتصفح.";
  if (status === "invalid") return "تعذر قراءة مرجع صورة الغلاف.";
  if (status === "out-of-scope") return "الصورة خارج نطاق المحفظة الحالية.";
  return kind === "units"
    ? "لا توجد صورة محفوظة لهذه الوحدة."
    : "لا توجد صورة محفوظة لهذا العقار.";
}
/** Resolve local bytes: legacy image, then manifest photos, then saved gallery. */
export function PropertyCover({
  property,
  kind = "properties",
  className = "",
  alt,
}: PropertyCoverProps) {
  const { state, identity } = usePrototype();
  const current = state.entities[kind].find(p => p.id === property.id);
  const inScope =
    !!current &&
    (state.settings.portfolioId === "all" ||
      state.settings.portfolioId === current.portfolioId);
  const [cover, setCover] = useState<{
    status: Status;
    url?: string;
    name?: string;
  }>({ status: "empty" });
  const latest = useRef({
    scope: identity.storageKey,
    id: property.id,
    inScope,
    kind,
  });
  latest.current = {
    scope: identity.storageKey,
    id: property.id,
    inScope,
    kind,
  };
  const urlRef = useRef<string | undefined>(undefined);
  const clear = useCallback(() => {
    revoke(urlRef.current);
    urlRef.current = undefined;
  }, []);
  const refs = useMemo(() => {
    const candidates: Candidate[] = [];
    let invalid = false;
    if (!current || !inScope) return { candidates, invalid };
    try {
      const manifest = parsePropertyMedia(current.meta.propertyMedia);
      if (manifest.photo)
        candidates.push({ kind: "legacy", descriptor: manifest.photo });
      for (const id of manifest.photoIds ?? [])
        candidates.push({ kind: "gallery", id });
    } catch {
      invalid = true;
    }
    try {
      for (const id of parsePhotoGallery(current.meta.photoGallery).ids)
        candidates.push({ kind: "gallery", id });
    } catch {
      invalid = true;
    }
    return { candidates, invalid };
  }, [current?.meta.propertyMedia, current?.meta.photoGallery, inScope, kind]);
  useEffect(() => {
    let cancelled = false;
    const scope = identity.storageKey,
      id = property.id;
    const valid = () =>
      !cancelled &&
      latest.current.scope === scope &&
      latest.current.id === id &&
      latest.current.kind === kind &&
      latest.current.inScope;
    clear();
    if (!current || !inScope) {
      setCover({ status: "out-of-scope" });
      return;
    }
    if (!refs.candidates.length) {
      setCover({ status: refs.invalid ? "invalid" : "empty" });
      return;
    }
    setCover({ status: "loading" });
    void (async () => {
      for (const candidate of refs.candidates) {
        if (!valid()) return;
        let blob: Blob | null = null;
        try {
          blob =
            candidate.kind === "legacy"
              ? await loadPropertyMedia(scope, candidate.descriptor, "photo")
              : await loadPropertyPhotoById(scope, candidate.id);
        } catch {}
        if (!valid()) return;
        if (!blob || !/^image\/(jpeg|png|webp)$/.test(blob.type)) continue;
        const url = URL.createObjectURL(blob);
        if (!valid()) {
          revoke(url);
          return;
        }
        urlRef.current = url;
        setCover({
          status: "available",
          url,
          name:
            candidate.kind === "legacy" ? candidate.descriptor.name : undefined,
        });
        return;
      }
      if (valid()) setCover({ status: "missing" });
    })();
    return () => {
      cancelled = true;
      clear();
    };
  }, [clear, identity.storageKey, property.id, inScope, refs, kind]);
  useEffect(() => () => clear(), [clear]);
  return (
    <figure
      className={`property-cover ${className}`.trim()}
      aria-busy={cover.status === "loading"}
    >
      {cover.status === "available" && cover.url ? (
        <img
          className="property-cover__image"
          src={cover.url}
          alt={
            alt ??
            `${kind === "units" ? "صورة الوحدة" : "صورة غلاف"} ${current?.title ?? property.title}`
          }
        />
      ) : (
        <div className="property-cover__placeholder" role="status">
          {message(cover.status, kind)}
        </div>
      )}
      {cover.name && (
        <figcaption className="property-cover__caption">
          {cover.name}
        </figcaption>
      )}
    </figure>
  );
}
