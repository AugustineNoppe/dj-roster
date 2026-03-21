---
phase: 7
slug: database-schema-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^30.3.0 |
| **Config file** | package.json `"test": "jest"` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | DB-01 | manual-only | SQL: `SELECT column_name FROM information_schema.columns WHERE table_name='djs'` | N/A | ⬜ pending |
| 07-01-02 | 01 | 1 | DB-02 | manual-only | Migration script verification output + manual PIN test | N/A | ⬜ pending |
| 07-01-03 | 01 | 1 | DB-03 | manual-only | Migration script output; spot-check JSONB via SQL Editor | N/A | ⬜ pending |
| 07-01-04 | 01 | 1 | DB-04 | manual-only | Human runs drop-legacy-tables.sql after confirming criteria 1–5 | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test files need to be created for Phase 7 — all verification is manual inspection of the database. The existing 49-test Jest suite must remain green throughout.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `djs` table exists with correct columns | DB-01 | Schema creation via Supabase SQL Editor | Run CREATE TABLE SQL, verify columns via `information_schema.columns` |
| All DJs migrated, no duplicates, PINs match | DB-02 | Data migration against live Supabase | Run migration script, verify row count, test PIN login for each DJ |
| JSONB fields match hardcoded constants | DB-03 | JSONB content comparison | Spot-check `recurring_availability` for known DJs (e.g., Mostyx), compare to FIXED_AVAILABILITY |
| Old tables dropped after manual verification | DB-04 | Intentionally manual — safety gate | Operator runs `drop-legacy-tables.sql` only after confirming criteria 1–5 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
