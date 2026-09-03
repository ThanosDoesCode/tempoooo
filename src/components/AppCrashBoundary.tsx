import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { isOffline } from "@/lib/network-errors";
import { isExpectedQueryCancellation } from "@/lib/query-cancellation";
import { QueryCancellationRecovery } from "@/components/QueryCancellationRecovery";

type Props = {
  children: ReactNode;
  onRetry: () => void;
  onChallengeHome: () => Promise<unknown>;
};

type State = { error: Error | null };

export class AppCrashBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (isExpectedQueryCancellation(error)) return;
    reportLovableError(error, {
      boundary: "app_component_error_boundary",
      componentStack: info.componentStack,
    });
  }

  private retry = () => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  private recoverCancellation = () => {
    this.props.onRetry();
    this.setState({ error: null });
  };

  private goToChallenge = () => {
    void this.props.onChallengeHome().then(
      () => this.setState({ error: null }),
      () => window.location.assign("/challenge"),
    );
  };

  override render() {
    if (!this.state.error) return this.props.children;
    if (isExpectedQueryCancellation(this.state.error)) {
      return <QueryCancellationRecovery onRecover={this.recoverCancellation} />;
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div role="alert" className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
          <h1 className="text-xl font-semibold text-foreground">Tempo hit a problem</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {isOffline()
              ? "You're offline. Reconnect, then retry. Any unsaved form data kept by the page remains on this device."
              : "This screen could not continue. Retry safely without signing out or reloading the PWA."}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={this.retry}
              className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.goToChallenge}
              className="flex min-h-11 items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground active:scale-[0.98]"
            >
              Challenge home
            </button>
          </div>
        </div>
      </main>
    );
  }
}
