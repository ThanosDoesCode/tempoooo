import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { communityBadgeLabel, useCommunityCount } from "@/lib/community-query";

/** Non-blocking shell read. Shared with Community; never part of authenticated/Today loaders. */
export function CommunityBadge() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const { data: count = 0 } = useCommunityCount(user?.id, mounted);
  if (!count) return null;
  return (
    <span
      id="community-request-count"
      role="status"
      aria-live="polite"
      aria-label={`${count > 9 ? "9 or more" : count} incoming friend requests`}
      className="absolute -right-2 -top-1 rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground"
    >
      {communityBadgeLabel(count)}
    </span>
  );
}
