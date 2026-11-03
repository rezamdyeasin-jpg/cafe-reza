// Café Reza — standalone Firebase build.
// Firestore is the only database: the customer site reads the same
// collections the admin panel writes (products, categories, settings,
// coupons, orders, reservations, messages, users). There is no second
// copy of the menu anywhere in this client: the seed file only writes
// Firestore documents once, from the admin panel.
// Sign-in is Google, Facebook and phone number only. There is no
// email/password form and no email-verification step.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  addDoc, collection, doc, getFirestore, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, where, type DocumentData,
} from "firebase/firestore";
import {
  getDb, isFirebaseConfigured, loginWithFacebook, loginWithGoogle, signOutUser,
  startPhoneSignIn, confirmPhoneCode, watchAuth, MISSING_CONFIG_BN, ensureUserDoc,
  type PhoneConfirmation,
} from "./firebase";
import {
  BANNER_SLIDES, MAP_COORDS, MAPS_LINK,
} from "./seed";
import {
  AD_SLOT_DEFS, enabledPayments, isStaffRole, orderFromDoc, parseAds, parseBannerSelection,
  parseContent, productFromDoc, categoryFromDoc, seedCatalog, settingsFromDoc, tr,
  useCatalog, useLive, useLiveDoc, useSettingsDoc, userFromDoc,
  type Category, type Coupon, type Lang, type Order, type Product, type Reservation,
  type Settings, type UserDoc,
} from "./db";
import { placeOrderTx, type CartLine } from "./orders";
import { InstallAppCard } from "./InstallAppCard";
import { AdminPanel } from "./AdminPanel";

export type CartItem = { productId: string; qty: number; size: string; sugar: string; milk: string; note: string };
type View = "store" | "track" | "reserve" | "account" | "admin" | "info";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;
const imgSrc = (key: string | null | undefined) => (key ? `/img/${key}` : "");
const displayName = (p: Product, lang: Lang) => (lang === "bn" && p.nameBn ? p.nameBn : p.nameEn);
const effPrice = (p: Product) => p.discountPrice ?? p.price;
const orderable = (p: Product) => p.available && effPrice(p) > 0;

function ProductImage({ p, h }: { p: Product; h?: number }) {
  const [failed, setFailed] = useState(false);
  const src = imgSrc(p.imageKey);
  if (!src || failed) {
    return <div className="flex items-center justify-center" style={{ height: h ?? 160, background: "var(--surface2)" }}><span className="serif" style={{ fontSize: 44, color: "var(--accent)" }}>{(p.nameEn || "C").slice(0, 1)}</span></div>;
  }
  return <img src={src} alt={p.nameEn} loading="lazy" onError={() => setFailed(true)} style={{ width: "100%", height: h ?? 160, objectFit: "cover", display: "block" }} />;
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
      <p className="small muted" style={{ marginTop: 8 }}>{tr(lang, "Diagram from the stored ingredient list — edit it in Admin → Products.", "সংরক্ষিত উপকরণ তালিকা থেকে আঁকা ডায়াগ্রাম — Admin → Products-এ বদলানো যায়।")}</p>
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
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (slides.length < 2 || paused || reduced || document.hidden) return;
    const id = setTimeout(() => setIdx((i) => (i + 1) % slides.length), 3000);
    return () => clearTimeout(id);
  }, [idx, paused, slides.length, reduced]);
  if (slides.length === 0) return null;
  const slide = slides[idx % slides.length];
  if (!slide || !slide.product) return null;
  const product = slide.product;
  return (
    <div className="card mt-4 overflow-hidden" role="region" aria-label={tr(lang, "Café Reza promos", "ক্যাফে রেজার প্রোমো")}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ touchAction: "pan-y" }}>
      <button type="button" onClick={() => onSelect(product)} className="block w-full text-left" style={{ background: "none", border: "none", padding: 0 }}>
        <div className="banner-slide relative" style={{ background: "#0d0906", height: "min(78vw, 340px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={`/img/${slide.img}`} alt={slide.alt} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
        </div>
        <div className="flex items-center justify-between px-3 py-2" style={{ background: "rgba(22,15,12,.72)", color: "#f5ebdd", gap: 8, flexWrap: "nowrap", height: 40 }}>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{displayName(product, lang)}</b><span style={{ flex: "none" }}>{orderable(product) ? tk(effPrice(product)) : tr(lang, "Price coming soon", "দাম আসছে")}</span>
        </div>
      </button>
      <div className="row px-3 py-2" style={{ justifyContent: "space-between" }}>
        <button className="chip" aria-label="Previous banner" onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)}>←</button>
        <div className="row">{slides.map((s, i) => <button key={s.slug} className={`chip ${i === idx % slides.length ? "chip-on" : ""}`} style={{ padding: "4px 9px" }} aria-label={`Banner ${i + 1}: ${s.slug}`} onClick={() => setIdx(i)}>•</button>)}</div>
        <button className="chip" aria-label="Next banner" onClick={() => setIdx((i) => (i + 1) % slides.length)}>→</button>
      </div>
    </div>
  );
}

function PromoVideo({ src, label, poster, lang }: { src: string | null; label: string; poster?: string; lang: Lang }) {
  if (!src) return poster ? <img src={poster} alt={label} style={{ width: "100%", height: 224, objectFit: "cover", display: "block" }} /> : null;
  return <video src={src} poster={poster} autoPlay muted loop playsInline disablePictureInPicture preload="auto" aria-label={label} style={{ width: "100%", height: 224, objectFit: "cover", display: "block", background: "#000", pointerEvents: "none" }} />;
}

function promoSrc(choice: string | undefined): string | null {
  if (choice === "a") return "/video/promo-a.mp4";
  if (choice === "b") return "/video/promo-b.mp4";
  if (choice === "none") return null;
  return "/video/promo-main.mp4";
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
  const img = <img src={src} alt="Advertisement" loading="lazy" style={{ width: "100%", height: 104, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} />;
  return <div className="mt-4" aria-label="Advertisement"><p className="text-center small muted">ADVERTISEMENT</p>{slot.linkUrl.trim() ? <a href={slot.linkUrl} target="_blank" rel="noreferrer sponsored">{img}</a> : img}</div>;
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
    <div className="card p-5" style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="logo-tile mx-auto" style={{ width: 88, height: 88 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
      <h1 className="serif text-center" style={{ fontSize: 24, marginTop: 10 }}>{tr(lang, "Log in to Café Reza", "ক্যাফে রেজা-এ লগইন করুন")}</h1>
      <p className="small muted text-center">{tr(lang, "Sign in with Google, Facebook or your phone number. New accounts are always customers. No password, no email verification step.", "Google, Facebook বা ফোন নম্বর দিয়ে সাইন-ইন করুন। নতুন অ্যাকাউন্ট সবসময় কাস্টমার। কোনো পাসওয়ার্ড ও কোনো ইমেইল যাচাইয়ের ধাপ নেই।")}</p>
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
  );
}

function DetailModal({ p, categories, lang, onClose, onAdd, wishlisted, onWish }: {
  p: Product; categories: Category[]; lang: Lang; onClose: () => void;
  onAdd: (extra: { qty: number; size: string; sugar: string; milk: string; note: string }) => void;
  wishlisted: boolean; onWish: () => void;
}) {
  const [tab, setTab] = useState<"photo" | "ingredients">("photo");
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState("Regular");
  const [sugar, setSugar] = useState("Normal");
  const [milk, setMilk] = useState("Normal");
  const [note, setNote] = useState("");
  const catName = categories.find((c) => c.id === p.categoryId);
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
        <p style={{ fontSize: 20, fontWeight: 700 }}>{orderable(p) ? tk(effPrice(p)) : tr(lang, "Price coming soon — the owner sets it in Admin.", "দাম আসছে — মালিক Admin-এ বসাবেন।")}</p>
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
      </div>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, setCart, products, settings, fbUser, userDoc, lang }: {
  open: boolean; onClose: () => void; cart: CartItem[]; setCart: (c: CartItem[]) => void;
  products: Product[]; settings: Settings; fbUser: User | null; userDoc: UserDoc | null; lang: Lang;
}) {
  const [step, setStep] = useState<"cart" | "checkout" | "done">("cart");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orderType, setOrderType] = useState("delivery");
  const [tableLabel, setTableLabel] = useState("");
  const [payment, setPayment] = useState("Cash on Delivery");
  const [coupon, setCoupon] = useState("");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneNo, setDoneNo] = useState("");
  const [doneTotal, setDoneTotal] = useState(0);
  useEffect(() => {
    if (open) { setStep("cart"); setErr(""); window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }
  }, [open ]);
  useEffect(() => { if (userDoc) { setName(userDoc.name); setPhone(userDoc.phone); } }, [userDoc]);
  if (!open) return null;
  const lines: CartLine[] = cart.map((c) => {
    const p = products.find((x) => x.slug === c.productId);
    return p ? { product: p, qty: c.qty, size: c.size, sugar: c.sugar, milk: c.milk, note: c.note } : null;
  }).filter((l): l is CartLine => l !== null);
  const subtotal = lines.reduce((a, l) => a + effPrice(l.product) * l.qty, 0);
  const vat = Math.round((subtotal * settings.vatPercent) / 100);
  const fee = orderType === "delivery" ? (settings.freeDeliveryAt > 0 && subtotal >= settings.freeDeliveryAt ? 0 : settings.deliveryFee) : 0;
  const payments = enabledPayments(settings.paymentsJson);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fbUser) { setErr(tr(lang, "Sign in first — orders need a signed-in account (Google, Facebook or phone).", "আগে সাইন-ইন করুন — অর্ডারের জন্য সাইন-ইন করা অ্যাকাউন্ট লাগবে (Google, Facebook বা ফোন)।")); return; }
    setErr(""); setBusy(true);
    const r = await placeOrderTx({
      uid: fbUser.uid, customerName: name.trim(), phone: phone.trim(), address: address.trim(),
      orderType, source: "website", paymentMethod: payment, paymentRef: ref.trim(),
      tableLabel: orderType === "dine-in" ? tableLabel.trim() : "", notes: "", staffName: "",
      couponCode: coupon, lines, settings, paidAmount: 0,
    });
    setBusy(false);
    if (!r.ok || !r.orderNo) { setErr(r.error ?? tr(lang, "Order failed.", "অর্ডার ব্যর্থ হয়েছে।")); return; }
    try {
      const recent = JSON.parse(localStorage.getItem("cr_recent_orders") ?? "[]") as Array<{ orderNo: string; phone: string }>;
      localStorage.setItem("cr_recent_orders", JSON.stringify([{ orderNo: r.orderNo, phone: phone.trim() }, ...recent].slice(0, 20)));
    } catch { /* recents are best-effort */ }
    setDoneNo(r.orderNo); setDoneTotal(subtotal + vat + fee);
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
              {orderType === "delivery" && <label>{tr(lang, "Delivery address", "ডেলিভারির ঠিকানা")}<input aria-label="Delivery address" required value={address} onChange={(e) => setAddress(e.target.value)} /></label>}
              {orderType === "dine-in" && <label>{tr(lang, "Table", "টেবিল")}<input aria-label="Dine-in table" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} placeholder="T1" /></label>}
              <label>{tr(lang, "Payment method", "পেমেন্ট মাধ্যম")}<select aria-label="Payment method" value={payment} onChange={(e) => setPayment(e.target.value)}>{payments.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
              {["bKash", "Nagad", "Rocket", "Bank Transfer"].includes(payment) && (
                <div className="card" style={{ padding: 10, marginTop: 8 }}>
                  <p className="small"><b>{tr(lang, "Manual verification only.", "শুধু ম্যানুয়াল যাচাই।")}</b> {settings.paymentNote}</p>
                  <p className="small">{tr(lang, "Send to", "পাঠান")}: <b>{payment === "bKash" ? settings.bkashNumber : payment === "Nagad" ? settings.nagadNumber : payment === "Rocket" ? settings.rocketNumber : ""}</b></p>
                  <label>{tr(lang, "Transaction / reference ID", "লেনদেন / রেফারেন্স আইডি")}<input aria-label="Transaction reference ID" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
                </div>
              )}
              <label>{tr(lang, "Coupon code (optional)", "কুপন কোড (ঐচ্ছিক)")}<input aria-label="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></label>
              <div style={{ marginTop: 10, fontSize: 14 }}>
                <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Subtotal", "সাবটোটাল")}</span><span>{tk(subtotal)}</span></div>
                <div className="row" style={{ justifyContent: "space-between" }}><span>VAT ({settings.vatPercent}%)</span><span>{tk(vat)}</span></div>
                <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Delivery", "ডেলিভারি")}</span><span>{fee === 0 ? tr(lang, "Free", "ফ্রি") : tk(fee)}</span></div>
                <div className="row" style={{ justifyContent: "space-between", fontWeight: 700, fontSize: 16 }}><span>{tr(lang, "Total", "মোট")}</span><span>{tk(subtotal + vat + fee)}</span></div>
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
            {step === "cart"
              ? <button className="btn-gold" style={{ width: "100%", marginTop: 8, padding: "12px" }} onClick={() => setStep("checkout")}>{tr(lang, "Go to checkout", "চেকআউটে যান")}</button>
              : <>
                  <button className="btn-gold" style={{ width: "100%", marginTop: 8, padding: "12px" }} type="submit" form="fb-checkout-form" disabled={busy}>{busy ? tr(lang, "Placing…", "অর্ডার হচ্ছে…") : `${tr(lang, "Place order", "অর্ডার করুন")} • ${tk(subtotal + vat + fee)}`}</button>
                  <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setStep("cart")}>{tr(lang, "Back to cart", "কার্টে ফিরুন")}</button>
                </>}
          </div>
        )}
      </div>
    </div>
  );
}

const TRACK_STAGES = ["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered"];

function TrackView({ fbUser, lang }: { fbUser: User | null; lang: Lang }) {
  const firestore = getDb();
  const { data: orders } = useLive<Order>(
    () => (firestore && fbUser ? query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    orderFromDoc,
  );
  const [search, setSearch] = useState("");
  if (!fbUser) return <p className="muted">{tr(lang, "Sign in to track your orders.", "অর্ডার ট্র্যাক করতে সাইন-ইন করুন।")}</p>;
  const shown = search.trim() ? orders.filter((o) => o.orderNo.toLowerCase().includes(search.trim().toLowerCase())) : orders;
  return (
    <div>
      <h2 className="serif" style={{ fontSize: 22 }}>{tr(lang, "Track your order", "অর্ডার ট্র্যাক করুন")}</h2>
      <label>{tr(lang, "Search by order number", "অর্ডার নম্বর দিয়ে খুঁজুন")}<input aria-label="Search by order number" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="CR-XXXXXX" /></label>
      {shown.length === 0 && <p className="muted">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {shown.map((o) => {
        const stageIdx = TRACK_STAGES.indexOf(o.status);
        return (
          <div key={o.id} className="card" style={{ marginTop: 12, padding: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)}</span></div>
            <p className="small muted">{o.status} • {o.paymentMethod} • {o.paymentStatus} • {o.createdAt ? new Date(o.createdAt).toLocaleString("en-GB") : ""}</p>
            <div className="row" style={{ marginTop: 8 }}>
              {TRACK_STAGES.map((s, i) => <span key={s} className={`chip ${i <= stageIdx ? "chip-on" : ""}`} style={{ padding: "4px 8px", fontSize: 12 }}>{s}</span>)}
            </div>
            <ul style={{ marginTop: 8, fontSize: 14 }}>{o.items.map((it, i) => <li key={i}>{it.qty} × {it.name}</li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}

function ReserveView({ fbUser, userDoc, lang }: { fbUser: User | null; userDoc: UserDoc | null; lang: Lang }) {
  const firestore = getDb();
  const { data: mine } = useLive<Reservation>(
    () => (firestore && fbUser ? query(collection(firestore, "reservations"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), email: String(d.email ?? ""), date: String(d.date ?? ""), time: String(d.time ?? ""), guests: Number(d.guests ?? 2), requests: String(d.requests ?? ""), status: String(d.status ?? "Pending"), tableLabel: String(d.tableLabel ?? ""), userId: String(d.userId ?? ""), createdAt: "" }),
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [requests, setRequests] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (userDoc) { setName(userDoc.name); setPhone(userDoc.phone); } }, [userDoc]);
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
      {mine.length === 0 && <p className="muted small">{tr(lang, "No reservations yet.", "এখনো কোনো রিজার্ভেশন নেই।")}</p>}
      {mine.map((r) => <div key={r.id} className="card" style={{ marginTop: 8, padding: 12 }}><b>{r.date} {r.time}</b> • {r.guests} {tr(lang, "guests", "অতিথি")} • <span className="chip">{r.status}</span><p className="small muted">{tr(lang, "Table:", "টেবিল:")} {r.tableLabel || tr(lang, "To be assigned", "পরে জানানো হবে")}</p></div>)}
    </div>
  );
}

function AccountView({ fbUser, userDoc, products, lang, onGoAdmin }: { fbUser: User | null; userDoc: UserDoc | null; products: Product[]; lang: Lang; onGoAdmin: () => void }) {
  const firestore = getDb();
  const { data: orders } = useLive<Order>(
    () => (firestore && fbUser ? query(collection(firestore, "orders"), where("userId", "==", fbUser.uid), orderBy("createdAt", "desc")) : null),
    orderFromDoc,
  );
  const [addrDraft, setAddrDraft] = useState("");
  const [msgDraft, setMsgDraft] = useState("");
  const [msgDone, setMsgDone] = useState("");
  if (!fbUser) return <SignInCard lang={lang} onSignedIn={() => undefined} />;
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
          {userDoc && isStaffRole(userDoc.role) && <button className="btn-gold" onClick={onGoAdmin}>{tr(lang, "Open admin panel", "অ্যাডমিন প্যানেল খুলুন")}</button>}
        </div>
      </div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My orders", "আমার অর্ডারগুলো")}</h3>
      {orders.length === 0 && <p className="muted small">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {orders.slice(0, 10).map((o) => <div key={o.id} className="card" style={{ marginTop: 8, padding: 12 }}><div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)}</span></div><p className="small muted">{o.status} • {o.paymentMethod} • {o.paymentStatus}</p></div>)}
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "Favourites", "প্রিয় আইটেম")}</h3>
      {(!userDoc || userDoc.wishlist.length === 0) && <p className="muted small">{tr(lang, "No favourites yet — tap the heart on a product.", "এখনো প্রিয় আইটেম নেই — প্রোডাক্টের হার্ট চাপুন।")}</p>}
      <div className="row">{(userDoc?.wishlist ?? []).map((slug) => { const p = products.find((x) => x.slug === slug); return p ? <span key={slug} className="chip">{displayName(p, lang)}</span> : null; })}</div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "My addresses", "আমার ঠিকানাগুলো")}</h3>
      <div className="row">{(userDoc?.addresses ?? []).map((a) => <span key={a} className="chip">{a}</span>)}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <input aria-label="New address" value={addrDraft} onChange={(e) => setAddrDraft(e.target.value)} placeholder={tr(lang, "House, road, area", "বাড়ি, রাস্তা, এলাকা")} style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => { if (!firestore || !addrDraft.trim() || !userDoc) return; void updateDoc(doc(firestore, "users", fbUser.uid), { addresses: [...userDoc.addresses, addrDraft.trim()] }); setAddrDraft(""); }}>{tr(lang, "Add address", "ঠিকানা যোগ করুন")}</button>
      </div>
      <h3 className="serif" style={{ fontSize: 19, marginTop: 18 }}>{tr(lang, "Message the cafe", "ক্যাফেকে মেসেজ করুন")}</h3>
      <label>{tr(lang, "Your message", "আপনার মেসেজ")}<textarea aria-label="Message to the cafe" rows={3} value={msgDraft} onChange={(e) => setMsgDraft(e.target.value)} /></label>
      <button className="btn-gold" onClick={() => void sendMessage()}>{tr(lang, "Send message", "মেসেজ পাঠান")}</button>
      {msgDone && <p className="small" role="status">{msgDone}</p>}
    </div>
  );
}

function InfoView({ settings, lang }: { settings: Settings; lang: Lang }) {
  const content = parseContent(settings.contentJson);
  let hours: Array<{ day: string; open: string; close: string; closed?: boolean }> = [];
  try { const raw = JSON.parse(settings.hoursJson || "[]") as unknown; hours = Array.isArray(raw) ? raw as typeof hours : []; } catch { hours = []; }
  return (
    <div>
      <h2 className="serif" style={{ fontSize: 22 }}>{settings.cafeName}</h2>
      <p className="muted">{settings.tagline}</p>
      {content.aboutText && <p style={{ marginTop: 8 }}>{content.aboutText}</p>}
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Visit us", "আমাদের ঠিকানা")}</b>
        <p style={{ marginTop: 6 }}>{settings.address}</p>
        <p>{tr(lang, "Phone:", "ফোন:")} <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a></p>
        <p><a href={settings.facebook} target="_blank" rel="noreferrer">Facebook — Café Reza</a></p>
        <p className="small muted">{tr(lang, "Pin:", "পিন:")} {MAP_COORDS.lat}, {MAP_COORDS.lon} • {MAP_COORDS.plusCode}</p>
        <iframe title={tr(lang, "Café Reza location map", "ক্যাফে রেজার অবস্থানের মানচিত্র")} src={`https://www.google.com/maps?q=${MAP_COORDS.lat},${MAP_COORDS.lon}&output=embed`} loading="lazy" style={{ width: "100%", height: 280, border: "1px solid var(--border)", borderRadius: 12, marginTop: 8 }} />
        <a className="btn-gold" style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }} href={MAPS_LINK} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Opening hours", "খোলার সময়")}</b>
        {hours.length === 0
          ? <p className="muted small" style={{ marginTop: 6 }}>{settings.hours || tr(lang, "Hours are set by the cafe in the admin panel.", "সময় ক্যাফে অ্যাডমিন প্যানেলে বসায়।")}</p>
          : <table><tbody>{hours.map((h) => <tr key={h.day}><td>{h.day}</td><td>{h.closed ? tr(lang, "Closed", "বন্ধ") : `${h.open} – ${h.close}`}</td></tr>)}</tbody></table>}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Policies", "নীতিমালা")}</b>
        <p className="small" style={{ marginTop: 6 }}>{tr(lang, "Pending/Confirmed orders can be cancelled with stock restored. Mobile payments stay “Pending verification” until the owner verifies them in Admin — never auto-marked paid. Prices follow the owner's printed menu; items without a price stay unorderable until the owner sets one in Admin.", "অপেক্ষমাণ/নিশ্চিত অর্ডার স্টক ফিরিয়ে বাতিল করা যায়। মোবাইল পেমেন্ট মালিক অ্যাডমিনে যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকে — কখনো স্বয়ংক্রিয়ভাবে পরিশোধিত ধরা হয় না। দাম মালিকের ছাপা মেনু অনুযায়ী; দাম ছাড়া আইটেম মালিক Admin-এ দাম না বসানো পর্যন্ত অর্ডার করা যায় না।")}</p>
      </div>
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("cr_lang") === "en" ? "en" : "bn"));
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("store");
  const [fbUser, setFbUser] = useState<User | null>(null);
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
      setView(head === "admin" ? "admin" : head === "track" ? "track" : head === "reserve" ? "reserve" : head === "account" ? "account" : head === "about" ? "info" : "store");
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

  useEffect(() => watchAuth((u) => setFbUser(u)), []);
  useEffect(() => {
    const firestore = getDb();
    if (!firestore || !fbUser) { setUserDoc(null); return; }
    const unsub = onSnapshot(doc(firestore, "users", fbUser.uid), (snap) => {
      if (snap.exists()) setUserDoc(userFromDoc(snap.id, snap.data() as DocumentData));
      else { setUserDoc(null); void ensureUserDoc(fbUser); }
    });
    return unsub;
  }, [fbUser]);

  const { categories, products, error: catalogError } = useCatalog();
  const { data: settings } = useSettingsDoc();
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
      <header className="topbar no-print">
        <div className="wrap row" style={{ justifyContent: "space-between", paddingTop: 10, paddingBottom: 10 }}>
          <button type="button" onClick={() => navigate("store")} style={{ background: "none", border: "none", display: "flex", gap: 10, alignItems: "center", textAlign: "left", color: "var(--text)" }}>
            <span className="logo-tile" style={{ width: 44, height: 44 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></span>
            <span><b className="serif" style={{ fontSize: 19 }}>{settings.cafeName}</b><br /><span className="small muted">{settings.tagline}</span></span>
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
          <button className={`chip ${view === "admin" ? "chip-on" : ""}`} onClick={() => navigate("admin")}>{tr(lang, "Admin", "অ্যাডমিন")}</button>
        </nav>
      </header>

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
          <AdminPanel fbUser={fbUser} userDoc={userDoc} settings={settings} categories={categories} products={products} lang={lang} onBack={() => navigate("store")} onSeed={runSeed} seedBusy={seedBusy} seedMsg={seedMsg} signInCard={<SignInCard lang={lang} onSignedIn={() => undefined} />} />
        </main>
      ) : view === "track" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><TrackView key={fbUser?.uid ?? "guest"} fbUser={fbUser} lang={lang} /></main>
      ) : view === "reserve" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><ReserveView key={fbUser?.uid ?? "guest"} fbUser={fbUser} userDoc={userDoc} lang={lang} /></main>
      ) : view === "account" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}>
          <AccountView key={fbUser?.uid ?? "guest"} fbUser={fbUser} userDoc={userDoc} products={products} lang={lang} onGoAdmin={() => navigate("admin")} />
          <InstallAppCard variant="customer" lang={lang} />
        </main>
      ) : view === "info" ? (
        <main className="wrap" style={{ marginTop: 14, maxWidth: 720 }}><InfoView settings={settings} lang={lang} /></main>
      ) : (
        <main className="wrap">
          <section className="card" style={{ marginTop: 14, overflow: "hidden" }}>
            <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
              <div style={{ padding: 20 }}>
                <div className="logo-tile" style={{ width: 88, height: 88 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
                <h1 className="serif" style={{ fontSize: 32, marginTop: 10 }}>{settings.cafeName}</h1>
                <p className="muted">{settings.tagline}</p>
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

          <InstallAppCard variant="customer" lang={lang} />
          <AdSlotView slotId="home-banner" adsJson={settings.adsJson} />
          <BannerCarousel products={products} onSelect={(p) => setDetail(p)} lang={lang} />

          <div className="row" style={{ marginTop: 18 }} role="tablist" aria-label="Categories">
            <button className={`chip ${cat === "all" ? "chip-on" : ""}`} onClick={() => setCat("all")}>{tr(lang, "All", "সব")}</button>
            {categories.filter((c) => c.active).map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? "chip-on" : ""}`} onClick={() => setCat(c.id)}>{lang === "bn" ? c.nameBn : c.nameEn}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {(["all", "best", "featured", "new"] as const).map((f) => <button key={f} className={`chip ${filter === f ? "chip-on" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? tr(lang, "All", "সব") : f === "best" ? tr(lang, "Best seller", "বেস্ট সেলার") : f === "featured" ? tr(lang, "Featured", "ফিচার্ড") : tr(lang, "New", "নতুন")}</button>)}
          </div>

          <div id="menu-list" className="grid products" style={{ marginTop: 14 }}>
            {filtered.map((p) => (
              <article key={p.slug} className="card" style={{ overflow: "hidden" }}>
                <button type="button" onClick={() => setDetail(p)} aria-label={`View ${p.nameEn}`} style={{ background: "none", border: "none", padding: 0, width: "100%", textAlign: "left", color: "var(--text)" }}>
                  <ProductImage p={p} h={150} />
                  <div style={{ padding: 12 }}>
                    <h3 style={{ margin: 0 }}>{displayName(p, lang)}</h3>
                    <p className="small muted" style={{ margin: "4px 0 0" }}>{p.description}</p>
                    <div className="row" style={{ marginTop: 6 }}>
                      {p.bestSeller && <span className="chip" style={{ padding: "2px 7px", fontSize: 11 }}>★ {tr(lang, "Best seller", "বেস্ট সেলার")}</span>}
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
          {filtered.length === 0 && !catalogError && (
            <div className="card" style={{ padding: 16, marginTop: 14, textAlign: "center" }}>
              <p>{isFirebaseConfigured
                ? tr(lang, "The menu is empty in Firestore. An admin can seed the real Cafe Reza catalog (34 products, 9 categories) from the admin panel.", "Firestore-এ মেনু খালি। অ্যাডমিন প্যানেল থেকে অ্যাডমিন আসল ক্যাটালগ (৩৪টি প্রোডাক্ট, ৯টি ক্যাটাগরি) বসাতে পারেন।")
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
                {["poster-faluda-red.jpg", "poster-grapes2.jpg", "poster-blue.jpg", "poster-dragon.jpg", "tray2.jpg", "tray.jpg", "menu-photo.jpg"].map((f) => (
                  <img key={f} src={`/img/${f}`} alt={f} loading="lazy" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} />
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{ padding: 16, marginTop: 24 }}>
            <h2 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Printed menu", "ছাপা মেনু")}</h2>
            <p className="small muted">{tr(lang, "The owner's printed menu photo, for price reference.", "দাম যাচাইয়ের জন্য মালিকের ছাপা মেনুর ছবি।")}</p>
            <img src="/img/menu-photo.jpg" alt="Cafe Reza printed menu with prices" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 8 }} />
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
        />
      )}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} setCart={setCart} products={products} settings={settings} fbUser={fbUser} userDoc={userDoc} lang={lang} />

      <footer className="wrap" style={{ marginTop: 28 }}>
        <div className="card" style={{ padding: 16, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span className="logo-tile" style={{ width: 56, height: 56 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p className="serif" style={{ fontSize: 18, margin: 0 }}>{settings.cafeName}</p>
            <p className="small muted" style={{ margin: 0 }}>{settings.tagline}</p>
            <p className="small" style={{ margin: "4px 0 0" }}>{settings.address}</p>
            <p className="small" style={{ margin: 0 }}>{tr(lang, "Call:", "কল করুন:")} <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`}>{settings.phone}</a> • <a href={settings.facebook} target="_blank" rel="noreferrer">Facebook</a> • <a href={MAPS_LINK} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a></p>
          </div>
          <button className="btn-ghost" onClick={() => navigate("admin")}>{tr(lang, "Staff sign-in", "স্টাফ সাইন-ইন")}</button>
        </div>
        <p className="small muted text-center" style={{ marginTop: 10 }}>BDT (৳) • Asia/Dhaka • {tr(lang, "Firestore is the database. Mobile payments stay “Pending verification” until the owner verifies them.", "Firestore-ই ডেটাবেস। মোবাইল পেমেন্ট মালিক যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকে।")}</p>
      </footer>

      <nav className="bottomnav no-print" aria-label="Mobile">
        <button onClick={() => navigate("store")}>🏠 {tr(lang, "Menu", "মেনু")}</button>
        <button onClick={() => setCartOpen(true)}>🛒 {tr(lang, "Cart", "কার্ট")} ({cartCount})</button>
        <button onClick={() => navigate("track")}>📦 {tr(lang, "Track", "ট্র্যাক")}</button>
        <button onClick={() => navigate("account")}>👤 {tr(lang, "Account", "অ্যাকাউন্ট")}</button>
      </nav>
      {cart.length > 0 && view === "store" && !cartOpen && (
        <button className="btn-gold no-print" style={{ position: "fixed", right: 16, bottom: 76, zIndex: 40, boxShadow: "0 8px 20px rgba(0,0,0,.35)" }} onClick={() => setCartOpen(true)}>{tr(lang, "View cart", "কার্ট দেখুন")} • {tk(cart.reduce((a, c) => { const p = products.find((x) => x.slug === c.productId); return a + (p ? effPrice(p) * c.qty : 0); }, 0))} ({cartCount})</button>
      )}
    </div>
  );
}
