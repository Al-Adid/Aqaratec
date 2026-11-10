import { useEffect } from "react";
import { useLocation } from "wouter";
import { LogOut, ShieldCheck, ShieldOff, Users, Database, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#eee9e1] bg-white px-4 py-3 shadow-sm shadow-black/[0.02]">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function SuperAdminDashboardContent({ adminId }: { adminId: number }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const overview = trpc.superAdmin.overview.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      navigate("/super-admin/login", { replace: true });
    },
  });
  const setActiveMutation = trpc.superAdmin.setAccountActive.useMutation({
    onSuccess: () => void overview.refetch(),
  });

  if (overview.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-red-600">
        تعذر تحميل بيانات لوحة التحكم.
      </div>
    );
  }

  const { totals, accounts } = overview.data;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="إجمالي الحسابات" value={totals.accounts} />
        <KpiCard label="نشطة" value={totals.activeAccounts} />
        <KpiCard label="موقوفة" value={totals.suspendedAccounts} />
        <KpiCard label="ملاك عقارات" value={totals.owners} />
        <KpiCard label="مديرو منصة" value={totals.admins} />
        <KpiCard label="مساحات محفوظة" value={totals.savedWorkspaces} />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[#eee9e1] bg-white shadow-sm shadow-black/[0.02]">
        <Table>
          <TableHeader>
            <TableRow className="border-[#eee9e1] hover:bg-transparent">
              <TableHead className="text-neutral-500">الاسم</TableHead>
              <TableHead className="text-neutral-500">البريد الإلكتروني</TableHead>
              <TableHead className="text-neutral-500">الدور</TableHead>
              <TableHead className="text-neutral-500">الحالة</TableHead>
              <TableHead className="text-neutral-500">مساحة العمل</TableHead>
              <TableHead className="text-neutral-500">آخر دخول</TableHead>
              <TableHead className="text-neutral-500"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map(({ account, workspace }) => (
              <TableRow key={account.id} className="border-[#eee9e1]">
                <TableCell className="text-neutral-800">
                  {account.name || "—"}
                </TableCell>
                <TableCell dir="ltr" className="text-neutral-600">
                  {account.email || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      account.role === "admin"
                        ? "bg-[#826c45]/10 text-[#826c45]"
                        : "bg-neutral-100 text-neutral-600"
                    }
                  >
                    {account.role === "admin" ? "مدير منصة" : "مالك عقار"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      account.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700"
                    }
                  >
                    {account.isActive ? "نشط" : "موقوف"}
                  </Badge>
                </TableCell>
                <TableCell className="text-neutral-500">
                  {workspace
                    ? `${workspace.recordCount} سجل • إصدار ${workspace.revision}`
                    : "لا توجد مساحة محفوظة"}
                </TableCell>
                <TableCell className="text-neutral-500">
                  {new Date(account.lastSignedIn).toLocaleDateString("ar")}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={account.id === adminId || setActiveMutation.isPending}
                    className="border-[#eee9e1] text-neutral-700 hover:bg-[#f9f7f5]"
                    onClick={() =>
                      setActiveMutation.mutate({
                        accountId: account.id,
                        isActive: !account.isActive,
                      })
                    }
                  >
                    {account.isActive ? (
                      <>
                        <ShieldOff size={14} /> إيقاف
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={14} /> تفعيل
                      </>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4">
        <Button
          variant="ghost"
          className="text-neutral-500 hover:bg-[#f1ece4] hover:text-neutral-900"
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut size={14} /> تسجيل الخروج
        </Button>
      </div>
    </>
  );
}

/**
 * This client-side redirect is UX only. The real boundary is server-side:
 * every superAdmin procedure runs through `adminProcedure`, which rejects
 * anything but `role === "admin"` regardless of what this page renders.
 */
export function SuperAdminDashboardPage() {
  const [, navigate] = useLocation();
  const auth = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.data || auth.data.role !== "admin") {
      navigate("/super-admin/login", { replace: true });
    }
  }, [auth.data, auth.isLoading, navigate]);

  if (auth.isLoading || !auth.data || auth.data.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#f9f7f5] to-[#f1ece4] text-neutral-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gradient-to-b from-[#f9f7f5] to-[#f1ece4] px-6 py-8 text-neutral-900"
    >
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#826c45]/10 text-[#826c45]">
            <Database size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">لوحة تحكم المنصة</h1>
            <p className="text-sm text-neutral-500">
              مرحبًا، {auth.data.name || auth.data.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Users size={15} /> عرض عبر جميع الحسابات
        </div>
      </header>

      <SuperAdminDashboardContent adminId={auth.data.id} />
    </main>
  );
}
