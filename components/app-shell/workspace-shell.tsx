import { WorkspaceLayout } from "@/components/app-shell/workspace-layout";
import { getOwnerMetrics } from "@/lib/admin/owner-metrics";
import { getApplicationOverview } from "@/lib/applications/application-overview";
import type { WorkspaceSession } from "@/lib/commands/session";
import { getConversationMessages } from "@/lib/conversation/conversation-messages";
import { getJobOverview } from "@/lib/jobs/job-overview";
import { getProfileOverview } from "@/lib/profile/profile-overview";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export async function WorkspaceShell({ session }: WorkspaceShellProps) {
  const [profileOverview, jobOverview, conversationMessages, applicationOverview, ownerMetrics] = await Promise.all([
    getProfileOverview(session.user.id),
    getJobOverview(session.user.id),
    getConversationMessages(session.user.id),
    getApplicationOverview(session.user.id),
    session.admin.roles.length > 0 ? getOwnerMetrics() : Promise.resolve(null),
  ]);

  return (
    <WorkspaceLayout
      applicationOverview={applicationOverview}
      conversationMessages={conversationMessages}
      jobOverview={jobOverview}
      ownerMetrics={ownerMetrics}
      profileOverview={profileOverview}
      session={session}
    />
  );
}
