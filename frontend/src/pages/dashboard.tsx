import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useSchema } from '@/hooks/use-schema';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Box, type LucideIcon } from 'lucide-react';
import { resolveModuleIcon } from '@/lib/module-icons';

export function Dashboard(): JSX.Element {
  const { user } = useAuth();
  const { modules } = useSchema();

  const getIcon = (iconName: string | null): LucideIcon => {
    if (!iconName) return Box;
    return resolveModuleIcon(iconName);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Welcome back, {user?.fullName}
        </h2>
        <p className="text-gray-500">Here is an overview of your workspace.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {modules.map((module) => {
          const Icon = getIcon(module.icon);
          return (
            <Link key={module.id} to={`/m/${module.key}`} className="block">
              <Card className="transition-colors hover:bg-gray-50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {module.labelPlural}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-gray-500" />
                </CardHeader>
                <div className="p-6 pt-0">
                  <div className="text-2xl font-bold">---</div>
                  <p className="text-xs text-gray-500">
                    {module.fields.length} fields configured
                  </p>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
