export type BulkModeMembership = {
  bulk_profile_id: string;
  role: "owner" | "editor" | "viewer";
  is_public: boolean;
  is_active: boolean;
};

export const activeBulkMemberships = <T extends BulkModeMembership>(memberships: T[] | undefined) =>
  memberships?.filter((membership) => membership.is_active !== false) ?? [];

/** Public Goal wins deterministically; a legacy-only owner keeps historical mode. */
export const preferredBulkMembership = <T extends BulkModeMembership>(
  memberships: T[] | undefined,
) => {
  const active = activeBulkMemberships(memberships).filter(
    (membership) => membership.role === "owner",
  );
  return active.find((membership) => membership.is_public) ?? active[0] ?? null;
};

export type AccountProductMode = "core" | "public" | "legacy";

export const accountProductMode = (
  memberships: BulkModeMembership[] | undefined,
): AccountProductMode => {
  const preferred = preferredBulkMembership(memberships);
  if (!preferred) return "core";
  return preferred.is_public ? "public" : "legacy";
};
