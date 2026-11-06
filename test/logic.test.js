import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, fit, ago, toolLabel, shortPath, whoTook, indexOf } from "../mods/shot-preview/logic.js";

test("parseFeed: newest first, unsafe names and broken lines out", () => {
  const text = '{"name":"a.png"}\n{"name":"../x.png"}\n{bad\n{"name":"b.png"}\n';
  assert.deepEqual(parseFeed(text).map((e) => e.name), ["b.png", "a.png"]);
  assert.deepEqual(parseFeed(null), []);
});

test("fit keeps the aspect, never upscales past cap, falls back without a size", () => {
  assert.deepEqual(fit(1920, 1080, 300, 200), { w: 300, h: 169 });
  assert.deepEqual(fit(400, 1600, 300, 200), { w: 50, h: 200 });
  assert.deepEqual(fit(100, 50, 300, 200), { w: 100, h: 50 });
  assert.deepEqual(fit(null, null, 300, 200), { w: 300, h: 200 });
  assert.deepEqual(fit(10, 10, 0, 200), { w: 0, h: 0 });
});

test("ago", () => {
  const now = 1_000_000_000;
  assert.equal(ago(now - 2000, now), "now");
  assert.equal(ago(now - 42_000, now), "42s");
  assert.equal(ago(now - 5 * 60_000, now), "5m");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d");
});

test("toolLabel", () => {
  assert.equal(toolLabel("Read"), "Read");
  assert.equal(toolLabel("mcp__playwright__browser_take_screenshot"), "playwright · browser_take_screenshot");
  assert.equal(toolLabel("mcp__plugin_pw_playwright__shot"), "playwright · shot");
  assert.equal(toolLabel(null), "?");
});

test("whoTook prefers the agent, else the folder", () => {
  const agents = [{ address: "t3", space_name: "xatu", tab_name: "", title: "✳ Fix login" }];
  assert.equal(whoTook({ terminal: "t3" }, agents, "/h").text, "xatu · Fix login");
  assert.equal(whoTook({ terminal: "t3" }, agents, "/h").agent, agents[0]);
  assert.deepEqual(whoTook({ terminal: "t8", cwd: "/h/dev/x" }, agents, "/h"), { agent: null, text: "~/dev/x" });
  assert.equal(shortPath("/other/x", "/h"), "/other/x");
});

test("indexOf falls back to the newest", () => {
  const e = [{ name: "b" }, { name: "a" }];
  assert.equal(indexOf(e, "a"), 1);
  assert.equal(indexOf(e, "zz"), 0);
  assert.equal(indexOf(e, null), 0);
});
