# Phase 9: Admin DJ Management API - Research

**Researched:** 2026-03-19
**Domain:** Node.js/Express admin CRUD endpoints — DJ lifecycle management against Supabase `djs` table
**Confidence:** HIGH — all findings verified by direct codebase inspection (server.js 1,260 LOC, lib/lockout.js, lib/business-logic.js, public/roster.html)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADMIN-02 | Admin can add a new DJ with name, rate, type, and PIN | POST /api/admin/djs — INSERT into djs, bcrypt.hash the PIN, invalidateCaches('djs') |
| ADMIN-03 | Admin can edit a DJ's name, rate, and type | PATCH /api/admin/djs/:id — UPDATE djs by id, invalidateCaches('djs') |
| ADMIN-04 | Admin can deactivate a DJ — disappears from dropdowns/auto-suggest/login | PATCH /api/admin/djs/:id { active: false } — fetchDJs() already filters active=true; login and requireDJAuth both check active flag |
| ADMIN-05 | Admin can reactivate a deactivated DJ | PATCH /api/admin/djs/:id { active: true } — same endpoint as ADMIN-04, invalidateCaches('djs') |
| ADMIN-06 | Admin can reset a DJ's PIN by inputting a new PIN (server hashes it) | POST /api/admin/djs/:id/pin { pin } — bcrypt.hash, UPDATE djs.pin_hash, invalidateCaches('djs') |
| ADMIN-07 | Admin can view lockout status and clear lockout for a DJ | GET /api/admin/djs returns locked_until; DELETE /api/admin/djs/:id/lockout calls clearFailedAttempts |
| ADMIN-08 | Rate editing removed from DJ Hours tab — consolidated into Manage DJs tab | POST /api/djs/update either returns 410 Gone / 403 or is locked to Manage DJs only; saveDJEdit() in roster.html deleted |
</phase_requirements>

---

## Summary

Phase 9 adds five new server endpoints under `/api/admin/djs` that cover the full DJ lifecycle: list all (including inactive), add, edit, reset PIN, and clear lockout. A sixth change disables or removes the legacy `/api/djs/update` endpoint that currently allows rate editing from the DJ Hours tab. All new endpoints use the existing `requireAdmin` middleware (reads `x-admin-password` header, bcrypt-compares against `ADMIN_PASSWORD` env var). Every write to the `djs` table must call `invalidateCaches('djs')` to ensure the 10-minute DJ list cache is busted immediately.

The `djs` table is fully in place from Phase 7 and all server code reads from it as of Phase 8. Phase 9 is therefore pure endpoint addition — no schema changes, no new npm packages, no new lib files required. The lockout library (`lib/lockout.js`) and its factory pattern are already live and tested. PIN hashing uses the existing `bcrypt` package (cost 10, consistent with Phase 7 migration).

The hardest design decision is what to do with `/api/djs/update` (ADMIN-08): the cleanest approach is to gate it behind `requireAdmin` and remove the in-body password check, then document that rate edits go through the new PATCH endpoint. Alternatively, return 410 Gone so the frontend's `saveDJEdit()` visibly fails until it is removed in Phase 10. Both approaches satisfy the requirement; the 410 approach gives the clearest failure signal before Phase 10 ships.

**Primary recommendation:** Add five new `/api/admin/djs` endpoints, gate `/api/djs/update` with a 410 response, and call `invalidateCaches('djs')` on every write.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bcrypt` | ^6.0.0 | Hash new PINs server-side | Already installed, already used for all PIN hashing in the project |
| `@supabase/supabase-js` | 2.99.1 | CRUD against `djs` table | Already installed and used throughout server.js |
| `express` | existing | Route registration, `requireAdmin` middleware | Entire server is Express; no change needed |

### No New Dependencies

All Phase 9 work is implemented with the existing installed stack. No `npm install` required.

```bash
# No new packages — all needed packages already installed
```

---

## Architecture Patterns

### Recommended Endpoint Set

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/djs` | requireAdmin | List ALL DJs (active + inactive) with lockout status |
| POST | `/api/admin/djs` | requireAdmin | Add new DJ (name, rate, type, pin) |
| PATCH | `/api/admin/djs/:id` | requireAdmin | Edit DJ fields (name, rate, type, active) |
| POST | `/api/admin/djs/:id/pin` | requireAdmin | Reset PIN (admin supplies plaintext, server hashes) |
| DELETE | `/api/admin/djs/:id/lockout` | requireAdmin | Clear lockout for DJ |
| POST | `/api/djs/update` | — | Return 410 Gone (ADMIN-08: rate editing disabled here) |

### Existing requireAdmin Pattern

```javascript
// Source: server.js line 299
async function requireAdmin(req, res, next) {
  try {
    const pw = req.headers['x-admin-password'];
    if (!pw || !(await bcrypt.compare(pw, process.env.ADMIN_PASSWORD))) {
      return res.status(401).json({ success: false, error: 'Unauthorised' });
    }
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Unauthorised' });
  }
}
```

All five new endpoints must use this middleware — no inline password checks.

### Existing invalidateCaches('djs') Pattern

```javascript
// Source: server.js line 162
function invalidateCaches(type, opts = {}) {
  switch (type) {
    case 'djs':
      cache.djs.data = null;
      cache.availability.clear(); // DJ changes affect availability context
      break;
    // ...
  }
}
```

Every endpoint that writes to `djs` must call `invalidateCaches('djs')` before returning success. This clears both the DJ list cache (10-minute TTL) and all availability caches.

### Existing Supabase Write Pattern (from Phase 8)

```javascript
// Source: server.js line 1150 — existing /api/djs/update
const { error } = await supabase
  .from('djs')
  .update({ rate })
  .ilike('name', oldName.trim());
if (error) throw new Error(error.message);
invalidateCaches('djs');
res.json({ success: true });
```

New endpoints follow the same shape but use `.eq('id', id)` (not ilike name) since the UUID id is available from the URL parameter.

### ID-Based vs Name-Based Lookups

New admin endpoints receive the DJ's `id` (UUID) in the URL. This is safer than ilike-name matching:
- The existing `/api/djs/update` uses `.ilike('name', oldName.trim())` — acceptable for a legacy endpoint
- New endpoints should use `.eq('id', id)` — exact, unambiguous, immune to name deduplication issues
- The GET `/api/admin/djs` response must include `id` so the frontend can use it in subsequent PATCH/POST/DELETE calls

### GET /api/admin/djs Shape

The GET endpoint differs from the public `GET /api/djs` in two ways:
1. Returns ALL DJs (active and inactive), not just `active = true`
2. Includes `locked_until`, `failed_attempts`, and `id` fields

```javascript
// New endpoint — returns admin-facing DJ list
app.get('/api/admin/djs', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('djs')
      .select('id, name, rate, type, active, venues, failed_attempts, locked_until')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ success: true, djs: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load DJs' });
  }
});
```

Do NOT include `pin_hash` in the select — it should never leave the server.

### POST /api/admin/djs (Add DJ)

```javascript
app.post('/api/admin/djs', requireAdmin, async (req, res) => {
  try {
    const { name, rate, type, pin } = req.body;
    if (!name || !pin || rate === undefined) {
      return res.status(400).json({ success: false, error: 'name, rate, and pin are required' });
    }
    if (!['resident', 'guest', 'casual'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid type' });
    }
    const pin_hash = await bcrypt.hash(String(pin).trim(), 10);
    const { data, error } = await supabase
      .from('djs')
      .insert({ name: name.trim(), rate: parseInt(rate), type, pin_hash, active: true })
      .select('id, name, rate, type, active')
      .single();
    if (error) throw new Error(error.message);
    invalidateCaches('djs');
    res.json({ success: true, dj: data });
  } catch (err) {
    console.error('[POST /api/admin/djs]', err.message);
    res.status(500).json({ success: false, error: 'Failed to add DJ' });
  }
});
```

### PATCH /api/admin/djs/:id (Edit / Activate / Deactivate)

One endpoint handles name/rate/type edits AND activate/deactivate. Frontend sends only the fields it wants to change.

```javascript
app.patch('/api/admin/djs/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'rate', 'type', 'active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }
    if (updates.name) updates.name = updates.name.trim();
    if (updates.rate !== undefined) updates.rate = parseInt(updates.rate);
    const { error } = await supabase.from('djs').update(updates).eq('id', id);
    if (error) throw new Error(error.message);
    invalidateCaches('djs');
    res.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/admin/djs/:id]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update DJ' });
  }
});
```

### POST /api/admin/djs/:id/pin (Reset PIN)

```javascript
app.post('/api/admin/djs/:id/pin', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ success: false, error: 'pin is required' });
    const pin_hash = await bcrypt.hash(String(pin).trim(), 10);
    const { error } = await supabase.from('djs').update({ pin_hash }).eq('id', id);
    if (error) throw new Error(error.message);
    // pin_hash is not in the DJ list cache, but invalidate to be safe
    invalidateCaches('djs');
    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/admin/djs/:id/pin]', err.message);
    res.status(500).json({ success: false, error: 'Failed to reset PIN' });
  }
});
```

### DELETE /api/admin/djs/:id/lockout (Clear Lockout)

```javascript
app.delete('/api/admin/djs/:id/lockout', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('djs')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/djs/:id/lockout]', err.message);
    res.status(500).json({ success: false, error: 'Failed to clear lockout' });
  }
});
```

Note: The existing `POST /api/admin/clear-lockout` (which uses name + `clearFailedAttempts()`) can remain in place for backward compatibility. The new DELETE endpoint is the canonical ID-based version for the Phase 10 UI.

### ADMIN-08: Disabling /api/djs/update for Rate Edits

The current `/api/djs/update` endpoint does an inline password check and is called from the DJ Hours tab's `saveDJEdit()` in roster.html. Two options:

**Option A — Return 410 Gone (recommended for Phase 9):**
```javascript
app.post('/api/djs/update', (req, res) => {
  res.status(410).json({ success: false, error: 'Rate editing moved to Manage DJs tab' });
});
```
This causes the frontend's `saveDJEdit()` to visibly fail, surfacing the issue before Phase 10 removes the UI.

**Option B — Gate behind requireAdmin (alternative):**
Replace the inline password check with `requireAdmin` middleware, then redirect to the new PATCH endpoint logic. More work, and the Hours tab UI would still appear to work — misrepresenting the requirement's intent.

Option A (410) is preferred: it satisfies ADMIN-08 immediately and forces Phase 10 to clean up the UI.

### Recommended File Structure

No new files needed. All endpoints are added to `server.js` in a new admin DJ management section, following the existing section-comment pattern:

```
server.js additions:
  /* == ADMIN — DJ MANAGEMENT ============================================== */
  GET  /api/admin/djs
  POST /api/admin/djs
  PATCH /api/admin/djs/:id
  POST /api/admin/djs/:id/pin
  DELETE /api/admin/djs/:id/lockout

  /* == LEGACY — DISABLED =================================================== */
  POST /api/djs/update  → 410 Gone
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password verification for admin routes | Inline bcrypt.compare in every route | `requireAdmin` middleware (already exists, server.js line 299) | DRY, already tested, already used by 8+ routes |
| PIN hashing | Custom hash function | `bcrypt.hash(pin, 10)` | Already installed, consistent bcrypt cost with migration |
| Cache busting after DJ writes | Custom cache clearing logic | `invalidateCaches('djs')` (already exists, server.js line 162) | Clears both `cache.djs` and all `cache.availability` entries atomically |
| Lockout clearing | Custom UPDATE query in each endpoint | `clearFailedAttempts(name)` from `lib/lockout.js` | Already tested with 8 unit tests; or direct `UPDATE djs SET failed_attempts=0, locked_until=null WHERE id=$1` for ID-based version |

---

## Common Pitfalls

### Pitfall 1: Forgetting invalidateCaches('djs') on Every Write

**What goes wrong:** Admin deactivates a DJ, the API returns success, but the DJ continues appearing in `/api/djs` responses for up to 10 minutes (cache TTL). The DJ can still appear in dropdowns and log in if the lockout/active check hits the cache.

**Why it happens:** New endpoints are written without checking the cache dependency graph.

**How to avoid:** Every endpoint that writes to `djs` — add, edit, pin reset, deactivate — must call `invalidateCaches('djs')` before returning. The cache dependency comment block at server.js line 149 documents this.

**Warning signs:** Admin deactivates DJ, DJ portal still shows them in dropdown; admin adds DJ, they don't appear in DJ list immediately.

### Pitfall 2: Including pin_hash in the Admin DJ List Response

**What goes wrong:** The GET `/api/admin/djs` SELECT includes `pin_hash`. The hash is returned to the browser in the admin session. While bcrypt hashes aren't directly reversible, exposing them unnecessarily is poor practice and logs/proxies may capture them.

**How to avoid:** Explicitly exclude `pin_hash` from the SELECT: `select('id, name, rate, type, active, venues, failed_attempts, locked_until')`. Never select `*` from `djs`.

### Pitfall 3: Using ilike Name Match Instead of UUID in New Endpoints

**What goes wrong:** PATCH `/api/admin/djs/:id` is supposed to use the UUID from the URL, but the implementation uses `.ilike('name', req.body.name)`. Name-based updates can collide if two DJs have similar names, and do not use the stable ID the frontend already has.

**How to avoid:** All new endpoints receive the UUID as `:id` and use `.eq('id', id)`. Only the legacy clear-lockout (which receives a name string) should use ilike/name matching.

### Pitfall 4: Not Validating type Field Values

**What goes wrong:** Admin sends `type: 'freelance'` which isn't a valid type. Supabase silently stores it. The `type === 'resident'` check in login and config endpoints returns false for this DJ even if they were meant to be a resident.

**How to avoid:** Validate `type` server-side before insert/update: `if (!['resident', 'guest', 'casual'].includes(type)) return 400`. Check the existing CHECK constraint on `djs.type` in the Phase 7 schema — if it exists, Supabase will reject it anyway, but a pre-check gives a better error message.

### Pitfall 5: Deactivated DJ Still Works if Active Not Checked at Login

**What goes wrong:** Admin sets `active = false` via PATCH. Cache is busted. But the next login attempt for this DJ fetches a fresh row from `djs` — if the auth code doesn't check `active`, the DJ can still log in.

**How to avoid:** Both `requireDJAuth` and `/api/dj/login` already check `active` in Phase 8:
```javascript
// server.js line 324
if (!djRow || !djRow.active) {
  return res.status(401).json({ success: false, error: 'Unauthorised' });
}
```
This is already correct. Verify it stays correct after Phase 9 changes.

### Pitfall 6: Existing /api/admin/clear-lockout Uses Name, New Endpoint Uses ID

**What goes wrong:** If Phase 10 calls the new DELETE `/api/admin/djs/:id/lockout` but Phase 9 was accidentally built to call the old `POST /api/admin/clear-lockout`, the two endpoints get out of sync.

**How to avoid:** Phase 9 adds the new DELETE endpoint. The old POST endpoint remains in place (backward compat) but is not removed yet. Phase 10 frontend uses the new DELETE endpoint with the DJ id.

---

## Code Examples

### Verified Pattern: requireAdmin (server.js line 299)

```javascript
// All new endpoints follow this exact middleware pattern
app.get('/api/admin/djs', requireAdmin, async (req, res) => {
  // ...
});
```

### Verified Pattern: try-catch with Supabase error check (from Phase 8 pattern)

```javascript
try {
  const { data, error } = await supabase.from('djs').insert({...}).select('id').single();
  if (error) throw new Error(error.message);
  invalidateCaches('djs');
  res.json({ success: true, dj: data });
} catch (err) {
  console.error('[POST /api/admin/djs]', err.message);
  res.status(500).json({ success: false, error: 'Failed to add DJ' });
}
```

### Verified Pattern: bcrypt.hash for PIN (consistent with Phase 7 migration)

```javascript
// Phase 7 migration used bcrypt.hash(pin, 10)
const pin_hash = await bcrypt.hash(String(pin).trim(), 10);
```

### Verified Pattern: fetchDJs() filters active=true (server.js line 208)

```javascript
// fetchDJs() — public endpoint — filters active=true
// GET /api/admin/djs must NOT use fetchDJs() — it needs all DJs
const { data, error } = await supabase
  .from('djs')
  .select('id, name, rate, type, active, venues, failed_attempts, locked_until')
  .order('name', { ascending: true });
// No .eq('active', true) filter here
```

### Existing Section Comment Style (for consistency)

```javascript
/* == ADMIN — CLEAR DJ LOCKOUT ============================================= */
app.post('/api/admin/clear-lockout', requireAdmin, async (req, res) => {
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DJ edit only via `/api/djs/update` with inline password | `/api/djs/update` returns 410; rate/name/type edits via PATCH `/api/admin/djs/:id` with `requireAdmin` | Phase 9 | Clean auth boundary; no more password in request body |
| No way to add/deactivate/reactivate DJs via API | Full CRUD at `/api/admin/djs` | Phase 9 | Admin self-service without DB access |
| Lockout clear only by DJ name | Lockout clear by UUID at DELETE `/api/admin/djs/:id/lockout` | Phase 9 | Unambiguous; safe when names have Unicode variants |

**Not changed in Phase 9:**
- `fetchDJs()` — still public, still filters active=true, still cached
- `requireDJAuth` — already checks active; no change needed
- `lib/lockout.js` — already handles clearFailedAttempts by name; no change needed

---

## Open Questions

1. **Type values: 'casual' vs 'guest' — which is the canonical set?**
   - What we know: FEATURES.md schema shows `type TEXT CHECK (type IN ('resident', 'guest'))`. STATE.md decisions reference 'resident' and 'casual'. ARCHITECTURE.md schema shows 'resident' / 'casual' / 'guest'.
   - What's unclear: Whether the Phase 7 migration seeded `type` as 'guest' or 'casual' for non-resident DJs.
   - Recommendation: Query the live `djs` table (`SELECT DISTINCT type FROM djs`) to confirm what values exist before implementing validation. The add-DJ endpoint should accept whatever values the existing data uses.

2. **Should /api/djs/update be completely removed or return 410?**
   - What we know: Phase 10 will remove the `saveDJEdit()` call in roster.html. Until then, the frontend will try to call this endpoint.
   - Recommendation: Return 410 Gone in Phase 9 so the failure is visible and drives Phase 10 cleanup. Do not silently drop the request.

3. **Does the existing `djs.type` column have a DB-level CHECK constraint?**
   - What we know: The Phase 7 schema SQL is in `scripts/` and created the table, but the exact constraint syntax wasn't inspected in this research.
   - Recommendation: Check the Phase 7 schema SQL or the Supabase table definition before adding server-side validation, to avoid contradicting the constraint.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest ^30.3.0 |
| Config file | `package.json` — `"test": "jest"` |
| Quick run command | `npx jest lib/` |
| Full suite command | `npx jest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-02 | POST /api/admin/djs adds DJ, bcrypt hashes PIN | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |
| ADMIN-03 | PATCH /api/admin/djs/:id updates name/rate/type | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |
| ADMIN-04 | PATCH active=false deactivates DJ; login rejects | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |
| ADMIN-05 | PATCH active=true reactivates DJ | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |
| ADMIN-06 | POST /api/admin/djs/:id/pin hashes new PIN, old PIN stops working | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |
| ADMIN-07 | DELETE /api/admin/djs/:id/lockout clears failed_attempts and locked_until | unit | `npx jest lib/lockout.test.js -x` | Exists |
| ADMIN-08 | POST /api/djs/update returns 410 | unit | `npx jest lib/admin-dj.test.js -x` | Wave 0 |

Note: The existing `lib/lockout.test.js` (18 tests) already covers `clearFailedAttempts`. ADMIN-07's new DELETE endpoint is a thin wrapper that calls the same underlying Supabase pattern — test the endpoint handler separately in the new test file.

Testing approach for server endpoints: The project tests pure functions (lib/) with Jest and injected mocks. Server-level endpoint tests are not in the current test suite. For Phase 9, test the route handler logic by extracting it into a testable helper function or by testing the Supabase interaction with mocked supabase client — following the same factory pattern used in `lib/lockout.js`.

### Sampling Rate

- **Per task commit:** `npx jest lib/`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green (currently 63/63 passing) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/admin-dj.test.js` — covers ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-08
- [ ] Handler logic must be extractable for unit testing (use factory pattern like lockout.js, or mock express req/res)

---

## Sources

### Primary (HIGH confidence)

- Direct inspection of `C:/Users/gusno/dj-roster/server.js` (1,260 LOC) — requireAdmin pattern, invalidateCaches pattern, existing admin routes, /api/djs/update, /api/admin/clear-lockout
- Direct inspection of `C:/Users/gusno/dj-roster/lib/lockout.js` — clearFailedAttempts implementation and factory pattern
- Direct inspection of `C:/Users/gusno/dj-roster/lib/lockout.test.js` — 18 existing lockout tests
- Direct inspection of `C:/Users/gusno/dj-roster/public/roster.html` — editDJ, saveDJEdit, existing admin password header pattern
- `.planning/REQUIREMENTS.md` — ADMIN-02 through ADMIN-08 requirement definitions
- `.planning/STATE.md` — locked decisions (PIN admin-only, deactivated DJs hide from UI/login/historical data preserved)
- `.planning/research/ARCHITECTURE.md` — endpoint list, cache invalidation graph, data flow
- `.planning/research/PITFALLS.md` — cache invalidation gaps, deactivated DJ auth, pin_hash exposure
- `.planning/research/FEATURES.md` — MVP definition, djs table schema, implementation notes

### Secondary (MEDIUM confidence)

- `.planning/research/STACK.md` — bcrypt cost 10 confirmed, no new dependencies needed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed installed, no new dependencies needed
- Architecture: HIGH — verified against live server.js; all patterns directly observable
- Pitfalls: HIGH — all pitfalls evidenced by direct code inspection

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable codebase; confidence degrades if server.js is significantly refactored)
