import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toast';
import { ErrorBoundary } from '@/components/error-boundary';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import { AppLayout } from '@/components/layout/app-layout';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginPage } from '@/pages/login';
import { Dashboard } from '@/pages/dashboard';
import { ModuleList } from '@/pages/module-list';

/**
 * Route-level code splitting.
 *
 * Plan Section 14 budgets 180 KB gzipped for the initial bundle, with a 250 KB
 * ceiling; a single chunk with every settings screen in it came to 334 KB. The
 * screens a salesperson uses all day — the list and the record — stay in the
 * main chunk; the admin screens, which are large and rarely opened, load on
 * demand.
 */
const RecordDetail = lazy(() =>
  import('@/pages/record-detail').then((m) => ({ default: m.RecordDetail })),
);
const SettingsModulesPage = lazy(() =>
  import('@/pages/settings-modules').then((m) => ({ default: m.SettingsModulesPage })),
);
const ModuleBuilderPage = lazy(() =>
  import('@/pages/module-builder').then((m) => ({ default: m.ModuleBuilderPage })),
);
const SettingsRolesPage = lazy(() =>
  import('@/pages/settings-roles').then((m) => ({ default: m.SettingsRolesPage })),
);
const SettingsUsersPage = lazy(() =>
  import('@/pages/settings-users').then((m) => ({ default: m.SettingsUsersPage })),
);
const SettingsAutomationsPage = lazy(() =>
  import('@/pages/settings-automations').then((m) => ({ default: m.SettingsAutomationsPage })),
);

/** A layout-shaped placeholder, so a lazy route does not shift the page. */
function RouteFallback(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Plan Section 11: the schema bundle is "revalidated with the ETag on
      // focus". The browser handles the conditional request; a 304 is cheap.
      refetchOnWindowFocus: true,
    },
  },
});

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <Toaster>
          <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="m/:moduleKey" element={<ModuleList />} />
              <Route path="m/:moduleKey/:recordId" element={<RecordDetail />} />
              <Route path="m/:moduleKey/detail/:recordId" element={<RecordDetail />} />
              <Route path="settings/modules" element={<SettingsModulesPage />} />
              <Route path="settings/modules/:moduleKey" element={<ModuleBuilderPage />} />
              <Route path="settings/roles" element={<SettingsRolesPage />} />
              <Route path="settings/users" element={<SettingsUsersPage />} />
              <Route path="settings/automations" element={<SettingsAutomationsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </Suspense>
        </BrowserRouter>
      </Toaster>
    </ConfirmDialogProvider>
      </QueryClientProvider>
    </ErrorBoundary>
);
}
