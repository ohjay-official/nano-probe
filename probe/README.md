# Probe files (Nano filming + App Check in an extension)

Throwaway checks for 12-13 Nov 2026, Africa/Lagos. They are not the product. Do not push secrets. These files are ready to commit; nobody has pushed them. The repo name is still yours to choose.

Two jobs in one workflow:

1. **Nano filming probe.** Branded Google Chrome on a public GitHub Actions Linux runner (4 vCPU, 16 GB RAM). Pass = `PROBE RESULT: on-device-ok` plus a Nano answer. If this fails, start finding a 16 GB laptop now. You need about 10 days.
2. **Extension probe.** The same branded Chrome loads a tiny MV3 extension through CDP `Extensions.loadUnpacked` (not `--load-extension`). The side panel page calls Firebase AI Logic hybrid, using an App Check debug token from a repo secret, and logs `result.response.inferenceSource`.

## What to copy into your new repo

Put these at the **repo root**, not nested under an extra folder:

- `probe/` (this folder)
- `.github/workflows/nano-probe.yml` (copy from `probe/github-workflows/nano-probe.yml`)

License the repo Apache-2.0, and show the license in the GitHub About section when you can.

## What you must do on your phone, in this order

1. **Create a public GitHub repo** under `ohjay-official`. Pick any name. Public matters: public repos get the 16 GB runner. Add Apache-2.0. Do not put keys in the README.
2. **Create a Firebase project** at https://console.firebase.google.com/ (you click any terms yourself).
3. **Add a Web app** in that project (the Web icon, give it a nickname, register). You do **not** need Firebase Hosting. Copy the `firebaseConfig` values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
4. **Turn on Firebase AI Logic** in the console (Gemini Developer API). App Check is required for AI Logic. For this probe you can start with the debug provider only.
5. **Create an App Check debug token.** Firebase console: Security, App Check, your web app, the three-dot menu, Manage debug tokens. Create one and keep it private. Never commit it.
   Source: https://firebase.google.com/docs/app-check/web/debug-provider
6. **Add GitHub Actions secrets** in the new repo: Settings, Secrets and variables, Actions, New repository secret. Add all of these, from the Firebase config and the debug token:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_APPCHECK_DEBUG_TOKEN`
7. **Put the probe files in the repo** (upload on github.com, or ask an agent once the repo exists and you have shared the name). Remember the workflow path: `.github/workflows/nano-probe.yml`.
8. **Run the workflow.** On GitHub: Actions, nano-probe, Run workflow. A push that touches `probe/**` or the workflow file also starts it.
9. **Wait and read the result.** The Nano job can take up to about 40 minutes (model download). Open the job Summary and the artifacts `nano-probe-out` and `extension-probe-out`.
10. **If the Nano job is not `on-device-ok`, start finding a 16 GB laptop today.** The product can still ship (judges use their own Chrome), but on-device video would need that laptop.

The extension job will fail early, with a clear message, if the Firebase secrets are missing. The Nano job does not need those secrets.

## How to read the results

- Nano pass: summary shows `on-device-ok`, a short Nano answer, and screenshots including `chrome://on-device-internals`.
- Extension pass: summary shows `firebase-ai-logic-ok` and an `inferenceSource` of `on_device` or `in_cloud`.
- Extension App Check failure: the log will say so. That is a useful result. The hosted product can still use reCAPTCHA App Check on the Vercel domain. The extension then follows the fallback in the spec (on-device only, cloud through the web app).
- If `Extensions.loadUnpacked` itself fails, we cannot load an unpacked extension into branded Chrome on this runner. Stop and talk before building the Gmail extension.

## Why branded Chrome, and not `--load-extension`

Branded Chrome 137 removed `--load-extension`. Chromium and Chrome for Testing still have the flag, but Chrome for Testing did not download Gemini Nano in our 11 Nov 2026 check (`availability()` was `unavailable`). The filming probe therefore uses branded `google-chrome` on the runner. The extension is loaded with `--remote-debugging-pipe`, `--enable-unsafe-extension-debugging`, and CDP `Extensions.loadUnpacked`. Sources are listed in `spec.md`.

## Do not

- Do not commit `extension/config.generated.js`, `probe/out`, or `probe/out-extension`.
- Do not put the debug token in the repo, a screenshot, or a chat that will be committed.
- Do not sign the runner into Gmail.
- Do not treat this probe as the product. The product must still call Firebase AI Logic only, never Chrome's `LanguageModel` directly. This Nano job talks to `LanguageModel` only to prove the runner can run Nano.
