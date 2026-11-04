import { createTranslator } from "./translate";
import { DICTIONARY } from "./dictionary";

/** Arabic -> English phrase lookup for code that needs the text itself (search, sorting). */
export const tx = createTranslator(DICTIONARY);
export const toEnglish = (text: string) => tx(text) ?? text;
