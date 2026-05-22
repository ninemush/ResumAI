import {
  BriefcaseBusiness,
  FileText,
  Layers3,
  Settings,
  Shield,
  UserRound,
} from "lucide-react";

import type { WorkspaceSession } from "@/lib/commands/session";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { brand, getBrandInitials } from "@/lib/brand";

const primaryItems = [
  { label: "Profile", icon: UserRound, active: true },
  { label: "Resume", icon: FileText, active: false },
  { label: "Applications", icon: BriefcaseBusiness, active: false },
  { label: "Artifacts", icon: Layers3, active: false },
  { label: "Settings", icon: Settings, active: false },
];

type SideNavProps = {
  session: WorkspaceSession;
};

export function SideNav({ session }: SideNavProps) {
  return (
    <aside className="side-nav" aria-label="Workspace navigation">
      <div className="side-nav-header">
        <div className="brand-mark small" aria-hidden="true">
          {getBrandInitials()}
        </div>
        <div>
          <strong>{brand.name}</strong>
          <span>{brand.category}</span>
        </div>
      </div>

      <nav className="nav-list">
        {primaryItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              aria-current={item.active ? "page" : undefined}
              className={item.active ? "nav-item active" : "nav-item"}
              key={item.label}
              type="button"
            >
              <Icon size={18} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}

        {session.admin.isOwner ? (
          <button className="nav-item" type="button">
            <Shield size={18} aria-hidden="true" />
            Owner Console
          </button>
        ) : null}
      </nav>

      <div className="side-nav-footer">
        <span>{session.user.email ?? "Signed in"}</span>
        <SignOutButton />
      </div>
    </aside>
  );
}
