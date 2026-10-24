# Information Hub

A desktop app for Windows, macOS and Linux that brings together your mail, calendars, work priorities and balanced, fact-checkable news, with several accounts per person.

The architecture and delivery slices are in the [plan](https://claude.ai/artifact/JH7TmXJRsJMdLcYKAqxsXC).

## Status

Slice 0: an app shell that installs on every OS and keeps your settings (name, theme, news topics and languages) between restarts. Mail, calendar and news screens are placeholders that say which slice brings them.

## Run it from source

Needs Node.js 22.

```sh
npm install
npm run dev        # opens the app with hot reload
npm test           # unit tests
npm run typecheck
npm run dist       # builds an installer for your OS into dist/
```

## Installers

Every push builds the macOS installer in GitHub Actions (Windows and Linux build only on version tags, or from Run workflow with "all platforms" ticked) (Actions tab, open a run, download the `installer-*` artifact). Pushing a tag such as `v0.0.1` publishes them as a GitHub release. The macOS app is signed with a Developer ID and notarized by Apple, so it opens normally. That needs these repository secrets: `CSC_LINK` (base64 of the Developer ID Application .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Without them, as on fork PRs, the Mac build gets an ad-hoc signature and must be opened via System Settings, Privacy & Security, Open Anyway.

Windows builds are not signed yet: on the SmartScreen screen, choose More info, then Run anyway.

## Google accounts (Gmail and Google Calendar)

The app signs in with Google's installed-app flow (OAuth with PKCE and a loopback redirect to `127.0.0.1`). It reads mail (`gmail.readonly`) and calendars (`calendar.readonly`); tokens stay on the computer, encrypted with the system keychain. Each account has Mail and Calendar switches; turning Calendar off makes it mail only, and the app then never asks Google for calendar access.

The build needs a Google OAuth client of type **Desktop app**:

1. In [Google Cloud console](https://console.cloud.google.com/), create a project (for example "Information Hub").
2. APIs & Services, Library: enable **Gmail API** and **Google Calendar API**.
3. Google Auth Platform: get started with User type **External**. Under Data access, add the scopes `gmail.readonly`, `calendar.readonly`, `openid`, `email` and `profile`. Under Audience, add each tester's Google address as a test user (up to 100).
4. Google Auth Platform, Clients: create a client with application type **Desktop app**. Copy its client ID and client secret.
5. In GitHub, Settings, Secrets and variables, Actions: add them as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. CI bakes them into the installers. To run from source, put them in `.env.local` as `MAIN_VITE_GOOGLE_CLIENT_ID=…` and `MAIN_VITE_GOOGLE_CLIENT_SECRET=…` (git ignores that file).

Google treats a Desktop app's client secret as non-confidential, which is why it may ship inside the app. While the app is in Testing, only listed test users can sign in and Google expires their sign-in after 7 days, so the account asks to reconnect weekly. Publishing to everyone needs Google's verification, and `gmail.readonly` is a restricted scope that also needs a yearly third-party security assessment.

## Microsoft accounts

Outlook mail and calendar (work, school and personal accounts) sign in through the system browser with MSAL; tokens are encrypted with the OS keychain and stay on the computer. The app needs a Microsoft Entra app registration, set once by the maintainer:

1. In [Entra admin center](https://entra.microsoft.com), App registrations, New registration. Name: Information Hub. Supported account types: any organizational directory and personal Microsoft accounts.
2. Redirect URI: platform "Public client/native (mobile & desktop)", value `http://localhost`.
3. API permissions, Microsoft Graph, Delegated: `Mail.Read`, `Calendars.Read`, `offline_access` (keep `User.Read`).
4. Copy the Application (client) ID into `MICROSOFT_CLIENT_ID` in `src/main/accounts/microsoft.ts`. It is not a secret. For a quick test, set `HUB_MICROSOFT_CLIENT_ID` when running `npm run dev`.

Some organizations only allow apps their admin approved, or from a verified publisher; the app then says to ask IT.

## Layout

- `src/main`: Electron main process. Owns files, network and credentials.
- `src/preload`: the small, typed bridge exposed to the UI as `window.hub`.
- `src/renderer`: React UI. Has no Node access.
- `src/shared`: types and logic used by both sides.
