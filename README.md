# nilusDO

Tasks, focus and time tracking, styled to match nilusCap. Hosted on Firebase at **https://nilusdo.web.app**.

## Layout
```
public/              ← everything that gets deployed
  index.html         page shell: login, sidebar, top bar, views
  app.css            design (same tokens/components as nilusCap)
  app.js             all app logic + router
  firebase-config.js Firebase project settings (tasklist-1f1bd)
  theme-init.js      applies saved light/dark theme before first paint
  manifest.webmanifest, icons   installable app (Add to Home Screen / Install)
firebase.json        hosting config (sites "nilusdo" + "nilusdo-app", serve public/, all URLs → index.html)
database.rules.json  Realtime Database rules (two-step sign-in required)
.firebaserc          default Firebase project
```

## URLs
`/` Focus · `/all` All tasks · `/c/<categoryId>` a category · `/plan` Daily plan · `/report` Time report ·
`/settings` Settings · `/login` · `/forgot-password`

## Deploy
```bash
firebase deploy --only database,hosting
```
Deploys the database rules and both sites (nilusdo.web.app and nilusdo-app.web.app). No build step. Data lives in the Firebase Realtime Database, so deploying never touches your tasks.

## Run locally
```bash
firebase serve --only hosting     # http://localhost:5000
```

## Accounts
Public sign-up is switched off (Firebase Auth `disabledUserSignup`), so nobody can create an account on their own; the
app only offers sign-in and password reset. To add someone: Firebase console → project `tasklist-1f1bd` →
**Authentication** → **Users** → **Add user**, then enter their email and a password.

## Two-step sign-in
Every sign-in needs the password **and** a 6-digit code from an authenticator app (Apple Passwords, Google
Authenticator, 1Password… — TOTP, free; no SMS). The database rules (`database.rules.json`) refuse anyone whose sign-in
skipped the code, so the data can't be read with just a password.

The first time an account signs in, the app asks it to confirm its email address, then shows a QR code to scan; after
typing one code, the account signs out and signs in again with password + code.

**Lost phone?** Clear the account's authenticator so it gets the setup screen again at the next sign-in:
```bash
TOKEN=$(gcloud auth print-access-token)
API=https://identitytoolkit.googleapis.com/v1/projects/tasklist-1f1bd
# 1. find the account's uid (localId)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: tasklist-1f1bd" \
  -H "Content-Type: application/json" $API/accounts:lookup -d '{"email":["someone@example.com"]}'
# 2. remove its authenticator app
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: tasklist-1f1bd" \
  -H "Content-Type: application/json" $API/accounts:update -d '{"localId":"THE_UID","mfa":{}}'
```
