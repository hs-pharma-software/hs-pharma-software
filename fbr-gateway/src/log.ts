/** One JSON line per event on stdout (journald keeps it). Never the token,
 * the invoice body or buyer details: only references, sizes and outcomes. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

const REDACT = /token|secret|authorization|signature|payload|body|ntn|cnic|buyer/i;

export function log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}, out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)) {
  const safe: LogFields = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = REDACT.test(k) ? "[redacted]" : v;
  out(JSON.stringify({ t: new Date().toISOString(), level, event, ...safe }));
}
