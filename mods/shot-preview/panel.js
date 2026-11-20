// The Resources panel (a dialog): what one agent, or all of them, produced. Three tabs:
//   Images: the selected one big (zoomable), with a strip of thumbnails.
//   Files: the files written or edited, with a live read-only preview.
//   Links: PRs, issues, artifacts, Jira tickets… opened in the browser.
// Keys: 1/2/3 tabs; ←/→ images, +/-/0 zoom; ↑/↓ files and links; Enter opens; Esc closes.
// Clear forgets the selected agent: its image copies are deleted and its lines dropped from the
// feeds, once Undo (cmd-z) is no longer offered.
// Zoom: cmd- or ctrl-scroll, pinch, or double-click; scroll or drag to pan a zoomed image.

import { div, image } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, TextView } from "gpui-base";
import { agents, closeOverlay, focused, home, notify, props, readTextFile, run, settings, theme, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import { fit, placeImage, maxZoom, zoomAround, panBy, ago, toolLabel, baseName, shortPath, whoTook, indexOf, ofAgent, notCleared, dropCleared, fileRows, linkRows, producers, relPath, languageOf, isMarkdown, LINK_LABEL } from "./logic.js";
import { iconButton, textButton, open } from "./ui.js";

const DIR = "shot-preview";
const TABS = ["images", "files", "links"];
const THUMB_W = 96;
const THUMB_H = 64;
const MAX_CHIPS = 8;
const ZOOM_STEP = 1.25;
const UNDO_MS = 8000;

export function initPanel(v, cx, p) {
  // The agent to show: given, else the focused terminal; "all" if it produced nothing.
  v.agent = p.terminal ?? focused()?.terminal ?? "all";
  v.tab = TABS.includes(p.tab) ? p.tab : null;
  v.sel = p.name ?? null; // image name
  v.fileSel = null; // file path
  v.fileAt = 0; // when the previewed file was last touched, to reload on a new edit
  v.linkSel = 0;
  v.code = null;
  v.md = null;
  v.fileError = null;
  v.size = null;
  v.view = null; // the big image's box, measured
  v.zoom = null; // { name, z, x, y } for the image it was set on; anything else is at fit
  v.drag = null; // the last pointer position while dragging a zoomed image
  v.clears = []; // agents cleared while open ({ terminal, at }), hidden from the feeds read
  v.undo = null; // { clear, label, counts } while Undo is offered; its files aren't touched yet
  v.handle = cx.focus_handle();
  const focus = () => v.handle.focus();
  focus();
  cx.timer.after(200, focus);
}

// The feeds minus the cleared agents.
const visible = (v) => {
  const keep = notCleared(v.clears);
  return { images: v.images.filter(keep), res: v.res.filter(keep) };
};

const data = (v) => {
  const { images, res } = visible(v);
  const mine = ofAgent(v.agent);
  const own = res.filter(mine);
  return { images: images.filter(mine), files: fileRows(own), links: linkRows(own) };
};

const agentsWithData = (v) => {
  const { images, res } = visible(v);
  return producers(images, res);
};

// After each read: settle the agent and tab on the first, keep the file preview live.
export function onData(v, cx, first) {
  if (first) {
    if (v.agent !== "all" && !agentsWithData(v).some((p) => p.terminal === v.agent)) v.agent = "all";
    if (!v.tab) pickTab(v);
  }
  if (v.tab === "files") syncFile(v, cx);
}

function pickTab(v) {
  const d = data(v);
  v.tab = TABS.find((k) => d[k].length > 0) ?? "images";
}

// Keeps the selected file valid, and reloads its preview when it changed.
function syncFile(v, cx) {
  const { files } = data(v);
  const row = files.find((f) => f.path === v.fileSel) ?? files[0] ?? null;
  if (!row) {
    showFile(v, null, 0, cx);
    return;
  }
  if (row.path !== v.fileSel || row.at !== v.fileAt) showFile(v, row.path, row.at, cx);
}

function showFile(v, path, at, cx) {
  const same = path === v.fileSel;
  v.fileSel = path;
  v.fileAt = at;
  v.fileError = null;
  if (!same) {
    v.code?.release();
    v.code = null;
    v.md = null;
  }
  if (!path) return;
  cx.spawn(async (cx) => {
    try {
      const text = await readTextFile(path);
      if (v.fileSel !== path) return;
      if (text === null) v.fileError = "This file is no longer there.";
      else if (text.includes("\0")) v.fileError = "Binary file: no text preview.";
      else if (isMarkdown(path)) v.md = text;
      else if (v.code) v.code.set_value(text);
      else v.code = codeState(path, text);
    } catch {
      if (v.fileSel === path) v.fileError = "Can't preview this file (too large or unreadable).";
    }
    cx.notify();
  });
}

export function codeState(path, text) {
  const t = theme();
  return EditorState.new({
    language: languageOf(path), readonly: true, value: text,
    font_family: settings().font_family, font_size: 12,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
  });
}

function dismiss() {
  const id = props()?.overlay;
  if (id) closeOverlay(id);
}

function setTab(v, tab, cx) {
  v.tab = tab;
  if (tab === "files") syncFile(v, cx);
  cx.notify();
}

function setAgent(v, agent, cx) {
  v.agent = agent;
  v.sel = null;
  v.linkSel = 0;
  pickTab(v);
  if (v.tab === "files") syncFile(v, cx);
  cx.notify();
}

function onKey(v, ev, cx) {
  const d = data(v);
  const k = ev.key;
  if (k === "escape") return dismiss();
  if (ev.keystroke === "cmd-z") return undoClear(v, cx);
  if (k === "1" || k === "2" || k === "3") return setTab(v, TABS[Number(k) - 1], cx);
  if (v.tab === "images" && d.images.length > 0) {
    const i = indexOf(d.images, v.sel);
    if (k === "left" || k === "right") {
      v.sel = d.images[Math.max(0, Math.min(d.images.length - 1, i + (k === "left" ? -1 : 1)))].name;
      cx.notify();
    } else if (k === "enter") open([`${v.dir}/${d.images[i].name}`], "the image");
    else if (k === "0") resetZoom(v, cx);
    else if (k === "+" || k === "=" || ev.key_char === "+") zoomStep(v, d.images[i], ZOOM_STEP, cx);
    else if (k === "-") zoomStep(v, d.images[i], 1 / ZOOM_STEP, cx);
  } else if (v.tab === "files" && d.files.length > 0) {
    const i = Math.max(0, d.files.findIndex((f) => f.path === v.fileSel));
    if (k === "up" || k === "down") {
      const row = d.files[Math.max(0, Math.min(d.files.length - 1, i + (k === "up" ? -1 : 1)))];
      showFile(v, row.path, row.at, cx);
      cx.notify();
    } else if (k === "enter") openBeside(d.files[i]);
  } else if (v.tab === "links" && d.links.length > 0) {
    if (k === "up" || k === "down") {
      v.linkSel = Math.max(0, Math.min(d.links.length - 1, v.linkSel + (k === "up" ? -1 : 1)));
      cx.notify();
    } else if (k === "enter") open([d.links[Math.min(v.linkSel, d.links.length - 1)].url], "the link");
  }
}

// A live read-only view of the file, as a pane beside the agent that wrote it.
function openBeside(row) {
  const pane = agents().find((a) => a.address === row.terminal)?.pane;
  dismiss();
  run("pane.split", { direction: "right", ...(pane ? { pane } : {}), mod: "shot-preview", props: { file: row.path } });
}

// ---- clearing an agent ----------------------------------------------------------------------
// Clear hides the agent at once and offers Undo. Its image copies and feed lines go when Undo
// is no longer offered: UNDO_MS later, on another clear, or when the panel closes.

function clearAgent(v, cx) {
  if (v.agent === "all") return;
  const p = agentsWithData(v).find((x) => x.terminal === v.agent);
  flushClear(v, cx);
  const clear = { terminal: v.agent, at: Date.now() };
  const u = { clear, label: p ? agentLabel(p, agents()).label : v.agent, counts: p ?? { images: 0, files: 0, links: 0 } };
  v.clears.push(clear);
  v.undo = u;
  setAgent(v, "all", cx);
  v.timer.after(UNDO_MS, (cx) => {
    if (v.undo === u) flushClear(v, cx);
  });
}

function undoClear(v, cx) {
  const u = v.undo;
  if (!u) return;
  v.undo = null;
  v.clears = v.clears.filter((c) => c !== u.clear);
  setAgent(v, u.clear.terminal, cx);
}

function flushClear(v, cx) {
  if (!v.undo) return;
  cx.spawn(async (cx) => {
    await commitClear(v);
    cx.notify();
  });
}

/** Deletes the pending clear's image copies and drops its lines from both feeds. */
export async function commitClear(v) {
  const u = v.undo;
  if (!u) return;
  v.undo = null;
  try {
    const feed = await dropFrom(`${v.dir}/feed.jsonl`, u.clear);
    await Promise.all(feed.images.map((name) => fs.unlink(`${v.dir}/${name}`).catch(() => null)));
    await dropFrom(`${v.dir}/resources.jsonl`, u.clear);
  } catch (e) {
    notify({ title: `Couldn't clear ${u.label}`, body: String(e?.message ?? e), level: "error" });
  }
}

// Rewrites a feed without the clear's lines. If the hook appended meanwhile, writeTextFile
// rejects the stale snapshot and it reads again.
async function dropFrom(path, clear) {
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const r = dropCleared(text, clear);
    if (text === null || r.dropped.length === 0) return r;
    try {
      await writeTextFile(path, r.text, text);
      return r;
    } catch (e) {
      if (i >= 4) throw e;
    }
  }
}

// ---- drawing ---------------------------------------------------------------------------------

export function renderPanel(v) {
  const t = theme();
  const d = data(v);
  const live = agents();
  const live_agent = v.agent === "all" ? null : live.find((a) => a.address === v.agent) ?? null;
  return v_flex().id("sp-panel").size_full().p(12).gap(10).text_size(12).bg(t.popover).text_color(t.foreground)
    .track_focus(v.handle)
    .on_key_down((ev, cx) => onKey(v, ev, cx))
    .on_size_change((size, cx) => {
      v.size = size;
      cx.notify();
    })
    .child(header(v, t, live))
    .child(h_flex().h(28).flex_none().gap(4).items_center()
      .children(TABS.map((k, i) => tabButton(v, t, k, `${["Images", "Files", "Links"][i]} ${d[k].length}`)))
      .child(div().flex_1())
      .when(v.agent !== "all", (el) => el.child(textButton(t, "sp-clear", "Clear",
        "Delete this agent's image copies and forget its files and links (the files themselves stay)", (cx) => clearAgent(v, cx))))
      .when(Boolean(live_agent), (el) => el.child(textButton(t, "sp-goto", "Go to agent", "Focus this agent's terminal", () => {
        dismiss();
        run("agent.focus", { terminal: live_agent.address });
      }))))
    .child(div().h(1).flex_none().bg(t.border))
    .child(v.tab === "files" ? filesTab(v, t, d.files) : v.tab === "links" ? linksTab(v, t, d.links) : imagesTab(v, t, d.images))
    .when(Boolean(v.undo), (el) => el.child(undoBar(v, t)));
}

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function undoBar(v, t) {
  const { label, counts: c } = v.undo;
  const what = [count(c.images, "image"), count(c.files, "file"), count(c.links, "link")].join(", ");
  return h_flex().h(32).flex_none().px(10).gap(8).items_center().rounded(6).bg(t.selected)
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`Cleared ${label}: ${what}.`))
    .child(textButton(t, "sp-undo", "Undo", "Bring them back (cmd-z)", (cx) => undoClear(v, cx)));
}

// A chip's label: the agent's, else its folder's name and "(closed)".
function agentLabel(p, live) {
  const { agent, text } = whoTook({ terminal: p.terminal, cwd: p.cwd }, live, home());
  return { agent, text, label: agent ? text : `${baseName(p.cwd ?? "") || p.terminal} (closed)` };
}

function header(v, t, live) {
  const list = agentsWithData(v).slice(0, MAX_CHIPS);
  // agent: undefined for "All agents", null when its terminal is gone (closed), else the live one.
  const chip = (id, label, tip, count, selected, agent) => h_flex().id(`sp-chip-${id}`).flex_none().h(24).px(8).gap(5).items_center().rounded(12)
    .border(1).border_color(selected ? t.accent : t.border).cursor_pointer().tooltip(tip)
    .when(agent === null, (c) => c.border_dashed())
    .when(selected, (c) => c.bg(t.selected))
    .when(!selected, (c) => c.hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => setAgent(v, id, cx))
    .when(agent !== undefined, (c) => c.child(statusDot(t, agent)))
    .child(div().max_w(200).truncate().text_color(agent === null ? t.dim : selected ? t.foreground : t.muted).child(label))
    .when(count !== null, (c) => c.child(div().text_size(11).text_color(t.dim).child(String(count))));
  const chips = list.map((p) => {
    const { agent, text } = agentLabel(p, live);
    const state = agent ? agent.status ?? "unknown" : "closed";
    const tip = `${agent ? text : `${text} (closed)`} · ${state} · ${p.images} images, ${p.files} files, ${p.links} links`;
    return chip(p.terminal, agent ? text : baseName(p.cwd ?? "") || p.terminal, tip, p.images + p.files + p.links, v.agent === p.terminal, agent);
  });
  return h_flex().h(28).flex_none().gap(8).items_center()
    .child(div().flex_none().font_semibold().text_size(13).child("Resources"))
    .child(h_flex().id("sp-chips").flex_1().min_w(0).gap(6).items_center().overflow_x_scroll()
      .child(chip("all", "All agents", "Everything, from every agent", null, v.agent === "all"))
      .children(chips))
    .child(iconButton(t, "sp-close", "×", "Close (Esc)", () => dismiss()));
}

// A live agent: a dot in its status color, as Herdr marks it. A closed one: a hollow ring.
function statusDot(t, agent) {
  const dot = div().flex_none().w(7).h(7).rounded(4);
  return agent ? dot.bg(t[agent.status] ?? t.unknown) : dot.border(1).border_color(t.dim);
}

function tabButton(v, t, key, label) {
  const on = v.tab === key;
  return div().id(`sp-tab-${key}`).flex_none().h(26).px(10).flex().items_center().rounded(6).cursor_pointer()
    .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected).font_medium())
    .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => setTab(v, key, cx))
    .child(label);
}

const empty = (t, text) => div().flex_1().min_h(0).flex().items_center().justify_center().text_color(t.dim).child(text);

function imagesTab(v, t, images) {
  if (images.length === 0) return empty(t, "No images yet: they show up when the agent takes a screenshot or reads an image.");
  const e = images[indexOf(images, v.sel)];
  const { text } = whoTook(e, agents(), home());
  const g = geometry(v, e);
  const cur = zoomOf(v, e);
  const at = placeImage(g.base, g.view, cur.z, cur.x, cur.y);
  const zoomed = cur.z > 1;
  const level = zoomed ? (e.w > 0 ? `${Math.round((at.w / e.w) * 100)}%` : `${cur.z.toFixed(1)}×`) : "Fit";
  const meta = [text, toolLabel(e.tool), e.w ? `${e.w}×${e.h}` : null, ago(e.at, Date.now())].filter(Boolean).join(" · ");
  const center = () => ({ x: g.view.w / 2, y: g.view.h / 2 });
  return v_flex().flex_1().min_h(0).gap(10)
    .child(h_flex().h(24).flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(e.src ? shortPath(e.src, home()) : baseName(e.name)))
      .child(h_flex().flex_none().gap(2).items_center()
        .child(iconButton(t, "sp-zoom-out", "−", "Zoom out (-)", (cx) => zoomStep(v, e, 1 / ZOOM_STEP, cx)))
        .child(div().id("sp-zoom-level").flex_none().w(44).h(20).flex().items_center().justify_center().rounded(4)
          .text_size(11).text_color(zoomed ? t.foreground : t.dim).cursor_pointer()
          .tooltip("Back to fit (0) · cmd-scroll, pinch or double-click to zoom")
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => resetZoom(v, cx))
          .child(level))
        .child(iconButton(t, "sp-zoom-in", "+", "Zoom in (+)", (cx) => zoomStep(v, e, ZOOM_STEP, cx))))
      .child(textButton(t, "sp-img-open", "Open", "Open in Preview (Enter)", () => open([`${v.dir}/${e.name}`], "the image")))
      .when(Boolean(e.src), (el) => el.child(textButton(t, "sp-img-reveal", "Finder", "Show the original in Finder", () => open(["-R", e.src], "Finder")))))
    .child(div().id("sp-img-view").flex_1().min_h(0).relative().overflow_hidden()
      .when(zoomed, (el) => (v.drag ? el.cursor_grabbing() : el.cursor_grab()))
      .on_size_change((size, cx) => {
        if (v.view?.w === size.width && v.view?.h === size.height) return;
        v.view = { w: size.width, h: size.height };
        cx.notify();
      })
      .on_scroll_wheel((ev, cx) => {
        const p = ev.local_position ?? center();
        if (ev.modifiers.platform || ev.modifiers.control) setZoom(v, e, zoomAround(g.base, g.view, zoomOf(v, e), Math.exp(ev.delta.y / 200), p.x, p.y, g.max), cx);
        else if (zoomOf(v, e).z > 1) setZoom(v, e, panBy(g.base, g.view, zoomOf(v, e), ev.delta.x, ev.delta.y), cx);
      })
      .on_pinch((ev, cx) => {
        const p = ev.local_position ?? center();
        setZoom(v, e, zoomAround(g.base, g.view, zoomOf(v, e), 1 + ev.delta, p.x, p.y, g.max), cx);
      })
      .on_mouse_down("left", (ev, cx) => {
        if (ev.click_count >= 2) {
          // Double-click: fit ↔ the image's own pixels (2× when it already fits at those).
          v.drag = null;
          if (zoomOf(v, e).z > 1) return resetZoom(v, cx);
          const p = ev.local_position ?? center();
          const own = e.w > 0 ? e.w / g.base.w : 1;
          return setZoom(v, e, zoomAround(g.base, g.view, zoomOf(v, e), own >= 1.5 ? own : 2, p.x, p.y, g.max), cx);
        }
        if (zoomOf(v, e).z <= 1) return;
        v.drag = { x: ev.position.x, y: ev.position.y };
        cx.notify();
      })
      .on_mouse_up("left", (_ev, cx) => {
        if (!v.drag) return;
        v.drag = null;
        cx.notify();
      })
      .on_mouse_move((ev, cx) => {
        if (!v.drag) return;
        const dx = ev.position.x - v.drag.x;
        const dy = ev.position.y - v.drag.y;
        v.drag = { x: ev.position.x, y: ev.position.y };
        setZoom(v, e, panBy(g.base, g.view, zoomOf(v, e), dx, dy), cx);
      })
      .on_hover((hovered, cx) => {
        if (hovered || !v.drag) return;
        v.drag = null;
        cx.notify();
      })
      .child(image(`${DIR}/${e.name}`).absolute().left(at.x).top(at.y).w(at.w).h(at.h).rounded(zoomed ? 0 : 4)))
    .child(div().h(20).flex_none().truncate().text_color(t.dim).child(meta))
    .child(h_flex().id("sp-strip").h(THUMB_H + 4).flex_none().gap(6).overflow_x_scroll()
      .children(images.map((x) => thumb(v, t, x, x.name === e.name))));
}

// The big image's box (measured; a guess from the panel size until then), its fitted size and
// how far it zooms.
function geometry(v, e) {
  const view = v.view ?? (v.size ? { w: v.size.width - 24, h: v.size.height - 24 - 28 - 28 - 1 - 24 - 20 - (THUMB_H + 4) - 50 } : { w: 600, h: 400 });
  const base = fit(e.w, e.h, view.w, view.h, 1);
  return { view, base, max: maxZoom(base, e.w) };
}

const zoomOf = (v, e) => (v.zoom?.name === e.name ? v.zoom : { z: 1, x: 0, y: 0 });

function setZoom(v, e, z, cx) {
  v.zoom = z.z > 1 ? { name: e.name, ...z } : null;
  cx.notify();
}

function resetZoom(v, cx) {
  v.zoom = null;
  v.drag = null;
  cx.notify();
}

// +/- and the buttons: around the middle of the box.
function zoomStep(v, e, factor, cx) {
  const g = geometry(v, e);
  setZoom(v, e, zoomAround(g.base, g.view, zoomOf(v, e), factor, g.view.w / 2, g.view.h / 2, g.max), cx);
}

function thumb(v, t, e, selected) {
  const s = fit(e.w, e.h, THUMB_W, THUMB_H, 1);
  return div().id(`sp-th-${e.name}`).flex_none().w(THUMB_W + 4).h(THUMB_H + 4).flex().items_center().justify_center()
    .rounded(5).border(2).border_color(selected ? t.accent : "#00000000").cursor_pointer()
    .tooltip(`${toolLabel(e.tool)} · ${ago(e.at, Date.now())}`)
    .on_click((_ev, cx) => {
      v.sel = e.name;
      cx.notify();
    })
    .child(image(`${DIR}/${e.name}`).w(s.w).h(s.h).rounded(3));
}

function filesTab(v, t, files) {
  if (files.length === 0) return empty(t, "No files yet: they show up when the agent writes or edits one.");
  const now = Date.now();
  const sel = files.find((f) => f.path === v.fileSel) ?? null;
  const showAgent = v.agent === "all";
  const live = agents();
  const row = (f) => {
    const on = f.path === v.fileSel;
    const rel = relPath(f.path, f.cwd, home());
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const badge = f.created ? "new" : f.edits > 1 ? `${f.edits} edits` : "edited";
    return v_flex().id(`sp-file-${f.path}`).flex_none().px(8).py(5).gap(1).rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => {
        showFile(v, f.path, f.at, cx);
        cx.notify();
      })
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(baseName(f.path)))
        .child(div().flex_none().text_size(10.5).text_color(f.created ? t.ansi2 : t.dim).child(badge))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(f.at, now))))
      .child(div().truncate().text_size(11).text_color(t.dim)
        .child(showAgent ? [whoTook(f, live, home()).text, dir].filter(Boolean).join(" · ") : dir || " "));
  };
  return h_flex().flex_1().min_h(0).gap(10).items_stretch()
    .child(v_flex().id("sp-files").w(320).flex_none().h_full().min_h(0).gap(2).overflow_y_scrollbar().children(files.map(row)))
    .child(div().w(1).flex_none().bg(t.border))
    .child(v_flex().flex_1().h_full().min_w(0).min_h(0).gap(8)
      .when(Boolean(sel), (el) => el.child(h_flex().h(24).flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(shortPath(sel.path, home())))
        .child(textButton(t, "sp-file-beside", "Open beside", "A live view as a pane next to the agent (Enter)", () => openBeside(sel)))
        .child(textButton(t, "sp-file-open", "Open", "Open with its default app", () => open([sel.path], "the file")))
        .child(textButton(t, "sp-file-reveal", "Finder", "Show in Finder", () => open(["-R", sel.path], "Finder")))))
      .child(preview(v, t)));
}

export function preview(v, t) {
  if (v.fileError) return empty(t, v.fileError);
  if (v.md !== null && v.md !== undefined) {
    return div().id("sp-md-wrap").flex_1().min_h(0).overflow_y_scrollbar().px(4)
      .child(TextView.markdown(`sp-md-${v.fileSel}`, v.md).selectable(true));
  }
  if (v.code) return Editor.new(v.code).flex_1().min_h(0);
  return empty(t, "Loading…");
}

function linksTab(v, t, links) {
  if (links.length === 0) return empty(t, "No links yet: PRs, issues, artifacts and tickets the agent creates show up here.");
  const now = Date.now();
  const showAgent = v.agent === "all";
  const live = agents();
  const sel = Math.min(v.linkSel, links.length - 1);
  return v_flex().id("sp-links").flex_1().min_h(0).gap(2).overflow_y_scrollbar()
    .children(links.map((l, i) => h_flex().id(`sp-link-${i}`).flex_none().px(8).py(6).gap(10).items_center().rounded(6).cursor_pointer()
      .when(i === sel, (el) => el.bg(t.selected))
      .when(i !== sel, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip(l.url)
      .on_click((_e, cx) => {
        v.linkSel = i;
        cx.notify();
        open([l.url], "the link");
      })
      .child(div().flex_none().w(64).text_size(10.5).font_medium().text_color(t.accent).child(LINK_LABEL[l.type] ?? "Link"))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_color(t.foreground).child(l.title || l.url))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child([showAgent ? whoTook(l, live, home()).text : null, l.title ? l.url : null].filter(Boolean).join(" · ") || " ")))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(l.at, now)))));
}
