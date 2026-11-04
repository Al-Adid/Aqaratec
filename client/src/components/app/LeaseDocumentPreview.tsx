import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, Printer, X } from "lucide-react";
import type { TemplateLeaseView } from "@shared/lease-template-types";
import "./LeaseDocumentPreview.css";

export interface LeaseDocumentPreviewProps {
  view: TemplateLeaseView;
  onClose: () => void;
}

const PRINT_FOOTER = "مسودة تجريبية · غير موقعة وغير مسجلة";

function completedContent(view: TemplateLeaseView): string {
  const values: Record<string, string> = {
    الاسم: view.tenantName,
    رقم_العقار: view.propertyNumber,
    رقم_الكهرباء: view.electricityNumber,
    نوع_العقار: view.propertyType,
  };
  return view.content.replace(/\{\{(الاسم|رقم_العقار|رقم_الكهرباء|نوع_العقار)\}\}/g, (_token, key) => values[key] ?? "");
}

function safeFilePart(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return normalized.slice(0, 70) || "مسودة-عقد";
}

function downloadText(view: TemplateLeaseView, content: string) {
  const name = safeFilePart(view.lease.title || view.templateName);
  const blob = new Blob(["\ufeff", content], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="lease-document-preview__data-item">
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

export function LeaseDocumentPreview({
  view,
  onClose,
}: LeaseDocumentPreviewProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const content = useMemo(() => completedContent(view), [view]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));
    const focusDialog = () => {
      const close = dialogRef.current?.querySelector<HTMLElement>(
        "[data-lease-preview-close]"
      );
      (close ?? focusable()[0] ?? dialogRef.current)?.focus();
    };
    focusDialog();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="lease-document-preview-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="lease-document-preview-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        dir="rtl"
      >
        <div
          className="lease-document-preview-actions"
          aria-label="إجراءات معاينة المسودة"
        >
          <button
            type="button"
            className="lease-document-preview-close"
            data-lease-preview-close
            onClick={onClose}
            aria-label="إغلاق معاينة العقد"
          >
            <X size={19} aria-hidden="true" />
            <span>إغلاق</span>
          </button>
          <div>
            <button
              type="button"
              className="lease-document-preview-text"
              onClick={() => downloadText(view, content)}
            >
              <Download size={17} aria-hidden="true" /> تنزيل TXT
            </button>
            <button
              type="button"
              className="lease-document-preview-print"
              onClick={() => window.print()}
            >
              <Printer size={17} aria-hidden="true" /> طباعة / حفظ PDF عبر المتصفح
            </button>
          </div>
        </div>

        <article className="lease-document-preview-content">
          <header className="lease-document-preview-header">
            <div>
              <span>مسودة عقد إيجار</span>
              <h2 id={titleId}>{view.lease.title || "مسودة عقد"}</h2>
            </div>
            <div className="lease-document-preview-version">
              <span>القالب</span>
              <strong>{view.templateName || "-"}</strong>
              <small>إصدار {view.templateVersion || "-"}</small>
            </div>
          </header>

          <dl className="lease-document-preview-data-grid">
            <DataItem label="المستأجر" value={view.tenantName} />
            <DataItem label="العقار" value={view.propertyNumber} />
            <DataItem label="رقم الكهرباء" value={view.electricityNumber} />
            <DataItem label="نوع العقار" value={view.propertyType} />
            <DataItem label="نطاق الإيجار" value={view.rentalMode === "whole" ? "العقار كاملاً" : view.unitTitle} />
            <DataItem label="حالة المسودة" value={view.lease.status || "مسودة"} />
          </dl>

          <section
            className="lease-document-preview-text-body"
            aria-label="نص مسودة العقد"
          >
            <pre>{content}</pre>
          </section>

          <footer className="lease-document-preview-footer">
            <strong>{PRINT_FOOTER}</strong>
            <span>
              التوقيع والإجراءات الحكومية وخطوات التسجيل منفصلة عن هذه المسودة.
            </span>
          </footer>
        </article>
      </section>
    </div>,
    document.body
  );
}
