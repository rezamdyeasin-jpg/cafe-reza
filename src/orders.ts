// Order creation through a Firestore transaction: stock is checked and
// decremented atomically, totals are computed from the product
// documents read inside the transaction (never from client-sent
// totals), and loyalty points are credited in the same transaction.
// Staff must still verify totals/payment before confirming an order:
// without a Cloud Function there is no server-side recomputation.
//
// Firestore transactions require ALL reads before ANY write: a read
// after a write fails with "Firestore transactions require all reads
// to be executed before all writes." So this transaction reads
// everything first (products, coupon, user) and only then writes
// (stock, coupon count, order, loyalty). That ordering is the whole
// fix for website orders failing at checkout.
import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, where, type DocumentReference } from "firebase/firestore";
import { getDb } from "./firebase";
import type { Order, OrderItem, Product, Settings } from "./db";

export type CartLine = { product: Product; qty: number; size: string; sugar: string; milk: string; note: string };

// --- Discounts: one shared implementation, used by the cart preview,
// the POS and the order transaction, so the price the customer sees is
// always the price they are charged. Every value comes from the admin
// Settings (comboMinQty / comboDiscount / happyHour* / cancelWindow*);
// the constants below are only fallbacks when a setting is missing.
// Combo: any single product with quantity >= comboMinQty gives
// comboDiscount off PER qualifying product line. No free-item option.
export const COMBO_MIN_QTY = 4;
export const COMBO_DISCOUNT_PER_LINE = 10;
export function timeToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
export function comboDiscount(lines: Array<{ qty: number }>, minQty: number, amount: number): number {
  if (minQty <= 0 || amount <= 0) return 0;
  let d = 0;
  for (const l of lines) if (l.qty >= minQty) d += amount;
  return d;
}

// Happy Hour: every day happyHourStart–happyHourEnd the cafe gives
// happyHourPercent off the subtotal, automatically. The same helpers
// run in the cart preview and in the order transaction.
export const HAPPY_HOUR_START = "16:00";
export const HAPPY_HOUR_END = "18:00";
export const HAPPY_HOUR_PERCENT = 2;
export function isHappyHour(now = new Date(), startMin: number, endMin: number): boolean {
  if (endMin <= startMin) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= startMin && cur < endMin;
}
export function happyHourDiscount(subtotal: number, now = new Date(), startMin: number, endMin: number, percent: number): number {
  if (percent <= 0) return 0;
  return isHappyHour(now, startMin, endMin) ? Math.round((subtotal * percent) / 100) : 0;
}

export function calcTotals(subtotal: number, discount: number, vatPercent: number, orderType: string, deliveryFeeSetting: number, freeAt: number) {
  const after = Math.max(0, subtotal - discount);
  const vat = Math.round((after * vatPercent) / 100);
  const deliveryFee = orderType === "delivery" ? (freeAt > 0 && after >= freeAt ? 0 : deliveryFeeSetting) : 0;
  return { vat, deliveryFee, total: after + vat + deliveryFee };
}

// Cancel an order and give its stock back. The same helper serves the
// customer cancel button and the admin status dropdown, so both paths
// restore stock the same way. Customers may only cancel their own
// order, only while it is Pending/Confirmed, and only inside the
// cancel window (an admin setting, in minutes); staff may cancel any
// order at any time. The Firestore rules enforce the same limits, so
// a direct write cannot bypass them.
export async function cancelOrderTx(args: {
  uid: string;
  orderId: string;
  cancelWindowMinutes: number;
  isStaff: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const firestore = getDb();
  if (!firestore) return { ok: false, error: "Firebase is not configured." };
  try {
    await runTransaction(firestore, async (tx) => {
      const orderRef = doc(firestore, "orders", args.orderId);
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error("Order not found.");
      const o = snap.data() as { userId?: string; status?: string; items?: Array<{ productId: string; qty: number }>; createdAt?: { toMillis?: () => number } | string };
      if (!args.isStaff && o.userId !== args.uid) throw new Error("This is not your order.");
      if (args.isStaff) {
        // Staff may cancel any order that has not ended yet — a
        // customer who messages after the window is helped this way.
        // Delivered/Completed orders are done; they go through the
        // refund flow instead, not a cancellation.
        if (o.status === "Cancelled" || o.status === "Refunded" || o.status === "Delivered" || o.status === "Completed") throw new Error("This order can no longer be cancelled.");
      } else {
        if (o.status !== "Pending" && o.status !== "Confirmed") throw new Error("This order can no longer be cancelled.");
      }
      if (!args.isStaff) {
        const createdMs = typeof o.createdAt === "string" ? Date.parse(o.createdAt) : (o.createdAt?.toMillis?.() ?? 0);
        if (!createdMs || Date.now() - createdMs > args.cancelWindowMinutes * 60 * 1000) {
          throw new Error("The cancellation window has passed — please message the cafe in the chatbox.");
        }
      }
      // ---- Reads: product stock for every item (before any write) ----
      const items = Array.isArray(o.items) ? o.items : [];
      const stocks: Array<{ ref: DocumentReference; stock: number; qty: number }> = [];
      for (const it of items) {
        const ref = doc(firestore, "products", it.productId);
        const pSnap = await tx.get(ref);
        if (pSnap.exists()) stocks.push({ ref, stock: Number((pSnap.data() as { stock?: number }).stock ?? 0), qty: Number(it.qty ?? 0) });
      }
      // ---- Writes: stock back, then the status ----
      for (const s of stocks) tx.update(s.ref, { stock: s.stock + s.qty });
      tx.update(orderRef, { status: "Cancelled" });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Bangladeshi mobile number: a website order's phone must be a
// real Bangladeshi mobile number, or the order must not go through.
// Accepted forms: 01XXXXXXXXX (11 digits), +8801XXXXXXXXX and
// 8801XXXXXXXXX — all normalised to 01XXXXXXXXX for storage.
// Operator codes are 3–9 (013, 014, 015, 016, 017, 018, 019).
// A 10-digit number, a random number or any other form is rejected
// (returns null). POS counter sales have no phone, so they skip this.
export function normalizeBdPhone(raw: string): string | null {
  const d = raw.trim().replace(/[\s\-()]/g, "");
  const intl = d.match(/^\+?880(1[3-9]\d{8})$/);
  if (intl) return `0${intl[1]}`;
  const local = d.match(/^0(1[3-9]\d{8})$/);
  if (local) return `0${local[1]}`;
  return null;
}

export async function placeOrderTx(args: {
  uid: string;
  customerName: string;
  phone: string;
  address: string;
  orderType: string;
  source: string;
  paymentMethod: string;
  paymentRef: string;
  tableLabel: string;
  notes: string;
  staffName: string;
  couponCode: string;
  lines: CartLine[];
  settings: Settings;
  paidAmount: number;
  redeemBlocks?: number;
}): Promise<{ ok: boolean; orderNo?: string; total?: number; receipt?: Order; error?: string }> {
  const firestore = getDb();
  if (!firestore) return { ok: false, error: "Firebase is not configured." };
  if (args.lines.length === 0) return { ok: false, error: "The cart is empty." };
  // Website orders need a real Bangladeshi mobile number — a wrong
  // or random number must not place an order. The number is stored
  // normalised (01XXXXXXXXX). POS counter sales have no phone.
  const isPos = args.source === "pos";
  let phone = args.phone;
  if (!isPos) {
    const ok = normalizeBdPhone(args.phone);
    if (!ok) return { ok: false, error: "Enter a valid Bangladeshi mobile number (11 digits, starting with 01)." };
    phone = ok;
  }
  const code = args.couponCode.trim().toUpperCase();
  try {
    // First-order-only coupons: check the customer's real order
    // history BEFORE the transaction. Existing customers have no
    // orderCount field on their user doc yet, so the order history
    // itself is the source of truth here; the transaction below also
    // increments orderCount on the user doc, which closes the race
    // where the same customer places two first orders at once.
    // POS orders have no customer account, so this check is skipped
    // there — the admin decides at the counter.
    if (code && !isPos) {
      const cSnap = await getDoc(doc(firestore, "coupons", code));
      if (cSnap.exists() && (cSnap.data() as { firstOrderOnly?: boolean }).firstOrderOnly === true) {
        const prior = await getDocs(query(collection(firestore, "orders"), where("userId", "==", args.uid), limit(1)));
        if (!prior.empty) return { ok: false, error: "This coupon is only for your first order — you already have an order." };
      }
    }
    const placed = await runTransaction(firestore, async (tx) => {
      // ---- Reads: user (website orders only) — once, early: both
      // the first-order coupon check and the loyalty credit need it.
      let userRef: DocumentReference | null = null;
      let userExists = false;
      let priorOrderCount = 0;
      let currentPoints = 0;
      if (!isPos) {
        userRef = doc(firestore, "users", args.uid);
        const userSnap = await tx.get(userRef);
        if (userSnap.exists()) {
          userExists = true;
          const u = userSnap.data() as { orderCount?: number; loyaltyPoints?: number };
          priorOrderCount = Number(u.orderCount ?? 0);
          currentPoints = Number(u.loyaltyPoints ?? 0);
        }
      }

      // ---- Reads: products (price, availability, stock) ----
      type ReadLine = { line: CartLine; ref: DocumentReference; price: number; stock: number };
      const readLines: ReadLine[] = [];
      let subtotal = 0;
      for (const line of args.lines) {
        const ref = doc(firestore, "products", line.product.slug);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error(`Product ${line.product.nameEn} no longer exists.`);
        const data = snap.data() as Partial<Product>;
        const price = Number(data.discountPrice ?? data.price ?? 0);
        if (!data.available || price <= 0) throw new Error(`${line.product.nameEn} is not available right now.`);
        const stock = Number(data.stock ?? 0);
        if (stock < line.qty) throw new Error(`Not enough stock for ${line.product.nameEn}. Only ${stock} left.`);
        readLines.push({ line, ref, price, stock });
        subtotal += price * line.qty;
      }

      // ---- Read: coupon ----
      let couponDiscount = 0;
      let couponRef: DocumentReference | null = null;
      let couponUsed = 0;
      if (code) {
        couponRef = doc(firestore, "coupons", code);
        const couponSnap = await tx.get(couponRef);
        if (!couponSnap.exists()) throw new Error("Coupon code not found.");
        const c = couponSnap.data() as { active?: boolean; kind?: string; value?: number; minPurchase?: number; maxDiscount?: number | null; usageLimit?: number | null; usedCount?: number; expiresAt?: string; firstOrderOnly?: boolean };
        if (!c.active) throw new Error("This coupon is not active.");
        if (c.expiresAt && c.expiresAt < new Date().toISOString().slice(0, 10)) throw new Error("This coupon has expired.");
        if (Number(c.minPurchase ?? 0) > subtotal) throw new Error(`This coupon needs a minimum purchase of ৳${c.minPurchase}.`);
        if (c.usageLimit != null && Number(c.usedCount ?? 0) >= Number(c.usageLimit)) throw new Error("This coupon has reached its usage limit.");
        // First-order-only coupons: the pre-transaction check above
        // already looked at the real order history; this second check
        // on the user doc's orderCount (incremented atomically below)
        // closes the race where two first orders land at once.
        if (c.firstOrderOnly && priorOrderCount > 0) throw new Error("This coupon is only for your first order — you already have an order.");
        couponDiscount = c.kind === "percent" ? Math.round((subtotal * Number(c.value ?? 0)) / 100) : Number(c.value ?? 0);
        if (c.maxDiscount != null) couponDiscount = Math.min(couponDiscount, Number(c.maxDiscount));
        couponDiscount = Math.min(couponDiscount, subtotal);
        couponUsed = Number(c.usedCount ?? 0) + 1;
      }

      // ---- Loyalty redemption (website orders only): the customer
      // asked to spend blocks of `loyaltyRedeemPoints` points, each
      // worth `loyaltyRedeemValue` off. Clamped to the points they
      // actually have, so a stale request can never over-redeem.
      // The deduction itself lands in the loyalty credit below.
      let loyaltyDiscount = 0;
      let redeemBlocksUsed = 0;
      if (!isPos) {
        const rp = args.settings.loyaltyRedeemPoints || 100;
        const rv = args.settings.loyaltyRedeemValue || 0;
        const maxBlocks = rp > 0 && rv > 0 ? Math.floor(currentPoints / rp) : 0;
        redeemBlocksUsed = Math.max(0, Math.min(args.redeemBlocks ?? 0, maxBlocks));
        loyaltyDiscount = Math.min(subtotal, redeemBlocksUsed * rv);
      }

      // ---- Discounts from the cart itself (same helpers the cart
      // preview uses, so the charged total matches the shown total) ----
      const combo = Math.min(comboDiscount(readLines.map((r) => ({ qty: r.line.qty })), args.settings.comboMinQty ?? COMBO_MIN_QTY, args.settings.comboDiscount ?? COMBO_DISCOUNT_PER_LINE), subtotal);
      const happy = happyHourDiscount(subtotal, new Date(), timeToMin(args.settings.happyHourStart ?? HAPPY_HOUR_START), timeToMin(args.settings.happyHourEnd ?? HAPPY_HOUR_END), args.settings.happyHourPercent ?? HAPPY_HOUR_PERCENT);
      const discount = Math.min(subtotal, couponDiscount + combo + happy + loyaltyDiscount);
      const { vat, deliveryFee, total } = calcTotals(subtotal, discount, args.settings.vatPercent, args.orderType, args.settings.deliveryFee, args.settings.freeDeliveryAt);
      if (args.settings.minOrder > 0 && total < args.settings.minOrder && args.source === "website") {
        throw new Error(`Minimum order is ৳${args.settings.minOrder}.`);
      }

      // ---- Loyalty: points earned on the final total, minus the
      // points the customer just redeemed, from the user snapshot
      // read at the top of the transaction. ----
      let loyalty: { points: number; tier: string } | null = null;
      if (!isPos && userRef) {
        const rp = args.settings.loyaltyRedeemPoints || 100;
        const earned = args.settings.loyaltyPerAmount > 0 ? Math.floor(total / args.settings.loyaltyPerAmount) : 0;
        const next = currentPoints - redeemBlocksUsed * rp + earned;
        loyalty = { points: next, tier: next >= 1000 ? "Gold" : next >= 500 ? "Silver" : "Bronze" };
      }

      // ---- Writes (only after every read above) ----
      for (const r of readLines) tx.update(r.ref, { stock: r.stock - r.line.qty });
      if (couponRef) tx.update(couponRef, { usedCount: couponUsed });
      const orderRef = doc(collection(firestore, "orders"));
      const no = `CR-${orderRef.id.slice(0, 6).toUpperCase()}`;
      const items: OrderItem[] = readLines.map((r) => ({ productId: r.line.product.slug, name: r.line.product.nameEn, qty: r.line.qty, price: r.price, size: r.line.size, note: r.line.note }));
      // The receipt is the exact order that is written below — the
      // same numbers, never recomputed afterwards. createdAt is the
      // server timestamp in Firestore; the receipt carries the
      // placement moment from this client (within a second of it) so
      // the just-placed order can show its receipt at once.
      const receipt: Order = {
        id: orderRef.id, orderNo: no, userId: args.uid, customerName: args.customerName, phone, address: args.address,
        orderType: args.orderType, source: args.source, status: isPos ? "Completed" : "Pending",
        paymentMethod: args.paymentMethod, paymentStatus: isPos ? "Paid" : "Unpaid", paymentRef: args.paymentRef,
        subtotal, discount, vat, deliveryFee, total,
        discountBreakdown: { coupon: couponDiscount, combo, happyHour: happy, loyalty: loyaltyDiscount },
        paidAmount: args.paidAmount, changeAmount: Math.max(0, args.paidAmount - total),
        tableLabel: args.tableLabel, notes: args.notes, staffName: args.staffName,
        items, couponCode: code, createdAt: new Date().toISOString(),
      };
      tx.set(orderRef, { ...receipt, createdAt: serverTimestamp() });
      // Loyalty: 1 point per `loyaltyPerAmount` spent (website orders),
      // and the order count that proves whether the next order is a
      // first order. Both ride on the same user-doc write, which only
      // happens when the user doc actually exists — updating a
      // missing doc would fail the whole transaction.
      if (userRef && userExists) tx.update(userRef, { orderCount: priorOrderCount + 1, ...(loyalty ? { loyaltyPoints: loyalty.points, tier: loyalty.tier } : {}) });
      return { no, total, receipt };
    });
    return { ok: true, orderNo: placed.no, total: placed.total, receipt: placed.receipt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
