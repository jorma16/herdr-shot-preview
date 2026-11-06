#!/usr/bin/env node
// Claude Code PostToolUse hook: copies every image a tool call captured or looked at into
// Herdr's home (~/.config/herdr-app/shot-preview/) and appends a line to feed.jsonl there, which
// the shot-preview mod watches. Herdr only loads images from inside its home, hence the copy.
//
// Never blocks or fails the tool call: any error ends the hook quietly with exit code 0.

import { readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync, renameSync, unlinkSync, existsSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { candidates, inlineImages, imageSize, parseLines, prune, copyName } from "./capture.js";

const KEEP = 30; // images kept on disk and in the feed
const FRESH_MS = 120_000; // a Bash-mentioned image counts if written this recently
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PER_CALL = 6;

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const home = homedir();
  const appHome = process.env.HERDR_APP_HOME || `${home}/.config/herdr-app`;
  if (!existsSync(appHome)) return; // no Herdr here

  const now = Date.now();
  const found = []; // { bytes, ext, key, src }
  for (const { path, fresh } of candidates(input, home)) {
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) continue;
    if (fresh && now - st.mtimeMs > FRESH_MS) continue;
    const real = realpathSync(path);
    found.push({ src: real, ext: real.split(".").pop(), key: `${real}:${st.mtimeMs}:${st.size}`, read: () => readFileSync(real) });
  }
  for (const { data, ext } of inlineImages(input)) {
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_BYTES) continue;
    found.push({ src: null, ext, key: createHash("sha1").update(bytes).digest("hex"), read: () => bytes });
  }
  if (found.length === 0) return;

  const dir = `${appHome}/shot-preview`;
  const feed = `${dir}/feed.jsonl`;
  mkdirSync(dir, { recursive: true });
  const old = existsSync(feed) ? parseLines(readFileSync(feed, "utf8")) : [];
  const seen = new Set(old.map((e) => e.key));

  const lines = [];
  for (const f of found.slice(0, MAX_PER_CALL)) {
    if (seen.has(f.key)) continue; // e.g. Bash wrote it, then Read looked at it
    seen.add(f.key);
    const bytes = f.read();
    const size = imageSize(bytes);
    const name = copyName(now, f.ext, randomBytes(3).toString("hex"));
    writeFileSync(`${dir}/${name}`, bytes);
    lines.push(JSON.stringify({
      name,
      key: f.key,
      src: f.src,
      tool: input.tool_name ?? null,
      session: input.session_id ?? null,
      terminal: process.env.HC_TERMINAL_ID ?? null,
      cwd: input.cwd ?? null,
      at: now,
      w: size?.w ?? null,
      h: size?.h ?? null,
    }));
  }
  if (lines.length === 0) return;
  appendFileSync(feed, `${lines.join("\n")}\n`);

  // Keep the folder small: rewrite the feed with the newest entries once it grows past KEEP.
  const all = parseLines(readFileSync(feed, "utf8"));
  if (all.length > KEEP + 10) {
    const { kept, drop } = prune(all, KEEP);
    const tmp = `${feed}.${process.pid}.tmp`;
    writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
    renameSync(tmp, feed);
    for (const name of drop) {
      try {
        unlinkSync(`${dir}/${name}`);
      } catch {
        // already gone
      }
    }
  }
}

try {
  main();
} catch (e) {
  if (process.env.SHOT_PREVIEW_DEBUG) console.error(e);
}
process.exit(0);
