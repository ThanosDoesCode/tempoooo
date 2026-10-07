import { Link, useLocation } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useChallengeInvitations } from "@/lib/challenge-invitations";

const MAIN_HEADERS = new Set([
  "/bulk",
  "/today",
  "/challenge",
  "/bulk/progress",
  "/progress",
  "/profile",
  "/you",
]);

/** Actionable account events, separate from browser/push notification settings. */
export function NotificationBell() {
  const { pathname } = useLocation();
  const invitations = useChallengeInvitations();
  if (!MAIN_HEADERS.has(pathname.replace(/\/$/, ""))) return null;
  const count = invitations.data?.length ?? 0;
  return (
    <Link
      to="/notifications"
      preload="intent"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-elevated"
    >
      <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-background"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
