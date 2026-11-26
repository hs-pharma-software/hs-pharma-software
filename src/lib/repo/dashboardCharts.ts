import { dbSelect } from "../db";
import { localDate } from "../localDate";
import { requireCurrentTenantId } from "./base";

/** Figures for the dashboard charts (wheels, flows, trends). Each reads only
 * this business's rows; "today" is the business's own local date. */

export interface DayValue { date: string; value: number }

/** The last `days` local dates, oldest first. */
export function lastDays(days: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    out.push(localDate(d));
  }
  return out;
}

/** Fills the days with no rows with 0, in date order. */
export function fillDays(dates: string[], rows: { d: string; n: number | null }[]): DayValue[] {
  const by = new Map(rows.map((r) => [r.d, Number(r.n) || 0]));
  return dates.map((date) => ({ date, value: by.get(date) ?? 0 }));
}

/** Net sales (returns subtracted) per day for the last `days` days. */
export async function getSalesTrend(days = 7): Promise<DayValue[]> {
  const t = requireCurrentTenantId();
  const dates = lastDays(days);
  const rows = await dbSelect<{ d: string; n: number | null }>(
    `SELECT substr(date, 1, 10) AS d,
            SUM(CASE WHEN COALESCE(is_return, 0) = 0 THEN COALESCE(total, 0) ELSE -COALESCE(total, 0) END) AS n
     FROM invoices
     WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_memorized, 0) = 0 AND COALESCE(is_quotation, 0) = 0
       AND substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ?
     GROUP BY substr(date, 1, 10)`,
    [t, dates[0], dates[dates.length - 1]],
  );
  return fillDays(dates, rows);
}

/** Today's sales split into what was collected and what was left on credit. */
export async function getTodaySalesSplit(today: string = localDate()): Promise<{ collected: number; credit: number }> {
  const t = requireCurrentTenantId();
  const rows = await dbSelect<{ total: number | null; paid: number | null }>(
    `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(MIN(COALESCE(paid, 0), COALESCE(total, 0))), 0) AS paid
     FROM invoices
     WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_return, 0) = 0 AND COALESCE(is_memorized, 0) = 0
       AND COALESCE(is_quotation, 0) = 0 AND substr(date, 1, 10) = ?`,
    [t, today],
  );
  const total = Number(rows[0]?.total) || 0;
  const collected = Number(rows[0]?.paid) || 0;
  return { collected, credit: Math.max(total - collected, 0) };
}

export interface HospitalBreakdown {
  /** Today's visits by kind (OPD, IPD, emergency…). */
  byType: { key: string; n: number }[];
  /** Today's visits by department. */
  byDepartment: { key: string; n: number }[];
  /** Today's money received (refunds subtracted) by method. */
  byMethod: { key: string; n: number }[];
  /** Today's OPD: token given → with or past the doctor → seen → admitted from a visit. */
  opdFlow: { tokens: number; called: number; seen: number; admitted: number };
  /** Money received per day, the last 7 days. */
  revenueTrend: DayValue[];
}

export async function getHospitalBreakdown(today: string = localDate()): Promise<HospitalBreakdown> {
  const t = requireCurrentTenantId();
  const dates = lastDays(7);
  const live = `tenant_id = ? AND deleted_at IS NULL AND COALESCE(status, '') != 'cancelled'`;
  const [byType, byDepartment, byMethod, flow, admitted, trend] = await Promise.all([
    dbSelect<{ k: string; n: number }>(
      `SELECT type AS k, COUNT(*) AS n FROM hospital_episodes WHERE ${live} AND date = ? GROUP BY type`, [t, today]),
    dbSelect<{ k: string; n: number }>(
      `SELECT COALESCE(NULLIF(TRIM(department), ''), 'No department') AS k, COUNT(*) AS n
       FROM hospital_episodes WHERE ${live} AND date = ? GROUP BY k`, [t, today]),
    dbSelect<{ k: string; n: number }>(
      `SELECT COALESCE(NULLIF(TRIM(method), ''), 'cash') AS k,
              SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS n
       FROM hospital_payments WHERE tenant_id = ? AND deleted_at IS NULL AND received_at >= ? AND received_at < ?
       GROUP BY k`, [t, today, today + "~"]),
    dbSelect<{ tokens: number | null; called: number | null; seen: number | null }>(
      `SELECT COUNT(*) AS tokens,
              SUM(CASE WHEN consult_status IN ('in_consultation', 'done') THEN 1 ELSE 0 END) AS called,
              SUM(CASE WHEN consult_status = 'done' THEN 1 ELSE 0 END) AS seen
       FROM hospital_episodes WHERE ${live} AND type = 'opd' AND date = ?`, [t, today]),
    dbSelect<{ n: number | null }>(
      `SELECT COUNT(*) AS n FROM hospital_episodes
       WHERE ${live} AND type = 'ipd' AND date = ? AND COALESCE(from_episode_id, '') != ''`, [t, today]),
    dbSelect<{ d: string; n: number | null }>(
      `SELECT substr(received_at, 1, 10) AS d, SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS n
       FROM hospital_payments WHERE tenant_id = ? AND deleted_at IS NULL AND received_at >= ? AND received_at < ?
       GROUP BY substr(received_at, 1, 10)`, [t, dates[0], dates[dates.length - 1] + "~"]),
  ]);
  const num = (rows: { k: string; n: number }[]): { key: string; n: number }[] => rows.map((r) => ({ key: r.k, n: Number(r.n) || 0 }));
  return {
    byType: num(byType),
    byDepartment: num(byDepartment),
    byMethod: num(byMethod),
    opdFlow: {
      tokens: Number(flow[0]?.tokens) || 0,
      called: Number(flow[0]?.called) || 0,
      seen: Number(flow[0]?.seen) || 0,
      admitted: Number(admitted[0]?.n) || 0,
    },
    revenueTrend: fillDays(dates, trend),
  };
}
