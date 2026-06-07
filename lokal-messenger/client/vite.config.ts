import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import os from "os";
import path from "path";

/** Dev mashinaning LAN IPv4 manzili (masalan 192.168.101.32) */
function detectLanIPv4(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const addr = iface.address;
      if (addr.startsWith("192.168.") || addr.startsWith("10.") || addr.startsWith("172.")) {
        return addr;
      }
    }
  }
  return "127.0.0.1";
}

const lanIp = detectLanIPv4();
if (!process.env.VITE_API_HOST && lanIp !== "127.0.0.1") {
  process.env.VITE_API_HOST = lanIp;
}
const apiHost = process.env.VITE_API_HOST || lanIp;
const apiTarget = `https://${apiHost}:8443`;
const devOpenUrl = lanIp !== "127.0.0.1" ? `https://${lanIp}:1420` : true;

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
    open:       devOpenUrl,
    // Dev rejimida barcha /api so'rovlari Go serverga yo'naltiriladi.
    // secure: false — o'z-o'zini imzolagan TLS sertifikatni qabul qiladi.
    proxy: {
      // REST so'rovlari
      "/api": {
        target:       apiTarget,
        changeOrigin: true,
        secure:       false,
      },
      "/healthz": {
        target:       apiTarget,
        changeOrigin: true,
        secure:       false,
      },
      "/ws": {
        target:       apiTarget,
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
