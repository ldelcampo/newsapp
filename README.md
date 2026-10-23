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

Every push builds an installer for each OS in GitHub Actions (Actions tab, open a run, download the `installer-*` artifact). Pushing a tag such as `v0.0.1` publishes them as a GitHub release. Builds are not code-signed yet, so Windows SmartScreen and macOS Gatekeeper will warn on first open: on macOS, right-click the app and choose Open.

## Layout

- `src/main`: Electron main process. Owns files, network and credentials.
- `src/preload`: the small, typed bridge exposed to the UI as `window.hub`.
- `src/renderer`: React UI. Has no Node access.
- `src/shared`: types and logic used by both sides.
