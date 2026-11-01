import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";

/** One account action on Profile and Settings; auth owns device cleanup and sign-out. */
export function SignOutButton() {
  const navigate = useNavigate();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (await signOut({ onError: setError })) {
        await navigate({ to: "/auth", replace: true });
      } else {
        setError((message) => message ?? "Could not sign out. Please try again.");
      }
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => void leave()}
        className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
