# Discord on the 3DS

The Discord applet (`shells/3ds/discord`) lists servers and channels, shows
messages as they arrive and sends messages. It reaches Discord through
**Pocket Companion** on the Mac with a **bot**: the applet fetches
`https://companion.pocket/discord/…`, and the companion's discord service
(PocketJS `tools/companion/services/discord.ts`) calls Discord's API with the
bot's token. The console never holds the token.

## What the bot can see

- Servers the bot was invited to, and the text and announcement channels its
  roles let it view.
- Not your direct messages, friends or servers it is not in.
- Messages you send from the 3DS appear under **the bot's name**, not yours.
  They mention no one: the service sends them with mentions turned off.

## Setting it up

1. Open the Discord developer portal,
   <https://discord.com/developers/applications>, and choose **New
   Application**. Give it a name (the bot's name in your servers).
2. Open **Bot** in the left column and choose **Reset Token**. Copy the token;
   the portal shows it once.
3. On the same page, under **Privileged Gateway Intents**, turn on **Message
   Content Intent** and save. Without it, messages arrive with empty text.
4. Give the token to the companion:

   ```sh
   bun tools/companion.ts service discord token <bot-token>
   ```

   The companion checks it with Discord (a user token is refused), stores it
   and connects to Discord's gateway.
5. Print the invite link:

   ```sh
   bun tools/companion.ts service discord status
   ```

   It names the bot, the number of servers it is in, the gateway state and an
   invite link with three permissions: View Channels, Read Message History and
   Send Messages (`permissions=68608`).
6. Open the link in a browser, choose a server you manage and authorize. Repeat
   for each server the bot should join.
7. On the 3DS, open Discord. If it shows **Set up Discord on your Mac**, tap
   **Try Again**.

## Commands

| Command | What it does |
| --- | --- |
| `service discord token <bot-token>` | Checks and stores the token, then connects. |
| `service discord status` | Bot name, server count, gateway state, invite link, and a reminder about Message Content. |
| `service discord logout` | Deletes the token and disconnects. |

The token is stored in `services/discord/token` under the companion's store,
`~/Library/Application Support/Pocket Companion/` (or
`$POCKET_COMPANION_HOME`), file **0600** in a **0700** folder. No response to
the console, log line or command output contains it. To revoke it, reset the
token in the developer portal.

## Using it on the 3DS

| Input | Action |
| --- | --- |
| Tap a server, then a channel | Open it at its newest message |
| Drag, the d-pad, or L / R (a page) | Scroll; scrolling to the top loads earlier messages |
| X, or **Write** | Write a message: the system keyboard opens; START or **Send** sends, B closes and keeps the draft |
| Y | Reload |
| B, or the back button | Back |

New messages appear while a channel is open; leaving it stops the updates.
Names and text in any script draw through glyphs the companion renders (the
glyphs service); the system keyboard types Latin letters.
