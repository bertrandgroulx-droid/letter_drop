import { DEFAULT_LEVEL, FINISH_BONUS, Game, LEVELS, LEVEL_NAMES, STRIKE_LIMIT, UNDO_COST, dailyWord, letterValue, playableLetters, randomSeed } from "./game.js";
import { DICTIONARY } from "./words.js";

// The shozbot daily kit (src/shozbot-daily.js, loaded as a plain script before
// this one): which day it is, the day's seed, the saved score per day, the
// streak, and the standard wording every daily game shares.
const daily = window.ShozDaily.create({ game: "letter-drop", title: "Letter Drop" });

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const els = {
  dailyText: document.getElementById("daily-text"),
  dailyLinks: document.getElementById("daily-links"),
  past: document.getElementById("past"),
  pastList: document.getElementById("past-list"),
  levels: document.getElementById("levels"),
  gameUi: document.querySelectorAll("[data-game-ui]"),
  board: document.getElementById("board"),
  message: document.getElementById("message"),
  score: document.getElementById("score"),
  keyboard: document.getElementById("keyboard"),
  undo: document.getElementById("undo"),
  tallyDetail: document.getElementById("tally-detail"),
  breakdown: document.getElementById("breakdown"),
  demo: document.getElementById("demo"),
  demoCoach: document.getElementById("demo-coach"),
  demoNote: document.getElementById("demo-note"),
  demoStrikes: document.getElementById("demo-strikes"),
  demoBack: document.getElementById("demo-back"),
  demoNext: document.getElementById("demo-next"),
  demoCount: document.getElementById("demo-count"),
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
function requestedSeed(query) {
  const word = query.get("word")?.toLowerCase();
  return word && DICTIONARY[5]?.has(word) ? word : undefined;
}

/**
 * Settings used to live at "letterdrop.level" and "letterdrop.seen". Every
 * app now shares the shozbot.com origin, so they move under the kit's
 * "letterdrop:" prefix, where the daily records live too.
 */
function migrateSetting(oldKey, newKey) {
  let old = null;
  try { old = localStorage.getItem(oldKey); } catch { return; }
  if (old === null) return;
  if (daily.read(newKey, null) === null) daily.write(newKey, old);
  try { localStorage.removeItem(oldKey); } catch { /* nothing to tidy */ }
}
migrateSetting("letterdrop.level", "level");
migrateSetting("letterdrop.seen", "seen");

// A level that no longer exists, or none at all, lands in the middle. It is
// the level for random puzzles; the daily is always dealt at the default.
let level = LEVELS.includes(daily.read("level", null)) ? daily.read("level", null) : DEFAULT_LEVEL;

// Which puzzle is showing: today's or a past day ({ mode: "daily", iso, number,
// date, seed }) or a random one ({ mode: "practice" }). The kit decides the
// wording from it.
let meta = daily.practiceMeta();
let game = new Game({ seed: randomSeed(level) });
// What the kit said when this run's score was saved, or null until it is.
let saved = null;
// Whether the page is showing the game or the Past puzzles list; nothing yet
// until the address has been read.
let view = null;
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
function boardLayout(g = game) {
  const offsets = [0];
  g.rows.forEach((row, i) => {
    if (!row.kept) return;
    const next = g.rows[i + 1];
    // A committed row puts the block after the added letter only when that
    // letter went in front. A draft row always shows its front slot.
    const blockStart = next ? (next.added?.side === "front" ? 1 : 0) : 1;
    offsets[i + 1] = offsets[i] + row.kept[0] - blockStart;
  });

  const leftmost = Math.min(...offsets);
  const placed = offsets.map((offset) => offset - leftmost);

  const widths = g.rows.map((row) => row.word.length);
  if (g.phase === "build") widths.push(g.block.length + 2);
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

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.7 4.7L19 7"/></svg>';

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
  button.innerHTML = CHECK_SVG;
  button.addEventListener("click", onEnter);
  return button;
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

function paragraph(className, text) {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
}

/** Only offered once the game is over, where it can teach without helping. */
function renderReveal() {
  const reveal = button("Show a perfect run", "ghost reveal", () => {
    game.answerShown = true;
    prefetchDefinitions();
    render();
  });
  const warning = paragraph("best-run-note", "Looking closes this game. Undo stops working.");
  return [reveal, warning];
}

/**
 * The game's own account of the run: what each part was worth. The total
 * sits above it in large type, so it is not repeated here.
 */
function renderScoreTable() {
  const { words, letters, penalty, bonus } = game.score;
  const newLetters = game.newLetters.map((c) => c.toUpperCase()).join(" ") || "none";
  const undoRow = penalty
    ? `<dt>${game.undos} undo${game.undos === 1 ? "" : "s"}</dt><dd>\u2212${penalty}</dd>`
    : "";
  const table = document.createElement("dl");
  table.innerHTML = `
      <dt>${game.wordsMade} word${game.wordsMade === 1 ? "" : "s"} made</dt><dd>${words}</dd>
      <dt>New letters: ${newLetters}</dt><dd>${letters}</dd>
      ${bonus ? `<dt>Got all the way down</dt><dd>${bonus}</dd>` : ""}
      ${undoRow}`;
  return table;
}

/**
 * The results, in the order every shozbot daily game uses: the score large,
 * a verdict, the streak, whether it was saved, then the ways onward. The
 * game's own breakdown and perfect run sit where they always did.
 *
 * In the daily, a dead end is not the end: the run only counts once it is
 * closed, by reaching a letter, giving up, striking out, or looking at a
 * perfect run. Until then the box says what the choices are and nothing is
 * saved, so a stall at the first word is never frozen as the day's score.
 */
function renderResult() {
  const isDaily = meta.mode === "daily";
  const box = document.createElement("div");
  box.className = game.isPerfect ? "result perfect" : "result";
  const heading = game.isPerfect ? "Perfect." : {
    won: "All the way down.",
    gaveup: "Gave up.",
    struckout: "Three strikes.",
    done: "End of the line.",
  }[game.phase] ?? "Stuck.";

  const title = document.createElement("h2");
  title.textContent = heading;
  box.append(title);

  if (isDaily && !game.isClosed) {
    box.append(
      renderScoreTable(),
      paragraph("best-run-note open-end",
        "Today\u2019s run is not over yet. Undo to try another route, or show a perfect run to finish here with this score."),
      ...renderReveal()
    );
    return box;
  }

  const score = game.score.total;
  const max = game.bestPossible;
  const practice = game.hintsUsed;

  const big = document.createElement("div");
  big.className = "big-score";
  big.innerHTML = `${score} <small>/ ${max}</small>`;
  box.append(big, paragraph("verdict", daily.verdict(score, max, meta)));

  const played = isDaily && daily.record(meta.iso);
  if (played && meta.iso === daily.todayMeta().iso) {
    const streak = daily.streakLine();
    if (streak) box.append(paragraph("streak", streak));
  }

  if (practice) {
    box.append(paragraph("practice", isDaily
      ? "Hints were on, so this one is practice: not saved as the day\u2019s score, and not for sharing."
      : "Hints were on, so this one is practice and cannot be shared."));
  } else {
    const first = Boolean(saved?.first);
    box.append(paragraph(first ? "saved good" : "saved", daily.savedLine(meta, first)));
  }

  box.append(renderScoreTable());
  if (game.isPerfect) box.append(paragraph("perfect-note", "You got the maximum score!"));

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.append(button(isDaily ? "Play random puzzles" : "More random puzzles", "primary", () => startRandom()));
  if (!practice) {
    const share = button("Share", "quiet", () => shareResult(share, box));
    actions.append(share);
  }
  actions.append(button("Past puzzles", "ghost", showPast));

  const more = document.createElement("div");
  more.className = "result-actions";
  more.append(isDaily
    ? button("Play it again", "quiet", () => startDaily(meta, true))
    : button("Today\u2019s puzzle", "quiet", openToday));
  box.append(actions, more);

  box.append(...(game.answerShown ? [renderBestRun()] : renderReveal()));
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
 * The shape of the run without naming the words, one line per word. Amber
 * for a letter carried down, green for a letter you brought in and scored on,
 * white for one you added but had used before.
 */
function shareGrid() {
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
  return rows.join("\n");
}

/**
 * The kit writes the heading, the score and the address; the grid is this
 * game's own. It is several lines, so it starts on a line of its own under
 * the score rather than beside it, which is where a one-line grid would go.
 * A random puzzle links to its own word, so a friend can be dealt the same.
 */
function shareText() {
  const grid = shareGrid();
  const page = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}` : "";
  return daily.shareText({
    meta,
    score: game.score.total,
    max: game.bestPossible,
    squares: grid ? `\n${grid}` : "",
    url: meta.mode === "daily" || !page ? undefined : `${page}?word=${game.seed}`,
  }).replace(" \n", "\n");
}

async function shareResult(button, box) {
  const text = shareText();
  const outcome = await daily.share(text, button);
  if (outcome !== "failed") return;

  // Nothing here can share or copy, so the text is put where it can be selected.
  if (box.querySelector(".share-fallback")) return;
  const field = document.createElement("textarea");
  field.className = "share-fallback";
  field.readOnly = true;
  field.rows = text.split("\n").length;
  field.value = text;
  box.append(field);
  field.select();
}

function submitNote(result) {
  const left = STRIKE_LIMIT - (result.strikes ?? 0);
  if (!result.strikes) return result.reason;
  return `${result.reason} ${left ? `${left} guess${left === 1 ? "" : "es"} left.` : "That is three."}`;
}

function defaultNote(g = game, alsoChosen = 0) {
  const word = g.currentWord.toUpperCase();
  switch (g.phase) {
    case "select": {
      const need = g.keepCount;
      const chosen = g.selection.length + alsoChosen;
      // "one letter in a row" is nonsense, so the last round says it plainly.
      const run = need === 1 ? "<b>1</b> letter" : `<b>${need}</b> letters in a row`;
      return `Drop ${run} into the next word. <b>${chosen}/${need}</b> chosen.`;
    }
    case "build": {
      const where = g.side === "front" ? "in front of" : "behind";
      return `Add an <b>unused</b> letter ${where} ${g.block.toUpperCase()} ` +
        `to make a ${g.block.length + 1}-letter word.`;
    }
    case "stuck":
      // Once the answer is out there is no undoing, so the advice goes too.
      if (g.answerShown || g.restored) return "";
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

/**
 * The moment a daily run closes, its score is saved. The kit keeps the first
 * score for a day and ignores any later one, so a replay can never overwrite
 * it. A run played with hints is practice and is not offered at all, and a
 * day shown again from its record was saved already.
 */
function settle() {
  if (meta.mode !== "daily" || saved || game.restored || game.hintsUsed || !game.isClosed) return;
  saved = daily.save(meta, {
    score: game.score.total,
    max: game.bestPossible,
    results: game.breakdown.map((entry) => entry.points),
    recap: game.record,
  });
}

/**
 * In the daily, a closed run is closed: the score is the day's score, so
 * there is no stepping back to try for a better one. Random puzzles keep
 * the game's own rule, where undo after a finish is allowed for a point.
 */
function undoAllowed() {
  return game.canUndo && !(meta.mode === "daily" && game.isClosed);
}

function render() {
  settle();
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
  const canUndo = undoAllowed();
  const undoCosts = canUndo &&
    game.rows.length > 1 && !game.selection.length && game.phase !== "build";
  els.undo.disabled = !canUndo;
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
  els.undo.title = canUndo ? "" : "This game is closed.";
  // The level is a random-puzzle setting; the daily is always dealt at the default.
  els.levels.hidden = meta.mode === "daily";
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

/* ---------- the demo in the instructions ---------- */

/** A game walked through a step at a time, at the reader's pace. */
const DEMO_SEED = "plant";

let demoPreview = [];
let demoNote = "";
let demoCoach = "";
let demoAt = 0;

/**
 * Each step is everything that happens between one press of Next and the
 * next, so a step is a thought rather than a keystroke. Going back replays
 * from the start, which keeps every step a pure function of its index.
 */
const DEMO_STEPS = [
  {
    coach: "You are dealt a five-letter word. Each round you drop some of its letters into a shorter one.",
    play: () => {},
  },
  {
    coach: "Tap three letters in a row. They have to be side by side.",
    play: (g) => { g.toggleSelect(1); g.toggleSelect(2); demoPreview = [3]; },
  },
  {
    coach: "They drop into your next word. Whatever you leave behind is gone.",
    play: (g) => { demoPreview = []; g.toggleSelect(3); },
  },
  {
    coach: "Now add one letter. It goes on an end, never in the middle. Tap a slot to choose the end.",
    play: (g) => { g.setSide("front"); g.setLetter("b"); },
  },
  {
    coach: "Tap the check to try it. BLAN is not a word, and a wrong guess spends one of your three.",
    play: (g) => { demoNote = submitNote(g.submit()); },
  },
  {
    coach: "So try the other end instead.",
    play: (g) => { demoNote = ""; g.setSide("end"); g.setLetter("d"); },
  },
  {
    coach: "LAND. Two points for the word, and two more for the D it brought in.",
    play: (g) => g.submit(),
  },
  {
    coach: "Two letters this round, and again one to add. Every letter already on the board is spent.",
    play: (g) => { g.toggleSelect(1); demoPreview = [2]; },
  },
  {
    coach: "This time the front is the end that works, making CAN.",
    play: (g) => {
      demoPreview = [];
      g.toggleSelect(2);
      g.setSide("front");
      g.setLetter("c");
      g.submit();
    },
  },
  {
    coach: "One letter now, and one to add.",
    play: (g) => { demoPreview = [1]; },
  },
  {
    coach: "AH holds an A, and A is a word on its own, so it drops. That is the whole game.",
    play: (g) => { demoPreview = []; g.toggleSelect(1); g.setLetter("h"); g.submit(); },
  },
];

function demoTile(letter, classes, value) {
  const tile = document.createElement("div");
  tile.className = classes.join(" ");
  if (letter) tile.textContent = letter;
  if (value) tile.dataset.value = value;
  return tile;
}

function drawDemo(g) {
  const layout = boardLayout(g);
  els.demo.style.setProperty("--extent", layout.extent);

  const rows = g.rows.map((row, i) => {
    const div = document.createElement("div");
    div.className = "row";
    div.style.setProperty("--offset", layout.offsets[i]);
    [...row.word].forEach((letter, index) => {
      const classes = ["tile"];
      if (row.kept) {
        classes.push(index >= row.kept[0] && index < row.kept[1] ? "dropped" : "spent");
      }
      const onLastRow = i === g.rows.length - 1;
      const chosen = g.phase === "select" && g.selection.includes(index);
      if (onLastRow && (chosen || demoPreview.includes(index))) classes.push("selected");
      div.append(demoTile(letter, classes, index === addedIndex(row) ? letterValue(letter) : 0));
    });
    return div;
  });

  if (g.phase === "build") {
    const draft = document.createElement("div");
    draft.className = "row";
    draft.style.setProperty("--offset", layout.offsets[g.rows.length]);
    const slot = (side) => {
      const filled = g.side === side && g.letter;
      const classes = ["tile", "slot"];
      if (g.side === side) classes.push("active");
      if (filled) classes.push("filled");
      return demoTile(filled ? g.letter : "", classes, filled ? letterValue(g.letter) : 0);
    };
    const check = document.createElement("button");
    check.className = "confirm";
    check.disabled = !g.letter;
    check.tabIndex = -1;
    check.innerHTML = CHECK_SVG;
    draft.append(
      slot("front"),
      ...[...g.block].map((c) => demoTile(c, ["tile"], 0)),
      slot("end"),
      check
    );
    rows.push(draft);
  }

  els.demo.replaceChildren(...rows);
  els.demoCoach.textContent = demoCoach;
  els.demoNote.innerHTML = demoNote || defaultNote(g, demoPreview.length);
  els.demoNote.classList.toggle("error", Boolean(demoNote));
  els.demoStrikes.replaceChildren(...Array.from({ length: STRIKE_LIMIT }, (_, i) => {
    const mark = document.createElement("i");
    mark.className = i < g.strikes ? "strike used" : "strike";
    return mark;
  }));

  const last = DEMO_STEPS.length - 1;
  els.demoBack.disabled = demoAt === 0;
  if (els.demoBack.disabled && document.activeElement === els.demoBack) els.demoNext.focus();
  els.demoNext.textContent = demoAt === last ? "Start again" : "Next";
  els.demoCount.textContent = `${demoAt + 1} of ${DEMO_STEPS.length}`;
}

/** Replays from the first step, so any step can be reached from any other. */
function showDemoStep(at) {
  demoAt = Math.max(0, Math.min(at, DEMO_STEPS.length - 1));
  demoPreview = [];
  demoNote = "";
  demoCoach = "";

  const g = new Game({ seed: DEMO_SEED });
  for (let i = 0; i <= demoAt; i += 1) {
    demoCoach = DEMO_STEPS[i].coach ?? demoCoach;
    DEMO_STEPS[i].play(g);
  }
  drawDemo(g);
}

function stepDemo(by) {
  const last = DEMO_STEPS.length - 1;
  showDemoStep(demoAt === last && by > 0 ? 0 : demoAt + by);
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
    setNote(submitNote(result), true);
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
  } else if (undoAllowed()) {
    game.undo();
  }
  setNote("");
  render();
}

/** Focus lands on the button at the end, so scroll back to the top after. */
function openRules() {
  els.rules.showModal();
  els.rules.scrollTop = 0;
  showDemoStep(0);
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
      (meta.mode === "daily"
        ? "then counts as practice: it is not saved as the day’s score and cannot be shared. "
        : "then counts as practice and cannot be shared. ") +
      "Tap again to switch them on.");
  } else {
    hintsOn = true;
    hintsArmed = false;
    // Marks the run as practice for good, even if you turn them off again.
    // A run that is already over is left as it was played.
    if (!game.isOver) game.hintsUsed = true;
    setNote("");
  }
  render();
}

/* ---------- which puzzle is showing ---------- */

/**
 * The address says what is showing, so a day can be linked and the back
 * button steps back through the places visited: ?daily=2026-10-12, ?past,
 * ?practice, ?word=plant. No query means today's puzzle. On the first load
 * and when the back button has already moved the address, the address is
 * replaced rather than pushed.
 */
let replacingUrl = false;

function setUrl(query) {
  try {
    history[replacingUrl ? "replaceState" : "pushState"](null, "", query || location.pathname);
  } catch { /* file:// and sandboxed frames refuse history writes */ }
}

function showView(which) {
  view = which;
  for (const el of els.gameUi) el.hidden = which !== "game";
  els.past.hidden = which !== "past";
  window.scrollTo(0, 0);
}

// The line under the title: what is showing, and links to the other places.
const PLACES = {
  today: ["Today’s puzzle", "./", () => openToday()],
  past: ["Past puzzles", "?past", () => showPast()],
  random: ["Random puzzles", "?practice", () => startRandom()],
};

function setDailyLine(nodes, places) {
  els.dailyText.replaceChildren(...nodes);
  els.dailyLinks.replaceChildren(...places.map((key) => {
    const [label, href, go] = PLACES[key];
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.addEventListener("click", (event) => { event.preventDefault(); go(); });
    return link;
  }));
}

function lineFor(m) {
  const strong = document.createElement("b");
  if (m.mode !== "daily") {
    strong.textContent = "Random puzzles";
    return [strong];
  }
  strong.textContent = `Daily No. ${m.number}`;
  return [strong, ` · ${daily.fmtShort(m.date)}`];
}

function showGame() {
  setDailyLine(lineFor(meta), meta.mode === "daily" ? ["past", "random"] : ["today", "past"]);
  showView("game");
  render();
}

function resetRun() {
  saved = null;
  giveUpArmed = false;
  hintsArmed = false;
  definitionFor = null;
  definitionIn = null;
  landingFrom = 0;
  setNote("");
  showGame();
}

/**
 * The day's puzzle. A day that has been played opens on its results, rebuilt
 * from the record so the board shows the run; `again` deals it afresh for a
 * replay, whose score is never kept.
 */
function startDaily(m, again = false) {
  meta = m;
  const seed = dailyWord(daily.rng(m.seed));
  const record = again ? null : daily.record(m.iso);
  game = record ? Game.restore(seed, record.recap) : new Game({ seed });
  if (!record) game.hintsUsed = hintsOn;
  setUrl(m.iso === daily.todayMeta().iso ? "" : `?daily=${m.iso}`);
  resetRun();
  // A day that ended with the answer out shows it again, so its words are fetched.
  if (game.restored && game.answerShown) prefetchDefinitions();
}

function openToday() {
  startDaily(daily.todayMeta());
}

function openDate(isoDate) {
  const date = daily.parseIso(isoDate);
  if (!date || date > daily.today()) return showPast();
  startDaily(daily.metaFor(date));
}

/** A fresh random deal at the slider's level, or the word a link asked for. */
function startRandom(seed) {
  meta = daily.practiceMeta();
  game = new Game({ seed: seed ?? randomSeed(level) });
  game.hintsUsed = hintsOn;
  setUrl(seed ? `?word=${seed}` : "?practice");
  resetRun();
}

function showPast() {
  setUrl("?past");
  const strong = document.createElement("b");
  strong.textContent = "Past puzzles";
  setDailyLine([strong, ` · the previous ${daily.PAST_DAYS} days`], ["today", "random"]);

  const today = daily.today();
  els.pastList.replaceChildren(...daily.pastDays().map((m) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `?daily=${m.iso}`;
    if (m.isToday) link.className = "today";
    link.addEventListener("click", (event) => { event.preventDefault(); openDate(m.iso); });

    const number = document.createElement("span");
    number.className = "n";
    number.textContent = `No. ${m.number}`;

    const date = document.createElement("span");
    date.className = "d";
    date.textContent = (m.isToday ? "Today, " : "") + daily.fmtTiny(m.date) +
      (m.date.getFullYear() !== today.getFullYear() ? `, ${m.date.getFullYear()}` : "");

    const score = document.createElement("span");
    score.className = m.record ? "s done" : "s";
    score.textContent = m.record ? `${m.record.score} / ${m.record.max}` : "Not played";

    link.append(number, date, score);
    item.append(link);
    return item;
  }));
  showView("past");
}

/** The puzzle asked for is the one in hand, so show it rather than deal it again. */
function resume(matches) {
  if (!matches) return false;
  if (view !== "game") showGame();
  return true;
}

/** Open whatever the address asks for. */
function route() {
  const query = new URLSearchParams(location.search);
  const word = requestedSeed(query);
  replacingUrl = true;
  try {
    if (query.has("past")) showPast();
    else if (word) resume(meta.mode === "practice" && game.seed === word) || startRandom(word);
    else if (query.has("practice")) resume(meta.mode === "practice") || startRandom();
    else {
      const wanted = query.get("daily") || daily.todayMeta().iso;
      resume(meta.mode === "daily" && meta.iso === wanted) || openDate(wanted);
    }
  } finally {
    replacingUrl = false;
  }
}

/* ---------- wiring ---------- */

els.undo.addEventListener("click", onBackspace);
els.newGame.addEventListener("click", () => startRandom());
window.addEventListener("popstate", route);
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
  daily.write("level", level);
  startRandom();
});
els.giveUp.addEventListener("click", onGiveUp);
els.hints.addEventListener("click", toggleHints);
els.howTo.addEventListener("click", openRules);
els.demoBack.addEventListener("click", () => stepDemo(-1));
els.demoNext.addEventListener("click", () => stepDemo(1));


document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  // While the instructions are open the arrows walk the guide. This lives on
  // the document because disabling Back moves focus out of the dialog, and a
  // listener on the dialog would never hear the key.
  if (els.rules.open) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      stepDemo(event.key === "ArrowRight" ? 1 : -1);
    }
    return;
  }
  if (view !== "game") return;

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

route();
if (!daily.read("seen", false)) {
  daily.write("seen", 1);
  openRules();
}
