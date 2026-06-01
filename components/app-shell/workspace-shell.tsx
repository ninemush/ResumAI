import { WorkspaceLayout } from "@/components/app-shell/workspace-layout";
import { getOwnerMetrics } from "@/lib/admin/owner-metrics";
import { getApplicationOverview } from "@/lib/applications/application-overview";
import { getArtifactOverview } from "@/lib/artifacts/artifact-overview";
import { getCreditSummary } from "@/lib/billing/credits";
import type { WorkspaceSession } from "@/lib/commands/session";
import { getConversationMessages } from "@/lib/conversation/conversation-messages";
import { getJobOverview } from "@/lib/jobs/job-overview";
import { getProfileOverview } from "@/lib/profile/profile-overview";
import { getMasterResumeOverview } from "@/lib/resumes/master-resume";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export async function WorkspaceShell({ session }: WorkspaceShellProps) {
  const [
    profileOverview,
    jobOverview,
    conversationMessages,
    applicationOverview,
    artifactOverview,
    masterResumeOverview,
    ownerMetrics,
    creditSummary,
  ] = await Promise.all([
    getProfileOverview(session.user.id),
    getJobOverview(session.user.id),
    getConversationMessages(session.user.id),
    getApplicationOverview(session.user.id),
    getArtifactOverview(session.user.id),
    getMasterResumeOverview(session.user.id),
    session.admin.roles.length > 0 ? getOwnerMetrics() : Promise.resolve(null),
    getCreditSummary(),
  ]);

  return (
    <WorkspaceLayout
      applicationOverview={applicationOverview}
      artifactOverview={artifactOverview}
      conversationMessages={conversationMessages}
      creditSummary={creditSummary}
      jobOverview={jobOverview}
      masterResumeOverview={masterResumeOverview}
      ownerMetrics={ownerMetrics}
      profileOverview={profileOverview}
      session={session}
    />
  );
}
