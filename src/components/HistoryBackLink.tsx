import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { backWithinApp } from "@/lib/in-app-back";

export function HistoryBackLink({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <Link
      to={fallback}
      preload="intent"
      className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-muted-foreground active:bg-elevated"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        if (backWithinApp(router.history)) event.preventDefault();
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
    </Link>
  );
}
