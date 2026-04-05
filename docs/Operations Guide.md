# Luca General Ledger — Operations Guide

This document covers everything you need to install, maintain, update, and
troubleshoot a Luca production instance on a VPS. It is written to be
self-contained — if you ever need to replace the server from scratch, this
document plus the GitHub repository is everything you need.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Fresh VPS Installation](#2-fresh-vps-installation)
3. [First Login and Admin Setup](#3-first-login-and-admin-setup)
4. [Connecting Claude (MCP Co-Work)](#4-connecting-claude-mcp-co-work)
5. [Updating Luca](#5-updating-luca)
6. [Useful Server Commands](#6-useful-server-commands)
7. [Troubleshooting](#7-troubleshooting)
8. [Complete Reinstall from Scratch](#8-complete-reinstall-from-scratch)
9. [Architecture Details — for Developers](#9-architecture-details--for-developers)

---

## 1. Architecture Overview

```
Internet
    │
    ▼
nginx (ports 80/443)          — SSL termination, reverse proxy
    │
    ▼
Docker: luca-api (port 3000)  — Express.js API + React frontend (static)
    │
    ▼
Docker: luca-db (port 5432)   — PostgreSQL 16 (internal only)
```

- **nginx** handles SSL (Let's Encrypt), redirects HTTP→HTTPS, and proxies
  all traffic to the Docker container. Port 3000 is bound to 127.0.0.1 only
  — not publicly accessible.
- **luca-api** serves both the REST API (`/api/*`), the MCP endpoint (`/mcp`),
  the OAuth server (`/oauth/*`), and the React frontend (static files).
- **luca-db** is the PostgreSQL mirror database. It is accessible only
  inside the Docker network — not from the internet.
- **Chain files** are stored in a Docker volume (`luca_chain_data`) mounted
  at `/data/chains` inside the container. They are the authoritative ledger
  and must be included in any backup.

### Key files on the VPS

| Path | Purpose |
|---|---|
| `/opt/luca/` | Application code (git repository) |
| `/opt/luca/.env` | All secrets and configuration (never commit this) |
| `/etc/nginx/sites-available/luca` | nginx virtual host config |
| `/etc/systemd/system/luca.service` | systemd unit — auto-start on reboot |
| `/etc/letsencrypt/` | SSL certificates (managed by certbot) |
| Docker volume `luca_chain_data` | Chain files (the authoritative ledger) |
| Docker volume `luca_pg_data` | PostgreSQL data directory |

---

## 2. Fresh VPS Installation

### Prerequisites

- Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 11, or Debian 12
- Minimum 2 GB RAM, 20 GB disk
- Your domain already has an A record pointing to the server's IP address
  (DNS must propagate before running the installer — Let's Encrypt will fail
  if the domain doesn't resolve to this server)

### Run the installer

```bash
curl -sSL https://raw.githubusercontent.com/roger296/luca-general-ledger/main/install.sh \
  -o /tmp/luca-install.sh && sudo bash /tmp/luca-install.sh
```

> **Why download first?** If you pipe `curl` directly to `bash`, the script's
> interactive prompts may not work correctly on some systems. Downloading first
> ensures stdin is connected to your keyboard.

### What the installer does (step by step)

1. Checks OS compatibility and available disk space
2. **Prompts you for:**
   - Company name (displayed in the web UI)
   - Domain name (e.g. `accounts.yourcompany.com`)
   - Admin email address (becomes your login username)
   - Admin password (minimum 12 characters)
   - SSL notification email (for Let's Encrypt expiry notices)
3. Installs system packages: `curl`, `git`, `nginx`, `certbot`, `ufw`
4. Installs Docker and the Docker Compose plugin
5. Configures the firewall: allows SSH, HTTP (80), HTTPS (443); blocks everything else
6. Clones the repository to `/opt/luca`
7. Generates secrets: `JWT_SECRET` (48-byte random), `DB_PASSWORD` (40-char random)
8. Writes `/opt/luca/.env` with all configuration
9. Builds the Docker image (compiles TypeScript + React frontend — takes 2–3 min)
10. Starts PostgreSQL, runs database migrations, seeds initial data
11. Starts all containers
12. Waits for the API to respond on port 3000
13. Sets your admin password via the API
14. Generates an OAuth client (Claude connector credentials)
15. Configures nginx with a temporary HTTP config for certbot validation
16. Obtains a Let's Encrypt SSL certificate
17. Switches nginx to the full HTTPS config
18. Creates a systemd service (`luca.service`) so Luca starts on reboot
19. Shows the final banner with your URL and Claude connector credentials

### If the installer fails partway through

Simply re-run it. When it detects `/opt/luca` already exists it will ask:
```
!! Directory /opt/luca already exists.
   Overwrite existing installation? [y/N]:
```
Type `Y`. It will stop any running containers, delete the directory, and
start fresh. Your SSL certificate will be reused (certbot keeps it in
`/etc/letsencrypt/`).

---

## 3. First Login and Admin Setup

### Default credentials

After installation the default login is:
- **Email:** `admin@localhost`
- **Password:** `admin`

If the installer completed successfully it will have changed the password to
what you entered. If the install was interrupted before that step, use the
defaults above.

### Change the admin email

The admin email defaults to `admin@localhost`. To change it:

```bash
cd /opt/luca

# Get a token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@localhost","password":"admin"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Get the user ID
USER_ID=$(curl -s http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

# Update email and display name
curl -s -X PUT "http://localhost:3000/api/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@yourcompany.com","display_name":"Your Name"}'
```

### Change the admin password

```bash
curl -s -X POST "http://localhost:3000/api/users/$USER_ID/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"admin","new_password":"YourNewPassword"}'
```

You can also do both of these through the web UI once logged in.

---

## 4. Connecting Claude (MCP Co-Work)

Luca exposes 50 MCP tools that Claude can use to operate the accounting
system conversationally. To connect Claude, you need to generate OAuth
credentials and add a connector in Claude.

### How the connection works

```
Claude.ai
    │
    │  1. POST /mcp  (HTTP, no token)  →  401 Unauthorized
    │  2. GET  /.well-known/oauth-protected-resource  →  JSON (auth server URL)
    │  3. GET  /.well-known/oauth-authorization-server  →  JSON (OAuth endpoints)
    │  4. Redirects user to GET /oauth/authorize  →  Login page (HTML)
    │  5. User fills in email + password, submits form (POST /oauth/authorize)
    │  6. Server validates credentials, issues auth code, redirects to claude.ai
    │  7. POST /oauth/token  →  Bearer access token
    │  8. POST /mcp  (with Bearer token)  →  JSON-RPC response
    ▼
Luca GL
```

The OAuth flow is Authorization Code with PKCE (S256). Claude generates
the `code_challenge` and `code_verifier`; Luca verifies them at token
exchange. Tokens are stored as SHA-256 hashes — the raw token is never
stored in the database.

### Step 1: Generate connector credentials

1. Log in to your Luca instance at `https://your-domain`
2. Click **Co-Work Credentials** in the left sidebar (under Admin)
3. Click **+ Generate credentials**
4. A green panel appears showing:
   - **MCP Server URL** — always `https://your-domain/mcp`
   - **Client ID** — a `luca_` prefixed hex string
   - **Client Secret** — a 64-char hex string (blurred by default, click to reveal)
5. Copy all three values. **The Client Secret is shown once only** — it is
   hashed with bcrypt before storage and cannot be retrieved again.
   If you lose it, generate a new credential and revoke the old one.

### Step 2: Add the connector in Claude

1. In Claude, go to **Customize → Connectors → Add connector**
2. Fill in:
   - **Name:** e.g. `My Luca Ledger`
   - **Remote MCP server URL:** the MCP Server URL from step 1
   - **OAuth Client ID:** the Client ID from step 1
   - **OAuth Client Secret:** the Client Secret from step 1
3. Click **Connect**
4. Claude will open a login page at `https://your-domain/oauth/authorize`
5. Enter your Luca email and password (the same credentials you use for the web UI)
6. Click **Sign in & Authorise**
7. You'll be redirected back to Claude with the connection established

### Revoking a connector

In **Co-Work Credentials**, each active connector has a **Revoke** button.
Revoking marks the client as inactive — all existing tokens for that client
immediately stop working. Generate a new credential if you need to reconnect.

### Troubleshooting the Claude connection

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid client." on the login page | The client_id in the URL doesn't match any active client, OR the form POST is not being parsed (old build) | Regenerate credentials in the UI; ensure the server is up to date |
| Login form reloads silently | Unhandled exception in the auth handler | Check `docker compose logs api` for errors; likely a DB issue |
| Connector shows "not connected" after login | `/mcp` endpoint returning 404 or non-JSON-RPC response | Ensure code is up to date and `docker compose up -d --build` has been run |
| `/.well-known/oauth-protected-resource` returns HTML | The well-known route is not registered before the SPA fallback | Ensure server.ts registers these routes before `app.use(express.static(...))` |
| "Invalid or expired token" on MCP calls | Access token expired or revoked | Disconnect and reconnect the Claude connector |

---

## 5. Updating Luca

### Standard update (code changes only, no new migrations)

```bash
cd /opt/luca && git pull && docker compose up -d --build
```

This pulls the latest code from GitHub, rebuilds the Docker image (recompiles
TypeScript and React), and restarts the containers. Takes 2–3 minutes.

> **Important:** `docker compose restart api` only bounces the running
> container — it does NOT recompile the code. Always use `up -d --build`
> after a `git pull`.

### Update with new database migrations

```bash
cd /opt/luca && git pull && \
  docker compose run --rm api npm run migrate && \
  docker compose up -d --build
```

### Checking what version is running

```bash
# Check git commit
cd /opt/luca && git log --oneline -5

# Check running containers
docker compose ps

# Check API health
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

---

## 6. Useful Server Commands

### Container management

```bash
cd /opt/luca

# View all running containers
docker compose ps

# View API logs (live)
docker compose logs -f api

# View last 100 lines of API logs
docker compose logs --tail=100 api

# Restart just the API (does NOT recompile)
docker compose restart api

# Stop everything
docker compose down

# Start everything (after a stop)
docker compose up -d

# Full rebuild and restart
docker compose up -d --build
```

### Database access

```bash
cd /opt/luca

# Open a PostgreSQL prompt
docker compose exec db psql -U gl_admin -d gl_ledger

# List tables
docker compose exec db psql -U gl_admin -d gl_ledger -c "\dt"

# Check OAuth clients
docker compose exec db psql -U gl_admin -d gl_ledger \
  -c "SELECT client_id, name, is_active, created_at FROM oauth_clients;"

# Check users
docker compose exec db psql -U gl_admin -d gl_ledger \
  -c "SELECT id, email, display_name, roles, is_active FROM users;"

# Update a user email directly (emergency use)
docker compose exec db psql -U gl_admin -d gl_ledger \
  -c "UPDATE users SET email = 'new@email.com' WHERE email = 'admin@localhost';"
```

### Running migrations manually

```bash
cd /opt/luca
docker compose run --rm api npm run migrate
```

### Checking the chain files

```bash
# List chain files
docker compose exec api ls /data/chains/

# View the last entry of a period's chain
docker compose exec api tail -1 /data/chains/2026-04.chain.jsonl | python3 -m json.tool
```

### SSL certificate renewal

Certbot is configured to auto-renew via cron. To check or force renewal:

```bash
# Check certificate expiry
certbot certificates

# Force renewal (normally not needed)
certbot renew --force-renewal
systemctl reload nginx
```

### Viewing nginx logs

```bash
tail -f /var/log/nginx/luca_access.log
tail -f /var/log/nginx/luca_error.log
```

---

## 7. Troubleshooting

### The web UI shows "Error: Authentication required" on every page

The React frontend loaded but there's no valid JWT in localStorage. This
happens when the app loads before login. Go to `https://your-domain` — you
should be redirected to the login page. If you land on a blank error screen
instead of a login redirect, the frontend auth layer may be from an old build.
Run `docker compose up -d --build` to recompile.

### Can't log in — "Invalid email or password"

1. Confirm the email address. The default is `admin@localhost` (literal string,
   not a real email address).
2. Email matching is case-insensitive, so `Admin@localhost` also works.
3. If you've forgotten the password, reset it directly via the database:

```bash
cd /opt/luca

# Get a token using DEFAULT credentials (if password was never changed)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@localhost","password":"admin"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

USER_ID=$(curl -s http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

curl -s -X POST "http://localhost:3000/api/users/$USER_ID/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"admin","new_password":"YourNewPassword"}'
```

If the default password has already been changed and you don't know the
current one, reset it directly in the database:

```bash
# Generate a bcrypt hash for your new password (run on any machine with Node)
node -e "const b=require('bcrypt');b.hash('NewPassword123',10).then(h=>console.log(h))"

# Set it in the database (replace the hash below with your generated hash)
docker compose exec db psql -U gl_admin -d gl_ledger \
  -c "UPDATE users SET password_hash = '\$2b\$10\$...' WHERE email = 'admin@localhost';"
```

### API health check fails

```bash
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

This returns JSON with `database` and `chain_dir_writable` status. Common
issues:
- `database: disconnected` — the `luca-db` container is not running.
  Run `docker compose up -d db` then wait 10 seconds and retry.
- `chain_dir_writable: false` — the chain volume mount has a permissions
  problem. Check `docker compose logs api` for details.

### Containers keep restarting

```bash
docker compose logs api --tail=50
```

Common causes:
- **Migration failure** — a new migration has a SQL error. Fix the migration
  and rebuild.
- **Missing environment variable** — check `.env` has all required values.
- **Port conflict** — something else is using port 3000. Check with
  `ss -tlnp | grep 3000`.

### MCP tools not appearing in Claude

After connecting the Claude connector:
1. Verify the MCP endpoint responds: `curl -s https://your-domain/mcp`
   should return JSON (not HTML).
2. Verify the discovery endpoints:
   - `curl -s https://your-domain/.well-known/oauth-authorization-server`
     should return JSON with `authorization_endpoint` and `token_endpoint`.
   - `curl -s https://your-domain/.well-known/oauth-protected-resource`
     should return JSON with `authorization_servers`.
3. If any of these return HTML (the SPA), the server code is out of date.
   Run `docker compose up -d --build`.
4. Disconnect and reconnect the connector in Claude after updating.

### Disk space issues

```bash
# Check disk usage
df -h /

# Check Docker disk usage
docker system df

# Clean up unused Docker images (safe — won't remove running containers)
docker image prune -f

# Check chain file sizes
docker compose exec api du -sh /data/chains/
```

---

## 8. Complete Reinstall from Scratch

Use this procedure if the server is unrecoverable and you need to start fresh
on a new VPS (or the same one after a full wipe).

### Before reinstalling — back up your data

If the old server is still accessible:

```bash
# Back up chain files (the authoritative ledger)
docker compose exec api tar czf /tmp/chains-backup.tar.gz /data/chains/
docker cp luca-api:/tmp/chains-backup.tar.gz ./chains-backup.tar.gz

# Back up the database
docker compose exec db pg_dump -U gl_admin gl_ledger > gl-ledger-backup.sql

# Back up the .env file (contains your secrets)
cp /opt/luca/.env ./luca-env-backup.txt
```

Download these files to your local machine before wiping the server.

### Fresh install on new server

1. Point your domain DNS to the new server's IP and wait for propagation
2. Run the installer:
   ```bash
   curl -sSL https://raw.githubusercontent.com/roger296/luca-general-ledger/main/install.sh \
     -o /tmp/luca-install.sh && sudo bash /tmp/luca-install.sh
   ```
3. When prompted, use the same domain name. Let's Encrypt will issue a new
   certificate — that's fine.

### Restore data after reinstall

```bash
cd /opt/luca

# Stop the running containers
docker compose down

# Restore chain files
docker compose up -d db
docker cp ./chains-backup.tar.gz luca-api:/tmp/
docker compose exec api tar xzf /tmp/chains-backup.tar.gz -C /

# Restore database (wipe the migrated/seeded DB first)
docker compose exec db psql -U gl_admin -d postgres \
  -c "DROP DATABASE gl_ledger; CREATE DATABASE gl_ledger OWNER gl_admin;"
docker compose exec -T db psql -U gl_admin -d gl_ledger < gl-ledger-backup.sql

# Start everything
docker compose up -d
```

> **Note:** If you only have the chain files and not a database backup, the
> database can be rebuilt from the chain files using:
> `docker compose exec api npm run chain:rebuild`

---

## 9. Architecture Details — for Developers

### Key source files

| File | Purpose |
|---|---|
| `src/server.ts` | Express app entry point. Mounts all routers in the correct order. Routes must be registered before `app.use(express.static(...))` or they will be caught by the SPA fallback. |
| `src/api/auth.ts` | JWT login/refresh/me endpoints. Public — no auth middleware. |
| `src/api/oauth.ts` | OAuth 2.0 Authorization Code flow. Public. Handles GET/POST `/oauth/authorize` and POST `/oauth/token`. Also registers `/.well-known/oauth-authorization-server`. |
| `src/api/oauth-clients.ts` | CRUD for OAuth clients. Protected by JWT (requires login to the web UI). |
| `src/engine/oauth.ts` | OAuth business logic: create/list/revoke clients, issue auth codes, exchange tokens, validate Bearer tokens. Tokens stored as SHA-256 hashes. Secrets stored as bcrypt hashes. |
| `src/mcp/server.ts` | MCP HTTP endpoint. Validates Bearer token, dispatches JSON-RPC 2.0 requests to the tool registry. Stateless — a fresh dispatch happens per request. |
| `src/mcp/tools.ts` | All 50 MCP tool definitions and handlers. Calls `registerTools(server)` to register with any McpServer-compatible object. |
| `src/db/migrations/` | Knex migration files. Run in order. New migrations must have a timestamp prefix later than all existing ones. |
| `src/chain/writer.ts` | Append-only chain file writer with mutex locking and fsync. |
| `src/chain/reader.ts` | Chain file reader and hash-chain verifier. |
| `nginx.conf.template` | nginx config template. `DOMAIN_PLACEHOLDER` is replaced by `sed` during install. |
| `install.sh` | VPS installer. All `read` prompts use `</dev/tty` to work when piped via `curl \| bash`. |

### Middleware order in server.ts

The order matters. Incorrect ordering causes subtle bugs:

```
requestIdMiddleware          ← must be first
helmet()                     ← security headers
cors()
morgan()                     ← request logging
express.json()               ← parse JSON bodies
express.urlencoded()         ← parse HTML form bodies (required for OAuth login form)
GET /api/health              ← public, no auth
registerOAuthDiscovery()     ← /.well-known/oauth-authorization-server
GET /.well-known/oauth-protected-resource   ← must be before static files
GET /.well-known/oauth-protected-resource/mcp
app.use('/oauth', oauthRouter)   ← public, no JWT auth
app.use('/mcp', mcpRouter)       ← Bearer token auth (not JWT)
app.use('/api', apiRouter)       ← JWT auth applied inside apiRouter
express.static(webDistPath)      ← SPA static files — MUST be last
GET * → index.html               ← SPA fallback — MUST be very last
errorHandler                     ← must be last middleware
```

### OAuth flow — detailed sequence

```
1. Claude → POST /mcp (no token)
   ← 401 Unauthorized

2. Claude → GET /.well-known/oauth-protected-resource
   ← { authorization_servers: ["https://your-domain"] }

3. Claude → GET /.well-known/oauth-authorization-server
   ← { authorization_endpoint: "https://your-domain/oauth/authorize",
        token_endpoint: "https://your-domain/oauth/token", ... }

4. Claude redirects user's browser →
   GET /oauth/authorize?client_id=luca_xxx&redirect_uri=https://claude.ai/...
                        &code_challenge=<S256>&code_challenge_method=S256
                        &state=<random>&scope=ledger:read+ledger:write
   ← HTML login page (self-contained, no JS framework)

5. User submits form →
   POST /oauth/authorize (application/x-www-form-urlencoded)
   body: client_id, redirect_uri, state, code_challenge,
         code_challenge_method, scope, email, password
   ← 302 Redirect to https://claude.ai/...?code=<auth_code>&state=<state>

6. Claude → POST /oauth/token
   body: grant_type=authorization_code, code=<auth_code>,
         client_id=luca_xxx, redirect_uri=..., code_verifier=<verifier>
   ← { access_token: "<raw_token>", token_type: "Bearer" }

7. Claude → POST /mcp
   Authorization: Bearer <raw_token>
   body: { "jsonrpc": "2.0", "method": "initialize", ... }
   ← { "jsonrpc": "2.0", "result": { "protocolVersion": "2024-11-05", ... } }

8. Claude → POST /mcp
   body: { "method": "tools/list" }
   ← { "result": { "tools": [...50 tools...] } }
```

### Database tables added for OAuth

| Table | Purpose |
|---|---|
| `oauth_clients` | Registered OAuth clients. `client_secret_hash` is bcrypt. `redirect_uris` is a PostgreSQL `text[]` array. |
| `oauth_authorization_codes` | Single-use codes with 10-minute TTL. PKCE fields stored for verification at token exchange. |
| `oauth_access_tokens` | Issued Bearer tokens. `token_hash` is SHA-256 of the raw token. `expires_at` is NULL for long-lived connector tokens. |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `production` in Docker |
| `PORT` | No | API port (default 3000) |
| `BASE_URL` | Yes | Full public URL e.g. `https://gl.tbv-3pl.com` — used in OAuth discovery responses |
| `JWT_SECRET` | Yes | Signs JWT tokens for web UI sessions |
| `JWT_EXPIRES_IN` | No | JWT lifetime (default `24h`) |
| `POSTGRES_DB` | No | Database name (default `gl_ledger`) |
| `POSTGRES_USER` | No | DB username (default `gl_admin`) |
| `POSTGRES_PASSWORD` | Yes | DB password |
| `CHAIN_DIR` | No | Chain file directory inside container (default `/data/chains`) |
| `ESCALATION_HOURS` | No | Hours before pending approvals escalate (default `48`) |
| `LOG_LEVEL` | No | Logging verbosity (default `info`) |

### Known issues and fixes applied

**`curl | bash` stdin problem (install.sh)**
When piping via `curl | bash`, stdin is the pipe (the script), not the
keyboard. Every `read` prompt received empty string immediately.
Fix: all `read` commands use `</dev/tty` to read from the keyboard.

**`set -euo pipefail` unbound variable crash**
Variables used conditionally (TOKEN, CLIENT_ID, etc.) must be initialised
before use. Fix: `TOKEN_RESPONSE=""` etc. before any curl calls.

**`cd` into directory before `rm -rf` (install.sh overwrite)**
The script `cd`'d into `INSTALL_DIR` to run `docker compose down`, then
deleted the directory. The shell's cwd no longer existed on disk, and
`git clone` failed with "Unable to read current working directory".
Fix: use `docker compose -f "$INSTALL_DIR/docker-compose.yml" down` and
`cd /tmp` before `rm -rf`.

**`docker-compose.yml version` attribute warning**
Docker Compose v2 ignores the top-level `version:` field and emits a warning.
Fix: remove `version: '3.8'` from both `docker-compose.yml` and
`docker-compose.dev.yml`.

**`express.urlencoded()` missing — OAuth form POST body empty**
The OAuth login form submits as `application/x-www-form-urlencoded` but the
server only had `express.json()`. `req.body` was always `{}` so `client_id`
was undefined and every login failed with "Invalid client."
Fix: add `app.use(express.urlencoded({ extended: true }))` in server.ts,
after `express.json()`.

**Invalid dummy bcrypt hash**
The timing-safe dummy hash used when an email is not found was too short
(52 chars; bcrypt requires 60). `bcrypt.compare` threw an exception which
was not caught, silently failing the login.
Fix: use a valid 60-char bcrypt hash; wrap `bcrypt.compare` in try/catch.

**Empty `updateUser({})` call in change-password endpoint**
A leftover stub call `updateUser(id, {})` fired before the actual
`db('users').update({ password_hash })`, causing a Knex error ("Empty .update()
call detected").
Fix: remove the stub call entirely.

**`/.well-known/oauth-protected-resource` returning SPA HTML**
This route was not registered before `express.static()`, so requests
were served the React `index.html` instead of the required JSON.
Fix: register all `/.well-known/` routes in server.ts before the
`express.static()` call.

**Frontend had no authentication layer**
All routes were public, API calls had no token, 401 errors showed as
"Error: Authentication required" inline rather than redirecting to login.
Fix: added `AuthContext.tsx` (token management, login/logout),
`Login.tsx` page, `ProtectedRoute.tsx` guard, updated `useApi.ts` to
inject `Authorization: Bearer` header and dispatch `luca:unauthorized`
events on 401, wrapped all routes in App.tsx with `ProtectedRoute`.
