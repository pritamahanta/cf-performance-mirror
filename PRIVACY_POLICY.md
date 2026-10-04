Privacy Policy for CF Performance Mirror

CF Performance Mirror does not transmit any data to the developer or to any
third-party server. Everything below happens directly between your browser
and codeforces.com.

## Performance panel (always on, no login required)

On Codeforces profile pages, the extension reads publicly available data —
the Codeforces public API (`user.status`, `user.rating`, `contest.list`,
`user.info`) — to compute and display contest performance statistics. This
requires no login and no authentication of any kind.

## Online Friends panel (opt-in, off by default)

This panel shows which of your Codeforces friends are currently online. It
is off until you turn it on, and it only works while you are logged in to
Codeforces in your browser. When enabled:

- It loads `https://codeforces.com/friends` using your browser's existing
  Codeforces login session, the same way the site itself would if you
  opened that page. The extension never sees, stores, or transmits your
  password or session token — only the list of friend handles that page
  shows you.
- To determine who is online right now, it reads each friend's public
  profile page (the same "Last visit: online now" text anyone can see
  there).
- The resulting friend list, their rating/rank, and their online status
  and check timestamps are stored in your browser's `localStorage`, keyed
  to your logged-in Codeforces handle, so the panel doesn't have to
  re-fetch everything on every page load. This data stays on your device;
  it is not sent to the developer or to any server. Clearing your
  browser's site data for `codeforces.com` removes it. Turning the panel
  off does not retroactively delete already-stored data; clear site data
  to remove it.

## What is not collected

No personally identifiable information beyond what Codeforces itself
already shows on the pages above. No tracking, analytics, or advertising.
All processing happens locally in your browser.

If you have questions, you can contact the developer at:
pritamohanta.in@gmail.com
