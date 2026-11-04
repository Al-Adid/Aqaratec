import { ChangeEvent, useRef, useState } from "react";
import {
  Download,
  FolderPlus,
  HardDriveDownload,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { validatePrototypeState } from "@shared/prototype-validation";
import type { PrototypeState } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";

function downloadJson(filename: string, contents: string) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type ImportPreview = {
  snapshot: PrototypeState;
  totalRows: number;
  portfolios: number;
  auditRows: number;
};

function makePreview(snapshot: PrototypeState): ImportPreview {
  return {
    snapshot,
    totalRows: Object.values(snapshot.entities).reduce(
      (total, rows) => total + rows.length,
      0
    ),
    portfolios: snapshot.entities.portfolios.length,
    auditRows: snapshot.audit.length,
  };
}

/** Compact controls designed to live inside the existing cloud popover. */
export function WorkspaceStorageControls() {
  const {
    storage,
    exportWorkspace,
    exportRecoveryRaw,
    repairLocalWorkspace,
    retryLocalPersistence,
    createSeparateLocalWorkspace,
    restoreExportToNewWorkspace,
    loadLatestLocalWorkspace,
  } = usePrototype();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [restoring, setRestoring] = useState(false);

  const exportCurrent = () => {
    downloadJson("sunnaa-prototype-local-export.json", exportWorkspace());
    toast.success("جُهزت نسخة JSON من الحالة الموجودة في الذاكرة");
  };
  const exportRecovery = () => {
    const raw = exportRecoveryRaw();
    if (!raw) {
      toast.error("لا توجد نسخة خام متاحة للتصدير في هذا المتصفح");
      return;
    }
    downloadJson("sunnaa-prototype-recovery.json", raw);
    toast.success("جُهزت النسخة الخام للاسترداد أو الفحص");
  };
  const repair = async () => {
    if (
      !window.confirm(
        "سيُحفظ النص الأصلي في نسخة الاسترداد ثم تبدأ بيانات تجريبية جديدة في هذه المساحة. هل تريد المتابعة؟"
      )
    )
      return;
    if (await repairLocalWorkspace())
      toast.success("فُتحت بيانات تجريبية جديدة في هذه المساحة");
  };
  const separate = () => {
    if (
      !window.confirm(
        "سيُنشأ مفتاح محلي منفصل ولن تُستبدل النسخة الحالية. هل تريد المتابعة؟"
      )
    )
      return;
    if (createSeparateLocalWorkspace())
      toast.success("فُتحت مساحة محلية منفصلة ومحفوظ اختيارها لهويتك فقط");
    else toast.error("تعذر إنشاء مساحة محلية منفصلة؛ بقيت المساحة الحالية دون تغيير");
  };
  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const validation = validatePrototypeState(parsed);
      if (!validation.success) {
        toast.error(`ملف JSON غير صالح: ${validation.message}`);
        return;
      }
      setPreview(makePreview(validation.data));
      toast.success("اكتمل التحقق الأولي. راجع المعاينة ثم أكّد الاستعادة.");
    } catch (error) {
      toast.error(
        `تعذر قراءة ملف JSON: ${error instanceof Error ? error.message : "تنسيق غير صالح"}`
      );
    }
  };
  const restorePreview = async () => {
    if (!preview || restoring) return;
    if (
      !window.confirm(
        "ستُحفظ هذه النسخة الموثقة في مساحة محلية جديدة فقط. لن تتغير المساحة الحالية أو معرفاتها. هل تريد المتابعة؟"
      )
    )
      return;
    setRestoring(true);
    try {
      if (await restoreExportToNewWorkspace(preview.snapshot)) {
        toast.success("استُعيدت النسخة في مساحة جديدة؛ بقيت المساحة السابقة دون تغيير.");
        setPreview(null);
      } else {
        toast.error("تعذر إنشاء مساحة الاستعادة؛ لم تتغير المساحة الحالية.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر استعادة نسخة التصدير"
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="cloud-storage-status" role="status">
      {storage.kind !== "ready" && <p className="muted small">{storage.message}</p>}
      <p className="muted small">
        التصدير والاستعادة محليان. الاستعادة تتحقق من الملف ثم تنشئ مساحة جديدة؛ لا
        تدمج أو تستبدل المساحة الحالية.
      </p>
      <div className="cloud-buttons">
        <button className="btn-secondary" onClick={exportCurrent}>
          <Download size={14} />
          تصدير JSON
        </button>
        <button
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={storage.kind === "identity-pending" || restoring}
        >
          <Upload size={14} />
          اختيار ملف استعادة
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="اختيار ملف JSON للاستعادة في مساحة جديدة"
          onChange={event => void readImport(event)}
        />
        {storage.hasRawRecovery && (
          <button className="btn-secondary" onClick={exportRecovery}>
            <HardDriveDownload size={14} />
            تصدير النسخة الخام
          </button>
        )}
        {storage.kind === "external-change" && (
          <button
            className="btn-secondary"
            onClick={async () => {
              if (
                window.confirm(
                  "سيُنشئ التطبيق نسخة محلية احتياطية من حالتك الحالية ثم يحمّل النسخة الأحدث من التخزين. هل تريد المتابعة؟"
                ) &&
                (await loadLatestLocalWorkspace())
              )
                toast.success("حُمّلت النسخة المحلية الأحدث بعد حفظ نسخة احتياطية");
            }}
          >
            <RefreshCw size={14} />
            تحميل النسخة المحلية الأحدث
          </button>
        )}
        {storage.kind === "memory-only" && (
          <button
            className="btn-secondary"
            onClick={async () => {
              if (await retryLocalPersistence()) toast.success("اكتمل الحفظ المحلي");
            }}
          >
            <RefreshCw size={14} />
            محاولة الحفظ المحلي
          </button>
        )}
        {(storage.kind === "recovery-required" ||
          storage.kind === "legacy-warning") && (
          <button className="btn-secondary" onClick={() => void repair()}>
            <RefreshCw size={14} />
            إصلاح صريح ببيانات تجريبية جديدة
          </button>
        )}
        <button className="btn-secondary" onClick={separate}>
          <FolderPlus size={14} />
          مساحة محلية منفصلة
        </button>
      </div>
      {preview && (
        <div className="cloud-storage-status" role="alert">
          <p className="muted small">
            معاينة الاستعادة: {preview.totalRows} سجلًا في {preview.portfolios} محافظ،
            و{preview.auditRows} حدث تدقيق. ستبقى المعرفات والعلاقات والأرصدة كما هي في
            الملف المتحقق منه.
          </p>
          <div className="cloud-buttons">
            <button
              className="btn-primary"
              onClick={() => void restorePreview()}
              disabled={restoring}
            >
              <Upload size={14} />
              {restoring ? "جارٍ إنشاء مساحة الاستعادة…" : "تأكيد الاستعادة في مساحة جديدة"}
            </button>
            <button className="btn-secondary" onClick={() => setPreview(null)} disabled={restoring}>
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
