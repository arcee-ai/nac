import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import "./index.css";

// Session data arrives over SSE, so cached REST reads only need to cover the
// gap between a mount and the first stream event.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Alt-click jumps from a rendered element to its source. The import is dynamic
// and guarded so the tool never reaches the committed production bundle; the
// element ids it reads are stamped by the Babel plugin the dev server adds.
if (import.meta.env.DEV) {
  void import("@locator/runtime").then(({ default: setupLocatorUI }) => {
    setupLocatorUI();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Hash routing keeps deep links working without a server catch-all. */}
        <HashRouter>
          <App />
        </HashRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
