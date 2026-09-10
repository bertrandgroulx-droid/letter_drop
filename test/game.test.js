import test from "node:test";
import assert from "node:assert/strict";
import {
  Game,
  PERFECT_SCORE,
  blocks,
  keepCount,
  nextWords,
} from "../src/game.js";
import { DICTIONARY, SEED_WORDS } from "../src/words.js";

/** Choose a block, pick an end, add a letter, and commit. */
function play(game, indices, letter, side = "end") {
  indices.forEach((i) => game.toggleSelect(i));
  game.setSide(side);
  game.setLetter(letter);
  return game.submit();
}

/** PLANT to LAND to LAB to AH, which then falls to A. A perfect run. */
function perfectRun(game) {
  play(game, [1, 2, 3], "d");
  play(game, [0, 1], "b");
  return play(game, [1], "h");
}

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

test("next words never reuse a letter already on the board", () => {
  const used = new Set("plant");
  const next = nextWords("plant", DICTIONARY, used);
  assert.ok(next.includes("land"), "D is still free");
  assert.ok(!next.includes("plan"), "P is already on the board");
  assert.ok(next.every((w) => [...w].filter((c) => !used.has(c)).length === 1));
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

test("a letter already on the board is refused", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));

  const reused = game.setLetter("p");
  assert.equal(reused.ok, false);
  assert.match(reused.reason, /already on the board/);
  assert.equal(game.letter, "", "the slot stays empty");

  assert.equal(game.setLetter("d").ok, true, "D has not been used");
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

test("a clean run scores every point on offer", () => {
  const game = new Game({ seed: "plant" });
  perfectRun(game);

  assert.deepEqual(game.rows.map((r) => r.word), ["plant", "land", "lab", "ah", "a"]);
  assert.equal(game.phase, "won");
  assert.deepEqual(game.newLetters, ["b", "d", "h"]);
  assert.deepEqual(game.score, { words: 8, letters: 3, penalty: 0, total: PERFECT_SCORE });
});

test("the last letter falls on its own", () => {
  const game = new Game({ seed: "plant" });
  const result = perfectRun(game);
  assert.equal(result.word, "ah");
  assert.equal(result.fell, "a", "AH reports the letter that fell");
  assert.equal(game.currentWord, "a");
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
  perfectRun(game);
  game.undo();
  assert.equal(game.currentWord, "lab", "back to the last real choice, not to AH");
  assert.equal(game.phase, "select");
});

test("undo costs a point once there is a word to take back", () => {
  const game = new Game({ seed: "plant" });
  play(game, [1, 2, 3], "d");
  assert.equal(game.score.total, 3);

  game.undo();
  assert.equal(game.currentWord, "plant");
  assert.equal(game.undos, 1);
  assert.equal(game.score.penalty, 1);
  assert.equal(game.score.total, 0, "the score never goes below zero");

  play(game, [1, 2, 3], "d");
  assert.equal(game.score.total, 2, "three points for LAND, less the undo");
});

test("backing out of a split you have not committed is free", () => {
  const game = new Game({ seed: "plant" });
  [1, 2, 3].forEach((i) => game.toggleSelect(i));
  assert.equal(game.phase, "build");
  game.undo();
  assert.equal(game.phase, "select");
  assert.equal(game.undos, 0, "nothing was committed, so nothing is charged");
  assert.deepEqual(game.selection, []);
});

test("a dead end is reported instead of silently accepted", () => {
  const dictionary = { ...DICTIONARY, 3: new Set(["cat"]) };
  const game = new Game({ seed: "plant", dictionary });
  play(game, [1, 2, 3], "d");
  assert.equal(game.phase, "stuck", "no 3-letter word survives from LAND");
});

test("the per-word breakdown adds up to the score", () => {
  const game = new Game({ seed: "plant" });
  perfectRun(game);
  assert.deepEqual(game.breakdown, [
    { word: "land", newLetter: "d", points: 3 },
    { word: "lab", newLetter: "b", points: 3 },
    { word: "ah", newLetter: "h", points: 3 },
    { word: "a", newLetter: null, points: 2 },
  ]);
  assert.equal(
    game.breakdown.reduce((sum, entry) => sum + entry.points, 0),
    game.score.total
  );
});

test("a perfect game is every word plus every new letter", () => {
  assert.equal(PERFECT_SCORE, 11);
});

test("every opening word can be played to a single letter without reusing one", () => {
  const solve = (word, used) =>
    word.length === 1 ||
    nextWords(word, DICTIONARY, used).some((next) =>
      solve(next, new Set([...used, ...next])));

  const step = Math.floor(SEED_WORDS.length / 150);
  const sample = SEED_WORDS.filter((_, i) => i % step === 0);
  const failures = sample.filter((word) => !solve(word, new Set(word)));
  assert.deepEqual(failures, [], "unsolvable openers");
});
