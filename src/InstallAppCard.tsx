// Install card — one per panel. The customer app and the admin app are two
// separate installable apps (different manifest + start URL), but both are
// this same website: same login, same Firestore data, same features.
import { useEffect, useState } from "react";
import { tr, type Lang } from "./db";

export function InstallAppCard({ variant, lang }: { variant: "customer" | "admin"; lang: Lang }) {
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<Event | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  useEffect(() => {
    const file = variant === "admin" ? "manifest-admin.webmanifest" : "manifest-customer.webmanifest";
    void fetch(`/${file}`, { method: "HEAD" }).then((res) => {
      if (!res.ok) return;
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) { link = document.createElement("link"); link.rel = "manifest"; document.head.appendChild(link); }
      link.href = `/${file}`;
    }).catch(() => undefined);
  }, [variant]);
  const install = async () => {
    const prompt = deferred as (Event & { prompt: () => Promise<void> }) | null;
    if (prompt) { await prompt.prompt(); setDeferred(null); return; }
    setShowHelp((v) => !v);
  };
  return (
    <div className="card" style={{ padding: 14, marginTop: 14 }}>
      <b>{variant === "admin" ? tr(lang, "Install the admin app", "অ্যাডমিন অ্যাপ ইনস্টল করুন") : tr(lang, "Install the Café Reza app", "ক্যাফে রেজা অ্যাপ ইনস্টল করুন")}</b>
      <p className="small muted" style={{ marginTop: 4 }}>{installed
        ? tr(lang, "Installed — the app is the same site, same account, same features as the website.", "ইনস্টল হয়েছে — অ্যাপ আর ওয়েবসাইট একই জিনিস: একই অ্যাকাউন্ট, একই সুবিধা।")
        : tr(lang, "The app is this same website installed on the phone — same login, same menu, same orders. It needs internet; there is no offline mode.", "অ্যাপ মানে এই একই ওয়েবসাইট ফোনে ইনস্টল করা — একই লগইন, একই মেনু, একই অর্ডার। ইন্টারনেট লাগবে; অফলাইন মোড নেই।")}</p>
      {!installed && <button className="btn-gold" style={{ marginTop: 8 }} onClick={() => void install()}>{tr(lang, "Install app", "অ্যাপ ইনস্টল করুন")}</button>}
      {showHelp && !installed && <p className="small" style={{ marginTop: 8 }}>{tr(lang, "Android: Chrome menu (⋮) → Install app / Add to Home screen. iPhone: Safari Share → Add to Home Screen.", "Android: Chrome মেনু (⋮) → Install app / Add to Home screen। iPhone: Safari Share → Add to Home Screen।")}</p>}
      {variant === "admin" && <p style={{ marginTop: 8 }}><a className="btn-ghost" style={{ textDecoration: "none" }} href="/manifest-admin.webmanifest" download="cafe-reza-admin.webmanifest">{tr(lang, "Download admin app file", "অ্যাডমিন অ্যাপের ফাইল ডাউনলোড করুন")}</a></p>}
    </div>
  );
}
