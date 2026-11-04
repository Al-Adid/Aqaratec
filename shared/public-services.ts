import { BRAND_ASSETS } from "./prototype";
import { FEATURE_DEFINITIONS } from "./service-definitions";
import { phaseFeature } from "./phase1-features";

export const PUBLIC_ORIGIN = "https://sunnaafurs-4cqeamvh.manus.space";
export const LANDING_HERO = BRAND_ASSETS.apartments;
export type PublicServiceState = "available" | "partial" | "coming-soon";
export interface PublicService {
  id: string;
  title: string;
  description: string;
  path: string;
  category: string;
  state: PublicServiceState;
  label: string;
  detail: string;
}
export const SERVICE_CATEGORIES = [
  "الكل",
  "الأملاك والتأجير",
  "الماليات والتقارير",
  "التشغيل والخدمات",
  "النمو والفرص",
  "المنصة والتكاملات",
] as const;
const groups: Record<string, string> = {};
for (const n of [2, 3, 4, 5, 14, 24, 25, 26])
  groups[`F${String(n).padStart(2, "0")}`] = "الأملاك والتأجير";
for (const n of [6, 7, 8, 9, 10, 11, 12])
  groups[`F${String(n).padStart(2, "0")}`] = "الماليات والتقارير";
for (const n of [13, 15, 16, 17, 18, 19, 20])
  groups[`F${String(n).padStart(2, "0")}`] = "التشغيل والخدمات";
for (const n of [27, 28, 29, 30, 33])
  groups[`F${String(n).padStart(2, "0")}`] = "النمو والفرص";
const overrides: Record<string, Partial<PublicService>> = {
  F05: {
    state: "partial",
    label: "متابعة تجريبية",
    description:
      "تسجيل حالة عقد الإيجار وإثباته داخل السجل؛ ليس تسجيلًا لدى جهة حكومية.",
    detail: "المتابعة يدوية؛ لا تحقق حكومي ولا غرامة تلقائية.",
  },
  F08: {
    state: "partial",
    label: "متاح جزئيًا",
    description:
      "إدخال المصروفات ومراجعتها وربطها بالعقار؛ استخراج بيانات الإيصال آليًا مؤجل.",
    detail: "لا OCR أو تحقق أصالة مستندات في هذه النسخة.",
  },
  F11: {
    state: "partial",
    label: "متاح جزئيًا",
    description:
      "صورة نقدية وذمم ومصروفات من السجلات؛ الميزانيات والتحليلات المتقدمة مرحلتها لاحقة.",
    detail: "لا ربط بنك مباشر أو اعتماد محاسبي إنتاجي.",
  },
  F12: {
    state: "partial",
    label: "كشوف تجريبية",
    description:
      "كشف المالك والرصيد والحركة للفترة؛ علامة متابعة الإقفال ليست قفلًا ماليًا.",
    detail: "الكشوف للتجربة وليست نظام محاسبة معتمدًا.",
  },
  F16: {
    state: "coming-soon",
    label: "قريبًا",
    description:
      "خطط صيانة وقائية وأصول وضمانات ودورية عمل، ضمن التوسع اللاحق.",
    detail: "دورة الصيانة الأساسية متاحة؛ الوقاية المتقدمة مؤجلة.",
  },
  F24: {
    state: "partial",
    label: "قوائم وموجز تسويقي",
    title: "التسويق العقاري وشركات الوساطة",
    description:
      "العقارات الشاغرة والعقود القريبة من الانتهاء، سجل شركات الوساطة، وتجهيز موجز تأجير بالمعلومات والأسعار والتوافر المتوقع.",
    detail:
      "الموجز ومحاكاة الإرسال متاحان للتجربة؛ إرسال البريد الحقيقي يحتاج حسابًا ومزودًا موثقًا.",
  },
  F25: {
    title: "وحدات غير مؤجرة وطلبات التأجير",
    path: "/unleased",
    state: "partial",
    label: "رحلة تجريبية",
    description:
      "طلب التأجير والوثائق ومراجعة الموظف والعقد والموعد والتسليم في خطوات مترابطة.",
    detail: "البريد والائتمان والتقويم غير موصولة؛ استخدم ملفات وبيانات وهمية.",
  },
  F28: {
    title: "المستشار العقاري",
    description:
      "تشخيص الأصول والسيولة والالتزامات والأهداف لبناء خطة ومراجعتها شهريًا.",
    detail:
      "مرحلة لاحقة. خطة السنة ناتج تخطيط، لا سنة اشتراك مجاني؛ الأسعار لم تعتمد.",
  },
  F29: {
    title: "قناص الفرص",
    description:
      "البحث عن فرص ملائمة للخطة والقدرة، مع أسباب الترشيح ومصادر البيانات.",
    detail: "مرحلة لاحقة؛ لا بحث سوق حي أو شراء أو تمويل تلقائي.",
  },
};
export function getPublicServices(): PublicService[] {
  const base = FEATURE_DEFINITIONS.map(f => {
    const phase = phaseFeature(f.path);
    const available = phase?.state === "active";
    return {
      ...f,
      category: groups[f.id] || "المنصة والتكاملات",
      state: available ? ("available" as const) : ("coming-soon" as const),
      label: available ? "متاح للتجربة" : "قريبًا",
      detail: phase?.reason || "خدمة ضمن مراحل التطوير؛ ليست مفعلة الآن.",
      ...overrides[f.id],
    };
  });
  return [
    ...base,
    {
      id: "X01",
      title: "الفواتير والمستحقات",
      description:
        "إصدار فاتورة أو مطالبة وسند قبض، مع سداد جزئي وربط الذمة نفسها دون تكرار.",
      path: "/billing",
      category: "الماليات والتقارير",
      state: "available",
      label: "متاح للتجربة",
      detail: "الطباعة تجريبية؛ لا فاتورة ضريبية معتمدة أو تحويل أموال.",
    },
    {
      id: "X02",
      title: "نماذج العقود",
      description:
        "أضف نموذجك واملأ بيانات المستأجر والعقار والكهرباء، ثم عاين العقد واطبعه.",
      path: "/contract-templates",
      category: "الأملاك والتأجير",
      state: "available",
      label: "متاح للتجربة",
      detail: "نص أو TXT أو Word مستخرج كنص؛ ليس توقيعًا أو مراجعة قانونية.",
    },
  ];
}
