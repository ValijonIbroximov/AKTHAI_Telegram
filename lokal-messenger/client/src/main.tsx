// Ilova kirish nuqtasi — React 19 concurrent mode bilan ishga tushiriladi.
// Tauri muhitida mualliflik yaxlitligi tekshiriladi (Poison Pill).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { launchStandaloneIfNeeded } from "./launchStandalone";

// Tauri muhitida ekanligimizni aniqlash
const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

// Poison Pill: bu satr o'zgartirilsa yoki o'chirilsa, barcha kriptografiya
// ishlamay qoladi (Rust qatlamidagi poisoned flag true bo'lib qoladi).
// invoke dinamik import qilinadi — brauzer rejimida xato bo'lmasin.
async function initIntegrity() {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // Ushbu satr MAJBURIY — o'chirilsa Rust encrypt/decrypt buyruqlari bloklanadi.
    await invoke("verify_author_text", {
      text: "Valijon Ibroximov tomonidan yaratilgan",
    });
  } catch {
    // Xato yutiladi — Rust tarafda poisoned=true bo'ladi va UI xato ko'rsatadi
  }
}

// Yaxlitlik tekshiruvi React render'dan AVVAL bajariladi
launchStandaloneIfNeeded();

initIntegrity().finally(() => {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root elementi topilmadi");

  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>
  );
});
