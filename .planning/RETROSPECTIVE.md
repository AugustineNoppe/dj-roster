# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Production Readiness

**Shipped:** 2026-03-19
**Phases:** 6 | **Plans:** 13

### What Was Built
- Auto-suggest block enforcement with decision logging across 3 venue passes
- Data integrity verification: slot normalization, timestamp-ordered sign-offs, accounting audit
- bcrypt PIN/password hashing with account lockout and credential scrubbing
- helmet + express-rate-limit replacing custom implementations (fixed memory leak)
- Centralized cache invalidation with dependency-aware clearing
- 49 Jest tests for extracted business logic module
- Dead code elimination and tech debt cleanup

### What Worked
- Investigation-first approach for Phase 1 (auto-suggest): root cause was found quickly via diagnostic endpoint, enabling targeted fixes
- Wave-based parallel execution for independent plans within phases
- Code verification caught 3 false positives in the milestone audit — prevented unnecessary rework
- Extracting business logic to lib/ made testing straightforward without Express overhead

### What Was Inefficient
- Phase 1 plans 01-02 and 01-03 were executed outside GSD workflow, causing audit to report them as unexecuted (false positives)
- Audit needed manual code verification to correct — automated checks relied on SUMMARY.md presence rather than code state
- STATE.md metrics drifted from reality (showed 7% progress with 85% actually complete)

### Patterns Established
- `.every()` block enforcement pattern for all-or-nothing DJ scheduling across venue passes
- `console.group`/`console.groupEnd` structured logging for algorithm passes
- `normalizeSlot()` canonicalization on both save and read paths
- Centralized `invalidateCaches()` with dependency graph documentation
- Business logic in `lib/` with Jest test coverage, server.js imports from lib

### Key Lessons
1. Always verify code state before treating audit gaps as real — summaries and verification files can lag behind actual implementation
2. DJ change-pin was intentionally removed — design decisions should be documented clearly to prevent re-implementation
3. bcrypt env var hashes work well for admin/manager passwords — eliminates plaintext secrets in environment

### Cost Observations
- Model mix: ~30% opus (orchestration), ~70% sonnet (execution/verification)
- Notable: Single-plan phases (Phase 6) execute very efficiently with sonnet agents

---

## Milestone: v2.0 — DJ Management & Supabase Consolidation

**Shipped:** 2026-03-21
**Phases:** 5 | **Plans:** 10

### What Was Built
- Single `djs` table with JSONB fields replacing dj_rates + dj_pins — full data migration with en-dash deduplication
- All server routes cut over to `djs` table — hardcoded DJ arrays eliminated, lockout persisted to DB
- Admin DJ management API: 7 endpoints (add/edit/deactivate/reactivate/PIN reset/lockout clear/schedules) with factory pattern
- Manage DJs frontend tab: DJ table, CRUD forms, recurring availability checkbox grid, fixed schedule venue/day/slot grids
- Integration gap closure: auth select `id`, CORS methods, stale comment cleanup, unchecked error fix

### What Worked
- Factory pattern (lockout.js, admin-dj.js) with injected dependencies enabled 62 new unit tests without Express overhead
- Milestone audit after Phase 10 caught two real integration issues (INT-01, INT-02) — Phase 11 closed both cleanly
- TDD approach for JSONB schedule handlers (Phase 10-01) prevented bugs in complex validation logic
- Clean cutover strategy (no dual-write) kept migration simple — migrate, verify, drop old tables

### What Was Inefficient
- Milestone audit was run before Phase 11 existed — the `tech_debt` status caused a re-check cycle that could have been avoided if audit ran after all planned work
- ROADMAP.md plan checkboxes for Phases 9-10 were not updated to `[x]` during execution — cosmetic but caused confusion during audit
- Nyquist validation tracking was partial across all phases — formal wave coverage not tracked despite 111 tests existing

### Patterns Established
- `createXHandlers(supabase, bcrypt, invalidateCaches)` factory pattern for testable server modules
- JSONB field handlers as separate endpoints from scalar field handlers (different validation needs)
- 410 Gone for permanently deprecated endpoints (clear signal vs 404)
- Milestone audit → gap closure phase → re-verify pattern for quality assurance
- PIN reset: admin inputs new PIN, server hashes — one-time display with Copy button in UI

### Key Lessons
1. Run milestone audit after all planned work completes, not before — avoids false-positive gap reports
2. Factory pattern with injected deps is the right abstraction for Supabase-dependent modules — test without mocking the HTTP layer
3. JSONB is excellent for flexible per-DJ configuration (availability, schedules) — no schema changes needed for new fields
4. Dedicated gap-closure phases (Phase 11) are low-cost and high-value — small scope, big impact on quality confidence

### Cost Observations
- Model mix: ~25% opus (orchestration/audit), ~75% sonnet (execution/verification)
- Sessions: ~8 sessions across 2 days
- Notable: Phase 11 (single plan, 4 targeted fixes) completed in one session — very efficient for gap closure

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 6 | 13 | First milestone — established GSD workflow patterns |
| v2.0 | 5 | 10 | Factory pattern for testable modules, milestone audit → gap closure cycle |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v1.0 | 49 | 15/15 requirements satisfied |
| v2.0 | 111 | 20/20 requirements satisfied, 2 integration gaps closed |

### Top Lessons (Verified Across Milestones)

1. Investigation-first phases save time when root cause is unknown
2. Code verification trumps documentation — always check the actual codebase
3. Factory pattern with injected deps enables high test coverage without mocking HTTP — validated across lockout.js and admin-dj.js
4. Milestone audits catch real integration issues — but run them after all planned work completes
