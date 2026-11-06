// A pane with a live, read-only view of one file (props().file): it reloads when the file
// changes, so you can watch an agent edit it. Opened from the Resources panel's Files tab.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, theme, watchFolder } from "herdr";
import { isMarkdown, shortPath } from "./logic.js";
import { codeState, preview } from "./panel.js";
import { textButton, open } from "./ui.js";

export function initViewer(v, cx, file) {
  v.fileSel = file;
  v.code = null;
  v.md = null;
  v.fileError = null;
  const dir = file.slice(0, file.lastIndexOf("/")) || "/";
  cx.spawn(async (cx) => {
    for (;;) {
      await load(v, cx);
      try {
        const changed = await watchFolder(dir);
        // Only reload for this file (or a refresh-everything root path).
        while (!changed.some((p) => p === file || p === dir)) {
          const more = await watchFolder(dir);
          changed.splice(0, changed.length, ...more);
        }
      } catch {
        return;
      }
    }
  });
}

async function load(v, cx) {
  const file = v.fileSel;
  try {
    const text = await readTextFile(file);
    v.fileError = null;
    if (text === null) v.fileError = "This file is no longer there.";
    else if (text.includes("\0")) v.fileError = "Binary file: no text preview.";
    else if (isMarkdown(file)) v.md = text;
    else if (v.code) v.code.set_value(text);
    else v.code = codeState(file, text);
  } catch {
    v.fileError = "Can't preview this file (too large or unreadable).";
  }
  cx.notify();
}

export function renderViewer(v) {
  const t = theme();
  return v_flex().id("sp-viewer").size_full().min_h(0).p(8).gap(8).text_size(12).bg(t.background).text_color(t.foreground)
    .child(h_flex().h(24).flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(shortPath(v.fileSel, home())))
      .child(textButton(t, "sp-v-open", "Open", "Open with its default app", () => open([v.fileSel], "the file")))
      .child(textButton(t, "sp-v-reveal", "Finder", "Show in Finder", () => open(["-R", v.fileSel], "Finder"))))
    .child(preview(v, t));
}
