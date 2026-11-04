import type { DemoEntity, PrototypeState } from "./prototype";

export interface PhotoGalleryManifest {
  v: 1;
  ids: string[];
}
export type PhotoGalleryTargetKind = "properties" | "units";
export const MAX_GALLERY_PHOTOS = 20;
export const MAX_PHOTO_GROUP_UNITS = 50;
export interface AssignUnitPhotoGroupInput {
  requestId: string;
  propertyId: string;
  unitIds: string[];
  photoIds: string[];
  title?: string;
}
export type PhotoGalleryTransition = {
  state: PrototypeState;
  result: DemoEntity;
};
