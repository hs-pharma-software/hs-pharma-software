/** Gateway settings, from environment variables only (see deploy/fbr-gateway.env.example). */

export interface GatewayConfig {
  host: string;
  port: number;
  /** Shared secrets with MAVIN's server; more than one during a key change (rotation). */
  secrets: string[];
  /** FBR's gateway; overridable only for tests. */
  fbrBaseUrl: string;
  fbrTimeoutMs: number;
  maxBodyBytes: number;
  /** Requests per minute per business (tenant reference) and in total. */
  ratePerTenant: number;
  rateTotal: number;
  /** How far a signed request's time may be from the gateway's clock. */
  maxSkewMs: number;
  /** Public service that echoes the caller's IP (static outbound IP check). */
  egressCheckUrl: string;
  version: string;
}

type Env = Record<string, string | undefined>;

function num(name: string, fallback: number, env: Env): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
  return n;
}

export function loadConfig(env: Env = process.env): GatewayConfig {
  const secrets = (env.GATEWAY_SECRETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!secrets.length) throw new Error("GATEWAY_SECRETS is not set (one or more shared secrets, comma separated).");
  if (secrets.some((s) => s.length < 32)) throw new Error("Each GATEWAY_SECRETS value must be at least 32 characters.");
  return {
    host: env.GATEWAY_HOST || "127.0.0.1",
    port: num("GATEWAY_PORT", 8787, env),
    secrets,
    fbrBaseUrl: (env.FBR_BASE_URL || "https://gw.fbr.gov.pk").replace(/\/+$/, ""),
    fbrTimeoutMs: num("FBR_TIMEOUT_MS", 40_000, env),
    maxBodyBytes: num("MAX_BODY_BYTES", 1_000_000, env),
    ratePerTenant: num("RATE_PER_TENANT_PER_MIN", 60, env),
    rateTotal: num("RATE_TOTAL_PER_MIN", 600, env),
    maxSkewMs: num("MAX_CLOCK_SKEW_MS", 5 * 60_000, env),
    egressCheckUrl: env.EGRESS_CHECK_URL || "https://api.ipify.org",
    version: env.GATEWAY_VERSION || "1.0.0",
  };
}
