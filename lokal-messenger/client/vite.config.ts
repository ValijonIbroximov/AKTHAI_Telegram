import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

// Dev server HTTPS — crypto.subtle (WebCrypto) LAN'da ishlashi uchun.
export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    host: true,
    port:       1420,
    strictPort: true,
    open:       true,
    // Dev rejimida barcha /api so'rovlari Go serverga yo'naltiriladi.
    // secure: false — o'z-o'zini imzolagan TLS sertifikatni qabul qiladi.
    proxy: {
      // REST so'rovlari
      "/api": {
        target:       "https://127.0.0.1:8443",
        changeOrigin: true,
        secure:       false,
      },
      "/ws": {
        target:       "https://127.0.0.1:8443",
        changeOrigin: true,
        secure:   false,
        ws:       true,
      },
    },
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
