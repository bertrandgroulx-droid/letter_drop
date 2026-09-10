#!/usr/bin/env python3
"""Inline the game from dev.html into a single self-contained page.

Writes:

  index.html         what the site serves and what you can double-click. One
                     file, so a browser has no separate script or stylesheet to
                     hold on to from a previous visit.
  dist/artifact.html the same page as a fragment, for hosts that supply their
                     own <head> and document wrapper

Usage: python3 tools/build_single.py
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = ["src/words.js", "src/game.js", "src/ui.js"]


def flatten(paths):
    """Concatenate ES modules into one script by dropping import/export."""
    chunks = []
    for path in paths:
        lines = []
        for line in (ROOT / path).read_text().splitlines():
            if re.match(r"^import\b.*;\s*$", line):
                continue
            if re.match(r"^export\s*\{.*\};\s*$", line):
                continue
            lines.append(re.sub(r"^export\s+", "", line))
        chunks.append(f"/* ---- {path} ---- */\n" + "\n".join(lines).strip())
    return "\n\n".join(chunks)


def main():
    html = (ROOT / "dev.html").read_text()
    css = (ROOT / "src/styles.css").read_text()
    js = flatten(SOURCES)

    icon = base64.b64encode((ROOT / "icon.svg").read_bytes()).decode()
    page = html.replace(
        '<link rel="icon" href="icon.svg" type="image/svg+xml">',
        f'<link rel="icon" href="data:image/svg+xml;base64,{icon}">',
    ).replace(
        '<link rel="stylesheet" href="src/styles.css">',
        f"<style>\n{css}</style>",
    ).replace(
        '<script type="module" src="src/ui.js"></script>',
        f"<script type=\"module\">\n{js}\n</script>",
    )

    (ROOT / "index.html").write_text(page)
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)

    # The fragment keeps <title> first so hosts that scan for it find it, and
    # drops the icon link because those hosts set their own.
    head = re.search(r"<head>(.*?)</head>", page, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", page, re.S).group(1)
    head = "\n".join(
        line for line in head.splitlines()
        if not re.search(r'<meta|rel="(?:icon|manifest|apple-touch-icon)"', line)
    )
    (out / "artifact.html").write_text(f"{head.strip()}\n{body.strip()}\n")

    for path in (ROOT / "index.html", out / "artifact.html"):
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
