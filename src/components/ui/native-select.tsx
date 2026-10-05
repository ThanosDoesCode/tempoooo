import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type NativeSelectProps = React.ComponentPropsWithoutRef<"select"> & {
  containerClassName?: string;
};

/** Keep native keyboard/mobile selection, with one consistently inset indicator. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <span className={cn("relative block min-w-0", containerClassName)}>
      <select
        ref={ref}
        {...props}
        className={cn(
          "rounded-xl border border-input bg-card text-base text-foreground",
          className,
          "block min-h-11 w-full min-w-0 appearance-none bg-none pl-4 pr-12",
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="control-chevron pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  ),
);
NativeSelect.displayName = "NativeSelect";
