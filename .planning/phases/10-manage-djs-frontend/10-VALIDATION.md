---
phase: 10
slug: manage-djs-frontend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^30.3.0 |
| **Config file** | package.json (`"test": "jest"`) |
| **Quick run command** | `npm test -- --testPathPattern=admin-dj` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=admin-dj`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 0 | SCHED-02 | unit | `npm test -- --testPathPattern=admin-dj` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 0 | SCHED-04 | unit | `npm test -- --testPathPattern=admin-dj` | ❌ W0 | ⬜ pending |
| 10-XX-XX | XX | 1 | ADMIN-01 | unit | `npm test -- --testPathPattern=admin-dj` | ✅ `lib/admin-dj.test.js` | ⬜ pending |
| 10-XX-XX | XX | 1 | ADMIN-01 | manual | Manual browser check | N/A | ⬜ pending |
| 10-XX-XX | XX | 1 | SCHED-02 | manual | Manual browser check | N/A | ⬜ pending |
| 10-XX-XX | XX | 1 | SCHED-04 | manual | Manual browser check | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Tests for `updateRecurringAvailability` in `lib/admin-dj.test.js` — covers SCHED-02
- [ ] Tests for `updateFixedSchedules` in `lib/admin-dj.test.js` — covers SCHED-04

*(Existing `lib/admin-dj.test.js` already covers `listDJs`, `addDJ`, `editDJ`, `resetPin`, `clearLockout`. New tests extend this file.)*

---

## Manual-Only Verifications

| Behaviour | Requirement | Why Manual | Test Instructions |
|-----------|-------------|------------|-------------------|
| UI renders DJ table with all required columns | ADMIN-01 | Frontend-only, no server-side rendering | Open roster.html as admin, verify table columns |
| Availability grid pre-loads saved state | SCHED-02 | Browser interaction required | Edit DJ availability, reload, verify state persists |
| Fixed schedule grid pre-loads Davoted's data | SCHED-04 | Browser interaction required | Open Davoted's fixed schedule, verify pre-populated slots |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
