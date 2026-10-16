import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/shared/api/client";
import { I18nProvider } from "@/shared/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
