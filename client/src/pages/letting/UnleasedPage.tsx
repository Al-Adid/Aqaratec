import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Landmark,
  MailCheck,
  Plus,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { type DemoEntity, money, toMinor } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import {
  LETTING_DOCUMENT_LABELS,
  LETTING_STAGE_LABELS,
  LETTING_TEST_EMAIL,
  type ApplicantKind,
  type LettingChequeInput,
  type LettingDocumentKind,
  type LettingStage,
} from "@shared/letting-types";
import { electricityNumberForRentalTarget } from "@/lib/prototype-rental";
import { downloadLettingCalendarInvite } from "@/lib/letting-calendar";
import {
  addLettingSlot,
  bookLettingAppointment,
  completeLettingApplication,
  createLettingApplication,
  decideLettingApplication,
  evaluateLettingRecommendation,
  getLettingCase,
  getLettingChequeSchedule,
  getLettingContract,
  getLeaseTemplates,
  listAvailableLettingTargets,
  requiredLettingDocuments,
  reviewLettingApplication,
  submitLettingHandover,
  submitLettingReturns,
  updateLettingProfile,
} from "@/lib/letting-engine";
import { LettingAttachments } from "@/components/letting/LettingAttachments";
import { LettingContractPreview } from "@/components/letting/LettingContractPreview";
import {
  Badge,
  DemoNotice,
  EmptyState,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import { usePrototype } from "@/contexts/PrototypeContext";
import "./letting.css";

const STAGE_FLOW: LettingStage[] = [
  "documents-requested",
  "review",
  "contract-issued",
  "returns-received",
  "appointment-booked",
  "handover-submitted",
  "completed",
];

type ChequeDraft = Omit<LettingChequeInput, "amountMinor"> & {
  id: string;
  amount: string;
};

type TemplateOption = {
  id: string;
  name: string;
  defaultRentMinor: number | null;
  portfolioId: string;
};

function requestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function isApplicantKind(value: unknown): value is ApplicantKind {
  return value === "individual" || value === "company";
}

function applicantKindOf(application: DemoEntity): ApplicantKind {
  return isApplicantKind(application.meta.applicantKind)
    ? application.meta.applicantKind
    : "individual";
}

function stageTone(
  stage: LettingStage
): "green" | "amber" | "red" | "blue" | "gray" {
  if (stage === "completed") return "green";
  if (stage === "rejected") return "red";
  if (stage === "review" || stage === "contract-issued") return "blue";
  if (stage === "documents-requested") return "amber";
  return "gray";
}

function inputFromMinor(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "";
  const major = value / 100;
  return Number.isInteger(major)
    ? String(major)
    : major.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function dateAfter(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : value;
}

function toQatarIso(value: string): string {
  if (!value) return "";
  return `${value.length === 16 ? `${value}:00` : value}+03:00`;
}

function datetimeInput(value: unknown): string {
  const source = text(value);
  return source ? source.slice(0, 16) : "";
}

function templateOption(value: unknown): TemplateOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const root =
    row.template && typeof row.template === "object"
      ? (row.template as Record<string, unknown>)
      : row;
  const id = text(root.id ?? row.id);
  if (!id) return null;
  const meta =
    root.meta && typeof root.meta === "object"
      ? (root.meta as Record<string, unknown>)
      : {};
  const defaultRent =
    row.defaultRentMinor ?? root.defaultRentMinor ?? meta.defaultRentMinor;
  return {
    id,
    name: text(row.name ?? root.title ?? root.name) || "قالب محفوظ",
    defaultRentMinor:
      typeof defaultRent === "number" && Number.isSafeInteger(defaultRent)
        ? defaultRent
        : null,
    portfolioId: text(root.portfolioId ?? row.portfolioId),
  };
}

function FieldError({ children }: { children?: string }) {
  return children ? (
    <small className="letting-field-error">{children}</small>
  ) : null;
}

function caseMailBody(email: DemoEntity): string {
  return (
    text(email.meta.body) || email.subtitle || "لا توجد معاينة نصية للرسالة."
  );
}

function Stepper({ stage }: { stage: LettingStage }) {
  const activeIndex = STAGE_FLOW.indexOf(stage);
  if (stage === "rejected") {
    return (
      <div className="letting-stepper letting-stepper--rejected" role="status">
        <span>تم إغلاق الطلب بقرار الموظف.</span>
      </div>
    );
  }
  return (
    <ol className="letting-stepper" aria-label="مراحل طلب التأجير">
      {STAGE_FLOW.map((item, index) => {
        const state =
          index < activeIndex
            ? "complete"
            : index === activeIndex
              ? "active"
              : "pending";
        return (
          <li className={`letting-step letting-step--${state}`} key={item}>
            <span>{index + 1}</span>
            <small>{LETTING_STAGE_LABELS[item]}</small>
          </li>
        );
      })}
    </ol>
  );
}

export function UnleasedPage() {
  const { state, canEdit, commitTransition, list } = usePrototype();
  const asOf = scenarioDate(state);
  const [selectedId, setSelectedId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [profileError, setProfileError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [returnsError, setReturnsError] = useState("");
  const [handoverError, setHandoverError] = useState("");
  const [slotError, setSlotError] = useState("");
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({});
  const [reviewDraft, setReviewDraft] = useState<Record<string, string>>({
    minimumRent: "",
    minimumCredit: "",
    creditScore: "",
    scoreScale: "",
    reportDate: "",
    creditSource: "",
    maximumAge: "",
  });
  const [documentsReviewed, setDocumentsReviewed] = useState(false);
  const [creditSourceReviewed, setCreditSourceReviewed] = useState(false);
  const [decisionDraft, setDecisionDraft] = useState({
    decision: "approve" as "approve" | "reject",
    reason: "",
    templateId: "",
    propertyNumber: "",
    electricityNumber: "",
  });
  const [cheques, setCheques] = useState<ChequeDraft[]>([]);
  const [slotDraft, setSlotDraft] = useState({
    employee: "",
    start: "",
    end: "",
  });
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [handoverDraft, setHandoverDraft] = useState({
    date: asOf,
    notes: "",
    declaration: false,
  });
  const [originalContractReceived, setOriginalContractReceived] =
    useState(false);
  const [originalChequesReceived, setOriginalChequesReceived] = useState(false);
  const [receivedDate, setReceivedDate] = useState(asOf);

  const allTargets = useMemo(() => {
    try {
      return listAvailableLettingTargets(state.entities, asOf);
    } catch {
      return [];
    }
  }, [asOf, state.entities]);
  const targets = useMemo(
    () =>
      allTargets.filter(
        target =>
          state.settings.portfolioId === "all" ||
          target.portfolioId === state.settings.portfolioId
      ),
    [allTargets, state.settings.portfolioId]
  );
  const properties = list("properties");
  const applications = useMemo(
    () =>
      state.entities.applications
        .filter(
          application =>
            application.meta.recordType === "letting-application" &&
            (state.settings.portfolioId === "all" ||
              application.portfolioId === state.settings.portfolioId)
        )
        .slice()
        .sort((left, right) => right.date.localeCompare(left.date)),
    [state.entities.applications, state.settings.portfolioId]
  );
  const selectedApplication = applications.find(row => row.id === selectedId);
  const selectedCase = useMemo(() => {
    if (!selectedApplication) return undefined;
    try {
      return getLettingCase(state.entities, selectedApplication.id);
    } catch {
      return undefined;
    }
  }, [selectedApplication, state.entities]);
  const selectedStage: LettingStage =
    selectedCase?.stage ?? "documents-requested";
  const selectedKind = selectedApplication
    ? applicantKindOf(selectedApplication)
    : "individual";
  const selectedProperty = selectedApplication
    ? properties.find(row => row.id === selectedApplication.propertyId)
    : undefined;
  const selectedUnitId = selectedApplication
    ? text(selectedApplication.meta.unitId)
    : "";

  const templates = useMemo<TemplateOption[]>(() => {
    if (!selectedApplication) return [];
    try {
      return (getLeaseTemplates(state.entities) as unknown[])
        .map(templateOption)
        .filter((option): option is TemplateOption => Boolean(option))
        .filter(
          option =>
            !option.portfolioId ||
            option.portfolioId === selectedApplication.portfolioId
        );
    } catch {
      return [];
    }
  }, [selectedApplication, state.entities]);
  const recommendation = useMemo(() => {
    if (!selectedApplication) return undefined;
    try {
      return evaluateLettingRecommendation(
        state.entities,
        selectedApplication.id
      );
    } catch {
      return undefined;
    }
  }, [selectedApplication, state.entities]);
  const contract = useMemo(() => {
    if (!selectedApplication) return undefined;
    try {
      return getLettingContract(state.entities, selectedApplication.id);
    } catch {
      return undefined;
    }
  }, [selectedApplication, state.entities]);
  const chequeSchedule = useMemo(() => {
    if (!selectedApplication) return [];
    try {
      return getLettingChequeSchedule(state.entities, selectedApplication.id);
    } catch {
      return [];
    }
  }, [selectedApplication, state.entities]);
  const selectedProfile = selectedCase?.profile;
  const allSlots = useMemo(
    () =>
      state.entities.tasks.filter(
        row =>
          row.meta.recordType === "letting-slot" &&
          (state.settings.portfolioId === "all" ||
            row.portfolioId === state.settings.portfolioId)
      ),
    [state.entities.tasks, state.settings.portfolioId]
  );
  const futureSlots = useMemo(
    () =>
      allSlots.filter(slot => {
        const start = text(slot.meta.start) || slot.date;
        return start.slice(0, 10) >= asOf && !text(slot.meta.reservedFor);
      }),
    [allSlots, asOf]
  );

  useEffect(() => {
    if (!selectedApplication) return;
    const profile = selectedCase?.profile;
    setProfileError("");
    setReviewError("");
    setDecisionError("");
    setReturnsError("");
    setHandoverError("");
    setSlotError("");
    setProfileDraft({
      identityNumber: text(profile?.meta.identityNumber),
      companyName: text(profile?.meta.companyName),
      companyNumber: text(profile?.meta.companyNumber),
      establishmentNumber: text(profile?.meta.establishmentNumber),
      companyAddress: text(profile?.meta.companyAddress),
      companyWebsite: text(profile?.meta.companyWebsite),
      authorizedName: text(profile?.meta.authorizedName),
      email: text(profile?.meta.email) || text(selectedApplication.meta.email),
      phone: text(profile?.meta.phone) || text(selectedApplication.meta.phone),
    });
    const propertyNumber = text(selectedProperty?.meta.propertyNumber);
    const electricity = electricityNumberForRentalTarget(
      state.entities,
      selectedApplication.propertyId,
      selectedUnitId
    );
    setDecisionDraft({
      decision: "approve",
      reason: "",
      templateId: "",
      propertyNumber,
      electricityNumber: electricity,
    });
    setHandoverDraft({ date: asOf, notes: "", declaration: false });
    setOriginalContractReceived(false);
    setOriginalChequesReceived(false);
    setReceivedDate(asOf);
  }, [
    asOf,
    selectedApplication?.id,
    selectedCase?.profile?.id,
    selectedProperty?.id,
    selectedUnitId,
    state.entities,
  ]);

  useEffect(() => {
    setCheques(
      chequeSchedule.map((item, index) => ({
        id: `${item.dueDate}-${index}`,
        dueDate: item.dueDate,
        amount: inputFromMinor(item.amountMinor),
        number: "",
        bank: "",
      }))
    );
  }, [chequeSchedule]);

  const availableTargetOptions = targets.map(target => {
    const property = properties.find(row => row.id === target.propertyId);
    return {
      value: target.id,
      label: `${property?.title ?? "عقار"} · ${target.title}`,
    };
  });

  const createApplication = (values: Record<string, string>) => {
    if (!canEdit) return;
    const target = targets.find(row => row.id === values.targetId);
    if (!target) throw new Error("اختر هدف تأجير شاغرًا ضمن نطاق المحفظة.");
    const kind: ApplicantKind =
      values.applicantKind === "company" ? "company" : "individual";
    const offerMinor = toMinor(values.offerRent);
    if (offerMinor <= 0)
      throw new Error("عرض الإيجار يجب أن يكون مبلغًا موجبًا صريحًا.");
    if (
      !values.startDate ||
      !values.endDate ||
      values.endDate < values.startDate
    )
      throw new Error("حدد فترة إيجار صحيحة.");
    if (values.startDate <= asOf)
      throw new Error("تاريخ بدء الإشغال المقترح يجب أن يلي تاريخ السيناريو.");
    const property = properties.find(row => row.id === target.propertyId);
    if (!property) throw new Error("هدف التأجير غير مرتبط بعقار صالح.");
    const operationId = requestId("letting-intake");
    commitTransition(current =>
      createLettingApplication(current, {
        requestId: operationId,
        messageId: requestId("letting-thread"),
        applicantKind: kind,
        propertyId: property.id,
        unitId: target.id,
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        offerMinor,
        startDate: values.startDate,
        endDate: values.endDate,
        message: values.message.trim(),
      })
    );
    setFeedback(
      "سُجل الطلب محليًا برقم عملية وخيط رسالة تجريبيين؛ لم تُرسل رسالة فعلية."
    );
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setProfileError("");
    try {
      commitTransition(current =>
        updateLettingProfile(current, selectedApplication.id, {
          name:
            text(selectedApplication.meta.name) || selectedApplication.title,
          email: profileDraft.email.trim(),
          phone: profileDraft.phone.trim(),
          identityNumber: profileDraft.identityNumber.trim(),
          companyName: profileDraft.companyName.trim(),
          companyNumber: profileDraft.companyNumber.trim(),
          establishmentNumber: profileDraft.establishmentNumber.trim(),
          companyAddress: profileDraft.companyAddress.trim(),
          companyWebsite: profileDraft.companyWebsite.trim(),
          authorizedName: profileDraft.authorizedName.trim(),
        })
      );
      setFeedback(
        "حُفظ ملف المتقدم المحلي. نوع المتقدم والاسم يظلان مقفلين لحماية طلب التأجير."
      );
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : "تعذر حفظ ملف المتقدم."
      );
    }
  };

  const submitReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setReviewError("");
    try {
      const optionalInteger = (value: string, label: string): number | null => {
        if (!value.trim()) return null;
        if (!/^\d+$/.test(value.trim()))
          throw new Error(`${label} يجب أن يكون عددًا صحيحًا.`);
        return Number(value);
      };
      const minRent = reviewDraft.minimumRent.trim()
        ? toMinor(reviewDraft.minimumRent)
        : null;
      if (minRent !== null && minRent <= 0)
        throw new Error("الحد الأدنى للإيجار قيمة موجبة صريحة أو يترك فارغًا.");
      commitTransition(current =>
        reviewLettingApplication(current, {
          requestId: requestId("letting-review"),
          applicationId: selectedApplication.id,
          minimumRentMinor: minRent,
          minimumCreditScore: optionalInteger(
            reviewDraft.minimumCredit,
            "الحد الأدنى للدرجة"
          ),
          creditScore: optionalInteger(reviewDraft.creditScore, "درجة التقرير"),
          scoreScaleMax: optionalInteger(
            reviewDraft.scoreScale,
            "مقياس الدرجة"
          ),
          creditReportDate: reviewDraft.reportDate,
          creditSourceReviewed,
          creditSource: reviewDraft.creditSource.trim(),
          documentsReviewed,
          maximumReportAgeDays: optionalInteger(
            reviewDraft.maximumAge,
            "أقصى عمر للتقرير"
          ),
        })
      );
      setFeedback(
        "حُفظت المراجعة كما أدخلها الموظف. لا تُستخرج أرقام أو قرارات من PDF تلقائيًا."
      );
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "تعذر حفظ المراجعة."
      );
    }
  };

  const submitDecision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setDecisionError("");
    try {
      if (!decisionDraft.reason.trim())
        throw new Error("سبب قرار الموظف مطلوب للموافقة أو الرفض.");
      const selectedTemplate = templates.find(
        template => template.id === decisionDraft.templateId
      );
      if (
        decisionDraft.decision === "approve" &&
        selectedTemplate?.defaultRentMinor !== null &&
        selectedTemplate?.defaultRentMinor !==
          selectedApplication.amountMinor &&
        !decisionDraft.reason.trim()
      )
        throw new Error("اختلاف إيجار القالب يحتاج سبب مراجعة بشريًا صريحًا.");
      commitTransition(current =>
        decideLettingApplication(current, {
          requestId: requestId("letting-decision"),
          applicationId: selectedApplication.id,
          decision: decisionDraft.decision,
          reason: decisionDraft.reason.trim(),
          templateId: decisionDraft.templateId || undefined,
          propertyNumber: decisionDraft.propertyNumber.trim(),
          electricityNumber: decisionDraft.electricityNumber.trim(),
        })
      );
      setFeedback(
        decisionDraft.decision === "approve"
          ? "صدر قرار الموافقة داخل النموذج. تم حجز هدف التأجير فقط؛ لا يعد مشغولًا فعليًا حتى الإكمال."
          : "حُفظ الرفض وسببه محليًا؛ لم تُرسل رسالة فعلية."
      );
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : "تعذر حفظ القرار."
      );
    }
  };

  const submitReturns = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setReturnsError("");
    try {
      if (!cheques.length)
        throw new Error("لا توجد دورة شيكات مجدولة للعقد الحالي.");
      const prepared = cheques.map(cheque => {
        const amountMinor = toMinor(cheque.amount);
        if (!cheque.number.trim() || !cheque.bank.trim())
          throw new Error("رقم الشيك والبنك مطلوبان لكل شيك.");
        if (amountMinor <= 0) throw new Error("قيمة الشيك يجب أن تكون موجبة.");
        return {
          number: cheque.number.trim(),
          bank: cheque.bank.trim(),
          amountMinor,
          dueDate: cheque.dueDate,
        };
      });
      commitTransition(current =>
        submitLettingReturns(current, {
          requestId: requestId("letting-returns"),
          applicationId: selectedApplication.id,
          cheques: prepared,
        })
      );
      setFeedback(
        "سُجلت الشيكات كمرتجعات مستلمة في النموذج، لا كتحصيل نقدي أو فاتورة تلقائية."
      );
    } catch (error) {
      setReturnsError(
        error instanceof Error ? error.message : "تعذر حفظ المرتجعات."
      );
    }
  };

  const addSlot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    setSlotError("");
    try {
      if (!slotDraft.employee.trim()) throw new Error("اسم الموظف مطلوب.");
      const start = toQatarIso(slotDraft.start);
      const end = toQatarIso(slotDraft.end);
      if (!start || !end || end <= start)
        throw new Error("أدخل نافذة موعد مستقبلية صحيحة.");
      commitTransition(current =>
        addLettingSlot(current, {
          requestId: requestId("letting-slot"),
          employee: slotDraft.employee.trim(),
          start,
          end,
          portfolioId:
            current.settings.portfolioId === "all"
              ? (selectedApplication?.portfolioId ?? "")
              : current.settings.portfolioId,
        })
      );
      setSlotDraft({ employee: "", start: "", end: "" });
      setFeedback(
        "أضيفت إتاحة الموظف محليًا. يتحقق المحرك من عدم تداخل أوقاته في كل المحافظ."
      );
    } catch (error) {
      setSlotError(
        error instanceof Error ? error.message : "تعذر إضافة الإتاحة."
      );
    }
  };

  const bookSlot = () => {
    if (!selectedApplication || !canEdit) return;
    setSlotError("");
    try {
      if (!selectedSlotId) throw new Error("اختر موعدًا مستقبليًا متاحًا.");
      commitTransition(current =>
        bookLettingAppointment(current, {
          requestId: requestId("letting-booking"),
          applicationId: selectedApplication.id,
          slotId: selectedSlotId,
        })
      );
      setFeedback("حُجز الموعد محليًا؛ لا يوجد تقويم خارجي أو دعوة مرسلة.");
    } catch (error) {
      setSlotError(error instanceof Error ? error.message : "تعذر حجز الموعد.");
    }
  };

  const submitHandover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setHandoverError("");
    try {
      commitTransition(current =>
        submitLettingHandover(current, {
          requestId: requestId("letting-handover"),
          applicationId: selectedApplication.id,
          date: handoverDraft.date,
          conditionNotes: handoverDraft.notes.trim(),
          tenantDeclaration: handoverDraft.declaration,
        })
      );
      setFeedback(
        "سُجلت ملاحظات الحالة وإقرار المستأجر كمحاكاة إدخال مستأجر؛ لا توجد بوابة مستأجر حقيقية."
      );
    } catch (error) {
      setHandoverError(
        error instanceof Error ? error.message : "تعذر حفظ إدخال الحالة."
      );
    }
  };

  const complete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplication || !canEdit) return;
    setHandoverError("");
    try {
      commitTransition(current =>
        completeLettingApplication(current, {
          requestId: requestId("letting-complete"),
          applicationId: selectedApplication.id,
          originalContractReceived,
          originalChequesReceived,
          receivedDate,
        })
      );
      setFeedback(
        "اكتملت دورة التأجير محليًا بعد تأكيد الموظف للأصول. لا يتم إنشاء فاتورة تلقائية."
      );
    } catch (error) {
      setHandoverError(
        error instanceof Error ? error.message : "تعذر إكمال التأجير."
      );
    }
  };

  const documentKinds: LettingDocumentKind[] = selectedApplication
    ? requiredLettingDocuments(selectedKind)
    : [];
  const selectedTemplate = templates.find(
    template => template.id === decisionDraft.templateId
  );
  const hasTemplateRentMismatch =
    selectedTemplate?.defaultRentMinor !== null &&
    selectedTemplate?.defaultRentMinor !== undefined &&
    selectedApplication &&
    selectedTemplate.defaultRentMinor !== selectedApplication.amountMinor;

  return (
    <div className="section-stack letting-page">
      <PageHeader
        eyebrow="وحدات غير مؤجرة"
        title="طلبات التأجير والوحدات المتاحة"
        description="دورة تشغيل محلية للطلبات من الاستلام حتى التسليم، تفصل المستند والقرار والحجز عن التحصيل أو الإشغال الفعلي."
      >
        <FormDialog
          title="فتح طلب تأجير جديد"
          description="يرتبط الطلب بهدف تأجير شاغر داخل النطاق الحالي. البريد التجريبي من suhaim@qissatec.com فقط، ولا تُرسل أي رسالة فعلية."
          trigger={
            <button
              type="button"
              className="btn-primary"
              disabled={!canEdit || !targets.length}
            >
              <Plus size={16} aria-hidden="true" /> طلب جديد
            </button>
          }
          disabled={!canEdit || !targets.length}
          submitLabel="فتح الطلب محليًا"
          fields={[
            {
              key: "targetId",
              label: "العقار / هدف التأجير الشاغر",
              type: "select",
              required: true,
              options: [
                { value: "", label: "اختر هدفًا شاغرًا" },
                ...availableTargetOptions,
              ],
            },
            {
              key: "applicantKind",
              label: "نوع المتقدم",
              type: "select",
              required: true,
              options: [
                { value: "individual", label: "فرد" },
                { value: "company", label: "شركة" },
              ],
            },
            {
              key: "name",
              label: "الاسم",
              required: true,
              placeholder: "اسم المتقدم أو الشركة",
            },
            {
              key: "email",
              label: "البريد الإلكتروني",
              required: true,
              placeholder: "name@example.com",
            },
            {
              key: "phone",
              label: "الهاتف",
              required: true,
              placeholder: "+974 …",
            },
            {
              key: "offerRent",
              label: "عرض الإيجار (ر.ق)",
              type: "number",
              required: true,
              placeholder: "0",
            },
            {
              key: "startDate",
              label: "تاريخ البدء المقترح",
              type: "date",
              required: true,
              defaultValue: dateAfter(asOf, 1),
            },
            {
              key: "endDate",
              label: "تاريخ النهاية المقترح",
              type: "date",
              required: true,
              defaultValue: dateAfter(asOf, 366),
            },
            {
              key: "message",
              label: "رسالة الطلب",
              type: "textarea",
              placeholder: "رسالة أو مرجع المحادثة (يُنشأ معرف الخيط تلقائيًا)",
            },
          ]}
          onSubmit={createApplication}
        />
      </PageHeader>

      <DemoNotice mode="interactive">
        المرسل المثبت للمعاينات هو{" "}
        <strong dir="ltr">{LETTING_TEST_EMAIL}</strong> فقط. لا SMTP ولا Gmail
        ولا تقويم خارجي ولا تسجيل دخول حقيقي؛ كل الرسائل أدناه معاينات «لم
        ترسل».
      </DemoNotice>

      {!canEdit && (
        <p className="letting-readonly" role="status">
          المعاينة الحالية للقراءة فقط؛ تستطيع فتح الحالات ومعاينة الوثائق، أما
          كل الأزرار التي تغيّر الطلب أو الموعد أو المستند فمعطلة.
        </p>
      )}
      {feedback && (
        <p className="letting-feedback" role="status">
          {feedback}
        </p>
      )}

      <div className="metric-grid letting-metrics">
        <Metric
          label="أهداف شاغرة في النطاق"
          value={String(targets.length)}
          detail="يظهر كل هدف تأجير شاغر مرة واحدة"
        />
        <Metric
          label="طلبات مفتوحة"
          value={String(
            applications.filter(
              row =>
                text(row.meta.stage) !== "completed" &&
                text(row.meta.stage) !== "rejected"
            ).length
          )}
          detail="لا تعني إشغالًا ماديًا"
        />
        <Metric
          label="طلبات مكتملة"
          value={String(
            applications.filter(row => text(row.meta.stage) === "completed")
              .length
          )}
          detail="بعد تأكيد أصول الموظف"
        />
      </div>

      <Panel
        title="الأهداف المتاحة"
        description={`النطاق الحالي: ${state.settings.portfolioId === "all" ? "جميع المحافظ" : "المحفظة المختارة"}. هذا الجدول قابل للنسخ إلى Excel: لا يعرض أرقام الهوية أو ملفات الإثبات.`}
      >
        {targets.length ? (
          <div
            className="letting-table-wrap"
            data-excel-table="available-letting-targets"
          >
            <table className="letting-table">
              <thead>
                <tr>
                  <th>العقار</th>
                  <th>هدف التأجير</th>
                  <th>رقم الوحدة/الهدف</th>
                  <th>الحالة التشغيلية</th>
                </tr>
              </thead>
              <tbody>
                {targets.map(target => {
                  const property = properties.find(
                    row => row.id === target.propertyId
                  );
                  return (
                    <tr key={target.id}>
                      <td>{property?.title ?? "عقار مرتبط"}</td>
                      <td>{target.title}</td>
                      <td className="letting-excel-number">
                        {text(target.meta.unitCode) ||
                          text(target.meta.code) ||
                          "-"}
                      </td>
                      <td>
                        <Badge tone="green">شاغر وقابل للطلب</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="لا توجد أهداف تأجير شاغرة في النطاق الحالي"
            description="غيّر نطاق المحفظة أو أضف عقارًا ووحدة متاحين من سجل العقارات."
          />
        )}
      </Panel>

      <Panel
        title="قائمة حالات التأجير"
        description="سجل تشغيلي مخصص للطلبات. لا تظهر فيه هوية المتقدم أو أرقام الشركة أو مرفقات الإثبات."
      >
        {applications.length ? (
          <div className="letting-table-wrap" data-excel-table="letting-cases">
            <table className="letting-table letting-cases-table">
              <thead>
                <tr>
                  <th>الطلب / المتقدم</th>
                  <th>الهدف</th>
                  <th>نوع المتقدم</th>
                  <th>عرض الإيجار</th>
                  <th>المدة المقترحة</th>
                  <th>المرحلة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {applications.map(application => {
                  const property = properties.find(
                    row => row.id === application.propertyId
                  );
                  const stage = (text(application.meta.stage) ||
                    "documents-requested") as LettingStage;
                  return (
                    <tr
                      key={application.id}
                      className={
                        application.id === selectedId
                          ? "letting-row--selected"
                          : ""
                      }
                    >
                      <td>
                        <strong>
                          {text(application.meta.name) || application.title}
                        </strong>
                        <small className="letting-case-ref">
                          #{application.id.slice(-6)}
                        </small>
                      </td>
                      <td>
                        <span>{property?.title ?? "عقار"}</span>
                        <small>
                          {text(application.meta.unitTitle) ||
                            text(application.meta.unitId) ||
                            "هدف تأجير"}
                        </small>
                      </td>
                      <td>
                        {applicantKindOf(application) === "company"
                          ? "شركة"
                          : "فرد"}
                      </td>
                      <td className="letting-excel-number">
                        {money(application.amountMinor)}
                      </td>
                      <td className="letting-excel-number">
                        {text(application.meta.startDate) || application.date}{" "}
                        <span>←</span> {text(application.meta.endDate) || "-"}
                      </td>
                      <td>
                        <Badge tone={stageTone(stage)}>
                          {LETTING_STAGE_LABELS[stage] ?? "بانتظار المراجعة"}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => setSelectedId(application.id)}
                        >
                          متابعة <ChevronLeft size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="لا توجد طلبات تأجير بعد"
            description="افتح طلبًا جديدًا من هدف شاغر، ثم أكمل ملف المتقدم ومستنداته دون أي إرسال حقيقي."
          />
        )}
      </Panel>

      {selectedApplication && selectedCase && (
        <section
          className="letting-case-workspace"
          aria-label={`حالة ${text(selectedApplication.meta.name) || selectedApplication.title}`}
        >
          <header className="letting-case-header">
            <div>
              <span className="eyebrow">حالة تأجير محلية</span>
              <h2>
                {text(selectedApplication.meta.name) ||
                  selectedApplication.title}
              </h2>
              <p className="muted">
                {selectedProperty?.title ?? "العقار"} -{" "}
                {text(selectedApplication.meta.unitTitle) || "هدف التأجير"} ·
                عرض {money(selectedApplication.amountMinor)}
              </p>
            </div>
            <div className="letting-case-header__actions">
              <Badge tone={stageTone(selectedStage)}>
                {LETTING_STAGE_LABELS[selectedStage]}
              </Badge>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedId("")}
              >
                إغلاق الحالة
              </button>
            </div>
          </header>
          <Stepper stage={selectedStage} />

          <div className="letting-case-columns">
            <div className="letting-stage-panels">
              {selectedStage === "documents-requested" && (
                <>
                  <Panel
                    title="1. ملف المتقدم"
                    description="الاسم ونوع المتقدم مقفلان من طلب البداية. الهاتف والبريد قابلان للتحديث؛ لا تعرض القائمة أرقام الهوية."
                  >
                    <form
                      className="letting-form"
                      onSubmit={saveProfile}
                      noValidate
                    >
                      <div className="letting-locked-fields">
                        <div>
                          <span>الاسم المقفل</span>
                          <strong>
                            {text(selectedApplication.meta.name) ||
                              selectedApplication.title}
                          </strong>
                        </div>
                        <div>
                          <span>نوع المتقدم المقفل</span>
                          <strong>
                            {selectedKind === "company" ? "شركة" : "فرد"}
                          </strong>
                        </div>
                      </div>
                      <div className="letting-form-grid">
                        <label className="form-label">
                          <span>
                            البريد الإلكتروني <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field"
                            type="email"
                            value={profileDraft.email ?? ""}
                            disabled={!canEdit}
                            onChange={event =>
                              setProfileDraft(draft => ({
                                ...draft,
                                email: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-label">
                          <span>
                            الهاتف <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field"
                            value={profileDraft.phone ?? ""}
                            disabled={!canEdit}
                            onChange={event =>
                              setProfileDraft(draft => ({
                                ...draft,
                                phone: event.target.value,
                              }))
                            }
                          />
                        </label>
                        {selectedKind === "individual" ? (
                          <label className="form-label span-all">
                            <span>
                              رقم البطاقة الشخصية{" "}
                              <i className="required-mark">*</i>
                            </span>
                            <input
                              className="field letting-sensitive-field"
                              value={profileDraft.identityNumber ?? ""}
                              disabled={!canEdit}
                              onChange={event =>
                                setProfileDraft(draft => ({
                                  ...draft,
                                  identityNumber: event.target.value,
                                }))
                              }
                            />
                            <small className="muted">
                              يُستخدم للتحقق الداخلي فقط ولا يظهر في جدول
                              الحالات.
                            </small>
                          </label>
                        ) : (
                          <>
                            <label className="form-label">
                              <span>
                                اسم الشركة <i className="required-mark">*</i>
                              </span>
                              <input
                                className="field"
                                value={profileDraft.companyName ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    companyName: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="form-label">
                              <span>
                                رقم الشركة <i className="required-mark">*</i>
                              </span>
                              <input
                                className="field letting-sensitive-field"
                                value={profileDraft.companyNumber ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    companyNumber: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="form-label">
                              <span>
                                رقم قيد المنشأة{" "}
                                <i className="required-mark">*</i>
                              </span>
                              <input
                                className="field letting-sensitive-field"
                                value={profileDraft.establishmentNumber ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    establishmentNumber: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="form-label">
                              <span>
                                المفوّض بالتوقيع{" "}
                                <i className="required-mark">*</i>
                              </span>
                              <input
                                className="field"
                                value={profileDraft.authorizedName ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    authorizedName: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="form-label">
                              <span>
                                العنوان <i className="required-mark">*</i>
                              </span>
                              <input
                                className="field"
                                value={profileDraft.companyAddress ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    companyAddress: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="form-label">
                              <span>الموقع الإلكتروني</span>
                              <input
                                className="field"
                                value={profileDraft.companyWebsite ?? ""}
                                disabled={!canEdit}
                                onChange={event =>
                                  setProfileDraft(draft => ({
                                    ...draft,
                                    companyWebsite: event.target.value,
                                  }))
                                }
                                placeholder="https://…"
                              />
                            </label>
                          </>
                        )}
                      </div>
                      <FieldError>{profileError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          className="btn-primary"
                          type="submit"
                          disabled={!canEdit}
                        >
                          <UserRound size={16} /> حفظ الملف
                        </button>
                      </div>
                    </form>
                  </Panel>
                  <Panel
                    title="2. مستندات المتقدم"
                    description={
                      selectedKind === "company"
                        ? "الشركة تحتاج البطاقة والكردت والسجل التجاري وقيد المنشأة."
                        : "الفرد يحتاج البطاقة الشخصية وتقرير الكردت فقط."
                    }
                  >
                    <LettingAttachments
                      applicationId={selectedApplication.id}
                      kinds={documentKinds}
                      disabled={!canEdit}
                    />
                  </Panel>
                  <Panel
                    title="3. انتقال للمراجعة"
                    description="بعد اكتمال الملف والمستندات، أضف معيار الإيجار والتقرير والدرجة صراحةً. لا يستنتج النظام القيم من المرفقات."
                  >
                    <form
                      className="letting-form"
                      onSubmit={submitReview}
                      noValidate
                    >
                      <div className="letting-form-grid">
                        <label className="form-label">
                          <span>الحد الأدنى للإيجار (ر.ق)</span>
                          <input
                            className="field"
                            inputMode="decimal"
                            value={reviewDraft.minimumRent}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                minimumRent: event.target.value,
                              }))
                            }
                            placeholder="اختياري؛ موجب إذا أدخل"
                          />
                        </label>
                        <label className="form-label">
                          <span>الحد الأدنى لدرجة الكردت</span>
                          <input
                            className="field"
                            inputMode="numeric"
                            value={reviewDraft.minimumCredit}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                minimumCredit: event.target.value,
                              }))
                            }
                            placeholder="اختياري"
                          />
                        </label>
                        <label className="form-label">
                          <span>درجة التقرير</span>
                          <input
                            className="field"
                            inputMode="numeric"
                            value={reviewDraft.creditScore}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                creditScore: event.target.value,
                              }))
                            }
                            placeholder="0 صالح إذا ذُكر المقياس"
                          />
                        </label>
                        <label className="form-label">
                          <span>حد مقياس الدرجة</span>
                          <input
                            className="field"
                            inputMode="numeric"
                            value={reviewDraft.scoreScale}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                scoreScale: event.target.value,
                              }))
                            }
                            placeholder="مثال 1000"
                          />
                        </label>
                        <label className="form-label">
                          <span>تاريخ تقرير الكردت</span>
                          <input
                            className="field letting-excel-number"
                            type="date"
                            max={asOf}
                            value={reviewDraft.reportDate}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                reportDate: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-label">
                          <span>مصدر التقرير</span>
                          <input
                            className="field"
                            value={reviewDraft.creditSource}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                creditSource: event.target.value,
                              }))
                            }
                            placeholder="اسم المصدر الذي راجعه الموظف"
                          />
                        </label>
                        <label className="form-label span-all">
                          <span>أقصى عمر للتقرير (يوم)</span>
                          <input
                            className="field"
                            inputMode="numeric"
                            value={reviewDraft.maximumAge}
                            disabled={!canEdit}
                            onChange={event =>
                              setReviewDraft(draft => ({
                                ...draft,
                                maximumAge: event.target.value,
                              }))
                            }
                            placeholder="اتركه فارغًا ليبقى غير محدد ويظهر احتياج المراجعة"
                          />
                        </label>
                      </div>
                      <label className="letting-check">
                        <input
                          type="checkbox"
                          checked={documentsReviewed}
                          disabled={!canEdit}
                          onChange={event =>
                            setDocumentsReviewed(event.target.checked)
                          }
                        />{" "}
                        راجع الموظف المستندات المطلوبة يدويًا
                      </label>
                      <label className="letting-check">
                        <input
                          type="checkbox"
                          checked={creditSourceReviewed}
                          disabled={!canEdit}
                          onChange={event =>
                            setCreditSourceReviewed(event.target.checked)
                          }
                        />{" "}
                        راجع الموظف مصدر التقرير يدويًا
                      </label>
                      <p className="letting-objective-note">
                        تقتصر أسباب التوصية على العرض والتقرير والمستندات وسلامة
                        البيانات؛ لا تستخدم الاسم أو العمر أو الجنسية أو أي سمة
                        ديموغرافية.
                      </p>
                      <FieldError>{reviewError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={!canEdit}
                        >
                          <ClipboardCheck size={16} /> حفظ المراجعة
                        </button>
                      </div>
                    </form>
                  </Panel>
                </>
              )}

              {selectedStage === "review" && (
                <>
                  <Panel
                    title="نتيجة التوصية الموضوعية"
                    description="توصية للمساعدة في المراجعة فقط؛ يبقى قرار الموظف مطلوبًا ولا يُستنتج من المرفقات أو السمات الشخصية."
                  >
                    {recommendation ? (
                      <div className="letting-recommendation">
                        <Badge
                          tone={
                            recommendation.outcome === "recommend-approve"
                              ? "green"
                              : recommendation.outcome === "recommend-reject"
                                ? "red"
                                : "amber"
                          }
                        >
                          {recommendation.outcome === "recommend-approve"
                            ? "يوصى بالموافقة"
                            : recommendation.outcome === "recommend-reject"
                              ? "يوصى بالرفض"
                              : "يحتاج مراجعة"}
                        </Badge>
                        <div>
                          <strong>الأسباب الموضوعية</strong>
                          <ul>
                            {recommendation.reasons.length ? (
                              recommendation.reasons.map(reason => (
                                <li key={reason}>{reason}</li>
                              ))
                            ) : (
                              <li>لم يسجل المحرك سببًا إيجابيًا بعد.</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <strong>النواقص المطلوب مراجعتها</strong>
                          <ul>
                            {recommendation.missing.length ? (
                              recommendation.missing.map(item => (
                                <li key={item}>{item}</li>
                              ))
                            ) : (
                              <li>لا توجد نواقص مسجلة.</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p className="muted">
                        لا تتوفر توصية بعد؛ راجع البيانات والمستندات.
                      </p>
                    )}
                  </Panel>
                  <Panel
                    title="قرار الموظف والعقد"
                    description="الموافقة لا تعني عقدًا قانونيًا أو توقيعًا. عند غياب قالب مطابق تستخدم مسودة نموذجية اختبارية موسومة بأنها غير معتمدة قانونيًا."
                  >
                    <form
                      className="letting-form"
                      onSubmit={submitDecision}
                      noValidate
                    >
                      <div className="letting-form-grid">
                        <label className="form-label">
                          <span>
                            القرار <i className="required-mark">*</i>
                          </span>
                          <select
                            className="field"
                            value={decisionDraft.decision}
                            disabled={!canEdit}
                            onChange={event =>
                              setDecisionDraft(draft => ({
                                ...draft,
                                decision: event.target.value as
                                  | "approve"
                                  | "reject",
                              }))
                            }
                          >
                            <option value="approve">موافقة الموظف</option>
                            <option value="reject">رفض الموظف</option>
                          </select>
                        </label>
                        <label className="form-label">
                          <span>قالب العقد الاختياري</span>
                          <select
                            className="field"
                            value={decisionDraft.templateId}
                            disabled={
                              !canEdit || decisionDraft.decision === "reject"
                            }
                            onChange={event =>
                              setDecisionDraft(draft => ({
                                ...draft,
                                templateId: event.target.value,
                              }))
                            }
                          >
                            <option value="">
                              {templates.length
                                ? "مسودة نموذجية اختبارية · غير معتمدة قانونيًا"
                                : "لا يوجد قالب مطابق · نموذج اختباري غير قانوني"}
                            </option>
                            {templates.map(template => (
                              <option value={template.id} key={template.id}>
                                {template.name}
                                {template.defaultRentMinor !== null
                                  ? ` · افتراضي ${money(template.defaultRentMinor)}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-label">
                          <span>
                            رقم العقار <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field letting-excel-number"
                            value={decisionDraft.propertyNumber}
                            disabled={!canEdit}
                            onChange={event =>
                              setDecisionDraft(draft => ({
                                ...draft,
                                propertyNumber: event.target.value,
                              }))
                            }
                            placeholder="أدخل الرقم يدويًا إذا لم يكن محفوظًا"
                          />
                        </label>
                        <label className="form-label">
                          <span>
                            رقم الكهرباء <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field letting-excel-number"
                            value={decisionDraft.electricityNumber}
                            disabled={!canEdit}
                            onChange={event =>
                              setDecisionDraft(draft => ({
                                ...draft,
                                electricityNumber: event.target.value,
                              }))
                            }
                            placeholder="أدخل الرقم يدويًا إذا لم يكن محفوظًا"
                          />
                        </label>
                        <label className="form-label span-all">
                          <span>
                            سبب القرار البشري <i className="required-mark">*</i>
                          </span>
                          <textarea
                            className="field"
                            rows={3}
                            value={decisionDraft.reason}
                            disabled={!canEdit}
                            onChange={event =>
                              setDecisionDraft(draft => ({
                                ...draft,
                                reason: event.target.value,
                              }))
                            }
                            placeholder="اكتب سبب القرار، واذكر سبب تجاوز التوصية أو اختلاف القالب إن وجد"
                          />
                        </label>
                      </div>
                      {!templates.length &&
                        decisionDraft.decision === "approve" && (
                          <p className="letting-warning">
                            لا يوجد قالب محفوظ مطابق؛ ستنشأ مسودة اختبارية صريحة
                            غير معتمدة قانونيًا، وليست اتفاقًا قانونيًا.
                          </p>
                        )}
                      {hasTemplateRentMismatch && (
                        <p className="letting-warning">
                          إيجار القالب الافتراضي (
                          {money(selectedTemplate!.defaultRentMinor!)}) يختلف عن
                          العرض الفعلي ({money(selectedApplication.amountMinor)}
                          ). لا يمر هذا الاختلاف بصمت: سجل مراجعة بشرية صريحة،
                          ثم صحح القالب أو اختر قالبًا متسقًا قبل اعتماد
                          المسودة.
                        </p>
                      )}
                      <FieldError>{decisionError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          type="submit"
                          className={
                            decisionDraft.decision === "reject"
                              ? "btn-secondary"
                              : "btn-primary"
                          }
                          disabled={!canEdit}
                        >
                          <ShieldCheck size={16} /> تثبيت القرار
                        </button>
                      </div>
                    </form>
                  </Panel>
                </>
              )}

              {selectedStage === "contract-issued" && (
                <>
                  <Panel
                    title="معاينة العقد بعد قرار الموافقة"
                    description="تظهر البيانات المتفق عليها: الطرف ووسائل الاتصال والإيجار وفترة العقد. المعاينة ليست توقيعًا أو تسجيلًا قانونيًا."
                  >
                    <div className="letting-contract-summary">
                      <div>
                        <span>الطرف</span>
                        <strong>
                          {text(selectedApplication.meta.name) ||
                            selectedApplication.title}
                        </strong>
                      </div>
                      <div>
                        <span>الاتصال</span>
                        <strong dir="ltr">
                          {text(selectedProfile?.meta.email) ||
                            text(selectedApplication.meta.email)}{" "}
                          ·{" "}
                          {text(selectedProfile?.meta.phone) ||
                            text(selectedApplication.meta.phone)}
                        </strong>
                      </div>
                      <div>
                        <span>الإيجار والفترة</span>
                        <strong>
                          {money(selectedApplication.amountMinor)} ·{" "}
                          {text(selectedApplication.meta.startDate)} ←{" "}
                          {text(selectedApplication.meta.endDate)}
                        </strong>
                      </div>
                    </div>
                    {contract ? (
                      <LettingContractPreview
                        applicationId={selectedApplication.id}
                      />
                    ) : (
                      <p className="letting-warning">
                        تعذرت معاينة الوثيقة الحالية؛ لا تتجاوز هذه الخطوة حتى
                        يصحح الموظف بيانات العقد.
                      </p>
                    )}
                  </Panel>
                  <Panel
                    title="العقد الموقّع وصور الشيكات"
                    description="ارفع نسخة العقد الموقعة وصور الشيكات محليًا. لا يُعلن ذلك توقيعًا قانونيًا أو تحصيلًا ماليًا."
                  >
                    <LettingAttachments
                      applicationId={selectedApplication.id}
                      kinds={["signed-contract", "cheque-image"]}
                      disabled={!canEdit}
                    />
                  </Panel>
                  <Panel
                    title="جدول الشيكات والاستلام"
                    description="تأتي المواعيد والقيم من دورة العقد المحسوبة في المحرك؛ لا تفترض الشاشة 12 شهرًا ولا تستخدم أرقامًا عائمة."
                  >
                    <form
                      className="letting-form"
                      onSubmit={submitReturns}
                      noValidate
                    >
                      {cheques.length ? (
                        <div className="letting-cheque-grid">
                          <div className="letting-cheque-grid__head">
                            <span>الاستحقاق</span>
                            <span>رقم الشيك</span>
                            <span>البنك</span>
                            <span>المبلغ (ر.ق)</span>
                          </div>
                          {cheques.map(cheque => (
                            <div
                              className="letting-cheque-grid__row"
                              key={cheque.id}
                            >
                              <input
                                className="field letting-excel-number"
                                type="date"
                                value={cheque.dueDate}
                                disabled={!canEdit}
                                onChange={event =>
                                  setCheques(rows =>
                                    rows.map(row =>
                                      row.id === cheque.id
                                        ? {
                                            ...row,
                                            dueDate: event.target.value,
                                          }
                                        : row
                                    )
                                  )
                                }
                                aria-label={`استحقاق شيك ${cheque.id}`}
                              />
                              <input
                                className="field"
                                value={cheque.number}
                                disabled={!canEdit}
                                onChange={event =>
                                  setCheques(rows =>
                                    rows.map(row =>
                                      row.id === cheque.id
                                        ? { ...row, number: event.target.value }
                                        : row
                                    )
                                  )
                                }
                                aria-label={`رقم شيك ${cheque.dueDate}`}
                              />
                              <input
                                className="field"
                                value={cheque.bank}
                                disabled={!canEdit}
                                onChange={event =>
                                  setCheques(rows =>
                                    rows.map(row =>
                                      row.id === cheque.id
                                        ? { ...row, bank: event.target.value }
                                        : row
                                    )
                                  )
                                }
                                aria-label={`بنك شيك ${cheque.dueDate}`}
                              />
                              <input
                                className="field letting-excel-number"
                                inputMode="decimal"
                                value={cheque.amount}
                                disabled={!canEdit}
                                onChange={event =>
                                  setCheques(rows =>
                                    rows.map(row =>
                                      row.id === cheque.id
                                        ? { ...row, amount: event.target.value }
                                        : row
                                    )
                                  )
                                }
                                aria-label={`مبلغ شيك ${cheque.dueDate}`}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="letting-warning">
                          لا توجد دورة قابلة للتجهيز. راجع تاريخي البداية
                          والنهاية والعقد قبل الاستمرار.
                        </p>
                      )}
                      <p className="letting-received-note">
                        <Landmark size={16} aria-hidden="true" />{" "}
                        <strong>مستلم لا محصّل:</strong> حفظ صور الشيكات وجدولها
                        لا ينشئ قبضًا نقديًا ولا فاتورة تلقائية.
                      </p>
                      <FieldError>{returnsError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          className="btn-primary"
                          type="submit"
                          disabled={!canEdit || !cheques.length}
                        >
                          <FileCheck2 size={16} /> حفظ المرتجعات واستلامها
                        </button>
                      </div>
                    </form>
                  </Panel>
                </>
              )}

              {selectedStage === "returns-received" && (
                <>
                  <Panel
                    title="إتاحة الموظف"
                    description="أضف نافذة موظف بتوقيت قطر (+03:00). يمنع المحرك التداخل حتى عبر المحافظ؛ لا يوجد تقويم خارجي."
                  >
                    <form
                      className="letting-form"
                      onSubmit={addSlot}
                      noValidate
                    >
                      <div className="letting-form-grid">
                        <label className="form-label">
                          <span>
                            الموظف <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field"
                            value={slotDraft.employee}
                            disabled={!canEdit}
                            onChange={event =>
                              setSlotDraft(draft => ({
                                ...draft,
                                employee: event.target.value,
                              }))
                            }
                            placeholder="اسم الموظف"
                          />
                        </label>
                        <label className="form-label">
                          <span>
                            من (+03:00) <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field letting-excel-number"
                            type="datetime-local"
                            min={`${asOf}T00:00`}
                            value={slotDraft.start}
                            disabled={!canEdit}
                            onChange={event =>
                              setSlotDraft(draft => ({
                                ...draft,
                                start: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-label">
                          <span>
                            إلى (+03:00) <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field letting-excel-number"
                            type="datetime-local"
                            min={`${asOf}T00:00`}
                            value={slotDraft.end}
                            disabled={!canEdit}
                            onChange={event =>
                              setSlotDraft(draft => ({
                                ...draft,
                                end: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <FieldError>{slotError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          className="btn-secondary"
                          type="submit"
                          disabled={!canEdit}
                        >
                          <Clock3 size={16} /> إضافة إتاحة
                        </button>
                      </div>
                    </form>
                  </Panel>
                  <Panel
                    title="حجز موعد التسليم"
                    description="اختر نافذة مستقبلية غير محجوزة. يتحقق المحرك من التداخل والحجز المكرر في انتقال ذري."
                  >
                    <div className="letting-booking-row">
                      <select
                        className="field"
                        value={selectedSlotId}
                        disabled={!canEdit}
                        onChange={event =>
                          setSelectedSlotId(event.target.value)
                        }
                      >
                        <option value="">اختر موعدًا متاحًا</option>
                        {futureSlots.map(slot => (
                          <option key={slot.id} value={slot.id}>
                            {text(slot.meta.employee) || slot.title} -{" "}
                            {datetimeInput(slot.meta.start)} إلى{" "}
                            {datetimeInput(slot.meta.end)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={!canEdit || !selectedSlotId}
                        onClick={bookSlot}
                      >
                        <CalendarDays size={16} /> حجز الموعد
                      </button>
                    </div>
                    {!futureSlots.length && (
                      <p className="muted small">
                        لا توجد إتاحة مستقبلية في نطاق العرض؛ أضف نافذة موظف
                        أولًا.
                      </p>
                    )}
                    <FieldError>{slotError}</FieldError>
                  </Panel>
                </>
              )}

              {selectedStage === "appointment-booked" && (
                <>
                  <Panel
                    title="صور حالة العقار وإقرار المستأجر"
                    description="الدليل المطلوب هنا هو صور المستأجر لحالة العقار فقط. العبارة التالية صريحة: محاكاة إدخال المستأجر، وليست بوابة مستأجر حقيقية."
                  >
                    <p className="letting-tenant-simulation">
                      محاكاة إدخال المستأجر: يرفع الموظف صور الحالة نيابةً عن
                      النموذج، دون حساب أو تسجيل دخول للمستأجر.
                    </p>
                    <LettingAttachments
                      applicationId={selectedApplication.id}
                      kinds={["handover-photo"]}
                      disabled={!canEdit}
                    />
                    <form
                      className="letting-form"
                      onSubmit={submitHandover}
                      noValidate
                    >
                      <div className="letting-form-grid">
                        <label className="form-label">
                          <span>
                            تاريخ معاينة الحالة{" "}
                            <i className="required-mark">*</i>
                          </span>
                          <input
                            className="field letting-excel-number"
                            type="date"
                            value={handoverDraft.date}
                            disabled={!canEdit}
                            onChange={event =>
                              setHandoverDraft(draft => ({
                                ...draft,
                                date: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-label span-all">
                          <span>
                            ملاحظات الحالة <i className="required-mark">*</i>
                          </span>
                          <textarea
                            className="field"
                            rows={4}
                            value={handoverDraft.notes}
                            disabled={!canEdit}
                            onChange={event =>
                              setHandoverDraft(draft => ({
                                ...draft,
                                notes: event.target.value,
                              }))
                            }
                            placeholder="سجل وصفًا واقعيًا لحالة التسليم"
                          />
                        </label>
                      </div>
                      <label className="letting-check">
                        <input
                          type="checkbox"
                          checked={handoverDraft.declaration}
                          disabled={!canEdit}
                          onChange={event =>
                            setHandoverDraft(draft => ({
                              ...draft,
                              declaration: event.target.checked,
                            }))
                          }
                        />{" "}
                        إقرار المستأجر بمحاكاة إدخال الحالة
                      </label>
                      <FieldError>{handoverError}</FieldError>
                      <div className="letting-form-actions">
                        <button
                          className="btn-primary"
                          type="submit"
                          disabled={!canEdit}
                        >
                          <Send size={16} /> حفظ إدخال الحالة
                        </button>
                      </div>
                    </form>
                  </Panel>
                </>
              )}

              {selectedStage === "handover-submitted" && (
                <Panel
                  title="التأكيد النهائي للموظف"
                  description="بعد صور المستأجر وإقراره، يؤكد الموظف أنه استلم أصول العقد والشيكات. عندها فقط يفعّل المحرك العقد وتطبيق القيود المتصلة دون تحصيل نقدي."
                >
                  <form className="letting-form" onSubmit={complete} noValidate>
                    <div className="letting-final-confirmation">
                      <label className="letting-check">
                        <input
                          type="checkbox"
                          checked={originalContractReceived}
                          disabled={!canEdit}
                          onChange={event =>
                            setOriginalContractReceived(event.target.checked)
                          }
                        />{" "}
                        استلم الموظف أصل العقد
                      </label>
                      <label className="letting-check">
                        <input
                          type="checkbox"
                          checked={originalChequesReceived}
                          disabled={!canEdit}
                          onChange={event =>
                            setOriginalChequesReceived(event.target.checked)
                          }
                        />{" "}
                        استلم الموظف أصول الشيكات
                      </label>
                      <label className="form-label">
                        <span>
                          تاريخ الاستلام النهائي{" "}
                          <i className="required-mark">*</i>
                        </span>
                        <input
                          className="field letting-excel-number"
                          type="date"
                          value={receivedDate}
                          disabled={!canEdit}
                          onChange={event =>
                            setReceivedDate(event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <FieldError>{handoverError}</FieldError>
                    <div className="letting-form-actions">
                      <button
                        className="btn-primary"
                        type="submit"
                        disabled={
                          !canEdit ||
                          !originalContractReceived ||
                          !originalChequesReceived
                        }
                      >
                        <CheckCircle2 size={16} /> تأكيد استلام العقد الأصلي
                        والشيكات
                      </button>
                    </div>
                  </form>
                </Panel>
              )}

              {selectedStage === "completed" && (
                <Panel
                  title="اكتمل التأجير"
                  description="فعّل المحرك العقد بعد الخطوات المطلوبة. لا تنشئ هذه الشاشة فاتورة تلقائيًا ولا تسجل نقدًا بدل الشيكات."
                >
                  <div className="letting-complete-links">
                    <a className="btn-primary" href="/leases">
                      فتح العقود
                    </a>
                    <a className="btn-secondary" href="/collections">
                      فتح التحصيلات
                    </a>
                    <a className="btn-secondary" href="/billing">
                      فتح الفوترة
                    </a>
                    <a
                      className="btn-secondary"
                      href={`/properties/${selectedApplication.propertyId}`}
                    >
                      فتح العقار
                    </a>
                  </div>
                </Panel>
              )}

              {selectedStage === "rejected" && (
                <Panel
                  title="طلب مرفوض"
                  description="حُفظ سبب قرار الموظف في السجل المحلي. لا تحرر بيانات الملف أو الوثائق بعد القرار حتى لا تختلف عن المراجعة المعتمدة."
                >
                  <p className="letting-rejected-note">
                    راجع سجل معاينات البريد أدناه إن احتجت إلى قراءة رسالة
                    الرفض؛ تظل الحالة «لم ترسل» ولا يوجد أي إرسال خارجي.
                  </p>
                </Panel>
              )}
            </div>

            <aside className="letting-case-sidebar">
              <Panel
                title="ملخص الطلب"
                description="لا يعرض الملخص أرقام الهوية أو مرفقات الإثبات."
              >
                <dl className="letting-summary-list">
                  <div>
                    <dt>نوع المتقدم</dt>
                    <dd>{selectedKind === "company" ? "شركة" : "فرد"}</dd>
                  </div>
                  <div>
                    <dt>عرض الإيجار</dt>
                    <dd className="letting-excel-number">
                      {money(selectedApplication.amountMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt>الفترة</dt>
                    <dd className="letting-excel-number">
                      {text(selectedApplication.meta.startDate)} ←{" "}
                      {text(selectedApplication.meta.endDate)}
                    </dd>
                  </div>
                  <div>
                    <dt>الحجز</dt>
                    <dd>
                      {[
                        "contract-issued",
                        "returns-received",
                        "appointment-booked",
                        "handover-submitted",
                      ].includes(selectedStage)
                        ? "محجوز للطلب، وليس إشغالًا ماديًا"
                        : selectedStage === "completed"
                          ? "مفعل بعد الإكمال"
                          : "غير محجوز"}
                    </dd>
                  </div>
                </dl>
              </Panel>
              <Panel
                title="معاينات البريد"
                description={`المرسل: ${LETTING_TEST_EMAIL}. السجل للعرض فقط ولا يرسل بريدًا.`}
              >
                {selectedCase.emails.length ? (
                  <ul className="letting-mail-list">
                    {selectedCase.emails.map(email => (
                      <li key={email.id}>
                        <div>
                          <MailCheck size={15} aria-hidden="true" />
                          <strong>{email.title || "معاينة رسالة"}</strong>
                        </div>
                        <span>
                          إلى: {text(email.meta.to) || "المتقدم"} · لم ترسل
                        </span>
                        <p>{caseMailBody(email)}</p>
                        {text(email.meta.contractDocumentId) && (
                          <small>
                            مرجع العقد: {text(email.meta.contractDocumentId)}
                          </small>
                        )}
                        {text(email.meta.slotStart) && (
                          <small>
                            نافذة الموعد: {text(email.meta.slotStart)} ←{" "}
                            {text(email.meta.slotEnd)}
                          </small>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">
                    لا توجد معاينات بريد بعد. ستبقى جميع الرسائل المستقبلية في
                    هذا السجل بوصف «لم ترسل».
                  </p>
                )}
              </Panel>
              {contract && (
                <Panel title="مرجع العقد">
                  <p className="letting-contract-ref">
                    <FileText size={16} aria-hidden="true" />{" "}
                    {contract.document.id}
                  </p>
                </Panel>
              )}
              {selectedCase.slot && (
                <Panel title="نافذة الموعد">
                  <p className="letting-calendar-window">
                    <CalendarDays size={16} aria-hidden="true" />{" "}
                    {text(selectedCase.slot.meta.start)} ←{" "}
                    {text(selectedCase.slot.meta.end)}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      try {
                        downloadLettingCalendarInvite(
                          selectedCase.slot!,
                          selectedApplication!
                        );
                      } catch (error) {
                        setFeedback(
                          error instanceof Error
                            ? error.message
                            : "تعذر تنزيل دعوة الموعد"
                        );
                      }
                    }}
                  >
                    تنزيل دعوة الموعد ICS
                  </button>
                  <p className="muted small">
                    تنزيل محلي فقط؛ لا إرسال دعوة ولا مزامنة مع تقويم خارجي.
                  </p>
                </Panel>
              )}
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}
