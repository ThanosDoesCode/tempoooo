import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/challenge" });
  },
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
    ],
  }),
  component: WelcomePage,
});

function WelcomePage() {
  return (
    <main className="flex min-h-screen items-center bg-background px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <p className="text-sm font-bold tracking-tight text-primary">Tempo</p>
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
          Build consistency. See progress.
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          Create a running or cycling Challenge with someone else, track each week and keep each
          other accountable.
        </p>
        <ul className="mt-7 space-y-3 text-sm text-foreground">
          {[
            "Set a shared weekly target",
            "Track qualifying runs and rides",
            "Stay accountable with clear weekly outcomes",
            "Add optional fitness tools whenever you want",
          ].map((item) => (
            <li key={item} className="rounded-xl border border-border bg-card px-4 py-3">
              {item}
            </li>
          ))}
        </ul>
        <Link
          to="/auth"
          search={{ mode: "signup" }}
          className="mt-8 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground"
        >
          Get started
        </Link>
        <Link
          to="/auth"
          search={{ mode: "signin" }}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-muted-foreground"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
