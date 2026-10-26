# Local development

## Requirements

- Node.js 22+ (developed on Node 24)
- For the Firebase emulators only: Java 21+ and the Firebase CLI (`npm i -g firebase-tools`)

## Option A: demo backend (no Firebase, no Java)

```bash
npm install
npm run dev
```

The browser runs the same server operations against fictional data stored in that browser's localStorage. Use it for UI work and demonstrations.

## Option B: Firebase emulators (real Firestore/Auth/Functions locally)

```bash
npm install
npm run build -w functions                      # bundle functions to functions/lib
firebase emulators:start --project demo-rgk-worktrack
# in a second terminal:
npm run seed:emulator                           # loads the fictional test data
```

Create `web/.env.development.local`:

```
VITE_BACKEND=firebase
VITE_USE_EMULATORS=true
VITE_FIREBASE_PROJECT_ID=demo-rgk-worktrack
VITE_FIREBASE_API_KEY=demo-key
```

Then run `npm run dev`. Sign in as `SA001` / `Test@1234` (see README for other accounts). The Emulator UI is at http://localhost:4000.

Rules tests: `firebase emulators:exec --only firestore --project demo-rgk-worktrack "npm run test:rules"`.

## Project layout

```
core/        business logic, schemas, permissions, metrics, all API operations, seed data, tests
functions/   Cloud Functions entry (api, reminders), Firestore/Auth adapters, seed & bootstrap scripts
web/         React app (pages per role in src/pages, shared components in src/components)
docs/        architecture, permissions, setup, deployment, checklist
```

To add an API operation:
1. Define it in `core/src/ops/*.ts` with `op({ input: zodSchema, run })`.
2. Register it in `core/src/ops/index.ts`.
3. Call it from the web app with `useOp('name', input)` or `useOpMutation('name')`; the call is fully typed end to end.
4. Add any new composite query to `firestore.indexes.json`.
