import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toast';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/pages/login';
import { Dashboard } from '@/pages/dashboard';
import { ModuleList } from '@/pages/module-list';
import { RecordDetail } from '@/pages/record-detail';
import { SettingsAutomationsPage } from '@/pages/settings-automations';
import { SettingsModulesPage } from '@/pages/settings-modules';
import { ModuleBuilderPage } from '@/pages/module-builder';
import { SettingsRolesPage } from '@/pages/settings-roles';
import { SettingsUsersPage } from '@/pages/settings-users';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <Toaster>
          <BrowserRouter>
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
        </BrowserRouter>
      </Toaster>
    </ConfirmDialogProvider>
  </QueryClientProvider>
);
}
