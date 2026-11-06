# herdr-shot-preview

A [Herdr](https://herdr.dev) mod that pops up a preview of every image Claude Code captures or
looks at: screenshots it takes (`screencapture`, `herdr-app shot`, Playwright…), images an MCP
tool returns, and image files it reads.

- **Card**: a floating block (bottom right by default) that shows up with each new image for
  10 s and stays while hovered. It shows the image, the agent that took it (click to go to it),
  how long ago, `+N` if more came in meanwhile, ↗ to open it in Preview and × to hide it. Click
  the image for the gallery.
- **Gallery**: a dialog with the last 30 images: the selected one big, what made it (agent,
  tool, size, time) and a strip of thumbnails. ←/→ to move, Enter opens it in Preview, Esc
  closes. **Open**, **Reveal** (the original in Finder) and **Agent** (go to the agent). Open it
  from the card or with `mod.open {name: "shot-preview"}` (command palette, or a key below).

## How it works

Herdr only loads images from inside its home, so a Claude Code `PostToolUse` hook
(`hook/shot-preview.mjs`, Node, standard library only) copies them there:

| Tool | Counts as an image |
|---|---|
| `Read` | the file it read, if it's a `.png`, `.jpg`, `.gif` or `.webp` |
| `Bash` | image paths in the command or its output, written in the last 2 minutes |
| `mcp__*` | images returned inline (base64), and absolute image paths in its text, written in the last 2 minutes |

Each one is copied to `~/.config/herdr-app/shot-preview/` (or `$HERDR_APP_HOME`) with a line in
`feed.jsonl`: file name, original path, tool, session, the Herdr terminal (`$HC_TERMINAL_ID`),
folder, time and pixel size. The same file seen twice (Bash writes it, then Read looks at it) is
kept once. Only the newest 30 are kept. The hook never blocks or fails a tool call.

The mod watches that folder (`watchFolder`), with no timers besides the card's.

## Install

1. The mod: `tools/install.sh` (copies `mods/shot-preview` into `~/.config/herdr-app/mods/`).
2. The card, as a floating block in your layout (a clone, not a shipped one), e.g. on the
   `work` column of a clone of `main`:

   ```json
   "floating": [ { "id": "shot-preview", "content": { "mod": "shot-preview" }, "edge": "right", "align": "end" } ]
   ```

   Drag it to another edge if you like; Herdr remembers the spot. Check `~/.config/herdr-app/layout.error`.
3. The hook, in `~/.claude/settings.json` (path to this repo):

   ```json
   "hooks": {
     "PostToolUse": [
       {
         "matcher": "Read|Bash|mcp__.*",
         "hooks": [ { "type": "command", "command": "node ~/dev/herdr-shot-preview/hook/shot-preview.mjs", "timeout": 10 } ]
       }
     ]
   }
   ```

   New Claude Code sessions pick it up (or `/hooks` in a running one).
4. Optional, a key for the gallery in `~/.config/herdr-app/keys.json`:
   `"global": { "<key>": { "command": "mod.open", "args": { "name": "shot-preview" } } }`.

## Develop

```sh
npm run dev           # copy into Herdr on every save, so the app hot reloads
npm test              # pure logic + the hook end to end, under node --test
npm run check         # herdr-app check: loads the mod once
```

Try the hook by hand: `SHOT_PREVIEW_DEBUG=1` prints its errors.

```sh
herdr-app shot /tmp/x.png
echo '{"tool_name":"Read","cwd":"/tmp","tool_input":{"file_path":"/tmp/x.png"}}' | node hook/shot-preview.mjs
```

| File | What |
|---|---|
| `hook/shot-preview.mjs` | the Claude Code hook: copies images and writes the feed |
| `hook/capture.js` | its pure logic: finding images in a tool call, image sizes, pruning |
| `mods/shot-preview/main.js` | the card and the gallery |
| `mods/shot-preview/logic.js` | the mod's pure functions |
| `test/` | `node --test` suites |
