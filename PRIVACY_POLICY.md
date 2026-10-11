Privacy Policy for CF Performance Mirror

Last updated: October 11, 2026

CF Performance Mirror does not transmit any data to the developer or to any
third-party server. Its only network requests go to codeforces.com, the site
you are already using. Everything below happens directly between your browser
and codeforces.com.

## Performance panel (always on, no login required)

On Codeforces profile pages, the extension reads publicly available data —
the Codeforces public API (`user.status`, `user.rating`, `contest.list`) —
to compute and display contest performance statistics. For the Solved by column
of the Problems box it also reads the public `problemset.problems` method, and
keeps only the number of users who solved each problem in `localStorage`,
fetching it again when the stored copy is older than 24 hours. This
requires no login and no authentication of any kind. Your filter and display
preferences, including whether the Online Friends panel and the Friends submissions
box are turned on and open, are saved in your browser's `localStorage`.

## Online Friends panel (on by default, can be turned off)

This panel shows which of your Codeforces friends are currently online. It
is on by default and can be turned off with the Friends button in the
profile page's controls. It only works while you are logged in to
Codeforces in your browser. While it is on:

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
  by the extension's background service worker. The handle, rating and rank it
  gets back are also saved in the ratings cache described under *Friends
  submissions box* below.

What is stored on your device:

- In `localStorage`, keyed to your logged-in Codeforces handle: your friends'
  handles, whether each was online and when that was checked, the rating and
  rank of friends shown as online, and when each friend was last active
  according to Codeforces. If the extension cannot tell which account is
  logged in, it stores nothing. A stored list belonging to another account,
  or left from a logged-out state, is deleted the next time a Codeforces page
  that has a sidebar loads, even if the panel is turned off.
- None of this is sent to the developer or to any server other than
  codeforces.com. It is stored in codeforces.com's own site storage, so
  scripts of codeforces.com itself can technically read it, as with any other
  data stored by that site in your browser.
- Turning the panel off does not retroactively delete already-stored data;
  clear your browser's site data for `codeforces.com` to remove it.

## Friends submissions box (on by default, can be turned off)

On problem pages of regular contests (not gym contests) this box shows which
of your friends have submitted the problem you are viewing. It is separate
from the Online Friends panel, is on by default (the Submissions button in
the profile page's controls turns it off), and only works while you are
logged in to Codeforces. While it is on, whether its box is open or closed (the
requests start when the problem page loads):

- It loads `https://codeforces.com/friends` using your browser's existing
  Codeforces login session, as described above, to get your friends'
  handles.
- It loads Codeforces' friends-only status page of the problem you opened
  (`https://codeforces.com/problemset/status/<contest>/problem/<letter>?friends=on`)
  using your browser's existing Codeforces login session, to see which of your
  friends have submitted it. Only the page's list of submissions is read, and
  the result is kept in memory for 2 minutes.
- It asks the Codeforces `contest.status` API for the submissions of each
  friend who has submitted the problem (of every friend, when that page cannot
  be used) in the contest of the problem page you opened. Only the friend's
  handle and the contest id are sent, to codeforces.com.
- It asks the Codeforces `user.info` API about your friends' handles, to
  colour them by rating. These requests are made directly from the page, not
  by the background service worker.

What is stored on your device:

- In `localStorage`: a friend's submissions in the contest of the problem
  page you opened — submission id, problem letter, submission time,
  participant type, time since the contest started, verdict, test set and
  passed-test count — kept for up to 24 hours and used without a new request for
  30 minutes (an older copy is shown while it is refreshed, and deleted once it
  is 24 hours old); a friend's handle, rating and rank, reused for up to 6
  hours (public Codeforces data stored by handle, not tied to your account,
  which the Online Friends panel also writes to); and whether the box is
  turned on and open.
- In `sessionStorage` (this browser tab only, gone when the tab is closed):
  your friends' handles, keyed to your logged-in Codeforces handle, reused for
  up to 5 minutes. Nothing is stored if the page does not show who is logged
  in.
- In memory only: the same friends' handles, while the page is open.

Like the above, none of this is sent to the developer or to any server other
than codeforces.com.

These are ordinary requests from your browser to codeforces.com, so Codeforces
can see them the way it sees any page you load.

## Opening a submission's source code

In the Friends submissions list and in the profile page's Problems box, you can
open a submission to read its source code in the page. When you open one, the
extension loads that submission's page on codeforces.com
(`https://codeforces.com/contest/<contest>/submission/<id>`, or `/gym/` for gym
contests) using your browser's existing Codeforces login session, and reads the
source from it. To have the source ready sooner, it starts that same request
when you rest the pointer on a submission in the list for a moment (about a
quarter of a second) or move keyboard focus to it, one at a time. If you then do
not open that submission, its page has still been loaded. If Codeforces answers
with HTTP 403 when you open a submission, it tries once more by loading the same
page in a hidden frame on codeforces.com; that retry is not made for the early
request. The source is kept in memory only (up to 25 submissions, until the
Codeforces page is closed or reloaded) and is not stored on disk.

## What is not collected

No personally identifiable information beyond what Codeforces itself
already shows on the pages above. No tracking, analytics, or advertising.
All processing happens locally in your browser.

If you have questions, you can contact the developer at:
pritamohanta.in@gmail.com
