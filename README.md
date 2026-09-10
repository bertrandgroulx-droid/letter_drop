# Letter Drop

A word game. You start with a five-letter word and drop letters through
progressively shorter words until you are down to a single letter.

## The rules

Each round you drop a run of consecutive letters from the current word down
into the next one, and add one more letter to the front or the back. Dropping
is not discarding: the letters you drop are the ones you take with you, and
whatever you leave behind is gone. They land side by side and in the same
order, so the added letter always goes on an end, never in the middle.

The letter you add must be one you have not used yet. Every letter already on
the board, the opening word included, is spent. That is what makes the game
hard: your options narrow every round.

| Round | Keep | Add | Makes |
| --- | --- | --- | --- |
| 1 | 3 consecutive letters | 1 | a 4-letter word |
| 2 | 2 consecutive letters | 1 | a 3-letter word |
| 3 | 1 letter | 1 | a 2-letter word |
| 4 | the A or the I | — | a 1-letter word, automatically |

The last round only works if the two-letter word holds an A or an I, since those
are the only single letters that are words on their own. It is not a decision,
so the game takes it for you.

A sample run from PLANT: drop LAN, add D for LAND. Drop LA, add B for LAB.
Drop A, add H for AH. The A then falls on its own and the game is over. That run
spends D, B, and H, and scores the full 11.

## The one thing to plan for

Nothing falls unless the two-letter word holds an A or an I, and those obey the
same no-reuse rule as every other letter: once one is on the board it can only
be carried down, never added again. 59% of openers already hold one, and those
runs are about choosing splits that bring it all the way down. The other 41%
need one kept unspent for the final round.

## Scoring

- **2 points** for every word you make. The opening word is dealt, not earned,
  so four words is 8 points.
- **1, 2 or 3 points** for the letter each word brings in, banded from Scrabble
  tile values. The everyday letters `aeilnorstu` pay 1, the awkward `dgbcmp` pay
  2, and `fhvwykjxqz` pay 3. Each key carries its value in the corner.
- **3 points** for reaching a single letter. Without it, stalling on a
  two-letter word holding no A or I costs nothing on about a third of deals,
  because a 3-point letter the round before covers what the fall would have
  paid. The bonus also means the greedy play of always grabbing the most
  expensive letter is wrong about half the time, since it stalls out.
- **Undo costs 1 point**, once there is a committed word to take back. Backing
  out of a split you have not committed yet is free. The total never goes below
  zero.

Every deal has its own ceiling, worked out by searching all of its solutions,
and it sits beside your running score from the first move. When a game ends you
can reveal one of the runs that reached it. Ties are common, so it is a perfect
run rather than the perfect run. Across the openers
it runs from 16 to 20, so `17 of 19` means something a flat maximum would not.

The on-screen keyboard greys out every letter that has appeared, whether it
came from the opening word or from a word you made. Those keys are also
disabled, because a spent letter can never be played again.

## Hints

Hints ring every letter that makes a word from the current position. It exists
for people learning the game, so a run played with hints on is marked as
practice and its Share button is withheld. Turning hints off again does not
clear the mark.

## Playing it

The quickest way is to open `index.html`. It is the whole game in one file, so
a double-click works with no server and no internet.

To work on the source instead, serve the folder and open `dev.html`, which
loads the real modules. The game is plain HTML, CSS, and JavaScript with no
dependencies, but it does use ES modules, which browsers refuse to load over
`file://`.

```
npm start          # python3 -m http.server 8000
```

Then open http://localhost:8000/dev.html.

Add `?word=plant` to the URL to open a specific puzzle. That is how you share a
game with someone or replay one.

## On a phone

Open the page and use Add to Home Screen. It launches without browser chrome
and gets a real icon, because `manifest.webmanifest` and the PNGs in `icons/`
are there for it. The page also keeps clear of the notch and the home
indicator once the browser bars are gone.

Redrawing the icons is the one job here that needs a browser, so unlike
everything else it is not dependency-free:

```
npm i -D playwright && node tools/build_icons.mjs
```

The output is committed, so you should not need to run it.

## Tests

```
npm test
```

These cover the rules rather than the interface: which words are reachable,
what counts as a legal split, scoring, undo, and dead ends. There is also a
check that every opening word the game can deal is solvable to a single letter.

## Layout

```
dev.html              markup, loading the modules below
src/styles.css        styles
src/game.js           the rules, with no DOM in sight
src/ui.js             rendering, keyboard, and input
src/words.js          generated word data, do not edit
tools/build_words.py  regenerates src/words.js
tools/build_single.py packs dev.html and src/ into index.html
tools/build_icons.mjs redraws icon.svg and the home screen icons
test/game.test.js     tests for the rules
manifest.webmanifest  what a phone reads when adding the game to a home screen
index.html            generated, do not edit
icon.svg, icons/      generated, do not edit
dist/artifact.html    generated, the same page without a document wrapper
```

`index.html` is generated and checked in. Everything is inlined, which means a
browser has no separate script or stylesheet left over from a previous visit,
so a deployed change shows up on the next load. Rebuild after any change to the
source, or the site will keep serving the old game:

```
python3 tools/build_single.py
```

## The word list

`src/words.js` holds every legal 2- to 5-letter word (14,084 of them) plus the
3,059 five-letter openers the game deals. Openers are drawn from common words
only, and each one is verified solvable under the no-reused-letters rule before
it goes in the list, so you can never be dealt a puzzle that cannot be
finished. Getting stuck is always a matter of which split you chose. Undo walks
it back, for a point.

To rebuild it, fetch the two source lists and run the generator:

```
curl -O https://raw.githubusercontent.com/redbo/scrabble/master/dictionary.txt
curl -O https://raw.githubusercontent.com/dolph/dictionary/master/popular.txt
python3 tools/build_words.py dictionary.txt popular.txt
```

Words come from the TWL06 tournament list, which is why some legal plays look
unusual. QI and ZA are words here.
