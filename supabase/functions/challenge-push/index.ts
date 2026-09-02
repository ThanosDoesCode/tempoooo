import { authorizedDispatcher, deliverEvent, type PushEvent } from "../_shared/challenge-push.ts";
import { adminClient, databaseStore, oneSignal } from "../_shared/push-store.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (
    !(await authorizedDispatcher(request, Deno.env.get("CHALLENGE_PUSH_DISPATCH_SECRET") ?? ""))
  ) {
    return new Response(null, { status: 401 });
  }
  // No client-supplied event, recipient, title or body is ever accepted.
  try {
    const provider = oneSignal();
    const db = adminClient();
    const result = await db.rpc("claim_challenge_push_events");
    if (result.error) throw new Error("claim_failed");
    const store = databaseStore(db);
    const counts: Record<string, number> = {};
    for (const event of (result.data ?? []) as PushEvent[]) {
      const status = await deliverEvent(event, store, provider);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return Response.json({ processed: result.data?.length ?? 0, counts });
  } catch {
    console.error("Challenge push worker failed");
    return Response.json({ error: "Push delivery unavailable" }, { status: 503 });
  }
});
