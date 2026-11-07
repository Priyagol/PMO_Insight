import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Provider } from 'react-redux';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { useApplyTheme } from '@/hooks/use-theme';
import { routes } from '@/routes/routes';
import { store, useAppSelector } from '@/store';
import { createQueryClient } from './query-client';

const router = createBrowserRouter(routes);

function ThemedApp() {
  useApplyTheme();
  const theme = useAppSelector((s) => s.ui.theme);
  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" richColors closeButton theme={theme} />
    </>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <TooltipProvider delayDuration={300}>
            <ThemedApp />
          </TooltipProvider>
        </SessionProvider>
      </QueryClientProvider>
    </Provider>
  );
}
