import { PageSkeleton } from "./components/PageSkeleton";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { readRetryDelay, shouldRetryRead } from "./lib/network-errors";
import { trackInAppHistory } from "./lib/in-app-back";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: shouldRetryRead,
        retryDelay: readRetryDelay,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPendingComponent: PageSkeleton,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });

  trackInAppHistory(router.history);
  return router;
};
