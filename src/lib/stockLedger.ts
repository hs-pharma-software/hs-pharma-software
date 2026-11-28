/** A product's stock history and the stock registers' search suggestions, for
 * every kind of business. Pure: each module reads its own records and gives
 * them here as movements and search items.
 *
 * Quantities are in the unit stock is kept in (packs for a pharmacy or store,
 * where a part of a pack is loose units: 20 of 200 tablets = 0.1). */

export type MoveKind =
  | "purchase" | "sale" | "sale_return" | "purchase_return"
  | "transfer_in" | "transfer_out" | "issue" | "return_in" | "dead" | "wastage" | "adjust" | "opening" | "correction";

export interface LedgerMove {
  id: string;
  /** yyyy-mm-dd; null for stock corrected by hand, whose date is not recorded. */
  date: string | null;
  /** When it was entered, to order the movements of one day. */
  at: string;
  kind: MoveKind;
  label: string;
  /** Signed: + in, - out. */
  qty: number;
  /** Invoice, purchase or entry number. */
  ref: string | null;
  /** Distributor, customer, department or branch. */
  party: string | null;
  /** Stock bought from `party`: a different one from the time before is a distributor change. */
  supplied?: boolean;
  details: string[];
}

/** One product with everything that brought it in or took it out. */
export interface LedgerView {
  name: string;
  company?: string | null;
  generic?: string | null;
  units: QtyUnits;
  /** Stock now. */
  available: number;
  moves: LedgerMove[];
}

export interface LedgerEntry extends LedgerMove {
  /** Stock after this movement. */
  balance: number;
  /** The distributor of the purchase before, when this one is from another. */
  previousSupplier: string | null;
}

export interface Ledger {
  entries: LedgerEntry[];
  /** Stock before the first entry shown, when a From date hides earlier ones. */
  broughtForward: number | null;
  closing: number;
  /** Stock now. */
  available: number;
  totalIn: number;
  totalOut: number;
  /** The distributors in the order they supplied, each with the date they started. */
  suppliers: { name: string; since: string | null }[];
}

const EPS = 1e-5;
const round6 = (n: number) => { const v = Math.round(n * 1e6) / 1e6; return Object.is(v, -0) ? 0 : v; };
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The movements in date order with the stock after each one, ending at today's
 * stock. A difference that no record explains (stock entered or corrected by
 * hand) is shown first when stock was added, last when it was taken away: the
 * Stock Register's opening and closing stock agree with it. */
export function buildLedger(moves: LedgerMove[], available: number, range: { from?: string; to?: string } = {}): Ledger {
  const sorted = [...moves].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const unexplained = round6(available - sorted.reduce((s, m) => s + m.qty, 0));
  const hand = (qty: number, label: string): LedgerMove => ({ id: "by-hand", date: null, at: "", kind: "correction", label, qty, ref: null, party: null, details: ["No purchase or sale record; the date is not recorded."] });
  if (unexplained > EPS) sorted.unshift(hand(unexplained, "Opening stock, or added by hand"));
  else if (unexplained < -EPS) sorted.push(hand(unexplained, "Removed or corrected by hand"));

  let balance = 0;
  let supplier: string | null = null;
  const suppliers: Ledger["suppliers"] = [];
  const all: LedgerEntry[] = sorted.map((m) => {
    balance = round6(balance + m.qty);
    let previousSupplier: string | null = null;
    if (m.supplied && m.party) {
      if (!supplier || !sameName(supplier, m.party)) {
        previousSupplier = supplier;
        suppliers.push({ name: m.party, since: m.date });
        supplier = m.party;
      }
    }
    return { ...m, balance, previousSupplier };
  });

  const { from, to } = range;
  // Hand corrections have no date: the one at the start belongs to the stock brought forward.
  const before = (e: LedgerEntry) => (e.date === null ? Boolean(from) && e.qty > 0 : Boolean(from) && e.date < from!);
  const after = (e: LedgerEntry) => e.date !== null && Boolean(to) && e.date > to!;
  const entries = all.filter((e) => !before(e) && !after(e));
  const earlier = all.filter(before);
  const broughtForward = from ? (earlier.length ? earlier[earlier.length - 1].balance : 0) : null;
  // The stock after each entry shown counts only what is shown and what came before (a correction placed after the period included).
  let running = broughtForward ?? 0;
  const shown = entries.map((e) => { running = round6(running + e.qty); return { ...e, balance: running }; });
  return {
    entries: shown,
    broughtForward,
    closing: running,
    available: round6(available),
    totalIn: round6(shown.filter((e) => e.date !== null && e.qty > 0).reduce((s, e) => s + e.qty, 0)),
    totalOut: round6(shown.filter((e) => e.date !== null && e.qty < 0).reduce((s, e) => s - e.qty, 0)),
    suppliers,
  };
}

/** Rows of one document (several lines or batches of a product) as one movement; `key` null keeps a row on its own. */
export function oneMovePerDocument<T extends { qty: number }>(rows: T[], key: (row: T) => string | null, move: (first: T, qty: number, rows: T[]) => LedgerMove): LedgerMove[] {
  const groups = new Map<string, T[]>();
  rows.forEach((r, n) => { const k = key(r) ?? `row ${n}`; groups.set(k, [...(groups.get(k) ?? []), r]); });
  return [...groups.values()].map((g) => move(g[0], g.reduce((s, r) => s + Number(r.qty), 0), g));
}

/** Each product's names (distributors), without repeats, the latest one last. */
export function latestLast(rows: { pid: string; name: string | null }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.name?.trim()) continue;
    map.set(r.pid, [...(map.get(r.pid) ?? []).filter((n) => n !== r.name), r.name]);
  }
  return map;
}

// ── Quantities and dates ────────────────────────────────────────────────

export interface QtyUnits { packing?: number | null; unit?: string | null; subUnit?: string | null }

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasLoose = (u: QtyUnits) => Number(u.packing) > 1 && Boolean(u.subUnit);

/** "2 Pack", "20 Tab", "1 Pack 140 Tab"; without loose units "12 pcs". */
export function formatStockQty(qty: number, u: QtyUnits): string {
  const sign = qty < -EPS ? "-" : "";
  const abs = Math.abs(qty);
  if (!hasLoose(u)) return `${sign}${Math.round(abs * 1000) / 1000}${u.unit ? ` ${u.unit}` : ""}`;
  const p = Number(u.packing);
  const loose = round2(abs * p);
  const packs = Math.floor(loose / p + 1e-9);
  const rest = round2(loose - packs * p);
  const parts = [packs ? `${packs} ${u.unit || "Pack"}` : "", rest ? `${rest} ${u.subUnit}` : ""].filter(Boolean);
  return `${sign}${parts.join(" ") || `0 ${u.subUnit}`}`;
}

/** The same quantity all in loose units ("340 Tab"), when it includes whole packs; else null. */
export function inLooseUnits(qty: number, u: QtyUnits): string | null {
  if (!hasLoose(u)) return null;
  const p = Number(u.packing);
  const loose = round2(qty * p);
  return Math.abs(loose) >= p ? `${loose} ${u.subUnit}` : null;
}

/** "2026-11-01" -> "01/11/2026". */
export function dayMonthYear(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// ── Search suggestions ──────────────────────────────────────────────────

/** A product (or ingredient, or store item) that is in stock or has been bought, even if none is left. */
export interface SearchItem {
  id: string;
  name: string;
  /** Barcode, product code, model: searched, and shown beside the name. */
  codes?: (string | null | undefined)[];
  company?: string | null;
  generic?: string | null;
  /** Every distributor it was bought from (and assigned ones), latest last. */
  distributors?: string[];
  stock: number;
  units?: QtyUnits;
}

export type SearchKind = "product" | "company" | "distributor" | "generic";
export const SEARCH_KINDS: Record<SearchKind, string> = { product: "Products", company: "Companies", distributor: "Distributors", generic: "Generic names" };

export interface Suggestion {
  kind: SearchKind;
  /** The product id, or the company / distributor / generic name. */
  value: string;
  label: string;
  hint: string;
  /** Products: whether any is left. */
  inStock?: boolean;
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, w: string[]) => { const t = text.toLowerCase(); return w.every((x) => t.includes(x)); };
const itemsOf = (item: SearchItem, kind: Exclude<SearchKind, "product">): string[] =>
  (kind === "distributor" ? item.distributors ?? [] : [(kind === "company" ? item.company : item.generic) ?? ""]).map((s) => s.trim()).filter(Boolean);

/** The products matching a company, distributor or generic name picked from the list, or the words typed. */
export function matchingItems(items: SearchItem[], pick: { kind: SearchKind | "text"; value: string }): SearchItem[] {
  const v = pick.value.trim();
  if (pick.kind === "product") return items.filter((i) => i.id === v);
  if (pick.kind === "text") {
    const w = words(v);
    if (!w.length) return items;
    return items.filter((i) => matches([i.name, ...(i.codes ?? []), i.company, i.generic, ...(i.distributors ?? [])].filter(Boolean).join(" "), w));
  }
  return items.filter((i) => itemsOf(i, pick.kind as Exclude<SearchKind, "product">).some((s) => sameName(s, v)));
}

/** What the list under a stock register's search box offers for what is typed:
 * products (in stock or not), then companies, distributors and generic names. */
export function suggestStock(items: SearchItem[], query: string, limit = { product: 30, other: 8 }): { list: Suggestion[]; more: number } {
  const w = words(query);
  const first = w[0] ?? "";
  const starts = (s: string) => Number(!s.toLowerCase().startsWith(first));
  const found = items.filter((i) => !w.length || matches([i.name, ...(i.codes ?? []), i.generic].filter(Boolean).join(" "), w))
    .sort((a, b) => starts(a.name) - starts(b.name) || Number(a.stock <= EPS) - Number(b.stock <= EPS) || a.name.localeCompare(b.name));
  const list: Suggestion[] = found.slice(0, limit.product).map((i) => ({
    kind: "product", value: i.id, label: i.name, inStock: i.stock > EPS,
    hint: [i.company, i.generic, i.distributors?.[i.distributors.length - 1]].filter(Boolean).join(" · "),
  }));
  let more = found.length - list.length;
  if (!w.length) return { list, more };
  for (const kind of ["company", "distributor", "generic"] as const) {
    const names = new Map<string, { label: string; n: number; out: number }>();
    for (const i of items) {
      for (const s of new Set(itemsOf(i, kind))) {
        if (!matches(s, w)) continue;
        const g = names.get(s.toLowerCase()) ?? { label: s, n: 0, out: 0 };
        g.n += 1;
        g.out += Number(i.stock <= EPS);
        names.set(s.toLowerCase(), g);
      }
    }
    const sorted = [...names.values()].sort((a, b) => starts(a.label) - starts(b.label) || a.label.localeCompare(b.label));
    more += Math.max(0, sorted.length - limit.other);
    list.push(...sorted.slice(0, limit.other).map((g): Suggestion => ({
      kind, value: g.label, label: g.label, hint: `${g.n} product${g.n === 1 ? "" : "s"}${g.out ? ` · ${g.out} out of stock` : ""}`,
    })));
  }
  return { list, more };
}
