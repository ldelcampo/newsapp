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

## Layout

- `src/main`: Electron main process. Owns files, network and credentials.
- `src/preload`: the small, typed bridge exposed to the UI as `window.hub`.
- `src/renderer`: React UI. Has no Node access.
- `src/shared`: types and logic used by both sides.
