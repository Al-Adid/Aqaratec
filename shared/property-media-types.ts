export type PropertyMediaKind = "photo" | "plan" | "video";
export type PropertyMediaMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "video/mp4"
  | "video/webm";

/** A byte-backed local file reference. It never contains a URL or file bytes. */
export interface PropertyMediaDescriptor {
  id: string;
  name: string;
  mime: PropertyMediaMime;
  size: number;
}

/**
 * v1 remains compatible with the original single `photo` / `plan` descriptors.
 * New groups contain opaque IndexedDB IDs only, so the snapshot remains bounded
 * and never serializes bytes, data URLs, or blob URLs.
 */
export interface PropertyMediaManifest {
  v: 1;
  photo?: PropertyMediaDescriptor;
  plan?: PropertyMediaDescriptor;
  photoIds?: string[];
  planIds?: string[];
  video?: PropertyMediaDescriptor;
  videoUrl?: string;
}

export interface StoredPropertyMedia extends PropertyMediaDescriptor {
  scopeKey: string;
  kind: PropertyMediaKind;
  blob: Blob;
  createdAt: string;
}

export const PROPERTY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROPERTY_PLAN_MAX_BYTES = 10 * 1024 * 1024;
export const PROPERTY_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PROPERTY_MEDIA_PHOTOS = 20;
export const MAX_PROPERTY_MEDIA_PLANS = 10;
export const MAX_PROPERTY_MEDIA_MANIFEST_LENGTH = 1024;
