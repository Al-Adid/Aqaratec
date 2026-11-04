import type {
  AccommodationProfile,
  ApartmentLayout,
  FurnishingStatus,
  VillaArrangement,
} from "@shared/unit-profile-types";

export const ROOM_LAYOUT_OPTIONS = [
  { value: "studio", label: "استوديو" },
  { value: "1-living", label: "غرفة وصالة" },
  { value: "2-living", label: "غرفتان وصالة" },
  { value: "3-living", label: "3 غرف وصالة" },
  { value: "4-living", label: "4 غرف وصالة" },
  { value: "5-living", label: "5 غرف وصالة" },
  { value: "custom", label: "توزيع مخصص" },
] as const satisfies readonly { value: ApartmentLayout; label: string }[];

export const ACCOMMODATION_FORM_KEYS = [
  "roomLayout",
  "bedrooms",
  "livingRooms",
  "bathrooms",
  "kitchens",
  "furnishing",
  "villaArrangement",
] as const;

const FURNISHING_STATUSES: readonly FurnishingStatus[] = [
  "furnished",
  "unfurnished",
];
const VILLA_ARRANGEMENTS: readonly VillaArrangement[] = [
  "attached",
  "detached",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDigits(value: string): string {
  return value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRoomLayout(value: unknown): value is ApartmentLayout {
  return ROOM_LAYOUT_OPTIONS.some(option => option.value === value);
}

function isFurnishing(value: unknown): value is FurnishingStatus {
  return FURNISHING_STATUSES.includes(value as FurnishingStatus);
}

function isVillaArrangement(value: unknown): value is VillaArrangement {
  return VILLA_ARRANGEMENTS.includes(value as VillaArrangement);
}

function parseFormCount(value: unknown, label: string): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = normalizeDigits(raw);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا بين 0 و20.`);
  }
  const count = Number(normalized);
  if (!Number.isSafeInteger(count) || count < 0 || count > 20) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا بين 0 و20.`);
  }
  return count;
}

function assertStoredCount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 20
  ) {
    throw new Error(`${label} غير صالح.`);
  }
  return value;
}

function validateLayoutCounts(profile: AccommodationProfile): void {
  const { roomLayout, bedrooms, livingRooms } = profile;
  if (!roomLayout) return;
  if (bedrooms === undefined || livingRooms === undefined) {
    throw new Error("حدّد عدد الغرف والصالات لتوزيع الغرف المختار.");
  }
  if (roomLayout === "studio") {
    if (bedrooms !== 0 || livingRooms !== 0) {
      throw new Error("الاستوديو لا يحتوي غرفًا أو صالة مستقلة.");
    }
    return;
  }
  if (roomLayout === "custom") return;

  const expectedBedrooms = Number(roomLayout.slice(0, 1));
  if (bedrooms !== expectedBedrooms || livingRooms !== 1) {
    throw new Error("عدد الغرف والصالات لا يطابق توزيع الغرف المختار.");
  }
}

function hasDetails(profile: AccommodationProfile): boolean {
  return Object.keys(profile).length > 0;
}

/**
 * Converts persisted accommodation facts only when every supplied key is known
 * and correctly typed. It never derives counts from a layout selection.
 */
export function parseAccommodationProfile(
  value: unknown
): AccommodationProfile | undefined {
  if (value === undefined) return undefined;
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some(
      key =>
        !ACCOMMODATION_FORM_KEYS.includes(
          key as (typeof ACCOMMODATION_FORM_KEYS)[number]
        )
    )
  ) {
    throw new Error("بيانات السكن غير صالحة.");
  }

  const profile: AccommodationProfile = {};
  if (value.roomLayout !== undefined) {
    if (!isRoomLayout(value.roomLayout))
      throw new Error("توزيع الغرف غير صالح.");
    profile.roomLayout = value.roomLayout;
  }
  for (const [key, label] of [
    ["bedrooms", "عدد الغرف"],
    ["livingRooms", "عدد الصالات"],
    ["bathrooms", "عدد الحمامات"],
    ["kitchens", "عدد المطابخ"],
  ] as const) {
    const count = assertStoredCount(value[key], label);
    if (count !== undefined) profile[key] = count;
  }
  if (value.furnishing !== undefined) {
    if (!isFurnishing(value.furnishing))
      throw new Error("حالة التأثيث غير صالحة.");
    profile.furnishing = value.furnishing;
  }
  if (value.villaArrangement !== undefined) {
    if (!isVillaArrangement(value.villaArrangement))
      throw new Error("ترتيب الفيلا غير صالح.");
    profile.villaArrangement = value.villaArrangement;
  }
  validateLayoutCounts(profile);
  return hasDetails(profile) ? profile : undefined;
}

/** Returns all form keys, preserving only explicitly saved accommodation facts. */
export function accommodationFormValues(
  profile?: AccommodationProfile
): Record<string, string> {
  return {
    roomLayout: profile?.roomLayout ?? "",
    bedrooms: profile?.bedrooms === undefined ? "" : String(profile.bedrooms),
    livingRooms:
      profile?.livingRooms === undefined ? "" : String(profile.livingRooms),
    bathrooms:
      profile?.bathrooms === undefined ? "" : String(profile.bathrooms),
    kitchens: profile?.kitchens === undefined ? "" : String(profile.kitchens),
    furnishing: profile?.furnishing ?? "",
    villaArrangement: profile?.villaArrangement ?? "",
  };
}

/** Builds optional accommodation facts from the dedicated string-only UI draft. */
export function makeAccommodationProfile(
  values: Record<string, string>
): AccommodationProfile | undefined {
  if (
    Object.keys(values).some(
      key =>
        !ACCOMMODATION_FORM_KEYS.includes(
          key as (typeof ACCOMMODATION_FORM_KEYS)[number]
        )
    )
  ) {
    throw new Error("بيانات السكن غير صالحة.");
  }

  const profile: AccommodationProfile = {};
  const roomLayout = text(values.roomLayout);
  if (roomLayout) {
    if (!isRoomLayout(roomLayout)) throw new Error("توزيع الغرف غير صالح.");
    profile.roomLayout = roomLayout;
  }
  for (const [key, label] of [
    ["bedrooms", "عدد الغرف"],
    ["livingRooms", "عدد الصالات"],
    ["bathrooms", "عدد الحمامات"],
    ["kitchens", "عدد المطابخ"],
  ] as const) {
    const count = parseFormCount(values[key], label);
    if (count !== undefined) profile[key] = count;
  }
  const furnishing = text(values.furnishing);
  if (furnishing) {
    if (!isFurnishing(furnishing)) throw new Error("حالة التأثيث غير صالحة.");
    profile.furnishing = furnishing;
  }
  const villaArrangement = text(values.villaArrangement);
  if (villaArrangement) {
    if (!isVillaArrangement(villaArrangement))
      throw new Error("ترتيب الفيلا غير صالح.");
    profile.villaArrangement = villaArrangement;
  }

  return parseAccommodationProfile(profile);
}

export function roomLayoutLabel(value: unknown): string {
  return (
    ROOM_LAYOUT_OPTIONS.find(option => option.value === value)?.label ??
    "غير محدد"
  );
}

/** A factual Arabic summary that does not invent omitted room counts. */
export function accommodationSummary(profile?: AccommodationProfile): string {
  if (!profile) return "";
  const summary: string[] = [];
  if (profile.roomLayout) summary.push(roomLayoutLabel(profile.roomLayout));
  if (profile.bedrooms !== undefined)
    summary.push(`${profile.bedrooms} غرف نوم`);
  if (profile.livingRooms !== undefined)
    summary.push(`${profile.livingRooms} صالة`);
  if (profile.bathrooms !== undefined)
    summary.push(`${profile.bathrooms} حمام`);
  if (profile.kitchens !== undefined) summary.push(`${profile.kitchens} مطبخ`);
  if (profile.furnishing === "furnished") summary.push("مفروش");
  if (profile.furnishing === "unfurnished") summary.push("غير مفروش");
  if (profile.villaArrangement === "attached") summary.push("فيلا متلاصقة");
  if (profile.villaArrangement === "detached") summary.push("فيلا منفصلة");
  return summary.join(" · ");
}
