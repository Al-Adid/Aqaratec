import type { DemoEntity } from "@shared/prototype";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  unitDisplayReference,
  updateUnitIdentifier,
} from "@/lib/prototype-unit-identifiers";
import { FormDialog } from "./Primitives";

function existingCode(unit: DemoEntity): string {
  const unitCode = unit.meta.unitCode;
  if (typeof unitCode === "string") return unitCode;
  const code = unit.meta.code;
  return typeof code === "string" ? code : "";
}

/** Edits only the local, human-facing unit display code in the prototype. */
export function UnitSerialEditor({ unit }: { unit: DemoEntity }) {
  const { canEdit, commitTransition, state } = usePrototype();
  const reference = unitDisplayReference(state.entities, unit.id);

  return (
    <FormDialog
      title="تعديل رقم/رمز الوحدة"
      description={`${reference ? `المرجع المعروض: ${reference}. ` : ""}هذا رمز عرض مولّد داخل النموذج، وليس رقمًا حكوميًا. لا تتغير العقود أو المستندات التاريخية الصادرة.`}
      trigger={
        <button className="btn-secondary" type="button" disabled={!canEdit}>
          تعديل رقم/رمز الوحدة
        </button>
      }
      disabled={!canEdit}
      fields={[
        {
          key: "unitCode",
          label: "رقم/رمز الوحدة",
          type: "text",
          required: true,
        },
      ]}
      initialValues={{ unitCode: existingCode(unit) }}
      submitLabel="حفظ رقم/رمز الوحدة"
      onSubmit={values =>
        commitTransition(current =>
          updateUnitIdentifier(current, unit.id, values.unitCode ?? "")
        )
      }
    />
  );
}

export default UnitSerialEditor;
