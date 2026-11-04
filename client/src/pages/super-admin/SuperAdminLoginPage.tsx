import { type FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { TRPCClientError } from "@trpc/client";
import { ShieldAlert, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Deliberately not linked from anywhere in the public site or the owner
 * app — this URL is reachable only by typing it. That is a UX nicety, never
 * the security boundary: every `superAdmin.*` procedure independently
 * requires `role === "admin"` server-side (see server/_core/trpc.ts,
 * adminProcedure), so a guessed URL or a non-admin login gains nothing.
 */
export function SuperAdminLoginPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logoutMutation = trpc.auth.logout.useMutation();
  const loginMutation = trpc.auth.login.useMutation();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) return;
    setError(null);

    loginMutation.mutate(
      { email: email.trim(), password },
      {
        onSuccess: async account => {
          if (account.role !== "admin") {
            // A real owner account authenticated correctly but has no
            // platform-admin role. Do not leave their session sitting on an
            // admin URL — sign them straight back out.
            await logoutMutation.mutateAsync().catch(() => {});
            utils.auth.me.setData(undefined, null);
            setError("هذا الحساب لا يملك صلاحية الوصول إلى لوحة التحكم.");
            return;
          }
          utils.auth.me.setData(undefined, account);
          navigate("/super-admin", { replace: true });
        },
        onError: err => {
          if (err instanceof TRPCClientError && err.data?.code === "FORBIDDEN") {
            setError("هذا الحساب موقوف.");
            return;
          }
          setError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
        },
      }
    );
  };

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100"
    >
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <ShieldAlert size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold">تحكم المنصة</h1>
            <p className="text-sm text-neutral-400">
              وصول مخصّص لمشغّلي المنصة فقط
            </p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email" className="text-neutral-300">
              البريد الإلكتروني
            </Label>
            <Input
              id="admin-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              disabled={loginMutation.isPending}
              className="border-neutral-700 bg-neutral-950 text-neutral-100"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password" className="text-neutral-300">
              كلمة المرور
            </Label>
            <Input
              id="admin-password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={loginMutation.isPending}
              className="border-neutral-700 bg-neutral-950 text-neutral-100"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={loginMutation.isPending}
            className="bg-amber-500 text-neutral-950 hover:bg-amber-400"
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                جارٍ التحقق…
              </>
            ) : (
              "دخول"
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
