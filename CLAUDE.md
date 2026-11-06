# herdr-shot-preview

Herdr mod (GPUI via gpui-kit, plain JavaScript, no build step) plus the Claude Code hook that
feeds it. See [README.md](README.md) for what it does, the feed and the install.

- Herdr runs a **copy** of `mods/shot-preview` in `~/.config/herdr-app/mods/shot-preview`.
  Edit here, never there. `npm run dev` re-copies on every save (the app hot reloads);
  otherwise run `tools/install.sh` after changing anything.
- The hook runs from this repo (`~/.claude/settings.json` points at `hook/shot-preview.mjs`),
  so edits apply on the next tool call. It must stay silent and always exit 0.
- Images live in `~/.config/herdr-app/shot-preview/`, outside the mod folder: an asset saved
  under `mods/` reloads the mod, and `install.sh` (rsync `--delete`) would wipe it.
- The API types are `mods/shot-preview/gpui-kit.d.ts` and `~/.config/herdr-app/herdr.d.ts`;
  `~/.config/herdr-app/AGENTS.md` is Herdr's own guide. They're the truth over memory.
- Keep `logic.js` and `hook/capture.js` free of `herdr` / `gpui-*` / `fs` imports so
  `npm test` runs them under Node.
- Before calling a change done: `npm test`, `npm run check`, and look at it in the app
  (`herdr-app shot`; run the hook by hand to make the card pop). The check only covers the
  first render, where the card is empty.
