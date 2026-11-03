import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
