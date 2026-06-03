import Link from "next/link";

import {
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
} from "@/lib/billing/credit-catalog";

export const metadata = {
  description:
    "Learn how Pramania credits are used for reading career sources, job analysis, resume drafts, application packets, and downloadable files.",
  title: "How Credits Work | Pramania",
};

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
          Pramania uses credits for actions that require document reading, job analysis,
          generation, file preparation, or deeper AI reasoning. The goal is simple: you
          should know what will use credits, why it is valuable, and where the work lands.
        </p>
        <p>
          Job hunting is a season, not something you should be charged for indefinitely.
          You can add credits when you need more help and stop when you do not. Pramania
          does not auto-charge, auto-renew credit packs, or refill your balance without
          your explicit action.
        </p>

        <div className="credits-callout">
          <strong>Simple rule:</strong>
          <p>
            Credits are tied to meaningful career outcomes, not raw token counts. Viewing
            saved work, asking Pramania to explain your context, or downloading files that
            were already prepared does not consume extra credits.
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
          {CREDIT_USAGE_GUIDE.map((action) => (
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

        <h2>What does not use credits</h2>
        <ul className="credits-free-list">
          {CREDIT_FREE_ACTIONS.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>

        <h2>Example credit journeys</h2>
        <div className="credits-example-grid" aria-label="Example credit usage">
          {CREDIT_EXAMPLE_JOURNEYS.map((journey) => (
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

        <div className="credits-principle-grid" aria-label="Credit principles">
          <article>
            <strong>No surprise deductions</strong>
            <p>Credit use is shown in Settings history, including what action used credits and when.</p>
          </article>
          <article>
            <strong>Failures are investigated</strong>
            <p>If a source or generation fails, Pramania records the issue with context so it can be triaged.</p>
          </article>
          <article>
            <strong>Your saved work stays available</strong>
            <p>Running out of credits blocks new high-cost actions, not access to your existing workspace.</p>
          </article>
        </div>

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
