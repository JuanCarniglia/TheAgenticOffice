/** Starting warehouse from stock_definitions.md. Prices are USD per unit. */

export interface StockSku {
  id: string;
  article: string;
  gsm: number;
  size: "A4" | "A3";
  unit: "reams" | "packs";
  qty: number;
  startQty: number;
  reorderAt: number;
  price: number;
  reorderNotified: boolean;
  incoming: number;
}

export const STARTING_BALANCE = 6000;
/** Office books rate for LLM usage this operating day. */
export const TOKEN_USD_PER_MILLION = 0.25;

export function tokenSpendUsd(tokens: number): number {
  return (tokens / 1_000_000) * TOKEN_USD_PER_MILLION;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatTokenCost(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export function estimateTokens(...parts: string[]): number {
  const chars = parts.join("").length;
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}
export const DEFAULT_PITCH_SKU = "copy-a3-80";
export const DEFAULT_PITCH_QTY = 30;
export const SKU_ID_TUPLE = [
  "copy-a4-75",
  "copy-a4-80",
  "copy-a3-80",
  "prem-a4-90",
  "prem-a4-100",
  "off-a4-80",
  "off-a3-90",
  "off-a4-120",
  "gloss-a4-115",
  "gloss-a3-150",
  "matte-a4-130",
  "matte-a3-170",
  "card-a4-200",
  "card-a4-250",
  "card-a3-300",
  "recy-a4-80",
  "color-a4-80",
  "kraft-a4-100",
  "kraft-a3-150",
  "photo-a4-200",
] as const;
export type SkuId = (typeof SKU_ID_TUPLE)[number];

const RAW: Array<Omit<StockSku, "qty" | "startQty" | "reorderNotified" | "reorderAt" | "incoming"> & { stock: number }> = [
  { id: "copy-a4-75", article: "Copy Paper A4", gsm: 75, size: "A4", unit: "reams", stock: 120, price: 4.2 },
  { id: "copy-a4-80", article: "Copy Paper A4", gsm: 80, size: "A4", unit: "reams", stock: 85, price: 4.8 },
  { id: "copy-a3-80", article: "Copy Paper A3", gsm: 80, size: "A3", unit: "reams", stock: 40, price: 8.5 },
  { id: "prem-a4-90", article: "Premium White", gsm: 90, size: "A4", unit: "reams", stock: 55, price: 6.4 },
  { id: "prem-a4-100", article: "Premium White", gsm: 100, size: "A4", unit: "reams", stock: 35, price: 7.2 },
  { id: "off-a4-80", article: "Offset White", gsm: 80, size: "A4", unit: "reams", stock: 60, price: 5.1 },
  { id: "off-a3-90", article: "Offset White", gsm: 90, size: "A3", unit: "reams", stock: 25, price: 9.0 },
  { id: "off-a4-120", article: "Offset White", gsm: 120, size: "A4", unit: "reams", stock: 30, price: 6.8 },
  { id: "gloss-a4-115", article: "Coated Gloss", gsm: 115, size: "A4", unit: "reams", stock: 18, price: 11.0 },
  { id: "gloss-a3-150", article: "Coated Gloss", gsm: 150, size: "A3", unit: "reams", stock: 22, price: 16.5 },
  { id: "matte-a4-130", article: "Coated Matte", gsm: 130, size: "A4", unit: "reams", stock: 20, price: 12.0 },
  { id: "matte-a3-170", article: "Coated Matte", gsm: 170, size: "A3", unit: "reams", stock: 15, price: 18.0 },
  { id: "card-a4-200", article: "Cardstock White", gsm: 200, size: "A4", unit: "packs", stock: 28, price: 9.5 },
  { id: "card-a4-250", article: "Cardstock White", gsm: 250, size: "A4", unit: "packs", stock: 16, price: 12.0 },
  { id: "card-a3-300", article: "Cardstock White", gsm: 300, size: "A3", unit: "packs", stock: 10, price: 22.0 },
  { id: "recy-a4-80", article: "Recycled Paper", gsm: 80, size: "A4", unit: "reams", stock: 45, price: 5.4 },
  { id: "color-a4-80", article: "Colored Paper", gsm: 80, size: "A4", unit: "packs", stock: 32, price: 6.2 },
  { id: "kraft-a4-100", article: "Kraft Paper", gsm: 100, size: "A4", unit: "packs", stock: 24, price: 5.8 },
  { id: "kraft-a3-150", article: "Kraft Paper", gsm: 150, size: "A3", unit: "packs", stock: 12, price: 10.5 },
  { id: "photo-a4-200", article: "Photo Paper Glossy", gsm: 200, size: "A4", unit: "packs", stock: 14, price: 14.0 },
];

export function seedStock(): StockSku[] {
  return RAW.map((row) => ({
    id: row.id,
    article: row.article,
    gsm: row.gsm,
    size: row.size,
    unit: row.unit,
    qty: row.stock,
    startQty: row.stock,
    reorderAt: Math.max(6, Math.floor(row.stock * 0.28)),
    price: row.price,
    reorderNotified: false,
    incoming: 0,
  }));
}

export function skuLabel(s: Pick<StockSku, "article" | "gsm">): string {
  return `${s.article} ${s.gsm} g/m²`;
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
