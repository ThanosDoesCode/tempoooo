import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Salad, Target, Trophy, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  normalizeUsername,
  useAccountProfile,
  usernameValidationError,
} from "@/lib/account-profile";
import { checkUsernameAvailability, saveAccountUsername } from "@/lib/privileged-rpcs.functions";
import { takeDestination } from "@/lib/pending-destination";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: AccountOnboarding,
});

type Availability = "idle" | "checking" | "available" | "taken";

function AccountOnboarding() {
  const { user } = useAuth();
  const profile = useAccountProfile(user?.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const establishedNeedsUsername = !!profile.data?.account_onboarded_at && !profile.data.username;
  const [step, setStep] = useState<0 | 1 | 2>(establishedNeedsUsername ? 1 : 0);
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completing = useRef(false);
  const normalized = normalizeUsername(username);
  const validationError = username ? usernameValidationError(username) : null;

  useEffect(() => {
    if (!completing.current && profile.data?.account_onboarded_at && profile.data.username) {
      const destination = takeDestination();
      void (destination
        ? navigate({ href: destination, replace: true })
        : navigate({ to: "/challenge", replace: true }));
    } else if (establishedNeedsUsername) {
      setStep(1);
    }
  }, [establishedNeedsUsername, navigate, profile.data]);

  useEffect(() => {
    if (!username || validationError) {
      setAvailability("idle");
      return;
    }
    setAvailability("checking");
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability({ data: { username: normalized } })
        .then((available) => setAvailability(available ? "available" : "taken"))
        .catch(() => setAvailability("idle"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [normalized, username, validationError]);

  const continueFromUsername = async () => {
    if (validationError || !normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      const available = await checkUsernameAvailability({ data: { username: normalized } });
      if (!available) {
        setAvailability("taken");
        return;
      }
      setAvailability("available");
      if (establishedNeedsUsername) {
        await finish();
      } else {
        setStep(2);
      }
    } catch {
      setError("We couldn't check that username. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    completing.current = true;
    setBusy(true);
    setError(null);
    try {
      await saveAccountUsername({
        data: { username: normalized, completeOnboarding: true },
      });
      await queryClient.invalidateQueries({ queryKey: ["account-profile", user?.id] });
      const destination = takeDestination();
      if (destination) {
        await navigate({ href: destination, replace: true });
      } else {
        await navigate({ to: "/challenge", replace: true });
      }
    } catch (cause) {
      completing.current = false;
      const message = cause instanceof Error ? cause.message : "";
      setError(
        /taken|unique/i.test(message)
          ? "That username is already taken."
          : "We couldn't save your username. Try again.",
      );
      setAvailability(/taken|unique/i.test(message) ? "taken" : "idle");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center py-8">
        {step === 0 ? (
          <section>
            <p className="text-sm font-semibold text-primary">Welcome to Tempo</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Stay consistent together.
            </h1>
            <p className="mt-3 leading-7 text-muted-foreground">
              Stay consistent with someone else. Create a Challenge, track your activity and keep
              each other accountable.
            </p>
            <button onClick={() => setStep(1)} className={primaryButton}>
              Continue
            </button>
          </section>
        ) : step === 1 ? (
          <section>
            <p className="text-sm font-semibold text-primary">Choose your username</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">How friends find you</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Friends use your username to invite you to Challenges.
            </p>
            <label className="mt-5 block">
              <span className="sr-only">Username</span>
              <div className="flex min-h-12 items-center rounded-xl border border-border bg-elevated px-3 focus-within:border-primary">
                <span className="text-muted-foreground">@</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={21}
                  placeholder="thanosxnt"
                  className="min-w-0 flex-1 bg-transparent px-1 py-3 outline-none"
                />
              </div>
            </label>
            <p aria-live="polite" className="mt-2 min-h-5 text-xs">
              {validationError ? (
                <span className="text-danger">{validationError}</span>
              ) : availability === "checking" ? (
                <span className="text-muted-foreground">Checking…</span>
              ) : availability === "available" ? (
                <span className="text-good">@{normalized} is available</span>
              ) : availability === "taken" ? (
                <span className="text-danger">@{normalized} is already taken</span>
              ) : null}
            </p>
            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
            <button
              disabled={busy || !normalized || !!validationError || availability === "taken"}
              onClick={() => void continueFromUsername()}
              className={primaryButton}
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </section>
        ) : (
          <section>
            <p className="text-sm font-semibold text-primary">Tempo</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Build consistency across your training, nutrition and challenges.
            </h1>
            <div className="mt-5 space-y-2">
              <FeatureRow icon={Trophy} title="Challenge">
                Set a weekly running or cycling target with someone else.
              </FeatureRow>
              <FeatureRow icon={Dumbbell} title="Training">
                Plan workouts, log sets and track your strength progress.
              </FeatureRow>
              <FeatureRow icon={Salad} title="Meals">
                Track calories and macros and save meals you use often.
              </FeatureRow>
              <FeatureRow icon={Target} title="Goal">
                Choose Bulk or Cut when you&apos;re ready and Tempo will help set your targets.
              </FeatureRow>
            </div>
            {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
            <button disabled={busy} onClick={() => void finish()} className={primaryButton}>
              {busy ? "Entering…" : "Enter Tempo"}
            </button>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-card p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

const primaryButton =
  "mt-6 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50";
