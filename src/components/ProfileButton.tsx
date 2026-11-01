import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAccountProfile } from "@/lib/account-profile";
import { preferredBulkMembership, useMemberships } from "@/lib/bulk-access";
import { useGoalDiscovery } from "@/lib/goal-discovery";

/** Account entry beside Notifications: the real OAuth avatar when one exists, otherwise initials. */
export function ProfileButton() {
  const { user } = useAuth();
  const profile = useAccountProfile(user?.id).data;
  const { data: memberships } = useMemberships();
  const discovery = useGoalDiscovery();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatar = avatarFailed ? null : (profile?.avatar_url ?? null);
  const initials = (profile?.username ?? user?.email ?? "").slice(0, 2).toUpperCase();
  // Challenge-only accounts that haven't seen Fitness tools keep the dot the old You tab carried.
  const showNew =
    !preferredBulkMembership(memberships) &&
    discovery.isSuccess &&
    discovery.data?.goal_seen_at == null;

  return (
    <Link
      to="/profile"
      aria-label="Profile"
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
    >
      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-elevated text-[12px] font-semibold text-foreground">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initials
        )}
      </span>
      {showNew ? (
        <span
          aria-label="New Fitness tools"
          className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </Link>
  );
}
