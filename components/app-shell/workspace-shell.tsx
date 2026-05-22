import { SideNav } from "@/components/app-shell/side-nav";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { JobIngestionPanel } from "@/components/jobs/job-ingestion-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import type { WorkspaceSession } from "@/lib/commands/session";
import { getJobOverview } from "@/lib/jobs/job-overview";
import { getProfileOverview } from "@/lib/profile/profile-overview";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export async function WorkspaceShell({ session }: WorkspaceShellProps) {
  const [profileOverview, jobOverview] = await Promise.all([
    getProfileOverview(session.user.id),
    getJobOverview(session.user.id),
  ]);

  return (
    <div className="workspace-shell">
      <SideNav session={session} />
      <div className="workspace-main">
        <ProfileExplorer overview={profileOverview} userId={session.user.id} />
        <JobIngestionPanel overview={jobOverview} />
      </div>
      <ConversationPanel userEmail={session.user.email} />
    </div>
  );
}
