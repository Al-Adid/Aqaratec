import { ROOM_LAYOUT_OPTIONS } from "@/lib/room-layout";

type Values = Record<string, string>;
const COUNTS: Record<string, [string, string]> = {
  studio: ["0", "0"],
  "1-living": ["1", "1"],
  "2-living": ["2", "1"],
  "3-living": ["3", "1"],
  "4-living": ["4", "1"],
  "5-living": ["5", "1"],
};

/** Defaults preserve the unit UI; a property policy can hide non-applicable facts. */
export function RoomLayoutFields({
  values,
  onChange,
  disabled = false,
  label = "تكوين الوحدة / توزيع الشقة",
  showVillaArrangement = false,
  showRoomLayout = true,
  showFurnishing = true,
  fieldPrefix = "",
  errors = {},
}: {
  values: Values;
  onChange: (patch: Values) => void;
  disabled?: boolean;
  label?: string;
  showVillaArrangement?: boolean;
  showRoomLayout?: boolean;
  showFurnishing?: boolean;
  fieldPrefix?: string;
  errors?: Record<string, string>;
}) {
  const layout = values.roomLayout ?? values.apartmentLayout ?? "";
  const fixedCounts = !!COUNTS[layout];
  const custom = layout === "custom";
  const fieldError = (key: string) => {
    const message = errors[`${fieldPrefix}${key}`];
    return message ? (
      <small
        className="property-form-error"
        role="alert"
        id={`${fieldPrefix}${key}-error`}
      >
        {message}
      </small>
    ) : null;
  };
  const setLayout = (next: string) => {
    const patch: Values = { roomLayout: next };
    if (values.category === "apartment") patch.apartmentLayout = next;
    if (COUNTS[next]) [patch.bedrooms, patch.livingRooms] = COUNTS[next];
    onChange(patch);
  };
  return (
    <>
      {showRoomLayout && (
        <label className="form-label">
          <span>
            {label}
            {values.category === "apartment" && (
              <i className="required-mark"> *</i>
            )}
          </span>
          <select
            className="field"
            name={`${fieldPrefix}roomLayout`}
            value={layout}
            required={values.category === "apartment"}
            disabled={disabled}
            aria-invalid={!!errors[`${fieldPrefix}roomLayout`]}
            onChange={event => setLayout(event.target.value)}
          >
            <option value="">غير محدد · اختر التكوين</option>
            {ROOM_LAYOUT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small className="muted">
            الاستوديو بلا غرف أو صالة مستقلة؛ التوزيع المخصص يتيح كتابة أعدادك.
            التكوين لا يغيّر نوع الوحدة أو السعر.
          </small>
          {fieldError("roomLayout")}
        </label>
      )}
      {(
        [
          ["bedrooms", "عدد الغرف"],
          ["livingRooms", "عدد الصالات"],
          ["bathrooms", "عدد الحمامات"],
          ["kitchens", "عدد المطابخ"],
        ] as const
      )
        .filter(
          ([key]) =>
            showRoomLayout || (key !== "bedrooms" && key !== "livingRooms")
        )
        .map(([key, countLabel]) => {
          const layoutCount = key === "bedrooms" || key === "livingRooms";
          return (
            <label className="form-label" key={key}>
              <span>
                {countLabel}
                {layoutCount && custom && <i className="required-mark"> *</i>}
              </span>
              <input
                className="field"
                name={`${fieldPrefix}${key}`}
                type="text"
                inputMode="numeric"
                value={values[key] ?? ""}
                required={layoutCount && custom}
                disabled={disabled || (layoutCount && fixedCounts)}
                placeholder="غير مسجل"
                aria-invalid={!!errors[`${fieldPrefix}${key}`]}
                onChange={event => onChange({ [key]: event.target.value })}
              />
              {layoutCount && fixedCounts && (
                <small className="muted">
                  وفق التكوين المختار؛ اختر توزيعًا مخصصًا لتعديل العدد.
                </small>
              )}
              {fieldError(key)}
            </label>
          );
        })}
      {showFurnishing && (
        <label className="form-label">
          <span>التأثيث</span>
          <select
            className="field"
            name={`${fieldPrefix}furnishing`}
            value={values.furnishing ?? ""}
            disabled={disabled}
            onChange={event => onChange({ furnishing: event.target.value })}
          >
            <option value="">غير محدد</option>
            <option value="furnished">مفروشة</option>
            <option value="unfurnished">غير مفروشة</option>
          </select>
          {fieldError("furnishing")}
        </label>
      )}
      {showVillaArrangement && (
        <label className="form-label">
          <span>ترتيب الفيلا</span>
          <select
            className="field"
            name={`${fieldPrefix}villaArrangement`}
            value={values.villaArrangement ?? ""}
            disabled={disabled}
            onChange={event =>
              onChange({ villaArrangement: event.target.value })
            }
          >
            <option value="">غير محدد</option>
            <option value="attached">متلاصقة</option>
            <option value="detached">منفصلة</option>
          </select>
          {fieldError("villaArrangement")}
        </label>
      )}
    </>
  );
}
