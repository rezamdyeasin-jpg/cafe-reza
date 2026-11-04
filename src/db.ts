// Typed Firestore documents + live hooks for the standalone build.
// Every read below is a live onSnapshot subscription: when an admin
// edits a product, price, banner or setting in the admin panel, the
// customer site updates without a refresh — one database, two panels.
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
  type DocumentData,
  type Query,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { SEED_CATEGORIES, SEED_PRODUCTS, DEFAULT_SETTINGS } from "./seed";

export type Lang = "bn" | "en";
export const tr = (lang: Lang, en: string, bn: string) => (lang === "bn" ? bn : en);

export function tsToIso(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const t = v as Timestamp;
  if (typeof t.toDate === "function") { try { return t.toDate().toISOString(); } catch { return ""; } }
  return "";
}

export type Category = { id: string; nameEn: string; nameBn: string; sortOrder: number; active: boolean };
export type Product = {
  id: string; slug: string; nameEn: string; nameBn: string; description: string;
  categoryId: string; price: number; discountPrice: number | null; costPrice: number;
  stock: number; available: boolean; featured: boolean; bestSeller: boolean; isNew: boolean;
  prepTime: number; imageKey: string | null; imageKey2: string | null; ingredients: string; sortOrder: number;
};
export type Settings = {
  cafeName: string; tagline: string; taglineBn: string; address: string; phone: string; email: string; facebook: string;
  hours: string; vatPercent: number; deliveryFee: number; freeDeliveryAt: number; minOrder: number;
  bkashNumber: string; nagadNumber: string; rocketNumber: string; paymentNote: string;
  adsJson: string; hoursJson: string; zonesJson: string; paymentsJson: string; contentJson: string;
  promoVideo: string; bannersJson: string; loyaltyPerAmount: number; loyaltyRedeemPoints: number; loyaltyRedeemValue: number;
};
export type Coupon = { id: string; code: string; kind: string; value: number; minPurchase: number; maxDiscount: number | null; usageLimit: number | null; usedCount: number; active: boolean; expiresAt: string; description: string };
export type OrderItem = { productId: string; name: string; qty: number; price: number; size: string; note: string };
export type Order = {
  id: string; orderNo: string; userId: string | null; customerName: string; phone: string; address: string;
  orderType: string; source: string; status: string; paymentMethod: string; paymentStatus: string; paymentRef: string;
  subtotal: number; discount: number; vat: number; deliveryFee: number; total: number;
  paidAmount: number; changeAmount: number; tableLabel: string; notes: string; staffName: string;
  items: OrderItem[]; couponCode: string; createdAt: string;
};
export type Reservation = { id: string; name: string; phone: string; email: string; date: string; time: string; guests: number; requests: string; status: string; tableLabel: string; userId: string; createdAt: string };
export type UserDoc = { id: string; name: string; email: string; phone: string; role: string; status: string; loyaltyPoints: number; tier: string; addresses: string[]; wishlist: string[]; createdAt: string };
export type MessageDoc = { id: string; userId: string; guestName: string; guestPhone: string; orderNo: string; author: string; authorName: string; body: string; readFlag: boolean; createdAt: string };
export type Ticket = { id: string; userId: string; name: string; phone: string; category: string; priority: string; status: string; message: string; reply: string; createdAt: string };
export type Review = { id: string; productId: string; author: string; rating: number; comment: string; status: string; createdAt: string };
export type InventoryItem = { id: string; name: string; category: string; unit: string; quantity: number; lowAt: number; costPerUnit: number; expiry: string; supplier: string };
export type Supplier = { id: string; name: string; phone: string; item: string; notes: string };
export type Expense = { id: string; category: string; description: string; amount: number; date: string; createdAt: string };
export type TableDoc = { id: string; label: string; capacity: number; status: string; notes: string };
export type RefundRequest = { id: string; orderId: string; orderNo: string; amount: number; reason: string; requestedBy: string; requestedByName: string; status: string; decidedBy: string; decidedByName: string; createdAt: string };

export const STAFF_ROLES = ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"];
export const isStaffRole = (role: string | undefined | null) => !!role && STAFF_ROLES.includes(role);
export const ORDER_STATUSES = ["Pending", "Confirmed", "Preparing", "Ready", "Out for Delivery", "Delivered", "Completed", "Cancelled", "Refunded"];
export const PAYMENTS = ["Cash on Delivery", "Cash at Counter", "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer"];

export function useLive<T>(build: () => Query<DocumentData> | null, map: (id: string, d: DocumentData) => T, deps: unknown[] = []): { data: T[]; loading: boolean; error: string } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = build();
    if (!q) { setLoading(false); return; }
    const unsub = onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => map(d.id, d.data()))); setLoading(false); setError(""); },
      (e) => { setError(e.message); setLoading(false); });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

export function useLiveDoc<T>(path: string | null, map: (d: DocumentData) => T, fallback: T): { data: T; loading: boolean; error: string } {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const firestore = getDb();
    if (!firestore || !path) { setLoading(false); return; }
    const unsub = onSnapshot(doc(firestore, path),
      (snap) => { if (snap.exists()) setData(map(snap.data())); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return { data, loading, error };
}

export function settingsFromDoc(d: DocumentData | undefined): Settings {
  const s = (d ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...s } as Settings;
}
export function productFromDoc(id: string, d: DocumentData): Product {
  const p = d as Partial<Product>;
  return {
    id, slug: p.slug ?? id, nameEn: p.nameEn ?? "", nameBn: p.nameBn ?? "", description: p.description ?? "",
    categoryId: p.categoryId ?? "", price: Number(p.price ?? 0), discountPrice: p.discountPrice ?? null,
    costPrice: Number(p.costPrice ?? 0), stock: Number(p.stock ?? 0), available: p.available !== false,
    featured: !!p.featured, bestSeller: !!p.bestSeller, isNew: !!p.isNew, prepTime: Number(p.prepTime ?? 10),
    imageKey: p.imageKey ?? null, imageKey2: p.imageKey2 ?? null, ingredients: p.ingredients ?? "",
    sortOrder: Number(p.sortOrder ?? 0),
  };
}
export function categoryFromDoc(id: string, d: DocumentData): Category {
  const c = d as Partial<Category>;
  return { id, nameEn: c.nameEn ?? "", nameBn: c.nameBn ?? "", sortOrder: Number(c.sortOrder ?? 0), active: c.active !== false };
}
export function orderFromDoc(id: string, d: DocumentData): Order {
  const o = d as Partial<Order> & { createdAt?: unknown };
  const items = Array.isArray(o.items) ? (o.items as OrderItem[]) : [];
  return {
    id, orderNo: o.orderNo ?? id.slice(0, 8).toUpperCase(), userId: o.userId ?? null,
    customerName: o.customerName ?? "", phone: o.phone ?? "", address: o.address ?? "",
    orderType: o.orderType ?? "delivery", source: o.source ?? "website", status: o.status ?? "Pending",
    paymentMethod: o.paymentMethod ?? "Cash on Delivery", paymentStatus: o.paymentStatus ?? "Unpaid",
    paymentRef: o.paymentRef ?? "", subtotal: Number(o.subtotal ?? 0), discount: Number(o.discount ?? 0),
    vat: Number(o.vat ?? 0), deliveryFee: Number(o.deliveryFee ?? 0), total: Number(o.total ?? 0),
    paidAmount: Number(o.paidAmount ?? 0), changeAmount: Number(o.changeAmount ?? 0),
    tableLabel: o.tableLabel ?? "", notes: o.notes ?? "", staffName: o.staffName ?? "",
    items, couponCode: o.couponCode ?? "", createdAt: tsToIso(o.createdAt),
  };
}
export function expenseFromDoc(id: string, d: DocumentData): Expense {
  const e = d as Partial<Expense> & { createdAt?: unknown };
  return { id, category: e.category ?? "", description: e.description ?? "", amount: Number(e.amount ?? 0), date: e.date ?? "", createdAt: tsToIso(e.createdAt) };
}

export function userFromDoc(id: string, d: DocumentData): UserDoc {
  const u = d as Partial<UserDoc> & { createdAt?: unknown };
  return {
    id, name: u.name ?? "", email: u.email ?? "", phone: u.phone ?? "", role: u.role ?? "customer",
    status: u.status ?? "active", loyaltyPoints: Number(u.loyaltyPoints ?? 0), tier: u.tier ?? "Bronze",
    addresses: Array.isArray(u.addresses) ? (u.addresses as string[]) : [],
    wishlist: Array.isArray(u.wishlist) ? (u.wishlist as string[]) : [],
    createdAt: tsToIso(u.createdAt),
  };
}

export function useCatalog() {
  const firestore = getDb();
  const cats = useLive<Category>(() => (firestore ? query(collection(firestore, "categories"), orderBy("sortOrder")) : null), categoryFromDoc);
  const prods = useLive<Product>(() => (firestore ? query(collection(firestore, "products"), orderBy("sortOrder")) : null), productFromDoc);
  return { categories: cats.data, products: prods.data, loading: cats.loading || prods.loading, error: cats.error || prods.error };
}
export function useSettingsDoc() {
  return useLiveDoc<Settings>("settings/cafe", settingsFromDoc, { ...DEFAULT_SETTINGS });
}

// Idempotent seed: inserts only missing categories/products and creates
// settings/cafe only when it does not exist. Never overwrites an
// admin-edited price, stock, flag or setting.
export async function seedCatalog(): Promise<{ inserted: number; categories: number; error?: string }> {
  const firestore = getDb();
  if (!firestore) return { inserted: 0, categories: 0, error: "Firebase is not configured." };
  try {
    const existingCats = await getDocs(collection(firestore, "categories"));
    const existingProds = await getDocs(collection(firestore, "products"));
    const catIds = new Set(existingCats.docs.map((d) => d.id));
    const prodSlugs = new Set(existingProds.docs.map((d) => (d.data().slug as string | undefined) ?? d.id));
    const batch = writeBatch(firestore);
    let catCount = 0;
    for (const c of SEED_CATEGORIES) {
      if (!catIds.has(c.id)) { batch.set(doc(firestore, "categories", c.id), { ...c }); catCount++; }
    }
    let inserted = 0;
    SEED_PRODUCTS.forEach((p, i) => {
      if (!prodSlugs.has(p.slug)) {
        batch.set(doc(firestore, "products", p.slug), {
          slug: p.slug, nameEn: p.en, nameBn: p.bn, description: p.desc, categoryId: p.categoryId,
          price: p.price, discountPrice: null, costPrice: 0, stock: 100, available: p.avail,
          featured: p.feat, bestSeller: p.best, isNew: p.isNew, prepTime: 10,
          imageKey: p.img, imageKey2: p.img2, ingredients: p.ing, sortOrder: i + 1, updatedAt: serverTimestamp(),
        });
        inserted++;
      }
    });
    const settingsSnap = await getDocs(query(collection(firestore, "settings"), where("__name__", "==", "cafe"), limit(1)));
    if (settingsSnap.empty) batch.set(doc(firestore, "settings", "cafe"), { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp() });
    // Default tables so the Tables & Reservations tab is never an empty
    // list on a fresh setup; the owner can rename, add or delete them.
    const existingTables = await getDocs(collection(firestore, "tables"));
    if (existingTables.empty) {
      ["T1", "T2", "T3", "T4", "T5", "T6"].forEach((label, i) => {
        batch.set(doc(firestore, "tables", label), { label, capacity: i < 2 ? 2 : 4, status: "Available", notes: "" });
      });
    }
    batch.set(doc(firestore, "meta", "lastSync"), { at: serverTimestamp(), products: SEED_PRODUCTS.length, source: "cafe-reza-firebase-seed" });
    await batch.commit();
    return { inserted, categories: catCount };
  } catch (e) {
    return { inserted: 0, categories: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export function parseContent(json?: string | null): { announcement: string; aboutText: string; showGallery: boolean } {
  try {
    const raw = JSON.parse(json ?? "") as { announcement?: unknown; aboutText?: unknown; showGallery?: unknown };
    return { announcement: typeof raw?.announcement === "string" ? raw.announcement : "", aboutText: typeof raw?.aboutText === "string" ? raw.aboutText : "", showGallery: raw?.showGallery !== false };
  } catch { return { announcement: "", aboutText: "", showGallery: true }; }
}
export function parseBannerSelection(json?: string | null): string[] {
  try {
    const raw = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
  } catch { return []; }
}
export type AdSlot = { id: string; enabled: boolean; kind: "image" | "code"; imageUrl: string; linkUrl: string; code: string };
export const AD_SLOT_DEFS: Array<{ id: string; label: string }> = [
  { id: "home-banner", label: "Homepage banner" },
  { id: "menu", label: "Below the menu list" },
  { id: "offers", label: "Offers section" },
  { id: "footer", label: "Footer area" },
];
export function parseAds(json?: string | null): AdSlot[] {
  let arr: unknown[] = [];
  try { const raw = JSON.parse(json ?? "[]") as unknown; arr = Array.isArray(raw) ? raw : []; } catch { arr = []; }
  return AD_SLOT_DEFS.map((d) => {
    const found = arr.find((x) => (x as AdSlot)?.id === d.id) as Partial<AdSlot> | undefined;
    return { id: d.id, enabled: found?.enabled === true, kind: found?.kind === "code" ? "code" : "image", imageUrl: typeof found?.imageUrl === "string" ? found.imageUrl : "", linkUrl: typeof found?.linkUrl === "string" ? found.linkUrl : "", code: typeof found?.code === "string" ? found.code : "" };
  });
}
export function enabledPayments(json?: string | null): string[] {
  try {
    const raw = JSON.parse(json ?? "") as unknown;
    if (Array.isArray(raw) && raw.length > 0) return raw.filter((s): s is string => typeof s === "string");
  } catch { /* fall through */ }
  return [...PAYMENTS];
}
export function orderNoFor(id: string): string {
  return `CR-${id.slice(0, 6).toUpperCase()}`;
}
