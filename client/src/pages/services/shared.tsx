import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, Panel, type FormField } from "@/components/app/Primitives";
import { usePrototype } from "@/contexts/PrototypeContext";
import { approveMaintenanceRequest } from "@/lib/prototype-maintenance";
import {
  PROTOTYPE_DATE,
  money,
  metadata,
  toMinor,
  type DemoEntity,
  type EntityKind,
  type NewEntity,
} from "@shared/prototype";

export const TODAY = PROTOTYPE_DATE;

export function toneFor(
  status: string
): "green" | "amber" | "red" | "blue" | "gray" {
  const value = status.toLowerCase();
  if (/(مغلق|منجز|موقّع|مسجّل|مقبول|محصّل|مكتمل|مرسل|تمت)/.test(value))
    return "green";
  if (/(مرفوض|متأخر|حرج|فشل|نزاع|مرتجع)/.test(value)) return "red";
  if (/(بانتظار|معلّق|قيد|قادم|منتهي|مطلوب|مسودة)/.test(value)) return "amber";
  if (/(محاكى|مجدول|معاينة|جديد|مفتوح|مرشح)/.test(value)) return "blue";
  return "gray";
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneFor(status)}>{status || "غير محدد"}</Badge>;
}

export function metadataText(entity: DemoEntity, key: string, fallback = "-") {
  return metadata(entity, key, fallback) || fallback;
}

export function dateText(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function parseAmount(value: string, fallback = 0) {
  if (!value.trim()) return fallback;
  try {
    return toMinor(value);
  } catch {
    return fallback;
  }
}

/**
 * Stage-one service forms begin with an explicit property. Their portfolio is
 * derived by the transition from that property; neither an "all" value nor a
 * first-portfolio fallback is ever submitted. A unit remains optional but is
 * always submitted as an ID, then verified against the selected property.
 */
export function scopedForm(
  properties: DemoEntity[],
  units: DemoEntity[]
): FormField[] {
  const visiblePropertyIds = new Set(properties.map(property => property.id));
  return [
    {
      key: "propertyId",
      label: "العقار المرتبط",
      type: "select",
      required: true,
      options: [
        {
          value: "",
          label: "اختر العقار صراحةً · تُستخلص المحفظة منه",
        },
        ...properties.map(property => ({
          value: property.id,
          label: property.title,
        })),
      ],
    },
    {
      key: "unitId",
      label: "الوحدة التابعة للعقار (اختيارية)",
      type: "select",
      options: [
        { value: "", label: "بدون وحدة · طلب على العقار" },
        ...units
          .filter(unit => visiblePropertyIds.has(unit.propertyId))
          .map(unit => {
            const property = properties.find(row => row.id === unit.propertyId);
            return {
              value: unit.id,
              label: `${property?.title ?? "عقار"} · ${unit.title}`,
            };
          }),
      ],
    },
  ];
}

export function baseInput(
  title: string,
  context: ReturnType<typeof usePrototype>,
  extra: Partial<DemoEntity> = {}
): NewEntity {
  return {
    title,
    subtitle: "سجل تجريبي محلي",
    portfolioId: context.state.settings.portfolioId || "portfolio-demo",
    propertyId: "",
    status: "جديد",
    date: TODAY,
    amountMinor: 0,
    currency: "QAR",
    meta: {},
    ...extra,
  };
}

/** Local action helper: every mutation logs a trace and displays an on-page result. */
export function useServiceActions(scope: string) {
  const prototype = usePrototype();
  const [feedback, setFeedback] = useState("لا توجد عملية حديثة في هذا القسم.");

  const show = (message: string, detail?: string) => {
    setFeedback(message);
    prototype.log(message, detail ?? scope);
  };

  const add = (
    kind: EntityKind,
    title: string,
    input: Partial<DemoEntity> = {}
  ) => {
    if (!prototype.canEdit) {
      show(
        "المعاينة الحالية للقراءة فقط؛ لم يُنشأ أي سجل.",
        `${scope} · يتاح التحرير لدور المشغّل فقط.`
      );
      return undefined;
    }
    const record = prototype.add(kind, baseInput(title, prototype, input));
    show(`تم إنشاء «${title}» محليًا.`, `${scope} · ${kind} · ${record.id}`);
    return record;
  };

  const patch = (
    kind: EntityKind,
    id: string,
    update: Partial<DemoEntity>,
    message: string
  ) => {
    if (!prototype.canEdit) {
      show(
        "المعاينة الحالية للقراءة فقط؛ لم يتغير السجل.",
        `${scope} · ${message}`
      );
      return;
    }
    prototype.patch(kind, id, update);
    show(message, `${scope} · ${kind} · ${id}`);
  };

  const status = (
    kind: EntityKind,
    id: string,
    nextStatus: string,
    message: string
  ) => {
    if (!prototype.canEdit) {
      show(
        "المعاينة الحالية للقراءة فقط؛ لم تتغير الحالة.",
        `${scope} · ${message}`
      );
      return;
    }
    prototype.setStatus(kind, id, nextStatus);
    show(message, `${scope} · ${kind} · ${id}`);
  };

  /** Owner preview may approve only a request already pending approval. */
  const approveMaintenance = (maintenanceId: string) => {
    const approved = approveMaintenanceRequest(prototype.state, maintenanceId);
    // PrototypeContext deliberately permits this status-only owner decision,
    // while continuing to block all other owner edits and transition writes.
    prototype.patch("maintenance", maintenanceId, {
      status: approved.result.status,
    });
    show(
      "سُجل اعتماد المالك لطلب الصيانة؛ لا ينشئ القرار تكلفة أو مصروفًا أو دفعًا.",
      `${scope} · maintenance · ${maintenanceId}`
    );
    return approved.result;
  };

  /** Approval in the owner portal is deliberately isolated from any general edit capability. */
  const ownerApproval = (title: string, detail: string) => {
    if (prototype.state.settings.role !== "owner") {
      show("الموافقة المستقلة متاحة فقط عند معاينة دور المالك.", scope);
      return;
    }
    // The context deliberately permits an owner only to change the status of a pending,
    // pre-existing approval decision. It must not create a general-edit escape hatch.
    const record = prototype
      .filtered("distributions")
      .find(item => item.status === "بانتظار الاعتماد");
    if (!record) {
      show(
        "لا يوجد قرار مستقل بانتظار المالك ضمن هذا النطاق؛ لم يتغير أي سجل.",
        `${scope} · ${title}`
      );
      return;
    }
    prototype.patch("distributions", record.id, { status: "معتمد" });
    show(
      "سُجلت موافقة مالك مستقلة على قرار قائم؛ لم يتغير عقد أو دفعة أو حق تحرير عام.",
      `${scope} · ${record.id} · ${detail}`
    );
  };

  return {
    ...prototype,
    feedback,
    show,
    add,
    patch,
    status,
    approveMaintenance,
    ownerApproval,
  };
}

export function ActionResult({ children }: { children: ReactNode }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {children}
    </p>
  );
}

export function LockedAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick}>
      {label}
    </button>
  );
}

export function ReadOnlyPanel({
  title = "حدود معاينة الدور",
}: {
  title?: string;
}) {
  return (
    <Panel title={title}>
      <p className="muted">
        هذه معاينة سيناريو وليست جلسة هوية أو إثبات صلاحية خادم. دور المالك قارئ
        افتراضيًا؛ موافقته، إن ظهرت، قرار مستقل لا يمنح تعديلًا عامًا.
      </p>
    </Panel>
  );
}

export function StatLine({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span>{status ? <StatusBadge status={status} /> : value}</span>
    </div>
  );
}

export { money };
