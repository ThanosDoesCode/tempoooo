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

export const ensureBulkProfileFor = (caller: string) =>
  rpc<string>("ensure_bulk_profile", { _caller: caller });

export const setBulkEditorFor = (caller: string, bulk: string, user: string, editor: boolean) =>
  rpc<void>("set_bulk_editor", { _caller: caller, _bulk: bulk, _user: user, _editor: editor });

export const acceptBulkInvitationFor = (caller: string, email: string, token: string) =>
  rpc<string>("accept_bulk_invitation", { _caller: caller, _email: email, _token: token });

export const acceptChallengeInvitationFor = (caller: string, email: string, token: string) =>
  rpc<string>("accept_challenge_invitation", { _caller: caller, _email: email, _token: token });

export const finalizeChallengeFor = (caller: string, challenge: string) =>
  rpc<number>("finalize_challenge", { _caller: caller, _c: challenge });

export const relatedProfilesFor = (caller: string) =>
  rpc<RelatedProfile[]>("related_profiles", { _caller: caller });
