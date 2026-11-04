import { useId, useRef, useState } from "react";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  addContentPreset,
  contentPresetOptions,
  MAX_CONTENT_PRESET_LENGTH,
} from "@/lib/content-presets";

export type ContentPresetPickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * A shared picker for descriptive property/unit contents. It intentionally does
 * not parse a contents label into room counts or any other numeric layout data.
 */
export function ContentPresetPicker({
  label,
  value,
  onChange,
  disabled = false,
}: ContentPresetPickerProps) {
  const { state, identity, canEdit, commitTransition } = usePrototype();
  const selectId = useId();
  const customId = useId();
  const initialStorageKeyRef = useRef(identity.storageKey);
  const latestRef = useRef({
    storageKey: identity.storageKey,
    canEdit,
    role: state.settings.role,
    disabled,
  });
  latestRef.current = {
    storageKey: identity.storageKey,
    canEdit,
    role: state.settings.role,
    disabled,
  };

  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const storageBindingChanged =
    initialStorageKeyRef.current !== identity.storageKey;
  const mayEdit =
    !storageBindingChanged &&
    !disabled &&
    canEdit &&
    state.settings.role === "operator";
  const options = contentPresetOptions(state);
  const visibleOptions =
    value && !options.includes(value) ? [value, ...options] : options;

  const selectPreset = (nextValue: string) => {
    const latest = latestRef.current;
    if (initialStorageKeyRef.current !== latest.storageKey) {
      setFeedback(
        "تغيرت مساحة العمل أثناء التحرير؛ أُوقف اختيار المحتويات حتى لا تنتقل المسودة إلى هوية أخرى."
      );
      return;
    }
    if (
      latest.disabled ||
      !latest.canEdit ||
      latest.role !== "operator"
    ) {
      setFeedback("المعاينة الحالية للقراءة فقط؛ لا يمكن تغيير المحتويات.");
      return;
    }
    onChange(nextValue);
  };

  const savePreset = () => {
    const latest = latestRef.current;
    if (initialStorageKeyRef.current !== latest.storageKey) {
      setFeedback(
        "تغيرت مساحة العمل أثناء التحرير؛ أُوقف حفظ الخيار حتى لا ينتقل إلى هوية أخرى."
      );
      return;
    }
    if (
      latest.disabled ||
      !latest.canEdit ||
      latest.role !== "operator"
    ) {
      setFeedback("المعاينة الحالية للقراءة فقط؛ لا يمكن حفظ خيار جديد.");
      return;
    }
    try {
      const transition = commitTransition(current =>
        addContentPreset(current, draft)
      );
      onChange(transition.value);
      setDraft("");
      setFeedback(transition.message);
    } catch (caught) {
      setFeedback(
        caught instanceof Error ? caught.message : "تعذر حفظ خيار المحتويات."
      );
    }
  };

  return (
    <div className="content-preset-picker">
      <label className="form-label" htmlFor={selectId}>
        <span>{label}</span>
        <select
          id={selectId}
          className="field"
          value={value}
          disabled={!mayEdit}
          onChange={event => selectPreset(event.target.value)}
        >
          <option value="">اختر المحتويات أو التوزيع</option>
          {visibleOptions.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="form-grid">
        <label className="form-label" htmlFor={customId}>
          <span>خيار محتويات جديد</span>
          <input
            id={customId}
            className="field"
            type="text"
            value={draft}
            maxLength={MAX_CONTENT_PRESET_LENGTH}
            disabled={!mayEdit}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </label>
        <div>
          <button
            className="btn-secondary"
            type="button"
            disabled={!mayEdit}
            onClick={savePreset}
          >
            إضافة وحفظ الخيار
          </button>
        </div>
      </div>

      {feedback && (
        <p
          className="muted small"
          role={feedback.includes("تعذر") || feedback.includes("أدخل") ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback}
        </p>
      )}
      <p className="muted small">
        يُعاد استخدام الخيار المحفوظ داخل مساحة العمل الحالية. يحتفظ به هذا
        المتصفح محليًا فقط، ما لم تكن اللقطة الحالية قد حُفظت عبر الحفظ السحابي
        الاختياري؛ وقد يزيله مسح بيانات المتصفح. اختيار الخيار أو حفظه هنا لا
        يحفظ العقار أو الوحدة حتى تضغط إجراء الحفظ المعتاد في النموذج.
      </p>
    </div>
  );
}

export default ContentPresetPicker;
