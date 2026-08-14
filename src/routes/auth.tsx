import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncProfile } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Lean Bulk Tracker" },
      {
        name: "description",
        content:
          "Sign in to your private lean bulk tracker and your two-person running and cycling challenge.",
      },
      { property: "og:title", content: "Sign in — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "Private bulk tracking and a 52-week endurance challenge.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        await syncProfile(data.session.user);
        const next = sessionStorage.getItem("post-auth-path");
        sessionStorage.removeItem("post-auth-path");
        window.location.href = next ?? "/";
      }
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth` },
          });
    const { data, error } = await fn;
    setBusy(false);
    if (error) return setMsg(error.message);
    if (data.user && data.session) {
      await syncProfile(data.user);
      window.location.href = "/";
    } else {
      setMsg("Check your email to confirm your account, then sign in.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Lean Bulk Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Private bulk tracking and your 52-week endurance challenge.
        </p>

        <form onSubmit={submit} method="post" className="space-y-3">
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-border bg-elevated px-3 py-3 text-sm outline-none"
          />
          <input
            type="password"
            name="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl border border-border bg-elevated px-3 py-3 text-sm outline-none"
          />

          <button
            disabled={busy}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {msg ? <p className="mt-3 text-xs text-warn">{msg}</p> : null}

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-xs text-muted-foreground"
        >
          {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
