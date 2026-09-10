# Letter Drop

A word game. You start with a five-letter word and drop letters through
progressively shorter words until you are down to a single letter.

## The rules

Each round you keep a run of consecutive letters from the current word and add
one new letter to the front or the back. The kept letters stay side by side and
in order, so the new letter always lands on an end, never in the middle.

| Round | Keep | Add | Makes |
| --- | --- | --- | --- |
| 1 | 3 consecutive letters | 1 | a 4-letter word |
| 2 | 2 consecutive letters | 1 | a 3-letter word |
| 3 | 1 letter | 1 | a 2-letter word |
| 4 | the A or the I | — | a 1-letter word |

The last round only works if the two-letter word holds an A or an I, since those
are the only single letters that are words on their own.

A sample run from PLANT: keep LAN, add D for LAND. Keep LA, add D for LAD. Keep
D, add A for AD. Then let the A fall.

## Scoring

- **2 points** for every word you make. The opening word is dealt, not earned,
  so a clean run to a single letter is 8 points.
- **1 point** for each different letter you use that was not in the opening
  word. There are three chances to add a letter, so the ceiling is 11.

The on-screen keyboard tracks this while you play. A heavy border means the
letter is in the opening word and earns no bonus. A filled grey key means you
have already used it. A green key means it was new, and you scored for it.

## Playing it

The quickest way is to open `dist/letter-drop.html`. It is the whole game in one
file, so a double-click works with no server and no internet.

To work on the source instead, serve the folder. The game is plain HTML, CSS,
and JavaScript with no dependencies and no build step, but it does use ES
modules, which browsers refuse to load over `file://`.

```
npm start          # python3 -m http.server 8000
```

Then open http://localhost:8000.

Add `?word=plant` to the URL to open a specific puzzle. That is how you share a
game with someone or replay one.

## Tests

```
npm test
```

These cover the rules rather than the interface: which words are reachable,
what counts as a legal split, scoring, undo, and dead ends. There is also a
check that every opening word the game can deal is solvable to a single letter.

## Layout

```
index.html            markup
src/styles.css        styles
src/game.js           the rules, with no DOM in sight
src/ui.js             rendering, keyboard, and input
src/words.js          generated word data, do not edit
tools/build_words.py  regenerates src/words.js
tools/build_single.py packs everything into dist/
test/game.test.js     tests for the rules
dist/                 generated single-file builds, do not edit
```

`dist/` is checked in so the game can be opened or handed to someone without a
toolchain. Rebuild it after any change to the source:

```
python3 tools/build_single.py
```

## The word list

`src/words.js` holds every legal 2- to 5-letter word (14,084 of them) plus the
3,074 five-letter openers the game deals. Openers are drawn from common words
only, and each one is verified solvable before it goes in the list, so you can
never be dealt a puzzle that cannot be finished. Getting stuck is always a
matter of which split you chose, and Undo walks it back.

To rebuild it, fetch the two source lists and run the generator:

```
curl -O https://raw.githubusercontent.com/redbo/scrabble/master/dictionary.txt
curl -O https://raw.githubusercontent.com/dolph/dictionary/master/popular.txt
python3 tools/build_words.py dictionary.txt popular.txt
```

Words come from the TWL06 tournament list, which is why some legal plays look
unusual. QI and ZA are words here.
