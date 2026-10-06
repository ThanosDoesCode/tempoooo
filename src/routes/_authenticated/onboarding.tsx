import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Salad, Target, Trophy, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackControl";
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

type Availability = "idle" | "checking" | "available" | "taken" | "unavailable";

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
    let active = true;
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability({ data: { username: normalized } })
        .then((available) => {
          if (active) setAvailability(available ? "available" : "taken");
        })
        .catch(() => {
          if (active) setAvailability("unavailable");
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
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
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] max-w-md flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="mb-6 flex min-h-11 items-center justify-between gap-3">
          {step > 0 && !establishedNeedsUsername ? (
            <BackButton
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(step === 2 ? 1 : 0);
              }}
            />
          ) : (
            <span className="text-sm font-semibold text-primary">Tempo</span>
          )}
          <p className="text-[13px] text-muted-foreground">
            {establishedNeedsUsername ? "Your profile" : `Account setup · ${step + 1} of 3`}
          </p>
        </div>
        {step === 0 ? (
          <section className="flex flex-1 flex-col">
            <p className="text-sm font-semibold text-primary">Welcome to Tempo</p>
            <h1 className="mt-2 text-[30px] font-semibold tracking-tight">
              Stay consistent together.
            </h1>
            <p className="mt-3 leading-7 text-muted-foreground">
              Stay consistent with someone else. Create a Challenge, track your activity and keep
              each other accountable.
            </p>
            <div className="flex-1 min-h-8" />
            <button onClick={() => setStep(1)} className={primaryButton}>
              Continue
            </button>
          </section>
        ) : step === 1 ? (
          <form
            className="flex flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void continueFromUsername();
            }}
          >
            <h1 className="text-[30px] font-semibold tracking-tight">Pick a username</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Friends use your username to invite you to Challenges.
            </p>
            <label className="mt-6 block">
              <span className="mb-2 block text-[13px] text-muted-foreground">Username</span>
              <div className="flex min-h-13 items-center rounded-[14px] border border-border bg-elevated px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <span className="text-muted-foreground">@</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={21}
                  disabled={busy}
                  aria-invalid={!!validationError || availability === "taken"}
                  aria-describedby="username-status"
                  placeholder="your_username"
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base font-medium outline-none"
                />
              </div>
            </label>
            <p
              id="username-status"
              aria-live="polite"
              className="mt-3 min-h-10 text-[13px] leading-5"
            >
              {validationError ? (
                <span className="text-warn">{validationError}</span>
              ) : availability === "checking" ? (
                <span className="text-muted-foreground">Checking…</span>
              ) : availability === "available" ? (
                <span className="text-good">@{normalized} is available</span>
              ) : availability === "taken" ? (
                <span className="text-warn">@{normalized} is already taken</span>
              ) : availability === "unavailable" ? (
                <span className="text-warn">
                  Availability couldn't be checked. Continue to retry.
                </span>
              ) : (
                <span className="text-muted-foreground">3–20 letters, numbers or underscores.</span>
              )}
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-warn">
                {error}
              </p>
            ) : null}
            <div className="flex-1 min-h-8" />
            <button
              type="submit"
              disabled={busy || !normalized || !!validationError || availability === "taken"}
              className={primaryButton}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        ) : (
          <section className="flex flex-1 flex-col">
            <h1 className="text-[30px] font-semibold tracking-tight">Tempo</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Build consistency across your training, nutrition and challenges.
            </p>
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
            {error ? (
              <p role="alert" className="mt-3 text-sm text-warn">
                {error}
              </p>
            ) : null}
            <div className="flex-1 min-h-6" />
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
    <div className="flex gap-3 rounded-[20px] bg-card p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

const primaryButton = "account-primary mt-6";
