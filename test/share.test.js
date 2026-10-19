import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP, HOME, handOver, shareLink } from "../src/share.js";
import "../src/shozbot-daily.js";

const { ShozDaily } = globalThis;
const OCT_12 = new Date(2026, 9, 12, 15, 30);
const daily = ShozDaily.create({ game: "letter-drop", title: "Letter Drop", storage: null, now: () => OCT_12 });
const canonical = "https://shozbot.com/letter-drop/";

test("a day's puzzle links to that day by date, so the link opens the same puzzle tomorrow", () => {
  const today = shareLink({ canonical, view: "game", meta: daily.todayMeta(), seed: "plant" });
  assert.deepEqual(today, { url: "https://shozbot.com/letter-drop/?daily=2026-10-12", title: "Letter Drop · Daily No. 285" });

  const past = shareLink({ canonical, view: "game", meta: daily.metaFor(daily.addDays(OCT_12, -3)), seed: "about" });
  assert.deepEqual(past, { url: "https://shozbot.com/letter-drop/?daily=2026-10-09", title: "Letter Drop · Daily No. 282" });
});

test("a random puzzle links to its word, which the game already understands", () => {
  const link = shareLink({ canonical, view: "game", meta: daily.practiceMeta(), seed: "plant" });
  assert.deepEqual(link, { url: "https://shozbot.com/letter-drop/?word=plant", title: APP });
});

test("the Past puzzles list, or no puzzle at all, is the plain address", () => {
  assert.deepEqual(shareLink({ canonical, view: "past", meta: daily.todayMeta(), seed: "plant" }), { url: canonical, title: APP });
  assert.deepEqual(shareLink({ canonical, view: "game", meta: null }), { url: canonical, title: APP });
});

test("the address is the shozbot.com one even without a canonical link to read", () => {
  assert.equal(HOME, "https://shozbot.com/letter-drop/");
  assert.equal(shareLink({ view: "game", meta: daily.todayMeta() }).url, `${HOME}?daily=2026-10-12`);
});

const link = { url: `${HOME}?daily=2026-10-12`, title: "Letter Drop · Daily No. 285" };

test("on a phone the share sheet gets the title and the link, and no note is shown", async () => {
  const calls = [], notes = [];
  const nav = { share: async (data) => { calls.push(data); }, clipboard: { writeText: async () => { throw new Error("should not copy"); } } };
  assert.equal(await handOver(link, { navigator: nav, toast: (t) => notes.push(t) }), "shared");
  assert.deepEqual(calls, [{ title: link.title, url: link.url }]);
  assert.deepEqual(notes, []);
});

test("a share sheet the person closes is left alone", async () => {
  const notes = [];
  const abort = Object.assign(new Error("closed"), { name: "AbortError" });
  const nav = { share: async () => { throw abort; }, clipboard: { writeText: async () => { throw new Error("should not copy"); } } };
  assert.equal(await handOver(link, { navigator: nav, toast: (t) => notes.push(t) }), "dismissed");
  assert.deepEqual(notes, []);
});

test("on a laptop the link is copied and a short 'Link copied' note is shown", async () => {
  const copied = [], notes = [];
  const nav = { clipboard: { writeText: async (t) => { copied.push(t); } } };
  assert.equal(await handOver(link, { navigator: nav, toast: (t) => notes.push(t) }), "copied");
  assert.deepEqual(copied, [link.url]);
  assert.deepEqual(notes, ["Link copied"]);
});

test("a share sheet the browser refuses falls through to the clipboard", async () => {
  const copied = [], notes = [];
  const nav = { share: async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); }, clipboard: { writeText: async (t) => { copied.push(t); } } };
  assert.equal(await handOver(link, { navigator: nav, toast: (t) => notes.push(t) }), "copied");
  assert.deepEqual(copied, [link.url]);
  assert.deepEqual(notes, ["Link copied"]);
});

test("where nothing can share or copy, the link itself is shown", async () => {
  const notes = [];
  assert.equal(await handOver(link, { navigator: {}, toast: (t) => notes.push(t) }), "shown");
  assert.deepEqual(notes, [link.url]);
  const blocked = { clipboard: { writeText: async () => { throw new Error("blocked"); } } };
  notes.length = 0;
  assert.equal(await handOver(link, { navigator: blocked, toast: (t) => notes.push(t) }), "shown");
  assert.deepEqual(notes, [link.url]);
});

test("the icon sits in the header's button row, immediately left of How to play, with the studio's glyph", () => {
  const page = readFileSync(new URL("../dev.html", import.meta.url), "utf8");
  const row = page.slice(page.indexOf('<div class="bar-right">'), page.indexOf("</header>"));
  const share = row.indexOf('id="share"');
  const howTo = row.indexOf('id="how-to"');
  assert.ok(share > -1 && howTo > -1, "both buttons are in the row");
  assert.ok(share < howTo, "the icon comes before How to play");
  assert.ok(!/id="[^"]+"/.test(row.slice(share + 10, howTo)), "and nothing sits between them");
  assert.ok(row.includes('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/>'), "the shared upload-arrow glyph");
  assert.ok(page.includes('<link rel="canonical" href="https://shozbot.com/letter-drop/">'), "the canonical link the address is built from");
});
