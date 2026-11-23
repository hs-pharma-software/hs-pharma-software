/** Hospital MR numbers: MR-<number>-<registration date DDMMYYYY>-<year>,
 * e.g. MR-0001-23112026-2026. The number counts on for ever (4 digits, more
 * after 9999); the year part is renewed at the patient's first visit of a
 * new year (MR-0001-23112026-2027), the earlier MR kept in the history.
 * Old numbers (MR-000123) were converted keeping their number. */

const NEW_FORMAT = /^MR-(\d+)-(\d{2})(\d{2})(\d{4})-(\d{4})$/i;
const OLD_FORMAT = /^MR-0*(\d+)$/i;

/** The MR for a number, registration date (yyyy-mm-dd) and year. */
export function formatMr(seq: number, regDate: string, year: number): string {
  const [y, m, d] = regDate.slice(0, 10).split("-");
  return `MR-${String(seq).padStart(4, "0")}-${d}${m}${y}-${year}`;
}

/** The parts of a new-format MR, or null. */
export function parseMr(mr: string | null | undefined): { seq: number; regDate: string; year: number } | null {
  const m = NEW_FORMAT.exec((mr ?? "").trim());
  if (!m) return null;
  return { seq: Number(m[1]), regDate: `${m[4]}-${m[3]}-${m[2]}`, year: Number(m[5]) };
}

/** Whether a typed term finds this patient by MR: the MR itself, the same MR of
 * an earlier year (an old slip), or an old MR-000123 by its number. */
export function mrMatches(p: { mr_no: string | null; mr_seq?: number | null }, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const mr = (p.mr_no ?? "").toLowerCase();
  if (mr.includes(t)) return true;
  const typed = parseMr(t);
  if (typed) {
    const own = parseMr(mr);
    return Boolean(own && own.seq === typed.seq && own.regDate === typed.regDate);
  }
  const old = OLD_FORMAT.exec(t);
  return Boolean(old && p.mr_seq != null && Number(p.mr_seq) === Number(old[1]));
}

/** SQL for the same search on a patients table alias (e.g. "p"): params to append in order. */
export function mrSearchSql(alias: string, term: string): { sql: string; params: unknown[] } {
  const t = term.trim();
  const typed = parseMr(t);
  const old = OLD_FORMAT.exec(t);
  const parts = [`${alias}.mr_no LIKE ?`];
  const params: unknown[] = [`%${t}%`];
  if (typed) { parts.push(`${alias}.mr_no LIKE ?`); params.push(`${t.slice(0, -4)}%`); }
  if (old) { parts.push(`${alias}.mr_seq = ?`); params.push(Number(old[1])); }
  return { sql: `(${parts.join(" OR ")})`, params };
}
