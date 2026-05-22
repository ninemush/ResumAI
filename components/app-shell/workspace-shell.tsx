import { SideNav } from "@/components/app-shell/side-nav";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import type { WorkspaceSession } from "@/lib/commands/session";
import { getProfileOverview } from "@/lib/profile/profile-overview";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export async function WorkspaceShell({ session }: WorkspaceShellProps) {
  const profileOverview = await getProfileOverview(session.user.id);

  return (
    <div className="workspace-shell">
      <SideNav session={session} />
      <ProfileExplorer overview={profileOverview} userId={session.user.id} />
      <ConversationPanel userEmail={session.user.email} />
    </div>
  );
}
