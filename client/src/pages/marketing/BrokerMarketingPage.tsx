import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  Eye,
  FileText,
  ImageOff,
  Mail,
  Pencil,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import {
  money,
  toMinor,
  type DemoEntity,
  type PrototypeState,
} from "@shared/prototype";
import { loadPropertyMedia, parsePropertyMedia } from "@/lib/property-media";
import {
  brokerCampaignInCurrentScope,
  createBrokerContact,
  getBrokerCampaignBrief,
  isBrokerCampaign,
  isBrokerContact,
  listBrokerTargets,
  saveBrokerCampaignBatches,
  simulateBrokerCampaignBatches,
  updateBrokerContact,
  type BrokerCampaignBrief,
  type BrokerCampaignInput,
  type BrokerContactInput,
  type BrokerContactUpdateInput,
  type BrokerRecipientBrief,
  type BrokerTarget,
} from "@/lib/broker-marketing";
import {
  brokerMailtoLink,
  downloadBrokerBrief,
  downloadBrokerEmailDraft,
} from "@/lib/broker-email-drafts";
import {
  Badge,
  EmptyState,
  FormDialog,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import { usePrototype } from "@/contexts/PrototypeContext";
import "./broker-marketing.css";

type Availability = "vacant" | "expiring" | "sale";
type MarketingGoal = "all" | "rent" | "sale";
type TargetScope = "vacant" | "expiring" | "all";
type TargetSort = "availability" | "property" | "availableFrom";
type BrokerFilter = "all" | "active" | "stopped";
type CampaignBatch = { campaign: DemoEntity; brief: BrokerCampaignBrief };

const DEFAULT_TITLES: Record<MarketingGoal, string> = {
  all: "فرص عقارية جاهزة للمراجعة",
  rent: "فرص تأجير جاهزة للمراجعة",
  sale: "فرص بيع جاهزة للمراجعة",
};

const BROKER_FIELDS = [
  {
    key: "companyName",
    label: "اسم الشركة",
    required: true,
    placeholder: "مثال: دار الوساطة العقارية",
  },
  {
    key: "email",
    label: "البريد الإلكتروني",
    required: true,
    placeholder: "leasing@example.test",
  },
  {
    key: "contactName",
    label: "الشخص المسؤول",
    required: true,
    placeholder: "الاسم المسؤول عن الموجز",
  },
  { key: "phone", label: "الهاتف", placeholder: "+974 …" },
  { key: "website", label: "الموقع الإلكتروني", placeholder: "https://…" },
  { key: "address", label: "العنوان", placeholder: "الدوحة، قطر" },
  {
    key: "notes",
    label: "ملاحظات داخلية",
    type: "textarea" as const,
    placeholder: "معلومة محلية لا تظهر في الموجز.",
  },
  {
    key: "active",
    label: "الحالة",
    type: "select" as const,
    options: [
      { value: "true", label: "نشط · يمكن اختياره مستلمًا" },
      { value: "false", label: "موقوف، محفوظ في السجل ولا يختار مستلمًا" },
    ],
  },
];

function requestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function amountInput(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return "";
  const major = value / 100;
  return Number.isInteger(major)
    ? String(major)
    : major.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function safePropertyImage(value: unknown): string {
  const image = text(value);
  return /^(https:\/\/|http:\/\/|\/manus-storage\/|\/assets\/|\/generated-brand\.webp(?:[?#]|$))/.test(
    image
  )
    ? image
    : "";
}

function brokerIsActive(broker: DemoEntity): boolean {
  return broker.meta.active !== false;
}

function brokerIsEligible(
  broker: DemoEntity,
  portfolioId: PrototypeState["settings"]["portfolioId"] = "all"
): boolean {
  return (
    brokerIsActive(broker) &&
    Boolean(text(broker.meta.email)) &&
    Boolean(text(broker.meta.contactName)) &&
    !broker.propertyId &&
    (!broker.portfolioId ||
      portfolioId === "all" ||
      broker.portfolioId === portfolioId)
  );
}

function displayAvailability(target: BrokerTarget): Availability {
  if (target.availability === "sale") return "sale";
  return target.availability === "expiring" ? "expiring" : "vacant";
}

function targetPurpose(target: BrokerTarget): "rent" | "sale" {
  return target.purpose === "sale" ? "sale" : "rent";
}

function isSaleTarget(target: BrokerTarget): boolean {
  return targetPurpose(target) === "sale";
}
function campaignPriceKey(
  target: Pick<BrokerTarget, "id" | "purpose">
): string {
  return `${target.purpose === "sale" ? "sale" : "rent"}:${target.id}`;
}
function targetTenancy(target: BrokerTarget): string {
  return text(target.tenancyLabel) || "حالة تأجير غير مسجلة";
}

function campaignTitleForGoal(goal: MarketingGoal): string {
  return DEFAULT_TITLES[goal];
}

function isDefaultCampaignTitle(value: string): boolean {
  return (Object.values(DEFAULT_TITLES) as string[]).includes(value);
}

function targetDate(target: BrokerTarget): string {
  return text(target.availableFrom) || "-";
}

function targetType(target: BrokerTarget): string {
  return text(target.propertyType) || "غير محدد";
}

function targetLocation(target: BrokerTarget): string {
  return text(target.location) || "-";
}

function targetRentSource(target: BrokerTarget): string {
  return (
    target.rentSourceLabel ??
    target.rentSource ??
    "إيجار مقترح من سجل العقار أو الوحدة"
  );
}

function websiteLink(value: string): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function mailtoFor(
  brief: BrokerCampaignBrief,
  recipient: BrokerRecipientBrief
): string | undefined {
  try {
    return brokerMailtoLink(brief, recipient);
  } catch {
    return undefined;
  }
}

function PropertyPreviewImage({
  property,
  title,
}: {
  property?: DemoEntity;
  title: string;
}) {
  const { identity } = usePrototype();
  const declaredImage = safePropertyImage(property?.meta.image);
  const mediaValue = text(property?.meta.propertyMedia);
  const [local, setLocal] = useState<
    "loading" | "available" | "missing" | "none"
  >(declaredImage ? "none" : "loading");
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    if (declaredImage) {
      setLocal("none");
      return () => undefined;
    }
    let photo;
    try {
      photo = parsePropertyMedia(mediaValue).photo;
    } catch {
      photo = undefined;
    }
    if (!photo) {
      setLocal("none");
      return () => undefined;
    }
    setLocal("loading");
    void loadPropertyMedia(identity.storageKey, photo, "photo")
      .then(blob => {
        if (!active) return;
        if (!blob) {
          setLocal("missing");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setLocal("available");
      })
      .catch(() => {
        if (active) setLocal("missing");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [declaredImage, identity.storageKey, mediaValue]);

  if (declaredImage) {
    return (
      <figure className="broker-property-image">
        <img src={declaredImage} alt={`صورة معاينة ${title}`} />
        <figcaption>
          الصورة للمعاينة داخل المتصفح فقط؛ لا تُرسل ولا تصبح مرفقًا.
        </figcaption>
      </figure>
    );
  }
  if (local === "available" && url) {
    return (
      <figure className="broker-property-image">
        <img src={url} alt={`صورة محلية لمعاينة ${title}`} />
        <figcaption>
          بايتات محلية في هذا المتصفح فقط؛ لا تدخل اللقطة ولا تُرسل كمرفق.
        </figcaption>
      </figure>
    );
  }
  if (local === "loading")
    return (
      <p className="broker-image-note">جارٍ تحميل الصورة المحلية للمعاينة…</p>
    );
  if (local === "missing")
    return (
      <p className="broker-image-note">
        توجد إشارة لصورة محلية، لكن بايتاتها غير متاحة هنا.
      </p>
    );
  return (
    <p className="broker-image-note broker-image-note--empty">
      <ImageOff size={15} aria-hidden="true" /> لا توجد صورة معاينة لهذا العقار.
    </p>
  );
}

function AvailabilityBadge({ target }: { target: BrokerTarget }) {
  if (isSaleTarget(target)) return <Badge tone="blue">للبيع</Badge>;
  return displayAvailability(target) === "vacant" ? (
    <Badge tone="green">شاغر الآن</Badge>
  ) : (
    <Badge tone="amber">متاح متوقع</Badge>
  );
}

function FrozenTargetSummary({
  targets,
  label,
}: {
  targets: BrokerCampaignBrief["targets"];
  label: string;
}) {
  return (
    <section className="broker-frozen-targets" aria-label={label}>
      <h4>الأهداف المجمدة</h4>
      <ul>
        {targets.map(target => {
          const sale = target.purpose === "sale";
          const amount = sale ? target.salePriceMinor : target.monthlyRentMinor;
          let amountLabel = "قيمة غير صالحة";
          try {
            amountLabel = money(amount ?? 0);
          } catch {
            /* The frozen body remains available if an old snapshot is malformed. */
          }
          return (
            <li key={target.targetId}>
              <span>
                <strong>{target.propertyTitle}</strong>
                <small>
                  {target.propertyNumber} · {target.unitCode}
                </small>
              </span>
              <span
                className={sale ? "broker-frozen-price" : "broker-card-rent"}
              >
                {sale
                  ? `${amountLabel} سعر البيع المطلوب`
                  : `${amountLabel} شهريًا`}
                {sale && target.tenancyLabel && (
                  <small>للبيع · {target.tenancyLabel}</small>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function briefForCampaign(
  state: PrototypeState,
  campaign: DemoEntity | undefined
): BrokerCampaignBrief | undefined {
  if (!campaign) return undefined;
  try {
    return getBrokerCampaignBrief(state, campaign);
  } catch {
    return undefined;
  }
}

function setHeaderIndeterminate(
  element: HTMLInputElement | null,
  selected: number,
  total: number
): void {
  if (element) element.indeterminate = selected > 0 && selected < total;
}

export function BrokerMarketingPage() {
  const { state, canEdit, commitTransition } = usePrototype();
  const [activeTab, setActiveTab] = useState("properties");
  const [marketingGoal, setMarketingGoal] = useState<MarketingGoal>("all");
  const [targetScope, setTargetScope] = useState<TargetScope>("all");
  const [expiryWindow, setExpiryWindow] = useState<30 | 60 | 90>(60);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("all");
  const [targetSort, setTargetSort] = useState<TargetSort>("availability");
  const [brokerSearch, setBrokerSearch] = useState("");
  const [brokerFilter, setBrokerFilter] = useState<BrokerFilter>("all");
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(DEFAULT_TITLES.all);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preparedCampaignIds, setPreparedCampaignIds] = useState<string[]>([]);
  const [simulationResults, setSimulationResults] = useState<DemoEntity[]>([]);
  const [confirmSimulationOpen, setConfirmSimulationOpen] = useState(false);
  const [selectedHistoricalCampaignId, setSelectedHistoricalCampaignId] =
    useState("");
  const saveRequestIdRef = useRef("");
  const simulationRequestIdRef = useRef("");
  const targetAllRef = useRef<HTMLInputElement>(null);
  const brokerAllRef = useRef<HTMLInputElement>(null);
  const targetIdentityRef = useRef(new Map<string, string>());

  const allTargets = useMemo(() => {
    try {
      return listBrokerTargets(state, {
        includeExpiring: true,
        expiringWithinDays: expiryWindow,
        includeSale: true,
      });
    } catch {
      return [];
    }
  }, [expiryWindow, state]);
  const targetById = useMemo(
    () => new Map(allTargets.map(target => [target.id, target])),
    [allTargets]
  );
  const selectedTargets = selectedTargetIds
    .map(id => targetById.get(id))
    .filter((target): target is BrokerTarget => Boolean(target));
  const targetTypes = useMemo(
    () =>
      [...new Set(allTargets.map(targetType))].sort((a, b) =>
        a.localeCompare(b, "ar")
      ),
    [allTargets]
  );
  const filteredTargets = useMemo(() => {
    const needle = targetSearch.trim().toLocaleLowerCase("ar");
    return allTargets
      .filter(
        target =>
          marketingGoal === "all" || targetPurpose(target) === marketingGoal
      )
      .filter(
        target =>
          isSaleTarget(target) ||
          targetScope === "all" ||
          displayAvailability(target) === targetScope
      )
      .filter(
        target =>
          targetTypeFilter === "all" || targetType(target) === targetTypeFilter
      )
      .filter(target => {
        if (!needle) return true;
        return [
          target.propertyTitle,
          target.propertyNumber,
          target.unitTitle,
          target.unitCode,
          targetType(target),
          targetLocation(target),
        ].some(value => value.toLocaleLowerCase("ar").includes(needle));
      })
      .slice()
      .sort((left, right) => {
        if (targetSort === "property")
          return `${left.propertyNumber}/${left.unitCode}`.localeCompare(
            `${right.propertyNumber}/${right.unitCode}`,
            "ar"
          );
        if (targetSort === "availableFrom")
          return targetDate(left).localeCompare(targetDate(right));
        if (displayAvailability(left) !== displayAvailability(right)) {
          const rank: Record<Availability, number> = {
            vacant: 0,
            expiring: 1,
            sale: 2,
          };
          return (
            rank[displayAvailability(left)] - rank[displayAvailability(right)]
          );
        }
        return targetDate(left).localeCompare(targetDate(right));
      });
  }, [
    allTargets,
    marketingGoal,
    targetScope,
    targetSearch,
    targetTypeFilter,
    targetSort,
  ]);

  const brokers = useMemo(
    () => state.entities.vendors.filter(isBrokerContact),
    [state.entities.vendors]
  );
  const filteredBrokers = useMemo(() => {
    const needle = brokerSearch.trim().toLocaleLowerCase("ar");
    return brokers.filter(broker => {
      const active = brokerIsActive(broker);
      if (brokerFilter === "active" && !active) return false;
      if (brokerFilter === "stopped" && active) return false;
      if (!needle) return true;
      return [
        broker.title,
        text(broker.meta.email),
        text(broker.meta.contactName),
        text(broker.meta.phone),
        text(broker.meta.website),
        text(broker.meta.address),
      ].some(value => value.toLocaleLowerCase("ar").includes(needle));
    });
  }, [brokers, brokerFilter, brokerSearch]);
  const filteredEligibleBrokers = useMemo(
    () =>
      filteredBrokers.filter(broker =>
        brokerIsEligible(broker, state.settings.portfolioId)
      ),
    [filteredBrokers, state.settings.portfolioId]
  );
  const campaigns = useMemo(
    () =>
      state.entities.documents
        .filter(isBrokerCampaign)
        .filter(campaign => brokerCampaignInCurrentScope(state, campaign))
        .slice()
        .sort((left, right) => right.date.localeCompare(left.date)),
    [state.entities.documents, state.settings.portfolioId]
  );
  const preparedBatches = useMemo<CampaignBatch[]>(() => {
    const byId = new Map(
      state.entities.documents.map(document => [document.id, document])
    );
    return preparedCampaignIds.flatMap(id => {
      const campaign = byId.get(id);
      if (!campaign || !brokerCampaignInCurrentScope(state, campaign))
        return [];
      const brief = briefForCampaign(state, campaign);
      return campaign && brief ? [{ campaign, brief }] : [];
    });
  }, [preparedCampaignIds, state]);
  const selectedHistoricalCampaign = campaigns.find(
    campaign => campaign.id === selectedHistoricalCampaignId
  );
  const historicalBrief = useMemo(
    () => briefForCampaign(state, selectedHistoricalCampaign),
    [selectedHistoricalCampaign, state]
  );
  const scopedProperties = useMemo(
    () =>
      state.entities.properties.filter(
        property =>
          state.settings.portfolioId === "all" ||
          property.portfolioId === state.settings.portfolioId
      ),
    [state.entities.properties, state.settings.portfolioId]
  );
  const portfolioName = useMemo(() => {
    if (state.settings.portfolioId === "all") return "كل المحافظ";
    return (
      state.entities.portfolios.find(
        row => row.id === state.settings.portfolioId
      )?.title ?? "المحفظة المختارة"
    );
  }, [state.entities.portfolios, state.settings.portfolioId]);
  const filteredSelectedTargets = filteredTargets.filter(target =>
    selectedTargetIds.includes(target.id)
  );
  const filteredSelectedBrokers = filteredEligibleBrokers.filter(broker =>
    selectedBrokerIds.includes(broker.id)
  );

  useEffect(() => {
    setSelectedBrokerIds(previous =>
      previous.filter(id => {
        const broker = brokers.find(row => row.id === id);
        return Boolean(
          broker && brokerIsEligible(broker, state.settings.portfolioId)
        );
      })
    );
  }, [brokers, state.settings.portfolioId]);

  useEffect(() => {
    const nextIdentity = new Map(
      [...targetById].map(([id, target]) => [
        id,
        `${targetPurpose(target)}:${target.portfolioId}:${target.propertyId}`,
      ])
    );
    const invalidIds = new Set(
      [...targetIdentityRef.current]
        .filter(([id, identity]) => nextIdentity.get(id) !== identity)
        .map(([id]) => id)
    );
    targetIdentityRef.current = nextIdentity;
    setSelectedTargetIds(previous =>
      previous.filter(id => targetById.has(id) && !invalidIds.has(id))
    );
    if (!invalidIds.size) return;
    const invalidPriceKeys = new Set(
      [...invalidIds].flatMap(id => [`rent:${id}`, `sale:${id}`])
    );
    setPriceDraft(previous =>
      Object.fromEntries(
        Object.entries(previous).filter(([key]) => !invalidPriceKeys.has(key))
      )
    );
    if (selectedTargetIds.some(id => invalidIds.has(id))) {
      saveRequestIdRef.current = "";
      simulationRequestIdRef.current = "";
      setPreparedCampaignIds([]);
      setSimulationResults([]);
      setConfirmSimulationOpen(false);
      setFeedback(
        "تغيّر هدف أو نطاق عرض مختار؛ راجع سعره وأعد تحديده قبل التجهيز."
      );
    }
  }, [targetById]);

  useEffect(() => {
    saveRequestIdRef.current = "";
    simulationRequestIdRef.current = "";
    setPreparedCampaignIds([]);
    setSimulationResults([]);
    setSelectedHistoricalCampaignId("");
    setConfirmSimulationOpen(false);
    setFeedback("");
  }, [state.settings.portfolioId]);

  useEffect(() => {
    setHeaderIndeterminate(
      targetAllRef.current,
      filteredSelectedTargets.length,
      filteredTargets.length
    );
  }, [filteredSelectedTargets.length, filteredTargets.length]);

  useEffect(() => {
    setHeaderIndeterminate(
      brokerAllRef.current,
      filteredSelectedBrokers.length,
      filteredEligibleBrokers.length
    );
  }, [filteredEligibleBrokers.length, filteredSelectedBrokers.length]);

  const markCampaignDirty = () => {
    saveRequestIdRef.current = "";
    simulationRequestIdRef.current = "";
    setPreparedCampaignIds([]);
    setSimulationResults([]);
    setConfirmSimulationOpen(false);
    setFeedback("");
  };

  const toggleTarget = (target: BrokerTarget, checked: boolean) => {
    setError("");
    markCampaignDirty();
    setSelectedTargetIds(previous => {
      if (!checked) return previous.filter(id => id !== target.id);
      return previous.includes(target.id) ? previous : [...previous, target.id];
    });
  };

  const toggleAllTargets = (checked: boolean) => {
    setError("");
    markCampaignDirty();
    const ids = filteredTargets.map(target => target.id);
    setSelectedTargetIds(previous => {
      const withoutVisible = previous.filter(id => !ids.includes(id));
      return checked ? [...withoutVisible, ...ids] : withoutVisible;
    });
  };

  const toggleBroker = (brokerId: string, checked: boolean) => {
    const broker = brokers.find(row => row.id === brokerId);
    if (!broker || !brokerIsEligible(broker, state.settings.portfolioId))
      return;
    setError("");
    markCampaignDirty();
    setSelectedBrokerIds(previous => {
      if (!checked) return previous.filter(id => id !== brokerId);
      return previous.includes(brokerId) ? previous : [...previous, brokerId];
    });
  };

  const toggleAllBrokers = (checked: boolean) => {
    setError("");
    markCampaignDirty();
    const ids = filteredEligibleBrokers.map(broker => broker.id);
    setSelectedBrokerIds(previous => {
      const withoutVisible = previous.filter(id => !ids.includes(id));
      return checked ? [...withoutVisible, ...ids] : withoutVisible;
    });
  };

  const setPrice = (target: BrokerTarget, value: string) => {
    setError("");
    markCampaignDirty();
    setPriceDraft(previous => ({
      ...previous,
      [campaignPriceKey(target)]: value,
    }));
  };

  const priceForTarget = (target: BrokerTarget): string =>
    priceDraft[campaignPriceKey(target)] ??
    amountInput(
      isSaleTarget(target)
        ? (target.suggestedSalePriceMinor ?? 0)
        : target.suggestedMonthlyRentMinor
    );

  const hasPositivePrice = (target: BrokerTarget): boolean => {
    try {
      return toMinor(priceForTarget(target)) > 0;
    } catch {
      return false;
    }
  };

  const brokerInput = (values: Record<string, string>): BrokerContactInput => ({
    requestId: requestId("broker-contact"),
    companyName: values.companyName,
    email: values.email,
    contactName: values.contactName,
    phone: values.phone,
    website: values.website,
    address: values.address,
    notes: values.notes,
    active: values.active !== "false",
  });

  const brokerUpdateInput = (
    values: Record<string, string>,
    brokerId: string
  ): BrokerContactUpdateInput => ({
    ...brokerInput(values),
    requestId: requestId("broker-update"),
    brokerId,
  });

  const addBroker = (values: Record<string, string>) => {
    if (!canEdit) return;
    try {
      const input = brokerInput(values);
      const broker = commitTransition(current =>
        createBrokerContact(current, input)
      );
      markCampaignDirty();
      if (brokerIsEligible(broker, state.settings.portfolioId))
        setSelectedBrokerIds(previous =>
          previous.includes(broker.id) ? previous : [...previous, broker.id]
        );
      setFeedback("حُفظت شركة الوساطة محليًا؛ لم تُنشأ رسالة ولم يُرسل بريد.");
      setError("");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "تعذر حفظ شركة الوساطة.";
      setError(message);
      throw caught;
    }
  };

  const editBroker = (broker: DemoEntity, values: Record<string, string>) => {
    if (!canEdit) return;
    try {
      const input = brokerUpdateInput(values, broker.id);
      const updated = commitTransition(current =>
        updateBrokerContact(current, input)
      );
      markCampaignDirty();
      if (!brokerIsEligible(updated, state.settings.portfolioId))
        setSelectedBrokerIds(previous =>
          previous.filter(id => id !== updated.id)
        );
      setFeedback(
        "حُدّث سجل شركة الوساطة محليًا؛ الشركات الموقوفة لا تُختار مستلمًا."
      );
      setError("");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "تعذر تعديل شركة الوساطة.";
      setError(message);
      throw caught;
    }
  };

  const campaignInput = (): BrokerCampaignInput => {
    const targetRentsMinor = Object.fromEntries(
      selectedTargets
        .filter(target => !isSaleTarget(target))
        .map(target => {
          return [target.id, toMinor(priceForTarget(target))];
        })
    );
    const targetSalePricesMinor = Object.fromEntries(
      selectedTargets.filter(isSaleTarget).map(target => {
        return [target.id, toMinor(priceForTarget(target))];
      })
    );
    const request =
      saveRequestIdRef.current || requestId("broker-campaign-batches");
    saveRequestIdRef.current = request;
    return {
      requestId: request,
      title,
      content,
      targetIds: selectedTargetIds,
      brokerIds: selectedBrokerIds,
      targetRentsMinor,
      ...(Object.keys(targetSalePricesMinor).length
        ? { targetSalePricesMinor }
        : {}),
      ...(selectedTargets.some(
        target =>
          !isSaleTarget(target) && displayAvailability(target) === "expiring"
      )
        ? { expiringWithinDays: expiryWindow }
        : {}),
    };
  };

  const prepareBatches = () => {
    if (!canEdit) return;
    if (!selectedTargets.length || !selectedBrokerIds.length) {
      setError(
        "اختر عقارًا واحدًا وشركة وساطة مؤهلة واحدة على الأقل قبل تجهيز الموجز."
      );
      return;
    }
    if (
      selectedTargets.some(
        target => isSaleTarget(target) && !hasPositivePrice(target)
      )
    ) {
      setError("أدخل سعر بيع مطلوبًا موجبًا لكل هدف للبيع قبل تجهيز الموجز.");
      return;
    }
    setError("");
    try {
      const campaignsForAttempt = commitTransition(current =>
        saveBrokerCampaignBatches(current, campaignInput())
      );
      setPreparedCampaignIds(campaignsForAttempt.map(campaign => campaign.id));
      setSelectedHistoricalCampaignId("");
      setFeedback(
        `حُفظت ${campaignsForAttempt.length} دفعة محلية في انتقال واحد. راجع اللقطات والمستلمين ثم أكّد المحاكاة التجريبية.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "تعذر تجهيز دفعات الموجز."
      );
    }
  };

  const simulatePreparedBatches = () => {
    if (!canEdit || !preparedCampaignIds.length) return;
    setError("");
    try {
      const request =
        simulationRequestIdRef.current || requestId("broker-batch-simulation");
      simulationRequestIdRef.current = request;
      const results = commitTransition(current =>
        simulateBrokerCampaignBatches(current, {
          campaignIds: preparedCampaignIds,
          requestId: request,
        })
      );
      setSimulationResults(results);
      setConfirmSimulationOpen(false);
      setFeedback(
        `اكتملت محاكاة ${results.length} دفعة محليًا. لم يُرسل بريد ولم يُتصل بمزود أو شبكة.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "تعذرت محاكاة دفعات الموجز."
      );
    }
  };

  const copyBrief = async (brief: BrokerCampaignBrief) => {
    const value = `${brief.subject}\n\n${brief.body}`;
    if (!navigator.clipboard?.writeText) {
      setError("النسخ غير متاح في هذا المتصفح؛ استخدم تنزيل TXT المحلي.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("نُسخ نص الموجز للمراجعة المحلية؛ لم يُرسل بريد.");
    } catch {
      setError("تعذر النسخ من هذا المتصفح؛ استخدم تنزيل TXT المحلي.");
    }
  };

  const selectedTargetCount = selectedTargets.length;
  const selectedBrokerCount = selectedBrokerIds.length;

  return (
    <div className="section-stack broker-marketing-page">
      <PageHeader
        eyebrow="تسويق الوسطاء"
        title="التسويق العقاري"
        description="اختيار عروض البيع وفرص الإيجار وتجهيز موجز محلي للوسطاء. لا توجد قناة بريد موصولة ولا مرفقات صور محلية."
      />

      <section
        className="broker-marketing-banner"
        role="status"
        aria-label="تنبيه إعداد البريد"
      >
        <Eye size={22} aria-hidden="true" />
        <div>
          <strong>إعداد البريد الحي معلّق</strong>
          <p>
            الحساب <bdi dir="ltr">suhaim@qissatec.com</bdi> مثال تجريبي فقط. لا
            SMTP ولا مزود بريد ولا إرسال بيانات خارج المتصفح.
          </p>
        </div>
      </section>

      {!canEdit && (
        <p className="broker-readonly" role="status">
          هذه معاينة قراءة فقط. تستطيع مراجعة الاختيارات واللقطات ومسودات
          البريد، لكن الاختيار والتعديل والتجهيز والمحاكاة معطلة.
        </p>
      )}
      {error && (
        <p className="broker-error" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="broker-feedback" role="status">
          {feedback}
        </p>
      )}

      <div className="metric-grid broker-metrics">
        <Metric
          label="العقارات في النطاق"
          value={String(scopedProperties.length)}
          detail={`مرشح المحفظة الموروث: ${portfolioName}`}
          icon={<Building2 size={18} />}
        />
        <Metric
          label="أهداف التسويق المتاحة"
          value={String(allTargets.length)}
          detail={`بيع، أو إيجار شاغر/متاح متوقع خلال ${expiryWindow} يومًا`}
          icon={<FileText size={18} />}
        />
        <Metric
          label="أهداف للبيع"
          value={String(allTargets.filter(isSaleTarget).length)}
          detail="تدخل الاختيار والموجز المحلي مثل الإيجار"
          icon={<Building2 size={18} />}
        />
        <Metric
          label="شركات الوساطة"
          value={String(brokers.length)}
          detail={`${brokers.filter(broker => brokerIsEligible(broker, state.settings.portfolioId)).length} مؤهلة للاختيار`}
          icon={<UsersRound size={18} />}
        />
      </div>

      <nav className="broker-steps" aria-label="خطوات تجهيز موجز الوسطاء">
        <button
          type="button"
          className={
            activeTab === "properties"
              ? "broker-step broker-step--active"
              : "broker-step"
          }
          onClick={() => setActiveTab("properties")}
        >
          <span>1</span> اختيار العقارات
          <small>{selectedTargetCount} مختار</small>
        </button>
        <button
          type="button"
          className={
            activeTab === "brokers"
              ? "broker-step broker-step--active"
              : "broker-step"
          }
          onClick={() => setActiveTab("brokers")}
        >
          <span>2</span> اختيار الشركات{" "}
          <small>{selectedBrokerCount} مختار</small>
        </button>
        <button
          type="button"
          className={
            activeTab === "briefs"
              ? "broker-step broker-step--active"
              : "broker-step"
          }
          onClick={() => setActiveTab("briefs")}
        >
          <span>3</span> مراجعة الموجز والتأكيد{" "}
          <small>
            {preparedBatches.length
              ? `${preparedBatches.length} دفعات`
              : "بانتظار التجهيز"}
          </small>
        </button>
      </nav>

      <TabBar
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "properties", label: "العقارات" },
          { key: "brokers", label: "شركات الوساطة" },
          { key: "briefs", label: "الموجز والمراجعة" },
        ]}
      />

      {activeTab === "properties" && (
        <Panel
          title={
            marketingGoal === "sale"
              ? "1. اختيار العقارات للبيع"
              : marketingGoal === "rent"
                ? "1. اختيار العقارات للإيجار"
                : "1. اختيار العقارات للبيع والإيجار"
          }
          description="السعر المقترح ظاهر قبل الاختيار. بعد اختيار الصف يمكن تعديل سعر الموجز فقط؛ الفراغ المتعمد لا يعود إلى قيمة بديلة."
        >
          <div className="broker-toolbar" aria-label="مرشحات العقارات">
            <label>
              هدف التسويق
              <select
                className="field"
                aria-label="هدف التسويق"
                value={marketingGoal}
                onChange={event => {
                  const nextGoal = event.target.value as MarketingGoal;
                  const titleWillChange = isDefaultCampaignTitle(title);
                  setMarketingGoal(nextGoal);
                  if (nextGoal === "sale") setTargetScope("all");
                  setTitle(previous =>
                    isDefaultCampaignTitle(previous)
                      ? campaignTitleForGoal(nextGoal)
                      : previous
                  );
                  if (titleWillChange) markCampaignDirty();
                }}
              >
                <option value="all">الكل · بيع وإيجار</option>
                <option value="rent">للإيجار</option>
                <option value="sale">للبيع</option>
              </select>
            </label>
            <label>
              توافر الإيجار
              <select
                className="field"
                aria-label="توافر الإيجار"
                value={targetScope}
                onChange={event =>
                  setTargetScope(event.target.value as TargetScope)
                }
              >
                <option value="all">كل فرص الإيجار</option>
                <option value="vacant">شاغر الآن</option>
                <option value="expiring">قريب الانتهاء</option>
              </select>
            </label>
            <label>
              نافذة العقود القريبة
              <select
                className="field"
                aria-label="نافذة العقود القريبة"
                value={expiryWindow}
                onChange={event => {
                  markCampaignDirty();
                  setExpiryWindow(Number(event.target.value) as 30 | 60 | 90);
                }}
              >
                <option value={30}>30 يومًا</option>
                <option value={60}>60 يومًا (افتراضي)</option>
                <option value={90}>90 يومًا</option>
              </select>
            </label>
            <label>
              نوع العقار
              <select
                className="field"
                aria-label="نوع العقار"
                value={targetTypeFilter}
                onChange={event => setTargetTypeFilter(event.target.value)}
              >
                <option value="all">كل الأنواع</option>
                {targetTypes.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ترتيب
              <select
                className="field"
                aria-label="ترتيب الأهداف"
                value={targetSort}
                onChange={event =>
                  setTargetSort(event.target.value as TargetSort)
                }
              >
                <option value="availability">الحالة ثم تاريخ التوافر</option>
                <option value="property">رقم العقار والوحدة</option>
                <option value="availableFrom">تاريخ التوافر</option>
              </select>
            </label>
            <label className="broker-toolbar__search">
              بحث
              <input
                className="field"
                value={targetSearch}
                onChange={event => setTargetSearch(event.target.value)}
                placeholder="عقار، رقم، وحدة، نوع أو موقع"
              />
            </label>
          </div>
          <p className="broker-filter-note">
            النطاق الحالي: <strong>{portfolioName}</strong>. تحديد الكل أدناه
            يطبق على كل النتائج المعروضة بالمرشحات، دون قص دفعات 10/20. مرشح
            التوافر يخص الإيجار فقط؛ عروض البيع تبقى ظاهرة عند اختيار البيع أو
            الكل ولا توصف بالشغور.
          </p>
          {filteredTargets.length ? (
            <div
              className="broker-table-wrap"
              data-excel-table="broker-targets"
            >
              <table className="broker-table broker-targets-table">
                <thead>
                  <tr>
                    <th>
                      <label className="broker-select-all">
                        <input
                          ref={targetAllRef}
                          data-testid="select-all-targets"
                          aria-label="تحديد كل العقارات المعروضة"
                          type="checkbox"
                          checked={
                            filteredTargets.length > 0 &&
                            filteredSelectedTargets.length ===
                              filteredTargets.length
                          }
                          disabled={!canEdit}
                          onChange={event =>
                            toggleAllTargets(event.currentTarget.checked)
                          }
                        />{" "}
                        تحديد الكل{" "}
                        <small>
                          {filteredSelectedTargets.length}/
                          {filteredTargets.length}
                        </small>
                      </label>
                    </th>
                    <th>الحالة</th>
                    <th>صورة معاينة</th>
                    <th>العقار</th>
                    <th>رقم العقار</th>
                    <th>الوحدة</th>
                    <th>النوع / الموقع</th>
                    <th>العقد / حالة التأجير</th>
                    <th>التوافر للإيجار</th>
                    <th>السعر المطلوب / الإيجار الشهري (ر.ق)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTargets.map(target => {
                    const selected = selectedTargetIds.includes(target.id);
                    const sale = isSaleTarget(target);
                    const expiring = displayAvailability(target) === "expiring";
                    const priceValue = priceForTarget(target);
                    const targetLabel = `${target.propertyTitle} · ${target.unitCode === "غير مسجل" ? target.unitTitle : target.unitCode}`;
                    return (
                      <tr
                        key={target.id}
                        className={`${selected ? "broker-row--selected" : ""} ${expiring ? "broker-row--expiring" : ""} ${sale ? "broker-row--sale" : ""}`}
                      >
                        <td>
                          <input
                            aria-label={`اختيار ${targetLabel}`}
                            type="checkbox"
                            checked={selected}
                            disabled={!canEdit}
                            onChange={event =>
                              toggleTarget(target, event.currentTarget.checked)
                            }
                          />
                        </td>
                        <td>
                          <AvailabilityBadge target={target} />
                        </td>
                        <td>
                          <div className="broker-table-photo">
                            <PropertyPreviewImage
                              property={state.entities.properties.find(
                                property => property.id === target.propertyId
                              )}
                              title={target.propertyTitle}
                            />
                          </div>
                        </td>
                        <td>
                          <strong>{target.propertyTitle}</strong>
                          <small>{target.unitTitle}</small>
                        </td>
                        <td className="broker-number">
                          {target.propertyNumber}
                        </td>
                        <td className="broker-number">{target.unitCode}</td>
                        <td>
                          <strong>{targetType(target)}</strong>
                          <small>{targetLocation(target)}</small>
                          {typeof target.area === "number" &&
                            target.area > 0 && <small>{target.area} م²</small>}
                        </td>
                        <td className="broker-number">
                          {sale
                            ? targetTenancy(target)
                            : expiring
                              ? text(target.contractEndDate) || "-"
                              : "-"}
                        </td>
                        <td className="broker-number">
                          {sale ? "-" : targetDate(target)}
                        </td>
                        <td>
                          <input
                            aria-label={`${sale ? "سعر البيع المطلوب" : "الإيجار الشهري"} ${targetLabel}`}
                            className="field broker-rent-input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={priceValue}
                            disabled={!canEdit || !selected}
                            onChange={event =>
                              setPrice(target, event.currentTarget.value)
                            }
                          />
                          <small className="broker-rent-source">
                            {sale
                              ? target.suggestedSalePriceMinor
                                ? "قيمة موجز البيع قابلة للتعديل محليًا فقط."
                                : "سعر البيع غير مسجل، أدخل مبلغًا موجبًا قبل التجهيز."
                              : `مصدر القيمة: ${targetRentSource(target)}${target.rentSourceDate ? ` · ${target.rentSourceDate}` : ""}`}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="لا توجد أهداف ضمن هذه المرشحات"
              description="جرّب نافذة زمنية أخرى أو ابحث في محفظة أخرى من المرشح العام."
            />
          )}
          <div className="broker-next-row">
            <p
              className="broker-selection-summary"
              data-testid="target-selection-count"
            >
              الأهداف المختارة: {selectedTargetCount} من {allTargets.length}.
              ستفصلها الدفعات في المحرك؛ ليست مقصوصة إلى 10.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={!canEdit || !selectedTargetCount}
              onClick={() => setActiveTab("brokers")}
            >
              التالي: اختيار شركات الوساطة{" "}
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </div>
        </Panel>
      )}

      {activeTab === "brokers" && (
        <Panel
          title="2. اختيار شركات الوساطة"
          description="تحديد الكل يختار الشركات المؤهلة فقط ضمن نتائج البحث والحالة الحالية."
          action={
            <FormDialog
              title="إضافة شركة وساطة"
              description="تُحفظ البيانات في بروتوتايب هذا المتصفح فقط. لا تضيف الشركة إلى قائمة بريد ولا ترسل رسالة."
              trigger={
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={!canEdit}
                >
                  إضافة شركة وساطة
                </button>
              }
              disabled={!canEdit}
              submitLabel="حفظ شركة الوساطة محليًا"
              fields={BROKER_FIELDS}
              onSubmit={addBroker}
            />
          }
        >
          <div
            className="broker-toolbar broker-toolbar--brokers"
            aria-label="بحث سجل الوسطاء"
          >
            <label>
              حالة السجل
              <select
                className="field"
                value={brokerFilter}
                onChange={event =>
                  setBrokerFilter(event.target.value as BrokerFilter)
                }
              >
                <option value="all">الكل</option>
                <option value="active">النشطة</option>
                <option value="stopped">الموقوفة</option>
              </select>
            </label>
            <label className="broker-toolbar__search">
              بحث في الشركة أو المسؤول أو البريد أو الهاتف
              <input
                className="field"
                value={brokerSearch}
                onChange={event => setBrokerSearch(event.target.value)}
                placeholder="ابحث في سجل الشركات"
              />
            </label>
          </div>
          {filteredBrokers.length ? (
            <div
              className="broker-table-wrap"
              data-excel-table="broker-contacts"
            >
              <table className="broker-table broker-brokers-table">
                <thead>
                  <tr>
                    <th>
                      <label className="broker-select-all">
                        <input
                          ref={brokerAllRef}
                          data-testid="select-all-brokers"
                          aria-label="تحديد كل الشركات المؤهلة المعروضة"
                          type="checkbox"
                          checked={
                            filteredEligibleBrokers.length > 0 &&
                            filteredSelectedBrokers.length ===
                              filteredEligibleBrokers.length
                          }
                          disabled={!canEdit || !filteredEligibleBrokers.length}
                          onChange={event =>
                            toggleAllBrokers(event.currentTarget.checked)
                          }
                        />{" "}
                        تحديد المؤهل{" "}
                        <small>
                          {filteredSelectedBrokers.length}/
                          {filteredEligibleBrokers.length}
                        </small>
                      </label>
                    </th>
                    <th>الشركة</th>
                    <th>المسؤول والبريد</th>
                    <th>الهاتف</th>
                    <th>الموقع / العنوان</th>
                    <th>ملاحظات</th>
                    <th>الحالة</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBrokers.map(broker => {
                    const active = brokerIsActive(broker);
                    const eligible = brokerIsEligible(broker);
                    return (
                      <tr
                        key={broker.id}
                        className={!active ? "broker-row--stopped" : ""}
                      >
                        <td>
                          <input
                            aria-label={`اختيار ${broker.title}`}
                            type="checkbox"
                            checked={selectedBrokerIds.includes(broker.id)}
                            disabled={!canEdit || !eligible}
                            onChange={event =>
                              toggleBroker(
                                broker.id,
                                event.currentTarget.checked
                              )
                            }
                          />
                        </td>
                        <td>
                          <strong>{broker.title}</strong>
                          {!eligible && active && (
                            <small>بيانات المستلم غير مكتملة</small>
                          )}
                        </td>
                        <td>
                          <strong>
                            {text(broker.meta.contactName) || "-"}
                          </strong>
                          <small>
                            <bdi dir="ltr">{text(broker.meta.email)}</bdi>
                          </small>
                        </td>
                        <td>
                          <bdi dir="ltr">{text(broker.meta.phone) || "-"}</bdi>
                        </td>
                        <td>
                          {text(broker.meta.website) ? (
                            <a
                              className="broker-site-link"
                              href={websiteLink(text(broker.meta.website))}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {text(broker.meta.website)}
                            </a>
                          ) : (
                            "-"
                          )}
                          {text(broker.meta.address) && (
                            <small>{text(broker.meta.address)}</small>
                          )}
                        </td>
                        <td className="broker-notes-cell">
                          {text(broker.meta.notes) || "-"}
                        </td>
                        <td>
                          <Badge tone={active ? "green" : "gray"}>
                            {active ? "نشط" : "موقوف"}
                          </Badge>
                        </td>
                        <td>
                          <FormDialog
                            key={`${broker.id}-${String(broker.meta.active)}`}
                            title={`تعديل ${broker.title}`}
                            description="الإيقاف يلغي الاختيار كمستلم فقط ويبقى السجل محفوظًا."
                            trigger={
                              <button
                                className="btn-ghost broker-edit-button"
                                type="button"
                                disabled={!canEdit}
                              >
                                <Pencil size={14} aria-hidden="true" /> تعديل
                              </button>
                            }
                            disabled={!canEdit}
                            submitLabel="حفظ التعديل محليًا"
                            fields={BROKER_FIELDS}
                            initialValues={{
                              companyName: broker.title,
                              email: text(broker.meta.email),
                              contactName: text(broker.meta.contactName),
                              phone: text(broker.meta.phone),
                              website: text(broker.meta.website),
                              address: text(broker.meta.address),
                              notes: text(broker.meta.notes),
                              active: active ? "true" : "false",
                            }}
                            onSubmit={values => editBroker(broker, values)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="لا توجد شركات وساطة بهذه المرشحات"
              description="غيّر البحث أو حالة السجل."
            />
          )}
          <div className="broker-next-row">
            <p
              className="broker-selection-summary"
              data-testid="broker-selection-count"
            >
              المستلمون المختارون: {selectedBrokerCount} من{" "}
              {
                brokers.filter(broker =>
                  brokerIsEligible(broker, state.settings.portfolioId)
                ).length
              }{" "}
              مؤهلة. ستفصلها الدفعات في المحرك؛ ليست مقصوصة إلى 20.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !canEdit || !selectedTargetCount || !selectedBrokerCount
              }
              onClick={() => setActiveTab("briefs")}
            >
              التالي: مراجعة الموجز <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </div>
        </Panel>
      )}

      {activeTab === "briefs" && (
        <div className="broker-workspace">
          <Panel
            title="3. مراجعة الموجز"
            description="تجهيز الموجز يحفظ جميع الدفعات الحالية في انتقال واحد، ثم يعرض كل لقطة ومستلميها قبل تأكيد المحاكاة التجريبية."
          >
            <div className="broker-message-grid">
              <label>
                عنوان الحملة / موضوع الموجز
                <input
                  aria-label="عنوان الحملة"
                  className="field"
                  maxLength={80}
                  value={title}
                  disabled={!canEdit}
                  onChange={event => {
                    markCampaignDirty();
                    setTitle(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="broker-message-content">
                مقدمة الموجز (اختيارية ضمن نص الحملة)
                <textarea
                  aria-label="نص المعاينة"
                  className="field"
                  maxLength={600}
                  value={content}
                  disabled={!canEdit}
                  onChange={event => {
                    markCampaignDirty();
                    setContent(event.currentTarget.value);
                  }}
                  placeholder="نرجو مراجعة الفرص أدناه والتواصل معنا بشأن الوحدات المناسبة…"
                />
              </label>
            </div>
            <div className="broker-preparation-summary">
              <span>
                <Building2 size={16} aria-hidden="true" /> {selectedTargetCount}{" "}
                أهداف مختارة
              </span>
              <span>
                <UsersRound size={16} aria-hidden="true" />{" "}
                {selectedBrokerCount} شركات مختارة
              </span>
              <span>
                <ShieldCheck size={16} aria-hidden="true" /> الصور تبقى محلية
                ولا تدخل الموجز
              </span>
            </div>
            {selectedTargets.length > 0 && (
              <div
                className="broker-preview-grid"
                aria-label="بطاقات المعاينة المحلية للأهداف المختارة"
              >
                {selectedTargets.map(target => {
                  const property = state.entities.properties.find(
                    row => row.id === target.propertyId
                  );
                  const sale = isSaleTarget(target);
                  let price = sale
                    ? "أدخل سعر بيع موجبًا"
                    : "أدخل إيجارًا موجبًا";
                  try {
                    price = money(toMinor(priceForTarget(target)));
                  } catch {
                    /* shown as field guidance */
                  }
                  return (
                    <article className="broker-preview-card" key={target.id}>
                      <PropertyPreviewImage
                        property={property}
                        title={`${target.propertyTitle} · ${target.unitCode}`}
                      />
                      <div>
                        <span className="broker-card-kicker">
                          {target.propertyNumber} · {target.unitCode}
                        </span>
                        <h3>{target.propertyTitle}</h3>
                        <p>
                          {targetType(target)} · {targetLocation(target)}
                        </p>
                        <p>
                          {sale
                            ? `للبيع · ${targetTenancy(target)}`
                            : displayAvailability(target) === "vacant"
                              ? "شاغر الآن"
                              : `متاح متوقع من ${targetDate(target)}`}
                        </p>
                        <strong
                          className={
                            sale ? "broker-card-price" : "broker-card-rent"
                          }
                        >
                          {sale
                            ? `${price} سعر البيع المطلوب`
                            : `${price} شهريًا`}
                        </strong>
                        {!sale && (
                          <small className="broker-rent-source">
                            {targetRentSource(target)}
                          </small>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="broker-save-row">
              <div>
                <Badge tone="amber">خطوة تجهيز محلية</Badge>
                <p>
                  الحفظ لا يرسل رسالة. راجع اللقطات الناتجة والمستلمين ثم أكد
                  محاكاة غير مرسلة.
                </p>
              </div>
              <div className="broker-save-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    !canEdit || !selectedTargetCount || !selectedBrokerCount
                  }
                  onClick={prepareBatches}
                >
                  <Sparkles size={16} aria-hidden="true" /> تجهيز لقطات الموجز
                  للمراجعة
                </button>
              </div>
            </div>
          </Panel>

          {preparedBatches.length > 0 && (
            <Panel
              title="لقطات المحاولة الحالية قبل التأكيد"
              description="هذه اللقطات تخص الاختيارات الحالية فقط. فتح حملة تاريخية أدناه لا يبدلها ولا يمكنه تأكيد محاكاة جديدة."
            >
              <div
                className="broker-current-attempt"
                data-testid="prepared-batches"
              >
                {preparedBatches.map((batch, index) => (
                  <article
                    className="broker-batch-card"
                    key={batch.campaign.id}
                  >
                    <div className="broker-batch-card__heading">
                      <div>
                        <span className="broker-card-kicker">
                          الدفعة {index + 1} · لقطة محلية مجمدة
                        </span>
                        <h3>{batch.campaign.title}</h3>
                      </div>
                      <Badge tone="amber">غير مرسلة</Badge>
                    </div>
                    <dl className="broker-brief-details">
                      <div>
                        <dt>العقارات</dt>
                        <dd>{batch.brief.targets.length}</dd>
                      </div>
                      <div>
                        <dt>المستلمون</dt>
                        <dd>{batch.brief.recipients.length}</dd>
                      </div>
                      <div>
                        <dt>التاريخ</dt>
                        <dd>{batch.brief.asOf}</dd>
                      </div>
                    </dl>
                    <FrozenTargetSummary
                      targets={batch.brief.targets}
                      label={`الأهداف المجمدة في ${batch.campaign.title}`}
                    />
                    <pre className="broker-brief-body">{batch.brief.body}</pre>
                    <section
                      className="broker-recipient-drafts"
                      aria-label={`مستلمو ${batch.campaign.title}`}
                    >
                      <h4>المستلمون في هذه الدفعة</h4>
                      <p>
                        لكل شركة ملف EML منفصل، أو مسودة تفتح في تطبيق بريدك. لا
                        يوجد إرسال آلي.
                      </p>
                      <ul>
                        {batch.brief.recipients.map(recipient => {
                          const mailto = mailtoFor(batch.brief, recipient);
                          return (
                            <li key={recipient.brokerId}>
                              <span>
                                <strong>{recipient.companyName}</strong>
                                <small>
                                  <bdi dir="ltr">{recipient.email}</bdi>
                                </small>
                              </span>
                              <div className="broker-recipient-actions">
                                {mailto && (
                                  <a className="btn-ghost" href={mailto}>
                                    <Mail size={14} aria-hidden="true" /> فتح
                                    الرسالة في بريدي
                                  </a>
                                )}
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() =>
                                    downloadBrokerEmailDraft(
                                      batch.brief,
                                      recipient
                                    )
                                  }
                                >
                                  <Download size={14} aria-hidden="true" />{" "}
                                  مسودة EML
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="broker-mailto-note">
                        يفتح الرابط مسودة؛ راجعها وأرسلها بنفسك من تطبيق البريد،
                        لا إرسال آلي. الإرسال المباشر يتطلب مزود بريد موثقًا
                        وموافقة مستقلة.
                      </p>
                    </section>
                  </article>
                ))}
              </div>
              <div className="broker-confirm-row">
                <div>
                  <strong>جاهز للتأكيد التجريبي</strong>
                  <p>
                    سيُشغّل المحرك محاكاة محلية لجميع الدفعات أو لا شيء، ثم يعرض
                    حالة كل دفعة وكل مستلم بوصف «لم يُرسل بريد».
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canEdit}
                  onClick={() => setConfirmSimulationOpen(true)}
                >
                  <Send size={16} aria-hidden="true" /> إرسال الموجز للشركات
                  المختارة · تجريبي
                </button>
              </div>
            </Panel>
          )}

          {simulationResults.length > 0 && (
            <Panel
              title="نتيجة المحاكاة المحلية"
              description="نتائج صريحة لكل دفعة ومستلم؛ لم يُرسل بريد ولم يُستدع مزود أو شبكة."
            >
              <div
                className="broker-simulation-results"
                data-testid="simulation-results"
              >
                {preparedBatches.map((batch, index) => {
                  const result = simulationResults.find(
                    row => text(row.meta.campaignId) === batch.campaign.id
                  );
                  return (
                    <article key={batch.campaign.id}>
                      <header>
                        <strong>الدفعة {index + 1}</strong>
                        <Badge tone="green">
                          {result?.status ?? "simulated-not-sent"}
                        </Badge>
                      </header>
                      <p>
                        {result
                          ? "اكتملت المحاكاة محليًا لهذه الدفعة."
                          : "لم تتغير حالة بيانات الأعمال؛ النتيجة محفوظة محليًا فقط."}
                      </p>
                      <ul>
                        {batch.brief.recipients.map(recipient => (
                          <li key={recipient.brokerId}>
                            <CheckCircle2 size={15} aria-hidden="true" />{" "}
                            {recipient.companyName} -{" "}
                            <bdi dir="ltr">{recipient.email}</bdi>{" "}
                            <span>لم يُرسل بريد</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </Panel>
          )}

          <Panel
            title="الحملات التاريخية"
            description="فتح لقطة قديمة للقراءة والتنزيل فقط. لا تغيّر اختيارات المحاولة الحالية ولا تظهر زر تأكيد لها."
          >
            {campaigns.length ? (
              <div className="broker-saved-layout">
                <div
                  className="broker-table-wrap"
                  data-excel-table="broker-campaign-previews"
                >
                  <table className="broker-table">
                    <thead>
                      <tr>
                        <th>العنوان</th>
                        <th>تاريخ اللقطة</th>
                        <th>الأهداف</th>
                        <th>المستلمون</th>
                        <th>الحالة</th>
                        <th>عرض</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map(campaign => {
                        const brief = briefForCampaign(state, campaign);
                        return (
                          <tr
                            key={campaign.id}
                            className={
                              campaign.id === selectedHistoricalCampaignId
                                ? "broker-row--selected"
                                : ""
                            }
                          >
                            <td>{campaign.title}</td>
                            <td className="broker-number">
                              {brief?.asOf ?? campaign.date}
                            </td>
                            <td>
                              {brief?.targets.length ??
                                text(campaign.meta.targetCount)}
                            </td>
                            <td>
                              {brief?.recipients.length ??
                                text(campaign.meta.brokerCount)}
                            </td>
                            <td>
                              <Badge tone="amber">غير مرسلة</Badge>
                            </td>
                            <td>
                              <button
                                className="btn-ghost"
                                type="button"
                                onClick={() =>
                                  setSelectedHistoricalCampaignId(campaign.id)
                                }
                              >
                                فتح اللقطة
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedHistoricalCampaign && (
                  <article
                    className="broker-saved-preview"
                    aria-label={`لقطة ${selectedHistoricalCampaign.title}`}
                  >
                    <div className="broker-saved-preview__top">
                      <div>
                        <span className="broker-card-kicker">
                          لقطة تاريخية للقراءة
                        </span>
                        <h3>{selectedHistoricalCampaign.title}</h3>
                      </div>
                      <Badge tone="amber">غير مرسلة</Badge>
                    </div>
                    {historicalBrief ? (
                      <>
                        <dl className="broker-brief-details">
                          <div>
                            <dt>الموضوع</dt>
                            <dd>{historicalBrief.subject}</dd>
                          </div>
                          <div>
                            <dt>الأهداف</dt>
                            <dd>{historicalBrief.targets.length}</dd>
                          </div>
                          <div>
                            <dt>المستلمون</dt>
                            <dd>{historicalBrief.recipients.length}</dd>
                          </div>
                        </dl>
                        <FrozenTargetSummary
                          targets={historicalBrief.targets}
                          label="الأهداف المجمدة في اللقطة التاريخية"
                        />
                        <pre className="broker-brief-body">
                          {historicalBrief.body}
                        </pre>
                        <div className="broker-brief-actions">
                          <button
                            className="btn-secondary"
                            type="button"
                            onClick={() => copyBrief(historicalBrief)}
                          >
                            <Copy size={15} aria-hidden="true" /> نسخ الموجز
                          </button>
                          <button
                            className="btn-secondary"
                            type="button"
                            onClick={() => downloadBrokerBrief(historicalBrief)}
                          >
                            <Download size={15} aria-hidden="true" /> تنزيل TXT
                            محليًا
                          </button>
                        </div>
                        <section
                          className="broker-recipient-drafts"
                          aria-label="مسودات الرسائل للمستلمين"
                        >
                          <h4>مسودات رسائل المستلمين</h4>
                          <p>
                            التنزيل أو فتح المسودة لا يرسل بريدًا ولا يؤكد هذه
                            الحملة.
                          </p>
                          <ul>
                            {historicalBrief.recipients.map(recipient => {
                              const mailto = mailtoFor(
                                historicalBrief,
                                recipient
                              );
                              return (
                                <li key={recipient.brokerId}>
                                  <span>
                                    <strong>{recipient.companyName}</strong>
                                    <small>
                                      <bdi dir="ltr">{recipient.email}</bdi>
                                    </small>
                                  </span>
                                  <div className="broker-recipient-actions">
                                    {mailto && (
                                      <a className="btn-ghost" href={mailto}>
                                        <Mail size={14} aria-hidden="true" />{" "}
                                        فتح الرسالة في بريدي
                                      </a>
                                    )}
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() =>
                                        downloadBrokerEmailDraft(
                                          historicalBrief,
                                          recipient
                                        )
                                      }
                                    >
                                      <Download size={14} aria-hidden="true" />{" "}
                                      مسودة EML
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          <p className="broker-mailto-note">
                            يفتح الرابط مسودة؛ راجعها وأرسلها بنفسك من تطبيق
                            البريد، لا إرسال آلي. يلزم مزود بريد موثق للإرسال
                            المباشر.
                          </p>
                        </section>
                      </>
                    ) : (
                      <p className="broker-legacy-note">
                        هذه لقطة قديمة لا تحمل موجزًا صالحًا للعرض. تبقى محفوظة
                        كما هي.
                      </p>
                    )}
                  </article>
                )}
              </div>
            ) : (
              <EmptyState
                title="لا توجد حملة محفوظة بعد"
                description="اختر أهدافًا وشركات وساطة ثم جهّز الموجز لإنشاء لقطات محلية."
              />
            )}
          </Panel>
        </div>
      )}

      {confirmSimulationOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget)
              setConfirmSimulationOpen(false);
          }}
        >
          <section
            className="modal broker-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="تأكيد محاكاة إرسال الموجز"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">محاكاة محلية</span>
                <h2>إرسال الموجز للشركات المختارة · تجريبي</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setConfirmSimulationOpen(false)}
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted small">
              سيتم تسجيل محاكاة غير مرسلة لجميع الدفعات الظاهرة. لا توجد رسالة
              إلكترونية أو SMTP أو طلب شبكة.
            </p>
            <div className="broker-confirm-modal__summary">
              <strong>{preparedBatches.length} دفعات</strong>
              <span>
                {
                  new Set(
                    preparedBatches.flatMap(batch =>
                      batch.brief.recipients.map(
                        recipient => recipient.brokerId
                      )
                    )
                  ).size
                }{" "}
                شركات مختارة
              </span>
              <span>
                {
                  new Set(
                    preparedBatches.flatMap(batch =>
                      batch.brief.targets.map(target => target.targetId)
                    )
                  ).size
                }{" "}
                أهداف مختارة
              </span>
              <span>
                {preparedBatches.reduce(
                  (total, batch) => total + batch.brief.recipients.length,
                  0
                )}{" "}
                رسائل بالدفعات · لم تُرسل
              </span>
            </div>
            <ul className="broker-confirm-recipients">
              {preparedBatches.flatMap((batch, index) =>
                batch.brief.recipients.map(recipient => (
                  <li key={`${batch.campaign.id}-${recipient.brokerId}`}>
                    الدفعة {index + 1}: {recipient.companyName} -{" "}
                    <bdi dir="ltr">{recipient.email}</bdi>
                  </li>
                ))
              )}
            </ul>
            <div className="broker-confirm-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmSimulationOpen(false)}
              >
                رجوع للمراجعة
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canEdit}
                onClick={simulatePreparedBatches}
              >
                <Send size={16} aria-hidden="true" /> تأكيد المحاكاة · لم يُرسل
                بريد
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
