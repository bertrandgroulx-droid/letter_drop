/**
 * The share icon in the header, the one every shozbot phone app carries: a
 * link to whatever is on screen, and the three ways of handing it over. No
 * DOM in here, so the link for each state and the hand-over can be tested on
 * their own.
 *
 * The address is always the shozbot.com one, taken from the page's canonical
 * link rather than from location: this file is also served from the old
 * github.io address, and saved progress lives per address.
 */
export const APP = "Letter Drop";
export const HOME = "https://shozbot.com/letter-drop/";

/**
 * What to share, from what is showing. A specific day's puzzle, in play or on
 * its results, links to that day by date, so the link opens the same puzzle
 * tomorrow. A random puzzle links to its word, which the game has always
 * supported, so a friend is dealt the same one. The Past puzzles list, or
 * anything else, is the plain address.
 */
export function shareLink({ canonical, view, meta, seed } = {}) {
  const base = canonical || HOME;
  if (view === "past" || !meta) return { url: base, title: APP };
  if (meta.mode === "daily") {
    return { url: `${base}?daily=${meta.iso}`, title: `${APP} · Daily No. ${meta.number}` };
  }
  return { url: seed ? `${base}?word=${seed}` : base, title: APP };
}

/**
 * On a phone, the share sheet. On a laptop, the clipboard, with a short
 * "Link copied" note. Where neither exists, the link itself goes in the note,
 * so it can at least be read off. A share sheet the person closes is left
 * alone; one the browser refuses falls through to the clipboard.
 */
export async function handOver(link, { navigator: nav, toast } = {}) {
  if (nav?.share) {
    try {
      await nav.share({ title: link.title, url: link.url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "dismissed";
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(link.url);
      toast?.("Link copied");
      return "copied";
    } catch { /* a blocked clipboard falls through to showing the link */ }
  }
  toast?.(link.url);
  return "shown";
}
