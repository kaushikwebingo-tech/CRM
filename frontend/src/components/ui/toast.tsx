import { forwardRef, type ElementRef, type ComponentPropsWithoutRef, type ReactNode, createContext, useContext, useState, useCallback } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = forwardRef<ElementRef<typeof ToastPrimitive.Viewport>, ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn('fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]', className)}
      {...props}
    />
  )
);
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

export const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-gray-200 bg-white text-gray-900',
        destructive: 'destructive group border-red-500 bg-red-500 text-white',
        success: 'border-green-500 bg-green-500 text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export const Toast = forwardRef<ElementRef<typeof ToastPrimitive.Root>, ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>>(
  ({ className, variant, ...props }, ref) => {
    return <ToastPrimitive.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />;
  }
);
Toast.displayName = ToastPrimitive.Root.displayName;

export const ToastAction = forwardRef<ElementRef<typeof ToastPrimitive.Action>, ComponentPropsWithoutRef<typeof ToastPrimitive.Action>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Action
      ref={ref}
      className={cn('inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-white transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-white/40 group-[.destructive]:hover:border-white/30 group-[.destructive]:hover:bg-red-500 group-[.destructive]:hover:text-white group-[.destructive]:focus:ring-red-500', className)}
      {...props}
    />
  )
);
ToastAction.displayName = ToastPrimitive.Action.displayName;

export const ToastClose = forwardRef<ElementRef<typeof ToastPrimitive.Close>, ComponentPropsWithoutRef<typeof ToastPrimitive.Close>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Close
      ref={ref}
      className={cn('absolute right-2 top-2 rounded-md p-1 text-gray-900/50 opacity-0 transition-opacity hover:text-gray-900 focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600', className)}
      toast-close=""
      {...props}
    >
      <X className="h-4 w-4" />
    </ToastPrimitive.Close>
  )
);
ToastClose.displayName = ToastPrimitive.Close.displayName;

export const ToastTitle = forwardRef<ElementRef<typeof ToastPrimitive.Title>, ComponentPropsWithoutRef<typeof ToastPrimitive.Title>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
  )
);
ToastTitle.displayName = ToastPrimitive.Title.displayName;

export const ToastDescription = forwardRef<ElementRef<typeof ToastPrimitive.Description>, ComponentPropsWithoutRef<typeof ToastPrimitive.Description>>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Description ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
  )
);
ToastDescription.displayName = ToastPrimitive.Description.displayName;

export interface ToastMessage {
  id: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  variant?: VariantProps<typeof toastVariants>['variant'];
}

export interface ToastContextValue {
  toast: (message: Omit<ToastMessage, 'id'>) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within Toaster');
  }
  return context;
}

let idCount = 0;

export function Toaster({ children }: { children?: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = (++idCount).toString();
    setToasts((prev) => [...prev, { ...message, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastProvider>
        {toasts.map(({ id, title, description, action, variant }) => (
          <Toast key={id} variant={variant}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action && <ToastAction altText="Action" asChild>{action}</ToastAction>}
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}
