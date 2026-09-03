import { operationalLog } from "./observability.ts";

export type PushEvent = {
  id: string;
  challenge_id: string;
  actor_id: string;
  actor_membership_id: string;
  opponent_membership_id: string;
  kind: "activity_posted" | "target_reached" | "week_penalty" | "payment_paid";
  facts: Record<string, unknown>;
  attempts: number;
  lease_token: string;
  subscription_ids: string[] | null;
};
export type Member = { id: string; user_id: string; challenge_id: string };
export type PushUser = { user_id: string; external_id: string; enabled: boolean };
export type Device = { subscription_id: string; user_id: string; is_active: boolean };
export type Audience = {
  members: Member[];
  user: PushUser | null;
  devices: Device[];
  name: string | null;
};
export type Outcome = "sent" | "skipped" | "pending" | "failed";
export interface PushStore {
  audience(event: PushEvent): Promise<Audience>;
  freezeDevices(event: PushEvent, ids: string[]): Promise<void>;
  finish(event: PushEvent, status: Outcome, code: string | null, messageId?: string): Promise<void>;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function opponent(event: PushEvent, members: Member[]): Member | undefined {
  if (members.length !== 2 || members.some((m) => m.challenge_id !== event.challenge_id)) return;
  if (!members.some((m) => m.id === event.actor_membership_id && m.user_id === event.actor_id))
    return;
  return members.find((m) => m.id === event.opponent_membership_id && m.user_id !== event.actor_id);
}

function number(facts: Record<string, unknown>, key: string): string {
  const n = Number(facts[key]);
  if (!Number.isFinite(n) || n < 0) throw new Error("invalid_event");
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(n);
}

export function notificationText(event: PushEvent, displayName: string | null) {
  // Never fall back to an email, and never include notes, evidence or resource IDs.
  const name =
    displayName
      ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .split(/\s+/)[0]
      ?.slice(0, 40) || "Your opponent";
  const facts = event.facts;
  switch (event.kind) {
    case "activity_posted":
      return {
        title: "New challenge activity 🏃",
        body:
          facts["activity_type"] === "cycle"
            ? `${name} logged a ${number(facts, "distance_km")} km ride, worth ${number(facts, "equivalent_km")} equivalent km.`
            : `${name} logged a ${number(facts, "distance_km")} km run and is now at ${number(facts, "total_km")} / ${number(facts, "target_km")} km this week.`,
      };
    case "target_reached":
      return {
        title: "Weekly target completed ✅",
        body: `${name} reached ${number(facts, "target_km")} km for this week.`,
      };
    case "week_penalty":
      return {
        title: "Weekly result finalized",
        body: `${name} finished the week with a €${number(facts, "amount_eur")} penalty.`,
      };
    case "payment_paid":
      return {
        title: "Payment marked as paid",
        body: `${name} marked a €${number(facts, "amount_eur")} payment as paid.`,
      };
    default:
      throw new Error("invalid_event");
  }
}

export class ProviderError extends Error {
  status: number;
  constructor(status: number) {
    super(`provider_http_${status}`);
    this.status = status;
  }
}
type ProviderSubscription = { id: string; type: string; enabled: boolean };
type ProviderUser = { identity?: { external_id?: string }; subscriptions?: ProviderSubscription[] };

export class OneSignal {
  private appId: string;
  private apiKey: string;
  private siteUrl: string;
  private request: typeof fetch;
  constructor(appId: string, apiKey: string, siteUrl: string, request: typeof fetch = fetch) {
    this.appId = appId;
    this.apiKey = apiKey;
    this.siteUrl = siteUrl;
    this.request = request;
  }

  async subscriptions(externalId: string): Promise<string[]> {
    const response = await this.request(
      `https://api.onesignal.com/apps/${this.appId}/users/by/external_id/${encodeURIComponent(externalId)}`,
      {
        headers: { Authorization: `Key ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) return [];
    if (!response.ok) throw new ProviderError(response.status);
    const user = (await response.json()) as ProviderUser;
    if (user.identity?.external_id !== externalId) return [];
    return (user.subscriptions ?? [])
      .filter(
        (s) =>
          s.enabled &&
          isUuid(s.id) &&
          ["ChromePush", "FirefoxPush", "SafariPush", "SafariLegacyPush"].includes(s.type),
      )
      .map((s) => s.id);
  }

  async send(event: PushEvent, ids: string[], name: string | null): Promise<string | null> {
    if (!ids.length) throw new Error("empty_audience");
    const text = notificationText(event, name);
    const response = await this.request("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.appId,
        include_subscription_ids: ids,
        target_channel: "push",
        headings: { en: text.title },
        contents: { en: text.body },
        url: new URL("/challenge", this.siteUrl).href,
        chrome_web_icon: new URL("/icons/challenge-notification.png", this.siteUrl).href,
        idempotency_key: event.id,
        // Limit lock-screen exposure and stale delivery after membership changes.
        ttl: 300,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ProviderError(response.status);
    const result = (await response.json()) as { id?: string };
    return isUuid(result.id) ? result.id : null; // 200 + no ID means no delivery.
  }
}

function allowedDevices(event: PushEvent, audience: Audience): string[] {
  const other = opponent(event, audience.members);
  if (!other || !audience.user?.enabled || audience.user.user_id !== other.user_id) return [];
  return audience.devices
    .filter(
      (d) =>
        d.user_id === other.user_id &&
        d.is_active &&
        (!event.subscription_ids || event.subscription_ids.includes(d.subscription_id)),
    )
    .map((d) => d.subscription_id);
}

export async function deliverEvent(
  event: PushEvent,
  store: PushStore,
  provider: OneSignal,
): Promise<Outcome> {
  try {
    const audience = await store.audience(event);
    const candidates = allowedDevices(event, audience);
    if (!candidates.length || !audience.user) {
      await store.finish(event, "skipped", "no_eligible_recipient");
      return "skipped";
    }
    // A browser can change OneSignal identity after registration. Verify again.
    const verified = await provider.subscriptions(audience.user.external_id);
    // Refresh membership and account/device opt-outs immediately before sending.
    const fresh = await store.audience(event);
    const allowed = allowedDevices(event, fresh);
    const ids = candidates.filter((id) => verified.includes(id) && allowed.includes(id));
    if (!ids.length || fresh.user?.external_id !== audience.user.external_id) {
      await store.finish(event, "skipped", "device_or_membership_changed");
      return "skipped";
    }
    // Persist before calling provider; timeouts/crashes reuse both audience and key.
    await store.freezeDevices(event, ids);
    const messageId = await provider.send(event, ids, fresh.name);
    const result = messageId ? "sent" : "skipped";
    await store.finish(
      event,
      result,
      messageId ? null : "provider_no_recipients",
      messageId ?? undefined,
    );
    return result;
  } catch (error) {
    const permanent =
      error instanceof ProviderError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429;
    const status = permanent || event.attempts >= 8 ? "failed" : "pending";
    const code = error instanceof ProviderError ? error.message : "delivery_failed";
    await store.finish(event, status, code);
    // No provider body, tokens, names, challenge IDs or notification content in logs.
    operationalLog(status === "failed" ? "error" : "warn", "challenge_push_delivery", {
      eventId: event.id,
      eventKind: event.kind,
      attempt: event.attempts,
      outcome: status,
      code,
    });
    return status;
  }
}

export async function authorizedDispatcher(request: Request, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("x-challenge-push-secret") ?? "";
  const hash = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(header), hash(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
