const configuredName = process.env.NEXT_PUBLIC_APP_NAME?.trim();
const configuredTagline = process.env.NEXT_PUBLIC_APP_TAGLINE?.trim();
const configuredContactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const configuredSupportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();

export const brand = {
  name: configuredName || "Pramania",
  tagline: configuredTagline || "Career clarity, guided by intelligence",
  category: "Career intelligence",
  contactEmail: configuredContactEmail || "hello@pramania.com",
  description: "AI-assisted job application workspace.",
  appIconPath: "/brand/pramania-app-icon-dark.png",
  appIconLightPath: "/brand/pramania-app-icon-light.png",
  bloomMarkPath: "/brand/pramania-bloom-mark-transparent.png",
  horizontalLogoPath: "/brand/pramania-horizontal-lockup-transparent.png",
  logoAlt: `${configuredName || "Pramania"} primary logo`,
  logoPath: "/brand/pramania-primary-logo-transparent.png",
  stackedLogoPath: "/brand/pramania-stacked-lockup-transparent.png",
  supportEmail: configuredSupportEmail || "support@pramania.com",
  wordmarkPath: "/brand/pramania-wordmark-only-transparent.png",
} as const;

export function getBrandInitials(name = brand.name) {
  const words = name
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}
