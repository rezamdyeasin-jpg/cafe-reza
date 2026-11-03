import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";
import { mapsEmbedUrl } from "./map_helpers.mjs";
import { confirmFirebaseEmailVerified, isFirebaseConfigured, mirrorCatalogToFirestore, probeFirebase, registerFirebaseEmailUser, sendFirebaseVerificationEmail, signInWithGoogleAndLink, type FirebaseProbe } from "./firebase";
import { APP_URL } from "./config";
import heroImg from "./assets/hero.jpg";
import logoImg from "./assets/logo.jpg";
import posterChoco from "./assets/poster-choco.jpg";
import posterFaluda from "./assets/poster-faluda.jpg";
import posterBlue from "./assets/poster-blue.jpg";
import posterPineapple from "./assets/poster-pineapple.jpg";
import posterLacchi from "./assets/poster-lacchi.jpg";
import posterFaludaRed from "./assets/poster-faluda-red.jpg";
import posterOreo from "./assets/poster-oreo.jpg";
import trayImg from "./assets/tray.jpg";
import posterGrapes from "./assets/poster-grapes.jpg";
import posterGreenmango from "./assets/poster-greenmango.jpg";
import posterCrusher from "./assets/poster-crusher.jpg";
import posterLitchi from "./assets/poster-litchi.jpg";
import posterDragon from "./assets/poster-dragon.jpg";
import posterOrange from "./assets/poster-orange.jpg";
import posterCoconut from "./assets/poster-coconut.jpg";
import posterCaramel from "./assets/poster-caramel.jpg";
import posterMangoShake from "./assets/poster-mango-shake.jpg";
import posterMangoSmoothie from "./assets/poster-mango-smoothie.jpg";
import posterGrapes2 from "./assets/poster-grapes2.jpg";
import posterSpecialCold from "./assets/poster-special-cold.jpg";
import posterKitkat from "./assets/poster-kitkat.jpg";
import posterStrawberry from "./assets/poster-strawberry.jpg";
import posterMilkTea from "./assets/poster-milk-tea.jpg";
import posterMalai from "./assets/poster-malai.jpg";
import posterColdTea from "./assets/poster-cold-tea.jpg";
import posterLemonadeHalf from "./assets/poster-lemonade-half.jpg";
import posterLemonadeFull from "./assets/poster-lemonade-full.jpg";
import mainMixedFruitJuice from "./assets/main-mixed-fruit-juice.png";
import mainHorlicksTea from "./assets/main-horlicks-tea.png";
import mainEdibleCupTea from "./assets/main-edible-cup-tea.png";
import posterHotCoffee from "./assets/poster-hot-coffee.jpg";
import posterEnergy from "./assets/poster-energy.jpg";
import posterDoiChira from "./assets/poster-doi-chira.jpg";
import posterMomo from "./assets/poster-momo.jpg";
import tray2Img from "./assets/tray2.jpg";
import posterEnergyDetail from "./assets/poster-energy-detail.jpg";
import menuPhoto from "./assets/menu-photo.jpg";
import promoMain from "./assets/promo-main.mp4";
import promoA from "./assets/promo-a.mp4";
import promoB from "./assets/promo-b.mp4";
import bannerGreenmango from "./assets/banner-greenmango.jpg";
import bannerCrusher from "./assets/banner-crusher.jpg";
import bannerCoconut from "./assets/banner-coconut.jpg";
import bannerFaluda from "./assets/banner-faluda.jpg";
import bannerBlue from "./assets/banner-blue.jpg";
import bannerPineapple from "./assets/banner-pineapple.jpg";

const IMAGES: Record<string, string> = { hero: heroImg, "poster-choco": posterChoco, "poster-faluda": posterFaluda, "poster-blue": posterBlue, "poster-pineapple": posterPineapple, "poster-lacchi": posterLacchi, "poster-faluda-red": posterFaludaRed, "poster-oreo": posterOreo, tray: trayImg, tray2: tray2Img, "poster-grapes": posterGrapes, "poster-greenmango": posterGreenmango, "poster-crusher": posterCrusher, "poster-litchi": posterLitchi, "poster-dragon": posterDragon, "poster-orange": posterOrange, "poster-coconut": posterCoconut, "poster-caramel": posterCaramel, "poster-mango-shake": posterMangoShake, "poster-mango-smoothie": posterMangoSmoothie, "poster-hot-coffee": posterHotCoffee, "poster-energy": posterEnergy, "poster-doi-chira": posterDoiChira, "poster-momo": posterMomo, "poster-energy-detail": posterEnergyDetail, "poster-grapes2": posterGrapes2, "poster-special-cold": posterSpecialCold, "poster-kitkat": posterKitkat, "poster-strawberry": posterStrawberry, "poster-milk-tea": posterMilkTea, "poster-malai": posterMalai, "poster-cold-tea": posterColdTea, "poster-lemonade-half": posterLemonadeHalf, "poster-lemonade-full": posterLemonadeFull, "main-mixed-fruit-juice": mainMixedFruitJuice, "main-horlicks-tea": mainHorlicksTea, "main-edible-cup-tea": mainEdibleCupTea };
type Store = ApiResponse<typeof api, "getStorefront">;
type Product = Store["products"][number];
type AdminProduct = Product & { costPrice: number };
type Order = ApiResponse<typeof api, "me">["orders"][number];
type OrderItem = { productId: number; name: string; qty: number; price: number; size: string; note: string };
type CartItem = { productId: number; qty: number; size: string; sugar: string; milk: string; note: string };
type View = "store" | "cart" | "checkout" | "track" | "reserve" | "account" | "admin" | "info";
const STATUSES = ["Pending", "Confirmed", "Accepted", "Preparing", "Ready", "Out for Delivery", "Delivered", "Completed", "Cancelled", "Refunded"];

// Optional future ad placements. Every slot is OFF by default and renders
// nothing when empty, so the layout never breaks. No ad-network code is
// hardcoded anywhere: an admin enables a slot later in Admin → Settings
// and supplies a banner image + link, or embed code. Embed code is never
// injected into this page — it runs inside a sandboxed iframe isolated
// from the app, so it cannot read the page, storage or session tokens.
type AdSlotId = "home-banner" | "menu" | "offers" | "footer";
type AdSlot = { id: AdSlotId; enabled: boolean; kind: "image" | "code"; imageUrl: string; linkUrl: string; code: string };
const AD_SLOT_DEFS: Array<{ id: AdSlotId; label: string; hint: string }> = [
  { id: "home-banner", label: "Homepage banner", hint: "Shown under the hero on the storefront." },
  { id: "menu", label: "Below the menu list", hint: "Shown under the product grid, between content sections." },
  { id: "offers", label: "Offers section", hint: "Shown before the gallery, under the menu." },
  { id: "footer", label: "Footer area", hint: "Shown just above the footer." },
];
function parseAds(json?: string | null): AdSlot[] {
  let raw: unknown = [];
  try { raw = json ? JSON.parse(json) : []; } catch { raw = []; }
  const arr = Array.isArray(raw) ? raw : [];
  return AD_SLOT_DEFS.map((d) => {
    const found = arr.find((x) => (x as AdSlot)?.id === d.id) as Partial<AdSlot> | undefined;
    return { id: d.id, enabled: found?.enabled === true, kind: found?.kind === "code" ? "code" : "image", imageUrl: typeof found?.imageUrl === "string" ? found.imageUrl : "", linkUrl: typeof found?.linkUrl === "string" ? found.linkUrl : "", code: typeof found?.code === "string" ? found.code : "" };
  });
}
function AdSlotView({ slotId, adsJson }: { slotId: AdSlotId; adsJson?: string | null }) {
  const slot = parseAds(adsJson).find((s) => s.id === slotId);
  if (!slot || !slot.enabled) return null;
  const safeHttp = (u: string) => /^https?:\/\//i.test(u.trim());
  if (slot.kind === "code") {
    if (!slot.code.trim()) return null;
    return (
      <div className="mt-4" aria-label="Advertisement">
        <p className="mb-1 text-center text-[10px] tracking-widest uppercase" style={{ color: "var(--dim)" }}>Advertisement</p>
        <iframe title={`Advertisement — ${slotId}`} sandbox="allow-scripts" allow="autoplay=()" srcDoc={slot.code} className="w-full rounded-xl" style={{ border: "1px solid var(--border)", height: 120, background: "#fff" }} />
      </div>
    );
  }
  const src = slot.imageUrl.trim();
  if (!src || !(safeHttp(src) || src.startsWith("data:image/"))) return null;
  const img = <img src={src} alt="Advertisement" loading="lazy" className="h-[76px] w-full rounded-xl object-cover object-center sm:h-[104px] md:h-[128px]" style={{ border: "1px solid var(--border)" }} />;
  return (
    <div className="mt-4" aria-label="Advertisement">
      <p className="mb-1 text-center text-[10px] tracking-widest uppercase" style={{ color: "var(--dim)" }}>Advertisement</p>
      {slot.linkUrl.trim() && safeHttp(slot.linkUrl) ? <a href={slot.linkUrl} target="_blank" rel="noreferrer sponsored">{img}</a> : img}
    </div>
  );
}
const PAYMENTS = ["Cash on Delivery", "Cash at Counter", "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer"];

// ---- Order tracking: orders placed on this device -----------------------
// After checkout the order number used to vanish with the confirmation
// screen. Recent orders are now remembered on this device (order number +
// phone only, nothing else) so the Track page can list them in order
// below the search box without the customer retyping an ID.
type RecentOrder = { orderNo: string; phone: string; total: number; at: string };
function loadRecentOrders(): RecentOrder[] {
  try { const raw = JSON.parse(localStorage.getItem("cr_recent_orders") ?? "[]"); return Array.isArray(raw) ? raw.filter((r) => typeof r?.orderNo === "string") : []; } catch { return []; }
}
function saveRecentOrder(orderNo: string, phone: string, total: number) {
  try {
    const list = loadRecentOrders().filter((r) => r.orderNo !== orderNo);
    list.unshift({ orderNo, phone, total, at: new Date().toISOString() });
    localStorage.setItem("cr_recent_orders", JSON.stringify(list.slice(0, 20)));
  } catch { /* storage unavailable — tracking search still works */ }
}

// ---- Table reservations: same persistence as orders --------------------
// A reservation used to vanish with its confirmation screen. The saved
// reservation (ID + phone) is remembered on this device, and the latest
// confirmation is kept until the customer starts another booking, so the
// booking survives navigation and reload and ID search finds it again.
type ReservationRow = { id: number; name: string; phone: string; email: string; date: string; time: string; guests: number; requests: string; status: string; tableLabel: string; createdAt: string };
type RecentReservation = { id: number; phone: string };
function loadRecentReservations(): RecentReservation[] {
  try { const raw = JSON.parse(localStorage.getItem("cr_recent_reservations") ?? "[]"); return Array.isArray(raw) ? raw.filter((r) => typeof r?.id === "number") : []; } catch { return []; }
}
function saveRecentReservation(id: number, phone: string) {
  try {
    const list = loadRecentReservations().filter((r) => r.id !== id);
    list.unshift({ id, phone });
    localStorage.setItem("cr_recent_reservations", JSON.stringify(list.slice(0, 20)));
  } catch { /* storage unavailable — phone lookup still works */ }
}
function loadLastReservation(): ReservationRow | null {
  try { const raw = JSON.parse(localStorage.getItem("cr_last_reservation") ?? "null"); return raw && typeof raw.id === "number" ? raw as ReservationRow : null; } catch { return null; }
}
function storeLastReservation(r: ReservationRow) { try { localStorage.setItem("cr_last_reservation", JSON.stringify(r)); } catch { /* ignore */ } }
function clearLastReservation() { try { localStorage.removeItem("cr_last_reservation"); } catch { /* ignore */ } }

// ---- Admin-controllable content, hours, zones, payments -----------------
type Zone = { area: string; fee: number; minOrder: number; active: boolean };
type HoursDay = { day: string; open: string; close: string; closed: boolean };
const WEEKDAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
function parseZones(json?: string | null): Zone[] {
  try { const raw = JSON.parse(json ?? "[]"); return Array.isArray(raw) ? raw.filter((z) => typeof z?.area === "string" && z.area.trim()).map((z) => ({ area: z.area, fee: Number(z.fee) || 0, minOrder: Number(z.minOrder) || 0, active: z.active !== false })) : []; } catch { return []; }
}
// No invented hours: when the owner has not saved opening hours, this
// returns no days and the storefront shows no hours text at all. The editor
// in Settings uses defaultHoursRows() as a starting draft only.
function parseHours(json?: string | null): HoursDay[] {
  try { const raw = JSON.parse(json ?? ""); if (Array.isArray(raw) && raw.length === 7) return raw.map((d, i) => ({ day: WEEKDAYS[i] ?? "", open: String(d?.open ?? "09:00"), close: String(d?.close ?? "22:00"), closed: d?.closed === true })); } catch { /* fall through */ }
  return [];
}
function defaultHoursRows(): HoursDay[] { return WEEKDAYS.map((day) => ({ day, open: "09:00", close: "22:00", closed: false })); }
function parseEnabledPayments(json?: string | null): string[] {
  try { const raw = JSON.parse(json ?? ""); if (Array.isArray(raw) && raw.length > 0) return raw.filter((m) => PAYMENTS.includes(m)); } catch { /* fall through */ }
  return [...PAYMENTS];
}
function parseContent(json?: string | null): { announcement: string; aboutText: string; showGallery: boolean } {
  try { const raw = JSON.parse(json ?? ""); return { announcement: typeof raw?.announcement === "string" ? raw.announcement : "", aboutText: typeof raw?.aboutText === "string" ? raw.aboutText : "", showGallery: raw?.showGallery !== false }; } catch { return { announcement: "", aboutText: "", showGallery: true }; }
}
function parseBannerSelection(json?: string | null): string[] {
  try { const raw = JSON.parse(json ?? "[]"); return Array.isArray(raw) ? raw.filter((s) => typeof s === "string" && s.trim()) : []; } catch { return []; }
}
function todayHoursText(settings: Store["settings"] | undefined, lang: Lang = "en"): string {
  if (!settings) return "";
  const days = parseHours(settings.hoursJson);
  // Day names in the stored hours are English; match against the English
  // weekday, but render the label in the active language.
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Asia/Dhaka" });
  const hit = days.find((d) => d.day === today);
  if (hit) return hit.closed ? tr(lang, `Closed today (${today})`, `আজ বন্ধ (${today})`) : tr(lang, `Open today ${hit.open}–${hit.close}`, `আজ খোলা ${hit.open}–${hit.close}`);
  return settings.hours || "";
}
// Full settings payload for partial saves: saveSettings only changes the
// fields supplied, but the request still needs the base fields, so callers
// build the payload from the current settings plus their patch.
function settingsPayload(settings: Record<string, unknown>, patch: Record<string, unknown>) {
  return {
    cafeName: String(settings.cafeName ?? "Cafe Reza"), tagline: String(settings.tagline ?? ""), address: String(settings.address ?? ""), phone: String(settings.phone ?? ""), email: String(settings.email ?? ""), facebook: String(settings.facebook ?? ""), hours: String(settings.hours ?? ""), vatPercent: Number(settings.vatPercent ?? 0), deliveryFee: Number(settings.deliveryFee ?? 40), freeDeliveryAt: Number(settings.freeDeliveryAt ?? 500), minOrder: Number(settings.minOrder ?? 0), demoMode: Boolean(settings.demoMode ?? true), bkashNumber: String(settings.bkashNumber ?? ""), nagadNumber: String(settings.nagadNumber ?? ""), rocketNumber: String(settings.rocketNumber ?? ""), paymentNote: String(settings.paymentNote ?? ""), adsJson: String(settings.adsJson ?? "[]"), hoursJson: String(settings.hoursJson ?? ""), zonesJson: String(settings.zonesJson ?? "[]"), paymentsJson: String(settings.paymentsJson ?? ""), contentJson: String(settings.contentJson ?? ""), promoVideo: String(settings.promoVideo ?? "main"), bannersJson: String(settings.bannersJson ?? "[]"), loyaltyPerAmount: Number(settings.loyaltyPerAmount ?? 100), loyaltyRedeemPoints: Number(settings.loyaltyRedeemPoints ?? 100), loyaltyRedeemValue: Number(settings.loyaltyRedeemValue ?? 20), ...patch,
  };
}
const tk = (n: number) => `৳${n.toLocaleString("en-IN")}`;
// ---- Full language switch: no mixed language -----------------------------
// The switcher must translate everything it renders. `tr` picks the whole
// string for the active language; status/type/payment labels go through the
// maps below so dynamically generated text (chips, timelines, receipts,
// notifications) is translated too. Owner-entered data (product names in
// both languages, custom notes, chat messages) renders as entered.
type Lang = "bn" | "en";
const tr = (lang: Lang, en: string, bn: string) => (lang === "bn" ? bn : en);
const STATUS_BN: Record<string, string> = { Pending: "অপেক্ষমাণ", Confirmed: "নিশ্চিত", Accepted: "গৃহীত", Preparing: "প্রস্তুত হচ্ছে", Ready: "প্রস্তুত", "Out for Delivery": "ডেলিভারির পথে", Delivered: "ডেলিভারি হয়েছে", Completed: "সম্পন্ন", Cancelled: "বাতিল", Refunded: "ফেরত দেওয়া হয়েছে", Approved: "অনুমোদিত", Rejected: "প্রত্যাখ্যাত", "Checked In": "চেক-ইন হয়েছে", "No Show": "আসেননি", Open: "খোলা", "In Progress": "চলমান", Resolved: "সমাধান হয়েছে", Closed: "বন্ধ" };
const statusText = (s: string, lang: Lang) => (lang === "bn" ? (STATUS_BN[s] ?? s) : s);
const TYPE_BN: Record<string, string> = { delivery: "ডেলিভারি", takeaway: "টেকঅ্যাওয়ে", "dine-in": "ডাইন-ইন" };
const typeText = (s: string, lang: Lang) => (lang === "bn" ? (TYPE_BN[s] ?? s) : s);
const PAY_BN: Record<string, string> = { Paid: "পরিশোধিত", Unpaid: "অপরিশোধিত", Pending: "অপেক্ষমাণ", Processing: "প্রক্রিয়াধীন", Failed: "ব্যর্থ", Refunded: "ফেরত দেওয়া হয়েছে", "Partially Refunded": "আংশিক ফেরত", "Pending verification": "যাচাইয়ের অপেক্ষায়" };
const payText = (s: string, lang: Lang) => (lang === "bn" ? (PAY_BN[s] ?? s) : s);
const PAYMENT_METHOD_BN: Record<string, string> = { "Cash on Delivery": "ক্যাশ অন ডেলিভারি", "Bank Transfer": "ব্যাংক ট্রান্সফার", Cash: "নগদ", "Cash at Counter": "কাউন্টারে নগদ", Split: "ভাগ করা" };
const paymentMethodText = (m: string, lang: Lang) => (lang === "bn" ? (PAYMENT_METHOD_BN[m] ?? m) : m);
// The default tagline and the seed product descriptions are stored in
// English only (settings / product rows have no Bengali field for them).
// In Bengali mode, show the Bengali rendering of exactly those stored
// strings; anything the owner edits afterwards shows as entered, so an
// edited description is never mistranslated by a stale mapping.
const DEFAULT_TAGLINE_EN = "On a mission to serve fresh, healthy & tasty food.";
const taglineText = (tagline: string | undefined | null, lang: Lang) => {
  if (!tagline) return tr(lang, DEFAULT_TAGLINE_EN, "তাজা, স্বাস্থ্যকর ও সুস্বাদু খাবার পরিবেশনের লক্ষ্যে।");
  if (lang === "bn" && tagline === DEFAULT_TAGLINE_EN) return "তাজা, স্বাস্থ্যকর ও সুস্বাদু খাবার পরিবেশনের লক্ষ্যে।";
  return tagline;
};
const DESCRIPTION_BN: Record<string, string> = {
  "Classic hot coffee, served fresh at the counter.": "ক্লাসিক হট কফি, কাউন্টারে তাজা পরিবেশন করা হয়।",
  "Our special hot coffee — the house favourite.": "আমাদের স্পেশাল হট কফি — ক্যাফের সবচেয়ে পছন্দের।",
  "Chilled chocolate coffee, served cold.": "ঠান্ডা চকোলেট কফি, ঠান্ডা পরিবেশন করা হয়।",
  "Chilled caramel coffee, served cold.": "ঠান্ডা ক্যারামেল কফি, ঠান্ডা পরিবেশন করা হয়।",
  "Our special cold coffee.": "আমাদের স্পেশাল কোল্ড কফি।",
  "Thick Oreo milkshake.": "ঘন ওরিও মিল্কশেক।",
  "Thick Kitkat milkshake.": "ঘন কিটক্যাট মিল্কশেক।",
  "Strawberry milkshake.": "স্ট্রবেরি মিল্কশেক।",
  "Cool, creamy coconut smoothie.": "ঠান্ডা, ক্রিমি কোকোনাট স্মুদি।",
  "Fresh pineapple juice.": "তাজা আনারসের জুস।",
  "Mixed fresh fruit juice.": "মিক্সড তাজা ফলের জুস।",
  "Grapes juice. Price to be set by the owner in Admin — not orderable until then.": "আঙুরের জুস। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Cafe Reza's signature special faluda.": "ক্যাফে রেজার সিগনেচার স্পেশাল ফালুদা।",
  "Curd with flattened rice — a light, traditional favourite.": "দই-চিড়া — হালকা, ঐতিহ্যবাহী পছন্দের খাবার।",
  "The special version of our doi-chira.": "আমাদের দই-চিড়ার স্পেশাল সংস্করণ।",
  "Steamed chicken momo, five pieces per plate.": "ভাপে সেদ্ধ চিকেন মোমো, প্রতি প্লেটে পাঁচ পিস।",
  "Spicy naga-style steamed momo, five pieces, served with special sauce.": "ঝাল নাগা স্টাইলের ভাপে সেদ্ধ মোমো, পাঁচ পিস, স্পেশাল সসসহ পরিবেশন করা হয়।",
  "Regular milk tea.": "রেগুলার দুধ চা।",
  "Rich malai tea.": "সমৃদ্ধ মালাই চা।",
  "Blue Lagoon mocktail. Price to be set by the owner in Admin — not orderable until then.": "ব্লু লেগুন মকটেল। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Our energy booster drink.": "আমাদের এনার্জি বুস্টার ড্রিংক।",
  "Chilled yoghurt lacchi.": "ঠান্ডা দইয়ের লাচ্ছি।",
  "Green mango juice. Price to be set by the owner in Admin — not orderable until then.": "কাঁচা আমের জুস। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Blue Lagoon Crusher — a separate variant from Blue Lagoon Mocktail. Price to be set by the owner in Admin.": "ব্লু লেগুন ক্রাশার — ব্লু লেগুন মকটেল থেকে আলাদা একটি ভ্যারিয়েন্ট। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন।",
  "Litchi juice. Price to be set by the owner in Admin — not orderable until then.": "লিচুর জুস। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Dragon fruit juice. Price to be set by the owner in Admin — not orderable until then.": "ড্রাগন ফলের জুস। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Orange juice. Price to be set by the owner in Admin — not orderable until then.": "কমলার জুস। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Mango milkshake. Price to be set by the owner in Admin — not orderable until then.": "আমের মিল্কশেক। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
  "Printed menu: 30/50 TK. Please confirm the option with the cafe when ordering.": "ছাপা মেনু: 30/50 টাকা। অর্ডার করার সময় ক্যাফের সাথে অপশনটি নিশ্চিত করে নিন।",
  "Tea served in an edible cup.": "খাওয়ার উপযোগী কাপে পরিবেশিত চা।",
  "Chilled cold tea.": "ঠান্ডা কোল্ড চা।",
  "Iced mint lemonade, half size — 60 TK per the owner's correction.": "আইসড মিন্ট লেমনেড, হাফ সাইজ — মালিকের সংশোধন অনুযায়ী 60 টাকা।",
  "Iced mint lemonade, full size — 120 TK per the owner's correction.": "আইসড মিন্ট লেমনেড, ফুল সাইজ — মালিকের সংশোধন অনুযায়ী 120 টাকা।",
  "Mango smoothie. Price to be set by the owner in Admin — not orderable until then.": "আমের স্মুদি। মালিক অ্যাডমিনে দাম নির্ধারণ করবেন — তার আগ পর্যন্ত অর্ডার করা যাবে না।",
};
const descText = (p: Product, lang: Lang) => (lang === "bn" ? (DESCRIPTION_BN[p.description] ?? p.description) : p.description);
// Same exact-match rule for the stored default address: only the
// owner-supplied default address gets a Bengali rendering; an edited
// address shows exactly as entered.
const DEFAULT_ADDRESS_EN = "Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh";
const addressText = (address: string | undefined | null, lang: Lang) => {
  const a = address || DEFAULT_ADDRESS_EN;
  if (lang === "bn" && a === DEFAULT_ADDRESS_EN) return "ধুলিপাড়া চৌমুহনী, EPZ রোড, কুমিল্লা, বাংলাদেশ";
  return a;
};
const categoryName = (p: Product, categories: Store["categories"] | undefined, lang: Lang) => {
  const c = categories?.find((x) => x.id === p.categoryId);
  if (!c) return p.category;
  return lang === "bn" ? c.nameBn : c.nameEn;
};
// Gallery poster labels are hardcoded English strings; render the
// Bengali product name in Bengali mode.
const GALLERY_BN: Record<string, string> = {
  "Special Faluda": "স্পেশাল ফালুদা",
  "Grapes Juice": "আঙুরের জুস",
  "Blue Lagoon": "ব্লু লেগুন",
  "Dragon Fruit Juice": "ড্রাগন ফলের জুস",
  "Cafe Reza tray — Momo, Doi-chira and Lacchi": "ক্যাফে রেজার ট্রে — মোমো, দই-চিড়া ও লাচ্ছি",
  "Momo · Doi-chira · Lacchi": "মোমো · দই-চিড়া · লাচ্ছি",
};
const galleryText = (en: string, lang: Lang) => (lang === "bn" ? (GALLERY_BN[en] ?? en) : en);
// ---- Cafe location (from the cafe's own Facebook page) -------------------
// The address, phone, tagline and Facebook page below come from the
// owner-supplied Facebook screenshot and live in Admin → Settings, so the
// owner can edit them without code. The map pin is NOT guessed: it comes
// from the exact location link the owner sent and that was verified on
// 2026-11-03 — https://goo.gl/maps/iPaXfgRejF3aaPr1A — which resolves to
// 23°26'59.3"N 91°11'24.4"E (23.449810, 91.190120), Plus Code C5XR+W2H
// Cumilla, on Dr Akhtar Hameed Khan Rd near Thira Pukur Rd. The embedded
// map is centered on those coordinates with the pin there, and every
// "Get Directions" button opens exactly that link. The Google map itself
// shows only the coordinates (no business name); the "Café Reza" label is
// page text beside the map. Do not replace this pin with an address search
// or different coordinates.
const CAFE_MAPS_URL = "https://goo.gl/maps/iPaXfgRejF3aaPr1A";
const CAFE_MAP_LABEL = "Café Reza — ধুলিপাড়া চৌমুহনী, EPZ রোড, কুমিল্লা";
type CafeSettings = { cafeName: string; tagline: string; address: string; phone: string; facebook: string };
function cafePlace(s: CafeSettings | undefined) {
  const address = s?.address || "Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh";
  return { label: s?.cafeName || "Café Reza", venue: s?.cafeName || "Café Reza", address, locality: "Comilla", country: "Bangladesh", lat: 23.44981, lng: 91.19012 };
}
function telHref(phone: string): string {
  const digits = phone.replace(/[^+\d]/g, "");
  return digits ? `tel:${digits}` : "";
}
function CafeMap({ settings, lang = "en", compact = false }: { settings: CafeSettings | undefined; lang?: Lang; compact?: boolean }) {
  const place = cafePlace(settings);
  const embed = mapsEmbedUrl(place);
  if (!embed) return null;
  return (
    <div>
      <p className="mb-2 text-sm"><b>{CAFE_MAP_LABEL}</b></p>
      <iframe
        title={CAFE_MAP_LABEL}
        src={embed}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        className="w-full rounded-xl"
        style={{ border: "1px solid var(--border)", height: compact ? 190 : 260, background: "var(--surface2)" }}
      />
      <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "Pin: 23.449810, 91.190120 • Plus Code C5XR+W2H Cumilla — from the owner's verified Google Maps link.", "পিন: 23.449810, 91.190120 • প্লাস কোড C5XR+W2H Cumilla — মালিকের যাচাই করা Google Maps লিংক থেকে।")}</p>
    </div>
  );
}
function CafeLocation({ settings, title, lang = "en" }: { settings: CafeSettings | undefined; title?: string; lang?: Lang }) {
  const place = cafePlace(settings);
  const phone = settings?.phone || "+880 1805-501689";
  const fb = settings?.facebook || "https://www.facebook.com/cafereza4u";
  return (
    <div className="card p-4">
      <b>{title ?? tr(lang, "Visit Café Reza", "ক্যাফে রেজায় আসুন")}</b>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Food & Drink • {taglineText(settings?.tagline, lang)}</p>
      <p className="mt-2 text-sm"><b>{tr(lang, "Address", "ঠিকানা")}:</b> {addressText(place.address, lang)}</p>
      <p className="mt-1 text-sm"><b>{tr(lang, "Phone", "ফোন")}:</b> <a className="underline" href={telHref(phone)}>{phone}</a></p>
      <div className="mt-3"><CafeMap settings={settings} lang={lang} /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn-gold" href={CAFE_MAPS_URL} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a>
        <a className="btn-ghost" href={CAFE_MAPS_URL} target="_blank" rel="noopener">{tr(lang, "View live location on Google Maps", "Google Maps-এ লাইভ লোকেশন দেখুন")}</a>
        <a className="btn-ghost" href={fb} target="_blank" rel="noreferrer">{tr(lang, "Facebook — Café Reza", "ফেসবুক — ক্যাফে রেজা")}</a>
        <a className="btn-ghost" href={fb} target="_blank" rel="noreferrer">{tr(lang, "Message via Facebook page", "ফেসবুক পেজে মেসেজ করুন")}</a>
      </div>
    </div>
  );
}
// ---- Private in-app chat -------------------------------------------------
// One conversation per customer, visible only to that customer and to staff.
// Never rendered on public pages, product pages or reviews.
type ChatMsg = { id: number; orderNo: string; author: string; authorName: string; body: string; readFlag: boolean; createdAt: string };
function ChatPanel({ token, userName, userPhone, orderNo, contextLabel, lang = "en" }: { token: string | null; userName?: string; userPhone?: string; orderNo?: string; contextLabel?: string; lang?: Lang }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(userName ?? "");
  const [phone, setPhone] = useState(userPhone ?? "");
  const [err, setErr] = useState("");
  const load = async () => {
    try {
      const r = await api.listMyMessages({ token: token ?? undefined, phone });
      setMsgs(r.messages as ChatMsg[]);
      setUnread(r.unreadStaff);
      if (r.unreadStaff > 0) { await api.markMessagesRead({ token: token ?? undefined, phone, guestPhone: "", from: "staff" }); setUnread(0); }
    } catch { /* chat stays usable offline of this load */ }
  };
  useEffect(() => { void load(); }, [token, phone, orderNo]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const r = await api.sendMessage({ token: token ?? undefined, name, phone, orderNo: orderNo ?? "", body: draft.trim() });
    if (!r.ok) { setErr(r.error ?? "Could not send."); return; }
    setErr(""); setDraft(""); void load();
  };
  return (
    <div>
      <p className="text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Private chat with the cafe", "ক্যাফের সাথে প্রাইভেট চ্যাট")}{contextLabel ? ` — ${contextLabel}` : ""}. {tr(lang, "Only you and cafe staff can see these messages.", "শুধু আপনি ও ক্যাফের স্টাফ এই মেসেজগুলো দেখতে পারবেন।")}{unread > 0 ? ` ${unread} new reply from the cafe.` : ""}</p>
      <div className="mt-3 space-y-2" style={{ maxHeight: 320, overflowY: "auto" }} aria-live="polite">
        {msgs.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No messages yet. Ask about an item, an order, or a table booking.", "এখনো কোনো মেসেজ নেই। কোনো আইটেম, অর্ডার বা টেবিল বুকিং নিয়ে জিজ্ঞাসা করুন।")}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={m.author === "customer" ? "text-right" : "text-left"}>
            <span className="inline-block max-w-[85%] rounded-xl px-3 py-2 text-left text-sm" style={{ background: m.author === "customer" ? "var(--surface2)" : "var(--accent)", color: m.author === "customer" ? "var(--text)" : "#fff" }}>
              <span className="block text-xs opacity-80">{m.author === "customer" ? tr(lang, "You", "আপনি") : `Café Reza — ${m.authorName}`}{m.orderNo ? ` • Order ${m.orderNo}` : ""}</span>
              {m.body}
              <span className="block text-xs opacity-70">{new Date(m.createdAt).toLocaleString("en-GB")}</span>
            </span>
          </div>
        ))}
      </div>
      <form className="mt-3 space-y-2" onSubmit={send}>
        {!token && (
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Your name for private chat" required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input aria-label="Your phone for private chat" required placeholder="Your phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        )}
        <label className="block text-sm">{tr(lang, "Message", "মেসেজ")}<textarea aria-label="Message to the cafe" required rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr(lang, "Write your message to Café Reza…", "ক্যাফে রেজাকে আপনার মেসেজ লিখুন…")} /></label>
        {err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
        <div className="flex gap-2"><button className="btn-gold flex-1" type="submit">{tr(lang, "Send message", "মেসেজ পাঠান")}</button><button className="btn-ghost" type="button" onClick={() => void load()}>{tr(lang, "Refresh", "রিফ্রেশ")}</button></div>
      </form>
    </div>
  );
}
const L: Record<string, { bn: string; en: string }> = {
  menu: { bn: "মেনু", en: "Menu" }, cart: { bn: "কার্ট", en: "Cart" }, track: { bn: "অর্ডার ট্র্যাক", en: "Track order" },
  reserve: { bn: "টেবিল বুকিং", en: "Reserve a table" }, account: { bn: "অ্যাকাউন্ট", en: "Account" },
  admin: { bn: "অ্যাডমিন", en: "Admin" }, add: { bn: "যোগ করুন", en: "Add" }, search: { bn: "খুঁজুন…", en: "Search…" },
  all: { bn: "সব", en: "All" }, best: { bn: "বেস্ট সেলার", en: "Best sellers" }, featured: { bn: "ফিচার্ড", en: "Featured" },
  offers: { bn: "অফার", en: "Offers" }, about: { bn: "আমাদের সম্পর্কে", en: "About & policies" }, new: { bn: "নতুন", en: "New" },
  checkout: { bn: "অর্ডার করুন", en: "Checkout" }, total: { bn: "মোট", en: "Total" },
};
function Logo({ size = 44 }: { size?: number }) {
  return <span className="logo-tile" style={{ width: size, height: size }}><img src={logoImg} alt="Café Reza official logo" /></span>;
}
// Google "G" brand mark (four-colour), drawn as inline SVG so the Gmail
// button needs no remote icon. The button itself stays honest: in Demo
// Mode there is no Firebase Auth, so it explains that instead of faking a
// Google sign-in.
function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}
function Price({ p, lang = "en" }: { p: Product; lang?: Lang }) {
  if (!p.available || p.price <= 0) return <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{tr(lang, "Price to be set", "দাম নির্ধারণ হয়নি")}</span>;
  const price = p.discountPrice ?? p.price;
  return <span className="font-bold text-base">{tk(price)}{p.discountPrice != null && <s className="ml-2 text-sm font-normal" style={{ color: "var(--dim)" }}>{tk(p.price)}</s>}</span>;
}
function ProdImg({ p, h = 190 }: { p: Product; h?: number }) {
  const src = p.imageKey ? IMAGES[p.imageKey] : undefined;
  if (!src) return <div className="flex items-center justify-center" style={{ height: h, background: "var(--surface2)" }}><span className="serif text-3xl" style={{ color: "var(--accent)" }}>R</span></div>;
  return <img src={src} alt={p.nameEn} loading="lazy" style={{ height: h, width: "100%", objectFit: "cover", display: "block" }} />;
}

// Two frames per product: 1) the product photo/poster, 2) this
// product's own ingredient poster (see IngredientPoster) — rendered
// from its own ingredient list, never another product's photo and
// never the same photo with labels pasted over it.
function ingredientList(p: Product): string[] {
  return (p.ingredients ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function productFrames(p: Product): Array<{ key: string | null; detail: boolean }> {
  return [
    { key: p.imageKey, detail: false },
    { key: null, detail: true },
  ];
}
function FrameImg({ frameKey, alt, h }: { frameKey: string | null; alt: string; h: number }) {
  const src = frameKey ? IMAGES[frameKey] : undefined;
  if (!src) return <div className="flex items-center justify-center" style={{ height: h, background: "var(--surface2)" }}><span className="serif text-3xl" style={{ color: "var(--accent)" }}>R</span></div>;
  return <img src={src} alt={alt} loading="lazy" style={{ height: h, width: "100%", objectFit: "cover", display: "block" }} />;
}
// Per-product ingredient poster in the Energy Booster poster style:
// the product's name, a vessel drawing for its kind (mug, glass, bowl
// or plate) and a labelled pill for every ingredient in its own list.
// It is a graphic poster rendered from live data — not a photograph,
// and no photo is shared between products. Because the name, the
// ingredient labels, the vessel and the tint all come from this
// product's own rows, every product's poster is different (including
// same-recipe variants, whose names differ), and editing the
// ingredients in Admin → Products redraws the poster at once. Labels
// are real SVG text, never baked into a picture, so they stay sharp
// and correct in both languages' layouts.
const POSTER_DOTS = ["#8b4a2f", "#c6a15b", "#7fb069", "#e07856", "#4a7fa5", "#8a5a9e", "#b8863b", "#5a8a6a"];
function posterTint(p: Product): string {
  const hay = `${p.nameEn} ${p.ingredients ?? ""}`.toLowerCase();
  if (hay.includes("blue")) return "#3f7fb8";
  if (hay.includes("strawberry") || hay.includes("dragon")) return "#d96a7f";
  if (hay.includes("mango") || hay.includes("orange") || hay.includes("caramel")) return "#e08a2e";
  if (hay.includes("grape")) return "#7a4a8a";
  if (hay.includes("green mango") || hay.includes("mint") || hay.includes("litchi")) return "#7fae4c";
  if (hay.includes("chocolate") || hay.includes("coffee") || hay.includes("horlicks")) return "#7a4a2f";
  if (hay.includes("tea")) return "#b4762e";
  if (hay.includes("chicken") || hay.includes("momo")) return "#c98a4a";
  if (hay.includes("curd") || hay.includes("yoghurt") || hay.includes("malai")) return "#e3d3a8";
  return "#c6a15b";
}
function vesselKind(p: Product): "mug" | "glass" | "bowl" | "plate" {
  const cat = (p.category ?? "").toLowerCase();
  if (cat.includes("dessert")) return "bowl";
  if (cat.includes("fast food")) return "plate";
  if (cat.includes("hot coffee") || cat.includes("tea")) return "mug";
  return "glass";
}
function Vessel({ kind, tint }: { kind: "mug" | "glass" | "bowl" | "plate"; tint: string }) {
  const outline = "#24150f";
  if (kind === "mug") return (
    <g fill="none" stroke={outline} strokeWidth="2.5">
      <path d="M176 96 q5 -9 0 -17 M200 96 q5 -9 0 -17 M224 96 q5 -9 0 -17" stroke="#8b4a2f" strokeLinecap="round" />
      <rect x="152" y="100" width="92" height="76" rx="12" fill="#fffdf6" />
      <rect x="161" y="112" width="74" height="55" rx="8" fill={tint} stroke="none" opacity="0.85" />
      <path d="M244 114 q28 6 0 46" />
      <line x1="146" y1="184" x2="256" y2="184" stroke="#c6a15b" />
    </g>
  );
  if (kind === "bowl") return (
    <g fill="none" stroke={outline} strokeWidth="2.5">
      <path d="M138 108 a62 42 0 0 0 124 0 Z" fill="#fffdf6" />
      <ellipse cx="200" cy="108" rx="62" ry="13" fill={tint} />
      <circle cx="182" cy="106" r="4" fill="#d96a7f" stroke="none" />
      <circle cx="205" cy="110" r="4" fill="#7fae4c" stroke="none" />
      <circle cx="222" cy="105" r="4" fill="#e08a2e" stroke="none" />
      <line x1="138" y1="162" x2="262" y2="162" stroke="#c6a15b" />
    </g>
  );
  if (kind === "plate") return (
    <g fill="none" stroke={outline} strokeWidth="2.5">
      <ellipse cx="200" cy="148" rx="88" ry="26" fill="#fffdf6" />
      <path d="M162 140 a17 13 0 0 1 34 0 Z" fill="#f5ebdd" />
      <path d="M183 138 a17 13 0 0 1 34 0 Z" fill="#f5ebdd" />
      <path d="M204 140 a17 13 0 0 1 34 0 Z" fill="#f5ebdd" />
      <path d="M179 140 v-8 M200 138 v-9 M221 140 v-8" strokeWidth="1.5" />
      <ellipse cx="200" cy="156" rx="20" ry="6" fill="#e07856" stroke="none" opacity="0.9" />
    </g>
  );
  return (
    <g fill="none" stroke={outline} strokeWidth="2.5">
      <rect x="226" y="66" width="8" height="52" rx="4" fill="#e07856" stroke="none" transform="rotate(16 230 92)" />
      <path d="M158 92 L242 92 L232 180 L168 180 Z" fill="#fffdf6" />
      <path d="M164 126 L236 126 L230 172 L170 172 Z" fill={tint} stroke="none" opacity="0.85" />
      <rect x="176" y="138" width="14" height="14" fill="#ffffff" strokeWidth="1.5" transform="rotate(18 183 145)" />
      <rect x="206" y="146" width="12" height="12" fill="#ffffff" strokeWidth="1.5" transform="rotate(-12 212 152)" />
    </g>
  );
}
function wrapPosterName(name: string): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of name.split(" ")) {
    if (cur && `${cur} ${w}`.length > 26) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}
function IngredientPoster({ p, h }: { p: Product; h: number }) {
  const ings = ingredientList(p);
  const tint = posterTint(p);
  const kind = vesselKind(p);
  const lines = wrapPosterName(p.nameEn);
  const label = ings.length > 0 ? `${p.nameEn} — ingredients: ${ings.join(", ")}` : `${p.nameEn} — ingredients not listed yet`;
  const nameY = lines.length > 1 ? [52, 75] : [64];
  return (
    <div style={{ height: h, background: "#f5ebdd", overflow: "hidden" }} role="img" aria-label={label}>
      <svg viewBox="0 0 400 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <title>{label}</title>
        <rect x="0" y="0" width="400" height="300" fill="#f5ebdd" />
        <rect x="7" y="7" width="386" height="286" fill="none" stroke="#c6a15b" strokeWidth="1.5" />
        <text x="200" y="30" textAnchor="middle" fontSize="10" letterSpacing="2.5" fill="#8b4a2f" fontFamily="system-ui, sans-serif" fontWeight="700">CAFÉ REZA • INGREDIENTS • উপাদান</text>
        {lines.map((ln, i) => (
          <text key={ln} x="200" y={nameY[i] ?? 64} textAnchor="middle" fontSize="21" fontWeight="700" fill="#24150f" fontFamily="Georgia, 'Palatino Linotype', serif">{ln}</text>
        ))}
        <Vessel kind={kind} tint={tint} />
        {ings.length === 0
          ? <text x="200" y="216" textAnchor="middle" fontSize="12" fill="#7a5c46" fontFamily="system-ui, sans-serif">Ingredients not listed yet — ask the cafe.</text>
          : ings.slice(0, 8).map((ing, i) => {
              const col = i % 2;
              const row = Math.floor(i / 2);
              const x = 14 + col * 193;
              const y = 192 + row * 26;
              return (
                <g key={ing}>
                  <rect x={x} y={y} width="179" height="21" rx="10.5" fill="#fffdf6" stroke="#dcc9ae" />
                  <circle cx={x + 12} cy={y + 10.5} r="4.5" fill={POSTER_DOTS[i % POSTER_DOTS.length]} />
                  <text x={x + 23} y={y + 14.5} fontSize="11.5" fill="#24150f" fontFamily="system-ui, sans-serif">{ing}</text>
                </g>
              );
            })}
      </svg>
    </div>
  );
}
function FrameView({ frame, p, h }: { frame: { key: string | null; detail: boolean }; p: Product; h: number }) {
  if (frame.detail) return <IngredientPoster p={p} h={h} />;
  return <FrameImg frameKey={frame.key} alt={p.nameEn} h={h} />;
}
// Manual-only slideshow (owner instruction, 3 Nov 2026): product
// photos never advance on their own. The frame changes only when the
// customer taps an arrow, a dot or a thumbnail, or swipes. No timer,
// no play/pause control, no hover behaviour.
function useSlideshow(count: number) {
  const [active, setActive] = useState(0);
  const go = useCallback((i: number) => {
    if (count <= 0) return;
    setActive(((i % count) + count) % count);
  }, [count]);
  const touchX = useRef<number | null>(null);
  const swipeProps = {
    onTouchStart: (e: ReactTouchEvent<HTMLDivElement>) => { touchX.current = e.touches[0]?.clientX ?? null; },
    onTouchEnd: (e: ReactTouchEvent<HTMLDivElement>) => {
      const start = touchX.current; touchX.current = null;
      const end = e.changedTouches[0]?.clientX;
      if (start == null || end == null) return;
      const dx = end - start;
      if (Math.abs(dx) > 40) go(active + (dx < 0 ? 1 : -1));
    },
  };
  return { active, go, swipeProps };
}
function SlideArrows({ onPrev, onNext, label }: { onPrev: () => void; onNext: () => void; label: string }) {
  const btn = "absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-base font-bold";
  const style = { background: "rgba(0,0,0,.55)", color: "#fff" } as const;
  return (<>
    <button type="button" className={btn} style={{ ...style, left: 6 }} aria-label={`Previous photo — ${label}`} onClick={onPrev}>‹</button>
    <button type="button" className={btn} style={{ ...style, right: 6 }} aria-label={`Next photo — ${label}`} onClick={onNext}>›</button>
  </>);
}
function SlideDots({ count, active, onGo, label }: { count: number; active: number; onGo: (i: number) => void; label: string }) {
  return (
    <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" aria-label={`Photo ${i + 1} of ${count} — ${label}`} aria-current={active === i} onClick={() => onGo(i)} className="h-2.5 rounded-full" style={{ width: active === i ? 20 : 10, background: active === i ? "#fff" : "rgba(255,255,255,.6)" }} />
      ))}
    </div>
  );
}
// Menu card: photo first, this product's own ingredient poster
// second — manual only, with arrows/dots/swipe. The frame itself
// opens the detail view; arrows and dots are siblings, never nested
// buttons.
function CardGallery({ p, lang, onOpen }: { p: Product; lang: Lang; onOpen: () => void }) {
  const frames = productFrames(p);
  const { active, go, swipeProps } = useSlideshow(frames.length);
  const frame = frames[active] ?? { key: null, detail: false };
  return (
    <div className="relative" {...swipeProps}>
      <button type="button" className="block w-full" onClick={onOpen} aria-label={`View ${p.nameEn}`}>
        <FrameView frame={frame} p={p} h={190} />
      </button>
      <span className="pointer-events-none absolute top-2 left-2 rounded px-1.5 py-px text-[11px] font-semibold" style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>{active + 1}/{frames.length}</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded px-1.5 py-px text-[11px] font-semibold" style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>{frame.detail ? tr(lang, "Ingredients", "উপাদান") : tr(lang, "Photo", "ছবি")}</span>
      <SlideArrows onPrev={() => go(active - 1)} onNext={() => go(active + 1)} label={p.nameEn} />
      <SlideDots count={frames.length} active={active} onGo={(i) => go(i)} label={p.nameEn} />
    </div>
  );
}
// Detail modal gallery: manual arrows, dots, swipe and thumbnail
// selectors; the second frame is this product's own ingredient
// poster, with the ingredient list written out underneath.
function DetailGallery({ p, lang }: { p: Product; lang: Lang }) {
  const frames = productFrames(p);
  const { active, go, swipeProps } = useSlideshow(frames.length);
  const frame = frames[active] ?? { key: null, detail: false };
  const ings = ingredientList(p);
  return (
    <div>
      <div className="relative" {...swipeProps}>
        <FrameView frame={frame} p={p} h={300} />
        <span className="pointer-events-none absolute top-2 left-2 rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}>{active === 0 ? tr(lang, "Photo 1 of 2 — product", "ছবি ১/২ — পণ্য") : tr(lang, "Photo 2 of 2 — ingredients poster", "ছবি ২/২ — উপাদানের পোস্টার")}</span>
        <SlideArrows onPrev={() => go(active - 1)} onNext={() => go(active + 1)} label={p.nameEn} />
        <SlideDots count={frames.length} active={active} onGo={(i) => go(i)} label={p.nameEn} />
      </div>
      <div className="mt-2 flex gap-2" role="tablist" aria-label="Product photos">
        {frames.map((f, i) => (
          <button key={i} type="button" role="tab" aria-selected={active === i} aria-label={i === 0 ? `Photo 1 — ${p.nameEn}` : `Photo 2 — ${p.nameEn} ingredients poster`} onClick={() => go(i)} className="relative w-20 flex-none overflow-hidden rounded-lg" style={{ border: active === i ? "2px solid var(--accent)" : "2px solid var(--border)", opacity: active === i ? 1 : 0.75 }}>
            <FrameView frame={f} p={p} h={56} />
            <span className="absolute bottom-0 left-0 rounded-tr px-1 text-[10px] font-semibold" style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}>{i === 0 ? tr(lang, "Photo", "ছবি") : tr(lang, "Ingredients", "উপাদান")}</span>
          </button>
        ))}
      </div>
      {frame.detail && (
        <div className="mt-2">
          <b className="text-sm">{tr(lang, "What's in it", "এর ভেতরে কী কী আছে")}</b>
          {ings.length > 0
            ? <p className="mt-0.5 text-sm" style={{ color: "var(--dim)" }}>{ings.join(" • ")}</p>
            : <p className="mt-0.5 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Ingredients not listed yet — the owner can add them in Admin → Products.", "উপাদান এখনো লেখা হয়নি — মালিক Admin → Products থেকে যোগ করতে পারবেন।")}</p>}
        </div>
      )}
    </div>
  );
}
// Homepage gallery carousel: the owner's posters, manual only —
// arrows, dots and swipe; tapping a poster opens its product.
function GalleryCarousel({ items, lang, onOpen }: { items: Array<{ src: string; alt: string; label: string }>; lang: Lang; onOpen: (i: number) => void }) {
  const { active, go, swipeProps } = useSlideshow(items.length);
  const item = items[active] ?? items[0];
  if (!item) return null;
  return (
    <div className="relative" {...swipeProps}>
      <button type="button" className="block w-full" onClick={() => onOpen(active)} aria-label={`${item.alt} — ${tr(lang, "view product", "পণ্য দেখুন")}`}>
        <img src={item.src} alt={item.alt} loading="lazy" className="h-64 w-full rounded-2xl object-cover sm:h-72" style={{ border: "1px solid var(--border)" }} />
      </button>
      <span className="pointer-events-none absolute top-2 left-2 rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}>{item.label}</span>
      <SlideArrows onPrev={() => go(active - 1)} onNext={() => go(active + 1)} label={item.alt} />
      <SlideDots count={items.length} active={active} onGo={(i) => go(i)} label="gallery" />
    </div>
  );
}

// Owner-supplied promo videos. Muted loop autoplay with play/pause and
// sound controls; the video only starts loading once it scrolls near the
// viewport (except the hero, which is eager), and it never covers content.
// When an admin enables a real ad in a slot, the ad replaces the video
// or banner in that slot — see PromoSlot.
function PromoVideo({ src, poster, label, eager = false, cover = false, slim = false, lang = "en" }: { src: string; poster?: string; label: string; eager?: boolean; cover?: boolean; slim?: boolean; lang?: Lang }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(eager);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useEffect(() => {
    if (started) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setStarted(true); return; }
    const ob = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) { setStarted(true); ob.disconnect(); } }, { rootMargin: "200px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [started]);
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    v.muted = muted;
    if (!reduceMotion) void v.play().catch(() => undefined);
  }, [started, muted, reduceMotion]);
  const togglePlay = () => { const v = vidRef.current; if (!v) return; if (v.paused) void v.play(); else v.pause(); };
  const toggleSound = () => {
    const v = vidRef.current;
    setMuted((m) => {
      const next = !m;
      if (v) { v.muted = next; if (!next) void v.play(); }
      return next;
    });
  };
  return (
    <div ref={wrapRef} className={cover ? "relative h-56 w-full overflow-hidden md:h-full" : slim ? "relative mt-3 overflow-hidden rounded-xl" : "relative mt-4 overflow-hidden rounded-2xl"} style={cover ? undefined : { border: "1px solid var(--border)" }}>
      {started ? (
        <video ref={vidRef} src={src} poster={poster} loop playsInline preload="metadata" aria-label={label} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className={cover ? "h-full w-full object-cover" : slim ? "h-[72px] w-full object-cover sm:h-[96px] md:h-[112px]" : "block w-full"} style={cover || slim ? undefined : { aspectRatio: "16 / 9", objectFit: "cover" }} />
      ) : poster ? (
        <img src={poster} alt={label} className={cover ? "h-full w-full object-cover" : slim ? "h-[72px] w-full object-cover sm:h-[96px] md:h-[112px]" : "block w-full"} />
      ) : (
        <div className={slim ? "h-[72px] w-full sm:h-[96px] md:h-[112px]" : "w-full"} style={slim ? { background: "var(--surface2)" } : { aspectRatio: "16 / 9", background: "var(--surface2)" }} />
      )}
      <div className="absolute right-2 bottom-2 flex gap-2">
        <button type="button" className="chip" aria-label={playing ? `${tr(lang, "Pause", "থামান")} ${label}` : `${tr(lang, "Play", "চালান")} ${label}`} onClick={togglePlay}>{playing ? tr(lang, "Pause", "থামান") : tr(lang, "Play", "চালান")}</button>
        <button type="button" className="chip" aria-label={muted ? `${tr(lang, "Unmute", "শব্দ চালু করুন")} ${label}` : `${tr(lang, "Mute", "শব্দ বন্ধ করুন")} ${label}`} onClick={toggleSound}>{muted ? tr(lang, "Sound off", "শব্দ বন্ধ") : tr(lang, "Sound on", "শব্দ চালু")}</button>
      </div>
    </div>
  );
}

const BANNER_SLIDES: Array<{ slug: string; img: string; alt: string }> = [
  { slug: "green-mango-juice", img: bannerGreenmango, alt: "Green Mango Juice — Café Reza poster" },
  { slug: "blue-lagoon-crusher", img: bannerCrusher, alt: "Blue Lagoon Crusher — Café Reza poster" },
  { slug: "coconut-smoothie", img: bannerCoconut, alt: "Coconut Smoothie — Café Reza poster" },
  { slug: "special-faluda", img: bannerFaluda, alt: "Special Faluda — Café Reza poster" },
  { slug: "blue-lagoon-mocktail", img: bannerBlue, alt: "Blue Lagoon Mocktail — Café Reza poster" },
  { slug: "pineapple-juice", img: bannerPineapple, alt: "Pineapple Juice — Café Reza poster" },
];

// Banner carousel of the owner's own posters. The banner AUTO-ROTATES
// (owner instruction, 3 Nov 2026: keep the top banner's automation on,
// while product photos stay manual-only — see useSlideshow, which has
// no timer). It advances every 3 seconds, pauses while the pointer is
// over it or keyboard focus is inside it, never advances under
// prefers-reduced-motion, and skips a tick while the tab is hidden.
// Each change animates slowly: the outgoing poster fades and drifts
// away while the incoming one glides in over about 1.1 seconds, so the
// banner is never an instant swap. Arrows/dots still work at any time
// and restart the 3-second timer.
// Each banner opens its product — no duplicate products are created
// for the banners. The admin chooses which banners show (Admin →
// Content); a custom banner URL shows as a plain image with no product.
// Touch / drag: a finger (or mouse) drag follows the poster and, past
// a threshold, swipes to the next/previous banner — the same carousel
// the arrows and dots control. A short drag snaps back, a tap still
// opens the product, and a swipe never opens it. Auto-rotation stays
// on (3s) and restarts after a swipe; it pauses while dragging.
function BannerCarousel({ products, onSelect, label, selection, lang = "en" }: { products: Product[]; onSelect: (p: Product) => void; label: string; selection?: string[]; lang?: Lang }) {
  const slides = (selection && selection.length > 0
    ? selection.map((s) => {
        const known = BANNER_SLIDES.find((b) => b.slug === s);
        if (known) return { ...known, product: products.find((p) => p.slug === known.slug) };
        return { slug: s, img: s, alt: "Café Reza banner", product: undefined as Product | undefined };
      })
    : BANNER_SLIDES.map((s) => ({ ...s, product: products.find((p) => p.slug === s.slug) }))).filter((s) => s.product !== undefined || /^https?:\/\//i.test(s.img) || s.img.startsWith("data:image/"));
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const count = slides.length;
  // Drag state: dragX follows the finger in pixels; dragging disables
  // the 1.1s glide transition so the poster tracks the touch exactly.
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; engaged: boolean } | null>(null);
  const dragDxRef = useRef(0);
  const suppressClickRef = useRef(false);
  useEffect(() => { if (count > 0 && idx >= count) setIdx(0); }, [count, idx]);
  useEffect(() => {
    if (count <= 1 || paused || reduceMotion) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (dragRef.current) return;
      setIdx((i) => (i + 1) % count);
    }, 3000);
    return () => window.clearInterval(id);
  }, [count, idx, paused, reduceMotion]);
  const finishDrag = (dx: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    dragDxRef.current = 0;
    setDragging(false);
    setDragX(0);
    setPaused(false);
    if (!d || !d.engaged) return;
    const threshold = Math.max(40, d.width * 0.18);
    if (Math.abs(dx) > threshold) {
      // Swallow the click that follows this pointer-up so a swipe
      // never opens the product it started on.
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 350);
      setIdx((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
    }
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    finishDrag(e.clientX - (dragRef.current?.startX ?? e.clientX));
  };
  // Touch pointers are implicitly captured to their start target, but
  // a mouse released outside the strip is not: finish on a window-level
  // pointer-up too, so a drag can never leave the banner stuck mid-slide.
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => finishDrag(dragDxRef.current);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => { window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
    // finishDrag reads only refs + setState, so no deps beyond dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  const stripWidth = stripRef.current?.clientWidth ?? 320;
  const slideStyle = (i: number): CSSProperties => {
    if (dragging) {
      const nextIdx = (idx + 1) % count;
      const prevIdx = (idx - 1 + count) % count;
      if (i === idx) return { opacity: 1, transform: `translateX(${dragX}px) scale(1)`, zIndex: 2, pointerEvents: "auto", transition: "none" };
      if (i === nextIdx && dragX < 0) return { opacity: 1, transform: `translateX(${stripWidth + dragX}px) scale(1)`, zIndex: 1, pointerEvents: "none", transition: "none" };
      if (i === prevIdx && dragX > 0) return { opacity: 1, transform: `translateX(${-stripWidth + dragX}px) scale(1)`, zIndex: 1, pointerEvents: "none", transition: "none" };
      return { opacity: 0, transform: "translateX(0) scale(1)", zIndex: 1, pointerEvents: "none", transition: "none" };
    }
    const isActive = i === idx;
    return { opacity: isActive ? 1 : 0, transform: isActive ? "translateX(0) scale(1)" : "translateX(28px) scale(1.06)", zIndex: isActive ? 2 : 1, pointerEvents: isActive ? "auto" : "none" };
  };
  const cur = slides[idx] ?? slides[0];
  if (!cur) return null;
  // Slim strip: a short, wide crop of the same poster image (object-cover,
  // centre crop), slimmer still on phones. Name + price stay readable as
  // a legible overlay bar on the image itself, so the strip needs no tall
  // caption block underneath. Arrows sit on the strip; dots sit just below.
  // All posters stay stacked in the strip and cross-fade / glide over
  // ~1.1s (see .banner-slide in theme.css) instead of swapping instantly,
  // so the 3-second rotation reads as one slow animation.
  return (
    <section
      className="mx-auto mt-3 w-full"
      aria-roledescription="carousel"
      aria-label={label}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => { if (!dragRef.current) setPaused(false); }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false); }}
    >
      <div
        ref={stripRef}
        className="relative h-[76px] select-none overflow-hidden rounded-xl sm:h-[104px] md:h-[128px]"
        style={{ border: "1px solid var(--border)", touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab" }}
        onClickCapture={(e) => { if (suppressClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressClickRef.current = false; } }}
        onPointerDown={(e) => {
          if (count <= 1 || e.button > 0) return;
          if ((e.target as Element).closest("button[aria-label='Previous banner'], button[aria-label='Next banner']")) return;
          dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, width: e.currentTarget.clientWidth || 320, engaged: false };
          dragDxRef.current = 0;
          setPaused(true);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || e.pointerId !== d.pointerId) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (!d.engaged) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            // Vertical movement is a page scroll, not a swipe: release
            // the gesture so the page keeps scrolling normally.
            if (Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; setPaused(false); return; }
            d.engaged = true;
            setDragging(true);
          }
          const clamped = Math.max(-d.width, Math.min(d.width, dx));
          dragDxRef.current = clamped;
          setDragX(clamped);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {slides.map((s, i) => {
          const isActive = i === idx;
          const p = s.product;
          const caption = p ? (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-2 py-1 text-sm text-white" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}><b className="truncate">{lang === "bn" ? p.nameBn : p.nameEn}</b><span className="flex-none"><Price p={p} lang={lang} /></span></span>
          ) : null;
          const inner = (
            <>
              <img src={s.img} alt={s.alt} draggable={false} onDragStart={(e) => e.preventDefault()} loading={i === 0 ? "eager" : "lazy"} className="h-full w-full object-cover object-center" />
              {caption}
            </>
          );
          return (
            <div
              key={s.slug}
              className="banner-slide absolute inset-0"
              aria-hidden={!isActive}
              style={slideStyle(i)}
            >
              {p ? (
                <button type="button" tabIndex={isActive ? 0 : -1} className="relative block h-full w-full text-left" onClick={() => onSelect(p)} aria-label={`View ${p.nameEn}`}>
                  {inner}
                </button>
              ) : (
                <div className="relative h-full w-full">{inner}</div>
              )}
            </div>
          );
        })}
        <button type="button" className="chip absolute top-1/2 left-2 z-10 -translate-y-1/2" style={{ padding: "4px 8px" }} aria-label="Previous banner" onClick={(e) => { setIdx((i) => (i - 1 + count) % count); e.currentTarget.blur(); }}>‹</button>
        <button type="button" className="chip absolute top-1/2 right-2 z-10 -translate-y-1/2" style={{ padding: "4px 8px" }} aria-label="Next banner" onClick={(e) => { setIdx((i) => (i + 1) % count); e.currentTarget.blur(); }}>›</button>
      </div>
      <div className="mt-1 flex items-center justify-center gap-1.5">
        {slides.map((s, i) => (
          <button key={s.slug} type="button" aria-label={`Show banner ${i + 1}: ${s.product?.nameEn ?? s.slug}`} aria-current={i === idx} onClick={(e) => { setIdx(i); e.currentTarget.blur(); }} className="rounded-full" style={{ width: 8, height: 8, background: i === idx ? "var(--accent)" : "var(--border)" }} />
        ))}
      </div>
    </section>
  );
}
function promoVideoSrc(choice: string | undefined): string | null {
  if (!choice || choice === "main") return promoMain;
  if (choice === "a") return promoA;
  if (choice === "b") return promoB;
  if (choice === "none") return null;
  return /^https?:\/\//i.test(choice.trim()) ? choice.trim() : promoMain;
}

function slotHasContent(slot: AdSlot) {
  if (slot.kind === "code") return slot.code.trim() !== "";
  const src = slot.imageUrl.trim();
  return src !== "" && (/^https?:\/\//i.test(src) || src.startsWith("data:image/"));
}

// A slot shows the owner's promo (video/banner) until the owner enables a
// real ad in Admin → Settings for that slot; the ad then replaces the promo.
function PromoSlot({ slotId, adsJson, fallback }: { slotId: AdSlotId; adsJson?: string | null; fallback?: ReactNode }) {
  const slot = parseAds(adsJson).find((s) => s.id === slotId);
  if (slot?.enabled && slotHasContent(slot)) return <AdSlotView slotId={slotId} adsJson={adsJson} />;
  return <>{fallback ?? null}</>;
}

// ---- App install (PWA): the app IS the website -------------------------
// The customer app and the admin app are the same site installed from the
// browser — same login, same data, no feature is app-only and none is
// website-only. Two separate manifests keep the two separate entries:
// the customer app opens #/ (shop + My Account) and the admin app opens
// #/admin (staff login). Install works on the hosted domain, in a real
// browser; inside this preview the browser install prompt is not offered,
// so the card shows the manual Add-to-Home-Screen steps instead. The app
// needs the internet — there is no offline mode and no native APK/Play
// Store build; nothing here claims one.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const ADMIN_MANIFEST_JSON = JSON.stringify({
  name: "Café Reza Admin",
  short_name: "Reza Admin",
  description: "Café Reza staff panel — orders, POS, stock and settings. Staff sign-in only.",
  id: "./#/admin",
  start_url: "./#/admin",
  scope: "./",
  display: "standalone",
  dir: "ltr",
  lang: "bn",
  background_color: "#160f0c",
  theme_color: "#160f0c",
  icons: [
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
}, null, 2);

// Deployment checklist the admin can download from Admin -> Security.
// Names only: no key, secret or value is ever written into this file.
const DEPLOY_CHECKLIST = `Cafe Reza — deployment checklist (admin first, then customers)
Video (owner): https://youtu.be/EgJ3HZvCbMI?si=Qh-U9e_aVYIk8wsz
GitHub repo package: cafe-reza-github.zip (cafe-reza/ folder inside).
The zip holds the full source: client/, server/, drizzle/, vercel.json,
firebase.json, firestore.rules, storage.rules, .env.example (names only),
ENV-VARS.md, DEPLOY.md, README.md. It never holds .env, app.db or
node_modules. Full steps: DEPLOY.md. Env-var names: ENV-VARS.md.

ORDER — ADMIN FIRST (owner instruction, 3 Nov 2026)
1. Admin panel first: open the #/admin entry, sign in as staff (create
   the owner account here when none exists). Check dashboard, POS and
   settings, then share the ADMIN link first.
2. Customer site next: open the #/ entry (shop + My Account) with a
   customer sign-in. Share its link only after the admin link.
Both entries run on this same artifact deployment (own server actions
+ database), separate logins, no shared panel. No link is hardcoded.

GITHUB
1. Sign in to GitHub (rezamdyeasin-jpg). New repository, e.g. cafe-reza.
2. Upload the zip contents (the cafe-reza/ folder). Never upload
   .env, app.db/app.db-shm/app.db-wal, or node_modules/ — .gitignore
   blocks them. Check git status before committing.

VERCEL (preview only — build NOT verified, see warning below)
1. vercel.com -> Continue with GitHub -> Add New Project -> Import cafe-reza.
2. Settings: Framework Preset Other, Root Directory ./, Build Command
   "bun run build:client && cp -r client/app/. client/dist/",
   Output Directory client/dist, Install Command "bun install".
   The cp step copies both PWA manifests + icons into the deploy.
3. Deploy. Vercel gives a free subdomain (cafe-reza-....vercel.app).

ENV VARS — Vercel Settings -> Environment Variables (Production), then Redeploy
Required: FIREBASE_API_KEY, FIREBASE_PROJECT_ID (cafe-reza),
FIREBASE_APP_ID — from Firebase Console -> Project settings -> Your apps
-> "Cafe Reza Web". Optional: FIREBASE_AUTH_DOMAIN,
FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID,
FIREBASE_MEASUREMENT_ID, VITE_FIREBASE_APPCHECK_KEY (App Check only),
VITE_APP_URL (leave empty normally). OTP mail only: RESEND_API_KEY,
RESEND_FROM (server-only, never VITE_). Never put a value in code,
.env.example or GitHub. Rotate/restrict any previously exposed web API
key in the Firebase Console. Full table: ENV-VARS.md.

FIREBASE DOMAIN + RULES
1. Firebase Console -> Authentication -> Settings -> Authorized domains:
   add the Vercel subdomain, or Google sign-in fails
   (auth/unauthorized-domain).
2. Deploy rules: firebase deploy --only firestore:rules,storage
   (firebase-tools, firebase login). Do not put real data in Firestore
   until the strict rules are deployed and verified.

WARNING — READ BEFORE CALLING ANY VERCEL LINK LIVE
package.json ties @hatch/space-sdk to a Hatch-runtime file: path
(/opt/hatch/...) and the client build uses that SDK, so a direct Vercel
deploy of this repo has NOT been verified and may fail at install/build.
Orders, accounts, POS and admin run on this artifact's server actions +
SQLite database, which Vercel does not run. The live shop stays on this
artifact until the backend moves to Cloud Functions + Firestore and a
standalone (non-Hatch) client build is verified. Do not share a Vercel
link as the live shop.

APPS STAY SEPARATE ON HOSTING TOO
Customer app manifest opens #/ ; admin app manifest opens #/admin.
Install: customer app from My Account (#/account); admin app from the
admin sign-in page / Security tab (manifest file downloadable there).
App = website: same code, routes, actions and database; no offline mode.
`;

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InstallAppCard({ variant, lang }: { variant: "customer" | "admin"; lang: Lang }) {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    const handler = (e: Event) => { e.preventDefault(); setDeferred(e as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    const done = () => setInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", handler); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => {
    if (!deferred) { setShowHelp(true); return; }
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") { setInstalled(true); setDeferred(null); }
      else setShowHelp(true);
    } catch { setShowHelp(true); }
  };
  const isAdmin = variant === "admin";
  return (
    <div className="card p-4">
      <b>{isAdmin ? tr(lang, "Admin app — install it from here", "অ্যাডমিন অ্যাপ — এখান থেকেই ইনস্টল করুন") : tr(lang, "Café Reza app — install it from here", "ক্যাফে রেজা অ্যাপ — এখান থেকেই ইনস্টল করুন")}</b>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
        {isAdmin
          ? tr(lang, "The admin app IS the admin panel: the same staff sign-in, dashboard, orders, POS, stock and settings — nothing extra, nothing missing. It never shows customer controls, and it never opens without a staff sign-in. It needs the internet.", "অ্যাডমিন অ্যাপই অ্যাডমিন প্যানেল: একই স্টাফ সাইন-ইন, ড্যাশবোর্ড, অর্ডার, POS, স্টক ও সেটিংস — বাড়তিও নয়, কমও নয়। এতে কাস্টমার নিয়ন্ত্রণ কখনো দেখায় না, আর স্টাফ সাইন-ইন ছাড়া খোলে না। ইন্টারনেট লাগবে।")
          : tr(lang, "The app IS the website: the same sign-in, menu, cart, orders, tracking, reservations, messages and loyalty — nothing extra, nothing missing, and no separate app account. It needs the internet.", "অ্যাপই ওয়েবসাইট: একই সাইন-ইন, মেনু, কার্ট, অর্ডার, ট্র্যাকিং, রিজার্ভেশন, মেসেজ ও লয়্যালটি — বাড়তিও নয়, কমও নয়, আর আলাদা অ্যাপ অ্যাকাউন্ট লাগে না। ইন্টারনেট লাগবে।")}
      </p>
      {installed
        ? <p className="mt-3 text-sm" role="status"><b>{tr(lang, "This app is installed on this device.", "এই ডিভাইসে অ্যাপটি ইনস্টল করা আছে।")}</b></p>
        : <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-gold" onClick={() => void install()}>{isAdmin ? tr(lang, "Install admin app", "অ্যাডমিন অ্যাপ ইনস্টল করুন") : tr(lang, "Install app", "অ্যাপ ইনস্টল করুন")}</button>
            <button className="btn-ghost" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>{tr(lang, "How to install manually", "হাতে ইনস্টল করার নিয়ম")}</button>
            {isAdmin && <button className="btn-ghost" onClick={() => { downloadTextFile("cafe-reza-admin.webmanifest", ADMIN_MANIFEST_JSON, "application/manifest+json"); setMsg(tr(lang, "Admin app file downloaded. Keep it with the hosting files (see DEPLOY.md).", "অ্যাডমিন অ্যাপের ফাইল ডাউনলোড হয়েছে। হোস্টিংয়ের ফাইলগুলোর সাথে রাখুন (DEPLOY.md দেখুন)।")); }}>{tr(lang, "Download admin app file", "অ্যাডমিন অ্যাপের ফাইল ডাউনলোড করুন")}</button>}
          </div>}
      {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
      {showHelp && (
        <div className="mt-3 space-y-1 text-sm">
          <p><b>{tr(lang, "Android (Chrome):", "অ্যান্ড্রয়েড (Chrome):")}</b> {tr(lang, "⋮ menu → “Install app” or “Add to Home screen”.", "⋮ মেনু → “Install app” বা “Add to Home screen”-এ চাপুন।")}</p>
          <p><b>{tr(lang, "iPhone (Safari):", "আইফোন (Safari):")}</b> {tr(lang, "Share → “Add to Home Screen”.", "Share → “Add to Home Screen”-এ চাপুন।")}</p>
          <p style={{ color: "var(--dim)" }}>{tr(lang, "If no install button appears here, open the hosted site link in your phone's browser and install from there — the in-app preview does not offer the browser install prompt.", "এখানে ইনস্টল বোতাম না এলে হোস্ট করা সাইটের লিংকটি ফোনের ব্রাউজারে খুলে সেখান থেকে ইনস্টল করুন — অ্যাপের ভেতরের প্রিভিউতে ব্রাউজারের ইনস্টল প্রম্পট আসে না।")}</p>
        </div>
      )}
    </div>
  );
}

export function App() {
  const qc = useQueryClient();
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("store");
  const [adminTab, setAdminTab] = useState("dashboard");
  const [trackOrderNo, setTrackOrderNo] = useState<string | null>(null);
  const [chatCtx, setChatCtx] = useState<{ orderNo?: string; label?: string } | null>(null);
  const openChat = (ctx?: { orderNo?: string; label?: string }) => setChatCtx(ctx ?? {});
  const [tableLabel, setTableLabel] = useState("");
  // Separate panels live at separate routes: the shop at #/, the customer
  // panel at #/account and the admin panel at #/admin. The hash is only
  // in-app navigation state — it is never shared or copied anywhere.
  const viewFromHash = (): { v: View; tab?: string; table?: string } => {
    const h = typeof window !== "undefined" ? window.location.hash.replace(/^#\/?/, "") : "";
    const [head, tail] = h.split("/");
    if (head === "admin") return { v: "admin", tab: tail || "dashboard" };
    if (head === "account") return { v: "account" };
    if (head === "track") return { v: "track" };
    if (head === "cart") return { v: "cart" };
    if (head === "checkout") return { v: "checkout" };
    if (head === "reserve") return { v: "reserve" };
    if (head === "about") return { v: "info" };
    if (head === "table") return { v: "store", table: tail || "" };
    return { v: "store" };
  };
  useEffect(() => {
    const apply = () => { const r = viewFromHash(); setView(r.v); if (r.tab) setAdminTab(r.tab); if (r.table !== undefined) setTableLabel(r.table); };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const navigate = (v: View, tab?: string) => {
    setView(v);
    if (tab) setAdminTab(tab);
    try {
      const hash = v === "store" ? "#/" : v === "info" ? "#/about" : v === "admin" ? `#/admin/${tab ?? adminTab}` : `#/${v}`;
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch { /* hash unavailable — state navigation still works */ }
  };
  const goTrack = (orderNo: string) => { setTrackOrderNo(orderNo); navigate("track"); };
  const [cat, setCat] = useState(0);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "best" | "featured" | "new">("all");
  const [cart, setCart] = useState<CartItem[]>(() => { try { return JSON.parse(localStorage.getItem("cr_cart") ?? "[]") as CartItem[]; } catch { return []; } });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("cr_token"));
  const [detail, setDetail] = useState<Product | null>(null);
  const [notice, setNotice] = useState("");
  const [infoTab, setInfoTab] = useState("about");
  const seeded = useRef(false);
  const t = (k: keyof typeof L) => (lang === "bn" ? L[k]?.bn : L[k]?.en) ?? k;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // Separate app entries: on the hosted site the manifest follows the
  // panel in view (customer manifest opens #/, admin manifest opens
  // #/admin). The files live in client/app/ and are copied into the
  // deploy by the hosting build command (DEPLOY.md). In this preview
  // they are not served, so the link is set only when the file answers
  // as JSON — no broken manifest request is left behind.
  useEffect(() => {
    const file = view === "admin" ? "manifest-admin.webmanifest" : "manifest-customer.webmanifest";
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`./${file}`, { method: "HEAD" });
        if (cancelled || !res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
        let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        if (!link) { link = document.createElement("link"); link.rel = "manifest"; document.head.appendChild(link); }
        link.href = `./${file}`;
      } catch { /* manifest files are hosting-only; preview runs without one */ }
    })();
    return () => { cancelled = true; };
  }, [view]);
  useEffect(() => { localStorage.setItem("cr_cart", JSON.stringify(cart)); }, [cart]);
  const store = useQuery({ queryKey: ["store"], queryFn: () => api.getStorefront({}) });
  const me = useQuery({ queryKey: ["me", token], queryFn: () => api.me({ token: token ?? "" }), enabled: !!token });
  const adminData = useQuery({ queryKey: ["admin", token], queryFn: () => api.getAdminData({ token: token ?? "" }), enabled: !!token && view === "admin" });
  useEffect(() => {
    if (store.data && store.data.products.length === 0 && !seeded.current) { seeded.current = true; api.seedCatalog({}).then(() => qc.invalidateQueries({ queryKey: ["store"] })); }
  }, [store.data, qc]);
  const user = me.data?.user ?? null;
  const products = store.data?.products ?? [];
  const settings = store.data?.settings;
  const cartCount = cart.reduce((a, c) => a + c.qty, 0);
  const cartTotal = cart.reduce((a, c) => { const p = products.find((x) => x.id === c.productId); return a + (p ? (p.discountPrice ?? p.price) * c.qty : 0); }, 0);
  const nameOf = (p: Product) => (lang === "bn" && p.nameBn ? p.nameBn : p.nameEn);
  const addToCart = (p: Product, extra?: Partial<CartItem>) => {
    if (!p.available || p.price <= 0) { setNotice("This item has no price yet. The owner sets its price in Admin first."); return; }
    setCart((prev) => {
      const key = `${p.id}|${extra?.size ?? "Regular"}|${extra?.note ?? ""}`;
      const idx = prev.findIndex((c) => `${c.productId}|${c.size}|${c.note}` === key);
      if (idx >= 0) { const copy = [...prev]; const cur = copy[idx]; if (cur) copy[idx] = { ...cur, qty: cur.qty + (extra?.qty ?? 1) }; return copy; }
      return [...prev, { productId: p.id, qty: extra?.qty ?? 1, size: extra?.size ?? "Regular", sugar: extra?.sugar ?? "Normal", milk: extra?.milk ?? "Regular", note: extra?.note ?? "" }];
    });
    setNotice(`${nameOf(p)} added to cart.`);
  };
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["store"] }); qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["admin"] }); };
  const filtered = useMemo(() => products.filter((p) => {
    if (cat !== 0 && p.categoryId !== cat) return false;
    if (filter === "best" && !p.bestSeller) return false;
    if (filter === "featured" && !p.featured) return false;
    if (filter === "new" && !p.isNew) return false;
    if (q && !(p.nameEn + p.nameBn + p.description).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [products, cat, filter, q]);
  const signOut = async () => { if (token) await api.logout({ token }); localStorage.removeItem("cr_token"); setToken(null); navigate("store"); refreshAll(); };

  // ---- Separate panels --------------------------------------------------
  // The admin panel and the customer panel are fully separate shells:
  // different headers, navigation, menus and logins. The shop shell below
  // never renders admin controls, and the admin shell never renders the
  // shop or customer controls. Customers reaching #/admin see only the
  // staff login; staff reaching #/account see only their own profile.
  if (view === "admin") {
    return <AdminShell token={token} setToken={setToken} user={user} hasAdmin={store.data?.hasAdmin ?? false} adminData={adminData.data?.data} loading={adminData.isPending} refreshAll={refreshAll} setNotice={setNotice} store={store.data} signOut={signOut} navigate={navigate} adminTab={adminTab} setAdminTab={setAdminTab} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />;
  }
  if (view === "account") {
    return <AccountShell token={token} setToken={setToken} user={user} meData={me.data} hasAdmin={store.data?.hasAdmin ?? false} products={products} nameOf={nameOf} refreshAll={refreshAll} signOut={signOut} setNotice={setNotice} addToCart={addToCart} navigate={navigate} settings={settings} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} goTrack={goTrack} openChat={openChat} />;
  }

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="sticky top-0 z-40 no-print" style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 pt-safe">
          <button onClick={() => navigate("store")} className="flex items-center gap-2" aria-label="Cafe Reza home"><Logo size={44} /><span className="serif text-lg font-bold leading-none">Café Reza</span></button>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="chip" onClick={() => setLang(lang === "bn" ? "en" : "bn")} aria-label="Switch language">{lang === "bn" ? "EN" : "বাং"}</button>
            <button className="chip" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
            <button className="chip" onClick={() => navigate("cart")} aria-label={`Cart, ${cartCount} items`}>🛒 {cartCount}</button>
            {user && <button className="chip" onClick={() => { api.markNotificationsRead({ token: token ?? "" }); navigate("account"); }} aria-label="Notifications">🔔 {me.data?.notifications.filter((n) => !n.readFlag).length ?? 0}</button>}
          </div>
        </div>
        {settings?.demoMode && <div className="px-3 pb-2 text-center text-xs" style={{ color: "var(--accent)" }}>{tr(lang, "DEMO MODE — no real payment gateway is connected. Mobile payments stay “Pending verification” until the owner verifies them.", "ডেমো মোড — আসল পেমেন্ট গেটওয়ে সংযুক্ত হয়নি। মোবাইল পেমেন্ট মালিক যাচাই না করা পর্যন্ত “যাচাইয়ের অপেক্ষায়” থাকবে।")}</div>}
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {([["store", t("menu")], ["track", t("track")], ["reserve", t("reserve")], ["info", t("about")], ["account", t("account")]] as Array<[View, string]>).map(([v, label]) => (
            <button key={v} className={`chip ${view === v ? "chip-on" : ""}`} onClick={() => navigate(v)}>{label}</button>
          ))}
        </nav>
      </header>
      {settings && parseContent(settings.contentJson).announcement && <div className="px-3 py-2 text-center text-sm font-medium" style={{ background: "var(--surface)", color: "var(--accent)" }}>{parseContent(settings.contentJson).announcement}</div>}

      {notice && <div className="mx-auto mt-3 max-w-6xl px-3"><button className="card w-full px-4 py-2 text-left text-sm" onClick={() => setNotice("")}>{notice} ✕</button></div>}

      {view === "store" && (
        <main className="mx-auto max-w-6xl px-3">
          <section className="card mt-4 overflow-hidden">
            <div className="grid md:grid-cols-2">
              <div className="p-5 md:p-8">
                <div className="logo-tile mb-4" style={{ width: 96, height: 96 }}><img src={logoImg} alt="Café Reza official logo" /></div>
                <h1 className="text-3xl md:text-4xl font-bold leading-tight">{settings?.cafeName ?? "Café Reza"}</h1>
                <p className="mt-2" style={{ color: "var(--dim)" }}>{taglineText(settings?.tagline, lang)}</p>
                <p className="mt-3 text-sm">{lang === "bn" ? "মোবাইল থেকে অর্ডার করুন — ডেলিভারি, টেকঅ্যাওয়ে বা ডাইন-ইন। দাম মালিকের ছাপা মেনু অনুযায়ী।" : "Order from your phone — delivery, takeaway or dine-in. Prices follow the owner's printed menu."}</p>
                <div className="mt-4 flex gap-2">
                  <input aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
                  <button className="btn-gold" onClick={() => document.getElementById("menu-list")?.scrollIntoView({ behavior: "smooth" })}>{t("menu")}</button>
                </div>
                {(todayHoursText(settings, lang) || settings?.hours) && <p className="mt-3 text-sm">🕒 {todayHoursText(settings, lang) || settings?.hours}</p>}
                {settings?.phone && <p className="text-sm">📞 {settings.phone}</p>}
              </div>
              {(() => { const heroSrc = promoVideoSrc(settings?.promoVideo); return heroSrc ? <PromoVideo src={heroSrc} poster={heroImg} label="Café Reza promo video" eager cover lang={lang} /> : <img src={heroImg} alt="Coffee at Café Reza" className="h-56 w-full object-cover md:h-full" />; })()}
            </div>
          </section>
          <PromoSlot slotId="home-banner" adsJson={settings?.adsJson} fallback={<BannerCarousel products={products} onSelect={setDetail} label="Café Reza promos" selection={parseBannerSelection(settings?.bannersJson)} lang={lang} />} />

          <div className="mt-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
            <button className={`chip ${cat === 0 ? "chip-on" : ""}`} onClick={() => setCat(0)}>{t("all")}</button>
            {(store.data?.categories ?? []).filter((c) => c.active).map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? "chip-on" : ""}`} onClick={() => setCat(c.id)}>{lang === "bn" ? c.nameBn : c.nameEn}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {(["all", "best", "featured", "new"] as const).map((f) => <button key={f} className={`chip ${filter === f ? "chip-on" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? t("all") : f === "best" ? t("best") : f === "featured" ? t("featured") : t("new")}</button>)}
          </div>

          <div id="menu-list" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {store.isPending && [1, 2, 3, 4].map((i) => <div key={i} className="card animate-pulse" style={{ height: 260 }} />)}
            {filtered.map((p) => (
              <article key={p.id} className="card overflow-hidden">
                <CardGallery p={p} lang={lang} onOpen={() => setDetail(p)} />
                <button className="w-full text-left" onClick={() => setDetail(p)} aria-label={`View ${p.nameEn}`}>
                  <div className="p-3">
                    <h3 className="font-semibold leading-snug">{nameOf(p)}</h3>
                    <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--dim)" }}>{descText(p, lang)}</p>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                      {p.bestSeller && <span className="chip" style={{ padding: "2px 7px" }}>★ {tr(lang, "Best seller", "বেস্ট সেলার")}</span>}
                      {p.isNew && <span className="chip" style={{ padding: "2px 7px" }}>{t("new")}</span>}
                      <span className="chip" style={{ padding: "2px 7px" }}>{categoryName(p, store.data?.categories, lang)}</span>
                    </div>
                  </div>
                </button>
                <div className="flex items-center justify-between px-3 pb-3">
                  <Price p={p} lang={lang} />
                  <button className="btn-gold" style={{ padding: "8px 14px" }} disabled={!p.available || p.price <= 0} onClick={() => addToCart(p)}>{t("add")}</button>
                </div>
              </article>
            ))}
          </div>
          {filtered.length === 0 && !store.isPending && <p className="py-10 text-center" style={{ color: "var(--dim)" }}>{lang === "bn" ? "এই ক্যাটাগরিতে এখনো আইটেম নেই।" : "No items in this category yet."}</p>}
          <PromoSlot slotId="menu" adsJson={settings?.adsJson} fallback={<PromoVideo src={promoA} label="Café Reza promo video" slim lang={lang} />} />

          <PromoSlot slotId="offers" adsJson={settings?.adsJson} fallback={<PromoVideo src={promoB} label="Café Reza promo video" slim lang={lang} />} />
          {(!settings || parseContent(settings.contentJson).showGallery) && <section className="mt-8">
            <h2 className="serif text-2xl font-bold">{tr(lang, "Gallery — real Cafe Reza posters", "গ্যালারি — ক্যাফে রেজার আসল পোস্টার")}</h2>
            <div className="mt-3">
              <GalleryCarousel items={[
                { src: posterFaludaRed, alt: galleryText("Special Faluda", lang), label: galleryText("Special Faluda", lang) },
                { src: posterGrapes2, alt: galleryText("Grapes Juice", lang), label: galleryText("Grapes Juice", lang) },
                { src: posterBlue, alt: galleryText("Blue Lagoon", lang), label: galleryText("Blue Lagoon", lang) },
                { src: posterDragon, alt: galleryText("Dragon Fruit Juice", lang), label: galleryText("Dragon Fruit Juice", lang) },
                { src: tray2Img, alt: galleryText("Cafe Reza tray — Momo, Doi-chira and Lacchi", lang), label: galleryText("Momo · Doi-chira · Lacchi", lang) },
              ]} lang={lang} onOpen={(i) => { const names = ["Special Faluda", "Grapes Juice", "Blue Lagoon", "Dragon Fruit Juice", "Chicken Momo"]; const hit = products.find((x) => x.nameEn === names[i]); if (hit) setDetail(hit); }} />
            </div>
          </section>}
          <section className="mt-8 grid gap-3 md:grid-cols-2">
            <div className="card p-5">
              <h2 className="serif text-xl font-bold">{lang === "bn" ? "কাস্টমার রিভিউ" : "Customer reviews"}</h2>
              {(store.data?.reviews ?? []).length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? "এখনো কোনো রিভিউ নেই। প্রথম রিভিউটি আপনিই দিন।" : "No reviews yet — yours can be the first."}</p>}
              {(store.data?.reviews ?? []).map((r) => <div key={r.id} className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}><b>{r.author}</b> {"★".repeat(r.rating)}<p className="text-sm">{r.comment}</p></div>)}
            </div>
            <div className="card p-5">
              <h2 className="serif text-xl font-bold">{lang === "bn" ? "ছাপা মেনু" : "Printed menu"}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? "দাম যাচাইয়ের জন্য মালিকের ছাপা মেনুর ছবি।" : "The owner's printed menu photo, for price reference."}</p>
              <img src={menuPhoto} alt="Cafe Reza printed menu with prices" loading="lazy" className="mt-3 w-full rounded-xl object-cover" />
            </div>
          </section>
        </main>
      )}

      {detail && <DetailModal p={detail} name={nameOf(detail)} onClose={() => setDetail(null)} onAdd={(extra) => { addToCart(detail, extra); setDetail(null); }} wishlisted={me.data?.wishlist.includes(detail.id) ?? false} onWish={async () => { if (!token) { setNotice("Sign in to save favourites."); return; } await api.toggleWishlist({ token, productId: detail.id }); refreshAll(); }} store={store.data} token={token} lang={lang} onMessage={() => { setDetail(null); openChat({ label: detail.nameEn }); }} />}
      {view === "cart" && <CartView cart={cart} setCart={setCart} products={products} nameOf={nameOf} go={(v) => navigate(v)} lang={lang} />}
      {view === "checkout" && <CheckoutView cart={cart} setCart={setCart} products={products} settings={settings} token={token} user={user} go={(v) => navigate(v)} setNotice={setNotice} refreshAll={refreshAll} onTrackOrder={goTrack} prefillTable={tableLabel} onMessage={(orderNo) => openChat({ orderNo, label: orderNo ? `Order ${orderNo}` : undefined })} lang={lang} />}
      {view === "track" && <TrackView initialOrderNo={trackOrderNo} onClearInitial={() => setTrackOrderNo(null)} myOrders={me.data?.orders ?? []} settings={settings} onMessage={(orderNo) => openChat({ orderNo, label: orderNo ? `Order ${orderNo}` : undefined })} lang={lang} />}
      {view === "reserve" && <ReserveView setNotice={setNotice} userPhone={user?.phone} lang={lang} />}
      {view === "info" && <InfoView tab={infoTab} setTab={setInfoTab} settings={settings} lang={lang} onMessage={() => openChat({})} />}

      {view === "store" && <div className="mx-auto max-w-6xl px-3"><PromoSlot slotId="footer" adsJson={settings?.adsJson} fallback={<BannerCarousel products={products} onSelect={setDetail} label="Café Reza promos, above the footer" selection={parseBannerSelection(settings?.bannersJson)} lang={lang} />} /></div>}
      {tableLabel && view === "store" && <div className="mx-auto mt-3 max-w-6xl px-3"><p className="card p-3 text-sm">Ordering for <b>Table {tableLabel}</b> — dine-in checkout will use this table. <button className="underline" onClick={() => { setTableLabel(""); try { window.location.hash = "#/"; } catch { /* ignore */ } }}>Clear table</button></p></div>}
      {chatCtx && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg p-3" role="dialog" aria-modal="true" aria-label="Private chat with Café Reza">
          <div className="card max-h-[80vh] overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-2"><h2 className="serif text-lg font-bold">{tr(lang, "Message Café Reza", "ক্যাফে রেজাকে মেসেজ করুন")}</h2><button className="btn-ghost" onClick={() => setChatCtx(null)} aria-label="Close chat">✕</button></div>
            <ChatPanel token={token} userName={user?.name} userPhone={user?.phone} orderNo={chatCtx.orderNo} contextLabel={chatCtx.label} lang={lang} />
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "Prefer phone or Facebook? Call", "ফোন বা ফেসবুক পছন্দ? কল করুন")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a> or {tr(lang, "open the", "খুলুন")} <a className="underline" href={settings?.facebook || "https://www.facebook.com/cafereza4u"} target="_blank" rel="noreferrer">{tr(lang, "Facebook page", "ফেসবুক পেজ")}</a>.</p>
          </div>
        </div>
      )}
      <footer className="mx-auto mt-10 max-w-6xl px-3 pb-4">
        <div className="card flex flex-col items-start gap-4 p-5 md:flex-row md:items-center">
          <Logo size={64} />
          <div className="flex-1">
            <p className="serif text-lg font-bold">{settings?.cafeName ?? "Café Reza"}</p>
            <p className="text-sm" style={{ color: "var(--dim)" }}>{taglineText(settings?.tagline, lang)}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{addressText(settings?.address, lang)}{settings?.hours ? ` • ${settings.hours}` : ""}</p>
            <p className="mt-1 text-sm">{tr(lang, "Call:", "কল করুন:")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a>{settings?.facebook ? <> • <a className="underline" href={settings.facebook} target="_blank" rel="noreferrer">Facebook — Café Reza</a></> : null} • <a className="underline" href={CAFE_MAPS_URL} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a></p>
          </div>
          <button className="btn-ghost" onClick={() => { navigate("info"); setInfoTab("policies"); }}>{tr(lang, "Policies", "নীতিমালা")}</button>
          <button className="btn-ghost" onClick={() => navigate("admin")}>{tr(lang, "Staff sign-in", "স্টাফ সাইন-ইন")}</button>
        </div>
        <div className="mt-4">
          <CafeMap settings={settings} lang={lang} compact />
          <a className="btn-gold mt-2 inline-block" href={CAFE_MAPS_URL} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a>
        </div>
        <p className="mt-3 text-center text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "BDT (৳) • Asia/Dhaka • Demo Mode until a real payment gateway is connected by the owner.", "BDT (৳) • Asia/Dhaka • মালিক আসল পেমেন্ট গেটওয়ে সংযুক্ত না করা পর্যন্ত ডেমো মোড।")}{todayHoursText(settings, lang) ? ` • ${todayHoursText(settings, lang)}` : ""}</p>
      </footer>

      <nav className="fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t px-2 py-2 no-print md:hidden" style={{ background: "var(--surface)", borderColor: "var(--border)", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }} aria-label="Mobile">
        <button onClick={() => navigate("store")}>🏠 {t("menu")}</button>
        <button onClick={() => navigate("cart")}>🛒 {t("cart")} ({cartCount})</button>
        <button onClick={() => navigate("track")}>📦 {t("track")}</button>
        <button onClick={() => navigate("account")}>👤 {t("account")}</button>
      </nav>
      {cart.length > 0 && view === "store" && (
        <button className="btn-gold fixed bottom-20 right-4 z-40 shadow-lg no-print md:bottom-6" onClick={() => navigate("cart")}>{tr(lang, "View cart", "কার্ট দেখুন")} • {tk(cartTotal)} ({cartCount})</button>
      )}
    </div>
  );
}

type ShellNav = (v: View, tab?: string) => void;

// Separate staff login for the admin panel: its own route (#/admin),
// its own server action (loginStaff, which rejects customer accounts),
// and its own dark layout — deliberately unlike the customer login's
// fruit-splash glass card. No Google button here: staff sign in with
// the work email + password the owner created for them.
function AdminLogin({ hasAdmin, setToken, refreshAll, setNotice, navigate, lang }: { hasAdmin: boolean; setToken: (t: string | null) => void; refreshAll: () => void; setNotice: (s: string) => void; navigate: ShellNav; lang: Lang }) {
  const [mode, setMode] = useState<"login" | "owner">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      if (mode === "login") { const r = await api.loginStaff({ email, password }); if (r.ok && r.token) { localStorage.setItem("cr_token", r.token); setToken(r.token); refreshAll(); } else setErr(r.error ?? tr(lang, "Login failed.", "লগইন ব্যর্থ হয়েছে।")); }
      else { if (password.length < 8) { setErr(tr(lang, "The owner password must be at least 8 characters.", "মালিকের পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।")); return; } const r = await api.createOwner({ name, email, phone, password }); if (r.ok && r.token) { localStorage.setItem("cr_token", r.token); setToken(r.token); refreshAll(); } else setErr(r.error ?? tr(lang, "Could not create owner account.", "মালিকের অ্যাকাউন্ট তৈরি করা যায়নি।")); }
    } catch (ex) { setErr(String(ex)); }
  };
  void setNotice;
  return (
    <main className="mx-auto max-w-md px-3 pt-8 pb-10">
      <div className="p-5 text-center" style={{ background: "#1c110b", border: "1px solid #c6a15b", borderRadius: 16, color: "#f5ebdd" }}>
        <div className="logo-tile mx-auto" style={{ width: 88, height: 88 }}><img src={logoImg} alt="Café Reza official logo" /></div>
        <p className="mt-3 text-xs font-bold tracking-widest" style={{ color: "#c6a15b" }}>{tr(lang, "STAFF ONLY", "শুধু স্টাফদের জন্য")}</p>
        <h1 className="serif mt-1 text-2xl font-bold">{tr(lang, "Admin panel sign-in", "অ্যাডমিন প্যানেলে সাইন-ইন")}</h1>
        <p className="mt-1 text-sm" style={{ color: "#cbb9a6" }}>{tr(lang, "Customer accounts cannot sign in here — the server rejects them. Customers use My Account (#/account).", "কাস্টমার অ্যাকাউন্ট দিয়ে এখানে সাইন-ইন করা যাবে না — সার্ভার তা প্রত্যাখ্যান করে। কাস্টমাররা My Account (#/account) ব্যবহার করেন।")}</p>
      </div>
      {!hasAdmin && <div className="mt-3 flex gap-2"><button className={`chip ${mode === "login" ? "chip-on" : ""}`} onClick={() => setMode("login")}>{tr(lang, "Staff sign-in", "স্টাফ সাইন-ইন")}</button><button className={`chip ${mode === "owner" ? "chip-on" : ""}`} onClick={() => setMode("owner")}>{tr(lang, "Create owner account", "মালিকের অ্যাকাউন্ট তৈরি করুন")}</button></div>}
      <form className="card mt-3 space-y-3 p-4" onSubmit={submit}>
        {mode === "owner" && <label className="block text-sm">{tr(lang, "Full name", "পুরো নাম")}<input aria-label="Owner full name" required value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label className="block text-sm">{tr(lang, "Work email", "কাজের ইমেইল")}<input aria-label="Admin email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === "owner" && <label className="block text-sm">{tr(lang, "Phone", "ফোন")}<input aria-label="Owner phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>}
        <label className="block text-sm">{tr(lang, "Password", "পাসওয়ার্ড")}<input aria-label="Admin password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {mode === "owner" && <p className="text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "At least 8 characters.", "কমপক্ষে ৮ অক্ষর।")}</p>}
        {err && <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>{err}</p>}
        <button className="btn-gold w-full" type="submit">{mode === "login" ? tr(lang, "Sign in to admin panel", "অ্যাডমিন প্যানেলে সাইন-ইন করুন") : tr(lang, "Create owner account", "মালিকের অ্যাকাউন্ট তৈরি করুন")}</button>
        {mode === "owner" && <p className="text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "Only available until the first owner account exists. No default password is published — choose your own.", "শুধু প্রথম মালিকের অ্যাকাউন্ট না থাকা পর্যন্ত। কোনো ডিফল্ট পাসওয়ার্ড দেওয়া নেই — নিজে বেছে নিন।")}</p>}
      </form>
      <div className="mt-3"><InstallAppCard variant="admin" lang={lang} /></div>
      <button className="btn-ghost mt-3 w-full" onClick={() => navigate("store")}>{tr(lang, "← Back to the cafe menu", "← ক্যাফের মেনুতে ফিরুন")}</button>
      <button className="btn-ghost mt-2 w-full" onClick={() => navigate("account")}>{tr(lang, "Customer sign-in instead", "কাস্টমার হিসেবে সাইন-ইন করুন")}</button>
    </main>
  );
}

const ADMIN_TABS: Array<[string, string, string]> = [["dashboard", "Dashboard", "ড্যাশবোর্ড"], ["orders", "Orders / Kitchen", "অর্ডার / কিচেন"], ["pos", "POS", "POS"], ["products", "Products & Categories", "প্রোডাক্ট ও ক্যাটাগরি"], ["inventory", "Inventory & Suppliers", "ইনভেন্টরি ও সাপ্লায়ার"], ["tables", "Tables & Reservations", "টেবিল ও রিজার্ভেশন"], ["coupons", "Coupons", "কুপন"], ["loyalty", "Loyalty", "লয়্যালটি"], ["staff", "Staff & Roles", "স্টাফ ও রোল"], ["expenses", "Expenses", "খরচ"], ["reports", "Reports", "রিপোর্ট"], ["settings", "Settings", "সেটিংস"], ["content", "Content & Banners", "কনটেন্ট ও ব্যানার"], ["support", "Support & Reviews", "সাপোর্ট ও রিভিউ"], ["security", "Security", "সিকিউরিটি"]];

function AdminShell({ token, setToken, user, hasAdmin, adminData, loading, refreshAll, setNotice, store, signOut, navigate, adminTab, setAdminTab, lang, setLang, theme, setTheme }: { token: string | null; setToken: (t: string | null) => void; user: ApiResponse<typeof api, "me">["user"]; hasAdmin: boolean; adminData: Record<string, any> | null | undefined; loading: boolean; refreshAll: () => void; setNotice: (s: string) => void; store: Store | undefined; signOut: () => void; navigate: ShellNav; adminTab: string; setAdminTab: (s: string) => void; lang: "bn" | "en"; setLang: (l: "bn" | "en") => void; theme: "dark" | "light"; setTheme: (t: "dark" | "light") => void }) {
  const role = user?.role ?? "";
  const baseTabs = role === "kitchen" ? ADMIN_TABS.filter(([k]) => k === "orders") : role === "cashier" ? ADMIN_TABS.filter(([k]) => ["dashboard", "orders", "pos"].includes(k)) : role === "inventory" ? ADMIN_TABS.filter(([k]) => ["inventory", "products"].includes(k)) : ADMIN_TABS;
  // Security (audit log, refund approvals, Firebase status) is admin /
  // manager only — never shown to other staff roles or to customers.
  const visibleTabs = (role === "admin" || role === "manager") ? baseTabs : baseTabs.filter(([k]) => k !== "security");
  const activeTab = visibleTabs.some(([k]) => k === adminTab) ? adminTab : visibleTabs[0]?.[0] ?? "dashboard";
  const activeLabel = visibleTabs.find(([k]) => k === activeTab);
  const staffLoginFromDenied = async () => {
    if (token) { try { await api.logout({ token }); } catch { /* session already gone */ } }
    localStorage.removeItem("cr_token");
    setToken(null);
    refreshAll();
  };
  if (!user) {
    return (
      <div className="min-h-screen" style={{ background: "#160f0c" }}>
        <SafeAreaTopScrim backgroundColor="#160f0c" />
        <AdminLogin hasAdmin={hasAdmin} setToken={setToken} refreshAll={refreshAll} setNotice={setNotice} navigate={navigate} lang={lang} />
      </div>
    );
  }
  if (role === "customer") {
    return (
      <div className="min-h-screen" style={{ background: "#160f0c" }}>
        <SafeAreaTopScrim backgroundColor="#160f0c" />
        <div className="mx-auto max-w-lg px-3 pt-10 pb-10">
          <div className="p-5 text-center" style={{ background: "#1c110b", border: "1px solid #c6a15b", borderRadius: 16, color: "#f5ebdd" }}>
            <b className="serif text-xl">{tr(lang, "Access denied.", "প্রবেশ নিষেধ।")}</b>
            <p className="mt-2 text-sm" style={{ color: "#cbb9a6" }}>{tr(lang, "You are signed in as a customer, and customers never see admin controls. Staff sign in here with a staff account — ask the owner to create one for you.", "আপনি কাস্টমার হিসেবে সাইন-ইন করেছেন, আর কাস্টমাররা কখনো অ্যাডমিন নিয়ন্ত্রণ দেখতে পান না। স্টাফরা এখানে স্টাফ অ্যাকাউন্ট দিয়ে সাইন-ইন করেন — অ্যাকাউন্টের জন্য মালিককে বলুন।")}</p>
            <button className="btn-gold mt-4 w-full" onClick={() => void staffLoginFromDenied()}>{tr(lang, "Staff sign-in (sign out of customer account)", "স্টাফ সাইন-ইন (কাস্টমার অ্যাকাউন্ট থেকে সাইন-আউট করুন)")}</button>
            <button className="btn-ghost mt-2 w-full" style={{ color: "#f5ebdd" }} onClick={signOut}>{tr(lang, "Sign out and go to the menu", "সাইন-আউট করে মেনুতে যান")}</button>
          </div>
        </div>
      </div>
    );
  }
  // Admin layout: dark sidebar + content — deliberately different from
  // the customer panel's top header + horizontal chip menu, and from the
  // storefront. No customer controls render anywhere in this shell.
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SafeAreaTopScrim backgroundColor="#1c110b" />
      <div className="md:sticky md:top-0 md:flex md:min-h-screen md:w-64 md:shrink-0 md:flex-col" style={{ background: "#1c110b", color: "#f5ebdd" }}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate("admin", "dashboard")} className="flex items-center gap-2 text-left" aria-label="Admin panel home"><Logo size={40} /><span className="serif text-lg font-bold leading-none">{tr(lang, "Admin Panel", "অ্যাডমিন প্যানেল")}<span className="block text-xs font-normal" style={{ color: "#cbb9a6" }}>{store?.settings?.cafeName ?? "Café Reza"}</span></span></button>
        </div>
        <p className="px-4 pb-2 text-xs" style={{ color: "#cbb9a6" }}>{tr(lang, "Signed in as", "সাইন-ইন করেছেন")} {user.name} ({role})</p>
        <nav aria-label="Admin navigation" className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:px-3">
          {visibleTabs.map(([k, labelEn, labelBn]) => {
            const label = lang === "bn" ? labelBn : labelEn;
            const on = activeTab === k;
            return (
              <button key={k} onClick={() => { setAdminTab(k); navigate("admin", k); }} aria-current={on ? "page" : undefined}
                className="whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold"
                style={on ? { background: "#c6a15b", color: "#160f0c", boxShadow: "inset 3px 0 0 #f5ebdd" } : { background: "transparent", color: "#f5ebdd" }}>{label}</button>
            );
          })}
        </nav>
        <div className="mt-auto hidden gap-2 p-4 md:flex md:flex-col">
          <button className="rounded-lg px-3 py-2 text-left text-sm" style={{ border: "1px solid #4a3325", color: "#f5ebdd" }} onClick={() => navigate("store")}>{tr(lang, "View store", "দোকান দেখুন")}</button>
          <button className="rounded-lg px-3 py-2 text-left text-sm" style={{ border: "1px solid #4a3325", color: "#f5ebdd" }} onClick={signOut}>{tr(lang, "Sign out", "সাইন-আউট")}</button>
          <p className="text-xs" style={{ color: "#cbb9a6" }}>Admin panel — #/admin • {tr(lang, "Separate from the customer panel (#/account).", "কাস্টমার প্যানেল (#/account) থেকে আলাদা।")}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-40 flex items-center gap-2 px-3 py-2" style={{ background: "var(--surface)", borderBottom: "2px solid var(--accent)" }}>
          <b className="serif flex-1 text-lg">{activeLabel ? (lang === "bn" ? activeLabel[2] : activeLabel[1]) : tr(lang, "Admin Panel", "অ্যাডমিন প্যানেল")}</b>
          <button className="chip" onClick={() => setLang(lang === "bn" ? "en" : "bn")} aria-label="Switch language">{lang === "bn" ? "EN" : "বাং"}</button>
          <button className="chip" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
          <button className="chip md:hidden" onClick={signOut}>{tr(lang, "Sign out", "সাইন-আউট")}</button>
        </div>
        <div className="mx-auto max-w-5xl px-3 py-4">
          <AdminView token={token} user={user} data={adminData} loading={loading} refreshAll={refreshAll} setNotice={setNotice} store={store} tab={activeTab} visibleTabs={visibleTabs} lang={lang} signOut={signOut} />
        </div>
        <p className="pb-6 text-center text-xs" style={{ color: "var(--dim)" }}>Admin panel — #/admin • Separate from the customer panel (#/account).</p>
      </div>
    </div>
  );
}

function AccountShell({ token, setToken, user, meData, hasAdmin, products, nameOf, refreshAll, signOut, setNotice, addToCart, navigate, settings, lang, setLang, theme, setTheme, goTrack, openChat }: { token: string | null; setToken: (t: string | null) => void; user: ApiResponse<typeof api, "me">["user"]; meData: ApiResponse<typeof api, "me"> | undefined; hasAdmin: boolean; products: Product[]; nameOf: (p: Product) => string; refreshAll: () => void; signOut: () => void; setNotice: (s: string) => void; addToCart: (p: Product) => void; navigate: ShellNav; settings: Store["settings"] | undefined; lang: "bn" | "en"; setLang: (l: "bn" | "en") => void; theme: "dark" | "light"; setTheme: (t: "dark" | "light") => void; goTrack: (orderNo: string) => void; openChat: (ctx?: { orderNo?: string; label?: string }) => void }) {
  const sections: Array<[string, string]> = [["account-overview", lang === "bn" ? "সারসংক্ষেপ" : "Overview"], ["account-orders", lang === "bn" ? "আমার অর্ডার" : "My orders"], ["account-reservations", lang === "bn" ? "আমার রিজার্ভেশন" : "My reservations"], ["account-wishlist", lang === "bn" ? "উইশলিস্ট" : "Wishlist"], ["account-addresses", lang === "bn" ? "সংরক্ষিত ঠিকানা" : "Saved addresses"], ["account-notifications", lang === "bn" ? "নোটিফিকেশন" : "Notifications"], ["account-messages", lang === "bn" ? "মেসেজ" : "Messages"]];
  void hasAdmin; // owner setup lives only in the admin panel login, never here
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // Panels never mix: a staff session reaching the customer panel sees
  // ONLY this denial — no customer controls, orders or profile render
  // for a staff account. Entering the admin panel is that account's own
  // separate entry (#/admin, staff login); becoming a customer by a role
  // change is refused server-side, so no switch happens here either.
  if (user && user.role !== "customer") {
    return (
      <div className="min-h-screen pb-8">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <div className="mx-auto max-w-lg px-3 pt-10">
          <div className="card p-5 text-center" style={{ border: "2px solid var(--accent)" }}>
            <b className="serif text-xl">{tr(lang, "Staff account — admin panel only.", "স্টাফ অ্যাকাউন্ট — শুধু অ্যাডমিন প্যানেলের জন্য।")}</b>
            <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "You are signed in with a staff account, and staff accounts never see customer controls. Staff work in the admin panel, with the staff sign-in there. Customers sign in here with a customer account.", "আপনি স্টাফ অ্যাকাউন্ট দিয়ে সাইন-ইন করেছেন, আর স্টাফ অ্যাকাউন্ট কখনো কাস্টমার নিয়ন্ত্রণ দেখতে পায় না। স্টাফরা অ্যাডমিন প্যানেলে কাজ করেন, সেখানকার স্টাফ সাইন-ইন দিয়ে। কাস্টমাররা এখানে কাস্টমার অ্যাকাউন্ট দিয়ে সাইন-ইন করেন।")}</p>
            <button className="btn-gold mt-4 w-full" onClick={() => navigate("admin")}>{tr(lang, "Open admin panel", "অ্যাডমিন প্যানেল খুলুন")}</button>
            <button className="btn-ghost mt-2 w-full" onClick={signOut}>{tr(lang, "Sign out", "সাইন-আউট")}</button>
          </div>
          <p className="mt-6 text-center text-xs" style={{ color: "var(--dim)" }}>Customer panel — #/account • No admin controls appear here. Staff sign in separately at #/admin.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen pb-8">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="sticky top-0 z-40" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 pt-safe">
          <button onClick={() => navigate("account")} className="flex items-center gap-2" aria-label="My account home"><Logo size={40} /><span className="serif text-lg font-bold leading-none">{tr(lang, "My Account", "আমার অ্যাকাউন্ট")}<span className="block text-xs font-normal" style={{ color: "var(--dim)" }}>{settings?.cafeName ?? "Café Reza"}</span></span></button>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="chip" onClick={() => setLang(lang === "bn" ? "en" : "bn")} aria-label="Switch language">{lang === "bn" ? "EN" : "বাং"}</button>
            <button className="chip" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
            <button className="chip" onClick={() => navigate("store")}>← Menu</button>
            {user && <button className="chip" onClick={signOut}>Sign out</button>}
          </div>
        </div>
        {user && <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2" aria-label="Account navigation">{sections.map(([id, label]) => <button key={id} className="chip" onClick={() => scrollTo(id)}>{label}</button>)}<button className="chip" onClick={() => navigate("track")}>📦 Track order</button></nav>}
      </header>
      <AccountView token={token} setToken={setToken} user={user} meData={meData} products={products} nameOf={nameOf} refreshAll={refreshAll} signOut={signOut} setNotice={setNotice} addToCart={addToCart} goTrack={goTrack} goReserve={() => navigate("reserve")} onMessage={(orderNo) => openChat({ orderNo, label: orderNo ? `Order ${orderNo}` : undefined })} settings={settings} lang={lang} />
      <div className="mx-auto mt-3 max-w-3xl px-3"><InstallAppCard variant="customer" lang={lang} /></div>
      <p className="mt-6 text-center text-xs" style={{ color: "var(--dim)" }}>Customer panel — #/account • No admin controls appear here. Staff sign in separately at #/admin.</p>
    </div>
  );
}

function DetailModal({ p, name, onClose, onAdd, wishlisted, onWish, store, token, onMessage, lang }: { p: Product; name: string; onClose: () => void; onAdd: (e: Partial<CartItem>) => void; wishlisted: boolean; onWish: () => void; store: Store | undefined; token: string | null; onMessage: () => void; lang: Lang }) {
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState("Regular");
  const [sugar, setSugar] = useState("Normal");
  const [milk, setMilk] = useState("Regular");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={p.nameEn}>
      <div className="card mx-auto my-6 max-w-lg overflow-hidden">
        <div className="p-3 pb-0"><DetailGallery p={p} lang={lang} /></div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><h2 className="serif text-2xl font-bold">{name}</h2><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{descText(p, lang)} • {categoryName(p, store?.categories, lang)} • ~{p.prepTime} min • Stock: {p.stock}</p>
          <div className="mt-3"><Price p={p} lang={lang} /></div>
          <label className="mt-4 block text-sm">Size (no price change)<select aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}><option>Small</option><option>Regular</option><option>Medium</option><option>Large</option></select></label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm">Sugar<select aria-label="Sugar level" value={sugar} onChange={(e) => setSugar(e.target.value)}><option>Less</option><option>Normal</option><option>Extra</option><option>No sugar</option></select></label>
            <label className="text-sm">Milk<select aria-label="Milk type" value={milk} onChange={(e) => setMilk(e.target.value)}><option>Regular</option><option>Full cream</option><option>Low fat</option><option>No milk</option></select></label>
          </div>
          <label className="mt-3 block text-sm">Special instructions<input aria-label="Special instructions" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less ice" /></label>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-2"><button className="chip" aria-label="Decrease quantity" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><b>{qty}</b><button className="chip" aria-label="Increase quantity" onClick={() => setQty(qty + 1)}>+</button></div>
            <button className="btn-gold flex-1" disabled={!p.available || p.price <= 0} onClick={() => onAdd({ qty, size, sugar, milk, note })}>{tr(lang, "Add to cart", "কার্টে যোগ করুন")}</button>
            <button className="btn-ghost" onClick={onWish} aria-label="Toggle wishlist">{wishlisted ? "♥ Saved" : "♡ Save"}</button>
            <button className="btn-ghost" onClick={onMessage}>{tr(lang, "Message Cafe", "ক্যাফেকে মেসেজ করুন")}</button>
          </div>
          <form className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }} onSubmit={async (e) => { e.preventDefault(); await api.addReview({ productId: p.id, author: "Guest", rating, comment }); setSent(true); }}>
            <h3 className="font-semibold">{tr(lang, "Write a review (moderated)", "রিভিউ লিখুন (মডারেটেড)")}</h3>
            <label className="mt-2 block text-sm">Rating<select aria-label="Rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} stars</option>)}</select></label>
            <label className="mt-2 block text-sm">Review<textarea aria-label="Review comment" value={comment} onChange={(e) => setComment(e.target.value)} required rows={3} /></label>
            <button className="btn-ghost mt-2" type="submit">{tr(lang, "Submit review", "রিভিউ জমা দিন")}</button>
            {sent && <p className="mt-2 text-sm" style={{ color: "var(--accent)" }}>Thank you — your review is waiting for moderation.</p>}
          </form>
          <p className="mt-3 text-xs" style={{ color: "var(--dim)" }}>Reviews from other customers appear on the menu page after approval.</p>
          <p className="hidden">{store?.coupons.length} {token}</p>
        </div>
      </div>
    </div>
  );
}

function CartView({ cart, setCart, products, nameOf, go, lang }: { cart: CartItem[]; setCart: (c: CartItem[]) => void; products: Product[]; nameOf: (p: Product) => string; go: (v: View) => void; lang: Lang }) {
  const rows = cart.map((c) => ({ ...c, p: products.find((x) => x.id === c.productId) })).filter((r) => r.p);
  const subtotal = rows.reduce((a, r) => a + (r.p ? (r.p.discountPrice ?? r.p.price) * r.qty : 0), 0);
  return (
    <main className="mx-auto max-w-3xl px-3 pt-4">
      <h1 className="serif text-2xl font-bold">{tr(lang, "Your cart", "আপনার কার্ট")}</h1>
      {rows.length === 0 && <p className="mt-4" style={{ color: "var(--dim)" }}>{tr(lang, "Your cart is empty. Browse the menu and add something tasty.", "আপনার কার্ট খালি। মেনু দেখে কিছু যোগ করুন।")}</p>}
      {rows.map((r, i) => (
        <div key={i} className="card mt-3 flex gap-3 p-3">
          <div className="w-20 flex-none overflow-hidden rounded-xl">{r.p && <ProdImg p={r.p} h={76} />}</div>
          <div className="flex-1">
            <b>{r.p && nameOf(r.p)}</b>
            <p className="text-xs" style={{ color: "var(--dim)" }}>{r.size} • {tr(lang, "Sugar", "চিনি")}: {r.sugar} • {tr(lang, "Milk", "দুধ")}: {r.milk}{r.note ? ` • ${r.note}` : ""}</p>
            <div className="mt-2 flex items-center gap-2">
              <button className="chip" aria-label="Decrease quantity" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}>−</button>
              <b>{r.qty}</b>
              <button className="chip" aria-label="Increase quantity" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, qty: c.qty + 1 } : c))}>+</button>
              <button className="btn-ghost ml-auto" style={{ padding: "6px 10px" }} onClick={() => setCart(cart.filter((_, j) => j !== i))}>{tr(lang, "Remove", "সরান")}</button>
            </div>
          </div>
          <b>{r.p && tk((r.p.discountPrice ?? r.p.price) * r.qty)}</b>
        </div>
      ))}
      {rows.length > 0 && <div className="card mt-4 flex items-center justify-between p-4"><span>{tr(lang, "Subtotal", "সাবটোটাল")}</span><b>{tk(subtotal)}</b></div>}
      {rows.length > 0 && <button className="btn-gold mt-4 w-full" onClick={() => go("checkout")}>{tr(lang, "Go to checkout", "চেকআউটে যান")}</button>}
      <button className="btn-ghost mt-3 w-full" onClick={() => go("store")}>{tr(lang, "Continue browsing", "আরও দেখুন")}</button>
    </main>
  );
}

function CheckoutView({ cart, setCart, products, settings, token, user, go, setNotice, refreshAll, onTrackOrder, prefillTable, onMessage, lang }: { cart: CartItem[]; setCart: (c: CartItem[]) => void; products: Product[]; settings: Store["settings"] | undefined; token: string | null; user: ApiResponse<typeof api, "me">["user"]; go: (v: View) => void; setNotice: (s: string) => void; refreshAll: () => void; onTrackOrder: (orderNo: string) => void; prefillTable?: string; onMessage: (orderNo?: string) => void; lang: Lang }) {
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState("");
  const [orderType, setOrderType] = useState<"delivery" | "takeaway" | "dine-in">(prefillTable ? "dine-in" : "delivery");
  const [checkoutTable, setCheckoutTable] = useState(prefillTable ?? "");
  const zones = parseZones(settings?.zonesJson).filter((z) => z.active);
  const [zone, setZone] = useState("");
  const enabledPayments = parseEnabledPayments(settings?.paymentsJson);
  const [payment, setPayment] = useState(enabledPayments[0] ?? "Cash on Delivery");
  const [ref, setRef] = useState("");
  const [coupon, setCoupon] = useState("");
  const [done, setDone] = useState<{ orderNo: string; total: number; paymentStatus: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const subtotal = cart.reduce((a, c) => { const p = products.find((x) => x.id === c.productId); return a + (p ? (p.discountPrice ?? p.price) * c.qty : 0); }, 0);
  const vat = Math.round((subtotal * (settings?.vatPercent ?? 0)) / 100);
  const zoneFee = zones.find((z) => z.area === zone)?.fee ?? (settings?.deliveryFee ?? 40);
  const fee = orderType === "delivery" ? (subtotal >= (settings?.freeDeliveryAt ?? 0) && (settings?.freeDeliveryAt ?? 0) > 0 ? 0 : zoneFee) : 0;
  const payNumber = payment === "bKash" ? settings?.bkashNumber : payment === "Nagad" ? settings?.nagadNumber : payment === "Rocket" ? settings?.rocketNumber : "";
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await api.placeOrder({ token: token ?? undefined, items: cart.map((c) => ({ productId: c.productId, qty: c.qty, size: c.size, note: `${c.sugar} sugar, ${c.milk} milk${c.note ? " — " + c.note : ""}` })), customerName: name, phone, address, orderType, source: "website", paymentMethod: payment, paymentRef: ref, couponCode: coupon, tableLabel: orderType === "dine-in" ? checkoutTable : "", notes: "", staffName: "", paidAmount: 0, zone: orderType === "delivery" ? zone : "", lang });
      if (!r.ok || !r.orderNo) { setErr(r.error ?? tr(lang, "Order failed.", "অর্ডার ব্যর্থ হয়েছে।")); return; }
      // Remember this order on this device so Track can list it in order
      // below the search box — the confirmation screen is no longer the
      // only place the order number lives.
      saveRecentOrder(r.orderNo, phone, r.total ?? 0);
      setDone({ orderNo: r.orderNo, total: r.total ?? 0, paymentStatus: r.paymentStatus ?? "" });
      setCart([]); refreshAll();
    } catch (ex) { setErr(tr(lang, "Order failed. Please try again.", "অর্ডার ব্যর্থ হয়েছে। আবার চেষ্টা করুন।")); } finally { setBusy(false); }
  };
  if (done) return (
    <main className="mx-auto max-w-lg px-3 pt-6 text-center">
      <div className="logo-tile mx-auto" style={{ width: 96, height: 96 }}><img src={logoImg} alt="Café Reza official logo" /></div>
      <h1 className="serif mt-4 text-3xl font-bold">{tr(lang, "Order placed!", "অর্ডার হয়ে গেছে!")}</h1>
      <p className="mt-2">{tr(lang, "Order number:", "অর্ডার নম্বর:")} <b>{done.orderNo}</b></p>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Your order is saved in Track below the search box, so you can find it again without retyping the number.", "আপনার অর্ডারটি সার্চ বক্সের নিচে ট্র্যাকে সংরক্ষিত আছে, তাই নম্বরটি আবার না লিখেও খুঁজে পাবেন।")}</p>
      <p>{tr(lang, "Total:", "মোট:")} <b>{tk(done.total)}</b> • {tr(lang, "Payment:", "পেমেন্ট:")} <b>{payText(done.paymentStatus, lang)}</b></p>
      {done.paymentStatus === "Pending verification" && <p className="mt-2 text-sm" style={{ color: "var(--accent)" }}>{tr(lang, "Demo Mode: your mobile payment stays pending until the owner verifies it. Do not treat it as paid yet.", "ডেমো মোড: মালিক যাচাই না করা পর্যন্ত আপনার মোবাইল পেমেন্ট অপেক্ষমাণ থাকবে। এখনো পরিশোধিত হিসেবে ধরবেন না।")}</p>}
      <button className="btn-gold mt-5 w-full" onClick={() => onTrackOrder(done.orderNo)}>{tr(lang, "Track this order", "এই অর্ডারটি ট্র্যাক করুন")}</button>
      <button className="btn-ghost mt-2 w-full" onClick={() => onMessage(done.orderNo)}>{tr(lang, "Message Cafe about this order", "এই অর্ডার নিয়ে ক্যাফেকে মেসেজ করুন")}</button>
      <button className="btn-ghost mt-2 w-full" onClick={() => go("store")}>{tr(lang, "Back to menu", "মেনুতে ফিরুন")}</button>
    </main>
  );
  if (cart.length === 0) return <main className="mx-auto max-w-lg px-3 pt-6"><p>{tr(lang, "Your cart is empty.", "আপনার কার্ট খালি।")}</p><button className="btn-gold mt-3" onClick={() => go("store")}>{tr(lang, "Browse menu", "মেনু দেখুন")}</button></main>;
  return (
    <main className="mx-auto max-w-lg px-3 pt-4">
      <h1 className="serif text-2xl font-bold">{tr(lang, "Checkout", "চেকআউট")}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Totals are re-checked on the server before your order is confirmed. Coupon discounts are applied by the server.", "অর্ডার নিশ্চিত হওয়ার আগে সার্ভারে মোট হিসাব আবার যাচাই করা হয়। কুপন ছাড় সার্ভারই প্রয়োগ করে।")}</p>
      <form onSubmit={submit} className="card mt-4 space-y-3 p-4">
        <label className="block text-sm">{tr(lang, "Full name", "পুরো নাম")}<input aria-label="Full name" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-sm">{tr(lang, "Phone", "ফোন")}<input aria-label="Phone number" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="block text-sm">{tr(lang, "Order type", "অর্ডারের ধরন")}<select aria-label="Order type" value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)}><option value="delivery">{tr(lang, "Home delivery", "হোম ডেলিভারি")}</option><option value="takeaway">{tr(lang, "Takeaway", "টেকঅ্যাওয়ে")}</option><option value="dine-in">{tr(lang, "Dine-in", "ডাইন-ইন")}</option></select></label>
        {orderType === "delivery" && <label className="block text-sm">{tr(lang, "Delivery address", "ডেলিভারির ঠিকানা")}<input aria-label="Delivery address" required value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tr(lang, "House, road, area, landmark", "বাড়ি, রাস্তা, এলাকা, পরিচিত স্থান")} /></label>}
        {orderType === "delivery" && zones.length > 0 && <label className="block text-sm">{tr(lang, "Delivery area (delivery charge set by the cafe)", "ডেলিভারি এলাকা (চার্জ ক্যাফে নির্ধারণ করে)")}<select aria-label="Delivery area" value={zone} onChange={(e) => setZone(e.target.value)}><option value="">{tr(lang, "Select area…", "এলাকা বেছে নিন…")}</option>{zones.map((z) => <option key={z.area} value={z.area}>{z.area} — {tk(z.fee)}{z.minOrder > 0 ? ` (${tr(lang, "min", "সর্বনিম্ন")} ${tk(z.minOrder)})` : ""}</option>)}</select></label>}
        {orderType === "delivery" && <p className="text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Delivering from", "ডেলিভারি আসছে")} {settings?.cafeName ?? "Café Reza"} — {addressText(settings?.address, lang)}. {tr(lang, "Questions? Call", "প্রশ্ন থাকলে কল করুন")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a>.</p>}
        {orderType === "dine-in" && <label className="block text-sm">{tr(lang, "Table", "টেবিল")}<input aria-label="Dine-in table" value={checkoutTable} onChange={(e) => setCheckoutTable(e.target.value)} placeholder={tr(lang, "e.g. T1", "যেমন: T1")} /></label>}
        {orderType !== "delivery" && <div className="rounded-xl p-3 text-sm" style={{ background: "var(--surface2)" }}><b>{tr(lang, "Pickup / dine-in at:", "পিকআপ / ডাইন-ইন:")}</b> {addressText(settings?.address, lang)} — <a className="underline" href={CAFE_MAPS_URL} target="_blank" rel="noopener">{tr(lang, "Get Directions", "দিকনির্দেশনা নিন")}</a> • {tr(lang, "Call", "কল করুন")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a></div>}
        <label className="block text-sm">{tr(lang, "Payment method", "পেমেন্ট মাধ্যম")}<select aria-label="Payment method" value={payment} onChange={(e) => setPayment(e.target.value)}>{enabledPayments.map((m) => <option key={m} value={m}>{paymentMethodText(m, lang)}</option>)}</select></label>
        {["bKash", "Nagad", "Rocket", "Bank Transfer"].includes(payment) && (
          <div className="rounded-xl p-3 text-sm" style={{ background: "var(--surface2)" }}>
            <p><b>{tr(lang, "Demo Mode — manual verification only.", "ডেমো মোড — শুধু ম্যানুয়াল যাচাই।")}</b> {settings?.paymentNote}</p>
            {payNumber && <p className="mt-1">{tr(lang, "Send to", "পাঠান")} {paymentMethodText(payment, lang)} {tr(lang, "number", "নম্বরে")}: <b>{payNumber}</b></p>}
            {!payNumber && <p className="mt-1">{tr(lang, "The owner has not added this number in Settings yet — ask at the counter.", "মালিক এখনো সেটিংসে এই নম্বর যোগ করেননি — কাউন্টারে জিজ্ঞাসা করুন।")}</p>}
            <label className="mt-2 block">{tr(lang, "Transaction / reference ID", "লেনদেন / রেফারেন্স আইডি")}<input aria-label="Transaction reference ID" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={tr(lang, "TrxID from your payment app", "আপনার পেমেন্ট অ্যাপের TrxID")} /></label>
          </div>
        )}
        <label className="block text-sm">{tr(lang, "Coupon code (optional)", "কুপন কোড (ঐচ্ছিক)")}<input aria-label="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder={tr(lang, "e.g. WELCOME10", "যেমন: WELCOME10")} /></label>
        <div className="space-y-1 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between"><span>{tr(lang, "Subtotal", "সাবটোটাল")}</span><span>{tk(subtotal)}</span></div>
          <div className="flex justify-between"><span>VAT ({settings?.vatPercent ?? 0}%)</span><span>{tk(vat)}</span></div>
          <div className="flex justify-between"><span>{tr(lang, "Delivery", "ডেলিভারি")}</span><span>{fee === 0 ? tr(lang, "Free", "ফ্রি") : tk(fee)}</span></div>
          <div className="flex justify-between text-base font-bold"><span>{tr(lang, "Estimated total", "আনুমানিক মোট")}</span><span>{tk(subtotal + vat + fee)}</span></div>
        </div>
        {err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
        <button className="btn-gold w-full" disabled={busy} type="submit">{busy ? tr(lang, "Placing…", "অর্ডার হচ্ছে…") : tr(lang, "Place order", "অর্ডার করুন")}</button>
        <button className="btn-ghost w-full" type="button" onClick={() => { setNotice(tr(lang, "Guest checkout is supported — no account needed.", "গেস্ট চেকআউট চলে — অ্যাকাউন্ট লাগবে না।")); go("cart"); }}>{tr(lang, "Back to cart", "কার্টে ফিরুন")}</button>
      </form>
    </main>
  );
}

const DELIVERY_STAGES = ["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered"];
function TrackView({ initialOrderNo, onClearInitial, myOrders, settings, onMessage, lang }: { initialOrderNo: string | null; onClearInitial: () => void; myOrders: Order[]; settings: Store["settings"] | undefined; onMessage: (orderNo?: string) => void; lang: Lang }) {
  const [no, setNo] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<Order | null>(null);
  const [missed, setMissed] = useState(false);
  const [tracked, setTracked] = useState<Order[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const loadList = async () => {
    const recent = loadRecentOrders();
    const merged = new Map<string, Order>();
    for (const o of myOrders) merged.set(o.orderNo, o);
    if (recent.length > 0) {
      setLoadingList(true);
      try {
        const r = await api.listTrackedOrders({ orders: recent.map((x) => ({ orderNo: x.orderNo, phone: x.phone })) });
        for (const o of (r.orders as Order[])) if (!merged.has(o.orderNo)) merged.set(o.orderNo, o);
      } catch { /* list falls back to the signed-in orders below */ } finally { setLoadingList(false); }
    }
    setTracked([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };
  useEffect(() => { void loadList(); }, [myOrders]);
  // Coming from "Track this order" after checkout: prefill the number and
  // show that order immediately — no retyping, no lost page.
  useEffect(() => {
    if (!initialOrderNo) return;
    setNo(initialOrderNo);
    const recent = loadRecentOrders().find((r) => r.orderNo === initialOrderNo);
    setPhone(recent?.phone ?? "");
    void (async () => { const r = await api.trackOrder({ orderNo: initialOrderNo, phone: recent?.phone ?? "" }); setResult(r.found ? (r.order as Order) : null); setMissed(!r.found); })();
    onClearInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderNo]);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api.trackOrder({ orderNo: no, phone });
    setResult(r.found ? (r.order as Order) : null); setMissed(!r.found);
    if (r.found && r.order) { saveRecentOrder((r.order as Order).orderNo, phone, (r.order as Order).total); void loadList(); }
  };
  return (
    <main className="mx-auto max-w-lg px-3 pt-4">
      <h1 className="serif text-2xl font-bold">{tr(lang, "Track your order", "আপনার অর্ডার ট্র্যাক করুন")}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Search by order number, or pick one of your orders below — newest first. Orders you place on this device stay listed here.", "অর্ডার নম্বর দিয়ে খুঁজুন, অথবা নিচে আপনার অর্ডারগুলো থেকে বেছে নিন — নতুনটা আগে। এই ডিভাইসে করা অর্ডার এখানেই তালিকায় থাকবে।")}</p>
      <form className="card mt-4 space-y-3 p-4" onSubmit={search}>
        <label className="block text-sm">{tr(lang, "Order number", "অর্ডার নম্বর")}<input aria-label="Order number" required value={no} onChange={(e) => setNo(e.target.value)} placeholder="CR-261103-0001" /></label>
        <label className="block text-sm">{tr(lang, "Phone (optional, must match the order)", "ফোন (ঐচ্ছিক, অর্ডারের সাথে মিলতে হবে)")}<input aria-label="Phone for tracking" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <button className="btn-gold w-full" type="submit">{tr(lang, "Track", "ট্র্যাক করুন")}</button>
      </form>
      {missed && <p className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{tr(lang, "No order found with those details. Check the order number and phone.", "এই তথ্যে কোনো অর্ডার পাওয়া যায়নি। অর্ডার নম্বর ও ফোন মিলিয়ে দেখুন।")}</p>}
      {result && (
        <div className="card mt-4 p-4" aria-live="polite">
          <div className="flex items-center gap-3"><Logo size={44} /><div><b>{result.orderNo}</b><p className="text-sm" style={{ color: "var(--dim)" }}>{new Date(result.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} • {result.orderType} • {result.source}</p></div></div>
          <div className="mt-3 flex flex-wrap gap-1">{STATUSES.map((s) => <span key={s} className={`chip ${s === result.status ? "chip-on" : ""}`} style={{ padding: "4px 8px", fontSize: 11 }}>{statusText(s, lang)}</span>)}</div>
          <p className="mt-3 text-sm">{tr(lang, "Status", "অবস্থা")}: <b>{statusText(result.status, lang)}</b> • {tr(lang, "Payment", "পেমেন্ট")}: <b>{payText(result.paymentStatus, lang)}</b> ({result.paymentMethod})</p>
          {result.orderType === "delivery" && (
            <div className="mt-3 rounded-xl p-3 text-sm" style={{ background: "var(--surface2)" }}>
              <b>{tr(lang, "Delivery update", "ডেলিভারি আপডেট")}</b>
              <ol className="mt-2 space-y-1">{DELIVERY_STAGES.map((s) => { const cur = DELIVERY_STAGES.indexOf(result.status); const idx = DELIVERY_STAGES.indexOf(s); return <li key={s} style={{ fontWeight: idx === cur ? 700 : 400 }}>{idx < cur ? "✓" : idx === cur ? "●" : "○"} {statusText(s, lang)}{idx === cur ? tr(lang, " — current stage", " — বর্তমান ধাপ") : ""}</li>; })}</ol>
              {result.staffName && <p className="mt-2">{tr(lang, "Assigned to", "দায়িত্বে")}: <b>{result.staffName}</b></p>}
              <p className="mt-2" style={{ color: "var(--dim)" }}>{tr(lang, "Your order travels from Café Reza at the address below. The stage above is updated by the cafe as the order moves — no live courier GPS is shown, and no staff member's personal location is shared.", "আপনার অর্ডার নিচের ঠিকানার ক্যাফে রেজা থেকে আসছে। অর্ডার এগোলে ক্যাফে উপরের ধাপ আপডেট করবে — কোনো লাইভ কুরিয়ার GPS দেখানো হয় না, এবং কোনো স্টাফের ব্যক্তিগত অবস্থান শেয়ার করা হয় না।")} {addressText(settings?.address, lang)}</p>
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2"><button className="btn-gold w-full" onClick={() => onMessage(result.orderNo)}>{tr(lang, "Message Cafe about this order", "এই অর্ডার নিয়ে ক্যাফেকে মেসেজ করুন")}</button><button className="btn-ghost w-full" onClick={() => { const el = document.getElementById("track-cafe-location"); el?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{tr(lang, "Where is the cafe?", "ক্যাফেটি কোথায়?")}</button></div>
          <ul className="mt-2 space-y-1 text-sm">{result.items.map((it: OrderItem, i: number) => <li key={i}>{it.qty} × {it.name} — {tk(it.price * it.qty)}</li>)}</ul>
          <p className="mt-2 font-bold">{tr(lang, "Total", "মোট")}: {tk(result.total)}</p>
          <div className="mt-3 space-y-1 text-xs" style={{ color: "var(--dim)" }}>{result.history.map((h: { status: string; at: string; by: string }, i: number) => <p key={i}>{h.status} — {new Date(h.at).toLocaleString("en-GB")} by {h.by}</p>)}</div>
          <button className="btn-ghost mt-3 w-full" onClick={() => { void loadList(); if (result) void (async () => { const r = await api.trackOrder({ orderNo: result.orderNo, phone: "" }); if (r.found) setResult(r.order as Order); })(); }}>{tr(lang, "Refresh status", "অবস্থা রিফ্রেশ করুন")}</button>
        </div>
      )}

      <h2 className="serif mt-6 text-xl font-bold">{tr(lang, "Your orders", "আপনার অর্ডারগুলো")}</h2>
      {loadingList && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Loading your orders…", "আপনার অর্ডার লোড হচ্ছে…")}</p>}
      {!loadingList && tracked.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No orders yet on this device. After you place an order, it appears here in order — newest first — so you never need to hunt for its number again. Signed-in customers also see their account orders here.", "এই ডিভাইসে এখনো কোনো অর্ডার নেই। অর্ডার করলে এখানে সিরিয়ালে — নতুনটা আগে — দেখা যাবে, তাই নম্বর খুঁজতে হবে না। সাইন-ইন করা কাস্টমাররা এখানে অ্যাকাউন্টের অর্ডারও দেখবেন।")}</p>}
      <ol className="mt-3 space-y-3">
        {tracked.map((o, i) => (
          <li key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2"><div><p className="text-xs" style={{ color: "var(--dim)" }}>#{i + 1} • {new Date(o.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</p><b>{o.orderNo}</b></div><span className="chip chip-on" style={{ padding: "4px 8px" }}>{statusText(o.status, lang)}</span></div>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{typeText(o.orderType, lang)} • {o.paymentMethod} ({payText(o.paymentStatus, lang)})</p>
            <ul className="mt-2 space-y-1 text-sm">{o.items.map((it: OrderItem, j: number) => <li key={j}>{it.qty} × {it.name} — {tk(it.price * it.qty)}</li>)}</ul>
            <p className="mt-2 font-bold">{tr(lang, "Total", "মোট")}: {tk(o.total)}</p>
            <button className="btn-gold mt-3 w-full" onClick={() => { setResult(o); setNo(o.orderNo); setMissed(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{tr(lang, "View tracking details", "ট্র্যাকিং বিস্তারিত দেখুন")}</button>
          </li>
        ))}
      </ol>
      {tracked.length > 0 && <button className="btn-ghost mt-3 w-full" onClick={() => void loadList()}>{tr(lang, "Refresh all statuses", "সব অবস্থা রিফ্রেশ করুন")}</button>}
      <div id="track-cafe-location" className="mt-6 scroll-mt-24"><CafeLocation settings={settings} title={tr(lang, "Cafe location", "ক্যাফের অবস্থান")} lang={lang} /></div>
      <div className="card mt-3 p-4"><b>{tr(lang, "Need help with an order?", "অর্ডার নিয়ে সাহায্য দরকার?")}</b><p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Message the cafe privately — only you and cafe staff can see it. Or call", "ক্যাফেকে প্রাইভেটে মেসেজ করুন — শুধু আপনি ও ক্যাফের স্টাফ দেখতে পারবেন। অথবা কল করুন")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a>.</p><button className="btn-gold mt-3 w-full" onClick={() => onMessage()}>{tr(lang, "Message Cafe", "ক্যাফেকে মেসেজ করুন")}</button></div>
    </main>
  );
}

function ReserveView({ setNotice, userPhone, lang }: { setNotice: (s: string) => void; userPhone?: string; lang: Lang }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", date: "", time: "19:00", guests: 2, requests: "" });
  const [done, setDone] = useState<ReservationRow | null>(() => loadLastReservation());
  const [searchId, setSearchId] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [found, setFound] = useState<ReservationRow | null>(null);
  const [missed, setMissed] = useState(false);
  const [mine, setMine] = useState<ReservationRow[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const loadMine = async (phoneOverride?: string) => {
    const phone = (phoneOverride ?? searchPhone ?? userPhone ?? "").trim();
    const recent = loadRecentReservations();
    const merged = new Map<number, ReservationRow>();
    setLoadingMine(true);
    try {
      if (phone) {
        const r = await api.listMyReservations({ phone });
        for (const x of (r.reservations as ReservationRow[])) merged.set(x.id, x);
      }
      for (const rec of recent) {
        const r = await api.trackReservation({ id: rec.id, phone: rec.phone });
        if (r.found && r.reservation) merged.set(r.reservation.id, r.reservation as ReservationRow);
      }
    } catch { /* list falls back to whatever was already loaded */ } finally { setLoadingMine(false); }
    const list = [...merged.values()].sort((a, b) => b.id - a.id);
    setMine(list);
    return list;
  };
  useEffect(() => { void loadMine(userPhone); }, [userPhone]);
  const submitBooking = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api.createReservation(f);
    if (!r.ok || !r.reservation) { setNotice(r.error ?? "Could not create the reservation."); return; }
    const saved = r.reservation as ReservationRow;
    saveRecentReservation(saved.id, saved.phone);
    storeLastReservation(saved);
    setDone(saved);
    setSearchId(String(saved.id));
    setSearchPhone(saved.phone);
    setFound(saved);
    setMissed(false);
    void loadMine(saved.phone);
    document.getElementById("reservation-confirmation")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const search = async (e: FormEvent) => {
    e.preventDefault();
    const id = Number(searchId);
    if (!id) { setMissed(true); setFound(null); return; }
    const r = await api.trackReservation({ id, phone: searchPhone });
    setFound(r.found ? (r.reservation as ReservationRow) : null);
    setMissed(!r.found);
    if (r.found && r.reservation) { saveRecentReservation(r.reservation.id, searchPhone); void loadMine(searchPhone); }
  };
  const startAnother = () => { setDone(null); clearLastReservation(); setF({ name: "", phone: f.phone, email: "", date: "", time: "19:00", guests: 2, requests: "" }); };
  return (
    <main className="mx-auto max-w-lg px-3 pt-4">
      <h1 className="serif text-2xl font-bold">{tr(lang, "Reserve a table", "টেবিল বুক করুন")}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "The cafe confirms every reservation — a request is not a confirmed booking until staff approve it. Your bookings stay listed below, newest first.", "প্রতিটি রিজার্ভেশন ক্যাফে নিশ্চিত করে — স্টাফ অনুমোদন না করা পর্যন্ত বুকিং নিশ্চিত নয়। আপনার বুকিংগুলো নিচে সিরিয়ালে থাকবে, নতুনটা আগে।")}</p>

      {done && (
        <div id="reservation-confirmation" className="card mt-4 p-4" aria-live="polite">
          <b>{tr(lang, "Reservation received — Reservation ID", "রিজার্ভেশন পাওয়া গেছে — রিজার্ভেশন আইডি")}: {done.id}</b>
          <p className="mt-2 text-sm">{tr(lang, "Keep this ID: it finds your booking again from the search below, even after you leave this page.", "এই আইডিটি রাখুন: নিচের সার্চ দিয়ে, এই পেজ ছেড়ে গেলেও, আপনার বুকিং আবার খুঁজে পাবেন।")}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Name</dt><dd><b>{done.name}</b></dd></div>
            <div className="flex justify-between"><dt>Date</dt><dd><b>{done.date}</b></dd></div>
            <div className="flex justify-between"><dt>Time</dt><dd><b>{done.time}</b></dd></div>
            <div className="flex justify-between"><dt>Guests</dt><dd><b>{done.guests}</b></dd></div>
            <div className="flex justify-between"><dt>Table</dt><dd><b>{done.tableLabel || "To be assigned by staff"}</b></dd></div>
            <div className="flex justify-between"><dt>Status</dt><dd><b>{statusText(done.status, lang)}</b></dd></div>
            <div className="flex justify-between"><dt>Phone</dt><dd>{done.phone}</dd></div>
          </dl>
          {done.requests && <p className="mt-2 text-sm">Requests: {done.requests}</p>}
          <div className="mt-4 flex flex-col gap-2">
            <button className="btn-gold w-full" onClick={() => document.getElementById("my-reservations")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{tr(lang, "View my reservations", "আমার রিজার্ভেশন দেখুন")}</button>
            <button className="btn-ghost w-full" onClick={startAnother}>{tr(lang, "Book another table", "আরেকটি টেবিল বুক করুন")}</button>
          </div>
        </div>
      )}

      <form className="card mt-4 space-y-3 p-4" onSubmit={search}>
        <b>{tr(lang, "Find a reservation by ID", "আইডি দিয়ে রিজার্ভেশন খুঁজুন")}</b>
        <label className="block text-sm">Reservation ID<input aria-label="Reservation ID" inputMode="numeric" required value={searchId} onChange={(e) => setSearchId(e.target.value)} placeholder="e.g. 3" /></label>
        <label className="block text-sm">Phone (must match the booking)<input aria-label="Phone for reservation search" value={searchPhone} onChange={(e) => setSearchPhone(e.target.value)} placeholder="Phone used when booking" /></label>
        <button className="btn-gold w-full" type="submit">{tr(lang, "Find reservation", "রিজার্ভেশন খুঁজুন")}</button>
      </form>
      {missed && <p className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{tr(lang, "No reservation found with that ID and phone. Check the ID from your confirmation above.", "এই আইডি ও ফোনে কোনো রিজার্ভেশন পাওয়া যায়নি। উপরের কনফার্মেশন থেকে আইডি মিলিয়ে দেখুন।")}</p>}
      {found && (
        <div className="card mt-4 p-4" aria-live="polite">
          <div className="flex justify-between gap-2"><b>Reservation ID: {found.id}</b><span className="chip chip-on">{statusText(found.status, lang)}</span></div>
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{found.name} • {found.phone}</p>
          <p className="mt-1 text-sm">Date <b>{found.date}</b> at <b>{found.time}</b> • {found.guests} guests • Table: <b>{found.tableLabel || "To be assigned"}</b></p>
          {found.requests && <p className="mt-1 text-sm">Requests: {found.requests}</p>}
          <button className="btn-ghost mt-3 w-full" onClick={() => void loadMine(searchPhone || found.phone)}>Refresh status</button>
        </div>
      )}

      {!done && (
        <form className="card mt-4 space-y-3 p-4" onSubmit={submitBooking}>
          <b>{tr(lang, "New table booking", "নতুন টেবিল বুকিং")}</b>
          <label className="block text-sm">Name<input aria-label="Reservation name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="block text-sm">Phone<input aria-label="Reservation phone" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="block text-sm">Email (optional)<input aria-label="Reservation email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Date<input aria-label="Reservation date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="block text-sm">Time<input aria-label="Reservation time" type="time" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
          </div>
          <label className="block text-sm">Guests<input aria-label="Guest count" type="number" min={1} max={20} required value={f.guests} onChange={(e) => setF({ ...f, guests: Number(e.target.value) })} /></label>
          <label className="block text-sm">Special requests<textarea aria-label="Special requests" rows={3} value={f.requests} onChange={(e) => setF({ ...f, requests: e.target.value })} /></label>
          <button className="btn-gold w-full" type="submit">{tr(lang, "Request reservation", "রিজার্ভেশনের অনুরোধ করুন")}</button>
        </form>
      )}

      <h2 id="my-reservations" className="serif mt-6 scroll-mt-24 text-xl font-bold">{tr(lang, "My reservations", "আমার রিজার্ভেশনগুলো")}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Newest first. Bookings made on this device, and bookings under the phone above, appear here — no ID needed.", "নতুনটা আগে। এই ডিভাইসে করা বুকিং ও উপরের ফোনের বুকিং এখানে দেখা যাবে — আইডি লাগবে না।")}</p>
      {loadingMine && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Loading your reservations…", "আপনার রিজার্ভেশন লোড হচ্ছে…")}</p>}
      {!loadingMine && mine.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No reservations yet. After you book a table, it appears here in order.", "এখনো কোনো রিজার্ভেশন নেই। টেবিল বুক করলে এখানে সিরিয়ালে দেখা যাবে।")}</p>}
      <ol className="mt-3 space-y-3">
        {mine.map((r, i) => (
          <li key={r.id} className="card p-4">
            <div className="flex items-start justify-between gap-2"><div><p className="text-xs" style={{ color: "var(--dim)" }}>#{i + 1}</p><b>Reservation ID: {r.id}</b></div><span className="chip chip-on" style={{ padding: "4px 8px" }}>{statusText(r.status, lang)}</span></div>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{r.name} • {r.phone}</p>
            <p className="mt-1 text-sm">Date <b>{r.date}</b> at <b>{r.time}</b> • {r.guests} guests • Table: <b>{r.tableLabel || "To be assigned"}</b></p>
            {r.requests && <p className="mt-1 text-sm">Requests: {r.requests}</p>}
            <button className="btn-ghost mt-3 w-full" onClick={() => { setFound(r); setSearchId(String(r.id)); setSearchPhone(r.phone); setMissed(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>View details</button>
          </li>
        ))}
      </ol>
      {mine.length > 0 && <button className="btn-ghost mt-3 w-full" onClick={() => void loadMine()}>{tr(lang, "Refresh all reservations", "সব রিজার্ভেশন রিফ্রেশ করুন")}</button>}
    </main>
  );
}

function InfoView({ tab, setTab, settings, lang, onMessage }: { tab: string; setTab: (s: string) => void; settings: Store["settings"] | undefined; lang: Lang; onMessage: () => void }) {
  const faqs: Array<[string, string, string, string]> = [
    ["Do I need an account to order?", "অর্ডার করতে কি অ্যাকাউন্ট লাগবে?", "No. Guest checkout works — name, phone and delivery details are enough.", "না। গেস্ট চেকআউট চলে — নাম, ফোন ও ডেলিভারির তথ্যই যথেষ্ট।"],
    ["How do bKash / Nagad / Rocket payments work here?", "এখানে bKash / Nagad / Rocket পেমেন্ট কীভাবে কাজ করে?", "Demo Mode: send the payment yourself, enter the transaction ID, and the order stays Pending verification until the owner verifies it in Admin. It is never auto-marked paid.", "ডেমো মোড: নিজে পেমেন্ট পাঠিয়ে ট্রানজাকশন আইডি দিন; মালিক অ্যাডমিনে যাচাই না করা পর্যন্ত অর্ডার “যাচাইয়ের অপেক্ষায়” থাকবে। এটি কখনো স্বয়ংক্রিয়ভাবে পরিশোধিত ধরা হয় না।"],
    ["Can I cancel my order?", "আমি কি অর্ডার বাতিল করতে পারব?", "Pending and Confirmed orders can be cancelled from your account. Later stages need the cafe's help — contact them directly.", "অপেক্ষমাণ ও নিশ্চিত অর্ডার অ্যাকাউন্ট থেকে বাতিল করা যায়। পরের ধাপে ক্যাফের সাহায্য লাগবে — সরাসরি যোগাযোগ করুন।"],
    ["What if an item has no price?", "কোনো আইটেমের দাম না থাকলে কী হবে?", "Testing items without a confirmed price show “Price to be set” and cannot be ordered until the owner sets a price in Admin.", "নিশ্চিত দাম ছাড়া টেস্টিং আইটেমে “দাম নির্ধারণ হয়নি” দেখাবে এবং মালিক অ্যাডমিনে দাম না বসানো পর্যন্ত অর্ডার করা যাবে না।"],
    ["What are the Iced Mint Lemonade sizes?", "Iced Mint Lemonade-এর সাইজ কী কী?", "Half is 60 TK and Full is 120 TK, per the owner's correction. Order the Half or Full item from the menu.", "হাফ ৬০ টাকা ও ফুল ১২০ টাকা, মালিকের সংশোধন অনুযায়ী। মেনু থেকে হাফ বা ফুল আইটেমটি অর্ডার করুন।"],
  ];
  return (
    <main className="mx-auto max-w-3xl px-3 pt-4">
      <div className="flex gap-2 overflow-x-auto">{([["about", "About", "আমাদের সম্পর্কে"], ["faq", "FAQ", "সাধারণ জিজ্ঞাসা"], ["policies", "Policies", "নীতিমালা"], ["contact", "Contact", "যোগাযোগ"]] as Array<[string, string, string]>).map(([k, lEn, lBn]) => <button key={k} className={`chip ${tab === k ? "chip-on" : ""}`} onClick={() => setTab(k)}>{lang === "bn" ? lBn : lEn}</button>)}</div>
      {tab === "about" && <div className="card mt-4 p-5">
        <div className="logo-tile" style={{ width: 120, height: 120 }}><img src={logoImg} alt="Café Reza official logo" /></div>
        <h1 className="serif mt-3 text-2xl font-bold">{settings?.cafeName ?? "Café Reza"}</h1>
        <p className="mt-2">{taglineText(settings?.tagline, lang)}</p>
        <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{parseContent(settings?.contentJson).aboutText || "A premium cafe in Bangladesh serving hot and cold coffee, milkshakes, fresh juice, doi-chira, special faluda and steamed momos — for dine-in, takeaway and home delivery."} {lang === "bn" ? "সব দাম মালিকের ছাপা মেনু অনুযায়ী।" : "All prices follow the owner's printed menu."}</p>
        <div className="mt-4">
          <b>{lang === "bn" ? "খোলার সময়" : "Opening hours"}</b>
          {parseHours(settings?.hoursJson).length > 0 ? <div className="mt-2 space-y-1 text-sm">{parseHours(settings?.hoursJson).map((d) => <p key={d.day} className="flex justify-between"><span>{d.day}</span><span>{d.closed ? "Closed" : `${d.open}–${d.close}`}</span></p>)}</div> : <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? "খোলার সময় এখনো নির্ধারণ করা হয়নি। নিশ্চিত হতে ক্যাফেতে কল করুন।" : "Opening hours have not been set yet. Please call the cafe to confirm."}</p>}
          {settings?.hours && <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>{settings.hours}</p>}
        </div>
        <div className="mt-4"><CafeLocation settings={settings} lang={lang as Lang} /></div>
        <img src={heroImg} alt="Coffee at Cafe Reza" className="mt-4 h-56 w-full rounded-xl object-cover" />
      </div>}
      {tab === "faq" && <div className="mt-4 space-y-3">{faqs.map(([qEn, qBn, aEn, aBn], i) => <div key={i} className="card p-4"><b>{lang === "bn" ? qBn : qEn}</b><p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? aBn : aEn}</p></div>)}</div>}
      {tab === "policies" && <div className="mt-4 space-y-3">
        {[["Privacy Policy", "গোপনীয়তা নীতি", "We store only what you give us: your name, contact details, orders, addresses and loyalty points. Passwords are stored hashed, never in plain text. Staff see orders to fulfil them; customers see only their own orders. No payment secrets are stored in this app.", "আমরা শুধু আপনার দেওয়া তথ্যই রাখি: নাম, যোগাযোগের তথ্য, অর্ডার, ঠিকানা ও লয়্যালটি পয়েন্ট। পাসওয়ার্ড হ্যাশ করে রাখা হয়, কখনো সরল টেক্সটে নয়। স্টাফ অর্ডার পূরণের জন্য অর্ডার দেখেন; কাস্টমার শুধু নিজের অর্ডার দেখেন। এই অ্যাপে কোনো পেমেন্ট গোপন তথ্য রাখা হয় না।"],
          ["Terms & Conditions", "শর্তাবলি", "Prices follow the printed menu and are re-checked on the server at checkout. The cafe may confirm, change or cancel an order by phone if an item is unavailable.", "দাম ছাপা মেনু অনুযায়ী এবং চেকআউটে সার্ভারে আবার যাচাই করা হয়। কোনো আইটেম না থাকলে ক্যাফে ফোনে অর্ডার নিশ্চিত, পরিবর্তন বা বাতিল করতে পারে।"],
          ["Delivery Policy", "ডেলিভারি নীতি", `Delivery fee is ${settings ? tk(settings.deliveryFee) : "set in Settings"}${settings && settings.freeDeliveryAt > 0 ? `, free over ${tk(settings.freeDeliveryAt)}` : ""}. Delivery areas and times are set by the owner in Admin → Settings.`, `ডেলিভারি চার্জ ${settings ? tk(settings.deliveryFee) : "সেটিংসে নির্ধারিত"}${settings && settings.freeDeliveryAt > 0 ? `, ${tk(settings.freeDeliveryAt)}-এর বেশি হলে ফ্রি` : ""}। ডেলিভারি এলাকা ও সময় মালিক অ্যাডমিন → সেটিংসে নির্ধারণ করেন।`],
          ["Refund & Cancellation Policy", "ফেরত ও বাতিল নীতি", "Pending/Confirmed orders can be cancelled with stock restored. Refunds for verified payments are processed by the owner and marked Refunded in Admin — never automatically. Mobile payments pending verification are not treated as paid.", "অপেক্ষমাণ/নিশ্চিত অর্ডার স্টক ফিরিয়ে বাতিল করা যায়। যাচাইকৃত পেমেন্টের ফেরত মালিক প্রক্রিয়া করেন এবং অ্যাডমিনে “ফেরত দেওয়া হয়েছে” হিসেবে চিহ্নিত করেন — কখনো স্বয়ংক্রিয়ভাবে নয়। যাচাইয়ের অপেক্ষায় থাকা মোবাইল পেমেন্ট পরিশোধিত ধরা হয় না।"]].map(([hEn, hBn, bEn, bBn]) => <div key={hEn} className="card p-4"><b>{lang === "bn" ? hBn : hEn}</b><p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? bBn : bEn}</p></div>)}
      </div>}
      {tab === "contact" && <div><div className="mt-4"><CafeLocation settings={settings} title={lang === "bn" ? "যোগাযোগ ও অবস্থান" : "Contact & location"} lang={lang as Lang} /></div><div className="card mt-3 p-4"><b>{lang === "bn" ? "ক্যাফেকে প্রাইভেটে মেসেজ করুন" : "Message the cafe privately"}</b><p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{lang === "bn" ? "প্রাইভেট ইন-অ্যাপ চ্যাট — শুধু আপনি ও ক্যাফের স্টাফ দেখতে পারবেন। পাবলিক সাপোর্ট টিকিটের জন্য নিচের ফর্মটি ব্যবহার করুন।" : "Private in-app chat — only you and cafe staff can see it. For a public support ticket, use the form below instead."}</p><button className="btn-gold mt-3 w-full" onClick={onMessage}>{lang === "bn" ? "ক্যাফেকে মেসেজ করুন" : "Message Cafe"}</button></div><ContactForm settings={settings} lang={lang as Lang} /></div>}
    </main>
  );
}
function ContactForm({ settings, lang }: { settings: Store["settings"] | undefined; lang: Lang }) {
  const [f, setF] = useState({ name: "", phone: "", category: "General", priority: "Normal", message: "" });
  const [done, setDone] = useState(false);
  return done ? <div className="card mt-4 p-4"><b>{tr(lang, "Message sent.", "মেসেজ পাঠানো হয়েছে।")}</b><p className="text-sm">{tr(lang, "Staff will see your ticket in Admin → Support.", "স্টাফ আপনার টিকিট অ্যাডমিন → সাপোর্টে দেখবেন।")}</p><button className="btn-ghost mt-2" onClick={() => setDone(false)}>{tr(lang, "Send another", "আরেকটি পাঠান")}</button></div> : (
    <form className="card mt-4 space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.createTicket(f); setDone(true); }}>
      <b>{tr(lang, "Support ticket (staff reply in Admin → Support)", "সাপোর্ট টিকিট (স্টাফ অ্যাডমিন → সাপোর্টে উত্তর দেবেন)")}</b>
      <p className="text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Or reach the cafe directly: call", "অথবা সরাসরি ক্যাফের সাথে যোগাযোগ করুন: কল করুন")} <a className="underline" href={telHref(settings?.phone || "+880 1805-501689")}>{settings?.phone || "+880 1805-501689"}</a>, or message via the <a className="underline" href={settings?.facebook || "https://www.facebook.com/cafereza4u"} target="_blank" rel="noreferrer">{tr(lang, "Facebook page / Messenger", "ফেসবুক পেজ / মেসেঞ্জার")}</a>.</p>
      <label className="block text-sm">{tr(lang, "Name", "নাম")}<input aria-label="Contact name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block text-sm">{tr(lang, "Phone", "ফোন")}<input aria-label="Contact phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">{tr(lang, "Category", "ক্যাটাগরি")}<select aria-label="Ticket category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option>General</option><option>Order</option><option>Refund request</option><option>Complaint</option></select></label>
        <label className="block text-sm">{tr(lang, "Priority", "অগ্রাধিকার")}<select aria-label="Ticket priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option>Normal</option><option>High</option><option>Urgent</option></select></label>
      </div>
      <label className="block text-sm">Message<textarea aria-label="Contact message" required rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      <button className="btn-gold w-full" type="submit">{tr(lang, "Send message", "মেসেজ পাঠান")}</button>
    </form>
  );
}

function AccountView({ token, setToken, user, meData, products, nameOf, refreshAll, signOut, setNotice, addToCart, goTrack, goReserve, onMessage, settings, lang }: { token: string | null; setToken: (t: string | null) => void; user: ApiResponse<typeof api, "me">["user"]; meData: ApiResponse<typeof api, "me"> | undefined; products: Product[]; nameOf: (p: Product) => string; refreshAll: () => void; signOut: () => void; setNotice: (s: string) => void; addToCart: (p: Product) => void; goTrack: (orderNo: string) => void; goReserve: () => void; onMessage: (orderNo?: string) => void; settings: Store["settings"] | undefined; lang: Lang }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [addr, setAddr] = useState({ label: "Home", address: "", area: "", phone: "" });
  const [myReservations, setMyReservations] = useState<ReservationRow[]>([]);
  const [redeemMsg, setRedeemMsg] = useState("");
  const [privacyMsg, setPrivacyMsg] = useState("");
  // NOTE: the 6-digit OTP-code option is intentionally hidden — no email
  // provider (Resend) is configured, so no code can ever be emailed. The
  // server actions stay, but nothing in the UI offers them; verification
  // is Firebase verification email only (below).
  // Verification is required after every sign-in path, including
  // Google — by Firebase verification email or by OTP code, either one.
  const [fbPassword, setFbPassword] = useState("");
  const [fbMsg, setFbMsg] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const sendFirebaseMail = async () => {
    if (!user) return;
    setFbBusy(true);
    const r = await sendFirebaseVerificationEmail(user.email, fbPassword || undefined);
    setFbBusy(false);
    setFbMsg(r.alreadyVerified ? tr(lang, "Firebase says this email is already verified. Press “I clicked the link” below to finish verification here.", "Firebase বলছে এই ইমেইল আগেই যাচাই হয়েছে। নিচের “লিংকে ক্লিক করেছি” বোতামে চাপ দিয়ে এখানে যাচাই সম্পূর্ণ করুন।") : r.ok ? tr(lang, "Firebase sent a verification email to your Gmail. Open it and click the verification link, then press “I clicked the link” below.", "Firebase আপনার Gmail-এ যাচাই মেইল পাঠিয়েছে। মেইলটি খুলে যাচাই লিংকে ক্লিক করুন, তারপর নিচের “লিংকে ক্লিক করেছি” বোতামে চাপুন।") : (r.error ?? tr(lang, "Firebase verification email could not be sent.", "Firebase যাচাই মেইল পাঠানো যায়নি।")));
    if (r.ok || r.alreadyVerified) refreshAll();
  };
  const confirmFirebase = async () => {
    if (!user) return;
    setFbBusy(true);
    const r = await confirmFirebaseEmailVerified(token ?? "", user.email, fbPassword || undefined);
    setFbBusy(false);
    if (r.ok) { setFbMsg(tr(lang, "Email verified with the Firebase verification email — you can now place orders.", "Firebase যাচাই মেইল দিয়ে ইমেইল যাচাই হয়েছে — এখন অর্ডার করতে পারবেন।")); setFbPassword(""); refreshAll(); }
    else setFbMsg(r.error ?? tr(lang, "Verification could not be completed.", "যাচাই সম্পূর্ণ করা যায়নি।"));
  };
  const exportData = async () => { const r = await api.exportMyData({ token: token ?? "" }); if (!r.ok || !r.json) { setPrivacyMsg(r.error ?? "Export failed."); return; } const blob = new Blob([r.json], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cafe-reza-my-data.json"; a.click(); URL.revokeObjectURL(a.href); setPrivacyMsg(tr(lang, "Your data was downloaded.", "আপনার ডেটা ডাউনলোড হয়েছে।")); };
  useEffect(() => {
    if (!user?.phone) return;
    void (async () => { try { const r = await api.listMyReservations({ token: token ?? "", phone: user.phone }); setMyReservations(r.reservations as ReservationRow[]); } catch { /* reservations list is optional here */ } })();
  }, [user?.phone, token]);
  const [gmailNote, setGmailNote] = useState("");
  const [gmailBusy, setGmailBusy] = useState(false);
  const onGmail = async () => {
    if (!(await isFirebaseConfigured())) { setGmailNote(tr(lang, "Google sign-in needs Firebase Auth configuration, which is not complete. Please sign in with your email and password below.", "Google সাইন-ইনের জন্য Firebase Auth কনফিগারেশন দরকার, যা সম্পূর্ণ হয়নি। নিচে ইমেইল ও পাসওয়ার্ড দিয়ে সাইন-ইন করুন।")); return; }
    setGmailBusy(true);
    setGmailNote(tr(lang, "Opening Google sign-in…", "Google সাইন-ইন খুলছে…"));
    const r = await signInWithGoogleAndLink();
    setGmailBusy(false);
    if (r.ok && r.token) { saveToken(r.token); return; }
    setGmailNote(r.error ?? tr(lang, "Google sign-in failed.", "Google সাইন-ইন ব্যর্থ হয়েছে।"));
  };
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  useEffect(() => { if (!justLoggedIn) return; const id = setTimeout(() => setJustLoggedIn(false), 1800); return () => clearTimeout(id); }, [justLoggedIn]);
  const saveToken = (t: string) => { localStorage.setItem("cr_token", t); setToken(t); setJustLoggedIn(true); refreshAll(); };
  const submitAuth = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      if (mode === "login") { const r = await api.login({ email, password }); if (r.ok && r.token) saveToken(r.token); else setErr(r.error ?? "Login failed."); }
      else {
        if (password.length < 4) { setErr(tr(lang, "Password must be at least 4 characters.", "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।")); return; }
        if (password.length < 6) { setErr(tr(lang, "Firebase login needs a password of at least 6 characters — please use 6 or more characters. A 4–5 character password cannot be registered through Firebase Auth, so the registration was not sent.", "Firebase লগইনের জন্য পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে — ৬ বা তার বেশি অক্ষর ব্যবহার করুন। ৪–৫ অক্ষরের পাসওয়ার্ড দিয়ে Firebase Auth-এ রেজিস্ট্রেশন করা যায় না, তাই রেজিস্ট্রেশন পাঠানো হয়নি।")); return; }
        const r = await api.register({ name, email, phone, password });
        if (r.ok && r.token) {
          saveToken(r.token);
          // Firebase sends the verification email itself (no Resend
          // needed). A failure here never blocks the account: the
          // Firebase / OTP options stay available on the account page.
          const fr = await registerFirebaseEmailUser(email, password);
          setFbMsg(fr.ok ? tr(lang, "Account created. Firebase sent a verification email to your Gmail — open it and click the link, then press “I clicked the link” below.", "অ্যাকাউন্ট তৈরি হয়েছে। Firebase আপনার Gmail-এ যাচাই মেইল পাঠিয়েছে — মেইলটি খুলে লিংকে ক্লিক করুন, তারপর নিচের “লিংকে ক্লিক করেছি” বোতামে চাপুন।") : (fr.error ?? ""));
        } else setErr(r.error ?? "Registration failed.");
      }
    } catch (ex) { setErr(String(ex)); }
  };
  if (!user) return (
    <main className="relative -mx-3 overflow-hidden px-3 pt-6 pb-10" style={{ background: "linear-gradient(160deg, #160f0c 0%, #24150f 55%, #3a2415 100%)" }}>
      {/* Fruit-splash backdrop like the reference video: owned juice
          posters ring the frosted-glass card in the site palette
          (espresso / cream / gold), no blue, no copied video text. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <img src={posterPineapple} alt="" className="absolute -left-8 top-2 w-52 opacity-70 sm:w-64" style={{ transform: "rotate(-10deg)", maskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)", WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)" }} />
        <img src={posterGrapes} alt="" className="absolute -right-10 top-10 w-48 opacity-70 sm:w-60" style={{ transform: "rotate(9deg)", maskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)", WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)" }} />
        <img src={posterMangoShake} alt="" className="absolute -bottom-6 left-1/2 w-60 -translate-x-1/2 opacity-60 sm:w-72" style={{ maskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)", WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 55%, transparent 100%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 65% 50% at 50% 42%, rgba(198,161,91,.28), transparent 70%), radial-gradient(ellipse 40% 32% at 88% 8%, rgba(245,235,221,.16), transparent 70%), linear-gradient(180deg, rgba(22,15,12,.25), rgba(22,15,12,.45))" }} />
      </div>
      <div className="relative mx-auto max-w-md">
        <div className="mx-auto p-5 text-center sm:p-7" style={{ background: "color-mix(in srgb, #f5ebdd 78%, transparent)", backdropFilter: "blur(20px) saturate(1.2)", WebkitBackdropFilter: "blur(20px) saturate(1.2)", border: "1px solid rgba(198,161,91,.7)", borderRadius: 20, boxShadow: "0 22px 48px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.35)", color: "#24150f" }}>
          <div className="logo-tile mx-auto" style={{ width: 96, height: 96 }}><img src={logoImg} alt="Café Reza official logo" /></div>
          <h1 className="serif mt-3 text-2xl font-bold">{mode === "login" ? tr(lang, "Log in to Café Reza", "ক্যাফে রেজা-এ লগইন করুন") : tr(lang, "Create your Café Reza account", "ক্যাফে রেজায় অ্যাকাউন্ট তৈরি করুন")}</h1>
          <p className="mt-1 text-sm" style={{ color: "#7a5c46" }}>{tr(lang, "Customer sign-in only. New accounts are always customers. Staff sign in separately in the admin panel.", "শুধু কাস্টমার সাইন-ইন। নতুন অ্যাকাউন্ট সবসময় কাস্টমার। স্টাফ অ্যাডমিন প্যানেলে আলাদাভাবে সাইন-ইন করেন।")}</p>
          <button type="button" disabled={gmailBusy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 font-semibold disabled:opacity-70" style={{ background: "#ffffff", color: "#24150f", border: "1px solid #dcc9ae", boxShadow: "0 4px 14px rgba(0,0,0,.12)" }} onClick={() => void onGmail()} aria-label="Login with Gmail"><GoogleG size={20} />{gmailBusy ? tr(lang, "Connecting…", "সংযোগ হচ্ছে…") : "Login with Gmail"}</button>
          <p className="mt-2 text-xs" style={{ color: "#7a5c46" }}>{tr(lang, "After signing in with Gmail, verify it with the Firebase verification email on your account page before you can order.", "Gmail দিয়ে সাইন-ইন করার পর অর্ডারের আগে আপনার অ্যাকাউন্ট পেজে Firebase যাচাই মেইল দিয়ে Gmail যাচাই করতে হবে।")}</p>
          {gmailNote && <p className="mt-2 text-sm" role="status" style={{ color: "#8b4a2f" }}>{gmailNote}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" className={`chip flex-1 ${mode === "login" ? "chip-on" : ""}`} onClick={() => setMode("login")}>{tr(lang, "Login", "লগইন")}</button>
            <button type="button" className={`chip flex-1 ${mode === "register" ? "chip-on" : ""}`} onClick={() => setMode("register")}>{tr(lang, "Register", "রেজিস্টার")}</button>
          </div>
          <form className="mt-4 space-y-3 text-left" onSubmit={submitAuth}>
            {mode !== "login" && <label className="block text-sm">{tr(lang, "Full name", "পুরো নাম")}<input aria-label="Full name" required value={name} onChange={(e) => setName(e.target.value)} /></label>}
            <label className="block text-sm">{tr(lang, "Email", "ইমেইল")}<input aria-label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {mode === "register" && <label className="block text-sm">{tr(lang, "Phone", "ফোন")}<input aria-label="Phone" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>}
            <label className="block text-sm">{tr(lang, "Password", "পাসওয়ার্ড")}<input aria-label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {mode === "register" && <p className="text-xs" style={{ color: "#7a5c46" }}>{tr(lang, "At least 4 characters. Firebase login needs at least 6 characters — please use 6 or more.", "কমপক্ষে ৪ অক্ষর। Firebase লগইনের জন্য কমপক্ষে ৬ অক্ষর লাগবে — ৬ বা তার বেশি ব্যবহার করুন।")}</p>}
            {err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
            <button className="btn-gold w-full" type="submit">{mode === "login" ? tr(lang, "Sign in", "সাইন-ইন করুন") : tr(lang, "Create account", "অ্যাকাউন্ট তৈরি করুন")}</button>
            <p className="text-center text-xs" style={{ color: "#7a5c46" }}>{tr(lang, "Passwords are stored hashed, never in plain text. Phone sign-in and password reset are not available on this page.", "পাসওয়ার্ড হ্যাশ করে রাখা হয়, কখনো সরল টেক্সটে নয়। ফোন সাইন-ইন ও পাসওয়ার্ড রিসেট এই পেজে নেই।")}</p>
          </form>
        </div>
      </div>
    </main>
  );
  const orders = meData?.orders ?? [];
  const loyaltyPer = settings?.loyaltyPerAmount ?? 100;
  const loyaltyNeed = settings?.loyaltyRedeemPoints ?? 100;
  const loyaltyValue = settings?.loyaltyRedeemValue ?? 20;
  return (
    <>
    {justLoggedIn && (
      <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(22,15,12,.72)", backdropFilter: "blur(6px)" }}>
        <div className="text-center">
          <svg className="login-success-badge mx-auto" width="110" height="110" viewBox="0 0 110 110" aria-hidden="true">
            <circle cx="55" cy="55" r="48" fill="none" stroke="#c6a15b" strokeWidth="4" />
            <path d="M35 56 L50 71 L77 40" fill="none" stroke="#4caf7d" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="serif mt-4 text-2xl font-bold" style={{ color: "#f5ebdd" }}>{tr(lang, "Login successful!", "লগইন সফল হয়েছে!")}</p>
        </div>
      </div>
    )}
    <main className="mx-auto max-w-3xl px-3 pt-4">
      <div id="account-overview" className="card flex items-center gap-3 p-4">
        <Logo size={56} />
        <div className="flex-1"><h1 className="serif text-xl font-bold">{tr(lang, "Welcome", "স্বাগতম")}, {user.name}</h1><p className="text-sm" style={{ color: "var(--dim)" }}>{user.email} • {user.phone} • {user.tier} member</p></div>
        <button className="btn-ghost" onClick={signOut}>Sign out</button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div className="card p-3"><b className="text-xl">{orders.length}</b><p className="text-xs">{tr(lang, "Total orders", "মোট অর্ডার")}</p></div>
        <div className="card p-3"><b className="text-xl">{orders.filter((o) => o.status === "Pending" || o.status === "Preparing").length}</b><p className="text-xs">{tr(lang, "In progress", "চলমান")}</p></div>
        <div className="card p-3"><b className="text-xl">{user.loyaltyPoints}</b><p className="text-xs">{tr(lang, "Loyalty points", "লয়্যালটি পয়েন্ট")}</p></div>
      </div>
      {user && !user.emailVerified && (
        <div className="card mt-3 p-4" style={{ border: "2px solid var(--accent)" }} aria-live="polite">
          <b>{tr(lang, "Email verification required", "ইমেইল যাচাইকরণ প্রয়োজন")}</b>
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, `Your Gmail (${user.email}) is not verified yet, so you cannot place orders until it is verified. Firebase will email you a verification link — no code to type.`, `আপনার Gmail (${user.email}) এখনো যাচাই হয়নি, তাই যাচাই না হওয়া পর্যন্ত অর্ডার করতে পারবেন না। Firebase যাচাই লিংকসহ মেইল পাঠাবে — কোনো কোড লিখতে হবে না।`)}</p>
          <label className="mt-2 block text-sm">{tr(lang, "Account password (only if you signed in with email + password)", "অ্যাকাউন্টের পাসওয়ার্ড (শুধু ইমেইল + পাসওয়ার্ডে সাইন-ইন করলে)")}<input aria-label="Account password for Firebase verification" type="password" autoComplete="current-password" value={fbPassword} onChange={(e) => setFbPassword(e.target.value)} placeholder="••••••••" /></label>
          <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "The password is used only for the Firebase sign-in, never sent to this site's server.", "পাসওয়ার্ডটি শুধু Firebase সাইন-ইনের জন্য ব্যবহৃত হয়, এই সাইটের সার্ভারে পাঠানো হয় না।")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-gold" disabled={fbBusy} onClick={() => void sendFirebaseMail()}>{tr(lang, "Send Firebase verification email", "Firebase যাচাই মেইল পাঠান")}</button>
            <button className="btn-ghost" disabled={fbBusy} onClick={() => void confirmFirebase()}>{tr(lang, "I clicked the link — finish verification", "লিংকে ক্লিক করেছি — যাচাই সম্পূর্ণ করুন")}</button>
          </div>
          {fbMsg && <p className="mt-2 text-sm" role="status">{fbMsg}</p>}
        </div>
      )}
      {user && user.emailVerified && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>✓ {tr(lang, "Email verified.", "ইমেইল যাচাই হয়েছে।")}</p>}
      {/* Privacy: customers can download their own data here. Account
          deletion and signing out every device are intentionally not
          offered on this page — a customer must not be able to delete
          their own account or touch another device's session from here. */}
      <div className="card mt-3 p-4">
        <b>{tr(lang, "Privacy & sessions", "প্রাইভেসি ও সেশন")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Download a copy of your own data — your profile, addresses, orders, messages and loyalty history.", "নিজের ডেটার একটি কপি ডাউনলোড করুন — আপনার প্রোফাইল, ঠিকানা, অর্ডার, মেসেজ ও লয়্যালটি ইতিহাস।")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => void exportData()}>{tr(lang, "Download my data", "আমার ডেটা ডাউনলোড করুন")}</button>
        </div>
        {privacyMsg && <p className="mt-2 text-sm" role="status">{privacyMsg}</p>}
      </div>
      <div className="card mt-3 p-4">
        <b>{tr(lang, "Loyalty rewards", "লয়্যালটি রিওয়ার্ড")}</b>
        <p className="text-sm" style={{ color: "var(--dim)" }}>1 point per {tk(loyaltyPer)} on delivered/completed orders. {loyaltyNeed} points redeems a one-time {tk(loyaltyValue)} coupon. Rates are set by the cafe in the admin panel.</p>
        <button className="btn-gold mt-2" disabled={user.loyaltyPoints < loyaltyNeed} onClick={async () => { const r = await api.redeemPoints({ token: token ?? "" }); if (r.ok) { setRedeemMsg(`Your coupon code: ${r.code}`); refreshAll(); } else setRedeemMsg(r.error ?? "Could not redeem."); }}>{tr(lang, "Redeem", "রিডিম করুন")} {loyaltyNeed} {tr(lang, "points", "পয়েন্ট")}</button>
        {redeemMsg && <p className="mt-2 text-sm">{redeemMsg}</p>}
        <div className="mt-3 space-y-1 text-xs">{(meData?.loyalty ?? []).map((l) => <p key={l.id}>{l.kind} {l.points > 0 ? "+" : ""}{l.points} — {l.note}</p>)}</div>
      </div>
      <h2 id="account-orders" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "My orders", "আমার অর্ডারগুলো")}</h2>
      {orders.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No orders yet.</p>}
      {orders.map((o) => (
        <div key={o.id} className="card mt-3 p-4">
          <div className="flex justify-between gap-2"><b>{o.orderNo}</b><span>{tk(o.total)}</span></div>
          <p className="text-sm" style={{ color: "var(--dim)" }}>{o.status} • {o.paymentMethod} • {o.paymentStatus} • {new Date(o.createdAt).toLocaleString("en-GB")}</p>
          <ul className="mt-1 space-y-1 text-sm">{o.items.map((it: OrderItem, i: number) => <li key={i}>{it.qty} × {it.name}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-gold" style={{ padding: "6px 12px" }} onClick={() => goTrack(o.orderNo)}>{tr(lang, "Track order", "অর্ডার ট্র্যাক করুন")}</button><button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={() => onMessage(o.orderNo)}>{tr(lang, "Message Cafe", "ক্যাফেকে মেসেজ করুন")}</button>
            {(o.status === "Pending" || o.status === "Confirmed") && <button className="btn-ghost" onClick={async () => { const r = await api.cancelOrder({ token: token ?? undefined, orderId: o.id }); if (r.ok) refreshAll(); else setNotice(r.error ?? "Cannot cancel."); }}>Cancel order</button>}
            <button className="btn-ghost" onClick={() => { o.items.forEach((it: OrderItem) => { const p = products.find((x) => x.id === it.productId); if (p) addToCart(p); }); setNotice("Previous items added to your cart (quantities reset to 1 each)."); }}>Reorder</button>
            <button className="btn-ghost" onClick={() => {
              const lines = [`Cafe Reza — Invoice ${o.orderNo}`, `Date: ${o.createdAt}`, `Customer: ${o.customerName} ${o.phone}`, `Status: ${o.status} | Payment: ${o.paymentMethod} (${o.paymentStatus})`, "", ...o.items.map((it: OrderItem) => `${it.qty} x ${it.name} @ ${tk(it.price)} = ${tk(it.price * it.qty)}`), "", `Subtotal ${tk(o.subtotal)}`, `Discount -${tk(o.discount)}`, `VAT ${tk(o.vat)}`, `Delivery ${tk(o.deliveryFee)}`, `TOTAL ${tk(o.total)}`, "", "Thank you for ordering at Cafe Reza."];
              const blob = new Blob([lines.join("\n")], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${o.orderNo}.txt`; a.click(); URL.revokeObjectURL(a.href);
            }}>Download invoice</button>
          </div>
        </div>
      ))}
      <h2 id="account-reservations" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "My reservations", "আমার রিজার্ভেশনগুলো")}</h2>
      {myReservations.length === 0 ? <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No table reservations under your phone yet. Book one from Table Booking — it stays listed here and on that page.</p> : myReservations.map((r) => (
        <div key={r.id} className="card mt-3 p-4">
          <div className="flex justify-between gap-2"><b>Reservation ID: {r.id}</b><span className="chip chip-on">{r.status}</span></div>
          <p className="mt-1 text-sm">Date <b>{r.date}</b> at <b>{r.time}</b> • {r.guests} guests • Table: <b>{r.tableLabel || "To be assigned"}</b></p>
          <button className="btn-ghost mt-2" onClick={goReserve}>View on reservations page</button>
        </div>
      ))}
      <h2 id="account-wishlist" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "Wishlist", "উইশলিস্ট")}</h2>
      <div className="mt-2 flex flex-wrap gap-2">{(meData?.wishlist ?? []).map((id) => { const p = products.find((x) => x.id === id); return p ? <button key={id} className="chip" onClick={() => addToCart(p)}>{nameOf(p)} — {tk(p.price)}</button> : null; })}{(meData?.wishlist ?? []).length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No favourites saved yet. Tap ♡ on a product.</p>}</div>
      <h2 id="account-addresses" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "Saved addresses", "সংরক্ষিত ঠিকানা")}</h2>
      <form className="card mt-2 space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveAddress({ token: token ?? "", ...addr }); setAddr({ label: "Home", address: "", area: "", phone: "" }); refreshAll(); }}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Label<input aria-label="Address label" value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} /></label>
          <label className="block text-sm">Phone<input aria-label="Address phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} /></label>
        </div>
        <label className="block text-sm">Address<input aria-label="Saved address" required value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></label>
        <label className="block text-sm">Area<input aria-label="Area" value={addr.area} onChange={(e) => setAddr({ ...addr, area: e.target.value })} /></label>
        <button className="btn-gold" type="submit">Save address</button>
      </form>
      {(meData?.addresses ?? []).map((a) => <p key={a.id} className="mt-2 text-sm"><b>{a.label}:</b> {a.address}, {a.area} ({a.phone})</p>)}
      <h2 id="account-messages" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "Messages", "মেসেজ")}</h2>
      <div className="card mt-2 p-4"><ChatPanel token={token} userName={user.name} userPhone={user.phone} lang={lang} /></div>
      <h2 id="account-notifications" className="serif mt-5 scroll-mt-24 text-xl font-bold">{tr(lang, "Notifications", "নোটিফিকেশন")}</h2>
      {(meData?.notifications ?? []).map((n) => <div key={n.id} className="card mt-2 p-3"><b>{n.title}</b><p className="text-sm">{n.body}</p></div>)}
      {(meData?.notifications ?? []).length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No notifications yet.</p>}
    </main>
    </>
  );
}

type AdminRow = Record<string, any>;
function SecurityTab({ token, data, userRole, lang, refreshAll, setNotice, signOut }: { token: string; data: AdminRow; userRole: string; lang: Lang; refreshAll: () => void; setNotice: (s: string) => void; signOut: () => void }) {
  const [probe, setProbe] = useState<FirebaseProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [publishing, setPublishing] = useState(false);
  const auditLogs = (data.auditLogs ?? []) as Array<Record<string, any>>;
  const secEvents = (data.securityEvents ?? []) as Array<Record<string, any>>;
  const refunds = (data.refundRequests ?? []) as Array<Record<string, any>>;
  const canDecide = userRole === "admin" || userRole === "manager";
  const check = async () => { setProbing(true); const p = await probeFirebase(); setProbe(p); setProbing(false); };
  const publish = async () => {
    setPublishing(true); setPublishMsg("");
    const r = await mirrorCatalogToFirestore((data.products ?? []) as Array<Record<string, unknown>>, (data.settings ?? {}) as Record<string, unknown>);
    setPublishing(false);
    setPublishMsg(r.ok ? tr(lang, "Catalog snapshot published to Firestore.", "ক্যাটালগের স্ন্যাপশট Firestore-এ প্রকাশিত হয়েছে।") : (r.error ?? "Publish failed."));
    if (r.ok) refreshAll();
  };
  const decide = async (id: number, approve: boolean) => {
    const r = await api.decideRefund({ token, requestId: id, approve });
    if (!r.ok) { setNotice(r.error ?? "Could not decide this refund."); return; }
    setNotice(approve ? "Refund approved — order marked Refunded." : "Refund request rejected.");
    refreshAll();
  };
  const logoutAll = async () => { await api.logoutAll({ token }); localStorage.removeItem("cr_token"); signOut(); };
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <b>{tr(lang, "Firebase connection", "Firebase সংযোগ")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Live status is checked against Firebase, never assumed. Demo Mode data stays the source of truth until the owner deploys the strict rules and verifies the mirror.", "লাইভ অবস্থা Firebase-এর সাথে যাচাই করে দেখানো হয়, অনুমান করে নয়। কঠোর rules ডেপ্লয় করে মিরর যাচাই না করা পর্যন্ত ডেমো মোডের ডেটাই আসল উৎস।")}</p>
        <p className="mt-2 text-sm">{tr(lang, "Config in this build:", "এই বিল্ডে কনফিগ:")} <b>{probe ? probe.configDetail : tr(lang, "not checked yet in this session — press “Check Firebase connection” below for the live status. Firebase config is loaded at runtime from the hosting environment; no key is baked into this build.", "এই সেশনে এখনো যাচাই হয়নি — লাইভ অবস্থার জন্য নিচের “Firebase সংযোগ যাচাই করুন” বোতামে চাপুন। Firebase কনফিগ রানটাইমে হোস্টিং এনভায়রনমেন্ট থেকে আনা হয়; এই বিল্ডে কোনো key বসানো নেই।")}</b> • {tr(lang, "Project:", "প্রজেক্ট:")} cafe-reza</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-gold" disabled={probing} onClick={() => void check()}>{probing ? tr(lang, "Checking…", "যাচাই হচ্ছে…") : tr(lang, "Check Firebase connection", "Firebase সংযোগ যাচাই করুন")}</button>
          <button className="btn-ghost" disabled={publishing} onClick={() => void publish()}>{publishing ? tr(lang, "Publishing…", "প্রকাশ হচ্ছে…") : tr(lang, "Publish catalog snapshot to Firestore", "ক্যাটালগের স্ন্যাপশট Firestore-এ প্রকাশ করুন")}</button>
        </div>
        {probe && (
          <div className="mt-3 space-y-1 text-sm">
            <p>{tr(lang, "Config:", "কনফিগ:")} {probe.configDetail}</p>
            <p>{tr(lang, "App:", "অ্যাপ:")} {probe.appReady ? tr(lang, "started", "চালু হয়েছে") : `${tr(lang, "not started", "চালু হয়নি")} — ${probe.appError}`}</p>
            <p>{tr(lang, "App Check:", "App Check:")} {probe.appCheck}</p>
            <p>{tr(lang, "Firestore:", "Firestore:")} {probe.firestore} — {probe.firestoreDetail}</p>
            <p>{tr(lang, "Firebase user:", "Firebase ব্যবহারকারী:")} {probe.firebaseUser || tr(lang, "none (sign in with Google first)", "কেউ নেই (আগে Google দিয়ে সাইন-ইন করুন)")}</p>
          </div>
        )}
        {publishMsg && <p className="mt-2 text-sm" role="status">{publishMsg}</p>}
        <p className="mt-3 text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "To go live: deploy the rules with `firebase deploy --only firestore:rules,storage`, add this domain to Authentication → Authorized domains, enable App Check enforcement, and set staff roles as custom claims (or /users/{uid} role fields). Full steps are in README → Going live on Firebase. Firestore rules were written but have NOT been tested against a live Firestore or emulator in this build.", "লাইভ করতে: `firebase deploy --only firestore:rules,storage` দিয়ে rules ডেপ্লয় করুন, এই ডোমেইনটি Authentication → Authorized domains-এ যোগ করুন, App Check enforcement চালু করুন, এবং স্টাফের রোল custom claims হিসেবে বসান। পুরো ধাপ README → Going live on Firebase-এ আছে। Firestore rules লেখা হয়েছে, কিন্তু এই বিল্ডে লাইভ Firestore বা এমুলেটরে পরীক্ষা করা হয়নি।")}</p>
      </div>

      <div className="card p-4">
        <b>{tr(lang, "Live launch — admin first, then customers", "লাইভ চালু — আগে অ্যাডমিন, তারপর কাস্টমার")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Launch order the owner asked for: (1) the admin panel goes live first and its link is shared first; (2) only then is the customer site published and its link shared. Both entries run on this same deployment — this artifact's own server actions and database — with separate logins and no shared panel. The links themselves are shared by the owner from this artifact; no link is hardcoded here. GitHub + Vercel (from the owner's video) is a separate, preview-only copy — see below.", "মালিক যেভাবে চেয়েছেন সেই ক্রম: (১) অ্যাডমিন প্যানেল আগে লাইভ হবে, আর তার লিংক আগে শেয়ার করা হবে; (২) তারপরই কাস্টমার সাইট প্রকাশ করে তার লিংক শেয়ার করা হবে। দুটি এন্ট্রিই এই একই ডেপ্লয়মেন্টে চলে — এই আর্টিফ্যাক্টের নিজের সার্ভার অ্যাকশন ও ডেটাবেসে — আলাদা লগইন, কোনো মেশানো প্যানেল নয়। লিংকগুলো মালিক এই আর্টিফ্যাক্ট থেকে শেয়ার করবেন; এখানে কোনো লিংক লেখা নেই। GitHub + Vercel (মালিকের ভিডিও থেকে) আলাদা, শুধু প্রিভিউয়ের কপি — নিচে দেখুন।")}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>{tr(lang, "Step 1 — Admin panel first: open the #/admin entry and sign in as staff (or create the owner account here when none exists). Check the dashboard, POS and settings, then share the admin link first.", "ধাপ ১ — আগে অ্যাডমিন প্যানেল: #/admin এন্ট্রি খুলে স্টাফ হিসেবে সাইন-ইন করুন (অ্যাকাউন্ট না থাকলে এখানেই মালিকের অ্যাকাউন্ট তৈরি করুন)। ড্যাশবোর্ড, POS ও সেটিংস দেখে নিয়ে অ্যাডমিন লিংকটি আগে শেয়ার করুন।")}</li>
          <li>{tr(lang, "Step 2 — Customer site next: open the #/ entry (shop + My Account) with a customer sign-in. Publish and share its link only after the admin link has been shared.", "ধাপ ২ — তারপর কাস্টমার সাইট: #/ এন্ট্রি (দোকান + My Account) কাস্টমার সাইন-ইন দিয়ে খুলুন। অ্যাডমিন লিংক শেয়ার করার পরই এর লিংক প্রকাশ/শেয়ার করুন।")}</li>
          <li>{tr(lang, "GitHub (preview copy only): new repository, upload the project files — never .env, app.db, or node_modules (the .gitignore file blocks them). A ready-made zip of the full files (cafe-reza-github.zip) was prepared on 3 Nov 2026; its contents and exclusions are listed in DEPLOY.md.", "GitHub (শুধু প্রিভিউয়ের কপি): নতুন রিপোজিটরি বানিয়ে প্রজেক্টের ফাইল তুলুন — .env, app.db বা node_modules কখনোই নয় (.gitignore এগুলো আটকায়)। পুরো ফাইলের তৈরি zip (cafe-reza-github.zip) ৩ নভেম্বর ২০২৬-এ বানানো হয়েছে; ভেতরে কী আছে আর কী নেই, DEPLOY.md-এ লেখা আছে।")}</li>
          <li>{tr(lang, "Vercel (preview only): Add New Project → Import the repository → Deploy. Project settings: Framework Other, Build Command `bun run build:client && cp -r client/app/. client/dist/`, Output Directory `client/dist`. The copy step puts the two app manifests and icons into the deploy.", "Vercel (শুধু প্রিভিউ): Add New Project → রিপোজিটরি Import → Deploy। সেটিংস: Framework Other, Build Command `bun run build:client && cp -r client/app/. client/dist/`, Output Directory `client/dist`। কপি ধাপটি দুটি অ্যাপের manifest ও আইকন ডেপ্লয়ে বসায়।")}</li>
          <li>{tr(lang, "Vercel → Settings → Environment Variables (Production): set FIREBASE_API_KEY, FIREBASE_PROJECT_ID and FIREBASE_APP_ID from Firebase Console, then Redeploy. Then add the Vercel subdomain to Firebase Authentication → Authorized domains.", "Vercel → Settings → Environment Variables (Production): Firebase Console থেকে FIREBASE_API_KEY, FIREBASE_PROJECT_ID ও FIREBASE_APP_ID বসান, তারপর Redeploy করুন। তারপর Vercel সাবডোমেইনটি Firebase Authentication → Authorized domains-এ যোগ করুন।")}</li>
          <li>{tr(lang, "Apps stay separate on hosting too: the customer app manifest opens #/ and the admin app manifest opens #/admin — two entries, two logins, no shared panel. Both are copied into the deploy by the build command in DEPLOY.md.", "হোস্টিংয়েও অ্যাপ দুটি আলাদাই থাকে: কাস্টমার অ্যাপের manifest #/ খোলে, অ্যাডমিন অ্যাপের manifest #/admin খোলে — দুটি এন্ট্রি, দুটি লগইন, কোনো মেশানো প্যানেল নয়। DEPLOY.md-এর বিল্ড কমান্ড দুটিকে ডেপ্লয়ে কপি করে।")}</li>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => downloadTextFile("cafe-reza-deploy-checklist.md", DEPLOY_CHECKLIST, "text/markdown")}>{tr(lang, "Download deployment checklist", "ডেপ্লয় চেকলিস্ট ডাউনলোড করুন")}</button>
        </div>
        <p className="mt-2 text-sm">{tr(lang, "Firebase config here:", "এখানে Firebase কনফিগ:")} <b>{probe ? probe.configDetail : tr(lang, "not checked yet — press “Check Firebase connection” above.", "এখনো যাচাই হয়নি — উপরের “Firebase সংযোগ যাচাই করুন” বোতামে চাপুন।")}</b></p>
        <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Important: a Vercel copy is only a preview. Orders, accounts, POS and admin data run on this artifact's own server actions and database, which Vercel does not run — the live shop stays here until the backend is moved to Cloud Functions + Firestore. No GitHub repository or Vercel deployment was created from this build: no repository/deploy credential was available to this builder, and the GitHub/Vercel accounts were created by the owner. The GitHub password still has to be set by the owner.", "জরুরি: Vercel-এর কপি শুধু প্রিভিউ। অর্ডার, অ্যাকাউন্ট, POS ও অ্যাডমিনের ডেটা এই আর্টিফ্যাক্টের নিজের সার্ভার অ্যাকশন ও ডেটাবেসে চলে, Vercel-এ সেগুলো চলে না — ব্যাকএন্ড Cloud Functions + Firestore-এ না সরানো পর্যন্ত লাইভ দোকান এখানেই থাকবে। এই বিল্ড থেকে কোনো GitHub রিপোজিটরি বা Vercel ডেপ্লয়মেন্ট বানানো হয়নি: এই বিল্ডারের কাছে রিপোজিটরি/ডেপ্লয়ের কোনো তথ্য ছিল না, GitHub/Vercel অ্যাকাউন্ট মালিকই বানিয়েছেন। GitHub-এর পাসওয়ার্ড মালিককেই বসাতে হবে।")}</p>
      </div>

      <InstallAppCard variant="admin" lang={lang} />

      <div className="card p-4">
        <b>{tr(lang, "Two-factor authentication (staff)", "টু-ফ্যাক্টর অথেনটিকেশন (স্টাফ)")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Not available yet. 2FA needs Firebase Auth multi-factor (TOTP/phone) enrollment plus a second-factor check in staff sign-in. Google sign-in alone is not 2FA. Remaining: enable MFA in the Firebase console, add an enrollment screen, and require the second factor before a staff session is issued.", "এখনো চালু হয়নি। 2FA-এর জন্য Firebase Auth মাল্টি-ফ্যাক্টর (TOTP/ফোন) এনরোলমেন্ট আর স্টাফ সাইন-ইনে দ্বিতীয় ধাপের যাচাই দরকার। শুধু Google সাইন-ইন 2FA নয়। বাকি: Firebase কনসোলে MFA চালু করা, এনরোলমেন্ট স্ক্রিন যোগ করা, আর স্টাফ সেশন দেওয়ার আগে দ্বিতীয় ধাপ বাধ্যতামূলক করা।")}</p>
        <button className="btn-ghost mt-3" onClick={() => void logoutAll()}>{tr(lang, "Sign out on all devices", "সব ডিভাইসে সাইন-আউট করুন")}</button>
        <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "Ends every session for this staff account, on every device.", "এই স্টাফ অ্যাকাউন্টের সব ডিভাইসের সব সেশন শেষ করে।")}</p>
      </div>

      <div className="card p-4">
        <b>{tr(lang, "Refund requests", "ফেরতের অনুরোধ")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "A cashier can never refund alone: staff request, and only an admin/manager who did not request it can approve. Approval marks the order Refunded.", "ক্যাশিয়ার একা কখনো ফেরত দিতে পারবে না: স্টাফ অনুরোধ করে, আর শুধু যে অনুরোধ করেনি এমন অ্যাডমিন/ম্যানেজার অনুমোদন দিতে পারে। অনুমোদনে অর্ডার Refunded হয়।")}</p>
        {refunds.filter((r) => r.status === "pending").length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No refund requests waiting.", "কোনো ফেরতের অনুরোধ অপেক্ষায় নেই।")}</p>}
        {refunds.filter((r) => r.status === "pending").map((r) => (
          <div key={r.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm" style={{ border: "1px solid var(--border)" }}>
            <div className="flex-1"><b>{r.orderNo}</b> — {tk(Number(r.amount))} • {tr(lang, "requested by", "অনুরোধ করেছেন")} {r.requestedByName} • {r.reason}</div>
            {canDecide
              ? <><button className="btn-gold" style={{ padding: "6px 12px" }} onClick={() => void decide(Number(r.id), true)}>{tr(lang, "Approve refund", "ফেরত অনুমোদন করুন")}</button><button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={() => void decide(Number(r.id), false)}>{tr(lang, "Reject", "প্রত্যাখ্যান করুন")}</button></>
              : <span className="text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "Admin/manager decision required.", "অ্যাডমিন/ম্যানেজারের সিদ্ধান্ত দরকার।")}</span>}
          </div>
        ))}
        {refunds.filter((r) => r.status !== "pending").slice(0, 5).map((r) => <p key={r.id} className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{r.orderNo} — {r.status} {tr(lang, "by", "কর্তৃক")} {r.decidedByName}</p>)}
      </div>

      <div className="card p-4">
        <b>{tr(lang, "Audit log — every admin change", "অডিট লগ — প্রতিটি অ্যাডমিন পরিবর্তন")}</b>
        {auditLogs.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No admin changes recorded yet.", "এখনো কোনো অ্যাডমিন পরিবর্তন রেকর্ড হয়নি।")}</p>}
        <ul className="mt-2 space-y-1 text-sm">{auditLogs.slice(0, 30).map((a) => <li key={a.id}>{new Date(a.createdAt).toLocaleString("en-GB")} • <b>{a.actorName}</b> — {a.action}{a.targetType ? ` (${a.targetType}${a.targetId ? ` #${a.targetId}` : ""})` : ""}{a.detail ? ` — ${a.detail}` : ""}</li>)}</ul>
      </div>

      <div className="card p-4">
        <b>{tr(lang, "Security events — sign-ins & alerts", "সিকিউরিটি ইভেন্ট — সাইন-ইন ও সতর্কতা")}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "Failed sign-ins are counted: 5 failures in 15 minutes locks that email out for 15 minutes. Every sign-in also notifies the account owner.", "ব্যর্থ সাইন-ইন গোনা হয়: ১৫ মিনিটে ৫ বার ব্যর্থ হলে ঐ ইমেইল ১৫ মিনিটের জন্য বন্ধ থাকে। প্রতিটি সাইন-ইনে অ্যাকাউন্টের মালিককে নোটিফিকেশন যায়।")}</p>
        {secEvents.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>{tr(lang, "No security events yet.", "এখনো কোনো সিকিউরিটি ইভেন্ট নেই।")}</p>}
        <ul className="mt-2 space-y-1 text-sm">{secEvents.slice(0, 30).map((e) => <li key={e.id} style={["login_blocked", "login_failed", "verification_failed"].includes(e.kind) ? { color: "var(--bad)" } : undefined}>{new Date(e.createdAt).toLocaleString("en-GB")} • {e.kind} • {e.email}{e.detail ? ` — ${e.detail}` : ""}</li>)}</ul>
      </div>
    </div>
  );
}
function AdminView({ token, user, data, loading, refreshAll, setNotice, store, tab, visibleTabs, lang, signOut }: { token: string | null; user: ApiResponse<typeof api, "me">["user"]; data: AdminRow | null | undefined; loading: boolean; refreshAll: () => void; setNotice: (s: string) => void; store: Store | undefined; tab: string; visibleTabs: Array<[string, string, string]>; lang: Lang; signOut: () => void }) {
  const [range, setRange] = useState<"today" | "7" | "30" | "all">("30");
  const stats = useQuery({ queryKey: ["stats", token, range], queryFn: () => api.dashboardStats({ token: token ?? "", range }), enabled: !!token && tab === "dashboard" });
  void visibleTabs;
  if (!user) return <p>Staff sign-in required.</p>;
  if (loading) return <p>Loading admin data…</p>;
  if (!data) return <p>Could not load admin data. Your session may have expired — sign in again from the admin panel.</p>;
  return (
    <main>
      <div className="flex items-center gap-3">
        <Logo size={52} />
        <div className="flex-1"><h1 className="serif text-2xl font-bold">Admin — {data.settings?.cafeName ?? "Café Reza"}</h1><p className="text-sm" style={{ color: "var(--dim)" }}>Signed in as {user.name} ({user.role}) • {navigator.onLine ? "Online" : "Offline — POS sales will queue"} • Demo Mode</p></div>
      </div>

      {tab === "dashboard" && (
        <div>
          <div className="mt-2 flex gap-2">{(["today", "7", "30", "all"] as const).map((r) => <button key={r} className={`chip ${range === r ? "chip-on" : ""}`} onClick={() => setRange(r)}>{r === "today" ? "Today" : r === "all" ? "All time" : `Last ${r} days`}</button>)}</div>
          {stats.data ? (
            <div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[["Revenue (range)", tk(stats.data.revenue)], ["Today's revenue", tk(stats.data.todayRevenue)], ["Orders", String(stats.data.orderCount)], ["Pending", String(stats.data.pending)], ["Completed", String(stats.data.completed)], ["Cancelled", String(stats.data.cancelled)], ["Customers", String(stats.data.customers)], ["Products", String(stats.data.products)], ["Low stock alerts", String(stats.data.lowStock)], ["Active reservations", String(stats.data.activeReservations)], ["Expenses", tk(stats.data.expenses)], ["Estimated profit*", tk(stats.data.profitEstimate)]].map(([l, v]) => (
                  <div key={l} className="card p-4"><p className="text-xs" style={{ color: "var(--dim)" }}>{l}</p><b className="text-xl">{v}</b></div>
                ))}
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>* Estimated profit = revenue − recorded expenses − recorded product costs. Revenue is not profit. All figures are computed from stored records.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="card p-4"><b>Sales — last 7 days</b><div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={stats.data.daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis /><Tooltip /><Bar dataKey="total" fill="#C6A15B" /></BarChart></ResponsiveContainer></div></div>
                <div className="card p-4"><b>Revenue by payment method</b><div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={stats.data.paymentMix} dataKey="value" nameKey="name" outerRadius={80} label>{stats.data.paymentMix.map((_, i) => <Cell key={i} fill={["#C6A15B", "#8B4A2F", "#7FB069", "#5B7FA6", "#E07856"][i % 5]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
                {stats.data.paymentMix.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No orders in this range yet.</p>}</div>
              </div>
              <div className="card mt-3 p-4"><b>Top-selling products</b>{stats.data.topProducts.map((tp) => <p key={tp.name} className="mt-1 flex justify-between text-sm"><span>{tp.name}</span><span>{tp.qty} sold • {tk(tp.total)}</span></p>)}{stats.data.topProducts.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No sales yet.</p>}</div>
              <div className="card mt-3 p-4"><b>Recent orders</b>{(data.orders as Order[]).slice(0, 6).map((o) => <p key={o.id} className="mt-1 flex justify-between text-sm"><span>{o.orderNo} — {o.customerName}</span><span>{o.status} • {tk(o.total)}</span></p>)}</div>
            </div>
          ) : <p className="mt-4">Loading figures…</p>}
        </div>
      )}

      {tab === "orders" && <OrdersTab token={token ?? ""} orders={data.orders as Order[]} refreshAll={refreshAll} setNotice={setNotice} userName={user.name} />}
      {tab === "pos" && <PosTab token={token ?? ""} products={data.products as Product[]} categories={data.categories} tables={data.tables} settings={data.settings} userName={user.name} refreshAll={refreshAll} setNotice={setNotice} shifts={data.shifts} />}
      {tab === "products" && <ProductsTab token={token ?? ""} products={data.products as AdminProduct[]} categories={data.categories} refreshAll={refreshAll} setNotice={setNotice} />}
      {tab === "inventory" && <InventoryTab token={token ?? ""} items={data.inventory} movements={data.movements} suppliers={data.suppliers} refreshAll={refreshAll} setNotice={setNotice} />}
      {tab === "tables" && <TablesTab token={token ?? ""} tables={data.tables} reservations={data.reservations} refreshAll={refreshAll} />}
      {tab === "coupons" && <CouponsTab token={token ?? ""} coupons={data.coupons} refreshAll={refreshAll} />}
      {tab === "loyalty" && <LoyaltyTab token={token ?? ""} settings={data.settings} loyaltyTx={data.loyaltyTx} refreshAll={refreshAll} setNotice={setNotice} />}
      {tab === "staff" && <StaffTab token={token ?? ""} users={data.users} refreshAll={refreshAll} setNotice={setNotice} lang={lang} />}
      {tab === "expenses" && <ExpensesTab token={token ?? ""} expenses={data.expenses} refreshAll={refreshAll} />}
      {tab === "reports" && <ReportsTab token={token ?? ""} orders={data.orders as Order[]} statsRange={range} />}
      {tab === "settings" && <SettingsTab token={token ?? ""} settings={data.settings} refreshAll={refreshAll} setNotice={setNotice} />}
      {tab === "content" && <ContentTab token={token ?? ""} settings={data.settings} refreshAll={refreshAll} setNotice={setNotice} />}
      {tab === "support" && <SupportTab token={token ?? ""} tickets={data.tickets} reviews={data.reviews} products={data.products as Product[]} refreshAll={refreshAll} />}
      {tab === "security" && <SecurityTab token={token ?? ""} data={data} userRole={user.role} lang={lang} refreshAll={refreshAll} setNotice={setNotice} signOut={signOut} />}
      <p className="hidden">{store?.products.length}</p>
    </main>
  );
}

function OrdersTab({ token, orders, refreshAll, setNotice, userName }: { token: string; orders: Order[]; refreshAll: () => void; setNotice: (s: string) => void; userName: string }) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("All");
  const [note, setNote] = useState("");
  const [sel, setSel] = useState<Order | null>(null);
  const [refundFor, setRefundFor] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const shown = orders.filter((o) => (statusF === "All" || o.status === statusF) && (!q || (o.orderNo + o.customerName + o.phone).toLowerCase().includes(q.toLowerCase())));
  const act = async (o: Order, status?: string, verify = false) => { const r = await api.updateOrderStatus({ token, orderId: o.id, status, note, verifyPayment: verify }); setNote(""); refreshAll(); setNotice(!r.ok ? (r.error ?? `Order ${o.orderNo} could not be updated.`) : verify ? "Payment marked Paid (manual verification)." : `Order ${o.orderNo} updated.`); };
  const submitRefund = async () => {
    if (!refundFor) return;
    const r = await api.requestRefund({ token, orderId: refundFor.id, reason: refundReason.trim() });
    if (!r.ok) { setNotice(r.error ?? "Refund request failed."); return; }
    setNotice(`Refund requested for ${refundFor.orderNo}. An admin/manager must approve it in Security → Refund requests.`);
    setRefundFor(null); setRefundReason(""); refreshAll();
  };
  return (
    <div>
      <b>Kitchen Display (KDS) — live order queue</b>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Kitchen staff see incoming orders here and advance them New → Preparing → Ready. The same status updates the customer&apos;s tracking page. Timers count from order time (Asia/Dhaka).</p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {(["New", "Preparing", "Ready"] as const).map((col) => {
          const colOrders = orders.filter((o) => col === "New" ? ["Pending", "Confirmed", "Accepted"].includes(o.status) : col === "Preparing" ? o.status === "Preparing" : o.status === "Ready");
          return (
            <div key={col} className="card p-3">
              <b>{col} ({colOrders.length})</b>
              {colOrders.map((o) => {
                const mins = Math.max(0, Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000));
                const next = col === "New" ? "Preparing" : col === "Preparing" ? "Ready" : o.orderType === "delivery" ? "Out for Delivery" : "Completed";
                return (
                  <div key={o.id} className="mt-2 rounded-xl p-2 text-sm" style={{ border: "1px solid var(--border)" }}>
                    <div className="flex justify-between"><b>{o.orderNo}</b><span>{mins} min</span></div>
                    <p style={{ color: "var(--dim)" }}>{o.customerName}{o.tableLabel ? ` • Table ${o.tableLabel}` : ""} • {o.orderType}</p>
                    <ul className="mt-1 space-y-0.5">{o.items.map((it: OrderItem, i: number) => <li key={i}>{it.qty} × {it.name}{it.note ? ` • ${it.note}` : ""}</li>)}</ul>
                    <button className="btn-gold mt-2 w-full" style={{ padding: "6px 10px" }} onClick={() => void act(o, next)}>Mark {next}</button>
                  </div>
                );
              })}
              {colOrders.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>None.</p>}
            </div>
          );
        })}
      </div>
      <b className="mt-4 block">All orders</b>
      <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Search orders" placeholder="Search order no, name, phone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select aria-label="Filter by status" value={statusF} onChange={(e) => setStatusF(e.target.value)} style={{ maxWidth: 180 }}>{["All", ...STATUSES].map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="mt-3 space-y-3">
        {shown.map((o) => (
          <div key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2"><Logo size={36} /><b>{o.orderNo}</b><span className="chip">{o.status}</span><span className="chip">{o.source}</span><span className="chip">{o.paymentMethod}: {o.paymentStatus}</span><b className="ml-auto">{tk(o.total)}</b></div>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{o.customerName} • {o.phone} • {o.orderType}{o.tableLabel ? ` • Table ${o.tableLabel}` : ""} • {new Date(o.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} • by {o.staffName || "—"}</p>
            <ul className="mt-1 space-y-1 text-sm">{o.items.map((it: OrderItem, i: number) => <li key={i}>{it.qty} × {it.name} ({it.size}) — {tk(it.price * it.qty)}{it.note ? ` • ${it.note}` : ""}</li>)}</ul>
            {o.notes && <p className="mt-1 text-sm">Notes: {o.notes}</p>}
            {o.paymentRef && <p className="mt-1 text-sm">Payment ref: {o.paymentRef}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <select aria-label={`Set status for ${o.orderNo}`} value={o.status} onChange={(e) => act(o, e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <input aria-label="Internal note" placeholder="Internal note…" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 220 }} />
              <button className="btn-ghost" onClick={() => act(o, undefined)}>Add note</button>
              {o.paymentStatus === "Pending verification" && <button className="btn-gold" onClick={() => act(o, undefined, true)}>Verify payment (manual)</button>}
              {o.paymentStatus === "Paid" && o.status !== "Refunded" && <button className="btn-ghost" onClick={() => { setRefundFor(o); setRefundReason(""); }}>Request refund (needs admin approval)</button>}
              <button className="btn-ghost" onClick={() => setSel(o)}>Receipt</button>
            </div>
            {refundFor?.id === o.id && (
              <div className="mt-3 rounded-xl p-3 text-sm" style={{ border: "1px solid var(--border)", background: "var(--surface2)" }}>
                <b>Refund request for {o.orderNo} ({tk(o.total)})</b>
                <p className="mt-1" style={{ color: "var(--dim)" }}>Nothing is refunded yet. An admin/manager who did not request it must approve in Security → Refund requests.</p>
                <label className="mt-2 block">Reason<input aria-label="Refund reason" required value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Why should this order be refunded?" /></label>
                <div className="mt-2 flex gap-2"><button className="btn-gold" disabled={refundReason.trim().length < 3} onClick={() => void submitRefund()}>Submit refund request</button><button className="btn-ghost" onClick={() => setRefundFor(null)}>Cancel</button></div>
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <p style={{ color: "var(--dim)" }}>No orders match.</p>}
      </div>
      {sel && <ReceiptModal order={sel} onClose={() => setSel(null)} cashier={userName} />}
    </div>
  );
}

function ReceiptModal({ order, onClose, cashier }: { order: Order; onClose: () => void; cashier: string }) {
  const download = () => {
    const lines = [`CAFE REZA`, `Receipt ${order.orderNo}`, `Date: ${new Date(order.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}`, `Cashier: ${cashier}`, `Customer: ${order.customerName} ${order.phone}`, "", ...order.items.map((it: OrderItem) => `${it.qty} x ${it.name} @ ${tk(it.price)} = ${tk(it.price * it.qty)}`), "", `Subtotal ${tk(order.subtotal)}`, `Discount -${tk(order.discount)}`, `VAT ${tk(order.vat)}`, `Delivery ${tk(order.deliveryFee)}`, `TOTAL ${tk(order.total)}`, `Paid ${tk(order.paidAmount)}`, `Change ${tk(order.changeAmount)}`, `Payment: ${order.paymentMethod} (${order.paymentStatus})`, "", "Thank you for visiting Cafe Reza!"];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `receipt-${order.orderNo}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Receipt">
      <div className="mx-auto my-6 max-w-sm p-5" style={{ background: "#F5EBDD", color: "#24150F", borderRadius: 12 }}>
        <div className="logo-tile mx-auto" style={{ width: 84, height: 84 }}><img src={logoImg} alt="Café Reza official logo" /></div>
        <h2 className="serif mt-2 text-center text-xl font-bold">CAFÉ REZA</h2>
        <p className="text-center text-xs">Receipt {order.orderNo} • {new Date(order.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</p>
        <p className="text-center text-xs">Cashier: {cashier} • Customer: {order.customerName}</p>
        <hr className="my-3" />
        {order.items.map((it: OrderItem, i: number) => <p key={i} className="flex justify-between text-sm"><span>{it.qty} × {it.name}</span><span>{tk(it.price * it.qty)}</span></p>)}
        <hr className="my-3" />
        <p className="flex justify-between text-sm"><span>Subtotal</span><span>{tk(order.subtotal)}</span></p>
        <p className="flex justify-between text-sm"><span>Discount</span><span>-{tk(order.discount)}</span></p>
        <p className="flex justify-between text-sm"><span>VAT</span><span>{tk(order.vat)}</span></p>
        <p className="flex justify-between text-sm"><span>Delivery</span><span>{tk(order.deliveryFee)}</span></p>
        <p className="flex justify-between font-bold"><span>Total</span><span>{tk(order.total)}</span></p>
        <p className="flex justify-between text-sm"><span>Paid / Change</span><span>{tk(order.paidAmount)} / {tk(order.changeAmount)}</span></p>
        <p className="flex justify-between text-sm"><span>Payment</span><span>{order.paymentMethod} ({order.paymentStatus})</span></p>
        <p className="mt-3 text-center text-sm">Thank you for visiting Café Reza!</p>
        <div className="mt-4 flex gap-2 no-print"><button className="btn-gold flex-1" onClick={download}>Download receipt</button><button className="btn-ghost flex-1" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function PosTab({ token, products, categories, tables, settings, userName, refreshAll, setNotice, shifts }: { token: string; products: Product[]; categories: Array<{ id: number; nameEn: string; nameBn: string }>; tables: Array<{ id: number; label: string; capacity: number; status: string }>; settings: AdminRow; userName: string; refreshAll: () => void; setNotice: (s: string) => void; shifts: Array<{ id: number; cashier: string; openingCash: number; closingCash: number | null; status: string }> }) {
  const [pcat, setPcat] = useState(0);
  const [pq, setPq] = useState("");
  const [pos, setPos] = useState<Array<{ productId: number; qty: number }>>([]);
  const [ptype, setPtype] = useState<"takeaway" | "dine-in" | "delivery">("takeaway");
  const [tableLabel, setTableLabel] = useState("");
  const [pay, setPay] = useState("Cash");
  const [cash, setCash] = useState(0);
  const [coupon, setCoupon] = useState("");
  const [custName, setCustName] = useState("Walk-in");
  const [custPhone, setCustPhone] = useState("");
  const [last, setLast] = useState<Order | null>(null);
  const [opening, setOpening] = useState(0);
  const [closing, setClosing] = useState(0);
  const [queue, setQueue] = useState<Array<AdminRow>>(() => { try { return JSON.parse(localStorage.getItem("cr_offline_queue") ?? "[]"); } catch { return []; } });
  const openShift = shifts.find((s) => s.status === "Open");
  const subtotal = pos.reduce((a, c) => { const p = products.find((x) => x.id === c.productId); return a + (p ? (p.discountPrice ?? p.price) * c.qty : 0); }, 0);
  const vat = Math.round((subtotal * (settings?.vatPercent ?? 0)) / 100);
  const total = subtotal + vat;
  const change = Math.max(0, cash - total);
  const syncQueue = async () => {
    if (queue.length === 0) return;
    let done = 0;
    for (const q of queue) { const r = await api.placeOrder(q.payload); if (r.ok) done++; }
    const left = queue.slice(done);
    setQueue(left); localStorage.setItem("cr_offline_queue", JSON.stringify(left));
    setNotice(done > 0 ? `${done} queued sale(s) synced. ${left.length} still pending.` : "Sync failed — queued sales are still pending. No stock was deducted twice.");
    refreshAll();
  };
  const charge = async () => {
    if (pos.length === 0) return;
    const payload = { token, items: pos.map((c) => ({ productId: c.productId, qty: c.qty, size: "Regular", note: "" })), customerName: custName || "Walk-in", phone: custPhone, address: "", orderType: ptype, source: "pos" as const, paymentMethod: pay, paymentRef: "", couponCode: coupon, tableLabel, notes: "", staffName: userName, paidAmount: pay === "Cash" || pay === "Cash at Counter" ? cash : total, zone: "", lang: "en" as const };
    if (!navigator.onLine) {
      const entry = { id: `OFF-${Date.now()}`, payload, total, at: new Date().toISOString() };
      const next = [...queue, entry]; setQueue(next); localStorage.setItem("cr_offline_queue", JSON.stringify(next));
      setNotice("Offline — sale queued as PENDING SYNC. It is NOT server-confirmed and stock is not deducted yet.");
      setPos([]); setCash(0); return;
    }
    const r = await api.placeOrder(payload);
    if (!r.ok) { setNotice(r.error ?? "POS sale failed."); return; }
    const found = await api.trackOrder({ orderNo: r.orderNo ?? "", phone: "" });
    if (found.order) setLast(found.order as Order);
    setNotice(`POS sale ${r.orderNo} recorded. Payment: ${r.paymentStatus}.`);
    setPos([]); setCash(0); setCoupon(""); refreshAll();
  };
  const shown = products.filter((p) => (pcat === 0 || p.categoryId === pcat) && (!pq || p.nameEn.toLowerCase().includes(pq.toLowerCase())));
  return (
    <div>
      <div className="card mt-3 p-4">
        <div className="flex flex-wrap items-center gap-3"><Logo size={44} /><div className="flex-1"><b>POS — {settings?.cafeName ?? "Café Reza"}</b><p className="text-sm" style={{ color: "var(--dim)" }}>Cashier: {userName} • {openShift ? `Shift open (opening ${tk(openShift.openingCash)})` : "No shift open"} • {navigator.onLine ? "Online" : "OFFLINE"} • Queued: {queue.length} pending sync</p></div>
          {!openShift ? <span className="flex items-center gap-2"><input aria-label="Opening cash" type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value))} style={{ maxWidth: 130 }} /><button className="btn-gold" onClick={async () => { const r = await api.openShift({ token, openingCash: opening }); if (r.ok) refreshAll(); else setNotice(r.error ?? "Shift failed."); }}>Open shift</button></span>
            : <span className="flex items-center gap-2"><input aria-label="Closing cash" type="number" value={closing} onChange={(e) => setClosing(Number(e.target.value))} style={{ maxWidth: 130 }} /><button className="btn-gold" onClick={async () => { const r = await api.closeShift({ token, closingCash: closing }); setNotice(`Shift closed. Expected ${tk(r.expected)}, difference ${tk(r.difference)}.`); refreshAll(); }}>Close shift</button></span>}
        </div>
        {queue.length > 0 && <div className="mt-3"><p className="text-sm font-semibold">Pending sync (never server-confirmed yet):</p>{queue.map((q) => <p key={q.id} className="text-sm">{q.id} — {tk(q.total)} — {q.at}</p>)}<button className="btn-gold mt-2" onClick={syncQueue} disabled={!navigator.onLine}>Sync now</button></div>}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <input aria-label="Search POS products" placeholder="Search products or scan barcode…" value={pq} onChange={(e) => setPq(e.target.value)} />
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1"><button className={`chip ${pcat === 0 ? "chip-on" : ""}`} onClick={() => setPcat(0)}>All</button>{categories.map((c) => <button key={c.id} className={`chip ${pcat === c.id ? "chip-on" : ""}`} onClick={() => setPcat(c.id)}>{c.nameEn}</button>)}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {shown.map((p) => (
              <button key={p.id} className="card overflow-hidden text-left" disabled={!p.available || p.price <= 0} onClick={() => setPos((prev) => { const ex = prev.find((x) => x.productId === p.id); return ex ? prev.map((x) => x.productId === p.id ? { ...x, qty: x.qty + 1 } : x) : [...prev, { productId: p.id, qty: 1 }]; })}>
                <ProdImg p={p} h={110} />
                <div className="p-2"><b className="block text-sm leading-tight">{p.nameEn}</b><span className="text-sm">{p.available && p.price > 0 ? tk(p.discountPrice ?? p.price) : "Price to be set"}</span></div>
              </button>
            ))}
          </div>
        </div>
        <div className="card h-fit p-4 lg:col-span-2">
          <b>Current sale</b>
          <label className="mt-2 block text-sm">Customer name<input aria-label="POS customer name" value={custName} onChange={(e) => setCustName(e.target.value)} /></label>
          <label className="mt-2 block text-sm">Customer phone<input aria-label="POS customer phone" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} /></label>
          <label className="mt-2 block text-sm">Type<select aria-label="POS order type" value={ptype} onChange={(e) => setPtype(e.target.value as typeof ptype)}><option value="takeaway">Takeaway</option><option value="dine-in">Dine-in</option><option value="delivery">Delivery</option></select></label>
          {ptype === "dine-in" && <label className="mt-2 block text-sm">Table<select aria-label="POS table" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)}><option value="">Select table</option>{tables.map((tb) => <option key={tb.id} value={tb.label}>{tb.label} ({tb.capacity} seats — {tb.status})</option>)}</select></label>}
          <div className="mt-3 space-y-2">
            {pos.map((c) => { const p = products.find((x) => x.id === c.productId); return p ? (
              <div key={c.productId} className="flex items-center gap-2 text-sm"><span className="flex-1">{p.nameEn}</span>
                <button className="chip" aria-label={`Decrease ${p.nameEn}`} onClick={() => setPos(pos.map((x) => x.productId === c.productId ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button><b>{c.qty}</b>
                <button className="chip" aria-label={`Increase ${p.nameEn}`} onClick={() => setPos(pos.map((x) => x.productId === c.productId ? { ...x, qty: x.qty + 1 } : x))}>+</button>
                <span>{tk((p.discountPrice ?? p.price) * c.qty)}</span>
                <button className="btn-ghost" style={{ padding: "4px 8px" }} aria-label={`Remove ${p.nameEn}`} onClick={() => setPos(pos.filter((x) => x.productId !== c.productId))}>✕</button></div>
            ) : null; })}
            {pos.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>Tap products to add them.</p>}
          </div>
          <div className="mt-3 space-y-1 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="flex justify-between"><span>Subtotal</span><span>{tk(subtotal)}</span></div>
            <div className="flex justify-between"><span>VAT ({settings?.vatPercent ?? 0}%)</span><span>{tk(vat)}</span></div>
            <div className="flex justify-between font-bold"><span>Total</span><span>{tk(total)}</span></div>
          </div>
          <label className="mt-3 block text-sm">Coupon<input aria-label="POS coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Optional" /></label>
          <label className="mt-2 block text-sm">Payment<select aria-label="POS payment method" value={pay} onChange={(e) => setPay(e.target.value)}>{parseEnabledPayments(settings?.paymentsJson).map((m) => <option key={m}>{m}</option>)}<option>Split</option></select></label>
          {(pay === "Cash" || pay === "Cash at Counter" || pay === "Split") && <label className="mt-2 block text-sm">Cash received<input aria-label="Cash received" type="number" value={cash} onChange={(e) => setCash(Number(e.target.value))} /></label>}
          {(pay === "Cash" || pay === "Cash at Counter" || pay === "Split") && <p className="mt-1 text-sm">Change: <b>{tk(change)}</b>{pay === "Split" && " — split payments: record the card/mobile part as a second note in Admin → Orders."}</p>}
          <button className="btn-gold mt-3 w-full" disabled={pos.length === 0} onClick={charge}>Charge {tk(total)}</button>
          <button className="btn-ghost mt-2 w-full" onClick={() => { setPos([]); setCash(0); }}>Clear sale</button>
          {last && <button className="btn-ghost mt-2 w-full" onClick={() => setLast(last)}>Reprint last receipt ({last.orderNo})</button>}
          <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>Receipts download as text files for thermal printers (58/80mm) — browser printing is handled by the device, not this page.</p>
        </div>
      </div>
      {last && <ReceiptModal order={last} onClose={() => setLast(null)} cashier={userName} />}
    </div>
  );
}

function ProductsTab({ token, products, categories, refreshAll, setNotice }: { token: string; products: AdminProduct[]; categories: Array<{ id: number; nameEn: string; nameBn: string; sortOrder?: number; active?: boolean }>; refreshAll: () => void; setNotice: (s: string) => void }) {
  const [f, setF] = useState({ id: undefined as number | undefined, nameEn: "", nameBn: "", description: "", categoryId: categories[0]?.id ?? 1, price: 0, discountPrice: "", costPrice: 0, stock: 100, available: true, featured: false, bestSeller: false, isNew: false, prepTime: 10, imageKey: "", imageKey2: "", ingredients: "" });
  const [catName, setCatName] = useState("");
  const [catEdit, setCatEdit] = useState({ id: 0, nameEn: "", nameBn: "", active: true });
  const sortedCats = [...categories].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  const sortedProducts = [...products].sort((a, b) => a.sortOrder - b.sortOrder);
  const moveProduct = async (p: AdminProduct, dir: -1 | 1) => {
    const idx = sortedProducts.findIndex((x) => x.id === p.id);
    const other = sortedProducts[idx + dir];
    if (!other) return;
    const payload = (x: AdminProduct, sortOrder: number) => ({ token, id: x.id, nameEn: x.nameEn, nameBn: x.nameBn, description: x.description, categoryId: x.categoryId, price: x.price, discountPrice: x.discountPrice, costPrice: x.costPrice, stock: x.stock, available: x.available, featured: x.featured, bestSeller: x.bestSeller, isNew: x.isNew, prepTime: x.prepTime, imageKey: x.imageKey, imageKey2: x.imageKey2, ingredients: x.ingredients, sortOrder });
    await api.saveProduct(payload(p, other.sortOrder));
    await api.saveProduct(payload(other, p.sortOrder));
    refreshAll();
  };
  const moveCategory = async (c: (typeof categories)[number], dir: -1 | 1) => {
    const idx = sortedCats.findIndex((x) => x.id === c.id);
    const other = sortedCats[idx + dir];
    if (!other) return;
    await api.saveCategory({ token, id: c.id, nameEn: c.nameEn, nameBn: c.nameBn, active: c.active !== false, sortOrder: other.sortOrder ?? 99 });
    await api.saveCategory({ token, id: other.id, nameEn: other.nameEn, nameBn: other.nameBn, active: other.active !== false, sortOrder: c.sortOrder ?? 99 });
    refreshAll();
  };
  const save = async (e: FormEvent) => { e.preventDefault(); await api.saveProduct({ token, id: f.id, nameEn: f.nameEn, nameBn: f.nameBn, description: f.description, categoryId: f.categoryId, price: f.price, discountPrice: f.discountPrice === "" ? null : Number(f.discountPrice), costPrice: f.costPrice, stock: f.stock, available: f.available, featured: f.featured, bestSeller: f.bestSeller, isNew: f.isNew, prepTime: f.prepTime, imageKey: f.imageKey || null, imageKey2: f.imageKey2 || null, ingredients: f.ingredients }); setNotice("Product saved."); setF({ id: undefined, nameEn: "", nameBn: "", description: "", categoryId: categories[0]?.id ?? 1, price: 0, discountPrice: "", costPrice: 0, stock: 100, available: true, featured: false, bestSeller: false, isNew: false, prepTime: 10, imageKey: "", imageKey2: "", ingredients: "" }); refreshAll(); };
  const IMAGE_OPTS = ["", "hero", "poster-hot-coffee", "poster-choco", "poster-caramel", "poster-special-cold", "poster-faluda", "poster-faluda-red", "poster-oreo", "poster-kitkat", "poster-strawberry", "poster-pineapple", "poster-lacchi", "poster-coconut", "poster-blue", "poster-crusher", "poster-grapes", "poster-grapes2", "poster-greenmango", "poster-litchi", "poster-dragon", "poster-orange", "poster-mango-shake", "poster-mango-smoothie", "poster-energy", "poster-energy-detail", "poster-doi-chira", "poster-momo", "poster-milk-tea", "poster-malai", "poster-cold-tea", "poster-lemonade-half", "poster-lemonade-full", "main-mixed-fruit-juice", "main-horlicks-tea", "main-edible-cup-tea", "tray", "tray2"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <form className="card space-y-3 p-4" onSubmit={save}>
          <b>{f.id ? "Edit product" : "Add product"}</b>
          <label className="block text-sm">Name (English)<input aria-label="Product name English" required value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></label>
          <label className="block text-sm">Name (Bengali)<input aria-label="Product name Bengali" value={f.nameBn} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></label>
          <label className="block text-sm">Description<textarea aria-label="Product description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Category<select aria-label="Product category" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></label>
            <label className="block text-sm">Photo 1 — product<select aria-label="Product photo" value={f.imageKey} onChange={(e) => setF({ ...f, imageKey: e.target.value })}>{IMAGE_OPTS.map((k) => <option key={k} value={k}>{k || "No photo"}</option>)}</select></label>
            <label className="block text-sm">Ingredients (comma-separated, shown as labels on the ingredients poster)<input aria-label="Ingredients" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} placeholder="Coffee, Milk, Ice" /></label>
            <label className="block text-sm">Price (৳)<input aria-label="Product price" type="number" min={0} required value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></label>
            <label className="block text-sm">Discount price (optional)<input aria-label="Discount price" type="number" min={0} value={f.discountPrice} onChange={(e) => setF({ ...f, discountPrice: e.target.value })} /></label>
            <label className="block text-sm">Cost price — admin only (৳)<input aria-label="Cost price" type="number" min={0} value={f.costPrice} onChange={(e) => setF({ ...f, costPrice: Number(e.target.value) })} /></label>
            <label className="block text-sm">Stock<input aria-label="Product stock" type="number" min={0} value={f.stock} onChange={(e) => setF({ ...f, stock: Number(e.target.value) })} /></label>
            <label className="block text-sm">Prep time (min)<input aria-label="Preparation time" type="number" min={1} value={f.prepTime} onChange={(e) => setF({ ...f, prepTime: Number(e.target.value) })} /></label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(["available", "featured", "bestSeller", "isNew"] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {k}</label>)}
          </div>
          <p className="text-xs" style={{ color: "var(--dim)" }}>To make a price-less testing item orderable: set its real price here and tick “available”. A price of 0 with “available” off keeps it hidden from ordering.</p>
          <button className="btn-gold w-full" type="submit">Save product</button>
        </form>
        <form className="card mt-3 space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); if (!catName.trim()) return; await api.saveCategory({ token, nameEn: catName, nameBn: catName, active: true }); setCatName(""); refreshAll(); }}>
          <b>Categories — order, visibility, rename, delete</b>
          <div className="flex gap-2"><input aria-label="New category name" placeholder="New category name…" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className="btn-gold" type="submit">Add category</button></div>
          {sortedCats.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={{ border: "1px solid var(--border)" }}>
              <b className="flex-1 text-sm">{c.nameEn} <span style={{ color: "var(--dim)" }}>({c.nameBn})</span></b>
              <span className="text-xs">{c.active === false ? "Hidden" : "Visible"}</span>
              <button type="button" className="btn-ghost" style={{ padding: "4px 8px" }} aria-label={`Move ${c.nameEn} up`} onClick={() => void moveCategory(c, -1)}>↑</button>
              <button type="button" className="btn-ghost" style={{ padding: "4px 8px" }} aria-label={`Move ${c.nameEn} down`} onClick={() => void moveCategory(c, 1)}>↓</button>
              <button type="button" className="btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setCatEdit({ id: c.id, nameEn: c.nameEn, nameBn: c.nameBn, active: c.active !== false })}>Edit</button>
              <button type="button" className="btn-ghost" style={{ padding: "4px 8px" }} onClick={async () => { await api.saveCategory({ token, id: c.id, nameEn: c.nameEn, nameBn: c.nameBn, active: !(c.active !== false) }); refreshAll(); }}>{c.active === false ? "Show" : "Hide"}</button>
              <button type="button" className="btn-ghost" style={{ padding: "4px 8px" }} onClick={async () => { if (confirm(`Delete category ${c.nameEn}?`)) { const r = await api.deleteCategory({ token, id: c.id }); if (!r.ok) setNotice(r.error ?? "Cannot delete."); refreshAll(); } }}>Delete</button>
            </div>
          ))}
          {catEdit.id > 0 && (
            <div className="flex flex-wrap gap-2">
              <input aria-label="Edit category English name" value={catEdit.nameEn} onChange={(e) => setCatEdit({ ...catEdit, nameEn: e.target.value })} />
              <input aria-label="Edit category Bengali name" value={catEdit.nameBn} onChange={(e) => setCatEdit({ ...catEdit, nameBn: e.target.value })} />
              <button type="button" className="btn-gold" onClick={async () => { await api.saveCategory({ token, id: catEdit.id, nameEn: catEdit.nameEn, nameBn: catEdit.nameBn, active: catEdit.active }); setCatEdit({ id: 0, nameEn: "", nameBn: "", active: true }); refreshAll(); }}>Save rename</button>
              <button type="button" className="btn-ghost" onClick={() => setCatEdit({ id: 0, nameEn: "", nameBn: "", active: true })}>Cancel</button>
            </div>
          )}
        </form>
      </div>
      <div className="space-y-2">
        {sortedProducts.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-3">
            <div className="w-14 flex-none overflow-hidden rounded-lg">{<ProdImg p={p} h={52} />}</div>
            <div className="flex-1"><b className="text-sm">{p.nameEn}</b><p className="text-xs" style={{ color: "var(--dim)" }}>{p.category} • {tk(p.price)} • Stock {p.stock} • {p.available ? "Available" : "Hidden"}</p></div>
            <button className="btn-ghost" style={{ padding: "6px 8px" }} aria-label={`Move ${p.nameEn} up`} onClick={() => void moveProduct(p, -1)}>↑</button>
            <button className="btn-ghost" style={{ padding: "6px 8px" }} aria-label={`Move ${p.nameEn} down`} onClick={() => void moveProduct(p, 1)}>↓</button>
            <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={() => setF({ id: p.id, nameEn: p.nameEn, nameBn: p.nameBn, description: p.description, categoryId: p.categoryId, price: p.price, discountPrice: p.discountPrice == null ? "" : String(p.discountPrice), costPrice: p.costPrice, stock: p.stock, available: p.available, featured: p.featured, bestSeller: p.bestSeller, isNew: p.isNew, prepTime: p.prepTime, imageKey: p.imageKey ?? "", imageKey2: p.imageKey2 ?? "", ingredients: p.ingredients ?? "" })}>Edit</button>
            <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={async () => { if (confirm("Delete this product?")) { await api.deleteProduct({ token, id: p.id }); refreshAll(); } }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InventoryTab({ token, items, movements, suppliers, refreshAll, setNotice }: { token: string; items: AdminRow[]; movements: AdminRow[]; suppliers: AdminRow[]; refreshAll: () => void; setNotice: (s: string) => void }) {
  const [f, setF] = useState({ name: "", category: "Coffee beans", unit: "kg", quantity: 0, lowAt: 1, costPerUnit: 0, expiry: "", supplier: "" });
  const [adj, setAdj] = useState({ itemId: 0, kind: "in", qty: 1, note: "" });
  const [sup, setSup] = useState({ name: "", phone: "", item: "", notes: "" });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <form className="card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveInventory({ token, ...f }); refreshAll(); }}>
          <b>Add / update ingredient</b>
          <label className="block text-sm">Name<input aria-label="Ingredient name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Category<select aria-label="Inventory category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["Coffee beans", "Milk", "Sugar", "Chocolate", "Syrups", "Flour", "Meat", "Vegetables", "Cheese", "Fruits", "Packaging", "Other ingredients"].map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="block text-sm">Unit<input aria-label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
            <label className="block text-sm">Quantity<input aria-label="Quantity" type="number" step="0.01" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
            <label className="block text-sm">Low-stock at<input aria-label="Low stock threshold" type="number" step="0.01" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: Number(e.target.value) })} /></label>
            <label className="block text-sm">Cost / unit (৳)<input aria-label="Cost per unit" type="number" value={f.costPerUnit} onChange={(e) => setF({ ...f, costPerUnit: Number(e.target.value) })} /></label>
            <label className="block text-sm">Expiry<input aria-label="Expiry date" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
          </div>
          <label className="block text-sm">Supplier<input aria-label="Supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></label>
          <button className="btn-gold w-full" type="submit">Save ingredient</button>
        </form>
        <form className="card mt-3 space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); if (!adj.itemId) return; await api.stockAdjust({ token, itemId: adj.itemId, kind: adj.kind, qty: adj.qty, note: adj.note }); refreshAll(); }}>
          <b>Stock movement (audited)</b>
          <label className="block text-sm">Item<select aria-label="Movement item" value={adj.itemId} onChange={(e) => setAdj({ ...adj, itemId: Number(e.target.value) })}><option value={0}>Select…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Kind<select aria-label="Movement kind" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}><option value="in">Stock in</option><option value="out">Stock out</option><option value="wastage">Wastage</option><option value="adjustment">Adjustment</option></select></label>
            <label className="block text-sm">Qty<input aria-label="Movement quantity" type="number" step="0.01" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: Number(e.target.value) })} /></label>
          </div>
          <label className="block text-sm">Note<input aria-label="Movement note" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></label>
          <button className="btn-gold w-full" type="submit">Record movement</button>
        </form>
      </div>
      <div>
        <b>Inventory & low-stock alerts</b>
        {items.map((it) => <div key={it.id} className="card mt-2 p-3"><div className="flex justify-between"><b>{it.name}</b><span>{it.quantity} {it.unit}</span></div><p className="text-xs" style={{ color: it.quantity <= it.lowAt ? "var(--bad)" : "var(--dim)" }}>{it.category} • Low at {it.lowAt} {it.unit}{it.quantity <= it.lowAt ? " — LOW STOCK" : ""} • Value {tk(Math.round(it.quantity * it.costPerUnit))}{it.expiry ? ` • Expires ${it.expiry}` : ""}</p></div>)}
        {items.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No ingredients yet. Add coffee beans, milk, sugar and the rest here.</p>}
        <b className="mt-4 block">Movement history</b>
        {movements.slice(0, 15).map((m) => <p key={m.id} className="mt-1 text-sm">{m.kind} {m.qty} — {m.note} <span style={{ color: "var(--dim)" }}>{new Date(m.createdAt).toLocaleString("en-GB")}</span></p>)}
        <b className="mt-4 block">Suppliers</b>
        {(suppliers ?? []).map((s) => <p key={s.id} className="mt-1 text-sm"><b>{s.name}</b> — {s.phone} • {s.item}{s.notes ? ` • ${s.notes}` : ""}</p>)}
        {(suppliers ?? []).length === 0 && <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>No suppliers yet.</p>}
        <form className="card mt-3 space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveSupplier({ token, ...sup }); setSup({ name: "", phone: "", item: "", notes: "" }); setNotice("Supplier saved."); refreshAll(); }}>
          <b>Add supplier</b>
          <label className="block text-sm">Name<input aria-label="Supplier name" required value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></label>
          <label className="block text-sm">Phone<input aria-label="Supplier phone" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></label>
          <label className="block text-sm">Supplies<input aria-label="Supplier item" value={sup.item} onChange={(e) => setSup({ ...sup, item: e.target.value })} /></label>
          <label className="block text-sm">Notes<input aria-label="Supplier notes" value={sup.notes} onChange={(e) => setSup({ ...sup, notes: e.target.value })} /></label>
          <button className="btn-gold w-full" type="submit">Save supplier</button>
        </form>
      </div>
    </div>
  );
}

function TablesTab({ token, tables, reservations, refreshAll }: { token: string; tables: AdminRow[]; reservations: AdminRow[]; refreshAll: () => void }) {
  const [newTable, setNewTable] = useState({ label: "", capacity: 4 });
  const activeFor = (label: string) => reservations.filter((r) => r.tableLabel === label && ["Pending", "Approved", "Confirmed", "Checked In"].includes(r.status));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <b>Table layout</b>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {tables.map((tb) => {
            const linked = activeFor(tb.label);
            return (
              <div key={tb.id} className="card p-4 text-center">
                <b className="serif text-xl">{tb.label}</b>
                <p className="text-sm">{tb.capacity} seats</p>
                <select aria-label={`Status for ${tb.label}`} value={tb.status} onChange={async (e) => { await api.saveTable({ token, id: tb.id, label: tb.label, capacity: tb.capacity, status: e.target.value, notes: tb.notes ?? "" }); refreshAll(); }}>
                  {["Available", "Occupied", "Reserved", "Cleaning"].map((s) => <option key={s}>{s}</option>)}
                </select>
                {linked.length > 0 ? linked.map((r) => <p key={r.id} className="mt-1 text-left text-xs"><b>#{r.id}</b> {r.name} • {r.date} {r.time} • {r.status}</p>) : <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>No active reservation</p>}
                <p className="mt-1 text-left text-xs" style={{ color: "var(--dim)" }}>Table route: #/table/{tb.label} — a printed QR code must encode the cafe&apos;s published site URL plus this route. No QR image is generated here because the published URL is not set in this build.</p>
                <button className="btn-ghost mt-2" style={{ padding: "4px 8px" }} onClick={async () => { if (confirm(`Delete table ${tb.label}?`)) { await api.deleteTable({ token, id: tb.id }); refreshAll(); } }}>Delete table</button>
              </div>
            );
          })}
        </div>
        <form className="card mt-3 flex flex-wrap items-end gap-2 p-4" onSubmit={async (e) => { e.preventDefault(); if (!newTable.label.trim()) return; await api.saveTable({ token, label: newTable.label.trim(), capacity: newTable.capacity, status: "Available", notes: "" }); setNewTable({ label: "", capacity: 4 }); refreshAll(); }}>
          <label className="block text-sm">New table label<input aria-label="New table label" required value={newTable.label} onChange={(e) => setNewTable({ ...newTable, label: e.target.value })} placeholder="T7" style={{ maxWidth: 110 }} /></label>
          <label className="block text-sm">Seats<input aria-label="New table seats" type="number" min={1} value={newTable.capacity} onChange={(e) => setNewTable({ ...newTable, capacity: Number(e.target.value) })} style={{ maxWidth: 90 }} /></label>
          <button className="btn-gold" type="submit">Add table</button>
        </form>
        <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>Assign a reservation to a table from the list, or link a POS dine-in order to a table in the POS screen. Confirming a reservation marks its table Reserved; checking in marks it Occupied.</p>
      </div>
      <div>
        <b>Reservations</b>
        {reservations.map((r) => (
          <div key={r.id} className="card mt-2 p-3">
            <div className="flex justify-between"><b>#{r.id} — {r.name}</b><span>{r.date} {r.time}</span></div>
            <p className="text-sm" style={{ color: "var(--dim)" }}>{r.guests} guests • {r.phone} {r.email} • {r.requests}</p>
            <div className="mt-2 flex gap-2">
              <select aria-label={`Reservation status for ${r.name}`} value={r.status} onChange={async (e) => { await api.updateReservation({ token, id: r.id, status: e.target.value, tableLabel: r.tableLabel ?? "" }); refreshAll(); }}>
                {["Pending", "Approved", "Rejected", "Confirmed", "Checked In", "Completed", "Cancelled", "No Show"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <input aria-label="Assign table" placeholder="Table (T1…)" defaultValue={r.tableLabel ?? ""} onBlur={async (e) => { if (e.target.value !== (r.tableLabel ?? "")) { await api.updateReservation({ token, id: r.id, status: r.status, tableLabel: e.target.value }); refreshAll(); } }} style={{ maxWidth: 120 }} />
            </div>
          </div>
        ))}
        {reservations.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No reservations yet.</p>}
      </div>
    </div>
  );
}

function CouponsTab({ token, coupons, refreshAll }: { token: string; coupons: AdminRow[]; refreshAll: () => void }) {
  const [f, setF] = useState({ code: "", kind: "percent", value: 10, minPurchase: 0, maxDiscount: "", usageLimit: "", active: true, expiresAt: "", description: "" });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card h-fit space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveCoupon({ token, code: f.code, kind: f.kind, value: f.value, minPurchase: f.minPurchase, maxDiscount: f.maxDiscount === "" ? null : Number(f.maxDiscount), usageLimit: f.usageLimit === "" ? null : Number(f.usageLimit), active: f.active, expiresAt: f.expiresAt, description: f.description }); refreshAll(); }}>
        <b>Create coupon</b>
        <label className="block text-sm">Code<input aria-label="Coupon code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Type<select aria-label="Coupon type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="percent">Percent %</option><option value="fixed">Fixed ৳</option><option value="freedelivery">Free delivery</option></select></label>
          <label className="block text-sm">Value<input aria-label="Coupon value" type="number" min={0} value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></label>
          <label className="block text-sm">Min. purchase (৳)<input aria-label="Minimum purchase" type="number" min={0} value={f.minPurchase} onChange={(e) => setF({ ...f, minPurchase: Number(e.target.value) })} /></label>
          <label className="block text-sm">Max discount (৳, optional)<input aria-label="Maximum discount" type="number" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} /></label>
          <label className="block text-sm">Usage limit (optional)<input aria-label="Usage limit" type="number" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} /></label>
          <label className="block text-sm">Expires<input aria-label="Coupon expiry" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
        </div>
        <label className="block text-sm">Description<input aria-label="Coupon description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <button className="btn-gold w-full" type="submit">Save coupon</button>
        <p className="text-xs" style={{ color: "var(--dim)" }}>Coupons are validated on the server at checkout, including expiry, minimum and usage limits.</p>
      </form>
      <div>{coupons.map((c) => <div key={c.id} className="card mt-2 flex items-center gap-3 p-3"><b className="flex-1">{c.code}</b><span className="text-sm">{c.kind} {c.value} • Used {c.usedCount}{c.usageLimit ? `/${c.usageLimit}` : ""}</span><button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={async () => { await api.saveCoupon({ token, id: c.id, code: c.code, kind: c.kind, value: c.value, minPurchase: c.minPurchase, maxDiscount: c.maxDiscount, usageLimit: c.usageLimit, active: !c.active, expiresAt: c.expiresAt ?? "", description: c.description }); refreshAll(); }}>{c.active ? "Disable" : "Enable"}</button></div>)}{coupons.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No coupons yet.</p>}</div>
    </div>
  );
}

// Fixed roles, owner instruction 3 Nov 2026: the owner email below is
// always the Super Admin; the customer email below is always an
// ordinary customer. The server enforces this on every path; the admin
// UI only reflects it (pinned rows cannot be re-roled or suspended).
const OWNER_EMAIL = "rezamdyeasin@gmail.com";
const CUSTOMER_EMAIL = "yeasinreza81@gmail.com";

function StaffTab({ token, users, refreshAll, setNotice, lang }: { token: string; users: AdminRow[]; refreshAll: () => void; setNotice: (s: string) => void; lang: Lang }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", role: "cashier" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const staff = users.filter((u) => u.role !== "customer");
  const customers = users.filter((u) => u.role === "customer");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card h-fit space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); if (f.password.length < 6) { setNotice(tr(lang, "Staff password must be at least 6 characters.", "স্টাফ পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।")); return; } const r = await api.saveStaff({ token, ...f }); if (r.ok) { setNotice("Staff account created."); setF({ name: "", email: "", phone: "", password: "", role: "cashier" }); refreshAll(); } else setNotice(r.error ?? "Failed."); }}>
        <b>Add staff member</b>
        <label className="block text-sm">Name<input aria-label="Staff name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block text-sm">Email<input aria-label="Staff email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block text-sm">Phone<input aria-label="Staff phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="block text-sm">Password<input aria-label="Staff password" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <p className="text-xs" style={{ color: "var(--dim)" }}>{tr(lang, "At least 6 characters.", "কমপক্ষে ৬ অক্ষর।")}</p>
        <label className="block text-sm">Role<select aria-label="Staff role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"].map((r) => <option key={r}>{r}</option>)}</select></label>
        <button className="btn-gold w-full" type="submit">Create staff account</button>
        <p className="text-xs" style={{ color: "var(--dim)" }}>Roles gate the admin tabs: kitchen sees Orders only, cashier sees Dashboard/Orders/POS, inventory sees Inventory/Products, admin & manager see everything.</p>
      </form>
      <div>
        <b>Staff ({staff.length})</b>
        {staff.map((u) => { const isOwner = String(u.email ?? "").toLowerCase() === OWNER_EMAIL; return <div key={u.id} className="card mt-2 flex flex-wrap items-center gap-2 p-3"><div className="flex-1"><b>{u.name}</b>{isOwner && <span className="chip chip-on ml-2">Owner / Super Admin</span>}<p className="text-xs" style={{ color: "var(--dim)" }}>{u.email} • {u.role} • {u.status}</p></div><select aria-label={`Role for ${u.name}`} disabled={isOwner} value={u.role} onChange={async (e) => { const r = await api.setUserRole({ token, id: u.id, role: e.target.value }); if (!r.ok) setNotice(r.error ?? "Role change failed."); refreshAll(); }} style={{ maxWidth: 150 }}>{["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"].map((r) => <option key={r}>{r}</option>)}</select><button className="btn-ghost" disabled={isOwner} style={{ padding: "6px 10px" }} onClick={async () => { const r = await api.toggleUser({ token, id: u.id, status: u.status === "active" ? "suspended" : "active" }); if (!r.ok) setNotice(r.error ?? "Could not change status."); refreshAll(); }}>{u.status === "active" ? "Suspend" : "Reactivate"}</button></div>; })}
        <b className="mt-4 block">Customers ({customers.length})</b>
        {customers.slice(0, 20).map((u) => <div key={u.id} className="mt-1 flex flex-wrap items-center gap-2 text-sm"><p className="flex-1">{u.name} — {u.email} • {u.loyaltyPoints} pts • {u.tier} • {u.status} • {u.emailVerified ? "✓ verified" : "unverified"}{String(u.email ?? "").toLowerCase() === CUSTOMER_EMAIL ? " • fixed customer role" : ""}</p><button className="btn-ghost" style={{ padding: "4px 10px", color: "var(--bad)" }} onClick={async () => { if (confirmDeleteId !== u.id) { setConfirmDeleteId(u.id); return; } const r = await api.adminDeleteUser({ token, id: u.id }); setConfirmDeleteId(null); if (!r.ok) setNotice(r.error ?? "Could not delete."); else setNotice(`Deleted ${u.email}. Past orders were anonymised.`); refreshAll(); }}>{confirmDeleteId === u.id ? "Tap again to delete" : "Delete"}</button></div>)}
      </div>
    </div>
  );
}

function ExpensesTab({ token, expenses, refreshAll }: { token: string; expenses: AdminRow[]; refreshAll: () => void }) {
  const [f, setF] = useState({ category: "Rent", description: "", amount: 0, date: new Date().toISOString().slice(0, 10) });
  const total = expenses.reduce((a, e) => a + e.amount, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card h-fit space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveExpense({ token, ...f }); refreshAll(); }}>
        <b>Record expense</b>
        <label className="block text-sm">Category<select aria-label="Expense category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["Rent", "Electricity", "Staff salaries", "Ingredients", "Packaging", "Maintenance", "Marketing", "Other"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="block text-sm">Description<input aria-label="Expense description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="block text-sm">Amount (৳)<input aria-label="Expense amount" type="number" min={0} required value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></label>
        <label className="block text-sm">Date<input aria-label="Expense date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <button className="btn-gold w-full" type="submit">Save expense</button>
      </form>
      <div><b>Total recorded expenses: {tk(total)}</b>{expenses.map((e) => <p key={e.id} className="mt-1 flex justify-between text-sm"><span>{e.date} — {e.category}: {e.description}</span><span>{tk(e.amount)}</span></p>)}{expenses.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No expenses recorded yet.</p>}</div>
    </div>
  );
}

function ReportsTab({ token, orders }: { token: string; orders: Order[]; statsRange: string }) {
  const pos = orders.filter((o) => o.source === "pos");
  const web = orders.filter((o) => o.source === "website");
  const sum = (arr: Order[]) => arr.filter((o) => o.status !== "Cancelled" && o.status !== "Refunded").reduce((a, o) => a + o.total, 0);
  const downloadCsv = async () => { const r = await api.exportOrdersCsv({ token }); const blob = new Blob([r.csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cafe-reza-orders.csv"; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <div className="card p-5">
      <b>Sales reports (from stored orders)</b>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["All sales", tk(sum(orders)), String(orders.length)], ["POS sales", tk(sum(pos)), `${pos.length} orders`], ["Online sales", tk(sum(web)), `${web.length} orders`], ["Refunded / cancelled", tk(orders.filter((o) => o.status === "Refunded").reduce((a, o) => a + o.total, 0)), `${orders.filter((o) => o.status === "Cancelled").length} cancelled`]].map(([l, v, s]) => <div key={l} className="rounded-xl p-3" style={{ background: "var(--surface2)" }}><p className="text-xs">{l}</p><b>{v}</b><p className="text-xs">{s}</p></div>)}
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>Gross sales, discounts, VAT and delivery are separate columns in the CSV. Expenses live in Admin → Expenses; estimated profit is on the Dashboard.</p>
      <button className="btn-gold mt-3" onClick={downloadCsv}>Download orders CSV (Excel-compatible)</button>
      <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>PDF invoices are downloaded per order from the customer Account screen and from order receipts in Admin.</p>
    </div>
  );
}

function SettingsTab({ token, settings, refreshAll, setNotice }: { token: string; settings: AdminRow; refreshAll: () => void; setNotice: (s: string) => void }) {
  const [f, setF] = useState<AdminRow>(settings);
  const [ads, setAds] = useState<AdSlot[]>(() => parseAds(settings.adsJson));
  const [zones, setZones] = useState<Zone[]>(() => parseZones(settings.zonesJson));
  const [zoneDraft, setZoneDraft] = useState({ area: "", fee: 40, minOrder: 0, active: true });
  const [hoursDays, setHoursDays] = useState<HoursDay[]>(() => { const parsed = parseHours(settings.hoursJson); return parsed.length ? parsed : defaultHoursRows(); });
  const [enabledPayments, setEnabledPayments] = useState<string[]>(() => parseEnabledPayments(settings.paymentsJson));
  const [loyalty, setLoyalty] = useState({ per: Number(settings.loyaltyPerAmount ?? 100), need: Number(settings.loyaltyRedeemPoints ?? 100), value: Number(settings.loyaltyRedeemValue ?? 20) });
  const saveExtras = async (patch: Record<string, unknown>, msg: string) => { await api.saveSettings({ token, ...settingsPayload(f as unknown as Record<string, unknown>, patch) }); setNotice(msg); refreshAll(); };
  const save = async (e: FormEvent) => { e.preventDefault(); await api.saveSettings({ token, cafeName: f.cafeName, tagline: f.tagline, address: f.address, phone: f.phone, email: f.email, facebook: f.facebook, hours: f.hours, vatPercent: Number(f.vatPercent), deliveryFee: Number(f.deliveryFee), freeDeliveryAt: Number(f.freeDeliveryAt), minOrder: Number(f.minOrder), demoMode: !!f.demoMode, bkashNumber: f.bkashNumber, nagadNumber: f.nagadNumber, rocketNumber: f.rocketNumber, paymentNote: f.paymentNote, adsJson: JSON.stringify(ads) }); setNotice("Settings saved."); refreshAll(); };
  const setAd = (id: AdSlotId, patch: Partial<AdSlot>) => setAds((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a));
  const field = (label: string, key: string, type = "text") => <label className="block text-sm">{label}<input aria-label={label} type={type} value={f[key] ?? ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></label>;
  return (
    <div>
      <div className="card flex items-center gap-3 p-4"><Logo size={56} /><div><b>Brand</b><p className="text-sm" style={{ color: "var(--dim)" }}>The official Cafe Reza logo is used as-is everywhere — header, footer, login, admin, POS and receipts. Do not replace it.</p></div></div>
      <form className="card mt-3 grid gap-3 p-4 md:grid-cols-2" onSubmit={save}>
        {field("Cafe name", "cafeName")}{field("Tagline", "tagline")}{field("Address", "address")}{field("Phone", "phone")}{field("Email", "email")}{field("Facebook URL", "facebook")}{field("Opening hours", "hours")}
        {field("VAT %", "vatPercent", "number")}{field("Delivery fee (৳)", "deliveryFee", "number")}{field("Free delivery over (৳)", "freeDeliveryAt", "number")}{field("Minimum order (৳)", "minOrder", "number")}
        {field("bKash number", "bkashNumber")}{field("Nagad number", "nagadNumber")}{field("Rocket number", "rocketNumber")}
        <label className="block text-sm md:col-span-2">Manual payment note<textarea aria-label="Manual payment note" rows={3} value={f.paymentNote ?? ""} onChange={(e) => setF({ ...f, paymentNote: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.demoMode} onChange={(e) => setF({ ...f, demoMode: e.target.checked })} /> Demo Mode (no real gateway connected)</label>
        <button className="btn-gold md:col-span-2" type="submit">Save settings</button>
      </form>
      <div className="card mt-3 grid gap-3 p-4 md:grid-cols-2">
        <b className="md:col-span-2">Opening hours — per day</b>
        {hoursDays.map((d, i) => (
          <div key={d.day} className="flex flex-wrap items-center gap-2 text-sm">
            <b className="w-24">{d.day}</b>
            <input aria-label={`${d.day} opening time`} type="time" value={d.open} disabled={d.closed} onChange={(e) => setHoursDays(hoursDays.map((x, j) => j === i ? { ...x, open: e.target.value } : x))} style={{ maxWidth: 120 }} />
            <span>–</span>
            <input aria-label={`${d.day} closing time`} type="time" value={d.close} disabled={d.closed} onChange={(e) => setHoursDays(hoursDays.map((x, j) => j === i ? { ...x, close: e.target.value } : x))} style={{ maxWidth: 120 }} />
            <label className="flex items-center gap-1"><input type="checkbox" checked={d.closed} onChange={(e) => setHoursDays(hoursDays.map((x, j) => j === i ? { ...x, closed: e.target.checked } : x))} /> Closed</label>
          </div>
        ))}
        <button className="btn-gold md:col-span-2" type="button" onClick={() => void saveExtras({ hoursJson: JSON.stringify(hoursDays) }, "Opening hours saved.")}>Save opening hours</button>
      </div>
      <div className="card mt-3 p-4">
        <b>Delivery zones — area, charge and minimum order</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Checkout shows these areas and the server charges the zone fee (free-delivery threshold still applies). No zones means the single delivery fee above applies everywhere.</p>
        {zones.map((z, i) => <p key={z.area} className="mt-2 flex flex-wrap items-center gap-2 text-sm"><b className="flex-1">{z.area}</b><span>{tk(z.fee)}{z.minOrder > 0 ? ` • min ${tk(z.minOrder)}` : ""} • {z.active ? "Active" : "Off"}</span><button className="btn-ghost" style={{ padding: "4px 8px" }} onClick={() => { const next = zones.filter((_, j) => j !== i); setZones(next); void saveExtras({ zonesJson: JSON.stringify(next) }, "Delivery zone removed."); }}>Remove</button></p>)}
        {zones.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No zones yet.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label="Zone area" placeholder="Area name…" value={zoneDraft.area} onChange={(e) => setZoneDraft({ ...zoneDraft, area: e.target.value })} style={{ maxWidth: 170 }} />
          <input aria-label="Zone delivery fee" type="number" min={0} value={zoneDraft.fee} onChange={(e) => setZoneDraft({ ...zoneDraft, fee: Number(e.target.value) })} style={{ maxWidth: 110 }} />
          <input aria-label="Zone minimum order" type="number" min={0} value={zoneDraft.minOrder} onChange={(e) => setZoneDraft({ ...zoneDraft, minOrder: Number(e.target.value) })} style={{ maxWidth: 130 }} />
          <button className="btn-gold" type="button" onClick={() => { if (!zoneDraft.area.trim()) return; const next = [...zones, { ...zoneDraft, area: zoneDraft.area.trim() }]; setZones(next); setZoneDraft({ area: "", fee: 40, minOrder: 0, active: true }); void saveExtras({ zonesJson: JSON.stringify(next) }, "Delivery zone saved."); }}>Add zone</button>
        </div>
      </div>
      <div className="card mt-3 p-4">
        <b>Payment methods — which ones customers and POS can use</b>
        <div className="mt-2 flex flex-wrap gap-3">{PAYMENTS.map((m) => <label key={m} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={enabledPayments.includes(m)} onChange={(e) => setEnabledPayments(e.target.checked ? [...enabledPayments, m] : enabledPayments.filter((x) => x !== m))} /> {m}</label>)}</div>
        <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Numbers for bKash / Nagad / Rocket are in the settings form above. Manual mobile payments always stay Pending verification until verified in Orders.</p>
        <button className="btn-gold mt-3" type="button" onClick={() => void saveExtras({ paymentsJson: JSON.stringify(enabledPayments) }, "Payment methods saved.")}>Save payment methods</button>
      </div>
      <div className="card mt-3 p-4">
        <b>Loyalty rates</b>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <label className="block text-sm">৳ per point<input aria-label="Taka per loyalty point" type="number" min={1} value={loyalty.per} onChange={(e) => setLoyalty({ ...loyalty, per: Number(e.target.value) })} /></label>
          <label className="block text-sm">Points to redeem<input aria-label="Points needed to redeem" type="number" min={1} value={loyalty.need} onChange={(e) => setLoyalty({ ...loyalty, need: Number(e.target.value) })} /></label>
          <label className="block text-sm">Coupon value (৳)<input aria-label="Loyalty coupon value" type="number" min={1} value={loyalty.value} onChange={(e) => setLoyalty({ ...loyalty, value: Number(e.target.value) })} /></label>
        </div>
        <button className="btn-gold mt-3" type="button" onClick={() => void saveExtras({ loyaltyPerAmount: loyalty.per, loyaltyRedeemPoints: loyalty.need, loyaltyRedeemValue: loyalty.value }, "Loyalty rates saved.")}>Save loyalty rates</button>
      </div>
      <div className="card mt-3 p-4">
        <b>Optional future ad placements — all OFF by default</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>No ads are shown now and no ad-network code is built into the app. Enable a slot only when you have an ad ready. Until then each slot shows the cafe's own promo content (a promo video or a poster banner), and an enabled ad replaces the promo in that slot. Allowed spots only: below the hero, between content sections, below the menu list, above the footer, and in the gallery/offers area. Never popups, interstitials, sticky or content-covering ads, never inside checkout, cart, POS, login or the admin panel, and never auto-playing or flashing ads — embed code runs sandboxed with autoplay disabled. An empty or disabled slot renders nothing and collapses with no blank gap. Save with the settings form above.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {AD_SLOT_DEFS.map((d) => { const a = ads.find((x) => x.id === d.id) ?? parseAds(null)[0]!; return (
            <div key={d.id} className="rounded-xl p-3" style={{ border: "1px solid var(--border)" }}>
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={a.enabled} onChange={(e) => setAd(d.id, { enabled: e.target.checked })} /> {d.label}</label>
              <p className="text-xs" style={{ color: "var(--dim)" }}>{d.hint}</p>
              <label className="mt-2 block text-sm">Type<select aria-label={`${d.label} ad type`} value={a.kind} onChange={(e) => setAd(d.id, { kind: e.target.value as AdSlot["kind"] })}><option value="image">Banner image + link</option><option value="code">Embed code (sandboxed)</option></select></label>
              {a.kind === "image" ? (
                <>
                  <label className="mt-2 block text-sm">Banner image URL<input aria-label={`${d.label} image URL`} placeholder="https://… or leave empty" value={a.imageUrl} onChange={(e) => setAd(d.id, { imageUrl: e.target.value })} /></label>
                  <label className="mt-2 block text-sm">Or upload a banner image<input aria-label={`${d.label} upload banner`} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setNotice("Banner image must be under 2 MB."); return; } const r = new FileReader(); r.onload = () => setAd(d.id, { imageUrl: String(r.result ?? "") }); r.readAsDataURL(file); }} /></label>
                  <label className="mt-2 block text-sm">Link URL (opens in a new tab)<input aria-label={`${d.label} link URL`} placeholder="https://…" value={a.linkUrl} onChange={(e) => setAd(d.id, { linkUrl: e.target.value })} /></label>
                </>
              ) : (
                <label className="mt-2 block text-sm">Embed code<textarea aria-label={`${d.label} embed code`} rows={3} placeholder="Paste the ad network embed code here…" value={a.code} onChange={(e) => setAd(d.id, { code: e.target.value })} /></label>
              )}
            </div>
          ); })}
        </div>
        <button className="btn-gold mt-3" type="button" onClick={async () => { await api.saveSettings({ token, cafeName: f.cafeName, tagline: f.tagline, address: f.address, phone: f.phone, email: f.email, facebook: f.facebook, hours: f.hours, vatPercent: Number(f.vatPercent), deliveryFee: Number(f.deliveryFee), freeDeliveryAt: Number(f.freeDeliveryAt), minOrder: Number(f.minOrder), demoMode: !!f.demoMode, bkashNumber: f.bkashNumber, nagadNumber: f.nagadNumber, rocketNumber: f.rocketNumber, paymentNote: f.paymentNote, adsJson: JSON.stringify(ads) }); setNotice("Ad placements saved."); refreshAll(); }}>Save ad placements</button>
      </div>
      <div className="card mt-3 p-4">
        <b>Firebase connection (cafe-reza) — config is loaded at runtime from the hosting environment; no key is baked into this build</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Serving domain: {APP_URL || "this domain (relative URLs — no domain is hardcoded)"}. Project cafe-reza exists; Firebase Auth — including verification email — runs only when the hosting environment provides the web config at runtime (FIREBASE_API_KEY, FIREBASE_PROJECT_ID and FIREBASE_APP_ID from Firebase Console → Project settings → Your apps → “Cafe Reza Web”). The previously exposed web API key must be rotated/restricted in the Console. Email/Password Auth is already enabled in the Firebase console, with the verification template from noreply@cafe-reza.firebaseapp.com. Firestore / Storage / Functions / Messaging / App Check / Hosting are still represented by this artifact's own secure server actions and database in Demo Mode until the strict rules are deployed and the mirror is verified; connect the gateway only after order, POS, stock, accounts and admin are verified — exactly as the owner directed. Nothing here claims a live Firebase data connection beyond what the Security probe above reports. See README.md for custom-domain and hosting steps.</p>
        <p className="mt-2 text-sm"><b>Flag for the owner:</b> Iced Mint Lemonade is now priced Half 60 TK / Full 120 TK. Testing items without prices (Blue Lagoon, Grapes Juice, Green Mango, Litchi, Dragon Fruit, Orange Juice, Mango Milkshake, Mango Smoothie, Blue Lagoon Mocktail/Crusher) stay unorderable until you set a price in Admin → Products.</p>
      </div>
    </div>
  );
}

function LoyaltyTab({ token, settings, loyaltyTx, refreshAll, setNotice }: { token: string; settings: AdminRow; loyaltyTx: AdminRow[]; refreshAll: () => void; setNotice: (s: string) => void }) {
  const [loyalty, setLoyalty] = useState({ per: Number(settings.loyaltyPerAmount ?? 100), need: Number(settings.loyaltyRedeemPoints ?? 100), value: Number(settings.loyaltyRedeemValue ?? 20) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card h-fit space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await api.saveSettings({ token, ...settingsPayload(settings as unknown as Record<string, unknown>, { loyaltyPerAmount: loyalty.per, loyaltyRedeemPoints: loyalty.need, loyaltyRedeemValue: loyalty.value }) }); setNotice("Loyalty rates saved."); refreshAll(); }}>
        <b>Loyalty program settings</b>
        <p className="text-sm" style={{ color: "var(--dim)" }}>Points are earned only by the server when an order is Delivered/Completed, and redeemed only through the ledger action in the customer panel. Customers can never edit their own balance.</p>
        <label className="block text-sm">Taka spent per point<input aria-label="Taka per loyalty point" type="number" min={1} value={loyalty.per} onChange={(e) => setLoyalty({ ...loyalty, per: Number(e.target.value) })} /></label>
        <label className="block text-sm">Points needed to redeem<input aria-label="Points needed to redeem" type="number" min={1} value={loyalty.need} onChange={(e) => setLoyalty({ ...loyalty, need: Number(e.target.value) })} /></label>
        <label className="block text-sm">Redemption coupon value (৳)<input aria-label="Loyalty coupon value" type="number" min={1} value={loyalty.value} onChange={(e) => setLoyalty({ ...loyalty, value: Number(e.target.value) })} /></label>
        <p className="text-sm" style={{ color: "var(--dim)" }}>Tiers are automatic: Bronze under 200, Silver 200+, Gold 500+, VIP 1000+ points.</p>
        <button className="btn-gold w-full" type="submit">Save loyalty settings</button>
      </form>
      <div>
        <b>Loyalty ledger ({loyaltyTx.length})</b>
        {loyaltyTx.map((l) => <p key={l.id} className="mt-1 text-sm">Customer #{l.userId} — {l.kind} {l.points > 0 ? "+" : ""}{l.points} — {l.note} <span style={{ color: "var(--dim)" }}>{new Date(l.createdAt).toLocaleString("en-GB")}</span></p>)}
        {loyaltyTx.length === 0 && <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>No loyalty transactions yet.</p>}
      </div>
    </div>
  );
}

function ContentTab({ token, settings, refreshAll, setNotice }: { token: string; settings: AdminRow; refreshAll: () => void; setNotice: (s: string) => void }) {
  const content = parseContent(settings.contentJson);
  const [announcement, setAnnouncement] = useState(content.announcement);
  const [aboutText, setAboutText] = useState(content.aboutText);
  const [showGallery, setShowGallery] = useState(content.showGallery);
  const [promoVideo, setPromoVideo] = useState(String(settings.promoVideo ?? "main"));
  const [customVideo, setCustomVideo] = useState(/^https?:\/\//i.test(String(settings.promoVideo ?? "")) ? String(settings.promoVideo) : "");
  const [banners, setBanners] = useState<string[]>(() => parseBannerSelection(settings.bannersJson));
  const [customBanner, setCustomBanner] = useState("");
  const save = async (patch: Record<string, unknown>, msg: string) => { await api.saveSettings({ token, ...settingsPayload(settings as unknown as Record<string, unknown>, patch) }); setNotice(msg); refreshAll(); };
  const bannerOptions = BANNER_SLIDES.map((b) => b.slug);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card h-fit space-y-3 p-4">
        <b>Homepage content</b>
        <label className="block text-sm">Announcement bar (empty = hidden)<input aria-label="Announcement text" value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder="e.g. Open today until 10pm" /></label>
        <label className="block text-sm">About text<textarea aria-label="About text" rows={4} value={aboutText} onChange={(e) => setAboutText(e.target.value)} placeholder="Leave empty for the default description" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showGallery} onChange={(e) => setShowGallery(e.target.checked)} /> Show gallery posters section</label>
        <button className="btn-gold w-full" type="button" onClick={() => void save({ contentJson: JSON.stringify({ announcement, aboutText, showGallery }) }, "Homepage content saved.")}>Save homepage content</button>
      </div>
      <div className="card h-fit space-y-3 p-4">
        <b>Hero video & banner carousel</b>
        <label className="block text-sm">Hero promo video<select aria-label="Hero promo video" value={promoVideo === customVideo && customVideo ? "custom" : promoVideo} onChange={(e) => setPromoVideo(e.target.value)}><option value="main">Promo video — main</option><option value="a">Promo video — A</option><option value="b">Promo video — B</option><option value="none">No video (photo only)</option><option value="custom">Custom video URL</option></select></label>
        {promoVideo === "custom" && <label className="block text-sm">Custom video URL<input aria-label="Custom hero video URL" placeholder="https://…" value={customVideo} onChange={(e) => setCustomVideo(e.target.value)} /></label>}
        <div>
          <b className="text-sm">Banner carousel — tick the posters to show (empty = all default posters)</b>
          <div className="mt-2 flex flex-wrap gap-2">{bannerOptions.map((slug) => <label key={slug} className="chip"><input type="checkbox" checked={banners.includes(slug)} onChange={(e) => setBanners(e.target.checked ? [...banners, slug] : banners.filter((b) => b !== slug))} /> {slug}</label>)}</div>
          <label className="mt-3 block text-sm">Custom banner image URL<input aria-label="Custom banner image URL" placeholder="https://… (added to the carousel)" value={customBanner} onChange={(e) => setCustomBanner(e.target.value)} /></label>
          <button className="btn-ghost mt-2" type="button" onClick={() => { if (/^https?:\/\//i.test(customBanner.trim())) { setBanners([...banners, customBanner.trim()]); setCustomBanner(""); } }}>Add custom banner</button>
          {banners.filter((b) => /^https?:\/\//i.test(b)).map((b) => <p key={b} className="mt-1 flex justify-between text-xs"><span className="truncate">{b}</span><button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => setBanners(banners.filter((x) => x !== b))}>Remove</button></p>)}
        </div>
        <button className="btn-gold w-full" type="button" onClick={() => void save({ promoVideo: promoVideo === "custom" ? customVideo : promoVideo, bannersJson: JSON.stringify(banners) }, "Video and banners saved.")}>Save video & banners</button>
        <p className="text-xs" style={{ color: "var(--dim)" }}>Banner images and links are unchanged by the slim-strip layout — the same posters open the same products. Ad slots live in Settings; enabled ads replace the promo in their slot.</p>
      </div>
    </div>
  );
}

function SupportTab({ token, tickets, reviews, products, refreshAll }: { token: string; tickets: AdminRow[]; reviews: AdminRow[]; products: Product[]; refreshAll: () => void }) {
  const [reply, setReply] = useState("");
  // Private-message inbox: staff only. Each conversation belongs to one
  // customer; unread counts count only that customer's unread messages.
  type Conv = { key: string; userId: number | null; name: string; phone: string; orderNo: string; lastBody: string; lastAt: string; unreadCustomer: number; count: number };
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [thread, setThread] = useState<ChatMsg[]>([]);
  const [staffDraft, setStaffDraft] = useState("");
  const loadConvs = async () => { try { const r = await api.listConversations({ token }); setConvs(r.conversations as Conv[]); } catch { /* inbox stays empty */ } };
  useEffect(() => { void loadConvs(); }, [token]);
  const openConv = async (c: Conv) => {
    setSelected(c);
    try {
      const r = await api.listConversationMessages({ token, userId: c.userId, guestPhone: c.userId ? "" : c.phone });
      setThread(r.messages as ChatMsg[]);
      await api.markMessagesRead({ token, phone: "", userId: c.userId, guestPhone: c.userId ? "" : c.phone, from: "customer" });
      void loadConvs();
    } catch { /* thread stays empty */ }
  };
  const unreadTotal = convs.reduce((a, c) => a + c.unreadCustomer, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <b>Private messages inbox {unreadTotal > 0 ? `(${unreadTotal} unread)` : ""}</b>
        <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Private chats with customers — visible only to staff here and to the customer themselves. Never shown publicly.</p>
        {convs.map((c) => (
          <button key={c.key} type="button" className="card mt-2 block w-full p-3 text-left" onClick={() => void openConv(c)} aria-label={`Open conversation with ${c.name}`}>
            <div className="flex justify-between gap-2"><b>{c.name}</b>{c.unreadCustomer > 0 && <span className="chip chip-on">{c.unreadCustomer} new</span>}</div>
            <p className="text-sm" style={{ color: "var(--dim)" }}>{c.phone}{c.orderNo ? ` • Order ${c.orderNo}` : ""} • {c.count} messages</p>
            <p className="mt-1 truncate text-sm">{c.lastBody}</p>
            <p className="text-xs" style={{ color: "var(--dim)" }}>{new Date(c.lastAt).toLocaleString("en-GB")}</p>
          </button>
        ))}
        {convs.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No private messages yet.</p>}
        {selected && (
          <div className="card mt-3 p-3">
            <b>Conversation with {selected.name}</b>
            <div className="mt-2 space-y-2" style={{ maxHeight: 300, overflowY: "auto" }}>
              {thread.map((m) => <p key={m.id} className="text-sm"><b>{m.author === "customer" ? selected.name : `Staff — ${m.authorName}`}:</b> {m.body} <span style={{ color: "var(--dim)" }}>({new Date(m.createdAt).toLocaleString("en-GB")})</span></p>)}
              {thread.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No messages in this conversation.</p>}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!staffDraft.trim()) return; await api.sendStaffReply({ token, userId: selected.userId, guestPhone: selected.userId ? "" : selected.phone, orderNo: selected.orderNo, body: staffDraft.trim() }); setStaffDraft(""); void openConv(selected); }}>
              <input aria-label="Reply to customer" required placeholder="Reply privately…" value={staffDraft} onChange={(e) => setStaffDraft(e.target.value)} />
              <button className="btn-gold" type="submit">Reply</button>
            </form>
          </div>
        )}
        <b className="mt-4 block">Support tickets</b>
        {tickets.map((tkx) => (
          <div key={tkx.id} className="card mt-2 p-3">
            <div className="flex justify-between"><b>{tkx.name}</b><span>{tkx.status} • {tkx.priority}</span></div>
            <p className="text-sm">{tkx.category} • {tkx.phone}</p><p className="mt-1 text-sm">{tkx.message}</p>
            {tkx.reply && <p className="mt-1 text-sm" style={{ color: "var(--accent)" }}>Reply: {tkx.reply}</p>}
            <div className="mt-2 flex gap-2">
              <input aria-label={`Reply to ticket ${tkx.id}`} placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <select aria-label={`Ticket status ${tkx.id}`} defaultValue={tkx.status} onChange={async (e) => { await api.updateTicket({ token, id: tkx.id, status: e.target.value, reply: reply || tkx.reply }); refreshAll(); }}>{["Open", "In Progress", "Resolved", "Closed"].map((s) => <option key={s}>{s}</option>)}</select>
              <button className="btn-ghost" onClick={async () => { await api.updateTicket({ token, id: tkx.id, status: tkx.status, reply }); setReply(""); refreshAll(); }}>Send</button>
            </div>
          </div>
        ))}
        {tickets.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No tickets yet.</p>}
      </div>
      <div>
        <b>Reviews (moderation)</b>
        {reviews.map((r) => <div key={r.id} className="card mt-2 flex items-center gap-2 p-3"><div className="flex-1"><b>{r.author}</b> {"★".repeat(r.rating)}<p className="text-sm">{r.comment}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{products.find((p) => p.id === r.productId)?.nameEn ?? ""} • {r.status}</p></div>
          <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={async () => { await api.updateReview({ token, id: r.id, status: "Approved" }); refreshAll(); }}>Approve</button>
          <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={async () => { await api.updateReview({ token, id: r.id, status: "Rejected" }); refreshAll(); }}>Reject</button></div>)}
        {reviews.length === 0 && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No reviews submitted yet.</p>}
        <b className="mt-4 block">Loyalty ledger</b>
        <p className="text-sm" style={{ color: "var(--dim)" }}>Points are only changed by server actions (earn on delivery, redeem in Account). See customer Account screens for per-customer ledgers.</p>
      </div>
    </div>
  );
}
