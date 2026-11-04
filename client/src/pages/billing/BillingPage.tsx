import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  FilePlus2,
  Landmark,
  Printer,
  ReceiptText,
  ShoppingBag,
  X,
} from "lucide-react";
import {
  CONFIRMED_COLLECTION_STATUSES,
  DemoEntity,
  EntityMap,
  money,
  PROTOTYPE_DATE,
  toMinor,
} from "@shared/prototype";
import type {
  BillingInput,
  BillingKind,
  BillingLine,
  BillingReceiptView,
  BillingView,
  CollectBillingInput,
} from "@shared/billing-types";
import { BillingDocumentPreview } from "@/components/app/BillingDocumentPreview";
import {
  Badge,
  DemoNotice,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  calculateBillingTotals,
  getBillingReceiptView,
  getBillingView,
} from "@/lib/prototype-billing";
import { StatusBadge } from "@/pages/operating/operatingUtils";
import "./billing.css";

type SourceMode = "new" | "existing";
type DraftLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};
type BillingDraft = {
  requestId: string;
  kind: BillingKind;
  sourceMode: SourceMode;
  existingReceivableId: string;
  issuerName: string;
  partyName: string;
  vendorId: string;
  issueDate: string;
  dueDate: string;
  portfolioId: string;
  propertyId: string;
  unitId: string;
  leaseId: string;
  lines: DraftLine[];
  fee: string;
  discount: string;
  notes: string;
};
type CollectionDraft = {
  documentId: string;
  amount: string;
  method: "نقد" | "تحويل";
  collectionDate: string;
  expectedRemainingMinor: number;
};
type PreviewState = { view: BillingView; receipt?: BillingReceiptView };
type FormErrors = Record<string, string>;

const KIND_LABELS: Record<BillingKind, string> = {
  invoice: "فاتورة",
  "payment-request": "مطالبة بالدفع",
  lpo: "أمر شراء LPO",
};

const CLOSED_DOCUMENT_STATUSES = [
  "محصّل",
  "محصل",
  "مسوّى",
  "مسدد",
  "ملغي",
  "مبطل",
];

function makeLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
  };
}

function majorInput(minor: number): string {
  const value = minor / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function entityValue(entity: DemoEntity | undefined, key: string): string {
  return entity ? String(entity.meta[key] ?? "") : "";
}

function billingViewsFor(
  entities: EntityMap,
  documents: DemoEntity[]
): Array<{ document: DemoEntity; view: BillingView }> {
  return documents.flatMap(document => {
    try {
      return [{ document, view: getBillingView(entities, document) }];
    } catch {
      // Existing document-library records are not billing records and stay out of this ledger.
      return [];
    }
  });
}

function isConfirmedReceipt(receipt: DemoEntity): boolean {
  return (
    CONFIRMED_COLLECTION_STATUSES.includes(
      receipt.status as (typeof CONFIRMED_COLLECTION_STATUSES)[number]
    ) && !["ملغي", "مبطل"].includes(receipt.status)
  );
}

function isOpenBillingView(view: BillingView): boolean {
  return (
    view.kind !== "lpo" &&
    view.remainingMinor > 0 &&
    !CLOSED_DOCUMENT_STATUSES.includes(view.status)
  );
}

function ModalShell({
  open,
  title,
  description,
  onClose,
  returnFocusRef,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  returnFocusRef: React.MutableRefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
        ) ?? []
      );
    const firstField = dialogRef.current?.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
    );
    (firstField ?? focusable()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes.at(-1);
      if (!first || !last) return;
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
      returnFocusRef.current?.focus();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal billing-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-dialog-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">إجراء محلي في البروتوتايب</span>
            <h2 id="billing-dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>
        {description && (
          <p className="muted small billing-modal-description">{description}</p>
        )}
        {children}
      </section>
    </div>
  );
}

function FieldError({ children }: { children?: string }) {
  return children ? (
    <span className="billing-field-error" role="alert">
      {children}
    </span>
  ) : null;
}

function BillingKindBadge({ kind }: { kind: BillingKind }) {
  return (
    <Badge tone={kind === "lpo" ? "blue" : "gray"}>{KIND_LABELS[kind]}</Badge>
  );
}

export function BillingPage() {
  const {
    state,
    list,
    outstanding,
    canEdit,
    issueBillingDocument,
    collectBillingDocument,
  } = usePrototype();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<BillingDraft | null>(null);
  const [collection, setCollection] = useState<CollectionDraft | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(
    null
  );
  const [pendingReceiptId, setPendingReceiptId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(
    "تُحفظ هذه الوثائق محليًا في هذا المتصفح، ولا تمثل فاتورة رسمية أو عملية دفع فعلية."
  );

  const documents = useMemo(
    () =>
      list("documents").filter(
        row =>
          state.settings.portfolioId === "all" ||
          row.portfolioId === state.settings.portfolioId
      ),
    [list, state.settings.portfolioId, state.entities.documents]
  );
  const billingRows = useMemo(
    () => billingViewsFor(state.entities, documents),
    [state.entities, documents]
  );
  const portfolios = list("portfolios");
  const allProperties = list("properties");
  const allUnits = list("units");
  const allLeases = list("leases");
  const allTenants = list("tenants");
  const allVendors = list("vendors");
  const allReceivables = list("receivables");

  useEffect(() => {
    if (!pendingDocumentId) return;
    const row = billingRows.find(
      item => item.document.id === pendingDocumentId
    );
    if (!row) return;
    setPreview({ view: row.view });
    setPendingDocumentId(null);
  }, [billingRows, pendingDocumentId]);

  useEffect(() => {
    if (!pendingReceiptId) return;
    const row = billingRows.find(item =>
      item.view.receipts.some(receipt => receipt.id === pendingReceiptId)
    );
    if (!row) return;
    try {
      const receipt = getBillingReceiptView(state.entities, pendingReceiptId);
      setPreview({ view: row.view, receipt });
      setPendingReceiptId(null);
    } catch {
      // The core just committed the receipt; keep the non-blocking success message until a later render can resolve it.
    }
  }, [billingRows, pendingReceiptId, state.entities]);

  const newDraft = (kind: BillingKind): BillingDraft => ({
    requestId: crypto.randomUUID(),
    kind,
    sourceMode: "new",
    existingReceivableId: "",
    issuerName: "صناع الفرص · نموذج",
    partyName: "",
    vendorId: "",
    issueDate: PROTOTYPE_DATE,
    dueDate: PROTOTYPE_DATE,
    portfolioId:
      state.settings.portfolioId === "all" ? "" : state.settings.portfolioId,
    propertyId: "",
    unitId: "",
    leaseId: "",
    lines: [makeLine()],
    fee: "",
    discount: "",
    notes: "",
  });

  const openIssue = (kind: BillingKind) => {
    if (!canEdit) return;
    returnFocusRef.current = document.activeElement as HTMLElement;
    setErrors({});
    setFormError("");
    setDraft(newDraft(kind));
  };

  const closeIssue = () => {
    setDraft(null);
    setErrors({});
    setFormError("");
  };

  const closeCollection = () => {
    setCollection(null);
    setErrors({});
    setFormError("");
  };

  const updateDraft = (patch: Partial<BillingDraft>) => {
    setDraft(current => (current ? { ...current, ...patch } : current));
  };

  const activeReceivables = useMemo(() => {
    if (!draft || draft.kind === "lpo" || !draft.portfolioId) return [];
    const linkedOpenReceivables = new Set(
      billingRows
        .filter(row => isOpenBillingView(row.view) && row.view.receivableId)
        .map(row => row.view.receivableId)
    );
    return allReceivables.filter(
      receivable =>
        receivable.portfolioId === draft.portfolioId &&
        outstanding(receivable.id) > 0 &&
        !linkedOpenReceivables.has(receivable.id)
    );
  }, [allReceivables, billingRows, draft, outstanding]);

  const formProperties = useMemo(
    () =>
      !draft?.portfolioId
        ? []
        : allProperties.filter(row => row.portfolioId === draft.portfolioId),
    [allProperties, draft?.portfolioId]
  );
  const formUnits = useMemo(
    () =>
      !draft?.propertyId
        ? []
        : allUnits.filter(
            row =>
              row.propertyId === draft.propertyId &&
              row.portfolioId === draft.portfolioId
          ),
    [allUnits, draft?.portfolioId, draft?.propertyId]
  );
  const formLeases = useMemo(
    () =>
      !draft?.propertyId
        ? []
        : allLeases.filter(row => {
            const leaseUnitId = entityValue(row, "unitId");
            return (
              row.propertyId === draft.propertyId &&
              row.portfolioId === draft.portfolioId &&
              (!draft.unitId || leaseUnitId === draft.unitId)
            );
          }),
    [allLeases, draft?.portfolioId, draft?.propertyId, draft?.unitId]
  );

  const draftLines = useMemo<BillingLine[]>(() => {
    if (!draft) return [];
    return draft.lines.flatMap(line => {
      try {
        const quantity = Number(line.quantity);
        const unitPriceMinor = toMinor(line.unitPrice || "0");
        return Number.isSafeInteger(quantity) && quantity > 0
          ? [{ description: line.description.trim(), quantity, unitPriceMinor }]
          : [];
      } catch {
        return [];
      }
    });
  }, [draft]);

  const totalsPreview = useMemo(() => {
    if (!draft || draftLines.length !== draft.lines.length) return null;
    try {
      return calculateBillingTotals(
        draftLines,
        draft.fee.trim() ? toMinor(draft.fee) : 0,
        draft.discount.trim() ? toMinor(draft.discount) : 0
      );
    } catch {
      return null;
    }
  }, [draft, draftLines]);

  const selectedExisting = draft
    ? allReceivables.find(row => row.id === draft.existingReceivableId)
    : undefined;

  const selectExistingReceivable = (receivableId: string) => {
    if (!draft) return;
    const receivable = activeReceivables.find(row => row.id === receivableId);
    if (!receivable) {
      updateDraft({ existingReceivableId: "" });
      return;
    }
    const tenantId = entityValue(receivable, "tenantId");
    const tenant = allTenants.find(row => row.id === tenantId);
    const leaseId = entityValue(receivable, "leaseId");
    const unitId = entityValue(receivable, "unitId");
    const dueDate =
      entityValue(receivable, "dueDate") ||
      entityValue(receivable, "due") ||
      receivable.date;
    updateDraft({
      existingReceivableId: receivable.id,
      portfolioId: receivable.portfolioId,
      propertyId: receivable.propertyId,
      unitId,
      leaseId,
      partyName:
        tenant?.title ||
        entityValue(receivable, "tenantName") ||
        entityValue(receivable, "tenant") ||
        receivable.subtitle,
      issueDate: receivable.date || PROTOTYPE_DATE,
      dueDate,
      lines: [
        {
          id: crypto.randomUUID(),
          description: receivable.title,
          quantity: "1",
          unitPrice: majorInput(receivable.amountMinor),
        },
      ],
    });
  };

  const validateIssue = (): { input?: BillingInput; errors: FormErrors } => {
    if (!draft) return { errors: { form: "تعذر فتح نموذج الوثيقة." } };
    const nextErrors: FormErrors = {};
    const require = (value: string, key: string, label: string) => {
      if (!value.trim()) nextErrors[key] = `${label} مطلوب.`;
    };
    require(draft.issuerName, "issuerName", "اسم المصدر");
    require(draft.portfolioId, "portfolioId", "المحفظة");
    require(draft.issueDate, "issueDate", "تاريخ الإصدار");
    require(draft.dueDate, "dueDate", "تاريخ الاستحقاق");
    if (draft.issueDate && draft.dueDate && draft.dueDate < draft.issueDate)
      nextErrors.dueDate = "تاريخ الاستحقاق لا يسبق تاريخ الإصدار.";
    const portfolio = portfolios.find(row => row.id === draft.portfolioId);
    if (!portfolio && draft.portfolioId)
      nextErrors.portfolioId = "اختر محفظة صالحة.";

    const property = allProperties.find(row => row.id === draft.propertyId);
    const requiresProperty = draft.kind !== "lpo";
    if (requiresProperty && !draft.propertyId)
      nextErrors.propertyId = "اختر عقارًا للوثيقة.";
    if (property && property.portfolioId !== draft.portfolioId)
      nextErrors.propertyId = "العقار يجب أن يتبع المحفظة المختارة.";
    if (draft.propertyId && !property)
      nextErrors.propertyId = "العقار المحدد غير متاح.";

    const unit = allUnits.find(row => row.id === draft.unitId);
    if (
      draft.unitId &&
      (!unit ||
        unit.propertyId !== draft.propertyId ||
        unit.portfolioId !== draft.portfolioId)
    )
      nextErrors.unitId = "الوحدة يجب أن تتبع العقار والمحفظة نفسيهما.";
    const lease = allLeases.find(row => row.id === draft.leaseId);
    if (
      draft.leaseId &&
      (!lease ||
        lease.propertyId !== draft.propertyId ||
        lease.portfolioId !== draft.portfolioId ||
        (draft.unitId && entityValue(lease, "unitId") !== draft.unitId))
    )
      nextErrors.leaseId = "العقد يجب أن يتبع العقار والوحدة المختارين.";

    if (draft.kind === "lpo") {
      const vendor = allVendors.find(row => row.id === draft.vendorId);
      if (!vendor) nextErrors.vendorId = "اختر موردًا قائمًا لأمر الشراء.";
      else if (vendor.portfolioId && vendor.portfolioId !== draft.portfolioId)
        nextErrors.vendorId = "المورد لا يتبع المحفظة المختارة.";
    } else {
      require(draft.partyName, "partyName", "اسم الطرف");
      if (draft.sourceMode === "existing") {
        const receivable = activeReceivables.find(
          row => row.id === draft.existingReceivableId
        );
        if (!receivable)
          nextErrors.existingReceivableId =
            "اختر استحقاقًا قائمًا صالحًا وغير مرتبط بوثيقة نشطة.";
      }
    }

    if (!draft.lines.length || draft.lines.length > 5)
      nextErrors.lines = "أدخل من سطر واحد إلى خمسة أسطر فقط.";
    const validatedLines: BillingLine[] = [];
    draft.lines.forEach((line, index) => {
      const prefix = `line-${line.id}`;
      if (!line.description.trim())
        nextErrors[`${prefix}-description`] = `وصف السطر ${index + 1} مطلوب.`;
      if (!/^\d+$/.test(line.quantity) || Number(line.quantity) <= 0)
        nextErrors[`${prefix}-quantity`] = "الكمية عدد صحيح موجب.";
      let unitPriceMinor = 0;
      try {
        unitPriceMinor = toMinor(line.unitPrice);
        if (unitPriceMinor <= 0)
          nextErrors[`${prefix}-price`] = "سعر الوحدة مبلغ موجب.";
      } catch {
        nextErrors[`${prefix}-price`] =
          "أدخل سعرًا صحيحًا بمنزلتين عشريتين كحد أقصى.";
      }
      const quantity = Number(line.quantity);
      if (
        Number.isSafeInteger(quantity) &&
        quantity > 0 &&
        unitPriceMinor > 0 &&
        line.description.trim()
      )
        validatedLines.push({
          description: line.description.trim(),
          quantity,
          unitPriceMinor,
        });
    });

    let feeMinor = 0;
    let discountMinor = 0;
    try {
      feeMinor = draft.fee.trim() ? toMinor(draft.fee) : 0;
    } catch {
      nextErrors.fee = "الرسوم يجب أن تكون مبلغًا صالحًا.";
    }
    try {
      discountMinor = draft.discount.trim() ? toMinor(draft.discount) : 0;
    } catch {
      nextErrors.discount = "الخصم يجب أن يكون مبلغًا صالحًا.";
    }
    if (draft.notes.length > 512)
      nextErrors.notes = "الحد الأقصى للملاحظات 512 حرفًا.";
    if (!Object.keys(nextErrors).length) {
      try {
        calculateBillingTotals(validatedLines, feeMinor, discountMinor);
      } catch (error) {
        nextErrors.lines =
          error instanceof Error ? error.message : "تعذر احتساب الإجمالي.";
      }
    }
    if (Object.keys(nextErrors).length) return { errors: nextErrors };

    const vendor = allVendors.find(row => row.id === draft.vendorId);
    return {
      errors: {},
      input: {
        requestId: draft.requestId,
        kind: draft.kind,
        portfolioId: draft.portfolioId,
        propertyId: draft.propertyId,
        unitId: draft.unitId,
        leaseId: draft.leaseId,
        existingReceivableId:
          draft.kind === "lpo" ? "" : draft.existingReceivableId,
        partyName:
          draft.kind === "lpo" ? (vendor?.title ?? "") : draft.partyName.trim(),
        issuerName: draft.issuerName.trim(),
        vendorId: draft.kind === "lpo" ? draft.vendorId : "",
        issueDate: draft.issueDate,
        dueDate: draft.dueDate,
        lines: validatedLines,
        feeMinor,
        discountMinor,
        notes: draft.notes.trim(),
      },
    };
  };

  const submitIssue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const result = validateIssue();
    setErrors(result.errors);
    setFormError("");
    if (!result.input) return;
    try {
      const document = issueBillingDocument(result.input);
      setFeedback(
        result.input.kind === "lpo"
          ? "حُفظ أمر الشراء محليًا للمورد. لا ينشئ هذا الأمر مصروفًا أو سدادًا أو مطالبة مستأجر."
          : "صدرت الوثيقة محليًا وربطت بذمة واحدة فقط. لم يُسجل أي نقد أو تحويل فعلي."
      );
      setPendingDocumentId(document.id);
      closeIssue();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "تعذر إصدار الوثيقة. راجع الحقول ثم حاول مرة أخرى."
      );
    }
  };

  const openCollection = (view: BillingView) => {
    if (!canEdit || !isOpenBillingView(view)) return;
    returnFocusRef.current = document.activeElement as HTMLElement;
    setErrors({});
    setFormError("");
    setCollection({
      documentId: view.document.id,
      amount: majorInput(view.remainingMinor),
      method: "تحويل",
      collectionDate: PROTOTYPE_DATE,
      expectedRemainingMinor: view.remainingMinor,
    });
  };

  const submitCollection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection || !canEdit) return;
    const nextErrors: FormErrors = {};
    let amountMinor = 0;
    try {
      amountMinor = toMinor(collection.amount);
      if (amountMinor <= 0) nextErrors.amount = "أدخل مبلغ سداد موجبًا.";
      if (amountMinor > collection.expectedRemainingMinor)
        nextErrors.amount = `المبلغ لا يتجاوز المتبقي عند فتح النموذج (${money(collection.expectedRemainingMinor)}).`;
    } catch {
      nextErrors.amount = "أدخل مبلغًا صالحًا بمنزلتين عشريتين كحد أقصى.";
    }
    if (!collection.collectionDate)
      nextErrors.collectionDate = "تاريخ السداد مطلوب.";
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) return;
    const input: CollectBillingInput = {
      documentId: collection.documentId,
      amountMinor,
      method: collection.method,
      collectionDate: collection.collectionDate,
      expectedRemainingMinor: collection.expectedRemainingMinor,
    };
    try {
      const receipt = collectBillingDocument(input);
      setFeedback(
        "سُجل السداد وسند القبض محليًا. لا يمثل ذلك تحويلًا مصرفيًا أو استلامًا فعليًا للأموال."
      );
      setPendingReceiptId(receipt.id);
      closeCollection();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "تعذر تسجيل السداد؛ قد يكون الرصيد تغير بسبب عملية أخرى."
      );
    }
  };

  const setLine = (lineId: string, patch: Partial<DraftLine>) => {
    setDraft(current =>
      current
        ? {
            ...current,
            lines: current.lines.map(line =>
              line.id === lineId ? { ...line, ...patch } : line
            ),
          }
        : current
    );
  };

  const removeLine = (lineId: string) => {
    setDraft(current =>
      current && current.lines.length > 1
        ? {
            ...current,
            lines: current.lines.filter(line => line.id !== lineId),
          }
        : current
    );
  };

  const printDocument = (view: BillingView) => {
    returnFocusRef.current = document.activeElement as HTMLElement;
    setPreview({ view });
  };

  const printReceipt = (view: BillingView, receiptId: string) => {
    try {
      setPreview({
        view,
        receipt: getBillingReceiptView(state.entities, receiptId),
      });
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "تعذر تجهيز سند القبض للطباعة."
      );
    }
  };

  return (
    <div className="section-stack billing-page">
      <PageHeader
        eyebrow="إصدار مستقل عن التحصيل"
        title="الفواتير والمستحقات"
        description="إصدار مبسط مستند إلى الذمم القائمة أو إلى بنود يدوية، مع فصل المستند عن التحصيل النقدي."
      >
        <button
          className="btn-primary"
          type="button"
          disabled={!canEdit}
          onClick={() => openIssue("invoice")}
        >
          <FilePlus2 size={16} /> إصدار فاتورة
        </button>
        <button
          className="btn-secondary"
          type="button"
          disabled={!canEdit}
          onClick={() => openIssue("payment-request")}
        >
          <ReceiptText size={16} /> مطالبة بالدفع
        </button>
        <button
          className="btn-secondary"
          type="button"
          disabled={!canEdit}
          onClick={() => openIssue("lpo")}
        >
          <ShoppingBag size={16} /> أمر شراء LPO
        </button>
      </PageHeader>

      <DemoNotice mode="interactive">
        بروتوتايب محلي محفوظ في هذا المتصفح فقط؛ ليست هذه فاتورة رسمية، ولا ينفذ
        أي إصدار أو تحصيل أو تحويل أموال خارج النموذج.
      </DemoNotice>

      {!canEdit && (
        <p className="billing-readonly" role="status">
          هذه معاينة للقراءة والطباعة فقط. اختر دور الموظف لإصدار وثيقة أو تسجيل
          سداد محلي.
        </p>
      )}
      <p className="billing-feedback" role="status">
        {feedback}
      </p>

      <Panel
        title="سجل المستندات"
        description="الحالة والمبالغ أدناه مشتقة من دفتر التجربة الحالي. لا تُنشأ فواتير أو ذمم خيالية عند فتح الشاشة."
      >
        {billingRows.length ? (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الطرف</th>
                  <th>العقار</th>
                  <th>الإصدار / الاستحقاق</th>
                  <th>الإجمالي</th>
                  <th>المحصّل</th>
                  <th>المتبقي</th>
                  <th>الحالة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {billingRows.map(({ document, view }) => {
                  const receipts = view.receipts.filter(isConfirmedReceipt);
                  const canCollect = canEdit && isOpenBillingView(view);
                  return (
                    <tr key={document.id}>
                      <td data-label="الرقم">
                        <div className="billing-number-cell">
                          <strong className="number">{view.number}</strong>
                          <BillingKindBadge kind={view.kind} />
                        </div>
                      </td>
                      <td data-label="الطرف">{view.partyName || "-"}</td>
                      <td data-label="العقار">
                        <span>{view.propertyTitle || "-"}</span>
                        {view.unitTitle && <small>{view.unitTitle}</small>}
                      </td>
                      <td data-label="الإصدار / الاستحقاق">
                        <span className="number">{view.issueDate || "-"}</span>
                        <small className="number">{view.dueDate || "-"}</small>
                      </td>
                      <td data-label="الإجمالي" className="number">
                        {money(view.totals.totalMinor)}
                      </td>
                      <td data-label="المحصّل" className="number">
                        {money(view.collectedMinor)}
                      </td>
                      <td data-label="المتبقي" className="number">
                        {money(view.remainingMinor)}
                      </td>
                      <td data-label="الحالة">
                        <StatusBadge status={view.status} />
                      </td>
                      <td data-label="الإجراءات">
                        <div className="billing-row-actions">
                          {canCollect && (
                            <button
                              className="btn-ghost"
                              type="button"
                              onClick={() => openCollection(view)}
                            >
                              <Landmark size={14} /> تسجيل سداد
                            </button>
                          )}
                          <details className="billing-print-menu">
                            <summary aria-label={`خيارات طباعة ${view.number}`}>
                              <Printer size={14} /> طباعة{" "}
                              <ChevronDown size={13} />
                            </summary>
                            <div className="billing-print-options">
                              <button
                                type="button"
                                onClick={() => printDocument(view)}
                              >
                                معاينة {KIND_LABELS[view.kind]}
                              </button>
                              {receipts.map(receipt => (
                                <button
                                  key={receipt.id}
                                  type="button"
                                  onClick={() => printReceipt(view, receipt.id)}
                                >
                                  سند {receipt.title || receipt.id.slice(-6)}
                                </button>
                              ))}
                              {!receipts.length && (
                                <span>لا توجد سندات قبض مؤكدة للطباعة.</span>
                              )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="billing-empty">
            <ReceiptText size={25} />
            <h3>لا توجد فواتير أو مطالبات أو أوامر شراء في النطاق الحالي.</h3>
            <p>
              يمكنك البدء بوثيقة جديدة، أو اختيار استحقاق خيالي قائم من نموذج
              التجربة عند إصدار فاتورة أو مطالبة.
            </p>
            <button
              className="btn-primary"
              type="button"
              disabled={!canEdit}
              onClick={() => openIssue("invoice")}
            >
              <FilePlus2 size={16} /> إصدار أول فاتورة
            </button>
          </div>
        )}
      </Panel>

      <ModalShell
        open={Boolean(draft)}
        title={draft ? KIND_LABELS[draft.kind] : "وثيقة"}
        description={
          draft?.kind === "lpo"
            ? "طلب شراء موجه إلى مورد. لا يمثل فاتورة مستأجر ولا تكلفة مسددة، ولا ينشئ ذمة مدينة."
            : "تُصدر الوثيقة إلى ذمة واحدة فقط عند الحاجة، ولا تسجل قبضًا أو ضريبة أو عملية خارجية."
        }
        onClose={closeIssue}
        returnFocusRef={returnFocusRef}
      >
        {draft && (
          <form onSubmit={submitIssue} noValidate>
            <div className="billing-form-grid">
              <label className="form-label">
                <span>
                  اسم المصدر <i className="required-mark">*</i>
                </span>
                <input
                  className="field"
                  value={draft.issuerName}
                  onChange={event =>
                    updateDraft({ issuerName: event.target.value })
                  }
                  aria-invalid={Boolean(errors.issuerName)}
                />
                <FieldError>{errors.issuerName}</FieldError>
              </label>
              <label className="form-label">
                <span>
                  المحفظة <i className="required-mark">*</i>
                </span>
                <select
                  className="field"
                  value={draft.portfolioId}
                  onChange={event =>
                    updateDraft({
                      portfolioId: event.target.value,
                      propertyId: "",
                      unitId: "",
                      leaseId: "",
                      existingReceivableId: "",
                    })
                  }
                  aria-invalid={Boolean(errors.portfolioId)}
                >
                  <option value="">اختر المحفظة</option>
                  {portfolios.map(portfolio => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.title}
                    </option>
                  ))}
                </select>
                <FieldError>{errors.portfolioId}</FieldError>
              </label>

              {draft.kind === "lpo" ? (
                <label className="form-label">
                  <span>
                    المورد <i className="required-mark">*</i>
                  </span>
                  <select
                    className="field"
                    value={draft.vendorId}
                    onChange={event =>
                      updateDraft({ vendorId: event.target.value })
                    }
                    aria-invalid={Boolean(errors.vendorId)}
                  >
                    <option value="">اختر موردًا</option>
                    {allVendors
                      .filter(
                        vendor =>
                          !draft.portfolioId ||
                          !vendor.portfolioId ||
                          vendor.portfolioId === draft.portfolioId
                      )
                      .map(vendor => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.title}
                        </option>
                      ))}
                  </select>
                  <FieldError>{errors.vendorId}</FieldError>
                </label>
              ) : (
                <label className="form-label">
                  <span>
                    الطرف <i className="required-mark">*</i>
                  </span>
                  <input
                    className="field"
                    value={draft.partyName}
                    placeholder="اسم المستأجر أو الجهة"
                    onChange={event =>
                      updateDraft({ partyName: event.target.value })
                    }
                    aria-invalid={Boolean(errors.partyName)}
                  />
                  <FieldError>{errors.partyName}</FieldError>
                </label>
              )}

              <label className="form-label">
                <span>
                  تاريخ الإصدار <i className="required-mark">*</i>
                </span>
                <input
                  className="field number"
                  type="date"
                  value={draft.issueDate}
                  onChange={event =>
                    updateDraft({ issueDate: event.target.value })
                  }
                  aria-invalid={Boolean(errors.issueDate)}
                />
                <FieldError>{errors.issueDate}</FieldError>
              </label>
              <label className="form-label">
                <span>
                  تاريخ الاستحقاق <i className="required-mark">*</i>
                </span>
                <input
                  className="field number"
                  type="date"
                  value={draft.dueDate}
                  onChange={event =>
                    updateDraft({ dueDate: event.target.value })
                  }
                  aria-invalid={Boolean(errors.dueDate)}
                />
                <FieldError>{errors.dueDate}</FieldError>
              </label>

              {draft.kind !== "lpo" && (
                <fieldset className="billing-source span-all">
                  <legend>مصدر الذمة</legend>
                  <label>
                    <input
                      type="radio"
                      name="source-mode"
                      checked={draft.sourceMode === "new"}
                      onChange={() =>
                        updateDraft({
                          sourceMode: "new",
                          existingReceivableId: "",
                        })
                      }
                    />{" "}
                    إنشاء ذمة واحدة مع الوثيقة
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="source-mode"
                      checked={draft.sourceMode === "existing"}
                      onChange={() => updateDraft({ sourceMode: "existing" })}
                      disabled={!activeReceivables.length}
                    />{" "}
                    من استحقاق قائم
                  </label>
                  {draft.sourceMode === "existing" && (
                    <label className="form-label billing-existing-receivable">
                      <span>
                        الاستحقاق القائم <i className="required-mark">*</i>
                      </span>
                      <select
                        className="field"
                        value={draft.existingReceivableId}
                        onChange={event =>
                          selectExistingReceivable(event.target.value)
                        }
                        aria-invalid={Boolean(errors.existingReceivableId)}
                      >
                        <option value="">
                          اختر استحقاقًا غير مرتبط بوثيقة نشطة
                        </option>
                        {activeReceivables.map(receivable => (
                          <option key={receivable.id} value={receivable.id}>
                            {receivable.title} · المتبقي{" "}
                            {money(outstanding(receivable.id))}
                          </option>
                        ))}
                      </select>
                      <FieldError>{errors.existingReceivableId}</FieldError>
                    </label>
                  )}
                  {!activeReceivables.length && (
                    <p>
                      لا توجد ذمم قائمة غير مرتبطة بوثيقة نشطة في المحفظة
                      المختارة.
                    </p>
                  )}
                  {selectedExisting && (
                    <p>سيُحفظ الرابط بالذمة القائمة فقط؛ لن تنشأ ذمة ثانية.</p>
                  )}
                </fieldset>
              )}

              <label className="form-label">
                <span>
                  العقار{" "}
                  {draft.kind !== "lpo" && <i className="required-mark">*</i>}
                </span>
                <select
                  className="field"
                  value={draft.propertyId}
                  onChange={event =>
                    updateDraft({
                      propertyId: event.target.value,
                      unitId: "",
                      leaseId: "",
                    })
                  }
                  aria-invalid={Boolean(errors.propertyId)}
                >
                  <option value="">
                    {draft.kind === "lpo" ? "بدون ربط عقار" : "اختر العقار"}
                  </option>
                  {formProperties.map(property => (
                    <option key={property.id} value={property.id}>
                      {property.title}
                    </option>
                  ))}
                </select>
                <FieldError>{errors.propertyId}</FieldError>
              </label>
              <label className="form-label">
                <span>الوحدة (اختياري)</span>
                <select
                  className="field"
                  value={draft.unitId}
                  disabled={!draft.propertyId || draft.kind === "lpo"}
                  onChange={event =>
                    updateDraft({ unitId: event.target.value, leaseId: "" })
                  }
                  aria-invalid={Boolean(errors.unitId)}
                >
                  <option value="">
                    {draft.propertyId ? "بدون ربط وحدة" : "اختر العقار أولًا"}
                  </option>
                  {formUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
                </select>
                <FieldError>{errors.unitId}</FieldError>
              </label>
              <label className="form-label">
                <span>العقد (اختياري)</span>
                <select
                  className="field"
                  value={draft.leaseId}
                  disabled={!draft.propertyId || draft.kind === "lpo"}
                  onChange={event => {
                    const lease = formLeases.find(
                      row => row.id === event.target.value
                    );
                    const tenant = allTenants.find(
                      row => row.id === entityValue(lease, "tenantId")
                    );
                    updateDraft({
                      leaseId: event.target.value,
                      partyName:
                        draft.kind === "lpo"
                          ? draft.partyName
                          : tenant?.title ||
                            entityValue(lease, "tenant") ||
                            lease?.subtitle ||
                            draft.partyName,
                    });
                  }}
                  aria-invalid={Boolean(errors.leaseId)}
                >
                  <option value="">
                    {draft.propertyId ? "بدون ربط عقد" : "اختر العقار أولًا"}
                  </option>
                  {formLeases.map(lease => (
                    <option key={lease.id} value={lease.id}>
                      {lease.title}
                    </option>
                  ))}
                </select>
                <FieldError>{errors.leaseId}</FieldError>
              </label>
              {draft.kind === "lpo" && (
                <p className="billing-lpo-helper">
                  أمر الشراء طلب للمورد، وليس فاتورة للمستأجر ولا تكلفة مدفوعة.
                </p>
              )}
            </div>

            <section
              className="billing-lines"
              aria-labelledby="billing-lines-title"
            >
              <div className="billing-lines-heading">
                <div>
                  <h3 id="billing-lines-title">بنود الوثيقة</h3>
                  <p>حتى 5 بنود. الكمية عدد صحيح موجب، والأسعار بوحدة ر.ق.</p>
                </div>
                <button
                  className="btn-ghost"
                  type="button"
                  disabled={draft.lines.length >= 5}
                  onClick={() =>
                    updateDraft({ lines: [...draft.lines, makeLine()] })
                  }
                >
                  + إضافة بند
                </button>
              </div>
              {draft.lines.map((line, index) => {
                const prefix = `line-${line.id}`;
                return (
                  <div className="billing-line-row" key={line.id}>
                    <label className="form-label billing-line-description">
                      <span>
                        الوصف {index + 1} <i className="required-mark">*</i>
                      </span>
                      <input
                        className="field"
                        value={line.description}
                        onChange={event =>
                          setLine(line.id, { description: event.target.value })
                        }
                        aria-invalid={Boolean(errors[`${prefix}-description`])}
                      />
                      <FieldError>{errors[`${prefix}-description`]}</FieldError>
                    </label>
                    <label className="form-label">
                      <span>
                        الكمية <i className="required-mark">*</i>
                      </span>
                      <input
                        className="field number"
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={event =>
                          setLine(line.id, { quantity: event.target.value })
                        }
                        aria-invalid={Boolean(errors[`${prefix}-quantity`])}
                      />
                      <FieldError>{errors[`${prefix}-quantity`]}</FieldError>
                    </label>
                    <label className="form-label">
                      <span>
                        سعر الوحدة (ر.ق) <i className="required-mark">*</i>
                      </span>
                      <input
                        className="field number"
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={event =>
                          setLine(line.id, { unitPrice: event.target.value })
                        }
                        aria-invalid={Boolean(errors[`${prefix}-price`])}
                      />
                      <FieldError>{errors[`${prefix}-price`]}</FieldError>
                    </label>
                    <button
                      className="icon-button billing-remove-line"
                      type="button"
                      disabled={draft.lines.length === 1}
                      onClick={() => removeLine(line.id)}
                      aria-label={`حذف البند ${index + 1}`}
                    >
                      <X size={17} />
                    </button>
                  </div>
                );
              })}
              <FieldError>{errors.lines}</FieldError>
            </section>

            <div className="billing-form-grid billing-totals-fields">
              <label className="form-label">
                <span>رسوم يدوية (اختياري)</span>
                <input
                  className="field number"
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.fee}
                  onChange={event => updateDraft({ fee: event.target.value })}
                  aria-invalid={Boolean(errors.fee)}
                />
                <FieldError>{errors.fee}</FieldError>
              </label>
              <label className="form-label">
                <span>خصم يدوي (اختياري)</span>
                <input
                  className="field number"
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.discount}
                  onChange={event =>
                    updateDraft({ discount: event.target.value })
                  }
                  aria-invalid={Boolean(errors.discount)}
                />
                <FieldError>{errors.discount}</FieldError>
              </label>
              <div className="billing-total-preview" aria-live="polite">
                <span>إجمالي المعاينة</span>
                <strong className="number">
                  {totalsPreview
                    ? money(totalsPreview.totalMinor)
                    : "أكمل البنود لعرض الإجمالي"}
                </strong>
                <small>لا يتضمن ادعاء ضريبة أو اعتمادًا رسميًا.</small>
              </div>
              <label className="form-label span-all">
                <span>ملاحظات داخلية (حتى 512 حرفًا)</span>
                <textarea
                  className="field"
                  rows={3}
                  maxLength={512}
                  value={draft.notes}
                  onChange={event => updateDraft({ notes: event.target.value })}
                  aria-invalid={Boolean(errors.notes)}
                />
                <small className="billing-char-count">
                  {draft.notes.length}/512
                </small>
                <FieldError>{errors.notes}</FieldError>
              </label>
            </div>
            {formError && (
              <p className="billing-form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-footer">
              <button type="submit" className="btn-primary">
                <FilePlus2 size={16} /> حفظ {KIND_LABELS[draft.kind]} محليًا
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeIssue}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </ModalShell>

      <ModalShell
        open={Boolean(collection)}
        title="تسجيل سداد"
        description="يسجل سند قبض محليًا فقط. لا يوجد اتصال بنك أو بوابة دفع أو استلام فعلي للأموال."
        onClose={closeCollection}
        returnFocusRef={returnFocusRef}
      >
        {collection && (
          <form onSubmit={submitCollection} noValidate>
            <div className="billing-form-grid">
              <label className="form-label">
                <span>
                  مبلغ السداد (ر.ق) <i className="required-mark">*</i>
                </span>
                <input
                  className="field number"
                  inputMode="decimal"
                  value={collection.amount}
                  onChange={event =>
                    setCollection(current =>
                      current
                        ? { ...current, amount: event.target.value }
                        : current
                    )
                  }
                  aria-invalid={Boolean(errors.amount)}
                />
                <small>
                  الحد عند فتح النموذج:{" "}
                  {money(collection.expectedRemainingMinor)}
                </small>
                <FieldError>{errors.amount}</FieldError>
              </label>
              <label className="form-label">
                <span>
                  الوسيلة <i className="required-mark">*</i>
                </span>
                <select
                  className="field"
                  value={collection.method}
                  onChange={event =>
                    setCollection(current =>
                      current
                        ? {
                            ...current,
                            method: event.target
                              .value as CollectionDraft["method"],
                          }
                        : current
                    )
                  }
                >
                  <option value="تحويل">تحويل</option>
                  <option value="نقد">نقد</option>
                </select>
              </label>
              <label className="form-label">
                <span>
                  تاريخ السداد <i className="required-mark">*</i>
                </span>
                <input
                  className="field number"
                  type="date"
                  value={collection.collectionDate}
                  onChange={event =>
                    setCollection(current =>
                      current
                        ? { ...current, collectionDate: event.target.value }
                        : current
                    )
                  }
                  aria-invalid={Boolean(errors.collectionDate)}
                />
                <FieldError>{errors.collectionDate}</FieldError>
              </label>
            </div>
            {formError && (
              <p className="billing-form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-footer">
              <button type="submit" className="btn-primary">
                <Landmark size={16} /> تسجيل السداد محليًا
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeCollection}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </ModalShell>

      {preview && (
        <BillingDocumentPreview
          view={preview.view}
          receipt={preview.receipt}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
