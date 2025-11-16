import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true, // Refetch when window regains focus after sleep/hibernation
      refetchOnReconnect: true, // Refetch when network reconnects
      retry: (failureCount, error) => {
        // Don't retry on network suspension errors - just wait for reconnect
        const errorMessage = String(error);
        if (errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
          return false;
        }
        // Retry up to 2 times for other errors
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      staleTime: 30000, // Consider data fresh for 30 seconds
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
