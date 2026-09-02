import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const acceptChallengeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ token: z.string().min(32).max(256) }).parse(data))
  .handler(async ({ data, context }) => {
    const email = typeof context.claims.email === "string" ? context.claims.email : "";
    const { acceptChallengeInvitationFor } = await import("./privileged-rpcs.server");
    return acceptChallengeInvitationFor(context.userId, email, data.token);
  });

export const finalizeChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ challenge: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { finalizeChallengeFor } = await import("./privileged-rpcs.server");
    return finalizeChallengeFor(context.userId, data.challenge);
  });

export const getRelatedProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { relatedProfilesFor } = await import("./privileged-rpcs.server");
    return relatedProfilesFor(context.userId);
  });
