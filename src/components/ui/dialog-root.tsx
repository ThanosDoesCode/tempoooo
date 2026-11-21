import * as Primitive from "@radix-ui/react-dialog";
import { NavigationOverlay } from "../NavigationOverlay";
import type { ComponentProps } from "react";

export * from "@radix-ui/react-dialog";

export function Root({
  open,
  defaultOpen,
  onOpenChange,
  historyBack,
  dismissible,
  ...props
}: ComponentProps<typeof Primitive.Root> & { historyBack?: boolean; dismissible?: boolean }) {
  return (
    <NavigationOverlay
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      historyBack={historyBack}
      dismissible={dismissible}
    >
      {(state) => <Primitive.Root {...props} {...state} />}
    </NavigationOverlay>
  );
}
