import { brand } from "@/lib/brand";

export const CREDIT_COSTS = {
  applicationMaterialsExport: 1,
  applicationMaterialsGenerate: 4,
  jobIngest: 1,
  masterResumeExport: 1,
  masterResumeGenerate: 2,
  profileSourceExtract: 1,
} as const;

export type CreditFeature = keyof typeof CREDIT_COSTS;

export const CREDIT_PURCHASE_OPTIONS = [
  {
    credits: 25,
    description:
      "Good for a focused search sprint or a few polished applications.",
    envKey: "NEXT_PUBLIC_REVENUECAT_CREDITS_25_URL",
    label: "Clarity",
    priceUsd: 12,
    productId: "pramania_credits_25",
    recommended: false,
  },
  {
    credits: 75,
    description:
      "Best value for a full search cycle with multiple tailored applications.",
    envKey: "NEXT_PUBLIC_REVENUECAT_CREDITS_75_URL",
    label: "Momentum",
    priceUsd: 29,
    productId: "pramania_credits_75",
    recommended: true,
  },
] as const;

export const CREDIT_USAGE_GUIDE = [
  {
    cost: CREDIT_COSTS.profileSourceExtract,
    examples:
      "Resume PDFs, DOCX files, text files, images, LinkedIn exports, and profile notes.",
    feature: "profileSourceExtract",
    name: "Read a career source",
    value: `Turns raw material into career context ${brand.name} can use.`,
  },
  {
    cost: CREDIT_COSTS.masterResumeGenerate,
    examples:
      "Create or rebuild your master ATS resume from saved profile context.",
    feature: "masterResumeGenerate",
    name: "Build the master resume",
    value: "Creates the reusable foundation for focused applications.",
  },
  {
    cost: CREDIT_COSTS.masterResumeExport,
    examples:
      "Create downloadable PDF/DOCX files for the latest master resume.",
    feature: "masterResumeExport",
    name: "Export master resume files",
    value:
      `Packages the approved master resume into files you can review and use outside ${brand.name}.`,
  },
  {
    cost: CREDIT_COSTS.jobIngest,
    examples: "Read a public job post link and compare it with your profile.",
    feature: "jobIngest",
    name: "Analyze a job link",
    value:
      "Helps you decide whether a role is worth pursuing before spending more effort.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsGenerate,
    examples: "Draft a tailored resume and cover letter for one specific job.",
    feature: "applicationMaterialsGenerate",
    name: "Draft job-specific materials",
    value:
      "Creates role-specific content from your profile and the job post; it does not overwrite your master resume.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsExport,
    examples:
      "Create downloadable PDF/DOCX files for the tailored resume and cover letter.",
    feature: "applicationMaterialsExport",
    name: "Export job-specific files",
    value:
      "Packages already drafted materials into files saved against that application.",
  },
] as const satisfies Array<{
  cost: number;
  examples: string;
  feature: CreditFeature;
  name: string;
  value: string;
}>;

export const CREDIT_FREE_ACTIONS = [
  `Ask ${brand.name} to explain your saved profile, jobs, applications, or credit balance.`,
  "Browse your workspace, Library, Jobs, Applications, Settings, and previous files.",
  "Edit your profile or resume manually.",
  "Change an application stage, archive or restore records, and update follow-up status.",
  "View or download files that were already prepared.",
  "Apply a promo code or report a support issue.",
] as const;

export const CREDIT_EXAMPLE_JOURNEYS = [
  {
    actions: [
      "Drop a LinkedIn profile export PDF",
      "Build the master resume",
      "Export master resume files",
    ],
    credits:
      CREDIT_COSTS.profileSourceExtract +
      CREDIT_COSTS.masterResumeGenerate +
      CREDIT_COSTS.masterResumeExport,
    title: "Build a starting profile",
  },
  {
    actions: [
      "Paste one job link",
      "Draft job-specific materials",
      "Export job-specific files",
    ],
    credits:
      CREDIT_COSTS.jobIngest +
      CREDIT_COSTS.applicationMaterialsGenerate +
      CREDIT_COSTS.applicationMaterialsExport,
    title: "Prepare one application",
  },
  {
    actions: [
      "Analyze three job links",
      "Draft materials for the strongest fit",
      "Export job-specific files",
    ],
    credits:
      CREDIT_COSTS.jobIngest * 3 +
      CREDIT_COSTS.applicationMaterialsGenerate +
      CREDIT_COSTS.applicationMaterialsExport,
    title: "Compare roles before applying",
  },
] as const;

export function formatCreditCost(cost: number) {
  return `${cost} credit${cost === 1 ? "" : "s"}`;
}

export function getCreditUsageItem(feature: CreditFeature) {
  return CREDIT_USAGE_GUIDE.find((item) => item.feature === feature);
}

export function getCreditUsageSummary() {
  return CREDIT_USAGE_GUIDE.map(
    (item) => `${item.name}: ${formatCreditCost(item.cost)}`,
  ).join("; ");
}
