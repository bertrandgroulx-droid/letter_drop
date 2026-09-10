import { Game, playableLetters } from "./game.js";
import { DICTIONARY } from "./words.js";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const els = {
  board: document.getElementById("board"),
  message: document.getElementById("message"),
  score: document.getElementById("score"),
  keyboard: document.getElementById("keyboard"),
  undo: document.getElementById("undo"),
  hints: document.getElementById("hints"),
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
let landingRow = 0;
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
  if (isCurrent && game.phase === "final" && "ai".includes(row.word[index])) {
    classes.push("droppable");
  }
  return classes.join(" ");
}

function renderRow(row, rowIndex) {
  const isCurrent = rowIndex === game.rows.length - 1;
  const div = document.createElement("div");
  div.className = isCurrent && !game.isOver && game.phase !== "build" ? "row" : "row past";
  if (rowIndex === landingRow) div.classList.add("landing");

  [...row.word].forEach((letter, index) => {
    const interactive = isCurrent &&
      ((game.phase === "select" && game.canSelect(index)) ||
        (game.phase === "final" && "ai".includes(letter)));
    const tile = document.createElement(interactive ? "button" : "div");
    tile.className = tileClasses(row, index, isCurrent);
    tile.textContent = letter;
    if (interactive) {
      tile.type = "button";
      tile.addEventListener("click", () => {
        if (game.phase === "select") {
          game.toggleSelect(index);
          if (game.phase === "build") landingRow = game.rows.length;
          setNote("");
        } else {
          const result = game.dropFinal(index);
          if (!result.ok) return setNote(result.reason, true), render();
          landingRow = game.rows.length - 1;
          setNote("");
        }
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
  if (els.hints.checked && playableLetters(game.block, side).size === 0) {
    slot.classList.add("dead");
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
  div.className = landingRow === game.rows.length ? "row draft landing" : "row draft";
  div.append(renderSlot("front"));
  for (const letter of game.block) {
    const tile = document.createElement("div");
    tile.className = "tile kept";
    tile.textContent = letter;
    div.append(tile);
  }
  div.append(renderSlot("end"));
  return div;
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
  const again = document.createElement("button");
  again.className = "primary";
  again.textContent = "New game";
  again.addEventListener("click", startNewGame);
  box.append(again);
  return box;
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
    case "final":
      return `<b>${word}</b> holds a one-letter word. Tap it to let it fall.`;
    case "stuck":
      return `No word can be made from <b>${word}</b>. Undo and try another split.`;
    default:
      return "";
  }
}

function render() {
  els.board.replaceChildren(
    ...game.rows.map(renderRow),
    ...(game.phase === "build" ? [renderDraft()] : []),
    ...(game.isOver ? [renderResult()] : [])
  );
  landingRow = -1;
  els.message.innerHTML = note || defaultNote();
  els.message.classList.toggle("error", noteIsError);
  els.score.textContent = game.score.total;
  els.undo.disabled = game.rows.length < 2 && !game.selection.length && game.phase !== "build";
  renderKeyboard();
}

function renderKeyboard() {
  const seed = new Set(game.seed);
  const used = new Set(game.rows.slice(1).flatMap((row) => [...row.word]));
  const scored = new Set(game.newLetters);
  const live = els.hints.checked && game.phase === "build"
    ? playableLetters(game.block, game.side)
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
      if (seed.has(letter)) key.classList.add("seed");
      if (used.has(letter)) key.classList.add("used");
      if (scored.has(letter)) key.classList.add("scored");
      if (live && !live.has(letter)) key.classList.add("dead");
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
  if (game.phase === "final") {
    const index = [...game.currentWord].findIndex((c) => "ai".includes(c));
    if (index >= 0) {
      game.dropFinal(index);
      landingRow = game.rows.length - 1;
      setNote("");
      return render();
    }
  }
  if (game.phase !== "build") return;

  const before = game.score.total;
  const result = game.submit();
  if (!result.ok) {
    setNote(result.reason, true);
    render();
    return shakeDraft();
  }
  landingRow = game.rows.length - 1;
  const gained = game.score.total - before;
  setNote(`<b>${result.word.toUpperCase()}</b> &middot; +${gained}`);
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
  history.replaceState(null, "", location.pathname);
  game = new Game();
  landingRow = 0;
  setNote("");
  render();
}

/* ---------- wiring ---------- */

els.undo.addEventListener("click", onBackspace);
els.newGame.addEventListener("click", startNewGame);
els.hints.addEventListener("change", () => {
  store.set("letterdrop.hints", els.hints.checked ? "1" : "0");
  render();
});
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

els.hints.checked = store.get("letterdrop.hints") === "1";
if (!store.get("letterdrop.seen")) {
  store.set("letterdrop.seen", "1");
  els.rules.showModal();
}
render();
