# X on the 3DS

The X applet (`shells/3ds/x`) reads the Following and For You timelines and
post threads, and likes, reposts and replies. It reaches X through **Pocket
Companion** on the Mac: the applet fetches `https://companion.pocket/x/…`, and
the companion's x service (PocketJS `tools/companion/services/x.ts`) calls
x.com with a session signed in on that Mac. The console never holds the
session.

## What it needs

- Pocket Companion running on a Mac paired with the console (Home > Settings
  > Mac shows it linked). Commands below run in a PocketJS checkout:
  `bun tools/companion.ts …`; they talk to the running companion.
- An X account signed in once on that Mac.

## Signing in

```sh
bun tools/companion.ts service x login
```

A window titled **Sign in to X for Pocket** opens on the Mac at x.com's login
page, with its own WebKit store (it shares no cookies with Safari). Sign in as
on the web, two-factor steps included. When X sets the session cookies
(`auth_token` and `ct0`), the window closes and the companion keeps them. The
command returns at once; the window stays open for up to **15 minutes**.

After a sign-in the companion reads x.com's client scripts to learn the
operations it calls (timeline, thread, like, repost, reply). This takes up to
about **80 s** the first time and is cached for **24 hours**.

When the window cannot open (no Swift compiler on the Mac), copy the two
cookies from a browser signed in to x.com (developer tools > Storage >
Cookies) and hand them over:

```sh
bun tools/companion.ts service x cookies <auth_token> <ct0>
```

## Commands

| Command | What it does |
| --- | --- |
| `service x login` | Opens the sign-in window. |
| `service x cookies <auth_token> <ct0>` | Saves a session from two cookie values. |
| `service x status` | Says whether a session is kept, since when, how many operations are known and the last error. |
| `service x probe` | Reads the operations again, names the timeline and thread operations in use, and reads one Following page. |
| `service x logout` | Deletes the session. |

## What is stored, and where

Under the companion's store, `~/Library/Application Support/Pocket Companion/`
(or `$POCKET_COMPANION_HOME`):

| File | Contents | Permissions |
| --- | --- | --- |
| `services/x/session.json` | `auth_token`, `ct0`, the time of the sign-in | file **0600**, folder **0700** |
| `services/x/operations.json` | The operation ids read from x.com's scripts | inside the **0700** folder |
| `services/x/avatars/` | 32×32 avatar textures sent to the console | inside the **0700** folder |

No response to the console, log line or command output contains a cookie
value. `logout` deletes `session.json`; X keeps the session valid on its side
until it expires or you end it under x.com > Settings > Security > Sessions.

## When X changes

The service uses x.com's web API, which X changes without notice:

- **Operation ids move.** The service reads them from x.com's scripts and reads
  them again when X answers that an operation is unknown, at most once every
  **10 minutes**. `service x probe` shows what it found; "timeline: not found"
  means the client changed shape.
- **The session ends.** The applet shows **Not signed in to X**; run
  `service x login` again.
- **A request header becomes required.** If X starts requiring a header the
  service does not send (such as `x-client-transaction-id`), reads fail with an
  API error on the applet and in `service x status`.

## Using it on the 3DS

| Input | Action |
| --- | --- |
| Tap **Following** / **For You**, or L / R | Switch timelines |
| Drag, or the d-pad | Scroll; the next page loads at the end |
| Tap a post | Open its thread: the posts it answers, the post, its replies |
| Tap the speech bubble | Reply: the system keyboard opens; START or **Reply** sends, B closes and keeps the draft |
| Tap the two arrows | Repost or undo the repost |
| Tap the heart | Like or unlike |
| X | Reload |
| B, or the back button | Back |

A like or repost shows at once and is undone with a notice when X refuses it.
Text in any script draws through glyphs the companion renders (the glyphs
service); the system keyboard types Latin letters.
