# Feature Research

**Domain:** Admin DJ Management UI, Recurring Availability System, Database-Driven Configuration
**Researched:** 2026-03-19
**Confidence:** HIGH (based on direct codebase analysis)

## Context

This is a subsequent milestone. The app is live and in production. All features below are additions or
replacements for existing functionality — not greenfield work. The baseline is:

- `dj_rates` table: name, rate
- `dj_pins` table: name, bcrypt PIN hash
- `FIXED_AVAILABILITY` hardcoded in server.js (8 DJs, day-of-week slot arrays)
- `FIXED_SCHEDULES` hardcoded in lib/business-logic.js (venue/day/slot object for Davoted)
- `RESIDENTS` hardcoded in lib/business-logic.js (3 names)
- `DIAG_FIXED_TEMPLATE` hardcoded in lib/business-logic.js (large inline roster template)
- Edit modal in DJ Hours tab: name and rate only, no add/deactivate/PIN reset
- Account lockout: in-memory Map, lost on server restart, not visible to admins
- No webhook signature verification
- Supabase error handling: mixed — some routes have try-catch, others rely on throw propagation

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are the core deliverables of this milestone. Missing any = milestone is incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Consolidated `djs` table | dj_rates + dj_pins split is a liability — auth and roster both query separately; consolidation is prerequisite for all other features | MEDIUM | Schema: id, name, pin_hash, rate, type (resident/guest), active (bool), venues (array or separate cols), recurring_availability (jsonb), fixed_schedules (jsonb). Migration: INSERT INTO djs SELECT, then update PIN hash from dj_pins. Clean cutover, no dual-write. |
| Add DJ from admin UI | DJs join the pool over time; currently requires direct DB insertion | LOW | Requires: name (required), rate (required), type (resident/guest), initial PIN (required — admin sets it, DJ given it). Active defaults true. |
| Edit DJ name + rate in Manage DJs tab | Already exists in DJ Hours tab — must be moved/consolidated, not duplicated | LOW | Remove edit button from DJ Hours tab. Same modal can be surfaced from Manage DJs table. |
| Edit recurring availability per DJ in admin UI | `FIXED_AVAILABILITY` is hardcoded for 8 DJs — any change requires a code deploy; admin-editable means no deploy needed | HIGH | FIXED_AVAILABILITY is a nested object: day-of-week (0–6) → array of slot strings. UI needs a day-of-week grid with slot checkboxes. Store as JSONB in `djs`. |
| Edit fixed schedules per DJ in admin UI | `FIXED_SCHEDULES` is hardcoded (Davoted only) — adding a second DJ requires code change | HIGH | FIXED_SCHEDULES is nested: venue → day-of-week → array of slots. UI needs venue tabs + day-of-week grid + slot checkboxes. Store as JSONB in `djs`. |
| Reset DJ PIN from admin UI | No current mechanism — requires direct DB edit | LOW | Admin generates new 4-digit PIN, bcrypt hash it server-side (cost 10), update `djs.pin_hash`. Return plaintext PIN to admin once, never store it. |
| Deactivate / reactivate DJ | No current mechanism — requires direct DB edit | LOW | Set `djs.active = false`. Deactivated DJs: excluded from `/api/djs`, excluded from auto-suggest, cannot log in (auth check active flag), historical data preserved. Reactivation re-enables all of the above. |
| Remove hardcoded DJ arrays from server.js and roster.html | FIXED_AVAILABILITY used in server.js; FIXED_SCHEDULES + RESIDENTS used in business-logic.js; roster.html loads dynamic DJ list already from /api/djs but may reference names | MEDIUM | After consolidation: server reads from `djs` table on startup or per-request (cached). buildAvailabilityMap() receives fixedSchedules from DB fetch instead of imported constant. RESIDENTS flag must come from `djs.type = 'resident'`. |
| Remove rate editing from DJ Hours tab | Rate edit is currently in DJ Hours tab via editDJ() modal — consolidating to Manage DJs tab prevents confusion about where the source of truth is | LOW | Remove edit button + editDJ() modal + saveDJEdit() from DJ Hours tab. Keep the hours display table as read-only. |
| Account lockout persisted to Supabase | In-memory `_loginAttempts` Map is lost on server restart — a restart is currently an effective lockout bypass | MEDIUM | New table or column on `djs`: `failed_attempts` (int), `locked_until` (timestamptz). checkLockout() and recordFailedAttempt() read/write DB instead of Map. clearFailedAttempts() updates DB. Admin clear-lockout endpoint already exists — must now write to DB. |
| Admin can see + clear lockout status in Manage DJs tab | Admins need visibility: who is locked, when does it expire, one-click clear | LOW | Add locked_until display to Manage DJs table row. "Clear lockout" button calls existing `/api/admin/clear-lockout` (already requires admin auth). |
| Try-catch all Supabase calls with graceful error handling | Current behavior on DB error: some routes throw (caught by outer try-catch), some propagate as unhandled promise rejections. In production, unhandled rejections can crash the process. | MEDIUM | Audit all `supabase.from(...)` calls. Every call must be inside try-catch or have `.catch()`. Errors must return `{ success: false, error: '...' }` with appropriate HTTP status, not crash the request. |
| Webhook signature verification | SEC-04 backlog item. Any inbound webhook (e.g., Supabase realtime hooks, external integrations) currently not verified — request forgery possible | MEDIUM | Standard HMAC-SHA256 pattern: compute signature from raw body + shared secret, compare with `x-hub-signature-256` header using `crypto.timingSafeEqual`. Use `express.raw()` for raw body capture on webhook routes only. Secret stored in env var. |

### Differentiators (Competitive Advantage)

This is an internal admin tool — "competitive advantage" here means quality-of-life for the ops team.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Inline recurring availability editor in admin tab | Editing availability defaults is otherwise a developer task; a visual day/slot grid lets the venue manager adjust to seasonal schedule changes without code deploys | HIGH | Day-of-week columns (Sun–Sat), slot rows (14:00–02:00), checkbox grid. Per-DJ. Saves to `djs.recurring_availability` JSONB. Must handle partial days (e.g., Sound Bogie has no Sunday). |
| Lockout status visible inline in DJ list | Admins know a DJ is locked without asking the DJ or digging in DB | LOW | Add "Locked until [time]" badge next to DJ name in table if `locked_until > now()`. |
| Active/inactive toggle with visual distinction | Deactivated DJs are visually distinct (greyed out) but remain in the list for reactivation | LOW | CSS class on row, toggle button. Deactivated DJs sorted to bottom or in a collapsible section. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dual-write to dj_rates + dj_pins during migration | "Safer" rollback path | Creates two sources of truth; bugs from sync drift will be subtle and hard to reproduce; adds code complexity for a temporary period | Do a clean cutover: migrate data to `djs` table, update all server code in same deployment, drop old tables only after confirming production is stable for a few days |
| Supabase Realtime subscriptions for live DJ list updates | Admin edits would propagate to other open admin sessions instantly | Adds WebSocket dependency, CSP changes, reconnect logic, race conditions on concurrent edits; the admin UI is used by 1-2 people at a time | Reload DJ list from server after each mutation (already the pattern for roster assignments) |
| JSONB schema validation in PostgreSQL for recurring_availability / fixed_schedules | Enforces shape at DB level | Adds migration complexity; app already validates on write; DB rejections produce opaque errors that bubble to the user | Validate structure in the API route before writing: check keys are 0–6, values are arrays of known slot strings. Log malformed writes, return clear error. |
| Per-DJ audit log for all admin changes | "Who changed what when?" | Medium implementation cost, high storage cost over time, not requested by anyone | Use Supabase's built-in row-level updated_at timestamps. Add `updated_by` varchar if needed. Full audit log is v3+ scope. |
| DJ self-service PIN change | DJs want to pick their own PIN | Contradicts the current intentional design decision (KEY_DECISIONS in PROJECT.md: "DJ change-pin route intentionally removed — PINs are admin-allocated only") | Admin resets PIN on DJ request, gives them new 4-digit code. Simple, secure, no self-service needed for this venue context. |

---

## Feature Dependencies

```
[Consolidated `djs` table]
    └──required by──> [Add DJ from admin UI]
    └──required by──> [Edit DJ name/rate/type/venues in Manage DJs]
    └──required by──> [Reset DJ PIN from admin UI]
    └──required by──> [Deactivate / reactivate DJ]
    └──required by──> [Edit recurring availability per DJ]
    └──required by──> [Edit fixed schedules per DJ]
    └──required by──> [Account lockout persisted to Supabase]
    └──required by──> [Remove hardcoded DJ arrays]

[Remove hardcoded DJ arrays]
    └──requires──> [Consolidated `djs` table] (server reads FIXED_AVAILABILITY, FIXED_SCHEDULES, RESIDENTS from DB)
    └──requires──> [Edit recurring availability per DJ] (data must exist in DB before code reads it)
    └──requires──> [Edit fixed schedules per DJ] (data must exist in DB before code reads it)

[Account lockout persisted to Supabase]
    └──enhances──> [Admin can see + clear lockout status in Manage DJs tab]
    └──requires──> [Consolidated `djs` table] (lockout columns live on `djs` or separate table)

[Manage DJs admin tab]
    └──aggregates──> [Add DJ] + [Edit DJ] + [Reset PIN] + [Deactivate/Reactivate] + [Edit recurring avail] + [Edit fixed schedules] + [Clear lockout]

[Remove rate editing from DJ Hours tab]
    └──requires──> [Edit DJ name/rate in Manage DJs tab] (replacement must exist before removal)

[Webhook signature verification]
    └──independent──> (no dependency on `djs` table, parallel work)

[Try-catch Supabase calls]
    └──independent──> (can be done in parallel with schema work, or as a sweep after)
```

### Dependency Notes

- **`djs` table is the critical path:** Everything except webhook verification and Supabase error handling depends on the schema migration completing first.
- **Migration order matters:** Data must be migrated into `djs` (from dj_rates + dj_pins) and recurring_availability / fixed_schedules JSONB columns must be seeded with the current hardcoded values BEFORE server code switches to reading from DB. Otherwise the first deploy will have empty data.
- **Recurring availability and fixed schedules are seeded, not empty:** On migration, copy current FIXED_AVAILABILITY and FIXED_SCHEDULES values as JSONB into `djs` rows for the affected DJs. Only then remove the hardcoded constants.
- **Remove rate editing from DJ Hours last:** The edit UI in DJ Hours tab should only be removed after the Manage DJs tab is fully working and deployed.

---

## MVP Definition

### This Milestone's Required Scope (v2.0)

All of the following must ship together — they are interdependent:

- [ ] `djs` table created, dj_rates + dj_pins data migrated into it
- [ ] Server routes updated to read from `djs` instead of dj_rates + dj_pins
- [ ] FIXED_AVAILABILITY seeded into `djs.recurring_availability` JSONB for affected DJs
- [ ] FIXED_SCHEDULES seeded into `djs.fixed_schedules` JSONB for Davoted
- [ ] Server reads recurring_availability and fixed_schedules from `djs` (removes hardcoded imports)
- [ ] RESIDENTS derived from `djs.type = 'resident'`
- [ ] Manage DJs tab added to roster.html with: DJ list table, add DJ, edit name/rate/type, reset PIN, deactivate/reactivate, clear lockout
- [ ] Recurring availability editor in Manage DJs tab (day/slot checkbox grid)
- [ ] Fixed schedules editor in Manage DJs tab (venue/day/slot grid)
- [ ] Rate editing removed from DJ Hours tab
- [ ] Account lockout columns on `djs` (or separate table), checkLockout() / recordFailedAttempt() read/write DB
- [ ] Try-catch coverage sweep for all Supabase calls

### Add After Core is Stable (v2.x)

- [ ] Webhook signature verification (SEC-04) — independent, lower urgency, add when inbound webhooks are actually active
- [ ] Lockout status badge in Manage DJs list (depends on account lockout persistence)

### Defer to Future Milestone (v3+)

- [ ] Full audit log for admin DJ changes
- [ ] DJ bulk import (CSV)
- [ ] Per-venue rate overrides per DJ

---

## Feature Prioritization Matrix

| Feature | Admin Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| Consolidated `djs` table + migration | HIGH (unblocks all) | MEDIUM | P1 |
| Server reads from `djs` (remove hardcoded) | HIGH (operational safety) | MEDIUM | P1 |
| Manage DJs tab — add/edit/deactivate/PIN reset | HIGH (ops workflow) | MEDIUM | P1 |
| Recurring availability editor | HIGH (schedule flexibility) | HIGH | P1 |
| Fixed schedules editor | MEDIUM (rarely changes) | HIGH | P1 |
| Account lockout persistence | MEDIUM (security gap on restart) | MEDIUM | P1 |
| Remove rate editing from DJ Hours tab | MEDIUM (UX hygiene) | LOW | P1 |
| Try-catch sweep all Supabase calls | HIGH (stability) | MEDIUM | P1 |
| Lockout status visible in admin UI | LOW (nice to have) | LOW | P2 |
| Webhook signature verification | MEDIUM (security hardening) | MEDIUM | P2 |

**Priority key:**
- P1: Required for v2.0 milestone completion
- P2: Should add when possible, does not block milestone
- P3: Future milestone

---

## Implementation Notes by Feature

### Consolidated `djs` Table Schema

```sql
CREATE TABLE djs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE,
  pin_hash              text,                    -- bcrypt hash, nullable for DJs not yet assigned a PIN
  rate                  integer NOT NULL DEFAULT 0,
  type                  text NOT NULL DEFAULT 'guest' CHECK (type IN ('resident', 'guest')),
  active                boolean NOT NULL DEFAULT true,
  venues                text[] DEFAULT '{}',     -- e.g. ['arkbar', 'love']
  recurring_availability jsonb DEFAULT '{}',     -- { "0": ["14:00–15:00", ...], "1": [...] }
  fixed_schedules        jsonb DEFAULT '{}',     -- { "arkbar": { "1": ["14:00–15:00"], ... }, ... }
  failed_attempts        integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
```

### Recurring Availability JSONB Shape

```json
{
  "0": ["14:00–15:00", "15:00–16:00", "16:00–17:00"],
  "1": ["14:00–15:00", "15:00–16:00"],
  "6": ["17:00–18:00", "18:00–19:00"]
}
```
Keys are day-of-week strings ("0"–"6"). Values are arrays of normalized slot strings using en-dash (U+2013). Empty object `{}` means no recurring defaults for that DJ.

### Fixed Schedules JSONB Shape

```json
{
  "arkbar": {
    "1": ["14:00–15:00", "15:00–16:00"],
    "4": ["14:00–15:00", "15:00–16:00", "20:00–21:00"]
  },
  "loveBeach": {
    "2": ["20:00–21:00", "21:00–22:00"]
  }
}
```
Outer key is venue string (must match the keys used in `buildAvailabilityMap`). Inner key is day-of-week string. Values are slot arrays.

### Account Lockout on `djs`

`checkLockout(name)`: query `SELECT locked_until FROM djs WHERE name ILIKE $1`. If `locked_until > NOW()` return true.

`recordFailedAttempt(name)`: `UPDATE djs SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END WHERE name ILIKE $1`.

`clearFailedAttempts(name)`: `UPDATE djs SET failed_attempts = 0, locked_until = NULL WHERE name ILIKE $1`.

Note: These are now async DB calls whereas the current in-memory versions are synchronous. Every caller of checkLockout() must be updated to await.

### Webhook Verification Pattern

```javascript
// Middleware for webhook routes only
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

function verifyWebhookSignature(req, res, next) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.status(401).json({ error: 'Missing signature' });
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Signature error' });
  }
  next();
}
```

### Migration Sequence (order matters)

1. Create `djs` table in Supabase (migration script)
2. Seed from dj_rates: INSERT name, rate
3. Seed from dj_pins: UPDATE pin_hash matching by name
4. Seed recurring_availability JSONB from current FIXED_AVAILABILITY hardcoded values
5. Seed fixed_schedules JSONB from current FIXED_SCHEDULES hardcoded values
6. Set `type = 'resident'` for RESIDENTS array members
7. Verify row counts match expectations
8. Deploy new server code that reads from `djs`
9. Smoke test all DJ login, roster load, auto-suggest, DJ portal
10. Drop dj_rates and dj_pins (or rename to _deprecated — keep for a few days)

---

## Sources

- Direct codebase analysis: `/c/Users/gusno/dj-roster/server.js` (1,250 LOC), `lib/business-logic.js`, `public/roster.html`
- PROJECT.md key decisions (PIN admin-only allocation, in-memory lockout rationale)
- Standard HMAC webhook verification pattern (Node.js `crypto` built-in, timing-safe comparison)
- Supabase JSONB column pattern for flexible schema (PostgreSQL JSONB, no external source needed)

---
*Feature research for: DJ Management & Supabase Consolidation (v2.0 milestone)*
*Researched: 2026-03-19*
