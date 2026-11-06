# herdr-shot-preview

[Herdr](https://herdr.dev) mods that show what each Claude Code agent produces: the images it
captures or looks at, the files it writes or edits, and the pages it publishes (PRs, issues,
artifacts, Jira tickets…).

![The Resources panel](preview.png)

- **Card**: a floating block (bottom right by default) that pops up with each new image for
  10 s and stays while hovered. It shows the image, the agent that took it (click to go to it),
  how long ago, `+N` if more came in meanwhile, ↗ to open it in Preview and × to hide it. Click
  the image for the Resources panel.
- **Resources panel**: a dialog with what one agent produced, or all of them (chips at the top,
  most recent first). Three tabs:
  - **Images**: the selected one big with a strip of thumbnails. Open (Preview), Finder.
  - **Files**: one row per file (new, edited, or `N edits`), newest first, with a read-only
    preview that reloads when the agent edits it again (Markdown rendered). **Open beside**
    splits a live view of the file as a pane next to the agent; Open, Finder.
  - **Links**: PRs, issues, artifacts, Jira tickets, docs… Click to open in the browser.

  Keys: `1` `2` `3` tabs, `←` `→` images, `↑` `↓` files and links, `Enter` opens, `Esc` closes.
  It opens on the focused agent. Ways to open it:
  - `cmd-shift-r` (bound in `keys.json`, below), or the palette's `mod.open shot-preview`;
  - the layers icon in an agent pane's header (hover it), with the `resources-pane` header;
  - clicking the card's image.
- **File pane**: the live, read-only file view **Open beside** makes.

## How it works

A Claude Code `PostToolUse` hook (`hook/shot-preview.mjs` inside the `shot-preview` mod, so it
is installed with it; Node, standard library only) writes two feeds into `~/.config/herdr-app/shot-preview/` (or `$HERDR_APP_HOME`), and the mod watches
that folder (`watchFolder`):

| Tool | Recorded |
|---|---|
| `Read` | an image file it read (`.png`, `.jpg`, `.gif`, `.webp`) |
| `Bash` | image paths in the command or its output written in the last 2 minutes; the URL `gh`/`glab` `pr`/`mr`/`issue`/`release`/`gist`/`repo create` prints, with its `--title` |
| `Write`, `Edit`, `NotebookEdit` | the file, as created or edited (not under `/tmp`, `/private/tmp` or `/var/folders`) |
| `Artifact` | the published artifact's URL and title |
| `mcp__*` | images returned inline (base64), and absolute image paths in its text written in the last 2 minutes; for tools named `create…`/`publish…`, the page they made (a Jira key becomes its `/browse/` URL) |

- `feed.jsonl`: images. Herdr only loads images from inside its home, so each is copied next
  to it. The same file seen twice (Bash writes it, Read looks at it) is kept once. The newest
  30 are kept.
- `resources.jsonl`: files and links, the newest 1000 lines.

Every line has the tool, Claude session, Herdr terminal (`$HC_TERMINAL_ID`, which is how the
panel knows the agent), folder and time. The hook never blocks or fails a tool call.

## Install

Added from herdr.dev/mods, Herdr copies the mods (the hook comes inside `shot-preview`) and
merges `keys.json` (steps 1 and 4); the layout (2) and the hook's line in Claude Code's
settings (3) are still yours to do.

1. The mods: `tools/install.sh` (copies `mods/*` into `~/.config/herdr-app/mods/`).
2. In your layout (a clone, not a shipped one), e.g. a clone of `main`:
   - the card, as a floating block on the `work` column:

     ```json
     "floating": [ { "id": "shot-preview", "content": { "mod": "shot-preview" }, "edge": "right", "align": "end" } ]
     ```

   - the pane header with the Resources button, in the tab block's `pane`:
     `"header": { "content": { "mod": "resources-pane" }, ... }`. It's Herdr's shipped `pane`
     header plus that button, so it won't get Herdr's later changes to `pane`.

   Check `~/.config/herdr-app/layout.error`.
3. The hook, in `~/.claude/settings.json`. It runs from the installed mod (with another
   `$HERDR_APP_HOME`, use that path and set the variable for Claude Code too):

   ```json
   "hooks": {
     "PostToolUse": [
       {
         "matcher": "Read|Bash|Write|Edit|NotebookEdit|Artifact|mcp__.*",
         "hooks": [ { "type": "command", "command": "node ~/.config/herdr-app/mods/shot-preview/hook/shot-preview.mjs", "timeout": 10 } ]
       }
     ]
   }
   ```

4. A key for the panel: merge [`keys.json`](keys.json) into `~/.config/herdr-app/keys.json`
   (`cmd-shift-r` → `mod.open shot-preview`).

macOS only (it opens files with `open`). [RECIPE.md](RECIPE.md) is the brief to rebuild it
from scratch.

## Develop

```sh
npm run dev           # copy into Herdr on every save: the app hot reloads, the hook updates
npm test              # pure logic + the hook end to end, under node --test
npm run check         # herdr-app check on both mods
```

Try the hook by hand (`SHOT_PREVIEW_DEBUG=1` prints its errors):

```sh
echo '{"tool_name":"Edit","cwd":"/tmp","tool_input":{"file_path":"'$PWD'/README.md"}}' | node mods/shot-preview/hook/shot-preview.mjs
```

| File | What |
|---|---|
| `mods/shot-preview/hook/shot-preview.mjs` | the Claude Code hook: copies images, writes both feeds |
| `mods/shot-preview/hook/capture.js` | its pure logic: finding images, files and links in a tool call; image sizes |
| `mods/shot-preview/main.js` | reads the feeds, picks the view |
| `mods/shot-preview/card.js` | the floating card |
| `mods/shot-preview/panel.js` | the Resources panel |
| `mods/shot-preview/viewer.js` | the file pane |
| `mods/shot-preview/logic.js` | pure functions: parsing, grouping per agent, formats |
| `mods/resources-pane/` | Herdr's pane header plus the Resources button |
| `test/` | `node --test` suites |
| `keys.json` | the key Herdr merges in when the mod is added from herdr.dev |
| `RECIPE.md`, `preview.png` | the herdr.dev/mods brief and screenshot |

## License

Apache-2.0 ([LICENSE](LICENSE)). `mods/resources-pane` is a modified copy of Herdr's shipped
`pane` header mod, also Apache-2.0.
