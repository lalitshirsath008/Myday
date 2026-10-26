# Production deployment

Nothing has been deployed yet. These steps need your Firebase project and Google Cloud credentials.

## 1. Create the Firebase project

1. In the Firebase Console, create a project. Use the **Blaze** plan; Cloud Functions require it.
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Firestore:** create the database in production mode. Use the `asia-south1` (Mumbai) region to match the functions.
4. **Project settings → Your apps:** add a **Web app** and note its config values.
5. *(Optional, recommended)* Set up **App Check** with reCAPTCHA Enterprise, then set the function parameter `ENFORCE_APP_CHECK=true`. This protects the public operations (login lookup, registration requests) from scripted abuse.

## 2. Configure

```bash
npm i -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc          # put your project id in it
cp web/.env.example web/.env.production.local
```

Fill in `web/.env.production.local`:
- `VITE_BACKEND=firebase`
- the four `VITE_FIREBASE_*` values from step 1

These values are public identifiers, not secrets. Access is protected by Auth and the server API.

When you first deploy functions, the CLI asks for these parameters (stored in `functions/.env.<project>`):
- `APP_URL`: the public URL of the app, e.g. `https://<project>.web.app`. Used in activation links.
- `ENFORCE_APP_CHECK`: `false` until App Check is configured.

## 3. Deploy

```bash
npm ci
npm run check                     # typecheck, lint, tests, build
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

Index creation can take a few minutes after the first deploy.

**Desktop app download (optional).** To offer the Windows "My day" app in the My day drawer, build it for the live address *before* deploying hosting:
set `desktop/config.json` → `"appUrl": "https://task-8861a.web.app"`, then run `npm install --prefix desktop` and `npm run dist --prefix desktop`.
This copies the installer into `web/public/downloads/`, so it is deployed with the site. The drawer only offers an installer built for the site's own address.
See [desktop/README.md](../desktop/README.md).

## 4. Create the first Super Admin

```bash
gcloud auth application-default login
GCLOUD_PROJECT=<project-id> APP_URL=https://<project>.web.app \
  npm run bootstrap-admin -w functions -- --code SA001 --name "Full Name" --phone 98XXXXXXXX --email you@rgkgroup.net --department IT
```

The script prints a one-time activation link. Open it to set the password. It refuses to run if a Super Admin already exists. Everything else is managed in the app:

1. departments
2. projects
3. calendar exceptions
4. users: create each user and share their activation link

## 5. Password reset emails (optional)

Employees with an official email can use **Forgot password**, which sends Firebase's built-in reset email.

- To use the app's own page, go to Authentication → Templates → Password reset → *Customize action URL* and set it to `https://<your-host>/reset-password`.
- Employees without an email get a set-password link from the Super Admin (User management → Password reset link).

## Operations notes

- The `reminders` function runs hourly at :05 IST. It sends notifications only within the configured reminder hour and de-duplicates them.
- **Email/SMS delivery is not configured.** Notifications are in-app only. To add email, use a server-side provider such as the Firebase "Trigger Email" extension, triggered from notifications. The app never claims an email was sent.
- **Backups:** enable Firestore point-in-time recovery or scheduled exports. Audit logs are append-only in the app, but database-level retention is your responsibility.
