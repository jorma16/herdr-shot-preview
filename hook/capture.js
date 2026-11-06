// Pure logic for the Claude Code hook: which images a tool call produced or looked at, their
// pixel size, and the feed's bookkeeping. No fs here, so `npm test` runs it as is.

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

const EXT_OF_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

// Image paths in free text: quoted ones (may hold spaces, like macOS "Screenshot … .png"), then
// bare tokens.
const QUOTED = /(["'])([^"'\n]*?\.(?:png|jpe?g|gif|webp))\1/gi;
const BARE = /(?:^|[\s=:(<>|;&,`])((?:~|\.{1,2})?\/?[\w@%+.\/~-]*\.(?:png|jpe?g|gif|webp))(?=$|[\s)"'<>|;&,`:])/gim;

export function pathsInText(text) {
  if (typeof text !== "string" || !/\.(png|jpe?g|gif|webp)/i.test(text)) return [];
  const out = new Set();
  for (const m of text.matchAll(QUOTED)) out.add(m[2]);
  const unquoted = text.replace(QUOTED, " ");
  for (const m of unquoted.matchAll(BARE)) out.add(m[1]);
  return [...out].filter((p) => p && !/^[.\/~]*$/.test(p.replace(IMAGE_EXT, "")));
}

export function resolvePath(p, cwd, home) {
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  if (p.startsWith("/")) return p;
  const parts = `${cwd}/${p}`.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

// Every string inside a value, for scanning tool responses of unknown shape.
function* strings(v, depth = 0) {
  if (depth > 8 || v == null) return;
  if (typeof v === "string") yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v)) yield* strings(x, depth + 1);
}

/**
 * The image files a PostToolUse input points at: [{ path, fresh }]. `fresh` means only count it
 * if it was written just now (a Bash command mentioning an old image isn't a capture).
 */
export function candidates(input, home) {
  const tool = input?.tool_name ?? "";
  const cwd = input?.cwd || home;
  const ti = input?.tool_input ?? {};
  const out = new Map();
  const add = (p, fresh) => {
    const abs = resolvePath(p, cwd, home);
    if (!out.has(abs) || !fresh) out.set(abs, { path: abs, fresh });
  };
  if (tool === "Read") {
    if (typeof ti.file_path === "string" && IMAGE_EXT.test(ti.file_path)) add(ti.file_path, false);
  } else if (tool === "Bash") {
    for (const p of pathsInText(ti.command)) add(p, true);
    for (const p of pathsInText(input?.tool_response?.stdout)) add(p, true);
  } else if (tool.startsWith("mcp__")) {
    for (const s of strings(input?.tool_response)) for (const p of pathsInText(s)) if (p.startsWith("/") || p.startsWith("~/")) add(p, true);
  }
  return [...out.values()];
}

/** Base64 images returned inline by an MCP tool: [{ data, ext }]. */
export function inlineImages(input) {
  if (!(input?.tool_name ?? "").startsWith("mcp__")) return [];
  const out = [];
  const walk = (v, depth) => {
    if (depth > 8 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (v.type === "image") {
      const data = typeof v.data === "string" ? v.data : v.source?.type === "base64" ? v.source.data : null;
      const mime = v.mimeType ?? v.mime_type ?? v.source?.media_type;
      const ext = EXT_OF_MIME[mime];
      if (data && ext) out.push({ data, ext });
      return;
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(input.tool_response, 0);
  return out;
}

/** Pixel size of a PNG, JPEG, GIF or WebP, from its first bytes. Null if unknown. */
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  // PNG: IHDR right after the signature.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  // GIF: logical screen size.
  if (b.toString("ascii", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  // WebP: RIFF....WEBP and one of three chunk kinds.
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 " && b.length >= 30) return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: walk the segments up to a start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// ---- files and links -------------------------------------------------------------------------

// Scratch files agents write and throw away: not worth listing.
const TEMP = /^\/(?:private\/)?(?:tmp|var\/folders)\//;

const URL_RE = /https?:\/\/[^\s"'<>`)\]}]+/g;

/** What kind of page a URL is: pr, issue, artifact, jira, doc, release, gist or link. */
export function linkType(url) {
  if (/\/pull\/\d+|\/merge_requests\/\d+/.test(url)) return "pr";
  if (/\/issues\/\d+/.test(url)) return "issue";
  if (/claude\.ai\/(?:code\/)?artifact\//.test(url)) return "artifact";
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url)) return "jira";
  if (/\/wiki\/|docs\.google\.com/.test(url)) return "doc";
  if (/\/releases\/tag\//.test(url)) return "release";
  if (/gist\.github\.com/.test(url)) return "gist";
  return "link";
}

const urlsIn = (s) => (typeof s === "string" ? s.match(URL_RE) ?? [] : []).map((u) => u.replace(/[.,;:]+$/, ""));

function flagValue(command, ...flags) {
  for (const f of flags) {
    const m = new RegExp(`(?:^|\\s)${f}(?:=|\\s+)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`).exec(command);
    if (m) return m[1] ?? m[2] ?? m[3];
  }
  return null;
}

/**
 * The files a tool call wrote and the pages it published: [{ kind: "file", path, op }] and
 * [{ kind: "link", url, type, title }].
 */
export function resources(input, home) {
  const tool = input?.tool_name ?? "";
  const cwd = input?.cwd || home;
  const ti = input?.tool_input ?? {};
  const res = input?.tool_response;
  const out = [];
  const file = (p, op) => {
    if (typeof p !== "string" || !p) return;
    const path = resolvePath(p, cwd, home);
    if (!TEMP.test(path)) out.push({ kind: "file", path, op });
  };
  const link = (url, title) => out.push({ kind: "link", url, type: linkType(url), title: title || null });

  if (tool === "Write") file(ti.file_path, res?.type === "create" ? "create" : "edit");
  else if (tool === "Edit" || tool === "MultiEdit") file(ti.file_path, "edit");
  else if (tool === "NotebookEdit") file(ti.notebook_path, "edit");
  else if (tool === "Bash") {
    const cmd = typeof ti.command === "string" ? ti.command : "";
    if (/\b(?:gh|glab)\s+(?:pr|mr|issue|release|gist|repo)\s+create\b/.test(cmd)) {
      const title = flagValue(cmd, "--title", "-t");
      const urls = [...urlsIn(res?.stdout), ...urlsIn(res?.stderr)].filter((u) => !/\/pull\/new\//.test(u));
      if (urls[0]) link(urls[0], title);
    }
  } else if (tool === "Artifact") {
    const action = ti.action ?? "publish";
    if (action === "publish" && !ti.asset) {
      const url = [...strings(res)].flatMap(urlsIn).find((u) => linkType(u) === "artifact");
      if (url) link(url, ti.title || (ti.file_path ? ti.file_path.split("/").pop() : null));
    }
  } else if (tool.startsWith("mcp__") && /create|publish/i.test(tool.split("__").pop())) {
    const all = [...strings(res)];
    const urls = all.flatMap(urlsIn);
    const page = urls.find((u) => !/\/rest\/|\/api\/|\/gateway\//.test(u));
    const key = all.map((s) => /^[A-Z][A-Z0-9]+-\d+$/.exec(s.trim())?.[0]).find(Boolean)
      ?? all.map((s) => /"key"\s*:\s*"([A-Z][A-Z0-9]+-\d+)"/.exec(s)?.[1]).find(Boolean);
    const title = ti.summary ?? ti.title ?? ti.name ?? null;
    if (page) link(page, title ?? key);
    else if (key && urls[0]) link(`${new URL(urls[0]).origin}/browse/${key}`, title ? `${key} ${title}` : key);
  }
  return out;
}

/** Feed lines (JSON per line) to entries, oldest first; bad lines are skipped. */
export function parseLines(text, field = "name") {
  const out = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e[field] === "string") out.push(e);
    } catch {
      // a half-written line from a concurrent append: skip it
    }
  }
  return out;
}

/** Keeps the newest `keep` entries; returns them and the image names to delete. */
export function prune(entries, keep) {
  if (entries.length <= keep) return { kept: entries, drop: [] };
  const kept = entries.slice(-keep);
  const still = new Set(kept.map((e) => e.name));
  return { kept, drop: entries.slice(0, -keep).map((e) => e.name).filter((n) => !still.has(n)) };
}

/** A file name for a copy: sortable by time, unique enough for concurrent hooks. */
export function copyName(now, ext, rand) {
  const d = new Date(now);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
  return `${stamp}-${rand}.${ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase()}`;
}
