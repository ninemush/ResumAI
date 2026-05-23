import { WorkspaceLayout } from "@/components/app-shell/workspace-layout";
import { getApplicationOverview } from "@/lib/applications/application-overview";
import type { WorkspaceSession } from "@/lib/commands/session";
import { getConversationMessages } from "@/lib/conversation/conversation-messages";
import { getJobOverview } from "@/lib/jobs/job-overview";
import { getProfileOverview } from "@/lib/profile/profile-overview";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export async function WorkspaceShell({ session }: WorkspaceShellProps) {
  const [profileOverview, jobOverview, conversationMessages, applicationOverview] = await Promise.all([
    getProfileOverview(session.user.id),
    getJobOverview(session.user.id),
    getConversationMessages(session.user.id),
    getApplicationOverview(session.user.id),
  ]);

  return (
    <WorkspaceLayout
      applicationOverview={applicationOverview}
      conversationMessages={conversationMessages}
      jobOverview={jobOverview}
      profileOverview={profileOverview}
      session={session}
    />
  );
}
