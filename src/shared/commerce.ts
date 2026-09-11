import type { StockSku } from "./catalog.js";
import { skuLabel } from "./catalog.js";
import { looksLikeAllStock } from "./roster.js";

export function findSku(stock: StockSku[], id: string): StockSku | undefined {
  return stock.find((s) => s.id === id);
}

/** US cuts we do not stock — map to the nearest mill size. */
export function requestedSize(text: string): "A4" | "A3" | null {
  const t = text.toLowerCase();
  if (/\b(legal|letter|us letter)\b/.test(t)) return "A4";
  if (/\b(tabloid|ledger)\b/.test(t)) return "A3";
  if (/\ba4\b/.test(t)) return "A4";
  if (/\ba3\b/.test(t)) return "A3";
  return null;
}

export function sizeAliasNote(text: string): string | null {
  if (/\blegal\b/i.test(text)) return "We don't stock legal — A4 is the closest cut.";
  if (/\bletter\b/i.test(text)) return "We don't stock US letter — A4 is the closest cut.";
  if (/\b(tabloid|ledger)\b/i.test(text)) return "We don't stock tabloid — A3 is the closest cut.";
  return null;
}

function familyBonus(t: string, s: StockSku): number {
  const hits: Array<[RegExp, (sku: StockSku) => boolean, number]> = [
    [/recycl/, (sku) => sku.article.includes("Recycled"), 5],
    [/\bkraft\b/, (sku) => sku.article.includes("Kraft"), 4],
    [/\b(photo|glossy photo)\b/, (sku) => sku.article.includes("Photo"), 4],
    [/\b(card\s*stock|cardstock)\b/, (sku) => sku.article.includes("Cardstock"), 4],
    [/\bgloss\b/, (sku) => sku.article.includes("Gloss") && !sku.article.includes("Photo"), 3],
    [/\bmatte\b/, (sku) => sku.article.includes("Matte"), 3],
    [/\bpremium\b/, (sku) => sku.article.startsWith("Premium"), 3],
    [/\boffset\b/, (sku) => sku.article.includes("Offset"), 3],
    [/\bcolor/, (sku) => sku.article.includes("Colored"), 3],
    [/\bcopy\b/, (sku) => sku.article.startsWith("Copy"), 2],
  ];
  let score = 0;
  let asked = false;
  for (const [re, ok, n] of hits) {
    if (!re.test(t)) continue;
    asked = true;
    score += ok(s) ? n : -5;
  }
  if (asked) return score;
  return 0;
}

export function matchSkuFromText(stock: StockSku[], text: string): StockSku | undefined {
  const t = text.toLowerCase();
  const wantSize = requestedSize(text);
  const scored = stock
    .map((s) => {
      let score = familyBonus(t, s);
      if (t.includes(s.article.toLowerCase())) score += 3;
      if (new RegExp(`\\b${s.gsm}\\s*(gsm|g/?m²|g/?m2)\\b`, "i").test(t)) score += 2;
      if (t.includes(s.size.toLowerCase())) score += 2;
      if (wantSize === s.size) score += 2;
      if (wantSize && wantSize !== s.size) score -= 4;
      if (t.includes("copy") && s.article.startsWith("Copy") && t.includes(s.size.toLowerCase())) score += 2;
      return { s, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.s;
}

export function mentionsPaperSpec(text: string): boolean {
  return /\b(recycl|kraft|gloss|matte|card\s*stock|cardstock|premium|offset|photo|color|legal|letter|tabloid|ledger|a3|a4|gsm|copy paper)\b/i.test(
    text,
  );
}

export function interpretPaperAsk(
  stock: StockSku[],
  text: string,
): { sku?: StockSku; qty?: number; note: string | null } | null {
  if (!/\b(paper|reams?|packs?|recycl|kraft|legal|letter|a3|a4|gsm|card|gloss|matte|copy|stock|need|want)\b/i.test(text)) {
    return null;
  }
  const sku = matchSkuFromText(stock, text);
  const withUnit = text.match(/\b(\d{1,3})\s*(reams?|packs?|units?)\b/i);
  const qty = withUnit ? Math.min(200, Math.max(1, Number(withUnit[1]))) : undefined;
  const note = sizeAliasNote(text);
  if (!sku && qty == null && !note && !mentionsPaperSpec(text)) return null;
  return { sku, qty, note };
}

export function qtyFromText(text: string, fallback: number, onHand?: number): number {
  if (onHand != null && looksLikeAllStock(text)) return Math.max(1, Math.min(onHand, 200));
  const withUnit = text.match(/\b(\d{1,3})\s*(reams?|packs?|units?)\b/i);
  if (withUnit) {
    const n = Number(withUnit[1]);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 200);
  }
  const gsm = new Set([75, 80, 90, 100, 115, 120, 130, 150, 170, 200, 250, 300]);
  const nums = [...text.matchAll(/\b(\d{1,3})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 200 && !gsm.has(n));
  const n = nums[0];
  if (n == null) return fallback;
  return n;
}

export interface SaleResult {
  ok: boolean;
  message: string;
  sku?: StockSku;
  qty?: number;
  revenue?: number;
  hitReorder?: boolean;
}

/** Mill restock is 20% of the shelf (sale) price per unit. */
export const REORDER_COST_RATE = 0.2;

export function restockToStart(sku: StockSku): { qty: number; cost: number } {
  const qty = Math.max(0, sku.startQty - sku.qty);
  const cost = Math.round(qty * sku.price * REORDER_COST_RATE * 100) / 100;
  sku.qty = sku.startQty;
  sku.reorderNotified = false;
  sku.incoming = 0;
  return { qty, cost };
}

export function ringUp(
  stock: StockSku[],
  skuId: string,
  qty: number,
): SaleResult {
  const sku = findSku(stock, skuId);
  if (!sku) return { ok: false, message: "Unknown article." };
  if (qty < 1) return { ok: false, message: "Quantity must be at least 1." };
  if (sku.qty < qty) {
    return {
      ok: false,
      message: `Only ${sku.qty} ${sku.unit} of ${skuLabel(sku)} left.`,
      sku,
    };
  }
  sku.qty -= qty;
  const revenue = Math.round(sku.price * qty * 100) / 100;
  const hitReorder = sku.qty <= sku.reorderAt && !sku.reorderNotified;
  if (hitReorder) sku.reorderNotified = true;
  return { ok: true, message: "Sold.", sku, qty, revenue, hitReorder };
}
