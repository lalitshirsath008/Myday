# Architecture

## Overview

```
Browser (React SPA)
   │  httpsCallable('api', { op, payload })  ← Firebase ID token attached automatically
   ▼
Cloud Function `api` (asia-south1)
   │  1. verify token → uid (by Firebase)
   │  2. load users/{uid} → role, accountStatus (server-side, never from the request)
   │  3. dispatch(op): validate input (Zod) → role + scope checks → transaction
   ▼
Firestore (Admin SDK)            Firebase Auth (Admin SDK)
```

### Decision 1: every read and write goes through one server API

The web app never talks to Firestore directly. `firestore.rules` denies all client access.

**Why:** the scoping rules are relational: a manager may read an employee's reports because the *employee's current* `primaryReportingManagerId` or `secondaryReviewerId` points at them. Expressing that in Security Rules would mean many `get()` calls per read, duplicated logic, and rules that are hard to test.

With one server entry point:
- authorization lives in one tested place (`core/src/ops`)
- exports can't bypass scope, because they call the same scoped queries as the list views
- dashboards aggregate on the server instead of streaming thousands of documents to the browser
- tampered clients, crafted requests or changed IDs in a payload can't reach other employees' data (Scenario H, tested)

**Trade-off:** no real-time listeners. Notifications poll every 60 s, which is acceptable for a reporting tool.

### Decision 2: business logic is backend-agnostic (`core/`)

Operations are written against two small interfaces: `Store`, with Firestore semantics including transactions that read before they write, and `AuthAdmin`. There are two implementations:

| | Production | Tests / demo |
|---|---|---|
| Store | `functions/src/firestoreStore.ts` | `core/src/memoryStore.ts` |
| AuthAdmin | `functions/src/adminAuth.ts` (Firebase Admin Auth) | `core/src/authAdmin.ts` `MemoryAuth` (PBKDF2 hashes) |

The 46 automated tests run the real operations end to end on the memory store. The browser demo uses the same code, so it behaves like production. The memory store enforces "no reads after writes in a transaction", which catches code that would break on Firestore.

### Decision 3: tasks are embedded in the daily report and also indexed

- `dailyReports/{id}.tasks[]`: the source of truth, versioned and approved as one unit (at most 10 tasks, well under Firestore's 1 MB limit).
- `tasks/{reportId}_{slot}`: a denormalized index written only on submission or admin correction. It powers project history and per-employee project queries without scanning reports.

### Decision 4: one report per employee per date, enforced transactionally

Report IDs are random. Uniqueness comes from `uniqueKeys/daily_{employeeId}_{date}`, created in the same transaction as the report. This prevents duplicate reports and lets an admin move a report to a corrected date without changing its ID or version history.

The same `uniqueKeys` mechanism enforces unique employee codes, mobile numbers and sign-in emails.

## Data model (Firestore collections)

| Collection | Purpose | Key fields |
|---|---|---|
| `users` | Profile & role (no secrets) | employeeCode, fullName, searchTokens, phoneNumber, officialEmail, authEmail, departmentId, designation, role, primaryReportingManagerId, secondaryReviewerId, accountStatus, joinedAt |
| `departments` | Configurable departments | name, code, active |
| `projects` | Projects / workstreams | name, code, departmentId, ownerId, participantIds, dates, status (PROPOSED/ACTIVE/ON_HOLD/COMPLETED/CANCELLED), priority, milestones |
| `dailyReports` | Daily report + embedded tasks | employeeId, workDate, workingDay, isHolidayWork, tasks[], projectIds, submissionStatus, reviewStatus, awaitingReview, revision, version, submittedAt, submittedLate, viewed/reviewed/approved/returned by+at, needsReReview |
| `tasks` | Task index (submitted content) | reportId, employeeId, workDate, projectId, status, times, progress |
| `weeklyReports` | `{employeeId}_{periodStart}` | calculatedSummary (automatic), narrative (employee-written), dailyReportIds, review fields |
| `reportReviews` | Every review event | reportType, reportId, reviewerId, action (VIEWED/REVIEWED/COMMENTED/APPROVED/RETURNED), comment, reportVersion |
| `reportVersions` | Immutable content snapshots | `{TYPE}_{reportId}_v{n}`, source (EMPLOYEE_SUBMISSION / ADMIN_CORRECTION), actor, reason, snapshot |
| `workCalendar` | Date exceptions | `{date}_{deptId or ALL}`, type HOLIDAY / WORKING_DAY, name |
| `systemSettings/general` | Settings + dated weekly policies | timezone, weekStartDay, deadlines, grace, task slots, reporting roles, categories, notification toggles, calendarPolicies[] |
| `notifications` | In-app notifications | userId, type, title, body, link, read. Deterministic IDs de-duplicate events |
| `auditLogs` | Append-only audit trail | actorId, actorRole, action, entityType, entityId, timestamp, reason, beforeSnapshot, afterSnapshot, requestCorrelationId |
| `activationTokens` | One-time links | ID is the **SHA-256 hash** of the token; the raw token is never stored |
| `registrationRequests` | Self-registration | status PENDING/APPROVED/REJECTED. Carries no role |
| `uniqueKeys` | Uniqueness constraints | code_, phone_, email_, daily_ keys |

All timestamps are ISO-8601 strings generated on the server. Business dates are `YYYY-MM-DD` in the company timezone (default `Asia/Kolkata`). Composite indexes are in `firestore.indexes.json`.

## Workflows

**Daily report:** draft → submit (version 1, review status PENDING_REVIEW, reviewers notified) → reviewer opens it (VIEWED, never approval) → REVIEWED / APPROVED / RETURNED (a reason is required).

- After a return, the employee edits and resubmits, which creates version 2.
- An approval names the version it applies to, so a stale approval of version 1 is rejected once version 2 exists.
- Employees can edit only drafts and returned reports.
- A save must carry the `expectedRevision` the client last saw. This optimistic concurrency check rejects duplicate submissions and stale overwrites.

**Weekly report:**
- `computeWeeklySummary` builds the automatic part from submitted daily reports and the work calendar: working days, submitted vs missing dates, task counts, project breakdown and collaborators.
- It is recomputed on the server on every save.
- The employee writes the narrative.
- Submission opens on the last working day of the period.

**Administrative correction:**
- Creates a new version marked `ADMIN_CORRECTION`, with the reason, the previous snapshot preserved, and before/after values in the audit log.
- It can move a report to a corrected date.
- If the report was approved and `reReviewOnAdminCorrection` is on, it returns to the review queue with `needsReReview`.

## Work calendar

`resolveWorkingDay(date)` checks, in order of precedence:
1. a **department exception**
2. a **company exception**
3. the **weekly policy in effect on that date**

Wednesday is not hardcoded. The seeded default policy (Sunday, Monday, Tuesday, Thursday, Friday, Saturday) can be changed. Policy changes take effect from a future date, and past dates are locked, so historical compliance never changes after the fact.

## Metric definitions

| Metric | Definition |
|---|---|
| Expected daily report | A working day (calendar + department) on which the user is in a reporting role, has joined and is not deactivated, **once its deadline has passed**, or earlier if a report was submitted |
| Compliance % | submitted ÷ expected. Late = submitted after deadline + grace. Holidays never count as missing |
| Tasks planned | Task records in submitted reports (one per task per day) |
| Pending | Status PLANNED (not started) |
| Overdue | **Latest record** of a work item (employee + project + normalized title, last 30 days) that is not completed and has an explicit due date earlier than today. Tasks without a due date are never overdue |
| Active days | Distinct dates with ≥ 1 task on the project. Not the task count |
| Elapsed calendar days | First to latest activity, inclusive. Does not imply continuous work |
| Recorded duration | Actual start/end times only. Overlapping intervals are merged per employee per day. Marked COMPLETE / PARTIAL / UNAVAILABLE |

No composite "performance score" or ranking is computed. The UI states that activity counts don't measure work quality.

## Security

- **Identity:** Firebase Auth. Users sign in with an employee code or mobile number. The server maps it to the auth email: the official email, or a non-deliverable `@users.rgk-worktrack.invalid` address. Unknown identifiers return a fake address, so the login error is identical and accounts can't be enumerated.
- **Passwords:** never stored in Firestore or the audit log, and never readable by admins. A Super Admin creates an account with an initial password (typed or generated); the account is active immediately, and by default the employee must choose their own password at first sign-in. Admins can set a new password later ("Set new password"), which signs out the user's other sessions. Employees with an official email can also use Firebase's built-in reset email. One-time activation links remain only for the very first Super Admin created by the bootstrap script.
- **Deactivation** disables the Firebase user and revokes refresh tokens. The API also refuses any non-ACTIVE profile on every call.
- **Role escalation:** self-registration has no role field. Role changes are Super Admin only, audited, and protected: you can't change your own role, the last Super Admin can't be removed, and a manager who still has reportees can't be demoted. Circular reporting lines are rejected.
- **Logging:** unexpected errors are logged with the operation name, uid and correlation ID only, never payloads, which may contain passwords.
- **Exports** neutralize spreadsheet formula injection and are audited.
- **Hosting** sends `X-Frame-Options`, `nosniff`, HSTS and `Referrer-Policy` headers.
