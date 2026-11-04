// Digital Analyzer — the visual centrepiece of the Analytics tab.
// A sales LINE CHART (Day / Week / Month) built only from real
// Firestore orders — revenue counts Completed / Delivered orders,
// the same set the Analytics headlines count — plus best products,
// order count and profit/loss cards. The design is a cleaner, more
// beautiful take on the INVESMATE "Line Chart" reference the owner
// gave (teal gradient, white chart card, blue line): deep teal
// header, gold accents, soft area fill, smooth line, hover tooltip.
// No chart library: a lightweight custom SVG chart, so the bundle
// gains no new dependency.
import { useMemo, useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { getDb } from "./firebase";
import { expenseFromDoc, tr, useLive, type Expense, type Lang, type Order, type Product } from "./db";

export type AnalyzerPeriod = "today" | "7d" | "30d" | "all";
type Granularity = "day" | "week" | "month";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKeyLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isRealized = (o: Order) => o.status === "Completed" || o.status === "Delivered";

type Bucket = { key: string; label: string; value: number };

function startOfWeekMonday(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (c.getDay() + 6) % 7; // Monday = 0
  c.setDate(c.getDate() - dow);
  return c;
}

function buildBuckets(orders: Order[], gran: Granularity, period: AnalyzerPeriod): Bucket[] {
  const done = orders.filter(isRealized);
  const now = new Date();
  const buckets: Bucket[] = [];
  const add = (o: Order, key: string) => {
    const b = buckets.find((x) => x.key === key);
    if (b) b.value += o.total;
  };
  if (gran === "day" && period === "today") {
    // The cafe opens at 16:00 — today's chart is hourly, 16:00–23:00.
    for (let h = 16; h < 24; h++) buckets.push({ key: `h${h}`, label: `${String(h).padStart(2, "0")}:00`, value: 0 });
    done.forEach((o) => {
      const d = new Date(o.createdAt);
      if (Number.isNaN(d.getTime()) || dayKeyLocal(d) !== dayKeyLocal(now)) return;
      add(o, `h${d.getHours()}`);
    });
    return buckets;
  }
  if (gran === "day") {
    const days = period === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push({ key: dayKeyLocal(d), label: `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}`, value: 0 });
    }
    done.forEach((o) => {
      const d = new Date(o.createdAt);
      if (Number.isNaN(d.getTime())) return;
      add(o, dayKeyLocal(d));
    });
    return buckets;
  }
  if (gran === "week") {
    const weeks = period === "7d" ? 2 : period === "30d" ? 5 : 8;
    const monday = startOfWeekMonday(now);
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - i * 7);
      buckets.push({ key: dayKeyLocal(d), label: `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}`, value: 0 });
    }
    done.forEach((o) => {
      const d = new Date(o.createdAt);
      if (Number.isNaN(d.getTime())) return;
      add(o, dayKeyLocal(startOfWeekMonday(d)));
    });
    return buckets;
  }
  // month — last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${MONTHS[d.getMonth()] ?? ""} ’${String(d.getFullYear()).slice(2)}`, value: 0 });
  }
  done.forEach((o) => {
    const d = new Date(o.createdAt);
    if (Number.isNaN(d.getTime())) return;
    add(o, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  return buckets;
}

// Catmull-Rom → cubic Bézier: a smooth curve through the points.
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  if (!first) return "";
  if (pts.length === 1) return `M ${first.x} ${first.y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] ?? first;
    const p1 = pts[i] ?? first;
    const p2 = pts[i + 1] ?? first;
    const p3 = pts[Math.min(pts.length - 1, i + 2)] ?? first;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function LineChart({ buckets, lang }: { buckets: Bucket[]; lang: Lang }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 260;
  const padL = 58;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const maxV = Math.max(1, ...buckets.map((b) => b.value));
  const yMax = maxV * 1.15;
  const xAt = (i: number) => (buckets.length <= 1 ? padL + (W - padL - padR) / 2 : padL + (i * (W - padL - padR)) / (buckets.length - 1));
  const yAt = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  const pts = buckets.map((b, i) => ({ x: xAt(i), y: yAt(b.value) }));
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const area = line && last ? `${line} L ${last.x} ${H - padB} L ${pts[0]?.x ?? padL} ${H - padB} Z` : "";
  const skip = Math.max(1, Math.ceil(buckets.length / 8));
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((vbX - padL) / (W - padL - padR)) * (buckets.length - 1));
    setHover(Math.max(0, Math.min(buckets.length - 1, idx)));
  };
  const hovered = hover !== null ? buckets[hover] : null;
  const hoverPt = hover !== null ? pts[hover] : null;
  return (
    <div style={{ position: "relative", background: "#ffffff", borderRadius: 14, padding: "10px 6px 4px", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={tr(lang, "Sales line chart", "বিক্রির লাইন চার্ট")} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", cursor: "crosshair" }}>
        <defs>
          <linearGradient id="da-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id="da-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((g) => {
          const v = (yMax / 4) * g;
          const y = yAt(v);
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#6b7280">{v >= 1000 ? `৳${Math.round(v / 1000)}k` : `৳${Math.round(v)}`}</text>
            </g>
          );
        })}
        {area && <path d={area} fill="url(#da-area)" />}
        {line && <path d={line} fill="none" stroke="url(#da-line)" strokeWidth={3} strokeLinecap="round" />}
        {pts.map((p, i) => {
          const b = buckets[i];
          const isH = hover === i;
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={isH ? 6 : 4} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
              {b && b.value > 0 && isH && (
                <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0f766e">{tk(b.value)}</text>
              )}
            </g>
          );
        })}
        {hoverPt && hovered && (
          <line x1={hoverPt.x} x2={hoverPt.x} y1={padT} y2={H - padB} stroke="#0f766e" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        )}
        {buckets.map((b, i) => (i % skip === 0 || i === buckets.length - 1 ? (
          <text key={b.key} x={xAt(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="#6b7280">{b.label}</text>
        ) : null))}
      </svg>
      {hovered && hoverPt && (
        <div style={{ position: "absolute", left: `${Math.min(88, Math.max(4, (hoverPt.x / W) * 100))}%`, top: 8, transform: "translateX(-50%)", background: "#0f766e", color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 4px 12px rgba(0,0,0,.25)" }}>
          {hovered.label} • {tk(hovered.value)}
        </div>
      )}
    </div>
  );
}

export function DigitalAnalyzer({ orders, products, lang, period }: { orders: Order[]; products: Product[]; lang: Lang; period: AnalyzerPeriod }) {
  const [gran, setGran] = useState<Granularity>("day");
  const firestore = getDb();
  const { data: expenses } = useLive<Expense>(
    () => (firestore ? query(collection(firestore, "expenses"), orderBy("date", "desc"), limit(200)) : null),
    expenseFromDoc,
  );
  const buckets = useMemo(() => buildBuckets(orders, gran, period), [orders, gran, period]);
  const stats = useMemo(() => {
    const done = orders.filter(isRealized);
    const revenue = buckets.reduce((a, b) => a + b.value, 0);
    const rangeStart = buckets[0]?.key ?? "";
    // Expenses inside the same range: bucket keys are day keys (or
    // hour keys for today). Compare expense dates with the first
    // bucket's date — for the hourly "today" view that is today.
    const startDate = gran === "day" && period === "today" ? dayKeyLocal(new Date()) : rangeStart.slice(0, 10);
    const expTotal = expenses
      .filter((e) => (period === "all" ? true : e.date >= startDate))
      .reduce((a, e) => a + e.amount, 0);
    const bestMap = new Map<string, { name: string; qty: number; rev: number }>();
    done.forEach((o) => o.items.forEach((it) => {
      const p = products.find((x) => x.slug === it.productId);
      const name = p ? (lang === "bn" && p.nameBn ? p.nameBn : p.nameEn) : it.name;
      const cur = bestMap.get(it.productId) ?? { name, qty: 0, rev: 0 };
      cur.qty += it.qty;
      cur.rev += it.price * it.qty;
      bestMap.set(it.productId, cur);
    }));
    const best = [...bestMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 3);
    const completed = done.length;
    return { revenue, expTotal, profit: revenue - expTotal, best, orderCount: orders.length, completed };
  }, [orders, products, expenses, buckets, gran, period, lang]);
  const rangeLabel = period === "today" ? tr(lang, "Today", "আজ") : period === "7d" ? tr(lang, "Last 7 days", "গত ৭ দিন") : period === "30d" ? tr(lang, "Last 30 days", "গত ৩০ দিন") : tr(lang, "All time", "সব সময়");
  const granLabel = gran === "day" ? tr(lang, "Day", "দিন") : gran === "week" ? tr(lang, "Week", "সপ্তাহ") : tr(lang, "Month", "মাস");
  const hasData = buckets.some((b) => b.value > 0) || orders.length > 0;
  return (
    <div className="card" style={{ overflow: "hidden", marginTop: 12, border: "2px solid #0f766e" }}>
      <div style={{ background: "linear-gradient(135deg,#0f766e 0%,#059669 55%,#10b981 100%)", color: "#fff", padding: "16px 18px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 className="serif" style={{ margin: 0, fontSize: 24, color: "#fff" }}>📈 {tr(lang, "Digital Analyzer", "ডিজিটাল অ্যানালাইজার")}</h3>
            <p style={{ margin: "4px 0 0", color: "#d1fae5", fontSize: 13 }}>{tr(lang, "Sales line chart from real orders — Completed / Delivered only.", "আসল অর্ডারের ডেটা থেকে বিক্রির লাইন চার্ট — শুধু সম্পন্ন / ডেলিভার্ড।")} {rangeLabel} • {granLabel}</p>
          </div>
          <span style={{ background: "#f59e0b", color: "#1a1207", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 800 }}>{tr(lang, "LIVE DATA", "লাইভ ডেটা")}</span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} className="chip" style={{ background: gran === g ? "#f59e0b" : "rgba(255,255,255,.18)", color: gran === g ? "#1a1207" : "#fff", borderColor: "transparent", fontWeight: 700 }} onClick={() => setGran(g)}>
              {g === "day" ? tr(lang, "Day", "দিন") : g === "week" ? tr(lang, "Week", "সপ্তাহ") : tr(lang, "Month", "মাস")}
            </button>
          ))}
          <span style={{ color: "#d1fae5", fontSize: 13, marginLeft: 4 }}>{tr(lang, "Revenue in view:", "এই ভিউয়ের আয়:")} <b style={{ color: "#fff" }}>{tk(stats.revenue)}</b></span>
        </div>
      </div>
      <div style={{ padding: 14 }}>
        {hasData ? <LineChart buckets={buckets} lang={lang} /> : <p className="muted" style={{ textAlign: "center", padding: 20 }}>{tr(lang, "No orders in this period yet — the chart will draw itself when orders arrive.", "এই সময়ে এখনো কোনো অর্ডার নেই — অর্ডার এলে চার্ট নিজে নিজে আঁকা হবে।")}</p>}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <b>🏆 {tr(lang, "Best products", "সেরা প্রোডাক্ট")}</b>
            {stats.best.length === 0
              ? <p className="small muted" style={{ marginTop: 6 }}>{tr(lang, "No sales yet.", "এখনো কোনো বিক্রি নেই।")}</p>
              : stats.best.map((b, i) => <p key={b.name} className="small" style={{ margin: "6px 0 0" }}>{i + 1}. {b.name} — ×{b.qty} • {tk(b.rev)}</p>)}
          </div>
          <div className="card" style={{ padding: 12 }}>
            <b>📦 {tr(lang, "Orders", "অর্ডার")}</b>
            <p style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 0" }}>{stats.orderCount}</p>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{stats.completed} {tr(lang, "completed / delivered", "টি সম্পন্ন / ডেলিভার্ড")}</p>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <b>💰 {tr(lang, "Profit / Loss", "লাভ / ক্ষতি")}</b>
            <p style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 0", color: stats.profit >= 0 ? "var(--good)" : "var(--bad)" }}>{tk(stats.profit)}</p>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{tr(lang, "Revenue", "আয়")} {tk(stats.revenue)} − {tr(lang, "expenses", "খরচ")} {tk(stats.expTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
