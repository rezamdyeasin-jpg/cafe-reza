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
import { collection, doc, runTransaction, serverTimestamp, type DocumentReference } from "firebase/firestore";
import { getDb } from "./firebase";
import type { OrderItem, Product, Settings } from "./db";

export type CartLine = { product: Product; qty: number; size: string; sugar: string; milk: string; note: string };

export function calcTotals(subtotal: number, discount: number, vatPercent: number, orderType: string, deliveryFeeSetting: number, freeAt: number) {
  const after = Math.max(0, subtotal - discount);
  const vat = Math.round((after * vatPercent) / 100);
  const deliveryFee = orderType === "delivery" ? (freeAt > 0 && after >= freeAt ? 0 : deliveryFeeSetting) : 0;
  return { vat, deliveryFee, total: after + vat + deliveryFee };
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
}): Promise<{ ok: boolean; orderNo?: string; error?: string }> {
  const firestore = getDb();
  if (!firestore) return { ok: false, error: "Firebase is not configured." };
  if (args.lines.length === 0) return { ok: false, error: "The cart is empty." };
  try {
    const orderNo = await runTransaction(firestore, async (tx) => {
      const isPos = args.source === "pos";
      const code = args.couponCode.trim().toUpperCase();

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
      let discount = 0;
      let couponRef: DocumentReference | null = null;
      let couponUsed = 0;
      if (code) {
        couponRef = doc(firestore, "coupons", code);
        const couponSnap = await tx.get(couponRef);
        if (!couponSnap.exists()) throw new Error("Coupon code not found.");
        const c = couponSnap.data() as { active?: boolean; kind?: string; value?: number; minPurchase?: number; maxDiscount?: number | null; usageLimit?: number | null; usedCount?: number; expiresAt?: string };
        if (!c.active) throw new Error("This coupon is not active.");
        if (c.expiresAt && c.expiresAt < new Date().toISOString().slice(0, 10)) throw new Error("This coupon has expired.");
        if (Number(c.minPurchase ?? 0) > subtotal) throw new Error(`This coupon needs a minimum purchase of ৳${c.minPurchase}.`);
        if (c.usageLimit != null && Number(c.usedCount ?? 0) >= Number(c.usageLimit)) throw new Error("This coupon has reached its usage limit.");
        discount = c.kind === "percent" ? Math.round((subtotal * Number(c.value ?? 0)) / 100) : Number(c.value ?? 0);
        if (c.maxDiscount != null) discount = Math.min(discount, Number(c.maxDiscount));
        discount = Math.min(discount, subtotal);
        couponUsed = Number(c.usedCount ?? 0) + 1;
      }

      const { vat, deliveryFee, total } = calcTotals(subtotal, discount, args.settings.vatPercent, args.orderType, args.settings.deliveryFee, args.settings.freeDeliveryAt);
      if (args.settings.minOrder > 0 && total < args.settings.minOrder && args.source === "website") {
        throw new Error(`Minimum order is ৳${args.settings.minOrder}.`);
      }

      // ---- Read: loyalty user (website orders only) ----
      let loyalty: { ref: DocumentReference; points: number; tier: string } | null = null;
      if (!isPos && args.settings.loyaltyPerAmount > 0) {
        const userRef = doc(firestore, "users", args.uid);
        const userSnap = await tx.get(userRef);
        if (userSnap.exists()) {
          const points = Math.floor(total / args.settings.loyaltyPerAmount);
          const current = Number((userSnap.data() as { loyaltyPoints?: number }).loyaltyPoints ?? 0);
          const next = current + points;
          loyalty = { ref: userRef, points: next, tier: next >= 1000 ? "Gold" : next >= 500 ? "Silver" : "Bronze" };
        }
      }

      // ---- Writes (only after every read above) ----
      for (const r of readLines) tx.update(r.ref, { stock: r.stock - r.line.qty });
      if (couponRef) tx.update(couponRef, { usedCount: couponUsed });
      const orderRef = doc(collection(firestore, "orders"));
      const no = `CR-${orderRef.id.slice(0, 6).toUpperCase()}`;
      const items: OrderItem[] = readLines.map((r) => ({ productId: r.line.product.slug, name: r.line.product.nameEn, qty: r.line.qty, price: r.price, size: r.line.size, note: r.line.note }));
      tx.set(orderRef, {
        orderNo: no, userId: args.uid, customerName: args.customerName, phone: args.phone, address: args.address,
        orderType: args.orderType, source: args.source, status: isPos ? "Completed" : "Pending",
        paymentMethod: args.paymentMethod, paymentStatus: isPos ? "Paid" : "Unpaid", paymentRef: args.paymentRef,
        subtotal, discount, vat, deliveryFee, total,
        paidAmount: args.paidAmount, changeAmount: Math.max(0, args.paidAmount - total),
        tableLabel: args.tableLabel, notes: args.notes, staffName: args.staffName,
        items, couponCode: code, createdAt: serverTimestamp(),
      });
      // Loyalty: 1 point per `loyaltyPerAmount` spent (website orders).
      if (loyalty) tx.update(loyalty.ref, { loyaltyPoints: loyalty.points, tier: loyalty.tier });
      return no;
    });
    return { ok: true, orderNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
