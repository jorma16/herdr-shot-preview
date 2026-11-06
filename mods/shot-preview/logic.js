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

/** Index of the entry with this name, else 0. */
export function indexOf(entries, name) {
  const i = entries.findIndex((e) => e.name === name);
  return i < 0 ? 0 : i;
}
