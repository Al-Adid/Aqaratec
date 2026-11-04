import type { Dictionary } from "./translate";
import { COMMON } from "./dict/common";
import { HARVEST_1 } from "./dict/harvest-1";
import { PROPERTIES_1 } from "./dict/properties-1";
import { MARKETING_1 } from "./dict/marketing-1";
import { EXTRA } from "./dict/extra";

/** All phrase dictionaries merged. Later files win on duplicate keys. */
export const DICTIONARY: Dictionary = { ...HARVEST_1, ...PROPERTIES_1, ...MARKETING_1, ...EXTRA, ...COMMON };
