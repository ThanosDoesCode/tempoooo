import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearAccountScopedBrowserData } from "@/lib/browser-data";
import { readRetryDelay, shouldRetryRead } from "@/lib/network-errors";

export const authenticatedUserQueryOptions = () =>
  queryOptions({
    queryKey: ["authenticated-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error && !data.user && shouldRetryRead(0, error)) throw error;
      if (error && !data.user) {
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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
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
