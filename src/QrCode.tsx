// React wrapper for the QR encoder in ./qr — renders the module
// matrix as SVG. The 4-module quiet zone the QR spec requires is
// built into the viewBox so the code always scans, even when placed
// on a coloured card.
import { useMemo } from "react";
import { encodeQr } from "./qr";

export function QrCode({ text, size = 160, title }: { text: string; size?: number; title?: string }) {
  const qr = useMemo(() => {
    try { return encodeQr(text); }
    catch { return null; }
  }, [text]);
  if (!qr) return <p className="small" role="alert">QR তৈরি করা যায়নি।</p>;
  const n = qr.size + 8;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={title ?? text}
      style={{ background: "#fff", display: "block", borderRadius: 8 }}
    >
      <rect width={n} height={n} fill="#fff" />
      {qr.modules.map((row, r) =>
        row.map((dark, c) =>
          dark ? <rect key={`${r}-${c}`} x={c + 4} y={r + 4} width={1} height={1} fill="#160f0c" /> : null,
        ),
      )}
    </svg>
  );
}
