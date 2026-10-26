# RGK Myday

Employee Productivity & Reporting Management System for **RGK Group of Industries**. It replaces the Excel-based daily task sheets with:

- structured daily reports (three priority tasks per day)
- weekly reports compiled automatically from those daily reports
- review and approval by Reporting Managers
- project tracking
- read-only analytics for Management
- a Super Admin workspace with full audit logging

| Part | Path | Tech |
|---|---|---|
| Business logic & server operations | `core/` | TypeScript, Zod (runs in Cloud Functions, tests and demo mode) |
| Backend | `functions/` | Firebase Cloud Functions v2 (single `api` callable + hourly reminders), Firestore Admin SDK |
| Web app | `web/` | React 19, Vite, Tailwind CSS 4, TanStack Query, React Hook Form + Zod, Recharts, Radix UI, Lucide |
| Database config | `firestore.rules`, `firestore.indexes.json`, `firebase.json` | Firestore, Firebase Auth, Hosting |

## Quick start (demo mode, no Firebase needed)

```bash
npm install
npm run dev            # http://localhost:5173
```

`npm run dev` uses the **demo backend**. It runs the real server code in the browser against fictional test data that is stored only in that browser. A banner on every page marks it as demo mode. Sign in with any of these test accounts, all with password `Test@1234`:

| Code | Role |
|---|---|
| `SA001` | Super Admin |
| `MG001` | Management |
| `RM101`, `RM102` | Reporting Manager |
| `EMP201` … `EMP206` | Employee (mobile numbers `9000000201` … also work) |

Use **Reset demo data** in the banner to start over.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Business-logic and workflow tests (`core/test`, 52 tests) |
| `npm run typecheck` | Strict TypeScript for core, functions, web |
| `npm run lint` | ESLint for the web app |
| `npm run build` | Bundle functions (`functions/lib`) and build the web app (`web/dist`) |
| `npm run check` | All of the above |
| `npm run test:rules` | Firestore rules tests. Needs the emulator (Java 21+): `firebase emulators:exec --only firestore "npm run test:rules"` |
| `npm run seed:emulator` | Load the same test data into running local emulators |
| `npm run desktop` | Start the desktop “My day” tab ([desktop/README.md](desktop/README.md)) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design decisions, data model, metric definitions, security model
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md): role–permission matrix and scope rules
- [docs/SETUP.md](docs/SETUP.md): local development with the Firebase emulators
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment and first Super Admin
- [docs/CHECKLIST.md](docs/CHECKLIST.md): feature checklist, test results, known limitations
- [desktop/README.md](desktop/README.md): the Windows desktop app (My day tab on the screen edge)
