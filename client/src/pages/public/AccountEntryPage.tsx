import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { isExplicitLocalGuestRuntime } from "@/components/app/WorkspaceIdentityBoundary";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { BRAND } from "@/i18n/brand";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccountEntryMode = "login" | "register";

export type AccountEntryPageProps = {
  mode: AccountEntryMode;
  /** Provided by ApplicationEntryGate for an explicit, local guest choice. */
  onTryDemo?: () => void;
  /** Explains a forced demo route without representing it as an account. */
  demoMessage?: string;
  demoButtonLabel?: string;
};

const MIN_PASSWORD_LENGTH = 8;

const copyByMode = {
  login: {
    eyebrow: ["دخول آمن", "Secure sign-in"],
    title: ["سجّل الدخول إلى صُنّاع الفرص", "Sign in to Sunnaa Al-Furas"],
    description: [
      "أدخل البريد الإلكتروني وكلمة المرور الخاصين بحسابك.",
      "Enter the email and password for your account.",
    ],
    alternate: ["ليس لديك حساب؟", "Don't have an account?"],
    alternateHref: "/register",
    alternateLabel: ["إنشاء حساب", "Create one"],
    submit: ["تسجيل الدخول", "Sign in"],
    submitting: ["جارٍ تسجيل الدخول…", "Signing in…"],
  },
  register: {
    eyebrow: ["إنشاء حساب", "Create account"],
    title: ["أنشئ حساب مالك عقار", "Create a property owner account"],
    description: [
      "حساب حقيقي محمي بكلمة مرور. بياناتك ومساحة عملك مخصّصة لحسابك فقط.",
      "A real, password-protected account. Your data and workspace are yours alone.",
    ],
    alternate: ["لديك حساب بالفعل؟", "Already have an account?"],
    alternateHref: "/login",
    alternateLabel: ["تسجيل الدخول", "Sign in"],
    submit: ["إنشاء الحساب", "Create account"],
    submitting: ["جارٍ إنشاء الحساب…", "Creating account…"],
  },
} as const;

function readableAuthError(error: unknown, t: (ar: string, en: string) => string): string {
  if (error instanceof TRPCClientError) {
    switch (error.data?.code) {
      case "CONFLICT":
        return t(
          "يوجد حساب مسجَّل بهذا البريد الإلكتروني بالفعل.",
          "An account with this email already exists."
        );
      case "UNAUTHORIZED":
        return t(
          "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
          "That email or password is incorrect."
        );
      case "FORBIDDEN":
        return t(
          "هذا الحساب موقوف. تواصل مع مدير المنصة.",
          "This account has been suspended. Contact the platform admin."
        );
      default:
        break;
    }
  }
  return t(
    "حدث خطأ غير متوقع. حاول مرة أخرى.",
    "Something went wrong. Please try again."
  );
}

/**
 * Public pre-application page with a real, password-based register/login
 * form. Successful submission mints a server session cookie and the result is
 * written straight into the `auth.me` cache so ApplicationEntryGate admits the
 * workspace on the same render pass, no extra round trip.
 */
export function AccountEntryPage({
  mode,
  onTryDemo,
  demoMessage,
  demoButtonLabel,
}: AccountEntryPageProps) {
  const { t, lang, dir, isAr } = useI18n();
  const Back = isAr ? ArrowRight : ArrowLeft;
  const [, navigate] = useLocation();
  const explicitLocalGuest = isExplicitLocalGuestRuntime();
  const utils = trpc.useUtils();
  const auth = trpc.auth.me.useQuery(undefined, {
    // Keep static local builds local-only. This is not a fallback identity: a
    // guest still has to be chosen explicitly by the entry gate.
    enabled: !explicitLocalGuest && !onTryDemo,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const registerMutation = trpc.auth.register.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const isSubmitting = registerMutation.isPending || loginMutation.isPending;

  const raw = copyByMode[mode];
  const pick = (pair: readonly [string, string]) => (isAr ? pair[0] : pair[1]);
  const content = useMemo(
    () => ({
      eyebrow: pick(raw.eyebrow),
      title: pick(raw.title),
      description: pick(raw.description),
      alternate: pick(raw.alternate),
      alternateHref: raw.alternateHref,
      alternateLabel: pick(raw.alternateLabel),
      submit: pick(raw.submit),
      submitting: pick(raw.submitting),
    }),
    [raw, isAr]
  );

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.me.setData(undefined, null),
  });

  useEffect(() => {
    // On /login, an existing session means "you're done, go in" — redirect
    // straight through. On /register, silently redirecting was the actual bug
    // behind "I type a new name and email and it just logs me in": whatever
    // the visitor typed was ignored and they landed on their OLD account's
    // dashboard. Show them who they're signed in as instead, with an explicit
    // choice, rather than guessing what they meant.
    if (!explicitLocalGuest && auth.data && mode === "login") {
      // This destination is intentionally fixed: never accept a redirect target
      // from the query string or an arbitrary previous location.
      navigate("/dashboard", { replace: true });
    }
  }, [auth.data, explicitLocalGuest, mode, navigate]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFormError(t("أكمل البريد الإلكتروني وكلمة المرور.", "Fill in email and password."));
      return;
    }

    if (mode === "register") {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setFormError(t("أدخل اسمك.", "Enter your name."));
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFormError(
          t(
            `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف.`,
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          )
        );
        return;
      }
      if (password !== confirmPassword) {
        setFormError(t("كلمتا المرور غير متطابقتين.", "Passwords do not match."));
        return;
      }

      registerMutation.mutate(
        { name: trimmedName, email: trimmedEmail, password },
        {
          onSuccess: account => {
            utils.auth.me.setData(undefined, account);
            navigate("/dashboard", { replace: true });
          },
          onError: error => setFormError(readableAuthError(error, t)),
        }
      );
      return;
    }

    loginMutation.mutate(
      { email: trimmedEmail, password },
      {
        onSuccess: account => {
          utils.auth.me.setData(undefined, account);
          navigate("/dashboard", { replace: true });
        },
        onError: error => setFormError(readableAuthError(error, t)),
      }
    );
  };

  const retrySessionVerification = () => {
    void auth.refetch();
  };
  const isCheckingSession =
    !explicitLocalGuest && (auth.isLoading || auth.isFetching);
  const sessionError = !explicitLocalGuest ? auth.error : null;
  const alreadySignedIn =
    mode === "register" && !explicitLocalGuest ? auth.data : null;

  const points = [
    t("عقود وفواتير وتحصيل في مكان واحد", "Leases, invoices and collections in one place"),
    t("عربي وEnglish بتبديل فوري", "Arabic and English, one tap to switch"),
    t("بيانات خيالية في النسخة التجريبية", "Fictional data in the demo version"),
  ];

  return (
    <main className="sf-public-page sf-account-page" dir={dir} lang={lang}>
      <aside className="sf-account-aside" aria-hidden="false">
        <a className="sf-account-aside__brand" href="/">
          <img src={BRAND.logo} alt="" />
          <span>{BRAND.name[lang]}</span>
        </a>
        <div>
          <h2>{BRAND.tagline[lang]}</h2>
          <ul>
            {points.map(point => (
              <li key={point}>
                <Check size={16} aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <small>
          {t(
            "نسخة تجريبية. لا وثائق حقيقية ولا حفظ أموال.",
            "Demo version. No real documents and no money held."
          )}
        </small>
      </aside>
      <div className="sf-account-main">
        <div className="sf-account-toolbar">
          <a className="sf-public-back-link sf-account-back-link" href="/">
            <Back size={16} aria-hidden="true" />
            {t("العودة إلى الصفحة الرئيسية", "Back to the home page")}
          </a>
          <LanguageSwitch />
        </div>
        <section
          className="sf-public-card sf-account-card"
          aria-labelledby="account-entry-title"
        >
          <div className="sf-account-brand">
            <img src={BRAND.logo} alt="" />
            <span>{BRAND.name[lang]}</span>
          </div>
          <div className="sf-account-content">
            <p className="sf-public-eyebrow sf-account-eyebrow">
              {content.eyebrow}
            </p>
            <h1
              id="account-entry-title"
              className="sf-public-title sf-account-title"
            >
              {content.title}
            </h1>
            <p className="sf-public-description sf-account-description">
              {content.description}
            </p>

            {isCheckingSession ? (
              <p className="sf-account-session-status" role="status">
                {t("جارٍ التحقق من الجلسة الحالية…", "Checking the current session…")}
              </p>
            ) : null}

            {sessionError ? (
              <div className="sf-account-alert" role="alert">
                <p>
                  {t(
                    "تعذر التحقق من الجلسة الحالية. لم نفتح تجربة ضيف تلقائيًا؛ يمكنك إعادة التحقق أو تسجيل الدخول أدناه.",
                    "Could not verify the current session. We did not open a guest demo automatically. You can retry or sign in below."
                  )}
                </p>
                <button
                  className="sf-public-secondary-button sf-account-retry-button"
                  type="button"
                  disabled={auth.isFetching}
                  onClick={retrySessionVerification}
                >
                  {t("إعادة التحقق", "Retry")}
                </button>
              </div>
            ) : null}

            {alreadySignedIn ? (
              <div className="sf-account-alert" role="status">
                <p>
                  {t(
                    `أنت مسجَّل الدخول بالفعل باسم ${
                      alreadySignedIn.name || alreadySignedIn.email
                    }. سجّل الخروج أولًا إن كنت تريد إنشاء حساب مختلف.`,
                    `You're already signed in as ${
                      alreadySignedIn.name || alreadySignedIn.email
                    }. Log out first if you want to create a different account.`
                  )}
                </p>
                <div className="sf-account-alert-actions">
                  <Button
                    type="button"
                    className="sf-public-primary-button sf-account-alert-primary-button"
                    onClick={() => navigate("/dashboard", { replace: true })}
                  >
                    {t("الذهاب إلى لوحة التحكم", "Go to dashboard")}
                  </Button>
                  <button
                    className="sf-public-secondary-button sf-account-retry-button"
                    type="button"
                    disabled={logoutMutation.isPending}
                    onClick={() => logoutMutation.mutate()}
                  >
                    {t("تسجيل الخروج وإنشاء حساب آخر", "Log out and create another account")}
                  </button>
                </div>
              </div>
            ) : null}

            {alreadySignedIn ? null : (
            <form
              className="flex flex-col gap-4"
              onSubmit={handleSubmit}
              noValidate
            >
              {mode === "register" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="account-name">{t("الاسم", "Name")}</Label>
                  <Input
                    id="account-name"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    disabled={isSubmitting}
                    dir={dir}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account-email">
                  {t("البريد الإلكتروني", "Email")}
                </Label>
                <Input
                  id="account-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  dir="ltr"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account-password">
                  {t("كلمة المرور", "Password")}
                </Label>
                <Input
                  id="account-password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  disabled={isSubmitting}
                  dir="ltr"
                />
              </div>

              {mode === "register" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="account-confirm-password">
                    {t("تأكيد كلمة المرور", "Confirm password")}
                  </Label>
                  <Input
                    id="account-confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    disabled={isSubmitting}
                    dir="ltr"
                  />
                </div>
              ) : null}

              {formError ? (
                <p className="sf-account-alert" role="alert">
                  {formError}
                </p>
              ) : null}

              <Button
                type="submit"
                className="sf-public-primary-button sf-account-login-button"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    {content.submitting}
                  </>
                ) : (
                  content.submit
                )}
              </Button>
            </form>
            )}

            {onTryDemo && !alreadySignedIn ? (
              <div className="sf-account-demo-choice">
                {demoMessage ? (
                  <p className="sf-account-demo-message">{demoMessage}</p>
                ) : null}
                <button
                  className="sf-public-secondary-button sf-account-demo-button"
                  type="button"
                  onClick={onTryDemo}
                >
                  {demoButtonLabel ?? t("تجربة بدون حساب", "Try without an account")}
                </button>
              </div>
            ) : null}

            {alreadySignedIn ? null : (
              <p className="sf-account-switch">
                {content.alternate}{" "}
                <a href={content.alternateHref}>{content.alternateLabel}</a>
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
