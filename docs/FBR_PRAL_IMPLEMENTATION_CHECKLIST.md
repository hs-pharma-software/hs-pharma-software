# FBR/PRAL Gateway — Implementation Checklist

Status values: **Completed** · **In progress** · **Blocked** · **Requires approval** · **Not started**
Last updated: 12 November 2026 (end of Phase 2 development).

| # | Task | Status | Depends on | Where |
|---|---|---|---|---|
| 1 | Phase 1 audit report | Completed | — | `docs/FBR_PRAL_PHASE_1_AUDIT_REPORT.md` |
| 2 | Block `offline_*`, `payment_*`, `fbr_*` tables from browser SQL + tests | Completed | — | `src/server/sqlPolicy.ts`, `tests/regression/server-only-tables.test.ts` |
| 3 | Migration v85: `fbr_credentials`, `fbr_submissions` (additive) | Completed (code) | — | `src-tauri/src/lib.rs`, `scripts/migrate-turso.cjs`, `src/lib/schemaVersion.ts` |
| 4 | Encrypted token storage (`FBR_TOKEN_KEY`, AES-256-GCM) | Completed | 3 | `src/server/fbr/secretBox.ts` |
| 5 | Gateway client (HMAC-signed) | Completed | — | `src/server/fbr/gatewayClient.ts` |
| 6 | Submission service: claim → send → record; uncertain never re-sent; resolve | Completed | 3, 5 | `src/server/fbr/service.ts` |
| 7 | Tokens (save, legacy copy, hidden from browsers), token test, reference lookups | Completed | 4, 5 | `service.ts`, `src/server/tenantScope.ts` |
| 8 | `/api/fbr` route | Completed | 6, 7 | `src/app/api/fbr/route.server.ts` |
| 9 | Client routes submit / test / lookups through `/api/fbr` (gateway + direct modes) | Completed | 8 | `src/lib/fbr.ts`, `fbrResponse.ts`, `fbrSubmit.ts`, `serviceFbr.ts`, `electric/fbr.ts` |
| 10 | Settings card: encrypted save, saved-token hint, route note, Super Admin per business | Completed | 8 | `src/components/settings/FbrSettingsCard.tsx` |
| 11 | Tenant UI: unclear / rejected submissions, resolve | Completed | 8 | `src/components/settings/FbrSubmissionsPanel.tsx` |
| 12 | Super Admin FBR page (gateway health, outbound IP, businesses, problems) | Completed | 8 | `src/app/admin/fbr/page.tsx`, `src/config/adminNav.ts` |
| 13 | Gateway service | Completed | — | `fbr-gateway/` |
| 14 | Gateway tests (mocked FBR) | Completed: 12/12 pass | 13 | `fbr-gateway/test/gateway.test.ts` |
| 15 | Server end-to-end tests (real gateway, mocked FBR) | Completed: 18/18 pass | 6–8 | `tests/server/fbr-gateway-flow.test.ts` |
| 16 | Full regression suite | Completed (see Phase 2 report §6) | all | `npm test` |
| 17 | VPS guide, systemd unit, Caddyfile, env template | Completed | 13 | `docs/FBR_GATEWAY_DEPLOYMENT.md`, `fbr-gateway/deploy/` |
| 18 | Phase 2 implementation report | Completed | all | `docs/FBR_PRAL_PHASE_2_IMPLEMENTATION_REPORT.md` |
| 19 | Run v85 (and v84) on the live database | Requires approval | 3 | backup, then `npm run migrate:turso` |
| 20 | Vercel env: `FBR_TOKEN_KEY` (step 1), then `FBR_GATEWAY_URL`, `FBR_GATEWAY_SECRET` | Requires approval | 17, 21–23 | deployment guide §7 |
| 21 | Buy VPS with static IPv4 | Requires approval | — | deployment guide §1 |
| 22 | DNS `A` record `fbr-api.mavin.pk` | Requires approval | 21 | deployment guide §4 |
| 23 | PRAL whitelisting of the gateway IP; per-taxpayer model confirmed | Blocked (external: PRAL) | 21 | deployment guide §6 |
| 24 | Sandbox end-to-end through the gateway with a real token | Blocked (needs 19–23) | 19–23 | deployment guide §8 |
| 25 | Production deploy (commit + push to `main`) | Requires approval | 16 | — |
| 26 | Server-built FBR payload (not trusted from the browser) | Not started (later) | 9 | audit §6.3 |
| 27 | Automatic reconciliation of unclear submissions | Blocked (external: needs a PRAL lookup API) | — | audit §9.4 |
| 28 | Android app FBR submission | Not started | 8 | — |
