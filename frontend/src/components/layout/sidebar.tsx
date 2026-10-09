import { NavLink } from 'react-router-dom';
import { Users, Zap, Shield, Layers, Menu, Package2, type LucideIcon } from 'lucide-react';
import { resolveModuleIcon } from '@/lib/module-icons';
import { useUiStore } from '@/stores/ui';
import { useSchema } from '@/hooks/use-schema';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Sidebar(): JSX.Element {
  const { sidebarOpen, toggleSidebar } = useUiStore();
  const { modules } = useSchema();

  // Resolved from a bounded set rather than lucide's full icon map, which used
  // to put every icon in the bundle (see lib/module-icons).
  const getIcon = (iconName: string | null): LucideIcon => resolveModuleIcon(iconName);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col bg-slate-900 text-white transition-all duration-200',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        {sidebarOpen && (
          <div className="flex items-center gap-2 font-semibold">
            <Package2 className="h-6 w-6 text-blue-500" />
            <span>CRM Next</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-slate-300 hover:text-white">
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-2">
          {modules.map((module) => {
            const Icon = getIcon(module.icon);
            return (
              <NavLink
                key={module.id}
                to={`/m/${module.key}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {sidebarOpen && <span>{module.labelPlural}</span>}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-800 p-2">
        <nav className="space-y-1">
          <NavLink
            to="/settings/modules"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Layers className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>Modules</span>}
          </NavLink>
          <NavLink
            to="/settings/roles"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Shield className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>Roles & RBAC</span>}
          </NavLink>
          <NavLink
            to="/settings/users"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Users className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>Users</span>}
          </NavLink>
          <NavLink
            to="/settings/automations"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )
            }
          >
            <Zap className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>Automations</span>}
          </NavLink>
        </nav>
      </div>
    </aside>
  );
}
