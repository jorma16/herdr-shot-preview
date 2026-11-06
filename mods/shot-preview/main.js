// What Claude Code agents produce, in Herdr. The Claude Code hook in this repo
// (hook/shot-preview.mjs) writes two feeds into <appHome>/shot-preview/: feed.jsonl (images,
// copied next to it) and resources.jsonl (files written or edited, pages published). This mod
// watches that folder and is three views, by how it was opened:
//   floating block (the layout's): a card that pops up with each new image (card.js).
//   overlay (props().overlay): the Resources panel, per agent: images, files, links (panel.js).
//     Opened from the card, a pane header, or `mod.open {name: "shot-preview"}`.
//   pane (props().file): a read-only, live view of one file (viewer.js).

import { View } from "gpui-kit";
import { appHome, props, readTextFile, watchFolder } from "herdr";
import * as fs from "fs/promises";
import { parseFeed, parseResources } from "./logic.js";
import { initCard, onNewImage, renderCard } from "./card.js";
import { initPanel, onData, renderPanel } from "./panel.js";
import { initViewer, renderViewer } from "./viewer.js";


export default class ShotPreview extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.file ? "viewer" : p.overlay ? "panel" : "card";
    this.dir = `${appHome()}/shot-preview`;
    this.timer = cx.timer;
    this.images = []; // newest first
    this.res = []; // newest first
    this.loaded = false;
    if (this.mode === "viewer") return initViewer(this, cx, p.file);
    if (this.mode === "panel") initPanel(this, cx, p);
    else initCard(this);
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
    const text = (name) => readTextFile(`${this.dir}/${name}`).catch(() => null);
    const [feed, res] = await Promise.all([text("feed.jsonl"), this.mode === "panel" ? text("resources.jsonl") : null]);
    const images = parseFeed(feed);
    const first = !this.loaded;
    const top = images[0] ?? null;
    if (this.mode === "card" && !first && top && top.name !== this.images[0]?.name) onNewImage(this, top);
    this.images = images;
    this.res = parseResources(res);
    this.loaded = true;
    if (this.mode === "panel") onData(this, cx, first);
    cx.notify();
  }

  render() {
    if (this.mode === "viewer") return renderViewer(this);
    if (this.mode === "panel") return renderPanel(this);
    return renderCard(this);
  }

  async close() {
    this.code?.release();
  }
}
