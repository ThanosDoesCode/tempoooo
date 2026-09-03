import { useEffect, useRef } from "react";

export function QueryCancellationRecovery({ onRecover }: { onRecover: () => void }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onRecover();
  }, [onRecover]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Restoring Tempo…
      </p>
    </main>
  );
}
