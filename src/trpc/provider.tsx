"use client";

import { QueryClient } from "@tanstack/react-query";
import { httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import type { AppRouter } from "@/server/api/root";

export const api = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // five-minute client cache: navigating back paints instantly;
            // Refresh buttons still force fresh data via invalidate()
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({ url: "/api/trpc" }),
          false: httpBatchLink({ url: "/api/trpc" }),
        }),
      ],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      {children}
    </api.Provider>
  );
}
