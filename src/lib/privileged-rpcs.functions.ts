import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ensureBulkProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureBulkProfileFor } = await import("./privileged-rpcs.server");
    return ensureBulkProfileFor(context.userId);
  });

export const setBulkEditor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ bulk: z.string().uuid(), user: z.string().uuid(), editor: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { setBulkEditorFor } = await import("./privileged-rpcs.server");
    return setBulkEditorFor(context.userId, data.bulk, data.user, data.editor);
  });

export const acceptBulkInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ token: z.string().min(32).max(256) }).parse(data))
  .handler(async ({ data, context }) => {
    const email = typeof context.claims.email === "string" ? context.claims.email : "";
    const { acceptBulkInvitationFor } = await import("./privileged-rpcs.server");
    return acceptBulkInvitationFor(context.userId, email, data.token);
  });

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
