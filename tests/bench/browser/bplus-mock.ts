/**
 * A mock of left-panel layout "B+" (docs/DECISIONS.md D-051) for the readability measurement
 * (readability.ts): an override stylesheet and a small page script, injected into a production
 * build of today's panel. No product code changes; the build that follows D-051 replaces this.
 *
 * What it does to each two-line step row:
 * - **44 px rows** (`ROW`): the stylesheet fixes the height; the script moves every row, the later
 *   band, the insertion line and the drop line by `translateY` from the list's 40 px positions to
 *   index × 44, and lengthens the canvas.
 * - **Difficulty:** the chip is hidden; a copy of its pips is drawn under the disc in ink, and line 2
 *   starts with "Lv n" (the chip's level). The disc keeps its difficulty colour.
 * - **Issue shape drawn once:** line 1's issue marker is hidden; line 2 keeps the worst issue's shape
 *   and words.
 * - **Chain only where it fits:** line 1 wraps, one line tall, so the chain position ("2/2") falls
 *   to an invisible second line when it does not fit beside the whole title. The active row's line 1
 *   does not wrap, so the chain always shows there and the title gives way.
 * - **Buttons:** hidden at rest; shown on hover, on the selected rows and on the active row.
 * - **The active row grows** by `EXTRA` (two 16 px lines): line 2 shows "Lv n · NPC · zone" whole
 *   (an issue row's place is read from the row's accessible name, which carries it), and the issue's
 *   words get their own block below, up to two lines, beside the buttons at the bottom right. Every
 *   row after it moves down by `EXTRA` (index × 44 + EXTRA), as D-051 sets for the virtual list.
 *
 * - **Reveal:** when the active row changes, the script scrolls it wholly into view by its B+ box, as
 *   the build's reveal will (the list's own reveal still counts 40 px rows).
 *
 * Limits (a mock, not the build): the list's own window, paging, drag and auto-scroll still count
 * 40 px rows, so PageDown moves 11 rows where the build would move 10 (on the sample route's 55 rows
 * the window still mounts every row in view, and the measurement scrolls the list itself); the row
 * index comes from React's `top` (index × 40); group headers are not restyled; one-line rows are
 * untouched; an issue row's place is parsed from its accessible name.
 */

/** B+'s fixed row height (D-051). */
export const BPLUS_ROW = 44;

/** The active row's one fixed extra: two 16 px lines for the issue's words (D-051, "the active row grows"). */
export const BPLUS_EXTRA = 32;

/** Today's two-line row height, which the built list still positions rows by. */
const TODAY_ROW = 40;

export const BPLUS_CSS = String.raw`
.frl-routelist .frl-row--two-line { height: ${String(BPLUS_ROW)}px !important; }
.frl-routelist .frl-row--two-line.frl-steprow.is-active {
  height: ${String(BPLUS_ROW + BPLUS_EXTRA)}px !important;
  align-items: flex-start;
}
.frl-row--two-line.frl-steprow.is-active > .frl-steprow__number,
.frl-row--two-line.frl-steprow.is-active > .frl-steprow__markbox,
.frl-row--two-line.frl-steprow.is-active > .frl-steprow__text,
.frl-row--two-line.frl-steprow.is-active > .frl-steprow__estimates { margin-top: 3px; }
.frl-row--two-line.frl-steprow.is-active > .frl-steprow__number { line-height: 20px; }
.frl-row--two-line .frl-steprow__line1 { height: 20px; flex-wrap: wrap; align-content: flex-start; overflow: hidden; row-gap: 6px; }
.frl-row--two-line .frl-steprow__line1 > * { height: 20px; line-height: 20px; }
.frl-row--two-line .frl-steprow__line1 > .frl-steprow__chain { order: 2; }
.frl-row--two-line.is-active .frl-steprow__line1 { flex-wrap: nowrap; }
.frl-row--two-line .frl-steprow__line2 { height: 18px; }
.frl-row--two-line .frl-steprow__estimates .frl-steprow__top { height: 20px; line-height: 20px; }
.frl-row--two-line .frl-steprow__estimates .frl-steprow__bottom { height: 18px; line-height: 18px; }

/* Difficulty: no chip; the pips under the disc in ink, "Lv n" on line 2. */
.frl-row--two-line .frl-steprow__difficulty { display: none; }
.frl-row--two-line .frl-steprow__markbox { flex-direction: column; align-items: center; gap: 2px; }
.frl-row--two-line .bplus-pips { display: block; }
.frl-row--two-line .bplus-pips .frl-difficulty__pip { fill: var(--frl-difficulty-pip-off); }
.frl-row--two-line .bplus-pips .frl-difficulty__pip.is-on { fill: var(--frl-fg-muted); }
.bplus-lv { flex: none; color: var(--frl-fg-muted); }
.bplus-sep { flex: none; }

/* The issue shape once: on line 2 with its words, not on line 1. */
.frl-row--two-line .frl-steprow__issues { display: none; }

/* Buttons: on hover, on the selected rows and on the active row only. */
.frl-row--two-line .frl-steprow__actions { display: none; }
.frl-row--two-line:hover .frl-steprow__actions,
.frl-row--two-line.is-selected .frl-steprow__actions,
.frl-row--two-line.is-active .frl-steprow__actions { display: inline-flex; }

/* The active row: the place whole on line 2, the issue's words in full below, the buttons at the bottom right. */
.frl-steprow__line2 > .bplus-place.bplus-place { display: none; }
.frl-row--two-line.is-active .frl-steprow__line2 > .bplus-place.bplus-place { display: inline-flex; flex: 0 1 auto; min-width: 0; overflow: hidden; }
.frl-row--two-line.is-active .frl-steprow__issue { display: none; }
.frl-row--two-line.is-active .frl-steprow__detail.is-place .frl-steprow__lead { flex: 0 1 auto; min-width: 0; }
.frl-row--two-line.is-active .frl-steprow__actions {
  position: absolute;
  right: 8px;
  bottom: 3px;
  height: 16px;
  margin: 0;
}
.bplus-issue { display: none; }
.frl-row--two-line.is-active .bplus-issue {
  position: absolute;
  top: ${String(BPLUS_ROW - 2)}px;
  left: calc(var(--frl-number-digits) * 6.82px + 6px + 36px);
  right: 8px;
  display: block;
  height: 32px;
  overflow: hidden;
  font-size: var(--frl-text-sm);
  line-height: 16px;
  white-space: normal;
}
.bplus-issue[data-severity='error'] { color: var(--frl-severity-error); }
.bplus-issue[data-severity='warning'] { color: var(--frl-severity-warning); }
.bplus-issue[data-severity='info'] { color: var(--frl-severity-info); }
.bplus-issue > svg { vertical-align: -1px; margin-right: 4px; }
/* The buttons' corner: a float on the second line only (the first, empty float takes line 1). */
.bplus-issue > .bplus-float-a { float: right; width: 0; height: 16px; }
.bplus-issue > .bplus-float-b { float: right; clear: right; width: 66px; height: 16px; }
`;

/**
 * The page script (plain JavaScript in a string, as probe.ts: tsx would wrap a serialised function
 * in a helper the page lacks). Idempotent: it runs on every change React makes to the list.
 */
export const BPLUS_SCRIPT = String.raw`(() => {
  if (window.__frlBplus !== undefined) return;
  const ROW = ${String(BPLUS_ROW)}, EXTRA = ${String(BPLUS_EXTRA)}, OLD = ${String(TODAY_ROW)};
  const state = { syncs: 0, revealed: null };
  window.__frlBplus = state;

  const indexOf = (el) => { const top = parseFloat(el.style.top); return Number.isFinite(top) ? Math.round(top / OLD) : null; };
  const setIf = (el, prop, value) => { if (el.style[prop] !== value) el.style[prop] = value; };

  // "Gornek, Durotar 42.06, 68.33" from a row's name: the place after the title and chain.
  const placeFromName = (row) => {
    const name = row.getAttribute('aria-label') || '';
    const title = row.querySelector('.frl-steprow__title');
    const verb = row.querySelector('.frl-steprow__verb');
    if (title === null) return null;
    const text = title.textContent.slice(verb === null ? 0 : verb.textContent.length).trim();
    const at = name.indexOf(': ' + text);
    if (at < 0) return null;
    let rest = name.slice(at + 2 + text.length).replace(/^ \(\d+ of \d+\)/, '');
    const match = /^, (.+?), (.+?) -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)?(?:, in group [^.]*)?\. /.exec(rest);
    return match === null ? null : { lead: match[1], zone: match[2] };
  };

  const decorate = (row) => {
    const line2 = row.querySelector('.frl-steprow__line2');
    const markbox = row.querySelector('.frl-steprow__markbox');
    const chip = row.querySelector('.frl-steprow__difficulty');
    if (line2 === null || markbox === null) return;
    // Pips under the disc and "Lv n" first on line 2.
    let lv = line2.querySelector(':scope > .bplus-lv');
    if (chip !== null) {
      const level = chip.querySelector('.frl-difficulty__level');
      const words = 'Lv ' + (level === null ? '?' : level.textContent);
      if (lv === null) {
        lv = document.createElement('span');
        lv.className = 'bplus-lv';
        const sep = document.createElement('span');
        sep.className = 'bplus-sep';
        sep.textContent = '·';
        line2.insertBefore(sep, line2.firstChild);
        line2.insertBefore(lv, sep);
      }
      if (lv.textContent !== words) lv.textContent = words;
      const pips = chip.querySelector('.frl-difficulty__pips');
      const mine = markbox.querySelector(':scope > .bplus-pips');
      const key = pips === null ? '' : pips.innerHTML;
      if (mine === null || mine.dataset.key !== key) {
        if (mine !== null) mine.remove();
        if (pips !== null) {
          const copy = pips.cloneNode(true);
          copy.classList.add('bplus-pips');
          copy.dataset.key = key;
          markbox.appendChild(copy);
        }
      }
    }
    // An issue row: its place (for the active row's line 2) and its words in full (the block below).
    const issue = row.querySelector('.frl-steprow__issue');
    let place = line2.querySelector(':scope > .bplus-place');
    let block = row.querySelector(':scope > .bplus-issue');
    if (issue === null) {
      if (place !== null) place.remove();
      if (block !== null) block.remove();
      return;
    }
    const where = placeFromName(row);
    const placeKey = where === null ? '' : where.lead + '|' + where.zone;
    if (place === null || place.dataset.key !== placeKey) {
      if (place !== null) place.remove();
      place = document.createElement('span');
      place.className = 'bplus-place frl-steprow__detail is-place';
      place.dataset.key = placeKey;
      if (where !== null) {
        const lead = document.createElement('span');
        lead.className = 'frl-steprow__lead';
        lead.textContent = where.lead;
        const sep = document.createElement('span');
        sep.className = 'frl-steprow__sep';
        sep.textContent = ' · ';
        const zone = document.createElement('span');
        zone.className = 'frl-steprow__zone';
        zone.textContent = where.zone;
        place.append(lead, sep, zone);
      }
      line2.insertBefore(place, issue);
    }
    const words = row.querySelector('.frl-steprow__issue-text');
    const severity = issue.getAttribute('data-severity') || '';
    const blockKey = severity + '|' + (words === null ? '' : words.textContent);
    if (block === null || block.dataset.key !== blockKey) {
      if (block !== null) block.remove();
      block = document.createElement('div');
      block.className = 'bplus-issue';
      block.dataset.key = blockKey;
      block.setAttribute('data-severity', severity);
      const a = document.createElement('span');
      a.className = 'bplus-float-a';
      const b = document.createElement('span');
      b.className = 'bplus-float-b';
      const shape = issue.querySelector('svg');
      const text = document.createElement('span');
      text.className = 'bplus-issue-text';
      text.textContent = words === null ? '' : words.textContent;
      block.append(a, b);
      if (shape !== null) block.appendChild(shape.cloneNode(true));
      block.appendChild(text);
      row.appendChild(block);
    }
  };

  const sync = (canvas) => {
    state.syncs += 1;
    const option = canvas.querySelector('[role=option][aria-setsize]');
    const count = option === null ? 0 : Number(option.getAttribute('aria-setsize'));
    const active = canvas.querySelector('.frl-row--two-line.is-active');
    if (canvas.querySelector('.frl-row--two-line') === null) return;
    const activeIndex = active === null ? null : indexOf(active);
    const shiftOf = (index) => index * (ROW - OLD) + (activeIndex !== null && index > activeIndex ? EXTRA : 0);
    const height = count * ROW + (activeIndex === null ? 0 : EXTRA);
    setIf(canvas, 'height', height + 'px');
    for (const el of canvas.children) {
      const index = indexOf(el);
      if (index === null) continue;
      setIf(el, 'transform', 'translateY(' + shiftOf(index) + 'px)');
      if (el.classList.contains('frl-routelist__later')) setIf(el, 'height', Math.max(0, height - (index * ROW + (activeIndex !== null && index > activeIndex ? EXTRA : 0))) + 'px');
      if (el.classList.contains('frl-steprow')) decorate(el);
    }
    // Reveal a newly active row by its B+ box (the build's reveal will use the same offsets).
    if (activeIndex !== state.revealed) {
      state.revealed = activeIndex;
      const viewport = canvas.parentElement;
      if (activeIndex !== null && viewport !== null) {
        const top = activeIndex * ROW;
        const bottom = top + ROW + EXTRA;
        if (top < viewport.scrollTop) viewport.scrollTop = top;
        else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight;
      }
    }
  };

  const attach = () => {
    const canvas = document.querySelector('.frl-routelist--two-line .frl-routelist__canvas');
    if (canvas === null) return false;
    if (canvas.__frlBplus === true) return true;
    canvas.__frlBplus = true;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; sync(canvas); });
    }).observe(canvas, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'aria-label'], characterData: true });
    sync(canvas);
    return true;
  };
  // The list mounts after the app boots, and again when its density or project changes.
  const watch = () => { new MutationObserver(() => { attach(); }).observe(document.documentElement, { childList: true, subtree: true }); attach(); };
  // An init script can run before the document has its root element.
  if (document.documentElement === null) document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
})()`;
