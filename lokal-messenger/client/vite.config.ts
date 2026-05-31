// Fayl: client/vite.config.ts
// Maqsad: Vite qurilish vositasi React va Tauri mijozi uchun sozlanadi.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri rivojlanish serveri uchun aniq port va host belgilanadi.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Kuchsiz mashinalar uchun maqsadli muhit zamonaviy WebView'ga moslanadi
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
