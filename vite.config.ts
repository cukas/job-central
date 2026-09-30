import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built index.html loads its JS/CSS under file://
  // in the packaged Electron app (an absolute "/assets/..." resolves to the
  // filesystem root there and the renderer comes up black).
  base: "./",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
