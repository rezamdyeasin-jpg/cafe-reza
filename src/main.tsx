import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

// If anything in App throws while rendering, React unmounts the whole
// page (black screen). Catch it at the top so the error is readable
// instead, with a way back.
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 560, margin: "48px auto", padding: 20, fontFamily: "sans-serif", color: "#f5ebdd", background: "#160f0c" }}>
          <h1 style={{ fontSize: 22 }}>ক্যাফে রেজা খুলতে পারেনি</h1>
          <p style={{ marginTop: 8 }}>পেজ খুলতে গিয়ে সমস্যা হয়েছে। নিচে ভুলের বিবরণ আছে।</p>
          <p role="alert" style={{ marginTop: 8, color: "#e07856", wordBreak: "break-word" }}>{this.state.error.message}</p>
          <p style={{ marginTop: 12 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 999, border: "none", background: "#c6a15b", fontWeight: 700, cursor: "pointer" }}>আবার চেষ্টা করুন</button>
            <a href="https://cafe-reza.web.app/#/" style={{ marginLeft: 12, color: "#f5ebdd" }}>দোকানে ফিরুন</a>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Uncaught errors outside React (async work, listeners) also surface on
// the page itself, in #fatal-error below the React root.
function showFatal(message: string) {
  const el = document.getElementById("fatal-error");
  if (el) { el.style.display = "block"; el.textContent = message; }
}
window.addEventListener("error", (e) => showFatal(`Error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  showFatal(`Error: ${r instanceof Error ? r.message : String(r)}`);
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
