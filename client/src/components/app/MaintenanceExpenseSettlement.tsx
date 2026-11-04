import { useState } from "react";
import { usePrototype } from "@/contexts/PrototypeContext";
import { FormDialog } from "./Primitives";
import { scenarioDate } from "@shared/prototype-clock";
import { money, type DemoEntity } from "@shared/prototype";
export function MaintenanceExpenseSettlement({
  expense,
}: {
  expense: DemoEntity;
}) {
  const ctx = usePrototype();
  const [requestId] = useState(() => `m-pay-${crypto.randomUUID()}`);
  if (expense.status === "مسدد")
    return (
      <span className="muted small">
        مسدد محليًا · {String(expense.meta.paidDate ?? "تاريخ غير مسجل")}
      </span>
    );
  return (
    <FormDialog
      title="تسجيل سداد مصروف الصيانة"
      description={`المبلغ ${money(expense.amountMinor)}. هذا إثبات تسوية محلية صريح ولا يحوّل أي أموال ولا يتصل ببنك أو مزود.`}
      trigger={
        <button
          className="btn-secondary"
          disabled={!ctx.canEdit || expense.status !== "غير مسدد"}
        >
          تسجيل سداد محلي
        </button>
      }
      fields={[
        {
          key: "date",
          label: "تاريخ السداد",
          type: "date",
          required: true,
          defaultValue: scenarioDate(ctx.state),
        },
        {
          key: "method",
          label: "طريقة السداد المسجلة",
          type: "select",
          required: true,
          options: [
            { value: "نقد", label: "نقد" },
            { value: "تحويل", label: "تحويل" },
          ],
        },
        {
          key: "confirm",
          label: "التأكيد",
          type: "select",
          required: true,
          options: [
            { value: "", label: "اختر التأكيد" },
            { value: "confirm", label: "أؤكد تسجيل تسوية محلية لهذا المصروف" },
          ],
        },
      ]}
      submitLabel="تأكيد تسجيل السداد محليًا"
      onSubmit={v => {
        if (v.confirm !== "confirm") throw new Error("التأكيد الصريح مطلوب");
        ctx.payMaintenanceExpense(expense.id, v.date, v.method, requestId);
      }}
    />
  );
}
