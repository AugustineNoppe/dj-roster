# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- Backend: `server.js` (single monolithic file)
- Frontend HTML: lowercase with hyphens for descriptive purpose (`landing.html`, `index.html`, `roster.html`, `dj.html`)
- No test files currently present

**Functions:**
- camelCase consistently used (e.g., `fetchDJs`, `requireAdmin`, `rateLimiter`, `setStep`)
- Middleware functions use descriptive names with verb prefixes (e.g., `requireAdmin`, `requireDJAuth`, `withVenueLock`)
- Utility functions use action verbs (e.g., `parseDateKey`, `normalizeSlot`, `invalidateRoster`, `makeDateKey`)
- Frontend functions use camelCase (e.g., `buildCal`, `makeDayCard`, `toggleDay`, `refreshBadge`)

**Variables:**
- camelCase for most variables (e.g., `djName`, `moKey`, `moLabel`, `isResident`)
- UPPERCASE_SNAKE_CASE for constants and configuration (e.g., `RESIDENTS`, `ALL_SLOTS`, `MONTH_NAMES`, `FIXED_SCHEDULES`, `RATE_WINDOW_MS`)
- Abbreviated variable names sometimes used in loops and state objects (e.g., `dj`, `dk` for dateKey, `ns` for normalizedSlot, `st` for state, `mo` for month)
- Private module-level state prefixed with underscore (e.g., `_rateCounts`, `_batchLocks`)
- Short single-letter variables used for array iteration (e.g., `r` for row, `d` for day, `m` for month)

**Types (Data Structures):**
- Plain JavaScript objects used for all data structures
- No TypeScript interfaces or classes
- Objects created with curly braces: `{ venue, date, slot, dj, month }`
- Maps and Sets used for caching and lookups (e.g., `cache.availability = new Map()`)

## Code Style

**Formatting:**
- No automated formatter configured (no `.eslintrc`, `.prettierrc`, or `eslint.config.js`)
- Indentation: 2 spaces consistently throughout
- Line length: typically 80-120 characters, no hard limit enforced
- Semicolons: used consistently at statement ends
- Spacing around operators consistent (e.g., `status === 'unavailable'`, `Date.now() - t < RATE_WINDOW_MS`)

**Linting:**
- No linter configured (no ESLint or Biome)
- Code style is maintained by convention rather than automation

## Import Organization

**Server-side (`server.js`):**
```javascript
// 1. Built-in Node.js modules (process, express, path)
const express = require('express');
const path = require('path');

// 2. Third-party libraries
const { createClient } = require('@supabase/supabase-js');

// 3. Configuration and constants follow immediately
const supabase = createClient(...);
const app = express();
```

**Frontend (in HTML `<script>` blocks):**
- No modular imports; all code inline in script tags
- Constants defined at top of script blocks
- Functions defined after constants, in execution order

## Error Handling

**Patterns:**
- Try-catch blocks used in async route handlers to catch database and processing errors
- Errors logged to console using `console.error` with context-specific prefixes (e.g., `[requireDJAuth]`, `[dj/availability]`)
- Error logging includes request context when available (paths, missing fields, values)
- All route handlers return JSON responses with `{ success: boolean, error?: string, ...data }`
- No HTTP status codes used in JSON responses; instead `success: false` indicates failure
- Status codes used only for specific cases: 401 for auth failures, 400 for validation, 429 for rate limit, 500 for server errors

**Example error flow** (`server.js` lines 392-411):
```javascript
app.post('/api/roster/assign', requireAdmin, async (req, res) => {
  try {
    const { venue, date, slot, dj, month } = req.body;
    const normSlot = normalizeSlot(slot);
    if (dj) {
      const { error } = await supabase.from('roster_assignments').upsert(...);
      if (error) throw new Error(error.message);
    }
    invalidateRoster(venue, month);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
```

## Logging

**Framework:** `console` methods (no logging library)

**Patterns:**
- `console.error()` used for all logging (errors, warnings, debug info)
- Prefix format: `[module/function] message` for context (e.g., `[requireDJAuth] pin mismatch`, `[dj/availability] delete error`)
- Sensitive information redacted or formatted safely (e.g., `'pin present:', !!pin` instead of logging pin value)
- Stack traces included when available (e.g., `err.stack || err.message`)
- Server startup logged to indicate successful initialization (`console.log` on line 941)

**Logging locations:**
- Authentication failures: detailed context logged for debugging (`server.js:310-326`)
- Database errors: include error object and sample data (`server.js:616`)
- Major operations: catch-all uncaught exception handler at process level (`server.js:1-3`)

## Comments

**When to Comment:**
- Section headers: `/* == SECTION NAME ===================== */` format used for major logical sections
- Inline comments: sparse, used only for complex algorithms or important business logic
- Comments explain "why", not "what" (code is readable enough that what is self-documenting)
- Example: `// YYYY-MM-DD` format comments mark date parsing conventions
- Fixed schedule comments explain the structure: `// Keys are day-of-week (0=Sun … 6=Sat)` at line 100

**Comments observed:**
- Security headers section (`server.js:14-25`) has clear header markers
- Cache layer explanation (`server.js:122-132`) documents TTL strategy
- Complex state building logic documented with comments (e.g., `// Build per-DJ status lookup from dj_availability:` at line 206)
- No JSDoc/TSDoc format used anywhere

## Function Design

**Size:**
- Functions generally 10-50 lines; longest fetch functions around 70 lines
- Middleware functions 5-15 lines
- Database query functions encapsulate full CRUD operation (query + error handling)

**Parameters:**
- Destructuring used heavily for request bodies: `const { venue, date, slot, dj, month } = req.body`
- Multiple related parameters not grouped into objects (used directly as function parameters)
- Optional parameters indicated by `||` operator: `const ip = req.ip || req.socket.remoteAddress || 'unknown'`
- No default parameters used in function definitions

**Return Values:**
- Route handlers return `res.json()` with status and data
- Cached fetchers return data objects: `{ success: true, ...data }`
- Utility functions return normalized data or null: `parseDateKey()` returns dateString or null
- Most functions return plain objects or arrays, no wrapper classes

## Module Design

**Exports:**
- Single file (`server.js`) exports Express app via implicit side effect
- No explicit module.exports used
- All functions defined as function declarations or const arrow functions in module scope
- Middleware and route handlers directly attached to Express app

**Architecture Pattern:**
- Linear file structure: constants → cache setup → fetcher functions → middleware → routes
- No separation of concerns via files; all concern separation within single file via functions and comments

**Cache Management:**
- Single cache object holds three sub-caches: `cache = { djs, availability, roster, finalized }`
- Each cache entry has: `{ data, time, ttl }`
- Cache invalidation functions like `invalidateRoster()` explicitly delete cache keys
- Per-venue mutex using `_batchLocks` Map for concurrency control (line 151-158)

## Common Patterns

**Data Normalization:**
- Slot times normalized to en-dash format: `normalizeSlot()` converts all dash variants to `\u2013` (line 77)
- Date keys created in YYYY-MM-DD format using `makeDateKey()` helper
- DJ names trimmed and converted to lowercase for case-insensitive lookups: `name.trim().toLowerCase()`

**Defensive Coding:**
- Route handlers check for missing required fields and return early with error response
- Database error objects always checked: `if (error) throw new Error(error.message)`
- Array existence checked before map/filter: `(data || []).map(...)` pattern
- Null coalescing for defaults: `slot || 'unknown'` or `rate || 0`

**Async Patterns:**
- Promise.all used for parallel database queries (e.g., line 195-198, line 847-850)
- Top-level async route handlers with try-catch
- Middleware can be async (e.g., `requireDJAuth` on line 306)
- No async/await in frontend code; uses `.then().catch()` chains

**State Management:**
- Availability state stored in nested objects: `{ dateKey: { slot: status } }`
- Roster assignments stored as 4-element arrays: `[date, normalizedSlot, dj, month]`
- Month validation uses regex: `/^[A-Za-z]+ \d{4}$/` (e.g., "March 2026")

---

*Convention analysis: 2026-03-13*
