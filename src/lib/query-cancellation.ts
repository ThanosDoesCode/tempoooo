import { isCancelledError, type Query, type QueryClient } from "@tanstack/react-query";

const USER_SCOPED_QUERY_ROOTS = new Set([
  "authenticated-user",
  "bulk-memberships",
  "bulk-admin",
  "bulk-exercise-library",
  "bulk-training-plan-templates",
  "bulk-training-plan",
  "bulk-training-session",
  "bulk-training-sessions",
  "bulk-progression",
  "bulk-meal-presets",
  "admin-diagnostics",
  "challenge",
  "challenge-members",
  "challenge-activities",
  "challenge-travel-pauses",
  "challenge-weeks",
  "challenge-payments",
  "challenge-invitations",
]);

export function isExpectedQueryCancellation(error: unknown): boolean {
  return isCancelledError(error);
}

export function authenticatedUserChanged(
  previousUserId: string | null | undefined,
  nextUserId: string | null,
): boolean {
  return previousUserId !== undefined && previousUserId !== nextUserId;
}

function isUserScopedQuery(query: Query): boolean {
  const root = query.queryKey[0];
  return typeof root === "string" && USER_SCOPED_QUERY_ROOTS.has(root);
}

export async function resetUserScopedQueries(queryClient: QueryClient): Promise<void> {
  const filters = { predicate: isUserScopedQuery };
  await queryClient.cancelQueries(filters, { silent: true });
  await queryClient.resetQueries(filters);
}

export async function recoverChallengeRoute(
  navigate: (options: { to: "/challenge"; replace: true }) => Promise<unknown>,
  invalidate: () => Promise<unknown>,
): Promise<void> {
  await navigate({ to: "/challenge", replace: true });
  await invalidate();
}
