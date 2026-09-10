import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINISH_BONUS,
  LETTER_VALUES,
  LEVELS,
  LEVEL_NAMES,
  POINTS_PER_WORD,
  STRIKE_LIMIT,
  UNDO_COST,
} from "../src/game.js";

/**
 * The instructions are prose and the rules are code, so they drift apart
 * silently. These check that what the dialog claims still matches what the
 * game does. If you change a rule and one of these fails, the fix is to update
 * the dialog, not the test.
 */
const page = readFileSync(new URL("../dev.html", import.meta.url), "utf8");
const rules = page.slice(page.indexOf('<dialog id="rules">'), page.indexOf("</dialog>"));

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];

/** Matches "3 points" or "Three points", ignoring the line breaks in the markup. */
function claims(number, noun) {
  const flat = rules.replace(/\s+/g, " ");
  const word = WORDS[number] ?? String(number);
  const plural = number === 1
    ? noun
    : noun.endsWith("s") ? `${noun}es` : `${noun}s`;
  return new RegExp(`(${number}|${word})\\s${plural}`, "i").test(flat);
}

test("the instructions exist and are reachable", () => {
  assert.ok(rules.includes("How to play"));
  assert.ok(page.includes('id="how-to"'), "and there is a button that opens them");
});

test("what a word is worth is stated correctly", () => {
  assert.ok(claims(POINTS_PER_WORD, "point"), `should say ${POINTS_PER_WORD} points a word`);
});

test("the letter value bands are stated correctly", () => {
  const bands = [...new Set(Object.values(LETTER_VALUES))].sort();
  assert.deepEqual(bands, [1, 2, 3], "if the bands change, so must this sentence");
  assert.match(rules.replace(/\s+/g, " "), /1, 2 or 3 points/);
});

test("the finish bonus is stated correctly", () => {
  assert.ok(claims(FINISH_BONUS, "point"), `should say ${FINISH_BONUS} points for finishing`);
});

test("the cost of undo is stated correctly", () => {
  assert.ok(claims(UNDO_COST, "point"), `should say undo costs ${UNDO_COST}`);
  assert.match(rules, /Undo costs/i);
});

test("the strike limit is stated correctly", () => {
  assert.ok(
    claims(STRIKE_LIMIT, "wrong guess"),
    `should say ${STRIKE_LIMIT} wrong guesses end the game`
  );
});

test("every level is described, by the name players see", () => {
  for (const level of LEVELS) {
    const shown = LEVEL_NAMES[level];
    assert.ok(shown, `${level} needs a name on screen`);
    assert.match(rules, new RegExp(`<b>${shown}</b>`, "i"), `${shown} should be explained`);
  }
});

test("the controls the game offers are all explained", () => {
  for (const [control, mention] of [
    ["hints", /Hints/],
    ["give up", /give up/i],
    ["the dictionary book", /book/i],
    ["the A or I endgame", /A or an I/],
    ["dropping is carrying, not discarding", /not discarding/i],
  ]) {
    assert.match(rules, mention, `${control} should be covered`);
  }
});
