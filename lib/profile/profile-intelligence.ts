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

export type DomainRead = {
  confidence: "low" | "medium" | "high";
  evidenceTerms: string[];
  gentlePrompts: string[];
  id: string;
  label: string;
  metricFamilies: string[];
  resumeImplications: string[];
};

export type SeniorityRead = {
  confidence: "low" | "medium" | "high";
  evidenceTerms: string[];
  guidance: string;
  label: string;
  level:
    | "early_career"
    | "individual_contributor"
    | "manager"
    | "senior_leader"
    | "executive"
    | "board_advisory"
    | "unknown";
  resumeImplications: string[];
};

export type ProfileIntelligence = {
  advisorPromptPack: {
    gentlePrompts: string[];
    metricFamilies: string[];
    resumeImplications: string[];
  };
  domainReads: DomainRead[];
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
  seniorityRead: SeniorityRead;
};

type DomainPack = Omit<DomainRead, "confidence" | "evidenceTerms"> & {
  terms: string[];
};

type SeniorityPack = Omit<SeniorityRead, "confidence" | "evidenceTerms"> & {
  terms: string[];
};

const signalGroups = [
  {
    label: "Commercial impact",
    terms: ["revenue", "bookings", "growth", "margin", "profit", "pipeline", "sales", "renewal"],
    prompt:
      "Can we attach revenue, bookings, margin, pipeline, renewal, pricing, or commercial-growth impact?",
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
      "Can we attach executive stakeholder level, geography, team size, budget, governance, or decision authority?",
  },
  {
    label: "Risk and control",
    terms: ["risk", "governance", "control", "audit", "compliance", "sox", "security", "regulatory"],
    prompt:
      "Can we quantify risk reduction, control improvement, audit readiness, compliance outcomes, or governance maturity?",
  },
];

const domainPacks: DomainPack[] = [
  {
    id: "gtm_revenue_ops",
    label: "GTM, revenue operations, and commercial strategy",
    terms: [
      "gtm",
      "go-to-market",
      "revenue operations",
      "revops",
      "sales operations",
      "pipeline",
      "forecast",
      "quota",
      "bookings",
      "pricing",
      "portfolio",
      "sales cycle",
      "funnel",
      "commercial",
      "customer success",
      "renewal",
      "retention",
    ],
    metricFamilies: [
      "pipeline created or influenced",
      "forecast accuracy or governance improvement",
      "quota or bookings coverage",
      "revenue, margin, CAGR, or profitability movement",
      "sales-cycle, conversion, or funnel leakage improvement",
      "renewal, retention, expansion, or customer adoption impact",
    ],
    gentlePrompts: [
      "Which commercial lever did you most directly influence: pipeline, pricing, renewals, margin, or sales execution?",
      "Was the impact closer to revenue growth, margin improvement, faster sales cycles, better forecast discipline, or customer retention?",
      "Can we name the operating scope: region, segment, portfolio, customer base, or sales team supported?",
    ],
    resumeImplications: [
      "Lead with commercial scope and operating model, then tie bullets to revenue, margin, pipeline, or customer outcomes.",
      "Avoid generic GTM language unless the resume shows the lever, scale, and decision authority behind it.",
    ],
  },
  {
    id: "engineering_platform",
    label: "Software, platform, and technical systems",
    terms: [
      "software",
      "engineer",
      "backend",
      "frontend",
      "full stack",
      "api",
      "microservices",
      "architecture",
      "latency",
      "reliability",
      "availability",
      "incident",
      "migration",
      "cloud",
      "kubernetes",
      "developer velocity",
      "github",
      "open source",
      "data pipeline",
    ],
    metricFamilies: [
      "systems owned and production scale",
      "latency, uptime, reliability, or incident reduction",
      "migration scope and risk reduction",
      "developer velocity, release cadence, or code quality improvement",
      "API throughput, platform adoption, or infrastructure cost movement",
    ],
    gentlePrompts: [
      "What did the system support: users, transactions, requests, services, teams, or revenue-critical workflows?",
      "Did your work change reliability, latency, deployment speed, incident rate, cost, or developer productivity?",
      "Which technical decision would a staff engineer or hiring manager recognize as high judgment?",
    ],
    resumeImplications: [
      "Show systems owned, scale, architectural judgment, and operational outcomes before listing tool names.",
      "Separate project proof from routine implementation so seniority is easy to read.",
    ],
  },
  {
    id: "healthcare_operations",
    label: "Healthcare, clinical, and patient operations",
    terms: [
      "healthcare",
      "clinical",
      "patient",
      "hospital",
      "clinic",
      "ehr",
      "emr",
      "revenue cycle",
      "quality",
      "compliance",
      "hipaa",
      "staffing",
      "utilization",
      "throughput",
      "care",
      "access",
      "wait time",
    ],
    metricFamilies: [
      "patient access or wait-time improvement",
      "throughput, utilization, or staffing efficiency",
      "quality, safety, compliance, or audit outcomes",
      "EHR adoption, documentation quality, or revenue-cycle improvement",
      "patient satisfaction, service recovery, or care coordination impact",
    ],
    gentlePrompts: [
      "Was the strongest outcome patient access, throughput, staffing stability, quality, compliance, or revenue-cycle performance?",
      "Can we describe scale without sensitive data: sites, teams, patient volume band, shifts, or service lines?",
      "Did the work improve wait time, utilization, documentation quality, denial rate, or patient satisfaction?",
    ],
    resumeImplications: [
      "Use privacy-safe operational evidence and avoid unauthorized patient detail.",
      "Connect process changes to patient, quality, staffing, compliance, or revenue-cycle outcomes.",
    ],
  },
  {
    id: "logistics_supply_chain",
    label: "Logistics, supply chain, and frontline operations",
    terms: [
      "logistics",
      "supply chain",
      "warehouse",
      "inventory",
      "dispatch",
      "transport",
      "shipment",
      "order volume",
      "fleet",
      "fulfillment",
      "safety",
      "overtime",
      "throughput",
      "late shipments",
      "equipment",
      "operations supervisor",
    ],
    metricFamilies: [
      "orders, shipments, routes, or throughput managed",
      "late shipment, inventory accuracy, or fulfillment improvement",
      "staffing, overtime, safety, or equipment utilization impact",
      "dispatch speed, cycle time, cost per order, or service-level movement",
    ],
    gentlePrompts: [
      "Was this closer to 10, 50, 100, or 1,000+ orders or shipments per shift?",
      "Did your work improve on-time delivery, inventory accuracy, safety, overtime, or throughput?",
      "What team size, shift pattern, sites, systems, or equipment did you coordinate?",
    ],
    resumeImplications: [
      "Make operating scale visible fast: volume, shifts, team size, sites, systems, and service levels.",
      "Translate frontline execution into reliability, cost, safety, and customer-impact proof.",
    ],
  },
  {
    id: "product_ux_design",
    label: "Product, UX, and design strategy",
    terms: [
      "product design",
      "ux",
      "ui",
      "user research",
      "portfolio",
      "case study",
      "figma",
      "design system",
      "prototype",
      "usability",
      "activation",
      "conversion",
      "experiment",
      "journey",
      "stakeholder",
      "launch",
    ],
    metricFamilies: [
      "conversion, activation, retention, or task success movement",
      "research impact on product decisions",
      "design-system adoption or delivery speed",
      "launch outcomes, usability improvement, or support reduction",
      "stakeholder alignment, roadmap influence, or experiment results",
    ],
    gentlePrompts: [
      "Which product outcome moved: conversion, activation, retention, task completion, support tickets, or launch quality?",
      "What decision did your research or design work change?",
      "Can we name the surface, user segment, design system, experiment, or launch you influenced?",
    ],
    resumeImplications: [
      "Translate portfolio case studies into ATS-safe bullets with problem, decision, scope, and outcome.",
      "Preserve design voice while making business and product impact legible to recruiters.",
    ],
  },
  {
    id: "education_enablement",
    label: "Education, enablement, and customer learning",
    terms: [
      "teacher",
      "education",
      "enablement",
      "training",
      "facilitation",
      "curriculum",
      "coaching",
      "onboarding",
      "implementation",
      "customer education",
      "learning",
      "adoption",
      "workshop",
      "instructional",
    ],
    metricFamilies: [
      "learner, customer, or stakeholder audience size",
      "adoption, onboarding, time-to-proficiency, or completion improvement",
      "training quality, satisfaction, or support deflection",
      "documentation, curriculum, workshop, or enablement asset impact",
    ],
    gentlePrompts: [
      "Who were you helping succeed: students, customers, sales teams, partners, or internal users?",
      "Did the work improve adoption, confidence, completion, time-to-proficiency, or support volume?",
      "What material did you create: curriculum, playbooks, workshops, documentation, or onboarding flows?",
    ],
    resumeImplications: [
      "Bridge transferable skills into customer success, enablement, implementation, onboarding, or customer education language.",
      "Show audience, complexity, behavior change, and adoption outcomes instead of only responsibilities.",
    ],
  },
  {
    id: "executive_transformation",
    label: "Executive transformation and operating leadership",
    terms: [
      "transformation",
      "operating model",
      "p&l",
      "board",
      "advisory",
      "executive",
      "vp",
      "svp",
      "evp",
      "cio",
      "coo",
      "cxo",
      "global",
      "regional",
      "governance",
      "stakeholder",
      "strategy",
      "portfolio",
      "margin",
    ],
    metricFamilies: [
      "P&L, budget, portfolio, or revenue scope",
      "global or regional remit and stakeholder complexity",
      "operating model, governance, control, or decision-rights improvement",
      "team scale, transformation mandate, or board-level influence",
      "cost, margin, risk, or shareholder-value movement",
    ],
    gentlePrompts: [
      "Which executive lever did you own most directly: P&L, operating model, governance, portfolio, customer value, or transformation delivery?",
      "What was the scope: geography, budget, team size, customer base, portfolio, or executive stakeholder group?",
      "Did the work change cost, margin, risk, growth, service quality, or decision speed?",
    ],
    resumeImplications: [
      "Make mandate, scope, decision authority, and business outcome visible before functional detail.",
      "Use board-ready language only where the evidence shows scale, governance, and executive judgment.",
    ],
  },
];

const seniorityPacks: SeniorityPack[] = [
  {
    level: "board_advisory",
    label: "board or advisory-level positioning",
    terms: ["board", "advisor", "adviser", "advisory", "non-executive", "mentor", "startup advisor"],
    guidance: "Anchor advice around governance, strategic judgment, executive credibility, and evidence of influence without overstating formal authority.",
    resumeImplications: [
      "Separate advisory work from employment chronology unless it was a formal role.",
      "Show strategic influence, governance, market insight, or founder/executive coaching outcomes.",
    ],
  },
  {
    level: "executive",
    label: "executive-level positioning",
    terms: ["chief", "cxo", "cio", "coo", "ceo", "cto", "cfo", "vp", "svp", "evp", "general manager", "p&l", "executive"],
    guidance: "Prioritize mandate, scope, P&L or budget exposure, governance, decision authority, market complexity, and enterprise outcomes.",
    resumeImplications: [
      "Lead each major role with mandate and scope before execution detail.",
      "Avoid task-level bullets unless they prove transformation, governance, or commercial outcomes.",
    ],
  },
  {
    level: "senior_leader",
    label: "director/head-of/senior leader positioning",
    terms: ["director", "head of", "senior manager", "regional lead", "global lead", "practice lead", "leader"],
    guidance: "Show leadership scope, cross-functional influence, operating rhythm, team scale, stakeholder complexity, and measurable portfolio outcomes.",
    resumeImplications: [
      "Balance strategic ownership with concrete delivery outcomes.",
      "Make team, geography, budget, portfolio, and stakeholder scope easy to scan.",
    ],
  },
  {
    level: "manager",
    label: "manager and team-lead positioning",
    terms: ["manager", "team lead", "lead", "supervisor", "people manager", "managed", "coached"],
    guidance: "Connect people/process ownership to team performance, quality, productivity, customer, or delivery outcomes.",
    resumeImplications: [
      "Show who or what was managed and what improved.",
      "Use concrete team, process, customer, or delivery proof rather than generic leadership claims.",
    ],
  },
  {
    level: "early_career",
    label: "early-career positioning",
    terms: ["student", "graduate", "intern", "internship", "junior", "entry level", "associate", "campus", "class project"],
    guidance: "Reduce intimidation. Translate projects, internships, coursework, part-time work, tools, and learning velocity into credible first-role evidence.",
    resumeImplications: [
      "Do not demand executive metrics; ask for project scope, audience, tools, and what changed.",
      "Position attainable role lanes and show transferable evidence clearly.",
    ],
  },
  {
    level: "individual_contributor",
    label: "individual-contributor positioning",
    terms: ["analyst", "specialist", "engineer", "designer", "consultant", "coordinator", "developer", "associate", "architect"],
    guidance: "Show ownership, technical or functional depth, stakeholder impact, quality, speed, and reliable delivery.",
    resumeImplications: [
      "Make craft expertise, ownership scope, and outcomes specific.",
      "Avoid inflating seniority; prove progression through complexity and results.",
    ],
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
  const proofFacts = facts.filter(isProofBearingFact);
  const proofValues = proofFacts.map((fact) => fact.fact_value);
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
  const domainReads = readDomainReads(profileText);
  const seniorityRead = readSeniorityRead(profileText);
  const advisorPromptPack = readAdvisorPromptPack(domainReads, seniorityRead);
  const proofThemes = signalGroups
    .map((group) => ({
      evidence: proofValues
        .filter((value) => group.terms.some((term) => value.toLowerCase().includes(term)))
        .slice(0, 3),
      label: group.label,
    }))
    .filter((theme) => theme.evidence.length > 0)
    .slice(0, 4);
  const missingGroups = signalGroups
    .filter((group) => !group.terms.some((term) => profileText.includes(term)))
    .slice(0, 4);
  const evidenceStrength = readEvidenceStrength(proofFacts.length, proofThemes.length);

  return {
    advisorPromptPack,
    domainReads,
    evidenceStrength,
    highValueGaps: [
      ...readBaselineGaps({ facts, profile }),
      ...readDomainSeniorityGaps({
        advisorPromptPack,
        domainReads,
        evidenceStrength,
        seniorityRead,
      }),
      ...missingGroups.map((group) => ({
        label: group.label,
        prompt: group.prompt,
        severity: "important" as const,
      })),
    ].slice(0, 6),
    positioningSignals: readPositioningSignals({ domainReads, facts, profile, proofThemes, seniorityRead }),
    proofThemes,
    resumeFocus: readResumeFocus({ advisorPromptPack, domainReads, profile, proofThemes, seniorityRead }),
    roleTargetRead: readRoleTargetRead(profile),
    seniorityRead,
  };
}

function isProofBearingFact(fact: ProfileFact) {
  return ["experience", "project", "accolade", "credential"].includes(fact.fact_type);
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
      label: "Role evidence",
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

function readDomainSeniorityGaps({
  advisorPromptPack,
  domainReads,
  evidenceStrength,
  seniorityRead,
}: {
  advisorPromptPack: ProfileIntelligence["advisorPromptPack"];
  domainReads: DomainRead[];
  evidenceStrength: ProfileIntelligence["evidenceStrength"];
  seniorityRead: SeniorityRead;
}): ProfileIntelligence["highValueGaps"] {
  const gaps: ProfileIntelligence["highValueGaps"] = [];

  if (domainReads.length > 0 && advisorPromptPack.gentlePrompts[0]) {
    gaps.push({
      label: `${domainReads[0].label} evidence`,
      prompt: advisorPromptPack.gentlePrompts[0],
      severity: evidenceStrength === "thin" ? "critical" : "important",
    });
  }

  if (seniorityRead.level !== "unknown" && advisorPromptPack.gentlePrompts[1]) {
    gaps.push({
      label: `${seniorityRead.label} proof`,
      prompt: advisorPromptPack.gentlePrompts[1],
      severity: seniorityRead.confidence === "high" ? "important" : "informational",
    });
  }

  return gaps;
}

function readDomainReads(corpus: string): DomainRead[] {
  return domainPacks
    .map((pack) => {
      const evidenceTerms = pack.terms.filter((term) => containsTerm(corpus, term));
      return {
        confidence: readConfidence(evidenceTerms.length),
        evidenceTerms,
        gentlePrompts: pack.gentlePrompts,
        id: pack.id,
        label: pack.label,
        metricFamilies: pack.metricFamilies,
        resumeImplications: pack.resumeImplications,
      };
    })
    .filter((read) => read.evidenceTerms.length > 0)
    .sort((left, right) => right.evidenceTerms.length - left.evidenceTerms.length)
    .slice(0, 3);
}

function readSeniorityRead(corpus: string): SeniorityRead {
  const ranked = seniorityPacks
    .map((pack) => {
      const evidenceTerms = pack.terms.filter((term) => containsTerm(corpus, term));
      return {
        confidence: readConfidence(evidenceTerms.length),
        evidenceTerms,
        guidance: pack.guidance,
        label: pack.label,
        level: pack.level,
        resumeImplications: pack.resumeImplications,
      };
    })
    .filter((read) => read.evidenceTerms.length > 0)
    .sort((left, right) => {
      if (right.evidenceTerms.length !== left.evidenceTerms.length) {
        return right.evidenceTerms.length - left.evidenceTerms.length;
      }

      return seniorityRank(right.level) - seniorityRank(left.level);
    });

  return (
    ranked[0] ?? {
      confidence: "low",
      evidenceTerms: [],
      guidance:
        "Ask for role scope, seniority target, ownership, stakeholders, and measurable outcomes before over-calibrating the advice.",
      label: "seniority still unclear",
      level: "unknown",
      resumeImplications: [
        "Keep positioning cautious until title, scope, and target level are clear.",
      ],
    }
  );
}

function readAdvisorPromptPack(
  domainReads: DomainRead[],
  seniorityRead: SeniorityRead,
): ProfileIntelligence["advisorPromptPack"] {
  return {
    gentlePrompts: dedupe([
      ...domainReads.flatMap((read) => read.gentlePrompts),
      seniorityRead.guidance,
      ...seniorityRead.resumeImplications,
    ]).slice(0, 10),
    metricFamilies: dedupe(domainReads.flatMap((read) => read.metricFamilies)).slice(0, 12),
    resumeImplications: dedupe([
      ...domainReads.flatMap((read) => read.resumeImplications),
      ...seniorityRead.resumeImplications,
    ]).slice(0, 10),
  };
}

function containsTerm(corpus: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase();

  if (escaped.includes(" ") || escaped.includes("-") || escaped.includes("&")) {
    return corpus.includes(escaped);
  }

  return new RegExp(`\\b${escaped}\\b`, "i").test(corpus);
}

function readConfidence(matchCount: number): "low" | "medium" | "high" {
  if (matchCount >= 4) {
    return "high";
  }

  if (matchCount >= 2) {
    return "medium";
  }

  return "low";
}

function seniorityRank(level: SeniorityRead["level"]) {
  const ranks: Record<SeniorityRead["level"], number> = {
    board_advisory: 6,
    executive: 5,
    senior_leader: 4,
    manager: 3,
    individual_contributor: 2,
    early_career: 1,
    unknown: 0,
  };

  return ranks[level];
}

function readPositioningSignals({
  domainReads,
  facts,
  profile,
  proofThemes,
  seniorityRead,
}: {
  domainReads: DomainRead[];
  facts: ProfileFact[];
  profile: ProfileSnapshot;
  proofThemes: ProfileIntelligence["proofThemes"];
  seniorityRead: SeniorityRead;
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

  for (const domainRead of domainReads) {
    signals.add(domainRead.label);
  }

  if (seniorityRead.level !== "unknown") {
    signals.add(seniorityRead.label);
  }

  for (const fact of facts) {
    if (["industry", "skill", "credential"].includes(fact.fact_type)) {
      signals.add(cleanSignal(fact.fact_value));
    }
  }

  return Array.from(signals).filter(Boolean).slice(0, 10);
}

function readResumeFocus({
  advisorPromptPack,
  domainReads,
  proofThemes,
  profile,
  seniorityRead,
}: {
  advisorPromptPack: ProfileIntelligence["advisorPromptPack"];
  domainReads: DomainRead[];
  proofThemes: ProfileIntelligence["proofThemes"];
  profile: ProfileSnapshot;
  seniorityRead: SeniorityRead;
}) {
  const focus = [
    profile.target_direction ? `Position toward ${profile.target_direction}` : null,
    profile.target_level ? `Calibrate language for ${profile.target_level}` : null,
    domainReads[0] ? `Use ${domainReads[0].label} evidence prompts` : null,
    seniorityRead.level !== "unknown" ? `Adapt proof depth for ${seniorityRead.label}` : null,
    ...proofThemes.map((theme) => `Show ${theme.label.toLowerCase()}`),
    ...advisorPromptPack.resumeImplications.slice(0, 2),
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

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
