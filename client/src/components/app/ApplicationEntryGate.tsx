import { trpc } from "@/lib/trpc";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AccountEntryPage } from "@/pages/public/AccountEntryPage";
import { isExplicitLocalGuestRuntime } from "./WorkspaceIdentityBoundary";

export const EXPLICIT_DEMO_SESSION_KEY = "sunnaa-explicit-demo-v1";

export type ApplicationEntryGateProps = {
  children: ReactNode;
  /** Used by /demo to show an explicit guest choice and its local-only warning. */
  forceDemo?: boolean;
  /**
   * Optional parent-owned fallback for browsers where sessionStorage is blocked.
   * The gate also keeps an in-memory fallback for its own lifetime.
   */
  demoSessionActive?: boolean;
  onDemoSessionChange?: (active: boolean) => void;
};

type GrantedAccess = "authenticated" | "guest";

function readDemoMarker(): boolean {
  try {
    return window.sessionStorage.getItem(EXPLICIT_DEMO_SESSION_KEY) === "1";
  } catch {
    // Safari private windows and embedded previews can reject sessionStorage.
    return false;
  }
}

function writeDemoMarker(active: boolean) {
  try {
    if (active) {
      window.sessionStorage.setItem(EXPLICIT_DEMO_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(EXPLICIT_DEMO_SESSION_KEY);
    }
  } catch {
    // The component's in-memory state remains the narrow fallback only.
  }
}

function VerificationSuspendedBanner({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <section
        className="sf-public-card sf-account-card sf-account-session-banner"
        role="alert"
      >
        <h1 className="sf-public-title sf-account-title">
          تعذر إعادة التحقق من الهوية
        </h1>
        <p className="sf-public-description sf-account-description">
          أوقفنا عرض مساحة العمل مؤقتًا وحافظنا على نسختك في الذاكرة. لم نفتح
          جلسة ضيف تلقائيًا ولم ننقل البيانات إلى حساب آخر.
        </p>
        <button
          className="sf-public-secondary-button sf-account-retry-button"
          type="button"
          onClick={onRetry}
        >
          إعادة التحقق
        </button>
      </section>
    );
  }

  return (
    <section
      className="sf-public-card sf-account-card sf-account-session-banner"
      role="status"
    >
      جارٍ إعادة التحقق من الهوية. أوقفنا العرض والتعديل مؤقتًا وحافظنا على
      مساحة العمل الحالية في الذاكرة.
    </section>
  );
}

/**
 * Blocks application composition until auth.me has been verified. A guest can
 * enter only after an explicit local-demo decision; this gate never supplies a
 * fake user and makes no claim that client-side gating is server-side RBAC.
 *
 * Once a verified account or an explicit guest choice has mounted the workspace,
 * background verification keeps that exact tree mounted. The corresponding
 * WorkspaceIdentityBoundary keeps its known namespace and blocks writes, while
 * this gate hides the DOM until the verification result is safe to show again.
 */
export function ApplicationEntryGate({
  children,
  forceDemo = false,
  demoSessionActive,
  onDemoSessionChange,
}: ApplicationEntryGateProps) {
  const explicitLocalGuest = isExplicitLocalGuestRuntime();
  const auth = trpc.auth.me.useQuery(undefined, {
    // A static local guest build must never make auth.me lookups. It still
    // requires a visitor to choose the local guest workspace explicitly.
    enabled: !explicitLocalGuest,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [memoryDemoActive, setMemoryDemoActive] = useState(
    () => Boolean(demoSessionActive) || readDemoMarker()
  );
  const lastGrantedAccess = useRef<GrantedAccess | null>(null);
  const hasExplicitDemo = Boolean(demoSessionActive) || memoryDemoActive;

  const setDemoSession = useCallback(
    (active: boolean) => {
      setMemoryDemoActive(active);
      writeDemoMarker(active);
      onDemoSessionChange?.(active);
    },
    [onDemoSessionChange]
  );

  // A verified account always wins. Remove an old demo grant immediately so a
  // later logout cannot reopen the local demo through a stale session marker.
  useEffect(() => {
    if (!explicitLocalGuest && auth.data) setDemoSession(false);
  }, [auth.data, explicitLocalGuest, setDemoSession]);

  const retrySessionVerification = () => {
    void auth.refetch();
  };

  const verificationOutstanding =
    !explicitLocalGuest &&
    (auth.isLoading || auth.isFetching || Boolean(auth.error));
  const grantedAccess: GrantedAccess | null = verificationOutstanding
    ? null
    : explicitLocalGuest
      ? hasExplicitDemo
        ? "guest"
        : null
      : auth.data
        ? "authenticated"
        : hasExplicitDemo
          ? "guest"
          : null;

  // This is deliberately a ref rather than a new identity/session. It records
  // only that a workspace tree has already been allowed to mount, so a later
  // loading/error state can retain it without treating that state as a guest.
  if (grantedAccess) lastGrantedAccess.current = grantedAccess;

  if (grantedAccess) {
    return (
      <>
        <div key="application-workspace" data-application-entry-content="ready">
          {children}
        </div>
      </>
    );
  }

  // Do not mount a workspace before the first trusted result or before a guest
  // choice. Once it is mounted, retain it during a background check/error, but
  // make the retained DOM genuinely non-interactive and inaccessible.
  if (verificationOutstanding && lastGrantedAccess.current) {
    return (
      <>
        <VerificationSuspendedBanner
          key="verification-banner"
          error={Boolean(auth.error)}
          onRetry={retrySessionVerification}
        />
        <div
          key="application-workspace"
          aria-hidden="true"
          data-application-entry-content="suspended"
          hidden
          inert={true}
        >
          {children}
        </div>
      </>
    );
  }

  if (verificationOutstanding) {
    if (auth.error) {
      return (
        <main className="sf-public-page sf-account-page">
          <section className="sf-public-card sf-account-card" role="alert">
            <h1 className="sf-public-title sf-account-title">
              تعذر التحقق من الهوية
            </h1>
            <p className="sf-public-description sf-account-description">
              لم نفتح مساحة المستخدم أو تجربة الضيف تلقائيًا. أعد التحقق، أو
              ابدأ تسجيل الدخول عبر Manus بعد عودة الاتصال.
            </p>
            <button
              className="sf-public-secondary-button sf-account-retry-button"
              type="button"
              onClick={retrySessionVerification}
            >
              إعادة التحقق
            </button>
          </section>
        </main>
      );
    }

    return (
      <main className="sf-public-page sf-account-page">
        <section className="sf-public-card sf-account-card" role="status">
          جارٍ التحقق من الجلسة قبل فتح مساحة العمل…
        </section>
      </main>
    );
  }

  // A settled logout (no auth data and no current explicit demo choice) must
  // dispose of the old tree rather than leaving another identity's DOM hidden.
  lastGrantedAccess.current = null;
  return (
    <AccountEntryPage
      mode="login"
      onTryDemo={() => setDemoSession(true)}
      demoMessage={
        forceDemo
          ? "هذه تجربة ضيف محلية بملفات وبيانات وهمية. لا تُنشئ حسابًا ولا تمنح وصولًا إلى واجهات محمية."
          : undefined
      }
    />
  );
}
