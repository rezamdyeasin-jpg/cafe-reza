// Self-contained QR Code encoder (byte mode, EC level L, versions
// 1–10). No dependency: the app has no QR library and adding one
// would pull a new package into the build. This is a from-scratch
// implementation of the QR spec (ISO/IEC 18004): byte-mode data
// encoding, Reed–Solomon error correction over GF(256), function
// patterns (finders, timing, alignment, dark module), format and
// version info, and mask selection by penalty score. The output is a
// boolean module matrix; QrCode (qr.tsx) renders it as SVG, and
// qrSvgString() returns a standalone SVG string for the print window.
//
// Only level L is implemented: a table QR is printed once and scanned
// at arm's length, and L keeps the code small (a table URL fits in
// version 3). If a longer URL ever needs more room, versions up to 10
// are supported (about 270 data bytes).

// ---- Galois field GF(256), primitive polynomial 0x11D ----
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!);

// Reed–Solomon divisor (generator polynomial, `degree` coefficients).
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1; // start with the monomial x^0
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

// Reed–Solomon remainder: the EC codewords for `data`.
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] = (result[i] ?? 0) ^ gfMul(divisor[i] ?? 0, factor);
  }
  return result;
}

// Version table, EC level L: total codewords, EC codewords per block,
// data codewords per block, and alignment-pattern centres.
const VERSIONS: Array<{ total: number; ecPerBlock: number; dataBlocks: number[]; align: number[] }> = [
  { total: 26, ecPerBlock: 7, dataBlocks: [19], align: [] },
  { total: 44, ecPerBlock: 10, dataBlocks: [34], align: [6, 18] },
  { total: 70, ecPerBlock: 15, dataBlocks: [55], align: [6, 22] },
  { total: 100, ecPerBlock: 20, dataBlocks: [80], align: [6, 26] },
  { total: 134, ecPerBlock: 26, dataBlocks: [108], align: [6, 30] },
  { total: 172, ecPerBlock: 18, dataBlocks: [68, 68], align: [6, 34] },
  { total: 196, ecPerBlock: 20, dataBlocks: [78, 78], align: [6, 22, 38] },
  { total: 242, ecPerBlock: 24, dataBlocks: [97, 97], align: [6, 24, 42] },
  { total: 292, ecPerBlock: 30, dataBlocks: [116, 116], align: [6, 26, 46] },
  { total: 346, ecPerBlock: 18, dataBlocks: [68, 68, 69, 69], align: [6, 28, 50] },
];

export type QrMatrix = { version: number; size: number; modules: boolean[][]; mask: number };

function appendBits(bits: boolean[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) bits.push(((value >>> i) & 1) === 1);
}

// The 15 format bits for EC level L (01) and `mask`, BCH(15,5)
// with generator 0x537, XORed with the mask pattern 0x5412.
function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

// The 18 version bits (versions 7+), BCH(18,6), generator 0x1F25.
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
  return (version << 12) | rem;
}

const MASK_FNS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// Penalty score of a finished matrix (lower is better): runs of 5+
// same-colour modules (+3 each extra), 2×2 blocks of one colour (+3),
// finder-like patterns (+40), and dark-module imbalance (+10 per 5%).
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const runScore = (line: boolean[]) => {
    let color = line[0];
    let len = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === color) len++;
      else { if (len >= 5) score += 3 + (len - 5); color = line[i]; len = 1; }
    }
    if (len >= 5) score += 3 + (len - 5);
  };
  for (let r = 0; r < size; r++) runScore(m[r]!);
  for (let c = 0; c < size; c++) runScore(m.map((row) => row[c]!));
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r]![c]!;
      if (m[r]![c + 1] === v && m[r + 1]![c] === v && m[r + 1]![c + 1] === v) score += 3;
    }
  }
  const patA = [true, false, true, true, true, false, true, false, false, false, false];
  const patB = [false, false, false, false, true, false, true, true, true, false, true];
  const hasPat = (line: boolean[]) => {
    for (let i = 0; i + 11 <= line.length; i++) {
      const seg = line.slice(i, i + 11);
      if (seg.every((v, j) => v === patA[j]) || seg.every((v, j) => v === patB[j])) return true;
    }
    return false;
  };
  for (let r = 0; r < size; r++) if (hasPat(m[r]!)) score += 40;
  for (let c = 0; c < size; c++) if (hasPat(m.map((row) => row[c]!))) score += 40;
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  // Smallest version whose data capacity (EC level L) fits the text.
  let version = 0;
  let dataCodewords = 0;
  for (let v = 1; v <= 10; v++) {
    const info = VERSIONS[v - 1]!;
    const cap = info.dataBlocks.reduce((a, b) => a + b, 0);
    const neededBits = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8 + 4;
    if (Math.ceil(neededBits / 8) <= cap) { version = v; dataCodewords = cap; break; }
  }
  if (version === 0) throw new Error("Text too long for a QR code (max version 10).");
  const info = VERSIONS[version - 1]!;
  const size = version * 4 + 17;

  // ---- Data bit stream (byte mode) + pad bytes ----
  const bits: boolean[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) appendBits(bits, b, 8);
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(false);
  const data = new Array<number>(dataCodewords).fill(0);
  for (let i = 0; i < bits.length; i++) if (bits[i]) data[Math.floor(i / 8)] = (data[Math.floor(i / 8)] ?? 0) | (1 << (7 - (i % 8)));
  const filled = Math.ceil(bits.length / 8);
  for (let i = filled; i < dataCodewords; i++) data[i] = (i - filled) % 2 === 0 ? 0xec : 0x11;

  // ---- Split into blocks, Reed–Solomon EC, interleave ----
  const divisor = rsDivisor(info.ecPerBlock);
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const len of info.dataBlocks) {
    const block = data.slice(offset, offset + len);
    offset += len;
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, divisor));
  }
  const final: number[] = [];
  const maxData = Math.max(...info.dataBlocks);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) final.push(b[i]!);
  for (let i = 0; i < info.ecPerBlock; i++) for (const e of ecBlocks) final.push(e[i]!);
  const finalBits: boolean[] = [];
  for (const b of final) for (let i = 7; i >= 0; i--) finalBits.push(((b >> i) & 1) === 1);

  // ---- Function patterns ----
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };
  const finder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        if (dr === -1 || dr === 7 || dc === -1 || dc === 7) set(r, c, false); // separator
        else set(r, c, dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
  for (const r of info.align) {
    for (const c of info.align) {
      if (isFunction[r]![c]) continue; // overlaps a finder
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }
  set(size - 8, 8, true); // dark module, always dark
  // Reserve the format-info cells (drawn after the mask is chosen).
  const reserveFormat = () => {
    for (let i = 0; i <= 5; i++) { isFunction[i]![8] = true; isFunction[8]![i] = true; }
    isFunction[7]![8] = true; isFunction[8]![7] = true; isFunction[8]![8] = true;
    for (let i = 9; i <= 14; i++) isFunction[8]![14 - i] = true;
    for (let i = 0; i <= 7; i++) isFunction[8]![size - 1 - i] = true;
    for (let i = 8; i <= 14; i++) isFunction[size - 15 + i]![8] = true;
  };
  reserveFormat();
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      isFunction[b]![a] = true;
      isFunction[a]![b] = true;
    }
  }

  // ---- Data placement (zigzag, skipping column 6) + mask choice ----
  const drawData = (mask: number): boolean[][] => {
    const m = modules.map((row) => [...row]);
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = ((right + 1) & 2) === 0;
          const r = upward ? size - 1 - vert : vert;
          if (!isFunction[r]![c] && i < finalBits.length) {
            let bit = finalBits[i]!;
            if (MASK_FNS[mask]!(r, c)) bit = !bit;
            m[r]![c] = bit;
            i++;
          }
        }
      }
    }
    return m;
  };
  const drawFormat = (m: boolean[][], mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) m[i]![8] = bit(i);
    m[7]![8] = bit(6);
    m[8]![8] = bit(7);
    m[8]![7] = bit(8);
    for (let i = 9; i <= 14; i++) m[8]![14 - i] = bit(i);
    for (let i = 0; i <= 7; i++) m[8]![size - 1 - i] = bit(i);
    for (let i = 8; i <= 14; i++) m[size - 15 + i]![8] = bit(i);
  };
  const drawVersion = (m: boolean[][]) => {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const bb = Math.floor(i / 3);
      m[bb]![a] = b;
      m[a]![bb] = b;
    }
  };

  let best: boolean[][] | null = null;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const m = drawData(mask);
    drawFormat(m, mask);
    if (version >= 7) drawVersion(m);
    const score = penalty(m);
    if (score < bestScore) { bestScore = score; best = m; bestMask = mask; }
  }
  return { version, size, modules: best!, mask: bestMask };
}

// Standalone SVG string (with the 4-module quiet zone the QR spec
// requires) for the print window. `px` is the rendered width/height.
export function qrSvgString(text: string, px = 240): string {
  const qr = encodeQr(text);
  const n = qr.size + 8;
  const rects: string[] = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r]![c]) rects.push(`<rect x="${c + 4}" y="${r + 4}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" role="img"><rect width="${n}" height="${n}" fill="#ffffff"/>${rects.join("")}</svg>`;
}

// The URL a table QR encodes: the customer menu with that table
// pre-selected for dine-in, using the app's hash routing. Uses the
// current origin so the same code works on the live site and on any
// preview deployment; falls back to the live domain outside a browser.
export function tableQrUrl(label: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-reza.web.app";
  return `${origin}/#/?table=${encodeURIComponent(label)}`;
}
