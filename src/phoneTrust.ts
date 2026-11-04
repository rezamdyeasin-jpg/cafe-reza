// Phone number reputation / trust score. Every figure comes from the
// real order documents — total orders, completed, cancelled and
// refunded counts per phone number, and the rates derived from them.
// Nothing is invented: a number with no orders has no history and
// shows no badge.
//
// A phone number is identified by its normalized form (Bangladeshi
// mobile: +880 1XXX-XXXXXX, 8801XXXXXXXXX and 01XXXXXXXXX are the
// same number), so the same customer is recognised however they
// typed the number at checkout.
import { tr, type Lang, type Order } from "./db";

export type PhoneStats = {
  phone: string; // the number as first seen (display form)
  total: number;
  completed: number;
  cancelled: number;
  refunded: number;
  cancelRate: number; // percent, 0–100
  returnRate: number; // percent, 0–100
};

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) return "0" + digits.slice(3);
  if (digits.startsWith("88") && digits.length === 12) return "0" + digits.slice(2);
  return digits;
}

// The stored forms a lookup should try, so "+880 1805-501689",
// "8801805501689" and "01805501689" all find the same history.
export function phoneQueryVariants(raw: string): string[] {
  const norm = normalizePhone(raw);
  const set = new Set<string>([raw.trim(), norm]);
  if (norm.startsWith("0") && norm.length === 11) {
    set.add(`+880${norm.slice(1)}`);
    set.add(`880${norm.slice(1)}`);
  }
  return [...set].filter(Boolean).slice(0, 10);
}

export function computePhoneStats(orders: Order[]): Map<string, PhoneStats> {
  const byPhone = new Map<string, PhoneStats>();
  for (const o of orders) {
    const norm = normalizePhone(o.phone ?? "");
    if (!norm) continue;
    const s = byPhone.get(norm) ?? { phone: o.phone, total: 0, completed: 0, cancelled: 0, refunded: 0, cancelRate: 0, returnRate: 0 };
    s.total += 1;
    if (o.status === "Completed" || o.status === "Delivered") s.completed += 1;
    if (o.status === "Cancelled") s.cancelled += 1;
    if (o.status === "Refunded") s.refunded += 1;
    byPhone.set(norm, s);
  }
  for (const s of byPhone.values()) {
    s.cancelRate = s.total > 0 ? (s.cancelled / s.total) * 100 : 0;
    s.returnRate = s.total > 0 ? (s.refunded / s.total) * 100 : 0;
  }
  return byPhone;
}

export type TrustLevel = "good" | "caution" | "risky";

// Thresholds come from the admin Settings (riskCautionPct /
// riskRiskyPct) — the defaults here are only fallbacks.
export function trustLevel(rate: number, cautionAt: number, riskyAt: number): TrustLevel {
  if (rate >= riskyAt) return "risky";
  if (rate >= cautionAt) return "caution";
  return "good";
}

export function trustLabel(level: TrustLevel, lang: Lang): string {
  return level === "risky" ? tr(lang, "Risky", "ঝুঁকিপূর্ণ") : level === "caution" ? tr(lang, "Caution", "সতর্ক") : tr(lang, "Good", "ভালো");
}

export function trustColor(level: TrustLevel): string {
  return level === "risky" ? "var(--bad)" : level === "caution" ? "#b58900" : "var(--good)";
}
