import { useI18n } from "./LanguageContext";

/** Segmented Arabic / English control. Works on every page, signed in or not. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className={`lang-switch ${className}`}
      role="group"
      aria-label={t("اللغة", "Language")}
      // the control itself never flips, so it reads the same in both languages
      dir="ltr"
      data-i18n-skip
    >
      <button
        type="button"
        lang="ar"
        aria-pressed={lang === "ar"}
        onClick={() => setLang("ar")}
      >
        عربي
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={lang === "en"}
        onClick={() => setLang("en")}
      >
        EN
      </button>
    </div>
  );
}
