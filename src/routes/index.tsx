import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/today", replace: true });
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
    <main className="min-h-svh bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-md flex-col">
        <p className="text-2xl font-semibold tracking-tight text-primary">Tempo</p>
        <div className="my-auto py-12">
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            Keep each other moving.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            A weekly running and cycling challenge with a friend, with something at stake. Track
            workouts, meals and weight too, if you want.
          </p>
        </div>
        <Link to="/auth" search={{ mode: "signup" }} className="account-primary">
          Create account
        </Link>
        <Link to="/auth" search={{ mode: "signin" }} className="account-secondary mt-3">
          I already have an account
        </Link>
      </div>
    </main>
  );
}
