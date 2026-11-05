// Café Reza — standalone Firebase build.
// Firestore is the only database: the customer site reads the same
// collections the admin panel writes (products, categories, settings,
// coupons, orders, reservations, messages, users). There is no second
// copy of the menu anywhere in this client: the seed file only writes
// Firestore documents once, from the admin panel.
// Sign-in is Google, Facebook and phone number only. There is no
// email/password form and no email-verification step.
import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  addDoc, collection, doc, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, where, type DocumentData,
} from "firebase/firestore";
import {
  getAuthInstance, getDb, isFirebaseConfigured, loginWithFacebook, loginWithGoogle, signOutUser,
  startPhoneSignIn, confirmPhoneCode, watchAuth, MISSING_CONFIG_BN, ensureUserDoc,
  type PhoneConfirmation,
} from "./firebase";
import {
  BANNER_SLIDES, MAP_COORDS, MAPS_LINK, OWNER_EMAIL,
} from "./seed";
import {
  AD_SLOT_DEFS, enabledPayments, isStaffRole, orderFromDoc, parseAds, parseBannerSelection,
  parseContent, productFromDoc, categoryFromDoc, seedCatalog, settingsFromDoc, tr, tsToIso,
  useCatalog, useLive, useLiveDoc, useSettingsDoc, userFromDoc,
  type Category, type Coupon, type Lang, type Order, type Product, type Reservation,
  type Review, type Settings, type UserDoc,
} from "./db";
import { cancelOrderTx, COMBO_DISCOUNT_PER_LINE, COMBO_MIN_QTY, comboDiscount, HAPPY_HOUR_END, HAPPY_HOUR_PERCENT, HAPPY_HOUR_START, happyHourDiscount, isHappyHour, placeOrderTx, timeToMin, type CartLine } from "./orders";
import { askAi, buildAiKnowledge } from "./aiAssistant";
import { ReceiptModal } from "./Receipt";
import { InstallAppCard } from "./InstallAppCard";
import { AdminPanel } from "./AdminPanel";

export type CartItem = { productId: string; qty: number; size: string; sugar: string; milk: string; note: string };
type View = "store" | "track" | "reserve" | "account" | "admin" | "info" | "refund" | "delivery" | "privacy";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;
const imgSrc = (key: string | null | undefined) => (key ? `/img/${key}` : "");
const displayName = (p: Product, lang: Lang) => (lang === "bn" && p.nameBn ? p.nameBn : p.nameEn);
const taglineText = (settings: Settings, lang: Lang) => (lang === "bn" ? (settings.taglineBn || settings.tagline) : settings.tagline);
const taglineClass = (lang: Lang) => (lang === "bn" ? "tagline-bn" : "tagline-en");
// Facebook/Messenger/Instagram open links in their own built-in browser,
// which partitions storage — Firebase Google/Facebook sign-in cannot
// complete there (missing initial state). Users must open in Chrome.
const isInAppBrowser = () => typeof navigator !== "undefined" && /FBAN|FBAV|Instagram/i.test(navigator.userAgent);
const effPrice = (p: Product) => p.discountPrice ?? p.price;
const orderable = (p: Product) => p.available && effPrice(p) > 0;

// Opening hours (settings.hoursJson: [{day, open, close}]) → is the
// cafe open right now? "00:00" as a closing time means midnight at
// the end of the day, so it reads as 24:00.
type DayHours = { day: string; open: string; close: string; closed?: boolean };
function parseHours(json?: string | null): DayHours[] {
  try {
    const raw = JSON.parse(json ?? "") as unknown;
    return Array.isArray(raw) ? (raw as DayHours[]) : [];
  } catch { return []; }
}
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function todayHours(json?: string | null, now = new Date()): DayHours | null {
  const dayName = DAY_NAMES[now.getDay()] ?? "";
  return parseHours(json).find((h) => h.day === dayName) ?? null;
}
function isOpenNow(json?: string | null, now = new Date()): boolean {
  const t = todayHours(json, now);
  if (!t || t.closed) return false;
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const open = toMin(t.open);
  let close = toMin(t.close);
  if (close === 0) close = 24 * 60;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= open && cur < close;
}
// Live open/closed badge: re-checks every 30 seconds, so the badge
// flips on its own when the cafe opens or closes.
function OpenNowBadge({ settings, lang }: { settings: Settings; lang: Lang }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, []);
  const open = isOpenNow(settings.hoursJson);
  const t = todayHours(settings.hoursJson);
  if (!t) {
    // No hours are configured at all: do not claim the cafe is
    // closed — just point to the hours.
    return (
      <span className="chip" style={{ background: "var(--gold)", color: "#1a1207", fontWeight: 800, borderColor: "transparent", padding: "6px 12px" }}>
        {tr(lang, "Opening hours — see About", "খোলার সময় — সম্পর্কে দেখুন")}
      </span>
    );
  }
  const hoursText = !t.closed ? `${t.open} – ${t.close}` : "";
  return (
    <span className="chip" style={{ background: open ? "var(--good)" : "var(--bad)", color: "#fff", fontWeight: 800, borderColor: "transparent", padding: "6px 12px" }}>
      {open ? `● ${tr(lang, "Open now", "এখন খোলা")}` : `● ${tr(lang, "Closed", "বন্ধ")}`}{hoursText ? ` • ${hoursText}` : ""}
    </span>
  );
}

// Stars shown for a product's average rating or a single review.
// Only real reviews a customer wrote are ever shown — nothing is
// invented, and a review appears here only after staff approve it.
function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return <span style={{ color: "var(--gold)", fontSize: size, letterSpacing: 1 }} aria-label={`${rating} / 5`}>{"★".repeat(full)}{"☆".repeat(5 - full)}</span>;
}

function reviewFromDoc(id: string, d: DocumentData): Review {
  return { id, productId: String(d.productId ?? ""), author: String(d.author ?? ""), rating: Number(d.rating ?? 0), comment: String(d.comment ?? ""), status: String(d.status ?? ""), createdAt: tsToIso(d.createdAt) };
}

// Food info chips: shown only when the admin filled the field in.
// A blank field means "not set" and renders nothing — never a guess.
function FoodInfo({ p, lang }: { p: Product; lang: Lang }) {
  const spiceLabel = p.spiceLevel === "mild" ? tr(lang, "Mild", "হালকা") : p.spiceLevel === "medium" ? tr(lang, "Medium", "মাঝারি") : p.spiceLevel === "hot" ? tr(lang, "Hot", "ঝাল") : "";
  const chips: ReactNode[] = [];
  if (p.veg === "veg") chips.push(<span key="veg" className="chip">🟢 {tr(lang, "Veg", "ভেজ")}</span>);
  else if (p.veg === "non-veg") chips.push(<span key="nonveg" className="chip">🔴 {tr(lang, "Non-veg", "নন-ভেজ")}</span>);
  if (spiceLabel) chips.push(<span key="spice" className="chip">🌶️ {spiceLabel}</span>);
  if (chips.length === 0) return null;
  return <div className="row" style={{ marginTop: 6 }}>{chips}</div>;
}

function ProductImage({ p, h }: { p: Product; h?: number }) {
  const [failed, setFailed] = useState(false);
  const src = imgSrc(p.imageKey);
  if (!src || failed) {
    return <div className="flex items-center justify-center" style={{ height: h ?? 160, background: "var(--surface2)" }}><span className="serif" style={{ fontSize: 44, color: "var(--accent)" }}>{(p.nameEn || "C").slice(0, 1)}</span></div>;
  }
  return <img src={src} alt={p.nameEn} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: h ?? 160, objectFit: "cover", display: "block" }} />;
}

// Frame 2 for every product: a labelled diagram drawn from the live
// ingredients list — never another product's photo. Posters that are
// photographs stay in frame 1 only.
function IngredientPoster({ p, lang }: { p: Product; lang: Lang }) {
  const items = p.ingredients.split(",").map((s) => s.trim()).filter(Boolean);
  const vessel = /tea|coffee/i.test(p.nameEn) ? "mug" : /smoothie|shake|juice|lemonade|mocktail|crusher|lacchi|booster/i.test(p.nameEn) ? "glass" : /doi|faluda/i.test(p.nameEn) ? "bowl" : "plate";
  return (
    <div className="p-4 text-center" style={{ background: "var(--surface2)", borderRadius: 12 }}>
      <p className="serif text-lg font-bold">{displayName(p, lang)}</p>
      <p className="small muted">{tr(lang, "Ingredients", "উপকরণ")} • {vessel}</p>
      <div className="mx-auto my-3 flex items-end justify-center" style={{ height: 64 }}>
        <div style={{ width: 72, height: vessel === "glass" ? 60 : 44, border: "3px solid var(--accent)", borderRadius: vessel === "plate" ? "50%" : vessel === "bowl" ? "0 0 36px 36px" : "6px 6px 14px 14px", background: "var(--surface)" }} />
      </div>
      <div className="row" style={{ justifyContent: "center" }}>
        {items.map((it) => <span key={it} className="chip" style={{ padding: "4px 10px" }}>{it}</span>)}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{tr(lang, "Diagram from the stored ingredient list.", "সংরক্ষিত উপকরণ তালিকা থেকে আঁকা ডায়াগ্রাম।")}</p>
    </div>
  );
}

function BannerCarousel({ products, onSelect, lang }: { products: Product[]; onSelect: (p: Product) => void; lang: Lang }) {
  const { data: settings } = useSettingsDoc();
  const selection = parseBannerSelection(settings.bannersJson);
  const slides = useMemo(() => {
    const list = (selection.length > 0 ? BANNER_SLIDES.filter((b) => selection.includes(b.slug)) : BANNER_SLIDES)
      .map((b) => ({ ...b, product: products.find((p) => p.slug === b.slug) }))
      .filter((s) => s.product !== undefined);
    return list;
  }, [selection, products]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  // Preload every banner poster once, so rotating slides never flashes blank
  // and the page below never jumps while an image loads.
  useEffect(() => {
    slides.forEach((s) => { const im = new Image(); im.src = `/img/${s.img}`; });
  }, [slides]);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; if (t) touchX.current = t.clientX; setPaused(true); };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const t = e.changedTouches[0];
    if (t) {
      const dx = t.clientX - touchX.current;
      const w = (e.currentTarget as HTMLElement).clientWidth;
      if (Math.abs(dx) > Math.max(40, w * 0.18)) setIdx((i) => (i + (dx < 0 ? 1 : -1) + slides.length) % slides.length);
    }
    touchX.current = null; setPaused(false);
  };
  // If a touch is cancelled (interrupted), the banner must resume —
  // without this, a cancelled swipe left `paused` stuck on true and the
  // auto-rotation never came back.
  const onTouchCancel = () => { touchX.current = null; setPaused(false); };
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Auto-advance with a running interval, not a one-shot timeout gated
  // on document.hidden. The old timeout returned early (no timer set at
  // all) when the tab happened to be hidden at mount, and nothing ever
  // re-triggered it — so the banner sat on one slide forever, on the
  // test browser and on the owner's phone. Now the interval is always
  // running (unless paused / reduced-motion / fewer than 2 slides) and
  // the callback simply skips advancing while the tab is hidden, so
  // rotation resumes the moment the tab is visible again.
  useEffect(() => {
    if (slides.length < 2 || paused || reduced) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIdx((i) => (i + 1) % slides.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, [idx, paused, slides.length, reduced]);
  if (slides.length === 0) return null;
  const slide = slides[idx % slides.length];
  if (!slide || !slide.product) return null;
  const product = slide.product;
  return (
    <div className="card mt-4 overflow-hidden" role="region" aria-label={tr(lang, "Café Reza promos", "ক্যাফে রেজার প্রোমো")}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel} style={{ touchAction: "pan-y" }}>
      <button type="button" onClick={() => onSelect(product)} className="block w-full text-left" style={{ background: "none", border: "none", padding: 0 }}>
        <div style={{ position: "relative", background: "#0d0906", height: "min(44vw, 200px)", overflow: "hidden" }}>
          {slides.map((s, i) => (
            <img key={s.slug} src={`/img/${s.img}`} alt={i === idx % slides.length ? s.alt : ""} aria-hidden={i !== idx % slides.length} decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: i === idx % slides.length ? 1 : 0, transition: reduced ? "none" : "opacity 0.8s ease" }} />
          ))}
        </div>
        <div key={slide.slug} className="flex items-center justify-between px-3 py-2 banner-caption-in" style={{ background: "rgba(22,15,12,.72)", color: "#f5ebdd", gap: 8, flexWrap: "nowrap", height: 40 }}>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{displayName(product, lang)}</b><span style={{ flex: "none" }}>{orderable(product) ? tk(effPrice(product)) : tr(lang, "Price coming soon", "দাম আসছে")}</span>
        </div>
      </button>
      <div className="row px-3 py-2" style={{ justifyContent: "space-between" }}>
        <button className="chip" aria-label="Previous banner" onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)}>←</button>
        <button className="chip" aria-label="Next banner" onClick={() => setIdx((i) => (i + 1) % slides.length)}>→</button>
      </div>
    </div>
  );
}

function PromoVideo({ src, label, poster, lang }: { src: string | null; label: string; poster?: string; lang: Lang }) {
  // Big hero video: taller than before with rounded corners, so it reads
  // as the page's main visual. Still silent autoplay loop, no controls.
  // preload="metadata": the page does not wait for the whole video
  // file before it becomes usable — the video still autoplays once
  // enough data has loaded. The old preload="auto" fetched the full
  // video eagerly and held the menu up behind it.
  if (!src) return poster ? <img src={poster} alt={label} style={{ width: "100%", height: "min(56vw, 360px)", objectFit: "cover", display: "block", borderRadius: 12, background: "#000" }} /> : null;
  return <video src={src} poster={poster} autoPlay muted loop playsInline disablePictureInPicture preload="metadata" aria-label={label} style={{ width: "100%", height: "min(56vw, 360px)", objectFit: "cover", display: "block", borderRadius: 12, background: "#000", pointerEvents: "none" }} />;
}

function promoSrc(choice: string | undefined): string | null {
  if (choice === "a") return "/video/promo-a.mp4";
  if (choice === "b") return "/video/promo-b.mp4";
  if (choice === "none") return null;
  return "/video/promo-main.mp4";
}

// Table QR handoff: a scanned table QR opens the menu with
// ?table=T1 in the hash (e.g. https://cafe-reza.web.app/#/?table=T1).
// The label is validated (letters, digits, dash, max 12 chars) so a
// crafted link cannot inject anything into the checkout form.
function tableParamFromHash(): string {
  if (typeof window === "undefined") return "";
  const q = (window.location.hash || "").split("?")[1] || "";
  const t = (new URLSearchParams(q).get("table") || "").trim().toUpperCase();
  return /^[A-Z0-9-]{1,12}$/.test(t) ? t : "";
}

function AdSlotView({ slotId, adsJson }: { slotId: string; adsJson?: string | null }) {
  const slot = parseAds(adsJson).find((s) => s.id === slotId);
  if (!slot || !slot.enabled) return null;
  if (slot.kind === "code") {
    if (!slot.code.trim()) return null;
    return <div className="mt-4" aria-label="Advertisement"><p className="text-center small muted">ADVERTISEMENT</p><iframe title={`Advertisement — ${slotId}`} sandbox="allow-scripts" srcDoc={slot.code} style={{ width: "100%", height: 120, border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }} /></div>;
  }
  const src = slot.imageUrl.trim();
  if (!src || !/^https?:\/\//i.test(src)) return null;
  const img = <img src={src} alt="Advertisement" loading="lazy" decoding="async" style={{ width: "100%", height: 104, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} />;
  return <div className="mt-4" aria-label="Advertisement"><p className="text-center small muted">ADVERTISEMENT</p>{slot.linkUrl.trim() ? <a href={slot.linkUrl} target="_blank" rel="noreferrer sponsored">{img}</a> : img}</div>;
}

function OffersSection({ settings, lang }: { settings: Settings; lang: Lang }) {
  // The cafe's live offers, in one place on the homepage. Each offer
  // below is also enforced in the order transaction, so what is
  // promised here is what the customer is actually charged — and
  // every number comes from the admin Settings, never hard-coded.
  // The Happy Hour card flips to "running now" live while it lasts.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, []);
  const minQty = settings.comboMinQty ?? COMBO_MIN_QTY;
  const comboAmt = settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE;
  const hhStart = settings.happyHourStart ?? HAPPY_HOUR_START;
  const hhEnd = settings.happyHourEnd ?? HAPPY_HOUR_END;
  const hhPct = settings.happyHourPercent ?? HAPPY_HOUR_PERCENT;
  const happyNow = isHappyHour(new Date(), timeToMin(hhStart), timeToMin(hhEnd));
  return (
    <section className="card" style={{ marginTop: 14, padding: 14, border: "2px solid var(--gold)" }} aria-label={tr(lang, "Offers and combos", "অফার ও কম্বো")}>
      <h2 className="serif" style={{ fontSize: 20, margin: 0 }}>🎁 {tr(lang, "Offers & Combos", "অফার ও কম্বো")}</h2>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="card" style={{ padding: 12, flex: 1, minWidth: 220 }}>
          <b>{tr(lang, "Combo offer", "কম্বো অফার")}</b>
          <p className="small" style={{ margin: "4px 0 0" }}>{lang === "bn"
            ? `একই আইটেম ${minQty}টা বা বেশি কিনলে ${comboAmt} টাকা ছাড় — চেকআউটে নিজে নিজেই বসবে, ${minQty}টা হওয়া প্রতিটি আইটেমে একবার করে। কোনো ফ্রি আইটেমের অফার নেই।`
            : `Buy ${minQty} or more of the same item and get ৳${comboAmt} off — applied automatically at checkout, once per item that reaches ${minQty}. No free-item offer.`}</p>
        </div>
        <div className="card" style={{ padding: 12, flex: 1, minWidth: 220, border: happyNow ? "2px solid var(--good)" : undefined }}>
          <b>🕓 {tr(lang, "Happy Hour", "হ্যাপি আওয়ার")} {happyNow && <span style={{ background: "var(--good)", color: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 12 }}>● {tr(lang, "Running now", "এখন চলছে")}</span>}</b>
          <p className="small" style={{ margin: "4px 0 0" }}>{lang === "bn"
            ? `প্রতিদিন ${hhStart}–${hhEnd}: পুরো অর্ডারে ${hhPct}% ছাড়, চেকআউটে নিজে নিজেই বসবে।`
            : `Every day ${hhStart}–${hhEnd}: ${hhPct}% off your whole order, applied automatically at checkout.`}</p>
        </div>
        <div className="card" style={{ padding: 12, flex: 1, minWidth: 220 }}>
          <b>🎟️ {tr(lang, "First order — 10% off", "প্রথম অর্ডারে ১০% ছাড়")}</b>
          <p className="small" style={{ margin: "4px 0 0" }}>{lang === "bn"
            ? "নতুন কাস্টমার? প্রথম অর্ডারে কুপন কোড WELCOME10 ব্যবহার করুন — ১০% ছাড় পাবেন। শুধু প্রথম অর্ডারের জন্য।"
            : "New here? Use coupon code WELCOME10 on your first order and get 10% off. First order only."}</p>
          <p className="small" style={{ margin: "6px 0 0" }}><code style={{ background: "var(--gold)", color: "#fff", borderRadius: 6, padding: "3px 10px", fontWeight: 700, letterSpacing: 1 }}>WELCOME10</code></p>
        </div>
      </div>
    </section>
  );
}

function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.3 1.5-1.1 2.7-2.4 3.5v2.9h3.9c2.3-2.1 3.5-5.2 3.5-8.3z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-2.9c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3C3.4 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.5c-.2-.7-.4-1.5-.4-2.5s.1-1.8.4-2.5v-3H1.4C.5 8.3 0 10.1 0 12s.5 3.7 1.4 5.5l4-3z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.4-3.3C17.9 1.1 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.5l4 3c.9-2.8 3.5-4.8 6.6-4.8z" />
    </svg>
  );
}

function SignInCard({ lang, onSignedIn }: { lang: Lang; onSignedIn: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [phoneName, setPhoneName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"number" | "code">("number");
  const [confirmation, setConfirmation] = useState<PhoneConfirmation | null>(null);

  const onSocial = async (provider: "google" | "facebook") => {
    if (!isFirebaseConfigured) { setNote(MISSING_CONFIG_BN); return; }
    setBusy(true); setNote(provider === "google" ? tr(lang, "Opening Google sign-in…", "Google সাইন-ইন খুলছে…") : tr(lang, "Opening Facebook sign-in…", "Facebook সাইন-ইন খুলছে…"));
    const r = provider === "google" ? await loginWithGoogle() : await loginWithFacebook();
    setBusy(false);
    if (r.ok) { onSignedIn(); return; }
    setNote(r.error ?? tr(lang, "Sign-in failed.", "সাইন-ইন ব্যর্থ হয়েছে।"));
  };
  const sendCode = async () => {
    const num = phoneNumber.trim();
    if (!/^\+8801[3-9]\d{8}$/.test(num)) { setErr(tr(lang, "Enter your full phone number with country code, e.g. +8801XXXXXXXXX.", "দেশের কোডসহ পুরো ফোন নম্বর লিখুন, যেমন +8801XXXXXXXXX।")); return; }
    if (phoneName.trim().length < 2) { setErr(tr(lang, "Enter your name for a new phone account.", "নতুন ফোন অ্যাকাউন্টের জন্য আপনার নাম লিখুন।")); return; }
    setErr(""); setBusy(true);
    const r = await startPhoneSignIn(num);
    setBusy(false);
    if (!r.ok || !r.confirmation) { setErr(r.error ?? tr(lang, "SMS code could not be sent.", "SMS কোড পাঠানো যায়নি।")); return; }
    setConfirmation(r.confirmation); setPhoneStep("code");
  };
  const verifyCode = async () => {
    if (!confirmation) return;
    if (!/^\d{6}$/.test(phoneCode.trim())) { setErr(tr(lang, "Enter the 6-digit SMS code.", "৬-অঙ্কের SMS কোডটি লিখুন।")); return; }
    setErr(""); setBusy(true);
    const r = await confirmPhoneCode(confirmation, phoneCode.trim(), phoneName);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? tr(lang, "Phone sign-in failed.", "ফোন সাইন-ইন ব্যর্থ হয়েছে।")); return; }
    onSignedIn();
  };
  return (
    <div className="login-hero">
      <div className="glass-login">
      <div className="logo-tile mx-auto" style={{ width: 88, height: 88 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
      <h1 className="serif text-center" style={{ fontSize: 24, marginTop: 10 }}>{tr(lang, "Log in to Café Reza", "ক্যাফে রেজা-এ লগইন করুন")}</h1>
      <p className="small muted text-center">{tr(lang, "Sign in with Google, Facebook or your phone number — new here? The same buttons create your account. New accounts are always customers. No password, no email verification step.", "Google, Facebook বা ফোন নম্বর দিয়ে সাইন-ইন করুন — নতুন হলে একই বোতামে অ্যাকাউন্ট তৈরি হবে। নতুন অ্যাকাউন্ট সবসময় কাস্টমার। কোনো পাসওয়ার্ড ও কোনো ইমেইল যাচাইয়ের ধাপ নেই।")}</p>
      {isInAppBrowser() && (
        <div className="card" role="alert" style={{ marginTop: 12, padding: 12, border: "1px solid var(--bad)", background: "rgba(224,120,86,.12)" }}>
          <b>{tr(lang, "Open in Chrome to sign in", "সাইন-ইন করতে Chrome-এ খুলুন")}</b>
          <p className="small" style={{ margin: "6px 0 0" }}>{tr(lang, "You opened this inside Messenger/Facebook's built-in browser. Google and Facebook sign-in do not work here. Tap ⋯ at the top, choose “Open in Chrome”, then sign in.", "আপনি মেসেঞ্জার/ফেসবুকের ভেতরের ব্রাউজার থেকে খুলেছেন। এখানে Google/Facebook দিয়ে সাইন-ইন কাজ করবে না। ওপরের ⋯ (তিন ডট) চেপে “Open in Chrome” / “Chrome-এ খুলুন” চাপুন, তারপর সাইন-ইন করুন।")}</p>
        </div>
      )}
      <button type="button" disabled={busy} className="btn-ghost" style={{ width: "100%", marginTop: 14, background: "#fff", color: "#24150f", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px" }} onClick={() => void onSocial("google")} aria-label="Login with Gmail"><GoogleG /> Login with Gmail</button>
      <button type="button" disabled={busy} style={{ width: "100%", marginTop: 8, background: "#1877f2", color: "#fff", border: "none", borderRadius: 999, padding: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={() => void onSocial("facebook")} aria-label="Continue with Facebook"><span aria-hidden="true" style={{ display: "flex", width: 20, height: 20, borderRadius: "50%", background: "#fff", color: "#1877f2", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>f</span>{tr(lang, "Continue with Facebook", "Facebook দিয়ে চালিয়ে যান")}</button>
      {!showPhone && <button type="button" className="btn-gold" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowPhone(true)}>{tr(lang, "Continue with phone number", "ফোন নম্বর দিয়ে চালিয়ে যান")}</button>}
      {showPhone && (
        <div style={{ marginTop: 14 }}>
          <label>{tr(lang, "Your name", "আপনার নাম")}<input aria-label="Your name" value={phoneName} onChange={(e) => setPhoneName(e.target.value)} placeholder={tr(lang, "e.g. Md. Yeasin Reza", "যেমন: মো: ইয়াছিন রেজা")} /></label>
          <label>{tr(lang, "Phone number (with country code)", "ফোন নম্বর (দেশের কোডসহ)")}<input aria-label="Phone number with country code" inputMode="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+8801XXXXXXXXX" /></label>
          {phoneStep === "code" && <label>{tr(lang, "6-digit SMS code", "৬-অঙ্কের SMS কোড")}<input aria-label="SMS verification code" inputMode="numeric" value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="••••••" /></label>}
          {phoneStep === "number"
            ? <button type="button" className="btn-gold" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => void sendCode()}>{tr(lang, "Send SMS code", "SMS কোড পাঠান")}</button>
            : <button type="button" className="btn-gold" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => void verifyCode()}>{tr(lang, "Verify code & sign in", "কোড যাচাই করে সাইন-ইন করুন")}</button>}
          <div id="recaptcha-container" aria-hidden="true" />
        </div>
      )}
      {note && <p className="small" role="status" style={{ marginTop: 10 }}>{note}</p>}
      {err && <p className="small" role="alert" style={{ marginTop: 10, color: "var(--bad)" }}>{err}</p>}
      </div>
    </div>
  );
}

function DetailModal({ p, categories, lang, onClose, onAdd, wishlisted, onWish, fbUser, userDoc }: {
  p: Product; categories: Category[]; lang: Lang; onClose: () => void;
  onAdd: (extra: { qty: number; size: string; sugar: string; milk: string; note: string }) => void;
  wishlisted: boolean; onWish: () => void; fbUser: User | null; userDoc: UserDoc | null;
}) {
  const firestore = getDb();
  const [tab, setTab] = useState<"photo" | "ingredients">("photo");
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState("Regular");
  const [sugar, setSugar] = useState("Normal");
  const [milk, setMilk] = useState("Normal");
  const [note, setNote] = useState("");
  const catName = categories.find((c) => c.id === p.categoryId);
  // Reviews for this product: approved ones only, newest first.
  // A new review is created as Pending — staff approve it in the
  // admin Support tab before it appears here.
  const { data: approvedReviews } = useLive<Review>(
    () => (firestore ? query(collection(firestore, "reviews"), where("status", "==", "Approved"), limit(200)) : null),
    reviewFromDoc,
  );
  const { data: myOrders } = useLive<Order>(
    () => (firestore && fbUser ? query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc"), limit(200)) : null),
    orderFromDoc,
  );
  const reviews = approvedReviews.filter((r) => r.productId === p.slug).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const hasOrdered = (myOrders ?? []).some((o) => o.items.some((i) => i.productId === p.slug));
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewMsg, setReviewMsg] = useState("");
  const [reviewed, setReviewed] = useState(() => {
    try { return !!fbUser && localStorage.getItem(`cr_reviewed_${fbUser.uid}_${p.slug}`) === "1"; } catch { return false; }
  });
  const submitReview = async () => {
    if (!firestore || !fbUser || !hasOrdered || !comment.trim()) return;
    await addDoc(collection(firestore, "reviews"), {
      productId: p.slug, author: userDoc?.name || fbUser.displayName || fbUser.email || "Customer",
      authorId: fbUser.uid, rating, comment: comment.trim(), status: "Pending", createdAt: serverTimestamp(),
    });
    try { localStorage.setItem(`cr_reviewed_${fbUser.uid}_${p.slug}`, "1"); } catch { /* best-effort */ }
    setReviewed(true);
    setReviewMsg(tr(lang, "Thank you! Your review is with the admin for approval and will show here once approved.", "ধন্যবাদ! আপনার রিভিউ অনুমোদনের জন্য অ্যাডমিনের কাছে গেছে — অনুমোদন হলে এখানে দেখাবে।"));
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={p.nameEn} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="serif" style={{ fontSize: 22 }}>{displayName(p, lang)}</h2>
          <button className="btn-ghost" aria-label="Close details" onClick={onClose}>✕</button>
        </div>
        <p className="small muted">{catName ? (lang === "bn" ? catName.nameBn : catName.nameEn) : ""} • {p.prepTime} {tr(lang, "min", "মিনিট")}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className={`chip ${tab === "photo" ? "chip-on" : ""}`} onClick={() => setTab("photo")}>{tr(lang, "Photo", "ছবি")}</button>
          <button className={`chip ${tab === "ingredients" ? "chip-on" : ""}`} onClick={() => setTab("ingredients")}>{tr(lang, "Ingredients", "উপকরণ")}</button>
          <button className="chip" onClick={onWish}>{wishlisted ? "♥ " : "♡ "}{tr(lang, "Favourite", "প্রিয়")}</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {tab === "photo" ? <ProductImage p={p} h={260} /> : <IngredientPoster p={p} lang={lang} />}
        </div>
        <p style={{ marginTop: 10 }}>{lang === "bn" ? p.description : p.description}</p>
        {p.ingredients && <p className="small muted" style={{ marginTop: 4 }}>{tr(lang, "Ingredients:", "উপকরণ:")} {p.ingredients}</p>}
        <FoodInfo p={p} lang={lang} />
        <p style={{ fontSize: 20, fontWeight: 700 }}>{orderable(p) ? tk(effPrice(p)) : tr(lang, "Price coming soon", "দাম আসছে")}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Size", "সাইজ")}<select aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}><option>Regular</option><option>Large</option><option>Small</option></select></label>
          <label style={{ flex: 1 }}>{tr(lang, "Sugar", "চিনি")}<select aria-label="Sugar" value={sugar} onChange={(e) => setSugar(e.target.value)}><option>Normal</option><option>Less</option><option>More</option><option>None</option></select></label>
          <label style={{ flex: 1 }}>{tr(lang, "Milk", "দুধ")}<select aria-label="Milk" value={milk} onChange={(e) => setMilk(e.target.value)}><option>Normal</option><option>Less</option><option>More</option><option>None</option></select></label>
        </div>
        <label>{tr(lang, "Note (optional)", "নোট (ঐচ্ছিক)")}<input aria-label="Order note" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="chip" aria-label="Decrease quantity" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <b>{qty}</b>
          <button className="chip" aria-label="Increase quantity" onClick={() => setQty(qty + 1)}>+</button>
          <button className="btn-gold" style={{ flex: 1 }} disabled={!orderable(p)} onClick={() => onAdd({ qty, size, sugar, milk, note })}>{tr(lang, "Add to cart", "কার্টে যোগ করুন")} • {tk(effPrice(p) * qty)}</button>
        </div>
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <h3 className="serif" style={{ fontSize: 18 }}>{tr(lang, "Reviews", "রিভিউ")}</h3>
          {reviews.length > 0 ? (
            <p><Stars rating={avg} /> <b>{avg.toFixed(1)}</b> <span className="small muted">({reviews.length} {tr(lang, "reviews", "টি রিভিউ")})</span></p>
          ) : (
            <p className="small muted">{tr(lang, "No reviews yet — be the first to review it after ordering.", "এখনো কোনো রিভিউ নেই — অর্ডার করে প্রথম রিভিউ দিন।")}</p>
          )}
          {reviews.map((r) => (
            <div key={r.id} className="card" style={{ padding: "8px 10px", marginTop: 6 }}>
              <div className="row" style={{ justifyContent: "space-between" }}><b>{r.author}</b><Stars rating={r.rating} size={13} /></div>
              <p style={{ margin: "4px 0 0" }}>{r.comment}</p>
            </div>
          ))}
          {!fbUser && <p className="small muted" style={{ marginTop: 10 }}>{tr(lang, "Sign in and order this item to leave a review.", "রিভিউ দিতে সাইন-ইন করে এই আইটেমটি অর্ডার করুন।")}</p>}
          {fbUser && !hasOrdered && <p className="small muted" style={{ marginTop: 10 }}>{tr(lang, "Only customers who ordered this item can review it.", "শুধু যাঁরা এই আইটেমটি অর্ডার করেছেন, তাঁরাই রিভিউ দিতে পারবেন।")}</p>}
          {fbUser && hasOrdered && !reviewed && (
            <div style={{ marginTop: 10 }}>
              <div className="row" role="radiogroup" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className="chip" aria-label={`${n} stars`} onClick={() => setRating(n)} style={{ fontSize: 20, color: n <= rating ? "var(--gold)" : "var(--muted)" }}>{n <= rating ? "★" : "☆"}</button>
                ))}
              </div>
              <input aria-label="Your review" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr(lang, "Write a short review…", "ছোট করে রিভিউ লিখুন…")} style={{ marginTop: 8 }} />
              <button className="btn-gold" style={{ marginTop: 8 }} disabled={!comment.trim()} onClick={() => void submitReview()}>{tr(lang, "Submit review", "রিভিউ জমা দিন")}</button>
            </div>
          )}
          {reviewMsg && <p className="small" role="status" style={{ marginTop: 8 }}>{reviewMsg}</p>}
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, setCart, products, settings, fbUser, userDoc, lang, initialTable }: {
  open: boolean; onClose: () => void; cart: CartItem[]; setCart: (c: CartItem[]) => void;
  products: Product[]; settings: Settings; fbUser: User | null; userDoc: UserDoc | null; lang: Lang;
  initialTable?: string;
}) {
  const [step, setStep] = useState<"cart" | "checkout" | "done">("cart");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orderType, setOrderType] = useState("delivery");
  const [tableLabel, setTableLabel] = useState("");
  const [payment, setPayment] = useState("Cash on Delivery");
  const [coupon, setCoupon] = useState("");
  const [redeem, setRedeem] = useState(false);
  const [couponInfo, setCouponInfo] = useState<{ status: "idle" | "ok" | "error"; discount: number; note: string; checkedSubtotal: number }>({ status: "idle", discount: 0, note: "", checkedSubtotal: -1 });
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneNo, setDoneNo] = useState("");
  const [doneTotal, setDoneTotal] = useState(0);
  const [doneReceipt, setDoneReceipt] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  useEffect(() => {
    if (open) {
      setStep("cart"); setErr(""); window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      // Table QR handoff: a scanned table QR opens the menu with
      // ?table=T1 in the URL — prefill dine-in with that table, but
      // only when the customer has not already picked a table.
      if (initialTable) {
        if (tableLabel === "") setOrderType("dine-in");
        setTableLabel((v) => (v === "" ? initialTable : v));
      }
      // Coupon wallet handoff: the Account "Use coupon" button stores
      // the code and opens the cart — pick it up once, then clear it.
      try {
        const walletCode = localStorage.getItem("cr_wallet_coupon");
        if (walletCode) {
          localStorage.removeItem("cr_wallet_coupon");
          setCoupon(walletCode.toUpperCase());
          void checkCoupon(walletCode);
        }
      } catch { /* wallet handoff is best-effort */ }
    }
  }, [open, initialTable ]);
  // Prefill only empty fields: never overwrite what the user already typed.
  // The old unconditional fill wiped a typed phone number whenever the
  // profile snapshot re-fired while the drawer was open.
  useEffect(() => {
    if (!userDoc) return;
    setName((v) => (v === "" ? userDoc.name : v));
    setPhone((v) => (v === "" ? userDoc.phone : v));
  }, [userDoc]);
  if (!open) return null;
  const lines: CartLine[] = cart.map((c) => {
    const p = products.find((x) => x.slug === c.productId);
    return p ? { product: p, qty: c.qty, size: c.size, sugar: c.sugar, milk: c.milk, note: c.note } : null;
  }).filter((l): l is CartLine => l !== null);
  const subtotal = lines.reduce((a, l) => a + effPrice(l.product) * l.qty, 0);
  // The same discount math as placeOrderTx, so the price shown here is
  // the price actually charged. VAT and the free-delivery threshold
  // both use the after-discount amount, exactly like the transaction.
  const combo = comboDiscount(lines.map((l) => ({ qty: l.qty })), settings.comboMinQty ?? COMBO_MIN_QTY, settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE);
  const happy = happyHourDiscount(subtotal, new Date(), timeToMin(settings.happyHourStart ?? HAPPY_HOUR_START), timeToMin(settings.happyHourEnd ?? HAPPY_HOUR_END), settings.happyHourPercent ?? HAPPY_HOUR_PERCENT);
  // Coupon preview: the customer checks the code before ordering, so
  // they see the discount (or a clear reason it does not apply) up
  // front. The preview is only used when the cart has not changed
  // since the check — otherwise the button must be tapped again —
  // and the transaction re-validates the coupon when placing the
  // order, so the preview can never promise a discount the order
  // will not actually get.
  const couponDisc = couponInfo.status === "ok" && couponInfo.checkedSubtotal === subtotal ? couponInfo.discount : 0;
  // Loyalty redemption: every `loyaltyRedeemPoints` points are worth
  // `loyaltyRedeemValue` off. The checkbox spends all the blocks the
  // customer has; the transaction clamps it to their real balance.
  const redeemPoints = settings.loyaltyRedeemPoints || 100;
  const redeemValue = settings.loyaltyRedeemValue || 0;
  const maxRedeemBlocks = userDoc && redeemPoints > 0 && redeemValue > 0 ? Math.floor(userDoc.loyaltyPoints / redeemPoints) : 0;
  const redeemBlocks = redeem && maxRedeemBlocks > 0 ? maxRedeemBlocks : 0;
  const loyaltyDisc = Math.min(subtotal, redeemBlocks * redeemValue);
  const discount = Math.min(subtotal, combo + happy + couponDisc + loyaltyDisc);
  const afterDiscount = Math.max(0, subtotal - discount);
  const vat = Math.round((afterDiscount * settings.vatPercent) / 100);
  const fee = orderType === "delivery" ? (settings.freeDeliveryAt > 0 && afterDiscount >= settings.freeDeliveryAt ? 0 : settings.deliveryFee) : 0;
  const total = afterDiscount + vat + fee;
  const payments = enabledPayments(settings.paymentsJson);
  const checkCoupon = async (codeOverride?: string) => {
    const code = (codeOverride ?? coupon).trim().toUpperCase();
    if (!code) { setCouponInfo({ status: "idle", discount: 0, note: "", checkedSubtotal: -1 }); return; }
    const firestore = getDb();
    if (!firestore) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "Could not check the coupon.", "কুপন যাচাই করা যায়নি।"), checkedSubtotal: -1 }); return; }
    try {
      const snap = await getDoc(doc(firestore, "coupons", code));
      if (!snap.exists()) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "Coupon code not found.", "কুপন কোড পাওয়া যায়নি।"), checkedSubtotal: -1 }); return; }
      const c = snap.data() as { active?: boolean; kind?: string; value?: number; minPurchase?: number; maxDiscount?: number | null; expiresAt?: string; firstOrderOnly?: boolean };
      if (!c.active) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "This coupon is not active.", "এই কুপনটি সক্রিয় নয়।"), checkedSubtotal: -1 }); return; }
      if (c.expiresAt && c.expiresAt < new Date().toISOString().slice(0, 10)) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "This coupon has expired.", "এই কুপনের মেয়াদ শেষ।"), checkedSubtotal: -1 }); return; }
      if (Number(c.minPurchase ?? 0) > subtotal) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, `This coupon needs a minimum purchase of ৳${c.minPurchase}.`, `এই কুপনে সর্বনিম্ন ${c.minPurchase} টাকা কেনাকাটা লাগবে।`), checkedSubtotal: -1 }); return; }
      if (c.firstOrderOnly) {
        if (!fbUser) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "Sign in to use this first-order coupon.", "এই প্রথম-অর্ডারের কুপন ব্যবহার করতে সাইন-ইন করুন।"), checkedSubtotal: -1 }); return; }
        const prior = await getDocs(query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), limit(1)));
        if (!prior.empty) { setCouponInfo({ status: "error", discount: 0, note: tr(lang, "This coupon is only for your first order — you already have an order.", "এই কুপন শুধু আপনার প্রথম অর্ডারের জন্য — আপনার আগের অর্ডার আছে।"), checkedSubtotal: -1 }); return; }
      }
      let d = c.kind === "percent" ? Math.round((subtotal * Number(c.value ?? 0)) / 100) : Number(c.value ?? 0);
      if (c.maxDiscount != null) d = Math.min(d, Number(c.maxDiscount));
      d = Math.min(d, subtotal);
      setCouponInfo({ status: "ok", discount: d, note: tr(lang, `Coupon ${code} applied: ৳${d} off`, `কুপন ${code} লেগেছে: ${d} টাকা ছাড়`), checkedSubtotal: subtotal });
    } catch {
      setCouponInfo({ status: "error", discount: 0, note: tr(lang, "Could not check the coupon.", "কুপন যাচাই করা যায়নি।"), checkedSubtotal: -1 });
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fbUser) { setErr(tr(lang, "Sign in first — orders need a signed-in account (Google, Facebook or phone).", "আগে সাইন-ইন করুন — অর্ডারের জন্য সাইন-ইন করা অ্যাকাউন্ট লাগবে (Google, Facebook বা ফোন)।")); return; }
    // A coupon that was already checked and rejected must not be
    // submitted — the order would fail in the transaction and the
    // customer would only see a spinner that reverts with no clear
    // reason. Show the coupon's own message here instead, so they
    // know to remove or change the code before ordering.
    if (coupon.trim() && couponInfo.status === "error") {
      setErr(couponInfo.note || tr(lang, "The coupon code is not valid — remove it or check it again before ordering.", "কুপন কোডটি ঠিক নয় — অর্ডারের আগে সেটি সরান বা আবার যাচাই করুন।"));
      return;
    }
    setErr(""); setBusy(true);
    const r = await placeOrderTx({
      uid: fbUser.uid, customerName: name.trim(), phone: phone.trim(), address: address.trim(),
      orderType, source: "website", paymentMethod: payment, paymentRef: ref.trim(),
      tableLabel: orderType === "dine-in" ? tableLabel.trim() : "", notes: "", staffName: "",
      couponCode: coupon, lines, settings, paidAmount: 0, redeemBlocks,
    });
    setBusy(false);
    if (!r.ok || !r.orderNo) { setErr(r.error ?? tr(lang, "Order failed.", "অর্ডার ব্যর্থ হয়েছে।")); return; }
    try {
      const recent = JSON.parse(localStorage.getItem("cr_recent_orders") ?? "[]") as Array<{ orderNo: string; phone: string }>;
      localStorage.setItem("cr_recent_orders", JSON.stringify([{ orderNo: r.orderNo, phone: phone.trim() }, ...recent].slice(0, 20)));
    } catch { /* recents are best-effort */ }
    setDoneNo(r.orderNo); setDoneTotal(r.total ?? total); setDoneReceipt(r.receipt ?? null);
    setCart([]); setStep("done");
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={tr(lang, "Your cart", "আপনার কার্ট")}>
      <div className="modal-backdrop" style={{ alignItems: "stretch", justifyContent: "flex-end", padding: 0 }} onClick={onClose} />
      <div className="drawer" style={{ display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="serif" style={{ fontSize: 22 }}>{tr(lang, "Your cart", "আপনার কার্ট")}</h2>
          <button className="btn-ghost" aria-label="Close cart" onClick={onClose}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {step === "done" ? (
            <div style={{ textAlign: "center", paddingTop: 30 }}>
              <p className="serif" style={{ fontSize: 26, fontWeight: 700 }}>{tr(lang, "Order placed!", "অর্ডার হয়ে গেছে!")}</p>
              <p>{tr(lang, "Order number:", "অর্ডার নম্বর:")} <b>{doneNo}</b></p>
              <p>{tr(lang, "Total:", "মোট:")} <b>{tk(doneTotal)}</b></p>
              <p className="small muted">{tr(lang, "Track it from the Track page.", "ট্র্যাক পেজ থেকে এটি ট্র্যাক করুন।")}</p>
              {doneReceipt && <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowReceipt(true)}>🧾 {tr(lang, "View receipt", "রিসিট দেখুন")}</button>}
              <button className="btn-gold" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>{tr(lang, "Done", "সম্পন্ন")}</button>
            </div>
          ) : step === "cart" ? (
            <>
              {lines.length === 0 && <p className="muted" style={{ marginTop: 12 }}>{tr(lang, "Your cart is empty. Browse the menu and add something tasty.", "আপনার কার্ট খালি। মেনু দেখে কিছু যোগ করুন।")}</p>}
              {lines.map((l, i) => (
                <div key={i} className="card" style={{ marginTop: 10, padding: 10, display: "flex", gap: 10 }}>
                  <div style={{ width: 64, flex: "none", overflow: "hidden", borderRadius: 10 }}><ProductImage p={l.product} h={64} /></div>
                  <div style={{ flex: 1 }}>
                    <b>{displayName(l.product, lang)}</b>
                    <p className="small muted">{l.size} • {l.sugar} • {l.milk}{l.note ? ` • ${l.note}` : ""}</p>
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="chip" aria-label="Decrease quantity" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}>−</button>
                      <b>{l.qty}</b>
                      <button className="chip" aria-label="Increase quantity" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: c.qty + 1 } : c))}>+</button>
                      <button className="btn-ghost" style={{ marginLeft: "auto", padding: "6px 10px" }} onClick={() => setCart(cart.filter((_, j) => j !== i))}>{tr(lang, "Remove", "সরান")}</button>
                    </div>
                  </div>
                  <b>{tk(effPrice(l.product) * l.qty)}</b>
                </div>
              ))}
            </>
          ) : (
            <form id="fb-checkout-form" onSubmit={(e) => void submit(e)} style={{ marginTop: 10 }}>
              {!fbUser && <p className="small" style={{ color: "var(--bad)" }}>{tr(lang, "Sign in to place an order — use Google, Facebook or phone from My Account.", "অর্ডার করতে সাইন-ইন করুন — My Account থেকে Google, Facebook বা ফোন ব্যবহার করুন।")}</p>}
              <label>{tr(lang, "Full name", "পুরো নাম")}<input aria-label="Full name" required value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label>{tr(lang, "Phone", "ফোন")}<input aria-label="Phone number" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <label>{tr(lang, "Order type", "অর্ডারের ধরন")}<select aria-label="Order type" value={orderType} onChange={(e) => setOrderType(e.target.value)}><option value="delivery">{tr(lang, "Home delivery", "হোম ডেলিভারি")}</option><option value="takeaway">{tr(lang, "Takeaway", "টেকঅ্যাওয়ে")}</option><option value="dine-in">{tr(lang, "Dine-in", "ডাইন-ইন")}</option></select></label>
              {orderType === "delivery" && (
                <>
                  {(userDoc?.savedAddresses ?? []).length > 0 && (
                    <label>{tr(lang, "Use a saved address", "সংরক্ষিত ঠিকানা ব্যবহার করুন")}<select aria-label="Saved address" value="" onChange={(e) => { if (e.target.value) setAddress(e.target.value); }}>
                      <option value="">{tr(lang, "Choose a saved address…", "সংরক্ষিত ঠিকানা বেছে নিন…")}</option>
                      {(userDoc?.savedAddresses ?? []).map((a, i) => <option key={`${a.address}-${i}`} value={a.address}>{a.label ? `${a.label} — ${a.address}` : a.address}</option>)}
                    </select></label>
                  )}
                  <label>{tr(lang, "Delivery address", "ডেলিভারির ঠিকানা")}<input aria-label="Delivery address" required value={address} onChange={(e) => setAddress(e.target.value)} /></label>
                </>
              )}
              {orderType === "dine-in" && <label>{tr(lang, "Table", "টেবিল")}<input aria-label="Dine-in table" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} placeholder="T1" /></label>}
              <label>{tr(lang, "Payment method", "পেমেন্ট মাধ্যম")}<select aria-label="Payment method" value={payment} onChange={(e) => setPayment(e.target.value)}>{payments.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
              {["bKash", "Nagad", "Rocket", "Bank Transfer"].includes(payment) && (
                <div className="card" style={{ padding: 10, marginTop: 8 }}>
                  <p className="small"><b>{tr(lang, "Manual verification only.", "শুধু ম্যানুয়াল যাচাই।")}</b> {settings.paymentNote}</p>
                  <p className="small">{tr(lang, "Send to", "পাঠান")}: <b>{payment === "bKash" ? settings.bkashNumber : payment === "Nagad" ? settings.nagadNumber : payment === "Rocket" ? settings.rocketNumber : ""}</b></p>
                  <label>{tr(lang, "Transaction / reference ID", "লেনদেন / রেফারেন্স আইডি")}<input aria-label="Transaction reference ID" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
                </div>
              )}
              <label>{tr(lang, "Coupon code (optional)", "কুপন কোড (ঐচ্ছিক)")}<input aria-label="Coupon code" value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponInfo({ status: "idle", discount: 0, note: "", checkedSubtotal: -1 }); }} /></label>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn-ghost" type="button" onClick={() => void checkCoupon()}>{tr(lang, "Check coupon", "কুপন যাচাই করুন")}</button>
                {couponInfo.status !== "idle" && <span className="small" role="status" style={{ color: couponInfo.status === "ok" ? "var(--good)" : "var(--bad)", fontWeight: 700 }}>{couponInfo.note}</span>}
                {couponInfo.status === "ok" && couponInfo.checkedSubtotal !== subtotal && <span className="small muted">{tr(lang, "Cart changed — check the coupon again.", "কার্ট বদলেছে — কুপন আবার যাচাই করুন।")}</span>}
              </div>
              {maxRedeemBlocks > 0 && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={redeem} onChange={(e) => setRedeem(e.target.checked)} />
                  <span>{lang === "bn" ? `লয়্যালটি পয়েন্ট ব্যবহার করুন — ${maxRedeemBlocks * redeemValue} টাকা ছাড় (${userDoc?.loyaltyPoints ?? 0} পয়েন্ট)` : `Use loyalty points — ৳${maxRedeemBlocks * redeemValue} off (${userDoc?.loyaltyPoints ?? 0} points)`}</span>
                </label>
              )}
              <div style={{ marginTop: 10, fontSize: 14 }}>
                <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Subtotal", "সাবটোটাল")}</span><span>{tk(subtotal)}</span></div>
                {combo > 0 && <div className="row" style={{ justifyContent: "space-between", color: "var(--good)", fontWeight: 700 }}><span>{lang === "bn" ? `কম্বো ছাড় (এক আইটেম ${settings.comboMinQty ?? COMBO_MIN_QTY}টা+ → ${settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE} টাকা ছাড়)` : `Combo discount (${settings.comboMinQty ?? COMBO_MIN_QTY}+ of one item → ৳${settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE} off)`}</span><span>−{tk(combo)}</span></div>}
                {happy > 0 && <div className="row" style={{ justifyContent: "space-between", color: "var(--good)", fontWeight: 700 }}><span>{tr(lang, "Happy Hour discount", "হ্যাপি আওয়ার ছাড়")} ({settings.happyHourPercent ?? HAPPY_HOUR_PERCENT}%)</span><span>−{tk(happy)}</span></div>}
                {couponDisc > 0 && <div className="row" style={{ justifyContent: "space-between", color: "var(--good)", fontWeight: 700 }}><span>{tr(lang, "Coupon discount", "কুপন ছাড়")} ({coupon.trim().toUpperCase()})</span><span>−{tk(couponDisc)}</span></div>}
                {loyaltyDisc > 0 && <div className="row" style={{ justifyContent: "space-between", color: "var(--good)", fontWeight: 700 }}><span>{tr(lang, "Loyalty points discount", "লয়্যালটি পয়েন্ট ছাড়")} ({redeemBlocks * redeemPoints} {tr(lang, "points", "পয়েন্ট")})</span><span>−{tk(loyaltyDisc)}</span></div>}
                <div className="row" style={{ justifyContent: "space-between" }}><span>VAT ({settings.vatPercent}%)</span><span>{tk(vat)}</span></div>
                <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Delivery", "ডেলিভারি")}</span><span>{fee === 0 ? tr(lang, "Free", "ফ্রি") : tk(fee)}</span></div>
                <div className="row" style={{ justifyContent: "space-between", fontWeight: 700, fontSize: 16 }}><span>{tr(lang, "Total", "মোট")}</span><span>{tk(total)}</span></div>
              </div>
              {err && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{err}</p>}
            </form>
          )}
        </div>
        {/* Sticky footer: the total and the checkout/confirm action are
            always visible — no scrolling is needed to reach them. */}
        {step !== "done" && lines.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="small muted">{tr(lang, "Subtotal", "সাবটোটাল")}</span><b>{tk(subtotal)}</b></div>
            {combo > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span className="small" style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Combo discount", "কম্বো ছাড়")}</span><b style={{ color: "var(--good)" }}>−{tk(combo)}</b></div>}
            {happy > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span className="small" style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Happy Hour discount", "হ্যাপি আওয়ার ছাড়")} ({settings.happyHourPercent ?? HAPPY_HOUR_PERCENT}%)</span><b style={{ color: "var(--good)" }}>−{tk(happy)}</b></div>}
            {couponDisc > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span className="small" style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Coupon discount", "কুপন ছাড়")} ({coupon.trim().toUpperCase()})</span><b style={{ color: "var(--good)" }}>−{tk(couponDisc)}</b></div>}
            {loyaltyDisc > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span className="small" style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Loyalty points discount", "লয়্যালটি পয়েন্ট ছাড়")}</span><b style={{ color: "var(--good)" }}>−{tk(loyaltyDisc)}</b></div>}
            {step === "cart"
              ? <button className="btn-gold" style={{ width: "100%", marginTop: 8, padding: "12px" }} onClick={() => setStep("checkout")}>{tr(lang, "Go to checkout", "চেকআউটে যান")}</button>
              : <>
                  <button className="btn-gold" style={{ width: "100%", marginTop: 8, padding: "12px" }} type="submit" form="fb-checkout-form" disabled={busy}>{busy ? tr(lang, "Placing…", "অর্ডার হচ্ছে…") : `${tr(lang, "Place order", "অর্ডার করুন")} • ${tk(total)}`}</button>
                  <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setStep("cart")}>{tr(lang, "Back to cart", "কার্টে ফিরুন")}</button>
                </>}
          </div>
        )}
      </div>
      {showReceipt && doneReceipt && <ReceiptModal order={doneReceipt} settings={settings} products={products} lang={lang} onClose={() => setShowReceipt(false)} />}
    </div>
  );
}

const TRACK_STAGES = ["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered"];

// A clock that ticks every `intervalMs` so time-sensitive UI (the
// open-now badge, the cancel window) updates without a reload.
function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Whether a customer may still cancel this order themselves: only
// while it is Pending/Confirmed and inside the cancel window (an
// admin setting, in minutes) from when it was placed.
function cancelRemainingMs(o: Order, settings: Settings, now: number): number {
  if (o.status !== "Pending" && o.status !== "Confirmed") return 0;
  const created = Date.parse(o.createdAt);
  if (!created) return 0;
  return (settings.cancelWindowMinutes ?? 2) * 60 * 1000 - (now - created);
}

// Estimated arrival / ready time from the order's real createdAt
// plus the admin's prep and delivery minutes (Settings). Delivery
// orders add both; takeaway/dine-in add prep only. Ended orders
// (Delivered, Completed, Cancelled, Refunded) have no ETA. The time
// is an estimate from the kitchen's usual pace, never a promise.
function orderEta(o: Order, settings: Settings): Date | null {
  if (o.status === "Cancelled" || o.status === "Refunded" || o.status === "Delivered" || o.status === "Completed") return null;
  const created = Date.parse(o.createdAt);
  if (!created) return null;
  const prep = settings.prepMinutes ?? 20;
  const del = o.orderType === "delivery" ? (settings.deliveryMinutes ?? 20) : 0;
  return new Date(created + (prep + del) * 60000);
}

// The customer cancel button, shared by the Track page and the
// Account order list. It only renders inside the window — after the
// window lapses it disappears entirely — and it asks for
// confirmation, cancels through the transaction (stock comes back),
// and reports the result in place.
function CancelOrderButton({ order, uid, settings, lang }: { order: Order; uid: string; settings: Settings; lang: Lang }) {
  const now = useNow(15000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const remaining = cancelRemainingMs(order, settings, now);
  if (remaining <= 0) return null;
  const secs = Math.ceil(remaining / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  const cancel = async () => {
    const ok = window.confirm(tr(lang, `Cancel order ${order.orderNo}? The items go back to stock.`, `অর্ডার ${order.orderNo} বাতিল করবেন? আইটেমগুলো স্টকে ফিরে যাবে।`));
    if (!ok) return;
    setBusy(true); setMsg("");
    const r = await cancelOrderTx({ uid, orderId: order.id, cancelWindowMinutes: settings.cancelWindowMinutes ?? 2, isStaff: false });
    setBusy(false);
    setMsg(r.ok ? tr(lang, "Order cancelled.", "অর্ডার বাতিল হয়েছে।") : (r.error ?? tr(lang, "Could not cancel the order.", "অর্ডার বাতিল করা যায়নি।")));
  };
  return (
    <span>
      <button className="btn-danger" style={{ padding: "6px 12px" }} disabled={busy} onClick={() => void cancel()}>{busy ? tr(lang, "Cancelling…", "বাতিল হচ্ছে…") : tr(lang, "Cancel order", "অর্ডার বাতিল করুন")}</button>
      <span className="small muted" style={{ marginLeft: 8 }}>{tr(lang, "You can cancel for", "বাতিল করা যাবে")} {mm}:{ss}</span>
      {msg && <span className="small" role="status" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}
// Order status in the customer's language, with a clear badge colour:
// gold = waiting / in progress, green = done, red = cancelled / refunded.
const STATUS_BN: Record<string, string> = {
  Pending: "অপেক্ষমাণ", Confirmed: "নিশ্চিত", Preparing: "তৈরি হচ্ছে",
  Ready: "প্রস্তুত", "Out for Delivery": "ডেলিভারির পথে", Delivered: "ডেলিভার্ড",
  Completed: "সম্পন্ন", Cancelled: "বাতিল", Refunded: "ফেরত দেওয়া হয়েছে",
};
const PAYMENT_STATUS_BN: Record<string, string> = {
  Unpaid: "অপরিশোধিত", Paid: "পরিশোধিত", "Pending verification": "যাচাইয়ের অপেক্ষায়",
};
const statusLabel = (s: string, lang: Lang) => (lang === "bn" ? (STATUS_BN[s] ?? s) : s);
const paymentStatusLabel = (s: string, lang: Lang) => (lang === "bn" ? (PAYMENT_STATUS_BN[s] ?? s) : s);
const statusBadgeStyle = (s: string) => {
  if (s === "Cancelled" || s === "Refunded") return { background: "var(--bad)", color: "#fff" };
  if (s === "Delivered" || s === "Completed") return { background: "var(--good)", color: "#fff" };
  return { background: "var(--gold)", color: "#1a1207" };
};
const orderItemName = (products: Product[], it: { productId: string; name: string }, lang: Lang) => {
  const p = products.find((x) => x.slug === it.productId);
  return p ? displayName(p, lang) : it.name;
};
// Dates are shown day-first (DD/MM/YYYY), never the US month-first
// order: a reservation date "2026-11-05" reads 05/11/2026.
const fmtDate = (raw: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Reservation status in the customer's language — the customer
// sees "নিশ্চিত" when the admin confirms, never the raw English.
const reservationStatusLabel = (s: string, lang: Lang) =>
  s === "Confirmed" ? tr(lang, "Confirmed", "নিশ্চিত")
  : s === "Cancelled" ? tr(lang, "Cancelled", "বাতিল")
  : s === "Completed" ? tr(lang, "Completed", "সম্পন্ন")
  : tr(lang, "Pending", "অপেক্ষমাণ");

function TrackView({ fbUser, products, settings, lang }: { fbUser: User | null; products: Product[]; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const { data: orders, loading: ordersLoading, error: ordersError } = useLive<Order>(
    () => (firestore && fbUser ? query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    orderFromDoc,
  );
  const [search, setSearch] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const now = useNow(15000);
  if (!fbUser) return <p className="muted">{tr(lang, "Sign in to track your orders.", "অর্ডার ট্র্যাক করতে সাইন-ইন করুন।")}</p>;
  const shown = search.trim() ? orders.filter((o) => o.orderNo.toLowerCase().includes(search.trim().toLowerCase())) : orders;
  return (
    <div>
      <h2 className="serif" style={{ fontSize: 22 }}>{tr(lang, "Track your order", "অর্ডার ট্র্যাক করুন")}</h2>
      <label>{tr(lang, "Search by order number", "অর্ডার নম্বর দিয়ে খুঁজুন")}<input aria-label="Search by order number" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="CR-XXXXXX" /></label>
      {ordersError && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{tr(lang, "Could not load your orders. Please try again.", "আপনার অর্ডারগুলো লোড করা যায়নি। আবার চেষ্টা করুন।")}</p>}
      {ordersLoading && !ordersError && <p className="muted">{tr(lang, "Loading your orders…", "অর্ডারগুলো লোড হচ্ছে…")}</p>}
      {!ordersLoading && orders.length === 0 && !ordersError && <p className="muted">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {!ordersLoading && orders.length > 0 && shown.length === 0 && <p className="muted">{tr(lang, "No order matches this number.", "এই নম্বরের কোনো অর্ডার পাওয়া যায়নি।")}</p>}
      {shown.map((o) => {
        const isEnded = o.status === "Cancelled" || o.status === "Refunded";
        const stageIdx = o.status === "Completed" ? TRACK_STAGES.length - 1 : TRACK_STAGES.indexOf(o.status);
        const eta = orderEta(o, settings);
        const etaText = eta ? eta.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
        const etaPassed = eta ? now > eta.getTime() : false;
        const progressPct = stageIdx < 0 ? 0 : Math.round(((stageIdx + 1) / TRACK_STAGES.length) * 100);
        return (
          <div key={o.id} className="card" style={{ marginTop: 12, padding: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)}</span></div>
            <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
              <span className="chip" style={{ ...statusBadgeStyle(o.status), padding: "4px 10px", fontWeight: 700 }}>{statusLabel(o.status, lang)}</span>
              <span className="small muted">{o.paymentMethod} • {paymentStatusLabel(o.paymentStatus, lang)} • {o.createdAt ? new Date(o.createdAt).toLocaleString("en-GB") : ""}</span>
            </div>
            {!isEnded && (
              <>
                <div className="row" style={{ marginTop: 8 }}>
                  {TRACK_STAGES.map((s, i) => <span key={s} className={`chip ${i <= stageIdx ? "chip-on" : ""}`} style={{ padding: "4px 8px", fontSize: 12 }}>{statusLabel(s, lang)}</span>)}
                </div>
                <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, marginTop: 8 }}><div style={{ width: `${progressPct}%`, height: "100%", background: "var(--gold)", borderRadius: 4, transition: "width 0.5s ease" }} /></div>
                {eta && (
                  <p style={{ marginTop: 8, marginBottom: 0, fontWeight: 700 }}>
                    {o.orderType === "delivery"
                      ? (etaPassed
                        ? `🛵 ${tr(lang, "On the way — arriving soon", "ডেলিভারির পথে — শীঘ্রই পৌঁছাবে")}`
                        : `🛵 ${tr(lang, "Arriving around", "পৌঁছাবে আনুমানিক")} ${etaText}`)
                      : (etaPassed
                        ? `⏱️ ${tr(lang, "Almost ready", "প্রায় তৈরি")}`
                        : `⏱️ ${tr(lang, "Ready around", "তৈরি হবে আনুমানিক")} ${etaText}`)}
                  </p>
                )}
              </>
            )}
            <ul style={{ marginTop: 8, fontSize: 14 }}>{o.items.map((it, i) => <li key={i}>{it.qty} × {orderItemName(products, it, lang)}</li>)}</ul>
            <div style={{ marginTop: 8 }}>
              <CancelOrderButton order={o} uid={fbUser.uid} settings={settings} lang={lang} />
              <button className="btn-ghost" style={{ padding: "6px 12px", marginLeft: 8 }} onClick={() => setReceiptOrder(o)}>🧾 {tr(lang, "Receipt", "রিসিট")}</button>
              {!isEnded && cancelRemainingMs(o, settings, now) <= 0 && <span className="small muted">{tr(lang, "The cancellation window has passed — message the cafe in the chatbox if you need help.", "বাতিলের সময়সীমা পেরিয়ে গেছে — সাহায্য লাগলে চ্যাটবক্সে ক্যাফেকে মেসেজ করুন।")}</span>}
            </div>
          </div>
        );
      })}
      {receiptOrder && <ReceiptModal order={receiptOrder} settings={settings} products={products} lang={lang} onClose={() => setReceiptOrder(null)} />}
    </div>
  );
}

function ReserveView({ fbUser, userDoc, lang }: { fbUser: User | null; userDoc: UserDoc | null; lang: Lang }) {
  const firestore = getDb();
  const { data: mine, loading: mineLoading, error: mineError } = useLive<Reservation>(
    () => (firestore && fbUser ? query(collection(firestore, "reservations"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), email: String(d.email ?? ""), date: String(d.date ?? ""), time: String(d.time ?? ""), guests: Number(d.guests ?? 2), requests: String(d.requests ?? ""), status: String(d.status ?? "Pending"), tableLabel: String(d.tableLabel ?? ""), userId: String(d.userId ?? ""), createdAt: "", reminderAt: tsToIso(d.reminderAt) }),
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [requests, setRequests] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Prefill only empty fields: never overwrite what the user already typed.
  useEffect(() => {
    if (!userDoc) return;
    setName((v) => (v === "" ? userDoc.name : v));
    setPhone((v) => (v === "" ? userDoc.phone : v));
  }, [userDoc]);
  if (!fbUser) return <p className="muted">{tr(lang, "Sign in to book a table.", "টেবিল বুক করতে সাইন-ইন করুন।")}</p>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore || !fbUser) return;
    setBusy(true); setMsg("");
    try {
      await addDoc(collection(firestore, "reservations"), { name, phone, email: fbUser.email ?? "", date, time, guests, requests, status: "Pending", tableLabel: "", userId: fbUser.uid, createdAt: serverTimestamp() });
      setMsg(tr(lang, "Reservation requested. The cafe will confirm it.", "রিজার্ভেশনের অনুরোধ পাঠানো হয়েছে। ক্যাফে নিশ্চিত করবে।"));
    } catch (ex) { setMsg(ex instanceof Error ? ex.message : String(ex)); }
    setBusy(false);
  };
  return (
    <div>
      <h2 className="serif" style={{ fontSize: 22 }}>{tr(lang, "Book a table", "টেবিল বুক করুন")}</h2>
      <form onSubmit={(e) => void submit(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Name", "নাম")}<input aria-label="Name" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{tr(lang, "Phone", "ফোন")}<input aria-label="Phone" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label>{tr(lang, "Date", "তারিখ")}<input aria-label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{tr(lang, "Time", "সময়")}<input aria-label="Time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label>{tr(lang, "Guests", "অতিথি")}<input aria-label="Guests" type="number" min={1} max={30} value={guests} onChange={(e) => setGuests(Number(e.target.value))} /></label>
        <label>{tr(lang, "Requests (optional)", "অনুরোধ (ঐচ্ছিক)")}<input aria-label="Requests" value={requests} onChange={(e) => setRequests(e.target.value)} /></label>
        <button className="btn-gold" disabled={busy} type="submit">{tr(lang, "Request reservation", "রিজার্ভেশনের অনুরোধ পাঠান")}</button>
        {msg && <p className="small" role="status">{msg}</p>}
      </form>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My reservations", "আমার রিজার্ভেশনগুলো")}</h3>
      {mineError && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{tr(lang, "Could not load your reservations. Please try again.", "আপনার রিজার্ভেশনগুলো লোড করা যায়নি। আবার চেষ্টা করুন।")}</p>}
      {mineLoading && !mineError && <p className="muted small">{tr(lang, "Loading your reservations…", "রিজার্ভেশনগুলো লোড হচ্ছে…")}</p>}
      {!mineLoading && mine.length === 0 && !mineError && <p className="muted small">{tr(lang, "No reservations yet.", "এখনো কোনো রিজার্ভেশন নেই।")}</p>}
      {mine.map((r) => <div key={r.id} className="card" style={{ marginTop: 8, padding: 12 }}><b>{fmtDate(r.date)} {r.time}</b> • {r.guests} {tr(lang, "guests", "অতিথি")} • <span className="chip" style={r.status === "Confirmed" ? { background: "#2e7d32", color: "#fff", borderColor: "transparent" } : undefined}>{reservationStatusLabel(r.status, lang)}</span><p className="small muted">{tr(lang, "Table:", "টেবিল:")} {r.tableLabel || tr(lang, "To be assigned", "পরে জানানো হবে")}</p>{r.reminderAt && <p className="small" style={{ margin: "4px 0 0" }}>🔔 {tr(lang, "Reminder sent", "মনে করানো হয়েছে")} — {new Date(r.reminderAt).toLocaleString("en-GB")}</p>}</div>)}
    </div>
  );
}

function AccountView({ fbUser, userDoc, products, settings, lang, onLoginSuccess, onUseCoupon }: { fbUser: User | null; userDoc: UserDoc | null; products: Product[]; settings: Settings; lang: Lang; onLoginSuccess: () => void; onUseCoupon: (code: string) => void }) {
  const firestore = getDb();
  const { data: orders, loading: ordersLoading, error: ordersError } = useLive<Order>(
    () => (firestore && fbUser ? query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    orderFromDoc,
  );
  const { data: coupons } = useLive<Coupon>(
    () => (firestore ? query(collection(firestore, "coupons"), orderBy("code")) : null),
    (id, d) => ({ id, code: String(d.code ?? id), kind: String(d.kind ?? "percent"), value: Number(d.value ?? 0), minPurchase: Number(d.minPurchase ?? 0), maxDiscount: d.maxDiscount == null ? null : Number(d.maxDiscount), usageLimit: d.usageLimit == null ? null : Number(d.usageLimit), usedCount: Number(d.usedCount ?? 0), active: d.active !== false, expiresAt: String(d.expiresAt ?? ""), description: String(d.description ?? ""), firstOrderOnly: d.firstOrderOnly === true }),
  );
  // Coupons the customer can actually use: active ones, and a
  // first-order-only coupon is hidden once they already have an order
  // (checkout would reject it anyway).
  const myCoupons = coupons.filter((c) => c.active && !(c.firstOrderOnly && orders.length > 0));
  const [addrDraft, setAddrDraft] = useState("");
  const [addrLabel, setAddrLabel] = useState("Home");
  const [msgDraft, setMsgDraft] = useState("");
  const [msgDone, setMsgDone] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  if (!fbUser) return <SignInCard lang={lang} onSignedIn={onLoginSuccess} />;
  const contact = userDoc?.phone ? userDoc.phone : (fbUser.email ?? fbUser.phoneNumber ?? "");
  const sendMessage = async () => {
    if (!firestore || !msgDraft.trim()) return;
    await addDoc(collection(firestore, "messages"), { userId: fbUser.uid, guestName: userDoc?.name ?? "", guestPhone: userDoc?.phone ?? "", orderNo: "", author: "customer", authorName: userDoc?.name ?? "", body: msgDraft.trim(), readFlag: false, createdAt: serverTimestamp() });
    setMsgDraft(""); setMsgDone(tr(lang, "Message sent. The cafe will reply here.", "মেসেজ পাঠানো হয়েছে। ক্যাফে এখানেই জবাব দেবে।"));
  };
  return (
    <div>
      <div className="card" style={{ padding: 14 }}>
        <h2 className="serif" style={{ fontSize: 22 }}>{tr(lang, "Welcome", "স্বাগতম")}, {userDoc?.name ?? fbUser.displayName ?? ""}</h2>
        <p className="small muted">{contact} • {userDoc?.tier ?? "Bronze"} • {userDoc?.loyaltyPoints ?? 0} {tr(lang, "loyalty points", "লয়্যালটি পয়েন্ট")}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn-ghost" onClick={() => void signOutUser()}>{tr(lang, "Sign out", "সাইন-আউট")}</button>
        </div>
      </div>
      <div className="card" style={{ padding: 14, border: "2px solid var(--gold)", marginTop: 12 }}>
        <b>⭐ {tr(lang, "Loyalty points", "লয়্যালটি পয়েন্ট")}</b>
        <p style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 2px" }}>{userDoc?.loyaltyPoints ?? 0} {tr(lang, "points", "পয়েন্ট")}</p>
        <p className="small muted" style={{ margin: 0 }}>{tr(lang, "Tier:", "স্তর:")} {userDoc?.tier ?? "Bronze"}</p>
        <p className="small" style={{ marginTop: 8 }}>{lang === "bn"
          ? `প্রতি ${settings.loyaltyPerAmount} টাকার অর্ডারে ১ পয়েন্ট। ${settings.loyaltyRedeemPoints} পয়েন্ট হলে ${settings.loyaltyRedeemValue} টাকা ছাড় — চেকআউটে পয়েন্ট ব্যবহার করুন।`
          : `1 point per ৳${settings.loyaltyPerAmount} spent. ${settings.loyaltyRedeemPoints} points = ৳${settings.loyaltyRedeemValue} off — use your points at checkout.`}</p>
        {(() => {
          const blocks = Math.floor((userDoc?.loyaltyPoints ?? 0) / (settings.loyaltyRedeemPoints || 100));
          return blocks > 0
            ? <p className="small" style={{ color: "var(--good)", fontWeight: 700 }}>{lang === "bn" ? `আপনার ${blocks * settings.loyaltyRedeemValue} টাকা ছাড় পাওয়ার মতো পয়েন্ট আছে (${blocks} ব্লক)।` : `You have enough points for ৳${blocks * settings.loyaltyRedeemValue} off (${blocks} block${blocks > 1 ? "s" : ""}).`}</p>
            : <p className="small muted">{lang === "bn" ? `${settings.loyaltyRedeemPoints - (userDoc?.loyaltyPoints ?? 0)} পয়েন্ট বাকি থাকলে প্রথম ছাড় পাবেন।` : `${settings.loyaltyRedeemPoints - (userDoc?.loyaltyPoints ?? 0)} more points to your first reward.`}</p>;
        })()}
      </div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My coupons", "আমার কুপনগুলো")}</h3>
      {myCoupons.length === 0 && <p className="muted small">{tr(lang, "No coupons available right now.", "এখন কোনো কুপন নেই।")}</p>}
      {myCoupons.map((c) => (
        <div key={c.id} className="card" style={{ padding: "10px 12px", marginTop: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{c.code}</b>
            <span>{c.kind === "percent" ? `${c.value}% ${tr(lang, "off", "ছাড়")}` : `${tk(c.value)} ${tr(lang, "off", "ছাড়")}`}</span>
          </div>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {c.firstOrderOnly ? `${tr(lang, "First order only", "শুধু প্রথম অর্ডার")} • ` : ""}{c.minPurchase > 0 ? `${tr(lang, "Min purchase", "সর্বনিম্ন কেনাকাটা")} ${tk(c.minPurchase)} • ` : ""}{c.expiresAt ? `${tr(lang, "Expires", "মেয়াদ")} ${fmtDate(c.expiresAt)}` : tr(lang, "No expiry", "মেয়াদের শেষ নেই")}
          </p>
          <button className="btn-gold" style={{ marginTop: 8, padding: "6px 14px" }} onClick={() => onUseCoupon(c.code)}>{tr(lang, "Use coupon", "কুপন ব্যবহার করুন")}</button>
        </div>
      ))}
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My orders", "আমার অর্ডারগুলো")}</h3>
      {ordersError && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{tr(lang, "Could not load your orders. Please try again.", "আপনার অর্ডারগুলো লোড করা যায়নি। আবার চেষ্টা করুন।")}</p>}
      {ordersLoading && !ordersError && <p className="muted small">{tr(lang, "Loading your orders…", "অর্ডারগুলো লোড হচ্ছে…")}</p>}
      {!ordersLoading && orders.length === 0 && !ordersError && <p className="muted small">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {orders.slice(0, 10).map((o) => <div key={o.id} className="card" style={{ marginTop: 8, padding: 12 }}><div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)}</span></div><p className="small" style={{ marginTop: 4 }}>{o.items.map((it) => `${it.qty} × ${orderItemName(products, it, lang)}`).join(" • ")}</p><p className="small muted" style={{ marginTop: 2 }}>{fmtDate(o.createdAt)}</p><p className="small muted"><span className="chip" style={{ ...statusBadgeStyle(o.status), padding: "2px 8px", fontWeight: 700 }}>{statusLabel(o.status, lang)}</span> {o.paymentMethod} • {paymentStatusLabel(o.paymentStatus, lang)}</p><div style={{ marginTop: 8 }}><CancelOrderButton order={o} uid={fbUser.uid} settings={settings} lang={lang} /> <button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={() => setReceiptOrder(o)}>🧾 {tr(lang, "Receipt", "রিসিট")}</button></div></div>)}
      {receiptOrder && <ReceiptModal order={receiptOrder} settings={settings} products={products} lang={lang} onClose={() => setReceiptOrder(null)} />}
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "Favourites", "প্রিয় আইটেম")}</h3>
      {(!userDoc || userDoc.wishlist.length === 0) && <p className="muted small">{tr(lang, "No favourites yet — tap the heart on a product.", "এখনো প্রিয় আইটেম নেই — প্রোডাক্টের হার্ট চাপুন।")}</p>}
      <div className="row">{(userDoc?.wishlist ?? []).map((slug) => { const p = products.find((x) => x.slug === slug); return p ? <span key={slug} className="chip">{displayName(p, lang)}</span> : null; })}</div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My addresses", "আমার ঠিকানাগুলো")}</h3>
      {(userDoc?.savedAddresses ?? []).length === 0 && <p className="muted small">{tr(lang, "No saved addresses yet — add one below and pick it at checkout.", "এখনো সংরক্ষিত ঠিকানা নেই — নিচে যোগ করুন, চেকআউটে বেছে নিতে পারবেন।")}</p>}
      {(userDoc?.savedAddresses ?? []).map((a, i) => (
        <div key={`${a.label}-${a.address}-${i}`} className="card" style={{ padding: "8px 10px", marginTop: 6 }}>
          <b>{a.label === "Home" ? tr(lang, "Home", "বাড়ি") : a.label === "Office" ? tr(lang, "Office", "অফিস") : a.label === "Other" ? tr(lang, "Other", "অন্য") : (a.label || tr(lang, "Address", "ঠিকানা"))}</b> — {a.address}
          <button className="btn-ghost" style={{ padding: "2px 8px", marginLeft: 8 }} onClick={() => { if (!firestore || !userDoc) return; const next = userDoc.savedAddresses.filter((_, j) => j !== i); void updateDoc(doc(firestore, "users", fbUser.uid), { savedAddresses: next, addresses: next.map((x) => x.address) }); }}>{tr(lang, "Remove", "সরান")}</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <select aria-label="Address label" value={addrLabel} onChange={(e) => setAddrLabel(e.target.value)} style={{ width: 110 }}>
          <option value="Home">{tr(lang, "Home", "বাড়ি")}</option>
          <option value="Office">{tr(lang, "Office", "অফিস")}</option>
          <option value="Other">{tr(lang, "Other", "অন্য")}</option>
        </select>
        <input aria-label="New address" value={addrDraft} onChange={(e) => setAddrDraft(e.target.value)} placeholder={tr(lang, "House, road, area", "বাড়ি, রাস্তা, এলাকা")} style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => { if (!firestore || !addrDraft.trim() || !userDoc) return; const next = [...userDoc.savedAddresses, { label: addrLabel, address: addrDraft.trim() }]; void updateDoc(doc(firestore, "users", fbUser.uid), { savedAddresses: next, addresses: next.map((x) => x.address) }); setAddrDraft(""); }}>{tr(lang, "Add address", "ঠিকানা যোগ করুন")}</button>
      </div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "Message the cafe", "ক্যাফেকে মেসেজ করুন")}</h3>
      <label>{tr(lang, "Your message", "আপনার মেসেজ")}<textarea aria-label="Message to the cafe" rows={3} value={msgDraft} onChange={(e) => setMsgDraft(e.target.value)} /></label>
      <button className="btn-gold" onClick={() => void sendMessage()}>{tr(lang, "Send message", "মেসেজ পাঠান")}</button>
      {msgDone && <p className="small" role="status">{msgDone}</p>}
    </div>
  );
}

function InfoView({ settings, lang, onPolicy }: { settings: Settings; lang: Lang; onPolicy?: (v: "refund" | "delivery" | "privacy") => void }) {
  const content = parseContent(settings.contentJson);
  let hours: Array<{ day: string; open: string; close: string; closed?: boolean }> = [];
  try { const raw = JSON.parse(settings.hoursJson || "[]") as unknown; hours = Array.isArray(raw) ? raw as typeof hours : []; } catch { hours = []; }
  return (
    <div>
      <div className="logo-tile" style={{ width: 88, height: 88 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
      <h2 className="serif" style={{ fontSize: 22, marginTop: 10 }}>{settings.cafeName}</h2>
      <p className={`muted ${taglineClass(lang)}`} style={{ fontSize: 17 }}>{taglineText(settings, lang)}</p>
      {content.aboutText && <p style={{ marginTop: 8 }}>{content.aboutText}</p>}
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Visit us", "আমাদের ঠিকানা")}</b>
        <p style={{ marginTop: 6 }}>{settings.address}</p>
        <p>{tr(lang, "Phone:", "ফোন:")} <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a></p>
        <p><a href={settings.facebook} target="_blank" rel="noreferrer">Facebook — Café Reza</a></p>
        <p className="small muted">{tr(lang, "Pin:", "পিন:")} {MAP_COORDS.lat}, {MAP_COORDS.lon} • {MAP_COORDS.plusCode}</p>
        <iframe title={tr(lang, "Café Reza location map", "ক্যাফে রেজার অবস্থানের মানচিত্র")} src={`https://maps.google.com/maps?q=${MAP_COORDS.lat},${MAP_COORDS.lon}&z=16&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" style={{ width: "100%", height: 280, border: "1px solid var(--border)", borderRadius: 12, marginTop: 8, background: "var(--surface)" }} />
        <p className="small muted" style={{ marginTop: 4 }}>{tr(lang, "If the map does not load here, tap Get Directions below.", "ম্যাপ এখানে না দেখালে নিচে 'দিকনির্দেশনা নিন' চাপুন।")}</p>
        <a className="btn-gold" style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }} href={MAPS_LINK} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Opening hours", "খোলার সময়")}</b>
        <div style={{ marginTop: 8 }}><OpenNowBadge settings={settings} lang={lang} /></div>
        {hours.length === 0
          ? <p className="muted small" style={{ marginTop: 6 }}>{settings.hours || tr(lang, "Hours are not set yet.", "সময় এখনো বসানো হয়নি।")}</p>
          : <table><tbody>{hours.map((h) => <tr key={h.day}><td>{h.day}</td><td>{h.closed ? tr(lang, "Closed", "বন্ধ") : `${h.open} – ${h.close}`}</td></tr>)}</tbody></table>}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Policies", "নীতিমালা")}</b>
        <p className="small" style={{ marginTop: 6 }}>{tr(lang, "Pending/Confirmed orders can be cancelled with stock restored. Mobile payments stay “Pending verification” until verified — never auto-marked paid. Prices follow the printed menu; items without a price stay unorderable until a price is set.", "অপেক্ষমাণ/নিশ্চিত অর্ডার স্টক ফিরিয়ে বাতিল করা যায়। মোবাইল পেমেন্ট যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকে — কখনো স্বয়ংক্রিয়ভাবে পরিশোধিত ধরা হয় না। দাম ছাপা মেনু অনুযায়ী; দাম ছাড়া আইটেম দাম না বসানো পর্যন্ত অর্ডার করা যায় না।")}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => onPolicy?.("refund")}>{tr(lang, "Refund Policy", "ফেরত নীতিমালা")}</button>
          <button className="chip" onClick={() => onPolicy?.("delivery")}>{tr(lang, "Delivery Policy", "ডেলিভারি নীতিমালা")}</button>
          <button className="chip" onClick={() => onPolicy?.("privacy")}>{tr(lang, "Privacy Policy", "গোপনীয়তা নীতিমালা")}</button>
        </div>
      </div>
    </div>
  );
}

// Customer-facing policy pages (footer links). Every number comes
// from live Settings — delivery fee, free-delivery threshold, cancel
// window, prep/delivery minutes, hours, phone and address — so the
// text stays true when the owner changes a setting in the admin panel.
function PolicyView({ policy, settings, lang, onBack }: { policy: "refund" | "delivery" | "privacy"; settings: Settings; lang: Lang; onBack: () => void }) {
  const title = policy === "refund" ? tr(lang, "Refund Policy", "ফেরত নীতিমালা") : policy === "delivery" ? tr(lang, "Delivery Policy", "ডেলিভারি নীতিমালা") : tr(lang, "Privacy Policy", "গোপনীয়তা নীতিমালা");
  const cancelMin = settings.cancelWindowMinutes ?? 2;
  const eta = (settings.prepMinutes ?? 20) + (settings.deliveryMinutes ?? 20);
  return (
    <div>
      <button className="chip" onClick={onBack}>← {tr(lang, "Menu", "মেনু")}</button>
      <h1 className="serif" style={{ fontSize: 26, marginTop: 12 }}>{title}</h1>
      <p className="muted">{settings.cafeName} • {settings.address}</p>
      {policy === "refund" && (
        <div className="card" style={{ padding: 16 }}>
          <p>{tr(lang, "Payment here is Cash on Delivery (or cash at the counter for dine-in and takeaway) — no advance payment is collected online, so a cancelled order has nothing to refund.", "এখানে পেমেন্ট ক্যাশ অন ডেলিভারি (ডাইন-ইন ও টেকঅ্যাওয়ের জন্য কাউন্টারে নগদ) — অনলাইনে আগাম টাকা নেওয়া হয় না, তাই বাতিল করা অর্ডারে ফেরত দেওয়ার কিছু থাকে না।")}</p>
          <ul>
            <li>{tr(lang, `You can cancel your own order within ${cancelMin} minutes of placing it, while it is still Pending or Confirmed. After that only the cafe can cancel it — write in the in-app chat or call us.`, `অর্ডার দেওয়ার ${cancelMin} মিনিটের মধ্যে, যতক্ষণ তা অপেক্ষমাণ বা নিশ্চিত অবস্থায় আছে, আপনি নিজে বাতিল করতে পারবেন। এরপর শুধু ক্যাফেই বাতিল করতে পারবে — ইন-অ্যাপ চ্যাটে লিখুন বা ফোন করুন।`)}</li>
            <li>{tr(lang, "A cancelled order is never charged. If you already paid by mobile payment (bKash, Nagad or Rocket), the payment stays “Pending verification” until our staff verifies it — it is never auto-marked paid.", "বাতিল করা অর্ডারে কখনো চার্জ করা হয় না। মোবাইল পেমেন্টে (বিকাশ, নগদ বা রকেট) টাকা দিয়ে থাকলে তা কর্মীরা যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকে — কখনো স্বয়ংক্রিয়ভাবে পরিশোধিত ধরা হয় না।")}</li>
            <li>{tr(lang, "A refund is given only after the cafe admin approves it. When an approved refund is due — for example a verified mobile payment for a cancelled order, or a wrong or damaged item — it is returned through the same channel you paid with.", "ফেরত দেওয়া হয় শুধু ক্যাফের অ্যাডমিন অনুমোদন করলে। অনুমোদিত ফেরত পাওনা হলে — যেমন বাতিল অর্ডারের যাচাই করা মোবাইল পেমেন্ট, বা ভুল/নষ্ট খাবার — তা আপনি যেভাবে দিয়েছেন সেই একই মাধ্যমে ফেরত দেওয়া হয়।")}</li>
            <li>{tr(lang, "Got a wrong or damaged item? Tell us in the in-app chat or by phone with your order number — the admin decides a replacement or a refund.", "ভুল বা নষ্ট খাবার পেলে অর্ডার নম্বরসহ ইন-অ্যাপ চ্যাটে বা ফোনে জানান — অ্যাডমিন বদলে দেওয়া বা ফেরতের সিদ্ধান্ত নেবেন।")}</li>
          </ul>
        </div>
      )}
      {policy === "delivery" && (
        <div className="card" style={{ padding: 16 }}>
          <ul>
            <li>{tr(lang, `Delivery charge is ${tk(settings.deliveryFee)} per order, and free for orders of ${tk(settings.freeDeliveryAt)} or more. The exact charge is shown at checkout before you confirm.`, `ডেলিভারি চার্জ প্রতি অর্ডারে ${tk(settings.deliveryFee)}, আর ${tk(settings.freeDeliveryAt)} বা তার বেশি অর্ডারে ফ্রি। নিশ্চিত করার আগে চেকআউটে সঠিক চার্জ দেখানো হয়।`)}</li>
            <li>{tr(lang, `Delivery usually takes about ${eta} minutes after you order (kitchen prep plus rider time). You can follow the order live on the Track page.`, `অর্ডারের পর ডেলিভারিতে সাধারণত প্রায় ${eta} মিনিট লাগে (রান্নার সময় + রাইডারের সময়)। ট্র্যাক পেজে অর্ডারটি লাইভ দেখতে পারবেন।`)}</li>
            <li>{tr(lang, `Opening hours: ${settings.hours || "4 PM – 12 AM, every day"}. Orders are taken only while the cafe is open.`, `খোলার সময়: ${settings.hours || "প্রতিদিন বিকাল ৪টা – রাত ১২টা"}। ক্যাফে খোলা থাকলেই অর্ডার নেওয়া হয়।`)}</li>
            <li>{tr(lang, "Delivery orders are paid Cash on Delivery. Dine-in and takeaway are also available — dine-in from a table QR, or pick a table at checkout.", "ডেলিভারি অর্ডারের পেমেন্ট ক্যাশ অন ডেলিভারি। ডাইন-ইন ও টেকঅ্যাওয়েও আছে — টেবিলের QR থেকে ডাইন-ইন করুন, বা চেকআউটে টেবিল বেছে নিন।")}</li>
            <li>{tr(lang, "Please give a complete delivery address and a reachable phone number, so the rider can find you.", "সঠিক ডেলিভারি ঠিকানা ও পৌঁছানো যায় এমন ফোন নম্বর দিন, যাতে রাইডার আপনাকে খুঁজে পায়।")}</li>
          </ul>
        </div>
      )}
      {policy === "privacy" && (
        <div className="card" style={{ padding: 16 }}>
          <ul>
            <li>{tr(lang, "We collect only what an order needs: your name, phone number and delivery address, your order history and saved addresses, and the messages you send in the in-app chat. Signing in is by Google, Facebook or phone number only.", "অর্ডারের জন্য যা দরকার শুধু তাই নেওয়া হয়: আপনার নাম, ফোন নম্বর ও ডেলিভারি ঠিকানা, অর্ডারের ইতিহাস ও সংরক্ষিত ঠিকানা, আর ইন-অ্যাপ চ্যাটে পাঠানো মেসেজ। সাইন-ইন শুধু Google, Facebook বা ফোন নম্বরে।")}</li>
            <li>{tr(lang, "Your details are used only to take, prepare and deliver your order and to reply to your messages. They are never sold, and never shown publicly — the chat is private between you and the cafe staff.", "আপনার তথ্য শুধু অর্ডার নেওয়া, তৈরি করা, ডেলিভারি দেওয়া আর মেসেজের উত্তর দেওয়ার কাজে ব্যবহৃত হয়। তা কখনো বিক্রি করা হয় না, আর প্রকাশ্যে দেখানোও হয় না — চ্যাট শুধু আপনার আর ক্যাফের কর্মীদের মধ্যে।")}</li>
            <li>{tr(lang, "You can download your own data anytime from the Account page.", "অ্যাকাউন্ট পেজ থেকে আপনি যেকোনো সময় নিজের ডেটা ডাউনলোড করতে পারবেন।")}</li>
            <li>{tr(lang, "If you have a question about your data, write in the in-app chat or call the cafe — we will answer it.", "নিজের ডেটা নিয়ে কোনো প্রশ্ন থাকলে ইন-অ্যাপ চ্যাটে লিখুন বা ক্যাফেতে ফোন করুন — আমরা উত্তর দেব।")}</li>
          </ul>
        </div>
      )}
      {settings.phone && <p style={{ marginTop: 12 }}>📞 <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a></p>}
    </div>
  );
}

// If the admin panel throws while rendering, React unmounts the whole
// page (black screen). Catch it here instead: show the error so it can
// be fixed, with a way back to the shop.
class PanelErrorBoundary extends Component<{ children: ReactNode; lang: Lang; onBack: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ padding: 20, marginTop: 14 }}>
          <h2 className="serif" style={{ fontSize: 20 }}>{tr(this.props.lang, "The admin panel could not open", "অ্যাডমিন প্যানেল খুলতে পারেনি")}</h2>
          <p className="small" style={{ marginTop: 8 }}>{tr(this.props.lang, "Something went wrong while opening the panel. The error is shown below so it can be fixed.", "প্যানেল খুলতে গিয়ে সমস্যা হয়েছে। নিচে ভুলের বিবরণ দেখা যাচ্ছে, যাতে ঠিক করা যায়।")}</p>
          <p className="small" role="alert" style={{ marginTop: 8, color: "var(--bad)", wordBreak: "break-word" }}>{this.state.error.message}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn-gold" onClick={() => window.location.reload()}>{tr(this.props.lang, "Try again", "আবার চেষ্টা করুন")}</button>
            <button className="btn-ghost" onClick={this.props.onBack}>{tr(this.props.lang, "Back to shop", "দোকানে ফিরুন")}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// In-app chatbox: a floating 💬 button on the customer site opens a
// popup chat between the signed-in customer and the admin/staff. The
// conversation lives in the existing `messages` collection (the same
// one the Account "Message the cafe" form and the admin Support tab
// use), so there is one inbox, not two. The AI assistant answers
// inside the same chat when the owner has put a Gemini key in
// Settings; without a key the chat still works and the admin replies.
// Unread staff replies are counted client-side (localStorage
// last-read time), because the rules do not let customers update
// readFlag. The button sits bottom-left so it never covers the
// bottom-right "View cart" button.
function ChatBox({ fbUser, userDoc, products, settings, lang }: { fbUser: User | null; userDoc: UserDoc | null; products: Product[]; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [lastRead, setLastRead] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { data: messages } = useLive<{ id: string; author: string; authorName: string; body: string; createdAt: string }>(
    () => (firestore && fbUser ? query(collection(firestore, "messages"), where("userId", "==", fbUser.uid), orderBy("createdAt", "asc"), limit(100)) : null),
    (id, d) => ({ id, author: String(d.author ?? ""), authorName: String(d.authorName ?? ""), body: String(d.body ?? ""), createdAt: tsToIso(d.createdAt) }),
    [fbUser?.uid],
  );
  useEffect(() => {
    if (!fbUser) { setLastRead(0); return; }
    try { setLastRead(Number(localStorage.getItem(`cr_chat_last_read_${fbUser.uid}`) ?? 0)); } catch { setLastRead(0); }
  }, [fbUser]);
  const markRead = () => {
    if (!fbUser) return;
    const t = Date.now();
    try { localStorage.setItem(`cr_chat_last_read_${fbUser.uid}`, String(t)); } catch { /* best-effort */ }
    setLastRead(t);
  };
  useEffect(() => { if (open) markRead(); }, [open, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages]);
  const unread = messages.filter((m) => (m.author === "staff" || m.author === "ai") && Date.parse(m.createdAt) > lastRead).length;
  const send = async () => {
    if (!firestore || !fbUser || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft(""); setAiNote(""); setSending(true);
    try {
      await addDoc(collection(firestore, "messages"), { userId: fbUser.uid, guestName: userDoc?.name ?? "", guestPhone: userDoc?.phone ?? "", orderNo: "", author: "customer", authorName: userDoc?.name ?? "", body: text, readFlag: false, createdAt: serverTimestamp() });
      // AI reply (best-effort): the chat works with or without it.
      const key = settings.geminiApiKey?.trim() ?? "";
      if (!key) {
        setAiNote(tr(lang, "AI is not set up yet — your message reached the admin.", "AI এখনো চালু হয়নি — আপনার মেসেজ অ্যাডমিনের কাছে পৌঁছেছে।"));
      } else {
        setAiBusy(true);
        const history = messages.filter((m) => m.author === "customer" || m.author === "ai").slice(-10).map((m) => ({ role: (m.author === "ai" ? "model" : "user") as "model" | "user", text: m.body }));
        const r = await askAi(key, buildAiKnowledge(products, settings), history, text);
        setAiBusy(false);
        if (r.ok && r.text) {
          await addDoc(collection(firestore, "messages"), { userId: fbUser.uid, guestName: "", guestPhone: "", orderNo: "", author: "ai", authorName: tr(lang, "AI Assistant", "AI সহকারী"), body: r.text, readFlag: false, createdAt: serverTimestamp() });
        } else {
          setAiNote(tr(lang, "AI could not answer right now — your message reached the admin.", "AI এখন উত্তর দিতে পারছে না — আপনার মেসেজ অ্যাডমিনের কাছে পৌঁছেছে।"));
        }
      }
    } catch {
      setAiNote(tr(lang, "Message could not be sent. Please try again.", "মেসেজ পাঠানো যায়নি। আবার চেষ্টা করুন।"));
    }
    setSending(false);
  };
  return (
    <>
      <button className="btn-gold no-print" aria-label={tr(lang, "Chat with the cafe", "ক্যাফের সাথে চ্যাট করুন")} onClick={() => { setOpen((v) => !v); if (!open) markRead(); }} style={{ position: "fixed", left: 16, bottom: 76, zIndex: 40, width: 56, height: 56, borderRadius: "50%", fontSize: 24, padding: 0, boxShadow: "0 8px 20px rgba(0,0,0,.35)" }}>
        💬
        {unread > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: "var(--bad)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{unread}</span>}
      </button>
      {open && (
        <div className="card no-print" role="dialog" aria-label={tr(lang, "Chat with Café Reza", "ক্যাফে রেজার সাথে চ্যাট")} style={{ position: "fixed", left: 16, bottom: 140, zIndex: 50, width: "min(360px, calc(100vw - 32px))", height: 480, maxHeight: "calc(100vh - 160px)", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--gold)", color: "#fff" }}>
            <b>💬 {tr(lang, "Chat with Café Reza", "ক্যাফে রেজার সাথে চ্যাট")}</b>
            <button className="btn-ghost" aria-label="Close chat" onClick={() => setOpen(false)} style={{ color: "#fff", padding: "2px 8px" }}>✕</button>
          </div>
          {!fbUser ? (
            <p className="small" style={{ padding: 14 }}>{tr(lang, "Sign in from My Account to chat with the cafe.", "ক্যাফের সাথে চ্যাট করতে My Account থেকে সাইন-ইন করুন।")}</p>
          ) : (
            <>
              <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.length === 0 && <p className="small muted">{tr(lang, "Ask anything — the menu, offers, opening hours, or your order. The AI assistant or the admin will reply here.", "যেকোনো কিছু জিজ্ঞেস করুন — মেনু, অফার, খোলার সময়, বা আপনার অর্ডার। AI সহকারী বা অ্যাডমিন এখানেই জবাব দেবেন।")}</p>}
                {messages.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.author === "customer" ? "flex-end" : "flex-start", maxWidth: "85%", background: m.author === "customer" ? "var(--gold)" : "var(--surface)", color: m.author === "customer" ? "#fff" : "inherit", borderRadius: 12, padding: "8px 10px" }}>
                    <span className="small" style={{ fontWeight: 700, opacity: 0.85 }}>{m.author === "ai" ? `🤖 ${m.authorName}` : m.author === "staff" ? `🏪 ${m.authorName || tr(lang, "Café Reza", "ক্যাফে রেজা")}` : tr(lang, "You", "আপনি")}</span>
                    <p style={{ margin: "2px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{m.body}</p>
                  </div>
                ))}
                {aiBusy && <p className="small muted">{tr(lang, "AI is writing…", "AI লিখছে…")}</p>}
              </div>
              {aiNote && <p className="small" role="status" style={{ margin: "0 12px 6px", color: "var(--bad)" }}>{aiNote}</p>}
              <div className="row" style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
                <input aria-label={tr(lang, "Write a message", "মেসেজ লিখুন")} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder={tr(lang, "Write a message…", "মেসেজ লিখুন…")} style={{ flex: 1 }} />
                <button className="btn-gold" disabled={sending || !draft.trim()} onClick={() => void send()}>{sending ? "…" : tr(lang, "Send", "পাঠান")}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("cr_lang") === "en" ? "en" : "bn"));
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("store");
  // Table QR handoff: a scanned table QR opens the menu with
  // ?table=T1 in the hash (e.g. #/?table=T1). The label is validated
  // (letters, digits, dash, max 12 chars) so a crafted link cannot
  // inject anything into the checkout form.
  const [qrTable, setQrTable] = useState(() => tableParamFromHash());
  const [fbUser, setFbUser] = useState<User | null>(null);
  // Auth restore is async: until the first onAuthStateChanged fires we
  // do NOT know whether anyone is signed in, so the admin panel must
  // show a loader — never the sign-in card — or a reload flashes the
  // login screen and looks like a mid-session logout.
  const [authReady, setAuthReady] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const onLoginSuccess = () => {
    setLoginSuccess(true);
    window.setTimeout(() => {
      setLoginSuccess(false);
      // The owner lands on the admin panel right after signing in (the
      // owner's choice); customers stay on the shop. Read the live auth
      // user here: fbUser/userDoc in this closure are stale from before
      // sign-in, and so is the view captured when sign-in started.
      const u = getAuthInstance()?.currentUser ?? null;
      if ((u?.email ?? "").toLowerCase() === OWNER_EMAIL) { navigate("admin"); return; }
      const head = window.location.hash.replace(/^#\/?/, "").split("/")[0];
      if (head === "account") navigate("store");
    }, 1500);
  };
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "best" | "featured" | "new">("all");
  const [cart, setCart] = useState<CartItem[]>(() => { try { return JSON.parse(localStorage.getItem("cr_cart_fb") ?? "[]") as CartItem[]; } catch { return []; } });
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [seedMsg, setSeedMsg] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);

  useEffect(() => { localStorage.setItem("cr_lang", lang); }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { localStorage.setItem("cr_cart_fb", JSON.stringify(cart)); }, [cart]);

  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      const head = h.split("/")[0];
      setView(head === "admin" ? "admin" : head === "track" ? "track" : head === "reserve" ? "reserve" : head === "account" ? "account" : head === "about" ? "info" : head === "refund" ? "refund" : head === "delivery" ? "delivery" : head === "privacy" ? "privacy" : "store");
      setQrTable(tableParamFromHash());
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  // Every view change lands at the top of the new page instantly.
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [view]);
  const navigate = (v: View) => {
    setView(v);
    const hash = v === "store" ? "#/" : v === "info" ? "#/about" : `#/${v}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  };
  // The customer app never shows the admin panel: a signed-in account
  // without a staff role that opens #/admin is sent back to the shop
  // silently — no denial text, no admin mention.
  useEffect(() => {
    if (view === "admin" && fbUser && userDoc && !isStaffRole(userDoc.role)) navigate("store");
  }, [view, fbUser, userDoc]);

  useEffect(() => watchAuth((u) => { setFbUser(u); setAuthReady(true); }), []);
  useEffect(() => {
    const firestore = getDb();
    if (!firestore || !fbUser) { setUserDoc(null); return; }
    const unsub = onSnapshot(doc(firestore, "users", fbUser.uid), (snap) => {
      if (snap.exists()) setUserDoc(userFromDoc(snap.id, snap.data() as DocumentData));
      else { setUserDoc(null); void ensureUserDoc(fbUser); }
    }, (e) => {
      // A listener error must never become an uncaught page error: log it
      // and keep the signed-in session usable without a profile.
      console.error("user profile listener failed", e);
      setUserDoc(null);
    });
    return unsub;
  }, [fbUser]);

  const { categories, products, loading: catalogLoading, error: catalogError, offline: isOffline } = useCatalog();
  const { data: settings } = useSettingsDoc();
  // Approved reviews only — the average per product shown on menu
  // cards comes from these real, staff-approved reviews.
  const { data: approvedReviews } = useLive<Review>(
    () => (getDb() ? query(collection(getDb()!, "reviews"), where("status", "==", "Approved"), limit(200)) : null),
    reviewFromDoc,
  );
  const reviewAvg = useMemo(() => {
    const sums = new Map<string, { sum: number; count: number }>();
    for (const r of approvedReviews) {
      const cur = sums.get(r.productId) ?? { sum: 0, count: 0 };
      cur.sum += r.rating; cur.count += 1;
      sums.set(r.productId, cur);
    }
    const out = new Map<string, { avg: number; count: number }>();
    for (const [k, v] of sums) out.set(k, { avg: v.sum / v.count, count: v.count });
    return out;
  }, [approvedReviews]);
  const content = parseContent(settings.contentJson);
  const isStaff = userDoc ? isStaffRole(userDoc.role) : false;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => cat === "all" || p.categoryId === cat)
      .filter((p) => !needle || p.nameEn.toLowerCase().includes(needle) || p.nameBn.includes(needle))
      .filter((p) => filter === "all" || (filter === "best" && p.bestSeller) || (filter === "featured" && p.featured) || (filter === "new" && p.isNew))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [products, cat, q, filter]);
  const cartCount = cart.reduce((a, c) => a + c.qty, 0);

  const addToCart = (p: Product, extra?: { qty: number; size: string; sugar: string; milk: string; note: string }) => {
    const item: CartItem = { productId: p.slug, qty: extra?.qty ?? 1, size: extra?.size ?? "Regular", sugar: extra?.sugar ?? "Normal", milk: extra?.milk ?? "Normal", note: extra?.note ?? "" };
    setCart((prev) => {
      const i = prev.findIndex((c) => c.productId === item.productId && c.size === item.size && c.sugar === item.sugar && c.milk === item.milk && c.note === item.note);
      if (i >= 0) { const next = [...prev]; const cur = next[i]; if (cur) next[i] = { ...cur, qty: cur.qty + item.qty }; return next; }
      return [...prev, item];
    });
    setCartOpen(true);
  };
  const toggleWishlist = (slug: string) => {
    const firestore = getDb();
    if (!firestore || !fbUser || !userDoc) return;
    const next = userDoc.wishlist.includes(slug) ? userDoc.wishlist.filter((s) => s !== slug) : [...userDoc.wishlist, slug];
    void updateDoc(doc(firestore, "users", fbUser.uid), { wishlist: next });
  };
  const runSeed = async () => {
    setSeedBusy(true); setSeedMsg("");
    const r = await seedCatalog();
    setSeedBusy(false);
    setSeedMsg(r.error ?? tr(lang, `Catalog seeded: ${r.inserted} products, ${r.categories} categories created. Existing items were not changed.`, `ক্যাটালগ বসানো হয়েছে: ${r.inserted}টি প্রোডাক্ট, ${r.categories}টি ক্যাটাগরি তৈরি হয়েছে। আগের আইটেম বদলানো হয়নি।`));
  };

  const showSetupNotice = !isFirebaseConfigured;
  return (
    <div style={{ paddingBottom: 84 }}>
      {loginSuccess && (
        <div className="success-overlay" role="status">
          <div className="success-tick">✓</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{tr(lang, "Login successful!", "লগইন সফল হয়েছে!")}</div>
        </div>
      )}
      {/* The customer header/nav never shows inside the admin panel: its
          Menu / Track / Account buttons navigate away from #/admin, which
          is why tapping Menu threw the owner out of the admin panel. The
          admin panel has its own header, tabs and back button. */}
      {/* The customer header never renders inside the admin panel — the
          admin has its own header (menu / alerts / title). Rendering it
          here put the shop logo, tagline and nav on top of the panel. */}
      {view !== "admin" && (<header className="topbar no-print">
        <div className="wrap row" style={{ justifyContent: "space-between", paddingTop: 10, paddingBottom: 10 }}>
          <button type="button" onClick={() => navigate("store")} style={{ background: "none", border: "none", display: "flex", gap: 10, alignItems: "center", textAlign: "left", color: "var(--text)", cursor: "pointer" }}>
            <span className="logo-tile" style={{ width: 44, height: 44 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></span>
            <span><b className="serif" style={{ fontSize: 19 }}>{settings.cafeName}</b><br /><span className={`small muted ${taglineClass(lang)}`}>{taglineText(settings, lang)}</span></span>
          </button>
          <div className="row">
            <button className="chip" aria-label="Switch language" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>{lang === "bn" ? "EN" : "বাংলা"}</button>
            <button className="chip" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
            <button className="chip" aria-label={`Cart, ${cartCount} items`} onClick={() => setCartOpen(true)}>🛒 {cartCount}</button>
            <button className="chip" onClick={() => navigate("account")} style={{ maxWidth: 150, minWidth: 118, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "none" }}>{fbUser ? (userDoc?.name ?? tr(lang, "Account", "অ্যাকাউন্ট")) : tr(lang, "Sign in", "সাইন-ইন")}</button>
          </div>
        </div>
        <nav className="wrap row" style={{ paddingBottom: 8 }} aria-label="Main">
          {([["store", tr(lang, "Menu", "মেনু")], ["track", tr(lang, "Track", "ট্র্যাক")], ["reserve", tr(lang, "Reserve", "রিজার্ভ")], ["info", tr(lang, "About", "সম্পর্কে")], ["account", tr(lang, "Account", "অ্যাকাউন্ট")]] as Array<[View, string]>).map(([v, label]) => (
            <button key={v} className={`chip ${view === v ? "chip-on" : ""}`} onClick={() => navigate(v)}>{label}</button>
          ))}
        </nav>
      </header>)}

      {showSetupNotice && (
        <div className="wrap"><div className="card" style={{ padding: 14, marginTop: 12, border: "2px solid var(--bad)" }}>
          <b>{tr(lang, "Firebase is not configured", "Firebase কনফিগার করা হয়নি")}</b>
          <p className="small" style={{ marginTop: 4 }}>{MISSING_CONFIG_BN}</p>
          <p className="small">{tr(lang, "Build with VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID from Firebase Console → Project settings → Your apps → “Cafe Reza Web”, deploy the rules, then sign in. The menu below stays empty until Firestore answers — nothing here is demo data.", "Firebase Console → Project settings → Your apps → “Cafe Reza Web” থেকে VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID ও VITE_FIREBASE_APP_ID বসিয়ে বিল্ড করুন, rules ডেপ্লয় করুন, তারপর সাইন-ইন করুন। Firestore উত্তর না দেওয়া পর্যন্ত মেনু খালি থাকবে — এখানে কোনো ডেমো ডেটা নেই।")}</p>
        </div></div>
      )}
      {content.announcement && <div className="wrap"><p className="text-center" style={{ padding: "8px 0", color: "var(--accent)", fontWeight: 600 }}>{content.announcement}</p></div>}

      {view === "admin" ? (
        <main className="wrap" style={{ marginTop: 14 }}>
          <PanelErrorBoundary lang={lang} onBack={() => navigate("store")}>
            <AdminPanel fbUser={fbUser} authReady={authReady} userDoc={userDoc} settings={settings} categories={categories} products={products} lang={lang} onToggleLang={() => setLang(lang === "bn" ? "en" : "bn")} theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} onBack={() => navigate("store")} onSeed={runSeed} seedBusy={seedBusy} seedMsg={seedMsg} signInCard={<SignInCard lang={lang} onSignedIn={onLoginSuccess} />} />
          </PanelErrorBoundary>
        </main>
      ) : view === "track" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><TrackView key={fbUser?.uid ?? "guest"} fbUser={fbUser} products={products} settings={settings} lang={lang} /></main>
      ) : view === "reserve" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><ReserveView key={fbUser?.uid ?? "guest"} fbUser={fbUser} userDoc={userDoc} lang={lang} /></main>
      ) : view === "account" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}>
          <AccountView key={fbUser?.uid ?? "guest"} fbUser={fbUser} userDoc={userDoc} products={products} settings={settings} lang={lang} onLoginSuccess={onLoginSuccess} onUseCoupon={(code) => { try { localStorage.setItem("cr_wallet_coupon", code); } catch { /* wallet handoff is best-effort */ } setCartOpen(true); }} />
          <InstallAppCard variant="customer" lang={lang} />
        </main>
      ) : view === "info" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><InfoView settings={settings} lang={lang} onPolicy={(v) => navigate(v)} /></main>
      ) : view === "refund" || view === "delivery" || view === "privacy" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><PolicyView policy={view} settings={settings} lang={lang} onBack={() => navigate("store")} /></main>
      ) : (
        <main className="wrap">
          <section className="card" style={{ marginTop: 14, overflow: "hidden" }}>
            <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
              <div style={{ padding: 20 }}>
                <div className="logo-tile" style={{ width: 88, height: 88 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
                <h1 className="serif" style={{ fontSize: 32, marginTop: 10 }}>{settings.cafeName}</h1>
                <p className={`muted ${taglineClass(lang)}`} style={{ fontSize: 20, fontWeight: 700 }}>{taglineText(settings, lang)}</p>
                <div className="row" style={{ marginTop: 10 }}><OpenNowBadge settings={settings} lang={lang} /></div>
                {qrTable && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <span className="chip chip-on" style={{ fontWeight: 700 }}>🪑 {tr(lang, `Table ${qrTable} — dine-in`, `টেবিল ${qrTable} — ডাইন-ইন`)}</span>
                    <button className="chip" onClick={() => navigate("store")}>{tr(lang, "Clear table", "টেবিল সরান")}</button>
                  </div>
                )}
                <p style={{ marginTop: 8 }}>{tr(lang, "Order from your phone — delivery, takeaway or dine-in. Prices follow the owner's printed menu.", "মোবাইল থেকে অর্ডার করুন — ডেলিভারি, টেকঅ্যাওয়ে বা ডাইন-ইন। দাম মালিকের ছাপা মেনু অনুযায়ী।")}</p>
                <div className="row" style={{ marginTop: 12 }}>
                  <input aria-label={tr(lang, "Search menu", "মেনু খুঁজুন")} placeholder={tr(lang, "Search the menu…", "মেনু খুঁজুন…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn-gold" onClick={() => document.getElementById("menu-list")?.scrollIntoView({ behavior: "smooth" })}>{tr(lang, "Menu", "মেনু")}</button>
                </div>
                {settings.phone && <p style={{ marginTop: 10 }}>📞 <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a></p>}
              </div>
              <PromoVideo src={promoSrc(settings.promoVideo)} label="Café Reza promo video" poster="/img/hero.jpg" lang={lang} />
            </div>
          </section>

          <AdSlotView slotId="home-banner" adsJson={settings.adsJson} />
          <BannerCarousel products={products} onSelect={(p) => setDetail(p)} lang={lang} />
          <InstallAppCard variant="customer" lang={lang} />
          <OffersSection settings={settings} lang={lang} />

          <div className="row" style={{ marginTop: 18 }} role="tablist" aria-label="Categories">
            <button className={`chip ${cat === "all" ? "chip-on" : ""}`} onClick={() => setCat("all")}>{tr(lang, "All", "সব")}</button>
            {categories.filter((c) => c.active).map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? "chip-on" : ""}`} onClick={() => setCat(c.id)}>{lang === "bn" ? c.nameBn : c.nameEn}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {(["all", "best", "featured", "new"] as const).map((f) => <button key={f} className={`chip ${filter === f ? "chip-on" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? tr(lang, "All", "সব") : f === "best" ? tr(lang, "Best seller", "বেস্ট সেলার") : f === "featured" ? tr(lang, "Featured", "ফিচার্ড") : tr(lang, "New", "নতুন")}</button>)}
          </div>
          {isOffline && (
            <p className="small text-center" role="status" style={{ marginTop: 12, color: "var(--accent)", fontWeight: 600 }}>
              📶 {tr(lang, "You are offline — showing the saved menu. Prices and availability may be older; placing an order needs the network.", "আপনি অফলাইনে — সংরক্ষিত মেনু দেখানো হচ্ছে। দাম ও স্টক পুরনো হতে পারে; অর্ডার দিতে নেট লাগবে।")}
            </p>
          )}

          <div id="menu-list" className="grid products" style={{ marginTop: 14 }}>
            {filtered.map((p) => (
              <article key={p.slug} className="card" style={{ overflow: "hidden" }}>
                <button type="button" onClick={() => setDetail(p)} aria-label={`View ${p.nameEn}`} style={{ background: "none", border: "none", padding: 0, width: "100%", textAlign: "left", color: "var(--text)" }}>
                  <ProductImage p={p} h={150} />
                  <div style={{ padding: 12 }}>
                    <h3 style={{ margin: 0 }}>{displayName(p, lang)}</h3>
                    <p className="small muted" style={{ margin: "4px 0 0" }}>{p.description}</p>
                    {reviewAvg.get(p.slug) && (
                      <p style={{ margin: "4px 0 0" }}><Stars rating={reviewAvg.get(p.slug)!.avg} size={13} /> <span className="small muted">{reviewAvg.get(p.slug)!.avg.toFixed(1)} ({reviewAvg.get(p.slug)!.count})</span></p>
                    )}
                    <FoodInfo p={p} lang={lang} />
                    <div className="row" style={{ marginTop: 6 }}>
                      {p.bestSeller && <span className="chip" style={{ padding: "3px 9px", fontSize: 12, fontWeight: 800, background: "var(--gold)", color: "#1a1207", borderColor: "transparent" }}>★ {tr(lang, "Popular", "জনপ্রিয়")}</span>}
                      {p.isNew && <span className="chip" style={{ padding: "2px 7px", fontSize: 11 }}>{tr(lang, "New", "নতুন")}</span>}
                    </div>
                  </div>
                </button>
                <div className="row" style={{ justifyContent: "space-between", padding: "0 12px 12px" }}>
                  <b>{orderable(p) ? tk(effPrice(p)) : tr(lang, "Price soon", "দাম আসছে")}</b>
                  <button className="btn-gold" style={{ padding: "8px 14px" }} disabled={!orderable(p)} onClick={() => addToCart(p)}>{tr(lang, "Add", "যোগ করুন")}</button>
                </div>
              </article>
            ))}
          </div>
          {catalogLoading && filtered.length === 0 && (
            <div className="card" style={{ padding: 16, marginTop: 14, textAlign: "center" }}>
              <p>{tr(lang, "Loading the menu…", "মেনু লোড হচ্ছে…")}</p>
            </div>
          )}
          {filtered.length === 0 && !catalogError && !catalogLoading && (
            <div className="card" style={{ padding: 16, marginTop: 14, textAlign: "center" }}>
              <p>{isFirebaseConfigured
                ? tr(lang, "The menu is empty right now.", "মেনু এখন খালি।")
                : tr(lang, "The menu loads from Firestore once Firebase is configured.", "Firebase কনফিগার হলেই মেনু Firestore থেকে আসবে।")}</p>
              {isStaff && <button className="btn-gold" style={{ marginTop: 8 }} disabled={seedBusy} onClick={() => void runSeed()}>{seedBusy ? tr(lang, "Seeding…", "বসানো হচ্ছে…") : tr(lang, "Seed catalog", "ক্যাটালগ বসান")}</button>}
              {seedMsg && <p className="small" role="status">{seedMsg}</p>}
            </div>
          )}
          {catalogError && <p className="small" role="alert" style={{ color: "var(--bad)", marginTop: 10 }}>{catalogError}</p>}

          <AdSlotView slotId="menu" adsJson={settings.adsJson} />
          <AdSlotView slotId="offers" adsJson={settings.adsJson} />

          {content.showGallery && (
            <section style={{ marginTop: 24 }}>
              <h2 className="serif" style={{ fontSize: 24 }}>{tr(lang, "Gallery — real Cafe Reza posters", "গ্যালারি — ক্যাফে রেজার আসল পোস্টার")}</h2>
              <div className="grid products" style={{ marginTop: 10 }}>
                {["poster-faluda-red.jpg", "poster-grapes2.jpg", "poster-blue.jpg", "poster-dragon.jpg", "tray2.jpg", "tray.jpg"].map((f) => (
                  <img key={f} src={`/img/${f}`} alt={f} loading="lazy" decoding="async" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} />
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{ padding: 16, marginTop: 24 }}>
            <h2 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Printed menu", "ছাপা মেনু")}</h2>
            <p className="small muted">{tr(lang, "The owner's printed menu photo, for price reference.", "দাম যাচাইয়ের জন্য মালিকের ছাপা মেনুর ছবি।")}</p>
            <img src="/img/menu-photo.jpg?v=2" alt="Cafe Reza printed menu with prices" loading="lazy" decoding="async" style={{ width: "100%", borderRadius: 12, marginTop: 8 }} />
          </section>
          <AdSlotView slotId="footer" adsJson={settings.adsJson} />
        </main>
      )}

      {detail && (
        <DetailModal
          p={detail} categories={categories} lang={lang} onClose={() => setDetail(null)}
          onAdd={(extra) => { addToCart(detail, extra); setDetail(null); }}
          wishlisted={userDoc?.wishlist.includes(detail.slug) ?? false}
          onWish={() => toggleWishlist(detail.slug)}
          fbUser={fbUser} userDoc={userDoc}
        />
      )}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} setCart={setCart} products={products} settings={settings} fbUser={fbUser} userDoc={userDoc} lang={lang} initialTable={qrTable} />

      {view !== "admin" && (<footer className="wrap" style={{ marginTop: 28 }}>
        <div className="card" style={{ padding: 16, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span className="logo-tile" style={{ width: 56, height: 56 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p className="serif" style={{ fontSize: 18, margin: 0 }}>{settings.cafeName}</p>
            <p className={`small muted ${taglineClass(lang)}`} style={{ margin: 0 }}>{taglineText(settings, lang)}</p>
            <p className="small" style={{ margin: "4px 0 0" }}>{settings.address}</p>
            <p className="small" style={{ margin: 0 }}>{tr(lang, "Call:", "কল করুন:")} <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a> • <a href={settings.facebook} target="_blank" rel="noreferrer">Facebook</a> • <a href={MAPS_LINK} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a></p>
            <p className="small" style={{ margin: "6px 0 0" }}>
              <button type="button" onClick={() => navigate("refund")} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}>{tr(lang, "Refund Policy", "ফেরত নীতিমালা")}</button>
              {" • "}
              <button type="button" onClick={() => navigate("delivery")} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}>{tr(lang, "Delivery Policy", "ডেলিভারি নীতিমালা")}</button>
              {" • "}
              <button type="button" onClick={() => navigate("privacy")} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", fontSize: "inherit" }}>{tr(lang, "Privacy Policy", "গোপনীয়তা নীতিমালা")}</button>
            </p>
          </div>
        </div>
        <p className="small muted text-center" style={{ marginTop: 10 }}>BDT (৳) • Asia/Dhaka • {tr(lang, "Mobile payments stay “Pending verification” until verified.", "মোবাইল পেমেন্ট যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকে।")}</p>
      </footer>)}

      {view !== "admin" && (<nav className="bottomnav no-print" aria-label="Mobile">
        <button onClick={() => navigate("store")}>🏠 {tr(lang, "Menu", "মেনু")}</button>
        <button onClick={() => setCartOpen(true)}>🛒 {tr(lang, "Cart", "কার্ট")} ({cartCount})</button>
        <button onClick={() => navigate("track")}>📦 {tr(lang, "Track", "ট্র্যাক")}</button>
        <button onClick={() => navigate("account")}>👤 {tr(lang, "Account", "অ্যাকাউন্ট")}</button>
      </nav>)}
      {view !== "admin" && <ChatBox fbUser={fbUser} userDoc={userDoc} products={products} settings={settings} lang={lang} />}
      {/* No floating admin button on customer pages: the customer app
          carries no admin trace. Staff reach the panel via #/admin. */}
      {cart.length > 0 && view === "store" && !cartOpen && (
        <button className="btn-gold no-print" style={{ position: "fixed", right: 16, bottom: 76, zIndex: 40, boxShadow: "0 8px 20px rgba(0,0,0,.35)" }} onClick={() => setCartOpen(true)}>{tr(lang, "View cart", "কার্ট দেখুন")} • {tk(cart.reduce((a, c) => { const p = products.find((x) => x.slug === c.productId); return a + (p ? effPrice(p) * c.qty : 0); }, 0))} ({cartCount})</button>
      )}
    </div>
  );
}
