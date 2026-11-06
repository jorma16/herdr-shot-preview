// Small pieces the views share.

import { div } from "gpui-kit";
import { exec, notify, openOverlay } from "herdr";

export function iconButton(t, id, glyph, tip, onClick) {
  return div().id(id).flex_none().w(20).h(20).flex().items_center().justify_center().rounded(4)
    .text_size(13).text_color(t.muted).cursor_pointer().tooltip(tip)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => onClick(cx))
    .child(glyph);
}

export function textButton(t, id, label, tip, onClick) {
  return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(5).border(1).border_color(t.border)
    .text_color(t.foreground).cursor_pointer().tooltip(tip)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .child(label);
}

/** Runs `open` (the default app, Finder with -R, the browser for a URL); a toast if it fails. */
export function open(args, what) {
  exec("open", args)
    .then((r) => r.code === 0 || notify({ title: `Couldn't open ${what}`, body: r.stderr.trim(), level: "error" }))
    .catch((e) => notify({ title: `Couldn't open ${what}`, body: String(e?.message ?? e), level: "error" }));
}

/** Opens the Resources panel. `terminal`: the agent to show ("all" for every one). */
export function openPanel(p = {}) {
  openOverlay({ mod: "shot-preview", props: p, kind: "dialog", width: 0.85, height: 0.85 });
}
