export type PhaseFeatureState = "active" | "coming-soon";
export interface PhaseFeature {
  path: string;
  title: string;
  state: PhaseFeatureState;
  reason: string;
}
const active = (path: string, title: string): PhaseFeature => ({
  path,
  title,
  state: "active",
  reason:
    "متاح في نموذج المرحلة الأولى ببيانات مصطنعة؛ ليس اعتمادًا تشغيليًا أو ماليًا.",
});
const soon = (path: string, title: string, reason: string): PhaseFeature => ({
  path,
  title,
  state: "coming-soon",
  reason,
});
export const PHASE_FEATURES: readonly PhaseFeature[] = [
  active("/dashboard", "لوحة التحكم"),
  active("/portfolios", "المحافظ"),
  active("/properties", "العقارات والوحدات"),
  active("/leases", "المستأجرون والعقود"),
  active("/unleased", "وحدات غير مؤجرة"),
  active("/sale-units", "وحدات للبيع"),
  active("/contract-templates", "نماذج العقود"),
  active("/billing", "الفواتير والمستحقات"),
  active("/collections", "التحصيل والشيكات"),
  active("/finance", "المالية والسيولة"),
  active("/expenses", "المصروفات"),
  active("/reports", "كشوف المالك والتقارير"),
  active("/vacancy", "الشغور"),
  active("/maintenance", "الصيانة الأساسية"),
  active("/roadmap", "فهرس المراحل"),
  soon(
    "/ownership",
    "الملكية والتوزيعات",
    "تحتاج نسبًا نافذة بحسب التاريخ وتسوية معتمدة؛ لا توزيع أو تحويل في هذه الجولة."
  ),
  soon(
    "/reconciliation",
    "المطابقة البنكية",
    "تحتاج تخصيص الطرفين ومنع إعادة استخدام الإيصال؛ لا تكامل بنك حي."
  ),
  soon(
    "/payments",
    "روابط الدفع",
    "تحتاج مزود دفع وموافقات واختبارات مستقلة، ولا تُفعّل في المرحلة الأولى."
  ),
  soon(
    "/documents",
    "خزنة الملفات",
    "تحتاج حفظ ملفات خاصًا وإصدارات واستعادة فعلية. قوالب العقود متاحة في نماذج العقود."
  ),
  soon(
    "/vendors",
    "إدارة الموردين المتقدمة",
    "المرحلة الأولى تربط موردًا بعملية الصيانة؛ التقييمات والترشيح المتقدم مؤجلان."
  ),
  soon(
    "/inspections",
    "الاستلام والتسليم",
    "مؤجل إلى قبول رحلة المعاينة والضمان والأضرار بصورة مستقلة."
  ),
  soon(
    "/disputes",
    "النزاعات والقضايا",
    "لا معاملات أو إجراءات قانونية فعلية ضمن هذه الجولة."
  ),
  soon(
    "/tasks",
    "المهام والموجز",
    "يؤجل تشغيل الموجز والتصعيد؛ متابعة الصيانة تبقى في شاشة الصيانة الأساسية."
  ),
  soon(
    "/notifications",
    "التنبيهات والقنوات",
    "لا رسائل أو بريد أو قنوات خارجية مفعلة."
  ),
  soon(
    "/portals",
    "بوابات الأطراف",
    "تحتاج هويات أطراف وعضوية وصلاحيات خادم مستقلة؛ معاينة الدور ليست تفويضًا."
  ),
  soon(
    "/assistant",
    "مساعد واتساب",
    "المساعد والقنوات الخارجية مؤجلان، بلا إرسال أو محادثة خلفية."
  ),
  active("/marketing", "التسويق العقاري وشركات الوساطة"),
  soon(
    "/signatures",
    "التوقيع الإلكتروني",
    "التوقيع القانوني وإثباته يحتاجان مزودًا وقبولًا مستقلًا؛ المسودة ليست توقيعًا."
  ),
  soon(
    "/insights",
    "التحليل والاقتراحات",
    "تحليل تطوير العقارات والسيولة يؤجل إلى ما بعد قبول إدارة العقارات."
  ),
  soon(
    "/market",
    "السوق والمقارنات",
    "مصادر السوق في الكود أمثلة وليست تغذية حية؛ لا توسعة الآن."
  ),
  soon(
    "/growth",
    "المستشار العقاري",
    "حساباته السابقة محفوظة ومختبرة، لكن تشغيل رحلة المستشار مؤجل إلى مرحلة لاحقة."
  ),
  soon(
    "/opportunities",
    "قناص الفرص",
    "مصادره أمثلة؛ لا بحث حي أو شراء أو تمويل آلي. تشغيله مؤجل."
  ),
  soon(
    "/funding",
    "التمويل",
    "يحتاج ملف تمويل صحيحًا وقرار موافقة مستقلًا؛ طلب الموافقة ليس صدورها."
  ),
  soon(
    "/data",
    "المصادر وجودة البيانات",
    "طبقة مصادر السوق وحقوقها وتكاملاتها مؤجلة، بلا ربط خارجي."
  ),
  soon(
    "/settings",
    "صلاحيات المؤسسة والاشتراكات",
    "صلاحيات العضوية والاشتراكات وتدقيق الإنتاج والنسخ الاحتياطي مؤجلة. الحفظ المحلي متاح عبر أدوات الحفظ."
  ),
];
export function phaseFeature(path: string): PhaseFeature | undefined {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return (
    PHASE_FEATURES.find(row => row.path === clean) ||
    (clean.startsWith("/properties/")
      ? PHASE_FEATURES.find(row => row.path === "/properties")
      : undefined)
  );
}
export const phaseFeatureActive = (path: string) =>
  phaseFeature(path)?.state === "active";
export function phaseFeatureCounts() {
  return {
    total: PHASE_FEATURES.length,
    active: PHASE_FEATURES.filter(f => f.state === "active").length,
    deferred: PHASE_FEATURES.filter(f => f.state === "coming-soon").length,
  };
}
