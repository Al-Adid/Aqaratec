import {
  MAX_PROPERTY_MEDIA_MANIFEST_LENGTH,
  MAX_PROPERTY_MEDIA_PHOTOS,
  MAX_PROPERTY_MEDIA_PLANS,
  PROPERTY_PHOTO_MAX_BYTES,
  PROPERTY_PLAN_MAX_BYTES,
  PROPERTY_VIDEO_MAX_BYTES,
  type PropertyMediaDescriptor,
  type PropertyMediaKind,
  type PropertyMediaManifest,
  type PropertyMediaMime,
  type StoredPropertyMedia,
} from "@shared/property-media-types";

const DB_NAME = "sunnaa-property-media-v1";
const STORE = "files";
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const VIDEO_MIMES = ["video/mp4", "video/webm"] as const;
const ID_PATTERN = /^[a-zA-Z0-9-]{8,100}$/;

function invalidMedia(): never {
  throw new Error("بيانات مرفقات العقار غير صالحة.");
}

function assertKind(kind: unknown): asserts kind is PropertyMediaKind {
  if (kind !== "photo" && kind !== "plan" && kind !== "video") invalidMedia();
}

function maximumBytes(kind: PropertyMediaKind): number {
  if (kind === "photo") return PROPERTY_PHOTO_MAX_BYTES;
  if (kind === "plan") return PROPERTY_PLAN_MAX_BYTES;
  return PROPERTY_VIDEO_MAX_BYTES;
}

function labelFor(kind: PropertyMediaKind): string {
  if (kind === "photo") return "الصورة";
  if (kind === "plan") return "المخطط";
  return "الفيديو";
}

function validMimeFor(
  kind: PropertyMediaKind,
  mime: unknown
): mime is PropertyMediaMime {
  if (typeof mime !== "string") return false;
  if (kind === "photo")
    return IMAGE_MIMES.includes(mime as (typeof IMAGE_MIMES)[number]);
  if (kind === "plan")
    return (
      IMAGE_MIMES.includes(mime as (typeof IMAGE_MIMES)[number]) ||
      mime === "application/pdf"
    );
  return VIDEO_MIMES.includes(mime as (typeof VIDEO_MIMES)[number]);
}

export function isPropertyMediaImage(mime: string): boolean {
  return IMAGE_MIMES.includes(mime as (typeof IMAGE_MIMES)[number]);
}

function validateDescriptor(
  value: unknown,
  kind: PropertyMediaKind
): PropertyMediaDescriptor {
  assertKind(kind);
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalidMedia();
  const descriptor = value as Record<string, unknown>;
  if (
    typeof descriptor.id !== "string" ||
    !ID_PATTERN.test(descriptor.id) ||
    typeof descriptor.name !== "string" ||
    !descriptor.name.trim() ||
    descriptor.name.length > 160 ||
    !validMimeFor(kind, descriptor.mime) ||
    typeof descriptor.size !== "number" ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size < 1 ||
    descriptor.size > maximumBytes(kind)
  ) {
    invalidMedia();
  }
  return {
    id: descriptor.id,
    name: descriptor.name,
    mime: descriptor.mime,
    size: descriptor.size,
  };
}

function validateOpaqueIds(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalidMedia();
  const ids = value.map(id => {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) invalidMedia();
    return id;
  });
  if (new Set(ids).size !== ids.length) invalidMedia();
  return ids;
}

function parseSafeVideoUrl(value: unknown): string | undefined {
  if (typeof value !== "string") invalidMedia();
  if (!value) return undefined;
  if (value !== value.trim() || value.length > 512) invalidMedia();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidMedia();
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    invalidMedia();
  }
  // This is validation only. The client never probes, fetches, embeds, or
  // uploads the URL; UI readers expose it solely as an explicit user link.
  return value;
}

export function parsePropertyMedia(value: unknown): PropertyMediaManifest {
  if (value === undefined || value === null || value === "") return { v: 1 };
  if (
    typeof value !== "string" ||
    value.length > MAX_PROPERTY_MEDIA_MANIFEST_LENGTH
  ) {
    invalidMedia();
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    invalidMedia();
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    invalidMedia();
  const raw = decoded as Record<string, unknown>;
  const allowed = new Set([
    "v",
    "photo",
    "plan",
    "photoIds",
    "planIds",
    "video",
    "videoUrl",
  ]);
  if (raw.v !== 1 || Object.keys(raw).some(key => !allowed.has(key)))
    invalidMedia();

  const photo =
    raw.photo === undefined
      ? undefined
      : validateDescriptor(raw.photo, "photo");
  const plan =
    raw.plan === undefined ? undefined : validateDescriptor(raw.plan, "plan");
  const photoIds =
    raw.photoIds === undefined
      ? undefined
      : validateOpaqueIds(raw.photoIds, MAX_PROPERTY_MEDIA_PHOTOS);
  const planIds =
    raw.planIds === undefined
      ? undefined
      : validateOpaqueIds(raw.planIds, MAX_PROPERTY_MEDIA_PLANS);
  if (
    new Set([...(photoIds ?? []), ...(photo ? [photo.id] : [])]).size >
      MAX_PROPERTY_MEDIA_PHOTOS ||
    new Set([...(planIds ?? []), ...(plan ? [plan.id] : [])]).size >
      MAX_PROPERTY_MEDIA_PLANS
  )
    invalidMedia();
  const video =
    raw.video === undefined
      ? undefined
      : validateDescriptor(raw.video, "video");
  const videoUrl =
    raw.videoUrl === undefined ? undefined : parseSafeVideoUrl(raw.videoUrl);

  return {
    v: 1,
    ...(photo ? { photo } : {}),
    ...(plan ? { plan } : {}),
    ...(photoIds?.length ? { photoIds } : {}),
    ...(planIds?.length ? { planIds } : {}),
    ...(video ? { video } : {}),
    ...(videoUrl ? { videoUrl } : {}),
  };
}

/** Serializes only bounded opaque references; it deliberately never truncates. */
export function serializePropertyMedia(
  manifest: PropertyMediaManifest
): string {
  const source = JSON.stringify(manifest);
  if (source.length > MAX_PROPERTY_MEDIA_MANIFEST_LENGTH) {
    throw new Error(
      "مراجع مرفقات العقار تتجاوز حد 1024 حرفًا؛ قلّل الملفات أو أسماءها دون حذف تلقائي."
    );
  }
  const validated = parsePropertyMedia(source);
  const normalized: PropertyMediaManifest = {
    v: 1,
    ...(validated.photo ? { photo: validated.photo } : {}),
    ...(validated.plan ? { plan: validated.plan } : {}),
    ...(validated.photoIds?.length ? { photoIds: validated.photoIds } : {}),
    ...(validated.planIds?.length ? { planIds: validated.planIds } : {}),
    ...(validated.video ? { video: validated.video } : {}),
    ...(validated.videoUrl ? { videoUrl: validated.videoUrl } : {}),
  };
  const raw = JSON.stringify(normalized);
  if (raw.length > MAX_PROPERTY_MEDIA_MANIFEST_LENGTH) {
    throw new Error(
      "مراجع مرفقات العقار تتجاوز حد 1024 حرفًا؛ قلّل الملفات أو أسماءها دون حذف تلقائي."
    );
  }
  return raw === '{"v":1}' ? "" : raw;
}

export function createPropertyMediaId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll("-", "").slice(0, 16);
  // Local fallback preserves the opaque-ID format where crypto.randomUUID is
  // unavailable (for example, a constrained test/browser environment).
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    .replace(/[^a-z0-9]/gi, "")
    .padEnd(12, "0")
    .slice(0, 16);
}

/** Builds a descriptor without reading file bytes; validation still occurs on store. */
export function makePropertyMediaDescriptor(
  id: string,
  file: File,
  kind: PropertyMediaKind
): PropertyMediaDescriptor {
  return validateDescriptor(
    { id, name: file.name, mime: file.type, size: file.size },
    kind
  );
}

async function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error("تعذر قراءة الملف."));
    reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
    reader.readAsArrayBuffer(blob);
  });
}

function hasSignature(bytes: Uint8Array, mime: PropertyMediaMime): boolean {
  const ascii = new TextDecoder("ascii").decode(bytes);
  if (mime === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (number, index) => bytes[index] === number
    );
  if (mime === "image/webp")
    return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mime === "application/pdf") return ascii.startsWith("%PDF-");
  if (mime === "video/mp4") return ascii.slice(4, 8) === "ftyp";
  return [0x1a, 0x45, 0xdf, 0xa3].every(
    (number, index) => bytes[index] === number
  );
}

export async function validatePropertyMediaFile(
  file: File,
  kind: PropertyMediaKind
): Promise<void> {
  assertKind(kind);
  const maximum = maximumBytes(kind);
  if (!file || file.size < 1 || file.size > maximum) {
    const limit = maximum / 1024 / 1024;
    throw new Error(
      `حجم ${labelFor(kind)} يجب أن يكون أكبر من صفر ولا يتجاوز ${limit} ميجابايت.`
    );
  }
  if (!validMimeFor(kind, file.type)) {
    throw new Error(
      kind === "photo"
        ? "اختر صورة JPG أو PNG أو WebP."
        : kind === "plan"
          ? "اختر مخططًا بصيغة PDF أو JPG أو PNG أو WebP."
          : "اختر فيديو MP4 أو WebM."
    );
  }
  const bytes = new Uint8Array(await bytesOf(file.slice(0, 16)));
  if (!hasSignature(bytes, file.type as PropertyMediaMime)) {
    throw new Error("محتوى الملف لا يتوافق مع صيغته؛ اختر ملفًا صحيحًا.");
  }
  // Reject an overlong filename before any descriptor/IDB write. This prevents
  // silent source-JSON truncation and leaves no orphaned local bytes.
  makePropertyMediaDescriptor(createPropertyMediaId(), file, kind);
}

function assertScope(scopeKey: string): void {
  if (!scopeKey || scopeKey.length > 500 || /pending/.test(scopeKey)) {
    throw new Error("انتظر تحقق مساحة العمل قبل حفظ المرفقات.");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        new Error(
          "تخزين الملفات غير متاح في هذا المتصفح؛ جرّب متصفحًا عاديًا خارج الوضع الخاص."
        )
      );
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("تعذر فتح تخزين مرفقات العقار في المتصفح."));
    request.onblocked = () =>
      reject(
        new Error(
          "تخزين المرفقات محجوب؛ أغلق التبويبات القديمة ثم أعد المحاولة."
        )
      );
  });
}

export async function storePropertyMedia(
  scopeKey: string,
  kind: PropertyMediaKind,
  file: File,
  requestedId?: string
): Promise<PropertyMediaDescriptor> {
  assertScope(scopeKey);
  assertKind(kind);
  await validatePropertyMediaFile(file, kind);
  const descriptor = makePropertyMediaDescriptor(
    requestedId ?? createPropertyMediaId(),
    file,
    kind
  );
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure: Error | undefined;
      const exists = store.get(descriptor.id);
      exists.onsuccess = () => {
        if (exists.result) {
          failure = new Error("تعذر حفظ الملف؛ تعارض معرف المرفق المحلي.");
          transaction.abort();
          return;
        }
        const record: StoredPropertyMedia = {
          ...descriptor,
          scopeKey,
          kind,
          blob: file.slice(0, file.size, file.type),
          createdAt: new Date().toISOString(),
        };
        store.put(record);
      };
      exists.onerror = () => {
        failure = new Error(
          "تعذر حفظ الملف؛ قد تكون مساحة تخزين المتصفح ممتلئة. لم يتغير العقار."
        );
        transaction.abort();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(
          failure ??
            new Error(
              "تعذر حفظ الملف؛ قد تكون مساحة تخزين المتصفح ممتلئة. لم يتغير العقار."
            )
        );
    });
    return descriptor;
  } finally {
    db.close();
  }
}

function descriptorMatches(
  left: PropertyMediaDescriptor,
  right: PropertyMediaDescriptor
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.mime === right.mime &&
    left.size === right.size
  );
}

function validStoredRow(
  value: unknown,
  scopeKey: string,
  kind: PropertyMediaKind,
  expected?: PropertyMediaDescriptor
): value is StoredPropertyMedia {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredPropertyMedia>;
  if (
    row.scopeKey !== scopeKey ||
    row.kind !== kind ||
    !(row.blob instanceof Blob)
  ) {
    return false;
  }
  try {
    const descriptor = validateDescriptor(row, kind);
    return (
      (!expected || descriptorMatches(descriptor, expected)) &&
      row.blob.size === descriptor.size &&
      row.blob.type === descriptor.mime
    );
  } catch {
    return false;
  }
}

export async function loadPropertyMedia(
  scopeKey: string,
  descriptor: PropertyMediaDescriptor,
  kind: PropertyMediaKind
): Promise<Blob | null> {
  assertScope(scopeKey);
  assertKind(kind);
  const validDescriptor = validateDescriptor(descriptor, kind);
  const db = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(validDescriptor.id);
      request.onsuccess = () => {
        const row = request.result;
        resolve(
          validStoredRow(row, scopeKey, kind, validDescriptor) ? row.blob : null
        );
      };
      request.onerror = () =>
        reject(new Error("تعذر قراءة الملف من هذا المتصفح."));
    });
  } finally {
    db.close();
  }
}

async function lookupStoredPropertyMedia(
  scopeKey: string,
  id: string,
  kind: PropertyMediaKind
): Promise<StoredPropertyMedia | null> {
  assertScope(scopeKey);
  assertKind(kind);
  if (!ID_PATTERN.test(id)) return null;
  const db = await openDatabase();
  try {
    return await new Promise<StoredPropertyMedia | null>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(id);
      request.onsuccess = () => {
        const row = request.result;
        resolve(validStoredRow(row, scopeKey, kind) ? row : null);
      };
      request.onerror = () =>
        reject(new Error("تعذر قراءة الملف من هذا المتصفح."));
    });
  } finally {
    db.close();
  }
}

/**
 * Resolves an opaque byte-backed ID in the current local scope. Omitted kind
 * remains `photo` for the established property/unit gallery API.
 */
export async function lookupPropertyMedia(
  scopeKey: string,
  id: string,
  kind: PropertyMediaKind = "photo"
): Promise<PropertyMediaDescriptor | null> {
  const row = await lookupStoredPropertyMedia(scopeKey, id, kind);
  return row
    ? { id: row.id, name: row.name, mime: row.mime, size: row.size }
    : null;
}

/** Generic opaque-ID loader for multi-plan/photo readers and local video. */
export async function loadPropertyMediaById(
  scopeKey: string,
  id: string,
  kind: PropertyMediaKind = "photo"
): Promise<Blob | null> {
  return (await lookupStoredPropertyMedia(scopeKey, id, kind))?.blob ?? null;
}

/** Legacy gallery convenience API; it remains photo-only. */
export async function loadPropertyPhotoById(
  scopeKey: string,
  id: string
): Promise<Blob | null> {
  return loadPropertyMediaById(scopeKey, id, "photo");
}

export async function discardPropertyMedia(
  scopeKey: string,
  id: string
): Promise<void> {
  assertScope(scopeKey);
  if (!ID_PATTERN.test(id)) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result?.scopeKey === scopeKey) store.delete(id);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("تعذر تنظيف الملف غير المحفوظ."));
    });
  } finally {
    db.close();
  }
}
