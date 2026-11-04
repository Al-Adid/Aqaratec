import { useMemo, useState } from "react";
import {
  Download,
  FilePlus2,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { usePrototype } from "@/contexts/PrototypeContext";
import { financialSummary } from "@/lib/prototype-finance";
import {
  Badge,
  DemoNotice,
  EntityTable,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
} from "@/components/app/Primitives";
import {
  ChartPanel,
  LocalOnly,
  PLAN_OPTIONS,
  StatusLine,
  bpsLabel,
  downloadLocalExport,
  entityInput,
  money,
  parseMinor,
  sumMinor,
} from "./DecisionShared";

const ROLE_MATRIX = [
  {
    role: "صاحب القرار",
    scope: "المحافظ المصرح بها",
    read: "قراءة افتراضية",
    change: "لا تعديل عام",
    approval: "موافقة مستقلة محددة",
  },
  {
    role: "المشغّل",
    scope: "محفظة أو عقار مفوض",
    read: "قراءة وتشغيل",
    change: "ضمن النطاق",
    approval: "لا يعتمد طلبه الحساس",
  },
  {
    role: "المشرف",
    scope: "المجمع المصرح",
    read: "قراءة ومراجعة",
    change: "لا تلقائياً",
    approval: "حسب تفويض مستقل",
  },
  {
    role: "مراجع مالي",
    scope: "فترة ومحفظة محددتان",
    read: "قراءة مقيدة",
    change: "لا تعديل",
    approval: "لا يحرر أو يعتمد",
  },
];

function ownerShareBps(owner: { meta: Record<string, unknown> }): number {
  const direct = owner.meta.shareBps;
  if (
    typeof direct === "number" &&
    Number.isSafeInteger(direct) &&
    direct >= 0 &&
    direct <= 10000
  )
    return direct;
  // توافق عرضي مع بذور قديمة؛ لا يكتب هذا المسار إلى الحالة ولا يخلط محافظاً مختلفة.
  const legacyShare = owner.meta.share;
  if (typeof legacyShare === "number" && Number.isFinite(legacyShare)) {
    const bps = Math.round(legacyShare * 100);
    return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000 ? bps : 0;
  }
  return 0;
}

function ownerEffectiveDate(owner: {
  meta: Record<string, unknown>;
  date: string;
}): string {
  const modern = owner.meta.effectiveDate;
  if (typeof modern === "string" && modern) return modern;
  const legacy = owner.meta.effective;
  return typeof legacy === "string" && legacy ? legacy : owner.date;
}

export function OwnershipPage() {
  const { state, list, add, log, canEdit } = usePrototype();
  const portfolios = list("portfolios");
  const portfolioIds = new Set(portfolios.map(portfolio => portfolio.id));
  const requestedPortfolioId = state.settings.portfolioId;
  // عند «كل المحافظ» نعرض أول محفظة صالحة فقط؛ لا يجوز جمع حصص 100% مستقلة إلى 200%.
  const ownershipPortfolioId =
    requestedPortfolioId !== "all" && portfolioIds.has(requestedPortfolioId)
      ? requestedPortfolioId
      : (portfolios[0]?.id ?? "");
  const scopeName =
    portfolios.find(portfolio => portfolio.id === ownershipPortfolioId)
      ?.title ?? "لا توجد محفظة صالحة";
  const inScope = (row: { portfolioId: string }) =>
    row.portfolioId === ownershipPortfolioId;
  const owners = list("owners").filter(inScope);
  const contributions = list("contributions").filter(inScope);
  const reserves = list("reserves").filter(inScope);
  const distributions = list("distributions").filter(inScope);
  const scopedFinancials = financialSummary(
    state.entities,
    ownershipPortfolioId,
    state.settings.period
  );
  const [result, setResult] = useState(
    "لم يُنشأ توزيع بعد؛ هذه الشاشة لا تدفع أو تحوّل أي مال."
  );

  const ownershipBps = owners.reduce(
    (total, owner) => total + ownerShareBps(owner),
    0
  );
  const reserveMinor = sumMinor(reserves);
  const totalContributionsMinor = sumMinor(contributions);
  const availableForProposalMinor = Math.max(
    0,
    scopedFinancials.incomeMinor - scopedFinancials.expenseMinor - reserveMinor
  );
  const ownershipChart = useMemo(
    () =>
      owners.map(owner => ({
        name: owner.title,
        share: ownerShareBps(owner) / 100,
      })),
    [owners]
  );
  const canSave = canEdit && Boolean(ownershipPortfolioId);

  const createDistribution = () => {
    if (!canSave) {
      setResult(
        "معاينة القراءة لا تنشئ تقرير توزيع. يعرض النموذج النطاق والنتيجة المقيدة فقط من دون استدعاء حفظ."
      );
      return;
    }
    if (!owners.length || ownershipBps !== 10000) {
      const message =
        "لا يمكن إنشاء توزيع مقترح: يلزم نسب مؤرخة مكتملة بمجموع 100% داخل المحفظة المعروضة وحدها. لم يُنشأ دفع أو تحويل.";
      setResult(message);
      log("امتناع عن توزيع مقترح", message);
      return;
    }
    add(
      "distributions",
      entityInput("توزيع مقترح للمراجعة", {
        portfolioId: ownershipPortfolioId,
        status: "محسوب للمراجعة",
        amountMinor: availableForProposalMinor,
        meta: {
          basis: "دخل تجريبي ناقص مصروف واحتياطي ضمن نطاق المحفظة",
          ownerCount: owners.length,
          paymentCreated: false,
          portfolioScope: ownershipPortfolioId,
        },
      })
    );
    const message = `أُنشئ تقرير توزيع محلي بقيمة ${money(availableForProposalMinor)} للمراجعة فقط في ${scopeName}؛ لا توجد دفعة أو تحويل.`;
    setResult(message);
    log("إنشاء توزيع مقترح", message);
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F03 · ملكية مشتركة"
        title="دفتر الملكية والتوزيع المقترح"
        description="نسب مؤرخة ومساهمات واحتياطي داخل محفظة واحدة. اعتماد التقرير لا يحرّك أموالاً."
      />
      <DemoNotice mode="interactive">
        كل السجلات هنا صورية ومحفوظة محلياً. عند اختيار «كل المحافظ»، يعرض F03
        أول محفظة صالحة فقط كي لا يجمع نسب محافظ منفصلة.
      </DemoNotice>

      <StatusLine tone={requestedPortfolioId === "all" ? "amber" : "blue"}>
        {requestedPortfolioId === "all"
          ? `نطاق F03 المقيد: ${scopeName} (اختيرت محفظة واحدة من «كل المحافظ»).`
          : `نطاق F03: ${scopeName}.`}
      </StatusLine>
      <div className="stats-grid">
        <Metric
          label="نسب فعّالة"
          value={bpsLabel(ownershipBps)}
          detail="يلزم 100% داخل المحفظة قبل اقتراح التوزيع"
          icon={<UsersRound size={18} />}
        />
        <Metric
          label="المساهمات المسجلة"
          value={money(totalContributionsMinor)}
          detail="سجل مساهمات محلي ضمن النطاق"
          icon={<Landmark size={18} />}
        />
        <Metric
          label="الاحتياطي"
          value={money(reserveMinor)}
          detail="منفصل عن التوزيع وفي المحفظة نفسها"
          icon={<LockKeyhole size={18} />}
        />
        <Metric
          label="المتاح للتقرير"
          value={money(availableForProposalMinor)}
          detail="حساب صوري قابل للتفسير ضمن النطاق"
          icon={<FilePlus2 size={18} />}
        />
      </div>

      <div className="split-layout">
        <Panel
          title="الشركاء والنسب المؤرخة"
          description="تحفظ النسبة بوحدة أساس (1% = 100 نقطة أساس) حتى لا تكون قيمة مالية عائمة."
          action={
            <FormDialog
              title="إضافة نسبة شريك"
              description="أضف تاريخ سريان واضحاً؛ لا تستبدل نسبة سابقة بلا أثر."
              trigger={
                <button className="btn-primary" disabled={!canSave}>
                  <UserRoundCheck size={16} /> إضافة شريك
                </button>
              }
              fields={[
                { key: "name", label: "اسم الشريك الصوري", required: true },
                {
                  key: "share",
                  label: "النسبة %",
                  type: "number",
                  required: true,
                  placeholder: "25",
                },
                {
                  key: "effectiveDate",
                  label: "تاريخ السريان",
                  type: "date",
                  required: true,
                  defaultValue: "2026-10-24",
                },
              ]}
              submitLabel="حفظ النسبة محلياً"
              onSubmit={values => {
                if (!canSave) {
                  setResult(
                    "معاينة القراءة لا تحفظ نسبة ملكية. اختر دور المشغّل ومحفظة صالحة لتجربة التسجيل."
                  );
                  return;
                }
                const shareBps = Math.round(Number(values.share) * 100);
                if (
                  !Number.isSafeInteger(shareBps) ||
                  shareBps <= 0 ||
                  ownershipBps + shareBps > 10000
                ) {
                  setResult(
                    "تعذر الحفظ: يجب أن تبقى حصص النسب الفعالة عند 100% أو أقل داخل المحفظة المعروضة."
                  );
                  return;
                }
                add(
                  "owners",
                  entityInput(values.name, {
                    portfolioId: ownershipPortfolioId,
                    status: "معتمدة بتاريخ سريان",
                    date: values.effectiveDate,
                    meta: {
                      shareBps,
                      effectiveDate: values.effectiveDate,
                      scope: scopeName,
                    },
                  })
                );
                const message = `حُفظت نسبة ${bpsLabel(shareBps)} للشريك ${values.name} بتاريخ ${values.effectiveDate} في ${scopeName}.`;
                setResult(message);
                log("إضافة نسبة ملكية مؤرخة", message);
              }}
            />
          }
        >
          <EntityTable
            rows={owners}
            empty="لا توجد نسب فعلية في نطاق المحفظة المعروض."
            columns={[
              {
                key: "owner",
                label: "الشريك",
                render: row => <strong>{row.title}</strong>,
              },
              {
                key: "share",
                label: "النسبة",
                render: row => bpsLabel(ownerShareBps(row)),
              },
              {
                key: "date",
                label: "السريان",
                render: row => ownerEffectiveDate(row),
              },
              {
                key: "status",
                label: "الحالة",
                render: row => <Badge tone="green">{row.status}</Badge>,
              },
            ]}
          />
        </Panel>
        <ChartPanel
          title="تركيب الملكية"
          description="رسم من نسب المحفظة المحلية المعروضة، وليس إثبات ملكية قانونياً."
          data={ownershipChart}
          dataKey="share"
          format={value => `${value}%`}
        />
      </div>

      <div className="split-layout">
        <Panel
          title="المساهمات والاحتياطي"
          description="المساهمة سجل محلي مستقل. الاحتياطي لا يختلط بالمبلغ المتاح للتوزيع."
          action={
            <div className="action-row">
              <FormDialog
                title="تسجيل مساهمة صورية"
                trigger={
                  <button className="btn-secondary" disabled={!canSave}>
                    إضافة مساهمة
                  </button>
                }
                fields={[
                  { key: "partner", label: "الشريك", required: true },
                  {
                    key: "amount",
                    label: "المبلغ ر.ق",
                    type: "number",
                    required: true,
                    placeholder: "1000.00",
                  },
                  {
                    key: "date",
                    label: "التاريخ",
                    type: "date",
                    required: true,
                    defaultValue: "2026-10-24",
                  },
                ]}
                submitLabel="تسجيل محلي"
                onSubmit={values => {
                  if (!canSave) {
                    setResult(
                      "معاينة القراءة لا تسجل مساهمة. لا يُستدعى إجراء الحفظ المحروس."
                    );
                    return;
                  }
                  const parsed = parseMinor(values.amount);
                  if (parsed.error || parsed.value === undefined) {
                    setResult(parsed.error ?? "مبلغ غير صالح");
                    return;
                  }
                  add(
                    "contributions",
                    entityInput(`مساهمة ${values.partner}`, {
                      portfolioId: ownershipPortfolioId,
                      date: values.date,
                      amountMinor: parsed.value,
                      status: "مسجلة صوريًا",
                      meta: { partner: values.partner },
                    })
                  );
                  const message = `سُجلت مساهمة صورية بقيمة ${money(parsed.value)}؛ لم تُحصل أو تُحوّل أموال.`;
                  setResult(message);
                  log("تسجيل مساهمة ملكية", message);
                }}
              />
              <FormDialog
                title="تخصيص احتياطي صوري"
                trigger={
                  <button className="btn-secondary" disabled={!canSave}>
                    تخصيص احتياطي
                  </button>
                }
                fields={[
                  {
                    key: "amount",
                    label: "المبلغ ر.ق",
                    type: "number",
                    required: true,
                  },
                  {
                    key: "reason",
                    label: "السبب",
                    type: "textarea",
                    required: true,
                  },
                ]}
                submitLabel="حفظ الاحتياطي"
                onSubmit={values => {
                  if (!canSave) {
                    setResult(
                      "معاينة القراءة لا تخصص احتياطياً. لا يُستدعى إجراء الحفظ المحروس."
                    );
                    return;
                  }
                  const parsed = parseMinor(values.amount);
                  if (parsed.error || parsed.value === undefined) {
                    setResult(parsed.error ?? "مبلغ غير صالح");
                    return;
                  }
                  add(
                    "reserves",
                    entityInput("احتياطي ملكية", {
                      portfolioId: ownershipPortfolioId,
                      amountMinor: parsed.value,
                      status: "مخصص صوريًا",
                      meta: { reason: values.reason },
                    })
                  );
                  const message = `خُصص احتياطي محلي قدره ${money(parsed.value)} بسبب: ${values.reason}.`;
                  setResult(message);
                  log("تخصيص احتياطي", message);
                }}
              />
            </div>
          }
        >
          <EntityTable
            rows={[...contributions, ...reserves].sort((a, b) =>
              b.date.localeCompare(a.date)
            )}
            empty="لا توجد مساهمات أو احتياطي في نطاق المحفظة."
            columns={[
              { key: "record", label: "السجل", render: row => row.title },
              { key: "date", label: "التاريخ", render: row => row.date },
              {
                key: "amount",
                label: "القيمة",
                render: row => money(row.amountMinor),
              },
              {
                key: "status",
                label: "الحالة",
                render: row => <Badge tone="blue">{row.status}</Badge>,
              },
            ]}
          />
        </Panel>
        <Panel
          title="تقرير التوزيع"
          description="يظل اقتراحاً داخل النموذج حتى بعد اعتماده كتقرير؛ لا ينشئ دفعة."
        >
          <p className="mini-label">حالة الإجراء</p>
          <p>{result}</p>
          <button
            className="btn-primary"
            onClick={createDistribution}
            disabled={!canSave}
          >
            <FilePlus2 size={16} /> إنشاء تقرير توزيع للمراجعة
          </button>
          <div className="mini-list">
            {distributions.slice(0, 3).map(distribution => (
              <div key={distribution.id}>
                <strong>{distribution.title}</strong>
                <span>
                  {money(distribution.amountMinor)} · {distribution.status}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <LocalOnly>
        لا توجد تعليمات دفع أو تحويل أو حسابات مصرفية في F03؛ يحفظ النموذج
        تقريراً قابلاً للمراجعة فقط.
      </LocalOnly>
    </div>
  );
}

export function SettingsPage() {
  const { state, list, add, patch, setSetting, log, canEdit } = usePrototype();
  const delegations = list("delegations");
  const approvals = list("approvals");
  const subscriptions = list("subscriptions");
  const [accessResult, setAccessResult] = useState(
    "صاحب القرار قارئ افتراضياً؛ الاعتماد صلاحية مستقلة وليست تحريراً عاماً."
  );
  const [subscriptionResult, setSubscriptionResult] = useState(
    "الأسعار وحدود الباقات معروضة للتجربة وليست عرضاً معتمداً أو فاتورة."
  );
  const latestSubscription = subscriptions[0];

  const requestSensitiveChange = (values: Record<string, string>) => {
    if (!canEdit) {
      setAccessResult(
        "معاينة القراءة لا تسجل طلب تغيير حساس. النتيجة مرئية ومقيدة من دون استدعاء add."
      );
      return;
    }
    if (values.requester.trim() === values.approver.trim()) {
      const message =
        "مُنع الطلب: لا يمكن لمقدم طلب تغيير حساس أن يعتمد طلبه بنفسه.";
      setAccessResult(message);
      log("منع اعتماد ذاتي", message);
      return;
    }
    add(
      "approvals",
      entityInput(`طلب ${values.change}`, {
        status: "بانتظار معتمد مستقل",
        meta: {
          requester: values.requester,
          approver: values.approver,
          portfolioScope: values.scope,
          selfApprovalBlocked: true,
        },
      })
    );
    const message = `سُجل طلب تغيير حساس باسم ${values.requester} وينتظر ${values.approver} بشكل مستقل؛ لم يتغير أي حساب فعلي.`;
    setAccessResult(message);
    log("طلب تغيير حساس", message);
  };

  const choosePlan = (key: string, title: string) => {
    if (!canEdit) {
      setSubscriptionResult(
        `معاينة القراءة تعرض «${title}» فقط؛ لم يُحفظ طلب تغيير ولم يُستدعَ add أو patch.`
      );
      return;
    }
    const record = entityInput(`تجربة تغيير إلى ${title}`, {
      status: "طلب تغيير محلي",
      meta: {
        planKey: key,
        billing: PLAN_OPTIONS.find(plan => plan.key === key)?.billing ?? "",
      },
    });
    if (latestSubscription)
      patch("subscriptions", latestSubscription.id, {
        ...record,
        status: "طلب تغيير محلي",
      });
    else add("subscriptions", record);
    const message = `حُفظت تجربة تغيير الباقة إلى «${title}» محلياً؛ لا اشتراك فعلي ولا تحصيل بطاقة.`;
    setSubscriptionResult(message);
    log("تجربة تغيير باقة", message);
  };

  const exportData = () => {
    const message = downloadLocalExport({
      exportedAt: new Date().toISOString(),
      prototype: true,
      settings: state.settings,
      subscriptions,
    });
    setSubscriptionResult(`${message}. لا غادر أي شيء المتصفح.`);
    log("تصدير بيانات تجربة", message);
  };

  const requestExit = () => {
    if (!canEdit) {
      setSubscriptionResult(
        "معاينة القراءة لا تسجل طلب خروج. تظهر نتيجة مقيدة ولا يُستدعى patch أو add."
      );
      return;
    }
    if (latestSubscription)
      patch("subscriptions", latestSubscription.id, {
        status: "طلب خروج محلي",
        meta: { ...latestSubscription.meta, exitRequestedAt: "2026-10-24" },
      });
    else
      add(
        "subscriptions",
        entityInput("طلب خروج من تجربة الباقة", {
          status: "طلب خروج محلي",
          meta: { planKey: "none" },
        })
      );
    const message =
      "سُجل طلب خروج وتجهيز للتصدير محلياً؛ لا إلغاء مزود أو حذف سحابي في هذا النموذج.";
    setSubscriptionResult(message);
    log("طلب خروج من التجربة", message);
  };

  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="F01 + F34 · الحوكمة والمنصة"
        title="الوصول، الموافقات والباقات"
        description="معاينة الأدوار واجهة سيناريو فقط وليست جلسة هوية أو تفويضاً خادمياً."
      />
      <DemoNotice mode="interactive">
        تغييرات الدور والباقات تحفظ في البروتوتايب المحلي. لا تمنح هذه المعاينة
        صلاحيات حقيقية ولا تشغل اشتراكاً.
      </DemoNotice>

      <div className="split-layout">
        <Panel
          title="معاينة الدور"
          description="تغير ما تراه في النموذج فقط؛ لا يثبت هوية ولا يعدّل صلاحيات الخادم."
        >
          <label className="mini-label" htmlFor="role-preview">
            الدور المعروض
          </label>
          <select
            id="role-preview"
            className="field"
            value={state.settings.role}
            onChange={event => {
              setSetting("role", event.target.value);
              setAccessResult(
                `تغيرت معاينة الدور إلى ${event.target.value}. هذه ليست مصادقة أو صلاحية خادم.`
              );
              log("تغيير معاينة الدور", event.target.value);
            }}
          >
            <option value="operator">مشغّل</option>
            <option value="owner">صاحب قرار</option>
            <option value="tenant">مستأجر</option>
            <option value="vendor">مقاول</option>
          </select>
          <StatusLine tone={canEdit ? "green" : "amber"}>
            {canEdit
              ? "المشهد الحالي يسمح بتعديل تجريبي للمشغّل."
              : "المشهد الحالي للقراءة؛ لا يمنح تحريراً عاماً."}
          </StatusLine>
          <p className="muted">{accessResult}</p>
        </Panel>
        <Panel
          title="نطاق المحفظة"
          description="المصفوفة تعرض النطاق المقصود؛ لا تعد دليلاً أمنياً بذاتها."
        >
          <Metric
            label="نطاق التجربة"
            value={state.settings.portfolioId || "كل المحافظ الصورية"}
            detail="التحقق الحقيقي مكانه في الخادم"
            icon={<ShieldCheck size={18} />}
          />
          <LocalOnly>
            مالك المحفظة يقرأ افتراضياً، ولا يصبح مشغّلاً أو معتمداً بمجرد
            اختيار الدور في المعاينة.
          </LocalOnly>
        </Panel>
      </div>

      <Panel
        title="مصفوفة الوصول"
        description="الفصل ظاهر بين القراءة والتعديل والموافقة؛ مدير العضويات لا يحصل على تفويض مالي تلقائياً."
      >
        <EntityTable
          rows={ROLE_MATRIX.map((item, index) => ({
            ...entityInput(item.role, {
              portfolioId: `role-${index}`,
              subtitle: item.scope,
              meta: item,
            }),
            id: `role-${index}`,
          }))}
          columns={[
            {
              key: "role",
              label: "الدور",
              render: row => <strong>{row.title}</strong>,
            },
            {
              key: "scope",
              label: "النطاق",
              render: row => String(row.meta.scope),
            },
            {
              key: "read",
              label: "القراءة",
              render: row => String(row.meta.read),
            },
            {
              key: "change",
              label: "التعديل",
              render: row => String(row.meta.change),
            },
            {
              key: "approval",
              label: "الموافقة",
              render: row => String(row.meta.approval),
            },
          ]}
        />
      </Panel>

      <div className="split-layout">
        <Panel
          title="تفويض مؤقت وتغيير حساس"
          description="كل تغيير حساس يمر بين مقدم الطلب ومعتمد مختلف. يمنع النموذج الاعتماد الذاتي صراحة."
          action={
            <div className="action-row">
              <FormDialog
                title="طلب تفويض مؤقت"
                trigger={
                  <button className="btn-secondary" disabled={!canEdit}>
                    إضافة تفويض
                  </button>
                }
                fields={[
                  { key: "delegate", label: "المفوَّض له", required: true },
                  {
                    key: "scope",
                    label: "نطاق المحفظة أو العقار",
                    required: true,
                  },
                  {
                    key: "expires",
                    label: "ينتهي في",
                    type: "date",
                    required: true,
                  },
                ]}
                submitLabel="طلب التفويض"
                onSubmit={values => {
                  if (!canEdit) {
                    setAccessResult("معاينة القراءة لا تحفظ تفويضاً مؤقتاً.");
                    return;
                  }
                  add(
                    "delegations",
                    entityInput(`تفويض ${values.delegate}`, {
                      status: "مطلوب اعتماد مستقل",
                      date: values.expires,
                      meta: {
                        delegate: values.delegate,
                        scope: values.scope,
                        expires: values.expires,
                      },
                    })
                  );
                  const message = `أضيف طلب تفويض مؤقت لـ${values.delegate} حتى ${values.expires} ضمن ${values.scope}.`;
                  setAccessResult(message);
                  log("طلب تفويض مؤقت", message);
                }}
              />
              <FormDialog
                title="طلب تغيير حساب أو صلاحية حساسة"
                description="استخدم اسمين مختلفين؛ لا توجد أي بيانات حساب حقيقية في النموذج."
                trigger={
                  <button className="btn-primary" disabled={!canEdit}>
                    طلب موافقة مستقلة
                  </button>
                }
                fields={[
                  {
                    key: "change",
                    label: "نوع التغيير",
                    required: true,
                    placeholder: "تعديل صلاحية حساسة",
                  },
                  { key: "requester", label: "مقدم الطلب", required: true },
                  { key: "approver", label: "المعتمد المستقل", required: true },
                  { key: "scope", label: "نطاق المحفظة", required: true },
                ]}
                submitLabel="تسجيل الطلب"
                onSubmit={requestSensitiveChange}
              />
            </div>
          }
        >
          <EntityTable
            rows={[...delegations, ...approvals].slice(0, 6)}
            empty="لا توجد تفويضات أو موافقات مسجلة بعد."
            columns={[
              { key: "name", label: "الطلب", render: row => row.title },
              {
                key: "status",
                label: "الحالة",
                render: row => (
                  <Badge tone={row.status.includes("مستقل") ? "amber" : "blue"}>
                    {row.status}
                  </Badge>
                ),
              },
              {
                key: "scope",
                label: "النطاق/المعتمد",
                render: row =>
                  String(row.meta.scope ?? row.meta.approver ?? "-"),
              },
            ]}
          />
        </Panel>
        <Panel
          title="أثر الضابط"
          description="لا توجد موافقة ذاتية أو تغيير حساب فعلي داخل هذا البروتوتايب."
        >
          <div className="mini-list">
            <div>
              <strong>مقدم الطلب</strong>
              <span>يسجل النطاق والسبب، لا يعتمد بنفسه.</span>
            </div>
            <div>
              <strong>معتمد مستقل</strong>
              <span>إجراء منفصل ومحاكاة فقط، ولا يرسل شيئاً.</span>
            </div>
            <div>
              <strong>سجل محلي</strong>
              <span>يظهر ضمن أنشطة التجربة بدلاً من أي تكامل خارجي.</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="F34 · باقات تجربة غير معتمدة"
        description="الاشتراك بالمنصة منفصل تماماً عن الإيجار والتحصيل. الأسعار التالية ليست سعراً نهائياً أو فاتورة."
      >
        <div className="plan-grid">
          {PLAN_OPTIONS.map(plan => (
            <article className="plan-card" key={plan.key}>
              <p className="mini-label">{plan.billing}</p>
              <h3>{plan.title}</h3>
              <p>{plan.price}</p>
              <p className="muted">{plan.setup}</p>
              <p className="muted">{plan.limit}</p>
              <button
                className="btn-secondary"
                disabled={!canEdit}
                onClick={() => choosePlan(plan.key, plan.title)}
              >
                جرّب تغيير الباقة
              </button>
            </article>
          ))}
        </div>
        <p className="muted">{subscriptionResult}</p>
        <div className="action-row">
          <button className="btn-primary" onClick={exportData}>
            <Download size={16} /> تصدير بيانات التجربة
          </button>
          <button
            className="btn-ghost"
            disabled={!canEdit}
            onClick={requestExit}
          >
            طلب خروج محلي
          </button>
        </div>
      </Panel>
    </div>
  );
}
