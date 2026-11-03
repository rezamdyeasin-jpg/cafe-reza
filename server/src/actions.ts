import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { privileged } from "@space/privileged";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

type Db = ReturnType<Ctx["db"]>;
async function privCrypto(ctx: Ctx, op: "hash" | "random", salt = "", password = "", bytes = 32) {
  const r = await ctx.executePrivileged(privileged.cryptoOps, { op, salt, password, bytes });
  return r.value;
}
const hashFor = (ctx: Ctx, salt: string, pw: string) => privCrypto(ctx, "hash", salt, pw);
const randHex = (ctx: Ctx, bytes = 32) => privCrypto(ctx, "random", "", "", bytes);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

async function authUser(ctx: Ctx, token?: string | null) {
  if (!token) return null;
  const db = ctx.db<typeof schema>();
  const s = (await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1))[0];
  if (!s) return null;
  const u = (await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1))[0];
  if (!u || u.status !== "active") return null;
  return u;
}
const STAFF = ["admin", "manager", "cashier", "kitchen", "waiter", "delivery", "inventory"];
// Fixed roles, owner instruction 3 Nov 2026 (screenshot: Md.yeasin Reza):
// rezamdyeasin@gmail.com is the owner / Super Admin (role "admin" is
// the owner role in this system) and yeasinreza81@gmail.com is an
// ordinary customer. The two must never swap panels: the guards below
// keep the owner out of customer sign-in/registration and keep the
// customer out of every staff path.
const OWNER_EMAIL = "rezamdyeasin@gmail.com";
const CUSTOMER_EMAIL = "yeasinreza81@gmail.com";
async function requireStaff(ctx: Ctx, token?: string | null) {
  const u = await authUser(ctx, token);
  if (!u || !STAFF.includes(u.role)) throw new Error("Staff sign-in is required for this action.");
  return u;
}
async function requireAdmin(ctx: Ctx, token?: string | null) {
  const u = await authUser(ctx, token);
  if (!u || (u.role !== "admin" && u.role !== "manager")) throw new Error("Admin sign-in is required for this action.");
  return u;
}
const pubUser = (u: typeof schema.users.$inferSelect) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, emailVerified: u.emailVerified === 1, status: u.status, loyaltyPoints: u.loyaltyPoints, tier: u.tier, createdAt: u.createdAt.toISOString() });
// Generates a 6-digit verification code, stores only its hash with a
// 15-minute expiry. No email provider is configured in this build, so no
// code is ever emailed here — the request/resend actions report that
// honestly, and verification completes only through a real channel
// (Firebase verification email, or a configured provider later).
async function issueVerificationCode(ctx: Ctx, email: string) {
  const db = ctx.db<typeof schema>();
  const hex = await randHex(ctx, 4);
  const code = String((parseInt(hex.slice(0, 8), 16) % 900000) + 100000).padStart(6, "0");
  const salt = await randHex(ctx, 16);
  await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, email));
  await db.insert(schema.emailVerifications).values({ email, codeHash: await hashFor(ctx, salt, code), salt, attempts: 0, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  // Returned only to the internal caller so it can hand the code to the
  // configured email provider. It is never sent to the client, never
  // logged, and the stored row is removed again if sending fails.
  return code;
}
// Configurable email provider (Resend HTTP API) via the host-only
// privileged sender. Credentials come only from the hosting
// environment (RESEND_API_KEY / RESEND_FROM); with no provider
// configured this returns sent:false and nothing is faked.
async function trySendVerificationEmail(ctx: Ctx, email: string, code: string): Promise<{ sent: boolean; detail: string }> {
  try {
    return await ctx.executePrivileged(privileged.sendEmail, {
      to: email,
      subject: "Your Cafe Reza verification code",
      text: `Your Cafe Reza verification code is ${code}. It expires in 15 minutes. If you did not register, ignore this email.`,
    });
  } catch {
    return { sent: false, detail: "Could not reach the email provider. Check the connection and try again." };
  }
}
// Append-only audit trail: every admin/staff change records who did what.
// Audit rows are never edited or deleted by any action.
async function auditLog(db: Db, actor: { id: number; name: string } | null, action: string, targetType: string, targetId: number | undefined, detail: string) {
  try { await db.insert(schema.auditLogs).values({ actorId: actor?.id ?? null, actorName: actor?.name ?? "", action, targetType, targetId: targetId ?? null, detail: detail.slice(0, 500) }); } catch { /* audit failure must never block the change itself */ }
}
async function recordSecurityEvent(db: Db, ev: { userId?: number | null; email: string; kind: string; detail: string }) {
  try { await db.insert(schema.securityEvents).values({ userId: ev.userId ?? null, email: ev.email, kind: ev.kind, detail: ev.detail.slice(0, 500) }); } catch { /* never block sign-in on logging failure */ }
}
// Verifies a Firebase Auth ID token with Google's tokeninfo endpoint, the
// same way linkGoogleAccount verifies Google sign-ins. Firebase sets
// email_verified=true on the token only after the user clicks the
// verification link Firebase emailed them, so a token passing these
// checks is proof the mailbox was verified — the client is never
// trusted on its own word. Returns the verified email on success.
async function verifyFirebaseIdToken(idToken: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  type TokenInfo = { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string; exp?: string };
  let info: TokenInfo | null = null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return { ok: false, error: "Google could not verify this Firebase sign-in. Please try again." };
    const parsed: unknown = await res.json();
    info = parsed as TokenInfo;
  } catch {
    return { ok: false, error: "Could not reach Google to verify this Firebase sign-in. Check the connection and try again." };
  }
  if (!info || info.aud !== "cafe-reza" || info.iss !== "https://securetoken.google.com/cafe-reza" || !info.sub || !info.email) {
    return { ok: false, error: "This Firebase sign-in could not be verified for Cafe Reza." };
  }
  if (info.exp && Number(info.exp) * 1000 < Date.now()) return { ok: false, error: "This Firebase sign-in has expired. Please sign in again." };
  if (info.email_verified !== "true") return { ok: false, error: "Firebase says this email is not verified yet. Open the verification email Firebase sent and click its link, then try again." };
  return { ok: true, email: info.email.toLowerCase() };
}
// Removes a customer account and its personal rows. Past orders keep
// their totals for the cafe's records but are anonymised and detached.
// Audit and security history rows are kept (they carry no password or
// address). Shared by the admin delete action and the one-time cleanup.
async function deleteCustomerRows(db: Db, userId: number) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await db.delete(schema.addresses).where(eq(schema.addresses.userId, userId));
  await db.delete(schema.wishlist).where(eq(schema.wishlist.userId, userId));
  await db.delete(schema.loyaltyTx).where(eq(schema.loyaltyTx.userId, userId));
  await db.delete(schema.messages).where(eq(schema.messages.userId, userId));
  await db.update(schema.notifications).set({ userId: null }).where(eq(schema.notifications.userId, userId));
  await db.update(schema.orders).set({ userId: null, customerName: "Deleted customer", phone: "", address: "" }).where(eq(schema.orders.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
// Shared sign-in: password check, staff-only gate, 15-minute lockout after
// 5 failed attempts for the same email, a login-success notification for
// the account owner, and a recorded event for every attempt outcome.
async function attemptLogin(ctx: Ctx, email: string, password: string, staffOnly: boolean): Promise<{ ok: boolean; token?: string; error?: string }> {
  const db = ctx.db<typeof schema>();
  const normalized = email.toLowerCase();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const recent = await db.select().from(schema.securityEvents).where(and(eq(schema.securityEvents.email, normalized), eq(schema.securityEvents.kind, "login_failed"))).orderBy(desc(schema.securityEvents.id)).limit(10);
  if (recent.filter((e) => e.createdAt >= cutoff).length >= 5) {
    await recordSecurityEvent(db, { email: normalized, kind: "login_blocked", detail: "Too many failed sign-in attempts in 15 minutes." });
    return { ok: false, error: "Too many failed sign-in attempts. Please wait 15 minutes and try again." };
  }
  const u = (await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1))[0];
  if (!u || (await hashFor(ctx, u.salt, password)) !== u.passwordHash) {
    await recordSecurityEvent(db, { userId: u?.id ?? null, email: normalized, kind: "login_failed", detail: "Wrong email or password." });
    return { ok: false, error: "Email or password is incorrect." };
  }
  if (u.status !== "active") {
    await recordSecurityEvent(db, { userId: u.id, email: normalized, kind: "login_failed", detail: "Suspended account sign-in attempt." });
    return { ok: false, error: "This account is suspended. Contact the cafe." };
  }
  if (!staffOnly && STAFF.includes(u.role)) {
    await recordSecurityEvent(db, { userId: u.id, email: normalized, kind: "login_failed", detail: "Staff account used at the customer sign-in." });
    return { ok: false, error: "Staff accounts sign in from the admin panel, not here. The owner (Super Admin) account never signs in as a customer." };
  }
  if (staffOnly && !STAFF.includes(u.role)) {
    await recordSecurityEvent(db, { userId: u.id, email: normalized, kind: "login_failed", detail: "Customer account used at the staff sign-in." });
    return { ok: false, error: "This sign-in is for staff accounts only. Customer accounts sign in from My Account." };
  }
  const token = await randHex(ctx, 32);
  await db.insert(schema.sessions).values({ token, userId: u.id });
  await recordSecurityEvent(db, { userId: u.id, email: normalized, kind: "login_success", detail: staffOnly ? "Staff sign-in." : "Customer sign-in." });
  await db.insert(schema.notifications).values({ userId: u.id, title: "New sign-in to your account", body: `A sign-in to ${normalized} just succeeded${staffOnly ? " at the staff panel" : ""}. If this was not you, sign out on all devices and tell the cafe owner.`, kind: "security" });
  return { ok: true, token };
}
const reservationShape = (r: typeof schema.reservations.$inferSelect) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, date: r.date, time: r.time, guests: r.guests, requests: r.requests, status: r.status, tableLabel: r.tableLabel, createdAt: r.createdAt.toISOString() });
const prodShape = (p: typeof schema.products.$inferSelect, catName: string) => ({
  id: p.id, slug: p.slug, nameEn: p.nameEn, nameBn: p.nameBn, description: p.description,
  categoryId: p.categoryId, category: catName, price: p.price, discountPrice: p.discountPrice,
  stock: p.stock, available: p.available === 1, featured: p.featured === 1,
  bestSeller: p.bestSeller === 1, isNew: p.isNew === 1, prepTime: p.prepTime, imageKey: p.imageKey, imageKey2: p.imageKey2, ingredients: p.ingredients, sortOrder: p.sortOrder,
});
const orderShape = (o: typeof schema.orders.$inferSelect) => ({
  id: o.id, orderNo: o.orderNo, userId: o.userId, customerName: o.customerName, phone: o.phone,
  address: o.address, orderType: o.orderType, source: o.source, status: o.status,
  paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, paymentRef: o.paymentRef,
  subtotal: o.subtotal, discount: o.discount, vat: o.vat, deliveryFee: o.deliveryFee, total: o.total,
  paidAmount: o.paidAmount, changeAmount: o.changeAmount, tableLabel: o.tableLabel, notes: o.notes,
  staffName: o.staffName, couponCode: o.couponCode,
  items: JSON.parse(o.itemsJson) as Array<{ productId: number; name: string; qty: number; price: number; size: string; note: string }>,
  history: JSON.parse(o.historyJson) as Array<{ status: string; at: string; by: string }>,
  createdAt: o.createdAt.toISOString(),
});
async function getSettings(db: Db) {
  const s = (await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1))[0];
  return s ?? { id: 1, cafeName: "Café Reza", tagline: "On a mission to serve fresh, healthy & tasty food.", address: "Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh", phone: "+880 1805-501689", email: "", facebook: "https://www.facebook.com/cafereza4u", hours: "", vatPercent: 0, deliveryFee: 40, freeDeliveryAt: 500, minOrder: 0, demoMode: 1, bkashNumber: "", nagadNumber: "", rocketNumber: "", paymentNote: "", adsJson: "[]", hoursJson: "", zonesJson: "[]", paymentsJson: "", contentJson: "", promoVideo: "main", bannersJson: "[]", loyaltyPerAmount: 100, loyaltyRedeemPoints: 100, loyaltyRedeemValue: 20 };
}
async function catalog(db: Db, includeCost = false) {
  const cats = await db.select().from(schema.categories).orderBy(schema.categories.sortOrder);
  const prods = await db.select().from(schema.products).orderBy(schema.products.sortOrder);
  const catName = new Map(cats.map((c) => [c.id, c.nameEn]));
  return { categories: cats.map((c) => ({ id: c.id, nameEn: c.nameEn, nameBn: c.nameBn, sortOrder: c.sortOrder, active: c.active === 1 })), products: prods.map((p) => includeCost ? { ...prodShape(p, catName.get(p.categoryId) ?? ""), costPrice: p.costPrice } : prodShape(p, catName.get(p.categoryId) ?? "")) };
}
function calcTotals(subtotal: number, discount: number, vatPercent: number, orderType: string, deliveryFeeSetting: number, freeAt: number) {
  const after = Math.max(0, subtotal - discount);
  const vat = Math.round((after * vatPercent) / 100);
  const deliveryFee = orderType === "delivery" ? (after >= freeAt && freeAt > 0 ? 0 : deliveryFeeSetting) : 0;
  return { vat, deliveryFee, total: after + vat + deliveryFee };
}

const SEED_CATS: Array<[string, string]> = [["Hot Coffee", "হট কফি"], ["Cold Coffee", "কোল্ড কফি"], ["Milkshake", "মিল্কশেক"], ["Smoothies", "স্মুদি"], ["Fresh Juice", "ফ্রেশ জুস"], ["Desserts", "ডেজার্ট"], ["Fast Food", "ফাস্ট ফুড"], ["Tea", "চা"], ["Mocktails", "মকটেল"]];
const SEED_PRODUCTS: Array<{ slug: string; en: string; bn: string; cat: number; price: number; img: string | null; img2?: string | null; ing: string; feat: boolean; best: boolean; isNew: boolean; avail?: boolean; desc: string }> = [
  { slug: "hot-coffee-regular", en: "Hot Coffee (Regular)", bn: "হট কফি (রেগুলার)", cat: 1, price: 50, img: "poster-hot-coffee", feat: false, best: false, isNew: false, ing: "Coffee, Milk, Hot water", desc: "Classic hot coffee, served fresh at the counter." },
  { slug: "hot-coffee-special", en: "Hot Coffee (Special)", bn: "হট কফি (স্পেশাল)", cat: 1, price: 80, img: "poster-hot-coffee", feat: true, best: true, isNew: false, ing: "Coffee, Milk, Hot water", desc: "Our special hot coffee — the house favourite." },
  { slug: "choco-cold-coffee", en: "Choco Cold Coffee", bn: "চকো কোল্ড কফি", cat: 2, price: 80, img: "poster-choco", feat: true, best: false, isNew: false, ing: "Coffee, Chocolate, Milk, Ice", desc: "Chilled chocolate coffee, served cold." },
  { slug: "caramel-cold-coffee", en: "Caramel Cold Coffee", bn: "ক্যারামেল কোল্ড কফি", cat: 2, price: 80, img: "poster-caramel", feat: false, best: false, isNew: false, ing: "Coffee, Caramel, Milk, Ice", desc: "Chilled caramel coffee, served cold." },
  { slug: "special-cold-coffee", en: "Special Cold Coffee", bn: "স্পেশাল কোল্ড কফি", cat: 2, price: 200, img: "poster-special-cold", feat: true, best: false, isNew: false, ing: "Coffee, Milk, Ice", desc: "Our special cold coffee." },
  { slug: "oreo-milkshake", en: "Oreo Milkshake", bn: "ওরিও মিল্কশেক", cat: 3, price: 100, img: "poster-oreo", feat: false, best: true, isNew: false, ing: "Oreo cookies, Milk, Ice, Cream", desc: "Thick Oreo milkshake." },
  { slug: "kitkat-milkshake", en: "Kitkat Milkshake", bn: "কিটক্যাট মিল্কশেক", cat: 3, price: 100, img: "poster-kitkat", feat: false, best: false, isNew: false, ing: "KitKat, Milk, Ice, Cream", desc: "Thick Kitkat milkshake." },
  { slug: "strawberry-milkshake", en: "Strawberry Milkshake", bn: "স্ট্রবেরি মিল্কশেক", cat: 3, price: 140, img: "poster-strawberry", feat: false, best: false, isNew: false, ing: "Strawberry, Milk, Ice", desc: "Strawberry milkshake." },
  { slug: "coconut-smoothie", en: "Coconut Smoothie", bn: "কোকোনাট স্মুদি", cat: 4, price: 60, img: "poster-coconut", feat: false, best: false, isNew: false, ing: "Coconut, Milk, Ice", desc: "Cool, creamy coconut smoothie." },
  { slug: "pineapple-juice", en: "Pineapple Juice", bn: "আনারসের জুস", cat: 5, price: 40, img: "poster-pineapple", feat: false, best: false, isNew: false, ing: "Pineapple, Ice, Water", desc: "Fresh pineapple juice." },
  { slug: "mixed-fruit-juice", en: "Mixed Fruit Juice", bn: "মিক্সড ফ্রুট জুস", cat: 5, price: 80, img: "main-mixed-fruit-juice", feat: false, best: false, isNew: false, ing: "Mixed fruits, Ice, Water", desc: "Mixed fresh fruit juice." },
  { slug: "grapes-juice", en: "Grapes Juice", bn: "আঙুরের জুস", cat: 5, price: 0, img: "poster-grapes", img2: "poster-grapes2", feat: false, best: false, isNew: true, avail: false, ing: "Grapes, Ice, Water", desc: "Grapes juice. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "special-faluda", en: "Special Faluda", bn: "স্পেশাল ফালুদা", cat: 6, price: 150, img: "poster-faluda", img2: "poster-faluda-red", feat: true, best: true, isNew: false, ing: "Milk, Ice cream, Vermicelli, Basil seeds, Jelly, Fruits", desc: "Cafe Reza's signature special faluda." },
  { slug: "doi-chira", en: "Doi-Chira", bn: "দই-চিড়া", cat: 6, price: 60, img: "poster-doi-chira", img2: "tray", feat: false, best: false, isNew: false, ing: "Curd, Flattened rice, Banana, Coconut, Fruits, Basil seeds", desc: "Curd with flattened rice — a light, traditional favourite." },
  { slug: "special-doi-chira", en: "Special Doi-Chira", bn: "স্পেশাল দই-চিড়া", cat: 6, price: 100, img: "poster-doi-chira", img2: "tray", feat: false, best: false, isNew: false, ing: "Curd, Flattened rice, Banana, Coconut, Fruits, Basil seeds", desc: "The special version of our doi-chira." },
  { slug: "chicken-momo-5pc", en: "Chicken Momo (5 pcs)", bn: "চিকেন মোমো (৫ পিস)", cat: 7, price: 80, img: "poster-momo", img2: "tray2", feat: false, best: true, isNew: false, ing: "Chicken, Onion, Spices, Flour wrapper, Dipping sauce", desc: "Steamed chicken momo, five pieces per plate." },
  { slug: "naga-momo", en: "Naga Momo (5 pcs)", bn: "নাগা মোমো (৫ পিস)", cat: 7, price: 90, img: "poster-momo", img2: "tray2", feat: false, best: false, isNew: true, ing: "Chicken, Naga chilli, Spices, Flour wrapper, Dipping sauce", desc: "Spicy naga-style steamed momo, five pieces, served with special sauce." },
  { slug: "regular-milk-tea", en: "Regular Milk Tea", bn: "রেগুলার দুধ চা", cat: 8, price: 40, img: "poster-milk-tea", feat: false, best: false, isNew: false, ing: "Tea, Milk, Sugar, Water", desc: "Regular milk tea." },
  { slug: "malai-tea", en: "Malai Tea", bn: "মালাই চা", cat: 8, price: 50, img: "poster-malai", feat: false, best: false, isNew: false, ing: "Tea, Milk, Malai, Sugar", desc: "Rich malai tea." },
  { slug: "blue-lagoon-mocktail", en: "Blue Lagoon Mocktail", bn: "ব্লু লেগুন মকটেল", cat: 9, price: 0, img: "poster-blue", feat: false, best: false, isNew: true, avail: false, ing: "Blue syrup, Lemon, Soda water, Mint, Ice", desc: "Blue Lagoon mocktail. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "energy-booster", en: "Energy Booster", bn: "এনার্জি বুস্টার", cat: 5, price: 100, img: "poster-energy", img2: "poster-energy-detail", feat: false, best: false, isNew: true, ing: "Banana, Dates, Honey, Almonds, Raisins, Cashews, Milk", desc: "Our energy booster drink." },
  { slug: "yogurd-lacchi", en: "Yogurd Lacchi", bn: "দইয়ের লাচ্ছি", cat: 4, price: 60, img: "poster-lacchi", img2: "tray", feat: false, best: false, isNew: false, ing: "Yoghurt, Milk, Sugar, Ice", desc: "Chilled yoghurt lacchi." },
  { slug: "green-mango-juice", en: "Green Mango Juice", bn: "কাঁচা আমের জুস", cat: 5, price: 0, img: "poster-greenmango", feat: false, best: false, isNew: true, avail: false, ing: "Green mango, Ice, Water", desc: "Green mango juice. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "blue-lagoon-crusher", en: "Blue Lagoon Crusher", bn: "ব্লু লেগুন ক্রাশার", cat: 9, price: 0, img: "poster-crusher", feat: false, best: false, isNew: true, avail: false, ing: "Blue syrup, Lemon, Crushed ice, Soda water", desc: "Blue Lagoon Crusher — a separate variant from Blue Lagoon Mocktail. Price to be set by the owner in Admin." },
  { slug: "litchi-juice", en: "Litchi Juice", bn: "লিচুর জুস", cat: 5, price: 0, img: "poster-litchi", feat: false, best: false, isNew: true, avail: false, ing: "Litchi, Ice, Water", desc: "Litchi juice. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "dragon-fruit-juice", en: "Dragon Fruit Juice", bn: "ড্রাগন ফলের জুস", cat: 5, price: 0, img: "poster-dragon", feat: false, best: false, isNew: true, avail: false, ing: "Dragon fruit, Ice, Water", desc: "Dragon fruit juice. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "orange-juice", en: "Orange Juice", bn: "কমলার জুস", cat: 5, price: 0, img: "poster-orange", feat: false, best: false, isNew: true, avail: false, ing: "Orange, Ice, Water", desc: "Orange juice. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "mango-milkshake", en: "Mango Milkshake", bn: "আমের মিল্কশেক", cat: 3, price: 0, img: "poster-mango-shake", feat: false, best: false, isNew: true, avail: false, ing: "Mango, Milk, Ice", desc: "Mango milkshake. Price to be set by the owner in Admin — not orderable until then." },
  { slug: "horlicks-tea", en: "Horlicks Tea", bn: "হরলিক্স চা", cat: 8, price: 30, img: "main-horlicks-tea", feat: false, best: false, isNew: false, ing: "Horlicks, Milk, Tea", desc: "Printed menu: 30/50 TK. Please confirm the option with the cafe when ordering." },
  { slug: "edible-cup-tea", en: "Edible Cup Tea", bn: "এডিবল কাপ চা", cat: 8, price: 50, img: "main-edible-cup-tea", feat: false, best: false, isNew: false, ing: "Tea, Milk, Edible cup", desc: "Tea served in an edible cup." },
  { slug: "cold-tea", en: "Cold Tea", bn: "কোল্ড চা", cat: 2, price: 80, img: "poster-cold-tea", feat: false, best: false, isNew: false, ing: "Tea, Ice, Water, Sugar", desc: "Chilled cold tea." },
  { slug: "iced-mint-lemonade-half", en: "Iced Mint Lemonade (Half)", bn: "আইসড মিন্ট লেমনেড (হাফ)", cat: 5, price: 60, img: "poster-lemonade-half", feat: false, best: false, isNew: true, ing: "Mint, Lemon, Ice, Sugar, Water", desc: "Iced mint lemonade, half size — 60 TK per the owner's correction." },
  { slug: "iced-mint-lemonade-full", en: "Iced Mint Lemonade (Full)", bn: "আইসড মিন্ট লেমনেড (ফুল)", cat: 5, price: 120, img: "poster-lemonade-full", feat: false, best: false, isNew: true, ing: "Mint, Lemon, Ice, Sugar, Water", desc: "Iced mint lemonade, full size — 120 TK per the owner's correction." },
  { slug: "mango-smoothie", en: "Mango Smoothie", bn: "আমের স্মুদি", cat: 4, price: 0, img: "poster-mango-smoothie", feat: false, best: false, isNew: true, avail: false, ing: "Mango, Yoghurt, Ice", desc: "Mango smoothie. Price to be set by the owner in Admin — not orderable until then." },
];

export const Actions = {
  getStorefront: defineAction({
    description: "Returns the public catalog, settings, approved reviews and active coupons for the storefront.",
    request: z.object({}),
    response: z.object({
      categories: z.array(z.object({ id: z.number(), nameEn: z.string(), nameBn: z.string(), sortOrder: z.number(), active: z.boolean() })),
      products: z.array(z.object({ id: z.number(), slug: z.string(), nameEn: z.string(), nameBn: z.string(), description: z.string(), categoryId: z.number(), category: z.string(), price: z.number(), discountPrice: z.number().nullable(), stock: z.number(), available: z.boolean(), featured: z.boolean(), bestSeller: z.boolean(), isNew: z.boolean(), prepTime: z.number(), imageKey: z.string().nullable(), imageKey2: z.string().nullable(), ingredients: z.string(), sortOrder: z.number() })),
      settings: z.object({ cafeName: z.string(), tagline: z.string(), address: z.string(), phone: z.string(), email: z.string(), facebook: z.string(), hours: z.string(), vatPercent: z.number(), deliveryFee: z.number(), freeDeliveryAt: z.number(), minOrder: z.number(), demoMode: z.boolean(), bkashNumber: z.string(), nagadNumber: z.string(), rocketNumber: z.string(), paymentNote: z.string(), adsJson: z.string(), hoursJson: z.string(), zonesJson: z.string(), paymentsJson: z.string(), contentJson: z.string(), promoVideo: z.string(), bannersJson: z.string(), loyaltyPerAmount: z.number(), loyaltyRedeemPoints: z.number(), loyaltyRedeemValue: z.number() }),
      reviews: z.array(z.object({ id: z.number(), productId: z.number(), author: z.string(), rating: z.number(), comment: z.string(), createdAt: z.string() })),
      coupons: z.array(z.object({ code: z.string(), kind: z.string(), value: z.number(), description: z.string() })),
      hasAdmin: z.boolean(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const c = await catalog(db);
      const s = await getSettings(db);
      const revs = await db.select().from(schema.reviews).where(eq(schema.reviews.status, "Approved")).orderBy(desc(schema.reviews.id)).limit(20);
      const cps = await db.select().from(schema.coupons).where(eq(schema.coupons.active, 1));
      const admins = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
      return { ...c, settings: { cafeName: s.cafeName || "Café Reza", tagline: s.tagline || "On a mission to serve fresh, healthy & tasty food.", address: s.address || "Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh", phone: s.phone || "+880 1805-501689", email: s.email, facebook: s.facebook || "https://www.facebook.com/cafereza4u", hours: s.hours, vatPercent: s.vatPercent, deliveryFee: s.deliveryFee, freeDeliveryAt: s.freeDeliveryAt, minOrder: s.minOrder, demoMode: s.demoMode === 1, bkashNumber: s.bkashNumber, nagadNumber: s.nagadNumber, rocketNumber: s.rocketNumber, paymentNote: s.paymentNote, adsJson: s.adsJson ?? "[]", hoursJson: s.hoursJson ?? "", zonesJson: s.zonesJson ?? "[]", paymentsJson: s.paymentsJson ?? "", contentJson: s.contentJson ?? "", promoVideo: s.promoVideo ?? "main", bannersJson: s.bannersJson ?? "[]", loyaltyPerAmount: s.loyaltyPerAmount ?? 100, loyaltyRedeemPoints: s.loyaltyRedeemPoints ?? 100, loyaltyRedeemValue: s.loyaltyRedeemValue ?? 20 }, reviews: revs.map((r) => ({ id: r.id, productId: r.productId, author: r.author, rating: r.rating, comment: r.comment, createdAt: r.createdAt.toISOString() })), coupons: cps.map((x) => ({ code: x.code, kind: x.kind, value: x.value, description: x.description })), hasAdmin: admins.length > 0 };
    },
  }),

  seedCatalog: defineAction({
    description: "Syncs the real Cafe Reza menu: inserts any missing seed products and updates only the two photos (imageKey/imageKey2) and ingredients of existing seed products to the owner's supplied photos and lists. Never changes prices, stock, availability or flags the owner set in Admin.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), count: z.number(), photosUpdated: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const cats = await db.select().from(schema.categories).limit(1);
      if (cats.length === 0) {
        for (const [i, [en, bn]] of SEED_CATS.entries()) {
          await db.insert(schema.categories).values({ nameEn: en, nameBn: bn, sortOrder: i + 1, active: 1 });
        }
      }
      let inserted = 0;
      let photosUpdated = 0;
      for (const [i, p] of SEED_PRODUCTS.entries()) {
        const row = (await db.select().from(schema.products).where(eq(schema.products.slug, p.slug)).limit(1))[0];
        const img2 = p.img2 ?? p.img;
        if (!row) {
          await db.insert(schema.products).values({ slug: p.slug, nameEn: p.en, nameBn: p.bn, description: p.desc, categoryId: p.cat, price: p.price, discountPrice: null, costPrice: 0, stock: 100, available: p.avail === false ? 0 : 1, featured: p.feat ? 1 : 0, bestSeller: p.best ? 1 : 0, isNew: p.isNew ? 1 : 0, prepTime: 10, imageKey: p.img, imageKey2: img2, ingredients: p.ing, sortOrder: i + 1 });
          inserted++;
        } else if (row.imageKey !== p.img || row.imageKey2 !== img2 || row.ingredients !== p.ing) {
          await db.update(schema.products).set({ imageKey: p.img, imageKey2: img2, ingredients: p.ing }).where(eq(schema.products.id, row.id));
          photosUpdated++;
        }
      }
      ctx.invalidateQueries();
      return { seeded: inserted > 0, count: inserted, photosUpdated };
    },
  }),

  createOwner: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Creates the first owner/admin account. Only works when no admin exists; no default password is published.",
    request: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().default(""), password: z.string().min(8) }),
    response: z.object({ ok: z.boolean(), token: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.email.toLowerCase() === CUSTOMER_EMAIL) return { ok: false, error: "That email is reserved for an ordinary customer account. It can never be the owner account." };
      const admins = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
      if (admins.length > 0) return { ok: false, error: "An owner account already exists. Sign in instead." };
      const taken = await db.select().from(schema.users).where(eq(schema.users.email, args.email.toLowerCase())).limit(1);
      if (taken.length > 0) return { ok: false, error: "That email is already registered." };
      const salt = await randHex(ctx, 16);
      const rows = await db.insert(schema.users).values({ name: args.name, email: args.email.toLowerCase(), phone: args.phone, passwordHash: await hashFor(ctx, salt, args.password), salt, role: "admin", status: "active" }).returning({ id: schema.users.id });
      const user = rows[0];
      if (!user) return { ok: false, error: "Could not create the owner account." };
      const token = await randHex(ctx, 32);
      await db.insert(schema.sessions).values({ token, userId: user.id });
      ctx.invalidateQueries();
      return { ok: true, token };
    },
  }),

  register: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Registers a customer account. New accounts are always customers; roles can never be self-assigned.",
    request: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().min(6), password: z.string().min(6) }),
    response: z.object({ ok: z.boolean(), token: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.email.toLowerCase() === OWNER_EMAIL) return { ok: false, error: "That email is the owner (Super Admin) account. It is created and signed in only from the admin panel, never as a customer." };
      const taken = await db.select().from(schema.users).where(eq(schema.users.email, args.email.toLowerCase())).limit(1);
      if (taken.length > 0) return { ok: false, error: "That email is already registered. Sign in instead." };
      const salt = await randHex(ctx, 16);
      const rows = await db.insert(schema.users).values({ name: args.name, email: args.email.toLowerCase(), phone: args.phone, passwordHash: await hashFor(ctx, salt, args.password), salt, role: "customer", status: "active" }).returning({ id: schema.users.id });
      const user = rows[0];
      if (!user) return { ok: false, error: "Could not create the account." };
      const token = await randHex(ctx, 32);
      await db.insert(schema.sessions).values({ token, userId: user.id });
      await db.insert(schema.notifications).values({ userId: user.id, title: "Welcome to Cafe Reza", body: "Your account is created but your email is not verified yet. Verify your Gmail from My Account before placing an order.", kind: "welcome" });
      ctx.invalidateQueries();
      return { ok: true, token };
    },
  }),

  login: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Signs a customer or staff member in with email and password and returns a session token.",
    request: z.object({ email: z.string().email(), password: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), token: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      return attemptLogin(ctx, args.email, args.password, false);
    },
  }),

  loginStaff: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Separate staff sign-in for the admin panel. Customer accounts are rejected here at the server, never issued a staff session.",
    request: z.object({ email: z.string().email(), password: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), token: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      return attemptLogin(ctx, args.email, args.password, true);
    },
  }),

  logoutAll: defineAction({
    description: "Ends every session for the signed-in user on all devices. The current token stops working too.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: true };
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
      await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "logout_all", detail: "Signed out on all devices." });
      return { ok: true };
    },
  }),

  logout: defineAction({
    description: "Ends the current session.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sessions).where(eq(schema.sessions.token, args.token));
      return { ok: true };
    },
  }),

  linkGoogleAccount: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Verifies a Firebase Google ID token with Google's tokeninfo endpoint, then signs the matching (or newly created) customer account in. Google sign-in never verifies the email by itself: the account stays unverified until the Firebase verification email link is confirmed or the OTP code is entered, and unverified accounts cannot order.",
    request: z.object({ idToken: z.string().min(10) }),
    response: z.object({ ok: z.boolean(), token: z.string().optional(), emailVerified: z.boolean().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      type TokenInfo = { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string; name?: string; exp?: string };
      let info: TokenInfo | null = null;
      try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(args.idToken)}`);
        if (!res.ok) return { ok: false, error: "Google could not verify this sign-in. Please try again." };
        const parsed: unknown = await res.json();
        info = parsed as TokenInfo;
      } catch {
        return { ok: false, error: "Could not reach Google to verify this sign-in. Check the connection and try again." };
      }
      if (!info || info.aud !== "cafe-reza" || info.iss !== "https://securetoken.google.com/cafe-reza" || info.email_verified !== "true" || !info.sub || !info.email) {
        return { ok: false, error: "This Google sign-in could not be verified for Cafe Reza." };
      }
      if (info.exp && Number(info.exp) * 1000 < Date.now()) return { ok: false, error: "This Google sign-in has expired. Please sign in again." };
      const email = info.email.toLowerCase();
      if (email === OWNER_EMAIL) return { ok: false, error: "This is the owner (Super Admin) account. Staff accounts sign in from the admin panel, not with Google here." };
      let u = (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
      if (u && u.firebaseUid && u.firebaseUid !== info.sub) return { ok: false, error: "This email is already linked to a different Google account." };
      if (!u) {
        const salt = await randHex(ctx, 16);
        const rows = await db.insert(schema.users).values({ name: info.name || email.split("@")[0] || "Cafe Reza customer", email, phone: "", passwordHash: await hashFor(ctx, salt, await randHex(ctx, 32)), salt, role: "customer", firebaseUid: info.sub, status: "active" }).returning({ id: schema.users.id });
        u = (await db.select().from(schema.users).where(eq(schema.users.id, rows[0]?.id ?? -1)).limit(1))[0];
        if (!u) return { ok: false, error: "Could not create your account. Please try again." };
      } else if (!u.firebaseUid) {
        // Link the Google identity, but do NOT mark the email verified:
        // Firebase verification-email confirmation or OTP verification
        // is still required after Google sign-in.
        await db.update(schema.users).set({ firebaseUid: info.sub }).where(eq(schema.users.id, u.id));
      }
      if (u.status !== "active") return { ok: false, error: "This account is suspended. Contact the cafe." };
      if (u.role !== "customer") return { ok: false, error: "Staff accounts sign in from the admin panel, not with Google here." };
      const token = await randHex(ctx, 32);
      await db.insert(schema.sessions).values({ token, userId: u.id });
      await recordSecurityEvent(db, { userId: u.id, email, kind: "login_success", detail: "Google (Firebase Auth) sign-in, token verified with Google. Email verification (Firebase verification email or OTP) still required before ordering." });
      await db.insert(schema.notifications).values({ userId: u.id, title: "New sign-in to your account", body: `A Google sign-in to ${email} just succeeded. If this was not you, sign out on all devices and tell the cafe owner.${u.emailVerified !== 1 ? " Verify your email with the Firebase verification email or the OTP code before ordering." : ""}`, kind: "security" });
      return { ok: true, token, emailVerified: u.emailVerified === 1 };
    },
  }),

  requestVerificationCode: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Generates an email verification code and tries to send it through the configured email provider. Reports honestly when no provider is configured; the code is never returned to the client.",
    request: z.object({ token: z.string(), lang: z.enum(["en", "bn"]).optional() }),
    response: z.object({ ok: z.boolean(), sent: z.boolean(), alreadyVerified: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const bn = args.lang === "bn";
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: false, sent: false, alreadyVerified: false, message: bn ? "সাইন-ইন করা প্রয়োজন।" : "Sign in required." };
      if (u.emailVerified === 1) return { ok: true, sent: false, alreadyVerified: true, message: bn ? "এই ইমেইল আগেই যাচাই হয়েছে।" : "This email is already verified." };
      const code = await issueVerificationCode(ctx, u.email);
      const send = await trySendVerificationEmail(ctx, u.email, code);
      if (!send.sent) {
        await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, u.email));
        await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "verification_send_failed", detail: send.detail });
        return { ok: true, sent: false, alreadyVerified: false, message: bn ? "যাচাই ইমেইল এখনো পাঠানো যায়নি। ক্যাফের মালিককে ইমেইল প্রোভাইডার কনফিগার করতে বলুন, অথবা নিচের Firebase যাচাই মেইল ব্যবহার করুন।" : `Verification email could not be sent yet: ${send.detail} Ask the cafe owner to configure an email provider, or use the Firebase verification email below.` };
      }
      await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "verification_code_sent", detail: "Verification code emailed (provider: Resend)." });
      return { ok: true, sent: true, alreadyVerified: false, message: bn ? "আপনার Gmail-এ ৬-অঙ্কের যাচাই কোড পাঠানো হয়েছে। ১৫ মিনিটের মধ্যে মেয়াদ শেষ হবে।" : "A 6-digit verification code was sent to your Gmail. It expires in 15 minutes." };
    },
  }),

  verifyEmailCode: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Checks the 6-digit email verification code (hashed, 15-minute expiry, 5 attempts). Marks the account verified on a match.",
    request: z.object({ token: z.string(), code: z.string().length(6), lang: z.enum(["en", "bn"]).optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const bn = args.lang === "bn";
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: false, error: bn ? "সাইন-ইন করা প্রয়োজন।" : "Sign in required." };
      if (u.emailVerified === 1) return { ok: true };
      const row = (await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.email, u.email)).orderBy(desc(schema.emailVerifications.id)).limit(1))[0];
      if (!row) return { ok: false, error: bn ? "এই ইমেইলের জন্য কোনো যাচাই কোড অপেক্ষা করছে না। আগে নতুন কোড চেয়ে নিন।" : "No verification code is waiting for this email. Request a new code first." };
      if (row.expiresAt < new Date()) { await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.id, row.id)); return { ok: false, error: bn ? "কোডের মেয়াদ শেষ হয়ে গেছে। নতুন কোড চেয়ে নিন।" : "That code has expired. Request a new one." }; }
      if (row.attempts >= 5) { await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.id, row.id)); return { ok: false, error: bn ? "অনেকবার ভুল হয়েছে। নতুন কোড চেয়ে নিন।" : "Too many wrong attempts. Request a new code." }; }
      const match = (await hashFor(ctx, row.salt, args.code)) === row.codeHash;
      if (!match) {
        await db.update(schema.emailVerifications).set({ attempts: row.attempts + 1 }).where(eq(schema.emailVerifications.id, row.id));
        await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "verification_failed", detail: "Wrong verification code entered." });
        return { ok: false, error: bn ? "কোডটি সঠিক নয়। ইমেইল দেখে আবার চেষ্টা করুন।" : "That code is incorrect. Check the email and try again." };
      }
      await db.update(schema.users).set({ emailVerified: 1 }).where(eq(schema.users.id, u.id));
      await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, u.email));
      await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "email_verified", detail: "Email verified with OTP code." });
      await db.insert(schema.notifications).values({ userId: u.id, title: "Email verified", body: "Your Gmail is verified. You can now place orders.", kind: "security" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  confirmFirebaseEmailVerified: defineAction({
    description: "Confirms email verification from a Firebase verification email: the client sends a fresh Firebase ID token, the server verifies it with Google's tokeninfo endpoint and marks the account verified only when Firebase reports email_verified=true for the same email. No client claim is trusted.",
    request: z.object({ token: z.string(), idToken: z.string().min(10) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: false, error: "Sign in required." };
      if (u.emailVerified === 1) return { ok: true };
      const checked = await verifyFirebaseIdToken(args.idToken);
      if (!checked.ok) return { ok: false, error: checked.error ?? "Firebase verification failed." };
      if (checked.email !== u.email.toLowerCase()) return { ok: false, error: "That Firebase sign-in belongs to a different email. Sign in to Firebase with the same Gmail as this account." };
      await db.update(schema.users).set({ emailVerified: 1 }).where(eq(schema.users.id, u.id));
      await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, u.email));
      await recordSecurityEvent(db, { userId: u.id, email: u.email, kind: "email_verified", detail: "Email verified with the Firebase verification email (ID token verified with Google)." });
      await db.insert(schema.notifications).values({ userId: u.id, title: "Email verified", body: "Your Gmail is verified with the Firebase verification email. You can now place orders.", kind: "security" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminDeleteUser: defineAction({
    description: "Admin/manager deletes a customer account and its personal rows; past orders are anonymised and detached. Staff and admin accounts, and the admin's own account, can never be deleted this way.",
    request: z.object({ token: z.string(), id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), deleted: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const actor = await requireAdmin(ctx, args.token);
      const target = (await db.select().from(schema.users).where(eq(schema.users.id, args.id)).limit(1))[0];
      if (!target) return { ok: false, deleted: false, error: "That account does not exist." };
      if (target.id === actor.id) return { ok: false, deleted: false, error: "You cannot delete your own account." };
      if (target.role !== "customer") return { ok: false, deleted: false, error: "Only customer accounts can be deleted here. Staff accounts are suspended, not deleted." };
      await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, target.email));
      await deleteCustomerRows(db, target.id);
      await auditLog(db, actor, "delete_user", "user", target.id, `Admin deleted customer account ${target.email}. Past orders anonymised.`);
      await recordSecurityEvent(db, { userId: null, email: target.email, kind: "account_deleted", detail: `Admin ${actor.name} deleted the customer account; past orders anonymised.` });
      ctx.invalidateQueries();
      return { ok: true, deleted: true };
    },
  }),

  applyRequestedAccountRoles: defineAction({
    description: "One-time owner-requested account fix (3 Nov 2026): makes rezamdyeasin@gmail.com the owner/Super Admin (role admin) when it exists, and makes yeasinreza81@gmail.com an ordinary customer — deleting it only while it is unverified, has no orders, and was created before 4 Nov 2026 so it can be registered fresh with Firebase verification email. Replaying it is safe: a fresh or verified customer account is never deleted, and a customer account is never demoted when it is the only admin. It cannot create the owner account (no password is ever invented) — when the owner email does not exist yet, the owner must create it from the admin panel.",
    request: z.object({}),
    response: z.object({ ok: z.boolean(), ownerAdmin: z.boolean(), ownerMissing: z.boolean(), customerDeleted: z.boolean(), customerRoleFixed: z.boolean(), detail: z.string() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const notes: string[] = [];
      let ownerAdmin = false;
      let ownerMissing = false;
      let customerDeleted = false;
      let customerRoleFixed = false;
      const owner = (await db.select().from(schema.users).where(eq(schema.users.email, OWNER_EMAIL)).limit(1))[0];
      if (!owner) {
        ownerMissing = true;
        notes.push("Owner account rezamdyeasin@gmail.com does not exist yet — create it from the admin panel (first owner account, or Admin → Staff & Roles as admin).");
      } else if (owner.role !== "admin") {
        await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, owner.id));
        ownerAdmin = true;
        notes.push("Owner account rezamdyeasin@gmail.com is now admin (Super Admin).");
        await recordSecurityEvent(db, { userId: null, email: OWNER_EMAIL, kind: "role_fixed", detail: "One-time owner-requested fix: owner account set to admin (Super Admin)." });
      } else {
        ownerAdmin = true;
        notes.push("Owner account rezamdyeasin@gmail.com is already admin (Super Admin).");
      }
      const customer = (await db.select().from(schema.users).where(eq(schema.users.email, CUSTOMER_EMAIL)).limit(1))[0];
      if (!customer) {
        notes.push("Customer account yeasinreza81@gmail.com does not exist — it can be registered fresh as a customer.");
      } else if (customer.role === "customer" && customer.emailVerified !== 1) {
        const cutoff = new Date("2026-11-03T18:00:00.000Z");
        const orders = await db.select().from(schema.orders).where(eq(schema.orders.userId, customer.id)).limit(1);
        if (customer.createdAt < cutoff && orders.length === 0) {
          await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.email, CUSTOMER_EMAIL));
          await deleteCustomerRows(db, customer.id);
          customerDeleted = true;
          notes.push("Unverified customer account yeasinreza81@gmail.com (no orders) was deleted so it can be registered fresh.");
          await recordSecurityEvent(db, { userId: null, email: CUSTOMER_EMAIL, kind: "account_deleted", detail: "One-time owner-requested cleanup: unverified account with no orders deleted so it can be registered fresh." });
        } else {
          notes.push("Customer account yeasinreza81@gmail.com was left untouched (created after the cutoff or has orders).");
        }
      } else if (customer.role !== "customer") {
        const otherAdmin = (await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1))[0];
        if (otherAdmin && otherAdmin.id !== customer.id) {
          await db.update(schema.users).set({ role: "customer" }).where(eq(schema.users.id, customer.id));
          customerRoleFixed = true;
          notes.push("Account yeasinreza81@gmail.com was set back to an ordinary customer account.");
          await recordSecurityEvent(db, { userId: null, email: CUSTOMER_EMAIL, kind: "role_fixed", detail: "One-time owner-requested fix: account set back to customer." });
        } else {
          notes.push("Account yeasinreza81@gmail.com was left untouched: it is the only admin, so demoting it would lock out the admin panel.");
        }
      } else {
        notes.push("Customer account yeasinreza81@gmail.com is already an ordinary customer account.");
      }
      ctx.invalidateQueries();
      return { ok: true, ownerAdmin, ownerMissing, customerDeleted, customerRoleFixed, detail: notes.join(" ") };
    },
  }),

  exportMyData: defineAction({
    description: "Returns the signed-in customer's own profile, addresses, orders, messages and loyalty history as JSON for download. Nobody else's data is included.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean(), json: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: false, error: "Sign in required." };
      const addrs = await db.select().from(schema.addresses).where(eq(schema.addresses.userId, u.id));
      const ords = (await db.select().from(schema.orders).where(eq(schema.orders.userId, u.id))).map(orderShape);
      const msgs = await db.select().from(schema.messages).where(eq(schema.messages.userId, u.id));
      const loy = await db.select().from(schema.loyaltyTx).where(eq(schema.loyaltyTx.userId, u.id));
      const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, u.id));
      return { ok: true, json: JSON.stringify({ exportedAt: new Date().toISOString(), profile: pubUser(u), addresses: addrs, orders: ords, messages: msgs, loyalty: loy, notifications: notifs }, null, 2) };
    },
  }),

  deleteMyData: defineAction({
    description: "Deletes the signed-in customer's account and personal rows. Past orders keep their totals for the cafe's records but are anonymised (name, phone and address removed).",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await authUser(ctx, args.token);
      if (!u) return { ok: false, error: "Sign in required." };
      if (u.role !== "customer") return { ok: false, error: "Staff accounts are removed by the owner in the admin panel, not here." };
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
      await db.delete(schema.addresses).where(eq(schema.addresses.userId, u.id));
      await db.delete(schema.wishlist).where(eq(schema.wishlist.userId, u.id));
      await db.delete(schema.loyaltyTx).where(eq(schema.loyaltyTx.userId, u.id));
      await db.delete(schema.messages).where(eq(schema.messages.userId, u.id));
      await db.update(schema.notifications).set({ userId: null }).where(eq(schema.notifications.userId, u.id));
      await db.update(schema.orders).set({ customerName: "Deleted customer", phone: "", address: "" }).where(eq(schema.orders.userId, u.id));
      await db.delete(schema.users).where(eq(schema.users.id, u.id));
      await recordSecurityEvent(db, { userId: null, email: u.email, kind: "account_deleted", detail: "Customer deleted their own account; past orders anonymised." });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  me: defineAction({
    description: "Returns the signed-in user's profile, addresses, wishlist, orders and notifications.",
    request: z.object({ token: z.string() }),
    response: z.object({
      user: z.object({ id: z.number(), name: z.string(), email: z.string(), phone: z.string(), role: z.string(), emailVerified: z.boolean(), status: z.string(), loyaltyPoints: z.number(), tier: z.string(), createdAt: z.string() }).nullable(),
      addresses: z.array(z.object({ id: z.number(), label: z.string(), address: z.string(), area: z.string(), phone: z.string() })),
      wishlist: z.array(z.number()),
      orders: z.array(z.any()),
      notifications: z.array(z.object({ id: z.number(), title: z.string(), body: z.string(), kind: z.string(), readFlag: z.boolean(), createdAt: z.string() })),
      loyalty: z.array(z.object({ id: z.number(), points: z.number(), kind: z.string(), note: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await authUser(ctx, args.token);
      if (!u) return { user: null, addresses: [], wishlist: [], orders: [], notifications: [], loyalty: [] };
      const addrs = await db.select().from(schema.addresses).where(eq(schema.addresses.userId, u.id));
      const wish = await db.select().from(schema.wishlist).where(eq(schema.wishlist.userId, u.id));
      const ords = await db.select().from(schema.orders).where(eq(schema.orders.userId, u.id)).orderBy(desc(schema.orders.id)).limit(30);
      const notifs = await db.select().from(schema.notifications).orderBy(desc(schema.notifications.id)).limit(30);
      const mine = notifs.filter((n) => n.userId === null || n.userId === u.id);
      const loy = await db.select().from(schema.loyaltyTx).where(eq(schema.loyaltyTx.userId, u.id)).orderBy(desc(schema.loyaltyTx.id)).limit(30);
      return { user: pubUser(u), addresses: addrs.map((a) => ({ id: a.id, label: a.label, address: a.address, area: a.area, phone: a.phone })), wishlist: wish.map((w) => w.productId), orders: ords.map(orderShape), notifications: mine.map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, readFlag: n.readFlag === 1, createdAt: n.createdAt.toISOString() })), loyalty: loy.map((l) => ({ id: l.id, points: l.points, kind: l.kind, note: l.note, createdAt: l.createdAt.toISOString() })) };
    },
  }),
  getFirebaseConfig: defineAction({
    description: "Returns the Firebase web-app configuration from the hosting environment so the client can initialize Firebase Auth without any key baked into shipped source. Returns empty fields when not configured.",
    request: z.object({}),
    response: z.object({ configured: z.boolean(), apiKey: z.string(), authDomain: z.string(), projectId: z.string(), storageBucket: z.string(), messagingSenderId: z.string(), appId: z.string(), measurementId: z.string() }),
    privileged: [privileged.firebaseConfig],
    async handler(ctx) {
      return await ctx.executePrivileged(privileged.firebaseConfig, {});
    },
  }),

  placeOrder: defineAction({
    description: "Creates an order after the server re-checks prices, stock and coupons. Mobile payments stay Pending verification in Demo Mode.",
    request: z.object({
      token: z.string().optional(),
      items: z.array(z.object({ productId: z.number(), qty: z.number().int().min(1).max(50), size: z.string().default("Regular"), note: z.string().default("") })).min(1),
      customerName: z.string().min(2), phone: z.string().min(6), address: z.string().default(""),
      orderType: z.enum(["delivery", "takeaway", "dine-in"]).default("delivery"),
      source: z.enum(["website", "pos"]).default("website"),
      paymentMethod: z.string().default("Cash on Delivery"), paymentRef: z.string().default(""),
      couponCode: z.string().default(""), tableLabel: z.string().default(""), notes: z.string().default(""),
      staffName: z.string().default(""), paidAmount: z.number().default(0), zone: z.string().default(""),
      lang: z.enum(["en", "bn"]).optional(),
    }),
    response: z.object({ ok: z.boolean(), orderNo: z.string().optional(), total: z.number().optional(), paymentStatus: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      // User-facing errors follow the caller's language so Bengali mode
      // never shows an English server message at checkout. Callers that
      // do not pass `lang` (POS / admin) keep the English default.
      const bn = args.lang === "bn";
      const itemName = (p: { nameEn: string; nameBn: string }) => (bn && p.nameBn ? p.nameBn : p.nameEn);
      const meUser = await authUser(ctx, args.token ?? null);
      if (meUser && meUser.role === "customer" && meUser.emailVerified !== 1) {
        return { ok: false, error: bn ? "অর্ডার করার আগে আপনার Gmail যাচাই করুন। আমার অ্যাকাউন্ট → ইমেইল যাচাইকরণ খুলুন।" : "Please verify your Gmail before placing an order. Open My Account → Email verification." };
      }
      if (meUser && meUser.role !== "customer" && args.source === "website") {
        return { ok: false, error: bn ? "স্টাফ অ্যাকাউন্ট দিয়ে কাস্টমারের ওয়েবসাইট অর্ডার করা যায় না। কাউন্টার বিক্রি POS ট্যাব দিয়ে করতে হয়।" : "Staff accounts cannot place customer website orders. Counter sales go through the POS tab." };
      }
      const s = await getSettings(db);
      const prods = await db.select().from(schema.products);
      const byId = new Map(prods.map((p) => [p.id, p]));
      let subtotal = 0;
      const lines: Array<{ productId: number; name: string; qty: number; price: number; size: string; note: string }> = [];
      for (const it of args.items) {
        const p = byId.get(it.productId);
        if (!p) return { ok: false, error: bn ? "একটি মেনু আইটেম আর পাওয়া যাচ্ছে না।" : "A menu item is no longer available." };
        if (p.available !== 1) return { ok: false, error: bn ? `${itemName(p)} এখন পাওয়া যাচ্ছে না।` : `${p.nameEn} is not available right now.` };
        if (p.stock < it.qty) return { ok: false, error: bn ? `স্টকে শুধু ${p.stock}টি ${itemName(p)} আছে।` : `Only ${p.stock} x ${p.nameEn} left in stock.` };
        const price = p.discountPrice ?? p.price;
        subtotal += price * it.qty;
        lines.push({ productId: p.id, name: p.nameEn, qty: it.qty, price, size: it.size, note: it.note });
      }
      let discount = 0; let couponCode = "";
      if (args.couponCode.trim()) {
        const cp = (await db.select().from(schema.coupons).where(eq(schema.coupons.code, args.couponCode.trim().toUpperCase())).limit(1))[0];
        if (!cp || cp.active !== 1) return { ok: false, error: bn ? "কুপন কোডটি সঠিক নয়।" : "Coupon code is not valid." };
        if (cp.expiresAt && cp.expiresAt < new Date().toISOString().slice(0, 10)) return { ok: false, error: bn ? "এই কুপনের মেয়াদ শেষ হয়ে গেছে।" : "This coupon has expired." };
        if (cp.usageLimit && cp.usedCount >= cp.usageLimit) return { ok: false, error: bn ? "এই কুপনের ব্যবহারের সীমা পূর্ণ হয়ে গেছে।" : "This coupon has reached its usage limit." };
        if (subtotal < cp.minPurchase) return { ok: false, error: bn ? `এই কুপনের জন্য কমপক্ষে ৳${cp.minPurchase} টাকার অর্ডার লাগবে।` : `This coupon needs a minimum order of ৳${cp.minPurchase}.` };
        if (cp.kind === "percent") discount = Math.round((subtotal * cp.value) / 100);
        else if (cp.kind === "fixed") discount = cp.value;
        else if (cp.kind === "freedelivery") discount = 0;
        if (cp.maxDiscount) discount = Math.min(discount, cp.maxDiscount);
        discount = Math.min(discount, subtotal);
        couponCode = cp.code;
        await db.update(schema.coupons).set({ usedCount: cp.usedCount + 1 }).where(eq(schema.coupons.id, cp.id));
      }
      const zoneFee = (() => {
        if (!args.zone.trim()) return s.deliveryFee;
        try {
          const zones = JSON.parse(s.zonesJson ?? "[]") as Array<{ area: string; fee: number; active?: boolean }>;
          const hit = zones.find((zn) => zn.active !== false && zn.area.trim().toLowerCase() === args.zone.trim().toLowerCase());
          return hit ? hit.fee : s.deliveryFee;
        } catch { return s.deliveryFee; }
      })();
      const t = calcTotals(subtotal, discount, s.vatPercent, args.orderType, zoneFee, s.freeDeliveryAt);
      const total = t.total;
      if (total < s.minOrder) return { ok: false, error: bn ? `সর্বনিম্ন অর্ডার ৳${s.minOrder}।` : `Minimum order is ৳${s.minOrder}.` };
      const isMobile = ["bKash", "Nagad", "Rocket", "Bank Transfer"].includes(args.paymentMethod);
      const isCashPos = args.source === "pos" && (args.paymentMethod === "Cash" || args.paymentMethod === "Cash at Counter");
      const paymentStatus = isMobile ? "Pending verification" : isCashPos && args.paidAmount >= total ? "Paid" : "Unpaid";
      const count = (await db.select().from(schema.orders)).length;
      const orderNo = `CR-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(count + 1).padStart(4, "0")}`;
      const history = [{ status: "Pending", at: new Date().toISOString(), by: args.staffName || args.customerName }];
      await db.insert(schema.orders).values({
        orderNo, userId: meUser?.id ?? null, customerName: args.customerName, phone: args.phone, address: args.address,
        orderType: args.orderType, source: args.source, status: "Pending", paymentMethod: args.paymentMethod,
        paymentStatus, paymentRef: args.paymentRef, subtotal, discount, vat: t.vat, deliveryFee: t.deliveryFee, total,
        paidAmount: args.paidAmount, changeAmount: Math.max(0, args.paidAmount - total), tableLabel: args.tableLabel,
        notes: args.notes, staffName: args.staffName, itemsJson: JSON.stringify(lines), historyJson: JSON.stringify(history), couponCode,
      });
      for (const ln of lines) {
        const p = byId.get(ln.productId);
        if (p) await db.update(schema.products).set({ stock: p.stock - ln.qty }).where(eq(schema.products.id, p.id));
      }
      await db.insert(schema.notifications).values({ userId: meUser?.id ?? null, title: `New order ${orderNo}`, body: `${args.customerName} — ৳${total}. Payment: ${paymentStatus}.`, kind: "order" });
      ctx.invalidateQueries();
      return { ok: true, orderNo, total, paymentStatus };
    },
  }),

  trackOrder: defineAction({
    description: "Looks up one order by order number and phone for customer tracking.",
    request: z.object({ orderNo: z.string(), phone: z.string().default("") }),
    response: z.object({ found: z.boolean(), order: z.any().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const o = (await db.select().from(schema.orders).where(eq(schema.orders.orderNo, args.orderNo.trim().toUpperCase())).limit(1))[0];
      if (!o) return { found: false, order: null };
      if (o.phone && args.phone && o.phone !== args.phone) return { found: false, order: null };
      return { found: true, order: orderShape(o) };
    },
  }),

  listTrackedOrders: defineAction({
    description: "Looks up several of this device's recent orders at once, in the order requested, for the tracking list below the search box. Each order is only returned when its phone matches, if a phone was stored.",
    request: z.object({ orders: z.array(z.object({ orderNo: z.string(), phone: z.string().default("") })).max(20) }),
    response: z.object({ orders: z.array(z.any()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const out: Array<ReturnType<typeof orderShape>> = [];
      for (const q of args.orders) {
        const o = (await db.select().from(schema.orders).where(eq(schema.orders.orderNo, q.orderNo.trim().toUpperCase())).limit(1))[0];
        if (!o) continue;
        if (o.phone && q.phone && o.phone !== q.phone) continue;
        out.push(orderShape(o));
      }
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { orders: out };
    },
  }),

  updateOrderStatus: defineAction({
    description: "Staff change an order status, add a note, or verify a manual payment. Loyalty points are awarded once on delivery/completion.",
    request: z.object({ token: z.string(), orderId: z.number(), status: z.string().optional(), note: z.string().default(""), verifyPayment: z.boolean().default(false) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const staff = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      // Refunds are never a direct status change: a cashier or any staff
      // member can only request one; an admin/manager must approve it.
      if (args.status === "Refunded" || args.status === "Refund") return { ok: false, error: "Refunds need an approved refund request. Ask an admin/manager to approve it in Security → Refund requests." };
      const o = (await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId)).limit(1))[0];
      if (!o) throw new Error("Order not found.");
      const history = JSON.parse(o.historyJson) as Array<{ status: string; at: string; by: string }>;
      const prev = o.status;
      let patch: Partial<typeof o> = {};
      if (args.status && args.status !== prev) {
        history.push({ status: args.status, at: new Date().toISOString(), by: staff.name });
        patch = { status: args.status, historyJson: JSON.stringify(history) };
        if (args.status === "Cancelled" && prev !== "Cancelled" && prev !== "Refunded") {
          const lines = JSON.parse(o.itemsJson) as Array<{ productId: number; qty: number }>;
          for (const ln of lines) {
            const p = (await db.select().from(schema.products).where(eq(schema.products.id, ln.productId)).limit(1))[0];
            if (p) await db.update(schema.products).set({ stock: p.stock + ln.qty }).where(eq(schema.products.id, p.id));
          }
        }
        if ((args.status === "Delivered" || args.status === "Completed") && o.userId && !history.some((h, i) => i < history.length - 1 && (h.status === "Delivered" || h.status === "Completed"))) {
          const per = (await getSettings(db)).loyaltyPerAmount || 100;
          const pts = Math.floor(o.total / per);
          if (pts > 0) {
            const u = (await db.select().from(schema.users).where(eq(schema.users.id, o.userId)).limit(1))[0];
            if (u) {
              const np = u.loyaltyPoints + pts;
              await db.update(schema.users).set({ loyaltyPoints: np, tier: np >= 1000 ? "VIP" : np >= 500 ? "Gold" : np >= 200 ? "Silver" : "Bronze" }).where(eq(schema.users.id, u.id));
              await db.insert(schema.loyaltyTx).values({ userId: u.id, points: pts, kind: "earn", note: `Order ${o.orderNo}` });
            }
          }
        }
      }
      if (args.note) patch = { ...patch, notes: (o.notes ? o.notes + " | " : "") + args.note };
      if (args.verifyPayment) patch = { ...patch, paymentStatus: "Paid" };
      if (Object.keys(patch).length) await db.update(schema.orders).set(patch).where(eq(schema.orders.id, o.id));
      await auditLog(db, staff, "order.status", "order", o.id, `${o.orderNo}: ${prev} -> ${args.status ?? prev}${args.verifyPayment ? " + payment verified" : ""}`);
      await db.insert(schema.notifications).values({ userId: o.userId, title: `Order ${o.orderNo}: ${args.status ?? o.status}`, body: args.verifyPayment ? "Your payment has been verified." : `Status updated to ${args.status ?? o.status}.`, kind: "order" });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  requestRefund: defineAction({
    description: "Staff request a refund for a paid order. Nothing is refunded until an admin/manager approves it.",
    request: z.object({ token: z.string(), orderId: z.number(), reason: z.string().min(3) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const staff = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const o = (await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId)).limit(1))[0];
      if (!o) return { ok: false, error: "Order not found." };
      if (o.status === "Refunded") return { ok: false, error: "This order is already refunded." };
      if (o.paymentStatus !== "Paid" && o.status !== "Delivered" && o.status !== "Completed") return { ok: false, error: "Only a paid, delivered or completed order can be refunded." };
      const pending = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.orderId, o.id));
      if (pending.some((r) => r.status === "pending")) return { ok: false, error: "A refund request for this order is already waiting for approval." };
      await db.insert(schema.refundRequests).values({ orderId: o.id, orderNo: o.orderNo, amount: o.total, reason: args.reason, requestedBy: staff.id, requestedByName: staff.name, status: "pending" });
      await auditLog(db, staff, "refund.request", "order", o.id, `${o.orderNo} ৳${o.total}: ${args.reason}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  decideRefund: defineAction({
    description: "Admin/manager approve or reject a refund request. The approver can never be the staff member who requested it. Approval marks the order Refunded.",
    request: z.object({ token: z.string(), requestId: z.number(), approve: z.boolean() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const decider = await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const r = (await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.id, args.requestId)).limit(1))[0];
      if (!r) return { ok: false, error: "Refund request not found." };
      if (r.status !== "pending") return { ok: false, error: "This request was already decided." };
      if (r.requestedBy === decider.id) return { ok: false, error: "The staff member who requested a refund cannot approve it. Another admin/manager must decide." };
      await db.update(schema.refundRequests).set({ status: args.approve ? "approved" : "rejected", decidedBy: decider.id, decidedByName: decider.name, decidedAt: new Date() }).where(eq(schema.refundRequests.id, r.id));
      if (args.approve) {
        const o = (await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId)).limit(1))[0];
        if (o) {
          const history = JSON.parse(o.historyJson) as Array<{ status: string; at: string; by: string }>;
          history.push({ status: "Refunded", at: new Date().toISOString(), by: decider.name });
          await db.update(schema.orders).set({ status: "Refunded", paymentStatus: "Refunded", historyJson: JSON.stringify(history) }).where(eq(schema.orders.id, o.id));
          await db.insert(schema.notifications).values({ userId: o.userId, title: `Order ${o.orderNo} refunded`, body: `৳${r.amount} refund approved by ${decider.name}.`, kind: "order" });
        }
      }
      await auditLog(db, decider, args.approve ? "refund.approve" : "refund.reject", "refund_request", r.id, `${r.orderNo} ৳${r.amount} requested by ${r.requestedByName}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  cancelOrder: defineAction({
    description: "Cancels a pending order and restores stock. Customers can cancel only their own pending orders.",
    request: z.object({ token: z.string().optional(), orderId: z.number() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const o = (await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId)).limit(1))[0];
      if (!o) return { ok: false, error: "Order not found." };
      const meUser = await authUser(ctx, args.token ?? null);
      const isStaff = meUser && STAFF.includes(meUser.role);
      if (!isStaff && (!meUser || o.userId !== meUser.id)) return { ok: false, error: "You can only cancel your own orders." };
      if (o.status !== "Pending" && o.status !== "Confirmed") return { ok: false, error: "This order can no longer be cancelled. Contact the cafe." };
      const lines = JSON.parse(o.itemsJson) as Array<{ productId: number; qty: number }>;
      for (const ln of lines) {
        const p = (await db.select().from(schema.products).where(eq(schema.products.id, ln.productId)).limit(1))[0];
        if (p) await db.update(schema.products).set({ stock: p.stock + ln.qty }).where(eq(schema.products.id, p.id));
      }
      const history = JSON.parse(o.historyJson) as Array<{ status: string; at: string; by: string }>;
      history.push({ status: "Cancelled", at: new Date().toISOString(), by: meUser?.name ?? "Customer" });
      await db.update(schema.orders).set({ status: "Cancelled", historyJson: JSON.stringify(history) }).where(eq(schema.orders.id, o.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getAdminData: defineAction({
    description: "Returns all operational records for staff screens: orders, products, inventory, reservations, users, tickets and settings.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean(), data: z.any().nullable() }),
    async handler(ctx, args) {
      await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const c = await catalog(db, true);
      const s = await getSettings(db);
      const orders = await db.select().from(schema.orders).orderBy(desc(schema.orders.id)).limit(200);
      const inv = await db.select().from(schema.inventoryItems);
      const mov = await db.select().from(schema.stockMovements).orderBy(desc(schema.stockMovements.id)).limit(100);
      const exp = await db.select().from(schema.expenses).orderBy(desc(schema.expenses.id)).limit(200);
      const sup = await db.select().from(schema.suppliers);
      const res = await db.select().from(schema.reservations).orderBy(desc(schema.reservations.id)).limit(100);
      const tbl = await db.select().from(schema.tablesTbl);
      const cps = await db.select().from(schema.coupons);
      const usrs = await db.select().from(schema.users).orderBy(desc(schema.users.id)).limit(200);
      const revs = await db.select().from(schema.reviews).orderBy(desc(schema.reviews.id)).limit(100);
      const tix = await db.select().from(schema.tickets).orderBy(desc(schema.tickets.id)).limit(100);
      const sh = await db.select().from(schema.shifts).orderBy(desc(schema.shifts.id)).limit(20);
      const loy = await db.select().from(schema.loyaltyTx).orderBy(desc(schema.loyaltyTx.id)).limit(100);
      const audit = await db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.id)).limit(100);
      const sec = await db.select().from(schema.securityEvents).orderBy(desc(schema.securityEvents.id)).limit(100);
      const refunds = await db.select().from(schema.refundRequests).orderBy(desc(schema.refundRequests.id)).limit(100);
      return { ok: true, data: { ...c, settings: { ...s, demoMode: s.demoMode === 1 }, orders: orders.map(orderShape), inventory: inv, movements: mov, expenses: exp, suppliers: sup, reservations: res.map(reservationShape), tables: tbl, coupons: cps, users: usrs.map(pubUser), reviews: revs, tickets: tix, shifts: sh, loyaltyTx: loy, auditLogs: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })), securityEvents: sec.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })), refundRequests: refunds.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null })) } };
    },
  }),

  dashboardStats: defineAction({
    description: "Computes dashboard figures from stored orders, expenses, products and inventory — never hardcoded.",
    request: z.object({ token: z.string(), range: z.enum(["today", "7", "30", "all"]).default("30") }),
    response: z.object({ revenue: z.number(), todayRevenue: z.number(), orderCount: z.number(), pending: z.number(), completed: z.number(), cancelled: z.number(), customers: z.number(), products: z.number(), lowStock: z.number(), activeReservations: z.number(), expenses: z.number(), profitEstimate: z.number(), daily: z.array(z.object({ day: z.string(), total: z.number() })), paymentMix: z.array(z.object({ name: z.string(), value: z.number() })), topProducts: z.array(z.object({ name: z.string(), qty: z.number(), total: z.number() })) }),
    async handler(ctx, args) {
      await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const all = await db.select().from(schema.orders);
      const live = all.filter((o) => o.status !== "Cancelled" && o.status !== "Refunded");
      const now = new Date();
      const start = args.range === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : args.range === "7" ? new Date(now.getTime() - 7 * 86400000) : args.range === "30" ? new Date(now.getTime() - 30 * 86400000) : new Date(0);
      const inRange = live.filter((o) => o.createdAt >= start);
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const revenue = inRange.reduce((a, o) => a + o.total, 0);
      const todayRevenue = live.filter((o) => o.createdAt >= todayStart).reduce((a, o) => a + o.total, 0);
      const exps = await db.select().from(schema.expenses);
      const expTotal = exps.filter((e) => args.range === "all" || new Date(e.date + "T00:00:00") >= start).reduce((a, e) => a + e.amount, 0);
      const prods = await db.select().from(schema.products);
      const costById = new Map(prods.map((p) => [p.id, p.costPrice]));
      let cost = 0;
      for (const o of inRange) for (const ln of JSON.parse(o.itemsJson) as Array<{ productId: number; qty: number }>) cost += (costById.get(ln.productId) ?? 0) * ln.qty;
      const dailyMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) { const d = new Date(now.getTime() - i * 86400000); dailyMap.set(d.toISOString().slice(5, 10), 0); }
      for (const o of live) { const k = o.createdAt.toISOString().slice(5, 10); if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + o.total); }
      const payMap = new Map<string, number>();
      for (const o of inRange) payMap.set(o.paymentMethod, (payMap.get(o.paymentMethod) ?? 0) + o.total);
      const topMap = new Map<string, { qty: number; total: number }>();
      for (const o of inRange) for (const ln of JSON.parse(o.itemsJson) as Array<{ name: string; qty: number; price: number }>) { const cur = topMap.get(ln.name) ?? { qty: 0, total: 0 }; cur.qty += ln.qty; cur.total += ln.qty * ln.price; topMap.set(ln.name, cur); }
      const inv = await db.select().from(schema.inventoryItems);
      const res = await db.select().from(schema.reservations);
      const customers = (await db.select().from(schema.users).where(eq(schema.users.role, "customer"))).length;
      return { revenue, todayRevenue, orderCount: inRange.length, pending: all.filter((o) => o.status === "Pending").length, completed: all.filter((o) => o.status === "Completed" || o.status === "Delivered").length, cancelled: all.filter((o) => o.status === "Cancelled").length, customers, products: prods.length, lowStock: inv.filter((i) => i.quantity <= i.lowAt).length + prods.filter((p) => p.stock <= 5).length, activeReservations: res.filter((r) => r.status === "Pending" || r.status === "Confirmed" || r.status === "Approved").length, expenses: expTotal, profitEstimate: revenue - expTotal - cost, daily: [...dailyMap.entries()].map(([day, total]) => ({ day, total })), paymentMix: [...payMap.entries()].map(([name, value]) => ({ name, value })), topProducts: [...topMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 6) };
    },
  }),

  saveProduct: defineAction({
    description: "Admin creates or edits a menu product, including price, stock and visibility flags.",
    request: z.object({ token: z.string(), id: z.number().optional(), slug: z.string().optional(), nameEn: z.string().min(2), nameBn: z.string().default(""), description: z.string().default(""), categoryId: z.number(), price: z.number().int().min(0), discountPrice: z.number().nullable().optional(), costPrice: z.number().int().min(0).default(0), stock: z.number().int().min(0).default(0), available: z.boolean().default(true), featured: z.boolean().default(false), bestSeller: z.boolean().default(false), isNew: z.boolean().default(false), prepTime: z.number().int().min(1).default(10), imageKey: z.string().nullable().optional(), imageKey2: z.string().nullable().optional(), ingredients: z.string().default(""), sortOrder: z.number().int().optional() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const vals = { slug: args.slug || slugify(args.nameEn), nameEn: args.nameEn, nameBn: args.nameBn, description: args.description, categoryId: args.categoryId, price: args.price, discountPrice: args.discountPrice ?? null, costPrice: args.costPrice, stock: args.stock, available: args.available ? 1 : 0, featured: args.featured ? 1 : 0, bestSeller: args.bestSeller ? 1 : 0, isNew: args.isNew ? 1 : 0, prepTime: args.prepTime, imageKey: args.imageKey ?? null, imageKey2: args.imageKey2 ?? null, ingredients: args.ingredients, updatedAt: new Date(), ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}) };
      if (args.id) await db.update(schema.products).set(vals).where(eq(schema.products.id, args.id));
      else await db.insert(schema.products).values({ ...vals, sortOrder: args.sortOrder ?? 99 });
      await auditLog(db, actor, args.id ? "product.update" : "product.create", "product", args.id, `${args.nameEn} price ৳${args.price}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  deleteProduct: defineAction({
    description: "Admin deletes a menu product.",
    request: z.object({ token: z.string(), id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); await db.delete(schema.products).where(eq(schema.products.id, args.id)); await auditLog(db, actor, "product.delete", "product", args.id, ""); ctx.invalidateQueries(); return { ok: true }; },
  }),
  saveCategory: defineAction({
    description: "Admin creates or renames a menu category.",
    request: z.object({ token: z.string(), id: z.number().optional(), nameEn: z.string().min(2), nameBn: z.string().default(""), active: z.boolean().default(true), sortOrder: z.number().int().optional() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); if (args.id) await db.update(schema.categories).set({ nameEn: args.nameEn, nameBn: args.nameBn, active: args.active ? 1 : 0, ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}) }).where(eq(schema.categories.id, args.id)); else await db.insert(schema.categories).values({ nameEn: args.nameEn, nameBn: args.nameBn, sortOrder: args.sortOrder ?? 99, active: 1 }); await auditLog(db, actor, args.id ? "category.update" : "category.create", "category", args.id, args.nameEn); ctx.invalidateQueries(); return { ok: true }; },
  }),
  deleteCategory: defineAction({
    description: "Admin deletes an empty menu category. A category that still has products cannot be deleted.",
    request: z.object({ token: z.string(), id: z.number() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); const used = await db.select().from(schema.products).where(eq(schema.products.categoryId, args.id)).limit(1); if (used.length > 0) return { ok: false, error: "This category still has products. Move or delete its products first." }; await db.delete(schema.categories).where(eq(schema.categories.id, args.id)); await auditLog(db, actor, "category.delete", "category", args.id, ""); ctx.invalidateQueries(); return { ok: true }; },
  }),
  saveCoupon: defineAction({
    description: "Admin creates or edits a coupon with usage limits and expiry.",
    request: z.object({ token: z.string(), id: z.number().optional(), code: z.string().min(3), kind: z.string(), value: z.number().int().min(0), minPurchase: z.number().int().min(0).default(0), maxDiscount: z.number().nullable().optional(), usageLimit: z.number().nullable().optional(), active: z.boolean().default(true), expiresAt: z.string().default(""), description: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); const vals = { code: args.code.toUpperCase(), kind: args.kind, value: args.value, minPurchase: args.minPurchase, maxDiscount: args.maxDiscount ?? null, usageLimit: args.usageLimit ?? null, active: args.active ? 1 : 0, expiresAt: args.expiresAt || null, description: args.description }; if (args.id) await db.update(schema.coupons).set(vals).where(eq(schema.coupons.id, args.id)); else await db.insert(schema.coupons).values(vals); await auditLog(db, actor, args.id ? "coupon.update" : "coupon.create", "coupon", args.id, args.code); ctx.invalidateQueries(); return { ok: true }; },
  }),
  saveSettings: defineAction({
    description: "Admin updates cafe, financial, delivery, payment, content, banner and loyalty settings. Only fields supplied are changed.",
    request: z.object({ token: z.string(), cafeName: z.string().optional(), tagline: z.string().optional(), address: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), facebook: z.string().optional(), hours: z.string().optional(), vatPercent: z.number().optional(), deliveryFee: z.number().optional(), freeDeliveryAt: z.number().optional(), minOrder: z.number().optional(), demoMode: z.boolean().optional(), bkashNumber: z.string().optional(), nagadNumber: z.string().optional(), rocketNumber: z.string().optional(), paymentNote: z.string().optional(), adsJson: z.string().optional(), hoursJson: z.string().optional(), zonesJson: z.string().optional(), paymentsJson: z.string().optional(), contentJson: z.string().optional(), promoVideo: z.string().optional(), bannersJson: z.string().optional(), loyaltyPerAmount: z.number().optional(), loyaltyRedeemPoints: z.number().optional(), loyaltyRedeemValue: z.number().optional() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); const { token: _t, demoMode, ...rest } = args; const patch: Record<string, unknown> = {}; for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v; if (demoMode !== undefined) patch.demoMode = demoMode ? 1 : 0; if (Object.keys(patch).length) await db.update(schema.settings).set(patch).where(eq(schema.settings.id, 1)); await auditLog(db, actor, "settings.update", "settings", 1, Object.keys(patch).join(", ")); ctx.invalidateQueries(); return { ok: true }; },
  }),
  createReservation: defineAction({
    description: "Creates a table reservation after a server-side capacity check for that date and time. Returns the saved reservation with its ID so the customer can find it again.",
    request: z.object({ name: z.string().min(2), phone: z.string().min(6), email: z.string().default(""), date: z.string(), time: z.string(), guests: z.number().int().min(1).max(20), requests: z.string().default("") }),
    response: z.object({ ok: z.boolean(), error: z.string().optional(), reservation: z.any().nullable().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const same = await db.select().from(schema.reservations);
      const booked = same.filter((r) => r.date === args.date && r.time === args.time && !["Cancelled", "Rejected", "No Show"].includes(r.status)).length;
      if (booked >= 6) return { ok: false, error: "That time is fully booked. Please choose another time.", reservation: null };
      const rows = await db.insert(schema.reservations).values({ ...args, status: "Pending" }).returning();
      const saved = rows[0];
      ctx.invalidateQueries();
      return { ok: true, reservation: saved ? reservationShape(saved) : null };
    },
  }),
  trackReservation: defineAction({
    description: "Looks up one reservation by its ID and phone, so a customer can find the reservation just made.",
    request: z.object({ id: z.number().int().min(1), phone: z.string().default("") }),
    response: z.object({ found: z.boolean(), reservation: z.any().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const r = (await db.select().from(schema.reservations).where(eq(schema.reservations.id, args.id)).limit(1))[0];
      if (!r) return { found: false, reservation: null };
      if (r.phone && args.phone && r.phone !== args.phone) return { found: false, reservation: null };
      return { found: true, reservation: reservationShape(r) };
    },
  }),
  listMyReservations: defineAction({
    description: "Lists a customer's reservations, newest first, by the phone on the booking (or the signed-in account's phone). Used for the serial list below the reservation search.",
    request: z.object({ token: z.string().optional(), phone: z.string().default("") }),
    response: z.object({ reservations: z.array(z.any()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const meUser = await authUser(ctx, args.token ?? null);
      const phone = (args.phone || meUser?.phone || "").trim();
      const all = await db.select().from(schema.reservations).orderBy(desc(schema.reservations.id)).limit(100);
      const mine = phone ? all.filter((r) => r.phone === phone) : [];
      return { reservations: mine.map(reservationShape) };
    },
  }),
  updateReservation: defineAction({
    description: "Staff update a reservation status or assign a table. Confirming/checking in a reservation also marks its assigned table Reserved/Occupied on the table layout.",
    request: z.object({ token: z.string(), id: z.number(), status: z.string(), tableLabel: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await auditLog(db, actor, "reservation.update", "reservation", args.id, `${args.status} table ${args.tableLabel}`);
      await db.update(schema.reservations).set({ status: args.status, tableLabel: args.tableLabel }).where(eq(schema.reservations.id, args.id));
      if (args.tableLabel) {
        const table = (await db.select().from(schema.tablesTbl).where(eq(schema.tablesTbl.label, args.tableLabel)).limit(1))[0];
        if (table) {
          const next = args.status === "Checked In" ? "Occupied" : ["Approved", "Confirmed"].includes(args.status) ? "Reserved" : ["Cancelled", "Completed", "No Show", "Rejected"].includes(args.status) ? "Available" : null;
          if (next && table.status !== next) await db.update(schema.tablesTbl).set({ status: next }).where(eq(schema.tablesTbl.id, table.id));
        }
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  saveTable: defineAction({
    description: "Admin creates or updates a table's label, capacity and status.",
    request: z.object({ token: z.string(), id: z.number().optional(), label: z.string().default(""), capacity: z.number().int().min(1), status: z.string(), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); if (args.id) await db.update(schema.tablesTbl).set({ label: args.label, capacity: args.capacity, status: args.status, notes: args.notes }).where(eq(schema.tablesTbl.id, args.id)); else await db.insert(schema.tablesTbl).values({ label: args.label || "T1", capacity: args.capacity, status: args.status, notes: args.notes }); await auditLog(db, actor, args.id ? "table.update" : "table.create", "table", args.id, args.label); ctx.invalidateQueries(); return { ok: true }; },
  }),
  deleteTable: defineAction({
    description: "Admin deletes a table.",
    request: z.object({ token: z.string(), id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); await db.delete(schema.tablesTbl).where(eq(schema.tablesTbl.id, args.id)); await auditLog(db, actor, "table.delete", "table", args.id, ""); ctx.invalidateQueries(); return { ok: true }; },
  }),
  setUserRole: defineAction({
    description: "Admin changes another staff account's role within the staff roles. A role change never moves an account between panels: a customer account always stays a customer, and a staff account always stays staff — staff accounts are created only by saveStaff and customer accounts only by customer registration. An admin cannot change their own role, the owner (Super Admin) account always stays admin, and the reserved customer account always stays a customer.",
    request: z.object({ token: z.string(), id: z.number(), role: z.string() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const meUser = await requireAdmin(ctx, args.token);
      if (meUser.id === args.id) return { ok: false, error: "You cannot change your own role." };
      if (![...STAFF, "customer"].includes(args.role)) return { ok: false, error: "Unknown role." };
      const db = ctx.db<typeof schema>();
      const target = (await db.select().from(schema.users).where(eq(schema.users.id, args.id)).limit(1))[0];
      if (!target) return { ok: false, error: "That account does not exist." };
      if (target.role === "customer" && args.role !== "customer") return { ok: false, error: "A customer account always stays a customer. Staff accounts are created separately in Staff & Roles — a role change never moves an account into the admin panel." };
      if (target.role !== "customer" && args.role === "customer") return { ok: false, error: "A staff account always stays staff. A role change never moves an account into the customer panel." };
      if (target.email.toLowerCase() === OWNER_EMAIL) return { ok: false, error: "The owner (Super Admin) account always stays admin." };
      if (target.email.toLowerCase() === CUSTOMER_EMAIL && args.role !== "customer") return { ok: false, error: "That account always stays an ordinary customer account." };
      await db.update(schema.users).set({ role: args.role }).where(eq(schema.users.id, args.id));
      await auditLog(db, meUser, "user.role", "user", args.id, `role -> ${args.role}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  saveInventory: defineAction({
    description: "Staff add or edit an inventory ingredient with low-stock threshold and expiry.",
    request: z.object({ token: z.string(), id: z.number().optional(), name: z.string().min(2), category: z.string(), unit: z.string(), quantity: z.number().min(0), lowAt: z.number().min(0), costPerUnit: z.number().min(0).default(0), expiry: z.string().default(""), supplier: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireStaff(ctx, args.token); const db = ctx.db<typeof schema>(); const vals = { name: args.name, category: args.category, unit: args.unit, quantity: args.quantity, lowAt: args.lowAt, costPerUnit: args.costPerUnit, expiry: args.expiry, supplier: args.supplier }; if (args.id) await db.update(schema.inventoryItems).set(vals).where(eq(schema.inventoryItems.id, args.id)); else await db.insert(schema.inventoryItems).values(vals); await auditLog(db, actor, args.id ? "inventory.update" : "inventory.create", "inventory", args.id, args.name); ctx.invalidateQueries(); return { ok: true }; },
  }),
  stockAdjust: defineAction({
    description: "Records a stock in, stock out, wastage or adjustment movement with an audit note.",
    request: z.object({ token: z.string(), itemId: z.number(), kind: z.string(), qty: z.number(), note: z.string().default("") }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const actor = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const item = (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, args.itemId)).limit(1))[0];
      if (!item) return { ok: false, error: "Item not found." };
      const delta = args.kind === "in" || args.kind === "adjustment" ? args.qty : -Math.abs(args.qty);
      const next = Math.max(0, item.quantity + delta);
      await db.update(schema.inventoryItems).set({ quantity: next }).where(eq(schema.inventoryItems.id, item.id));
      await db.insert(schema.stockMovements).values({ itemId: item.id, kind: args.kind, qty: args.qty, note: args.note });
      await auditLog(db, actor, "stock.adjust", "inventory", item.id, `${item.name} ${args.kind} ${args.qty} ${args.note}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  saveSupplier: defineAction({
    description: "Admin saves a supplier record.",
    request: z.object({ token: z.string(), name: z.string().min(2), phone: z.string().default(""), item: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); await db.insert(schema.suppliers).values({ name: args.name, phone: args.phone, item: args.item, notes: args.notes }); await auditLog(db, actor, "supplier.create", "supplier", undefined, args.name); ctx.invalidateQueries(); return { ok: true }; },
  }),
  saveExpense: defineAction({
    description: "Admin records a business expense.",
    request: z.object({ token: z.string(), category: z.string(), description: z.string().default(""), amount: z.number().int().min(0), date: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireAdmin(ctx, args.token); const db = ctx.db<typeof schema>(); await db.insert(schema.expenses).values({ category: args.category, description: args.description, amount: args.amount, date: args.date }); await auditLog(db, actor, "expense.create", "expense", undefined, `${args.category} ৳${args.amount}`); ctx.invalidateQueries(); return { ok: true }; },
  }),
  saveStaff: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Admin creates a staff account with a role. Roles are assigned only here, never by self-registration.",
    request: z.object({ token: z.string(), name: z.string().min(2), email: z.string().email(), phone: z.string().default(""), password: z.string().min(6), role: z.string() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const actor = await requireAdmin(ctx, args.token);
      if (args.role === "customer") return { ok: false, error: "Use customer registration for customer accounts." };
      if (args.email.toLowerCase() === CUSTOMER_EMAIL) return { ok: false, error: "That email is reserved for an ordinary customer account. It can never be a staff account." };
      if (args.email.toLowerCase() === OWNER_EMAIL && args.role !== "admin") return { ok: false, error: "The owner (Super Admin) account must be created with the admin role." };
      const db = ctx.db<typeof schema>();
      const taken = await db.select().from(schema.users).where(eq(schema.users.email, args.email.toLowerCase())).limit(1);
      if (taken.length > 0) return { ok: false, error: "That email is already registered." };
      const salt = await randHex(ctx, 16);
      await db.insert(schema.users).values({ name: args.name, email: args.email.toLowerCase(), phone: args.phone, passwordHash: await hashFor(ctx, salt, args.password), salt, role: args.role, status: "active" });
      await auditLog(db, actor, "staff.create", "user", undefined, `${args.name} role ${args.role}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  toggleUser: defineAction({
    description: "Admin suspends or reactivates a user account. The owner (Super Admin) account can never be suspended, so the admin panel can never be locked out.",
    request: z.object({ token: z.string(), id: z.number(), status: z.string() }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const meUser = await requireAdmin(ctx, args.token);
      if (meUser.id === args.id) return { ok: false, error: "You cannot suspend your own account." };
      const db = ctx.db<typeof schema>();
      const target = (await db.select().from(schema.users).where(eq(schema.users.id, args.id)).limit(1))[0];
      if (!target) return { ok: false, error: "That account does not exist." };
      if (target.email.toLowerCase() === OWNER_EMAIL && args.status !== "active") return { ok: false, error: "The owner (Super Admin) account can never be suspended." };
      await db.update(schema.users).set({ status: args.status }).where(eq(schema.users.id, args.id));
      await auditLog(db, meUser, "user.status", "user", args.id, `status -> ${args.status}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  addReview: defineAction({
    description: "Submits a product review for moderation; it appears only after approval.",
    request: z.object({ productId: z.number(), author: z.string().min(2), rating: z.number().int().min(1).max(5), comment: z.string().min(3) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const db = ctx.db<typeof schema>(); await db.insert(schema.reviews).values({ ...args, status: "Pending" }); ctx.invalidateQueries(); return { ok: true }; },
  }),
  updateReview: defineAction({
    description: "Staff approve or reject a review.",
    request: z.object({ token: z.string(), id: z.number(), status: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireStaff(ctx, args.token); const db = ctx.db<typeof schema>(); await db.update(schema.reviews).set({ status: args.status }).where(eq(schema.reviews.id, args.id)); await auditLog(db, actor, "review.update", "review", args.id, args.status); ctx.invalidateQueries(); return { ok: true }; },
  }),
  createTicket: defineAction({
    description: "Creates a customer support ticket.",
    request: z.object({ name: z.string().min(2), phone: z.string().default(""), category: z.string().default("General"), priority: z.string().default("Normal"), message: z.string().min(3) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const db = ctx.db<typeof schema>(); await db.insert(schema.tickets).values({ ...args, status: "Open", reply: "" }); ctx.invalidateQueries(); return { ok: true }; },
  }),
  updateTicket: defineAction({
    description: "Staff reply to and update a support ticket.",
    request: z.object({ token: z.string(), id: z.number(), status: z.string(), reply: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const actor = await requireStaff(ctx, args.token); const db = ctx.db<typeof schema>(); await db.update(schema.tickets).set({ status: args.status, reply: args.reply }).where(eq(schema.tickets.id, args.id)); await auditLog(db, actor, "ticket.update", "ticket", args.id, args.status); ctx.invalidateQueries(); return { ok: true }; },
  }),
  // ---- Private in-app chat -------------------------------------------------
  // Messages are private: a customer sees only their own conversation
  // (signed-in account, or the phone they booked with); staff see all
  // conversations in the inbox. Nothing is shown on public pages or reviews.
  listMyMessages: defineAction({
    description: "Returns only the requesting customer's own private chat with the cafe, newest last, plus how many staff replies are unread.",
    request: z.object({ token: z.string().optional(), phone: z.string().default("") }),
    response: z.object({ messages: z.array(z.any()), unreadStaff: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const meUser = await authUser(ctx, args.token ?? null);
      const phone = (args.phone || meUser?.phone || "").trim();
      const all = await db.select().from(schema.messages).orderBy(schema.messages.id).limit(200);
      const mine = all.filter((m) => (meUser && m.userId === meUser.id) || (phone && m.guestPhone && m.guestPhone === phone));
      return { messages: mine.map((m) => ({ id: m.id, orderNo: m.orderNo, author: m.author, authorName: m.authorName, body: m.body, readFlag: m.readFlag === 1, createdAt: m.createdAt.toISOString() })), unreadStaff: mine.filter((m) => m.author === "staff" && m.readFlag !== 1).length };
    },
  }),
  sendMessage: defineAction({
    description: "A customer sends a private message to the cafe, optionally linked to an order. Signed-in customers are identified by account; guests by the phone they give.",
    request: z.object({ token: z.string().optional(), name: z.string().default(""), phone: z.string().default(""), orderNo: z.string().default(""), body: z.string().min(1).max(2000) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const meUser = await authUser(ctx, args.token ?? null);
      const phone = (args.phone || meUser?.phone || "").trim();
      const name = (args.name || meUser?.name || "").trim();
      if (!meUser && (!phone || !name)) return { ok: false, error: "Add your name and phone so the cafe can reply to you privately." };
      let orderId: number | null = null;
      if (args.orderNo) { const o = (await db.select().from(schema.orders).where(eq(schema.orders.orderNo, args.orderNo)).limit(1))[0]; if (o) orderId = o.id; }
      await db.insert(schema.messages).values({ userId: meUser?.id ?? null, guestName: meUser ? "" : name, guestPhone: meUser ? "" : phone, orderId, orderNo: args.orderNo, author: "customer", authorName: name || "Customer", body: args.body.trim(), readFlag: 0 });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  listConversations: defineAction({
    description: "Staff-only inbox: one row per customer conversation with the last message and the count of unread customer messages. Never exposed to customers.",
    request: z.object({ token: z.string() }),
    response: z.object({ conversations: z.array(z.any()) }),
    async handler(ctx, args) {
      await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const all = await db.select().from(schema.messages).orderBy(schema.messages.id).limit(500);
      const users = await db.select().from(schema.users);
      const byKey = new Map<string, { key: string; userId: number | null; name: string; phone: string; orderNo: string; lastBody: string; lastAt: string; unreadCustomer: number; count: number }>();
      for (const m of all) {
        const u = m.userId ? users.find((x) => x.id === m.userId) : undefined;
        const key = m.userId ? `u:${m.userId}` : `g:${m.guestPhone}`;
        const cur = byKey.get(key) ?? { key, userId: m.userId, name: u?.name ?? m.guestName ?? m.authorName, phone: u?.phone ?? m.guestPhone, orderNo: "", lastBody: "", lastAt: "", unreadCustomer: 0, count: 0 };
        cur.count += 1;
        cur.lastBody = m.body; cur.lastAt = m.createdAt.toISOString();
        if (m.orderNo) cur.orderNo = m.orderNo;
        if (m.author === "customer" && m.readFlag !== 1) cur.unreadCustomer += 1;
        byKey.set(key, cur);
      }
      return { conversations: [...byKey.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) };
    },
  }),
  listConversationMessages: defineAction({
    description: "Staff-only: full private thread for one customer conversation.",
    request: z.object({ token: z.string(), userId: z.number().nullable().optional(), guestPhone: z.string().default("") }),
    response: z.object({ messages: z.array(z.any()) }),
    async handler(ctx, args) {
      await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const all = await db.select().from(schema.messages).orderBy(schema.messages.id).limit(500);
      const mine = all.filter((m) => (args.userId && m.userId === args.userId) || (args.guestPhone && m.guestPhone === args.guestPhone));
      return { messages: mine.map((m) => ({ id: m.id, orderNo: m.orderNo, author: m.author, authorName: m.authorName, body: m.body, readFlag: m.readFlag === 1, createdAt: m.createdAt.toISOString() })) };
    },
  }),
  sendStaffReply: defineAction({
    description: "Staff reply in a private customer conversation. Only the customer and staff can see it.",
    request: z.object({ token: z.string(), userId: z.number().nullable().optional(), guestPhone: z.string().default(""), orderNo: z.string().default(""), body: z.string().min(1).max(2000) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const staff = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      let orderId: number | null = null;
      if (args.orderNo) { const o = (await db.select().from(schema.orders).where(eq(schema.orders.orderNo, args.orderNo)).limit(1))[0]; if (o) orderId = o.id; }
      await db.insert(schema.messages).values({ userId: args.userId ?? null, guestName: "", guestPhone: args.guestPhone, orderId, orderNo: args.orderNo, author: "staff", authorName: staff.name, body: args.body.trim(), readFlag: 0 });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  markMessagesRead: defineAction({
    description: "Marks one conversation's messages from the other side as read — staff marking customer messages, or a customer marking staff replies.",
    request: z.object({ token: z.string().optional(), phone: z.string().default(""), userId: z.number().nullable().optional(), guestPhone: z.string().default(""), from: z.enum(["customer", "staff"]) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const meUser = await authUser(ctx, args.token ?? null);
      if (args.from === "customer") {
        await requireStaff(ctx, args.token ?? "");
        if (args.userId) await db.update(schema.messages).set({ readFlag: 1 }).where(and(eq(schema.messages.userId, args.userId), eq(schema.messages.author, "customer")));
        else if (args.guestPhone) await db.update(schema.messages).set({ readFlag: 1 }).where(and(eq(schema.messages.guestPhone, args.guestPhone), eq(schema.messages.author, "customer")));
      } else {
        const phone = (args.phone || meUser?.phone || "").trim();
        const all = await db.select().from(schema.messages).where(eq(schema.messages.author, "staff"));
        for (const m of all) if ((meUser && m.userId === meUser.id) || (phone && m.guestPhone === phone)) await db.update(schema.messages).set({ readFlag: 1 }).where(eq(schema.messages.id, m.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  saveAddress: defineAction({
    description: "Saves a delivery address for the signed-in customer.",
    request: z.object({ token: z.string(), label: z.string().default("Home"), address: z.string().min(3), area: z.string().default(""), phone: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const u = await authUser(ctx, args.token); if (!u) throw new Error("Sign in required."); const db = ctx.db<typeof schema>(); await db.insert(schema.addresses).values({ userId: u.id, label: args.label, address: args.address, area: args.area, phone: args.phone }); ctx.invalidateQueries(); return { ok: true }; },
  }),
  toggleWishlist: defineAction({
    description: "Adds or removes a product from the customer's wishlist.",
    request: z.object({ token: z.string(), productId: z.number() }),
    response: z.object({ ok: z.boolean(), wished: z.boolean() }),
    async handler(ctx, args) { const u = await authUser(ctx, args.token); if (!u) throw new Error("Sign in required."); const db = ctx.db<typeof schema>(); const ex = await db.select().from(schema.wishlist).where(and(eq(schema.wishlist.userId, u.id), eq(schema.wishlist.productId, args.productId))); if (ex.length > 0) { await db.delete(schema.wishlist).where(eq(schema.wishlist.id, ex[0]?.id ?? 0)); return { ok: true, wished: false }; } await db.insert(schema.wishlist).values({ userId: u.id, productId: args.productId }); return { ok: true, wished: true }; },
  }),
  redeemPoints: defineAction({
    privileged: [privileged.cryptoOps],
    description: "Redeems loyalty points for a one-time coupon, using the rates set by the admin in Settings. Points are deducted only through this ledger action.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean(), code: z.string().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const u = await authUser(ctx, args.token);
      if (!u) throw new Error("Sign in required.");
      const db = ctx.db<typeof schema>();
      const s = await getSettings(db);
      const need = s.loyaltyRedeemPoints || 100;
      const value = s.loyaltyRedeemValue || 20;
      if (u.loyaltyPoints < need) return { ok: false, error: `You need at least ${need} points to redeem.` };
      const code = `POINTS-${(await randHex(ctx, 3)).toUpperCase()}`;
      await db.insert(schema.coupons).values({ code, kind: "fixed", value, minPurchase: 0, usageLimit: 1, active: 1, description: `Loyalty redemption — ${need} points` });
      await db.update(schema.users).set({ loyaltyPoints: u.loyaltyPoints - need }).where(eq(schema.users.id, u.id));
      await db.insert(schema.loyaltyTx).values({ userId: u.id, points: -need, kind: "redeem", note: `Coupon ${code}` });
      ctx.invalidateQueries();
      return { ok: true, code };
    },
  }),
  markNotificationsRead: defineAction({
    description: "Marks the signed-in user's notifications as read.",
    request: z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) { const u = await authUser(ctx, args.token); if (!u) return { ok: false }; const db = ctx.db<typeof schema>(); const all = await db.select().from(schema.notifications); for (const n of all.filter((x) => x.userId === null || x.userId === u.id)) await db.update(schema.notifications).set({ readFlag: 1 }).where(eq(schema.notifications.id, n.id)); return { ok: true }; },
  }),
  openShift: defineAction({
    description: "Opens a POS cashier shift with an opening cash balance.",
    request: z.object({ token: z.string(), openingCash: z.number().int().min(0) }),
    response: z.object({ ok: z.boolean(), error: z.string().optional() }),
    async handler(ctx, args) {
      const staff = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const open = (await db.select().from(schema.shifts).where(eq(schema.shifts.status, "Open"))).length;
      if (open > 0) return { ok: false, error: "A shift is already open." };
      await db.insert(schema.shifts).values({ cashier: staff.name, openingCash: args.openingCash, status: "Open" });
      await auditLog(db, staff, "shift.open", "shift", undefined, `opening cash ৳${args.openingCash}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  closeShift: defineAction({
    description: "Closes the open POS shift and reports expected vs actual cash.",
    request: z.object({ token: z.string(), closingCash: z.number().int().min(0) }),
    response: z.object({ ok: z.boolean(), expected: z.number(), difference: z.number() }),
    async handler(ctx, args) {
      const staff = await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const open = (await db.select().from(schema.shifts).where(eq(schema.shifts.status, "Open")).orderBy(desc(schema.shifts.id)).limit(1))[0];
      if (!open) return { ok: false, expected: 0, difference: 0 };
      const orders = await db.select().from(schema.orders);
      const cashSales = orders.filter((o) => o.source === "pos" && o.createdAt >= open.openedAt && (o.paymentMethod === "Cash" || o.paymentMethod === "Cash at Counter") && o.status !== "Cancelled").reduce((a, o) => a + o.total, 0);
      const expected = open.openingCash + cashSales;
      await db.update(schema.shifts).set({ closingCash: args.closingCash, status: "Closed", closedAt: new Date() }).where(eq(schema.shifts.id, open.id));
      await auditLog(db, staff, "shift.close", "shift", open.id, `closing cash ৳${args.closingCash}, expected ৳${expected}`);
      ctx.invalidateQueries();
      return { ok: true, expected, difference: args.closingCash - expected };
    },
  }),
  exportOrdersCsv: defineAction({
    description: "Exports orders as CSV text for reports. Staff only.",
    request: z.object({ token: z.string() }),
    response: z.object({ csv: z.string() }),
    async handler(ctx, args) {
      await requireStaff(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const orders = await db.select().from(schema.orders).orderBy(desc(schema.orders.id)).limit(500);
      const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
      const lines = ["OrderNo,Date,Customer,Type,Source,Status,Payment,PaymentStatus,Subtotal,Discount,VAT,Delivery,Total"];
      for (const o of orders) lines.push([o.orderNo, o.createdAt.toISOString(), o.customerName, o.orderType, o.source, o.status, o.paymentMethod, o.paymentStatus, o.subtotal, o.discount, o.vat, o.deliveryFee, o.total].map(esc).join(","));
      return { csv: lines.join("\n") };
    },
  }),
} satisfies ActionsModule;
