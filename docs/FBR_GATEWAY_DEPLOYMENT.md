# MAVIN FBR gateway: deployment guide (Ubuntu VPS)

This puts `fbr-gateway/` on a small VPS with a **static public IPv4**, behind Caddy (automatic HTTPS) at
`https://fbr-api.mavin.pk`, then points MAVIN at it. Nothing here has been done yet: buying the VPS, the DNS record, and the
Vercel settings need your approval.

Order: **1** VPS → **2** server set-up → **3** gateway → **4** HTTPS + DNS → **5** check the outbound IP → **6** PRAL whitelisting →
**7** MAVIN settings → **8** sandbox test → **9** production.

---

## 1. VPS

| Need | Value |
|---|---|
| CPU / RAM / disk | 1 vCPU, 1 GB RAM (512 MB works), 10–20 GB |
| IP | **dedicated static public IPv4** (must not change: PRAL whitelists it) |
| OS | Ubuntu 24.04 LTS |
| Region | Mumbai or Bangalore (near Pakistan and Vercel `bom1`), or a Pakistani provider |
| Cost | about USD 4–7 per month (check the provider's current price) |

Examples: AWS Lightsail (Mumbai; attach a free static IP), DigitalOcean (Bangalore; add a Reserved IP), Vultr (Mumbai/Bangalore).
Whatever the provider, the **outbound** address must be the static IP (check in step 5).

## 2. Server set-up (as root, once)

```bash
apt update && apt -y upgrade
apt -y install curl ufw unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades          # automatic security updates

# Firewall: SSH, HTTP (certificate), HTTPS only. The gateway port 8787 stays closed (localhost only).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Time must be right: signed requests older than 5 minutes are refused.
timedatectl set-ntp true && timedatectl

# Node.js 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs && node --version             # v22.x

# A user that only runs the gateway
useradd --system --no-create-home --shell /usr/sbin/nologin fbrgw
```

SSH: use keys, disable password login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`).

## 3. The gateway

Build it on your PC (inside the MAVIN repository) and copy the result:

```bash
cd fbr-gateway
npm install
npm test                      # must pass
npm run build                 # creates dist/
scp -r dist package.json root@<VPS-IP>:/opt/mavin-fbr-gateway/
scp deploy/mavin-fbr-gateway.service root@<VPS-IP>:/etc/systemd/system/
scp deploy/fbr-gateway.env.example root@<VPS-IP>:/etc/mavin-fbr-gateway.env
```

On the VPS:

```bash
chown -R root:root /opt/mavin-fbr-gateway && chmod -R a+rX /opt/mavin-fbr-gateway
openssl rand -base64 48                     # the shared secret: keep it for step 7
nano /etc/mavin-fbr-gateway.env             # GATEWAY_SECRETS=<that secret>
chmod 600 /etc/mavin-fbr-gateway.env
systemctl daemon-reload
systemctl enable --now mavin-fbr-gateway
systemctl status mavin-fbr-gateway          # active (running)
curl -s http://127.0.0.1:8787/health        # {"ok":true,...}
journalctl -u mavin-fbr-gateway -f          # logs (JSON lines, no tokens or invoices)
```

The gateway restarts by itself if it stops (`Restart=always`), and starts at boot.

## 4. HTTPS and DNS

1. **DNS** (at your DNS host for `mavin.pk`): add an `A` record `fbr-api` → `<VPS static IP>`, TTL 300. *(Requires approval: live DNS.)*
2. **Caddy:**

```bash
apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
cp <repo>/fbr-gateway/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
curl -s https://fbr-api.mavin.pk/health     # {"ok":true,...} with a valid certificate
```

Caddy obtains and renews the Let's Encrypt certificate itself (DNS must point here first, ports 80/443 open).

## 5. Check the outbound (static) IP

FBR sees the address the gateway connects **from**:

```bash
curl -s https://api.ipify.org; echo        # on the VPS: must equal the static IP
```

After step 7, *Super Admin → FBR Integration → Check outbound IP* asks the gateway the same question.
If the two differ, the provider is sending traffic from another address: fix that before asking PRAL.

## 6. PRAL whitelisting

Send PRAL (Digital Invoicing support) the **static IP** from step 5, with MAVIN as the software provider. Ask them to confirm:

1. that this one IP is whitelisted for the businesses that use MAVIN (or what each business must do on its own DI profile:
   some taxpayers may need to add the IP themselves);
2. for **sandbox** first, then **production**;
3. the current DI API version (MAVIN implements v1.12).

Until PRAL confirms, keep MAVIN in direct mode (step 7 not done): shops keep submitting from their own whitelisted connections.

## 7. MAVIN settings (Vercel, Production environment) *(Requires approval)*

| Variable | Value |
|---|---|
| `FBR_TOKEN_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts tokens at rest. **Keep a copy safely**: if lost, businesses re-enter their tokens. |
| `FBR_GATEWAY_URL` | `https://fbr-api.mavin.pk` |
| `FBR_GATEWAY_SECRET` | the secret from step 3 (same value as `GATEWAY_SECRETS` on the VPS) |

Also run migration **v85** on the live database first: `node scripts/backup-turso-snapshot.cjs` then `npm run migrate:turso`.

`FBR_TOKEN_KEY` alone (without the gateway variables) is enough to move tokens into encrypted storage while staying in direct mode.
With all three set, MAVIN sends every business's FBR calls through the gateway.

## 8. Sandbox test

With a business on **Sandbox** in *Settings → FBR*:
1. *Test sandbox token* → "Token accepted by FBR sandbox through MAVIN's gateway".
2. Submit one sandbox invoice from *Invoices* → an FBR number appears.
3. *Super Admin → FBR Integration*: gateway Healthy; the business shows 1 accepted.

## 9. Production

Per business, after its sandbox scenarios pass: production token in *Settings → FBR*, environment *Production*, test, then
submit one real invoice and confirm it in IRIS.

---

## Monitoring

- **Uptime:** a free monitor (e.g. UptimeRobot) on `https://fbr-api.mavin.pk/health` every 5 minutes, alert by email/WhatsApp.
- **MAVIN:** *Super Admin → FBR Integration* shows gateway health, per-business counts and unclear / rejected submissions.
- **Logs:** `journalctl -u mavin-fbr-gateway --since "1 hour ago"`; `outcome":"uncertain"` lines mean FBR did not answer.
- **Disk:** journald is capped by default; Caddy rolls its log at 10 MB × 5.

## Secret rotation (no downtime)

1. Generate a new secret; on the VPS set `GATEWAY_SECRETS=NEW,OLD`; `systemctl restart mavin-fbr-gateway`.
2. On Vercel set `FBR_GATEWAY_SECRET=NEW`; redeploy.
3. On the VPS set `GATEWAY_SECRETS=NEW`; restart.

## Backup and rollback

- The gateway keeps **no data**: a new VPS is the same files plus `/etc/mavin-fbr-gateway.env`. Keep the env file's secret in
  your password manager.
- **Update:** copy the new `dist/` to `/opt/mavin-fbr-gateway/dist.new`, then
  `mv dist dist.old && mv dist.new dist && systemctl restart mavin-fbr-gateway`.
  **Roll back:** `mv dist dist.bad && mv dist.old dist && systemctl restart mavin-fbr-gateway`.
- **Turn the gateway off for MAVIN** (e.g. VPS down for long): remove `FBR_GATEWAY_URL` on Vercel and redeploy. MAVIN returns to
  direct mode; shops submit from their own whitelisted connections. Submissions in progress stay recorded; unclear ones still
  need resolving.
- **If the static IP ever changes:** PRAL must whitelist the new one before switching (step 6).
