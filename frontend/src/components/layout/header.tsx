import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Search, LogOut } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useSchema } from '@/hooks/use-schema';
import { logout } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { GlobalSearchDialog } from '@/components/search/global-search-dialog';

export function Header(): JSX.Element {
  const { user } = useAuth();
  const { getModule } = useSchema();
  const { moduleKey } = useParams<{ moduleKey?: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeModule = moduleKey ? getModule(moduleKey) : undefined;
  
  let breadcrumb = 'Dashboard';
  if (activeModule) {
    breadcrumb = activeModule.labelPlural;
  } else if (location.pathname.startsWith('/settings/modules')) {
    breadcrumb = 'Module Settings';
  } else if (location.pathname.startsWith('/settings/users')) {
    breadcrumb = 'Users';
  }

  const handleLogout = async (): Promise<void> => {
    await logout();
    queryClient.invalidateQueries({ queryKey: ['auth'] });
  };

  const initials = user?.fullName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2) || 'U';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center">
        <h1 className="text-lg font-medium text-gray-900">{breadcrumb}</h1>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => setSearchOpen(true)}
          className="w-64 justify-start text-gray-500 hover:text-gray-900 cursor-pointer"
        >
          <Search className="mr-2 h-4 w-4" />
          <span>Search...</span>
          <kbd className="ml-auto rounded border bg-gray-50 px-1.5 font-mono text-[10px] font-medium text-gray-500">
            ⌘K
          </kbd>
        </Button>

        <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full">
              <Avatar>
                <AvatarImage src={user?.avatarUrl || undefined} alt={user?.fullName} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-50 mt-2 w-56 rounded-md border border-gray-200 bg-white p-1 shadow-md" align="end">
              <DropdownMenu.Label className="px-2 py-1.5 text-sm font-semibold text-gray-900">
                {user?.fullName}
                <span className="block text-xs font-normal text-gray-500">{user?.email}</span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-gray-100"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
