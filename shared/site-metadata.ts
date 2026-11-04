import { phaseFeature } from "./phase1-features";
import { PUBLIC_ORIGIN } from "./public-services";
export const SITE_SHARE_IMAGE =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663884651967/baItzAIMlHWeIiwN.png";
export function siteMetadata(path: string) {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const home = clean === "/";
  const account =
    clean === "/register"
      ? "إنشاء حساب"
      : clean === "/login"
        ? "تسجيل الدخول"
        : clean === "/demo"
          ? "تجربة محلية بدون حساب"
          : phaseFeature(clean)?.title;
  return {
    title: home
      ? "صُنّاع الفرص | إدارة العقارات والتأجير والتحصيل"
      : `${account || "الصفحة غير موجودة"} | صُنّاع الفرص`,
    description: home
      ? "تعرف على خدمات صُنّاع الفرص لإدارة العقارات والوحدات والعقود والفواتير والتحصيل والصيانة، وسجّل للدخول إلى التجربة مع بيان المتاح والخدمات القادمة."
      : "مدخل نظام صُنّاع الفرص التجريبي. بيانات الحساب ومساحات الإدارة غير عامة؛ استخدم ملفات وبيانات وهمية في هذه النسخة.",
    robots: home ? "index,follow" : "noindex,nofollow",
    canonical: home ? `${PUBLIC_ORIGIN}/` : undefined,
    url: home ? `${PUBLIC_ORIGIN}/` : undefined,
    image: SITE_SHARE_IMAGE,
  };
}
