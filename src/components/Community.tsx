import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  changeCommunityRelationship,
  communityListOptions,
  communityPeople,
  communityProfileOptions,
  communitySearchOptions,
  normalizePeopleSearch,
  refreshCommunity,
  useCommunityCount,
  validPeopleSearch,
  type CommunityAction,
  type CommunityList,
  type CommunityPerson,
} from "@/lib/community-query";
import { MainPageHeader } from "./MainPageHeader";
import { HistoryBackLink } from "./HistoryBackLink";
import { DataError } from "./ui-kit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";

const secondaryButton =
  "min-h-11 rounded-xl border border-border bg-elevated px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const primaryButton = `${secondaryButton} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;

function Initials({ username }: { username: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-elevated text-sm font-semibold"
    >
      {username.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Each send token belongs to one explicit action and survives failures/retries only. */
export function CommunityActions({
  person,
  detail = false,
  blocked = false,
}: {
  person: CommunityPerson;
  detail?: boolean;
  blocked?: boolean;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [pending, setPending] = useState<CommunityAction | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "block" | "unblock" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [more, setMore] = useState(false);
  const confirmTrigger = useRef<HTMLButtonElement | null>(null);
  const ask = (action: "remove" | "block" | "unblock", trigger: HTMLButtonElement) => {
    confirmTrigger.current = trigger;
    setConfirm(action);
    setDialogOpen(true);
  };
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const sendToken = useRef<string | null>(null);
  const identity = useRef(`${user?.id}:${person.user_id}`);
  if (identity.current !== `${user?.id}:${person.user_id}`) {
    identity.current = `${user?.id}:${person.user_id}`;
    sendToken.current = null;
  }
  const run = async (action: CommunityAction) => {
    if (!user || busy.current) return;
    busy.current = true;
    setPending(action);
    setError(null);
    setMessage("");
    const actor = user.id;
    if (action === "send") sendToken.current ??= crypto.randomUUID();
    try {
      await changeCommunityRelationship(action, person, sendToken.current ?? undefined);
      sendToken.current = null;
      // The refreshed relationship owns “Request sent”: a reciprocal send or old retry
      // can legitimately resolve to an incoming request or a completed lifecycle instead.
      setMessage(
        action === "send" ? "" : action === "accept" ? "Friend request accepted" : "Updated",
      );
      await refreshCommunity(client, actor);
    } catch {
      setError("Could not update this connection. Refresh or try again.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
  const button = (label: string, action: CommunityAction, primary = false) => (
    <button
      type="button"
      disabled={pending !== null || !user}
      className={primary ? primaryButton : secondaryButton}
      onClick={() => void run(action)}
    >
      {pending === action ? "Updating…" : label}
    </button>
  );
  return (
    <div className="min-w-0 space-y-2" aria-busy={pending !== null}>
      <div className="flex flex-wrap items-center gap-2">
        {blocked ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={!!pending}
            onClick={(event) => ask("unblock", event.currentTarget)}
          >
            Unblock
          </button>
        ) : person.relationship_state === "none" ? (
          button("Add friend", "send", true)
        ) : person.relationship_state === "incoming_pending" ? (
          <>
            {button("Accept", "accept", true)}
            {button("Decline", "decline")}
          </>
        ) : person.relationship_state === "outgoing_pending" ? (
          <>
            <span className="text-sm text-muted-foreground">Request sent</span>
            {detail ? button("Cancel request", "cancel") : null}
          </>
        ) : (
          <span className="text-sm font-medium text-primary">Friends</span>
        )}
        {detail && !blocked ? (
          <button
            type="button"
            aria-label="Connection actions"
            aria-expanded={more}
            className={`${secondaryButton} grid w-11 place-items-center px-0`}
            onClick={() => setMore(!more)}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {detail && more ? (
        <div className="flex flex-wrap gap-2 rounded-xl bg-elevated p-2">
          {person.relationship_state === "friends" ? (
            <button
              type="button"
              className={secondaryButton}
              disabled={!!pending}
              onClick={(event) => ask("remove", event.currentTarget)}
            >
              Remove friend
            </button>
          ) : null}
          <button
            type="button"
            className={`${secondaryButton} text-destructive`}
            disabled={!!pending}
            onClick={(event) => ask("block", event.currentTarget)}
          >
            Block user
          </button>
        </div>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={message && !pending ? "text-xs text-muted-foreground" : "sr-only"}
      >
        {pending ? "Updating connection…" : message}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent
          className="w-[calc(100%-2rem)] max-w-sm gap-3 rounded-2xl p-5"
          onCloseAutoFocus={(event) => {
            if (confirmTrigger.current?.isConnected) {
              event.preventDefault();
              confirmTrigger.current.focus();
            }
          }}
        >
          <AlertDialogTitle>
            {confirm === "block"
              ? `Block @${person.username}?`
              : confirm === "unblock"
                ? `Unblock @${person.username}?`
                : `Remove @${person.username}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === "block"
              ? "You won’t appear in each other’s Community searches. Any request or friendship will end."
              : confirm === "unblock"
                ? "You can find each other again. Previous requests and friendships won’t be restored."
                : "You can send another friend request later."}
          </AlertDialogDescription>
          <div className="grid grid-cols-2 gap-2">
            <AlertDialogCancel className="m-0 min-h-11 rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const action = confirm;
                setDialogOpen(false);
                if (action) void run(action);
              }}
            >
              {confirm === "block" ? "Block" : confirm === "unblock" ? "Unblock" : "Remove"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CommunityPersonRow({
  person,
  actions = false,
  blocked = false,
}: {
  person: CommunityPerson;
  actions?: boolean;
  blocked?: boolean;
}) {
  const identity = (
    <>
      <Initials username={person.username} />
      <span className="min-w-0 break-all text-sm font-medium">@{person.username}</span>
    </>
  );
  return (
    <li className="space-y-2 border-b border-border py-3 last:border-0">
      {blocked ? (
        <div className="flex min-h-11 items-center gap-3">{identity}</div>
      ) : (
        <Link
          to="/community/$userId"
          params={{ userId: person.user_id }}
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {identity}
        </Link>
      )}
      {actions || blocked ? <CommunityActions person={person} blocked={blocked} /> : null}
    </li>
  );
}

export function CommunityListSection({ kind, title }: { kind: CommunityList; title: string }) {
  const { user } = useAuth();
  const query = useInfiniteQuery(communityListOptions(user?.id, kind));
  const people = communityPeople(query.data?.pages);
  if (query.isPending)
    return (
      <p role="status" className="py-3 text-sm text-muted-foreground">
        Loading {title.toLowerCase()}…
      </p>
    );
  if (query.isError)
    return (
      <DataError
        message={`Could not load ${title.toLowerCase()}.`}
        onRetry={() => void query.refetch()}
      />
    );
  if (!people.length && kind === "incoming") return null;
  return (
    <section className="min-w-0">
      <h2 className="text-base font-semibold">{title}</h2>
      {!people.length ? (
        <div className="py-4 text-sm text-muted-foreground">
          {kind === "friends" ? (
            <>
              <p className="font-medium text-foreground">No friends yet</p>
              <p className="mt-1">Search for people to add on Tempo.</p>
            </>
          ) : (
            "No people here yet"
          )}
        </div>
      ) : (
        <ul className="min-w-0">
          {people.map((person) => (
            <CommunityPersonRow
              key={person.user_id}
              person={person}
              actions={kind === "incoming" || kind === "outgoing"}
              blocked={kind === "blocked"}
            />
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <button
          type="button"
          className={`${secondaryButton} mt-2`}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

export function CommunityPage({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const { user } = useAuth();
  const [debounced, setDebounced] = useState(search);
  const [manage, setManage] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const results = useQuery(communitySearchOptions(user?.id, debounced));
  useCommunityCount(user?.id); // same key as the shell badge, not another fetch implementation
  const searching = search.trim().length > 0;
  const valid = validPeopleSearch(normalizePeopleSearch(search));
  return (
    <>
      <MainPageHeader title="Community" />
      <label htmlFor="community-search" className="mb-2 block text-sm font-medium">
        Search people
      </label>
      <input
        id="community-search"
        type="search"
        value={search}
        maxLength={21}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Search by username"
        onChange={(event) => onSearchChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-elevated px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-5 space-y-5">
        {searching ? (
          !valid ? (
            <p className="text-sm text-muted-foreground">
              Enter 2–20 letters, numbers or underscores.
            </p>
          ) : debounced !== search || results.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Searching…
            </p>
          ) : results.isError ? (
            <DataError message="Could not search people." onRetry={() => void results.refetch()} />
          ) : !results.data?.length ? (
            <p className="text-sm text-muted-foreground">No people found</p>
          ) : (
            <ul>
              {results.data.map((person) => (
                <CommunityPersonRow key={person.user_id} person={person} actions />
              ))}
            </ul>
          )
        ) : (
          <>
            <CommunityListSection kind="incoming" title="Friend requests" />
            <CommunityListSection kind="friends" title="Friends" />
            <button
              type="button"
              aria-expanded={manage}
              className={`${secondaryButton} text-muted-foreground`}
              onClick={() => setManage(!manage)}
            >
              Manage connections
            </button>
            {manage ? (
              <>
                <CommunityListSection kind="outgoing" title="Sent requests" />
                <CommunityListSection kind="blocked" title="Blocked people" />
              </>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

export function CommunityProfilePage({ userId }: { userId: string }) {
  const { user } = useAuth();
  const query = useQuery(communityProfileOptions(user?.id, userId));
  return (
    <>
      <HistoryBackLink fallback="/community" fallbackLabel="Community" />
      {query.isPending ? (
        <p role="status">Loading profile…</p>
      ) : query.isError ? (
        <DataError message="Could not load this person." onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <>
          <h1 className="text-2xl font-semibold">Person unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This Community profile isn’t available.
          </p>
        </>
      ) : (
        <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Initials username={query.data.username} />
            <h1 className="min-w-0 break-all text-xl font-semibold">@{query.data.username}</h1>
          </div>
          <CommunityActions key={`${user?.id}:${userId}`} person={query.data} detail />
        </section>
      )}
    </>
  );
}
