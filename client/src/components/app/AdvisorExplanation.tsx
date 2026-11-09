import { useState } from "react";
import { Sparkles, LogIn } from "lucide-react";
import { useLocation } from "wouter";
import { usePrototype } from "@/contexts/PrototypeContext";
import { trpc } from "@/lib/trpc";
import type { AdvisorProfile } from "@shared/advisor-types";
import { Panel } from "./Primitives";

export function AdvisorExplanation({ profile }: { profile: AdvisorProfile }) {
  const [, navigate] = useLocation();
  const { state } = usePrototype();
  const auth = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const [consent, setConsent] = useState(false);
  const explain = trpc.advisor.explain.useMutation();
  const fingerprint = JSON.stringify({ profile, entities: state.entities });
  const [explainedFingerprint, setExplainedFingerprint] = useState("");
  const stale = explain.data && fingerprint !== explainedFingerprint;
  const submit = async () => {
    setExplainedFingerprint(fingerprint);
    try {
      await explain.mutateAsync({ profile, snapshot: state, consent: true });
    } catch {
      /* API error appears below; no pretend replacement. */
    }
  };
  return (
    <Panel
      title="شرح وضعك بلغة بسيطة"
      description="اختياري: الذكاء الاصطناعي يشرح نتيجة المحرك فقط، ولا يغيّر الحسابات أو يبحث عن أسعار."
    >
      {!auth.data ? (
        <div>
          <p className="muted small">
            الرحلة والحسابات تعمل محليًا. الشرح الذكي يتطلب دخولًا حقيقيًا
            لحماية خدمة المشروع.
          </p>
          <button
            className="btn-secondary"
            disabled={auth.isLoading}
            onClick={() => navigate("/login")}
          >
            <LogIn size={16} /> تسجيل الدخول للشرح
          </button>
        </div>
      ) : (
        <>
          <label
            className="small"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
            />
            أوافق على إرسال ملخص الأرقام الصورية لهذه المحفظة لخدمة الشرح؛ لا
            مستندات أو أسماء أو حسابات بنكية.
          </label>
          <button
            className="btn-secondary"
            disabled={
              !consent ||
              explain.isPending ||
              ["tenant", "vendor"].includes(state.settings.role)
            }
            onClick={() => void submit()}
          >
            <Sparkles size={16} />
            {explain.isPending ? "جارٍ شرح النتائج…" : "اشرح لي النتيجة"}
          </button>
          {explain.error && (
            <p role="alert" className="muted">
              {explain.error.message}
            </p>
          )}
          {stale && (
            <p className="muted">
              تغيّرت البيانات بعد هذا الشرح؛ أعد الشرح قبل الاعتماد عليه.
            </p>
          )}
          {explain.data && (
            <div
              aria-live="polite"
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, marginTop: 16 }}
            >
              {explain.data.text}
              <p className="muted small">
                شرح مولد · {explain.data.model} · {explain.data.basis}
              </p>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
