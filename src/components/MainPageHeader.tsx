import type { ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";

/** One title/bell baseline for the four main tabs, with room for optional metadata. */
export function MainPageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header
      className={`fade-up mb-3.5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 ${children ? "min-[400px]:grid-cols-[minmax(0,1fr)_auto_auto]" : ""}`}
    >
      <div className="col-span-full min-h-5 break-words text-sm leading-5 text-muted-foreground">
        {eyebrow}
      </div>
      <h1 className="col-start-1 row-start-2 min-w-0 break-words py-1 text-[30px] font-semibold leading-9 tracking-tight">
        {title}
      </h1>
      <div className={`col-start-2 row-start-2 ${children ? "min-[400px]:col-start-3" : ""}`}>
        <NotificationBell />
      </div>
      {children ? (
        <div className="col-span-full row-start-3 mt-1 flex min-w-0 justify-end min-[400px]:col-span-1 min-[400px]:col-start-2 min-[400px]:row-start-2 min-[400px]:mt-0">
          {children}
        </div>
      ) : null}
    </header>
  );
}
