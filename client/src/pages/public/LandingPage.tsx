import React, { type ReactNode, useMemo, useState } from "react";
import {
  getPublicServices,
  LANDING_HERO,
  SERVICE_CATEGORIES,
  type PublicService,
} from "@shared/public-services";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CircleDollarSign,
  Compass,
  FileCheck2,
  Languages,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { BRAND } from "@/i18n/brand";
import { LanguageSwitch } from "@/i18n/LanguageSwitch";
import { useI18n } from "@/i18n";
import { toEnglish } from "@/i18n/tx";

type Category = (typeof SERVICE_CATEGORIES)[number];
type AvailabilityFilter = "all" | "available" | "upcoming";

const CATEGORY_EN: Record<string, string> = {
  الكل: "All",
  "الأملاك والتأجير": "Property & letting",
  "الماليات والتقارير": "Finance & reports",
  "التشغيل والخدمات": "Operations & services",
  "النمو والفرص": "Growth & opportunities",
  "المنصة والتكاملات": "Platform & integrations",
};

const stateText: Record<PublicService["state"], [string, string]> = {
  available: ["متاح للتجربة", "Available to try"],
  partial: ["متاح جزئيًا", "Partly available"],
  "coming-soon": ["قريبًا", "Coming soon"],
};

function matchesAvailability(
  service: PublicService,
  filter: AvailabilityFilter
) {
  if (filter === "available") {
    return service.state === "available" || service.state === "partial";
  }
  if (filter === "upcoming") {
    return service.state === "coming-soon";
  }
  return true;
}

function serviceSearchText(service: PublicService) {
  const arabic = [
    service.id,
    service.title,
    service.description,
    service.category,
    service.label,
    service.detail,
  ].join(" ");
  // search in both languages so "maintenance" finds the same card as "صيانة"
  const english = [service.title, service.description, service.category]
    .map(toEnglish)
    .join(" ");
  return `${arabic} ${english}`.toLocaleLowerCase();
}

function StatusBadge({ service }: { service: PublicService }) {
  const { t } = useI18n();
  const [ar, en] = stateText[service.state];
  return (
    <span className={`sf-status sf-status--${service.state}`}>
      {service.label ? service.label : t(ar, en)}
    </span>
  );
}

function ServiceCard({ service }: { service: PublicService }) {
  const { t, isAr } = useI18n();
  const isAvailable = service.state !== "coming-soon";
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  return (
    <article className="sf-service-card" data-service-id={service.id}>
      <div className="sf-service-card__meta">
        <span className="sf-service-card__id">{service.id}</span>
        <StatusBadge service={service} />
      </div>
      <div className="sf-service-card__body">
        <p className="sf-service-card__category">{service.category}</p>
        <h3>{service.title}</h3>
        <p>{service.description}</p>
      </div>
      {isAvailable ? (
        <a className="sf-service-card__link" href={service.path}>
          {service.state === "partial"
            ? t("جرّب الجزء المتاح", "Try the available part")
            : t("فتح التجربة", "Open the demo")}{" "}
          <Arrow size={16} aria-hidden="true" />
        </a>
      ) : (
        <details className="sf-service-card__details">
          <summary>{t("تفاصيل الحالة والحدود", "Status and limits")}</summary>
          <p>{service.detail}</p>
        </details>
      )}
      {service.state === "partial" && (
        <p className="sf-service-card__limit">{service.detail}</p>
      )}
    </article>
  );
}

function FaqItem({
  question,
  children,
}: {
  question: string;
  children: ReactNode;
}) {
  return (
    <details className="sf-faq-item">
      <summary>{question}</summary>
      <div className="sf-faq-item__answer">{children}</div>
    </details>
  );
}

/**
 * Public-only marketing page. It deliberately receives no application context,
 * authentication state, client records, or network data so it can be rendered
 * on the server as-is. Language comes from the optional LanguageProvider and
 * falls back to Arabic when rendered without one.
 */
export function LandingPage() {
  const { t, lang, dir, isAr } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("الكل");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const allServices = useMemo(() => getPublicServices(), []);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  const tryable = allServices.filter(s => s.state !== "coming-soon").length;

  const availabilityOptions: ReadonlyArray<{
    id: AvailabilityFilter;
    label: string;
  }> = [
    { id: "all", label: t("الكل", "All") },
    { id: "available", label: t("المتاح للتجربة", "Available to try") },
    { id: "upcoming", label: t("قريبًا", "Coming soon") },
  ];

  const visibleServices = useMemo(
    () =>
      allServices.filter(service => {
        const withinCategory =
          category === "الكل" || service.category === category;
        const matchesQuery =
          !normalizedQuery ||
          serviceSearchText(service).includes(normalizedQuery);
        return (
          withinCategory &&
          matchesAvailability(service, availability) &&
          matchesQuery
        );
      }),
    [allServices, availability, category, normalizedQuery]
  );

  const resetFilters = () => {
    setQuery("");
    setCategory("الكل");
    setAvailability("all");
  };

  const layers = [
    {
      icon: Building2,
      n: "01",
      title: t("إدارة الأملاك", "Property management"),
      text: t(
        "رتّب العقارات والوحدات والعقود ومراحل الشغور والصيانة في سجل واحد قابل للمراجعة.",
        "Keep properties, units, leases, vacancy and maintenance in one record that is easy to review."
      ),
    },
    {
      icon: CircleDollarSign,
      n: "02",
      title: t("صورة مالية مقروءة", "A readable financial picture"),
      text: t(
        "راجع التحصيل والمصروفات والسيولة والكشوف التجريبية، مع فصل واضح بين ما هو مسجل وما يحتاج قرارًا بشريًا.",
        "Review collections, expenses, liquidity and demo statements, with a clear line between what is recorded and what needs a human decision."
      ),
    },
    {
      icon: Compass,
      n: "03",
      title: t("نمو وفرص", "Growth and opportunities"),
      text: t(
        "طبقة للتخطيط وفرص السوق والتمويل ستصل لاحقًا؛ لا تمثل اليوم توصية استثمارية أو تنفيذًا تلقائيًا.",
        "A planning, market and funding layer arrives later. Today it is not an investment recommendation or automatic execution."
      ),
      soon: true,
    },
  ];

  const highlights = [
    {
      icon: FileCheck2,
      text: t("عقود وفواتير وتحصيل مترابطة", "Leases, invoices and collections, connected"),
    },
    {
      icon: Wrench,
      text: t("صيانة وشغور بخطوات واضحة", "Maintenance and vacancy in clear steps"),
    },
    {
      icon: Languages,
      text: t("عربي وEnglish بتبديل فوري", "Arabic and English, one tap to switch"),
    },
    {
      icon: ShieldCheck,
      text: t("بيانات خيالية ولا إرسال فعلي", "Fictional data, nothing is actually sent"),
    },
  ];

  return (
    <main className="sf-public" dir={dir} lang={lang}>
      <header className="sf-header">
        <a
          className="sf-brand"
          href="#start"
          aria-label={t("صنّاع الفرص، بداية الصفحة", "Sunnaa Al-Furas, top of page")}
        >
          <img src={BRAND.logo} alt="" />
          <span>{BRAND.name[lang]}</span>
        </a>

        <nav className="sf-nav" aria-label={t("أقسام الصفحة", "Page sections")}>
          <a href="#approach">{t("كيف تعمل", "How it works")}</a>
          <a href="#services">{t("الخدمات", "Services")}</a>
          <a href="#faq">{t("الأسئلة الشائعة", "FAQ")}</a>
        </nav>

        <div className="sf-header__actions">
          <LanguageSwitch />
          <a className="sf-login-link" href="/login">
            {t("تسجيل الدخول", "Sign in")}
          </a>
          <a className="sf-button sf-button--small" href="/register">
            {t("إنشاء حساب", "Create account")}
          </a>
        </div>
      </header>

      <section className="sf-hero" id="start" aria-labelledby="sf-hero-title">
        <div className="sf-hero__copy">
          <p className="sf-eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            {t("مساحة عمل عقارية هادئة وواضحة", "A calm, clear real-estate workspace")}
          </p>
          <h1 id="sf-hero-title">
            {t("أملاكك مرتّبة. وقراراتك أوضح.", "Your properties, in order. Your decisions, clearer.")}
          </h1>
          <p className="sf-hero__lead">
            {t(
              "اجمع ما تحتاجه لإدارة العقار ومراجعته في مكان واحد، ثم ابدأ من تجربة محلية مفهومة بدلًا من ملفات متفرقة وجداول يصعب تتبعها.",
              "Bring everything you need to manage and review a property into one place. Start from a clear local demo instead of scattered files and spreadsheets nobody can follow."
            )}
          </p>
          <div className="sf-hero__actions">
            <a className="sf-button" href="/register">
              {t("ابدأ بإنشاء حساب", "Start by creating an account")}
            </a>
            <a className="sf-button sf-button--quiet" href="/demo">
              {t("جرّب النسخة المحلية", "Try the local demo")}
              <Arrow size={16} aria-hidden="true" />
            </a>
          </div>
          <p className="sf-hero__note">
            {t(
              "إنشاء الحساب يفتح عبر مسار Manus الحالي؛ لا توجد هنا استمارة بريد أو كلمة مرور بديلة.",
              "Creating an account opens through the existing Manus flow. There is no email form or alternative password here."
            )}
          </p>
        </div>
        <div className="sf-hero__image-wrap">
          <img
            className="sf-hero__image"
            src={LANDING_HERO}
            alt={t("صورة توضيحية مولّدة لعمارة خيالية", "Generated illustration of a fictional building")}
          />
          <div className="sf-float sf-float--a">
            <b>{allServices.length}</b>
            <span>{t("خدمة في الدليل", "services in the directory")}</span>
          </div>
          <div className="sf-float sf-float--b">
            <b>{tryable}</b>
            <span>{t("جاهزة للتجربة", "ready to try")}</span>
          </div>
          <div className="sf-hero__caption">
            {t(
              "صورة توضيحية مولّدة، لا تمثل أملاك عميل.",
              "Generated illustration. It does not show any client's property."
            )}
          </div>
        </div>
      </section>

      <ul className="sf-highlights" aria-label={t("أبرز ما في النسخة", "Highlights")}>
        {highlights.map(item => (
          <li key={item.text}>
            <item.icon size={20} aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>

      <section
        className="sf-introduction"
        aria-labelledby="sf-introduction-title"
      >
        <div>
          <p className="sf-eyebrow">
            {t("من ملف إكسل إلى سير عمل أوضح", "From an Excel file to a clearer workflow")}
          </p>
          <h2 id="sf-introduction-title">
            {t("ابدأ بما تعرفه، وانتقل خطوة بخطوة", "Start with what you know, then move step by step")}
          </h2>
        </div>
        <p>
          {t(
            "إن كانت معلوماتك موزعة بين أوراق وعقود ورسائل، فليس المطلوب نقل كل شيء دفعة واحدة. ابدأ بعقار أو عقد أو مصروف، وراجع الصورة تدريجيًا.",
            "If your information is spread across papers, contracts and messages, you do not have to move it all at once. Start with one property, lease or expense and widen the picture gradually."
          )}
        </p>
      </section>

      <section
        className="sf-levels"
        id="approach"
        aria-labelledby="sf-levels-title"
      >
        <div className="sf-section-heading">
          <p className="sf-eyebrow">
            {t("ثلاث طبقات، بترتيب عملي", "Three layers, in a practical order")}
          </p>
          <h2 id="sf-levels-title">
            {t("ما الذي تساعدك المنصة على ترتيبه؟", "What does the platform help you organise?")}
          </h2>
        </div>
        <div className="sf-levels__grid">
          {layers.map(layer => (
            <article
              key={layer.n}
              className={`sf-level-card ${layer.soon ? "sf-level-card--soon" : ""}`}
            >
              <span className="sf-level-card__icon">
                <layer.icon size={22} aria-hidden="true" />
              </span>
              <span className="sf-level-card__number">{layer.n}</span>
              {layer.soon && (
                <span className="sf-status sf-status--coming-soon">
                  {t("قريبًا", "Coming soon")}
                </span>
              )}
              <h3>{layer.title}</h3>
              <p>{layer.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="sf-services"
        id="services"
        aria-labelledby="sf-services-title"
      >
        <div className="sf-section-heading sf-section-heading--services">
          <div>
            <p className="sf-eyebrow">{t("دليل الخدمات", "Service directory")}</p>
            <h2 id="sf-services-title">
              {t(
                "كل ما في النسخة الحالية، بحالته الصريحة",
                "Everything in this version, with its honest status"
              )}
            </h2>
          </div>
          <p>
            {t(
              "تظهر الخدمات المتاحة للتجربة، والوظائف الجزئية، وما هو مؤجل بوضوح. لا تفتح إلا الخدمة المتاحة فعليًا.",
              "Services you can try, partial features and what is deferred are all shown plainly. Only services that are actually available open."
            )}
          </p>
        </div>

        <div
          className="sf-service-controls"
          aria-label={t("البحث وتصفية الخدمات", "Search and filter services")}
        >
          <div className="sf-search-field">
            <label htmlFor="sf-service-search">
              {t("ابحث في الخدمات", "Search services")}
            </label>
            <div className="sf-search-input">
              <Search size={18} aria-hidden="true" />
              <input
                id="sf-service-search"
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t("مثال: عقود، صيانة، سيولة", "e.g. leases, maintenance, liquidity")}
              />
            </div>
          </div>

          <div
            className="sf-filter-group"
            aria-label={t("تصفية حسب الحالة", "Filter by status")}
          >
            <span className="sf-filter-group__label">{t("الحالة", "Status")}</span>
            <div className="sf-filter-pills">
              {availabilityOptions.map(option => (
                <button
                  key={option.id}
                  className="sf-filter-button"
                  type="button"
                  data-availability-filter={option.id}
                  aria-pressed={availability === option.id}
                  onClick={() => setAvailability(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="sf-filter-group"
            aria-label={t("تصفية حسب الفئة", "Filter by category")}
          >
            <span className="sf-filter-group__label">{t("الفئة", "Category")}</span>
            <div className="sf-filter-pills">
              {SERVICE_CATEGORIES.map(item => (
                <button
                  key={item}
                  className="sf-filter-button"
                  type="button"
                  data-service-category={item}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {isAr ? item : (CATEGORY_EN[item] ?? item)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="sf-results-count" aria-live="polite">
          {visibleServices.length === 0
            ? t(
                "لا توجد خدمات مطابقة للبحث أو التصفية الحالية.",
                "No services match the current search or filters."
              )
            : t(
                `عرض ${visibleServices.length} خدمة`,
                `Showing ${visibleServices.length} services`
              )}
        </p>

        {visibleServices.length > 0 ? (
          <div className="sf-services-grid">
            {visibleServices.map(service => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        ) : (
          <div className="sf-empty-state" role="status">
            <h3>{t("لم نجد خدمة بهذه المواصفات", "We could not find a matching service")}</h3>
            <p>
              {t(
                "جرّب كلمة بحث أخرى، أو أعد الفلاتر لعرض كامل دليل الخدمات.",
                "Try another keyword, or reset the filters to see the full directory."
              )}
            </p>
            <button
              className="sf-button sf-button--quiet"
              type="button"
              onClick={resetFilters}
            >
              {t("إعادة ضبط البحث والفلاتر", "Reset search and filters")}
            </button>
          </div>
        )}
      </section>

      <section className="sf-steps" aria-labelledby="sf-steps-title">
        <div className="sf-section-heading">
          <p className="sf-eyebrow">
            {t("بداية بسيطة لمستخدم إكسل", "A simple start for Excel users")}
          </p>
          <h2 id="sf-steps-title">
            {t("ثلاث خطوات دون قفزة كبيرة", "Three steps, no big leap")}
          </h2>
        </div>
        <ol className="sf-steps__list">
          <li>
            <span>1</span>
            <div>
              <h3>{t("اختر ملفًا واحدًا للبدء", "Pick one file to start")}</h3>
              <p>
                {t(
                  "ابدأ بعقار أو وحدة أو عقد تعرفه جيدًا، بدلًا من استيراد كل شيء.",
                  "Begin with a property, unit or lease you know well instead of importing everything."
                )}
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>{t("راجع السجل كما هو", "Review the record as it is")}</h3>
              <p>
                {t(
                  "أدخل البيانات التجريبية وميّز ما يحتاج متابعة قبل اعتماد أي قرار.",
                  "Enter the demo data and mark what needs follow-up before approving any decision."
                )}
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>{t("وسّع الصورة بهدوء", "Widen the picture calmly")}</h3>
              <p>
                {t(
                  "أضف العناصر التالية حين يصبح التسلسل واضحًا لفريقك.",
                  "Add the next pieces once the sequence is clear to your team."
                )}
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="sf-faq" id="faq" aria-labelledby="sf-faq-title">
        <div className="sf-section-heading">
          <p className="sf-eyebrow">{t("أسئلة قبل البدء", "Questions before you start")}</p>
          <h2 id="sf-faq-title">
            {t("إجابات مباشرة بلا وعود زائدة", "Straight answers, no extra promises")}
          </h2>
        </div>
        <div className="sf-faq__list">
          <FaqItem
            question={t("هل تحفظ المنصة وثائقي أو أموالي؟", "Does the platform store my documents or money?")}
          >
            {t(
              "هذه النسخة التجريبية ليست خدمة حفظ وثائق حقيقية، وليست محفظة أموال أو خدمة تحويل. لا تضع وثائق شخصية أو بيانات تشغيلية حساسة في التجربة.",
              "This demo is not a real document storage service, a wallet or a money transfer service. Do not put personal documents or sensitive operating data into it."
            )}
          </FaqItem>
          <FaqItem
            question={t("هل أستطيع التجربة قبل إنشاء حساب؟", "Can I try it before creating an account?")}
          >
            {isAr ? (
              <>
                نعم. رابط التجربة المحلية يفتح <a href="/demo">نسخة توضيحية محلية</a>{" "}
                ببيانات مصطنعة، وهو موصوف بوضوح كتجربة لا كحسابك الفعلي.
              </>
            ) : (
              <>
                Yes. The local demo link opens a <a href="/demo">local preview</a>{" "}
                with synthetic data, clearly described as a trial and not your real account.
              </>
            )}
          </FaqItem>
          <FaqItem
            question={t("هل المستشار العقاري متاح الآن؟", "Is the real-estate advisor available now?")}
          >
            {t(
              "طبقة النمو والمستشار ضمن الخدمات القادمة. تعرض الصفحة حالتها صراحة، ولا تقدم توصية استثمارية أو بحث سوق حي أو قرار شراء تلقائيًا.",
              "The growth and advisor layer is among the upcoming services. The page states this openly and offers no investment recommendation, live market search or automatic purchase decision."
            )}
          </FaqItem>
          <FaqItem question={t("كيف أسجل؟", "How do I sign up?")}>
            {isAr ? (
              <>
                استخدم زر <a href="/register">إنشاء حساب</a> لفتح مسار التسجيل في
                Manus الحالي. لا تجمع هذه الصفحة بريدًا إلكترونيًا أو كلمة مرور، ولا
                تنشئ حسابًا بديلًا من داخلها.
              </>
            ) : (
              <>
                Use the <a href="/register">Create account</a> button to open the
                existing Manus sign-up flow. This page collects no email or password
                and does not create an account of its own.
              </>
            )}
          </FaqItem>
        </div>
      </section>

      <section className="sf-final-cta" aria-labelledby="sf-final-cta-title">
        <div className="sf-final-cta__inner">
          <p className="sf-eyebrow">{t("ابدأ من المكان المناسب", "Start from the right place")}</p>
          <h2 id="sf-final-cta-title">
            {t(
              "رتّب أول سجل، ثم خذ الخطوة التالية بوضوح.",
              "Set up your first record, then take the next step with confidence."
            )}
          </h2>
          <p>
            {t(
              "أنشئ حسابًا عبر Manus الحالي، أو افتح التجربة المحلية إذا أردت استكشاف تدفق العمل قبل البدء.",
              "Create an account through the existing Manus flow, or open the local demo to explore the workflow first."
            )}
          </p>
          <a className="sf-button" href="/register">
            {t("إنشاء حساب", "Create account")}
          </a>
          <div className="sf-final-cta__links">
            <a href="/dashboard">{t("الذهاب إلى لوحة الإدارة", "Go to the dashboard")}</a>
            <a href="/demo">{t("تجربة محلية بلا حساب", "Local demo, no account")}</a>
          </div>
        </div>
      </section>

      <footer className="sf-footer">
        <div className="sf-footer__inner">
          <div>
            <p className="sf-footer__brand">{BRAND.name[lang]}</p>
            <p className="sf-footer__note">
              {t(
                "نسخة تجريبية لتوضيح تدفق العمل وإدارة السجل.",
                "A demo version that shows the workflow and record keeping."
              )}
            </p>
          </div>
          <div
            className="sf-footer__links"
            aria-label={t("روابط عامة", "Public links")}
          >
            <a href="/login">{t("تسجيل الدخول", "Sign in")}</a>
            <a href="/register">{t("إنشاء حساب", "Create account")}</a>
            <a href="/demo">{t("التجربة المحلية", "Local demo")}</a>
            <span>
              {t(
                "ليست وثائق حقيقية أو خدمة حفظ أموال، ولا تتضمن وعود عوائد أو أسعار اشتراك غير مقررة.",
                "Not real documents or a money-holding service, and it contains no promised returns or unapproved subscription prices."
              )}
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
