import { Link } from "@tanstack/react-router";
import { CalendarCheck, Dumbbell, Home, LineChart } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Today", icon: Home },
  { to: "/training", label: "Training", icon: Dumbbell },
  { to: "/progress", label: "Progress", icon: LineChart },
  { to: "/check-in", label: "Check-In", icon: CalendarCheck },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-lg px-4 pb-28 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="group flex flex-col items-center gap-1 rounded-xl py-2 text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="text-[11px] font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="fade-up mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}
