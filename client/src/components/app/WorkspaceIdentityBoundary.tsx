import { ReactNode, useRef, useState } from "react";
import {
  PrototypeProvider,
  type PrototypeWorkspaceIdentity,
} from "@/contexts/PrototypeContext";
import { STATIC_LOCAL_WORKSPACE_ID } from "@/lib/prototype-workspace-storage";
import { trpc } from "@/lib/trpc";

/** Exported for focused static-build regression tests. */
export function isExplicitLocalGuestRuntime(): boolean {
  return import.meta.env.VITE_EXPLICIT_LOCAL_GUEST === "1";
}

/** Initial identity checks never read a personal namespace. Background checks
 * retain the already-mounted provider (including quota-only memory) but suspend
 * editing/cloud actions. A newly verified account remounts its own namespace. */
export function WorkspaceIdentityBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const explicitLocalGuest = isExplicitLocalGuestRuntime();
  const [localGuestOptedIn, setLocalGuestOptedIn] = useState(false);
  // A disabled tRPC query creates no auth.me network request. It lets this
  // component retain stable hook ordering while static builds are intentionally
  // local-only rather than treating a real auth failure as a guest session.
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !explicitLocalGuest,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const lastVerified = useRef<PrototypeWorkspaceIdentity | null>(null);

  let identity: PrototypeWorkspaceIdentity;
  if (explicitLocalGuest) {
    identity = localGuestOptedIn
      ? {
          status: "guest",
          userId: null,
          localWorkspaceId: STATIC_LOCAL_WORKSPACE_ID,
        }
      : {
          status: "pending",
          userId: null,
          localWorkspaceId: STATIC_LOCAL_WORKSPACE_ID,
          verificationError:
            "وضع الضيف المحلي لم يُفتح بعد. لن نقرأ أو نكتب أي مساحة حتى تختاره صراحةً.",
        };
  } else {
    const unresolved = auth.isLoading || auth.isFetching || Boolean(auth.error);
    if (unresolved) {
      const verificationError = auth.error
        ? "تعذر إعادة التحقق من الهوية. توقفت الكتابة مؤقتًا، وبقيت النسخة الموجودة في الذاكرة محفوظة للتصدير؛ لم تُنقل إلى حساب آخر."
        : undefined;
      identity = lastVerified.current
        ? {
            ...lastVerified.current,
            verificationPending: true,
            verificationError,
          }
        : {
            status: "pending",
            userId: null,
            localWorkspaceId: "default",
            verificationError,
          };
    } else {
      identity = auth.data
        ? {
            status: "authenticated",
            userId: auth.data.id,
            name: auth.data.name,
            localWorkspaceId: "default",
          }
        : { status: "guest", userId: null, localWorkspaceId: "default" };
      lastVerified.current = identity;
    }
  }

  return (
    <PrototypeProvider identity={identity}>
      {!explicitLocalGuest && identity.status === "pending" && (
        <div
          className="prototype-notice"
          role={identity.verificationError ? "alert" : "status"}
        >
          <p>
            {identity.verificationError ??
              "جارٍ التحقق من الهوية قبل تحميل مساحة العمل وبيانات العقار…"}
          </p>
          {identity.verificationError && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => void auth.refetch()}
            >
              إعادة التحقق
            </button>
          )}
        </div>
      )}
      {explicitLocalGuest && !localGuestOptedIn && (
        <div className="prototype-notice" role="status">
          <p>
            هذا تشغيل ثابت محلي للتجربة فقط. لن يُستخدم تسجيل الدخول أو الحفظ
            السحابي، وستُحفظ البيانات في مساحة ضيف مستقلة باسم static-demo.
          </p>
          <button
            className="btn-secondary"
            onClick={() => setLocalGuestOptedIn(true)}
          >
            فتح مساحة الضيف المحلية
          </button>
        </div>
      )}
      {lastVerified.current &&
        !explicitLocalGuest &&
        (auth.isLoading || auth.isFetching || Boolean(auth.error)) && (
          <div className="prototype-notice" role="status">
            {identity.verificationError ??
              "جارٍ إعادة التحقق من الهوية. التعديل متوقف مؤقتًا ونسختك الحالية لم تتغير."}
          </div>
        )}
      {identity.status !== "pending" && children}
    </PrototypeProvider>
  );
}
