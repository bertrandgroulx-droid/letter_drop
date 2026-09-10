import { Game, PERFECT_SCORE } from "./game.js";
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
    if (interactive) {
      tile.type = "button";
      tile.addEventListener("click", () => {
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
  if (active && game.letter) slot.textContent = game.letter;
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
  const heading = game.phase === "won"
    ? "Cleared it."
    : game.phase === "done" ? "End of the line." : "Stuck.";
  const newLetters = game.newLetters.map((c) => c.toUpperCase()).join(" ") || "none";
  box.innerHTML = `
    <h2>${heading}</h2>
    <dl>
      <dt>${game.wordsMade} word${game.wordsMade === 1 ? "" : "s"} made</dt><dd>${words}</dd>
      <dt>New letters: ${newLetters}</dt><dd>${letters}</dd>
      <dt class="total">Total</dt><dd class="total">${total}</dd>
    </dl>`;
  const share = document.createElement("button");
  share.className = "primary";
  share.textContent = "Share";
  share.addEventListener("click", () => shareResult(share, box));

  const again = document.createElement("button");
  again.className = "ghost";
  again.textContent = "New game";
  again.addEventListener("click", startNewGame);

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.append(share, again);
  box.append(actions);
  return box;
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

  const link = `${location.origin}${location.pathname}?word=${game.seed}`;
  return [
    `Letter Drop \u00b7 ${game.seed.toUpperCase()}`,
    `${game.score.total} of ${PERFECT_SCORE}`,
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
      return `Select <b>${need}</b> letter${need === 1 ? "" : "s"} in a row to drop. ` +
        `<b>${chosen}/${need}</b> chosen.`;
    }
    case "build": {
      const where = game.side === "front" ? "in front of" : "behind";
      return `Add a letter <b>${where}</b> ${game.block.toUpperCase()} ` +
        `to make a ${game.block.length + 1}-letter word. Arrow keys switch ends.`;
    }
    case "stuck":
      return `No word can be made from <b>${word}</b>. Undo and try another split.`;
    default:
      return "";
  }
}

function tallyText() {
  const words = game.wordsMade;
  if (!words) return "no words yet";
  const fresh = game.newLetters.length;
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return plural(words, "word") + (fresh ? ` \u00b7 ${plural(fresh, "new letter")}` : "");
}

function renderBreakdown() {
  els.breakdown.replaceChildren(...game.breakdown.map((entry) => {
    const item = document.createElement("li");

    const word = document.createElement("span");
    word.className = "bd-word";
    word.textContent = entry.word;

    const pips = document.createElement("span");
    pips.className = "bd-pips";
    for (let i = 0; i < entry.max; i += 1) {
      const pip = document.createElement("i");
      pip.className = i < entry.points ? "pip filled" : "pip";
      pips.append(pip);
    }

    const count = document.createElement("span");
    count.className = "bd-count";
    count.textContent = `${entry.points} of ${entry.max}`;

    item.append(word, pips, count);
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
  els.tallyDetail.textContent = tallyText();
  renderBreakdown();
  els.undo.disabled = game.rows.length < 2 && !game.selection.length && game.phase !== "build";
  renderKeyboard();
}

function renderKeyboard() {
  // One state only: the letter has appeared, in the opening word or in a word
  // the player made.
  const used = new Set([
    ...game.seed,
    ...game.rows.slice(1).flatMap((row) => [...row.word]),
  ]);

  const rows = KEY_ROWS.map((letters, index) => {
    const row = document.createElement("div");
    row.className = "kb-row";
    if (index === 2) row.append(actionKey("Enter", onEnter));
    for (const letter of letters) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.textContent = letter;
      if (used.has(letter)) key.classList.add("used");
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
  if (game.phase !== "build") {
    setNote(game.phase === "select" ? "Choose your letters first." : "", game.phase === "select");
    return render();
  }
  game.setLetter(letter);
  setNote("");
  render();
}

function onEnter() {
  if (game.phase !== "build") return;

  const before = game.score.total;
  const result = game.submit();
  if (!result.ok) {
    setNote(result.reason, true);
    render();
    return shakeDraft();
  }
  landingFrom = game.rows.length - (result.fell ? 2 : 1);
  const gained = game.score.total - before;
  const made = `<b>${result.word.toUpperCase()}</b>`;
  setNote(result.fell
    ? `${made}, then the ${result.fell.toUpperCase()} fell on its own &middot; +${gained}`
    : `${made} &middot; +${gained}`);
  render();
}

function onBackspace() {
  if (game.phase === "build" && game.letter) {
    game.setLetter("");
  } else {
    game.undo();
  }
  setNote("");
  render();
}

function startNewGame() {
  try {
    history.replaceState(null, "", location.pathname);
  } catch { /* sandboxed frames refuse history writes */ }
  game = new Game();
  landingFrom = 0;
  setNote("");
  render();
}

/* ---------- wiring ---------- */

els.undo.addEventListener("click", onBackspace);
els.newGame.addEventListener("click", startNewGame);
els.howTo.addEventListener("click", () => els.rules.showModal());

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
  els.rules.showModal();
}
render();
