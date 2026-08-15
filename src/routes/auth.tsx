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

const SAVED_KEY = "saved-credentials";

/** Light obfuscation so the value is not plainly readable at a glance. */
const encode = (v: string) => btoa(unescape(encodeURIComponent(v)));
const decode = (v: string) => decodeURIComponent(escape(atob(v)));

function readSaved(): { email: string; password: string } | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(decode(raw)) as { email?: string; password?: string };
    if (!parsed.email || !parsed.password) return null;
    return { email: parsed.email, password: parsed.password };
  } catch {
    return null;
  }
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("last-email");
    if (saved) setEmail(saved);
    const stored = readSaved();
    if (stored) {
      setEmail(stored.email);
      setPassword(stored.password);
    }
    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        await syncProfile(data.session.user);
        const next = sessionStorage.getItem("post-auth-path");
        sessionStorage.removeItem("post-auth-path");
        window.location.href = next ?? "/";
        return;
      }
      // Saved on this device: sign in automatically, no typing needed.
      if (stored) {
        setBusy(true);
        const { error } = await supabase.auth.signInWithPassword(stored);
        setBusy(false);
        if (!error) {
          window.location.href = "/";
          return;
        }
        localStorage.removeItem(SAVED_KEY);
        setMsg("Saved password no longer works, please sign in again.");
        return;
      }
      // Otherwise ask the browser / keychain for a stored credential.
      try {
        const cred = (await navigator.credentials?.get({
          password: true,
          mediation: "optional",
        } as CredentialRequestOptions)) as (Credential & { id?: string; password?: string }) | null;
        if (cred?.id && cred.password) {
          setEmail(cred.id);
          setPassword(cred.password);
        }
      } catch {
        /* stored-credential retrieval is best-effort */
      }
    });
  }, []);

  /** Saves locally when asked, and lets the browser / keychain store it too. */
  const offerToSaveCredentials = async () => {
    localStorage.setItem("last-email", email);
    if (remember) {
      localStorage.setItem(SAVED_KEY, encode(JSON.stringify({ email, password })));
    } else {
      localStorage.removeItem(SAVED_KEY);
    }
    try {
      const C = (window as unknown as { PasswordCredential?: new (d: unknown) => Credential })
        .PasswordCredential;
      if (C && navigator.credentials?.store) {
        await navigator.credentials.store(new C({ id: email, password, name: email }));
      }
    } catch {
      /* credential storage is a best-effort browser feature */
    }
  };



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
      await offerToSaveCredentials();
      // small delay so the browser can show its save-password prompt
      setTimeout(() => {
        window.location.href = "/";
      }, 400);
    } else {
      await offerToSaveCredentials();
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Save password on this device
          </label>

          <button
            disabled={busy}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {msg ? <p className="mt-3 text-xs text-warn">{msg}</p> : null}

        <p className="mt-3 text-[11px] text-muted-foreground">
          With "Save password" on, this device signs you in automatically and you never type it
          again. Only enable it on a device you keep to yourself.
        </p>



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
