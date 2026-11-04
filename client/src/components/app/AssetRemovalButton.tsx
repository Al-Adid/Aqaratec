import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  checkAssetRemoval,
  removeUnusedAsset,
  type RemovableAssetKind,
} from "@/lib/prototype-asset-removal";
import { FormDialog } from "./Primitives";
export function AssetRemovalButton({
  kind,
  id,
  title,
  redirectTo,
}: {
  kind: RemovableAssetKind;
  id: string;
  title: string;
  redirectTo?: string;
}) {
  const { state, canEdit, commitTransition } = usePrototype();
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const check = checkAssetRemoval(state, kind, id);
  const label = kind === "properties" ? "حذف العقار" : "حذف المحفظة";
  return (
    <span className="asset-removal-action" onClick={e => e.stopPropagation()}>
      <FormDialog
        title={label}
        description={`${title} · ${check.reason}`}
        trigger={
          <button
            type="button"
            className="btn-ghost"
            disabled={!canEdit}
            aria-label={`${label}: ${title}`}
          >
            <Trash2 size={14} />
            {label}
          </button>
        }
        fields={[
          {
            key: "confirmation",
            label: "اكتب اسم السجل كما هو لتأكيد الحذف",
            required: true,
            placeholder: title,
          },
        ]}
        submitLabel={label}
        onSubmit={values => {
          if (values.confirmation !== title)
            throw new Error("الاسم لا يطابق السجل؛ لم يُحذف شيء.");
          commitTransition(current => removeUnusedAsset(current, kind, id));
          setMessage("حُذف السجل غير المرتبط من مساحة التجربة.");
          if (redirectTo) navigate(redirectTo);
        }}
      />
      {!check.allowed && (
        <small className="muted asset-removal-reason">{check.reason}</small>
      )}
      {message && <small role="status">{message}</small>}
    </span>
  );
}
