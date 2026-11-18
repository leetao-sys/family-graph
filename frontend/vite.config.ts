import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API_TARGET 可指向其他后端端口（如并行调试时）；默认 8000
    proxy: { "/api": process.env.API_TARGET || "http://127.0.0.1:8000" },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
