---
phase: 9
slug: admin-dj-management-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^30.3.0 |
| **Config file** | `package.json` — `"test": "jest"` |
| **Quick run command** | `npx jest lib/` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest lib/`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | ADMIN-02 | unit | `npx jest lib/admin-dj.test.js -x` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | ADMIN-03 | unit | `npx jest lib/admin-dj.test.js -x` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | ADMIN-04, ADMIN-05 | unit | `npx jest lib/admin-dj.test.js -x` | ❌ W0 | ⬜ pending |
| 09-01-04 | 01 | 1 | ADMIN-06 | unit | `npx jest lib/admin-dj.test.js -x` | ❌ W0 | ⬜ pending |
| 09-01-05 | 01 | 1 | ADMIN-07 | unit | `npx jest lib/lockout.test.js -x` | ✅ | ⬜ pending |
| 09-01-06 | 01 | 1 | ADMIN-08 | unit | `npx jest lib/admin-dj.test.js -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/admin-dj.test.js` — stubs for ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-08
- [ ] Handler logic extracted into testable functions using factory pattern (like lockout.js)

*Existing `lib/lockout.test.js` (18 tests) already covers clearFailedAttempts for ADMIN-07.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deactivated DJ disappears from dropdowns | ADMIN-04 | Requires browser DOM | Admin deactivates DJ → refresh roster → DJ absent from all dropdowns |
| Reactivated DJ appears in dropdowns | ADMIN-05 | Requires browser DOM | Admin reactivates DJ → refresh roster → DJ present in dropdowns |
| Cache invalidation timing | ALL | Timing-dependent | Make admin change → verify DJ list updates within 10s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
