import { DEFAULT_LEVEL, FINISH_BONUS, Game, LEVELS, LEVEL_NAMES, STRIKE_LIMIT, UNDO_COST, letterValue, playableLetters, randomSeed } from "./game.js";
import { DICTIONARY } from "./words.js";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const els = {
  board: document.getElementById("board"),
  message: document.getElementById("message"),
  score: document.getElementById("score"),
  keyboard: document.getElementById("keyboard"),
  undo: document.getElementById("undo"),
  tallyDetail: document.getElementById("tally-detail"),
  breakdown: document.getElementById("breakdown"),
  result: document.getElementById("result"),
  hints: document.getElementById("hints"),
  level: document.getElementById("level"),
  levelNames: document.getElementById("level-names"),
  tallyLabel: document.getElementById("tally-label"),
  giveUp: document.getElementById("give-up"),
  strikes: document.getElementById("strikes"),
  newGame: document.getElementById("new-game"),
  howTo: document.getElementById("how-to"),
  rules: document.getElementById("rules"),
};

/** ?word=plant opens a specific puzzle, so a game can be shared or replayed. */
function requestedSeed() {
  const word = new URLSearchParams(location.search).get("word")?.toLowerCase();
  return word && DICTIONARY[5]?.has(word) ? word : undefined;
}

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

// A level that no longer exists, or none at all, lands in the middle.
let level = LEVELS.includes(store.get("letterdrop.level"))
  ? store.get("letterdrop.level")
  : DEFAULT_LEVEL;
let game = new Game({ seed: requestedSeed() ?? randomSeed(level) });
let landingFrom = 0;
let hintsOn = false;
let definitionFor = null;
let definitionIn = null;   // which list the open definition belongs under
let giveUpArmed = false;
let hintsArmed = false;

// Wikimedia's own endpoint: no key, and the only free source that actually
// carries the short Scrabble words. Blocked outright in some embeddings, which
// is what the link fallback is for.
const DEFINITION_API = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const LOOKUP_TIMEOUT = 6000;
const definitions = new Map();
let note = "";
let noteIsError = false;


/* ---------- rendering ---------- */

function addedIndex(row) {
  if (!row.added) return -1;
  return row.added.side === "front" ? 0 : row.word.length - 1;
}

/**
 * Once a row has given up its letters it says so: the ones that went down are
 * greyed and arrowed, and the ones left behind fade, because they are out of
 * the game. The letter added to a row needs no marking of its own, since every
 * added letter is a new one.
 */
function tileClasses(row, index, isCurrent) {
  const classes = ["tile"];
  if (row.kept) {
    const wentDown = index >= row.kept[0] && index < row.kept[1];
    classes.push(wentDown ? "dropped" : "spent");
  }
  if (isCurrent && game.phase === "select" && game.selection.includes(index)) {
    classes.push("selected");
  }
  return classes.join(" ");
}

/**
 * Where each row sits, so a dropped letter lands directly under itself and the
 * arrows point at the real thing. Rows step left and right as a result, which
 * is the shape of the run rather than a tidy funnel.
 */
function boardLayout() {
  const offsets = [0];
  game.rows.forEach((row, i) => {
    if (!row.kept) return;
    const next = game.rows[i + 1];
    // A committed row puts the block after the added letter only when that
    // letter went in front. A draft row always shows its front slot.
    const blockStart = next ? (next.added?.side === "front" ? 1 : 0) : 1;
    offsets[i + 1] = offsets[i] + row.kept[0] - blockStart;
  });

  const leftmost = Math.min(...offsets);
  const placed = offsets.map((offset) => offset - leftmost);

  const widths = game.rows.map((row) => row.word.length);
  if (game.phase === "build") widths.push(game.block.length + 2);
  const extent = Math.max(...widths.map((width, i) => width + placed[i]));

  return { offsets: placed, extent };
}

function renderRow(row, rowIndex, offset) {
  const isCurrent = rowIndex === game.rows.length - 1;
  const div = document.createElement("div");
  div.className = "row";
  div.style.setProperty("--offset", offset);
  if (rowIndex >= landingFrom) div.classList.add("landing");

  [...row.word].forEach((letter, index) => {
    const interactive = isCurrent && game.phase === "select" && game.canSelect(index);
    const tile = document.createElement(interactive ? "button" : "div");
    tile.className = tileClasses(row, index, isCurrent);
    tile.textContent = letter;
    if (index === addedIndex(row)) tile.dataset.value = letterValue(letter);
    if (interactive) {
      tile.type = "button";
      tile.addEventListener("click", () => {
        disarmGiveUp();
        game.toggleSelect(index);
        if (game.phase === "build") landingFrom = game.rows.length;
        setNote("");
        render();
      });
    }
    div.append(tile);
  });
  div.append(rowLookup(row.word));
  if (definitionFor === row.word && definitionIn === "board") {
    div.append(renderDefinition());
  }
  return div;
}

function renderSlot(side) {
  const active = game.side === side;
  const slot = document.createElement("button");
  slot.type = "button";
  slot.className = `tile slot${active ? " active" : ""}${active && game.letter ? " filled" : ""}`;
  slot.setAttribute("aria-label", side === "front" ? "add letter in front" : "add letter behind");
  if (active && game.letter) {
    slot.textContent = game.letter;
    slot.dataset.value = letterValue(game.letter);
  }
  slot.addEventListener("click", () => {
    game.setSide(side);
    setNote("");
    render();
  });
  return slot;
}

function renderDraft(offset) {
  const div = document.createElement("div");
  div.className = landingFrom === game.rows.length ? "row draft landing" : "row draft";
  div.style.setProperty("--offset", offset);
  div.append(renderSlot("front"));
  for (const letter of game.block) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.textContent = letter;
    div.append(tile);
  }
  div.append(renderSlot("end"), renderConfirm());
  return div;
}

/** Lights up only once a letter is in place. */
function renderConfirm() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "confirm";
  button.disabled = !game.letter;
  button.setAttribute(
    "aria-label",
    game.letter ? `Make ${game.draftWord.toUpperCase()}` : "Make the word"
  );
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.7 4.7L19 7"/></svg>';
  button.addEventListener("click", onEnter);
  return button;
}

function renderResult() {
  const { words, letters, total } = game.score;
  const box = document.createElement("div");
  box.className = game.isPerfect ? "result perfect" : "result";
  const heading = game.isPerfect ? "Perfect." : {
    won: "All the way down.",
    gaveup: "Gave up.",
    struckout: "Three strikes.",
    done: "End of the line.",
  }[game.phase] ?? "Stuck.";
  const { penalty, bonus } = game.score;
  const newLetters = game.newLetters.map((c) => c.toUpperCase()).join(" ") || "none";
  const undoRow = penalty
    ? `<dt>${game.undos} undo${game.undos === 1 ? "" : "s"}</dt><dd>\u2212${penalty}</dd>`
    : "";
  box.innerHTML = `
    <h2>${heading}</h2>
    <dl>
      <dt>${game.wordsMade} word${game.wordsMade === 1 ? "" : "s"} made</dt><dd>${words}</dd>
      <dt>New letters: ${newLetters}</dt><dd>${letters}</dd>
      ${bonus ? `<dt>Got all the way down</dt><dd>${bonus}</dd>` : ""}
      ${undoRow}
      <dt class="total">Total</dt><dd class="total">${total} of ${game.bestPossible}</dd>
    </dl>
    ${game.isPerfect ? '<p class="perfect-note">You got the maximum score!</p>' : ""}`;
  const again = document.createElement("button");
  again.textContent = "New game";
  again.addEventListener("click", startNewGame);

  const actions = document.createElement("div");
  actions.className = "result-actions";

  again.className = "primary";
  if (game.hintsUsed) {
    const note = document.createElement("p");
    note.className = "practice";
    note.textContent = "Hints were on, so this one is practice and cannot be shared.";
    box.append(note);
    actions.append(again);
  } else {
    const share = document.createElement("button");
    share.className = "quiet";
    share.textContent = "Share";
    share.addEventListener("click", () => shareResult(share, box));
    actions.append(again, share);
  }

  box.append(actions);

  // Only offered once the game is over, where it can teach without helping.
  if (game.answerShown) {
    box.append(renderBestRun());
  } else {
    const reveal = document.createElement("button");
    reveal.className = "ghost reveal";
    reveal.textContent = "Show a perfect run";
    reveal.addEventListener("click", () => {
      game.answerShown = true;
      prefetchDefinitions();
      render();
    });

    const warning = document.createElement("p");
    warning.className = "best-run-note";
    warning.textContent = "Looking closes this game. Undo stops working.";
    box.append(reveal, warning);
  }
  return box;
}

/** Wiktionary returns markup, which is read for its text and never inserted. */
function plainText(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body.textContent.replace(/\s+/g, " ").trim();
}

function shorten(text, limit = 170) {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit);
  return text.slice(0, cut > 40 ? cut : limit) + "\u2026";
}

// Nearly half the two-letter words double as ISO codes, and Wiktionary often
// leads with that, so AR reads as "the code for Arabic" rather than a word.
const CODE_SENSE = /\bISO\b|\b(?:language|country|currency)\s+code\b/i;
const CODE_SECTION = /^(?:symbol|letter|number|numeral)$/;

/** The first English sense that reads as a word rather than an abbreviation. */
function firstSense(data) {
  const sections = data?.en ?? [];
  return pickSense(sections, true) ?? pickSense(sections, false);
}

function pickSense(sections, skipCodes) {
  for (const section of sections) {
    const part = (section.partOfSpeech ?? "").toLowerCase();
    if (skipCodes && CODE_SECTION.test(part)) continue;
    for (const item of section.definitions ?? []) {
      const text = plainText(item.definition ?? "");
      if (!text) continue;
      if (skipCodes && CODE_SENSE.test(text)) continue;
      return { part, text: shorten(text) };
    }
  }
  return null;
}

/** Pull the first sense of a word, or null if we cannot reach a dictionary. */
async function lookUp(word) {
  if (definitions.has(word)) return definitions.get(word);

  let entry = null;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), LOOKUP_TIMEOUT);
  try {
    const response = await fetch(DEFINITION_API + encodeURIComponent(word), {
      signal: stop.signal,
    });
    if (response.ok) entry = firstSense(await response.json());
  } catch { /* offline, blocked, or too slow to be worth waiting for */ }
  clearTimeout(timer);

  definitions.set(word, entry);
  return entry;
}

/**
 * Fetch every word in the revealed run at once, so tapping one is instant
 * rather than starting a request the player has to wait on.
 */
function prefetchDefinitions() {
  for (const word of [game.seed, ...game.exampleRun.map((e) => e.word)]) {
    lookUp(word).then(() => {
      if (definitionFor === word) render();
    });
  }
}

function wiktionaryLink(word, label) {
  const link = document.createElement("a");
  link.className = "definition-source";
  link.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}#English`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = label;
  return link;
}

/** An open book, so a word that can be looked up says so. */
function bookIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("class", "book");
  svg.setAttribute("aria-hidden", "true");
  for (const d of [
    "M9 5.2S7.6 4 5.2 4H2.5v9.2h2.7c2.4 0 3.8 1.2 3.8 1.2",
    "M9 5.2S10.4 4 12.8 4h2.7v9.2h-2.7c-2.4 0-3.8 1.2-3.8 1.2",
    "M9 5.2v9.2",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The book that takes the check's place once a word is on the board. */
function rowLookup(word) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-lookup";
  if (definitionFor === word && definitionIn === "board") button.classList.add("open");
  button.setAttribute("aria-label", `What does ${word.toUpperCase()} mean?`);
  button.title = `What does ${word.toUpperCase()} mean?`;
  button.append(bookIcon());
  button.addEventListener("click", () => showDefinition(word, "board"));
  return button;
}

/** A word you can tap to find out what it means. */
function lookupButton(word, where) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bd-word lookup";
  if (definitionFor === word && definitionIn === where) button.classList.add("open");
  button.title = `What does ${word.toUpperCase()} mean?`;
  button.append(word, bookIcon());
  button.addEventListener("click", () => showDefinition(word, where));
  return button;
}

function showDefinition(word, where) {
  // Tapping the open one again puts it away, since it sits over the rows below.
  if (definitionFor === word && definitionIn === where) {
    definitionFor = null;
    definitionIn = null;
    render();
    return;
  }
  definitionFor = word;
  definitionIn = where;
  render();
  if (definitions.has(word)) return;
  lookUp(word).then(() => {
    if (definitionFor === word) render();
  });
}

/** Definition text comes from elsewhere, so it goes in as text, never markup. */
function renderDefinition() {
  const box = document.createElement("p");
  box.className = "definition";

  const name = document.createElement("b");
  name.textContent = definitionFor.toUpperCase();
  box.append(name, " ");

  if (!definitions.has(definitionFor)) {
    box.append("looking up\u2026");
    return box;
  }

  const entry = definitions.get(definitionFor);
  if (entry) {
    if (entry.part) {
      const part = document.createElement("i");
      part.textContent = entry.part;
      box.append(part, " \u00b7 ");
    }
    box.append(entry.text);
    box.append(wiktionaryLink(definitionFor, "Full entry on Wiktionary \u2197"));
    return box;
  }

  box.append("could not be fetched here.");
  box.append(wiktionaryLink(definitionFor, "Look it up on Wiktionary \u2197"));
  return box;
}

/** One of the highest-scoring runs this deal allowed, revealed after the fact. */
function renderBestRun() {
  const wrap = document.createElement("div");
  wrap.className = "best-run";

  const title = document.createElement("h3");
  title.textContent = `A perfect run, worth ${game.bestPossible}`;
  wrap.append(title);

  const rows = [
    [game.seed, "dealt", true],
    ...game.exampleRun.map((entry) => [entry.word, `+${entry.points}`, true]),
    ["finished", `+${FINISH_BONUS}`, false],
  ];

  const list = document.createElement("ol");
  list.className = "breakdown";
  list.append(...rows.map(([label, value, isWord]) => {
    const item = document.createElement("li");

    const name = isWord
      ? lookupButton(label, "run")
      : Object.assign(document.createElement("span"), {
          className: "bd-word",
          textContent: label,
        });

    const count = document.createElement("span");
    count.className = "bd-count";
    count.textContent = value;

    item.append(name, count);
    return item;
  }));
  wrap.append(list);

  if (definitionFor && definitionIn === "run") wrap.append(renderDefinition());

  const runs = game.bestRun.count;
  const note = document.createElement("p");
  note.className = "best-run-note";
  note.textContent = runs === 1
    ? `The only run that reaches ${game.bestPossible}. Tap a word for its meaning.`
    : `${runs} different runs reach ${game.bestPossible}. Tap a word for its meaning.`;
  wrap.append(note);
  return wrap;
}

/**
 * A summary that shows the shape of the run without naming the words. Amber
 * for a letter carried down, green for a letter you brought in and scored on,
 * white for one you added but had used before.
 */
function shareText() {
  const rows = game.rows.slice(1).map((row, index) => {
    const entry = game.breakdown[index];
    const added = row.added
      ? (row.added.side === "front" ? 0 : row.word.length - 1)
      : -1;
    const squares = [...row.word]
      .map((_, i) => (i === added ? (entry.newLetter ? "\u{1F7E9}" : "\u2B1C") : "\u{1F7E7}"))
      .join("");
    return `${squares} ${entry.points}`;
  });
  if (game.score.bonus) rows.push(`finished ${game.score.bonus}`);
  if (game.undos) rows.push(`${game.undos} undo${game.undos === 1 ? "" : "s"}`);

  const link = `${location.origin}${location.pathname}?word=${game.seed}`;
  return [
    `Letter Drop \u00b7 ${game.seed.toUpperCase()}`,
    `${game.score.total} of ${game.bestPossible}${game.isPerfect ? " \u00b7 perfect" : ""}`,
    "",
    ...rows,
    "",
    link,
  ].join("\n");
}

async function shareResult(button, box) {
  const text = shareText();

  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Share"; }, 1600);
    return;
  } catch { /* clipboard is not available here */ }

  if (box.querySelector(".share-fallback")) return;
  const field = document.createElement("textarea");
  field.className = "share-fallback";
  field.readOnly = true;
  field.rows = text.split("\n").length;
  field.value = text;
  box.append(field);
  field.select();
}

function defaultNote() {
  const word = game.currentWord.toUpperCase();
  switch (game.phase) {
    case "select": {
      const need = game.keepCount;
      const chosen = game.selection.length;
      return `Drop <b>${need}</b> letter${need === 1 ? "" : "s"} in a row into ` +
        `the next word. <b>${chosen}/${need}</b> chosen.`;
    }
    case "build": {
      const where = game.side === "front" ? "in front of" : "behind";
      return `Add an <b>unused</b> letter ${where} ${game.block.toUpperCase()} ` +
        `to make a ${game.block.length + 1}-letter word.`;
    }
    case "stuck":
      return `No word can be made from <b>${word}</b>. Undo and drop a ` +
        `different run of letters.`;
    default:
      return "";
  }
}

/** Rows sit at different offsets, so a panel hung off one can overshoot. */
function keepDefinitionOnScreen() {
  const panel = els.board.querySelector(".row .definition");
  if (!panel) return;
  panel.style.marginLeft = "0px";
  const overshoot = panel.getBoundingClientRect().right - (window.innerWidth - 12);
  if (overshoot > 0) panel.style.marginLeft = `${-Math.ceil(overshoot)}px`;
}

function tallyText() {
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const runs = game.bestRun.count;
  const parts = [runs === 1 ? "1 way to get there" : `${runs} ways to get there`];

  if (game.wordsMade) {
    parts.push(plural(game.wordsMade, "word"));
    const fresh = game.newLetters.length;
    if (fresh) parts.push(plural(fresh, "new letter"));
  }
  if (game.hintsUsed) parts.push("practice");
  return parts.join(" \u00b7 ");
}

function renderBreakdown() {
  const lines = game.breakdown.map((entry) => [entry.word, `+${entry.points}`, false]);
  if (game.score.bonus) lines.push(["finished", `+${game.score.bonus}`, false]);
  if (game.undos) {
    const label = game.undos === 1 ? "1 undo" : `${game.undos} undos`;
    lines.push([label, `\u2212${game.score.penalty}`, true]);
  }

  els.breakdown.replaceChildren(...lines.map(([label, value, penalty]) => {
    const item = document.createElement("li");

    const name = document.createElement("span");
    name.className = "bd-word";
    name.textContent = label;

    const count = document.createElement("span");
    count.className = penalty ? "bd-count penalty" : "bd-count";
    count.textContent = value;

    item.append(name, count);
    return item;
  }));
}

function render() {
  const layout = boardLayout();
  els.board.style.setProperty("--extent", layout.extent);
  els.board.replaceChildren(
    ...game.rows.map((row, i) => renderRow(row, i, layout.offsets[i])),
    ...(game.phase === "build" ? [renderDraft(layout.offsets[game.rows.length])] : [])
  );
  // Outside the board, so the width of the result panel cannot decide how big
  // the tiles are.
  els.result.replaceChildren(...(game.isOver ? [renderResult()] : []));
  landingFrom = Infinity;
  els.message.innerHTML = note || defaultNote();
  els.message.classList.toggle("error", noteIsError);
  els.score.textContent = game.score.total;
  els.tallyLabel.textContent = `points of ${game.bestPossible}`;
  els.tallyDetail.textContent = tallyText();
  renderBreakdown();
  const undoCosts = game.canUndo &&
    game.rows.length > 1 && !game.selection.length && game.phase !== "build";
  els.undo.disabled = !game.canUndo;
  els.undo.textContent = undoCosts ? `Undo \u2212${UNDO_COST}` : "Undo";
  els.strikes.replaceChildren(...Array.from({ length: STRIKE_LIMIT }, (_, i) => {
    const mark = document.createElement("i");
    mark.className = i < game.strikes ? "strike used" : "strike";
    return mark;
  }));
  els.strikes.title = `${game.strikes} of ${STRIKE_LIMIT} wrong guesses used`;
  els.giveUp.hidden = game.isOver;
  els.giveUp.textContent = giveUpArmed ? "Sure? Show the answer" : "Give up";
  els.giveUp.classList.toggle("armed", giveUpArmed);
  els.undo.title = game.canUndo ? "" : "This game is closed.";
  keepDefinitionOnScreen();
  els.hints.textContent = hintsOn ? "Hints on" : hintsArmed ? "Turn on?" : "Hints";
  els.hints.classList.toggle("on", hintsOn);
  els.hints.classList.toggle("armed", hintsArmed);
  els.hints.setAttribute("aria-pressed", String(hintsOn));
  renderLevels();
  renderKeyboard();
}

function renderKeyboard() {
  // One state only: the letter has appeared, in the opening word or in a word
  // the player made.
  const used = game.usedLetters;
  const live = hintsOn && game.phase === "build"
    ? playableLetters(game.block, game.side, game.dictionary, used)
    : null;

  const rows = KEY_ROWS.map((letters, index) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    if (index === 2) row.append(actionKey("Enter", onEnter));
    for (const letter of letters) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.textContent = letter;
      key.dataset.value = letterValue(letter);
      if (live?.has(letter)) key.classList.add("playable");
      if (used.has(letter)) {
        key.classList.add("used");
        key.disabled = true;  // a letter already on the board cannot be added again
      }
      key.addEventListener("click", () => typeLetter(letter));
      row.append(key);
    }
    if (index === 2) row.append(actionKey("Back", onBackspace));
    return row;
  });
  els.keyboard.replaceChildren(...rows);
}

function actionKey(label, handler) {
  const key = document.createElement("button");
  key.type = "button";
  key.className = "key wide";
  key.textContent = label;
  key.addEventListener("click", handler);
  return key;
}

/* ---------- actions ---------- */

function setNote(text, isError = false) {
  note = text;
  noteIsError = isError;
}

function shakeDraft() {
  const row = els.board.querySelector(".draft");
  if (!row) return;
  row.classList.add("shake");
  row.addEventListener("animationend", () => row.classList.remove("shake"), { once: true });
}

function typeLetter(letter) {
  disarmGiveUp();
  if (game.phase !== "build") {
    setNote(game.phase === "select" ? "Drop your letters first." : "", game.phase === "select");
    return render();
  }
  const result = game.setLetter(letter);
  setNote(result.ok ? "" : result.reason, !result.ok);
  render();
}

function onEnter() {
  disarmGiveUp();
  if (game.phase !== "build") return;

  const result = game.submit();
  if (!result.ok) {
    const left = STRIKE_LIMIT - (result.strikes ?? 0);
    setNote(result.strikes
      ? `${result.reason} ${left ? `${left} guess${left === 1 ? "" : "es"} left.` : "That is three."}`
      : result.reason, true);
    render();
    return shakeDraft();
  }
  landingFrom = game.rows.length - (result.fell ? 2 : 1);
  lookUp(result.word);
  if (result.fell) lookUp(result.fell);
  // No note on success. The score column already lists what the word was
  // worth, so the line goes back to saying what to do next.
  setNote("");
  render();
}

function onBackspace() {
  disarmGiveUp();
  if (game.phase === "build" && game.letter) {
    game.setLetter("");
  } else {
    game.undo();
  }
  setNote("");
  render();
}

/** Focus lands on the button at the end, so scroll back to the top after. */
function openRules() {
  els.rules.showModal();
  els.rules.scrollTop = 0;
}

function onGiveUp() {
  if (giveUpArmed) {
    game.giveUp();
    prefetchDefinitions();
    giveUpArmed = false;
  } else {
    giveUpArmed = true;
  }
  setNote("");
  render();
}

/** Any other move cancels a half-pressed Give up or Hints. */
function disarmGiveUp() {
  giveUpArmed = false;
  hintsArmed = false;
}

/**
 * Switching hints on costs you the ability to share the run, so the first tap
 * says what they do and what they cost, and the second turns them on. Turning
 * them off again is free and immediate.
 */
function toggleHints() {
  if (hintsOn) {
    hintsOn = false;
    hintsArmed = false;
    setNote("");
  } else if (!hintsArmed) {
    hintsArmed = true;
    setNote("Hints ring every letter that makes a word from here. This run " +
      "then counts as practice and cannot be shared. Tap again to switch them on.");
  } else {
    hintsOn = true;
    hintsArmed = false;
    // Marks the run as practice for good, even if you turn them off again.
    game.hintsUsed = true;
    setNote("");
  }
  render();
}

function startNewGame() {
  try {
    history.replaceState(null, "", location.pathname);
  } catch { /* sandboxed frames refuse history writes */ }
  game = new Game({ seed: randomSeed(level) });
  game.hintsUsed = hintsOn;
  giveUpArmed = false;
  hintsArmed = false;
  definitionFor = null;
  definitionIn = null;
  landingFrom = 0;
  setNote("");
  render();
}

/* ---------- wiring ---------- */

els.undo.addEventListener("click", onBackspace);
els.newGame.addEventListener("click", startNewGame);
function renderLevels() {
  els.level.value = String(LEVELS.indexOf(level));
  els.levelNames.replaceChildren(...LEVELS.map((name) => {
    const span = document.createElement("span");
    span.textContent = LEVEL_NAMES[name];
    if (name === level) span.className = "on";
    return span;
  }));
}

els.level.addEventListener("input", () => {
  const chosen = LEVELS[Number(els.level.value)];
  if (!chosen || chosen === level) return;
  level = chosen;
  store.set("letterdrop.level", level);
  startNewGame();
});
els.giveUp.addEventListener("click", onGiveUp);
els.hints.addEventListener("click", toggleHints);
els.howTo.addEventListener("click", openRules);

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || els.rules.open) return;
  const key = event.key;
  if (/^[a-zA-Z]$/.test(key)) {
    typeLetter(key.toLowerCase());
  } else if (key === "Enter") {
    onEnter();
  } else if (key === "Backspace") {
    event.preventDefault();
    onBackspace();
  } else if (key === "ArrowLeft" || key === "ArrowRight") {
    if (game.phase !== "build") return;
    game.setSide(key === "ArrowLeft" ? "front" : "end");
    setNote("");
    render();
  } else {
    return;
  }
});

if (!store.get("letterdrop.seen")) {
  store.set("letterdrop.seen", "1");
  openRules();
}
render();
