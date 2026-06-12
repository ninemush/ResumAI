import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/ai-use",
        "/credits",
        "/data-retention",
        "/privacy",
        "/security",
        "/subprocessors",
        "/terms",
      ],
      disallow: ["/api/", "/auth/", "/admin/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://pramania.com").replace(/\/$/, "");
}
