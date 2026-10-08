# CF Performance Mirror
Analyse your Codeforces profile — solve times, WA% by topic and problem, division breakdown, and time-range filters.

## Install from Chrome Web Store

- [Install CF Performance Mirror (Chrome)](https://chromewebstore.google.com/detail/cf-performance-mirror/lpbkkcofbkmghobeeeipbdgohbckcdgj)

## Install from Firefox Add-ons

- [Install CF Performance Mirror (Firefox)](https://addons.mozilla.org/en-US/firefox/addon/cf-performance-mirror/)

## Overview
Analyze overall performance, solve time, failure rates, rating changes, and errors by division and time range. Track your Codeforces performance with clear insights into solve times, failure rates, rating changes, and problem-level errors, broken down by division and time range. Filter by contest type and focus on selected topics or rating ranges to quickly spot weak areas and improve efficiently, all directly on your profile page.

## How it works
The performance panel runs entirely client-side on `codeforces.com/profile/<handle>`. It fetches from public Codeforces APIs (`user.status`, `contest.list`, `user.rating`). No login needed, no server, no tracking.

The Online Friends panel is a separate, **opt-in** feature (off by default) that shows which of your Codeforces friends are online. Turning it on requires being logged in to Codeforces. See [Online Friends: what it does and its limits](#online-friends-what-it-does-and-its-limits) below and `PRIVACY_POLICY.md`.

## Where it appears
- The performance panel is injected into Codeforces profile pages (URLs matching `https://codeforces.com/profile/*`).
- The Online Friends panel, once turned on, appears site-wide on `codeforces.com` pages that have a sidebar, not only profile pages.
- The Online Friends panel is switched on and off with the people-icon button in the performance panel on your profile page. While that is off, the panel is not shown anywhere and makes no requests. While it is on, the chevron in the panel's own header opens and closes it; a closed panel shows only its header and also makes no requests.

## Online Friends: what it does and its limits

**What it requests** (all to `codeforces.com`, nothing else):
- `https://codeforces.com/friends`: your friend list, read with your browser's existing login session.
- Each friend's public profile page; the download is cut off shortly after the "Last visit" line. A friend is shown as online when it says "online now" (English) or "сейчас на сайте" (Russian).
- The `user.info` API for your friends' handles (100 per request): rating, rank and last-activity time. The last-activity time only decides which friends are checked first; being online is decided by the profile page.
- On problem pages of regular contests: the `contest.status` API, once per online friend, to show who has solved the problem (see "Solved marks" below).

**When it runs and how fast**
- Only while the panel is turned on and open. Hiding the Codeforces tab cancels the running profile checks and stops new lookups until the tab is visible again. On a problem page, solved-mark requests that are already queued still finish.
- Profile checks: at most 3 at a time, then at most 2 per second after an initial burst of 20. The burst allowance is per page load.
- Each kind of API call (`user.info` for the scan, `user.info` for ratings of online friends, `contest.status`) is paced separately at roughly one every 2.1 seconds; Codeforces documents a limit of one API request per two seconds. Because the pacing is separate, these calls can overlap.
- Where the browser supports Web Locks, only one tab per account scans at a time.

**What the list means**
- A friend is listed only if they were confirmed online within the last 6 minutes (time with the tab hidden does not count).
- A full pass over all friends needs at least (number of friends − 20) ÷ 2 seconds because of the burst of 20 and the 2-per-second cap. When the last full pass took 5 minutes or more, the panel notes that someone who just came online can take several minutes to appear and that short visits may be missed.
- If some friends could not be checked, the panel says the list may be missing online friends.
- Only the English and Russian Codeforces interface languages are understood. A page in any other wording counts as "unknown", never as offline or online; if no friend can be checked, the panel shows an error.
- If the friends page shows you as logged in but lists no friends, the panel says "No friends found on your Codeforces friends page." instead of showing an error.

**Solved marks (problem pages only)**
- Shown on `/problemset/problem/<contest>/<problem>` and `/contest/<id>/problem/<problem>` pages of regular contests. Gym contests are skipped.
- A friend is marked when any of their submissions to that problem has the verdict "OK". The check does not tell contest submissions from later practice ones.
- Submissions are requested once per friend per contest, and the result is reused for 10 minutes in that tab. There is no polling: a friend who solves the problem while the page is open gets a mark after you reload it once the 10 minutes are over.
- The first 30 online friends are checked automatically. If more are listed, the panel shows "Solved marks are checked for the first 30 of N online friends." with a "Check next 30" link; each click sends at most 30 more requests.

## Privacy & security 🛡️
- No server operated by the developer, no tracking, no ads — nothing is uploaded anywhere.
- The performance panel uses only public Codeforces APIs and needs no login.
- The Online Friends panel is opt-in and, once turned on, uses your existing Codeforces login session to read your own friends page; it never sees or stores your password or session token. It keeps the friend list, online status, ratings and last-activity times in `localStorage`, and a short-lived cache of friends' contest submissions in `sessionStorage`, both on your device. See `PRIVACY_POLICY.md` for the full list.
- Requires host permission for `https://codeforces.com/*` to fetch data directly. No other permissions.
- Inspect the source before installing if you want to verify behavior — the codebase is small and self-contained.

## Motivation / Philosophy
- Built for competitive programmers who want a private, quick snapshot of where they struggle and how long they take on problems.
- Lightweight, focused on actionable insights rather than dashboards — no tracking, no servers.

— Friendly to the CP community.
## Architecture

The extension is written in React + TypeScript.

- `src/domain/` contains Codeforces classification, timeline, performance, table, and friction logic.
- `src/services/` contains Codeforces API and local-storage access.
- `src/components/` contains the React UI.
- `src/hooks/` contains React state/effects such as performance data and live theme detection.
- `src/content/` contains the small browser-extension integration layer that mounts the React app into an isolated Shadow DOM.

## Development

```bash
npm install
npm run typecheck
npm run build
npm install --no-save tsx   # tsx is not listed in package.json
npx tsx --test tests/*.test.ts
```

The production bundle is emitted to `dist/content.js`.

### Build

`npm run build` creates a loadable extension package in `dist/` containing the generated React content script (`content.js`), the background worker (`background.js`, copied from `public/`), the manifest, and the icons.
