import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    className={cn(
      "peer group relative inline-flex h-11 min-h-11 w-[52px] shrink-0 cursor-pointer items-center rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    {/* The 32px visual track sits inside a 44px touch target, including on coarse pointers. */}
    <span
      aria-hidden="true"
      data-slot="switch-track"
      className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-full bg-input transition-colors group-data-[state=checked]:bg-primary motion-reduce:transition-none"
    />
    <SwitchPrimitives.Thumb
      aria-hidden="true"
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none relative block size-7 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-[2px] motion-reduce:transition-none",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
