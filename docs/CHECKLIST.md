# Development checklist & status

Status as of 25 Oct 2026. ✅ = implemented and verified by automated tests or the browser run · 🟡 = implemented, not verified in this environment · ⬜ = not implemented.

## Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` (core, functions, web: strict) | ✅ pass |
| `npm run lint` (web) | ✅ 0 errors, 0 warnings |
| `npm test`: 46 unit + workflow tests on the real operations | ✅ 46/46 |
| `npm run build`: functions bundle + web production build | ✅ pass |
| Browser end-to-end run in Microsoft Edge (demo backend): every route for all four roles, Scenarios A, B, D, E, F, G, H, I, mobile (390 px) layout | ✅ 68/68 checks, 0 console errors, no horizontal overflow |
| Firestore rules tests (`functions/test/rules.test.ts`) | 🟡 written, **not run**: needs the Firestore emulator (Java 21+, not installed) |
| Functions against real Firestore / emulator | 🟡 not run (same reason). The Firestore adapter typechecks and bundles; logic is covered via the memory store |
| Production deployment | ⬜ not deployed: needs your Firebase project (see DEPLOYMENT.md) |

## UI/UX redesign (mobile-first)

| Item | Status |
|---|---|
| Poppins typography, orange design tokens (`web/src/index.css`), 16–28 px radii, soft shadows, light + dark | ✅ |
| Accessible orange: bright `#FC8019` for accents only; buttons/links use `#C8530A` (4.55:1 with white) | ✅ |
| Mobile bottom navigation (4 items per role, safe-area aware); slim collapsible light sidebar on desktop | ✅ |
| Employee home: greeting, "Today's work" card with progress + one primary action, 3 counters, manager card, recent activity | ✅ |
| Daily tasks: tabbed task cards, essential fields first, "More details" for the rest, sticky Save/Submit bar | ✅ |
| Report history / weekly / projects / notifications as compact cards with chip filters and a filter sheet | ✅ |
| Manager "My team" with quick filters and employee cards; review screen with Approve / Request changes | ✅ |
| Management "Company overview" with 4 headline numbers, department focus, pending work; details expandable | ✅ |
| Super Admin home grouped into People, Organization, Reports, Calendar, Settings | ✅ |
| Tables become cards on phones; calendar date details in a bottom sheet | ✅ |
| Browser run after redesign: 72/72 checks, 0 console errors, no horizontal overflow at 390 px | ✅ |

## Business requirements

| # | Requirement | Status |
|---|---|---|
| 1 | Accounts: admin-created + activation link, self-registration pending approval, unique code/mobile, no plaintext passwords | ✅ |
| 2 | Three primary task slots (configurable; optional additional tasks) | ✅ |
| 3 | Task fields incl. planned/actual times, collaborators, project, category, due date, progress, status | ✅ (attachments ⬜) |
| 4 | Weekly reports auto-compiled from daily reports + calendar, narrative, review | ✅ |
| 5 | Manager review: viewed ≠ approved, reviewed/approved/returned (reason required), version-safe | ✅ |
| 6 | Employee sees pending / viewed / approved / returned | ✅ |
| 7 | Management company-wide read-only analytics, departments, compliance, pending work | ✅ |
| 8 | Global search (name, code, department, designation, manager, project) with autocomplete | ✅ |
| 9 | Super Admin: users, roles, hierarchy, departments, projects, calendar, settings, corrections | ✅ |
| 10 | Audit trail of sensitive actions, before/after snapshots, reasons | ✅ |
| – | Work calendar: Wednesday not hardcoded, date & department exceptions, dated policies, past locked | ✅ |
| – | Project history: first/latest, active days ≠ tasks ≠ elapsed days, merged durations | ✅ |
| – | Notifications: submission, review outcome, feedback, review requested, overdue, deadline, activation, reassignment; de-duplicated; configurable | ✅ in-app |
| – | Exports: CSV, Excel-compatible (.xls), print / save as PDF; scoped and audited | ✅ |
| – | Greeting by local time, quote on login, light & dark mode, responsive | ✅ |

## Known limitations & remaining configuration

1. **Attachments are not implemented.** The prompt marks them optional. They would need Firebase Storage, Storage rules and virus-scanning policy.
2. **No email/SMS delivery.** Notifications are in-app; activation links are shared by the admin. Firebase's built-in reset email works for users who have an official email.
3. **PDF export uses the browser's Print / Save as PDF** with print styles. There is no server-generated PDF.
4. **Scale limits (deliberate guards):**
   - analytics ranges of up to 92 days
   - list scans capped at 5,000 reports
   - company analytics at 20,000 reports per request
   - in-memory directory filtering for up to 5,000 users

   This suits a company of a few hundred to a couple of thousand employees. Beyond that, add pre-aggregated daily statistics (the `core` design allows this without UI changes).
5. **Fixed role matrix.** The four roles' permissions are defined in code, not editable per role in the UI; user role *assignment* is fully managed in the UI.
6. **Saved filter presets** are not implemented. Date presets (this week, last month, …) are.
7. **Account history:** deactivation and reactivation keep only the latest `deactivatedAt`, so a gap between two employment periods is treated as active for compliance.
8. **Audit log paging** uses a timestamp cursor. Two events in the same millisecond on a page boundary could be skipped in the viewer; the records themselves are intact.
9. **Demo mode** stores data in browser localStorage and must never be used for real data. Production builds default to Firebase and show a setup screen if it isn't configured.
10. `npm install` reports some audit advisories in transitive dev dependencies. These have not been triaged yet.
