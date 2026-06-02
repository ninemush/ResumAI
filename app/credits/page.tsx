import Link from "next/link";

import { CREDIT_COSTS, CREDIT_PURCHASE_OPTIONS } from "@/lib/billing/credits";

export const metadata = {
  description:
    "Learn how Pramania credits are used for reading career sources, job analysis, resume drafts, application packets, and downloadable files.",
  title: "How Credits Work | Pramania",
};

const creditActions = [
  {
    cost: CREDIT_COSTS.profileSourceExtract,
    examples: "Reading a resume PDF, DOCX, text file, image, or profile export you drop into chat.",
    name: "Read career source",
    value: "Turns raw material into structured career context Pramania can use.",
  },
  {
    cost: CREDIT_COSTS.masterResumeGenerate,
    examples: "Creating or rebuilding your master ATS resume from confirmed profile context.",
    name: "Master resume draft",
    value: "Creates the reusable foundation for role-specific applications.",
  },
  {
    cost: CREDIT_COSTS.masterResumeExport,
    examples: "Preparing the latest master resume as a validated PDF or DOCX file.",
    name: "Master resume download",
    value: "Produces a file you can review, download, and use outside Pramania.",
  },
  {
    cost: CREDIT_COSTS.jobIngest,
    examples: "Reading a public job post link and producing a fit review against your profile.",
    name: "Job analysis",
    value: "Helps you decide whether a role is worth pursuing before spending more effort.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsGenerate,
    examples: "Creating a tailored resume and cover letter for one specific job.",
    name: "Application packet",
    value: "Creates role-specific materials without overwriting your master resume.",
  },
  {
    cost: CREDIT_COSTS.applicationMaterialsExport,
    examples: "Preparing job-specific resume and cover letter files for an application record.",
    name: "Application files",
    value: "Saves downloadable files against that job so you can revisit what you used.",
  },
];

const sampleJourneys = [
  {
    actions: [
      "Drop a LinkedIn profile export PDF",
      "Create a master resume",
      "Download the master resume",
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
      "Create job-specific materials",
      "Download the files",
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
      "Create materials for the strongest fit",
      "Download the application package",
    ],
    credits:
      CREDIT_COSTS.jobIngest * 3 +
      CREDIT_COSTS.applicationMaterialsGenerate +
      CREDIT_COSTS.applicationMaterialsExport,
    title: "Compare roles before applying",
  },
];

export default function CreditsPage() {
  return (
    <main className="legal-page">
      <section className="legal-document credits-document" aria-labelledby="credits-title">
        <Link className="legal-back-link" href="/">
          Back to Pramania
        </Link>
        <p className="eyebrow">Credits</p>
        <h1 id="credits-title">How Pramania credits work</h1>
        <p className="legal-meta">Credits are used when Pramania does high-cost work for you.</p>

        <p>
          Pramania uses credits for actions that require AI reasoning, document reading,
          job analysis, generation, validation, or export infrastructure. Browsing your
          workspace, reading saved materials, editing text, changing application status,
          and downloading already-created files do not consume extra credits.
        </p>

        <div className="credits-callout">
          <strong>Simple rule:</strong>
          <p>
            Credits are tied to meaningful outcomes, not raw token counts. You should know
            when credits are being used and what value that action creates.
          </p>
        </div>

        <h2>Current credit costs</h2>
        <div className="credits-table" role="table" aria-label="Credit costs">
          <div className="credits-table-row credits-table-head" role="row">
            <span>Action</span>
            <span>Credits</span>
            <span>Example</span>
            <span>Why it matters</span>
          </div>
          {creditActions.map((action) => (
            <div className="credits-table-row" key={action.name} role="row">
              <span>
                <strong>{action.name}</strong>
              </span>
              <span>{action.cost}</span>
              <span>{action.examples}</span>
              <span>{action.value}</span>
            </div>
          ))}
        </div>

        <h2>Example credit journeys</h2>
        <div className="credits-example-grid" aria-label="Example credit usage">
          {sampleJourneys.map((journey) => (
            <article className="credits-example-card" key={journey.title}>
              <span>{journey.credits} credits</span>
              <h3>{journey.title}</h3>
              <ul>
                {journey.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <h2>Credit packs</h2>
        <div className="credits-pack-grid" aria-label="Credit packs">
          {CREDIT_PURCHASE_OPTIONS.map((option) => (
            <article className="credits-pack-card" key={option.productId}>
              <span>{option.recommended ? "Best value" : "Focused pack"}</span>
              <h3>{option.label}</h3>
              <strong>
                ${option.priceUsd} for {option.credits} credits
              </strong>
              <p>{option.description}</p>
            </article>
          ))}
        </div>

        <h2>What happens when credits run low?</h2>
        <p>
          Pramania shows your available balance in Settings. The app warns at 50%, 75%,
          and 90% usage. When credits are exhausted, high-cost actions such as reading
          new career sources, generation, job analysis, and export are blocked until more credits
          are added. Your saved profile, applications, uploaded sources, and generated
          materials remain available.
        </p>

        <p>
          For billing and usage terms, review the{" "}
          <Link href="/terms" target="_blank">
            Terms and Conditions
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank">
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
