import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        peopleFast: resolve(__dirname, "people-fast.html"),
        peopleVideo: resolve(__dirname, "people-video.html"),
        speechOnline: resolve(__dirname, "speech-online.html"),
        scoreboard: resolve(__dirname, "scoreboard.html"),
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
