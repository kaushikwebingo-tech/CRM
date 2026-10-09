import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel, e.g. to keep a crash inside one cell. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Remounting the subtree when this changes clears a stale error. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Stops one bad value from blanking the whole application.
 *
 * Everything this UI renders comes from metadata and from record data, so a
 * field type missing from the registry, a select value that is not in its
 * options, or a number column holding a string is a render-time throw — and
 * without a boundary React unmounts the entire tree and the user sees a white
 * screen with no way back. There was no boundary anywhere in the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Render error:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-rose-200 bg-rose-50/40 p-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">This section could not be shown</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            {error.message || 'An unexpected error occurred while rendering.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={this.reset}>
            Try again
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    );
  }
}

/** Keeps a single table cell's failure inside that cell. */
export function CellBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={() => <span className="text-xs text-rose-500">—</span>}>
      {children}
    </ErrorBoundary>
  );
}
