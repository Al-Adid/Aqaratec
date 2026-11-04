import { useState } from "react";
import {
  ArrowUpLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Layers3,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
} from "recharts";
import { money } from "@shared/prototype";
import { scenarioDate } from "@shared/prototype-clock";
import { phaseFeatureCounts } from "@shared/phase1-features";
import { unitOccupancyAt } from "@/lib/prototype-lease-lifecycle";
import { usePrototype } from "@/contexts/PrototypeContext";
import { useI18n } from "@/i18n";
import {
  financialSummary,
  isOccupiedUnit,
  monthlyCashflow,
} from "@/lib/prototype-finance";
import { getMonthlyPropertyCollections } from "@/lib/prototype-payments";
import { inPrototypePeriod } from "@/lib/prototype-period";
import MonthlyCollectionPanel from "@/components/app/MonthlyCollectionPanel";
import {
  Badge,
  EntityTable,
  Metric,
  Panel,
} from "@/components/app/Primitives";

const isMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);
const dashboardMonth = (period: string, date: string) =>
  isMonth(period) ? period : date.substring(0, 7);

function endsWithinThirtyDays(leaseEnd: string, asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(leaseEnd)) return false;
  const start = new Date(`${asOf}T00:00:00Z`).getTime();
  const end = start + 30 * 24 * 60 * 60 * 1000;
  const target = new Date(`${leaseEnd}T00:00:00Z`).getTime();
  return target >= start && target <= end;
}

export default function Dashboard() {
  const { state, financials: totals, filtered, list } = usePrototype();
  const { t, isAr, lang } = useI18n();
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem("sunnaa-guide-dismissed") !== "yes";
    } catch {
      return true;
    }
  });
  const asOf = scenarioDate(state);
  const phaseCounts = phaseFeatureCounts();
  const period = dashboardMonth(state.settings.period, asOf);
  const chart = monthlyCashflow(
    state.entities,
    state.settings.portfolioId,
    asOf
  );
  const propertyCollections = getMonthlyPropertyCollections(
    state.entities,
    state.settings.portfolioId,
    period
  );
  const collectionTotals = propertyCollections.reduce(
    (total, property) => ({
      expectedMinor: total.expectedMinor + property.expectedMinor,
      collectedMinor: total.collectedMinor + property.collectedMinor,
      lossMinor: total.lossMinor + property.lossMinor,
      remainingMinor: total.remainingMinor + property.remainingMinor,
    }),
    { expectedMinor: 0, collectedMinor: 0, lossMinor: 0, remainingMinor: 0 }
  );
  const tasks = filtered("tasks").filter(row => row.status !== "مكتمل");
  const transactions = filtered("collections")
    .filter(row => inPrototypePeriod(row.date, period))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const vacancyCount = filtered("units").filter(
    row => unitOccupancyAt(state.entities, row.id, asOf) !== "occupied"
  ).length;
  const endSoon = filtered("leases").filter(row => {
    const status = row.status;
    const leaseEnd = String(row.meta.end ?? row.meta.endDate ?? "");
    return (
      ["نافذ", "مجدد"].includes(status) && endsWithinThirtyDays(leaseEnd, asOf)
    );
  }).length;
  const handledMinor =
    collectionTotals.collectedMinor + collectionTotals.lossMinor;
  const ratio =
    collectionTotals.expectedMinor > 0
      ? Math.round((handledMinor / collectionTotals.expectedMinor) * 100)
      : 0;
  const donut = [
    {
      name: "إيجار محصّل مؤكد",
      value: collectionTotals.collectedMinor,
      color: "#826c45",
    },
    {
      name: "معالجة بخسارة",
      value: collectionTotals.lossMinor,
      color: "#D6A45C",
    },
    { name: "متبقي", value: collectionTotals.remainingMinor, color: "#e8decd" },
  ];
  const dueCount = propertyCollections.reduce(
    (count, property) =>
      count + property.dues.filter(due => due.remainingMinor > 0).length,
    0
  );
  const ArrowGo = ArrowUpLeft;
  const RING = 2 * Math.PI * 80;
  const periodLabel = new Intl.DateTimeFormat(isAr ? "ar-QA" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));

  return (
    <div className="section-stack dashboard-page">
      <section className="dash-hero" aria-labelledby="dash-title">
        <div>
          <span className="eyebrow">
            {t("كل رقم له سجل", "Every number has a record")} · {periodLabel}
          </span>
          <h1 id="dash-title">
            {t(
              "ملخص العقارات والتحصيل",
              "Your portfolio and collections at a glance"
            )}
          </h1>
          <p>
            {t(
              "متابعة واضحة للدخل والسيولة وما يحتاج قرارك. أرقام صورية مترابطة وليست بيانات سوق.",
              "A clear view of income, liquidity and what needs your decision. Linked fictional figures, not market data."
            )}
          </p>
          <div className="dash-hero__chips">
            <span className="dash-chip">
              <Building2 size={16} />
              <b>{totals.propertyCount}</b> {t("عقارات", "properties")}
            </span>
            <span className="dash-chip">
              <Layers3 size={16} />
              <b>{totals.unitCount}</b> {t("وحدات", "units")}
            </span>
            <span className="dash-chip">
              <TrendingUp size={16} />
              <b>{totals.occupancy}%</b> {t("إشغال", "occupied")}
            </span>
            <span className="dash-chip">
              <CalendarClock size={16} />
              {t("تاريخ السيناريو", "Scenario date")} <b>{asOf}</b>
            </span>
          </div>
          <div className="dash-hero__actions">
            <Link href="/collections" className="btn-primary">
              <CircleDollarSign size={17} />
              {t("تسجيل تحصيل", "Record a collection")}
            </Link>
            <Link href="/billing" className="btn-secondary">
              {t("إصدار فاتورة", "Issue an invoice")}
              <ArrowGo size={16} />
            </Link>
            <Link href="/contract-templates" className="btn-secondary">
              {t("نماذج العقود", "Contract templates")}
            </Link>
            <Link href="/unleased" className="btn-secondary">
              {t("وحدات غير مؤجرة", "Vacant units")}
            </Link>
            <Link href="/marketing" className="btn-secondary">
              {t("التسويق العقاري", "Property marketing")}
            </Link>
          </div>
        </div>
        <div
          className="dash-ring"
          role="img"
          aria-label={t(
            `${ratio}% معالج من استحقاقات الشهر`,
            `${ratio}% of this month's dues handled`
          )}
        >
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle
              className="dash-ring__track"
              cx="100"
              cy="100"
              r="80"
              fill="none"
              strokeWidth="16"
            />
            <circle
              className="dash-ring__value"
              cx="100"
              cy="100"
              r="80"
              fill="none"
              strokeWidth="16"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - Math.min(ratio, 100) / 100)}
            />
          </svg>
          <div className="dash-ring__label">
            <strong>{ratio}%</strong>
            <span>{t("معالج من استحقاقات الشهر", "of this month's dues handled")}</span>
          </div>
        </div>
      </section>

      {showGuide && (
        <section
          className="quick-start"
          aria-label={t("طريقة استخدام النظام", "How to use the system")}
        >
          <strong>{t("ابدأ بأربع خطوات", "Start in four steps")}</strong>
          <ol>
            <li>
              <Link href="/properties">
                <b>1</b> {t("أضف عقارًا أو استورد الإكسل", "Add a property or import Excel")}
              </Link>
            </li>
            <li>
              <Link href="/contract-templates">
                <b>2</b>{" "}
                {t("اختر نموذجًا وعبّئ عقد المستأجر", "Pick a template and fill the lease")}
              </Link>
            </li>
            <li>
              <Link href="/billing">
                <b>3</b>{" "}
                {t("أصدر الفاتورة أو مطالبة الدفع", "Issue the invoice or payment request")}
              </Link>
            </li>
            <li>
              <Link href="/collections">
                <b>4</b> {t("سجّل تحصيل الشهر", "Record the month's collection")}
              </Link>
            </li>
          </ol>
          <button
            className="icon-button"
            aria-label={t("إخفاء طريقة الاستخدام", "Hide the guide")}
            onClick={() => {
              setShowGuide(false);
              try {
                localStorage.setItem("sunnaa-guide-dismissed", "yes");
              } catch {}
            }}
          >
            ×
          </button>
        </section>
      )}

      <div className="stats-grid dashboard-stats">
        <Link href="/properties">
          <Metric
            label={t("عدد العقارات", "Properties")}
            value={String(totals.propertyCount)}
            detail={t("أصول ظاهرة ضمن النطاق الحالي", "Assets in the current scope")}
            icon={<Building2 size={20} />}
          />
        </Link>
        <Link href="/properties">
          <Metric
            label={t("عدد الوحدات", "Units")}
            value={String(totals.unitCount)}
            detail={t(
              `${totals.occupancy}% إشغال ضمن المحفظة`,
              `${totals.occupancy}% occupancy across the portfolio`
            )}
            icon={<Layers3 size={20} />}
          />
        </Link>
        <Link href="/collections">
          <Metric
            label={t("محصّل لاستحقاقات الشهر", "Collected for this month's dues")}
            value={money(collectionTotals.collectedMinor)}
            detail={t(
              "دفعات مستحقات الشهر؛ قد يكون قبضها في أشهر أخرى، وليست حركة النقد خلال الشهر",
              "Payments against this month's dues. They may have been received in other months, so this is not the month's cash movement."
            )}
            icon={<CircleDollarSign size={20} />}
          />
        </Link>
        <Link href="/collections">
          <Metric
            label={t("المتبقي الحالي لمستحقات الشهر", "Still outstanding this month")}
            value={money(collectionTotals.remainingMinor)}
            detail={t(
              `${dueCount} استحقاقات تحتاج متابعة`,
              `${dueCount} dues need follow-up`
            )}
            icon={<Clock3 size={20} />}
          />
        </Link>
        <Link href="/expenses">
          <Metric
            label={t("المصروفات المسددة", "Expenses paid")}
            value={money(totals.expenseMinor)}
            detail={t("ضمن الفترة المختارة", "Within the selected period")}
            icon={<Wallet size={20} />}
          />
        </Link>
        <Link href="/finance">
          <Metric
            label={t("النقد المتاح بعد الحجز", "Cash available after holds")}
            value={money(totals.availableDrawMinor)}
            detail={t(
              "بعد الاحتياطي والتأمين والالتزامات؛ ليس ربحًا",
              "After reserves, deposits and commitments. Not profit."
            )}
            icon={<Wallet size={20} />}
          />
        </Link>
      </div>

      <MonthlyCollectionPanel />
      <details className="analysis-details" open>
        <summary>
          {t("تفاصيل مالية ورسوم وتقارير المحافظ", "Financial detail, charts and portfolio reports")}
        </summary>

        <div className="dashboard-analysis">
          <Panel
            title={t("حركة الدخل والمصروفات", "Income and expenses")}
            description={t(
              "بالريال القطري • من سجلات النموذج المحصّلة",
              "In Qatari riyal • from collected model records"
            )}
            action={
              <div className="chart-legend">
                <span>
                  <i className="green-dot" />
                  {t("الدخل", "Income")}
                </span>
                <span>
                  <i className="gold-dot" />
                  {t("المصروفات", "Expenses")}
                </span>
              </div>
            }
          >
            <div className="cashflow-chart" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chart}
                  margin={{ top: 15, right: 15, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#826c45" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#826c45" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 5"
                    vertical={false}
                    stroke="#e9e1d3"
                  />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "#776c58" }}
                    dy={10}
                  />
                  <YAxis
                    tickFormatter={value => `${value / 1000}k`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "#776c58" }}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      isAr
                        ? new Intl.NumberFormat("en-QA").format(value) + " ر.ق"
                        : "QAR " + new Intl.NumberFormat("en-QA").format(value),
                      name === "income"
                        ? t("الدخل المحصل", "Income collected")
                        : t("المصروفات", "Expenses"),
                    ]}
                    contentStyle={{
                      border: "1px solid #ebe3d5",
                      borderRadius: 12,
                      fontSize: 13,
                      fontFamily: "IBM Plex Sans Arabic",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    stroke="#826c45"
                    strokeWidth={2.5}
                    fill="url(#incomeFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke="#C79A57"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-summary">
              <span>
                {t("صافي نقد الفترة", "Net cash for the period")}{" "}
                <strong>
                  {money(
                    totals.incomeMinor +
                      totals.recoveryMinor -
                      totals.expenseMinor
                  )}
                </strong>
              </span>
              <Link href="/finance" className="link-button">
                {t("تفاصيل السيولة", "Liquidity details")}
                <ArrowGo size={14} />
              </Link>
            </div>
          </Panel>

          <Panel
            title={t("معالجة استحقاقات الشهر", "Handling this month's dues")}
            description={t(
              "الخسائر معالجة محاسبية، وليست إيجارًا محصّلًا؛ والشيك غير المحصّل ليس نقدًا.",
              "Losses are an accounting treatment, not rent collected. An uncollected cheque is not cash."
            )}
          >
            <div className="collection-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donut}
                    dataKey="value"
                    innerRadius={68}
                    outerRadius={82}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    {donut.map(segment => (
                      <Cell key={segment.name} fill={segment.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-label">
                <strong>{ratio}%</strong>
                <span>{t("معالج من الاستحقاق", "of dues handled")}</span>
              </div>
            </div>
            <div className="progress-summary collection-progress-summary">
              <div>
                <span>{t("محصّل مؤكد", "Collected")}</span>
                <strong>{money(collectionTotals.collectedMinor)}</strong>
              </div>
              <div>
                <span>{t("خسارة معالجة", "Written off")}</span>
                <strong>{money(collectionTotals.lossMinor)}</strong>
              </div>
              <div>
                <span>{t("متبقي", "Remaining")}</span>
                <strong>{money(collectionTotals.remainingMinor)}</strong>
              </div>
            </div>
            <Link href="/collections" className="btn-secondary full-width">
              {t("افتح سجل التحصيل", "Open the collections ledger")}
              <ArrowGo size={15} />
            </Link>
          </Panel>
        </div>

        <div className="dashboard-insight">
          <span className="insight-symbol">
            <TrendingUp size={23} />
          </span>
          <div>
            <strong>
              {t(
                "قبل التفكير في أصل جديد، راجع فرص التحسين داخل محفظتك.",
                "Before looking for a new asset, review the improvements inside your portfolio."
              )}
            </strong>
            <p>
              {t(
                `${vacancyCount} وحدات غير مشغولة و${endSoon} عقود نافذة أو مجددة تنتهي خلال 30 يومًا من تاريخ النموذج.`,
                `${vacancyCount} units are unoccupied and ${endSoon} active or renewed leases end within 30 days of the model date.`
              )}
            </p>
          </div>
          <Link
            href="/growth"
            aria-disabled="true"
            onClick={event => event.preventDefault()}
          >
            {t("المستشار العقاري · قريبًا", "Real-estate advisor · Coming soon")}
            <ArrowGo size={17} />
          </Link>
        </div>

        <div className="dashboard-bottom">
          <Panel
            title={t("أداء المحافظ", "Portfolio performance")}
            description={t(
              "محافظ منفصلة، وصورة واحدة للقرار",
              "Separate portfolios, one picture for decisions"
            )}
            action={
              <Link href="/portfolios" className="link-button">
                {t("كل المحافظ", "All portfolios")}
                <ArrowGo size={15} />
              </Link>
            }
          >
            <div className="portfolio-performance">
              {list("portfolios")
                .filter(
                  row =>
                    state.settings.portfolioId === "all" ||
                    row.id === state.settings.portfolioId
                )
                .map(row => {
                  const summary = financialSummary(
                    state.entities,
                    row.id,
                    period
                  );
                  return (
                    <Link
                      href="/portfolios"
                      key={row.id}
                      className="portfolio-performance-row"
                    >
                      <span className="portfolio-avatar">
                        <Wallet size={21} />
                      </span>
                      <div>
                        <strong>{row.title}</strong>
                        <span>
                          {t(
                            `${summary.propertyCount} عقارات • ${summary.unitCount} وحدات`,
                            `${summary.propertyCount} properties • ${summary.unitCount} units`
                          )}
                        </span>
                      </div>
                      <div className="portfolio-income">
                        <strong>{money(summary.incomeMinor)}</strong>
                        <span>{t("محصّل خلال الفترة", "collected in the period")}</span>
                      </div>
                      <Badge tone="green">
                        {t(
                          `${summary.occupancy}% إشغال`,
                          `${summary.occupancy}% occupied`
                        )}
                      </Badge>
                    </Link>
                  );
                })}
            </div>
            <div className="thin-divider" />
            <div className="mini-ledger">
              <div>
                <span>{t("رصيد النقد المؤكد", "Confirmed cash balance")}</span>
                <strong>{money(totals.cashMinor)}</strong>
              </div>
              <div>
                <span>{t("تأمينات محجوزة", "Deposits held")}</span>
                <strong>{money(totals.depositMinor)}</strong>
              </div>
              <div>
                <span>{t("احتياطي مخصص", "Reserve set aside")}</span>
                <strong>{money(totals.reserveMinor)}</strong>
              </div>
            </div>
          </Panel>
          <Panel
            title={t("المهام والموجز · قريبًا", "Tasks and daily brief · Coming soon")}
            description={t(
              "الأولوية من المواعيد، لا من رسائل متفرقة",
              "Priorities come from due dates, not scattered messages"
            )}
            action={
              <Link
                href="/tasks"
                className="link-button"
                aria-disabled="true"
                onClick={event => event.preventDefault()}
              >
                {t("المهام", "Tasks")}
                <ArrowGo size={15} />
              </Link>
            }
          >
            <div className="task-preview-list">
              {tasks.slice(0, 4).map(row => (
                <Link
                  href="/tasks"
                  key={row.id}
                  className="task-preview"
                  aria-disabled="true"
                  onClick={event => event.preventDefault()}
                >
                  <span
                    className={`task-marker ${row.meta.priority === "عاجل" ? "urgent" : ""}`}
                  >
                    <CalendarClock size={17} />
                  </span>
                  <div>
                    <strong>{row.title}</strong>
                    <span>
                      {String(row.meta.owner ?? "موظف النموذج")} •{" "}
                      {String(row.meta.due ?? row.date)}
                    </span>
                  </div>
                  <Badge tone={row.meta.priority === "عاجل" ? "amber" : "gray"}>
                    {String(row.meta.priority ?? "عادي")}
                  </Badge>
                </Link>
              ))}
              {tasks.length === 0 && (
                <div className="empty-state">
                  <CheckCircle2 size={27} />
                  <h3>{t("لا مهام مفتوحة في هذا النطاق", "No open tasks in this scope")}</h3>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <Panel
          title={t("آخر حركات التحصيل", "Latest collections")}
          action={
            <Link href="/collections" className="link-button">
              {t("كل الحركات", "All transactions")}
              <ArrowGo size={15} />
            </Link>
          }
        >
          <EntityTable
            rows={transactions}
            columns={[
              {
                key: "title",
                label: t("الحركة", "Transaction"),
                render: row => (
                  <div className="table-title">
                    <strong>{row.title}</strong>
                    <span>
                      {list("properties").find(
                        property => property.id === row.propertyId
                      )?.title ?? t("المحفظة", "Portfolio")}
                    </span>
                  </div>
                ),
              },
              { key: "date", label: t("التاريخ", "Date") },
              {
                key: "method",
                label: t("الطريقة", "Method"),
                render: row => String(row.meta.method ?? "-"),
              },
              {
                key: "amountMinor",
                label: t("المبلغ", "Amount"),
                render: row => <b>{money(row.amountMinor)}</b>,
              },
              {
                key: "status",
                label: t("الحالة", "Status"),
                render: row => (
                  <Badge tone={row.status === "محصّل" ? "green" : "amber"}>
                    {row.status}
                  </Badge>
                ),
              },
            ]}
          />
        </Panel>
      </details>
      <div className="dashboard-bottom-caption" data-lang={lang}>
        <Link href="/roadmap">
          {t(
            `${phaseCounts.active} واجهات للمرحلة الأولى • ${phaseCounts.deferred} قريبًا`,
            `${phaseCounts.active} screens in phase 1 • ${phaseCounts.deferred} coming soon`
          )}
        </Link>
        <br />
        {t(
          `تاريخ سيناريو النموذج: ${asOf} • لا تتضمن النتائج توقعًا مضمونًا أو تقييمًا استثماريًا.`,
          `Model scenario date: ${asOf} • Results include no guaranteed forecast or investment valuation.`
        )}
      </div>
    </div>
  );
}
