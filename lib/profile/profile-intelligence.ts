import "server-only";

type ProfileFact = {
  confidence: number | null;
  fact_type: string;
  fact_value: string;
};

type ProfileSnapshot = {
  headline: string | null;
  summary: string | null;
  target_direction: string | null;
  target_level: string | null;
};

export type ProfileIntelligence = {
  evidenceStrength: "thin" | "developing" | "strong";
  highValueGaps: {
    label: string;
    prompt: string;
    severity: "critical" | "important" | "informational";
  }[];
  positioningSignals: string[];
  proofThemes: {
    evidence: string[];
    label: string;
  }[];
  resumeFocus: string[];
  roleTargetRead: string;
};

const signalGroups = [
  {
    label: "Commercial impact",
    terms: ["revenue", "bookings", "growth", "margin", "profit", "pipeline", "sales", "renewal"],
    prompt:
      "Can we prove revenue, bookings, margin, pipeline, renewal, pricing, or commercial-growth impact?",
  },
  {
    label: "Operational scale",
    terms: ["operations", "delivery", "capacity", "process", "cycle", "efficiency", "cost", "automation"],
    prompt:
      "Can we quantify cost reduction, cycle-time improvement, delivery capacity, automation throughput, or productivity gain?",
  },
  {
    label: "Customer outcomes",
    terms: ["customer", "client", "retention", "nps", "csat", "adoption", "satisfaction", "service"],
    prompt:
      "Can we show adoption, retention, CSAT/NPS, customer value, time-to-value, or service-quality movement?",
  },
  {
    label: "Technology and data credibility",
    terms: ["ai", "automation", "data", "analytics", "cloud", "platform", "api", "integration"],
    prompt:
      "Can we name the platforms, data/AI use cases, integration scope, deployment scale, or technical outcomes?",
  },
  {
    label: "Executive scope",
    terms: ["executive", "board", "vp", "global", "regional", "stakeholder", "transformation", "strategy"],
    prompt:
      "Can we prove executive stakeholder level, geography, team size, budget, governance, or decision authority?",
  },
  {
    label: "Risk and control",
    terms: ["risk", "governance", "control", "audit", "compliance", "sox", "security", "regulatory"],
    prompt:
      "Can we quantify risk reduction, control improvement, audit readiness, compliance outcomes, or governance maturity?",
  },
];

export function buildProfileIntelligence({
  facts,
  profile,
}: {
  facts: ProfileFact[];
  profile: ProfileSnapshot;
}): ProfileIntelligence {
  const values = facts.map((fact) => fact.fact_value);
  const profileText = [
    profile.headline,
    profile.summary,
    profile.target_direction,
    profile.target_level,
    ...values,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const proofThemes = signalGroups
    .map((group) => ({
      evidence: values
        .filter((value) => group.terms.some((term) => value.toLowerCase().includes(term)))
        .slice(0, 3),
      label: group.label,
    }))
    .filter((theme) => theme.evidence.length > 0)
    .slice(0, 4);
  const missingGroups = signalGroups
    .filter((group) => !group.terms.some((term) => profileText.includes(term)))
    .slice(0, 4);
  const evidenceStrength = readEvidenceStrength(facts.length, proofThemes.length);

  return {
    evidenceStrength,
    highValueGaps: [
      ...readBaselineGaps({ facts, profile }),
      ...missingGroups.map((group) => ({
        label: group.label,
        prompt: group.prompt,
        severity: "important" as const,
      })),
    ].slice(0, 6),
    positioningSignals: readPositioningSignals({ facts, profile, proofThemes }),
    proofThemes,
    resumeFocus: readResumeFocus({ proofThemes, profile }),
    roleTargetRead: readRoleTargetRead(profile),
  };
}

function readEvidenceStrength(factCount: number, themeCount: number): ProfileIntelligence["evidenceStrength"] {
  if (factCount >= 12 && themeCount >= 3) {
    return "strong";
  }

  if (factCount >= 5 || themeCount >= 2) {
    return "developing";
  }

  return "thin";
}

function readBaselineGaps({
  facts,
  profile,
}: {
  facts: ProfileFact[];
  profile: ProfileSnapshot;
}): ProfileIntelligence["highValueGaps"] {
  const factTypes = new Set(facts.map((fact) => fact.fact_type));
  const gaps: ProfileIntelligence["highValueGaps"] = [];

  if (!profile.target_direction) {
    gaps.push({
      label: "Target direction",
      prompt: "Choose the role family or career lane this profile should optimize for.",
      severity: "critical",
    });
  }

  if (!profile.target_level) {
    gaps.push({
      label: "Seniority level",
      prompt: "Clarify the level we are positioning for so the resume does not under- or over-sell the user.",
      severity: "important",
    });
  }

  if (!factTypes.has("experience") && !factTypes.has("project")) {
    gaps.push({
      label: "Work proof",
      prompt: "Add role, project, or initiative evidence with scope, ownership, and outcome.",
      severity: "critical",
    });
  }

  if (!factTypes.has("skill")) {
    gaps.push({
      label: "Skill evidence",
      prompt: "Add tools, methods, domain skills, and strengths that hiring teams or ATS screens would search for.",
      severity: "important",
    });
  }

  return gaps;
}

function readPositioningSignals({
  facts,
  profile,
  proofThemes,
}: {
  facts: ProfileFact[];
  profile: ProfileSnapshot;
  proofThemes: ProfileIntelligence["proofThemes"];
}) {
  const signals = new Set<string>();

  if (profile.target_direction) {
    signals.add(profile.target_direction);
  }

  if (profile.target_level) {
    signals.add(profile.target_level);
  }

  for (const theme of proofThemes) {
    signals.add(theme.label);
  }

  for (const fact of facts) {
    if (["industry", "skill", "credential"].includes(fact.fact_type)) {
      signals.add(cleanSignal(fact.fact_value));
    }
  }

  return Array.from(signals).filter(Boolean).slice(0, 10);
}

function readResumeFocus({
  proofThemes,
  profile,
}: {
  proofThemes: ProfileIntelligence["proofThemes"];
  profile: ProfileSnapshot;
}) {
  const focus = [
    profile.target_direction ? `Position toward ${profile.target_direction}` : null,
    profile.target_level ? `Calibrate language for ${profile.target_level}` : null,
    ...proofThemes.map((theme) => `Prove ${theme.label.toLowerCase()}`),
    "Convert responsibilities into measurable business value where evidence supports it",
    "Keep gaps and metric prompts out of final resume claims until the user substantiates them",
  ].filter(Boolean);

  return focus.slice(0, 8) as string[];
}

function readRoleTargetRead(profile: ProfileSnapshot) {
  if (profile.target_direction && profile.target_level) {
    return `${profile.target_level} roles in ${profile.target_direction}`;
  }

  if (profile.target_direction) {
    return `${profile.target_direction}, level still open`;
  }

  return "Target lane still open";
}

function cleanSignal(value: string) {
  return value
    .replace(/^language:\s*/i, "")
    .replace(/^location:\s*/i, "")
    .trim();
}
