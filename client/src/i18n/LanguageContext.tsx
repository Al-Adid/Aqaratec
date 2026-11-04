import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "ar" | "en";
export type Dir = "rtl" | "ltr";

export const LANGUAGE_STORAGE_KEY = "sunnaa-lang";

export interface I18n {
  lang: Lang;
  dir: Dir;
  isAr: boolean;
  isEn: boolean;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  /** Pick the string for the active language. Arabic first, then English. */
  t: (ar: string, en: string) => string;
}

export const dirOf = (lang: Lang): Dir => (lang === "ar" ? "rtl" : "ltr");

const make = (lang: Lang, setLang: (l: Lang) => void): I18n => ({
  lang,
  dir: dirOf(lang),
  isAr: lang === "ar",
  isEn: lang === "en",
  setLang,
  toggle: () => setLang(lang === "ar" ? "en" : "ar"),
  t: (ar, en) => (lang === "ar" ? ar : en),
});

// Used when a component renders without the provider (tests, server render).
const fallback = make("ar", () => {});
const LanguageContext = createContext<I18n>(fallback);

function readInitial(): Lang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl === "ar" || fromUrl === "en") return fromUrl;
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // storage can be blocked; Arabic is the product default
  }
  return "ar";
}

export function LanguageProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? readInitial());

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dirOf(lang);
    root.dataset.lang = lang;
  }, [lang]);

  const value = useMemo(() => make(lang, setLang), [lang, setLang]);
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useI18n = () => useContext(LanguageContext);
