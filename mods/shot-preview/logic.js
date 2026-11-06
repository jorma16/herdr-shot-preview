// Pure functions for the mod: no `herdr` or `gpui-*` imports, so `npm test` runs them in Node.

/** feed.jsonl to entries, newest first. Bad or half-written lines are skipped. */
export function parseFeed(text) {
  const out = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.name === "string" && /^[\w.-]+$/.test(e.name)) out.push(e);
    } catch {
      // skip
    }
  }
  return out.reverse();
}

/** The largest size with the image's aspect that fits in maxW × maxH, never above `cap` × pixels. */
export function fit(w, h, maxW, maxH, cap = 1) {
  if (!(maxW > 0) || !(maxH > 0)) return { w: 0, h: 0 };
  if (!(w > 0) || !(h > 0)) return { w: Math.round(maxW), h: Math.round(maxH) };
  const s = Math.min(maxW / w, maxH / h, cap);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** How long ago, short: "now", "42s", "5m", "3h", "2d". */
export function ago(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** What made the image: "Read", "Bash", or "playwright · browser_take_screenshot". */
export function toolLabel(tool) {
  if (!tool) return "?";
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!m) return tool;
  const server = m[1].replace(/^plugin_[^_]+_/, "").replace(/^claude_ai_/, "");
  return `${server} · ${m[2]}`;
}

export const baseName = (p) => (p ? p.split("/").pop() : "");

/** ~ for the home folder. */
export const shortPath = (p, home) => (p && home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p ?? "");

// Drops the status glyphs agents put first in their title ("✳ Fix login" → "Fix login").
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** Who took it: the agent's tab or title and its space, else the folder it ran in. */
export function whoTook(entry, agents, home) {
  const a = entry.terminal ? agents.find((x) => x.address === entry.terminal) : null;
  if (a) {
    const name = clean(a.tab_name) || clean(a.title);
    return { agent: a, text: [a.space_name, name].filter(Boolean).join(" · ") };
  }
  return { agent: null, text: shortPath(entry.cwd, home) || "Claude Code" };
}

/** resources.jsonl to entries, newest first. */
export function parseResources(text) {
  const out = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.kind === "file" && typeof e.path === "string") out.push(e);
      else if (e?.kind === "link" && typeof e.url === "string" && /^https?:\/\//.test(e.url)) out.push(e);
    } catch {
      // skip
    }
  }
  return out.reverse();
}

/** Whether an entry belongs to the chosen agent ("all", or a terminal address). */
export const ofAgent = (sel) => (e) => sel === "all" || e.terminal === sel;

/**
 * Files, one row per path (newest first): created if any write made it, how many times it was
 * edited, when last, and by whom (the latest entry's terminal and folder).
 */
export function fileRows(entries) {
  const rows = new Map();
  for (const e of entries) {
    if (e.kind !== "file") continue;
    const r = rows.get(e.path);
    if (!r) rows.set(e.path, { path: e.path, created: e.op === "create", edits: e.op === "edit" ? 1 : 0, at: e.at, terminal: e.terminal, cwd: e.cwd });
    else {
      r.created ||= e.op === "create";
      if (e.op === "edit") r.edits += 1;
    }
  }
  return [...rows.values()];
}

/** Links, one per URL (newest first), keeping the first title found. */
export function linkRows(entries) {
  const rows = new Map();
  for (const e of entries) {
    if (e.kind !== "link") continue;
    const r = rows.get(e.url);
    if (!r) rows.set(e.url, { url: e.url, type: e.type ?? "link", title: e.title ?? null, at: e.at, terminal: e.terminal, cwd: e.cwd });
    else if (!r.title && e.title) r.title = e.title;
  }
  return [...rows.values()];
}

/**
 * The agents (terminal addresses) that produced anything, most recent first, with counts:
 * [{ terminal, at, images, files, links }].
 */
export function producers(images, res) {
  const by = new Map();
  const add = (e, what) => {
    if (!e.terminal) return;
    const p = by.get(e.terminal) ?? { terminal: e.terminal, at: 0, cwd: null, images: 0, files: 0, links: 0 };
    if ((e.at ?? 0) >= p.at) {
      p.at = e.at ?? 0;
      p.cwd = e.cwd ?? p.cwd;
    }
    p[what] += 1;
    by.set(e.terminal, p);
  };
  // Per agent: a file another agent touched too counts for both.
  const perAgent = (what) => {
    const seen = new Set();
    for (const e of res) {
      if (e.kind !== what.slice(0, -1) || !e.terminal) continue;
      const id = `${e.terminal}\n${e.path ?? e.url}`;
      if (seen.has(id)) continue;
      seen.add(id);
      add(e, what);
    }
  };
  for (const e of images) add(e, "images");
  perAgent("files");
  perAgent("links");
  return [...by.values()].sort((a, b) => b.at - a.at);
}

/** A path relative to a folder when inside it, else with ~ for home. */
export function relPath(path, cwd, home) {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return shortPath(path, home);
}

/** The editor language for a file, as Herdr's Files panel names them. */
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json", svelte: "html", vue: "html", sh: "bash", zsh: "bash" };
export function languageOf(path) {
  const name = baseName(path);
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
  return LANG[ext] ?? ext;
}

export const isMarkdown = (path) => /\.(md|markdown|mdx)$/i.test(path);

export const LINK_LABEL = { pr: "PR", issue: "Issue", artifact: "Artifact", jira: "Jira", doc: "Doc", release: "Release", gist: "Gist", link: "Link" };

/** Index of the entry with this name, else 0. */
export function indexOf(entries, name) {
  const i = entries.findIndex((e) => e.name === name);
  return i < 0 ? 0 : i;
}
