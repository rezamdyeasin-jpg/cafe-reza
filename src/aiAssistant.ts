// The AI assistant that lives inside the customer chatbox. It runs on
// the owner's Gemini API key (stored in Settings by the admin — the key
// itself is never written in code) and answers ONLY from the knowledge
// base built here: the live menu with live prices, the live settings
// and the cafe's fixed facts. It never invents a price, an offer or a
// fact, and it never places an order — the customer always orders from
// the cart themselves.
//
// The Gemini call is a plain fetch — no new dependency. The model is
// gemini-3.5-flash (verified working with the owner's key on 5 Nov 2026;
// gemini-2.5-flash returns 404 "no longer available to new users" and
// gemini-flash-latest returns 503 high-demand). If the key is missing
// or the call fails, the caller shows a polite note and the chat
// still works — the admin always gets the customer's message.
import type { Order, Product, Settings } from "./db";

// Build the AI's knowledge base from live data. The menu is built
// from the actual products array (never a hard-coded list), and the
// offers, delivery charge and loyalty values come from the live
// settings, so the AI always says what the site currently shows.
// The signed-in customer's own recent orders are included too (only
// theirs — never another customer's), so the AI can answer whether
// an order was confirmed, what stage it is at, or if it was cancelled.
export function buildAiKnowledge(products: Product[], settings: Settings, orders?: Order[]): string {
  const menu = products
    .filter((p) => p.available && p.price > 0)
    .map((p) => {
      const bits = [`- ${p.nameEn} (${p.nameBn}) — ৳${p.price} [${p.categoryId}]`];
      if (p.discountPrice != null && p.discountPrice > 0 && p.discountPrice < p.price) bits.push(`discount ৳${p.discountPrice}`);
      bits.push(p.stock > 0 ? `in stock (${p.stock} left)` : "OUT OF STOCK");
      if (p.description) bits.push(`— ${p.description}`);
      if (p.spiceLevel) bits.push(`spice: ${p.spiceLevel}`);
      if (p.veg) bits.push(p.veg);
      if (p.ingredients) bits.push(`ingredients: ${p.ingredients}`);
      return bits.join(" ");
    })
    .join("\n");
  const orderLines = (orders ?? []).slice(0, 10).map((o) => {
    const items = o.items.map((it) => `${it.qty}× ${it.name}`).join(", ");
    const when = o.createdAt ? new Date(o.createdAt).toLocaleString("en-GB") : "";
    return `- ${o.orderNo} — status: ${o.status} — ${items} — total ৳${o.total} — ${o.paymentMethod} / ${o.paymentStatus}${o.orderType ? ` — ${o.orderType}` : ""}${when ? ` — ${when}` : ""}`;
  }).join("\n");
  const redeemPoints = settings.loyaltyRedeemPoints || 100;
  const redeemValue = settings.loyaltyRedeemValue || 0;
  return `You are the AI assistant of Café Reza, a cafe in Comilla, Bangladesh, answering inside the cafe's own chatbox. Answer in the SAME language the customer writes in (Bengali if they write Bengali, English if they write English). Keep answers SHORT and helpful — one or two sentences when that is enough, a short list when the customer asks for options.

FACTS — answer only from these. If the customer asks something not covered here, say you do not know and offer to connect them to the admin. NEVER invent a price, an offer, a time or any other fact.
- Cafe: Café Reza. Address: Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh. Map: https://goo.gl/maps/iPaXfgRejF3aaPr1A. Phone: +880 1805-501689. This phone number has NO WhatsApp — never offer WhatsApp.
- Opening hours: every day 4 PM – 12 AM (16:00–00:00).${settings.hours ? ` The cafe's own hours text: "${settings.hours}".` : ""}
- MENU (the full live menu — prices in taka; "OUT OF STOCK" means it cannot be ordered right now):
${menu}
- YOUR ORDERS (the signed-in customer's own recent orders only — answer order questions ONLY from this list; never invent an order, a status or a total. If the order number is not here, say you cannot find it and suggest the Track page or the admin):
${orderLines || "(no orders yet)"}
- ORDER STATUSES (what each one means): Pending = placed, waiting for the cafe to confirm. Confirmed = the cafe confirmed it. Preparing = being made in the kitchen. Ready = ready for pickup/delivery. Out for Delivery = the rider is on the way. Delivered / Completed = done. Cancelled = cancelled (stock goes back). Refunded = money returned after admin approval.
- OFFERS:
  * Combo: buy ${settings.comboMinQty ?? 4} or more of the SAME item and get ৳${settings.comboDiscount ?? 10} off that item, automatically at checkout. There is NO free-item offer — only money off.
  * Happy Hour: every day ${settings.happyHourStart ?? "16:00"}–${settings.happyHourEnd ?? "18:00"}: ${settings.happyHourPercent ?? 2}% off the whole order, automatically.
  * First order: coupon code WELCOME10 gives 10% off, first order only.
  * Delivery: ৳${settings.deliveryFee} delivery charge; free delivery on orders of ৳${settings.freeDeliveryAt} or more.
  * Loyalty: 1 point per ৳${settings.loyaltyPerAmount} spent; ${redeemPoints} points = ৳${redeemValue} off at checkout.
- CANCELLING: a customer can cancel an order only within ${settings.cancelWindowMinutes ?? 2} minutes of placing it, from the Track page or My Account. After that only the admin can cancel — the customer should message the admin here in this chatbox.
- PAYMENT: Cash on Delivery. Mobile payments (bKash/Nagad/Rocket) are manual only: the customer sends the money and shares the transaction ID at checkout. There is no online card payment yet.
- HOW TO ORDER: browse the menu, tap a product, add it to the cart, then checkout from the cart. The order number appears after placing the order.
- HOW TO TRACK: the Track page — search by order number. The order's status is shown there. You can also answer about the customer's own orders from YOUR ORDERS above (confirmed? what stage? cancelled?) — only from that list.
- HOW TO RESERVE A TABLE: the Reserve page — pick a date, time and number of guests; the cafe confirms it.
- WHAT YOU CANNOT DO: you cannot take money, give refunds, or fix a wrong order — those need the admin. If the customer asks for any of those, say so and offer to pass the message to the admin. You also cannot see other customers' orders — only the signed-in customer's own orders listed above.
- If the customer wants to order ("give me a cold coffee"), help them pick from the menu and tell them the price, but NEVER place an order yourself — they place it from the cart.`;
}

export async function askAi(apiKey: string, systemPrompt: string, history: Array<{ role: "user" | "model"; text: string }>, question: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: "user", parts: [{ text: question }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
      }),
    });
    if (!res.ok) return { ok: false, error: `Gemini ${res.status}` };
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (!text) return { ok: false, error: "Empty reply" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
