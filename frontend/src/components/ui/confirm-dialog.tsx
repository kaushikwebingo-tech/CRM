import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title?: string;
  description?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'default' | 'warning';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const ConfirmContext = React.createContext<ConfirmContextType | undefined>(undefined);

let globalConfirmFn: ((options: ConfirmOptions | string) => Promise<boolean>) | null = null;

export function confirmModal(options: ConfirmOptions | string): Promise<boolean> {
  if (globalConfirmFn) {
    return globalConfirmFn(options);
  }
  return Promise.resolve(
    typeof options === 'string'
      ? window.confirm(options)
      : window.confirm(options.message || options.description || 'Are you sure?')
  );
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions>({
    title: 'Confirm Action',
    description: 'Are you sure you want to proceed?',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default',
  });

  const resolverRef = React.useRef<((val: boolean) => void) | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      if (typeof opts === 'string') {
        const isDelete = opts.toLowerCase().includes('delete') || opts.toLowerCase().includes('remove');
        setOptions({
          title: isDelete ? 'Confirm Deletion' : 'Confirm Action',
          description: opts,
          confirmText: isDelete ? 'Delete' : 'Confirm',
          cancelText: 'Cancel',
          variant: isDelete ? 'destructive' : 'default',
        });
      } else {
        const isDelete =
          opts.variant === 'destructive' ||
          (opts.title && (opts.title.toLowerCase().includes('delete') || opts.title.toLowerCase().includes('remove'))) ||
          (opts.description && (opts.description.toLowerCase().includes('delete') || opts.description.toLowerCase().includes('remove'))) ||
          (opts.message && (opts.message.toLowerCase().includes('delete') || opts.message.toLowerCase().includes('remove')));

        setOptions({
          title: opts.title || (isDelete ? 'Confirm Deletion' : 'Confirm Action'),
          description: opts.description || opts.message || 'Are you sure you want to proceed?',
          confirmText: opts.confirmText || (isDelete ? 'Delete' : 'Confirm'),
          cancelText: opts.cancelText || 'Cancel',
          variant: opts.variant || (isDelete ? 'destructive' : 'default'),
        });
      }
      setIsOpen(true);
    });
  }, []);

  React.useEffect(() => {
    globalConfirmFn = confirm;
    return () => {
      globalConfirmFn = null;
    };
  }, [confirm]);

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  };

  const isDestructive = options.variant === 'destructive';
  const isWarning = options.variant === 'warning';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <DialogContent className="sm:max-w-md p-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center shrink-0',
                isDestructive && 'bg-red-100 text-red-600',
                isWarning && 'bg-amber-100 text-amber-600',
                !isDestructive && !isWarning && 'bg-blue-100 text-blue-600'
              )}
            >
              {isDestructive || isWarning ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Info className="h-5 w-5" />
              )}
            </div>

            <div className="flex-1 space-y-1.5 pt-0.5">
              <DialogHeader className="text-left space-y-1">
                <DialogTitle className="text-base font-bold text-slate-900">
                  {options.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 leading-relaxed">
                  {options.description}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>

          <DialogFooter className="mt-5 flex gap-2 sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
              {options.cancelText || 'Cancel'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              className={cn(
                isDestructive && 'bg-red-600 hover:bg-red-700 text-white',
                isWarning && 'bg-amber-600 hover:bg-amber-700 text-white',
                !isDestructive && !isWarning && 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
            >
              {options.confirmText || 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions | string) => Promise<boolean> {
  const context = React.useContext(ConfirmContext);
  if (!context) {
    return confirmModal;
  }
  return context.confirm;
}
