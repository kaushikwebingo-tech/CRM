import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useSchema, SchemaProvider } from '@/hooks/use-schema';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/error-boundary';

function AppLayoutContent(): JSX.Element {
  const { isLoading, isRefreshing, error, schema } = useSchema();
  const location = useLocation();

  // Guardrail 17: no blocking spinner on a route that has cached data. The
  // bundle is seeded from localStorage, so a reload renders the shell
  // immediately and revalidates behind a quiet indicator.
  if (isLoading) {
    return (
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <div className="w-60 border-r border-slate-200 bg-white p-4 space-y-3">
          <Skeleton className="h-8 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error && !schema) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-gray-50 text-center">
        <h2 className="text-base font-semibold text-slate-900">Could not load your workspace</h2>
        <p className="max-w-sm text-sm text-slate-500">{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        {isRefreshing && (
          <div className="h-0.5 w-full overflow-hidden bg-blue-100">
            <div className="h-full w-1/3 animate-pulse bg-blue-500" />
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function AppLayout(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SchemaProvider>
      <AppLayoutContent />
    </SchemaProvider>
  );
}
