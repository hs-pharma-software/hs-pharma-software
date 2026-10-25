/** Server-only configuration (Vercel environment variables, or .env.local in
 * development). Never import this from code that runs in the browser: these
 * values must not be sent to it. */
if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface ServerConfig {
  tursoUrl: string;
  tursoToken: string;
  sessionSecret: string;
}

export function serverConfig(): ServerConfig {
  // The NEXT_PUBLIC_ names are accepted only in development, where .env.local
  // still carries them for the desktop build; production uses the server names.
  const dev = process.env.NODE_ENV !== "production";
  const tursoUrl = process.env.TURSO_DATABASE_URL || (dev ? process.env.NEXT_PUBLIC_TURSO_DATABASE_URL : "") || "";
  const tursoToken = process.env.TURSO_AUTH_TOKEN || (dev ? process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN : "") || "";
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (!tursoUrl || !tursoToken) throw new ConfigError("The server's database settings (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN) are missing.");
  if (sessionSecret.length < 32) throw new ConfigError("SESSION_SECRET is missing or shorter than 32 characters.");
  return { tursoUrl, tursoToken, sessionSecret };
}

export class ConfigError extends Error {}
