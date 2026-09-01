import { isUuid } from "../_shared/challenge-push.ts";
import { adminClient, oneSignal } from "../_shared/push-store.ts";

Deno.serve(async (request: Request) => {
  const origin = Deno.env.get("CHALLENGE_PUSH_SITE_URL") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (request.headers.get("origin") && request.headers.get("origin") !== origin)
    return reply({ error: "Forbidden" }, 403);
  try {
    const db = adminClient();
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return reply({ error: "Not authenticated" }, 401);
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user) return reply({ error: "Not authenticated" }, 401);
    const uid = auth.data.user.id;
    if (Number(request.headers.get("content-length")) > 2048)
      return reply({ error: "Invalid request" }, 400);
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: "Invalid request" }, 400);
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || !["identity", "register", "status", "detach"].includes(String(body["action"])))
      return reply({ error: "Invalid request" }, 400);
    const id = body["subscription_id"];
    if (body["action"] !== "identity" && !isUuid(id))
      return reply({ error: "Invalid subscription" }, 400);
    // Own-device cleanup remains possible after leaving a challenge.
    if (body["action"] === "detach") {
      const result = await db
        .from("push_subscriptions")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("user_id", uid)
        .eq("subscription_id", id);
      if (result.error) throw new Error("database_failed");
      return reply({ ok: true });
    }
    const member = await db.from("challenge_members").select("id").eq("user_id", uid).limit(1);
    if (member.error) throw new Error("database_failed");
    if (!member.data?.length) return reply({ error: "Challenge membership required" }, 403);
    const created = await db
      .from("challenge_push_users")
      .upsert({ user_id: uid }, { onConflict: "user_id", ignoreDuplicates: true });
    if (created.error) throw new Error("database_failed");
    const identity = await db
      .from("challenge_push_users")
      .select("external_id,enabled")
      .eq("user_id", uid)
      .single();
    if (identity.error) throw new Error("database_failed");
    if (body["action"] === "identity") return reply(identity.data);
    if (body["action"] === "status") {
      const device = await db
        .from("push_subscriptions")
        .select("is_active")
        .eq("user_id", uid)
        .eq("subscription_id", id)
        .maybeSingle();
      if (device.error) throw new Error("database_failed");
      return reply({ enabled: identity.data.enabled && device.data?.is_active === true });
    }
    // Only an explicit enable action may undo an account-wide opt-out.
    const activate = body["activate"] === true;
    if (!activate && !identity.data.enabled) return reply({ enabled: false });
    const verified = await oneSignal().subscriptions(identity.data.external_id);
    if (!verified.includes(id as string))
      return reply({ error: "Device not verified yet. Please try again." }, 409);
    const saved = await db.rpc("register_challenge_push_device", {
      _user: uid,
      _subscription: id,
      _external_id: identity.data.external_id,
      _activate: activate,
    });
    if (saved.error) throw new Error("database_failed");
    return reply({ enabled: saved.data === true });
  } catch {
    return reply({ error: "Could not update notifications. Please try again." }, 503);
  }
});
