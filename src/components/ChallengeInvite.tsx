import { useState } from "react";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { randomToken, sha256Hex } from "@/lib/auth";
import {
  challengeUsernameError,
  normalizeUsername,
  usernameValidationError,
} from "@/lib/account-profile";
import { createChallengeInvitation } from "@/lib/privileged-rpcs.functions";

type Invitation = {
  id: string;
  invited_username_snapshot: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

function usePendingInvites(challengeId: string | undefined) {
  return useQuery({
    enabled: !!challengeId,
    queryKey: ["challenge-invitations", challengeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenge_invitations")
        .select("id, invited_username_snapshot, expires_at, accepted_at, revoked_at")
        .eq("challenge_id", challengeId!)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });
}

/**
 * Invitation tokens are only stored hashed, so an old link can never be shown again.
 * Regenerating replaces every pending invitation with a single fresh one.
 */
export function ChallengeInviteCard({ challengeId }: { challengeId: string }) {
  const { data: pending, isLoading, error: loadError, refetch } = usePendingInvites(challengeId);
  const [username, setUsername] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = pending?.[0];
  const target = normalizeUsername(username || current?.invited_username_snapshot || "");

  const generate = async () => {
    const validationError = usernameValidationError(target);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = randomToken();
      await createChallengeInvitation({
        data: {
          challengeId,
          username: target,
          tokenHash: await sha256Hex(token),
        },
      });
      setLink(`${window.location.origin}/invite/challenge/${token}`);
      await refetch();
      setNotice("Invitation link created.");
    } catch (e) {
      setError(challengeUsernameError(e, target));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the link. Select and copy it manually.");
    }
  };

  return (
    <Card>
      <SectionTitle>Invite your opponent</SectionTitle>
      {isLoading ? (
        <div className="h-8 animate-pulse rounded-lg bg-elevated" aria-label="Loading invitation" />
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs">
          <p className="text-danger">Could not load the current invitation.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 min-h-11 rounded-lg border border-danger/40 px-3 py-2 font-semibold text-danger"
          >
            Try again
          </button>
        </div>
      ) : current ? (
        <p className="text-xs text-muted-foreground">
          Pending invitation for{" "}
          <span className="font-medium text-foreground">
            @{current.invited_username_snapshot ?? "Tempo user"}
          </span>
          , expires {new Date(current.expires_at).toLocaleDateString()}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">No pending invitation right now.</p>
      )}

      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
          Username
        </span>
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
          value={username}
          placeholder={current?.invited_username_snapshot ?? "Search username"}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none focus:border-ring"
        />
      </label>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy || !!usernameValidationError(target)}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {!busy && (link ? <RefreshCw className="h-4 w-4" /> : <Link2 className="h-4 w-4" />)}
        {busy ? (
          <PendingLabel>Creating invitation…</PendingLabel>
        ) : link ? (
          "Create a new link"
        ) : (
          "Create invitation link"
        )}
      </button>

      {link ? (
        <div className="mt-3 space-y-2">
          <p className="break-all rounded-xl border border-border bg-elevated p-3 text-xs">
            {link}
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium"
          >
            <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-xs text-good">
          {notice}
        </p>
      ) : null}
      <div className="mt-2">
        <Note>
          The link is shown once for security. Creating a new one cancels any earlier link, only the
          invited username can accept it, and it stops working once your opponent joins.
        </Note>
      </div>
    </Card>
  );
}
