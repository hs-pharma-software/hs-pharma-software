# MAVIN FBR gateway

A small Node.js service (TypeScript, no runtime dependencies) that sends MAVIN's FBR Digital Invoicing calls from **one static IP**,
so PRAL can whitelist a single address for MAVIN.

```
Browser / Android → MAVIN on Vercel (/api/fbr) → this gateway (fbr-api.mavin.pk) → gw.fbr.gov.pk
```

It holds no tokens and no data: MAVIN's server sends each business's token with each request, over HTTPS, signed.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | `{ ok, version, uptimeSec }` for uptime monitors |
| POST | `/v1/fbr` | signed | `{ environment, operation, referencePath?, token, payload?, tenantRef }` → FBR |
| GET | `/v1/egress-ip` | signed | `{ ip }`: the address FBR sees (to confirm the static IP) |

`operation`: `post` (record an invoice), `validate` (check only, records nothing), `reference` (one of FBR's lookups:
`SaleTypeToRate`, `HS_UOM`, `SroSchedule`, `SROItem`). Any other FBR address is refused: the gateway is not an open proxy.

Answer of `/v1/fbr`:

- `{ outcome: "response", status, body }`: FBR answered (any HTTP status); MAVIN reads the body.
- `{ outcome: "not_sent", error }`: nothing left the gateway (DNS, refused, TLS). Safe to send again.
- `{ outcome: "uncertain", error }`: it may have reached FBR, but no answer came (timeout, connection dropped). MAVIN does
  **not** send it again on its own; a person checks IRIS / the PRAL portal.

### Signing

```
signature = hex( HMAC-SHA256( secret, `${timestamp}.${requestId}.${METHOD}.${path}.${sha256hex(body)}` ) )
headers:    X-Mavin-Timestamp (ms), X-Mavin-Request-Id (unique), X-Mavin-Signature
```

Refused: missing or wrong signature, a body changed after signing, a timestamp more than 5 minutes off, a request id used before.
MAVIN signs in `src/server/fbr/gatewayClient.ts`; a test checks both sides produce the same signature.

## Logs

One JSON line per event on stdout (journald): request id, a per-business reference (an HMAC, not the business id), operation,
environment, outcome, HTTP status, duration. Never the token, the invoice, buyer details or signatures.

## Develop and test

```bash
npm install          # TypeScript and Node types (development only)
npm test             # tests against a local stand-in for FBR (never the real FBR)
npm run build        # dist/ for the server
```

Deployment: see `docs/FBR_GATEWAY_DEPLOYMENT.md` in the MAVIN repository.
