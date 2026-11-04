import React from "react";
import { renderToString } from "react-dom/server";
import type { Express } from "express";
import { LandingPage } from "../client/src/pages/public/LandingPage";
import routes from "../client/public/manus-routes.json";
import { PUBLIC_ORIGIN } from "../shared/public-services";
import { siteMetadata } from "../shared/site-metadata";

export function cleanPagePath(url: string): string {
  try {
    return (
      new URL(url, "https://invalid.example").pathname.replace(/\/+$/, "") ||
      "/"
    );
  } catch {
    return "/404";
  }
}
export function knownPagePath(path: string): boolean {
  if (path === "/404") return true;
  return routes.routes.some(route => {
    const pattern = route.path
      .split("/")
      .map(piece =>
        piece.startsWith(":")
          ? "[^/]+"
          : piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      )
      .join("/");
    return new RegExp(`^${pattern}$`).test(path);
  });
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );
export function renderPageTemplate(
  template: string,
  url: string
): { html: string; status: number } {
  const path = cleanPagePath(url);
  const exists = knownPagePath(path);
  const metadata = siteMetadata(path);
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(
      /<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi,
      ""
    )
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
  const tags = [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}">`,
    `<meta name="robots" content="${metadata.robots}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="صُنّاع الفرص">`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:image" content="${escapeHtml(metadata.image)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(metadata.image)}">`,
  ];
  if (metadata.canonical)
    tags.push(
      `<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`,
      `<meta property="og:url" content="${escapeHtml(metadata.url!)}">`
    );
  html = html.replace("</head>", () => `${tags.join("\n")}\n</head>`);
  if (path === "/")
    html = html.replace(
      /<div id=["']root["']><\/div>/,
      () => `<div id="root">${renderToString(<LandingPage />)}</div>`
    );
  return { html, status: !exists || path === "/404" ? 404 : 200 };
}
export function registerPublicSeoDocuments(app: Express) {
  app.get("/robots.txt", (_req, res) => {
    const hidden = Array.from(
      new Set(
        routes.routes
          .filter(row => row.path !== "/")
          .map(row => row.path.split("/:")[0])
      )
    );
    res
      .type("text/plain")
      .set("Cache-Control", "no-cache")
      .send(
        [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          ...hidden.map(path => `Disallow: ${path}`),
          `Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`,
          "",
        ].join("\n")
      );
  });
  app.get("/sitemap.xml", (_req, res) =>
    res
      .type("application/xml")
      .set("Cache-Control", "no-cache")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PUBLIC_ORIGIN}/</loc></url></urlset>`
      )
  );
}
