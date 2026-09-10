import { DICTIONARY, SEED_WORDS } from "./words.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const SINGLE_LETTER_WORDS = ["a", "i"];

export const POINTS_PER_WORD = 2;
export const POINTS_PER_NEW_LETTER = 1;

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

/** Every word reachable from `word` in one round. */
export function nextWords(word, dictionary = DICTIONARY) {
  if (word.length <= 1) return [];
  if (word.length === 2) return SINGLE_LETTER_WORDS.filter((c) => word.includes(c));

  const target = dictionary[word.length - 1];
  const found = new Set();
  for (const [start, end] of blocks(word, keepCount(word.length))) {
    const block = word.slice(start, end);
    for (const letter of ALPHABET) {
      if (target.has(letter + block)) found.add(letter + block);
      if (target.has(block + letter)) found.add(block + letter);
    }
  }
  return [...found].sort();
}

/** The letters that make a real word when added to `block` on `side`. */
export function playableLetters(block, side, dictionary = DICTIONARY) {
  const target = dictionary[block.length + 1];
  if (!target) return new Set();
  return new Set(
    [...ALPHABET].filter((c) => target.has(side === "front" ? c + block : block + c))
  );
}

export function randomSeed(random = Math.random) {
  return SEED_WORDS[Math.floor(random() * SEED_WORDS.length)];
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

  /** Letters the player brought in that were not in the opening word. */
  get newLetters() {
    const fromSeed = new Set(this.seed);
    const used = new Set();
    for (const row of this.rows.slice(1)) {
      for (const c of row.word) if (!fromSeed.has(c)) used.add(c);
    }
    return [...used].sort();
  }

  get score() {
    return {
      words: this.wordsMade * POINTS_PER_WORD,
      letters: this.newLetters.length * POINTS_PER_NEW_LETTER,
      get total() {
        return this.words + this.letters;
      },
    };
  }

  /** Decide what the player can do from the word now on the board. */
  refreshPhase() {
    const word = this.currentWord;
    if (word.length === 1) {
      this.phase = "won";
    } else if (word.length === 2) {
      this.phase = nextWords(word, this.dictionary).length ? "final" : "done";
    } else {
      this.phase = nextWords(word, this.dictionary).length ? "select" : "stuck";
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

  setLetter(letter) {
    if (this.phase !== "build") return false;
    this.letter = /^[a-z]$/i.test(letter) ? letter.toLowerCase() : "";
    return true;
  }

  get draftWord() {
    if (this.phase !== "build" || !this.letter) return null;
    return this.side === "front" ? this.letter + this.block : this.block + this.letter;
  }

  /** Check the built word. Returns {ok} or {ok: false, reason}. */
  submit() {
    if (this.phase !== "build") return { ok: false, reason: "not building" };
    if (!this.letter) return { ok: false, reason: "Add a letter first." };
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
    return { ok: true, word };
  }

  /** The last move: let the A or I in a 2-letter word fall on its own. */
  dropFinal(index) {
    if (this.phase !== "final") return { ok: false, reason: "not the last round" };
    const letter = this.currentWord[index];
    if (!SINGLE_LETTER_WORDS.includes(letter)) {
      return { ok: false, reason: "Only A and I are words on their own." };
    }
    this.currentRow.kept = [index, index + 1];
    this.rows.push({ word: letter, added: null, kept: null });
    this.refreshPhase();
    return { ok: true, word: letter };
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
    this.rows.pop();
    this.currentRow.kept = null;
    this.selection = [];
    this.block = null;
    this.letter = "";
    this.refreshPhase();
    return true;
  }
}
