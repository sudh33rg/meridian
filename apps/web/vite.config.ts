/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MERIDIAN_API_TARGET points the dev proxy at another local API (default: port 9990).
const apiTarget = process.env.MERIDIAN_API_TARGET ?? "http://127.0.0.1:9990";

export default defineConfig({
  plugins: [react()],
  // changeOrigin stays false so the API sees the browser's Host (its CSRF Origin check compares it).
  server: {
    port: 9991,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false, ws: true },
      "/health": { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
