import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileSearch,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
  formatCreditCost,
} from "@/lib/billing/credit-catalog";
import { brand } from "@/lib/brand";

export const metadata = {
  description:
    "Learn how Pramania credits are used for reading career sources, job analysis, resume drafts, job-specific materials, and downloadable files.",
  title: `How Credits Work | ${brand.name}`,
};

export default function CreditsPage() {
  return (
    <main className="credits-help-page">
      <section className="credits-help-shell" aria-labelledby="credits-title">
        <header className="credits-help-topbar">
          <Link className="credits-back-link" href="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to workspace
          </Link>
          <span>Help / Billing</span>
        </header>

        <section className="credits-help-hero">
          <div>
            <p className="eyebrow">Credits</p>
            <h1 id="credits-title">How Pramania credits work</h1>
            <p>
              {brand.name} uses credits only for higher-cost work: reading
              career sources, analyzing jobs, generating materials, preparing
              files, and deeper AI reasoning. Your balance, usage history,
              purchases, and invoices live in Settings.
            </p>
          </div>

          <aside
            className="credits-help-summary"
            aria-label="Credit model summary"
          >
            <CircleDollarSign size={22} aria-hidden="true" />
            <strong>Job hunting is a phase.</strong>
            <p>
              Add credits when you need more support. {brand.name} does not
              auto-charge, auto-renew credit packs, or refill your balance
              without your explicit action.
            </p>
          </aside>
        </section>

        <section className="credits-rule-grid" aria-label="Credit principles">
          <article>
            <CheckCircle2 size={18} aria-hidden="true" />
            <strong>Saved work stays available</strong>
            <p>
              Viewing prepared files, browsing your workspace, and reviewing
              saved context are free.
            </p>
          </article>
          <article>
            <ReceiptText size={18} aria-hidden="true" />
            <strong>Usage is auditable</strong>
            <p>
              Settings shows the action, date, and amount for every credit
              event.
            </p>
          </article>
          <article>
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>No surprise deductions</strong>
            <p>
              High-cost actions are priced by outcome, not hidden token
              counters.
            </p>
          </article>
        </section>

        <section className="credits-help-section">
          <div className="credits-section-heading">
            <FileSearch size={19} aria-hidden="true" />
            <div>
              <p className="eyebrow">Usage</p>
              <h2>What uses credits</h2>
            </div>
          </div>
          <div className="credits-cost-grid" aria-label="Credit costs">
            {CREDIT_USAGE_GUIDE.map((action) => (
              <article className="credits-cost-card" key={action.name}>
                <div>
                  <strong>{action.name}</strong>
                  <span>{formatCreditCost(action.cost)}</span>
                </div>
                <p>{action.examples}</p>
                <small>{action.value}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="credits-help-section credits-help-split">
          <div>
            <div className="credits-section-heading">
              <CheckCircle2 size={19} aria-hidden="true" />
              <div>
                <p className="eyebrow">Free actions</p>
                <h2>What does not use credits</h2>
              </div>
            </div>
            <ul className="credits-free-list credits-free-list-modern">
              {CREDIT_FREE_ACTIONS.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="credits-section-heading">
              <Sparkles size={19} aria-hidden="true" />
              <div>
                <p className="eyebrow">Examples</p>
                <h2>Typical journeys</h2>
              </div>
            </div>
            <div
              className="credits-example-stack"
              aria-label="Example credit usage"
            >
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
          </div>
        </section>

        <section className="credits-help-section">
          <div className="credits-section-heading">
            <CircleDollarSign size={19} aria-hidden="true" />
            <div>
              <p className="eyebrow">Packs</p>
              <h2>Add credits when you need more runway</h2>
            </div>
          </div>
          <p className="credits-section-copy">
            The larger pack is better value for a full search cycle, but both
            are one-time purchases. You stay in control.
          </p>
          <div
            className="credits-pack-grid credits-pack-grid-modern"
            aria-label="Credit packs"
          >
            {CREDIT_PURCHASE_OPTIONS.map((option) => (
              <article className="credits-pack-card" key={option.productId}>
                <span>
                  {option.recommended ? "Best value" : "Focused pack"}
                </span>
                <h3>{option.label}</h3>
                <strong>
                  ${option.priceUsd} for {option.credits} credits
                </strong>
                <p>{option.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="credits-help-section credits-low-credit-section">
          <div>
            <p className="eyebrow">Low balance</p>
            <h2>What happens when credits run low?</h2>
            <p>
              {brand.name} warns at 50%, 75%, and 90% usage. When credits are
              exhausted, new source reading, generation, job analysis, and
              export are blocked until more credits are added. Your existing
              workspace remains available.
            </p>
          </div>
          <div className="credits-legal-links">
            <Link href="/terms">Terms and Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
