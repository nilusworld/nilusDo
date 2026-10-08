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
firebase.json        hosting config (site "nilusdo", serves public/, all URLs → index.html)
.firebaserc          default Firebase project
```

## URLs
`/` Focus · `/all` All tasks · `/c/<categoryId>` a category · `/plan` Daily plan · `/report` Time report ·
`/settings` Settings · `/login` · `/forgot-password`

## Deploy
```bash
firebase deploy --only hosting
```
No build step. Data lives in the Firebase Realtime Database, so deploying never touches your tasks.

## Run locally
```bash
firebase serve --only hosting     # http://localhost:5000
```
