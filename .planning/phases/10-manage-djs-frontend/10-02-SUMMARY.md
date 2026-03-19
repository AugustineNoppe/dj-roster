---
phase: 10-manage-djs-frontend
plan: "02"
subsystem: frontend
tags: [ui, admin, manage-djs, crud, roster-html]
dependency_graph:
  requires: ["10-01"]
  provides: ["manage-djs-tab", "dj-crud-ui"]
  affects: ["public/roster.html"]
tech_stack:
  added: []
  patterns: ["fetch + showToast pattern", "inline modal overlay", "badge CSS pattern"]
key_files:
  created: []
  modified:
    - public/roster.html
decisions:
  - "manageDJs module-level variable stored so Plan 03 availability editing can reference DJ data without re-fetching"
  - "mainContent hidden and manageContent shown when switching to manage tab; reversed on loadAll/loadHours"
  - "Availability and Fixed Schedule buttons rendered as disabled stubs with showToast('Coming soon') for Plan 03"
  - "openEditDJModal uses JSON.stringify + data attribute pattern to pass DJ object safely to modal"
metrics:
  duration_minutes: 12
  completed_date: "2026-03-19"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 10 Plan 02: Manage DJs Frontend Summary

**One-liner:** Manage DJs tab with full DJ table, add form, edit modal, and CRUD action buttons wired to Phase 9 admin API endpoints.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Manage DJs tab button and switchVenue support | a9947f0 | public/roster.html |
| 2 | DJ table, Add DJ form, Edit modal, and action buttons | ec85f02 | public/roster.html |

## What Was Built

**Task 1** added the fourth venue tab "Manage DJs" with:
- Tab button with orange active border (`.venue-tab.manage.active{border-bottom-color:#ff9800}`)
- Full CSS block: manage table, badges (active/inactive/locked), action buttons, add form, edit modal overlay
- `switchVenue` updated: handles `manage` venue, hides status bar and hours sidebar toggle, guards against unauthenticated access
- `manageContent` div container added to HTML body
- `loadAll()` and `loadHours()` restore `mainContent` visibility and hide `manageContent`

**Task 2** added all JavaScript functions:
- `loadManageDJs()` — fetches `GET /api/admin/djs` with admin header, shows spinner, calls `renderManageDJs`
- `renderManageDJs(djs)` — builds add form and DJ table (Name, Rate, Type, Status, Lockout, Actions columns)
- `isLocked(dj)` — helper: `dj.locked_until && new Date(dj.locked_until) > new Date()`
- `addNewDJ(e)` — `POST /api/admin/djs` then refreshes table
- `openEditDJModal(dj)` — creates inline overlay with pre-filled Name/Rate/Type inputs
- `saveEditDJ(id)` — `PATCH /api/admin/djs/:id` with name/rate/type
- `toggleDJActive(id, currentActive)` — `PATCH /api/admin/djs/:id` with `active: !currentActive`
- `resetDJPin(id, name)` — `POST /api/admin/djs/:id/pin` via `prompt()`
- `clearDJLockoutUI(id, name)` — `DELETE /api/admin/djs/:id/lockout`
- Module-level `let manageDJs = []` for Plan 03 availability editing

## API Endpoints Wired

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | /api/admin/djs | loadManageDJs |
| POST | /api/admin/djs | addNewDJ |
| PATCH | /api/admin/djs/:id | saveEditDJ, toggleDJActive |
| POST | /api/admin/djs/:id/pin | resetDJPin |
| DELETE | /api/admin/djs/:id/lockout | clearDJLockoutUI |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**One minor addition (Rule 2):** Added `$('mainContent').style.display = ''` at the top of `loadAll()` and `loadHours()` to restore mainContent visibility when switching away from the manage tab. The plan specified hiding mainContent but did not specify restoring it; this was a correctness requirement to prevent the roster from being invisible after visiting the manage tab.

## Verification

- `npm test`: 111/111 tests passing (no regressions — backend unchanged)

## Self-Check: PASSED

- `public/roster.html` modified: exists
- Commit a9947f0 exists (Task 1)
- Commit ec85f02 exists (Task 2)
