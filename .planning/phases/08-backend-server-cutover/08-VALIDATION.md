---
phase: 8
slug: backend-server-cutover
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (package.json `"test": "jest"`) |
| **Config file** | None — Jest uses defaults |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~0.3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + manual smoke test of DJ login + Davoted portal availability
- **Max feedback latency:** 1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-xx-01 | TBD | TBD | SCHED-01 | unit | `npm test -- --testNamePattern "recurring_availability"` | ❌ W0 | ⬜ pending |
| 08-xx-02 | TBD | TBD | SCHED-03 | unit | `npm test -- --testNamePattern "fixedSchedules from DB"` | ❌ W0 | ⬜ pending |
| 08-xx-03 | TBD | TBD | SCHED-05 | grep | `grep -r "FIXED_AVAILABILITY\|FIXED_SCHEDULES\|RESIDENTS" server.js lib/` exits 1 | N/A | ⬜ pending |
| 08-xx-04 | TBD | TBD | STAB-01 | unit | `npm test -- --testNamePattern "lockout persistence"` | ❌ W0 | ⬜ pending |
| 08-xx-05 | TBD | TBD | STAB-02 | unit | `npm test -- --testNamePattern "lockout DB"` | ❌ W0 | ⬜ pending |
| 08-xx-06 | TBD | TBD | STAB-03 | manual grep | Verify each `supabase.from` inside try-catch | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/business-logic.test.js` — add test: `buildAvailabilityMap` with DB-shaped fixedSchedules (string keys) produces identical output to constant-shaped (integer keys)
- [ ] `lib/business-logic.test.js` — update existing tests that import `FIXED_SCHEDULES` constant to pass fixture data instead (required before constant removal)
- [ ] New lockout tests — add tests for DB-backed lockout functions (within existing suite or new `lib/lockout.test.js`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DJ login works after migration | SCHED-01 | Needs live Supabase + running server | Start server, log in as 2 DJs with existing PINs |
| Davoted portal shows pre-populated availability | SCHED-03 | Needs live Supabase + running server | Log in as Davoted, check availability grid |
| Try-catch coverage complete | STAB-03 | Grep verification, not unit-testable | `grep -n "supabase.from" server.js` — verify each in try-catch |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
