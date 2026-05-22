const configuredName = process.env.NEXT_PUBLIC_APP_NAME?.trim();
const configuredTagline = process.env.NEXT_PUBLIC_APP_TAGLINE?.trim();

export const brand = {
  name: configuredName || "Pramania",
  tagline: configuredTagline || "Apply smarter",
  category: "Application OS",
  description: "AI-assisted job application workspace.",
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
