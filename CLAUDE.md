# herdr-shot-preview

Herdr mods (GPUI via gpui-kit, plain JavaScript, no build step) plus the Claude Code hook that
feeds them. See [README.md](README.md) for what they do, the feeds and the install.

- Herdr runs a **copy** of each `mods/<name>` in `~/.config/herdr-app/mods/<name>`.
  Edit here, never there. `npm run dev` re-copies on every save (the app hot reloads);
  otherwise run `tools/install.sh` after changing anything.
- The hook runs from this repo (`~/.claude/settings.json` points at `hook/shot-preview.mjs`),
  so edits apply on the next tool call. It must stay silent and always exit 0.
- Images live in `~/.config/herdr-app/shot-preview/`, outside the mod folder: an asset saved
  under `mods/` reloads the mod, and `install.sh` (rsync `--delete`) would wipe it.
- The API types are `mods/shot-preview/gpui-kit.d.ts` and `~/.config/herdr-app/herdr.d.ts`;
  `~/.config/herdr-app/AGENTS.md` is Herdr's own guide. They're the truth over memory.
- `mods/resources-pane` is Herdr's shipped `pane` header (`~/.config/herdr-app/mods/pane`)
  plus the Resources button; keep its diff from the shipped one small.
- Keep `logic.js` and `hook/capture.js` free of `herdr` / `gpui-*` / `fs` imports so
  `npm test` runs them under Node.
- Before calling a change done: `npm test`, `npm run check`, and look at it in the app
  (`herdr-app shot`; run the hook by hand to make the card pop; `mod.open shot-preview` for
  the panel). The check only covers the first render, where the card is empty.
