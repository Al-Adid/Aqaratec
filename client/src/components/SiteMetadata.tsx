import { useEffect } from "react";
import { useLocation } from "wouter";
import { siteMetadata } from "@shared/site-metadata";
export function SiteMetadata() {
  const [path] = useLocation();
  useEffect(() => {
    const meta = siteMetadata(path);
    document.title = meta.title;
    const set = (
      attribute: "name" | "property",
      key: string,
      value: string
    ) => {
      let node = document.head.querySelector<HTMLMetaElement>(
        `meta[${attribute}="${key}"]`
      );
      if (!node) {
        node = document.createElement("meta");
        node.setAttribute(attribute, key);
        document.head.append(node);
      }
      node.content = value;
    };
    set("name", "description", meta.description);
    set("name", "robots", meta.robots);
    set("property", "og:title", meta.title);
    set("property", "og:description", meta.description);
    set("property", "og:image", meta.image);
    set("property", "og:site_name", "صُنّاع الفرص");
    set("property", "og:type", "website");
    set("name", "twitter:card", "summary");
    set("name", "twitter:title", meta.title);
    set("name", "twitter:description", meta.description);
    set("name", "twitter:image", meta.image);
    let link = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    if (meta.canonical) {
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.append(link);
      }
      link.href = meta.canonical;
      set("property", "og:url", meta.url!);
    } else {
      link?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }
  }, [path]);
  return null;
}
