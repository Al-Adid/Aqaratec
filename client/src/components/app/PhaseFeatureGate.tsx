import type { ReactNode } from "react";
import { Link } from "wouter";
import { phaseFeature } from "@shared/phase1-features";
export function PhaseFeatureGate({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const feature = phaseFeature(path);
  if (!feature || feature.state === "active") return <>{children}</>;
  return (
    <section className="section-stack coming-soon-page" aria-label="خدمة مؤجلة">
      <header className="page-header">
        <div>
          <span className="eyebrow">المرحلة التالية</span>
          <h1>{feature.title} · قريبًا</h1>
          <p>{feature.reason}</p>
        </div>
      </header>
      <div className="panel">
        <h2>هذه الخدمة غير مفعلة الآن</h2>
        <p>
          نركز على إغلاق رحلة إدارة العقارات. الكود والبيانات السابقة محفوظان،
          لكن لن تفتح هذه الصفحة نموذج إضافة أو إجراءً أو طلبًا خلفيًا للخدمة
          المؤجلة.
        </p>
        <p className="muted">
          البيانات مصطنعة، والأدوار معاينة؛ لا شراء أو دفع أو تمويل أو توقيع
          تلقائي.
        </p>
        <Link href="/" className="btn-primary">
          ارجع لإدارة العقارات
        </Link>
        <Link href="/roadmap" className="btn-secondary">
          اعرض المراحل والخدمات
        </Link>
      </div>
    </section>
  );
}
