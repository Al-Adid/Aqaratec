import {
  MAX_CONTENT_PRESET_LENGTH,
  MAX_CONTENT_PRESETS,
  type PrototypeState,
} from "@shared/prototype";

/** Always available, but deliberately not duplicated into a user's saved list. */
export const BUILT_IN_CONTENT_PRESETS = [
  "استوديو",
  "غرفة وصالة وحمام",
  "غرفتان وصالة وحمام",
  "ثلاث غرف وصالة وحمام",
  "أربع غرف وصالة وحمام",
  "خمس غرف وصالة وحمام",
] as const;

export type AddContentPresetResult = {
  kind: "added" | "existing";
  value: string;
  message: string;
};

function normalizedLabel(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("خيار المحتويات يجب أن يكون نصًا.");
  const label = value.trim();
  if (!label) throw new Error("أدخل خيار محتويات غير فارغ.");
  if (label.length > MAX_CONTENT_PRESET_LENGTH)
    throw new Error(
      `خيار المحتويات لا يتجاوز ${MAX_CONTENT_PRESET_LENGTH} حرفًا.`
    );
  return label;
}

/** Built-ins plus this workspace's custom choices, with stable first occurrence. */
export function contentPresetOptions(state: PrototypeState): string[] {
  const seen = new Set<string>();
  return [...BUILT_IN_CONTENT_PRESETS, ...(state.settings.contentPresets ?? [])]
    .map(normalizedLabel)
    .filter(label => {
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    });
}

/**
 * Operator-only, pure state transition for a custom contents label. It changes
 * no property, unit, financial, or other entity record; normal workspace
 * snapshot persistence is responsible for retaining the returned state.
 */
export function addContentPreset(
  state: PrototypeState,
  input: string
): { state: PrototypeState; result: AddContentPresetResult } {
  if (state.settings.role !== "operator")
    throw new Error("معاينة القراءة لا تسمح بحفظ خيارات محتويات جديدة.");

  const value = normalizedLabel(input);
  const saved = state.settings.contentPresets ?? [];
  const exists = contentPresetOptions(state).includes(value);
  if (exists) {
    return {
      state,
      result: {
        kind: "existing",
        value,
        message: "هذا الخيار محفوظ أو متاح بالفعل؛ لم نضف نسخة مكررة.",
      },
    };
  }
  if (saved.length >= MAX_CONTENT_PRESETS)
    throw new Error(`يمكن حفظ ${MAX_CONTENT_PRESETS} خيار محتويات كحد أقصى.`);

  return {
    state: {
      ...state,
      settings: {
        ...state.settings,
        contentPresets: [...saved, value],
      },
    },
    result: {
      kind: "added",
      value,
      message: "حُفظ الخيار في مساحة العمل الحالية ويمكنك اختياره الآن.",
    },
  };
}

export { MAX_CONTENT_PRESET_LENGTH, MAX_CONTENT_PRESETS };
