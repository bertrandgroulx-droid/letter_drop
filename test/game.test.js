import test from "node:test";
import assert from "node:assert/strict";
import { Game, blocks, keepCount, nextWords } from "../src/game.js";
import { DICTIONARY, SEED_WORDS } from "../src/words.js";

test("each round keeps two fewer letters than the word", () => {
  assert.deepEqual([5, 4, 3].map(keepCount), [3, 2, 1]);
});

test("there are always three ways to split a word", () => {
  for (const n of [5, 4, 3]) {
    assert.equal(blocks("a".repeat(n), keepCount(n)).length, 3);
  }
});

test("next words keep the block intact and add one letter on an end", () => {
  const next = nextWords("plant");
  assert.ok(next.includes("land"), "LAN + D");
  assert.ok(next.includes("plan"), "P + LAN");
  assert.ok(next.every((w) => w.length === 4));
  assert.ok(
    next.every((w) => blocks("plant", 3).some(([a, b]) => {
      const block = "plant".slice(a, b);
      return w.startsWith(block) || w.endsWith(block);
    })),
    "every result still holds one of the three blocks, whole and in order"
  );
  assert.ok(!next.includes("tarp"), "letters may not be reordered");
});

test("a two-letter word only drops to the A or I it contains", () => {
  assert.deepEqual(nextWords("ad"), ["a"]);
  assert.deepEqual(nextWords("hi"), ["i"]);
  assert.deepEqual(nextWords("go"), []);
});

test("selection must stay contiguous", () => {
  const game = new Game({ seed: "plant" });
  assert.ok(game.toggleSelect(0));
  assert.equal(game.canSelect(2), false, "cannot skip a letter");
  assert.ok(game.canSelect(1));
  game.toggleSelect(1);
  assert.equal(game.canSelect(3), false, "cannot extend past the far end");
});

test("the drop happens as soon as enough letters are chosen", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  assert.equal(game.phase, "build");
  assert.equal(game.block, "lan");
});

test("a word not in the list is refused", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("z");
  const result = game.submit();
  assert.equal(result.ok, false);
  assert.match(result.reason, /LANZ/);
  assert.equal(game.phase, "build", "the player stays put and can try again");
});

test("a full run scores two a word plus one for each new letter", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  assert.ok(game.submit().ok, "LAND");

  [0, 1].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  assert.ok(game.submit().ok, "LAD");

  game.toggleSelect(2);
  game.setSide("front");
  game.setLetter("a");
  assert.ok(game.submit().ok, "AD");

  assert.equal(game.phase, "won", "the A falls without being asked");

  assert.deepEqual(game.rows.map((r) => r.word), ["plant", "land", "lad", "ad", "a"]);
  assert.deepEqual(game.newLetters, ["d"]);
  assert.deepEqual({ ...game.score, total: game.score.total }, { words: 8, letters: 1, total: 9 });
});

test("the last letter falls on its own", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();
  [0, 1].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();

  game.toggleSelect(2);
  game.setSide("front");
  game.setLetter("a");
  const result = game.submit();

  assert.equal(result.word, "ad");
  assert.equal(result.fell, "a", "AD reports the letter that fell");
  assert.equal(game.currentWord, "a");
  assert.equal(game.phase, "won");
  assert.equal(game.score.words, 8, "the fall still scores as a word");
});

test("a two-letter word without an A or I is the end of the road", () => {
  const game = new Game({ seed: "plant" });
  game.rows.push({ word: "go", added: null, kept: null });
  game.refreshPhase();
  assert.equal(game.phase, "done");
  assert.equal(game.fallThrough(), null, "nothing falls from GO");
});

test("undo steps back past the letter that fell on its own", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();
  [0, 1].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();
  game.toggleSelect(2);
  game.setSide("front");
  game.setLetter("a");
  game.submit();

  assert.equal(game.phase, "won");
  game.undo();
  assert.equal(game.currentWord, "lad", "back to the last real choice, not to AD");
  assert.equal(game.phase, "select");
});

test("undo walks back one word at a time", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();
  assert.equal(game.currentWord, "land");
  game.undo();
  assert.equal(game.currentWord, "plant");
  assert.equal(game.rows[0].kept, null, "the old split is cleared too");
  assert.equal(game.phase, "select");
  assert.equal(game.score.total, 0);
});

test("undo backs out of a split before it backs out of a word", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  assert.equal(game.phase, "build");
  game.undo();
  assert.equal(game.phase, "select");
  assert.equal(game.currentWord, "plant");
  assert.deepEqual(game.selection, []);
});

test("a dead end is reported instead of silently accepted", () => {
  const dictionary = { ...DICTIONARY, 3: new Set(["cat"]) };
  const game = new Game({ seed: "plant", dictionary });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  game.setLetter("d");
  game.submit();
  assert.equal(game.phase, "stuck", "no 3-letter word survives from LAND");
});

test("every opening word can be played to a single letter", () => {
  const solve = (word, seen = new Set()) => {
    if (word.length === 1) return true;
    if (seen.has(word)) return false;
    seen.add(word);
    return nextWords(word).some((next) => solve(next, seen));
  };
  const step = Math.floor(SEED_WORDS.length / 150);
  const sample = SEED_WORDS.filter((_, i) => i % step === 0);
  const failures = sample.filter((word) => !solve(word));
  assert.deepEqual(failures, [], "unsolvable openers");
});
