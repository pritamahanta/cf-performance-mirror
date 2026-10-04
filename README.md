# CF Performance Mirror
Analyse your Codeforces profile — solve times, WA% by topic and problem, division breakdown, and time-range filters.

## Install from Chrome Web Store

- [Install CF Performance Mirror (Chrome)](https://chromewebstore.google.com/detail/cf-performance-mirror/lpbkkcofbkmghobeeeipbdgohbckcdgj)

## Install from Firefox Add-ons

- [Install CF Performance Mirror (Firefox)](https://addons.mozilla.org/en-US/firefox/addon/cf-performance-mirror/)

## Overview
Analyze overall performance, solve time, failure rates, rating changes, and errors by division and time range. Track your Codeforces performance with clear insights into solve times, failure rates, rating changes, and problem-level errors, broken down by division and time range. Filter by contest type and focus on selected topics or rating ranges to quickly spot weak areas and improve efficiently, all directly on your profile page.

## How it works
The performance panel runs entirely client-side on `codeforces.com/profile/<handle>`. It fetches from public Codeforces APIs (`user.status`, `contest.list`, `user.rating`, `user.info`). No login needed, no server, no tracking.

The Online Friends panel is a separate, **opt-in** feature (off by default) that shows which of your Codeforces friends are online. Turning it on requires being logged in to Codeforces: it reads your own `https://codeforces.com/friends` page using your browser's existing session, then checks each friend's public profile page for "Last visit: online now". The resulting friend list and online status are kept in your browser's `localStorage` so the panel doesn't refetch everything on every page. See `PRIVACY_POLICY.md` for details.

## Where it appears
- The performance panel is injected into Codeforces profile pages (URLs matching `https://codeforces.com/profile/*`).
- The Online Friends panel, once turned on, appears site-wide on `codeforces.com` pages that have a sidebar, not only profile pages.

## Privacy & security 🛡️
- No server operated by the developer, no tracking, no ads — nothing is uploaded anywhere.
- The performance panel uses only public Codeforces APIs and needs no login.
- The Online Friends panel is opt-in and, once turned on, uses your existing Codeforces login session to read your own friends page; it never sees or stores your password or session token, only the resulting friend list and online status (kept in `localStorage` on your device).
- Requires host permission for Codeforces domains to fetch data directly.
- Inspect the source before installing if you want to verify behavior — the codebase is small and self-contained.

## Motivation / Philosophy
- Built for competitive programmers who want a private, quick snapshot of where they struggle and how long they take on problems.
- Lightweight, focused on actionable insights rather than dashboards — no tracking, no servers.

— Friendly to the CP community.
## Refactored architecture

The extension is being migrated from the original single-file DOM implementation to React + TypeScript while keeping the original behavior as the reference implementation.

- `src/domain/` contains Codeforces classification, timeline, performance, table, and friction logic.
- `src/services/` contains Codeforces API and local-storage access.
- `src/components/` contains the React UI.
- `src/hooks/` contains React state/effects such as performance data and live theme detection.
- `src/content/` contains the small browser-extension integration layer that mounts the React app into an isolated Shadow DOM.
- `legacy/content.js` is retained only as the behavior/rollback reference until browser regression testing is complete.

## Development

```bash
npm install
npm run typecheck
npm run build
```

The production bundle is emitted to `dist/content.js`. Do not switch the store-facing manifest to that bundle until the built extension has been loaded unpacked in Chrome and checked against real Codeforces profile pages.


### Build

`npm run build` creates a loadable Chrome extension package in `dist/` containing the generated React content script, manifest, and icons.
