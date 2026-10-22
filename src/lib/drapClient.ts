import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { clean, parseDrapRecordHtml, type DrapRecord } from "./drap";

// DRAP's public registry (Registered Drugs Index). It sends no CORS headers,
// so requests go through the Tauri HTTP plugin (allow-listed in capabilities).
const BASE = "https://eapp.dra.gov.pk/productView.php";

async function drapFetch(url: string, init?: RequestInit): Promise<string> {
  const res = await tauriFetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`DRAP registry returned HTTP ${res.status}`);
  return (await res.text()).replace(/^﻿/, "");
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected response from DRAP (${what})`);
  }
}

export interface DrapHit {
  regNo: string;
  name: string;
  company?: string;
  generic?: string;
}

/** Brand name search (DRAP needs at least 3 characters). */
export async function searchDrapBrands(term: string): Promise<DrapHit[]> {
  const text = await drapFetch(`${BASE}?search=${encodeURIComponent(term)}&_type=${encodeURIComponent("brand name")}`);
  const data = parseJson<{ results?: { id: string; text: string }[] }>(text, "brand search");
  return (data.results ?? []).map((r) => ({ regNo: clean(r.id), name: clean(r.text) }));
}

/** Generic name search: resolves matching generic names, then lists every
 * product registered under each. */
export async function searchDrapGenerics(term: string): Promise<DrapHit[]> {
  const text = await drapFetch(`${BASE}?searchGeneric=${encodeURIComponent(term)}&_type=${encodeURIComponent("generic name")}`);
  const generics = parseJson<{ results?: { id: string; text: string }[] }>(text, "generic search").results ?? [];
  const hits: DrapHit[] = [];
  for (const g of generics) {
    const body = new URLSearchParams({ masterID: g.id }).toString();
    const list = await drapFetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!list.trim().startsWith("[")) continue;
    for (const p of parseJson<{ registrationNo: string; approvedName: string; companyName: string; genericName: string }[]>(list, "generic products")) {
      hits.push({
        regNo: clean(p.registrationNo),
        name: clean(p.approvedName),
        company: clean(p.companyName),
        generic: clean(p.genericName.replace(/<br\s*\/?>/gi, " ")),
      });
    }
  }
  return hits;
}

export async function fetchDrapRecord(regNo: string): Promise<DrapRecord | null> {
  const body = new URLSearchParams({ webRegNo: regNo }).toString();
  const html = await drapFetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseDrapRecordHtml(html);
}

/** Fetches full records for many registration numbers, 3 at a time. */
export async function fetchDrapRecords(
  regNos: string[],
  onProgress?: (done: number, total: number) => void
): Promise<{ records: DrapRecord[]; errors: { regNo: string; error: string }[] }> {
  const unique = Array.from(new Set(regNos.map(clean).filter(Boolean)));
  const records: DrapRecord[] = [];
  const errors: { regNo: string; error: string }[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < unique.length) {
      const regNo = unique[next++];
      try {
        const rec = await fetchDrapRecord(regNo);
        if (rec) records.push(rec);
        else errors.push({ regNo, error: "No record found" });
      } catch (e) {
        errors.push({ regNo, error: e instanceof Error ? e.message : String(e) });
      }
      onProgress?.(++done, unique.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const order = new Map(unique.map((r, i) => [r, i]));
  records.sort((a, b) => (order.get(a.regNo) ?? 0) - (order.get(b.regNo) ?? 0));
  return { records, errors };
}
