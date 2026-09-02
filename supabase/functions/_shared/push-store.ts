import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  OneSignal,
  opponent,
  type PushEvent,
  type PushStore,
  type Outcome,
} from "./challenge-push.ts";

export function environment(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error("push_configuration_missing");
  return value;
}
export function adminClient() {
  return createClient(environment("SUPABASE_URL"), environment("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function oneSignal() {
  const site = new URL(environment("CHALLENGE_PUSH_SITE_URL"));
  if (site.protocol !== "https:" && site.hostname !== "localhost")
    throw new Error("invalid_site_url");
  return new OneSignal(
    environment("ONESIGNAL_APP_ID"),
    environment("ONESIGNAL_REST_API_KEY"),
    site.origin,
  );
}
export function databaseStore(db: ReturnType<typeof adminClient>): PushStore {
  return {
    async audience(event) {
      const members = await db
        .from("challenge_members")
        .select("id,user_id,challenge_id")
        .eq("challenge_id", event.challenge_id);
      if (members.error) throw new Error("database_failed");
      const other = opponent(event, members.data ?? []);
      if (!other) return { members: members.data ?? [], user: null, devices: [], name: null };
      const [user, devices, profile] = await Promise.all([
        db
          .from("challenge_push_users")
          .select("user_id,external_id,enabled")
          .eq("user_id", other.user_id)
          .maybeSingle(),
        db
          .from("push_subscriptions")
          .select("user_id,subscription_id,is_active")
          .eq("user_id", other.user_id)
          .eq("provider", "onesignal")
          .eq("is_active", true),
        db.from("profiles").select("display_name").eq("id", event.actor_id).maybeSingle(),
      ]);
      if (user.error || devices.error || profile.error) throw new Error("database_failed");
      return {
        members: members.data ?? [],
        user: user.data,
        devices: devices.data ?? [],
        name: profile.data?.display_name ?? null,
      };
    },
    async freezeDevices(event, ids) {
      const result = await db
        .from("challenge_notification_events")
        .update({ subscription_ids: event.subscription_ids ?? ids })
        .eq("id", event.id)
        .eq("lease_token", event.lease_token)
        .eq("status", "processing")
        .select("id");
      if (result.error || result.data?.length !== 1) throw new Error("lease_lost");
    },
    async finish(event: PushEvent, status: Outcome, code: string | null, messageId?: string) {
      const result = await db
        .from("challenge_notification_events")
        .update({
          status,
          last_error: code,
          provider_message_id: messageId ?? null,
          lease_until: null,
          lease_token: null,
          next_attempt_at: new Date(
            Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** (event.attempts - 1)),
          ).toISOString(),
          finished_at: status === "pending" ? null : new Date().toISOString(),
        })
        .eq("id", event.id)
        .eq("lease_token", event.lease_token);
      if (result.error) throw new Error("database_failed");
    },
  };
}
