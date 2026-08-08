import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        people: resolve(__dirname, "people.html"),
        peopleFast: resolve(__dirname, "people-fast.html"),
        speech: resolve(__dirname, "speech.html"),
        speechOnline: resolve(__dirname, "speech-online.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
