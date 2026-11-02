import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, setUnauthorizedHandler } from "@/shared/api/client";
import { I18nProvider } from "@/shared/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // Client errors (401/403/404/400) won't change on retry — fail fast.
          retry: (failureCount, error) =>
            !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
            failureCount < 1,
          refetchOnWindowFocus: false,
          staleTime: 30_000,
        },
      },
    });
    // Session expired mid-use: drop all cached state and return to login
    // (instead of every panel failing with its own "not authenticated").
    // The login page's own flow clears the cache again on a fresh login.
    setUnauthorizedHandler(() => {
      client.clear();
      window.location.assign("/login?expired=1");
    });
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
