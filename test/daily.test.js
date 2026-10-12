import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LEVEL, FINISH_BONUS, Game, dailyWord } from "../src/game.js";
import { DICTIONARY, SEEDS } from "../src/words.js";
// A plain script: loading it defines globalThis.ShozDaily rather than exporting.
import "../src/shozbot-daily.js";

const { ShozDaily } = globalThis;

/** A throwaway localStorage, so a test never touches a real one. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

function kit(now, storage = memoryStorage()) {
  return ShozDaily.create({ game: "letter-drop", title: "Letter Drop", storage, now: () => now });
}

const OCT_12 = new Date(2026, 9, 12, 15, 30);

/** Choose a block, pick an end, add a letter, and commit. */
function play(game, indices, letter, side = "end") {
  indices.forEach((i) => game.toggleSelect(i));
  game.setSide(side);
  game.setLetter(letter);
  return game.submit();
}

test("the day's word is the same every time it is drawn", () => {
  const daily = kit(OCT_12);
  const meta = daily.todayMeta();
  const first = dailyWord(daily.rng(meta.seed));
  const second = dailyWord(daily.rng(meta.seed));
  assert.equal(first, second);
  assert.equal(first.length, 5);
});

test("the day's word comes from the default level's pool", () => {
  const daily = kit(OCT_12);
  for (let i = 0; i < 30; i += 1) {
    const meta = daily.metaFor(daily.addDays(OCT_12, -i));
    assert.ok(SEEDS[DEFAULT_LEVEL].includes(dailyWord(daily.rng(meta.seed))), `${meta.iso} is dealt at the default level`);
  }
});

test("different days are dealt different words, by and large", () => {
  const daily = kit(OCT_12);
  const words = new Set();
  for (let i = 0; i < 60; i += 1) {
    words.add(dailyWord(daily.rng(daily.metaFor(daily.addDays(OCT_12, -i)).seed)));
  }
  assert.ok(words.size > 50, `${words.size} distinct words over 60 days`);
});

test("the daily is numbered by the day of the year and stored under the game's prefix", () => {
  const storage = memoryStorage();
  const daily = kit(OCT_12, storage);
  const meta = daily.todayMeta();
  assert.equal(meta.number, 285);
  assert.equal(meta.iso, "2026-10-12");
  daily.save(meta, { score: 12, max: 18, results: [4, 4, 4], recap: {} });
  assert.ok(storage.getItem("letterdrop:daily:2026-10-12"), "the key the collection page reads");
});

test("the first finished score is the one that is kept", () => {
  const daily = kit(OCT_12);
  const meta = daily.todayMeta();
  assert.deepEqual(daily.save(meta, { score: 11, max: 18 }), { first: true, saved: true });
  assert.deepEqual(daily.save(meta, { score: 18, max: 18 }), { first: false, saved: false });
  assert.equal(daily.record(meta.iso).score, 11, "the better replay does not overwrite it");
  assert.equal(daily.savedLine(meta, true), "Saved as your score for today.");
  assert.equal(daily.savedLine(meta, false), "Your first score for this puzzle is the one that is kept.");
});

test("the streak counts days in a row ending today or yesterday", () => {
  const storage = memoryStorage();
  const daily = kit(OCT_12, storage);
  const day = (n) => daily.metaFor(daily.addDays(OCT_12, n));
  assert.equal(daily.streak(), 0);
  daily.save(day(-1), { score: 5, max: 18 });
  daily.save(day(-2), { score: 5, max: 18 });
  assert.equal(daily.streak(), 2, "yesterday and the day before, with today still to play");
  assert.equal(daily.streakLine(), "2 days in a row");
  daily.save(day(0), { score: 5, max: 18 });
  assert.equal(daily.streak(), 3);
  daily.save(day(-4), { score: 5, max: 18 });
  assert.equal(daily.streak(), 3, "a gap three days back does not count");
  assert.equal(kit(daily.addDays(OCT_12, 2), storage).streak(), 0, "a missed day ends it");
});

test("the ceiling for the deal is the maximum the results are measured against", () => {
  const game = new Game({ seed: "plant" });
  play(game, [1, 2, 3], "f", "front");
  play(game, [2, 3], "y");
  play(game, [0], "h");
  assert.equal(game.isPerfect, true);
  const daily = kit(OCT_12);
  assert.equal(daily.verdict(game.score.total, game.bestPossible, daily.todayMeta()), "A perfect game.");
});

test("a run is closed by reaching a letter, giving up, striking out or looking, not by a dead end", () => {
  const stuck = new Game({ seed: "plant", dictionary: { ...DICTIONARY, 3: new Set(["cat"]) } });
  play(stuck, [1, 2, 3], "d");
  assert.equal(stuck.phase, "stuck");
  assert.equal(stuck.isClosed, false, "undo is the way out of a dead end");
  stuck.answerShown = true;
  assert.equal(stuck.isClosed, true, "but looking closes it");

  const won = new Game({ seed: "plant" });
  play(won, [1, 2, 3], "d");
  play(won, [0, 1], "b");
  play(won, [1], "h");
  assert.equal(won.isClosed, true);

  const gaveUp = new Game({ seed: "plant" });
  gaveUp.giveUp();
  assert.equal(gaveUp.isClosed, true);
});

test("a run can be written down and shown again from the record", () => {
  const game = new Game({ seed: "plant" });
  play(game, [1, 2, 3], "z");          // a wrong guess, for the strike
  play(game, [], "d");
  play(game, [0, 1], "b");
  game.undo();                          // costs a point
  play(game, [0, 1], "b");
  play(game, [1], "h");
  assert.equal(game.phase, "won");

  const back = Game.restore("plant", game.record);
  assert.deepEqual(back.rows, game.rows);
  assert.equal(back.phase, "won");
  assert.equal(back.strikes, 1);
  assert.equal(back.undos, 1);
  assert.deepEqual(back.score, game.score);
  assert.deepEqual(back.breakdown, game.breakdown);
  assert.equal(back.restored, true);
  assert.equal(back.canUndo, false, "a saved day is a record, not a game to carry on");
  assert.equal(back.giveUp(), false);
  assert.equal(back.isOver, true);
});

test("a record for a different word, or none, gives a fresh game rather than a broken one", () => {
  const other = new Game({ seed: "plant" });
  play(other, [1, 2, 3], "d");
  for (const record of [null, undefined, {}, { rows: [] }, other.record]) {
    const game = Game.restore("about", record);
    assert.equal(game.seed, "about");
    assert.deepEqual(game.rows, [{ word: "about", added: null, kept: null }]);
    assert.equal(game.restored, false);
  }
});

test("a gave-up run comes back gave up, with the answer shown", () => {
  const game = new Game({ seed: "plant" });
  play(game, [1, 2, 3], "d");
  game.giveUp();
  const back = Game.restore("plant", game.record);
  assert.equal(back.phase, "gaveup");
  assert.equal(back.answerShown, true);
  assert.equal(back.score.total, game.score.total);
});

test("the share text is the kit's heading and score with the game's grid under it", () => {
  const daily = kit(OCT_12);
  const text = daily.shareText({
    meta: daily.todayMeta(), score: 18, max: 18,
    squares: "\n\u{1F7E7}\u{1F7E7}\u{1F7E7}\u{1F7E9} 5", url: "https://shozbot.com/letter-drop/",
  }).replace(" \n", "\n");
  assert.deepEqual(text.split("\n"), [
    "Letter Drop No. 285 · Oct 12",
    "18/18",
    "\u{1F7E7}\u{1F7E7}\u{1F7E7}\u{1F7E9} 5",
    "https://shozbot.com/letter-drop/",
  ]);
});

test("the finish bonus is part of the saved score, as the ceiling includes it", () => {
  const game = new Game({ seed: "plant" });
  play(game, [1, 2, 3], "d");
  play(game, [0, 1], "b");
  play(game, [1], "h");
  assert.equal(game.score.bonus, FINISH_BONUS);
  assert.ok(game.score.total <= game.bestPossible);
});
