import { FINISH_BONUS, Game, UNDO_COST, letterValue, playableLetters } from "./game.js";
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
  hints: document.getElementById("hints"),
  tallyLabel: document.getElementById("tally-label"),
  giveUp: document.getElementById("give-up"),
  newGame: document.getElementById("new-game"),
  howTo: document.getElementById("how-to"),
  rules: document.getElementById("rules"),
};

/** ?word=plant opens a specific puzzle, so a game can be shared or replayed. */
function requestedSeed() {
  const word = new URLSearchParams(location.search).get("word")?.toLowerCase();
  return word && DICTIONARY[5]?.has(word) ? word : undefined;
}

let game = new Game({ seed: requestedSeed() });
let landingFrom = 0;
let hintsOn = false;
let definitionFor = null;
let giveUpArmed = false;

// Free, no key, no sign-up. Blocked outright in some embeddings, which is what
// the Wiktionary fallback is for.
const DEFINITION_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const definitions = new Map();
let note = "";
let noteIsError = false;

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

/* ---------- rendering ---------- */

function addedIndex(row) {
  if (!row.added) return -1;
  return row.added.side === "front" ? 0 : row.word.length - 1;
}

function tileClasses(row, index, isCurrent) {
  const classes = ["tile"];
  if (row.kept && index >= row.kept[0] && index < row.kept[1]) classes.push("kept");
  if (index === addedIndex(row)) classes.push("added");
  if (isCurrent && game.phase === "select" && game.selection.includes(index)) {
    classes.push("selected");
  }
  return classes.join(" ");
}

function renderRow(row, rowIndex) {
  const isCurrent = rowIndex === game.rows.length - 1;
  const div = document.createElement("div");
  div.className = isCurrent && !game.isOver && game.phase !== "build" ? "row" : "row past";
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

function renderDraft() {
  const div = document.createElement("div");
  div.className = landingFrom === game.rows.length ? "row draft landing" : "row draft";
  div.append(renderSlot("front"));
  for (const letter of game.block) {
    const tile = document.createElement("div");
    tile.className = "tile kept";
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
  box.className = "result";
  const heading = {
    won: "Cleared it.",
    gaveup: "Gave up.",
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
      <dt class="total">Total</dt><dd class="total">${total}</dd>
    </dl>`;
  const again = document.createElement("button");
  again.textContent = "New game";
  again.addEventListener("click", startNewGame);

  const actions = document.createElement("div");
  actions.className = "result-actions";

  if (game.hintsUsed) {
    again.className = "primary";
    const note = document.createElement("p");
    note.className = "practice";
    note.textContent = "Hints were on, so this one is practice and cannot be shared.";
    box.append(note);
    actions.append(again);
  } else {
    const share = document.createElement("button");
    share.className = "primary";
    share.textContent = "Share";
    share.addEventListener("click", () => shareResult(share, box));
    again.className = "ghost";
    actions.append(share, again);
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
      render();
    });

    const warning = document.createElement("p");
    warning.className = "best-run-note";
    warning.textContent = "Looking closes this game. Undo stops working.";
    box.append(reveal, warning);
  }
  return box;
}

/** Pull the first sense of a word, or null if we cannot reach a dictionary. */
async function lookUp(word) {
  let entry = null;
  try {
    const response = await fetch(DEFINITION_API + encodeURIComponent(word));
    if (response.ok) {
      const meaning = (await response.json())?.[0]?.meanings?.[0];
      const text = meaning?.definitions?.[0]?.definition;
      if (text) entry = { part: meaning.partOfSpeech ?? "", text };
    }
  } catch { /* offline, or the page is not allowed to reach it */ }
  definitions.set(word, entry);
  return entry;
}

function showDefinition(word) {
  definitionFor = word;
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
    box.append("\u2026");
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
    return box;
  }

  const link = document.createElement("a");
  link.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(definitionFor)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "look it up on Wiktionary";
  box.append("could not be fetched here, so ", link, ".");
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
    ...game.bestRun.line.map((entry) => [entry.word, `+${entry.points}`, true]),
    ["finished", `+${FINISH_BONUS}`, false],
  ];

  const list = document.createElement("ol");
  list.className = "breakdown";
  list.append(...rows.map(([label, value, isWord]) => {
    const item = document.createElement("li");

    const name = document.createElement(isWord ? "button" : "span");
    name.className = "bd-word";
    name.textContent = label;
    if (isWord) {
      name.type = "button";
      name.classList.add("lookup");
      name.title = `What does ${label.toUpperCase()} mean?`;
      name.addEventListener("click", () => showDefinition(label));
    }

    const count = document.createElement("span");
    count.className = "bd-count";
    count.textContent = value;

    item.append(name, count);
    return item;
  }));
  wrap.append(list);

  if (definitionFor) wrap.append(renderDefinition());

  const note = document.createElement("p");
  note.className = "best-run-note";
  note.textContent = "Tap a word for its meaning. Runs often tie for best, and this is one of them.";
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
    `${game.score.total} of ${game.bestPossible}`,
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

function tallyText() {
  const words = game.wordsMade;
  if (!words) return game.hintsUsed ? "practice run" : "no words yet";
  const fresh = game.newLetters.length;
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const line = plural(words, "word") + (fresh ? ` \u00b7 ${plural(fresh, "new letter")}` : "");
  return game.hintsUsed ? `${line} \u00b7 practice` : line;
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
  els.board.replaceChildren(
    ...game.rows.map(renderRow),
    ...(game.phase === "build" ? [renderDraft()] : []),
    ...(game.isOver ? [renderResult()] : [])
  );
  landingFrom = Infinity;
  els.message.innerHTML = note || defaultNote();
  els.message.classList.toggle("error", noteIsError);
  els.score.textContent = game.score.total;
  els.tallyLabel.textContent = `points of ${game.bestPossible}`;
  els.tallyDetail.textContent = tallyText();
  renderBreakdown();
  const somethingToUndo =
    game.rows.length > 1 || game.selection.length > 0 || game.phase === "build";
  const canUndo = somethingToUndo && !game.answerShown;
  const undoCosts =
    canUndo && game.rows.length > 1 && !game.selection.length && game.phase !== "build";
  els.undo.disabled = !canUndo;
  els.undo.textContent = undoCosts ? `Undo \u2212${UNDO_COST}` : "Undo";
  els.giveUp.hidden = game.isOver;
  els.giveUp.textContent = giveUpArmed ? "Sure? Show the answer" : "Give up";
  els.giveUp.classList.toggle("on", giveUpArmed);
  els.undo.title = game.answerShown
    ? "You have seen a perfect run, so this game is closed."
    : "";
  els.hints.textContent = hintsOn ? "Hints on" : "Hints";
  els.hints.classList.toggle("on", hintsOn);
  els.hints.setAttribute("aria-pressed", String(hintsOn));
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
    setNote(result.reason, true);
    render();
    return shakeDraft();
  }
  landingFrom = game.rows.length - (result.fell ? 2 : 1);
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
    giveUpArmed = false;
  } else {
    giveUpArmed = true;
  }
  setNote("");
  render();
}

/** Any other move cancels a half-pressed Give up. */
function disarmGiveUp() {
  giveUpArmed = false;
}

function toggleHints() {
  hintsOn = !hintsOn;
  // Turning hints on marks this run as practice for good, even if you turn
  // them off again.
  if (hintsOn) game.hintsUsed = true;
  render();
}

function startNewGame() {
  try {
    history.replaceState(null, "", location.pathname);
  } catch { /* sandboxed frames refuse history writes */ }
  game = new Game();
  game.hintsUsed = hintsOn;
  giveUpArmed = false;
  definitionFor = null;
  landingFrom = 0;
  setNote("");
  render();
}

/* ---------- wiring ---------- */

els.undo.addEventListener("click", onBackspace);
els.newGame.addEventListener("click", startNewGame);
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
