import { useEffect } from "react";
import { useI18n } from "./LanguageContext";
import { createTranslator, hasArabic, type Translator } from "./translate";
import { DICTIONARY } from "./dictionary";

/**
 * Renders the English view of screens that still carry Arabic copy.
 *
 * While English is active it rewrites visible text nodes and a few attributes
 * through the phrase dictionary and keeps doing so as React updates the page.
 * Application state and stored data are never touched, and switching back to
 * Arabic restores every node. Screens written with `t(ar, en)` are unaffected.
 */

const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);

interface Rec {
  orig: string;
  out: string;
}

declare global {
  interface Window {
    __I18N_MISSING__?: Set<string>;
  }
}

const translator: Translator = createTranslator(DICTIONARY);

export function DomTranslator() {
  const { lang } = useI18n();

  useEffect(() => {
    if (lang !== "en") return;

    const texts = new WeakMap<Text, Rec>();
    const attrs = new WeakMap<Element, Map<string, Rec>>();
    const missing: Set<string> | null = import.meta.env.DEV
      ? (window.__I18N_MISSING__ ??= new Set())
      : null;

    const skipped = (el: Element | null) =>
      !!el && (SKIP_TAGS.has(el.tagName) || !!el.closest("[data-i18n-skip]"));

    const doText = (node: Text) => {
      const cur = node.nodeValue ?? "";
      const rec = texts.get(node);
      if (rec && cur === rec.out) return;
      if (!hasArabic(cur)) {
        if (rec) texts.delete(node);
        return;
      }
      if (skipped(node.parentElement)) return;
      const out = translator(cur);
      if (out !== null && out !== cur) {
        texts.set(node, { orig: cur, out });
        node.nodeValue = out;
      } else {
        if (rec) texts.delete(node);
        if (missing && missing.size < 6000) missing.add(cur.trim());
      }
    };

    const doAttr = (el: Element, name: string) => {
      const cur = el.getAttribute(name);
      if (cur === null) return;
      let map = attrs.get(el);
      const rec = map?.get(name);
      if (rec && cur === rec.out) return;
      if (!hasArabic(cur) || skipped(el)) return;
      const out = translator(cur);
      if (out !== null && out !== cur) {
        if (!map) attrs.set(el, (map = new Map()));
        map.set(name, { orig: cur, out });
        el.setAttribute(name, out);
      } else if (missing && missing.size < 6000) {
        missing.add(cur.trim());
      }
    };

    const doSubtree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        doText(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const rootEl = root as Element;
      if (skipped(rootEl)) return;
      const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
      );
      let n: Node | null = walker.currentNode;
      while (n) {
        if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
        else for (const a of ATTRS) doAttr(n as Element, a);
        n = walker.nextNode();
      }
    };

    // batch mutations into one pass per frame
    let queue: MutationRecord[] = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = queue;
      queue = [];
      for (const m of batch) {
        if (m.type === "childList") m.addedNodes.forEach(doSubtree);
        else if (m.type === "characterData") doText(m.target as Text);
        else if (m.type === "attributes" && m.attributeName)
          doAttr(m.target as Element, m.attributeName);
      }
    };
    const observer = new MutationObserver(records => {
      queue.push(...records);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    });

    doSubtree(document.documentElement);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    });

    return () => {
      observer.disconnect();
      const walker = document.createTreeWalker(
        document.documentElement,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
      );
      let n: Node | null = walker.currentNode;
      while (n) {
        if (n.nodeType === Node.TEXT_NODE) {
          const rec = texts.get(n as Text);
          if (rec && (n as Text).nodeValue === rec.out)
            (n as Text).nodeValue = rec.orig;
        } else {
          const map = attrs.get(n as Element);
          if (map)
            map.forEach((rec, name) => {
              if ((n as Element).getAttribute(name) === rec.out)
                (n as Element).setAttribute(name, rec.orig);
            });
        }
        n = walker.nextNode();
      }
    };
  }, [lang]);

  return null;
}
