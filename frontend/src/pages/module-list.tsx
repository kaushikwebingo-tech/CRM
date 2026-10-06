import { useParams } from 'react-router-dom';
import { useSchema } from '@/hooks/use-schema';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ModuleList(): JSX.Element {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const { getModule } = useSchema();

  if (!moduleKey) {
    return <div className="p-6 text-red-500">Module key is missing</div>;
  }

  const moduleDef = getModule(moduleKey);

  if (!moduleDef) {
    return <div className="p-6 text-red-500">Module not found: {moduleKey}</div>;
  }

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">
            {moduleDef.labelPlural}
          </h2>
          <p className="text-sm text-gray-500">
            Manage your {moduleDef.labelPlural.toLowerCase()} here.
          </p>
        </div>
        <Button>
          Create {moduleDef.labelSingular}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white">
        <div className="flex flex-col items-center space-y-3 text-center">
          <div className="rounded-full bg-gray-100 p-3">
            <Inbox className="h-6 w-6 text-gray-500" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">No records yet</h3>
            <p className="text-sm text-gray-500 mt-1">
              Get started by creating a new {moduleDef.labelSingular.toLowerCase()}.
            </p>
          </div>
          <Button variant="outline" className="mt-4">
            Create {moduleDef.labelSingular}
          </Button>
        </div>
      </div>
    </div>
  );
}
