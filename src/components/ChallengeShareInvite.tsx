import { useRef, useState } from "react";

/** Shares the Tempo entry point; invitation acceptance remains authenticated and username-based. */
export function ChallengeShareInvite({
  username,
  compact = false,
}: {
  username: string;
  compact?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const share = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNote(null);
    const url = window.location.origin;
    const text = `I've set up a Tempo challenge for us. Open Tempo to accept, @${username}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Tempo challenge", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Invite link copied");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setNote("Invite link copied");
      } catch {
        setNote("Couldn’t share the link. Try again.");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void share()}
        className="flex h-[52px] w-full items-center justify-center rounded-[16px] bg-primary text-base font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? "Sharing…" : compact ? "Share invite" : "Share invite link"}
      </button>
      {note ? (
        <p role="status" className="mt-2 text-[13px] text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}
