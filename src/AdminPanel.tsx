// Admin panel — the ONLY place the customer site is managed.
// It writes the same Firestore collections the storefront reads, so
// every edit here (product, price, category, banner, offer, order,
// reservation, setting, content) controls the user panel at once.
// The admin and customer panels are separate: separate route (#/admin),
// separate sign-in screen, and a customer account opening #/admin sees
// only the access-denied card below. Staff roles are read from the
// /users/{uid} document; only an admin writes catalog and settings.
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { getDb, probeFirestore, signOutUser } from "./firebase";
import { BANNER_SLIDES, CUSTOMER_EMAIL, OWNER_EMAIL, SEED_PRODUCTS } from "./seed";
import {
  AD_SLOT_DEFS, expenseFromDoc, isStaffRole, orderFromDoc, ORDER_STATUSES, parseAds, parseBannerSelection, parseContent,
  supplierFromDoc, tr, tsToIso, useLive, userFromDoc,
  type AuditLogEntry, type Category, type Coupon, type Expense, type Lang, type Order, type Product, type Reservation, type Settings, type Supplier, type UserDoc,
} from "./db";
import { cancelOrderTx, comboDiscount, COMBO_DISCOUNT_PER_LINE, COMBO_MIN_QTY, HAPPY_HOUR_END, HAPPY_HOUR_PERCENT, HAPPY_HOUR_START, happyHourDiscount, placeOrderTx, timeToMin } from "./orders";
import { InstallAppCard } from "./InstallAppCard";
import { DigitalAnalyzer } from "./DigitalAnalyzer";
import { ReceiptModal } from "./Receipt";
import { QrCode } from "./QrCode";
import { qrSvgString, tableQrUrl } from "./qr";
import { computePhoneStats, normalizePhone, phoneQueryVariants, trustColor, trustLabel, trustLevel, type PhoneStats } from "./phoneTrust";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;

// Table QR print: opens a small printable page with the table QR so
// staff can print it and stick it on the table. window.print() runs
// on load; the window stays open for the user to close. The label is
// escaped — it comes from Firestore and is printed as text, never HTML.
function printTableQr(label: string) {
  const url = tableQrUrl(label);
  const esc = label.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) return;
  const svg = qrSvgString(url, 260);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table ${esc} — Café Reza</title><style>body{font-family:sans-serif;text-align:center;padding:24px;color:#3B2314}h1{font-size:30px;margin:14px 0 4px}p{margin:6px 0}.url{font-size:13px;color:#6b4a2f;word-break:break-all}</style></head><body>${svg}<h1>Table ${esc}</h1><p>Scan to open the menu &amp; order</p><p>মেনু খুলে অর্ডার করতে স্ক্যান করুন</p><p class="url">${url}</p><p>Café Reza — ক্যাফে রেজা</p><script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

// Phone trust badge: the number's cancel rate from real orders, with
// the trust label from the admin's thresholds (Settings → risk*Pct).
// No badge at all when the number has no order history.
function PhoneTrustBadge({ stats, settings, lang }: { stats: PhoneStats | undefined; settings: Settings; lang: Lang }) {
  if (!stats || stats.total === 0) return null;
  const level = trustLevel(stats.cancelRate, settings.riskCautionPct ?? 25, settings.riskRiskyPct ?? 50);
  const color = trustColor(level);
  return (
    <span className="chip" style={{ border: `2px solid ${color}`, color, fontWeight: 700, padding: "2px 8px" }} title={tr(lang, `Orders: ${stats.total}, completed: ${stats.completed}, cancelled: ${stats.cancelled}, refunded: ${stats.refunded}`, `অর্ডার: ${stats.total}, সম্পন্ন: ${stats.completed}, বাতিল: ${stats.cancelled}, ফেরত: ${stats.refunded}`)}>
      {level === "risky" ? "⚠ " : ""}{trustLabel(level, lang)} • {tr(lang, "cancel", "বাতিল")} {Math.round(stats.cancelRate)}% ({stats.cancelled}/{stats.total})
    </span>
  );
}
const IMG_FILES = [...new Set([...SEED_PRODUCTS.map((p) => p.img), ...SEED_PRODUCTS.map((p) => p.img2), ...BANNER_SLIDES.map((b) => b.img), "hero.jpg", "logo.jpg", "tray.jpg", "tray2.jpg", "menu-photo.jpg"])].sort();
const STAFF_ROLES = ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"];
const PAYMENTS = ["Cash on Delivery", "Cash at Counter", "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer"];

// Super Admin = the owner account (role admin + pinned owner email).
// Only the owner sees money figures, role management, settings and the
// Owner panel. Other staff get the same panel design, but only the tabs
// their role allows — never financial data.
const isOwnerDoc = (u: UserDoc | null | undefined) => !!u && u.role === "admin" && (u.email || "").toLowerCase() === OWNER_EMAIL;
const dayKey = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const todayKey = () => dayKey(new Date().toISOString());
type Period = "today" | "7d" | "30d" | "all";
const inPeriod = (o: Order, period: Period) => {
  if (period === "all") return true;
  if (period === "today") return dayKey(o.createdAt) === todayKey();
  const days = period === "7d" ? 7 : 30;
  const t = new Date(o.createdAt).getTime();
  return !Number.isNaN(t) && t >= Date.now() - days * 86400000;
};
const LIVE_ORDER = (o: Order) => o.status !== "Cancelled" && o.status !== "Refunded";
const realized = (list: Order[]) => list.filter((o) => LIVE_ORDER(o) && (o.status === "Completed" || o.status === "Delivered")).reduce((a, o) => a + o.total, 0);

function audit(actor: UserDoc, action: string, detail: string) {
  const firestore = getDb();
  if (!firestore) return;
  void addDoc(collection(firestore, "auditLogs"), { actorId: actor.id, actorName: actor.name, action, targetType: "", targetId: null, detail: detail.slice(0, 500), createdAt: serverTimestamp() }).catch(() => undefined);
}

// Names follow the admin panel language, like the storefront:
// Bengali mode shows the Bengali name, English mode the English one.
// Order items only store the English name, so they are translated
// back through the current product list (fallback: stored name).
const displayName = (p: Product, lang: Lang) => (lang === "bn" && p.nameBn ? p.nameBn : p.nameEn);
const displayCategoryName = (c: Category, lang: Lang) => (lang === "bn" && c.nameBn ? c.nameBn : c.nameEn);
const itemName = (products: Product[], it: { productId: string; name: string }, lang: Lang) => {
  const p = products.find((x) => x.slug === it.productId);
  return p ? displayName(p, lang) : it.name;
};
// Dates are shown day-first (DD/MM/YYYY), never the US month-first order.
const fmtDate = (raw: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// A clock that ticks every `intervalMs` so time-sensitive UI (the
// kitchen waiting timer) updates without a reload.
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Waiting time since an order was placed, as mm:ss (or hh:mm:ss
// past an hour). Only live kitchen stages count — a finished,
// delivered or cancelled order has no waiting time.
const KITCHEN_ACTIVE = ["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery"];
function waitingText(createdAt: string, now: number): string {
  const created = Date.parse(createdAt);
  if (!created) return "";
  const secs = Math.max(0, Math.floor((now - created) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function OrdersTab({ userDoc, products, settings, lang }: { userDoc: UserDoc; products: Product[]; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const now = useNow(1000);
  const { data: orders } = useLive<Order>(() => (firestore ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(60)) : null), orderFromDoc);
  // Trust stats come from a wider recent window (200 orders) than the
  // 60 shown here, so a number's history is judged on more than the
  // few orders on screen. The lookup below reads the full history.
  const { data: statsOrders } = useLive<Order>(() => (firestore ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(200)) : null), orderFromDoc);
  const phoneStats = useMemo(() => computePhoneStats(statsOrders), [statsOrders]);
  const [note, setNote] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");
  const [lookupResult, setLookupResult] = useState<{ stats: PhoneStats; orders: Order[] } | null>(null);
  // Full history for one number: tries every stored form of the
  // number (+880…, 880…, 01…), then keeps only the orders whose
  // normalized number matches — all from real order documents.
  const lookupPhone = async () => {
    if (!firestore || !lookupInput.trim()) return;
    setLookupBusy(true); setLookupMsg(""); setLookupResult(null);
    try {
      const norm = normalizePhone(lookupInput.trim());
      const snap = await getDocs(query(collection(firestore, "orders"), where("phone", "in", phoneQueryVariants(lookupInput.trim()))));
      const found = snap.docs.map((d) => orderFromDoc(d.id, d.data())).filter((o) => normalizePhone(o.phone ?? "") === norm);
      if (found.length === 0) { setLookupMsg(tr(lang, "No orders found for this number.", "এই নম্বরে কোনো অর্ডার পাওয়া যায়নি।")); return; }
      const map = computePhoneStats(found);
      const stats = map.get(norm);
      if (!stats) { setLookupMsg(tr(lang, "No orders found for this number.", "এই নম্বরে কোনো অর্ডার পাওয়া যায়নি।")); return; }
      setLookupResult({ stats, orders: [...found].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    } catch (e) {
      setLookupMsg(e instanceof Error ? e.message : String(e));
    }
    setLookupBusy(false);
  };
  const setStatus = async (o: Order, status: string) => {
    if (!firestore || status === o.status) return;
    // Cancelling / refunding is destructive and was one accidental tap
    // away — confirm it first. The select is controlled by the live
    // order, so cancelling the dialog leaves the old status showing.
    if (status === "Cancelled" || status === "Refunded") {
      const ok = window.confirm(tr(lang, `Change ${o.orderNo} to ${status}? This cannot be undone from here.`, `${o.orderNo}-এর অবস্থা ${status === "Cancelled" ? "বাতিল" : "ফেরত"} করবেন? এটা এখান থেকে ফেরানো যাবে না।`));
      if (!ok) return;
    }
    // Cancelling goes through the same transaction as the customer
    // cancel button, so the items go back to stock — a plain status
    // write would leave the stock short, which is what the old code
    // did (the policy text already promised the stock back).
    if (status === "Cancelled") {
      const r = await cancelOrderTx({ uid: userDoc.id, orderId: o.id, cancelWindowMinutes: settings.cancelWindowMinutes ?? 2, isStaff: true });
      if (!r.ok) { setNote(r.error ?? tr(lang, "Could not cancel the order.", "অর্ডার বাতিল করা যায়নি।")); return; }
      audit(userDoc, "order.status", `${o.orderNo} → Cancelled (stock restored)`);
      setNote(tr(lang, `${o.orderNo} cancelled — the items are back in stock.`, `${o.orderNo} বাতিল হয়েছে — আইটেমগুলো স্টকে ফিরে গেছে।`));
      return;
    }
    await updateDoc(doc(firestore, "orders", o.id), { status });
    audit(userDoc, "order.status", `${o.orderNo} → ${status}`);
    setNote(tr(lang, `${o.orderNo} status changed to ${status}.`, `${o.orderNo}-এর অবস্থা ${status} করা হয়েছে।`));
  };
  const verifyPayment = async (o: Order) => {
    if (!firestore) return;
    await updateDoc(doc(firestore, "orders", o.id), { paymentStatus: "Paid" });
    audit(userDoc, "order.paymentVerified", `${o.orderNo} marked Paid (manual verification).`);
    setNote(tr(lang, "Payment marked Paid (manual verification).", "পেমেন্ট পরিশোধিত হিসেবে চিহ্নিত হয়েছে (ম্যানুয়াল যাচাই)।"));
  };
  const requestRefund = async (o: Order) => {
    if (!firestore) return;
    // One order gets one refund request: the button used to create a
    // new document on every tap, so one order ended up with 4 approved
    // and 4 rejected rows in the history.
    const existing = await getDocs(query(collection(firestore, "refundRequests"), where("orderId", "==", o.id), limit(1)));
    if (!existing.empty) {
      setNote(tr(lang, `A refund request for ${o.orderNo} already exists — see below.`, `${o.orderNo}-এর ফেরতের অনুরোধ আগেই আছে — নিচে দেখুন।`));
      return;
    }
    await addDoc(collection(firestore, "refundRequests"), { orderId: o.id, orderNo: o.orderNo, amount: o.total, reason: refundReason || "Refund requested in admin", requestedBy: userDoc.id, requestedByName: userDoc.name, status: "pending", decidedBy: "", decidedByName: "", createdAt: serverTimestamp() });
    setNote(tr(lang, "Refund request created — an admin/manager decides it below.", "ফেরতের অনুরোধ তৈরি হয়েছে — অ্যাডমিন/ম্যানেজার নিচে সিদ্ধান্ত নেবেন।"));
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Live Orders / Kitchen", "লাইভ অর্ডার / কিচেন")}</h3>
      <p className="small"><span style={{ color: "var(--good)" }}>● {tr(lang, "LIVE", "লাইভ")}</span> — {tr(lang, "New orders appear here the moment they arrive.", "নতুন অর্ডার আসার সঙ্গে সঙ্গে এখানে দেখা যাবে।")} {orders.filter((o) => o.status === "Pending").length} {tr(lang, "pending", "টি অপেক্ষমাণ")}</p>
      {note && <p className="small" role="status">{note}</p>}
      <div className="card" style={{ padding: 12, marginTop: 10 }}>
        <b>{tr(lang, "Phone number lookup", "ফোন নম্বর খুঁজুন")}</b>
        <p className="small muted" style={{ margin: "4px 0 8px" }}>{tr(lang, "Type a number to see its full order history and trust score — from real orders, however the number was typed at checkout.", "একটা নম্বর লিখে তার পুরো অর্ডারের ইতিহাস ও ট্রাস্ট স্কোর দেখুন — আসল অর্ডার থেকে, চেকআউটে নম্বর যেভাবেই লেখা হোক।")}</p>
        <div className="row">
          <input aria-label={tr(lang, "Phone number to look up", "খুঁজতে ফোন নম্বর")} value={lookupInput} onChange={(e) => setLookupInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void lookupPhone(); }} placeholder="01XXXXXXXXX" style={{ flex: 1 }} />
          <button className="btn-gold" disabled={lookupBusy || !lookupInput.trim()} onClick={() => void lookupPhone()}>{lookupBusy ? tr(lang, "Searching…", "খুঁজছি…") : tr(lang, "Search", "খুঁজুন")}</button>
        </div>
        {lookupMsg && <p className="small" role="status" style={{ marginTop: 8 }}>{lookupMsg}</p>}
        {lookupResult && (
          <div style={{ marginTop: 10 }}>
            <p style={{ margin: 0 }}><b>{lookupResult.stats.phone}</b> <PhoneTrustBadge stats={lookupResult.stats} settings={settings} lang={lang} /></p>
            <p className="small" style={{ margin: "6px 0 0" }}>
              {tr(lang, "Total orders:", "মোট অর্ডার:")} <b>{lookupResult.stats.total}</b> •
              {" "}{tr(lang, "Completed:", "সম্পন্ন:")} <b>{lookupResult.stats.completed}</b> •
              {" "}{tr(lang, "Cancelled:", "বাতিল:")} <b>{lookupResult.stats.cancelled} ({Math.round(lookupResult.stats.cancelRate)}%)</b> •
              {" "}{tr(lang, "Refunded:", "ফেরত:")} <b>{lookupResult.stats.refunded} ({Math.round(lookupResult.stats.returnRate)}%)</b>
            </p>
            <ul className="small" style={{ marginTop: 6 }}>{lookupResult.orders.slice(0, 20).map((o) => <li key={o.id}>{o.orderNo} • {o.status} • {tk(o.total)} • {o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-GB") : ""}</li>)}</ul>
          </div>
        )}
      </div>
      <label>{tr(lang, "Refund reason (for the button below)", "ফেরতের কারণ (নিচের বোতামের জন্য)")}<input aria-label="Refund reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} /></label>
      {orders.length === 0 && <p className="muted small">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {orders.map((o) => {
        const st = phoneStats.get(normalizePhone(o.phone ?? ""));
        const lvl = st ? trustLevel(st.cancelRate, settings.riskCautionPct ?? 25, settings.riskRiskyPct ?? 50) : null;
        // Kitchen timer: how long this order has waited since it was
        // placed. Past the admin's late limit it turns red and the
        // card gets a red border, so a late order is visible at a
        // glance. Only orders still in the kitchen count.
        const isKitchenActive = KITCHEN_ACTIVE.includes(o.status);
        const waitMs = isKitchenActive ? now - Date.parse(o.createdAt) : 0;
        const isLate = isKitchenActive && waitMs > (settings.kitchenLateMinutes ?? 30) * 60000;
        return (
        <div key={o.id} className="card" style={{ padding: 12, marginTop: 10, border: lvl === "risky" ? "2px solid var(--bad)" : isLate ? "2px solid var(--bad)" : undefined, background: isLate ? "rgba(224,120,86,.08)" : undefined }}>
          <div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)} • {o.paymentStatus}</span></div>
          <p className="small muted">{o.customerName} • {o.phone} • {o.orderType} • {o.source} • {o.createdAt ? new Date(o.createdAt).toLocaleString("en-GB") : ""}</p>
          {isKitchenActive && (
            <p style={{ margin: "4px 0 0", fontWeight: 700, color: isLate ? "var(--bad)" : undefined }}>
              ⏱️ {tr(lang, "Waiting", "অপেক্ষা করছে")} {waitingText(o.createdAt, now)}
              {isLate && <span style={{ marginLeft: 8 }}>🔴 {tr(lang, "LATE — over the kitchen limit", "দেরি — কিচেনের সীমা পেরিয়েছে")}</span>}
            </p>
          )}
          {st && <p style={{ margin: "4px 0 0" }}><PhoneTrustBadge stats={st} settings={settings} lang={lang} /></p>}
          {lvl === "risky" && <p className="small" style={{ color: "var(--bad)", fontWeight: 700, margin: "4px 0 0" }}>⚠ {tr(lang, "Warning: this number cancels often — confirm the order by phone before preparing it.", "সতর্কতা: এই নম্বর থেকে প্রায়ই বাতিল হয় — তৈরি করার আগে ফোনে অর্ডারটি নিশ্চিত করুন।")}</p>}
          <ul className="small">{o.items.map((it, i) => <li key={i}>{it.qty} × {itemName(products, it, lang)} — {tk(it.price)}</li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Status", "অবস্থা")}<select aria-label={`Status for ${o.orderNo}`} value={o.status} onChange={(e) => void setStatus(o, e.target.value)}>{["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered", "Completed", "Cancelled", "Refunded"].map((s) => <option key={s}>{s}</option>)}</select></label>
            {o.paymentStatus === "Pending verification" && <button className="btn-gold" onClick={() => void verifyPayment(o)}>{tr(lang, "Verify payment (manual)", "পেমেন্ট যাচাই করুন (ম্যানুয়াল)")}</button>}
            <button className="btn-ghost" onClick={() => void requestRefund(o)}>{tr(lang, "Request refund", "ফেরতের অনুরোধ")}</button>
            <button className="btn-ghost" onClick={() => setReceiptOrder(o)}>🧾 {tr(lang, "Receipt", "রিসিট")}</button>
          </div>
        </div>
        );
      })}
      {receiptOrder && <ReceiptModal order={receiptOrder} settings={settings} products={products} lang={lang} onClose={() => setReceiptOrder(null)} />}
      <RefundDecisions userDoc={userDoc} products={products} lang={lang} />
    </div>
  );
}

function RefundDecisions({ userDoc, lang }: { userDoc: UserDoc; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const canDecide = userDoc.role === "admin" || userDoc.role === "manager";
  const { data: reqs } = useLive(() => (firestore ? query(collection(firestore, "refundRequests"), orderBy("createdAt", "desc"), limit(20)) : null),
    (id, d) => ({ id, orderId: String(d.orderId ?? ""), orderNo: String(d.orderNo ?? ""), amount: Number(d.amount ?? 0), reason: String(d.reason ?? ""), status: String(d.status ?? "pending"), requestedByName: String(d.requestedByName ?? "") }));
  if (reqs.length === 0) return null;
  // Show one row per order (the newest request): older duplicates made
  // for the same order before the one-request rule collapse here.
  const seen = new Set<string>();
  const shown = reqs.filter((r) => { if (seen.has(r.orderId)) return false; seen.add(r.orderId); return true; });
  return (
    <div style={{ marginTop: 18 }}>
      <h4 className="serif" style={{ fontSize: 18 }}>{tr(lang, "Refund requests", "ফেরতের অনুরোধ")}</h4>
      {shown.map((r) => (
        <div key={r.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{r.orderNo}</b> • {tk(r.amount)} • {r.status} • {r.reason} ({r.requestedByName})
          {r.status === "pending" && canDecide && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn-gold" onClick={() => { if (!firestore) return; void updateDoc(doc(firestore, "refundRequests", r.id), { status: "approved", decidedBy: userDoc.id, decidedByName: userDoc.name }); void updateDoc(doc(firestore, "orders", r.orderId), { status: "Refunded" }); }}>{tr(lang, "Approve refund", "ফেরত অনুমোদন")}</button>
              <button className="btn-ghost" onClick={() => { if (!firestore) return; void updateDoc(doc(firestore, "refundRequests", r.id), { status: "rejected", decidedBy: userDoc.id, decidedByName: userDoc.name }); }}>{tr(lang, "Reject", "বাতিল")}</button>
            </div>
          )}
          {r.status === "pending" && !canDecide && <p className="small muted">{tr(lang, "Only admin/manager can decide.", "শুধু অ্যাডমিন/ম্যানেজার সিদ্ধান্ত নিতে পারেন।")}</p>}
        </div>
      ))}
    </div>
  );
}

function PosTab({ userDoc, products, settings, lang }: { userDoc: UserDoc; products: Product[]; settings: Settings; lang: Lang }) {
  const [cart, setCart] = useState<Array<{ slug: string; qty: number }>>([]);
  const [cashText, setCashText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [saleReceipt, setSaleReceipt] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const cash = Number(cashText) || 0;
  const qtyBySlug = new Map(cart.map((c) => [c.slug, c.qty]));
  const lines = cart.map((c) => ({ product: products.find((p) => p.slug === c.slug), qty: c.qty })).filter((l): l is { product: Product; qty: number } => !!l.product);
  // Excel-style live formulas: line = qty x unit price, total = sum of
  // lines minus the combo discount (same helper as the website cart),
  // change = cash - total. Nothing is typed twice; every number
  // updates the moment a quantity changes.
  const subtotal = lines.reduce((a, l) => a + (l.product.discountPrice ?? l.product.price) * l.qty, 0);
  const combo = comboDiscount(lines.map((l) => ({ qty: l.qty })), settings.comboMinQty ?? COMBO_MIN_QTY, settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE);
  const happy = happyHourDiscount(subtotal, new Date(), timeToMin(settings.happyHourStart ?? HAPPY_HOUR_START), timeToMin(settings.happyHourEnd ?? HAPPY_HOUR_END), settings.happyHourPercent ?? HAPPY_HOUR_PERCENT);
  const total = Math.max(0, subtotal - combo - happy);
  const change = Math.max(0, cash - total);
  const inc = (slug: string) => setCart((prev) => { const cur = prev.find((c) => c.slug === slug); return cur ? prev.map((c) => (c.slug === slug ? { ...c, qty: c.qty + 1 } : c)) : [...prev, { slug, qty: 1 }]; });
  const dec = (slug: string) => setCart((prev) => { const cur = prev.find((c) => c.slug === slug); if (!cur) return prev; return cur.qty <= 1 ? prev.filter((c) => c.slug !== slug) : prev.map((c) => (c.slug === slug ? { ...c, qty: c.qty - 1 } : c)); });
  const removeLine = (slug: string) => setCart((prev) => prev.filter((c) => c.slug !== slug));
  const sell = async () => {
    if (!getDb() || lines.length === 0) return;
    if (cash < total) { setMsg(tr(lang, "Cash received is less than the total.", "পাওয়া টাকা মোটের চেয়ে কম।")); return; }
    setBusy(true); setMsg("");
    const r = await placeOrderTx({
      uid: userDoc.id, customerName: "Counter sale", phone: "", address: "", orderType: "takeaway",
      source: "pos", paymentMethod: "Cash", paymentRef: "", tableLabel: "", notes: "", staffName: userDoc.name,
      couponCode: "", lines: lines.map((l) => ({ product: l.product, qty: l.qty, size: "Regular", sugar: "Normal", milk: "Normal", note: "" })),
      settings, paidAmount: cash,
    });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "Sale failed."); return; }
    const charged = r.total ?? total;
    const changeDue = Math.max(0, cash - charged);
    setMsg(tr(lang, `Sale done: ${r.orderNo}. Total: ${tk(charged)}. Change: ${tk(changeDue)}.`, `বিক্রি হয়েছে: ${r.orderNo}। মোট: ${tk(charged)}। ফেরত: ${tk(changeDue)}।`));
    setSaleReceipt(r.receipt ?? null);
    setCart([]); setCashText("");
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>POS</h3>
      <div className="pos-layout" style={{ marginTop: 10 }}>
        <div className="grid products">
          {products.filter((p) => p.available && (p.discountPrice ?? p.price) > 0).map((p) => {
            const inCart = qtyBySlug.get(p.slug) ?? 0;
            return (
              <button key={p.slug} type="button" className="card" style={{ padding: 10, textAlign: "left", color: "var(--text)", position: "relative", boxShadow: inCart > 0 ? "0 0 0 2px var(--gold)" : undefined }} onClick={() => inc(p.slug)}>
                {p.imageKey && <img src={`/img/${p.imageKey}`} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />}
                <b>{displayName(p, lang)}</b><br /><span>{tk(p.discountPrice ?? p.price)}</span>
                {inCart > 0 && <span style={{ position: "absolute", top: 6, right: 6, background: "var(--gold)", color: "#1a1207", borderRadius: 999, minWidth: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, padding: "0 6px" }}>×{inCart}</span>}
              </button>
            );
          })}
        </div>
        <div className="card pos-cart" style={{ padding: 12 }}>
          {lines.length === 0 && <p className="small muted">{tr(lang, "Tap a product to add it.", "প্রোডাক্টে চাপ দিলে এখানে যোগ হবে।")}</p>}
          {lines.map((l) => {
            const price = l.product.discountPrice ?? l.product.price;
            return (
              <div key={l.product.slug} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                {l.product.imageKey && <img src={`/img/${l.product.imageKey}`} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{displayName(l.product, lang)}</b>
                  <div className="small muted">{tk(price)} × {l.qty} = {tk(price * l.qty)}</div>
                </div>
                <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => dec(l.product.slug)} aria-label={tr(lang, "Decrease", "কমান")}>−</button>
                <b style={{ minWidth: 20, textAlign: "center" }}>{l.qty}</b>
                <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => inc(l.product.slug)} aria-label={tr(lang, "Increase", "বাড়ান")}>+</button>
                <button className="btn-danger" style={{ padding: "4px 10px" }} onClick={() => removeLine(l.product.slug)} aria-label={tr(lang, "Remove", "সরান")}>✕</button>
              </div>
            );
          })}
          <p><b>{tr(lang, "Subtotal", "সাবটোটাল")}: {tk(subtotal)}</b></p>
          {combo > 0 && <p style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Combo discount", "কম্বো ছাড়")}: −{tk(combo)}</p>}
          {happy > 0 && <p style={{ color: "var(--good)", fontWeight: 700 }}>{tr(lang, "Happy Hour discount", "হ্যাপি আওয়ার ছাড়")} ({settings.happyHourPercent ?? HAPPY_HOUR_PERCENT}%): −{tk(happy)}</p>}
          <p><b>{tr(lang, "Total", "মোট")}: {tk(total)}</b></p>
          <label>{tr(lang, "Cash received", "পাওয়া টাকা")}<input aria-label="Cash received" type="number" value={cashText} onChange={(e) => setCashText(e.target.value)} /></label>
          <p>{tr(lang, "Change:", "ফেরত:")} <b>{tk(change)}</b></p>
          <button className="btn-gold" disabled={busy || lines.length === 0} onClick={() => void sell()}>{tr(lang, "Complete cash sale", "নগদ বিক্রি সম্পন্ন করুন")}</button>
          <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => { setCart([]); setCashText(""); }}>{tr(lang, "Clear all", "সব মুছুন")}</button>
          {msg && <p className="small" role="status">{msg}</p>}
          {saleReceipt && <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowReceipt(true)}>🧾 {tr(lang, "Receipt for the last sale", "শেষ বিক্রির রিসিট")}</button>}
          {showReceipt && saleReceipt && <ReceiptModal order={saleReceipt} settings={settings} products={products} lang={lang} onClose={() => setShowReceipt(false)} />}
        </div>
      </div>
    </div>
  );
}

function ProductsTab({ userDoc, categories, products, lang }: { userDoc: UserDoc; categories: Category[]; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ slug: "", nameEn: "", nameBn: "", description: "", categoryId: "", price: 0, discountPrice: "", stock: 100, available: true, featured: false, bestSeller: false, isNew: false, imageKey: "", imageKey2: "", ingredients: "", spiceLevel: "", veg: "", sortOrder: 1 });
  const [catForm, setCatForm] = useState({ id: "", nameEn: "", nameBn: "", sortOrder: 99, active: true });
  const [msg, setMsg] = useState("");
  const startEdit = (p: Product) => {
    // Toggle: tapping Edit on the row that is already open closes it.
    // Opening another row closes the first one — only one inline
    // editor is ever open, and it always sits directly under its row.
    if (editing?.slug === p.slug) { setEditing(null); setForm({ slug: "", nameEn: "", nameBn: "", description: "", categoryId: "", price: 0, discountPrice: "", stock: 100, available: true, featured: false, bestSeller: false, isNew: false, imageKey: "", imageKey2: "", ingredients: "", spiceLevel: "", veg: "", sortOrder: 1 }); return; }
    setEditing(p);
    setForm({ slug: p.slug, nameEn: p.nameEn, nameBn: p.nameBn, description: p.description, categoryId: p.categoryId, price: p.price, discountPrice: p.discountPrice == null ? "" : String(p.discountPrice), stock: p.stock, available: p.available, featured: p.featured, bestSeller: p.bestSeller, isNew: p.isNew, imageKey: p.imageKey ?? "", imageKey2: p.imageKey2 ?? "", ingredients: p.ingredients, spiceLevel: p.spiceLevel, veg: p.veg, sortOrder: p.sortOrder });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    const slug = form.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || `item-${Date.now()}`;
    const data = { slug, nameEn: form.nameEn.trim(), nameBn: form.nameBn.trim(), description: form.description.trim(), categoryId: form.categoryId, price: Number(form.price), discountPrice: form.discountPrice === "" ? null : Number(form.discountPrice), stock: Number(form.stock), available: form.available, featured: form.featured, bestSeller: form.bestSeller, isNew: form.isNew, imageKey: form.imageKey || null, imageKey2: form.imageKey2 || null, ingredients: form.ingredients.trim(), spiceLevel: form.spiceLevel, veg: form.veg, sortOrder: Number(form.sortOrder), updatedAt: serverTimestamp() };
    if (editing) await updateDoc(doc(firestore, "products", editing.slug), data);
    else await setDoc(doc(firestore, "products", slug), { ...data, costPrice: 0, prepTime: 10 });
    audit(userDoc, editing ? "product.update" : "product.create", `${data.nameEn} — price ${data.price}`);
    setMsg(tr(lang, "Product saved — the customer menu updates at once.", "প্রোডাক্ট সংরক্ষিত হয়েছে — কাস্টমার মেনু সাথে সাথে বদলে যাবে।"));
    setEditing(null);
    setForm({ slug: "", nameEn: "", nameBn: "", description: "", categoryId: "", price: 0, discountPrice: "", stock: 100, available: true, featured: false, bestSeller: false, isNew: false, imageKey: "", imageKey2: "", ingredients: "", spiceLevel: "", veg: "", sortOrder: 1 });
  };
  const remove = async (p: Product) => {
    if (!firestore) return;
    await deleteDoc(doc(firestore, "products", p.slug));
    audit(userDoc, "product.delete", p.nameEn);
  };
  const saveCat = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    const id = catForm.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || `cat-${Date.now()}`;
    await setDoc(doc(firestore, "categories", id), { nameEn: catForm.nameEn.trim(), nameBn: catForm.nameBn.trim(), sortOrder: Number(catForm.sortOrder), active: catForm.active }, { merge: true });
    audit(userDoc, "category.save", catForm.nameEn);
    setCatForm({ id: "", nameEn: "", nameBn: "", sortOrder: 99, active: true });
    setMsg(tr(lang, "Category saved.", "ক্যাটাগরি সংরক্ষিত হয়েছে।"));
  };
  // The one product form, used in two places: at the top for a new
  // product, and inline directly under the row being edited. Only one
  // copy is ever on screen, so the shared `form` state never clashes.
  const renderProductForm = () => (
    <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
      <b>{editing ? tr(lang, "Edit product", "প্রোডাক্ট সম্পাদনা") : tr(lang, "New product", "নতুন প্রোডাক্ট")}</b>
      <label>{tr(lang, "Slug (Firestore document id)", "স্লাগ (Firestore ডকুমেন্ট আইডি)")}<input aria-label="Product slug" value={form.slug} disabled={!!editing} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
      <label>{tr(lang, "Name (English)", "নাম (ইংরেজি)")}<input aria-label="Product name English" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
      <label>{tr(lang, "Name (Bengali)", "নাম (বাংলা)")}<input aria-label="Product name Bengali" value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} /></label>
      <label>{tr(lang, "Description", "বিবরণ")}<input aria-label="Product description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <label>{tr(lang, "Category", "ক্যাটাগরি")}<select aria-label="Product category" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">{tr(lang, "Choose…", "বেছে নিন…")}</option>{categories.map((c) => <option key={c.id} value={c.id}>{displayCategoryName(c, lang)}</option>)}</select></label>
      <div className="row">
        <label style={{ flex: 1 }}>{tr(lang, "Price (৳, 0 = not set yet)", "দাম (৳, ০ = এখনো বসানো হয়নি)")}<input aria-label="Price" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></label>
        <label style={{ flex: 1 }}>{tr(lang, "Discount price (empty = none)", "ছাড়ের দাম (খালি = নেই)")}<input aria-label="Discount price" type="number" min={0} value={form.discountPrice} onChange={(e) => setForm({ ...form, discountPrice: e.target.value })} /></label>
        <label style={{ flex: 1 }}>{tr(lang, "Stock", "স্টক")}<input aria-label="Stock" type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></label>
      </div>
      <label>{tr(lang, "Photo file", "ছবির ফাইল")}<select aria-label="Photo file" value={form.imageKey} onChange={(e) => setForm({ ...form, imageKey: e.target.value })}><option value="">{tr(lang, "No photo", "ছবি নেই")}</option>{IMG_FILES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
      <label>{tr(lang, "Second photo file", "দ্বিতীয় ছবির ফাইল")}<select aria-label="Second photo file" value={form.imageKey2} onChange={(e) => setForm({ ...form, imageKey2: e.target.value })}><option value="">{tr(lang, "Same as photo", "ছবির মতোই")}</option>{IMG_FILES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
      <label>{tr(lang, "Ingredients (comma separated)", "উপকরণ (কমা দিয়ে)")}<input aria-label="Ingredients" value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} /></label>
      <div className="row">
        <label style={{ flex: 1 }}>{tr(lang, "Spice level", "ঝালের মাত্রা")}<select aria-label="Spice level" value={form.spiceLevel} onChange={(e) => setForm({ ...form, spiceLevel: e.target.value })}>
          <option value="">{tr(lang, "Not set", "বসানো হয়নি")}</option>
          <option value="mild">{tr(lang, "Mild", "হালকা")}</option>
          <option value="medium">{tr(lang, "Medium", "মাঝারি")}</option>
          <option value="hot">{tr(lang, "Hot", "ঝাল")}</option>
        </select></label>
        <label style={{ flex: 1 }}>{tr(lang, "Veg / Non-veg", "ভেজ / নন-ভেজ")}<select aria-label="Veg or non-veg" value={form.veg} onChange={(e) => setForm({ ...form, veg: e.target.value })}>
          <option value="">{tr(lang, "Not set", "বসানো হয়নি")}</option>
          <option value="veg">{tr(lang, "Veg", "ভেজ")}</option>
          <option value="non-veg">{tr(lang, "Non-veg", "নন-ভেজ")}</option>
        </select></label>
      </div>
      <div className="row">
        {(["available", "featured", "bestSeller", "isNew"] as const).map((k) => <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}><input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} style={{ width: "auto" }} />{k}</label>)}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn-gold" type="submit">{tr(lang, "Save product", "প্রোডাক্ট সংরক্ষণ করুন")}</button>
        {editing && <button className="btn-ghost" type="button" onClick={() => { setEditing(null); setForm({ slug: "", nameEn: "", nameBn: "", description: "", categoryId: "", price: 0, discountPrice: "", stock: 100, available: true, featured: false, bestSeller: false, isNew: false, imageKey: "", imageKey2: "", ingredients: "", spiceLevel: "", veg: "", sortOrder: 1 }); }}>{tr(lang, "Cancel edit", "সম্পাদনা বাতিল")}</button>}
      </div>
    </form>
  );
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Products & Categories", "প্রোডাক্ট ও ক্যাটাগরি")}</h3>
      {msg && <p className="small" role="status">{msg}</p>}
      {!editing && renderProductForm()}
      <div style={{ overflowX: "auto" }}>
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>{tr(lang, "Product", "প্রোডাক্ট")}</th><th>{tr(lang, "Price", "দাম")}</th><th>{tr(lang, "Stock", "স্টক")}</th><th>{tr(lang, "Shown", "দেখানো হয়")}</th><th /></tr></thead>
          <tbody>{products.map((p) => (
            <Fragment key={p.slug}>
              <tr style={editing?.slug === p.slug ? { background: "var(--surface)", boxShadow: "inset 3px 0 0 var(--gold)" } : undefined}>
                <td>{displayName(p, lang)} <span className="small muted">({p.slug})</span></td><td>{tk(p.discountPrice ?? p.price)}</td><td>{p.stock}</td><td>{p.available ? "✓" : "—"}</td>
                <td><button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => startEdit(p)}>{editing?.slug === p.slug ? tr(lang, "Close", "বন্ধ করুন") : tr(lang, "Edit", "সম্পাদনা")}</button> <button className="btn-danger" style={{ padding: "4px 10px" }} onClick={() => void remove(p)}>{tr(lang, "Delete", "মুছুন")}</button></td>
              </tr>
              {editing?.slug === p.slug && (
                <tr><td colSpan={5} style={{ padding: 0, border: "none" }}>
                  <div className="row-expand" style={{ padding: 12, background: "var(--surface)", border: "2px solid var(--gold)", borderRadius: 10, margin: "4px 0 10px" }}>
                    {renderProductForm()}
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
      <form onSubmit={(e) => void saveCat(e)} className="card" style={{ padding: 14, marginTop: 18 }}>
        <b>{tr(lang, "Category", "ক্যাটাগরি")}</b>
        <label>{tr(lang, "Category id", "ক্যাটাগরি আইডি")}<input aria-label="Category id" value={catForm.id} onChange={(e) => setCatForm({ ...catForm, id: e.target.value })} placeholder="hot-coffee" /></label>
        <label>{tr(lang, "Name (English)", "নাম (ইংরেজি)")}<input aria-label="Category name English" required value={catForm.nameEn} onChange={(e) => setCatForm({ ...catForm, nameEn: e.target.value })} /></label>
        <label>{tr(lang, "Name (Bengali)", "নাম (বাংলা)")}<input aria-label="Category name Bengali" value={catForm.nameBn} onChange={(e) => setCatForm({ ...catForm, nameBn: e.target.value })} /></label>
        <label>{tr(lang, "Sort order", "ক্রম")}<input aria-label="Category sort order" type="number" value={catForm.sortOrder} onChange={(e) => setCatForm({ ...catForm, sortOrder: Number(e.target.value) })} /></label>
        <button className="btn-gold" type="submit">{tr(lang, "Save category", "ক্যাটাগরি সংরক্ষণ করুন")}</button>
      </form>
      {categories.map((c) => (
        <p key={c.id} className="small">{displayCategoryName(c, lang)} {lang === "bn" ? (c.nameEn ? <span className="small muted">({c.nameEn})</span> : null) : (c.nameBn ? <span className="small muted">({c.nameBn})</span> : null)} — {tr(lang, "order", "ক্রম")} {c.sortOrder} — {c.active ? tr(lang, "active", "সক্রিয়") : tr(lang, "hidden", "লুকানো")}
          <button className="btn-danger" style={{ padding: "2px 8px", marginLeft: 8 }} onClick={() => { if (products.some((p) => p.categoryId === c.id)) { setMsg(tr(lang, "This category still has products. Move or delete its products first.", "এই ক্যাটাগরিতে এখনো প্রোডাক্ট আছে। আগে প্রোডাক্ট সরান বা মুছুন।")); return; } if (firestore) void deleteDoc(doc(firestore, "categories", c.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
        </p>
      ))}
    </div>
  );
}

function ReservationsTab({ userDoc, lang }: { userDoc: UserDoc; lang: Lang }) {
  const firestore = getDb();
  const { data: res } = useLive<Reservation>(() => (firestore ? query(collection(firestore, "reservations"), orderBy("createdAt", "desc"), limit(60)) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), email: String(d.email ?? ""), date: String(d.date ?? ""), time: String(d.time ?? ""), guests: Number(d.guests ?? 2), requests: String(d.requests ?? ""), status: String(d.status ?? "Pending"), tableLabel: String(d.tableLabel ?? ""), userId: String(d.userId ?? ""), createdAt: "", reminderAt: tsToIso(d.reminderAt) }));
  const { data: tables } = useLive(() => (firestore ? query(collection(firestore, "tables"), orderBy("label")) : null),
    (id, d) => ({ id, label: String(d.label ?? id), capacity: Number(d.capacity ?? 4), status: String(d.status ?? "Available"), notes: String(d.notes ?? "") }));
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(4);
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Tables & Reservations", "টেবিল ও রিজার্ভেশন")}</h3>
      {res.length === 0 && <p className="muted small">{tr(lang, "No reservations yet.", "এখনো কোনো রিজার্ভেশন নেই।")}</p>}
      {res.map((r) => (
        <div key={r.id} className="card" style={{ padding: 12, marginTop: 10 }}>
          <b>{r.name}</b> • {r.phone} • {fmtDate(r.date)} {r.time} • {r.guests} {tr(lang, "guests", "অতিথি")}
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Status", "অবস্থা")}<select aria-label={`Reservation status ${r.id}`} value={r.status} onChange={(e) => { if (firestore) void updateDoc(doc(firestore, "reservations", r.id), { status: e.target.value }); }}><option>Pending</option><option>Confirmed</option><option>Cancelled</option><option>Completed</option></select></label>
            <label style={{ margin: 0 }}>{tr(lang, "Table", "টেবিল")}<input aria-label="Reservation table" value={r.tableLabel} onChange={(e) => { if (firestore) void updateDoc(doc(firestore, "reservations", r.id), { tableLabel: e.target.value }); }} placeholder="T1" /></label>
            {(r.status === "Pending" || r.status === "Confirmed") && (
              <button className="btn-gold" style={{ padding: "6px 10px" }} onClick={() => {
                if (!firestore) return;
                void updateDoc(doc(firestore, "reservations", r.id), { reminderAt: new Date().toISOString() });
                audit(userDoc, "reservation.reminder", `${r.name} — ${r.date} ${r.time}`);
              }}>🔔 {tr(lang, "Send reminder", "মনে করিয়ে দিন")}</button>
            )}
            <button className="btn-danger" style={{ padding: "6px 10px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "reservations", r.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
          </div>
          {r.requests && <p className="small muted">{r.requests}</p>}
          {r.reminderAt && <p className="small muted" style={{ margin: "4px 0 0" }}>🔔 {tr(lang, "Reminder sent:", "মনে করানো হয়েছে:")} {new Date(r.reminderAt).toLocaleString("en-GB")}</p>}
        </div>
      ))}
      <h4 className="serif" style={{ fontSize: 18, marginTop: 18 }}>{tr(lang, "Tables", "টেবিল")}</h4>
      <p className="small muted">{tr(lang, "Each table has a QR code. Print it and stick it on the table — scanning opens the menu with that table pre-selected for dine-in.", "প্রতিটি টেবিলের একটি QR কোড আছে। প্রিন্ট করে টেবিলে লাগান — স্ক্যান করলে ওই টেবিল ডাইন-ইনের জন্য আগে থেকে বসানো মেনু খুলবে।")}</p>
      {tables.length === 0 && <p className="muted small">{tr(lang, "No tables yet — add one below.", "এখনো কোনো টেবিল নেই — নিচে টেবিল যোগ করুন।")}</p>}
      {tables.map((t) => (
        <div key={t.id} className="card" style={{ padding: 12, marginTop: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <QrCode text={tableQrUrl(t.label)} size={120} title={`Table ${t.label} QR code`} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <b>{t.label}</b> • {t.capacity} {tr(lang, "seats", "আসন")} • {t.status}
            <p className="small muted" style={{ margin: "6px 0 0", wordBreak: "break-all" }}>{tableQrUrl(t.label)}</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn-gold" style={{ padding: "6px 10px" }} onClick={() => printTableQr(t.label)}>🖨️ {tr(lang, "Print QR", "QR প্রিন্ট করুন")}</button>
              <button className="btn-danger" style={{ padding: "6px 10px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "tables", t.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
            </div>
          </div>
        </div>
      ))}
      <div className="row">
        <input aria-label="New table label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T1" style={{ flex: 1 }} />
        <input aria-label="Table capacity" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} style={{ width: 90 }} />
        <button className="btn-gold" onClick={() => { if (!firestore || !label.trim()) return; void addDoc(collection(firestore, "tables"), { label: label.trim(), capacity, status: "Available", notes: "" }); setLabel(""); }}>{tr(lang, "Add table", "টেবিল যোগ করুন")}</button>
      </div>
    </div>
  );
}

function CouponsTab({ userDoc, lang }: { userDoc: UserDoc; lang: Lang }) {
  const firestore = getDb();
  const { data: coupons } = useLive<Coupon>(() => (firestore ? query(collection(firestore, "coupons"), orderBy("code")) : null),
    (id, d) => ({ id, code: String(d.code ?? id), kind: String(d.kind ?? "percent"), value: Number(d.value ?? 0), minPurchase: Number(d.minPurchase ?? 0), maxDiscount: d.maxDiscount == null ? null : Number(d.maxDiscount), usageLimit: d.usageLimit == null ? null : Number(d.usageLimit), usedCount: Number(d.usedCount ?? 0), active: d.active !== false, expiresAt: String(d.expiresAt ?? ""), description: String(d.description ?? ""), firstOrderOnly: d.firstOrderOnly === true }));
  const [f, setF] = useState({ code: "", kind: "percent", value: 10, minPurchase: 0, maxDiscount: "", usageLimit: "", expiresAt: "", description: "", active: true, firstOrderOnly: false });
  const [msg, setMsg] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    const code = f.code.trim().toUpperCase();
    await setDoc(doc(firestore, "coupons", code), { code, kind: f.kind, value: Number(f.value), minPurchase: Number(f.minPurchase), maxDiscount: f.maxDiscount === "" ? null : Number(f.maxDiscount), usageLimit: f.usageLimit === "" ? null : Number(f.usageLimit), usedCount: 0, active: f.active, expiresAt: f.expiresAt, description: f.description, firstOrderOnly: f.firstOrderOnly });
    audit(userDoc, "coupon.save", code);
    setMsg(tr(lang, "Offer/coupon saved — customers see it at checkout.", "অফার/কুপন সংরক্ষিত হয়েছে — কাস্টমার চেকআউটে দেখবে।"));
    setF({ code: "", kind: "percent", value: 10, minPurchase: 0, maxDiscount: "", usageLimit: "", expiresAt: "", description: "", active: true, firstOrderOnly: false });
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Coupons & Offers", "কুপন ও অফার")}</h3>
      {msg && <p className="small" role="status">{msg}</p>}
      <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Code", "কোড")}<input aria-label="Coupon code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label>{tr(lang, "Type", "ধরন")}<select aria-label="Coupon type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="percent">Percent %</option><option value="fixed">Fixed ৳</option></select></label>
        <label>{tr(lang, "Value", "মান")}<input aria-label="Coupon value" type="number" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></label>
        <label>{tr(lang, "Minimum purchase (৳)", "সর্বনিম্ন কেনাকাটা (৳)")}<input aria-label="Minimum purchase" type="number" value={f.minPurchase} onChange={(e) => setF({ ...f, minPurchase: Number(e.target.value) })} /></label>
        <label>{tr(lang, "Expires (date, optional)", "মেয়াদ (তারিখ, ঐচ্ছিক)")}<input aria-label="Coupon expiry" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
        <label>{tr(lang, "Description", "বিবরণ")}<input aria-label="Coupon description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0 0" }}><input type="checkbox" style={{ width: "auto" }} checked={f.firstOrderOnly} onChange={(e) => setF({ ...f, firstOrderOnly: e.target.checked })} />{tr(lang, "First order only — a customer who already has an order cannot use it.", "শুধু প্রথম অর্ডারের জন্য — আগের অর্ডার আছে এমন কাস্টমার ব্যবহার করতে পারবে না।")}</label>
        <button className="btn-gold" type="submit">{tr(lang, "Save coupon", "কুপন সংরক্ষণ করুন")}</button>
      </form>
      {coupons.length === 0 && <p className="muted small" style={{ marginTop: 10 }}>{tr(lang, "No coupons yet — make one in the form above.", "এখনো কোনো কুপন নেই — উপরের ফরমে কুপন বানান।")}</p>}
      {coupons.map((c) => <p key={c.id} className="small">{c.code} — {c.kind} {c.value}{c.firstOrderOnly ? ` • ${tr(lang, "first order only", "শুধু প্রথম অর্ডার")}` : ""} • {c.active ? tr(lang, "active", "সক্রিয়") : tr(lang, "inactive", "নিষ্ক্রিয়")} • {tr(lang, "used", "ব্যবহৃত")} {c.usedCount} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "coupons", c.id), { active: !c.active }); }}>{c.active ? tr(lang, "Deactivate", "বন্ধ করুন") : tr(lang, "Activate", "চালু করুন")}</button> <button className="btn-danger" style={{ padding: "2px 8px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "coupons", c.id)); }}>{tr(lang, "Delete", "মুছুন")}</button></p>)}
    </div>
  );
}

function ContentTab({ userDoc, settings, lang }: { userDoc: UserDoc; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const content = parseContent(settings.contentJson);
  const [announcement, setAnnouncement] = useState(content.announcement);
  const [aboutText, setAboutText] = useState(content.aboutText);
  const [showGallery, setShowGallery] = useState(content.showGallery);
  const [promoVideo, setPromoVideo] = useState(settings.promoVideo);
  const [banners, setBanners] = useState<string[]>(parseBannerSelection(settings.bannersJson));
  const [msg, setMsg] = useState("");
  useEffect(() => { setAnnouncement(content.announcement); setAboutText(content.aboutText); setShowGallery(content.showGallery); }, [settings.contentJson]);
  useEffect(() => { setPromoVideo(settings.promoVideo); }, [settings.promoVideo]);
  useEffect(() => { setBanners(parseBannerSelection(settings.bannersJson)); }, [settings.bannersJson]);
  const saveAll = async () => {
    if (!firestore) return;
    await setDoc(doc(firestore, "settings", "cafe"), {
      contentJson: JSON.stringify({ announcement, aboutText, showGallery }),
      promoVideo, bannersJson: JSON.stringify(banners),
    }, { merge: true });
    audit(userDoc, "content.save", "Homepage content, video and banners updated.");
    setMsg(tr(lang, "Saved — the customer site updates at once.", "সংরক্ষিত হয়েছে — কাস্টমার সাইট সাথে সাথে বদলে যাবে।"));
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Content & Banners", "কনটেন্ট ও ব্যানার")}</h3>
      {msg && <p className="small" role="status">{msg}</p>}
      <div className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Announcement bar (shown on every customer page)", "ঘোষণা বার (সব কাস্টমার পেজে দেখায়)")}<input aria-label="Announcement" value={announcement} onChange={(e) => setAnnouncement(e.target.value)} /></label>
        <label>{tr(lang, "About text", "সম্পর্কে লেখা")}<textarea aria-label="About text" rows={3} value={aboutText} onChange={(e) => setAboutText(e.target.value)} /></label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={showGallery} onChange={(e) => setShowGallery(e.target.checked)} style={{ width: "auto" }} />{tr(lang, "Show gallery on the homepage", "হোমপেজে গ্যালারি দেখান")}</label>
        <label>{tr(lang, "Homepage promo video", "হোমপেজের প্রোমো ভিডিও")}<select aria-label="Promo video" value={promoVideo} onChange={(e) => setPromoVideo(e.target.value)}><option value="main">Main promo</option><option value="a">Promo A</option><option value="b">Promo B</option><option value="none">No video (photo hero)</option></select></label>
        <b>{tr(lang, "Banner carousel (owner posters)", "ব্যানার ক্যারোসেল (মালিকের পোস্টার)")}</b>
        {BANNER_SLIDES.map((b) => (
          <label key={b.slug} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={banners.includes(b.slug)} style={{ width: "auto" }} onChange={(e) => setBanners(e.target.checked ? [...banners, b.slug] : banners.filter((s) => s !== b.slug))} />
            <img src={`/img/${b.img}`} alt={b.alt} style={{ width: 64, height: 32, objectFit: "cover", borderRadius: 6 }} /> {b.slug}
          </label>
        ))}
        <button className="btn-gold" style={{ marginTop: 12 }} onClick={() => void saveAll()}>{tr(lang, "Save content & banners", "কনটেন্ট ও ব্যানার সংরক্ষণ করুন")}</button>
      </div>
    </div>
  );
}

function SettingsTab({ userDoc, settings, lang }: { userDoc: UserDoc; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const [f, setF] = useState({ ...settings });
  const [msg, setMsg] = useState("");
  useEffect(() => { setF({ ...settings }); }, [settings]);
  const [enabled, setEnabled] = useState<string[]>(() => {
    try { const raw = JSON.parse(settings.paymentsJson || "") as unknown; return Array.isArray(raw) ? raw as string[] : [...PAYMENTS]; } catch { return [...PAYMENTS]; }
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    await setDoc(doc(firestore, "settings", "cafe"), { ...f, paymentsJson: JSON.stringify(enabled) }, { merge: true });
    audit(userDoc, "settings.save", "Cafe settings updated (name, prices rules, delivery, payments, loyalty).");
    setMsg(tr(lang, "Settings saved — the customer site updates at once.", "সেটিংস সংরক্ষিত হয়েছে — কাস্টমার সাইট সাথে সাথে বদলে যাবে।"));
  };
  const num = (k: keyof Settings) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) as never });
  const str = (k: keyof Settings) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value as never });
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Settings", "সেটিংস")}</h3>
      {msg && <p className="small" role="status">{msg}</p>}
      <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Cafe name", "ক্যাফের নাম")}<input aria-label="Cafe name" value={f.cafeName} onChange={str("cafeName")} /></label>
        <label>{tr(lang, "Tagline", "ট্যাগলাইন")}<input aria-label="Tagline" value={f.tagline} onChange={str("tagline")} /></label>
        <label>{tr(lang, "Tagline (Bengali)", "ট্যাগলাইন (বাংলা)")}<input aria-label="Tagline (Bengali)" value={f.taglineBn} onChange={str("taglineBn")} /></label>
        <label>{tr(lang, "Address", "ঠিকানা")}<input aria-label="Address" value={f.address} onChange={str("address")} /></label>
        <label>{tr(lang, "Phone", "ফোন")}<input aria-label="Phone" value={f.phone} onChange={str("phone")} /></label>
        <label>{tr(lang, "Email", "ইমেইল")}<input aria-label="Email" value={f.email} onChange={str("email")} /></label>
        <label>Facebook<input aria-label="Facebook URL" value={f.facebook} onChange={str("facebook")} /></label>
        <label>{tr(lang, "Hours text", "সময়ের লেখা")}<input aria-label="Hours text" value={f.hours} onChange={str("hours")} /></label>
        <label>{tr(lang, "Opening hours JSON (day/open/close)", "খোলার সময়ের JSON")}<textarea aria-label="Opening hours JSON" rows={3} value={f.hoursJson} onChange={str("hoursJson")} placeholder='[{"day":"Saturday","open":"09:00","close":"22:00"}]' /></label>
        <div className="row">
          <label style={{ flex: 1 }}>VAT %<input aria-label="VAT percent" type="number" value={f.vatPercent} onChange={num("vatPercent")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Delivery fee (৳)", "ডেলিভারি ফি (৳)")}<input aria-label="Delivery fee" type="number" value={f.deliveryFee} onChange={num("deliveryFee")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Free delivery at (৳)", "ফ্রি ডেলিভারি (৳ থেকে)")}<input aria-label="Free delivery at" type="number" value={f.freeDeliveryAt} onChange={num("freeDeliveryAt")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Minimum order (৳)", "সর্বনিম্ন অর্ডার (৳)")}<input aria-label="Minimum order" type="number" value={f.minOrder} onChange={num("minOrder")} /></label>
        </div>
        <label>{tr(lang, "Delivery zones JSON", "ডেলিভারি জোনের JSON")}<textarea aria-label="Delivery zones JSON" rows={2} value={f.zonesJson} onChange={str("zonesJson")} placeholder='[{"area":"EPZ","fee":40,"active":true}]' /></label>
        <div className="row">
          <label style={{ flex: 1 }}>bKash<input aria-label="bKash number" value={f.bkashNumber} onChange={str("bkashNumber")} /></label>
          <label style={{ flex: 1 }}>Nagad<input aria-label="Nagad number" value={f.nagadNumber} onChange={str("nagadNumber")} /></label>
          <label style={{ flex: 1 }}>Rocket<input aria-label="Rocket number" value={f.rocketNumber} onChange={str("rocketNumber")} /></label>
        </div>
        <label>{tr(lang, "Payment note", "পেমেন্ট নোট")}<input aria-label="Payment note" value={f.paymentNote} onChange={str("paymentNote")} /></label>
        <b>{tr(lang, "Enabled payment methods (customer checkout)", "চালু পেমেন্ট মাধ্যম (কাস্টমার চেকআউট)")}</b>
        <div className="row">{PAYMENTS.map((m) => <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}><input type="checkbox" checked={enabled.includes(m)} style={{ width: "auto" }} onChange={(e) => setEnabled(e.target.checked ? [...enabled, m] : enabled.filter((x) => x !== m))} />{m}</label>)}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Loyalty: 1 point per (৳)", "লয়্যালটি: ১ পয়েন্ট প্রতি (৳)")}<input aria-label="Loyalty per amount" type="number" value={f.loyaltyPerAmount} onChange={num("loyaltyPerAmount")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Points to redeem", "রিডিমে পয়েন্ট")}<input aria-label="Loyalty redeem points" type="number" value={f.loyaltyRedeemPoints} onChange={num("loyaltyRedeemPoints")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Redeem value (৳)", "রিডিম মান (৳)")}<input aria-label="Loyalty redeem value" type="number" value={f.loyaltyRedeemValue} onChange={num("loyaltyRedeemValue")} /></label>
        </div>
        <b style={{ marginTop: 14 }}>{tr(lang, "Offers & Happy Hour (these values are live everywhere the moment they are saved)", "অফার ও হ্যাপি আওয়ার (সেভ করলেই সব জায়গায় চালু হবে)")}</b>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Combo: buy this many of one item", "কম্বো: এক আইটেম কতটা কিনলে")}<input aria-label="Combo minimum quantity" type="number" min={1} value={f.comboMinQty} onChange={num("comboMinQty")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Combo discount (৳)", "কম্বো ছাড় (৳)")}<input aria-label="Combo discount" type="number" min={0} value={f.comboDiscount} onChange={num("comboDiscount")} /></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Happy Hour starts", "হ্যাপি আওয়ার শুরু")}<input aria-label="Happy Hour start time" type="time" value={f.happyHourStart} onChange={str("happyHourStart")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Happy Hour ends", "হ্যাপি আওয়ার শেষ")}<input aria-label="Happy Hour end time" type="time" value={f.happyHourEnd} onChange={str("happyHourEnd")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Happy Hour discount (%)", "হ্যাপি আওয়ার ছাড় (%)")}<input aria-label="Happy Hour discount percent" type="number" min={0} value={f.happyHourPercent} onChange={num("happyHourPercent")} /></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Customer cancel window (minutes)", "কাস্টমার বাতিলের সময়সীমা (মিনিট)")}<input aria-label="Customer cancel window minutes" type="number" min={0} value={f.cancelWindowMinutes} onChange={num("cancelWindowMinutes")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Trust: Caution at cancel rate (%)", "ট্রাস্ট: সতর্ক সীমা — বাতিলের হার (%)")}<input aria-label="Trust caution percent" type="number" min={0} max={100} value={f.riskCautionPct} onChange={num("riskCautionPct")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Trust: Risky at cancel rate (%)", "ট্রাস্ট: ঝুঁকিপূর্ণ সীমা — বাতিলের হার (%)")}<input aria-label="Trust risky percent" type="number" min={0} max={100} value={f.riskRiskyPct} onChange={num("riskRiskyPct")} /></label>
        </div>
        <p className="small muted">{tr(lang, "After this many minutes the customer can no longer cancel — only the admin can. The customer can still message the admin in the chatbox. A phone number whose cancel rate reaches the Risky limit shows a red warning on its orders; at the Caution limit it shows yellow.", "এত মিনিট পর কাস্টমার আর বাতিল করতে পারবে না — তখন শুধু অ্যাডমিন বাতিল করতে পারবেন। কাস্টমার চ্যাটবক্সে অ্যাডমিনকে জানাতে পারবেন। কোনো নম্বরের বাতিলের হার ঝুঁকিপূর্ণ সীমায় পৌঁছালে তার অর্ডারে লাল সতর্কতা দেখাবে; সতর্ক সীমায় হলুদ।")}</p>
        <b style={{ marginTop: 14 }}>{tr(lang, "Live tracking & kitchen timers (minutes)", "লাইভ ট্র্যাকিং ও কিচেন টাইমার (মিনিট)")}</b>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>{tr(lang, "Prep time (minutes)", "তৈরির সময় (মিনিট)")}<input aria-label="Prep time minutes" type="number" min={0} value={f.prepMinutes} onChange={num("prepMinutes")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Delivery time (minutes)", "ডেলিভারির সময় (মিনিট)")}<input aria-label="Delivery time minutes" type="number" min={0} value={f.deliveryMinutes} onChange={num("deliveryMinutes")} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Kitchen late after (minutes)", "কিচেনে দেরি ধরা হবে (মিনিট)")}<input aria-label="Kitchen late after minutes" type="number" min={0} value={f.kitchenLateMinutes} onChange={num("kitchenLateMinutes")} /></label>
        </div>
        <p className="small muted">{tr(lang, "The Track page estimates arrival from the order time plus prep and delivery minutes. In Live Orders, an order waiting longer than the late limit turns red.", "ট্র্যাক পেজে অর্ডারের সময়ের সাথে তৈরির ও ডেলিভারির সময় যোগ করে পৌঁছানোর আনুমানিক সময় দেখায়। লাইভ অর্ডারে দেরির সীমা পেরোনো অর্ডার লাল হয়ে যায়।")}</p>
        <b style={{ marginTop: 14 }}>{tr(lang, "AI assistant (inside the customer chatbox)", "AI সহকারী (কাস্টমার চ্যাটবক্সের ভেতরে)")}</b>
        <label style={{ marginTop: 8 }}>{tr(lang, "Gemini API key", "Gemini API কী")}<input aria-label="Gemini API key" type="password" value={f.geminiApiKey} onChange={str("geminiApiKey")} placeholder="AIza…" autoComplete="off" /></label>
        <p className="small muted">{tr(lang, "The chatbox AI answers customers from the live menu and offers using this key. Restrict the key in Google Cloud Console → Credentials → API restrictions + HTTP referrers to cafe-reza.web.app ONLY before pasting it here — otherwise anyone who reads it could use it. Leave it empty and the chat still works; customers just talk to the admin directly.", "চ্যাটবক্সের AI এই কী দিয়ে লাইভ মেনু ও অফার থেকে কাস্টমারের উত্তর দেয়। এখানে বসানোর আগে Google Cloud Console → Credentials-এ কী-টিকে API restrictions ও HTTP referrers দিয়ে শুধু cafe-reza.web.app-এর জন্য সীমাবদ্ধ করুন — নইলে যে কেউ পড়ে ব্যবহার করতে পারবে। খালি রাখলে চ্যাট তবু চলবে; কাস্টমার সরাসরি অ্যাডমিনের সাথে কথা বলবেন।")}</p>
        <button className="btn-gold" style={{ marginTop: 12 }} type="submit">{tr(lang, "Save settings", "সেটিংস সংরক্ষণ করুন")}</button>
      </form>
    </div>
  );
}

function UsersTab({ userDoc, settings, lang }: { userDoc: UserDoc; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const { data: users } = useLive<UserDoc>(() => (firestore ? query(collection(firestore, "users"), orderBy("createdAt", "desc"), limit(60)) : null), userFromDoc);
  // Phone trust comes from the recent orders (same source as the
  // Live Orders badges), so a customer's history is visible here too.
  const { data: statsOrders } = useLive<Order>(() => (firestore ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(200)) : null), orderFromDoc);
  const phoneStats = useMemo(() => computePhoneStats(statsOrders), [statsOrders]);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  // Per-customer totals from the recent-orders window (the same 200
  // orders Live Orders reads). The order count comes from the user
  // doc itself, so it is the true lifetime total. Orders match by
  // user id, or by the customer's phone for counter orders placed
  // without sign-in. Cancelled/refunded orders spend nothing.
  const crm = useMemo(() => {
    const m = new Map<string, { spent: number; lastAt: string }>();
    for (const o of statsOrders) {
      if (o.status === "Cancelled" || o.status === "Refunded") continue;
      const key = o.userId || (o.phone ? `phone:${normalizePhone(o.phone)}` : "");
      if (!key) continue;
      const cur = m.get(key) ?? { spent: 0, lastAt: "" };
      cur.spent += o.total;
      if (!cur.lastAt || o.createdAt > cur.lastAt) cur.lastAt = o.createdAt;
      m.set(key, cur);
    }
    return m;
  }, [statsOrders]);
  const crmFor = (u: UserDoc) => crm.get(u.id) ?? crm.get(`phone:${normalizePhone(u.phone ?? "")}`) ?? { spent: 0, lastAt: "" };
  const shown = users.filter((u) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(needle);
  });
  const changeRole = async (u: UserDoc, role: string) => {
    if (!firestore) return;
    if (u.email === OWNER_EMAIL && role !== "admin") { setMsg(tr(lang, "The owner account must stay admin.", "মালিকের অ্যাকাউন্ট অ্যাডমিনই থাকতে হবে।")); return; }
    if (u.email === CUSTOMER_EMAIL && role !== "customer") { setMsg(tr(lang, "This account must stay an ordinary customer.", "এই অ্যাকাউন্ট সাধারণ কাস্টমারই থাকতে হবে।")); return; }
    await updateDoc(doc(firestore, "users", u.id), { role });
    audit(userDoc, "user.role", `${u.email} → ${role}`);
    setMsg(tr(lang, "Role updated.", "রোল বদলানো হয়েছে।"));
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Users & Staff", "ইউজার ও স্টাফ")}</h3>
      <p className="small muted">{tr(lang, "Staff sign in with Google, Facebook or phone, then an admin gives them a staff role here. Roles can never move the owner off admin or the pinned customer onto staff. New staff accounts are created by signing in first — there is no password to invent.", "স্টাফ Google, Facebook বা ফোনে সাইন-ইন করেন, তারপর অ্যাডমিন এখানে স্টাফ রোল দেন। রোল কখনো মালিককে অ্যাডমিন থেকে সরায় না বা নির্দিষ্ট কাস্টমারকে স্টাফ বানায় না। নতুন স্টাফ অ্যাকাউন্ট আগে সাইন-ইন করে তৈরি হয় — কোনো পাসওয়ার্ড বানানো হয় না।")}</p>
      {msg && <p className="small" role="status">{msg}</p>}
      <input aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr(lang, "Search by name, phone or email…", "নাম, ফোন বা ইমেইল দিয়ে খুঁজুন…")} style={{ marginTop: 10 }} />
      {shown.length === 0 && <p className="muted small">{tr(lang, "No customers match that search.", "এই খোঁজে কোনো কাস্টমার মেলেনি।")}</p>}
      {shown.map((u) => {
        const c = crmFor(u);
        return (
        <div key={u.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{u.name}</b> — {u.email} • {u.phone} • {u.status}
          {u.role === "customer" && <span style={{ marginLeft: 8 }}><PhoneTrustBadge stats={phoneStats.get(normalizePhone(u.phone ?? ""))} settings={settings} lang={lang} /></span>}
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {tr(lang, "Orders:", "অর্ডার:")} {u.orderCount} • {tr(lang, "Spent:", "খরচ:")} {tk(c.spent)} • {tr(lang, "Last order:", "শেষ অর্ডার:")} {c.lastAt ? fmtDate(c.lastAt) : "—"} • ⭐ {u.loyaltyPoints} {tr(lang, "pts", "পয়েন্ট")} ({u.tier})
          </p>
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Role", "রোল")}<select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => void changeRole(u, e.target.value)}><option value="customer">customer</option>{STAFF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "users", u.id), { status: u.status === "active" ? "suspended" : "active" }); }}>{u.status === "active" ? tr(lang, "Suspend", "সাসপেন্ড") : tr(lang, "Activate", "সক্রিয় করুন")}</button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

// Audit log (owner only): every recorded admin/staff action, newest
// first, straight from the `auditLogs` collection the audit()
// helper writes to. Reads are staff-only in the rules; the tab
// itself is owner-only in ADMIN_TABS.
function AuditLogTab({ lang }: { lang: Lang }) {
  const firestore = getDb();
  const { data: logs, loading } = useLive<AuditLogEntry>(() => (firestore ? query(collection(firestore, "auditLogs"), orderBy("createdAt", "desc"), limit(100)) : null),
    (id, d) => ({ id, actorName: String(d.actorName ?? ""), action: String(d.action ?? ""), detail: String(d.detail ?? ""), createdAt: tsToIso(d.createdAt) }));
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Audit Log", "অডিট লগ")}</h3>
      <p className="small muted">{tr(lang, "Who did what, and when — the newest first. Only the owner sees this.", "কে কী করল, কখন — নতুনটা আগে। শুধু মালিকই এটা দেখতে পান।")}</p>
      {loading && <p className="muted small">{tr(lang, "Loading…", "লোড হচ্ছে…")}</p>}
      {!loading && logs.length === 0 && <p className="muted small">{tr(lang, "No audit records yet.", "এখনো কোনো অডিট রেকর্ড নেই।")}</p>}
      {logs.map((l) => (
        <div key={l.id} className="card" style={{ padding: "8px 12px", marginTop: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{l.action}</b>
            <span className="small muted">{l.createdAt ? new Date(l.createdAt).toLocaleString("en-GB") : ""}</span>
          </div>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{l.actorName} — {l.detail}</p>
        </div>
      ))}
    </div>
  );
}

function SupportTab({ userDoc, products, lang }: { userDoc: UserDoc; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const { data: messages } = useLive(() => (firestore ? query(collection(firestore, "messages"), orderBy("createdAt", "desc"), limit(100)) : null),
    (id, d) => ({ id, userId: String(d.userId ?? ""), author: String(d.author ?? ""), authorName: String(d.authorName ?? ""), guestName: String(d.guestName ?? ""), guestPhone: String(d.guestPhone ?? ""), body: String(d.body ?? ""), orderNo: String(d.orderNo ?? ""), readFlag: !!d.readFlag, createdAt: tsToIso(d.createdAt) }));
  const { data: tickets } = useLive(() => (firestore ? query(collection(firestore, "tickets"), orderBy("createdAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), category: String(d.category ?? "General"), priority: String(d.priority ?? "Normal"), status: String(d.status ?? "Open"), message: String(d.message ?? ""), reply: String(d.reply ?? "") }));
  const { data: reviews } = useLive(() => (firestore ? query(collection(firestore, "reviews"), orderBy("createdAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, productId: String(d.productId ?? ""), author: String(d.author ?? ""), rating: Number(d.rating ?? 5), comment: String(d.comment ?? ""), status: String(d.status ?? "Pending") }));
  const [reply, setReply] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  // One conversation per customer, newest first — the admin sees who
  // wrote, what they last said, and how many of their messages are
  // still unread. Opening a thread marks the customer's messages
  // read, so the unread counts stay honest.
  const threads = useMemo(() => {
    const byId = new Map<string, typeof messages>();
    for (const m of messages) {
      const arr = byId.get(m.userId) ?? [];
      arr.push(m);
      byId.set(m.userId, arr);
    }
    return [...byId.entries()].map(([userId, list]) => {
      const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const unread = list.filter((m) => m.author === "customer" && !m.readFlag).length;
      const last = sorted[sorted.length - 1];
      const name = sorted.find((m) => m.author === "customer")?.authorName || sorted[0]?.guestName || sorted[0]?.authorName || userId;
      const phone = sorted.find((m) => m.guestPhone)?.guestPhone ?? "";
      return { userId, list: sorted, unread, last, name, phone };
    }).sort((a, b) => (b.last?.createdAt ?? "").localeCompare(a.last?.createdAt ?? ""));
  }, [messages]);
  const open = async (userId: string) => {
    setOpenThread(userId);
    if (!firestore) return;
    const thread = threads.find((t) => t.userId === userId);
    const unread = thread?.list.filter((m) => m.author === "customer" && !m.readFlag) ?? [];
    if (unread.length === 0) return;
    const batch = writeBatch(firestore);
    for (const m of unread) batch.update(doc(firestore, "messages", m.id), { readFlag: true });
    await batch.commit();
  };
  const sendReply = async (userId: string) => {
    if (!firestore || !reply.trim()) return;
    await addDoc(collection(firestore, "messages"), { userId, guestName: "", guestPhone: "", orderNo: "", author: "staff", authorName: userDoc.name, body: reply.trim(), readFlag: false, createdAt: serverTimestamp() });
    setReply("");
  };
  const active = threads.find((t) => t.userId === openThread) ?? null;
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Support & Reviews", "সাপোর্ট ও রিভিউ")}</h3>
      <h4 className="serif" style={{ fontSize: 18, marginTop: 14 }}>{tr(lang, "Messages", "মেসেজ")}</h4>
      {threads.length === 0 && <p className="muted small">{tr(lang, "No messages yet.", "এখনো কোনো মেসেজ নেই।")}</p>}
      {active ? (
        <div className="card" style={{ padding: 12, marginTop: 10 }}>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => setOpenThread(null)}>← {tr(lang, "All messages", "সব মেসেজ")}</button>
          <p style={{ marginTop: 8 }}><b>{active.name}</b> {active.phone && <span className="small muted">• {active.phone}</span>}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {active.list.map((m) => (
              <div key={m.id} style={{ alignSelf: m.author === "staff" ? "flex-end" : "flex-start", maxWidth: "85%", background: m.author === "staff" ? "var(--gold)" : "var(--surface)", color: m.author === "staff" ? "#fff" : "inherit", borderRadius: 12, padding: "8px 10px" }}>
                <span className="small" style={{ fontWeight: 700, opacity: 0.85 }}>{m.author === "ai" ? (<><img src="/img/logo.jpg" alt="" style={{ width: 18, height: 18, borderRadius: "50%", verticalAlign: "-4px", marginRight: 4 }} />{m.authorName}</>) : m.author === "staff" ? `🏪 ${m.authorName}` : m.authorName || tr(lang, "Customer", "কাস্টমার")}</span>
                <p className="small" style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p>
                {m.createdAt && <p className="small muted" style={{ margin: "2px 0 0" }}>{new Date(m.createdAt).toLocaleString("en-GB")}</p>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input aria-label="Staff reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tr(lang, "Write a reply…", "জবাব লিখুন…")} style={{ flex: 1 }} />
            <button className="btn-gold" onClick={() => void sendReply(active.userId)}>{tr(lang, "Send reply", "জবাব পাঠান")}</button>
          </div>
        </div>
      ) : (
        threads.map((t) => (
          <div key={t.userId} className="card" style={{ padding: 10, marginTop: 8, cursor: "pointer" }} onClick={() => void open(t.userId)}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{t.name}</b>
              {t.unread > 0 && <span style={{ background: "var(--bad)", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{t.unread} {tr(lang, "new", "নতুন")}</span>}
            </div>
            {t.phone && <p className="small muted" style={{ margin: "2px 0" }}>{t.phone}</p>}
            <p className="small" style={{ margin: "4px 0 0" }}>{t.last ? (<>{t.last.author === "staff" ? "🏪" : t.last.author === "ai" ? (<img src="/img/logo.jpg" alt="" style={{ width: 16, height: 16, borderRadius: "50%", verticalAlign: "-3px", marginRight: 3 }} />) : "👤"} {t.last.body}</>) : ""}</p>
          </div>
        ))
      )}
      <h4 className="serif" style={{ fontSize: 18, marginTop: 18 }}>{tr(lang, "Tickets", "টিকিট")}</h4>
      {tickets.length === 0 && <p className="muted small">{tr(lang, "No tickets yet.", "এখনো কোনো টিকিট নেই।")}</p>}
      {tickets.map((t) => (
        <div key={t.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{t.name} • {t.phone}</b> — {t.category} / {t.priority}
          <p className="small">{t.message}</p>
          <div className="row">
            <select aria-label={`Ticket status ${t.id}`} value={t.status} onChange={(e) => { if (firestore) void updateDoc(doc(firestore, "tickets", t.id), { status: e.target.value }); }}>{["Open", "In Progress", "Resolved", "Closed"].map((s) => <option key={s}>{s}</option>)}</select>
            <input aria-label={`Ticket reply ${t.id}`} defaultValue={t.reply} placeholder={tr(lang, "Reply…", "জবাব…")} onBlur={(e) => { if (firestore && e.target.value !== t.reply) void updateDoc(doc(firestore, "tickets", t.id), { reply: e.target.value }); }} />
          </div>
        </div>
      ))}
      <h4 className="serif" style={{ fontSize: 18, marginTop: 18 }}>{tr(lang, "Reviews", "রিভিউ")}</h4>
      {reviews.length === 0 && <p className="muted small">{tr(lang, "No reviews yet.", "এখনো কোনো রিভিউ নেই।")}</p>}
      {reviews.map((r) => {
        const p = products.find((x) => x.slug === r.productId);
        return (
          <div key={r.id} className="card" style={{ padding: 10, marginTop: 8 }}>
            <b>{r.author}</b> {"★".repeat(r.rating)} — {p ? displayName(p, lang) : r.productId} • {r.status}
            <p className="small">{r.comment}</p>
            <div className="row">
              <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "reviews", r.id), { status: "Approved" }); }}>{tr(lang, "Approve", "অনুমোদন")}</button>
              <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "reviews", r.id), { status: "Rejected" }); }}>{tr(lang, "Reject", "বাতিল")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InventoryTab({ userDoc, lang }: { userDoc: UserDoc; lang: Lang }) {
  const firestore = getDb();
  const canManage = userDoc.role === "admin" || userDoc.role === "manager";
  const { data: items } = useLive(() => (firestore ? query(collection(firestore, "inventory"), orderBy("name")) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), category: String(d.category ?? ""), unit: String(d.unit ?? "kg"), quantity: Number(d.quantity ?? 0), lowAt: Number(d.lowAt ?? 1), costPerUnit: Number(d.costPerUnit ?? 0), expiry: String(d.expiry ?? ""), supplier: String(d.supplier ?? "") }));
  const [f, setF] = useState({ name: "", category: "Other ingredients", unit: "kg", quantity: 0, lowAt: 1, costPerUnit: 0, expiry: "", supplier: "" });
  const [filter, setFilter] = useState<"all" | "low" | "expiring">("all");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    await addDoc(collection(firestore, "inventory"), { ...f, quantity: Number(f.quantity), lowAt: Number(f.lowAt), costPerUnit: Number(f.costPerUnit) });
    setF({ name: "", category: "Other ingredients", unit: "kg", quantity: 0, lowAt: 1, costPerUnit: 0, expiry: "", supplier: "" });
  };
  const lowItems = items.filter((it) => it.quantity <= it.lowAt);
  const stockValue = items.reduce((acc, it) => acc + it.quantity * it.costPerUnit, 0);
  const expiring = items.filter((it) => {
    if (!it.expiry) return false;
    const t = new Date(`${it.expiry}T00:00:00`).getTime();
    return !Number.isNaN(t) && t <= Date.now() + 7 * 86400000;
  });
  const shown = filter === "low" ? lowItems : filter === "expiring" ? expiring : items;
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Inventory", "ইনভেন্টরি")}</h3>
      {!canManage && <p className="small muted">{tr(lang, "Expenses are manager/admin only; stock viewing is open to all staff.", "খরচ শুধু ম্যানেজার/অ্যাডমিনের; স্টক সব স্টাফ দেখতে পারেন।")}</p>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{items.length}</b><p className="small">{tr(lang, "Total items", "মোট আইটেম")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{lowItems.length}</b><p className="small">{tr(lang, "Low stock", "কম স্টক")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(stockValue)}</b><p className="small">{tr(lang, "Stock value", "স্টকের মূল্য")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{expiring.length}</b><p className="small">{tr(lang, "Expiring within 7 days", "৭ দিনে মেয়াদ শেষ")}</p></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className={`chip ${filter === "all" ? "chip-on" : ""}`} onClick={() => setFilter("all")}>{tr(lang, "All", "সব")}</button>
        <button className={`chip ${filter === "low" ? "chip-on" : ""}`} onClick={() => setFilter("low")}>{tr(lang, "Low stock", "কম স্টক")}</button>
        <button className={`chip ${filter === "expiring" ? "chip-on" : ""}`} onClick={() => setFilter("expiring")}>{tr(lang, "Expiring soon", "মেয়াদ শেষের কাছাকাছি")}</button>
      </div>
      <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Item name", "আইটেমের নাম")}<input aria-label="Inventory item name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>{tr(lang, "Quantity", "পরিমাণ")}<input aria-label="Quantity" type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Unit", "একক")}<input aria-label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Low-stock at", "কম স্টক সীমা")}<input aria-label="Low stock at" type="number" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: Number(e.target.value) })} /></label>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>{tr(lang, "Cost per unit (৳)", "প্রতি একক খরচ (৳)")}<input aria-label="Cost per unit" type="number" value={f.costPerUnit} onChange={(e) => setF({ ...f, costPerUnit: Number(e.target.value) })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Supplier", "সরবরাহকারী")}<input aria-label="Supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Expiry (date)", "মেয়াদ (তারিখ)")}<input aria-label="Expiry date" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
        </div>
        <button className="btn-gold" type="submit">{tr(lang, "Add item", "আইটেম যোগ করুন")}</button>
      </form>
      {shown.length === 0 && <p className="muted small" style={{ marginTop: 10 }}>{tr(lang, "No items in this view.", "এই ভিউতে কোনো আইটেম নেই।")}</p>}
      {shown.map((it) => (
        <div key={it.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{it.name}</b> — {it.quantity} {it.unit} {it.quantity <= it.lowAt && <span style={{ color: "var(--bad)" }}>• {tr(lang, "LOW", "কম")}</span>}
          <p className="small muted" style={{ margin: "2px 0" }}>{it.category}{it.supplier ? ` • ${it.supplier}` : ""}{it.expiry ? ` • ${tr(lang, "expiry", "মেয়াদ")} ${it.expiry}` : ""} • {tr(lang, "cost", "খরচ")} {tk(it.costPerUnit)}/{it.unit} • {tr(lang, "value", "মূল্য")} {tk(it.quantity * it.costPerUnit)}</p>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="chip" onClick={() => { if (firestore) void updateDoc(doc(firestore, "inventory", it.id), { quantity: it.quantity + 1 }); }}>+1</button>
            <button className="chip" onClick={() => { if (firestore) void updateDoc(doc(firestore, "inventory", it.id), { quantity: Math.max(0, it.quantity - 1) }); }}>−1</button>
            <button className="btn-danger" style={{ padding: "4px 10px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "inventory", it.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FirebaseTab({ userDoc, lang, onSeed, seedBusy, seedMsg }: { userDoc: UserDoc; lang: Lang; onSeed: () => void; seedBusy: boolean; seedMsg: string }) {
  const firestore = getDb();
  const [probe, setProbe] = useState<{ state: string; detail: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const check = async () => { setProbing(true); setProbe(await probeFirestore()); setProbing(false); };
  // ---- Data backup (owner only tab) ----
  // Export reads every collection as it is right now and downloads it
  // as one JSON file. Firestore Timestamps become ISO strings, so the
  // file is plain JSON. Restore writes it back — but ONLY the
  // admin-writable collections (products, categories, coupons,
  // settings, tables, suppliers, expenses, inventory). Orders,
  // reservations, users, messages, reviews and audit logs are exported
  // for safekeeping but are NOT restored from the browser: the rules
  // forbid creating another customer's order from the client, and
  // restoring them would rewrite other people's data.
  const [backupMsg, setBackupMsg] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<{ name: string; collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>> } | null>(null);
  const toPlain = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof (v as { toDate?: unknown })?.toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString();
    if (Array.isArray(v)) return v.map(toPlain);
    if (typeof v === "object") { const out: Record<string, unknown> = {}; for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toPlain(val); return out; }
    return v;
  };
  const fromPlain = (docData: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...docData };
    for (const k of ["createdAt", "updatedAt", "reminderAt"]) {
      const v = out[k];
      if (typeof v === "string" && !Number.isNaN(Date.parse(v))) out[k] = new Date(v);
    }
    return out;
  };
  const exportBackup = async () => {
    if (!firestore) return;
    setBackupBusy(true); setBackupMsg(""); setRestoreFile(null);
    try {
      const names = ["products", "categories", "orders", "coupons", "users", "settings", "reservations", "tables", "suppliers", "expenses", "reviews", "inventory", "auditLogs", "messages"];
      const collections: Record<string, Array<{ id: string; data: unknown }>> = {};
      for (const name of names) {
        const snap = await getDocs(collection(firestore, name));
        collections[name] = snap.docs.map((d) => ({ id: d.id, data: toPlain(d.data()) }));
      }
      const total = Object.values(collections).reduce((n, arr) => n + arr.length, 0);
      const blob = new Blob([JSON.stringify({ app: "cafe-reza", version: 1, exportedAt: new Date().toISOString(), collections }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cafe-reza-backup-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      audit(userDoc, "backup.export", `${total} docs`);
      setBackupMsg(tr(lang, `Backup downloaded — ${total} records.`, `ব্যাকআপ ডাউনলোড হয়েছে — ${total}টি রেকর্ড।`));
    } catch (e) { setBackupMsg(`${tr(lang, "Backup failed:", "ব্যাকআপ ব্যর্থ:")} ${(e as Error).message}`); }
    setBackupBusy(false);
  };
  const readRestoreFile = async (file: File | undefined) => {
    setBackupMsg(""); setRestoreFile(null);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; collections?: Record<string, Array<{ id: string; data: Record<string, unknown> }>> };
      if (!parsed.collections || typeof parsed.collections !== "object") { setBackupMsg(tr(lang, "That file is not a Café Reza backup.", "এই ফাইলটি ক্যাফে রেজার ব্যাকআপ নয়।")); return; }
      setRestoreFile({ name: file.name, collections: parsed.collections });
    } catch { setBackupMsg(tr(lang, "Could not read that file — it is not valid JSON.", "ফাইলটি পড়া যায়নি — এটি সঠিক JSON নয়।")); }
  };
  const restoreBackup = async () => {
    if (!firestore || !restoreFile) return;
    const restorable = ["products", "categories", "coupons", "settings", "tables", "suppliers", "expenses", "inventory"];
    const counts = restorable.map((n) => `${n}: ${(restoreFile.collections[n] ?? []).length}`).join(", ");
    if (!window.confirm(tr(lang, `Restore this backup? It OVERWRITES the current ${counts}. Orders, reservations, users, messages, reviews and audit logs are NOT restored — they stay as they are. This cannot be undone.`, `এই ব্যাকআপটি ফেরত বসাবেন? এটি বর্তমান ডেটা ওভাররাইট করবে — ${counts}। অর্ডার, রিজার্ভেশন, ইউজার, মেসেজ, রিভিউ ও অডিট লগ ফেরত বসানো হবে না — সেগুলো যেমন আছে তেমনই থাকবে। এটি আর ফেরানো যাবে না।`))) return;
    setBackupBusy(true); setBackupMsg("");
    try {
      let written = 0;
      let batch = writeBatch(firestore);
      let inBatch = 0;
      const flush = async () => { if (inBatch === 0) return; await batch.commit(); batch = writeBatch(firestore); inBatch = 0; };
      for (const name of restorable) {
        for (const item of restoreFile.collections[name] ?? []) {
          if (!item.id || typeof item.data !== "object" || item.data === null) continue;
          batch.set(doc(firestore, name, item.id), fromPlain(item.data), { merge: false });
          written++; inBatch++;
          if (inBatch >= 400) await flush();
        }
      }
      await flush();
      audit(userDoc, "backup.restore", `${restoreFile.name} — ${written} docs`);
      setRestoreFile(null);
      setBackupMsg(tr(lang, `Restore done — ${written} records written.`, `ফেরত বসানো শেষ — ${written}টি রেকর্ড লেখা হয়েছে।`));
    } catch (e) { setBackupMsg(`${tr(lang, "Restore failed:", "ফেরত বসানো ব্যর্থ:")} ${(e as Error).message}`); }
    setBackupBusy(false);
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Firebase & Launch", "Firebase ও লঞ্চ")}</h3>
      <div className="card" style={{ padding: 14, marginTop: 10 }}>
        <b>{tr(lang, "Connection check (live, never assumed)", "সংযোগ যাচাই (লাইভ, অনুমান নয়)")}</b>
        <p className="small muted">{probe ? probe.detail : tr(lang, "Press the button for the live Firestore status.", "লাইভ Firestore অবস্থার জন্য বোতামে চাপুন।")}</p>
        <button className="btn-gold" disabled={probing} onClick={() => void check()}>{probing ? tr(lang, "Checking…", "যাচাই হচ্ছে…") : tr(lang, "Check Firestore connection", "Firestore সংযোগ যাচাই করুন")}</button>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Seed the real catalog", "আসল ক্যাটালগ বসান")}</b>
        <p className="small muted">{tr(lang, "Writes the 26 products and 9 categories (owner's printed menu prices) only where Firestore is empty. Never overwrites an admin-edited price or stock.", "২৬টি প্রোডাক্ট ও ৯টি ক্যাটাগরি (মালিকের ছাপা মেনুর দাম) শুধু খালি জায়গায় লেখে। অ্যাডমিনের বদলানো দাম বা স্টক কখনো ওভাররাইট করে না।")}</p>
        <button className="btn-gold" disabled={seedBusy} onClick={onSeed}>{seedBusy ? tr(lang, "Seeding…", "বসানো হচ্ছে…") : tr(lang, "Seed catalog", "ক্যাটালগ বসান")}</button>
        {seedMsg && <p className="small" role="status">{seedMsg}</p>}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Data backup", "ডেটা ব্যাকআপ")}</b>
        <p className="small muted">{tr(lang, "Export downloads every collection as it is right now (products, categories, orders, coupons, users, settings, reservations, tables, suppliers, expenses, reviews, inventory, audit log, messages) as one JSON file. Keep it somewhere safe.", "এক্সপোর্ট করলে সব কালেকশন এখন যেমন আছে তেমনই (প্রোডাক্ট, ক্যাটাগরি, অর্ডার, কুপন, ইউজার, সেটিংস, রিজার্ভেশন, টেবিল, সরবরাহকারী, খরচ, রিভিউ, ইনভেন্টরি, অডিট লগ, মেসেজ) একটি JSON ফাইলে ডাউনলোড হবে। নিরাপদ জায়গায় রাখুন।")}</p>
        <div className="row">
          <button className="btn-gold" disabled={backupBusy} onClick={() => void exportBackup()}>{backupBusy ? tr(lang, "Working…", "কাজ হচ্ছে…") : tr(lang, "Export backup (JSON)", "ব্যাকআপ এক্সপোর্ট (JSON)")}</button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{tr(lang, "Orders CSV lives in Analytics → “Download orders CSV (this period)”.", "অর্ডারের CSV আছে অ্যানালাইসিস → “অর্ডারের CSV ডাউনলোড (এই সময়ের)”-এ।")}</p>
        <b style={{ display: "block", marginTop: 12 }}>{tr(lang, "Import / Restore", "ইমপোর্ট / ফেরত বসান")}</b>
        <p className="small muted">{tr(lang, "Pick a backup file made by Export above. It OVERWRITES the current catalog, coupons, settings, tables, suppliers, expenses and inventory with the file. Orders, reservations, users, messages, reviews and audit logs are NOT restored — they stay as they are.", "উপরে এক্সপোর্ট করা ব্যাকআপ ফাইল বেছে নিন। এটি বর্তমান ক্যাটালগ, কুপন, সেটিংস, টেবিল, সরবরাহকারী, খরচ ও ইনভেন্টরি ফাইলের ডেটা দিয়ে ওভাররাইট করবে। অর্ডার, রিজার্ভেশন, ইউজার, মেসেজ, রিভিউ ও অডিট লগ ফেরত বসানো হবে না — সেগুলো যেমন আছে তেমনই থাকবে।")}</p>
        <input aria-label={tr(lang, "Choose a backup file", "ব্যাকআপ ফাইল বেছে নিন")} type="file" accept=".json,application/json" onChange={(e) => void readRestoreFile(e.target.files?.[0])} />
        {restoreFile && (
          <div className="card" style={{ padding: 12, marginTop: 10, border: "2px solid var(--bad)" }}>
            <b>{restoreFile.name}</b>
            <p className="small" style={{ marginTop: 6 }}>{Object.entries(restoreFile.collections).map(([n, arr]) => `${n}: ${arr.length}`).join(" • ")}</p>
            <p className="small" style={{ color: "var(--bad)", fontWeight: 600 }}>{tr(lang, "Warning: restoring overwrites the current data listed above. This cannot be undone — export a fresh backup first if you are unsure.", "সতর্কতা: ফেরত বসালে উপরের বর্তমান ডেটা ওভাররাইট হবে। এটি আর ফেরানো যাবে না — নিশ্চিত না হলে আগে নতুন একটি ব্যাকআপ এক্সপোর্ট করে নিন।")}</p>
            <button className="btn-danger" disabled={backupBusy} onClick={() => void restoreBackup()}>{backupBusy ? tr(lang, "Restoring…", "ফেরত বসানো হচ্ছে…") : tr(lang, "Restore this backup", "এই ব্যাকআপটি ফেরত বসান")}</button>
          </div>
        )}
        {backupMsg && <p className="small" role="status" style={{ marginTop: 8 }}>{backupMsg}</p>}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Launch order — admin first, then customers", "লঞ্চের ক্রম — আগে অ্যাডমিন, তারপর কাস্টমার")}</b>
        <ol className="small" style={{ marginTop: 6 }}>
          <li>1. {tr(lang, "Deploy rules + hosting: firebase deploy --only firestore:rules,storage,hosting. Open #/admin, sign in, verify the dashboard — share the admin link first.", "Rules + হোস্টিং ডেপ্লয় করুন: firebase deploy --only firestore:rules,storage,hosting। #/admin খুলে সাইন-ইন করে ড্যাশবোর্ড যাচাই করুন — অ্যাডমিন লিংক আগে শেয়ার করুন।")}</li>
          <li>2. {tr(lang, "Add the hosting domain to Firebase Console → Authentication → Settings → Authorized domains. Enable Google, Facebook and Phone providers.", "হোস্টিং ডোমেইনটি Firebase Console → Authentication → Settings → Authorized domains-এ যোগ করুন। Google, Facebook ও Phone চালু করুন।")}</li>
          <li>3. {tr(lang, "Only then publish the customer link (#/) for ordering and marketing.", "তারপরই কাস্টমার লিংক (#/) অর্ডার ও মার্কেটিংয়ের জন্য প্রকাশ করুন।")}</li>
        </ol>
        <p className="small muted">{tr(lang, "Build env vars (names only): VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APPCHECK_KEY (optional). Values come from Firebase Console → Project settings → Your apps → “Cafe Reza Web”.", "বিল্ডের env var (শুধু নাম): VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APPCHECK_KEY (ঐচ্ছিক)। মান Firebase Console → Project settings → Your apps → “Cafe Reza Web” থেকে নিতে হবে।")}</p>
      </div>
      <InstallAppCard variant="admin" lang={lang} />
    </div>
  );
}

type AdminTabDef = { id: string; en: string; bn: string; icon: string; group: string; roles: string[]; ownerOnly?: boolean };
const MENU_GROUPS: Array<{ id: string; en: string; bn: string }> = [
  { id: "business", en: "Business", bn: "ব্যবসা" },
  { id: "orders", en: "Orders & Service", bn: "অর্ডার ও সেবা" },
  { id: "products", en: "Products", bn: "প্রোডাক্ট" },
  { id: "marketing", en: "Marketing", bn: "মার্কেটিং" },
  { id: "manage", en: "Manage", bn: "পরিচালনা" },
];
const ADMIN_TABS: AdminTabDef[] = [
  { id: "owner", en: "Owner", bn: "মালিক", icon: "👑", group: "business", roles: ["admin"], ownerOnly: true },
  { id: "dashboard", en: "Dashboard", bn: "ড্যাশবোর্ড", icon: "📊", group: "business", roles: ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"] },
  { id: "orders", en: "Live Orders / Kitchen", bn: "লাইভ অর্ডার / কিচেন", icon: "🍳", group: "orders", roles: ["admin", "manager", "cashier", "kitchen", "waiter", "delivery"] },
  { id: "pos", en: "POS", bn: "POS", icon: "🧾", group: "orders", roles: ["admin", "manager", "cashier"] },
  { id: "analytics", en: "Analytics", bn: "অ্যানালাইসিস", icon: "📈", group: "business", roles: ["admin"], ownerOnly: true },
  { id: "finance", en: "Finance", bn: "আয়-ব্যয়", icon: "💰", group: "business", roles: ["admin"], ownerOnly: true },
  { id: "products", en: "Products & Categories", bn: "প্রোডাক্ট ও ক্যাটাগরি", icon: "🛍️", group: "products", roles: ["admin", "manager", "inventory"] },
  { id: "reservations", en: "Tables & Reservations", bn: "টেবিল ও রিজার্ভেশন", icon: "🪑", group: "orders", roles: ["admin", "manager", "cashier", "waiter"] },
  { id: "coupons", en: "Coupons & Offers", bn: "কুপন ও অফার", icon: "🎟️", group: "marketing", roles: ["admin", "manager"] },
  { id: "ads", en: "Ads", bn: "বিজ্ঞাপন", icon: "📢", group: "marketing", roles: ["admin", "manager"] },
  { id: "content", en: "Content & Banners", bn: "কনটেন্ট ও ব্যানার", icon: "🖼️", group: "marketing", roles: ["admin", "manager"] },
  { id: "inventory", en: "Inventory", bn: "ইনভেন্টরি", icon: "📦", group: "products", roles: ["admin", "manager", "inventory"] },
  { id: "users", en: "Users & Staff", bn: "ইউজার ও স্টাফ", icon: "👥", group: "manage", roles: ["admin"], ownerOnly: true },
  { id: "support", en: "Support & Reviews", bn: "সাপোর্ট ও রিভিউ", icon: "💬", group: "manage", roles: ["admin", "manager", "cashier"] },
  { id: "settings", en: "Settings", bn: "সেটিংস", icon: "⚙️", group: "manage", roles: ["admin"], ownerOnly: true },
  { id: "audit", en: "Audit Log", bn: "অডিট লগ", icon: "📋", group: "manage", roles: ["admin"], ownerOnly: true },
  { id: "firebase", en: "Firebase & Launch", bn: "Firebase ও লঞ্চ", icon: "🔥", group: "manage", roles: ["admin"], ownerOnly: true },
  { id: "apps", en: "Apps", bn: "অ্যাপস", icon: "📱", group: "manage", roles: ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"] },
];

function PeriodButtons({ period, setPeriod, lang }: { period: Period; setPeriod: (p: Period) => void; lang: Lang }) {
  const opts: Array<[Period, string, string]> = [["today", "Today", "আজ"], ["7d", "Last 7 days", "৭ দিন"], ["30d", "Last 30 days", "৩০ দিন"], ["all", "All time", "সব"]];
  return (
    <div className="row" style={{ marginTop: 8 }}>
      {opts.map(([v, en, bn]) => <button key={v} className={`chip ${period === v ? "chip-on" : ""}`} onClick={() => setPeriod(v)}>{lang === "bn" ? bn : en}</button>)}
    </div>
  );
}

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}><span className="small">{label}</span><b className="small">{suffix}</b></div>
      <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, marginTop: 2 }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} /></div>
    </div>
  );
}

// Ads: a dedicated tab (it used to live inside Content). Slots are off by
// default; enabling one shows it on the customer site at that placement.
function AdsTab({ userDoc, settings, lang }: { userDoc: UserDoc; settings: Settings; lang: Lang }) {
  const firestore = getDb();
  const [ads, setAds] = useState(parseAds(settings.adsJson));
  const [msg, setMsg] = useState("");
  useEffect(() => { setAds(parseAds(settings.adsJson)); }, [settings.adsJson]);
  const save = async () => {
    if (!firestore) return;
    await setDoc(doc(firestore, "settings", "cafe"), { adsJson: JSON.stringify(ads) }, { merge: true });
    audit(userDoc, "ads.save", "Ad placements updated.");
    setMsg(tr(lang, "Saved — the customer site updates at once.", "সংরক্ষিত হয়েছে — কাস্টমার সাইট সাথে সাথে বদলে যাবে।"));
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Ads", "বিজ্ঞাপন")}</h3>
      <p className="small muted">{tr(lang, "Ads are off by default. Enable a slot to show it on the customer site at that place — your own banner image + link, or an embed code. No ad network is connected, so there is no ad income or click tracking here.", "বিজ্ঞাপন ডিফল্টে বন্ধ থাকে। চালু করলে কাস্টমার সাইটের ওই জায়গায় দেখাবে — নিজের ব্যানার ছবি + লিংক, অথবা এমবেড কোড। কোনো বিজ্ঞাপন নেটওয়ার্ক যুক্ত নেই, তাই আয় বা ক্লিকের হিসাব এখানে আসে না।")}</p>
      {msg && <p className="small" role="status">{msg}</p>}
      {ads.map((slot, i) => (
        <div key={slot.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={slot.enabled} style={{ width: "auto" }} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, enabled: e.target.checked } : a))} />{AD_SLOT_DEFS.find((d) => d.id === slot.id)?.label ?? slot.id}</label>
          <label>{tr(lang, "Type", "ধরন")}<select aria-label={`Ad type ${slot.id}`} value={slot.kind} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, kind: e.target.value as "image" | "code" } : a))}><option value="image">Banner image + link</option><option value="code">Embed code (sandboxed)</option></select></label>
          {slot.kind === "image" ? <>
            <label>{tr(lang, "Image URL", "ছবির লিংক")}<input aria-label={`Ad image ${slot.id}`} value={slot.imageUrl} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, imageUrl: e.target.value } : a))} /></label>
            <label>{tr(lang, "Link URL", "লিংক")}<input aria-label={`Ad link ${slot.id}`} value={slot.linkUrl} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, linkUrl: e.target.value } : a))} /></label>
          </> : <label>{tr(lang, "Embed code", "এমবেড কোড")}<textarea aria-label={`Ad code ${slot.id}`} rows={3} value={slot.code} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, code: e.target.value } : a))} /></label>}
        </div>
      ))}
      <button className="btn-gold" style={{ marginTop: 12 }} onClick={() => void save()}>{tr(lang, "Save ads", "বিজ্ঞাপন সংরক্ষণ করুন")}</button>
    </div>
  );
}

// Analytics (owner only): real Firestore orders only — never fake figures.
// Revenue counts Completed/Delivered orders; Cancelled/Refunded are excluded.
function AnalyticsTab({ orders, products, categories, lang }: { orders: Order[]; products: Product[]; categories: Category[]; lang: Lang }) {
  const [period, setPeriod] = useState<Period>("30d");
  const list = orders.filter((o) => inPeriod(o, period));
  const live = list.filter(LIVE_ORDER);
  const revenue = realized(live);
  const completed = live.filter((o) => o.status === "Completed" || o.status === "Delivered");
  const aov = completed.length > 0 ? Math.round(revenue / completed.length) : 0;
  // Every money breakdown (best sellers, by category, by payment,
  // discounts) uses ONLY the completed / delivered orders — the same
  // set the Revenue headline counts — so the parts always add up to
  // the headline. Using all live orders here used to sum past it.
  const discount = completed.reduce((a, o) => a + o.discount, 0);
  const cancelled = list.filter((o) => o.status === "Cancelled").length;
  const best = (() => {
    const m = new Map<string, { name: string; qty: number; rev: number }>();
    completed.forEach((o) => o.items.forEach((it) => { const cur = m.get(it.productId) ?? { name: itemName(products, it, lang), qty: 0, rev: 0 }; cur.qty += it.qty; cur.rev += it.price * it.qty; m.set(it.productId, cur); }));
    return [...m.entries()].map(([slug, v]) => ({ slug, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 8);
  })();
  const byCat = (() => {
    const m = new Map<string, number>();
    const prodBySlug = new Map(products.map((p) => [p.slug, p]));
    completed.forEach((o) => o.items.forEach((it) => { const p = prodBySlug.get(it.productId); const cid = p?.categoryId ?? ""; m.set(cid, (m.get(cid) ?? 0) + it.price * it.qty); }));
    const rows = [...m.entries()].map(([cid, rev]) => {
      const cat = categories.find((c) => c.id === cid);
      return { name: cat ? (lang === "bn" ? cat.nameBn : cat.nameEn) : tr(lang, "Other", "অন্যান্য"), rev };
    }).sort((a, b) => b.rev - a.rev);
    // Delivery fees are part of the order total (and of the Revenue
    // headline), but they belong to no product category — the old code
    // left them out, so the category bars summed ৳40 short of Revenue
    // on a delivered order with a delivery fee. Show them as their own
    // line so the parts add up to the headline.
    const delivery = completed.reduce((a, o) => a + (o.deliveryFee ?? 0), 0);
    if (delivery > 0) rows.push({ name: tr(lang, "Delivery", "ডেলিভারি"), rev: delivery });
    return rows.sort((a, b) => b.rev - a.rev);
  })();
  const byPayment = (() => {
    const m = new Map<string, { n: number; rev: number }>();
    completed.forEach((o) => { const cur = m.get(o.paymentMethod) ?? { n: 0, rev: 0 }; cur.n += 1; cur.rev += o.total; m.set(o.paymentMethod, cur); });
    return [...m.entries()].sort((a, b) => b[1].rev - a[1].rev);
  })();
  const byHour = (() => {
    const blocks = [0, 0, 0, 0, 0, 0];
    // Counts every order in the period (all statuses), so the blocks
    // add up to the Orders headline below.
    list.forEach((o) => { const h = new Date(o.createdAt).getHours(); if (!Number.isNaN(h)) { const bi = Math.floor(h / 4); blocks[bi] = (blocks[bi] ?? 0) + 1; } });
    return blocks;
  })();
  const maxBest = best[0]?.qty ?? 0;
  const maxCat = byCat[0]?.rev ?? 0;
  // The "Popular" badge on the customer menu is driven by these real
  // sales: one tap marks the top 5 sellers as Popular and clears the
  // badge from the rest, so the menu always shows what actually sells.
  const [syncMsg, setSyncMsg] = useState("");
  const syncBestSellers = async () => {
    const firestore = getDb();
    if (!firestore) return;
    if (best.length === 0) { setSyncMsg(tr(lang, "No sales in this period — nothing to sync.", "এই সময়ে কোনো বিক্রি নেই — সিঙ্ক করার কিছু নেই।")); return; }
    const top = new Set(best.slice(0, 5).map((b) => b.slug));
    const batch = writeBatch(firestore);
    let changed = 0;
    products.forEach((p) => {
      const want = top.has(p.slug);
      if (p.bestSeller !== want) { batch.update(doc(firestore, "products", p.slug), { bestSeller: want }); changed++; }
    });
    if (changed === 0) { setSyncMsg(tr(lang, "The Popular badges are already up to date.", "জনপ্রিয় ব্যাজগুলো ইতিমধ্যেই হালনাগাদ আছে।")); return; }
    await batch.commit();
    setSyncMsg(tr(lang, `${changed} products updated — the top ${top.size} sellers now show the Popular badge on the menu.`, `${changed}টি প্রোডাক্ট বদলানো হয়েছে — সেরা ${top.size}টি এখন মেনুতে জনপ্রিয় ব্যাজ দেখাবে।`));
  };
  const downloadCsv = () => {
    const rows: string[][] = [["Order", "Date", "Customer", "Phone", "Items", "Total", "Status", "Payment", "PaymentStatus"]];
    list.forEach((o) => rows.push([o.orderNo, o.createdAt, o.customerName, o.phone, o.items.map((it) => `${it.qty}x ${itemName(products, it, lang)}`).join("; "), String(o.total), o.status, o.paymentMethod, o.paymentStatus]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "cafe-reza-orders.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Analytics", "অ্যানালাইসিস")}</h3>
      <p className="small muted">{tr(lang, "Real orders from Firestore only. Orders counts every order in this period. Revenue and the money breakdowns count only Completed / Delivered orders; Cancelled / Refunded are excluded.", "শুধু Firestore-এর আসল অর্ডার। অর্ডার সংখ্যা এই সময়ের সব অর্ডার। আয় আর টাকার ভাগগুলো শুধু সম্পন্ন / ডেলিভার্ড অর্ডার; বাতিল / ফেরত বাদ।")}</p>
      <PeriodButtons period={period} setPeriod={setPeriod} lang={lang} />
      <DigitalAnalyzer orders={list} products={products} lang={lang} period={period} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(revenue)}</b><p className="small">{tr(lang, "Revenue", "আয়")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{list.length}</b><p className="small">{tr(lang, "Orders", "অর্ডার")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(aov)}</b><p className="small">{tr(lang, "Average order value", "গড় অর্ডার মূল্য")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(discount)}</b><p className="small">{tr(lang, "Discounts given", "দেওয়া ছাড়")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{cancelled}</b><p className="small">{tr(lang, "Cancelled", "বাতিল")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{list.reduce((a, o) => a + o.deliveryFee, 0) > 0 ? tk(list.reduce((a, o) => a + o.deliveryFee, 0)) : "—"}</b><p className="small">{tr(lang, "Delivery fees", "ডেলিভারি ফি")}</p></div>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Best sellers", "সেরা বিক্রি")}</b>
        {best.length === 0 ? <p className="small muted">{tr(lang, "No orders in this period.", "এই সময়ে কোনো অর্ডার নেই।")}</p> : best.map((b) => <Bar key={b.name} label={`${b.name} × ${b.qty}`} value={b.qty} max={maxBest} suffix={tk(b.rev)} />)}
        <p className="small muted" style={{ marginTop: 10 }}>{tr(lang, "The Popular badge on the menu comes from these real sales. Sync it when the top sellers change.", "মেনুর জনপ্রিয় ব্যাজ এই আসল বিক্রি থেকেই আসে। সেরা বিক্রি বদলালে এখানে সিঙ্ক করুন।")}</p>
        <button className="btn-gold" onClick={() => void syncBestSellers()}>{tr(lang, "Mark top 5 as Popular on the menu", "সেরা ৫টিকে মেনুতে জনপ্রিয় করুন")}</button>
        {syncMsg && <p className="small" role="status" style={{ marginTop: 6 }}>{syncMsg}</p>}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Revenue by category", "ক্যাটাগরি অনুযায়ী আয়")}</b>
        {byCat.length === 0 ? <p className="small muted">{tr(lang, "No orders in this period.", "এই সময়ে কোনো অর্ডার নেই।")}</p> : byCat.map((c) => <Bar key={c.name} label={c.name} value={c.rev} max={maxCat} suffix={tk(c.rev)} />)}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "By payment method", "পেমেন্ট মাধ্যম অনুযায়ী")}</b>
        {byPayment.length === 0 ? <p className="small muted">{tr(lang, "No orders in this period.", "এই সময়ে কোনো অর্ডার নেই।")}</p> : byPayment.map(([m, v]) => <p key={m} className="small">{m} — {v.n} {tr(lang, "orders", "অর্ডার")} • {tk(v.rev)}</p>)}
        <b style={{ display: "block", marginTop: 12 }}>{tr(lang, "By order status", "অর্ডারের অবস্থা অনুযায়ী")}</b>
        {ORDER_STATUSES.map((st) => { const n = list.filter((o) => o.status === st).length; return n > 0 ? <p key={st} className="small">{st} — {n}</p> : null; })}
        <b style={{ display: "block", marginTop: 12 }}>{tr(lang, "Orders by 4-hour block", "৪ ঘণ্টার ব্লক অনুযায়ী অর্ডার")}</b>
        {byHour.map((n, i) => <p key={i} className="small">{`${String(i * 4).padStart(2, "0")}:00–${String(i * 4 + 4).padStart(2, "0")}:00`} — {n}</p>)}
      </div>
      <button className="btn-gold" style={{ marginTop: 12 }} onClick={downloadCsv}>{tr(lang, "Download orders CSV (this period)", "অর্ডারের CSV ডাউনলোড (এই সময়ের)")}</button>
    </div>
  );
}

// Finance (owner only): income, expenses, profit and cash — revenue is
// never confused with profit.
function FinanceTab({ userDoc, orders, lang }: { userDoc: UserDoc; orders: Order[]; lang: Lang }) {
  const firestore = getDb();
  const { data: expenses } = useLive<Expense>(() => (firestore ? query(collection(firestore, "expenses"), orderBy("date", "desc"), limit(200)) : null), expenseFromDoc);
  const { data: suppliers } = useLive<Supplier>(() => (firestore ? query(collection(firestore, "suppliers"), orderBy("name")) : null), supplierFromDoc);
  const [period, setPeriod] = useState<Period>("30d");
  const [f, setF] = useState({ date: todayKey(), category: "কাঁচামাল", description: "", amount: 0, supplier: "" });
  const [sup, setSup] = useState({ name: "", phone: "", item: "", notes: "" });
  const [msg, setMsg] = useState("");
  const [supMsg, setSupMsg] = useState("");
  const expInPeriod = expenses.filter((e) => {
    if (period === "all") return true;
    if (period === "today") return e.date === todayKey();
    const days = period === "7d" ? 7 : 30;
    const t = new Date(`${e.date}T00:00:00`).getTime();
    return !Number.isNaN(t) && t >= Date.now() - days * 86400000;
  });
  const list = orders.filter((o) => inPeriod(o, period));
  const live = list.filter(LIVE_ORDER);
  const revenue = realized(live);
  const expTotal = expInPeriod.reduce((a, e) => a + e.amount, 0);
  const profit = revenue - expTotal;
  const discount = live.reduce((a, o) => a + o.discount, 0);
  const deliveryFees = live.reduce((a, o) => a + o.deliveryFee, 0);
  const paidByMethod = (() => {
    const m = new Map<string, number>();
    live.forEach((o) => { if (o.paidAmount > 0) m.set(o.paymentMethod, (m.get(o.paymentMethod) ?? 0) + o.paidAmount); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const unpaid = live.reduce((a, o) => a + Math.max(0, o.total - o.paidAmount), 0);
  const addExpense = async () => {
    if (!firestore || f.amount <= 0 || !f.description.trim()) { setMsg(tr(lang, "Enter a description and an amount above 0.", "বিবরণ ও ০-এর বেশি টাকা লিখুন।")); return; }
    await addDoc(collection(firestore, "expenses"), { category: f.category, description: f.description.trim(), amount: f.amount, date: f.date, supplier: f.supplier, createdAt: serverTimestamp() });
    audit(userDoc, "expense.add", `${f.category} — ${f.description.trim()} ৳${f.amount}${f.supplier ? ` (${f.supplier})` : ""}`);
    setF({ date: todayKey(), category: "কাঁচামাল", description: "", amount: 0, supplier: "" });
    setMsg(tr(lang, "Expense saved.", "খরচ সংরক্ষণ হয়েছে।"));
  };
  const addSupplier = async () => {
    if (!firestore || !sup.name.trim()) { setSupMsg(tr(lang, "Enter the supplier's name.", "সরবরাহকারীর নাম লিখুন।")); return; }
    await addDoc(collection(firestore, "suppliers"), { name: sup.name.trim(), phone: sup.phone.trim(), item: sup.item.trim(), notes: sup.notes.trim() });
    audit(userDoc, "supplier.add", sup.name.trim());
    setSup({ name: "", phone: "", item: "", notes: "" });
    setSupMsg(tr(lang, "Supplier saved.", "সরবরাহকারী সংরক্ষণ হয়েছে।"));
  };
  // Supplier totals are all-time (not the selected period), so the
  // owner sees the full spend per supplier at a glance. Expenses with
  // no supplier are grouped under "No supplier".
  const supplierTotals = (() => {
    const m = new Map<string, number>();
    expenses.forEach((e) => m.set(e.supplier || "", (m.get(e.supplier || "") ?? 0) + e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Finance", "আয়-ব্যয়")}</h3>
      <p className="small muted">{tr(lang, "Revenue is not profit: profit = revenue − expenses. Cash figures count only money actually received (paidAmount).", "আয় আর লাভ এক নয়: লাভ = আয় − খরচ। নগদ হিসাব শুধু আসলে পাওয়া টাকা (paidAmount) ধরে।")}</p>
      <PeriodButtons period={period} setPeriod={setPeriod} lang={lang} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(revenue)}</b><p className="small">{tr(lang, "Revenue (Completed / Delivered)", "আয় (সম্পন্ন / ডেলিভার্ড)")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(expTotal)}</b><p className="small">{tr(lang, "Expenses", "খরচ")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(profit)}</b><p className="small">{tr(lang, "Estimated profit", "আনুমানিক লাভ")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(discount)}</b><p className="small">{tr(lang, "Discounts given", "দেওয়া ছাড়")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(deliveryFees)}</b><p className="small">{tr(lang, "Delivery fees", "ডেলিভারি ফি")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(unpaid)}</b><p className="small">{tr(lang, "Unpaid balance", "বাকি (অপরিশোধিত)")}</p></div>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Cash received by payment method", "পেমেন্ট মাধ্যম অনুযায়ী প্রাপ্ত অর্থ")}</b>
        {paidByMethod.length === 0 ? <p className="small muted">{tr(lang, "No money received in this period.", "এই সময়ে কোনো টাকা পাওয়া যায়নি।")}</p> : paidByMethod.map(([m, v]) => <p key={m} className="small">{m} — {tk(v)}</p>)}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Add an expense", "খরচ যোগ করুন")}</b>
        {msg && <p className="small" role="status">{msg}</p>}
        <div className="row">
          <label>{tr(lang, "Date", "তারিখ")}<input aria-label="Expense date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>{tr(lang, "Category", "ধরন")}<select aria-label="Expense category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["কাঁচামাল", "ভাড়া", "বেতন", "বিদ্যুৎ ও গ্যাস", "পরিবহন", "অন্যান্য"].map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label>{tr(lang, "Description", "বিবরণ")}<input aria-label="Expense description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="row">
          <label>{tr(lang, "Amount (৳)", "টাকা (৳)")}<input aria-label="Expense amount" type="number" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></label>
          <label>{tr(lang, "Supplier (optional)", "সরবরাহকারী (ঐচ্ছিক)")}<select aria-label="Expense supplier" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">{tr(lang, "No supplier", "কোনো সরবরাহকারী নয়")}</option>{suppliers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
        </div>
        <button className="btn-gold" onClick={() => void addExpense()}>{tr(lang, "Save expense", "খরচ সংরক্ষণ করুন")}</button>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Expenses (recent)", "খরচ (সাম্প্রতিক)")}</b>
        {expInPeriod.length === 0 ? <p className="small muted">{tr(lang, "No expenses in this period.", "এই সময়ে কোনো খরচ নেই।")}</p> : expInPeriod.slice(0, 50).map((e) => (
          <p key={e.id} className="small">{e.date} • {e.category} • {e.description}{e.supplier ? ` • ${e.supplier}` : ""} — {tk(e.amount)} <button className="btn-danger" style={{ padding: "2px 8px" }} onClick={() => { if (!firestore) return; void deleteDoc(doc(firestore, "expenses", e.id)); audit(userDoc, "expense.delete", `${e.category} — ${e.description} ৳${e.amount}`); }}>{tr(lang, "Delete", "মুছুন")}</button></p>
        ))}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Suppliers", "সরবরাহকারী")}</b>
        {supMsg && <p className="small" role="status">{supMsg}</p>}
        <div className="row">
          <label>{tr(lang, "Name", "নাম")}<input aria-label="Supplier name" value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></label>
          <label>{tr(lang, "Phone", "ফোন")}<input aria-label="Supplier phone" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></label>
        </div>
        <label>{tr(lang, "What they supply", "যা সরবরাহ করে")}<input aria-label="Supplier item" value={sup.item} onChange={(e) => setSup({ ...sup, item: e.target.value })} placeholder={tr(lang, "e.g. milk, tea leaves, cups", "যেমন: দুধ, চা পাতা, কাপ")} /></label>
        <label>{tr(lang, "Notes", "মন্তব্য")}<input aria-label="Supplier notes" value={sup.notes} onChange={(e) => setSup({ ...sup, notes: e.target.value })} /></label>
        <button className="btn-gold" onClick={() => void addSupplier()}>{tr(lang, "Save supplier", "সরবরাহকারী সংরক্ষণ করুন")}</button>
        {suppliers.length === 0
          ? <p className="small muted" style={{ marginTop: 8 }}>{tr(lang, "No suppliers yet — add one above, then link expenses to them.", "এখনো কোনো সরবরাহকারী নেই — উপরে যোগ করুন, তারপর খরচ তাদের সাথে যুক্ত করুন।")}</p>
          : suppliers.map((s) => (
            <p key={s.id} className="small" style={{ marginTop: 8 }}>{s.name}{s.phone ? ` • ${s.phone}` : ""}{s.item ? ` • ${s.item}` : ""}{s.notes ? ` • ${s.notes}` : ""} <button className="btn-danger" style={{ padding: "2px 8px" }} onClick={() => { if (!firestore) return; void deleteDoc(doc(firestore, "suppliers", s.id)); audit(userDoc, "supplier.delete", s.name); }}>{tr(lang, "Delete", "মুছুন")}</button></p>
          ))}
        <b style={{ display: "block", marginTop: 12 }}>{tr(lang, "Spent per supplier (all time)", "সরবরাহকারী অনুযায়ী খরচ (সব সময়ের মোট)")}</b>
        {supplierTotals.length === 0
          ? <p className="small muted">{tr(lang, "No expenses yet.", "এখনো কোনো খরচ নেই।")}</p>
          : supplierTotals.map(([name, total]) => <p key={name || "none"} className="small">{name || tr(lang, "No supplier", "কোনো সরবরাহকারী নয়")} — {tk(total)}</p>)}
      </div>
    </div>
  );
}

// Owner Control Panel (Super Admin only): the business at a glance,
// staff & permissions summary, and quick links to the owner-only tabs.
function OwnerTab({ userDoc, orders, products, lang, onGoTab }: { userDoc: UserDoc; orders: Order[]; products: Product[]; lang: Lang; onGoTab: (t: string) => void }) {
  const firestore = getDb();
  const { data: users } = useLive<UserDoc>(() => (firestore ? query(collection(firestore, "users"), orderBy("createdAt", "desc"), limit(100)) : null), userFromDoc);
  const staff = users.filter((u) => u.role !== "customer");
  const todayOrders = orders.filter((o) => dayKey(o.createdAt) === todayKey() && LIVE_ORDER(o));
  const todayRevenue = realized(todayOrders);
  const monthRevenue = realized(orders.filter((o) => o.createdAt.slice(0, 7) === todayKey().slice(0, 7)));
  const lowStock = products.filter((p) => p.stock <= 5);
  const pending = orders.filter((o) => o.status === "Pending").length;
  const best = (() => {
    const m = new Map<string, { name: string; qty: number }>();
    orders.filter(LIVE_ORDER).forEach((o) => o.items.forEach((it) => { const cur = m.get(it.productId) ?? { name: itemName(products, it, lang), qty: 0 }; cur.qty += it.qty; m.set(it.productId, cur); }));
    return [...m.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;
  })();
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Owner Control Panel", "মালিক প্যানেল")}</h3>
      <p className="small muted">{tr(lang, "Only the Super Admin (owner) sees this. Financial figures and important settings live here and in the owner-only tabs — staff never see them.", "এটি শুধু সুপার অ্যাডমিন (মালিক) দেখতে পারেন। আর্থিক তথ্য ও গুরুত্বপূর্ণ সেটিংস এখানে ও মালিকের ট্যাবে থাকে — স্টাফরা এগুলো দেখতে পান না।")}</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(todayRevenue)}</b><p className="small">{tr(lang, "Revenue today", "আজকের আয়")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(monthRevenue)}</b><p className="small">{tr(lang, "Revenue this month", "এই মাসের আয়")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{todayOrders.length}</b><p className="small">{tr(lang, "Orders today", "আজকের অর্ডার")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{pending}</b><p className="small">{tr(lang, "Pending orders", "অপেক্ষমাণ অর্ডার")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{lowStock.length}</b><p className="small">{tr(lang, "Low-stock products", "কম স্টকের প্রোডাক্ট")}</p></div>
        <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{staff.length}</b><p className="small">{tr(lang, "Staff accounts", "স্টাফ অ্যাকাউন্ট")}</p></div>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Best seller (all time)", "সেরা বিক্রি (সব সময়)")}</b>
        <p className="small">{best ? `${best.name} × ${best.qty}` : tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>
        <b>{tr(lang, "Low stock", "কম স্টক")}</b>
        {lowStock.length === 0 ? <p className="small muted">{tr(lang, "No product is at or below 5 in stock.", "কোনো প্রোডাক্টের স্টক ৫ বা তার নিচে নেই।")}</p> : lowStock.slice(0, 5).map((p) => <p key={p.slug} className="small">{displayName(p, lang)} — {p.stock} {tr(lang, "left", "বাকি")}</p>)}
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Staff & permissions", "স্টাফ ও অনুমতি")}</b>
        <p className="small muted">{tr(lang, "Cashiers, kitchen and waiters see only the tabs for their own work — never money figures, roles or settings. Change a role in Users & Staff.", "ক্যাশিয়ার, কিচেন ও ওয়েটার শুধু নিজের কাজের ট্যাব দেখেন — আয়, রোল বা সেটিংস কখনো দেখেন না। রোল বদলাতে Users & Staff-এ যান।")}</p>
        {staff.length === 0 ? <p className="small muted">{tr(lang, "No staff accounts yet.", "এখনো কোনো স্টাফ অ্যাকাউন্ট নেই।")}</p> : staff.map((u) => <p key={u.id} className="small">{u.name} • {u.email} • {u.role}{u.email.toLowerCase() === OWNER_EMAIL ? ` (${tr(lang, "Super Admin", "সুপার অ্যাডমিন")})` : ""}</p>)}
        <button className="btn-gold" style={{ marginTop: 8 }} onClick={() => onGoTab("users")}>{tr(lang, "Open Users & Staff", "Users & Staff খুলুন")}</button>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>{tr(lang, "Quick links", "দ্রুত লিংক")}</b>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn-gold" onClick={() => onGoTab("finance")}>{tr(lang, "Finance", "আয়-ব্যয়")}</button>
          <button className="btn-gold" onClick={() => onGoTab("analytics")}>{tr(lang, "Analytics", "অ্যানালাইসিস")}</button>
          <button className="btn-gold" onClick={() => onGoTab("ads")}>{tr(lang, "Ads", "বিজ্ঞাপন")}</button>
          <button className="btn-gold" onClick={() => onGoTab("settings")}>{tr(lang, "Settings", "সেটিংস")}</button>
        </div>
      </div>
    </div>
  );
}

// Apps: download/install options for BOTH apps on every device.
// Desktop + Android install with one tap (beforeinstallprompt); iPhone
// has no install button in Safari, so it is Share -> Add to Home Screen.
// Only one InstallAppCard is mounted at a time, so the install prompt
// always targets the selected app's manifest.
function AppsTab({ lang }: { lang: Lang }) {
  const [app, setApp] = useState<"customer" | "admin">("customer");
  const startUrl = app === "admin" ? "https://cafe-reza.web.app/#/admin" : "https://cafe-reza.web.app/#/";
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Apps", "অ্যাপস")}</h3>
      <p className="small muted">{tr(lang, "Both apps are this same website — same login, same data, same features. Pick an app, then install it on any device: Desktop, Android or iPhone.", "দুটো অ্যাপই এই একই ওয়েবসাইট — একই লগইন, একই ডেটা, একই সুবিধা। অ্যাপ বেছে নিন, তারপর যেকোনো ডিভাইসে ইনস্টল করুন: ডেস্কটপ, Android বা iPhone।")}</p>
      <div className="row" style={{ marginTop: 8 }}>
        <button className={`chip ${app === "customer" ? "chip-on" : ""}`} onClick={() => setApp("customer")}>{tr(lang, "Customer app — Café Reza", "কাস্টমার অ্যাপ — ক্যাফে রেজা")}</button>
        <button className={`chip ${app === "admin" ? "chip-on" : ""}`} onClick={() => setApp("admin")}>{tr(lang, "Admin app — Café Reza Admin", "অ্যাডমিন অ্যাপ — ক্যাফে রেজা অ্যাডমিন")}</button>
      </div>
      <InstallAppCard variant={app} lang={lang} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <b>🖥️ {tr(lang, "Desktop", "ডেস্কটপ")}</b>
          <p className="small muted">Windows / Mac — Chrome, Edge</p>
          <p className="small">{tr(lang, "Open the app, then press Install above — or the browser menu (⋮) → Install.", "অ্যাপটি খুলে উপরের Install বোতামে চাপুন — অথবা ব্রাউজার মেনু (⋮) → Install।")}</p>
          <p><a href={startUrl} target="_blank" rel="noreferrer">{tr(lang, "Open the app", "অ্যাপটি খুলুন")}</a></p>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <b>🤖 {tr(lang, "Android", "Android")}</b>
          <p className="small muted">Chrome</p>
          <p className="small">{tr(lang, "Open the app, then press Install above — or Chrome menu (⋮) → Install app / Add to Home screen.", "অ্যাপটি খুলে উপরের Install বোতামে চাপুন — অথবা Chrome মেনু (⋮) → Install app / Add to Home screen।")}</p>
          <p><a href={startUrl} target="_blank" rel="noreferrer">{tr(lang, "Open the app", "অ্যাপটি খুলুন")}</a></p>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <b>🍎 {tr(lang, "iPhone (Apple)", "iPhone (Apple)")}</b>
          <p className="small muted">Safari</p>
          <p className="small">{tr(lang, "iPhone has no install button in Safari: open the app in Safari, tap Share, then Add to Home Screen.", "iPhone-এ Safari-তে সরাসরি Install বোতাম হয় না: Safari-তে অ্যাপটি খুলে Share চেপে Add to Home Screen করুন।")}</p>
          <p><a href={startUrl} target="_blank" rel="noreferrer">{tr(lang, "Open the app in Safari", "Safari-তে অ্যাপটি খুলুন")}</a></p>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>{tr(lang, "These are web apps (PWA), not Play Store / App Store downloads — no store account needed. Native store apps come later.", "এগুলো ওয়েব অ্যাপ (PWA), Play Store / App Store ডাউনলোড নয় — স্টোর অ্যাকাউন্ট লাগে না। নেটিভ স্টোর অ্যাপ পরে আসবে।")}</p>
    </div>
  );
}

export function AdminPanel({ fbUser, authReady, userDoc, settings, categories, products, lang, onToggleLang, theme, onToggleTheme, onBack, onSeed, seedBusy, seedMsg, signInCard }: {
  fbUser: User | null; authReady: boolean; userDoc: UserDoc | null; settings: Settings; categories: Category[]; products: Product[];
  lang: Lang; onToggleLang: () => void; theme: "dark" | "light"; onToggleTheme: () => void; onBack: () => void; onSeed: () => void; seedBusy: boolean; seedMsg: string; signInCard: React.ReactNode;
}) {
  const [tab, setTab] = useState("dashboard");
  const [showAlerts, setShowAlerts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Choosing any section closes the menu, however it was chosen (menu
  // item, tab chip or alert shortcut) — the menu must never stay open
  // after navigating to a section.
  useEffect(() => { setShowMenu(false); }, [tab]);
  const firestore = getDb();
  // The panel mounts while the user doc is still loading (fresh sign-in),
  // so these queries must re-subscribe once staff is known — the old
  // empty-deps effect kept the first render's "no query" forever.
  const staffReady = !!userDoc && isStaffRole(userDoc.role);
  const { data: orders } = useLive<Order>(() => (firestore && staffReady ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(500)) : null), orderFromDoc, [staffReady]);
  const { data: invItems } = useLive(() => (firestore && staffReady ? query(collection(firestore, "inventory"), orderBy("name"), limit(200)) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), quantity: Number(d.quantity ?? 0), lowAt: Number(d.lowAt ?? 1) }), [staffReady]);

  // While auth is still restoring (page reload), show a loader — never
  // the sign-in card. Showing the card here is what made a reload flash
  // the login screen and look like a mid-session logout.
  if (!authReady) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "48px 16px", textAlign: "center" }}>
        <div className="logo-tile" style={{ width: 64, height: 64 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
        <div className="spinner" aria-hidden="true" />
        <p className="muted">{tr(lang, "Checking your sign-in…", "আপনার সাইন-ইন যাচাই হচ্ছে…")}</p>
      </div>
    );
  }
  if (!fbUser) {
    return (
      <div>
        <h2 className="serif" style={{ fontSize: 24 }}>{tr(lang, "Admin panel — staff sign-in", "অ্যাডমিন প্যানেল — স্টাফ সাইন-ইন")}</h2>
        <p className="small muted">{tr(lang, "Sign in with Google, Facebook or phone. Your staff role (from your user record) decides what you can do here.", "Google, Facebook বা ফোনে সাইন-ইন করুন। আপনার স্টাফ রোল (ইউজার রেকর্ড থেকে) এখানে কী করতে পারবেন তা ঠিক করে।")}</p>
        <div style={{ marginTop: 12 }}>{signInCard}</div>
      </div>
    );
  }
  if (!userDoc) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "48px 16px", textAlign: "center" }}>
        <div className="logo-tile" style={{ width: 64, height: 64 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></div>
        <div className="spinner" aria-hidden="true" />
        <p className="muted">{tr(lang, "Setting up your account…", "আপনার অ্যাকাউন্ট তৈরি হচ্ছে…")}</p>
      </div>
    );
  }
  // A signed-in account without a staff role never sees this panel:
  // the customer app sends it back to the shop silently, so this
  // renders nothing — no denial text, no admin mention.
  if (!isStaffRole(userDoc.role)) return null;
  const revenue = realized(orders);
  const lowStock = products.filter((p) => p.stock <= 5);
  const owner = isOwnerDoc(userDoc);
  const visibleTabs = ADMIN_TABS.filter((t) => (!t.ownerOnly || owner) && t.roles.includes(userDoc.role));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id ?? "dashboard";
  const todayOrders = orders.filter((o) => dayKey(o.createdAt) === todayKey() && LIVE_ORDER(o));
  const todayRevenue = realized(todayOrders);
  const todayBest = (() => {
    const m = new Map<string, { name: string; qty: number }>();
    todayOrders.forEach((o) => o.items.forEach((it) => { const cur = m.get(it.productId) ?? { name: itemName(products, it, lang), qty: 0 }; cur.qty += it.qty; m.set(it.productId, cur); }));
    return [...m.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;
  })();
  const pendingOrders = orders.filter((o) => o.status === "Pending").length;
  const pendingVerification = orders.filter((o) => o.paymentStatus === "Pending verification").length;
  const lowInvCount = invItems.filter((it) => it.quantity <= it.lowAt).length;
  const alertTotal = pendingOrders + pendingVerification + lowInvCount + lowStock.length;
  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Admin">
        <div className="row">
          <button className="chip" onClick={() => { setShowMenu(!showMenu); setShowAlerts(false); }}>☰ {tr(lang, "Menu", "মেনু")}</button>
          <button className="chip" onClick={() => { setShowAlerts(!showAlerts); setShowMenu(false); }}>🔔 {tr(lang, "Alerts", "সতর্কতা")}{alertTotal > 0 ? ` (${alertTotal})` : ""}</button>
          <button className="chip" aria-label="Switch language" onClick={onToggleLang}>{lang === "bn" ? "EN" : "বাংলা"}</button>
          <button className="chip" aria-label="Toggle theme" onClick={onToggleTheme}>{theme === "dark" ? "☀" : "☾"}</button>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="logo-tile" style={{ width: 44, height: 44 }}><img src="/img/logo.jpg" alt="Café Reza logo" /></span>
          <span>
            <p className="serif" style={{ fontSize: 18, margin: 0 }}>{tr(lang, "Admin panel", "অ্যাডমিন প্যানেল")}</p>
            <p className="small muted" style={{ margin: 0 }}>{userDoc.name} • {owner ? tr(lang, "Super Admin (Owner)", "সুপার অ্যাডমিন (মালিক)") : userDoc.role}</p>
          </span>
        </div>
        {showAlerts && (
          <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, paddingTop: 72 }} onClick={() => setShowAlerts(false)}>
            <div className="card" role="dialog" aria-label={tr(lang, "Alerts", "সতর্কতা")} style={{ width: "min(480px, 100%)", padding: 16, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ justifyContent: "space-between" }}><b className="serif" style={{ fontSize: 18 }}>🔔 {tr(lang, "Alerts", "সতর্কতা")}</b><button className="btn-ghost" aria-label={tr(lang, "Close", "বন্ধ করুন")} onClick={() => setShowAlerts(false)}>✕</button></div>
              {alertTotal === 0 ? <p className="small muted" style={{ marginTop: 8 }}>{tr(lang, "No alerts — everything is fine.", "কোনো সতর্কতা নেই — সব ঠিক আছে।")}</p> : <>
                <p className="small" style={{ marginTop: 8 }}>• {pendingOrders} {tr(lang, "pending orders", "টি অপেক্ষমাণ অর্ডার")} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { setTab("orders"); setShowAlerts(false); }}>{tr(lang, "View", "দেখুন")}</button></p>
                <p className="small" style={{ margin: 0 }}>• {pendingVerification} {tr(lang, "payments awaiting verification", "টি পেমেন্ট যাচাইয়ের অপেক্ষায়")} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { setTab("orders"); setShowAlerts(false); }}>{tr(lang, "View", "দেখুন")}</button></p>
                <p className="small" style={{ margin: 0 }}>• {lowInvCount} {tr(lang, "low-stock ingredients", "টি কম স্টকের উপকরণ")} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { setTab("inventory"); setShowAlerts(false); }}>{tr(lang, "View", "দেখুন")}</button></p>
                <p className="small" style={{ margin: 0 }}>• {lowStock.length} {tr(lang, "low-stock products", "টি কম স্টকের প্রোডাক্ট")} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { setTab("products"); setShowAlerts(false); }}>{tr(lang, "View", "দেখুন")}</button></p>
              </>}
            </div>
          </div>
        )}
        {showMenu && (
          <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, paddingTop: 72 }} onClick={() => setShowMenu(false)}>
            <div className="card" role="dialog" aria-label={tr(lang, "Menu", "মেনু")} style={{ width: "min(480px, 100%)", padding: 16, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ justifyContent: "space-between" }}><b className="serif" style={{ fontSize: 18 }}>☰ {tr(lang, "Menu", "মেনু")}</b><button className="btn-ghost" aria-label={tr(lang, "Close", "বন্ধ করুন")} onClick={() => setShowMenu(false)}>✕</button></div>
              {MENU_GROUPS.map((g) => {
                const items = visibleTabs.filter((t) => t.group === g.id);
                if (items.length === 0) return null;
                return (
                  <div key={g.id} style={{ marginTop: 8 }}>
                    <p className="small muted" style={{ margin: "0 0 2px", fontWeight: 700 }}>{lang === "bn" ? g.bn : g.en}</p>
                    {items.map((t) => (
                      <button key={t.id} className={`chip ${activeTab === t.id ? "chip-on" : ""}`} style={{ display: "block", width: "100%", marginTop: 4, textAlign: "left" }} onClick={() => { setTab(t.id); setShowMenu(false); }}>{t.icon} {lang === "bn" ? t.bn : t.en}</button>
                    ))}
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 8 }}>
                <button className="btn-gold" style={{ display: "block", width: "100%" }} onClick={onBack}>🛍️ {tr(lang, "Go to shop", "দোকানে যান")}</button>
                <button className="btn-ghost" style={{ display: "block", width: "100%", marginTop: 6 }} onClick={() => void signOutUser()}>{tr(lang, "Sign out", "সাইন-আউট")}</button>
              </div>
            </div>
          </div>
        )}
        <div className="admin-tabs-row">
          {visibleTabs.map((t) => <button key={t.id} className={`chip ${activeTab === t.id ? "chip-on" : ""}`} onClick={() => setTab(t.id)}>{lang === "bn" ? t.bn : t.en}</button>)}
        </div>
        <button className="btn-ghost" onClick={onBack}>{tr(lang, "Back to shop", "দোকানে ফিরুন")}</button>
      </nav>
      <div>
        {activeTab === "owner" && <OwnerTab userDoc={userDoc} orders={orders} products={products} lang={lang} onGoTab={(t) => setTab(t)} />}
        {activeTab === "dashboard" && (
          <div>
            <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Dashboard", "ড্যাশবোর্ড")}</h3>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{orders.length}</b><p className="small">{tr(lang, "Orders (recent 500)", "অর্ডার (সাম্প্রতিক ৫০০)")}</p></div>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{orders.filter((o) => o.status === "Pending").length}</b><p className="small">{tr(lang, "Pending orders", "অপেক্ষমাণ অর্ডার")}</p></div>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{todayOrders.length}</b><p className="small">{tr(lang, "Orders today", "আজকের অর্ডার")}</p></div>
            </div>
            {owner && (
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
                <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(todayRevenue)}</b><p className="small">{tr(lang, "Revenue today", "আজকের আয়")}</p></div>
                <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(revenue)}</b><p className="small">{tr(lang, "Total revenue (Completed / Delivered)", "মোট আয় (সম্পন্ন / ডেলিভার্ড)")}</p></div>
                <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{todayBest ? `${todayBest.name} × ${todayBest.qty}` : "—"}</b><p className="small">{tr(lang, "Best seller today", "আজকের সেরা বিক্রি")}</p></div>
              </div>
            )}
            <div className="card" style={{ padding: 14, marginTop: 12, border: lowStock.length > 0 ? "2px solid var(--bad)" : undefined, background: lowStock.length > 0 ? "rgba(224,120,86,.08)" : undefined }}>
              <b style={{ color: lowStock.length > 0 ? "var(--bad)" : undefined }}>⚠ {tr(lang, "Low stock — act now", "কম স্টক — এখনই দেখুন")}</b>
              {lowStock.length === 0 ? <p className="small muted">{tr(lang, "No product is at or below 5 in stock.", "কোনো প্রোডাক্টের স্টক ৫ বা তার নিচে নেই।")}</p> : <>
                <p className="small" style={{ marginTop: 6, fontWeight: 700, color: "var(--bad)" }}>{tr(lang, `${lowStock.length} products are running low — restock before they run out.`, `${lowStock.length}টি প্রোডাক্ট শেষের দিকে — শেষ হওয়ার আগেই স্টক বাড়ান।`)}</p>
                {lowStock.map((p) => <p key={p.slug} className="small" style={{ color: "var(--bad)", fontWeight: 700 }}>{displayName(p, lang)} — {p.stock} {tr(lang, "left", "বাকি")}</p>)}
                <button className="btn-gold" style={{ marginTop: 8 }} onClick={() => setTab("products")}>{tr(lang, "Open Products to restock", "স্টক বাড়াতে প্রোডাক্ট খুলুন")}</button>
              </>}
            </div>
            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              <b>{tr(lang, "What the admin panel controls", "অ্যাডমিন প্যানেল যা যা নিয়ন্ত্রণ করে")}</b>
              <p className="small" style={{ marginTop: 6 }}>{tr(lang, "Everything on the customer site — products, prices, categories, banners, offers, orders, reservations, settings and content — is read live from Firestore. Editing anything here changes the customer panel at once; there is no separate copy to sync.", "কাস্টমার সাইটের সবকিছু — প্রোডাক্ট, দাম, ক্যাটাগরি, ব্যানার, অফার, অর্ডার, রিজার্ভেশন, সেটিংস ও কনটেন্ট — Firestore থেকে লাইভ পড়া হয়। এখানে কিছু বদলালেই কাস্টমার প্যানেল সাথে সাথে বদলে যায়; আলাদা কোনো কপি মেলানোর দরকার নেই।")}</p>
            </div>
          </div>
        )}
        {activeTab === "orders" && <OrdersTab userDoc={userDoc} products={products} settings={settings} lang={lang} />}
        {activeTab === "pos" && <PosTab userDoc={userDoc} products={products} settings={settings} lang={lang} />}
        {activeTab === "products" && <ProductsTab userDoc={userDoc} categories={categories} products={products} lang={lang} />}
        {activeTab === "reservations" && <ReservationsTab userDoc={userDoc} lang={lang} />}
        {activeTab === "coupons" && <CouponsTab userDoc={userDoc} lang={lang} />}
        {activeTab === "analytics" && <AnalyticsTab orders={orders} products={products} categories={categories} lang={lang} />}
        {activeTab === "finance" && <FinanceTab userDoc={userDoc} orders={orders} lang={lang} />}
        {activeTab === "ads" && <AdsTab userDoc={userDoc} settings={settings} lang={lang} />}
        {activeTab === "content" && <ContentTab userDoc={userDoc} settings={settings} lang={lang} />}
        {activeTab === "settings" && <SettingsTab userDoc={userDoc} settings={settings} lang={lang} />}
        {activeTab === "audit" && <AuditLogTab lang={lang} />}
        {activeTab === "users" && <UsersTab userDoc={userDoc} settings={settings} lang={lang} />}
        {activeTab === "support" && <SupportTab userDoc={userDoc} products={products} lang={lang} />}
        {activeTab === "inventory" && <InventoryTab userDoc={userDoc} lang={lang} />}
        {activeTab === "firebase" && <FirebaseTab userDoc={userDoc} lang={lang} onSeed={onSeed} seedBusy={seedBusy} seedMsg={seedMsg} />}
        {activeTab === "apps" && <AppsTab lang={lang} />}
      </div>
    </div>
  );
}
// AdminPanel.tsx ends here.