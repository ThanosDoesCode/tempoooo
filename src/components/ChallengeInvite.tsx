import { useEffect, useState } from "react";
import { Search, Send } from "lucide-react";
import { Card, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { challengeUsernameError, normalizeUsername } from "@/lib/account-profile";
import {
  searchChallengeInviteUsers,
  sendChallengeUsernameInvitation,
} from "@/lib/privileged-rpcs.functions";

export function ChallengeInviteCard({ challengeId }: { challengeId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ username: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalized = normalizeUsername(query);

  useEffect(() => {
    if (normalized.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      void searchChallengeInviteUsers({ data: { challengeId, query: normalized } })
        .then(setResults)
        .catch(() => setError("Could not search usernames. Try again."))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [challengeId, normalized]);

  const send = async (username: string) => {
    if (sending) return;
    setSending(username);
    setError(null);
    setNotice(null);
    try {
      await sendChallengeUsernameInvitation({ data: { challengeId, username } });
      setNotice(`Invitation sent to @${username}.`);
      setQuery("");
      setResults([]);
    } catch (cause) {
      setError(challengeUsernameError(cause, username));
    } finally {
      setSending(null);
    }
  };

  return (
    <Card>
      <SectionTitle>Invite your opponent</SectionTitle>
      <p className="text-xs leading-5 text-muted-foreground">
        Search their Tempo username. They can accept securely from Profile.
      </p>
      <label className="relative mt-3 block">
        <span className="sr-only">Search Tempo username</span>
        <Search
          className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
          value={query}
          placeholder="Search username"
          onChange={(event) => setQuery(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-border bg-elevated py-2.5 pl-9 pr-3 text-sm outline-none focus:border-ring"
        />
      </label>
      {searching ? <p className="mt-2 text-xs text-muted-foreground">Searching…</p> : null}
      {!searching && normalized.length >= 2 && results.length === 0 && !error ? (
        <p className="mt-2 text-xs text-muted-foreground">No eligible usernames found.</p>
      ) : null}
      {results.length ? (
        <div className="mt-2 space-y-2" role="list" aria-label="Eligible Tempo users">
          {results.map(({ username }) => (
            <button
              key={username}
              type="button"
              disabled={sending !== null}
              onClick={() => void send(username)}
              className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-elevated px-3 text-left text-sm active:scale-[0.99] disabled:opacity-60"
            >
              <span className="font-semibold">@{username}</span>
              <span className="flex items-center gap-1 text-primary">
                {sending === username ? (
                  <PendingLabel>Sending</PendingLabel>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" /> Invite
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {notice ? (
        <p className="mt-2 text-xs text-good" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
