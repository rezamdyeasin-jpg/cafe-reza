// Payment receipt — one shared component used everywhere a receipt
// is shown: the customer site right after an order is placed, the
// customer Account page, the admin Live Orders, and the POS cash
// sale. Every amount comes from the order document itself (items,
// discountBreakdown, delivery fee, total) — nothing is recomputed
// here, so the receipt can never disagree with the order.
//
// Printing / PDF: the Print button calls window.print() and the
// print stylesheet (theme.css) hides everything except the receipt,
// so the printout — or "Save as PDF" from the print dialog — is a
// clean receipt with no app chrome around it. No PDF library is
// needed, so nothing heavy is added to the build.
import { tr, type Lang, type Order, type Product, type Settings } from "./db";

const tk = (n: number) => `৳${n.toLocaleString("en-US")}`;

function itemName(products: Product[], it: Order["items"][number], lang: Lang): string {
  const p = products.find((x) => x.slug === it.productId);
  if (!p) return it.name;
  return lang === "bn" && p.nameBn ? p.nameBn : p.nameEn;
}

export function ReceiptView({ order, settings, products, lang }: { order: Order; settings: Settings; products: Product[]; lang: Lang }) {
  const bd = order.discountBreakdown;
  const when = order.createdAt ? new Date(order.createdAt) : null;
  const whenText = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const discountLines: Array<{ label: string; amount: number }> = [];
  if (bd) {
    if (bd.combo > 0) discountLines.push({ label: tr(lang, "Combo discount", "কম্বো ছাড়"), amount: bd.combo });
    if (bd.happyHour > 0) discountLines.push({ label: tr(lang, "Happy Hour discount", "হ্যাপি আওয়ার ছাড়"), amount: bd.happyHour });
    if (bd.coupon > 0) discountLines.push({ label: tr(lang, "Coupon discount", "কুপন ছাড়") + (order.couponCode ? ` (${order.couponCode})` : ""), amount: bd.coupon });
    if (bd.loyalty > 0) discountLines.push({ label: tr(lang, "Loyalty points discount", "লয়্যালটি পয়েন্ট ছাড়"), amount: bd.loyalty });
  } else if (order.discount > 0) {
    discountLines.push({ label: tr(lang, "Discount", "ছাড়"), amount: order.discount });
  }
  return (
    <div className="receipt-print" style={{ background: "#fffdf7", color: "#3B2314", border: "2px solid #3B2314", borderRadius: 12, padding: 18, maxWidth: 480, margin: "0 auto", fontFamily: "inherit" }}>
      <div style={{ textAlign: "center" }}>
        <img src="/img/logo.jpg" alt="Café Reza logo" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "50%" }} />
        <p className="serif" style={{ fontSize: 24, fontWeight: 700, margin: "8px 0 0" }}>{settings.cafeName}</p>
        <p className="small" style={{ margin: "2px 0" }}>{settings.address}</p>
        <p className="small" style={{ margin: 0 }}>{tr(lang, "Phone:", "ফোন:")} {settings.phone}</p>
      </div>
      <hr style={{ border: "none", borderTop: "1px dashed #c6a15b", margin: "14px 0" }} />
      <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
        <span><b>{tr(lang, "Order No:", "অর্ডার নম্বর:")}</b> {order.orderNo}</span>
        <span>{whenText}</span>
      </div>
      {(order.customerName || order.phone || order.address) && (
        <p className="small" style={{ margin: "8px 0 0" }}>
          <b>{order.customerName}</b>
          {order.phone && <> • {order.phone}</>}
          {order.address && <><br />{order.address}</>}
          {order.tableLabel && <><br />{tr(lang, "Table:", "টেবিল:")} {order.tableLabel}</>}
        </p>
      )}
      <hr style={{ border: "none", borderTop: "1px dashed #c6a15b", margin: "14px 0" }} />
      <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #c6a15b", textAlign: "left" }}>
            <th style={{ padding: "4px 0" }}>{tr(lang, "Item", "আইটেম")}</th>
            <th style={{ padding: "4px 0", textAlign: "center" }}>{tr(lang, "Qty", "পরিমাণ")}</th>
            <th style={{ padding: "4px 0", textAlign: "right" }}>{tr(lang, "Amount", "টাকা")}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f0e6d6" }}>
              <td style={{ padding: "6px 0" }}>{itemName(products, it, lang)}{it.size && it.size !== "Regular" ? ` (${it.size})` : ""}{it.note ? ` — ${it.note}` : ""}</td>
              <td style={{ padding: "6px 0", textAlign: "center" }}>{it.qty}</td>
              <td style={{ padding: "6px 0", textAlign: "right" }}>{tk(it.price * it.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Subtotal", "সাবটোটাল")}</span><span>{tk(order.subtotal)}</span></div>
        {discountLines.map((d) => (
          <div key={d.label} className="row" style={{ justifyContent: "space-between", color: "#2e7d32" }}><span>{d.label}</span><span>−{tk(d.amount)}</span></div>
        ))}
        {order.vat > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span>VAT</span><span>{tk(order.vat)}</span></div>}
        <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Delivery", "ডেলিভারি")}</span><span>{order.deliveryFee === 0 ? tr(lang, "Free", "ফ্রি") : tk(order.deliveryFee)}</span></div>
        <div className="row" style={{ justifyContent: "space-between", fontWeight: 700, fontSize: 17, borderTop: "1px solid #c6a15b", marginTop: 6, paddingTop: 6 }}><span>{tr(lang, "Total", "মোট")}</span><span>{tk(order.total)}</span></div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}><span>{tr(lang, "Payment:", "পেমেন্ট:")}</span><span><b>{order.paymentMethod}</b>{order.paymentStatus ? ` • ${order.paymentStatus}` : ""}</span></div>
        {order.paidAmount > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Paid:", "পরিশোধ:")}</span><span>{tk(order.paidAmount)}</span></div>}
        {order.changeAmount > 0 && <div className="row" style={{ justifyContent: "space-between" }}><span>{tr(lang, "Change:", "ফেরত:")}</span><span>{tk(order.changeAmount)}</span></div>}
      </div>
      <hr style={{ border: "none", borderTop: "1px dashed #c6a15b", margin: "14px 0" }} />
      <p className="serif" style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: 0 }}>{tr(lang, "Thank you!", "ধন্যবাদ!")}</p>
      <p className="small muted" style={{ textAlign: "center", margin: "4px 0 0" }}>{tr(lang, "Come again — Café Reza", "আবার আসবেন — ক্যাফে রেজা")}</p>
    </div>
  );
}

export function ReceiptModal({ order, settings, products, lang, onClose }: { order: Order; settings: Settings; products: Product[]; lang: Lang; onClose: () => void }) {
  // The receipt sits directly in the fixed overlay (not inside a
  // drawer): the print stylesheet hides everything on the page except
  // `.receipt-print`, so Print / Save-as-PDF gives a clean receipt.
  // The buttons live outside the receipt in a `no-print` row.
  return (
    <div role="dialog" aria-modal="true" aria-label={tr(lang, "Payment receipt", "পেমেন্ট রিসিট")}>
      <div className="modal-backdrop" onClick={onClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", overflow: "auto", padding: 16 }}>
        <div className="row no-print" style={{ justifyContent: "space-between", maxWidth: 480, width: "100%", marginBottom: 10 }}>
          <h2 className="serif" style={{ fontSize: 20, margin: 0 }}>🧾 {tr(lang, "Payment receipt", "পেমেন্ট রিসিট")}</h2>
          <button className="btn-ghost" aria-label="Close receipt" onClick={onClose}>✕</button>
        </div>
        <ReceiptView order={order} settings={settings} products={products} lang={lang} />
        <div className="row no-print" style={{ marginTop: 12, maxWidth: 480, width: "100%" }}>
          <button className="btn-gold" style={{ flex: 1 }} onClick={() => window.print()}>🖨️ {tr(lang, "Print", "প্রিন্ট করুন")}</button>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={() => window.print()}>📄 {tr(lang, "Download as PDF", "PDF হিসেবে ডাউনলোড")}</button>
        </div>
        <p className="small muted no-print" style={{ marginTop: 6, maxWidth: 480 }}>{tr(lang, "For PDF: in the print dialog choose “Save as PDF” as the destination.", "PDF-এর জন্য: প্রিন্ট ডায়ালগে গন্তব্য হিসেবে “Save as PDF” বেছে নিন।")}</p>
      </div>
    </div>
  );
}
