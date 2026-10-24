const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date on this computer's clock, "YYYY-MM-DD". `toISOString()` gives the
 * UTC date instead, which is yesterday for the first hours after midnight in
 * Pakistan (UTC+5), so appointments and episodes landed on the wrong day. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date and time, "YYYY-MM-DD HH:MM". */
export function localDateTime(d: Date = new Date()): string {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
