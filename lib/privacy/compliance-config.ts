import { brand } from "@/lib/brand";

export type ComplianceItemStatus = "missing" | "draft" | "configured" | "approved";

export type SubprocessorConfig = {
  crossBorderTransferBasis: string;
  dataCategories: string[];
  dpaStatus: ComplianceItemStatus;
  hostingRegion: string;
  name: string;
  processingPurpose: string;
  status: ComplianceItemStatus;
};

export const publicPolicyPaths = {
  aiUse: "/ai-use",
  dataRetention: "/data-retention",
  privacy: "/privacy",
  security: "/security",
  subprocessors: "/subprocessors",
} as const;

export const subprocessorConfig: SubprocessorConfig[] = [
  {
    crossBorderTransferBasis: "Placeholder pending legal review.",
    dataCategories: ["account metadata", "profile and resume data", "application data", "storage objects"],
    dpaStatus: "draft",
    hostingRegion: "Supabase project region must be confirmed before launch.",
    name: "Supabase",
    processingPurpose: "Authentication, database, private storage, and operational audit records.",
    status: "configured",
  },
  {
    crossBorderTransferBasis: "Placeholder pending legal review.",
    dataCategories: ["account metadata", "application telemetry", "server logs"],
    dpaStatus: "draft",
    hostingRegion: "Vercel deployment region must be confirmed before launch.",
    name: "Vercel",
    processingPurpose: "Application hosting, serverless route execution, and deployment operations.",
    status: "configured",
  },
  {
    crossBorderTransferBasis: "Placeholder pending legal review.",
    dataCategories: ["profile text", "job text", "generated resume and cover letter content"],
    dpaStatus: "draft",
    hostingRegion: "AI processing region and retention posture must be confirmed before launch.",
    name: "OpenAI",
    processingPurpose: "Assistive profile analysis, role recommendations, and generated application materials.",
    status: "configured",
  },
  {
    crossBorderTransferBasis: "Placeholder pending legal review.",
    dataCategories: ["account identifier", "purchase and credit entitlement metadata"],
    dpaStatus: "missing",
    hostingRegion: "Payment entitlement region must be confirmed before launch.",
    name: "RevenueCat",
    processingPurpose: "Credit purchase entitlement processing and webhook-based ledger grants.",
    status: "draft",
  },
];

export const retentionPolicyConfig = [
  {
    dataCategory: "Editable profile drafts, profile facts, and uploaded sources",
    retentionRule: "User-controlled while account is active; deletion requests receive review for deletion or minimization.",
    status: "draft" as ComplianceItemStatus,
  },
  {
    dataCategory: "Generated master resumes and non-submitted drafts",
    retentionRule: "Deletable when no quota, dispute, or audit dependency requires retention.",
    status: "draft" as ComplianceItemStatus,
  },
  {
    dataCategory: "Application records, quota events, credit ledger, and billing evidence",
    retentionRule: "Retain minimal audit-safe evidence for quota, fraud, accounting, and dispute handling.",
    status: "draft" as ComplianceItemStatus,
  },
  {
    dataCategory: "Security incidents, audit events, and admin notes",
    retentionRule: "Retain for security operations, incident response, abuse prevention, and future audit evidence.",
    status: "draft" as ComplianceItemStatus,
  },
];

export const complianceHardeningChecklist = [
  { item: "Legal review of public policies and request handling", status: "missing" as ComplianceItemStatus },
  { item: "Final data retention schedule approved by owner and counsel", status: "missing" as ComplianceItemStatus },
  { item: "DPA and subprocessor review completed", status: "draft" as ComplianceItemStatus },
  { item: "Hosting and processing regions confirmed", status: "missing" as ComplianceItemStatus },
  { item: "Cross-border transfer basis documented", status: "missing" as ComplianceItemStatus },
  { item: "Breach response owner and escalation rota assigned", status: "draft" as ComplianceItemStatus },
  { item: "Durable distributed rate limiting selected for production", status: "draft" as ComplianceItemStatus },
  { item: "Admin access review cadence scheduled", status: "draft" as ComplianceItemStatus },
];

export const aiUseNotices = [
  `${brand.name} uses AI to draft and organize career materials, not to make employment decisions.`,
  "AI outputs can be incomplete or inaccurate and should be reviewed before use outside the app.",
  "Profile, resume, job, and application text may be sent to AI providers only when needed for the requested workflow.",
  "Users can request review of AI-assisted processing through the Privacy Center.",
];
