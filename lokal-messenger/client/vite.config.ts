import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Tauri development server port va host sozlamalari.
// HTTPS o'chirilgan — Tauri o'zi TLS boshqaradi.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port:         1420,
    strictPort:   true,
    watch: {
      // Tauri src-tauri papkasini kuzatmaslik (qo'shcha qayta yuklashdan saqlaydi)
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri Windows x64 uchun optimizatsiya
    target:           "chrome120",
    minify:           "esbuild",
    sourcemap:        false,
    rollupOptions: {
      output: {
        // Katta bo'laklarni bo'lish (lazy loading uchun)
        manualChunks: {
          vendor: ["react", "react-dom"],
          state:  ["zustand"],
        },
      },
    },
  },
});
