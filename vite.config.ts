import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // GitHub Pages publica em /<repositório>/; defina VITE_BASE no build (ver .github/workflows/deploy-pages.yml).
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "src/**/*.test.tsx", "supabase/functions/_shared/*.test.ts"] },
});
