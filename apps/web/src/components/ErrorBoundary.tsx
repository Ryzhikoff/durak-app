import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level error boundary. Catches render-time errors in the React subtree
 * and renders a minimal fallback so the user doesn't see a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep noise low — log to console in dev for triage.
    // Production telemetry can be wired up later.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught error', error, info);
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-xl">
          <h1 className="mb-2 text-xl font-semibold">Что-то пошло не так</h1>
          <p className="mb-4 text-sm text-textMuted">
            Произошла непредвиденная ошибка. Перезагрузите страницу.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-base font-medium text-accentText hover:bg-accentHover"
          >
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}
