import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reloadForNewVersion, router } from "@/app/router";
import { ToastProvider } from "@/components/ui";
import { AuthProvider } from "@/features/auth/AuthProvider";
import "./styles.css";

// Pré-carregamento de arquivo de uma versão antiga (deploy novo com a aba aberta): recarrega uma vez.
window.addEventListener("vite:preloadError", (e) => { if (reloadForNewVersion()) e.preventDefault(); });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && !/permission|JWT|forbidden/i.test(String((e as Error)?.message)) },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
