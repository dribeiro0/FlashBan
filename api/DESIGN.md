# Report API design

Owner: @sysoutprntlne. Planning draft, November 6, 2026. Not built yet. Endpoints and shapes come from [docs/CONTRACTS.md section 5](../docs/CONTRACTS.md); this file adds how they are validated, limited, stored and counted. Threat numbers refer to [security/THREAT_MODEL.md](../security/THREAT_MODEL.md).

## Stack

**Node.js 20+ with the built-in `node:http` module and no runtime dependencies.**

- The rest of the project is JavaScript and already tests with `node --test`, so the API uses the same language, test runner and review habits.
- Zero dependencies means nothing to pin or audit and no install step at the demo (T12). The API is two endpoints; Express or FastAPI would add more surface than code.
- Run: `node api/server.js` (default `127.0.0.1:8787`). Config through environment variables with safe defaults; the API needs no secrets.

Planned files: `api/server.js` (HTTP, routing, limits), `api/validate.js` (pure validation), `api/store.js` (counting and listing), `api/test/*.test.mjs`.

## `POST /api/reports`

Request body (contract section 5):

```json
{ "v": 1, "install": "random-uuid-per-install", "domain": "example.com", "source": "video", "flashesPerSecond": 7.5, "areaPct": 0.42, "red": false, "at": 1731000000000 }
```

Order of checks, cheapest first. The first failure returns.

1. **Method and path.** Only `POST /api/reports` and `GET /api/domains`; anything else is 404 (wrong method on a known path: 405).
2. **Rate limit** by client IP: 429 with `Retry-After`. Done before reading the body.
3. **Content-Type** must be `application/json`: otherwise 415. *(Not in the contract; see "Contract questions".)*
4. **Size.** If `Content-Length` is over 2048 bytes, 413 without reading. While streaming, stop and return 413 as soon as 2048 bytes are exceeded (covers chunked bodies with no length). Body read timeout 5 s.
5. **Parse.** `JSON.parse` in a `try`; invalid JSON is 400. The top level must be a plain object.
6. **Schema.** Exactly these keys, all required, no others (unknown key is 400):

| Field | Rule |
|---|---|
| `v` | exactly `1` |
| `install` | string, UUID v4 format (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`), stored lowercased |
| `domain` | string, at most 253 chars, lowercased; matches `^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$` (at least two labels, each 1 to 63 chars, no leading or trailing hyphen, alphabetic TLD). That rejects IP literals, `localhost`, ports, paths, schemes, userinfo and query strings (T11). Punycode (`xn--`) is allowed; raw Unicode is not. |
| `source` | one of `video`, `canvas`, `css`, `gif`, `dom` (same set as contract section 3) |
| `flashesPerSecond` | finite number, 0 to 60 |
| `areaPct` | finite number, 0 to 1 |
| `red` | boolean |
| `at` | integer ms; within 24 h in the past and 5 min in the future of server time, otherwise 400. Kept only for information: every time window uses the **server's** receive time, so a client can't backdate or pre-date reports. |

7. **Per-install limit** (below): over the limit is 429.
8. **Store** and return **202** with an empty body.

Errors return `{"error": "<short code>"}` (for example `"unknown_field"`, `"too_large"`) and never echo the input back. No stack traces in responses.

## `GET /api/domains`

Returns the contract section 5 shape:

```json
{ "v": 1, "updated": 1731000000000, "domains": [ { "domain": "example.com", "severity": "block", "reports": 12, "installs": 5, "lastSeen": 1731000000000 } ] }
```

- The list is rebuilt when a report is stored (or at most once a second) and cached. GET serves the cache, so it costs nothing per request. It is sent with `Cache-Control: max-age=60` and an `ETag`; a matching `If-None-Match` returns 304.
- Sorted by `installs` descending, then `domain`. Capped at 5000 entries.
- Same IP rate limit as POST, with a higher budget.

## Distinct-install threshold (T9)

A domain is listed only when **at least N = 3 distinct installs** have reported it **in the last 7 days**. N and the window come from env (`LIST_MIN_INSTALLS`, `LIST_WINDOW_DAYS`), defaulting to the contract values.

How "distinct" is counted:

1. For each domain the store keeps, per install, only the **latest** report (its server time, metrics and network bucket). Repeat reports from one install refresh that row instead of adding weight, so one install counts once however many times it reports.
2. Each install is tagged with a **network bucket**: the client IP truncated to /24 for IPv4 or /48 for IPv6, then hashed with HMAC-SHA256 under a random key generated at startup and kept only in memory. Raw IPs are never stored.
3. `installs` = the number of installs with a report inside the window. **Qualifying installs** = the number of distinct network buckets among them. The domain is listed when qualifying installs ≥ N. So one attacker on one network who invents 50 install ids still counts once.
4. `reports` = total reports for the domain in the window (information only).
5. `lastSeen` = server time of the newest report.
6. `severity` = `"block"` when at least half of the qualifying installs reported `flashesPerSecond > 3` or `red: true`; otherwise `"warn"`.
7. Rows older than the window are pruned on write and every 10 minutes.

Limit of this defense (say so in the pitch): install ids are self-chosen, so an attacker with addresses on 3 or more different networks can still get a domain listed. The extension only treats a listed domain as "start in strict guarded mode", never as "block the whole site", which keeps the damage from a poisoned entry small.

## Rate limits (T10)

All in memory, as token buckets.

| Key | Budget | Applies to |
|---|---|---|
| Client IP | 30 requests per minute, burst 10 | POST |
| Client IP | 120 requests per minute | GET |
| Install id | 1 report per domain per 10 minutes; 100 reports per day | POST, checked after validation |
| Global | 50 requests per second, then 503 | everything |

When the IP bucket table passes 10,000 keys, the oldest are dropped. The rate limit uses the TCP peer address and ignores `X-Forwarded-For` unless `TRUST_PROXY=1`, so a client can't spoof its way around the limit.

## Storage

In memory (`Map`s), with an optional JSON snapshot written every 30 s and on shutdown to `api/data/store.json` (path from `DATA_FILE`, and `api/data/` is gitignored). It holds install id, domain, metrics, server time and the network bucket hash, nothing else. That is enough for a weekend demo. SQLite would be the next step if the API outlived the event.

Memory caps: 10,000 domains and 50 installs kept per domain (the newest). A full table refuses new domains with 503 rather than growing.

## HTTP hardening

- CORS: `POST` allows only the extension origin from `ALLOWED_ORIGIN` (`chrome-extension://<id>`). `GET` allows any origin, since the list is public. No credentials. The preflight allows `POST` with the `Content-Type` header only.
- Headers on every response: `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` (except the GET list), `Content-Security-Policy: default-src 'none'`.
- Server timeouts: headers 5 s, request 10 s, keep-alive 5 s, at most 200 open connections.
- Logs: method, path, status and duration only. No bodies, IPs or install ids.

## Tests (Saturday)

`node --test api/test/`, covering: a valid report gets 202; every field missing, wrong type, out of range, or an extra key gets 400; bad domains (`localhost`, `1.2.3.4`, `a.com/path`, `-a.com`, 254 chars, `exa mple.com`) get 400; a body of 2049 bytes gets 413 both with and without `Content-Length`; IP and install limits get 429; `at` too old or too new gets 400; listing appears at 3 distinct networks, not at 3 installs on one network, and drops off after 7 days (with an injected clock); severity rule; GET returns 304 on a matching `ETag`.

## Contract questions (for @DxubleBTW, not changed)

1. **415 for a non-JSON `Content-Type`.** The contract lists 202/400/413/429. I can use 400 instead to stay inside it; preference?
2. **The plan says reports are "signed", but the contract has no signature field.** A key built into the extension can be extracted, so a signature would add no real protection. I propose dropping "signed" from `PROJECT_PLAN.md` section 4.6 and relying on the network-bucket counting above.
3. **Contest path.** The plan mentions that a listed domain can be contested. I propose this is out of scope for the weekend and listed as future work, unless you want an endpoint.
4. **How the extension uses the list.** Listed means "start that domain in strict guarded mode" (plan section 4.6). Confirm that `severity` from the list doesn't trigger anything stronger.
