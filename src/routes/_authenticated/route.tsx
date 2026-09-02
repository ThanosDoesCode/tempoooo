import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authenticatedUserQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(authenticatedUserQueryOptions());
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: () => <Outlet />,
});
