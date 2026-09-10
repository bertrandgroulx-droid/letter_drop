import { DICTIONARY, SEED_WORDS } from "./words.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const SINGLE_LETTER_WORDS = ["a", "i"];

export const POINTS_PER_WORD = 2;
export const UNDO_COST = 1;

/**
 * For getting all the way down to a single letter. Without it, stalling on a
 * two-letter word that holds no A or I costs nothing on about a third of
 * deals, because a three-point letter the round before covers the two points
 * the fall would have paid.
 */
export const FINISH_BONUS = 3;

const NOTHING_USED = new Set();

/**
 * What a letter is worth when you bring it in, banded from Scrabble tile
 * values: the everyday letters, the awkward ones, and the ones you have to
 * build a word around.
 */
export const LETTER_VALUES = Object.fromEntries([
  ...[..."aeilnorstu"].map((c) => [c, 1]),
  ...[..."dgbcmp"].map((c) => [c, 2]),
  ...[..."fhvwykjxqz"].map((c) => [c, 3]),
]);

export function letterValue(letter) {
  return LETTER_VALUES[letter] ?? 0;
}


/** How many letters carry over from a word of this length into the next round. */
export function keepCount(length) {
  return length - 2;
}

/** Every run of `size` consecutive letters in `word`, as [start, end) pairs. */
export function blocks(word, size) {
  const out = [];
  for (let i = 0; i + size <= word.length; i += 1) out.push([i, i + size]);
  return out;
}

/**
 * Every word reachable from `word` in one round. Letters in `used` are off
 * limits, because a letter may only be added to the board once.
 */
export function nextWords(word, dictionary = DICTIONARY, used = NOTHING_USED) {
  if (word.length <= 1) return [];
  if (word.length === 2) return SINGLE_LETTER_WORDS.filter((c) => word.includes(c));

  const target = dictionary[word.length - 1];
  const found = new Set();
  for (const [start, end] of blocks(word, keepCount(word.length))) {
    const block = word.slice(start, end);
    for (const letter of ALPHABET) {
      if (used.has(letter)) continue;
      if (target.has(letter + block)) found.add(letter + block);
      if (target.has(block + letter)) found.add(block + letter);
    }
  }
  return [...found].sort();
}

export function randomSeed(random = Math.random) {
  return SEED_WORDS[Math.floor(random() * SEED_WORDS.length)];
}

/** The letters that make a real word when added to `block` on `side`. */
export function playableLetters(block, side, dictionary = DICTIONARY, used = NOTHING_USED) {
  const target = dictionary[block.length + 1];
  if (!target) return new Set();
  return new Set([...ALPHABET].filter(
    (c) => !used.has(c) && target.has(side === "front" ? c + block : block + c)
  ));
}

/**
 * The highest-scoring run from this position, the finish included, and the
 * words it goes through. Several runs often tie, and this returns the first
 * of them, so it is a best line rather than the best line.
 */
function bestRunFrom(word, used, dictionary) {
  if (word.length === 1) return { score: FINISH_BONUS, line: [] };

  // Stalling here scores nothing further, and is the score to beat.
  let best = { score: 0, line: [] };
  for (const next of nextWords(word, dictionary, used)) {
    const added = [...next].find((c) => !used.has(c)) ?? null;
    const points = POINTS_PER_WORD + (added ? letterValue(added) : 0);
    const rest = bestRunFrom(next, new Set([...used, ...next]), dictionary);
    if (points + rest.score > best.score) {
      best = {
        score: points + rest.score,
        line: [{ word: next, added, points }, ...rest.line],
      };
    }
  }
  return best;
}

/**
 * One puzzle. `rows` is the chain of words built so far, oldest first. Each row
 * records how it was made (`added`) and which of its letters drop into the next
 * word (`kept`), both null until they happen.
 */
export class Game {
  constructor({ seed = randomSeed(), dictionary = DICTIONARY } = {}) {
    this.dictionary = dictionary;
    this.seed = seed;
    this.rows = [{ word: seed, added: null, kept: null }];
    this.selection = [];
    this.block = null;
    this.side = "end";
    this.letter = "";
    this.phase = "select";
    this.undos = 0;
    this.hintsUsed = false;
    this.best = null;
    this.refreshPhase();
  }

  get currentRow() {
    return this.rows[this.rows.length - 1];
  }

  get currentWord() {
    return this.currentRow.word;
  }

  get keepCount() {
    return keepCount(this.currentWord.length);
  }

  get isOver() {
    return this.phase === "won" || this.phase === "done" || this.phase === "stuck";
  }

  /** Words the player made. The opener was dealt, not earned, so it does not count. */
  get wordsMade() {
    return this.rows.length - 1;
  }

  /** Every letter on the board, so every letter that can no longer be added. */
  get usedLetters() {
    const used = new Set(this.seed);
    for (const row of this.rows.slice(1)) {
      for (const c of row.word) used.add(c);
    }
    return used;
  }

  /** Letters the player brought in that were not in the opening word. */
  get newLetters() {
    const fromSeed = new Set(this.seed);
    const used = new Set();
    for (const row of this.rows.slice(1)) {
      for (const c of row.word) if (!fromSeed.has(c)) used.add(c);
    }
    return [...used].sort();
  }

  /**
   * What each word you made was worth, and what it could have been worth. Only
   * the word that first brings a letter in scores for it, and the last letter
   * falls without adding one, so it can never reach three.
   */
  get breakdown() {
    const seen = new Set(this.seed);
    return this.rows.slice(1).map((row) => {
      const fresh = [...row.word].filter((c) => !seen.has(c));
      fresh.forEach((c) => seen.add(c));
      return {
        word: row.word,
        newLetter: fresh[0] ?? null,
        points: POINTS_PER_WORD + (fresh.length ? letterValue(fresh[0]) : 0),
      };
    });
  }

  /**
   * The best this particular deal was ever worth, which is what the final
   * score is measured against. Takes a few milliseconds, so it waits until
   * something asks, which is the end of the game.
   */
  get bestRun() {
    if (this.best === null) {
      this.best = bestRunFrom(this.seed, new Set(this.seed), this.dictionary);
    }
    return this.best;
  }

  get bestPossible() {
    return this.bestRun.score;
  }

  get score() {
    const words = this.wordsMade * POINTS_PER_WORD;
    const letters = this.newLetters.reduce((sum, c) => sum + letterValue(c), 0);
    const bonus = this.phase === "won" ? FINISH_BONUS : 0;
    const penalty = this.undos * UNDO_COST;
    return {
      words,
      letters,
      bonus,
      penalty,
      total: Math.max(0, words + letters + bonus - penalty),
    };
  }

  /** Decide what the player can do from the word now on the board. */
  refreshPhase() {
    const word = this.currentWord;
    const open = nextWords(word, this.dictionary, this.usedLetters).length > 0;
    if (word.length === 1) {
      this.phase = "won";
    } else if (word.length === 2) {
      this.phase = open ? "final" : "done";
    } else {
      this.phase = open ? "select" : "stuck";
    }
    return this.phase;
  }

  /** A tile can join the selection only if it keeps the run unbroken. */
  canSelect(index) {
    if (this.phase !== "select") return false;
    if (this.selection.includes(index)) return index === this.selection[0] ||
      index === this.selection[this.selection.length - 1];
    if (this.selection.length >= this.keepCount) return false;
    if (this.selection.length === 0) return true;
    return index === this.selection[0] - 1 ||
      index === this.selection[this.selection.length - 1] + 1;
  }

  /** Add or remove a tile. Once the run is the right size it drops on its own. */
  toggleSelect(index) {
    if (!this.canSelect(index)) return false;
    if (this.selection.includes(index)) {
      this.selection = this.selection.filter((i) => i !== index);
    } else {
      this.selection = [...this.selection, index].sort((a, b) => a - b);
    }
    if (this.selection.length === this.keepCount) this.drop();
    return true;
  }

  /** Commit the selected run and move on to building the next word. */
  drop() {
    if (this.phase !== "select" || this.selection.length !== this.keepCount) return false;
    const [start] = this.selection;
    const end = this.selection[this.selection.length - 1] + 1;
    this.currentRow.kept = [start, end];
    this.block = this.currentWord.slice(start, end);
    this.letter = "";
    this.side = "end";
    this.phase = "build";
    return true;
  }

  setSide(side) {
    if (this.phase !== "build") return false;
    this.side = side;
    return true;
  }

  /** Refuses a letter that is already on the board. */
  setLetter(letter) {
    if (this.phase !== "build") return { ok: false };
    if (!/^[a-z]$/i.test(letter)) {
      this.letter = "";
      return { ok: true };
    }
    const c = letter.toLowerCase();
    if (this.usedLetters.has(c)) {
      return {
        ok: false,
        reason: `${c.toUpperCase()} is already on the board. Add a letter you have not used.`,
      };
    }
    this.letter = c;
    return { ok: true };
  }

  get draftWord() {
    if (this.phase !== "build" || !this.letter) return null;
    return this.side === "front" ? this.letter + this.block : this.block + this.letter;
  }

  /** Check the built word. Returns {ok} or {ok: false, reason}. */
  submit() {
    if (this.phase !== "build") return { ok: false, reason: "not building" };
    if (!this.letter) return { ok: false, reason: "Add a letter first." };
    if (this.usedLetters.has(this.letter)) {
      return { ok: false, reason: `${this.letter.toUpperCase()} is already on the board.` };
    }
    const word = this.draftWord;
    if (!this.dictionary[word.length].has(word)) {
      return { ok: false, reason: `${word.toUpperCase()} is not in the word list.` };
    }
    this.rows.push({
      word,
      added: { letter: this.letter, side: this.side },
      kept: null,
    });
    this.selection = [];
    this.block = null;
    this.letter = "";
    this.refreshPhase();
    return { ok: true, word, fell: this.fallThrough() };
  }

  /**
   * The last round is not a decision. If the two-letter word holds an A or an
   * I, there is only ever one thing to do, so it falls on its own.
   */
  fallThrough() {
    if (this.phase !== "final") return null;
    const index = [...this.currentWord].findIndex((c) => SINGLE_LETTER_WORDS.includes(c));
    const letter = this.currentWord[index];
    this.currentRow.kept = [index, index + 1];
    this.rows.push({ word: letter, added: null, kept: null });
    this.refreshPhase();
    return letter;
  }

  /** Step back one word, or clear a half-finished selection. */
  undo() {
    if (this.phase === "build") {
      this.currentRow.kept = null;
      this.selection = [];
      this.block = null;
      this.letter = "";
      this.phase = "select";
      return true;
    }
    if (this.selection.length) {
      this.selection = [];
      return true;
    }
    if (this.rows.length < 2) return false;
    this.undos += 1;
    this.rows.pop();
    // The last letter fell on its own, so step back past it to a real choice.
    if (this.currentWord.length === 2 && this.rows.length > 1) this.rows.pop();
    this.currentRow.kept = null;
    this.selection = [];
    this.block = null;
    this.letter = "";
    this.refreshPhase();
    return true;
  }
}
