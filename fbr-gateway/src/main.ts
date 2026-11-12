/** Entry point: start the gateway; on SIGTERM / SIGINT stop taking new
 * requests and let the ones in progress finish (FBR calls can take ~40 s). */
import { loadConfig } from "./config.ts";
import { createGateway } from "./server.ts";
import { log } from "./log.ts";

const cfg = loadConfig();
const server = createGateway(cfg);

server.listen(cfg.port, cfg.host, () => log("info", "started", { host: cfg.host, port: cfg.port, version: cfg.version }));

let stopping = false;
function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "stopping", { signal, inFlight: server.inFlight() });
  server.close(() => { log("info", "stopped"); process.exit(0); });
  server.closeIdleConnections();
  // Never wait for ever: systemd restarts the service anyway.
  setTimeout(() => { log("warn", "forced_exit", { inFlight: server.inFlight() }); process.exit(1); }, cfg.fbrTimeoutMs + 10_000).unref();
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
process.on("unhandledRejection", (e) => log("error", "unhandled_rejection", { message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
