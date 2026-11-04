import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import { getLettingContract } from "@/lib/letting-engine";
import "./letting-print.css";

export interface LettingContractPreviewProps {
  applicationId: string;
}

const PROTOTYPE_WARNING =
  "هذه معاينة تجريبية فقط وليست عقدًا قانونيًا معتمدًا أو توقيعًا أو تسجيلًا حكوميًا. يلزم تدقيق بشري وقانوني مستقل قبل أي استخدام فعلي.";

function ContractDialog({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    const closeButton = dialogRef.current?.querySelector<HTMLElement>(
      "[data-letting-contract-close]"
    );
    (closeButton ?? focusable()[0] ?? dialogRef.current)?.focus();

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
      className="letting-contract-preview__backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="letting-contract-preview"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        dir="rtl"
      >
        <header className="letting-contract-preview__toolbar">
          <button
            type="button"
            className="btn-ghost"
            data-letting-contract-close
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" /> إغلاق
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.print()}
          >
            <Printer size={18} aria-hidden="true" /> طباعة / حفظ PDF عبر المتصفح
          </button>
        </header>

        <article className="letting-contract-preview__page">
          <header className="letting-contract-preview__header">
            <span>معاينة عقد التأجير</span>
            <h2 id={titleId}>{title || "مسودة عقد التأجير"}</h2>
          </header>
          <p className="letting-contract-preview__warning">
            {PROTOTYPE_WARNING}
          </p>
          <section
            className="letting-contract-preview__content"
            aria-label="النص الكامل لمسودة العقد"
          >
            {/* React renders this strictly as text; no contract HTML is injected. */}
            <pre>{content}</pre>
          </section>
          <footer className="letting-contract-preview__footer">
            <strong>نهاية المعاينة التجريبية</strong>
            <span>{PROTOTYPE_WARNING}</span>
          </footer>
        </article>
      </section>
    </div>,
    document.body
  );
}

/** Shows the core-generated plain-text contract. It does not render identity
 * images or synthesize legal terms; profile fields are preserved in the engine
 * content exactly as the core contract view has generated them. */
export function LettingContractPreview({
  applicationId,
}: LettingContractPreviewProps) {
  const { state } = usePrototype();
  const [open, setOpen] = useState(false);
  const contract = useMemo(
    () => getLettingContract(state.entities, applicationId),
    [applicationId, state.entities]
  );

  useEffect(() => {
    if (!contract) setOpen(false);
  }, [contract]);

  if (!contract)
    return (
      <section
        className="letting-contract-preview__unavailable"
        aria-label="معاينة العقد"
      >
        <p>لا يتوفر عقد للطباعة في هذه الحالة بعد.</p>
      </section>
    );

  return (
    <section
      className="letting-contract-preview__entry"
      aria-label="معاينة العقد"
    >
      <p>
        يعرض النص بيانات الطلب والملف كما ولّدها محرك التجربة. لا تتضمن المعاينة
        صور الهوية أو تحققًا رسميًا.
      </p>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        معاينة العقد والطباعة
      </button>
      {open && (
        <ContractDialog
          title={contract.document.title}
          content={contract.content}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
