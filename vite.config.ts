import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: { app: "index.html", corePreview: "scout-core-preview.html" },
      output: {
        manualChunks: {
          charts: ["recharts"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001" } },
});
