import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathsInText, resolvePath, candidates, inlineImages, imageSize, parseLines, prune, copyName } from "../hook/capture.js";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "../hook/shot-preview.mjs");

// A 3×2 PNG: signature + IHDR is all imageSize reads.
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test("pathsInText finds bare and quoted image paths", () => {
  assert.deepEqual(pathsInText("screencapture -x /tmp/a.png && echo ok"), ["/tmp/a.png"]);
  assert.deepEqual(pathsInText(`mv "/Users/me/Desktop/Screenshot 2026-11-06 at 10.00.00.png" out/b.jpg`).sort(),
    ["/Users/me/Desktop/Screenshot 2026-11-06 at 10.00.00.png", "out/b.jpg"].sort());
  assert.deepEqual(pathsInText("npx playwright screenshot https://x.dev shot.webp"), ["shot.webp"]);
  assert.deepEqual(pathsInText("--output=~/shots/c.jpeg"), ["~/shots/c.jpeg"]);
  assert.deepEqual(pathsInText("ls src/"), []);
  assert.deepEqual(pathsInText(undefined), []);
});

test("resolvePath handles ~, absolute and relative paths", () => {
  assert.equal(resolvePath("~/a.png", "/w", "/h"), "/h/a.png");
  assert.equal(resolvePath("/x/a.png", "/w", "/h"), "/x/a.png");
  assert.equal(resolvePath("../b/./a.png", "/w/repo", "/h"), "/w/b/a.png");
});

test("candidates: Read counts any image, Bash only fresh ones, other tools none", () => {
  const home = "/h";
  assert.deepEqual(candidates({ tool_name: "Read", cwd: "/w", tool_input: { file_path: "/w/a.png" } }, home), [{ path: "/w/a.png", fresh: false }]);
  assert.deepEqual(candidates({ tool_name: "Read", cwd: "/w", tool_input: { file_path: "/w/a.ts" } }, home), []);
  assert.deepEqual(candidates({ tool_name: "Bash", cwd: "/w", tool_input: { command: "herdr-app shot" }, tool_response: { stdout: "/w/herdr-shot.png\n" } }, home),
    [{ path: "/w/herdr-shot.png", fresh: true }]);
  assert.deepEqual(candidates({ tool_name: "Edit", cwd: "/w", tool_input: { file_path: "/w/a.png" } }, home), []);
  assert.deepEqual(candidates({ tool_name: "mcp__pw__browser_take_screenshot", cwd: "/w", tool_response: [{ type: "text", text: "Saved to /tmp/p.png and rel.png" }] }, home),
    [{ path: "/tmp/p.png", fresh: true }]);
});

test("inlineImages reads MCP and Messages-API shaped image blocks", () => {
  const input = {
    tool_name: "mcp__chrome__screenshot",
    tool_response: [
      { type: "text", text: "ok" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { content: [{ type: "image", source: { type: "base64", data: "BBBB", media_type: "image/jpeg" } }] },
      { type: "image", data: "CCCC", mimeType: "image/svg+xml" },
    ],
  };
  assert.deepEqual(inlineImages(input), [{ data: "AAAA", ext: "png" }, { data: "BBBB", ext: "jpg" }]);
  assert.deepEqual(inlineImages({ ...input, tool_name: "Read" }), []);
});

test("imageSize reads PNG, GIF, JPEG and WebP headers", () => {
  assert.deepEqual(imageSize(png(3, 2)), { w: 3, h: 2 });
  const gif = Buffer.alloc(24);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(640, 6);
  gif.writeUInt16LE(480, 8);
  assert.deepEqual(imageSize(gif), { w: 640, h: 480 });
  // JPEG: SOI, an APP0 segment, then SOF0 with height 300 and width 500.
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpg), { w: 500, h: 300 });
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBPVP8X", 8, "ascii");
  webp.writeUIntLE(1919, 24, 3);
  webp.writeUIntLE(1079, 27, 3);
  assert.deepEqual(imageSize(webp), { w: 1920, h: 1080 });
  assert.equal(imageSize(Buffer.from("not an image at all, really")), null);
});

test("parseLines skips broken lines; prune keeps the newest", () => {
  const entries = parseLines('{"name":"a.png"}\n{"name":\n\n{"name":"b.png"}\n{"x":1}\n');
  assert.deepEqual(entries.map((e) => e.name), ["a.png", "b.png"]);
  const many = ["1", "2", "3", "4"].map((n) => ({ name: `${n}.png` }));
  assert.deepEqual(prune(many, 2), { kept: many.slice(2), drop: ["1.png", "2.png"] });
  assert.deepEqual(prune(many, 9), { kept: many, drop: [] });
});

test("copyName is sortable and normalises jpeg", () => {
  const n = copyName(new Date(2026, 10, 6, 9, 5, 7, 42).getTime(), "JPEG", "abc123");
  assert.equal(n, "20261106-090507-042-abc123.jpg");
});

test("the hook copies a fresh Bash capture once and ignores stale ones", () => {
  const root = mkdtempSync(join(tmpdir(), "shot-preview-"));
  const app = join(root, "herdr-app");
  mkdirSync(app);
  const work = join(root, "work");
  mkdirSync(work);
  writeFileSync(join(work, "new.png"), png(1280, 720));
  writeFileSync(join(work, "old.png"), png(10, 10));
  const old = Date.now() / 1000 - 3600;
  utimesSync(join(work, "old.png"), old, old);
  const run = (input) => execFileSync("node", [HOOK], { input: JSON.stringify(input), env: { ...process.env, HERDR_APP_HOME: app, HC_TERMINAL_ID: "t9" } });
  const bash = { session_id: "s1", tool_name: "Bash", cwd: work, tool_input: { command: "screencapture -x new.png; ls old.png" }, tool_response: { stdout: "old.png" } };
  run(bash);
  run({ ...bash, tool_name: "Read", tool_input: { file_path: join(work, "new.png") } }); // same file: no duplicate
  run({ tool_name: "Bash", cwd: work, tool_input: { command: "not json at all" } });
  const feed = parseLines(readFileSync(join(app, "shot-preview/feed.jsonl"), "utf8"));
  assert.equal(feed.length, 1);
  assert.equal(feed[0].src.endsWith("/work/new.png"), true);
  assert.equal(feed[0].terminal, "t9");
  assert.deepEqual([feed[0].w, feed[0].h], [1280, 720]);
  assert.deepEqual(readdirSync(join(app, "shot-preview")).sort(), [feed[0].name, "feed.jsonl"].sort());
});

test("the hook exits 0 on garbage input and without Herdr", () => {
  execFileSync("node", [HOOK], { input: "{nope", env: { ...process.env, HERDR_APP_HOME: "/nonexistent-herdr" } });
});
