import { ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  phaseFeature,
  phaseFeatureActive,
  phaseFeatureCounts,
} from "@shared/phase1-features";
import { scenarioDate, validScenarioDate } from "@shared/prototype-clock";
import { Link, useLocation } from "wouter";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Layers,
  LogOut,
  Menu,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import { trpc } from "@/lib/trpc";
import {
  allNavigation,
  navigation,
  ROLE_LABELS,
  ROLE_LABELS_EN,
  PRIMARY_PATHS,
} from "@/lib/navigation";
import { BRAND } from "@/i18n/brand";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import { useI18n } from "@/i18n";
import { CloudWorkspace } from "./CloudWorkspace";
import { WorkspaceStorageBanner } from "./WorkspaceStorageBanner";
import { CommandPalette } from "./CommandPalette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppFrame({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { state, list, setSetting, reset, identity } = usePrototype();
  const { lang, isAr, t } = useI18n();
  const utils = trpc.useUtils();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      navigate("/login", { replace: true });
    },
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const Chevron = isAr ? ChevronLeft : ChevronRight;
  const primary = new Set<string>(PRIMARY_PATHS);
  const activeMore =
    !primary.has(location) && !location.startsWith("/properties/");
  const current =
    allNavigation.find(item => item.path === location) ??
    (location.startsWith("/properties/")
      ? allNavigation.find(item => item.path === "/properties")
      : undefined);
  const scenario = scenarioDate(state);
  const scenarioYear = Number(scenario.slice(0, 4));
  const counts = phaseFeatureCounts();
  const labelOf = (item: { label: string; english: string }) =>
    isAr ? item.label : item.english;

  // keep the stored prototype setting in step with the interface language
  useEffect(() => {
    if (state.settings.language === lang) return;
    try {
      setSetting("language", lang);
    } catch {
      // storage is not writable yet (guest workspace not opened): the
      // interface language still follows the switch, only the saved copy waits
    }
  }, [lang, state.settings.language, setSetting]);

  // Ctrl/Cmd + K opens quick jump from anywhere in the workspace
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const goTo = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };
  const resetDemo = () => {
    if (
      window.confirm(
        t(
          "إعادة بيانات التجربة الأصلية في هذا المتصفح؟ ستفقد تعديلاتك المحلية فقط، ولن تحذف نسخة سحابية.",
          "Restore the original demo data in this browser? You will lose only your local edits. No cloud copy is deleted."
        )
      )
    )
      reset();
  };
  const soonToast = (item: { label: string; english: string }) =>
    toast.info(`${labelOf(item)} · ${t("قريبًا", "Coming soon")}`);

  const renderLink = (item: (typeof allNavigation)[number]) => {
    const active =
      location === item.path ||
      (item.path === "/properties" && location.startsWith("/properties/"));
    const enabled = phaseFeatureActive(item.path);
    return (
      <Link
        href={item.path}
        key={item.path}
        aria-current={active ? "page" : undefined}
        onClick={event => {
          if (!enabled) {
            event.preventDefault();
            soonToast(item);
            return;
          }
          setMobileOpen(false);
        }}
        aria-disabled={!enabled}
        title={phaseFeature(item.path)?.reason}
        className={`nav-link ${active ? "active" : ""}`}
      >
        <item.icon size={18} />
        <span>{labelOf(item)}</span>
        {!enabled && <small className="nav-soon">{t("قريبًا", "Soon")}</small>}
        {enabled && item.path === "/roadmap" && (
          <b className="nav-count">{counts.total}</b>
        )}
      </Link>
    );
  };

  return (
    <div className="app-shell">
      {mobileOpen && (
        <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`app-sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol">
            <img src={BRAND.logo} alt="" />
          </div>
          <div className="brand-text">
            <strong>{BRAND.name[lang]}</strong>
            <span>{BRAND.tagline[lang]}</span>
          </div>
          <button
            className="sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label={t("إغلاق القائمة", "Close menu")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-dot" />
          <div>
            <strong>{t("مساحة التجربة", "Demo workspace")}</strong>
            <span>{t("المرحلة الأولى • قطر", "Phase 1 • Qatar")}</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav
          className="sidebar-nav"
          aria-label={t("قائمة شاشات النظام", "System screens")}
        >
          <div className="nav-group">
            <span className="nav-section-label">
              {t("عملك اليومي", "Your daily work")}
            </span>
            {PRIMARY_PATHS.map(path =>
              renderLink(allNavigation.find(row => row.path === path)!)
            )}
          </div>
          <button
            className="nav-more-button"
            aria-expanded={moreOpen || activeMore}
            aria-controls="more-services"
            onClick={() => setMoreOpen(value => !value)}
          >
            <Layers size={16} />
            <span>{t("المزيد من الخدمات", "More services")}</span>
            <ChevronDown size={16} />
          </button>
          {(moreOpen || activeMore) && (
            <div id="more-services">
              {navigation
                .map(group => ({
                  ...group,
                  items: group.items.filter(item => !primary.has(item.path)),
                }))
                .filter(group => group.items.length)
                .map(group => {
                  const open =
                    openGroups.includes(group.titleEn) ||
                    group.items.some(item => item.path === location);
                  return (
                    <div className="nav-group" key={group.titleEn}>
                      <button
                        className="nav-group-title"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenGroups(prev =>
                            prev.includes(group.titleEn)
                              ? prev.filter(x => x !== group.titleEn)
                              : [...prev, group.titleEn]
                          )
                        }
                      >
                        <span>{isAr ? group.title : group.titleEn}</span>
                        <ChevronDown
                          size={13}
                          className={open ? "" : "chevron-closed"}
                        />
                      </button>
                      {open && group.items.map(renderLink)}
                    </div>
                  );
                })}
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-prototype">
            <FlaskConical size={17} />
            <span>{t("بروتوتايب تفاعلي", "Interactive prototype")}</span>
            <span className="version-pill">V1</span>
          </div>
          <button className="sidebar-reset" onClick={resetDemo}>
            <RotateCcw size={15} />
            {t("إعادة بيانات التجربة", "Reset demo data")}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label={t("فتح القائمة", "Open menu")}
            >
              <Menu size={23} />
            </button>
            <span className="breadcrumb-home">
              {t("مساحة التجربة", "Demo workspace")}
            </span>
            <Chevron size={14} />
            <strong>
              {current ? labelOf(current) : t("المنصة", "Platform")}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("البحث في الخدمات", "Search services")}
              aria-keyshortcuts="Control+K Meta+K"
            >
              <Search size={17} />
              <span>{t("ابحث عن خدمة أو شاشة…", "Find a module…")}</span>
              <kbd>Ctrl K</kbd>
            </button>
            <LanguageSwitch />
            <CloudWorkspace />
            <button
              className="icon-button notification-button"
              onClick={() => navigate("/notifications")}
              aria-label={t("التنبيهات · قريبًا", "Notifications, coming soon")}
              disabled={!phaseFeatureActive("/notifications")}
            >
              <Bell size={19} />
              <i />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="profile-circle"
                  aria-label={t("حساب المستخدم", "Account menu")}
                >
                  {isAr ? "ص" : "S"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <Settings size={16} />
                  {t("الإعدادات", "Settings")}
                </DropdownMenuItem>
                {identity.status === "authenticated" ? (
                  <DropdownMenuItem
                    disabled={logoutMutation.isPending}
                    onSelect={() => logoutMutation.mutate()}
                  >
                    <LogOut size={16} />
                    {t("تسجيل الخروج", "Log out")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="prototype-strip">
          <span>
            <FlaskConical size={14} />
            <strong>{t("بروتوتايب تجريبي", "Demo prototype")}</strong>
            <i />
            {identity.status === "authenticated"
              ? t(
                  "حساب حقيقي · الحفظ محلي حتى تختار الحفظ في السحابة",
                  "Real account. Saved locally until you choose to save to the cloud"
                )
              : t(
                  "بيانات خيالية · الحفظ محلي في هذا المتصفح",
                  "Fictional data. Saved locally in this browser"
                )}
          </span>
          <Link href="/roadmap">
            {t(
              "المرحلة الأولى والخدمات القادمة",
              "Phase 1 and upcoming services"
            )}
            <Chevron size={14} />
          </Link>
        </div>
        <div className="filter-bar">
          <div className="scope-filter">
            <label>{t("المحفظة", "Portfolio")}</label>
            <select
              value={state.settings.portfolioId}
              onChange={event => setSetting("portfolioId", event.target.value)}
              aria-label={t("اختيار المحفظة", "Choose portfolio")}
            >
              <option value="all">{t("جميع المحافظ", "All portfolios")}</option>
              {list("portfolios").map(row => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          </div>
          <div className="scope-filter">
            <label>{t("الفترة", "Period")}</label>
            <select
              value={state.settings.period}
              onChange={event => setSetting("period", event.target.value)}
              aria-label={t("اختيار الفترة", "Choose period")}
            >
              <option value="all">{t("كل الفترات", "All periods")}</option>
              <option value="month">
                {t("شهر النموذج الحالي", "Current model month")}
              </option>
              <option value="quarter">
                {t("ربع السيناريو", "Scenario quarter")}
              </option>
              <option value="year">
                {t("سنة السيناريو", "Scenario year")}
              </option>
              {/^(\d{4})-(0[1-9]|1[0-2])$/.test(state.settings.period) &&
                !state.settings.period.startsWith(`${scenarioYear}-`) && (
                  <option value={state.settings.period}>
                    {state.settings.period}
                  </option>
                )}
              {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                <option
                  key={month}
                  value={`${scenarioYear}-${String(month).padStart(2, "0")}`}
                >
                  {new Intl.DateTimeFormat(isAr ? "ar-QA" : "en-GB", {
                    month: "long",
                    timeZone: "UTC",
                  }).format(
                    new Date(
                      `${scenarioYear}-${String(month).padStart(2, "0")}-01T00:00:00Z`
                    )
                  )}{" "}
                  {scenarioYear}
                </option>
              ))}
            </select>
          </div>
          <div className="scope-filter scenario-date">
            <CalendarDays size={15} />
            <label>
              {t(
                "تاريخ السيناريو · ليس اليوم الفعلي",
                "Scenario date, not today"
              )}
            </label>
            <input
              type="date"
              aria-label={t("تاريخ السيناريو", "Scenario date")}
              value={scenario}
              onChange={event => {
                try {
                  if (!validScenarioDate(event.target.value))
                    throw new Error(
                      t(
                        "اختر تاريخًا صالحًا للسيناريو",
                        "Choose a valid scenario date"
                      )
                    );
                  setSetting("scenarioDate", event.target.value);
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t("تعذر تغيير التاريخ", "Could not change the date")
                  );
                }
              }}
            />
          </div>
          <div className="scope-filter role-filter">
            <ShieldCheck size={15} />
            <select
              value={state.settings.role}
              onChange={event => setSetting("role", event.target.value)}
              aria-label={t(
                "معاينة دور وليست تسجيل دخول",
                "Role preview, not a sign-in"
              )}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {isAr
                    ? label
                    : ROLE_LABELS_EN[value as keyof typeof ROLE_LABELS_EN]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <main className="app-main">
          <WorkspaceStorageBanner />
          {children}
        </main>
        <footer className="main-footer">
          <span>
            {t(
              "صُنّاع الفرص • تجربة الفكرة قبل بناء النظام الإنتاجي",
              "Sunnaa Al-Furas • Try the idea before building the production system"
            )}
          </span>
          <span>
            {t(
              "لا شراء أو تمويل أو دفع أو توقيع تلقائي",
              "No automatic purchase, funding, payment or signing"
            )}
          </span>
        </footer>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        onNavigate={goTo}
      />
    </div>
  );
}
