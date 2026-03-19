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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 6 | 13 | First milestone — established GSD workflow patterns |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v1.0 | 49 | 15/15 requirements satisfied |

### Top Lessons (Verified Across Milestones)

1. Investigation-first phases save time when root cause is unknown
2. Code verification trumps documentation — always check the actual codebase
