import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearAccountScopedBrowserData } from "@/lib/browser-data";
import { readRetryDelay, shouldRetryRead, errorStatus } from "@/lib/network-errors";

import { withStartupDeadline } from "@/lib/startup";

export function isInvalidSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { name?: string; code?: string };
  return (
    details.name === "AuthSessionMissingError" ||
    errorStatus(error) === 401 ||
    (errorStatus(error) === 400 &&
      [
        "bad_jwt",
        "session_not_found",
        "user_not_found",
        "refresh_token_not_found",
        "refresh_token_already_used",
      ].includes(details.code ?? ""))
  );
}

export const authenticatedUserQueryOptions = () =>
  queryOptions({
    queryKey: ["authenticated-user"],
    queryFn: async () => {
      // Three attempts plus backoff fit inside the route's existing 10s deadline.
      const { data, error } = await withStartupDeadline(
        supabase.auth.getUser(),
        "authentication",
        undefined,
        2500,
      );
      if (error && !data.user && isInvalidSessionError(error)) {
        await supabase.auth.signOut({ scope: "local" });
        return null;
      }
      if (error) throw error;
      return data.user;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: shouldRetryRead,
    retryDelay: readRetryDelay,
  });

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let authEventReceived = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      authEventReceived = true;
      if (!alive) return;
      setSession(s);
      setReady(true);
    });
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive || authEventReceived || error) return;
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        /* The authenticated route owns bounded retry/recovery UI. */
      });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, ready };
}

/** Keeps public.profiles in sync with the signed-in account. */
export async function syncProfile(user: User) {
  const name =
    (user.user_metadata?.["full_name"] as string | undefined) ??
    (user.user_metadata?.["name"] as string | undefined) ??
    user.email?.split("@")[0] ??
    "Athlete";
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    display_name: name,
    avatar_url: (user.user_metadata?.["avatar_url"] as string | undefined) ?? null,
  });
  if (error) throw error;
}

export async function signOut() {
  const { detachChallengePush } = await import("./challenge-push");
  try {
    await detachChallengePush();
  } catch {
    window.alert(
      "Could not safely disconnect this device's notifications. Please retry signing out when connected.",
    );
    return false;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    window.alert("Could not sign out. Please check your connection and try again.");
    return false;
  }
  clearAccountScopedBrowserData();
  return true;
}

export async function clearDeletedAccountSession() {
  await supabase.auth.signOut({ scope: "local" });
  clearAccountScopedBrowserData();
}

export async function sha256Hex(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
