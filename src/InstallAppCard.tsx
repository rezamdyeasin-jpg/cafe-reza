// Install card — one per panel. The customer app and the admin app are two
// separate installable apps (different manifest + start URL), but both are
// this same website: same login, same Firestore data, same features.
//
// Why the button used to look dead: `beforeinstallprompt` fires once, at
// page load — before this card mounts (it sits low on the homepage and
// inside the admin Apps tab), so the card's own listener missed the
// event and `deferred` stayed null. The fallback only toggled a small
// help line, which hid again on a 2nd tap — so the button did nothing
// visible. Now the prompt is captured globally in main.tsx before React
// renders, this card reads it from window on mount, and tapping Install
// ALWAYS gives a visible result: the browser prompt, or clear
// platform-specific steps in a bordered box that never hides itself.
// There is no APK/IPA/download file — this is a web app (PWA) and the
// install happens through the browser; the help says so plainly.
import { useEffect, useState } from "react";
import { tr, type Lang } from "./db";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: "accepted" | "dismissed" }> };
const getDeferred = (): BIPEvent | null => {
  const w = window as unknown as { __deferredInstallPrompt?: BIPEvent | null };
  return w.__deferredInstallPrompt ?? null;
};
const clearDeferred = () => {
  const w = window as unknown as { __deferredInstallPrompt?: BIPEvent | null };
  w.__deferredInstallPrompt = null;
};
const isStandaloneNow = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
const platformNow = (): "ios" | "android" | "desktop" => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
};

export function InstallAppCard({ variant, lang }: { variant: "customer" | "admin"; lang: Lang }) {
  const [installed, setInstalled] = useState<boolean>(() => isStandaloneNow());
  const [deferred, setDeferred] = useState<BIPEvent | null>(() => getDeferred());
  const [showHelp, setShowHelp] = useState(false);
  const [result, setResult] = useState("");
  const platform = platformNow();
  useEffect(() => {
    // Fallback listener: if the prompt fires after this card mounted,
    // catch it here too. The global capture in main.tsx is the primary
    // path — this only covers a late-firing event.
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); clearDeferred(); setDeferred(null); };
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
    setResult("");
    const prompt = deferred ?? getDeferred();
    if (prompt) {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        clearDeferred();
        setDeferred(null);
        if (choice?.outcome === "accepted") {
          setInstalled(true);
          setResult(tr(lang, "Installed — look for the Café Reza icon on your home screen / desktop.", "ইনস্টল হয়েছে — হোম স্ক্রিন / ডেস্কটপে ক্যাফে রেজার আইকন দেখুন।"));
        } else {
          setResult(tr(lang, "Install dismissed — you can install later from the browser menu.", "ইনস্টল বাতিল হয়েছে — পরে ব্রাউজার মেনু থেকে ইনস্টল করতে পারবেন।"));
          setShowHelp(true);
        }
      } catch {
        // The prompt could not be shown (e.g. already used): fall back
        // to the written steps instead of going silent.
        setShowHelp(true);
      }
      return;
    }
    // No browser prompt is available (iPhone Safari never offers one,
    // or the browser already dismissed it): ALWAYS show the exact
    // steps for this device. This is set to true and never toggled
    // off by the Install button — tapping again keeps it visible.
    setShowHelp(true);
  };
  const steps: string[] =
    platform === "ios"
      ? [
          tr(lang, "1. Open the app in Safari (not Messenger / Facebook).", "১. Safari-তে অ্যাপটি খুলুন (মেসেঞ্জার / ফেসবুক দিয়ে নয়)।"),
          tr(lang, "2. Tap Share (⬆) at the bottom of Safari.", "২. Safari-র নিচে Share (⬆) চাপুন।"),
          tr(lang, "3. Tap “Add to Home Screen”.", "৩. “Add to Home Screen” চাপুন।"),
        ]
      : platform === "android"
        ? [
            tr(lang, "1. Open the app in Chrome.", "১. Chrome-এ অ্যাপটি খুলুন।"),
            tr(lang, "2. Tap the Chrome menu (⋮) at the top right.", "২. ওপরের ডানদিকে Chrome মেনু (⋮) চাপুন।"),
            tr(lang, "3. Tap “Install app” / “Add to Home screen”.", "৩. “Install app” / “Add to Home screen” চাপুন।"),
          ]
        : [
            tr(lang, "1. Open the app in Chrome or Edge.", "১. Chrome বা Edge-এ অ্যাপটি খুলুন।"),
            tr(lang, "2. Click the Install (⬇) icon at the right of the address bar — or the browser menu (⋮) → “Install app”.", "২. অ্যাড্রেস বারের ডানদিকে Install (⬇) আইকনে ক্লিক করুন — অথবা ব্রাউজার মেনু (⋮) → “Install app”।"),
          ];
  return (
    <div className="card" style={{ padding: 14, marginTop: 14 }}>
      <b>{variant === "admin" ? tr(lang, "Install the admin app", "অ্যাডমিন অ্যাপ ইনস্টল করুন") : tr(lang, "Install the Café Reza app", "ক্যাফে রেজা অ্যাপ ইনস্টল করুন")}</b>
      <p className="small muted" style={{ marginTop: 4 }}>{installed
        ? tr(lang, "Installed — the app is the same site, same account, same features as the website.", "ইনস্টল হয়েছে — অ্যাপ আর ওয়েবসাইট একই জিনিস: একই অ্যাকাউন্ট, একই সুবিধা।")
        : tr(lang, "The app is this same website installed on the phone — same login, same menu, same orders. It needs internet; there is no offline mode.", "অ্যাপ মানে এই একই ওয়েবসাইট ফোনে ইনস্টল করা — একই লগইন, একই মেনু, একই অর্ডার। ইন্টারনেট লাগবে; অফলাইন মোড নেই।")}</p>
      {!installed && <button className="btn-gold" style={{ marginTop: 8 }} onClick={() => void install()}>{tr(lang, "Install app", "অ্যাপ ইনস্টল করুন")}</button>}
      {result && <p className="small" role="status" style={{ marginTop: 8, fontWeight: 700 }}>{result}</p>}
      {showHelp && !installed && (
        <div role="status" style={{ marginTop: 10, padding: 12, border: "2px solid var(--gold)", borderRadius: 12, background: "var(--surface2)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{platform === "ios"
              ? tr(lang, "Install on iPhone (Safari)", "iPhone-এ ইনস্টল (Safari)")
              : platform === "android"
                ? tr(lang, "Install on Android (Chrome)", "Android-এ ইনস্টল (Chrome)")
                : tr(lang, "Install on Desktop (Chrome / Edge)", "ডেস্কটপে ইনস্টল (Chrome / Edge)")}</b>
            <button className="btn-ghost" style={{ padding: "2px 10px" }} aria-label={tr(lang, "Close", "বন্ধ করুন")} onClick={() => setShowHelp(false)}>✕</button>
          </div>
          {steps.map((s) => <p key={s} className="small" style={{ margin: "6px 0 0" }}>{s}</p>)}
          <p className="small muted" style={{ marginTop: 8 }}>{tr(lang, "This is a web app (PWA) — there is no APK / IPA file to download. It installs through the browser, and it is the same website with the same login.", "এটা ওয়েব অ্যাপ (PWA) — ডাউনলোড করার APK / IPA ফাইল নেই। ব্রাউজার থেকেই ইনস্টল হয়, আর এটা একই ওয়েবসাইট — একই লগইন।")}</p>
        </div>
      )}
    </div>
  );
}
