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

export const previewChallengeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ token: z.string().min(32).max(256) }).parse(data))
  .handler(async ({ data, context }) => {
    const email = typeof context.claims.email === "string" ? context.claims.email : "";
    const { previewChallengeInvitationFor } = await import("./privileged-rpcs.server");
    return previewChallengeInvitationFor(context.userId, email, data.token);
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

export const getAdminDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { adminDiagnosticsFor } = await import("./privileged-rpcs.server");
    return adminDiagnosticsFor(context.userId);
  });

const usernameInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/);

export const checkUsernameAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ username: usernameInput }).parse(data))
  .handler(async ({ data, context }) => {
    const { usernameAvailableFor } = await import("./privileged-rpcs.server");
    return usernameAvailableFor(context.userId, data.username);
  });

export const saveAccountUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ username: usernameInput, completeOnboarding: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { setAccountUsernameFor } = await import("./privileged-rpcs.server");
    return setAccountUsernameFor(context.userId, data.username, data.completeOnboarding);
  });

export const createChallengeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        challengeId: z.string().uuid(),
        username: usernameInput,
        tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { createChallengeInvitationFor } = await import("./privileged-rpcs.server");
    return createChallengeInvitationFor(context.userId, data);
  });

const createChallengeInput = z.object({
  requestId: z.string().uuid(),
  name: z.string().min(1).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).max(100),
  durationWeeks: z.number().int().min(52).max(520),
  invitedUsername: usernameInput,
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  weeklyTargetKm: z.number().min(1).max(500),
  penaltyMode: z.enum(["money", "custom"]),
  penaltyHighEur: z.number().min(0).max(1000),
  penaltyMediumEur: z.number().min(0).max(1000),
  penaltyLowEur: z.number().min(0).max(1000),
  penaltyHighCustom: z.string().max(160).nullable(),
  penaltyMediumCustom: z.string().max(160).nullable(),
  penaltyLowCustom: z.string().max(160).nullable(),
  travelPauseEnabled: z.boolean(),
  travelPauseHomeCountries: z.array(z.string().min(2).max(2)).max(12),
});

export const createChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createChallengeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { createChallengeFor } = await import("./privileged-rpcs.server");
    return createChallengeFor(context.userId, data);
  });

export const disableChallengePushAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { disableChallengePushFor } = await import("./privileged-rpcs.server");
    await disableChallengePushFor(context.userId);
    return { ok: true };
  });

export const setChallengeWeekTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        challenge: z.string().uuid(),
        weekNumber: z.number().int().min(1).max(520),
        targetKm: z.number().min(1).max(500).multipleOf(0.01).nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { setChallengeWeekTargetFor } = await import("./privileged-rpcs.server");
    return setChallengeWeekTargetFor(context.userId, data);
  });
