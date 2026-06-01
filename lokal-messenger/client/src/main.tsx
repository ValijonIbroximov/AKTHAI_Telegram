// Ilova kirish nuqtasi — React 19 concurrent mode bilan ishga tushiriladi.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root elementi topilmadi");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
