import { z } from "zod";
import {
  ENTITY_KINDS,
  MAX_CONTENT_PRESET_LENGTH,
  MAX_CONTENT_PRESETS,
  type EntityKind,
  type PrototypeState,
} from "./prototype";
import { validScenarioDate } from "./prototype-clock";

/**
 * Snapshot contract shared by the in-browser prototype and the protected tRPC
 * endpoint. Keep this module browser-safe: it deliberately uses TextEncoder,
 * not Node's Buffer, for the serialized JSON limit.
 */
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_ENTITY_ROWS_PER_KIND = 500;
export const MAX_TOTAL_ENTITY_ROWS = 2_000;
export const MAX_AUDIT_ROWS = 500;
export const MAX_ID_LENGTH = 128;
export const MAX_TITLE_LENGTH = 256;
export const MAX_TEXT_LENGTH = 1_024;
export const MAX_DATE_LENGTH = 64;
export const MAX_META_ENTRIES = 32;
export const MAX_META_KEY_LENGTH = 64;
export const MAX_META_NUMBER = 1_000_000_000_000;
export const MAX_AMOUNT_MINOR = Number.MAX_SAFE_INTEGER;

const boundedString = (max: number) => z.string().max(max);

export const metaValueSchema = z.union([
  boundedString(MAX_TEXT_LENGTH),
  z.number().finite().min(-MAX_META_NUMBER).max(MAX_META_NUMBER),
  z.boolean(),
]);

export const metaSchema = z
  .record(boundedString(MAX_META_KEY_LENGTH).min(1), metaValueSchema)
  .superRefine((meta, ctx) => {
    if (Object.keys(meta).length > MAX_META_ENTRIES) {
      ctx.addIssue({
        code: "custom",
        message: `meta may contain at most ${MAX_META_ENTRIES} entries`,
      });
    }
  });

export const demoEntitySchema = z
  .object({
    id: boundedString(MAX_ID_LENGTH).min(1),
    title: boundedString(MAX_TITLE_LENGTH).min(1),
    subtitle: boundedString(MAX_TEXT_LENGTH),
    portfolioId: boundedString(MAX_ID_LENGTH),
    propertyId: boundedString(MAX_ID_LENGTH),
    status: boundedString(MAX_ID_LENGTH),
    date: boundedString(MAX_DATE_LENGTH),
    // Zero is valid for non-monetary demo entities, matching shared isMinorAmount.
    amountMinor: z.number().int().nonnegative().max(MAX_AMOUNT_MINOR),
    currency: z.literal("QAR"),
    meta: metaSchema,
  })
  .strict();

const entitySchemas = Object.fromEntries(
  ENTITY_KINDS.map(kind => [
    kind,
    z.array(demoEntitySchema).max(MAX_ENTITY_ROWS_PER_KIND),
  ])
) as Record<EntityKind, z.ZodArray<typeof demoEntitySchema>>;

export const entityMapSchema = z.object(entitySchemas).strict();

export const auditEventSchema = z
  .object({
    id: boundedString(MAX_ID_LENGTH).min(1),
    at: boundedString(MAX_DATE_LENGTH).min(1),
    title: boundedString(MAX_TITLE_LENGTH).min(1),
    detail: boundedString(MAX_TEXT_LENGTH),
  })
  .strict();

// The dashboard month picker supports valid year/month values, not arbitrary text.
export const prototypePeriodSchema = z.union([
  z.enum(["all", "month", "quarter", "year"]),
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
]);

/**
 * A preset is persisted inside the workspace snapshot, never in a separate
 * browser-global key. Trimming here normalizes valid JSON before it enters the
 * app while the refinement still rejects blank or repeated saved choices.
 */
export const contentPresetSchema = z
  .string()
  .trim()
  .min(1, "خيار المحتويات لا يمكن أن يكون فارغًا")
  .max(
    MAX_CONTENT_PRESET_LENGTH,
    `خيار المحتويات لا يتجاوز ${MAX_CONTENT_PRESET_LENGTH} حرفًا`
  );

export const contentPresetsSchema = z
  .array(contentPresetSchema)
  .max(
    MAX_CONTENT_PRESETS,
    `يمكن حفظ ${MAX_CONTENT_PRESETS} خيار محتويات كحد أقصى`
  )
  .superRefine((presets, ctx) => {
    const seen = new Set<string>();
    for (const preset of presets) {
      if (seen.has(preset)) {
        ctx.addIssue({
          code: "custom",
          message: "لا يمكن حفظ خيار محتويات مكرر",
        });
        return;
      }
      seen.add(preset);
    }
  });

/** Returns the UTF-8 size of exactly the JSON body stored/transmitted. */
export function serializedPrototypeBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export const prototypeStateSchema = z
  .object({
    version: z.literal(1),
    entities: entityMapSchema,
    audit: z.array(auditEventSchema).max(MAX_AUDIT_ROWS),
    settings: z
      .object({
        role: z.enum(["operator", "owner", "tenant", "vendor"]),
        portfolioId: boundedString(MAX_ID_LENGTH),
        period: prototypePeriodSchema,
        language: z.enum(["ar", "en"]),
        scenarioDate: z
          .string()
          .refine(validScenarioDate, "تاريخ السيناريو غير صالح")
          .optional(),
        contentPresets: contentPresetsSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const totalRows = ENTITY_KINDS.reduce(
      (total, kind) => total + state.entities[kind].length,
      0
    );
    if (totalRows > MAX_TOTAL_ENTITY_ROWS) {
      ctx.addIssue({
        code: "custom",
        message: `snapshot may contain at most ${MAX_TOTAL_ENTITY_ROWS} entity rows`,
      });
    }

    if (serializedPrototypeBytes(state) > MAX_SNAPSHOT_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "snapshot must not exceed 512 KiB when serialized as JSON",
      });
    }
  });

export type ValidatedPrototypeState = z.infer<typeof prototypeStateSchema>;

export type PrototypeValidation =
  | { success: true; data: PrototypeState }
  | { success: false; message: string; issues: readonly z.core.$ZodIssue[] };

/**
 * A small, UI-safe validation result. The original Zod schema remains exported
 * for tRPC input validation and detailed test assertions.
 */
export function validatePrototypeState(value: unknown): PrototypeValidation {
  const result = prototypeStateSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data as PrototypeState };
  }
  return {
    success: false,
    message: result.error.issues[0]?.message ?? "لقطة البروتوتايب غير صالحة",
    issues: result.error.issues,
  };
}

export function assertPrototypeState(value: unknown): PrototypeState {
  const result = validatePrototypeState(value);
  if (!result.success)
    throw new Error(`لقطة البروتوتايب غير صالحة: ${result.message}`);
  return result.data;
}
