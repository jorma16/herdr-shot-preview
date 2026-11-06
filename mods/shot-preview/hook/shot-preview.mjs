#!/usr/bin/env node
// Claude Code PostToolUse hook: records what each agent produces, for the shot-preview mod.
//   images (Read, Bash screenshots, MCP image results): copied into Herdr's home
//     (<appHome>/shot-preview/), one line each in feed.jsonl there. Herdr only loads images
//     from inside its home, hence the copy.
//   files written or edited, and pages published (PRs, issues, artifacts, Jira tickets…):
//     one line each in resources.jsonl, same folder.
// Never blocks or fails the tool call: any error ends the hook quietly with exit code 0.

import { readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync, renameSync, unlinkSync, existsSync, realpathSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { candidates, inlineImages, imageSize, resources, parseLines, prune, copyName } from "./capture.js";

const KEEP_IMAGES = 30; // images kept on disk and in feed.jsonl
const KEEP_RESOURCES = 1000; // lines kept in resources.jsonl
const FRESH_MS = 120_000; // a Bash-mentioned image counts if written this recently
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PER_CALL = 6;

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const home = homedir();
  const appHome = process.env.HERDR_APP_HOME || `${home}/.config/herdr-app`;
  if (!existsSync(appHome)) return; // no Herdr here

  const dir = `${appHome}/shot-preview`;
  const now = Date.now();
  const who = {
    tool: input.tool_name ?? null,
    session: input.session_id ?? null,
    terminal: process.env.HC_TERMINAL_ID ?? null,
    cwd: input.cwd ?? null,
    at: now,
  };
  const found = images(input, home, now);
  const res = resources(input, home);
  if (found.length === 0 && res.length === 0) return;
  mkdirSync(dir, { recursive: true });
  if (found.length > 0) saveImages(dir, found, who);
  if (res.length > 0) appendCapped(`${dir}/resources.jsonl`, res.map((r) => ({ ...r, ...who })), KEEP_RESOURCES, "kind");
}

// [{ src, ext, key, read }] for each image the call captured or looked at.
function images(input, home, now) {
  const found = [];
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
  return found.slice(0, MAX_PER_CALL);
}

function saveImages(dir, found, who) {
  const feed = `${dir}/feed.jsonl`;
  const seen = new Set((existsSync(feed) ? parseLines(readFileSync(feed, "utf8")) : []).map((e) => e.key));
  const entries = [];
  for (const f of found) {
    if (seen.has(f.key)) continue; // e.g. Bash wrote it, then Read looked at it
    seen.add(f.key);
    const bytes = f.read();
    const size = imageSize(bytes);
    const name = copyName(who.at, f.ext, randomBytes(3).toString("hex"));
    writeFileSync(`${dir}/${name}`, bytes);
    entries.push({ name, key: f.key, src: f.src, ...who, w: size?.w ?? null, h: size?.h ?? null });
  }
  const dropped = appendCapped(feed, entries, KEEP_IMAGES, "name");
  for (const e of dropped) {
    try {
      unlinkSync(`${dir}/${e.name}`);
    } catch {
      // already gone
    }
  }
}

// Appends entries as JSON lines; once the file is 10% past `keep`, rewrites it with the newest
// `keep`. Returns the entries dropped.
function appendCapped(path, entries, keep, field) {
  if (entries.length === 0) return [];
  appendFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
  const all = parseLines(readFileSync(path, "utf8"), field);
  if (all.length <= keep + Math.ceil(keep / 10)) return [];
  const { kept } = prune(all, keep);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
  renameSync(tmp, path);
  const still = new Set(kept.map((e) => e[field]));
  return all.slice(0, all.length - keep).filter((e) => !still.has(e[field]));
}

try {
  main();
} catch (e) {
  if (process.env.SHOT_PREVIEW_DEBUG) console.error(e);
}
process.exit(0);
