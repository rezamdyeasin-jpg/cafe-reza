// Admin panel — the ONLY place the customer site is managed.
// It writes the same Firestore collections the storefront reads, so
// every edit here (product, price, category, banner, offer, order,
// reservation, setting, content) controls the user panel at once.
// The admin and customer panels are separate: separate route (#/admin),
// separate sign-in screen, and a customer account opening #/admin sees
// only the access-denied card below. Staff roles are read from the
// /users/{uid} document; only an admin writes catalog and settings.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, limit, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { getDb, probeFirestore } from "./firebase";
import { BANNER_SLIDES, CUSTOMER_EMAIL, OWNER_EMAIL, SEED_PRODUCTS } from "./seed";
import {
  isStaffRole, orderFromDoc, parseAds, parseBannerSelection, parseContent,
  tr, useLive, userFromDoc,
  type Category, type Coupon, type Lang, type Order, type Product, type Reservation, type Settings, type UserDoc,
} from "./db";
import { placeOrderTx } from "./orders";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;
const IMG_FILES = [...new Set([...SEED_PRODUCTS.map((p) => p.img), ...SEED_PRODUCTS.map((p) => p.img2), ...BANNER_SLIDES.map((b) => b.img), "hero.jpg", "logo.jpg", "tray.jpg", "tray2.jpg", "menu-photo.jpg"])].sort();
const STAFF_ROLES = ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"];
const PAYMENTS = ["Cash on Delivery", "Cash at Counter", "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer"];

function audit(actor: UserDoc, action: string, detail: string) {
  const firestore = getDb();
  if (!firestore) return;
  void addDoc(collection(firestore, "auditLogs"), { actorId: actor.id, actorName: actor.name, action, targetType: "", targetId: null, detail: detail.slice(0, 500), createdAt: serverTimestamp() }).catch(() => undefined);
}

function OrdersTab({ userDoc, products, lang }: { userDoc: UserDoc; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const { data: orders } = useLive<Order>(() => (firestore ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(60)) : null), orderFromDoc);
  const [note, setNote] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const setStatus = async (o: Order, status: string) => {
    if (!firestore) return;
    await updateDoc(doc(firestore, "orders", o.id), { status });
    audit(userDoc, "order.status", `${o.orderNo} → ${status}`);
  };
  const verifyPayment = async (o: Order) => {
    if (!firestore) return;
    await updateDoc(doc(firestore, "orders", o.id), { paymentStatus: "Paid" });
    audit(userDoc, "order.paymentVerified", `${o.orderNo} marked Paid (manual verification).`);
    setNote(tr(lang, "Payment marked Paid (manual verification).", "পেমেন্ট পরিশোধিত হিসেবে চিহ্নিত হয়েছে (ম্যানুয়াল যাচাই)।"));
  };
  const requestRefund = async (o: Order) => {
    if (!firestore) return;
    await addDoc(collection(firestore, "refundRequests"), { orderId: o.id, orderNo: o.orderNo, amount: o.total, reason: refundReason || "Refund requested in admin", requestedBy: userDoc.id, requestedByName: userDoc.name, status: "pending", decidedBy: "", decidedByName: "", createdAt: serverTimestamp() });
    setNote(tr(lang, "Refund request created — an admin/manager decides it below.", "ফেরতের অনুরোধ তৈরি হয়েছে — অ্যাডমিন/ম্যানেজার নিচে সিদ্ধান্ত নেবেন।"));
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Orders / Kitchen", "অর্ডার / কিচেন")}</h3>
      {note && <p className="small" role="status">{note}</p>}
      <label>{tr(lang, "Refund reason (for the button below)", "ফেরতের কারণ (নিচের বোতামের জন্য)")}<input aria-label="Refund reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} /></label>
      {orders.length === 0 && <p className="muted small">{tr(lang, "No orders yet.", "এখনো কোনো অর্ডার নেই।")}</p>}
      {orders.map((o) => (
        <div key={o.id} className="card" style={{ padding: 12, marginTop: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}><b>{o.orderNo}</b><span>{tk(o.total)} • {o.paymentStatus}</span></div>
          <p className="small muted">{o.customerName} • {o.phone} • {o.orderType} • {o.source} • {o.createdAt ? new Date(o.createdAt).toLocaleString("en-GB") : ""}</p>
          <ul className="small">{o.items.map((it, i) => <li key={i}>{it.qty} × {it.name} — {tk(it.price)}</li>)}</ul>
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Status", "অবস্থা")}<select aria-label={`Status for ${o.orderNo}`} value={o.status} onChange={(e) => void setStatus(o, e.target.value)}>{["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered", "Completed", "Cancelled", "Refunded"].map((s) => <option key={s}>{s}</option>)}</select></label>
            {o.paymentStatus === "Pending verification" && <button className="btn-gold" onClick={() => void verifyPayment(o)}>{tr(lang, "Verify payment (manual)", "পেমেন্ট যাচাই করুন (ম্যানুয়াল)")}</button>}
            <button className="btn-ghost" onClick={() => void requestRefund(o)}>{tr(lang, "Request refund", "ফেরতের অনুরোধ")}</button>
          </div>
        </div>
      ))}
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
  return (
    <div style={{ marginTop: 18 }}>
      <h4 className="serif" style={{ fontSize: 18 }}>{tr(lang, "Refund requests", "ফেরতের অনুরোধ")}</h4>
      {reqs.map((r) => (
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
  const [cash, setCash] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const lines = cart.map((c) => ({ product: products.find((p) => p.slug === c.slug), qty: c.qty })).filter((l): l is { product: Product; qty: number } => !!l.product);
  const total = lines.reduce((a, l) => a + (l.product.discountPrice ?? l.product.price) * l.qty, 0);
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
    setMsg(tr(lang, `Sale done: ${r.orderNo}. Change: ${tk(cash - total)}.`, `বিক্রি হয়েছে: ${r.orderNo}। ফেরত: ${tk(cash - total)}।`));
    setCart([]); setCash(0);
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>POS</h3>
      <div className="grid products" style={{ marginTop: 10 }}>
        {products.filter((p) => p.available && (p.discountPrice ?? p.price) > 0).map((p) => (
          <button key={p.slug} type="button" className="card" style={{ padding: 10, textAlign: "left", color: "var(--text)" }} onClick={() => setCart((prev) => { const i = prev.findIndex((c) => c.slug === p.slug); if (i >= 0) { const n = [...prev]; const cur = n[i]; if (cur) n[i] = { ...cur, qty: cur.qty + 1 }; return n; } return [...prev, { slug: p.slug, qty: 1 }]; })}>
            <b>{p.nameEn}</b><br /><span>{tk(p.discountPrice ?? p.price)}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        {lines.map((l) => <p key={l.product.slug}>{l.qty} × {l.product.nameEn} — {tk((l.product.discountPrice ?? l.product.price) * l.qty)}</p>)}
        <p><b>{tr(lang, "Total", "মোট")}: {tk(total)}</b></p>
        <label>{tr(lang, "Cash received", "পাওয়া টাকা")}<input aria-label="Cash received" type="number" value={cash} onChange={(e) => setCash(Number(e.target.value))} /></label>
        <p>{tr(lang, "Change:", "ফেরত:")} <b>{tk(Math.max(0, cash - total))}</b></p>
        <button className="btn-gold" disabled={busy || lines.length === 0} onClick={() => void sell()}>{tr(lang, "Complete cash sale", "নগদ বিক্রি সম্পন্ন করুন")}</button>
        <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setCart([])}>{tr(lang, "Clear", "মুছুন")}</button>
        {msg && <p className="small" role="status">{msg}</p>}
      </div>
    </div>
  );
}

function ProductsTab({ userDoc, categories, products, lang }: { userDoc: UserDoc; categories: Category[]; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ slug: "", nameEn: "", nameBn: "", description: "", categoryId: "", price: 0, discountPrice: "", stock: 100, available: true, featured: false, bestSeller: false, isNew: false, imageKey: "", imageKey2: "", ingredients: "", sortOrder: 1 });
  const [catForm, setCatForm] = useState({ id: "", nameEn: "", nameBn: "", sortOrder: 99, active: true });
  const [msg, setMsg] = useState("");
  const startEdit = (p: Product) => {
    setEditing(p);
    setForm({ slug: p.slug, nameEn: p.nameEn, nameBn: p.nameBn, description: p.description, categoryId: p.categoryId, price: p.price, discountPrice: p.discountPrice == null ? "" : String(p.discountPrice), stock: p.stock, available: p.available, featured: p.featured, bestSeller: p.bestSeller, isNew: p.isNew, imageKey: p.imageKey ?? "", imageKey2: p.imageKey2 ?? "", ingredients: p.ingredients, sortOrder: p.sortOrder });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    const slug = form.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || `item-${Date.now()}`;
    const data = { slug, nameEn: form.nameEn.trim(), nameBn: form.nameBn.trim(), description: form.description.trim(), categoryId: form.categoryId, price: Number(form.price), discountPrice: form.discountPrice === "" ? null : Number(form.discountPrice), stock: Number(form.stock), available: form.available, featured: form.featured, bestSeller: form.bestSeller, isNew: form.isNew, imageKey: form.imageKey || null, imageKey2: form.imageKey2 || null, ingredients: form.ingredients.trim(), sortOrder: Number(form.sortOrder), updatedAt: serverTimestamp() };
    if (editing) await updateDoc(doc(firestore, "products", editing.slug), data);
    else await setDoc(doc(firestore, "products", slug), { ...data, costPrice: 0, prepTime: 10 });
    audit(userDoc, editing ? "product.update" : "product.create", `${data.nameEn} — price ${data.price}`);
    setMsg(tr(lang, "Product saved — the customer menu updates at once.", "প্রোডাক্ট সংরক্ষিত হয়েছে — কাস্টমার মেনু সাথে সাথে বদলে যাবে।"));
    setEditing(null);
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
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Products & Categories", "প্রোডাক্ট ও ক্যাটাগরি")}</h3>
      {msg && <p className="small" role="status">{msg}</p>}
      <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <b>{editing ? tr(lang, "Edit product", "প্রোডাক্ট সম্পাদনা") : tr(lang, "New product", "নতুন প্রোডাক্ট")}</b>
        <label>{tr(lang, "Slug (Firestore document id)", "স্লাগ (Firestore ডকুমেন্ট আইডি)")}<input aria-label="Product slug" value={form.slug} disabled={!!editing} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
        <label>{tr(lang, "Name (English)", "নাম (ইংরেজি)")}<input aria-label="Product name English" required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
        <label>{tr(lang, "Name (Bengali)", "নাম (বাংলা)")}<input aria-label="Product name Bengali" value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} /></label>
        <label>{tr(lang, "Description", "বিবরণ")}<input aria-label="Product description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>{tr(lang, "Category", "ক্যাটাগরি")}<select aria-label="Product category" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">{tr(lang, "Choose…", "বেছে নিন…")}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></label>
        <div className="row">
          <label style={{ flex: 1 }}>{tr(lang, "Price (৳, 0 = not set yet)", "দাম (৳, ০ = এখনো বসানো হয়নি)")}<input aria-label="Price" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Discount price (empty = none)", "ছাড়ের দাম (খালি = নেই)")}<input aria-label="Discount price" type="number" min={0} value={form.discountPrice} onChange={(e) => setForm({ ...form, discountPrice: e.target.value })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Stock", "স্টক")}<input aria-label="Stock" type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></label>
        </div>
        <label>{tr(lang, "Photo file", "ছবির ফাইল")}<select aria-label="Photo file" value={form.imageKey} onChange={(e) => setForm({ ...form, imageKey: e.target.value })}><option value="">{tr(lang, "No photo", "ছবি নেই")}</option>{IMG_FILES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        <label>{tr(lang, "Second photo file", "দ্বিতীয় ছবির ফাইল")}<select aria-label="Second photo file" value={form.imageKey2} onChange={(e) => setForm({ ...form, imageKey2: e.target.value })}><option value="">{tr(lang, "Same as photo", "ছবির মতোই")}</option>{IMG_FILES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        <label>{tr(lang, "Ingredients (comma separated)", "উপকরণ (কমা দিয়ে)")}<input aria-label="Ingredients" value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} /></label>
        <div className="row">
          {(["available", "featured", "bestSeller", "isNew"] as const).map((k) => <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}><input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} style={{ width: "auto" }} />{k}</label>)}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn-gold" type="submit">{tr(lang, "Save product", "প্রোডাক্ট সংরক্ষণ করুন")}</button>
          {editing && <button className="btn-ghost" type="button" onClick={() => setEditing(null)}>{tr(lang, "Cancel edit", "সম্পাদনা বাতিল")}</button>}
        </div>
      </form>
      <div style={{ overflowX: "auto" }}>
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>{tr(lang, "Product", "প্রোডাক্ট")}</th><th>{tr(lang, "Price", "দাম")}</th><th>{tr(lang, "Stock", "স্টক")}</th><th>{tr(lang, "Shown", "দেখানো হয়")}</th><th /></tr></thead>
          <tbody>{products.map((p) => <tr key={p.slug}><td>{p.nameEn} <span className="small muted">({p.slug})</span></td><td>{tk(p.discountPrice ?? p.price)}</td><td>{p.stock}</td><td>{p.available ? "✓" : "—"}</td><td><button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => startEdit(p)}>{tr(lang, "Edit", "সম্পাদনা")}</button> <button className="btn-danger" style={{ padding: "4px 10px" }} onClick={() => void remove(p)}>{tr(lang, "Delete", "মুছুন")}</button></td></tr>)}</tbody>
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
        <p key={c.id} className="small">{c.nameEn} ({c.nameBn}) — {tr(lang, "order", "ক্রম")} {c.sortOrder} — {c.active ? tr(lang, "active", "সক্রিয়") : tr(lang, "hidden", "লুকানো")}
          <button className="btn-danger" style={{ padding: "2px 8px", marginLeft: 8 }} onClick={() => { if (products.some((p) => p.categoryId === c.id)) { setMsg(tr(lang, "This category still has products. Move or delete its products first.", "এই ক্যাটাগরিতে এখনো প্রোডাক্ট আছে। আগে প্রোডাক্ট সরান বা মুছুন।")); return; } if (firestore) void deleteDoc(doc(firestore, "categories", c.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
        </p>
      ))}
    </div>
  );
}

function ReservationsTab({ userDoc, lang }: { userDoc: UserDoc; lang: Lang }) {
  const firestore = getDb();
  const { data: res } = useLive<Reservation>(() => (firestore ? query(collection(firestore, "reservations"), orderBy("createdAt", "desc"), limit(60)) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), email: String(d.email ?? ""), date: String(d.date ?? ""), time: String(d.time ?? ""), guests: Number(d.guests ?? 2), requests: String(d.requests ?? ""), status: String(d.status ?? "Pending"), tableLabel: String(d.tableLabel ?? ""), userId: String(d.userId ?? ""), createdAt: "" }));
  const { data: tables } = useLive(() => (firestore ? query(collection(firestore, "tables"), orderBy("label")) : null),
    (id, d) => ({ id, label: String(d.label ?? id), capacity: Number(d.capacity ?? 4), status: String(d.status ?? "Available"), notes: String(d.notes ?? "") }));
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(4);
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Tables & Reservations", "টেবিল ও রিজার্ভেশন")}</h3>
      {res.map((r) => (
        <div key={r.id} className="card" style={{ padding: 12, marginTop: 10 }}>
          <b>{r.name}</b> • {r.phone} • {r.date} {r.time} • {r.guests} {tr(lang, "guests", "অতিথি")}
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Status", "অবস্থা")}<select aria-label={`Reservation status ${r.id}`} value={r.status} onChange={(e) => { if (firestore) void updateDoc(doc(firestore, "reservations", r.id), { status: e.target.value }); }}><option>Pending</option><option>Confirmed</option><option>Cancelled</option><option>Completed</option></select></label>
            <label style={{ margin: 0 }}>{tr(lang, "Table", "টেবিল")}<input aria-label="Reservation table" value={r.tableLabel} onChange={(e) => { if (firestore) void updateDoc(doc(firestore, "reservations", r.id), { tableLabel: e.target.value }); }} placeholder="T1" /></label>
            <button className="btn-danger" style={{ padding: "6px 10px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "reservations", r.id)); }}>{tr(lang, "Delete", "মুছুন")}</button>
          </div>
          {r.requests && <p className="small muted">{r.requests}</p>}
        </div>
      ))}
      <h4 className="serif" style={{ fontSize: 18, marginTop: 18 }}>{tr(lang, "Tables", "টেবিল")}</h4>
      {tables.map((t) => <p key={t.id} className="small">{t.label} • {t.capacity} {tr(lang, "seats", "আসন")} • {t.status} <button className="btn-danger" style={{ padding: "2px 8px", marginLeft: 8 }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "tables", t.id)); }}>{tr(lang, "Delete", "মুছুন")}</button></p>)}
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
    (id, d) => ({ id, code: String(d.code ?? id), kind: String(d.kind ?? "percent"), value: Number(d.value ?? 0), minPurchase: Number(d.minPurchase ?? 0), maxDiscount: d.maxDiscount == null ? null : Number(d.maxDiscount), usageLimit: d.usageLimit == null ? null : Number(d.usageLimit), usedCount: Number(d.usedCount ?? 0), active: d.active !== false, expiresAt: String(d.expiresAt ?? ""), description: String(d.description ?? "") }));
  const [f, setF] = useState({ code: "", kind: "percent", value: 10, minPurchase: 0, maxDiscount: "", usageLimit: "", expiresAt: "", description: "", active: true });
  const [msg, setMsg] = useState("");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    const code = f.code.trim().toUpperCase();
    await setDoc(doc(firestore, "coupons", code), { code, kind: f.kind, value: Number(f.value), minPurchase: Number(f.minPurchase), maxDiscount: f.maxDiscount === "" ? null : Number(f.maxDiscount), usageLimit: f.usageLimit === "" ? null : Number(f.usageLimit), usedCount: 0, active: f.active, expiresAt: f.expiresAt, description: f.description });
    audit(userDoc, "coupon.save", code);
    setMsg(tr(lang, "Offer/coupon saved — customers see it at checkout.", "অফার/কুপন সংরক্ষিত হয়েছে — কাস্টমার চেকআউটে দেখবে।"));
    setF({ code: "", kind: "percent", value: 10, minPurchase: 0, maxDiscount: "", usageLimit: "", expiresAt: "", description: "", active: true });
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
        <button className="btn-gold" type="submit">{tr(lang, "Save coupon", "কুপন সংরক্ষণ করুন")}</button>
      </form>
      {coupons.map((c) => <p key={c.id} className="small">{c.code} — {c.kind} {c.value} • {c.active ? tr(lang, "active", "সক্রিয়") : tr(lang, "inactive", "নিষ্ক্রিয়")} • {tr(lang, "used", "ব্যবহৃত")} {c.usedCount} <button className="btn-ghost" style={{ padding: "2px 8px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "coupons", c.id), { active: !c.active }); }}>{c.active ? tr(lang, "Deactivate", "বন্ধ করুন") : tr(lang, "Activate", "চালু করুন")}</button> <button className="btn-danger" style={{ padding: "2px 8px" }} onClick={() => { if (firestore) void deleteDoc(doc(firestore, "coupons", c.id)); }}>{tr(lang, "Delete", "মুছুন")}</button></p>)}
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
  const [ads, setAds] = useState(parseAds(settings.adsJson));
  const [msg, setMsg] = useState("");
  useEffect(() => { setAnnouncement(content.announcement); setAboutText(content.aboutText); setShowGallery(content.showGallery); }, [settings.contentJson]);
  useEffect(() => { setPromoVideo(settings.promoVideo); }, [settings.promoVideo]);
  useEffect(() => { setBanners(parseBannerSelection(settings.bannersJson)); }, [settings.bannersJson]);
  useEffect(() => { setAds(parseAds(settings.adsJson)); }, [settings.adsJson]);
  const saveAll = async () => {
    if (!firestore) return;
    await setDoc(doc(firestore, "settings", "cafe"), {
      contentJson: JSON.stringify({ announcement, aboutText, showGallery }),
      promoVideo, bannersJson: JSON.stringify(banners), adsJson: JSON.stringify(ads),
    }, { merge: true });
    audit(userDoc, "content.save", "Homepage content, video, banners and ad slots updated.");
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
        <b style={{ display: "block", marginTop: 12 }}>{tr(lang, "Ad placements (off by default)", "বিজ্ঞাপনের জায়গা (ডিফল্টে বন্ধ)")}</b>
        {ads.map((slot, i) => (
          <div key={slot.id} className="card" style={{ padding: 10, marginTop: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={slot.enabled} style={{ width: "auto" }} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, enabled: e.target.checked } : a))} />{slot.id}</label>
            <label>{tr(lang, "Type", "ধরন")}<select aria-label={`Ad type ${slot.id}`} value={slot.kind} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, kind: e.target.value as "image" | "code" } : a))}><option value="image">Banner image + link</option><option value="code">Embed code (sandboxed)</option></select></label>
            {slot.kind === "image" ? <>
              <label>{tr(lang, "Image URL", "ছবির লিংক")}<input aria-label={`Ad image ${slot.id}`} value={slot.imageUrl} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, imageUrl: e.target.value } : a))} /></label>
              <label>{tr(lang, "Link URL", "লিংক")}<input aria-label={`Ad link ${slot.id}`} value={slot.linkUrl} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, linkUrl: e.target.value } : a))} /></label>
            </> : <label>{tr(lang, "Embed code", "এমবেড কোড")}<textarea aria-label={`Ad code ${slot.id}`} rows={3} value={slot.code} onChange={(e) => setAds(ads.map((a, j) => j === i ? { ...a, code: e.target.value } : a))} /></label>}
          </div>
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
        <button className="btn-gold" style={{ marginTop: 12 }} type="submit">{tr(lang, "Save settings", "সেটিংস সংরক্ষণ করুন")}</button>
      </form>
    </div>
  );
}

function UsersTab({ userDoc, lang }: { userDoc: UserDoc; lang: Lang }) {
  const firestore = getDb();
  const { data: users } = useLive<UserDoc>(() => (firestore ? query(collection(firestore, "users"), orderBy("createdAt", "desc"), limit(60)) : null), userFromDoc);
  const [msg, setMsg] = useState("");
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
      {users.map((u) => (
        <div key={u.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{u.name}</b> — {u.email} • {u.phone} • {u.loyaltyPoints} {tr(lang, "pts", "পয়েন্ট")} • {u.status}
          <div className="row" style={{ marginTop: 6 }}>
            <label style={{ margin: 0 }}>{tr(lang, "Role", "রোল")}<select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => void changeRole(u, e.target.value)}><option value="customer">customer</option>{STAFF_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={() => { if (firestore) void updateDoc(doc(firestore, "users", u.id), { status: u.status === "active" ? "suspended" : "active" }); }}>{u.status === "active" ? tr(lang, "Suspend", "সাসপেন্ড") : tr(lang, "Activate", "সক্রিয় করুন")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SupportTab({ userDoc, products, lang }: { userDoc: UserDoc; products: Product[]; lang: Lang }) {
  const firestore = getDb();
  const { data: messages } = useLive(() => (firestore ? query(collection(firestore, "messages"), orderBy("createdAt", "desc"), limit(50)) : null),
    (id, d) => ({ id, userId: String(d.userId ?? ""), author: String(d.author ?? ""), authorName: String(d.authorName ?? ""), body: String(d.body ?? ""), orderNo: String(d.orderNo ?? ""), readFlag: !!d.readFlag }));
  const { data: tickets } = useLive(() => (firestore ? query(collection(firestore, "tickets"), orderBy("createdAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, name: String(d.name ?? ""), phone: String(d.phone ?? ""), category: String(d.category ?? "General"), priority: String(d.priority ?? "Normal"), status: String(d.status ?? "Open"), message: String(d.message ?? ""), reply: String(d.reply ?? "") }));
  const { data: reviews } = useLive(() => (firestore ? query(collection(firestore, "reviews"), orderBy("createdAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, productId: String(d.productId ?? ""), author: String(d.author ?? ""), rating: Number(d.rating ?? 5), comment: String(d.comment ?? ""), status: String(d.status ?? "Pending") }));
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const sendReply = async (userId: string) => {
    if (!firestore || !reply.trim()) return;
    await addDoc(collection(firestore, "messages"), { userId, guestName: "", guestPhone: "", orderNo: "", author: "staff", authorName: userDoc.name, body: reply.trim(), readFlag: false, createdAt: serverTimestamp() });
    setReply(""); setReplyTo(null);
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Support & Reviews", "সাপোর্ট ও রিভিউ")}</h3>
      <h4 className="serif" style={{ fontSize: 18, marginTop: 14 }}>{tr(lang, "Messages", "মেসেজ")}</h4>
      {messages.map((m) => (
        <div key={m.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{m.authorName || m.author}</b> {m.orderNo && <span className="small muted">({m.orderNo})</span>}
          <p className="small" style={{ margin: "4px 0" }}>{m.body}</p>
          {replyTo === m.userId
            ? <><input aria-label="Staff reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tr(lang, "Write a reply…", "জবাব লিখুন…")} /><button className="btn-gold" style={{ marginTop: 6 }} onClick={() => void sendReply(m.userId)}>{tr(lang, "Send reply", "জবাব পাঠান")}</button></>
            : <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={() => setReplyTo(m.userId)}>{tr(lang, "Reply", "জবাব দিন")}</button>}
        </div>
      ))}
      <h4 className="serif" style={{ fontSize: 18, marginTop: 18 }}>{tr(lang, "Tickets", "টিকিট")}</h4>
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
      {reviews.map((r) => {
        const p = products.find((x) => x.slug === r.productId);
        return (
          <div key={r.id} className="card" style={{ padding: 10, marginTop: 8 }}>
            <b>{r.author}</b> {"★".repeat(r.rating)} — {p?.nameEn ?? r.productId} • {r.status}
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
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore) return;
    await addDoc(collection(firestore, "inventory"), { ...f, quantity: Number(f.quantity), lowAt: Number(f.lowAt), costPerUnit: Number(f.costPerUnit) });
    setF({ name: "", category: "Other ingredients", unit: "kg", quantity: 0, lowAt: 1, costPerUnit: 0, expiry: "", supplier: "" });
  };
  return (
    <div>
      <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Inventory", "ইনভেন্টরি")}</h3>
      {!canManage && <p className="small muted">{tr(lang, "Expenses are manager/admin only; stock viewing is open to all staff.", "খরচ শুধু ম্যানেজার/অ্যাডমিনের; স্টক সব স্টাফ দেখতে পারেন।")}</p>}
      <form onSubmit={(e) => void save(e)} className="card" style={{ padding: 14, marginTop: 10 }}>
        <label>{tr(lang, "Item name", "আইটেমের নাম")}<input aria-label="Inventory item name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>{tr(lang, "Quantity", "পরিমাণ")}<input aria-label="Quantity" type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Unit", "একক")}<input aria-label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
          <label style={{ flex: 1 }}>{tr(lang, "Low-stock at", "কম স্টক সীমা")}<input aria-label="Low stock at" type="number" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: Number(e.target.value) })} /></label>
        </div>
        <button className="btn-gold" type="submit">{tr(lang, "Add item", "আইটেম যোগ করুন")}</button>
      </form>
      {items.map((it) => (
        <div key={it.id} className="card" style={{ padding: 10, marginTop: 8 }}>
          <b>{it.name}</b> — {it.quantity} {it.unit} {it.quantity <= it.lowAt && <span style={{ color: "var(--bad)" }}>• {tr(lang, "LOW", "কম")}</span>}
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
  const [probe, setProbe] = useState<{ state: string; detail: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const check = async () => { setProbing(true); setProbe(await probeFirestore()); setProbing(false); };
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
        <p className="small muted">{tr(lang, "Writes the 34 products and 9 categories (owner's printed menu prices) only where Firestore is empty. Never overwrites an admin-edited price or stock.", "৩৪টি প্রোডাক্ট ও ৯টি ক্যাটাগরি (মালিকের ছাপা মেনুর দাম) শুধু খালি জায়গায় লেখে। অ্যাডমিনের বদলানো দাম বা স্টক কখনো ওভাররাইট করে না।")}</p>
        <button className="btn-gold" disabled={seedBusy} onClick={onSeed}>{seedBusy ? tr(lang, "Seeding…", "বসানো হচ্ছে…") : tr(lang, "Seed catalog", "ক্যাটালগ বসান")}</button>
        {seedMsg && <p className="small" role="status">{seedMsg}</p>}
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
    </div>
  );
}

const ADMIN_TABS: Array<[string, string, string]> = [
  ["dashboard", "Dashboard", "ড্যাশবোর্ড"],
  ["orders", "Orders / Kitchen", "অর্ডার / কিচেন"],
  ["pos", "POS", "POS"],
  ["products", "Products & Categories", "প্রোডাক্ট ও ক্যাটাগরি"],
  ["reservations", "Tables & Reservations", "টেবিল ও রিজার্ভেশন"],
  ["coupons", "Coupons & Offers", "কুপন ও অফার"],
  ["content", "Content & Banners", "কনটেন্ট ও ব্যানার"],
  ["settings", "Settings", "সেটিংস"],
  ["users", "Users & Staff", "ইউজার ও স্টাফ"],
  ["support", "Support & Reviews", "সাপোর্ট ও রিভিউ"],
  ["inventory", "Inventory", "ইনভেন্টরি"],
  ["firebase", "Firebase & Launch", "Firebase ও লঞ্চ"],
];

export function AdminPanel({ fbUser, userDoc, settings, categories, products, lang, onBack, onSeed, seedBusy, seedMsg, signInCard }: {
  fbUser: User | null; userDoc: UserDoc | null; settings: Settings; categories: Category[]; products: Product[];
  lang: Lang; onBack: () => void; onSeed: () => void; seedBusy: boolean; seedMsg: string; signInCard: React.ReactNode;
}) {
  const [tab, setTab] = useState("dashboard");
  const firestore = getDb();
  const { data: orders } = useLive<Order>(() => (firestore && userDoc && isStaffRole(userDoc.role) ? query(collection(firestore, "orders"), orderBy("createdAt", "desc"), limit(100)) : null), orderFromDoc);

  if (!fbUser) {
    return (
      <div>
        <h2 className="serif" style={{ fontSize: 24 }}>{tr(lang, "Admin panel — staff sign-in", "অ্যাডমিন প্যানেল — স্টাফ সাইন-ইন")}</h2>
        <p className="small muted">{tr(lang, "Sign in with Google, Facebook or phone. Your staff role (from your user record) decides what you can do here. Customer accounts see only the access-denied message below.", "Google, Facebook বা ফোনে সাইন-ইন করুন। আপনার স্টাফ রোল (ইউজার রেকর্ড থেকে) এখানে কী করতে পারবেন তা ঠিক করে। কাস্টমার অ্যাকাউন্ট শুধু নিচের নিষেধ-বার্তা দেখবে।")}</p>
        <div style={{ marginTop: 12 }}>{signInCard}</div>
      </div>
    );
  }
  if (!userDoc) {
    return <p className="muted">{tr(lang, "Setting up your account…", "আপনার অ্যাকাউন্ট তৈরি হচ্ছে…")}</p>;
  }
  if (!isStaffRole(userDoc.role)) {
    return (
      <div className="card" style={{ padding: 18, textAlign: "center" }}>
        <h2 className="serif" style={{ fontSize: 24 }}>{tr(lang, "Access denied", "প্রবেশ নিষেধ")}</h2>
        <p>{tr(lang, "This panel is for staff only. Your account is a customer account — it can order from the shop, but it cannot open or manage the admin panel. A staff role is given by an admin in Users & Staff.", "এই প্যানেল শুধু স্টাফের জন্য। আপনার অ্যাকাউন্ট কাস্টমার অ্যাকাউন্ট — দোকান থেকে অর্ডার করা যাবে, কিন্তু অ্যাডমিন প্যানেল খোলা বা পরিচালনা করা যাবে না। স্টাফ রোল অ্যাডমিন Users & Staff-এ দেন।")}</p>
        <button className="btn-gold" onClick={onBack}>{tr(lang, "Back to the shop", "দোকানে ফিরুন")}</button>
      </div>
    );
  }
  const revenue = orders.filter((o) => o.status === "Completed" || o.status === "Delivered").reduce((a, o) => a + o.total, 0);
  const lowStock = products.filter((p) => p.stock <= 5);
  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Admin">
        <p className="serif" style={{ fontSize: 18, margin: 0 }}>{tr(lang, "Admin panel", "অ্যাডমিন প্যানেল")}</p>
        <p className="small muted" style={{ margin: 0 }}>{userDoc.name} • {userDoc.role}</p>
        {ADMIN_TABS.map(([id, en, bn]) => <button key={id} className={`chip ${tab === id ? "chip-on" : ""}`} onClick={() => setTab(id)}>{lang === "bn" ? bn : en}</button>)}
        <button className="btn-ghost" onClick={onBack}>{tr(lang, "Back to shop", "দোকানে ফিরুন")}</button>
      </nav>
      <div>
        {tab === "dashboard" && (
          <div>
            <h3 className="serif" style={{ fontSize: 20 }}>{tr(lang, "Dashboard", "ড্যাশবোর্ড")}</h3>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 10 }}>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{orders.length}</b><p className="small">{tr(lang, "Orders (recent 100)", "অর্ডার (সাম্প্রতিক ১০০)")}</p></div>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{tk(revenue)}</b><p className="small">{tr(lang, "Completed / Delivered revenue", "সম্পন্ন / ডেলিভার্ড আয়")}</p></div>
              <div className="card" style={{ padding: 12, textAlign: "center" }}><b style={{ fontSize: 20 }}>{orders.filter((o) => o.status === "Pending").length}</b><p className="small">{tr(lang, "Pending orders", "অপেক্ষমাণ অর্ডার")}</p></div>
            </div>
            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              <b>{tr(lang, "Low stock", "কম স্টক")}</b>
              {lowStock.length === 0 ? <p className="small muted">{tr(lang, "No product is at or below 5 in stock.", "কোনো প্রোডাক্টের স্টক ৫ বা তার নিচে নেই।")}</p> : lowStock.map((p) => <p key={p.slug} className="small">{p.nameEn} — {p.stock} {tr(lang, "left", "বাকি")}</p>)}
            </div>
            <div className="card" style={{ padding: 14, marginTop: 12 }}>
              <b>{tr(lang, "What the admin panel controls", "অ্যাডমিন প্যানেল যা যা নিয়ন্ত্রণ করে")}</b>
              <p className="small" style={{ marginTop: 6 }}>{tr(lang, "Everything on the customer site — products, prices, categories, banners, offers, orders, reservations, settings and content — is read live from Firestore. Editing anything here changes the customer panel at once; there is no separate copy to sync.", "কাস্টমার সাইটের সবকিছু — প্রোডাক্ট, দাম, ক্যাটাগরি, ব্যানার, অফার, অর্ডার, রিজার্ভেশন, সেটিংস ও কনটেন্ট — Firestore থেকে লাইভ পড়া হয়। এখানে কিছু বদলালেই কাস্টমার প্যানেল সাথে সাথে বদলে যায়; আলাদা কোনো কপি মেলানোর দরকার নেই।")}</p>
            </div>
          </div>
        )}
        {tab === "orders" && <OrdersTab userDoc={userDoc} products={products} lang={lang} />}
        {tab === "pos" && <PosTab userDoc={userDoc} products={products} settings={settings} lang={lang} />}
        {tab === "products" && <ProductsTab userDoc={userDoc} categories={categories} products={products} lang={lang} />}
        {tab === "reservations" && <ReservationsTab userDoc={userDoc} lang={lang} />}
        {tab === "coupons" && <CouponsTab userDoc={userDoc} lang={lang} />}
        {tab === "content" && <ContentTab userDoc={userDoc} settings={settings} lang={lang} />}
        {tab === "settings" && <SettingsTab userDoc={userDoc} settings={settings} lang={lang} />}
        {tab === "users" && <UsersTab userDoc={userDoc} lang={lang} />}
        {tab === "support" && <SupportTab userDoc={userDoc} products={products} lang={lang} />}
        {tab === "inventory" && <InventoryTab userDoc={userDoc} lang={lang} />}
        {tab === "firebase" && <FirebaseTab userDoc={userDoc} lang={lang} onSeed={onSeed} seedBusy={seedBusy} seedMsg={seedMsg} />}
      </div>
    </div>
  );
}
// AdminPanel.tsx ends here.