import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  LogIn,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { usePrototype } from "@/contexts/PrototypeContext";
import {
  retainCloudBaseOnRemoteObservation,
  STATIC_LOCAL_WORKSPACE_ID,
} from "@/lib/prototype-workspace-storage";
import { WorkspaceStorageControls } from "./WorkspaceStorageControls";
import type { PrototypeState } from "@shared/prototype";

type ObservedWorkspace = {
  snapshot: PrototypeState | null;
  revision: number;
};

type CloudReadState = "idle" | "loading" | "ready" | "error";

function rowCount(state: PrototypeState) {
  return Object.values(state.entities).reduce(
    (total, rows) => total + rows.length,
    0
  );
}

function downloadJson(filename: string, contents: string) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CloudWorkspace() {
  const [open, setOpen] = useState(false);
  const [observed, setObserved] = useState<ObservedWorkspace | null>(null);
  const [verifiedScope, setVerifiedScope] = useState<string | null>(null);
  const [readState, setReadState] = useState<CloudReadState>("idle");
  const [cloudConflict, setCloudConflict] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const {
    state,
    identity,
    storage,
    cloudBaseline,
    exportWorkspace,
    adoptCloudWorkspace,
    initializeEmptyCloudBaseline,
    markCloudSaveSuccess,
    createSeparateLocalWorkspace,
  } = usePrototype();
  const authenticated =
    identity.status === "authenticated" &&
    !identity.verificationPending &&
    !identity.verificationError;
  const explicitStaticGuest =
    identity.status === "guest" &&
    identity.localWorkspaceId === STATIC_LOCAL_WORKSPACE_ID;
  const scopeRef = useRef(identity.storageKey);
  scopeRef.current = identity.storageKey;
  const workspace = trpc.prototype.load.useQuery(
    { clientUserId: Number(identity.userId ?? 0) },
    {
      enabled: open && authenticated,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const refetchWorkspace = workspace.refetch;
  const utils = trpc.useUtils();

  // We do not trust a cached query result from a preceding identity. Only the
  // refetch promise that began under the current scope enables any cloud action.
  const refreshWorkspace = useCallback(async () => {
    if (!authenticated) return;
    const requestedScope = identity.storageKey;
    setReadState("loading");
    setVerifiedScope(null);
    setCloudConflict(false);
    try {
      const result = await refetchWorkspace();
      if (scopeRef.current !== requestedScope) return;
      if (result.error || !result.data) {
        setReadState("error");
        return;
      }
      setObserved({
        snapshot: result.data.snapshot as PrototypeState | null,
        revision: result.data.revision,
      });
      setVerifiedScope(requestedScope);
      setReadState("ready");
    } catch {
      if (scopeRef.current !== requestedScope) return;
      setReadState("error");
    }
  }, [authenticated, identity.storageKey, refetchWorkspace]);

  useEffect(() => {
    setObserved(null);
    setVerifiedScope(null);
    setCloudConflict(false);
    setShowComparison(false);
    if (open && authenticated) void refreshWorkspace();
    if (!authenticated) setReadState("idle");
  }, [authenticated, identity.storageKey, open, refreshWorkspace]);

  useEffect(() => {
    if (verifiedScope !== identity.storageKey || !observed) return;
    // R07: this call can bind only the proven empty server R0. For R1/R2 it
    // intentionally does nothing; a refetch is observation, never adoption.
    void initializeEmptyCloudBaseline(
      observed.revision,
      Boolean(observed.snapshot)
    );
  }, [
    identity.storageKey,
    initializeEmptyCloudBaseline,
    observed,
    verifiedScope,
  ]);

  const save = trpc.prototype.save.useMutation();
  const expectedRevision = retainCloudBaseOnRemoteObservation(
    cloudBaseline.revision,
    observed?.revision ?? 0
  );
  const canSave =
    authenticated &&
    verifiedScope === identity.storageKey &&
    readState === "ready" &&
    storage.canPersist &&
    expectedRevision !== null &&
    !save.isPending;

  const saveCurrent = () => {
    if (!canSave || expectedRevision === null) return;
    const clientUserId = Number(identity.userId);
    if (!Number.isSafeInteger(clientUserId) || clientUserId <= 0) {
      toast.error("تعذر التحقق من هوية الحساب قبل الحفظ السحابي");
      return;
    }
    const snapshot = state;
    const saveScope = identity.storageKey;
    save.mutate(
      {
        snapshot,
        expectedRevision,
        clientUserId,
      },
      {
        onSuccess: result => {
          void (async () => {
            if (scopeRef.current !== saveScope) return;
            const bound = await markCloudSaveSuccess(
              result.revision,
              snapshot,
              saveScope
            );
            // A delayed Web Lock completion must never update the new identity's
            // observed remote state after an account/workspace switch.
            if (scopeRef.current !== saveScope) return;
            setObserved({ snapshot, revision: result.revision });
            void utils.prototype.load.invalidate();
            if (bound) {
              toast.success(
                `حُفظت لقطة تجربتك الخاصة • إصدار ${result.revision}`
              );
            } else {
              toast.error(
                "حُفظت السحابة لكن تغيرت النسخة المحلية أو تعذر ربط خط الأساس. صدّرها ثم راجع أو حمّل صراحةً قبل حفظ جديد."
              );
            }
          })();
        },
        onError: error => {
          if (scopeRef.current !== saveScope) return;
          if (error.data?.code === "CONFLICT") {
            setCloudConflict(true);
            toast.error(
              "تعارض الإصدار: بقيت نسختك المحلية كما هي. صدّرها أو راجع السحابة ثم حمّلها صراحةً."
            );
            void refreshWorkspace();
            return;
          }
          toast.error(
            "تعذر الحفظ السحابي. بقيت التغييرات المحلية في الذاكرة ويمكن تصديرها."
          );
        },
      }
    );
  };

  const load = async () => {
    if (!observed?.snapshot) return;
    if (
      !window.confirm(
        "سيُنشئ التطبيق نسخة محلية احتياطية ثم يستبدل الحالة الحالية بلقطة السحابة. هل تريد المتابعة؟"
      )
    )
      return;
    try {
      if (await adoptCloudWorkspace(observed.snapshot, observed.revision)) {
        setCloudConflict(false);
        toast.success(
          `حُمّلت لقطة السحابة الصريحة • إصدار ${observed.revision}`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر تحميل لقطة السحابة"
      );
    }
  };

  const login = () => {
    try {
      startLogin();
    } catch {
      toast.error("تعذر بدء الدخول. يمكنك مواصلة البروتوتايب والحفظ المحلي.");
    }
  };

  const remoteAlreadyExists =
    Boolean(observed?.snapshot) && cloudBaseline.revision === null;
  const observedNewerThanBase =
    observed !== null &&
    cloudBaseline.revision !== null &&
    observed.revision > cloudBaseline.revision;

  return (
    <div className="cloud-workspace">
      <button
        className="icon-button"
        aria-label="حفظ نموذج التجربة في السحابة"
        title="حفظ نموذج التجربة"
        onClick={() => setOpen(value => !value)}
      >
        <Cloud size={19} />
      </button>
      {open && (
        <div className="cloud-popover">
          <div className="cloud-heading">
            <strong>نسخة تجربتك الخاصة</strong>
            <button
              className="icon-button"
              aria-label="إغلاق"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p className="muted small">
            الحفظ المحلي يعمل ضمن مساحة معزولة. السحابة اختيارية وتتطلب دخولًا
            حقيقيًا؛ معاينة الدور ليست تسجيل دخول.
          </p>
          {identity.status === "pending" ? (
            <p className="muted small">
              {identity.verificationError ??
                "جارٍ التحقق من الهوية؛ لا نقرأ مساحة حساب سابق ولا نسمح بحفظ خاص الآن."}
            </p>
          ) : explicitStaticGuest ? (
            <p className="muted small">
              وضع الضيف المحلي الثابت مفعل صراحةً. لا تُرسل استعلامات هوية أو حفظ
              سحابي في هذا التشغيل.
            </p>
          ) : !authenticated ? (
            <button className="btn-primary full-width" onClick={login}>
              <LogIn size={15} />
              تسجيل الدخول للحفظ
            </button>
          ) : (
            <>
              <div className="cloud-identity">
                جلسة موثقة: {identity.name || "مستخدم Manus"}
              </div>
              {readState === "loading" ? (
                <p className="muted small">جارٍ قراءة لقطة تجربتك…</p>
              ) : readState === "error" ? (
                <div>
                  <p className="muted small">
                    تعذر قراءة النسخة، لا يمكن الكتابة قبل التحقق منها.
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={() => void refreshWorkspace()}
                  >
                    <RefreshCw size={14} />
                    إعادة المحاولة
                  </button>
                </div>
              ) : verifiedScope === identity.storageKey && observed ? (
                <>
                  <p className="muted small">
                    {observed.revision
                      ? `اللقطة السحابية المرصودة: إصدار ${observed.revision}`
                      : "لا توجد لقطة سحابية محفوظة بعد."}
                  </p>
                  <p className="muted small">
                    {cloudBaseline.revision === null
                      ? "لم تُبنَ النسخة المحلية على لقطة سحابية بعد."
                      : `خط أساس الحفظ المحلي: إصدار ${cloudBaseline.revision}`}
                    {observedNewerThanBase &&
                      "، توجد نسخة أحدث مرصودة؛ الحفظ سيطلب خط الأساس القديم وقد يتعارض."}
                  </p>
                  {remoteAlreadyExists && (
                    <p className="muted small">
                      توجد لقطة سحابية سابقة. صدّر نسختك المحلية إن احتجت، ثم
                      حمّل اللقطة صراحةً قبل أن يصبح الحفظ ممكنًا.
                    </p>
                  )}
                  {cloudConflict && (
                    <div className="cloud-storage-status" role="alert">
                      <p className="muted small">
                        احتُفظت حالتك المحلية ولم تُستبدل. اختر التصدير أو
                        المقارنة ثم التحميل الصريح؛ لا يوجد دمج تلقائي.
                      </p>
                      <button
                        className="btn-secondary"
                        onClick={() =>
                          downloadJson(
                            "sunnaa-prototype-conflict-local.json",
                            exportWorkspace()
                          )
                        }
                      >
                        <Download size={14} />
                        تصدير نسختي المتعارضة
                      </button>
                    </div>
                  )}
                  <div className="cloud-buttons">
                    <button
                      className="btn-primary"
                      disabled={!canSave}
                      onClick={saveCurrent}
                      title={
                        remoteAlreadyExists
                          ? "حمّل اللقطة السحابية صراحةً أو احتفظ بنسخة محلية منفصلة أولًا"
                          : undefined
                      }
                    >
                      <CloudUpload size={15} />
                      {save.isPending ? "جارٍ الحفظ…" : "حفظ لقطتي"}
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={!observed.snapshot || save.isPending}
                      onClick={() => void load()}
                    >
                      <CloudDownload size={15} />
                      تحميل صريح
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={!observed.snapshot}
                      onClick={() => setShowComparison(value => !value)}
                    >
                      <Copy size={15} />
                      مقارنة
                    </button>
                  </div>
                  {showComparison && observed.snapshot && (
                    <p className="muted small">
                      محلي: {rowCount(state)} سجلًا. سحابي:{" "}
                      {rowCount(observed.snapshot)} سجلًا. المقارنة وصفية فقط؛
                      لا يوجد دمج تلقائي.
                    </p>
                  )}
                  <button
                    className="link-button"
                    onClick={() => void refreshWorkspace()}
                  >
                    <RefreshCw size={13} />
                    تحديث حالة النسخة
                  </button>
                  <button
                    className="link-button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "سيُنشأ مفتاح محلي منفصل فقط؛ الخادم يحتفظ بلقطة واحدة لكل حساب. هل تريد المتابعة؟"
                        )
                      )
                        if (createSeparateLocalWorkspace())
                          toast.success("فُتحت مساحة محلية منفصلة لهويتك فقط");
                    }}
                  >
                    <Copy size={13} />
                    مساحة محلية منفصلة
                  </button>
                </>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => void refreshWorkspace()}
                >
                  <RefreshCw size={14} />
                  تحقق من النسخة السحابية
                </button>
              )}
            </>
          )}
          <WorkspaceStorageControls />
          <p className="cloud-footnote">
            هذه لقطة بروتوتايب صورية خاصة، وليست نظامًا محاسبيًا أو دفترًا متعدد
            المستخدمين أو خدمة إنتاجية. لا ترفع هويات أو عقودًا حقيقية.
          </p>
        </div>
      )}
    </div>
  );
}
