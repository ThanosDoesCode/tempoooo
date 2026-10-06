import { ArrowLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Today is the visual source of truth for route and local-step Back controls. */
export const backControlClassName =
  "inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-elevated active:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function BackLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      {children}
    </>
  );
}

/** Local wizard/editor steps retain their own existing state transitions. */
export function BackButton({
  children = "Back",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={cn(backControlClassName, className)}>
      <BackLabel>{children}</BackLabel>
    </button>
  );
}
