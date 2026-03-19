# Stack Research

**Domain:** DJ Roster Management App — v2.0 DJ Management & Supabase Consolidation
**Researched:** 2026-03-19
**Confidence:** HIGH (all findings verified against installed package-lock.json, Node.js official docs, and existing project patterns)

---

## Scope

This is a SUBSEQUENT MILESTONE research file. It covers only what is NEW for v2.0. The existing stack (Node.js/Express, @supabase/supabase-js, bcrypt, helmet, express-rate-limit, Jest) is validated and unchanged.

**New capabilities needed:**
1. Supabase schema migration for the consolidated `djs` table
2. Admin CRUD UI patterns (Manage DJs tab) in vanilla JS
3. Account lockout persistence to Supabase
4. Webhook signature verification
5. Consistent Supabase error handling

---

## Recommended Stack

### Core Technologies (NEW additions)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js built-in `crypto` | built-in (no install) | Webhook HMAC-SHA256 signature verification | Already available in every Node.js runtime; `createHmac` + `timingSafeEqual` is the canonical pattern per Node.js docs. Zero dependency overhead, timing-safe comparison prevents timing attacks. |
| Plain SQL migration scripts | n/a | `djs` table creation, dj_rates + dj_pins consolidation | Project already uses `.sql` files run in Supabase SQL Editor (see `scripts/migrate-availability-timestamps.sql`). Consistent with established pattern. No new tooling to learn or maintain. |
| Plain Node.js migration scripts | n/a | One-time data migration from dj_rates + dj_pins into `djs` | Project already uses this pattern (see `scripts/hash-existing-pins.js`). `@supabase/supabase-js` + `dotenv` already installed — no additions needed. |

### No New npm Dependencies Required

All four new feature areas can be implemented with existing installed packages:

| Feature | Implementation | Packages Used |
|---------|---------------|---------------|
| `djs` table schema | SQL in Supabase SQL Editor | None (schema change, not code) |
| Data migration (dj_rates + dj_pins → djs) | `scripts/migrate-to-djs.js` Node script | `@supabase/supabase-js` ^2.99.1, `dotenv` (already installed) |
| Admin CRUD (Manage DJs tab) | `fetch()` calls + `innerHTML` in roster.html | None (vanilla JS, existing pattern) |
| Account lockout persistence | Supabase `dj_login_attempts` table + existing client | `@supabase/supabase-js` ^2.99.1 (already installed) |
| Webhook signature verification | `require('node:crypto')` in server.js | Node.js built-in |
| Supabase error handling | try/catch wrapper pattern, check `error` on every call | None |

---

## Supporting Libraries

No new supporting libraries needed for v2.0.

The existing `@supabase/supabase-js` at **2.99.1** (installed, confirmed in package-lock.json) provides:
- `.from().select/insert/update/upsert/delete()` — all CRUD needed for `djs` table and `dj_login_attempts`
- `.from().upsert()` with `onConflict` — correct pattern for lockout upsert (already used for dj_availability)
- Full error objects on every call (`const { data, error } = await supabase.from(...)`)

---

## Development Tools

No new dev tools needed. Existing Jest ^30.3.0 covers testing.

---

## Installation

No new packages to install for v2.0.

```bash
# No npm install required — all needed packages already in dependencies
# Existing stack handles all new features
```

---

## Alternatives Considered

### Schema Migration Tooling

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Plain `.sql` + Node.js scripts (existing pattern) | Supabase CLI (`supabase migration`) | Supabase CLI adds local Docker dev environment, supabase link/push workflow — heavy setup overhead for a solo-deployed `node server.js` app on port 8080. Overkill for 1-2 table changes. Existing `.sql` + SQL Editor pattern already works and the team knows it. |
| Plain `.sql` + Node.js scripts | Knex.js migrations | Knex adds a dependency, migration tracking table, and its own CLI. For a project that directly uses Supabase's REST client (not a raw DB connection), there's no benefit — Supabase SQL Editor is already the migration surface. |
| Plain `.sql` + Node.js scripts | db-migrate | Same objection as Knex — adds tooling overhead without value given the Supabase-hosted setup. |

### Webhook Verification

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Node.js built-in `crypto` | `jsonwebtoken` | JWT is for authentication tokens, not HMAC webhook signatures. Wrong abstraction. |
| Node.js built-in `crypto` | `crypto-js` npm package | Pure overhead — Node.js built-in `crypto` is faster (native bindings), already available, and is the standard recommendation. Never add a library when the built-in does the job. |

### Account Lockout Persistence

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Supabase `dj_login_attempts` table | Redis | Redis adds a separate service to run and maintain. For 10-20 DJs, Supabase is sufficient and already the authoritative store. |
| Supabase `dj_login_attempts` table | Keep in-memory Map | Explicitly called out in PROJECT.md as a requirement to fix — restarts lose lockout state, which is a security gap. |

### Admin CRUD UI

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Vanilla JS `fetch()` + `innerHTML` (existing pattern) | React/Vue component | The entire 1,982-line `roster.html` is vanilla JS. Introducing a framework for one new tab creates a split-stack maintenance burden with no payoff. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Supabase CLI for migrations | Requires Docker, local Supabase project, `supabase link` — full local environment setup not warranted for a simple hosted project with occasional schema changes | SQL files run in Supabase SQL Editor + Node.js migration scripts (established pattern) |
| `crypto-js` npm package | Adds unnecessary dependency for HMAC operations already covered by Node.js built-in `crypto` | `require('node:crypto')` — `createHmac('sha256', secret).update(payload).digest('hex')` + `timingSafeEqual` |
| ORM (Prisma, Drizzle, Typeorm) | Project uses Supabase REST client directly. Adding an ORM creates a dual-access pattern and migration conflict with Supabase SQL Editor. Heavy for a 7-table schema. | Direct `@supabase/supabase-js` calls (already installed) |
| `express-async-errors` | Solves uncaught promise rejections in Express routes — but project already handles this with per-route try/catch. Adding a global handler after the fact risks masking intentional error paths. | Per-route try/catch (already partially implemented, needs to be made consistent) |

---

## Stack Patterns by Variant

**For the `djs` table schema migration:**
- Use two files: `scripts/migrate-djs-schema.sql` (CREATE TABLE, column definitions, constraints) and `scripts/migrate-djs-data.js` (copy data from dj_rates + dj_pins → djs, verify row counts, then drop old tables)
- Because the project already has this exact split pattern (SQL for schema, Node.js for data transforms)

**For account lockout persistence:**
- Table: `dj_login_attempts` with columns `(dj_name TEXT PRIMARY KEY, failed_count INT DEFAULT 0, locked_until TIMESTAMPTZ)`
- Use `upsert({ onConflict: 'dj_name' })` — same pattern as `dj_availability` upserts already in production
- On server startup: load active lockouts into the in-memory Map from Supabase (hybrid approach — fast reads from memory, persistence from DB)
- Because: pure DB lockout adds a Supabase round-trip to every login attempt; hybrid keeps the fast path while surviving restarts

**For webhook signature verification:**
- Use `express.raw({ type: 'application/json' })` on the webhook route specifically (NOT `express.json()`) so the raw body is preserved for HMAC computation
- Because: `express.json()` parses the body before the route handler runs, making the original bytes unavailable — HMAC must be computed against the raw bytes

**For Supabase error handling:**
- Pattern: `const { data, error } = await supabase.from(...); if (error) { console.error('[context]:', error.message); return res.status(500).json({ success: false, error: 'DB error' }); }`
- Do NOT expose `error.message` to clients in production — log it server-side, return a generic message
- Because: Supabase error messages can include table names, column names, and constraint details that reveal schema

---

## Version Compatibility

| Package | Installed Version | Compatible With | Notes |
|---------|-------------------|-----------------|-------|
| `@supabase/supabase-js` | 2.99.1 | Node.js >=20.0.0 (per package-lock.json engines field) | Already installed and working in production. No upgrade needed for v2.0 features. |
| `bcrypt` | ^6.0.0 | Node.js >=20 | Used for PIN hashing — no changes needed for v2.0 (`djs` table still stores `pin_hash`). |
| Node.js built-in `crypto` | Available in all Node.js LTS versions | All Node.js >=12 | `createHmac` and `timingSafeEqual` are stable APIs. No version concerns. |

---

## Integration Points

### `djs` Table Shape (Informed by What Gets Migrated)

The new `djs` table consolidates:
- `dj_rates`: `name`, `rate`, `type` (resident/guest)
- `dj_pins`: `name`, `pin` (hash)
- Hardcoded `RESIDENTS` array in `business-logic.js`
- Hardcoded `FIXED_SCHEDULES` in `business-logic.js` (per-DJ venue/weekday/slot assignments)
- Hardcoded `FIXED_AVAILABILITY` in `server.js` (per-DJ default availability slots)

New columns needed: `name TEXT PRIMARY KEY`, `pin_hash TEXT`, `rate NUMERIC`, `dj_type TEXT`, `is_active BOOLEAN DEFAULT true`, `venues TEXT[]`, `recurring_availability JSONB`, `fixed_schedule JSONB`

### `dj_login_attempts` Table Shape

`dj_name TEXT PRIMARY KEY`, `failed_count INT DEFAULT 0`, `locked_until TIMESTAMPTZ`

### Webhook Route Pattern

```javascript
// IMPORTANT: Use express.raw() on webhook routes, not express.json()
app.post('/api/webhooks/some-hook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const { createHmac, timingSafeEqual } = require('node:crypto');
    const sig = req.headers['x-webhook-signature'] || '';
    const expected = createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(req.body) // raw Buffer
      .digest('hex');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    // process webhook...
  }
);
```

Note: The global `app.use(express.json())` at line 107 of server.js is fine — webhook routes must be registered BEFORE or use route-specific `express.raw()` middleware that overrides the global parser for that route.

---

## Sources

- `C:/Users/gusno/dj-roster/package-lock.json` — `@supabase/supabase-js` 2.99.1 confirmed installed (HIGH confidence)
- `C:/Users/gusno/dj-roster/server.js` — existing lockout Map, FIXED_SCHEDULES, FIXED_AVAILABILITY patterns reviewed directly (HIGH confidence)
- `C:/Users/gusno/dj-roster/scripts/migrate-availability-timestamps.sql` — established SQL migration pattern confirmed (HIGH confidence)
- `C:/Users/gusno/dj-roster/scripts/hash-existing-pins.js` — established Node.js data migration pattern confirmed (HIGH confidence)
- Node.js v25.8.1 official docs (`nodejs.org/api/crypto.html`) — `createHmac`, `timingSafeEqual` confirmed available and documented (HIGH confidence)
- `.planning/PROJECT.md` — feature requirements for v2.0, existing constraints, key decisions (HIGH confidence)

---

*Stack research for: DJ Roster App v2.0 — DJ Management & Supabase Consolidation*
*Researched: 2026-03-19*
