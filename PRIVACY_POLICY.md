Privacy Policy for CF Performance Mirror

Last updated: October 8, 2026

CF Performance Mirror does not transmit any data to the developer or to any
third-party server. Its only network requests go to codeforces.com, the site
you are already using. Everything below happens directly between your browser
and codeforces.com.

## Performance panel (always on, no login required)

On Codeforces profile pages, the extension reads publicly available data —
the Codeforces public API (`user.status`, `user.rating`, `contest.list`) —
to compute and display contest performance statistics. This
requires no login and no authentication of any kind. Your filter and display
preferences, including whether the Online Friends panel is turned on and
open, are saved in your browser's `localStorage`.

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
- It asks the Codeforces `user.info` API about your friends' handles, to get
  their rating, rank and when each was last active. Those requests are made
  by the extension's background service worker.
- On problem pages of regular contests (not gym contests), it asks the
  Codeforces `contest.status` API for each online friend's submissions in
  that contest, to show who has solved the problem. Only the friend's handle
  and the contest id are sent, to codeforces.com.

What is stored on your device:

- In `localStorage`, keyed to your logged-in Codeforces handle: your friends'
  handles, whether each was online and when that was checked, the rating and
  rank of friends shown as online, and when each friend was last active
  according to Codeforces. If the extension cannot tell which account is
  logged in, it stores nothing. A stored list belonging to another account,
  or left from a logged-out state, is deleted the next time a Codeforces page
  that has a sidebar loads, even if the panel is turned off.
- In `sessionStorage` (this browser tab only, gone when the tab is closed):
  a friend's submissions in the contest of the problem page you opened —
  submission id, problem letter, submission time, participant type, time since
  the contest started, verdict, test set and passed-test count — reused for up
  to 10 minutes.
- None of this is sent to the developer or to any server other than
  codeforces.com. It is stored in codeforces.com's own site storage, so
  scripts of codeforces.com itself can technically read it, as with any other
  data stored by that site in your browser.
- Turning the panel off does not retroactively delete already-stored data;
  clear your browser's site data for `codeforces.com` to remove it.

These are ordinary requests from your browser to codeforces.com, so Codeforces
can see them the way it sees any page you load.

## What is not collected

No personally identifiable information beyond what Codeforces itself
already shows on the pages above. No tracking, analytics, or advertising.
All processing happens locally in your browser.

If you have questions, you can contact the developer at:
pritamohanta.in@gmail.com
