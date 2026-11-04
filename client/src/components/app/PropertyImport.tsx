import { useMemo, useState } from "react";
import { Upload, Download } from "lucide-react";
import { toast } from "sonner";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  IMPORT_FIELDS,
  parseDelimited,
  previewPropertyImport,
  preflightXlsx,
} from "@/lib/property-import";
import { makePropertyDraft } from "@/lib/property-fields";
import { PROTOTYPE_DATE } from "@shared/prototype";

function generateImportRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `rental-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PropertyImport({
  onImport,
  onImportRentalProperties,
}: {
  /** Legacy compatibility for existing isolated UI consumers. */
  onImport?: (values: Record<string, string>) => void;
  /** Production path: validates and commits the selected rows atomically. */
  onImportRentalProperties?: (
    rows: Array<Record<string, string>>,
    requestId: string
  ) => void;
}) {
  const { state, canEdit } = usePrototype();
  const [headers, setHeaders] = useState<string[]>([]),
    [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [portfolioId, setPortfolioId] = useState(
    state.settings.portfolioId === "all" ? "" : state.settings.portfolioId
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [importRequestId, setImportRequestId] = useState("");
  const preview = useMemo(
    () =>
      previewPropertyImport(
        rows,
        mapping,
        state.entities.properties
          .filter(p => p.portfolioId === portfolioId)
          .map(p => p.title),
        Number(PROTOTYPE_DATE.slice(0, 4))
      ),
    [rows, mapping, state.entities.properties, portfolioId]
  );
  const valid = preview.filter(p => !p.errors.length && selected.has(p.index));
  const template = () => {
    const csv =
      "\uFEFFاسم العقار,نوع العقار,سنة البناء,عدد الوحدات,طريقة التأجير,رقم العقار,رقم الكهرباء,المنطقة,حساب التحصيل\r\nعقار مثال,فيلا,2020,1,whole,0001,00129,الدوحة,حساب إيجار تجريبي\r\n";
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "قالب-العقارات.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const read = async (file: File) => {
    setError("");
    setMessage("");
    setBusy(true);
    setRows([]);
    setHeaders([]);
    setImportRequestId("");
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("الحد الأقصى للملف اثنان ميغابايت");
      let matrix: string[][] = [];
      if (/\.xlsx$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        preflightXlsx(buffer);
        const { Workbook } = await import("exceljs");
        const workbook = new Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("لا توجد ورقة بيانات");
        if (sheet.rowCount > 51 || sheet.columnCount > 30)
          throw new Error(
            "تدعم هذه التجربة خمسين صفًا وثلاثين عمودًا في الورقة الأولى"
          );
        sheet.eachRow({ includeEmpty: false }, row => {
          const cells: string[] = [];
          for (let i = 1; i <= sheet.columnCount; i++) {
            const v = row.getCell(i).value;
            if (
              v &&
              typeof v === "object" &&
              ("formula" in v || "sharedFormula" in v)
            )
              cells.push("[معادلة]");
            else if (v && typeof v === "object" && "richText" in v)
              cells.push(v.richText.map(x => x.text).join(""));
            else if (v && typeof v === "object" && "text" in v)
              cells.push(String(v.text));
            else if (v instanceof Date)
              cells.push(v.toISOString().slice(0, 10));
            else cells.push(v == null ? "" : String(v));
          }
          matrix.push(cells);
        });
      } else if (/\.(csv|tsv)$/i.test(file.name)) {
        const text = (await file.text()).replace(/^\uFEFF/, "");
        matrix = parseDelimited(
          text,
          /\.tsv$/i.test(file.name)
            ? "\t"
            : text.split(/\r?\n/)[0].includes(";")
              ? ";"
              : ","
        );
      } else
        throw new Error(
          "اختر ملف XLSX أو CSV أو TSV؛ ملفات الماكرو غير مدعومة"
        );
      if (matrix.length < 2)
        throw new Error("أضف صف بيانات بعد صف أسماء الأعمدة");
      if (matrix.length > 51 || matrix.some(r => r.length > 30))
        throw new Error("حد التجربة خمسون صفًا وثلاثون عمودًا");
      const head = matrix[0].map(s => s.trim());
      setHeaders(head);
      setRows(matrix.slice(1));
      const map: Record<string, number> = {};
      for (const field of IMPORT_FIELDS)
        map[field.key] = head.findIndex(h =>
          field.aliases.some(a => a.toLowerCase() === h.toLowerCase())
        );
      setMapping(map);
      setSelected(new Set(matrix.slice(1).map((_, i) => i + 2)));
      setImportRequestId(generateImportRequestId());
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر قراءة الملف");
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    setError("");
    if (!canEdit) return;
    try {
      if (!state.entities.portfolios.some(p => p.id === portfolioId))
        throw new Error("اختر المحفظة التي ستستقبل السجلات");
      if (!valid.length) throw new Error("لا توجد صفوف صحيحة محددة للحفظ");
      // Validate the complete selected batch before invoking the first state
      // transition. This keeps an invalid row from partially importing earlier
      // rows and shares the exact creation rules with the manual dialog.
      const drafts = valid.map(row =>
        makePropertyDraft(
          { ...row.values, portfolioId, inputMethod: "Excel" },
          { requireInputMethod: true, referenceDate: PROTOTYPE_DATE }
        )
      );
      // Preserve a retryable batch identity. The atomic context operation does
      // the matching in-memory preflight again before its single state commit.
      const requestId = importRequestId || generateImportRequestId();
      if (!importRequestId) setImportRequestId(requestId);
      const importRows = valid.map(row => ({
        ...row.values,
        portfolioId,
        inputMethod: "Excel",
      }));
      if (onImportRentalProperties) {
        onImportRentalProperties(importRows, requestId);
      } else if (onImport) {
        // This branch is retained only for the pre-existing isolated component
        // test. The application property page always supplies the atomic batch
        // operation above.
        importRows.forEach(onImport);
      } else {
        throw new Error("معالج استيراد العقارات غير متاح");
      }
      setMessage(
        `أضيف ${drafts.length} عقارات مع وحداتها إلى المحفظة المختارة. لم نغيّر سجلًا موجودًا.`
      );
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الاستيراد");
      toast.error("راجع صفوف الملف قبل الحفظ");
    }
  };
  return (
    <details className="import-details">
      <summary>استيراد من الإكسل</summary>
      <div className="section-stack" style={{ paddingTop: 16 }}>
        <p className="muted small">
          يقرأ الملف داخل متصفحك فقط، ولا يرفعه لخدمة خارجية. معاينة وتصحيح قبل
          الإضافة؛ لا استبدال أو حذف لسجلاتك.
        </p>
        <div className="button-row">
          <button className="btn-secondary" onClick={template}>
            <Download size={16} /> تنزيل قالب يفتح في الإكسل
          </button>
          <label className="btn-secondary file-pick">
            <Upload size={16} />
            {busy ? "جارٍ القراءة…" : "اختر ملفًا"}
            <input
              aria-label="ملف إكسل للعقارات"
              type="file"
              accept=".xlsx,.csv,.tsv"
              disabled={!canEdit || busy}
              className="file-pick__input"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void read(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="badge badge-red">
            {error}
          </p>
        )}
        {headers.length > 0 && (
          <>
            <label>
              المحفظة التي تستقبل الملف
              <select
                className="field"
                value={portfolioId}
                onChange={e => setPortfolioId(e.target.value)}
              >
                <option value="">اختر المحفظة</option>
                {state.entities.portfolios.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              {IMPORT_FIELDS.map(field => (
                <label key={field.key}>
                  {field.label}
                  <select
                    className="field"
                    value={mapping[field.key] ?? -1}
                    onChange={e =>
                      setMapping(p => ({
                        ...p,
                        [field.key]: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={-1}>لم أحدد العمود</option>
                    {headers.map((h, i) => (
                      <option value={i} key={i}>
                        {h || `عمود ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="muted small">
              {preview.length} صفوف · {valid.length} صحيحة ومحددة. يمكنك تعديل
              الخلايا في المعاينة أو استبعاد الصف قبل الاعتماد.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>اختيار</th>
                    {IMPORT_FIELDS.map(f => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                    <th>الفحص</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map(row => (
                    <tr key={row.index}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`اختيار صف ${row.index}`}
                          checked={selected.has(row.index)}
                          onChange={e =>
                            setSelected(p => {
                              const n = new Set(p);
                              e.target.checked
                                ? n.add(row.index)
                                : n.delete(row.index);
                              return n;
                            })
                          }
                        />
                      </td>
                      {IMPORT_FIELDS.map(field => (
                        <td key={field.key}>
                          <input
                            className="field"
                            aria-label={`${field.label} صف ${row.index}`}
                            style={{ minWidth: 110 }}
                            value={row.values[field.key]}
                            disabled={(mapping[field.key] ?? -1) < 0}
                            onChange={e =>
                              setRows(p =>
                                p.map((cells, i) => {
                                  if (i !== row.index - 2) return cells;
                                  const next = [...cells];
                                  next[mapping[field.key]] = e.target.value;
                                  return next;
                                })
                              )
                            }
                          />
                        </td>
                      ))}
                      <td>
                        {row.errors.length ? row.errors.join(" • ") : "صحيح"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="button-row">
              <button
                className="btn-primary"
                disabled={!canEdit || !valid.length || !portfolioId}
                onClick={save}
              >
                اعتماد وإضافة {valid.length} عقارات
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setRows([]);
                  setHeaders([]);
                  setMessage("");
                  setImportRequestId("");
                }}
              >
                إلغاء الملف
              </button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
