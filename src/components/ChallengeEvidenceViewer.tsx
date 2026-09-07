import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveEvidenceUrls, type EvidenceResolution } from "@/lib/challenge-evidence-viewer";
import { reportLovableError } from "@/lib/lovable-error-reporting";

const HISTORY_MARKER = "__tempoChallengeEvidenceViewer";

type ViewerState = { status: "idle" | "loading" } | EvidenceResolution;

/** Evidence screenshots are visible to both challenge members so neither can cheat. */
export function ChallengeEvidenceViewer({ paths, expired }: { paths: string[]; expired: boolean }) {
  const viewerId = useId();
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ViewerState>({ status: "idle" });
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());

  const closeLocally = () => {
    requestId.current += 1;
    setOpen(false);
  };

  const close = () => {
    const historyState = window.history.state as Record<string, unknown> | null;
    if (historyState?.[HISTORY_MARKER] === viewerId) {
      window.history.back();
      return;
    }
    closeLocally();
  };

  const load = async () => {
    const activeRequest = ++requestId.current;
    setFailedUrls(new Set());
    setState({ status: "loading" });
    try {
      const result = await resolveEvidenceUrls({
        paths,
        expired,
        sign: (storagePaths) =>
          supabase.storage.from("challenge-evidence").createSignedUrls(storagePaths, 300),
      });
      if (activeRequest !== requestId.current) return;
      if (result.status === "unavailable" && result.reason === "unexpected") {
        reportLovableError(result.cause, {
          boundary: "challenge_evidence_viewer",
          phase: "signed_url",
        });
      }
      setState(result);
    } catch (error) {
      if (activeRequest !== requestId.current) return;
      reportLovableError(error, {
        boundary: "challenge_evidence_viewer",
        phase: "local_recovery",
      });
      setState({ status: "unavailable", reason: "unexpected", cause: error });
    }
  };

  const show = () => {
    const currentState = window.history.state;
    const preservedState =
      currentState && typeof currentState === "object"
        ? (currentState as Record<string, unknown>)
        : {};
    window.history.pushState({ ...preservedState, [HISTORY_MARKER]: viewerId }, "");
    setOpen(true);
    void load();
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeFromViewerHistory = () => {
      requestId.current += 1;
      setOpen(false);
    };
    const onPopState = () => closeFromViewerHistory();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const historyState = window.history.state as Record<string, unknown> | null;
      if (historyState?.[HISTORY_MARKER] === viewerId) window.history.back();
      else closeFromViewerHistory();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, viewerId]);

  if (paths.length === 0) return null;

  const availableUrls =
    state.status === "ready" ? state.urls.filter((url) => !failedUrls.has(url)) : [];
  const allImagesFailed = state.status === "ready" && availableUrls.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={
          expired
            ? "View expired evidence status"
            : `View ${paths.length} evidence screenshot${paths.length > 1 ? "s" : ""}`
        }
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-2 font-medium text-muted-foreground hover:bg-elevated"
      >
        <ImageIcon className="h-3 w-3" aria-hidden="true" />
        {expired ? "Evidence expired after finalization" : "Evidence available"}
        {!expired && paths.length > 1 ? ` ${paths.length}` : ""}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Activity evidence"
              className="fixed inset-0 z-[100] flex min-h-dvh flex-col bg-black/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
            >
              <div className="flex min-h-11 shrink-0 items-center justify-end">
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close evidence"
                  autoFocus
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X className="h-5 w-5" aria-hidden="true" /> Close
                </button>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto py-4">
                {state.status === "loading" || state.status === "idle" ? (
                  <p role="status" className="text-sm text-white/70">
                    Loading evidence…
                  </p>
                ) : state.status === "expired" ? (
                  <p role="status" className="text-center text-sm font-medium text-white/80">
                    Evidence expired after finalization
                  </p>
                ) : state.status === "unavailable" || allImagesFailed ? (
                  <div className="text-center">
                    <p role="alert" className="text-sm font-medium text-white">
                      Evidence unavailable
                    </p>
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="mt-4 min-h-11 rounded-xl border border-white/25 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                    {availableUrls.map((url, index) => (
                      <img
                        key={url}
                        src={url}
                        alt={`Activity evidence screenshot ${index + 1}`}
                        onError={() =>
                          setFailedUrls((current) => {
                            const next = new Set(current);
                            next.add(url);
                            return next;
                          })
                        }
                        className="min-h-0 max-h-full max-w-full rounded-xl object-contain"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
