# Letter Drop

A word game. See README.md for the rules and the layout of the project.

## Keep the instructions with the rules

The rules live in two places: as code in `src/game.js`, and as prose in the
How to play dialog in `dev.html`. They drift apart silently, and a player
following stale instructions plays the wrong game.

**Any change to how the game works means updating that dialog in the same
change.** `test/instructions.test.js` guards the parts it can check
mechanically, comparing the dialog against the constants in `src/game.js`, so
changing a score or a limit will fail the tests until the prose catches up. It
cannot check wording, so read the dialog whenever behaviour changes.

## Working on it

```
npm test                        # rules, and the instructions check
python3 tools/build_single.py   # regenerate index.html and dist/ after any edit
```

`index.html`, `icon.svg`, `icons/`, `src/words.js` and `dist/` are generated.
Edit `dev.html` and `src/` instead, then rebuild. Forgetting the rebuild means
the site keeps serving the old game.
