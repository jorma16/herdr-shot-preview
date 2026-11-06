// A preview of the images Claude Code captures or looks at. The Claude Code hook in this repo
// (hook/shot-preview.mjs) copies each one into <appHome>/shot-preview/ and appends a line to
// feed.jsonl there; this mod watches that folder. Two views of the same mod:
//   floating block (the layout's): a card that pops up with each new image for a few seconds
//     (it stays while hovered). Click the image for the gallery; ↗ opens it in Preview.
//   overlay (props().overlay): the gallery, the last images big with a strip to pick from.
//     Opened from the card, or with `mod.open {name: "shot-preview"}` (palette, a key).

import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, home, props, placement, run, theme, exec, readTextFile, watchFolder, openOverlay, closeOverlay, notify } from "herdr";
import * as fs from "fs/promises";
import { parseFeed, fit, ago, toolLabel, baseName, shortPath, whoTook, indexOf } from "./logic.js";

const DIR = "shot-preview"; // under appHome(), where image() looks
const SHOW_MS = 10000; // how long the card stays after a new image
const CARD_W = 300;
const CARD_MAX_H = 200;
const THUMB_W = 96;
const THUMB_H = 64;

export default class ShotPreview extends View {
  init(_props, cx) {
    this.gallery = Boolean(props()?.overlay);
    this.dir = `${appHome()}/${DIR}`;
    this.entries = []; // newest first
    this.timer = cx.timer;
    // card
    this.newest = undefined; // newest name seen; undefined until the first read (no pop on start)
    this.shown = null; // the entry on the card, null when hidden
    this.burst = 0; // images since the card popped up
    this.until = 0;
    // gallery
    this.sel = props()?.name ?? null;
    this.size = null;
    if (this.gallery) {
      this.handle = cx.focus_handle();
      const focus = () => this.handle.focus();
      focus();
      cx.timer.after(200, focus);
    }
    cx.spawn(async (cx) => {
      await fs.mkdir(this.dir, { recursive: true }).catch(() => null);
      for (;;) {
        await this.read(cx);
        try {
          await watchFolder(this.dir);
        } catch {
          return;
        }
      }
    });
  }

  async read(cx) {
    const text = await readTextFile(`${this.dir}/feed.jsonl`).catch(() => null);
    this.entries = parseFeed(text);
    const top = this.entries[0] ?? null;
    if (!this.gallery && this.newest !== undefined && top && top.name !== this.newest) this.pop(top);
    this.newest = top?.name ?? null;
    cx.notify();
  }

  // ---- floating card -----------------------------------------------------------------------

  pop(entry) {
    this.burst = this.shown ? this.burst + 1 : 1;
    this.shown = entry;
    this.until = Date.now() + SHOW_MS;
    this.timer.after(SHOW_MS + 50, (cx) => this.expire(cx));
  }

  // Hides the card once its time is up, unless the pointer is on it (then checks again soon).
  expire(cx) {
    if (!this.shown) return;
    if (placement()?.hovered) {
      this.until = Math.max(this.until, Date.now() + 1500);
      this.timer.after(1550, (cx) => this.expire(cx));
      return;
    }
    if (Date.now() < this.until) return;
    this.hide(cx);
  }

  hide(cx) {
    this.shown = null;
    this.burst = 0;
    cx.notify();
  }

  render() {
    return this.gallery ? this.renderGallery() : this.renderCard();
  }

  renderCard() {
    const e = this.shown;
    if (!e) return div();
    const t = theme();
    const now = Date.now();
    const { agent, text } = whoTook(e, agents(), home());
    const size = fit(e.w, e.h, CARD_W, CARD_MAX_H, 1);
    const tip = [e.src ? shortPath(e.src, home()) : null, toolLabel(e.tool), e.w ? `${e.w}×${e.h}` : null].filter(Boolean).join(" · ");
    return v_flex().id("sp-card").w(CARD_W).px(8).py(4).gap(6).text_size(11.5)
      .child(div().id("sp-card-img").flex().justify_center().cursor_pointer().tooltip(tip)
        .on_click((_ev, cx) => {
          this.openGallery(e.name);
          this.hide(cx);
        })
        .child(image(`${DIR}/${e.name}`).w(size.w).h(size.h).rounded(4)))
      .child(h_flex().gap(6).items_center()
        .child(div().id("sp-card-who").flex_1().min_w(0).truncate().text_color(t.foreground)
          .when(Boolean(agent), (el) => el.cursor_pointer().hover((s) => s.text_color(t.accent))
            .on_click(() => run("agent.focus", { terminal: agent.address })))
          .child(text))
        .when(this.burst > 1, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.selected).text_color(t.muted).child(`+${this.burst - 1}`)))
        .child(div().flex_none().text_color(t.dim).child(ago(e.at, now)))
        .child(iconButton(t, "sp-card-open", "↗", "Open in Preview", () => openFile(this.dir, e)))
        .child(iconButton(t, "sp-card-close", "×", "Hide", (cx) => this.hide(cx))));
  }

  openGallery(name) {
    openOverlay({ mod: "shot-preview", props: { name }, kind: "dialog", width: 0.85, height: 0.85 });
  }

  // ---- gallery -----------------------------------------------------------------------------

  current() {
    return this.entries[indexOf(this.entries, this.sel)] ?? null;
  }

  move(by, cx) {
    if (this.entries.length === 0) return;
    const i = Math.max(0, Math.min(this.entries.length - 1, indexOf(this.entries, this.sel) + by));
    this.sel = this.entries[i].name;
    cx.notify();
  }

  dismiss() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  renderGallery() {
    const t = theme();
    const e = this.current();
    const root = v_flex().id("sp-gallery").size_full().p(12).gap(10).text_size(12).bg(t.popover)
      .track_focus(this.handle)
      .on_key_down((ev, cx) => {
        if (ev.key === "left" || ev.key === "up") this.move(-1, cx);
        else if (ev.key === "right" || ev.key === "down") this.move(1, cx);
        else if (ev.key === "enter" && this.current()) openFile(this.dir, this.current());
        else if (ev.key === "escape") this.dismiss();
      })
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      });
    if (!e) {
      return root.items_center().justify_center()
        .child(div().text_color(t.dim).child("No captures yet. They show up here when Claude Code takes or reads one."));
    }
    const now = Date.now();
    const { agent, text } = whoTook(e, agents(), home());
    const box = this.size ? { w: this.size.width - 24, h: this.size.height - 24 - 28 - 20 - THUMB_H - 4 - 30 } : { w: 600, h: 400 };
    const big = fit(e.w, e.h, box.w, box.h, 1);
    const meta = [text, toolLabel(e.tool), e.w ? `${e.w}×${e.h}` : null, ago(e.at, now)].filter(Boolean).join(" · ");
    return root
      .child(h_flex().h(28).flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(e.src ? shortPath(e.src, home()) : baseName(e.name)))
        .child(textButton(t, "sp-open", "Open", "Open in Preview (Enter)", () => openFile(this.dir, e)))
        .when(Boolean(e.src), (el) => el.child(textButton(t, "sp-reveal", "Reveal", "Show in Finder", () => exec("open", ["-R", e.src]))))
        .when(Boolean(agent), (el) => el.child(textButton(t, "sp-agent", "Agent", "Go to the agent that took it", () => {
          this.dismiss();
          run("agent.focus", { terminal: agent.address });
        })))
        .child(iconButton(t, "sp-close", "×", "Close (Esc)", () => this.dismiss())))
      .child(div().flex_1().min_h(0).flex().items_center().justify_center()
        .child(image(`${DIR}/${e.name}`).w(big.w).h(big.h).rounded(4)))
      .child(div().h(20).flex_none().truncate().text_color(t.muted).child(meta))
      .child(h_flex().id("sp-strip").h(THUMB_H + 4).flex_none().gap(6).overflow_x_scroll()
        .children(this.entries.map((x) => this.thumb(t, x, x.name === e.name))));
  }

  thumb(t, e, selected) {
    const s = fit(e.w, e.h, THUMB_W, THUMB_H, 1);
    return div().id(`sp-th-${e.name}`).flex_none().w(THUMB_W + 4).h(THUMB_H + 4).flex().items_center().justify_center()
      .rounded(5).border(2).border_color(selected ? t.accent : "#00000000").cursor_pointer()
      .tooltip(`${toolLabel(e.tool)} · ${ago(e.at, Date.now())}`)
      .on_click((_ev, cx) => {
        this.sel = e.name;
        cx.notify();
      })
      .child(image(`${DIR}/${e.name}`).w(s.w).h(s.h).rounded(3));
  }
}

function iconButton(t, id, glyph, tip, onClick) {
  return div().id(id).flex_none().w(20).h(20).flex().items_center().justify_center().rounded(4)
    .text_size(13).text_color(t.muted).cursor_pointer().tooltip(tip)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => onClick(cx))
    .child(glyph);
}

function textButton(t, id, label, tip, onClick) {
  return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(5).border(1).border_color(t.border)
    .text_color(t.foreground).cursor_pointer().tooltip(tip)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .child(label);
}

// Opens the copy (the original may be gone or overwritten since).
function openFile(dir, e) {
  exec("open", [`${dir}/${e.name}`]).then((r) => {
    if (r.code !== 0) notify({ title: "Couldn't open the image", body: r.stderr.trim(), level: "error" });
  });
}
