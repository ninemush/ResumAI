import { SideNav } from "@/components/app-shell/side-nav";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import type { WorkspaceSession } from "@/lib/commands/session";

type WorkspaceShellProps = {
  session: WorkspaceSession;
};

export function WorkspaceShell({ session }: WorkspaceShellProps) {
  return (
    <div className="workspace-shell">
      <SideNav session={session} />
      <ProfileExplorer />
      <ConversationPanel userEmail={session.user.email} />
    </div>
  );
}
