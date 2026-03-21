# Phase 10: Manage DJs Frontend - Research

**Researched:** 2026-03-19
**Domain:** Vanilla JS frontend tab, admin DJ CRUD, recurring availability editing, fixed schedule editing
**Confidence:** HIGH

## Summary

Phase 10 builds the Manage DJs tab entirely in `public/roster.html` — no new server-side code is needed for the core DJ table (ADMIN-01). The backend API is fully wired: five routes under `/api/admin/djs` are live in `server.js` and cover list, add, edit (name/rate/type/active), reset PIN, and clear lockout.

The two scheduling requirements (SCHED-02 recurring availability, SCHED-04 fixed schedules) require new backend endpoints because `editDJ` in `lib/admin-dj.js` only allows `ALLOWED_EDIT_KEYS = ['name', 'rate', 'type', 'active']` — it deliberately excludes JSONB fields. Two additional PATCH routes must be added: one to update `recurring_availability`, one to update `fixed_schedules`. These will mirror the existing `PATCH /api/admin/djs/:id` pattern.

The UI follows the existing dark-theme design system in `roster.html` (CSS custom properties, `--surface`, `--border`, `--teal`, etc.) and the tab-switching pattern already in use for ARKbar/Love/Hours. All work is in a single HTML file — no build tooling, no framework.

**Primary recommendation:** Add the "Manage DJs" tab as a fourth `venue-tab` button in the existing `<nav class="venue-bar">`, rendered by `switchVenue('manage')`, using the same `showToast` / `fetch` patterns already established in the file. Add two new PATCH routes to server.js for JSONB schedule fields.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADMIN-01 | Admin can view all DJs in a Manage DJs tab with name, rate, type, active status, and lockout status | `GET /api/admin/djs` returns `id, name, rate, type, active, venues, failed_attempts, locked_until`; build HTML table from response |
| SCHED-02 | Admin can edit a DJ's recurring availability via day-of-week checkbox grid | Requires new `PATCH /api/admin/djs/:id/recurring-availability` route; `recurring_availability` is JSONB `{ "0": ["14:00–15:00", ...], "1": [...] }` keyed by day-of-week integer string |
| SCHED-04 | Admin can edit a DJ's fixed schedule via venue + day + slot grid | Requires new `PATCH /api/admin/djs/:id/fixed-schedules` route; `fixed_schedules` is JSONB `{ arkbar: { "0": [...slots], ... }, loveBeach: { "0": [...slots], ... } }` — only Davoted currently has data |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (ES6+) | — | All frontend behaviour in roster.html | No build tooling; consistent with entire codebase |
| Express.js | ^4.18.2 | Two new PATCH routes for JSONB schedule fields | Already the server framework |
| Supabase JS client | ^2.0.0 | JSONB `.update()` for schedule fields | Already injected via `createAdminDJHandlers` factory |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Jest | ^30.3.0 | Unit tests for new handler functions | Any new handler added to `lib/admin-dj.js` must have tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline tab in roster.html | Separate HTML page | New page would break single-admin-file convention; roster.html already has all auth/session logic |
| Modal dialogs for edit forms | Inline row editing | Modals are cleaner for multi-field edits; consistent with existing `.dj-detail` modal CSS already present |

**Installation:** No new packages required.

---

## Architecture Patterns

### Existing Tab Pattern

The current tab navigation in `roster.html` uses:

```html
<!-- HTML (lines 528-532) -->
<nav class="venue-bar" aria-label="Venue tabs">
  <button class="venue-tab active" id="tabArkbar" onclick="switchVenue('arkbar')">ARKbar / HIP</button>
  <button class="venue-tab love" id="tabLove" onclick="switchVenue('love')">Love Beach Club</button>
  <button class="venue-tab hours" id="tabHours" onclick="switchVenue('hours')">DJ Hours</button>
</nav>
```

```javascript
// JS (lines 757-762)
$('tabArkbar').classList.toggle('active', venue === 'arkbar');
$('tabLove').classList.toggle('active', venue === 'love');
$('tabHours').classList.toggle('active', venue === 'hours');
```

Add a fourth button with id `tabManage` and a `manage` venue key.

### Existing API Call Pattern

```javascript
// Consistent pattern used throughout roster.html
const res = await fetch('/api/admin/djs', {
  headers: { 'x-admin-password': adminPassword }
});
const data = await res.json();
if (!data.success) { showToast(data.error || 'Error', 'error'); return; }
```

All admin routes use `requireAdmin` middleware which checks `req.headers['x-admin-password']`.

### DJ Table Render Pattern

`listDJs` returns `id, name, rate, type, active, venues, failed_attempts, locked_until`. Build a table showing:
- Name
- Rate (integer, Thai Baht implied)
- Type (`resident` / `guest` / `casual`)
- Active status (badge)
- Lockout status (derived: `locked_until` is non-null and in the future → locked)

Action buttons per row:
- Edit (name/rate/type) → inline form or modal → `PATCH /api/admin/djs/:id`
- Deactivate / Reactivate → `PATCH /api/admin/djs/:id` with `{ active: false/true }`
- Reset PIN → prompt for new PIN → `POST /api/admin/djs/:id/pin`
- Clear Lockout (only shown when locked) → `DELETE /api/admin/djs/:id/lockout`
- Edit Availability → opens day-of-week checkbox grid → new route
- Edit Fixed Schedule → opens venue+day+slot grid → new route (Davoted-only currently, but UI should work for any DJ)

### Backend: New JSONB Routes Pattern

Both new routes follow the exact same handler-wired pattern as the existing five routes.

**New handler signatures (to add to `lib/admin-dj.js`):**

```javascript
// recurring_availability: { "0": ["14:00–15:00", ...], "6": [...] }
// Keys are day-of-week strings ("0"=Sun … "6"=Sat)
async function updateRecurringAvailability({ id, recurring_availability } = {}) { ... }

// fixed_schedules: { arkbar: { "1": ["14:00–15:00", ...] }, loveBeach: { "1": [...] } }
async function updateFixedSchedules({ id, fixed_schedules } = {}) { ... }
```

Both must call `invalidateCaches('djs')` on success.

**New routes in server.js:**

```javascript
app.patch('/api/admin/djs/:id/recurring-availability', requireAdmin, async (req, res) => {
  const result = await updateRecurringAvailability({ id: req.params.id, ...req.body });
  res.status(result.status || 200).json(result);
});

app.patch('/api/admin/djs/:id/fixed-schedules', requireAdmin, async (req, res) => {
  const result = await updateFixedSchedules({ id: req.params.id, ...req.body });
  res.status(result.status || 200).json(result);
});
```

### JSONB Data Structures (Confirmed from codebase)

**`recurring_availability`** (server.js line 811):
```javascript
// Keyed by dow string ("0"–"6"), value is array of slot strings
{ "0": ["14:00–15:00", "15:00–16:00"], "1": [], "5": ["20:00–21:00"] }
// Empty days may be omitted or present as []
// Slots use en-dash (U+2013) — use normalizeSlot() on write
```

**`fixed_schedules`** (server.js lines 803–804):
```javascript
// Venues: "arkbar" and "loveBeach" (note camelCase for loveBeach)
// Keyed by dow string ("0"–"6"), value is array of slot strings
{
  arkbar:    { "1": ["14:00–15:00", "15:00–16:00"] },
  loveBeach: { "2": ["20:00–21:00", "21:00–22:00"] }
}
// hip is NOT in fixed_schedules — hip schedule is separate DIAG_FIXED_TEMPLATE logic
```

### Slot Normalisation

All slot strings must use en-dash (U+2013) — not hyphen or em-dash. The server has `normalizeSlot()` in `lib/business-logic.js`. The frontend should send slots with the same en-dash character used in `ARKBAR_SLOTS`, `HIP_SLOTS`, `LOVE_WEEKDAY_SLOTS` constants already in roster.html.

### Recurring Availability UI: Day-of-Week Checkbox Grid

Display as a 7-column grid (Sun–Sat) × N-slot rows with checkboxes:

```
         Sun  Mon  Tue  Wed  Thu  Fri  Sat
14–15    [ ]  [x]  [ ]  [x]  [ ]  [x]  [ ]
15–16    [ ]  [x]  [ ]  [x]  [ ]  [x]  [ ]
...
```

On save: collect checked slots per dow → build `recurring_availability` object → PATCH route.

### Fixed Schedule UI: Venue + Day + Slot Grid

Two sections (ARKbar, Love Beach Club) — each a grid of days × slots with checkboxes. On save: collect checked slots per venue per dow → build `fixed_schedules` object → PATCH route.

Relevant slot constants already in roster.html:
- `ARKBAR_SLOTS` — 11 slots
- `LOVE_WEEKDAY_SLOTS` — 7 slots
- `LOVE_SAT_SLOTS` — 9 slots (Saturday has different slots at Love)

For simplicity, use `ARKBAR_SLOTS` for ARKbar and show Saturday Love slots separately, or use a unified set. The existing data for Davoted only uses a subset — keep it slot-list based, not trying to merge the two Saturday Love variants.

### Anti-Patterns to Avoid

- **Directly posting `recurring_availability` through the existing `editDJ` handler**: `ALLOWED_EDIT_KEYS` only allows `name/rate/type/active`. JSONB fields must go through dedicated handlers with their own validation.
- **JSON.stringify before sending to Supabase**: The Phase 7 decision locked this — pass raw JS objects, never double-encode.
- **Relying on `venues` column for availability display**: The `venues` array is separate from `recurring_availability`. Do not conflate them.
- **Assuming hip is in fixed_schedules**: Hip is handled via `DIAG_FIXED_TEMPLATE` (stays in code for v2.0 per STATE.md decision). The fixed_schedules JSONB only covers `arkbar` and `loveBeach`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth header on admin fetches | Custom auth layer | `'x-admin-password': adminPassword` header pattern | Already implemented in `requireAdmin` middleware |
| Cache invalidation after schedule edits | Manual cache management | Call `invalidateCaches('djs')` | `fetchDJs()` TTL cache already handles this |
| Slot normalisation | Custom regex | `normalizeSlot()` in business-logic.js | En-dash normalisation already battle-tested |
| Toast notifications | Custom notification UI | `showToast(msg, type)` already in roster.html | Consistent UX, handles timers and types |

---

## Common Pitfalls

### Pitfall 1: loveBeach vs love key naming
**What goes wrong:** Using `love` as the venue key in `fixed_schedules` when the actual JSONB key is `loveBeach`.
**Why it happens:** The server normalises venue names to lowercase (`love`, `arkbar`, `hip`) for most routes, but the JSONB column uses `loveBeach` (camelCase) as established in Phase 8.
**How to avoid:** Always write `loveBeach` when building the `fixed_schedules` payload. Confirmed in server.js lines 803–804: `fixedSched.arkbar` and `fixedSched.loveBeach`.
**Warning signs:** Davoted's fixed schedule not appearing in auto-suggest after edit.

### Pitfall 2: Slot strings use en-dash not hyphen
**What goes wrong:** Checkboxes render with hyphen-separated slot labels; on save the payload uses hyphens, breaking slot matching.
**Why it happens:** The UI constants in roster.html use `\u2013` (en-dash) but `innerHTML` may display the glyph — easy to accidentally use a plain hyphen when constructing payloads.
**How to avoid:** Use the existing slot constant arrays directly (`ARKBAR_SLOTS`, etc.) to populate checkboxes and build the save payload. Never reconstruct slot strings from label text.
**Warning signs:** Availability grid shows no pre-loaded state after save/reload.

### Pitfall 3: editDJ does not persist JSONB fields
**What goes wrong:** Sending `recurring_availability` in a `PATCH /api/admin/djs/:id` body silently drops it.
**Why it happens:** `ALLOWED_EDIT_KEYS = ['name', 'rate', 'type', 'active']` — any other key is silently ignored by the `for (const key of ALLOWED_EDIT_KEYS)` loop.
**How to avoid:** New JSONB fields must use the two dedicated routes described above.
**Warning signs:** No error, but DB doesn't update.

### Pitfall 4: Lockout display logic
**What goes wrong:** Showing a lockout badge when `locked_until` is non-null but already expired.
**Why it happens:** `locked_until` stores a future timestamp; if it's in the past the DJ is no longer locked.
**How to avoid:** Compare `new Date(dj.locked_until) > new Date()` before showing the locked badge. Also use `failed_attempts` count as secondary info.

### Pitfall 5: Cache not invalidated after schedule edits
**What goes wrong:** DJ availability responses don't reflect the updated recurring_availability for up to the cache TTL.
**Why it happens:** If the new handlers forget `invalidateCaches('djs')`.
**How to avoid:** Both `updateRecurringAvailability` and `updateFixedSchedules` must call `invalidateCaches('djs')` on success, mirroring all other handlers.

### Pitfall 6: Adding a new DJ without venues/recurring_availability
**What goes wrong:** New DJ row has null `recurring_availability`; server returns `{}` as fallback, so DJ gets no default availability — they won't appear in availability map.
**Why it happens:** `addDJ` only sets `name, rate, type, active, pin_hash` — leaves JSONB columns null.
**How to avoid:** This is expected behaviour (new DJs have no pre-set availability). Document it in UI as "No recurring availability set — edit after creation."

---

## Code Examples

### Fetch DJ List (admin)
```javascript
// Pattern: consistent with all admin fetches in roster.html
async function loadManageDJs() {
  const res = await fetch('/api/admin/djs', {
    headers: { 'x-admin-password': adminPassword }
  });
  const data = await res.json();
  if (!data.success) { showToast(data.error || 'Failed to load DJs', 'error'); return; }
  renderDJTable(data.djs);
}
```

### Deactivate/Reactivate DJ
```javascript
async function toggleDJActive(id, currentActive) {
  const res = await fetch(`/api/admin/djs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ active: !currentActive })
  });
  const data = await res.json();
  if (!data.success) { showToast(data.error || 'Failed', 'error'); return; }
  showToast(currentActive ? 'DJ deactivated' : 'DJ reactivated', 'success');
  loadManageDJs();
}
```

### Save Recurring Availability
```javascript
// Build payload: { recurring_availability: { "0": ["14:00–15:00"], "1": [], ... } }
async function saveRecurringAvailability(djId, availObj) {
  const res = await fetch(`/api/admin/djs/${djId}/recurring-availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
    body: JSON.stringify({ recurring_availability: availObj })
  });
  const data = await res.json();
  if (!data.success) { showToast(data.error || 'Failed to save', 'error'); return; }
  showToast('Availability saved', 'success');
}
```

### Lockout Badge Display
```javascript
function isLocked(dj) {
  return dj.locked_until && new Date(dj.locked_until) > new Date();
}
// Usage in table render:
// const lockBadge = isLocked(dj) ? `<span class="badge-locked">Locked (${dj.failed_attempts})</span>` : '';
```

### Handler Skeleton (lib/admin-dj.js addition)
```javascript
async function updateRecurringAvailability({ id, recurring_availability } = {}) {
  if (!id) return { success: false, error: 'id is required', status: 400 };
  if (recurring_availability === undefined || recurring_availability === null) {
    return { success: false, error: 'recurring_availability is required', status: 400 };
  }
  try {
    const { error } = await supabase
      .from('djs')
      .update({ recurring_availability })
      .eq('id', id);
    if (error) {
      console.error('[updateRecurringAvailability] supabase error:', error.message || error);
      return { success: false, error: 'Failed to update recurring availability' };
    }
    invalidateCaches('djs');
    return { success: true };
  } catch (err) {
    console.error('[updateRecurringAvailability] unexpected error:', err.message || err);
    return { success: false, error: 'Failed to update recurring availability' };
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ALLOWED_EDIT_KEYS` covers only core fields | JSONB schedule fields need dedicated handlers | Phase 10 (this phase) | Two new handlers + routes required |
| `editDJ` handler whitelist | Existing — no change to whitelist | — | Do not add JSONB keys to existing whitelist |
| Hardcoded `FIXED_AVAILABILITY` constant | `recurring_availability` JSONB in `djs` table | Phase 8 | Admin UI now edits DB directly |
| Hardcoded `FIXED_SCHEDULES` constant | `fixed_schedules` JSONB in `djs` table | Phase 8 | Admin UI now edits DB directly |

**Deprecated/outdated:**
- `POST /api/djs/update`: Returns 410 Gone. Any remaining UI references in roster.html must be removed or replaced with `PATCH /api/admin/djs/:id`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^30.3.0 |
| Config file | package.json (`"test": "jest"`) |
| Quick run command | `npm test -- --testPathPattern=admin-dj` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behaviour | Test Type | Automated Command | File Exists? |
|--------|-----------|-----------|-------------------|-------------|
| ADMIN-01 | `listDJs` returns all DJ fields without pin_hash | unit | `npm test -- --testPathPattern=admin-dj` | ✅ `lib/admin-dj.test.js` |
| SCHED-02 | `updateRecurringAvailability` persists JSONB to DB | unit | `npm test -- --testPathPattern=admin-dj` | ❌ Wave 0 — function does not exist yet |
| SCHED-04 | `updateFixedSchedules` persists JSONB to DB | unit | `npm test -- --testPathPattern=admin-dj` | ❌ Wave 0 — function does not exist yet |
| ADMIN-01 | UI renders DJ table with all required columns | manual | Manual browser check | N/A — frontend-only |
| SCHED-02 | Availability grid pre-loads saved state; saving updates DJ portal response | manual | Manual browser check | N/A — frontend-only |
| SCHED-04 | Fixed schedule grid pre-loads Davoted's current data; saving updates auto-suggest | manual | Manual browser check | N/A — frontend-only |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=admin-dj`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (currently 96/96 passing) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Tests for `updateRecurringAvailability` in `lib/admin-dj.test.js` — covers SCHED-02
- [ ] Tests for `updateFixedSchedules` in `lib/admin-dj.test.js` — covers SCHED-04

*(Existing `lib/admin-dj.test.js` already covers `listDJs`, `addDJ`, `editDJ`, `resetPin`, `clearLockout`. New tests extend this file.)*

---

## Open Questions

1. **Should `updateFixedSchedules` validate venue keys?**
   - What we know: Only `arkbar` and `loveBeach` are valid venue keys for `fixed_schedules`. Hip is handled separately.
   - What's unclear: Whether to reject unknown venue keys or silently ignore.
   - Recommendation: Validate at handler level — reject any key not in `['arkbar', 'loveBeach']` with a 400 error.

2. **Should recurring availability UI show all 12 slots or only venue-relevant ones?**
   - What we know: `recurring_availability` is used for the DJ portal default status (available/unavailable). It's slot-agnostic across venues.
   - What's unclear: Whether to show all `ALL_SLOTS` (12) or just the slots for a given venue.
   - Recommendation: Show all slots from `ALL_SLOTS` so the admin sets a comprehensive default; the portal already uses these defaults across all venues.

3. **Does the Add DJ form need a venue selector?**
   - What we know: `addDJ` inserts `venues: []` implicitly (column default). The `venues` array is not currently used for access control — DJ login works independently.
   - What's unclear: Whether `venues` affects anything in the current codebase.
   - Recommendation: Omit `venues` from the add form for now — it appears unused in current routing logic. Can be added later.

---

## Sources

### Primary (HIGH confidence)
- `lib/admin-dj.js` — full handler implementations, ALLOWED_EDIT_KEYS whitelist confirmed
- `server.js` lines 1203–1228 — five admin DJ routes confirmed wired
- `server.js` lines 789–815 — recurring_availability and fixed_schedules read paths confirmed
- `lib/business-logic.js` lines 1–75 — JSONB data structure shapes confirmed (DIAG_FIXED_TEMPLATE)
- `public/roster.html` lines 528–532, 757–762 — tab pattern confirmed
- `public/roster.html` lines 589–603 — slot constants confirmed with en-dash characters
- `.planning/STATE.md` — ALLOWED_EDIT_KEYS whitelist decision, JSONB encoding decision confirmed

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — ADMIN-01, SCHED-02, SCHED-04 definitions
- `lib/admin-dj.test.js` — 33 tests confirmed, no JSONB handler tests exist yet

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — entire codebase is plain Node/Express/vanilla JS, no ambiguity
- Architecture: HIGH — existing tab/fetch/toast patterns directly reusable; JSONB structures confirmed from live code
- Pitfalls: HIGH — loveBeach key naming and en-dash slot normalisation confirmed from source; ALLOWED_EDIT_KEYS whitelist gap confirmed from admin-dj.js source
- New route shapes: HIGH — mirrors five existing routes with identical factory pattern

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable codebase, no external dependencies changing)
