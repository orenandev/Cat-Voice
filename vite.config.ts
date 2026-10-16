import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "libarchive.js"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: "es" },
});
