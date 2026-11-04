import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { BRAND_ASSETS, money } from "@shared/prototype";
import type {
  BillingKind,
  BillingReceiptView,
  BillingView,
} from "@shared/billing-types";
import "./BillingDocumentPreview.css";

export interface BillingDocumentPreviewProps {
  view: BillingView;
  receipt?: BillingReceiptView;
  onClose: () => void;
}

const DOCUMENT_KIND_LABELS: Record<BillingKind, string> = {
  invoice: "فاتورة",
  "payment-request": "مطالبة بالدفع",
  lpo: "أمر شراء LPO",
};

const DOCUMENT_DISCLAIMER =
  "نموذج تجريبي، غير معتمد للاستخدام المالي أو الضريبي";

function formatMoney(value: number) {
  return Number.isFinite(value) ? money(value) : "-";
}

function DataItem({
  label,
  value,
  number = false,
}: {
  label: string;
  value: string;
  number?: boolean;
}) {
  return (
    <div className="billing-document-preview-data-item">
      <dt>{label}</dt>
      <dd className={number ? "billing-document-preview-number" : undefined}>
        {value || "-"}
      </dd>
    </div>
  );
}

function PrototypeFooter() {
  return (
    <footer className="billing-document-preview-prototype-footer">
      <strong>{DOCUMENT_DISCLAIMER}</strong>
      <span>
        هذا المستند صادر ضمن نموذج تجريبي، وليس فاتورة ضريبية أو سجلاً حكوميًا
        أو إثباتًا للدفع.
      </span>
    </footer>
  );
}

function DocumentHeader({ title, number }: { title: string; number: string }) {
  return (
    <header className="billing-document-preview-header">
      <div className="billing-document-preview-brand">
        <img src={BRAND_ASSETS.icon} alt="رمز صُنّاع الفرص" />
        <div>
          <strong>صُنّاع الفرص</strong>
          <span>إدارة واعية. نمو مدروس.</span>
        </div>
      </div>
      <div className="billing-document-preview-document-name">
        <span>{title}</span>
        <bdi className="billing-document-preview-number">{number || "-"}</bdi>
      </div>
    </header>
  );
}

function DocumentPreview({ view }: { view: BillingView }) {
  const isLpo = view.kind === "lpo";
  const purchaseRequest = String(
    view.document.meta.purchaseRequest ??
      view.document.meta.purchaseRequestNumber ??
      view.document.meta.requestNumber ??
      ""
  );

  return (
    <>
      <DocumentHeader
        title={DOCUMENT_KIND_LABELS[view.kind]}
        number={view.number}
      />

      <section className="billing-document-preview-summary">
        <div>
          <span>الجهة المصدرة</span>
          <strong>{view.issuerName || "-"}</strong>
        </div>
        <div>
          <span>{isLpo ? "المورّد" : "الطرف"}</span>
          <strong>{view.partyName || "-"}</strong>
        </div>
        <div>
          <span>الحالة</span>
          <strong>{view.status || "-"}</strong>
        </div>
      </section>

      <dl className="billing-document-preview-data-grid">
        <DataItem label="رقم المستند" value={view.number} number />
        <DataItem label="تاريخ الإصدار" value={view.issueDate} number />
        <DataItem label="تاريخ الاستحقاق" value={view.dueDate} number />
        <DataItem label="العقار" value={view.propertyTitle} />
        <DataItem label="الوحدة" value={view.unitTitle} />
        <DataItem label="عقد الإيجار" value={view.leaseTitle} />
        {isLpo && (
          <DataItem label="طلب الشراء" value={purchaseRequest || "-"} number />
        )}
      </dl>

      <section
        className="billing-document-preview-lines-section"
        aria-label="بنود المستند"
      >
        <h3>البنود</h3>
        <div className="billing-document-preview-table-wrap">
          <table className="billing-document-preview-table">
            <thead>
              <tr>
                <th scope="col">الوصف</th>
                <th scope="col">الكمية</th>
                <th scope="col">سعر الوحدة</th>
                <th scope="col">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.length ? (
                view.lines.map((line, index) => (
                  <tr key={`${line.description}-${index}`}>
                    <td>{line.description || "-"}</td>
                    <td className="billing-document-preview-number">
                      {Number.isFinite(line.quantity) ? line.quantity : "-"}
                    </td>
                    <td className="billing-document-preview-number">
                      {formatMoney(line.unitPriceMinor)}
                    </td>
                    <td className="billing-document-preview-number">
                      {formatMoney(line.quantity * line.unitPriceMinor)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="billing-document-preview-empty-line"
                  >
                    لا توجد بنود مسجلة في هذا النموذج.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="billing-document-preview-totals"
        aria-label="ملخص المبالغ"
      >
        <dl>
          <div>
            <dt>إجمالي البنود</dt>
            <dd>{formatMoney(view.totals.subtotalMinor)}</dd>
          </div>
          <div>
            <dt>الرسوم</dt>
            <dd>{formatMoney(view.totals.feeMinor)}</dd>
          </div>
          <div>
            <dt>الخصم</dt>
            <dd>{formatMoney(view.totals.discountMinor)}</dd>
          </div>
          <div className="billing-document-preview-total-row">
            <dt>إجمالي المستند</dt>
            <dd>{formatMoney(view.totals.totalMinor)}</dd>
          </div>
        </dl>
      </section>

      {!isLpo && (
        <section
          className="billing-document-preview-settlement"
          aria-label="حالة التسوية"
        >
          <h3>حالة التحصيل</h3>
          <div>
            <span>
              <small>المؤكد تحصيله</small>
              <strong>{formatMoney(view.collectedMinor)}</strong>
            </span>
            <span>
              <small>خسارة مسجلة</small>
              <strong>{formatMoney(view.lossMinor)}</strong>
            </span>
            <span>
              <small>المتبقي</small>
              <strong>{formatMoney(view.remainingMinor)}</strong>
            </span>
          </div>
        </section>
      )}

      {view.notes && (
        <section
          className="billing-document-preview-notes"
          aria-label="ملاحظات"
        >
          <h3>ملاحظات</h3>
          <p>{view.notes}</p>
        </section>
      )}

      <PrototypeFooter />
    </>
  );
}

function ReceiptPreview({
  view,
  receipt,
}: {
  view: BillingView;
  receipt: BillingReceiptView;
}) {
  return (
    <>
      <DocumentHeader title="سند قبض RCP" number={receipt.number} />

      <section className="billing-document-preview-summary">
        <div>
          <span>الجهة المصدرة</span>
          <strong>{receipt.issuerName || view.issuerName || "-"}</strong>
        </div>
        <div>
          <span>الطرف</span>
          <strong>{receipt.partyName || view.partyName || "-"}</strong>
        </div>
        <div>
          <span>طريقة الدفع</span>
          <strong>{receipt.method || "-"}</strong>
        </div>
      </section>

      <dl className="billing-document-preview-data-grid">
        <DataItem label="رقم الإيصال RCP" value={receipt.number} number />
        <DataItem
          label="المستند المرتبط"
          value={receipt.documentNumber}
          number
        />
        <DataItem label="تاريخ التحصيل" value={receipt.date} number />
        <DataItem label="العقار" value={receipt.propertyTitle} />
        <DataItem label="الوحدة" value={receipt.unitTitle} />
      </dl>

      <section
        className="billing-document-preview-receipt-amounts"
        aria-label="مبالغ الإيصال"
      >
        <div>
          <span>المبلغ المحصل</span>
          <strong>{formatMoney(receipt.amountMinor)}</strong>
        </div>
        <div>
          <span>
            {receipt.balanceKind === "historical"
              ? "المتبقي بعد هذا التحصيل"
              : `الرصيد الحالي كما في ${receipt.balanceAsOf}`}
          </span>
          <strong>{formatMoney(receipt.remainingMinor)}</strong>
        </div>
      </section>

      {receipt.balanceKind === "current" && (
        <p className="muted small">
          هذا السند القديم لا يحتوي لقطة رصيد تاريخية؛ المعروض هو الرصيد الحالي
          عند إعادة المعاينة، وليس المتبقي وقت إصداره.
        </p>
      )}
      <PrototypeFooter />
    </>
  );
}

export function BillingDocumentPreview({
  view,
  receipt,
  onClose,
}: BillingDocumentPreviewProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const isReceipt = Boolean(receipt);
  const dialogTitle = isReceipt
    ? "معاينة سند القبض"
    : `معاينة ${DOCUMENT_KIND_LABELS[view.kind]}`;

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter(element => !element.hasAttribute("disabled"));

    const focusDialog = () => {
      const closeButton = dialogRef.current?.querySelector<HTMLElement>(
        "[data-billing-preview-close]"
      );
      (closeButton ?? getFocusable()[0] ?? dialogRef.current)?.focus();
    };
    focusDialog();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
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
      className="billing-document-preview-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="billing-document-preview-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        dir="rtl"
      >
        <div
          className="billing-document-preview-actions"
          aria-label="إجراءات المعاينة"
        >
          <button
            type="button"
            className="billing-document-preview-close"
            data-billing-preview-close
            onClick={onClose}
            aria-label="إغلاق المعاينة"
          >
            <X size={19} aria-hidden="true" />
            <span>إغلاق</span>
          </button>
          <button
            type="button"
            className="billing-document-preview-print"
            onClick={() => window.print()}
          >
            <Printer size={17} aria-hidden="true" />
            طباعة / حفظ PDF
          </button>
        </div>

        <div className="billing-document-preview-content">
          <span className="billing-document-preview-dialog-title" id={titleId}>
            {dialogTitle}
          </span>
          {receipt ? (
            <ReceiptPreview view={view} receipt={receipt} />
          ) : (
            <DocumentPreview view={view} />
          )}
        </div>

        <p className="billing-document-preview-safari-help">
          في Safari، اختر المشاركة ثم «طباعة» واحفظ المستند بصيغة PDF.
        </p>
      </section>
    </div>,
    document.body
  );
}
