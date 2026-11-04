import type { DemoEntity, PrototypeState } from "@shared/prototype";
import { validatePrototypeState } from "@shared/prototype-validation";
import {
  MAX_GALLERY_PHOTOS,
  MAX_PHOTO_GROUP_UNITS,
  type AssignUnitPhotoGroupInput,
  type PhotoGalleryManifest,
  type PhotoGalleryTargetKind,
  type PhotoGalleryTransition,
} from "@shared/photo-gallery-types";

const MAX_TEXT_LENGTH = 1024;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 256;
const MAX_META_ENTRIES = 32;
const MAX_ROWS_PER_KIND = 500;
const MAX_TOTAL_ROWS = 2000;
const GROUP_DOCUMENT_TYPE = "unit-photo-gallery";
const ID_PATTERN = /^[a-zA-Z0-9-]{8,100}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

type GalleryTarget = {
  target: DemoEntity;
  property: DemoEntity;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireId(value: unknown, label: string): string {
  const result = text(value);
  if (!result || result.length > MAX_ID_LENGTH)
    throw new Error(`${label} غير صالح.`);
  return result;
}

function requirePhotoId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    throw new Error("مرجع الصورة غير صالح.");
  return value;
}

function uniquePhotoIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GALLERY_PHOTOS)
    throw new Error(`يمكن ربط ${MAX_GALLERY_PHOTOS} صورة كحد أقصى.`);
  const ids = value.map(requirePhotoId);
  if (new Set(ids).size !== ids.length)
    throw new Error("لا يمكن تكرار مرجع الصورة في المعرض.");
  return ids;
}

function uniqueEntityIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_PHOTO_GROUP_UNITS)
    throw new Error(`يمكن اختيار ${MAX_PHOTO_GROUP_UNITS} وحدة كحد أقصى.`);
  const ids = value.map(item => requireId(item, label));
  if (new Set(ids).size !== ids.length)
    throw new Error("لا يمكن تكرار الوحدة في مجموعة الصور.");
  return ids;
}

function manifestText(ids: string[]): string {
  const raw = JSON.stringify({ v: 1, ids });
  // Keep this explicit even though the normal ID/20 limits leave plenty of
  // room. Metadata is persisted independently of IndexedDB bytes.
  if (raw.length > MAX_TEXT_LENGTH)
    throw new Error("مراجع صور المعرض تتجاوز حد بيانات السجل.");
  return raw;
}

/** Parses only the bounded, ID-only gallery reference format. */
export function parsePhotoGallery(value: unknown): PhotoGalleryManifest {
  if (value === undefined || value === null || value === "")
    return { v: 1, ids: [] };
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH)
    throw new Error("بيانات معرض الصور غير صالحة.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("بيانات معرض الصور غير صالحة.");
  }
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    Object.keys(decoded).some(key => key !== "v" && key !== "ids") ||
    (decoded as Record<string, unknown>).v !== 1
  ) {
    throw new Error("بيانات معرض الصور غير صالحة.");
  }
  try {
    return {
      v: 1,
      ids: uniquePhotoIds((decoded as Record<string, unknown>).ids),
    };
  } catch {
    throw new Error("بيانات معرض الصور غير صالحة.");
  }
}

function assertOperator(state: PrototypeState): void {
  if (state.settings.role !== "operator")
    throw new Error("تعديل صور المعرض متاح لمعاينة الموظف فقط.");
}

function assertCurrentPortfolio(
  state: PrototypeState,
  portfolioId: string
): void {
  if (
    state.settings.portfolioId !== "all" &&
    state.settings.portfolioId !== portfolioId
  ) {
    throw new Error("العقار خارج نطاق المحفظة الحالية.");
  }
}

function propertyFor(state: PrototypeState, propertyId: string): DemoEntity {
  const property = state.entities.properties.find(row => row.id === propertyId);
  if (!property) throw new Error("العقار المحدد غير موجود.");
  const portfolio = state.entities.portfolios.find(
    row => row.id === property.portfolioId
  );
  if (!portfolio)
    throw new Error("العقار لا يتبع محفظة صالحة؛ لم يتغير المعرض.");
  assertCurrentPortfolio(state, property.portfolioId);
  return property;
}

function targetFor(
  state: PrototypeState,
  kind: PhotoGalleryTargetKind,
  id: string
): GalleryTarget {
  const targetId = requireId(id, "معرف الهدف");
  if (kind === "properties") {
    const property = propertyFor(state, targetId);
    return { target: property, property };
  }
  if (kind !== "units") throw new Error("نوع هدف المعرض غير صالح.");
  const unit = state.entities.units.find(row => row.id === targetId);
  if (!unit) throw new Error("الوحدة المحددة غير موجودة.");
  const property = propertyFor(state, unit.propertyId);
  if (unit.portfolioId !== property.portfolioId)
    throw new Error("الوحدة والعقار لا يتبعان المحفظة نفسها.");
  return { target: unit, property };
}

function galleryMeta(entity: DemoEntity, ids: string[]): DemoEntity["meta"] {
  const hasExistingKey = Object.hasOwn(entity.meta, "photoGallery");
  if (!hasExistingKey && Object.keys(entity.meta).length >= MAX_META_ENTRIES)
    throw new Error("لا توجد مساحة لمرجع معرض الصور في بيانات السجل.");
  return { ...entity.meta, photoGallery: manifestText(ids) };
}

function replaceTarget(
  state: PrototypeState,
  kind: PhotoGalleryTargetKind,
  result: DemoEntity
): PrototypeState {
  return {
    ...state,
    entities: {
      ...state.entities,
      [kind]: state.entities[kind].map(row =>
        row.id === result.id ? result : row
      ),
    },
  };
}

function ensureValid(next: PrototypeState): PrototypeState {
  const check = validatePrototypeState(next);
  if (!check.success)
    throw new Error(`لا يمكن حفظ معرض الصور: ${check.message}`);
  return check.data;
}

/**
 * Replaces the gallery references on one asset. It deliberately never calls
 * IndexedDB: unlinking a photo must not delete a Blob which may still be used
 * by another target or a historical snapshot.
 */
export function saveTargetPhotoGallery(
  state: PrototypeState,
  kind: PhotoGalleryTargetKind,
  id: string,
  ids: string[]
): PhotoGalleryTransition {
  assertOperator(state);
  const normalIds = uniquePhotoIds(ids);
  const { target } = targetFor(state, kind, id);
  const result: DemoEntity = {
    ...target,
    meta: galleryMeta(target, normalIds),
  };
  return { state: ensureValid(replaceTarget(state, kind, result)), result };
}

function mergedGalleryIds(previous: string[], additions: string[]): string[] {
  const merged = [...previous];
  for (const id of additions) if (!merged.includes(id)) merged.push(id);
  if (merged.length > MAX_GALLERY_PHOTOS)
    throw new Error(`لا تتسع الوحدة لأكثر من ${MAX_GALLERY_PHOTOS} صورة.`);
  return merged;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function chunksFor(ids: string[]): string[] {
  const chunks: string[] = [];
  let chunk: string[] = [];
  for (const id of ids) {
    const proposed = JSON.stringify([...chunk, id]);
    if (proposed.length > MAX_TEXT_LENGTH) {
      if (!chunk.length) throw new Error("مرجع الصورة يتجاوز حد بيانات السجل.");
      chunks.push(JSON.stringify(chunk));
      chunk = [id];
    } else {
      chunk.push(id);
    }
  }
  if (chunk.length) chunks.push(JSON.stringify(chunk));
  return chunks;
}

function groupDocumentMeta(
  requestId: string,
  fingerprint: string,
  propertyId: string,
  unitIds: string[],
  photoIds: string[]
): DemoEntity["meta"] {
  const unitChunks = chunksFor(unitIds);
  const photoChunks = chunksFor(photoIds);
  const meta: DemoEntity["meta"] = {
    requestId,
    photoGalleryRequestId: requestId,
    photoGalleryFingerprint: fingerprint,
    photoGalleryType: GROUP_DOCUMENT_TYPE,
    propertyId,
    unitIdChunkCount: unitChunks.length,
    photoIdChunkCount: photoChunks.length,
  };
  unitChunks.forEach((chunk, index) => {
    meta[`unitIds${index + 1}`] = chunk;
  });
  photoChunks.forEach((chunk, index) => {
    meta[`photoIds${index + 1}`] = chunk;
  });
  if (Object.keys(meta).length > MAX_META_ENTRIES)
    throw new Error("سجل مجموعة الصور يتجاوز سعة البيانات الوصفية.");
  return meta;
}

function entityCount(state: PrototypeState): number {
  return Object.values(state.entities).reduce(
    (count, rows) => count + rows.length,
    0
  );
}

function newDocumentId(state: PrototypeState, requestId: string): string {
  const base = `photo-group-${hash(requestId)}`;
  let candidate = base;
  let index = 1;
  while (state.entities.documents.some(row => row.id === candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

/**
 * Adds a shared selection to each selected unit in one pure transition. The
 * group document is intentionally small, stores only bounded ID chunks, and
 * makes a retried click idempotent without ever storing file bytes in JSON.
 */
export function assignUnitPhotoGroup(
  state: PrototypeState,
  input: AssignUnitPhotoGroupInput
): PhotoGalleryTransition {
  assertOperator(state);
  const requestId = text(input?.requestId);
  if (!REQUEST_ID_PATTERN.test(requestId))
    throw new Error("معرف طلب مجموعة الصور غير صالح.");
  const propertyId = requireId(input?.propertyId, "معرف العقار");
  const unitIds = uniqueEntityIds(input?.unitIds, "معرف الوحدة");
  const photoIds = uniquePhotoIds(input?.photoIds);
  if (!unitIds.length) throw new Error("اختر وحدة واحدة على الأقل.");
  if (!photoIds.length) throw new Error("اختر صورة واحدة على الأقل.");
  const title = text(input?.title) || "إسناد صور لوحدات مختارة";
  if (title.length > MAX_TITLE_LENGTH)
    throw new Error("عنوان مجموعة الصور طويل جدًا.");

  const property = propertyFor(state, propertyId);
  const fingerprint = hash(
    JSON.stringify({ propertyId, unitIds, photoIds, title })
  );
  const prior = state.entities.documents.find(
    row => row.meta.photoGalleryRequestId === requestId
  );
  if (prior) {
    if (
      prior.meta.photoGalleryType === GROUP_DOCUMENT_TYPE &&
      prior.meta.photoGalleryFingerprint === fingerprint
    ) {
      return { state, result: prior };
    }
    throw new Error("معرف طلب مجموعة الصور مستخدم ببيانات مختلفة.");
  }

  const units = unitIds.map(unitId => {
    const unit = state.entities.units.find(row => row.id === unitId);
    if (
      !unit ||
      unit.propertyId !== property.id ||
      unit.portfolioId !== property.portfolioId
    ) {
      throw new Error("كل الوحدات المختارة يجب أن تتبع العقار والمحفظة نفسها.");
    }
    return unit;
  });

  const updated = new Map<string, DemoEntity>();
  for (const unit of units) {
    const current = parsePhotoGallery(unit.meta.photoGallery).ids;
    updated.set(unit.id, {
      ...unit,
      meta: galleryMeta(unit, mergedGalleryIds(current, photoIds)),
    });
  }

  if (
    state.entities.documents.length >= MAX_ROWS_PER_KIND ||
    entityCount(state) >= MAX_TOTAL_ROWS
  ) {
    throw new Error("لا توجد سعة لحفظ سجل مجموعة الصور.");
  }
  const document: DemoEntity = {
    id: newDocumentId(state, requestId),
    title,
    subtitle: "سجل محلي لمجموعة صور الوحدات؛ لا يحتوي ملفات أو روابط عامة.",
    portfolioId: property.portfolioId,
    propertyId: property.id,
    status: "محفوظ محليًا",
    date: new Date().toISOString().slice(0, 10),
    amountMinor: 0,
    currency: "QAR",
    meta: groupDocumentMeta(
      requestId,
      fingerprint,
      property.id,
      unitIds,
      photoIds
    ),
  };
  const next: PrototypeState = {
    ...state,
    entities: {
      ...state.entities,
      units: state.entities.units.map(unit => updated.get(unit.id) ?? unit),
      documents: [...state.entities.documents, document],
    },
  };
  return { state: ensureValid(next), result: document };
}
