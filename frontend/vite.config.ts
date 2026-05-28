import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Single config drives the dev server, prod build, and Vitest. The dev server
// keeps CRA's :3000 default so docker-compose + any external bookmarks keep
// working. We don't proxy to :8000; the app already resolves the backend
// origin via VITE_API_BASE / VITE_WS_URL (see lib/api.ts), the same override
// pattern CRA used.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: "build",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
