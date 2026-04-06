# OAuth Debugging Journal — Claude MCP Connector

**System:** Luca General Ledger v1.0
**Domain:** https://gl.tbv-3pl.com
**Goal:** Connect Luca to Claude via the "Add custom connector" dialog using OAuth 2.0 Authorization Code + PKCE flow
**Status:** ❌ Unresolved — auth codes are issued and redirected to Claude but POST /oauth/token is never called

---

## The Intended Flow

```
1. User opens Claude → Customize → Connectors → Add connector
2. User enters MCP Server URL: https://gl.tbv-3pl.com/mcp
3. Claude fetches GET /mcp → 401 with WWW-Authenticate header
4. Claude reads WWW-Authenticate → discovers resource_metadata URL
5. Claude fetches /.well-known/oauth-protected-resource → gets authorization_servers list
6. Claude fetches /.well-known/oauth-authorization-server → gets authorization_endpoint + token_endpoint
7. Claude redirects user's browser to /oauth/authorize with client_id, PKCE code_challenge, state, resource
8. User sees Luca login page → enters credentials → submits form
9. Luca validates credentials → issues auth code → 302 redirects to https://claude.ai/api/mcp/auth_callback?code=...&state=...
10. Claude's backend calls POST /oauth/token with code + code_verifier → receives Bearer token
11. Claude stores token and uses it for all subsequent POST /mcp calls
```

---

## The Problem

**Step 9 completes successfully. Step 10 never happens.**

The authorization code is issued and the user's browser is redirected to Claude's callback URL. Claude's backend never calls `POST /oauth/token`. There is no record of any token endpoint request in nginx access logs or application logs.

The result: the OAuth window either reloads (prompting the user to log in again) or the connector shows as failed.

---

## Evidence

### What DOES work
- `GET /.well-known/oauth-authorization-server` → returns correct JSON
- `GET /.well-known/oauth-protected-resource` → returns correct JSON
- `GET /oauth/authorize` → renders login form correctly
- `POST /oauth/authorize` → validates credentials, issues auth code, 302 redirect fires
- Authorization codes ARE created in the `oauth_authorization_codes` DB table
- Codes remain `used = false` (never consumed)
- No access tokens are ever created in `oauth_access_tokens`

### What NEVER appears in logs
```
POST /oauth/token
```
Not in nginx access logs. Not in application logs. Claude's servers never attempt to reach this endpoint.

### Confirmed working separately
```bash
# Direct curl test of token endpoint — returns correct error (no PKCE verifier), proving endpoint works
curl -s -X POST https://gl.tbv-3pl.com/oauth/token \
  -d "grant_type=authorization_code&code=test&client_id=test&redirect_uri=https://claude.ai/api/mcp/auth_callback"
# → {"error":"invalid_grant","error_description":"Authorization code not found or expired"}
```

### Sample successful authorize redirect (from app logs)
```
[oauth] Redirecting to callback: https://claude.ai/api/mcp/auth_callback?code=9e460d2719e88753a5d6622c2928902d071f2957a8336f46e39573df600bb667&iss=https%3A%2F%2Fgl.tbv-3pl.com&state=VhXC6lSN5F7vrHoQ3wnNo5YBZgVP81fDlF9VwzBpNVs
```

---

## Root Causes Found and Fixed (Chronologically)

### Fix 1 — `express.urlencoded()` missing
**Symptom:** Login form POST to `/oauth/authorize` returned "Invalid client." immediately.
**Cause:** `express.urlencoded({ extended: true })` was not registered in `server.ts`. The HTML form POST body was never parsed — `req.body` was always `{}`.
**Fix:** Added `app.use(express.urlencoded({ extended: true }))` in `server.ts`.

---

### Fix 2 — No try/catch on async route handlers (Express 4)
**Symptom:** Submitting the login form caused the page to silently reload with no error shown.
**Cause:** Express 4 silently drops rejected promises from async route handlers. Any thrown error (including bcrypt exceptions) caused the handler to hang with no response.
**Fix:** Wrapped all async OAuth handlers in `try/catch` blocks.

---

### Fix 3 — Invalid dummy bcrypt hash
**Symptom:** Even with try/catch, bcrypt.compare threw an exception on the "user not found" timing-safe path.
**Cause:** The dummy hash used for constant-time comparison was 52 characters. bcrypt requires exactly 60 characters and throws on malformed hashes.
**Fix:** Replaced with a valid 60-character bcrypt hash.

---

### Fix 4 — `resource` parameter not preserved through the login form
**Symptom:** 302 redirect fired but POST /oauth/token was never called.
**Cause:** Claude includes a `resource` parameter (RFC 8707) in the GET /oauth/authorize URL. This was not being extracted and passed into the hidden form fields on the login page. When the form POSTed, `resource` was absent. We were not including it in the redirect back to Claude. Claude's callback handler may have rejected the code because the resource binding was missing.
**Fix:** Added `resource` to the GET handler query extraction, the login page hidden fields, and the `oauthParams()` helper function.

---

### Fix 5 — Well-known routes returning SPA HTML (591 bytes)
**Symptom:** `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` returned the React SPA's `index.html` (591 bytes) instead of JSON.
**Cause:** These routes were registered in `server.ts` AFTER `express.static()`. The static file middleware was intercepting any GET request that didn't match a real file and serving `index.html` via the SPA fallback handler.
**Fix:** Moved all well-known routes, OAuth routes, and MCP routes to be registered BEFORE `express.static()`.

---

### Fix 6 — `iss` parameter missing from authorization response (RFC 9207)
**Symptom:** POST /oauth/token still never called after fix 4.
**Hypothesis:** The MCP OAuth spec and RFC 9207 require the authorization server to include an `iss` (issuer identifier) parameter in the redirect back to the client. Without it, a strict client (like Claude) may silently reject the authorization code.
**Fix Applied:** Added `callbackUrl.searchParams.set('iss', config.baseUrl)` to the redirect, and added `authorization_response_iss_parameter_supported: true` and `token_endpoint_auth_methods_supported` to the discovery document.
**Result:** ❌ No change — POST /oauth/token still never called.

---

## Current State of oauth.ts

### Discovery document (`/.well-known/oauth-authorization-server`)
```json
{
  "issuer": "https://gl.tbv-3pl.com",
  "authorization_endpoint": "https://gl.tbv-3pl.com/oauth/authorize",
  "token_endpoint": "https://gl.tbv-3pl.com/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
  "authorization_response_iss_parameter_supported": true,
  "scopes_supported": ["ledger:read", "ledger:write"]
}
```

### Protected resource metadata (`/.well-known/oauth-protected-resource`)
```json
{
  "resource": "https://gl.tbv-3pl.com",
  "authorization_servers": ["https://gl.tbv-3pl.com"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["ledger:read", "ledger:write"]
}
```

### Authorization redirect (what we send back to Claude)
```
https://claude.ai/api/mcp/auth_callback
  ?code=<64-char hex>
  &iss=https%3A%2F%2Fgl.tbv-3pl.com
  &state=<Claude's state value echoed back>
```

### WWW-Authenticate header on POST /mcp 401 response
```
Bearer realm="https://gl.tbv-3pl.com",
       scope="ledger:read ledger:write",
       resource_metadata="https://gl.tbv-3pl.com/.well-known/oauth-protected-resource"
```

---

## Key Observations

1. **Double submissions** — Each time the user attempts to connect, the login form is submitted twice in quick succession (1 second apart, with different state values). This suggests Claude re-initiates the OAuth flow after receiving the callback, rather than exchanging the code. It is not a user double-click.

2. **No nginx entry at all** — There is zero record of any token endpoint request in nginx access logs. This means either: (a) Claude's backend is not attempting the call, or (b) the request is somehow blocked before reaching nginx. Given our server is publicly accessible and Claude's authorization requests do reach us, (a) is more likely.

3. **Token endpoint is publicly reachable** — Direct curl tests from external machines confirm the endpoint responds correctly.

4. **Claude's UI behaviour** — After submitting credentials and getting the redirect, the OAuth window/flow restarts (user is prompted to log in again), rather than Claude showing "Connected" or an error message.

---

## Hypotheses Not Yet Tested

### H1 — Dynamic Client Registration (RFC 7591) required
Claude's MCP connector spec may require authorization servers to support dynamic client registration. Before redirecting the user, Claude might attempt `POST /oauth/register` to register itself as a client. If this fails or is absent, Claude might fall back to a broken state.

**To test:** Check nginx logs for any `POST /oauth/register` requests when a new connector is added. Add a dynamic registration endpoint.

### H2 — Claude uses a different token endpoint discovery mechanism
Instead of `/.well-known/oauth-authorization-server`, Claude might resolve the token endpoint differently — e.g. from a `Link` header on the MCP server response, or from a different metadata path.

**To test:** Check what headers GET /mcp and POST /mcp return, and whether Claude might be expecting a `Link: <...>; rel="oauth-authorization-server"` header.

### H3 — Token exchange is browser-side but a CORS preflight is failing silently
If Claude's callback page uses client-side JavaScript to call POST /oauth/token (rather than server-side), a CORS preflight failure would prevent the request from ever appearing in nginx logs.

**To test:** Open browser DevTools → Network tab → retry the OAuth flow → look for any OPTIONS or POST requests to gl.tbv-3pl.com after the callback redirect.

### H4 — `resource` parameter must be reflected in the token endpoint response
RFC 8707 says the issued token should be bound to the `resource`. Claude might expect the token response to include a `resource` field confirming the binding. Without it, Claude might silently discard the token.

**To test:** N/A yet — the token endpoint is never called, so the response format is not the current issue.

### H5 — Connector type mismatch
The Claude "Add custom connector" dialog might expect a different setup. Perhaps Luca should be configured as a "remote MCP server" rather than a custom OAuth connector, or the MCP URL format needs to be different (e.g. with or without trailing slash, with `/mcp` suffix or without).

**To test:** Try different URL formats in Claude's connector dialog. Try without `/mcp` suffix. Try with trailing slash.

### H6 — Claude requires a specific client_id format or pre-registration
Our client IDs are `luca_` + 12 random bytes hex (e.g. `luca_feef57f8c16ac171477a67af`). Claude might require a UUID format or a specific registration process.

**To test:** Generate a UUID-format client ID and test.

---

## Alternative Approaches to Consider

### Option A — Use a third-party OAuth proxy
Deploy an OAuth proxy (e.g. oauth2-proxy, Authentik, Keycloak) in front of the MCP server. These are battle-tested implementations that Claude is more likely to be compatible with.

### Option B — Implement RFC 7591 Dynamic Client Registration
Add `POST /oauth/register` endpoint so Claude can self-register. The discovery document would advertise `registration_endpoint`. This is commonly required by MCP-compatible auth servers.

### Option C — Use a managed OAuth provider (Auth0, Clerk, Supabase Auth)
Replace the custom OAuth server with a managed provider that already has Claude connector compatibility. The MCP server would validate tokens issued by the external provider.

### Option D — Use API key authentication instead of OAuth
Claude connectors may support simpler Bearer token authentication where the user pastes a static API key rather than going through the full OAuth dance. This sidesteps the OAuth server entirely.

### Option E — Deploy using an existing open-source MCP auth server
Use an existing MCP-compatible auth implementation as reference or as a drop-in, rather than the custom implementation.

---

## Server Details

| Item | Value |
|------|-------|
| Domain | https://gl.tbv-3pl.com |
| Server | Ubuntu 22/24 VPS |
| Stack | Node 20 + Express + PostgreSQL 16 in Docker |
| MCP URL | https://gl.tbv-3pl.com/mcp |
| Token endpoint | https://gl.tbv-3pl.com/oauth/token |
| Auth server | https://gl.tbv-3pl.com |
| Client IDs | Generated in UI under Admin → Co-Work Credentials |

---

*Last updated: 2026-04-05*
