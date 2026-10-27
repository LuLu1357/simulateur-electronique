import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:8765" },
      },
    },
  },
  build: { outDir: "dist" },
});
