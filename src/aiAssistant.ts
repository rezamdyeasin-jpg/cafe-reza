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

// --- Weather (Comilla) for food suggestions: Open-Meteo is free and
// needs no API key. The AI uses it to suggest food that fits today's
// weather — cold drinks when hot, hot tea/coffee when cold or rainy,
// and an energy drink when the customer feels tired or low.
export type WeatherNow = { tempC: number; condition: string; isHot: boolean; isRainy: boolean; isCold: boolean };
export async function fetchWeatherNow(): Promise<WeatherNow | null> {
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=23.46&longitude=91.18&current=temperature_2m,weather_code&timezone=Asia%2FDhaka");
    if (!res.ok) return null;
    const d = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
    const temp = Number(d.current?.temperature_2m);
    const code = Number(d.current?.weather_code ?? -1);
    if (!Number.isFinite(temp)) return null;
    const rainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
    const condition = rainy ? "rainy" : code <= 1 ? "clear" : code <= 3 ? "cloudy" : code === 45 || code === 48 ? "foggy" : "cloudy";
    return { tempC: Math.round(temp), condition, isHot: temp >= 30, isRainy: rainy, isCold: temp < 20 };
  } catch {
    return null;
  }
}

// Build the AI's knowledge base from live data. The menu is built
// from the actual products array (never a hard-coded list), and the
// offers, delivery charge and loyalty values come from the live
// settings, so the AI always says what the site currently shows.
// The signed-in customer's own recent orders are included too (only
// theirs — never another customer's), so the AI can answer whether
// an order was confirmed, what stage it is at, or if it was cancelled.
export function buildAiKnowledge(products: Product[], settings: Settings, orders?: Order[], weather?: WeatherNow | null): string {
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
  return `You are the AI assistant of Café Reza, a cafe in Comilla, Bangladesh, answering inside the cafe's own chatbox. You are warm, cheerful and friendly — talk like a smiling, helpful friend of the cafe, in a natural, flowing way, with a light playful touch when it fits. Use a few emojis when they suit the moment (a greeting, a food item, a happy note) — tasteful, never emoji overload. Answer in the SAME language the customer writes in (Bengali if they write Bengali, English if they write English). Keep answers SHORT and helpful — one or two sentences when that is enough, a short list when the customer asks for options.

FACTS — answer only from these. If the customer asks something not covered here, say you do not know and offer to connect them to the admin. NEVER invent a price, an offer, a time or any other fact.
- Cafe: Café Reza. Address: Dhulipara Chawmuhani, EPZ road, Comilla, Bangladesh. Map: https://goo.gl/maps/iPaXfgRejF3aaPr1A. Phone: +880 1805-501689. This phone number has NO WhatsApp — never offer WhatsApp.
- Opening hours: every day 4 PM – 12 AM (16:00–00:00).${settings.hours ? ` The cafe's own hours text: "${settings.hours}".` : ""}
- MENU (the full live menu — prices in taka; "OUT OF STOCK" means it cannot be ordered right now):
${menu}
- YOUR ORDERS (the signed-in customer's own recent orders only — answer order questions ONLY from this list; never invent an order, a status or a total. If the order number is not here, say you cannot find it and suggest the Track page or the admin):
${orderLines || "(no orders yet)"}
- TODAY'S WEATHER in Comilla: ${weather ? `${weather.tempC}°C, ${weather.condition}${weather.isHot ? " — HOT day" : ""}${weather.isRainy ? " — RAINY day" : ""}${weather.isCold ? " — COLD day" : ""}.` : "not available right now."} Suggest food that fits the weather: on a HOT day suggest cold drinks (cold coffee, cold tea, coconut smoothie, milkshakes, juices, iced mint lemonade) to cool down; on a RAINY day suggest hot tea/coffee and warm snacks (momos, doi-chira) for comfort; on a COLD day suggest hot coffee, hot tea, Horlicks tea and malai tea to warm up. If the customer says they feel tired or low on energy, suggest the Energy Booster Drink. When the customer asks "what should I eat today?" or opens the chat, greet them cheerfully with a weather-based suggestion by name and price, and ask if they would like it.
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
- If the customer sends a screenshot or photo, look at it carefully and solve the problem in it — for example a wrong price, a missing item, an error on the screen, or a question about a dish in the photo. Describe what you see and give the fix or the answer.
- WHAT YOU CANNOT DO: you cannot take money, give refunds, or fix a wrong order — those need the admin. If the customer asks for any of those, say so and offer to pass the message to the admin. You also cannot see other customers' orders — only the signed-in customer's own orders listed above.
- If the customer wants to order ("give me a cold coffee"), help them pick from the menu and tell them the price, but NEVER place an order yourself — they place it from the cart.`;
}

export async function askAi(apiKey: string, systemPrompt: string, history: Array<{ role: "user" | "model"; text: string }>, question: string, imageDataUrl?: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    // The question can carry a screenshot (data URL). If present, send
    // it to Gemini as an image part so the AI can see it and solve the
    // problem in it. The image is already compressed by the caller.
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: question }];
    if (imageDataUrl) {
      const m = imageDataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (m && m[1] && m[2]) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: "user", parts }],
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
