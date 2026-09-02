import { supabaseAdmin } from "@/integrations/supabase/client.server";

type RelatedProfile = { id: string; display_name: string | null; email: string | null };

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const client = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export const acceptChallengeInvitationFor = (caller: string, email: string, token: string) =>
  rpc<string>("accept_challenge_invitation", { _caller: caller, _email: email, _token: token });

export const finalizeChallengeFor = (caller: string, challenge: string) =>
  rpc<number>("finalize_challenge", { _caller: caller, _c: challenge });

export const relatedProfilesFor = (caller: string) =>
  rpc<RelatedProfile[]>("related_profiles", { _caller: caller });
