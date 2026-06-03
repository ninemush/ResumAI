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
    description: "Good for a focused search sprint or a few polished applications.",
    envKey: "NEXT_PUBLIC_REVENUECAT_CREDITS_25_URL",
    label: "Clarity",
    priceUsd: 12,
    productId: "pramania_credits_25",
    recommended: false,
  },
  {
    credits: 75,
    description: "Best value for a full search cycle with multiple tailored applications.",
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
    examples: "Resume PDFs, DOCX files, text files, images, LinkedIn exports, and profile notes.",
    feature: "profileSourceExtract",
    name: "Read a career source",
    value: "Turns raw material into career context Pramania can use.",
  },
  {
    cost: CREDIT_COSTS.masterResumeGenerate,
    examples: "Create or rebuild your master ATS resume from saved profile context.",
    feature: "masterResumeGenerate",
    name: "Build the master resume",
    value: "Creates the reusable foundation for focused applications.",
  },
  {
    cost: CREDIT_COSTS.masterResumeExport,
    examples: "Prepare the latest master resume as PDF and DOCX files.",
    feature: "masterResumeExport",
    name: "Prepare master resume files",
    value: "Produces downloadable files you can review and use outside Pramania.",
  },
  {
    cost: CREDIT_COSTS.jobIngest,
    examples: "Read a public job post link and compare it with your profile.",
    feature: "jobIngest",
    name: "Analyze a job link",
    value: "Helps you decide whether a role is worth pursuing before spending more effort.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsGenerate,
    examples: "Create a tailored resume and cover letter for one specific job.",
    feature: "applicationMaterialsGenerate",
    name: "Create an application packet",
    value: "Creates role-specific materials without overwriting your master resume.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsExport,
    examples: "Prepare job-specific resume and cover-letter PDF/DOCX files.",
    feature: "applicationMaterialsExport",
    name: "Prepare application files",
    value: "Saves files against that job so you can revisit what you used.",
  },
] as const satisfies Array<{
  cost: number;
  examples: string;
  feature: CreditFeature;
  name: string;
  value: string;
}>;

export const CREDIT_FREE_ACTIONS = [
  "Ask Pramania to explain your saved profile, jobs, applications, or credit balance.",
  "Browse your workspace, Library, Jobs, Applications, Settings, and previous files.",
  "Edit your profile or resume manually.",
  "Change an application stage, archive or restore records, and update follow-up status.",
  "View or download files that were already prepared.",
  "Apply a promo code or report a support issue.",
] as const;

export const CREDIT_EXAMPLE_JOURNEYS = [
  {
    actions: ["Drop a LinkedIn profile export PDF", "Build the master resume", "Prepare PDF/DOCX files"],
    credits:
      CREDIT_COSTS.profileSourceExtract +
      CREDIT_COSTS.masterResumeGenerate +
      CREDIT_COSTS.masterResumeExport,
    title: "Build a starting profile",
  },
  {
    actions: ["Paste one job link", "Create the application packet", "Prepare files"],
    credits:
      CREDIT_COSTS.jobIngest +
      CREDIT_COSTS.applicationMaterialsGenerate +
      CREDIT_COSTS.applicationMaterialsExport,
    title: "Prepare one application",
  },
  {
    actions: ["Analyze three job links", "Create materials for the strongest fit", "Prepare files"],
    credits:
      CREDIT_COSTS.jobIngest * 3 +
      CREDIT_COSTS.applicationMaterialsGenerate +
      CREDIT_COSTS.applicationMaterialsExport,
    title: "Compare roles before applying",
  },
] as const;
