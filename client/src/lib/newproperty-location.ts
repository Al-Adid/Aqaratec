export const MAX_PROPERTY_LOCATION_IDENTIFIER_LENGTH = 80;
export const MAX_PROPERTY_LOCATION_URL_LENGTH = 512;
export const MAX_PROPERTY_LOCATION_LENGTH = 1024;

export interface PropertyLocation {
  v: 1;
  zoneNumber?: string;
  streetNumber?: string;
  buildingNumber?: string;
  mapUrl?: string;
}

const LOCATION_KEYS = new Set([
  "v",
  "zoneNumber",
  "streetNumber",
  "buildingNumber",
  "mapUrl",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (typeof value !== "string") throw new Error(`${label} غير صالح.`);
  const result = value.trim();
  if (!result) return undefined;
  if (result.length > MAX_PROPERTY_LOCATION_IDENTIFIER_LENGTH) {
    throw new Error(
      `${label} يتجاوز ${MAX_PROPERTY_LOCATION_IDENTIFIER_LENGTH} حرفًا.`
    );
  }
  // Identifiers intentionally remain text. Do not normalize Arabic digits or
  // remove leading zeroes: they are reference values, not numeric quantities.
  return result;
}

/** Returns a persisted HTTP(S) URL only; it never fetches or embeds the URL. */
export function safePropertyLocationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") throw new Error("رابط الموقع غير صالح.");
  if (!value.trim()) return undefined;
  if (
    value !== value.trim() ||
    value.length > MAX_PROPERTY_LOCATION_URL_LENGTH
  ) {
    throw new Error("رابط الموقع غير صالح.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("رابط الموقع غير صالح.");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("رابط الموقع يجب أن يكون HTTP أو HTTPS دون بيانات دخول.");
  }
  return value;
}

function invalidLocation(): never {
  throw new Error("بيانات موقع العقار غير صالحة.");
}

/**
 * Parses only the versioned, compact location payload. Absence is deliberate:
 * old descriptive `location` text remains independent and is never inferred.
 */
export function parsePropertyLocation(raw: unknown): PropertyLocation {
  if (raw === undefined || raw === null || raw === "") return { v: 1 };
  if (typeof raw !== "string" || raw.length > MAX_PROPERTY_LOCATION_LENGTH)
    return invalidLocation();

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return invalidLocation();
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    return invalidLocation();
  const value = decoded as Record<string, unknown>;
  if (value.v !== 1 || Object.keys(value).some(key => !LOCATION_KEYS.has(key)))
    return invalidLocation();

  try {
    const zoneNumber =
      value.zoneNumber === undefined
        ? undefined
        : optionalIdentifier(value.zoneNumber, "رقم المنطقة");
    const streetNumber =
      value.streetNumber === undefined
        ? undefined
        : optionalIdentifier(value.streetNumber, "رقم الشارع");
    const buildingNumber =
      value.buildingNumber === undefined
        ? undefined
        : optionalIdentifier(value.buildingNumber, "رقم المبنى");
    const mapUrl =
      value.mapUrl === undefined
        ? undefined
        : safePropertyLocationUrl(value.mapUrl);
    return {
      v: 1,
      ...(zoneNumber ? { zoneNumber } : {}),
      ...(streetNumber ? { streetNumber } : {}),
      ...(buildingNumber ? { buildingNumber } : {}),
      ...(mapUrl ? { mapUrl } : {}),
    };
  } catch {
    return invalidLocation();
  }
}

/**
 * Builds the compact structured payload from direct form values. An entirely
 * empty group intentionally returns an empty string so callers can clear only
 * `meta.propertyLocation` without touching the historical descriptive text.
 */
export function makePropertyLocation(values: Record<string, string>): string {
  const zoneNumber = optionalIdentifier(values.zoneNumber ?? "", "رقم المنطقة");
  const streetNumber = optionalIdentifier(
    values.streetNumber ?? "",
    "رقم الشارع"
  );
  const buildingNumber = optionalIdentifier(
    values.buildingNumber ?? "",
    "رقم المبنى"
  );
  const mapUrl = safePropertyLocationUrl(values.mapUrl ?? "");
  if (!zoneNumber && !streetNumber && !buildingNumber && !mapUrl) return "";

  const serialized = JSON.stringify({
    v: 1,
    ...(zoneNumber ? { zoneNumber } : {}),
    ...(streetNumber ? { streetNumber } : {}),
    ...(buildingNumber ? { buildingNumber } : {}),
    ...(mapUrl ? { mapUrl } : {}),
  });
  // Reparse to keep builder and reader locked to the same contract.
  parsePropertyLocation(serialized);
  if (serialized.length > MAX_PROPERTY_LOCATION_LENGTH)
    throw new Error("بيانات موقع العقار تتجاوز 1024 حرفًا.");
  return serialized;
}

/** Safe direct-form value detection used by property-fields without inference. */
export function hasPropertyLocationFormFields(
  values: Record<string, string>
): boolean {
  return ["zoneNumber", "streetNumber", "buildingNumber", "mapUrl"].some(key =>
    Object.prototype.hasOwnProperty.call(values, key)
  );
}
