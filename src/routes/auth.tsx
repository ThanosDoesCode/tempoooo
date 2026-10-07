import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { HistoryBackLink } from "@/components/HistoryBackLink";
import { useCallback, useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { syncProfile } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import {
  rememberDestination,
  sanitizeDestination,
  takeDestination,
} from "@/lib/pending-destination";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: "signin" | "signup"; redirect?: string } => {
    const mode =
      search["mode"] === "signup" || search["mode"] === "signin"
        ? (search["mode"] as "signin" | "signup")
        : undefined;
    const redirect = sanitizeDestination(
      typeof search["redirect"] === "string" ? search["redirect"] : null,
    );
    return { ...(mode ? { mode } : {}), ...(redirect ? { redirect } : {}) };
  },
  beforeLoad: async ({ search }) => {
    // Signed-in visitors (including a swipe back in the installed app) never see this screen.
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const destination = takeDestination(search.redirect ?? null);
    if (destination) throw redirect({ href: destination, replace: true });
    throw redirect({ to: "/today", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Tempo" },
      {
        name: "description",
        content: "Sign in to Tempo, your 52-week running and cycling challenge.",
      },
      { property: "og:title", content: "Sign in — Tempo" },
      {
        property: "og:description",
        content: "Build consistency through Tempo's 52-week running and cycling challenge.",
      },
    ],
  }),
  component: AuthPage,
});

type Notice = { kind: "error" | "success"; text: string };
type PendingAction = "password" | "google" | null;

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const goAfterAuth = useCallback(async () => {
    const destination = takeDestination(search.redirect ?? null);
    if (destination) {
      await navigate({ href: destination, replace: true });
      return;
    }
    await navigate({ to: "/today", replace: true });
  }, [navigate, search.redirect]);
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    // Remove credentials written by releases that predated browser-managed password saving.
    localStorage.removeItem("saved-credentials");
    if (search.redirect) rememberDestination(search.redirect);
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) return;
      try {
        await syncProfile(data.session.user);
        await goAfterAuth();
      } catch (error) {
        setNotice({ kind: "error", text: userFacingError(error, "restore your account") });
      }
    });
  }, [goAfterAuth, search.redirect]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending("password");
    setNotice(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth` },
          });
    const { data, error } = await fn;
    setPending(null);
    if (error) {
      setNotice({
        kind: "error",
        text: userFacingError(error, mode === "signin" ? "sign in" : "create your account"),
      });
      return;
    }
    if (data.user && data.session) {
      try {
        await syncProfile(data.user);
        await goAfterAuth();
      } catch (error) {
        setNotice({ kind: "error", text: userFacingError(error, "finish signing in") });
      }
    } else {
      setPassword("");
      setNotice({
        kind: "success",
        text: `We sent a confirmation link to ${email}. Open it to verify your email, then return here to sign in.`,
      });
    }
  };

  const continueWithGoogle = async () => {
    setPending("google");
    setNotice(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth`,
        extraParams: { prompt: "select_account" },
      });
      if (result.redirected) return;
      if (result.error) throw result.error;

      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error ?? new Error("google_session_missing");
      await syncProfile(data.user);
      await goAfterAuth();
    } catch (error) {
      setNotice({
        kind: "error",
        text: userFacingError(error, "continue with Google"),
      });
      setPending(null);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <HistoryBackLink fallback="/" fallbackLabel="Tempo" />
        <p className="mt-4 text-sm font-semibold text-primary">Tempo</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {mode === "signin"
            ? "Sign in to pick up where you left off."
            : "Start with a Challenge. Add fitness tools when you're ready."}
        </p>

        <button
          type="button"
          onClick={() => void continueWithGoogle()}
          disabled={pending !== null}
          className="account-secondary mt-6"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
            <path
              fill="currentColor"
              d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
            />
            <path
              fill="currentColor"
              d="M12 22c2.7 0 4.98-.9 6.64-2.36l-3.24-2.54c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
              opacity=".82"
            />
            <path
              fill="currentColor"
              d="M6.39 13.93A6.01 6.01 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"
              opacity=".65"
            />
            <path
              fill="currentColor"
              d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
              opacity=".92"
            />
          </svg>
          {pending === "google" ? "Connecting to Google…" : "Continue with Google"}
        </button>

        <div className="my-5 flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>Or use email</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} method="post" className="space-y-3">
          <label htmlFor="auth-email" className="sr-only">
            Email address
          </label>
          <input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="account-input"
          />
          <label htmlFor="auth-password" className="sr-only">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            name="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="account-input"
          />
          <button disabled={pending !== null} className="account-primary">
            {pending === "password"
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {notice ? (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mt-4 rounded-xl border p-3 text-sm ${
              notice.kind === "success"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-warn/40 bg-warn/10 text-warn"
            }`}
          >
            {notice.kind === "success" ? (
              <p className="mb-1 font-semibold">Check your email to finish signing up</p>
            ) : null}
            <p>{notice.text}</p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setNotice(null);
          }}
          disabled={pending !== null}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl px-3 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
