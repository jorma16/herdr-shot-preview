// The floating card: pops up with each new image for SHOW_MS, stays while hovered.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, home, placement, run, theme } from "herdr";
import { fit, ago, toolLabel, shortPath, whoTook } from "./logic.js";
import { iconButton, open, openPanel } from "./ui.js";

const DIR = "shot-preview";
const SHOW_MS = 10000;
const CARD_W = 300;
const CARD_MAX_H = 200;

export function initCard(v) {
  v.shown = null; // the entry on the card, null when hidden
  v.burst = 0; // images since the card popped up
  v.until = 0;
}

export function onNewImage(v, entry) {
  v.burst = v.shown ? v.burst + 1 : 1;
  v.shown = entry;
  v.until = Date.now() + SHOW_MS;
  v.timer.after(SHOW_MS + 50, (cx) => expire(v, cx));
}

// Hides the card once its time is up, unless the pointer is on it (then checks again soon).
function expire(v, cx) {
  if (!v.shown) return;
  if (placement()?.hovered) {
    v.until = Math.max(v.until, Date.now() + 1500);
    v.timer.after(1550, (cx) => expire(v, cx));
    return;
  }
  if (Date.now() < v.until) return;
  hide(v, cx);
}

function hide(v, cx) {
  v.shown = null;
  v.burst = 0;
  cx.notify();
}

export function renderCard(v) {
  const e = v.shown;
  if (!e) return div();
  const t = theme();
  const { agent, text } = whoTook(e, agents(), home());
  const size = fit(e.w, e.h, CARD_W, CARD_MAX_H, 1);
  const tip = [e.src ? shortPath(e.src, home()) : null, toolLabel(e.tool), e.w ? `${e.w}×${e.h}` : null].filter(Boolean).join(" · ");
  return v_flex().id("sp-card").w(CARD_W).px(8).py(4).gap(6).text_size(11.5)
    .child(div().id("sp-card-img").flex().justify_center().cursor_pointer().tooltip(tip)
      .on_click((_ev, cx) => {
        openPanel({ terminal: e.terminal ?? "all", tab: "images", name: e.name });
        hide(v, cx);
      })
      .child(image(`${DIR}/${e.name}`).w(size.w).h(size.h).rounded(4)))
    .child(h_flex().gap(6).items_center()
      .child(div().id("sp-card-who").flex_1().min_w(0).truncate().text_color(t.foreground)
        .when(Boolean(agent), (el) => el.cursor_pointer().hover((s) => s.text_color(t.accent))
          .on_click(() => run("agent.focus", { terminal: agent.address })))
        .child(text))
      .when(v.burst > 1, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.selected).text_color(t.muted).child(`+${v.burst - 1}`)))
      .child(div().flex_none().text_color(t.dim).child(ago(e.at, Date.now())))
      .child(iconButton(t, "sp-card-open", "↗", "Open in Preview", () => open([`${v.dir}/${e.name}`], "the image")))
      .child(iconButton(t, "sp-card-close", "×", "Hide", (cx) => hide(v, cx))));
}
