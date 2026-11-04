import { useMemo, useState } from "react";
import { ArrowLeft, Boxes, CircleCheckBig, Clock3 } from "lucide-react";
import {
  Badge,
  DemoNotice,
  Metric,
  PageHeader,
  Panel,
  TabBar,
} from "@/components/app/Primitives";
import { FEATURE_DEFINITIONS } from "./decision/DecisionShared";
import { phaseFeature } from "@shared/phase1-features";
export { OwnershipPage, SettingsPage } from "./decision/OwnershipSettingsPages";
export { MarketPage, GrowthPage } from "./decision/MarketGrowthPages";
export {
  OpportunitiesPage,
  DataPage,
  FundingPage,
} from "./decision/OpportunitiesDataFundingPages";
export function RoadmapPage() {
  const [filter, setFilter] = useState("all");
  const services = useMemo(
    () =>
      FEATURE_DEFINITIONS.map(feature => ({
        ...feature,
        phase: phaseFeature(feature.path),
      })),
    []
  );
  const active = services.filter(f => f.phase?.state === "active");
  const deferred = services.filter(f => f.phase?.state !== "active");
  const visible = services.filter(
    f =>
      filter === "all" ||
      (filter === "active"
        ? f.phase?.state === "active"
        : f.phase?.state !== "active")
  );
  return (
    <div className="section-stack">
      <PageHeader
        eyebrow="مراحل النظام"
        title="المرحلة الأولى: إدارة العقارات"
        description="نغلق إدارة الأملاك والعقود والتحصيل والصيانة والتقارير أولًا. بقية الأفكار محفوظة ومعروضة، لكن وظائفها غير مفعلة الآن."
      />
      <DemoNotice mode="simulation">
        توفر واجهة أساسية لا يعني اكتمال كل تفاصيل الفكرة أو اعتمادًا ماليًا أو
        أمنيًا. الكود والاختبارات السابقة للمستشار والقناص محفوظة، وتشغيلهما
        مؤجل.
      </DemoNotice>
      <div className="stats-grid">
        <Metric
          label="خدمات في الفهرس"
          value={String(services.length)}
          detail="العدد مشتق من تعريفات الخدمات وليس ثابتًا"
          icon={<Boxes size={18} />}
        />
        <Metric
          label="واجهات المرحلة الأولى"
          value={String(active.length)}
          detail="متاحة كنموذج محلي ببيانات مصطنعة"
          icon={<CircleCheckBig size={18} />}
        />
        <Metric
          label="قريبًا"
          value={String(deferred.length)}
          detail="لا إجراء أو طلب خلفي من الصفحة المؤجلة"
          icon={<Clock3 size={18} />}
        />
      </div>
      <Panel
        title="كل الأفكار ومراحل إتاحتها"
        description="الملكية والتوزيعات والمطابقة المتقدمة والتمويل والخزنة الحقيقية والصلاحيات الخادمية تتطلب جولات مستقلة."
      >
        <TabBar
          items={[
            { key: "all", label: `كل الخدمات ${services.length}` },
            { key: "active", label: "المرحلة الأولى" },
            { key: "deferred", label: "قريبًا" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="roadmap-grid">
          {visible.map(feature => (
            <article className="roadmap-card" key={feature.id}>
              <div className="roadmap-card-head">
                <strong>{feature.id}</strong>
                <Badge
                  tone={feature.phase?.state === "active" ? "green" : "amber"}
                >
                  {feature.phase?.state === "active"
                    ? "واجهة المرحلة الأولى"
                    : "قريبًا"}
                </Badge>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <p className="muted small">
                {feature.phase?.reason || "وظيفة مؤجلة إلى قبول مرحلتها."}
              </p>
              {feature.id === "F08" && (
                <p className="muted small">
                  الإدخال اليدوي للمصروفات متاح؛ استخراج المستندات بالذكاء
                  الاصطناعي مؤجل.
                </p>
              )}
              <div className="roadmap-card-footer">
                <code>{feature.path}</code>
                {feature.phase?.state === "active" ? (
                  <a className="btn-secondary" href={feature.path}>
                    افتح الواجهة <ArrowLeft size={15} />
                  </a>
                ) : (
                  <button
                    className="btn-secondary"
                    disabled
                    aria-label={`${feature.title} قريبًا`}
                  >
                    قريبًا · غير مفعلة
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <p className="muted">
        عدد البطاقات المعروضة: {visible.length}. الأدوار معاينة والسحابة لقطة
        بروتوتايب، وليست نظام مؤسسة أو دفترًا إنتاجيًا.
      </p>
    </div>
  );
}
