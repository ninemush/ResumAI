import type { MetadataRoute } from "next";

const publicRoutes = [
  { path: "/", priority: 1 },
  { path: "/ai-use", priority: 0.7 },
  { path: "/credits", priority: 0.7 },
  { path: "/data-retention", priority: 0.7 },
  { path: "/privacy", priority: 0.8 },
  { path: "/security", priority: 0.7 },
  { path: "/subprocessors", priority: 0.6 },
  { path: "/terms", priority: 0.8 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date("2026-06-12T00:00:00.000Z");

  return publicRoutes.map((route) => ({
    changeFrequency: "monthly",
    lastModified,
    priority: route.priority,
    url: `${siteUrl}${route.path}`,
  }));
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://pramania.com").replace(/\/$/, "");
}
