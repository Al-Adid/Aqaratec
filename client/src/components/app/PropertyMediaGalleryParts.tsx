import { FileText, ImagePlus, Map, Video } from "lucide-react";
import type { PropertyMediaKind } from "@shared/property-media-types";
import { isPropertyMediaImage } from "@/lib/property-media";
import "./PropertyMediaGallery.css";

export const PROPERTY_MEDIA_SECTIONS = [
  {
    kind: "photo",
    title: "صور العقار",
    action: "إضافة صور العقار",
    empty: "أضف صور الواجهة والغرف والمرافق لتظهر هنا.",
  },
  {
    kind: "plan",
    title: "المخططات والخرائط",
    action: "إضافة مخططات وخرائط",
    empty: "أضف صور المخطط العقاري أو ملفات PDF لتظهر هنا.",
  },
  {
    kind: "video",
    title: "فيديو العقار",
    action: "إضافة فيديو العقار",
    empty: "أضف فيديو من جهازك أو أدخل رابطه أدناه.",
  },
] as const;

export function MediaKindIcon({ kind }: { kind: PropertyMediaKind }) {
  const Icon = kind === "photo" ? ImagePlus : kind === "plan" ? Map : Video;
  return <Icon size={22} aria-hidden="true" />;
}

export function PropertyMediaPreview({
  kind,
  mime,
  url,
  alt,
}: {
  kind: PropertyMediaKind;
  mime: string;
  url: string;
  alt: string;
}) {
  if (isPropertyMediaImage(mime)) {
    return (
      <a
        className="property-media-image-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`فتح ${alt}`}
      >
        <img className="property-media-preview" src={url} alt={alt} />
      </a>
    );
  }
  if (kind === "video" && (mime === "video/mp4" || mime === "video/webm")) {
    return (
      <video
        className="property-media-preview"
        controls
        preload="metadata"
        playsInline
        src={url}
        aria-label={alt}
      >
        معاينة فيديو محلي
      </video>
    );
  }
  if (kind === "plan" && mime === "application/pdf") {
    return (
      <div className="property-media-file-preview">
        <FileText size={40} aria-hidden="true" />
        <strong>مخطط أو خريطة PDF</strong>
        <span>افتح الملف للاطلاع على المخطط كاملًا</span>
      </div>
    );
  }
  return null;
}
