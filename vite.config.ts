import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    rollupOptions: {
      input: {
        classroom: resolve(__dirname, "classroom.html"),
        scoreboard: resolve(__dirname, "scoreboard.html"),
        scoreboardAdmin: resolve(__dirname, "scoreboard-admin.html"),
        vision: resolve(__dirname, "vision.html"),
        visionFace: resolve(__dirname, "vision-face.html"),
        countdown: resolve(__dirname, "countdown.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
