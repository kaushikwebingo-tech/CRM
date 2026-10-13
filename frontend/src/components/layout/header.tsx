import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Search, LogOut, Bell, Check, Clock } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useSchema } from '@/hooks/use-schema';
import { logout } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { GlobalSearchDialog } from '@/components/search/global-search-dialog';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationItem,
} from '@/api/notifications';

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

        <NotificationBell />

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

function NotificationBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = () => {
    fetchNotifications()
      .then((res) => {
        setItems(res.items || []);
        setUnreadCount(res.unreadCount || 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleMarkRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await markNotificationRead(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {}
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative cursor-pointer text-gray-500 hover:text-gray-900">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 mt-2 w-80 sm:w-96 rounded-lg border border-gray-200 bg-white p-0 shadow-lg text-sm"
          align="end"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gray-50/50 rounded-t-lg">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {items.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <Bell className="mx-auto h-6 w-6 text-gray-300 mb-2" />
                <p className="text-xs">No notifications yet</p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 transition flex items-start gap-3 ${
                    item.isRead ? 'bg-white' : 'bg-blue-50/40'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${item.isRead ? 'font-medium text-gray-800' : 'font-semibold text-blue-900'}`}>
                      {item.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                      {item.body}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  {!item.isRead && (
                    <button
                      onClick={(e) => handleMarkRead(item.id, e)}
                      title="Mark read"
                      className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

