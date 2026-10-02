/**
 * The page side of the readability measurement (readability.ts), as plain JavaScript in a string (as
 * probe.ts: tsx would wrap a serialised function in a helper the page lacks). harness.test.ts
 * compiles it. The definitions it applies are in readability-summary.ts.
 */

/**
 * The page side: `window.__frlRead` with `rows()` (every mounted step row's record), `view()` (the
 * list's box and the steps wholly in it) and `reveal(step)` (scrolls the list until that row is
 * wholly in view). Plain JavaScript in a string, as probe.ts.
 */
export const PAGE_SOURCE = String.raw`(() => {
  const list = () => document.querySelector('[role=listbox]');
  const clips = (node, row) => {
    if (node === row) return true;
    const style = getComputedStyle(node);
    return style.overflowX !== 'visible' || style.overflowY !== 'visible' || /strict|content|paint/.test(style.contain);
  };
  const clipOf = (el, row) => {
    let box = null;
    for (let node = el; node !== null; node = node.parentElement) {
      if (clips(node, row)) {
        const b = node.getBoundingClientRect();
        box = box === null ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : { l: Math.max(box.l, b.left), t: Math.max(box.t, b.top), r: Math.min(box.r, b.right), b: Math.min(box.b, b.bottom) };
      }
      if (node === row) break;
    }
    return box;
  };
  const round1 = (value) => Math.round(value * 10) / 10;
  // Glyph boxes against the clip: cut past 0.02 px across (more than one 1/64 px layout unit) or 1 px up or down; hidden when none is inside.
  const textOf = (el, row) => {
    if (el === null) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (rects.length === 0) return { state: 'absent', text, needPx: 0, clipPx: 0, lines: 0 };
    const clip = clipOf(el, row);
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
    const inside = rects.filter((r) => r.right > clip.l + 0.5 && r.left < clip.r - 0.5 && r.top + r.height / 2 > clip.t && r.top + r.height / 2 < clip.b);
    const cut = rects.some((r) => r.right > clip.r + 0.02 || r.left < clip.l - 0.02 || r.top < clip.t - 1 || r.bottom > clip.b + 1);
    const state = inside.length === 0 ? 'hidden' : cut ? 'cut' : 'whole';
    const need = tops.length > 1 ? rects.reduce((sum, r) => sum + r.width, 0) : right - left;
    return { state, text, needPx: round1(need), clipPx: round1(Math.max(0, clip.r - clip.l)), lines: tops.length };
  };
  // The first of these that is drawn, else the first that exists (the mock adds copies beside the app's own).
  const pick = (row, selectors) => {
    const found = selectors.flatMap((selector) => [...row.querySelectorAll(selector)]);
    const drawn = found.find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0);
    return drawn || found[0] || null;
  };
  const record = (row) => {
    const name = row.getAttribute('aria-label') || '';
    const title = row.querySelector('.frl-steprow__title');
    const issue = pick(row, ['.bplus-issue-text', '.frl-steprow__issue-text']);
    const actions = row.querySelector('.frl-steprow__actions');
    const box = row.getBoundingClientRect();
    return {
      step: Number(row.getAttribute('aria-posinset')),
      kind: row.getAttribute('data-step-kind') || '',
      quest: / Quest level /.test(name),
      selected: row.getAttribute('aria-selected') === 'true',
      active: row.classList.contains('is-active'),
      hovered: row.matches(':hover'),
      height: round1(box.height),
      carried: /no step finishes/i.test(name),
      hasIssue: row.querySelector('.frl-steprow__issue, .frl-steprow__more') !== null,
      hasChain: row.querySelector('.frl-steprow__chain') !== null,
      title: textOf(title, row),
      chain: textOf(row.querySelector('.frl-steprow__chain'), row),
      issue: textOf(issue, row),
      lead: textOf(pick(row, ['.frl-steprow__line2 .frl-steprow__lead']), row),
      zone: textOf(pick(row, ['.frl-steprow__line2 .frl-steprow__zone']), row),
      buttons: actions !== null && actions.getClientRects().length > 0 && actions.getBoundingClientRect().width > 0,
      name,
      tooltip: title === null ? '' : title.getAttribute('title') || '',
    };
  };
  const frames = (n) => new Promise((done) => { let left = n; const tick = () => { left -= 1; if (left <= 0) done(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const view = () => {
    const l = list();
    const box = l.getBoundingClientRect();
    const rows = [...l.querySelectorAll('[role=option][aria-posinset]')].map((row) => ({ step: Number(row.getAttribute('aria-posinset')), r: row.getBoundingClientRect(), active: row.classList.contains('is-active') }));
    const whole = rows.filter((x) => x.r.top >= box.top - 0.5 && x.r.bottom <= box.bottom + 0.5).sort((a, b) => a.step - b.step);
    const active = rows.find((x) => x.active);
    return {
      listHeight: round1(box.height),
      listWidth: round1(box.width),
      scrollTop: l.scrollTop,
      stepsInView: whole.length,
      steps: whole.map((x) => x.step),
      activeStep: active === undefined ? null : active.step,
      activeInView: active === undefined ? null : whole.some((x) => x.active),
    };
  };
  const rowOf = (step) => list().querySelector('[role=option][aria-posinset="' + step + '"]');
  const reveal = async (step) => {
    for (let i = 0; i < 12; i += 1) {
      const l = list();
      const box = l.getBoundingClientRect();
      const row = rowOf(step);
      if (row !== null) {
        const r = row.getBoundingClientRect();
        if (r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5) return true;
        l.scrollTop += r.top - box.top - (box.height - r.height) / 2;
      } else {
        const rows = [...l.querySelectorAll('[role=option][aria-posinset]:not(.is-active)')].map((x) => ({ step: Number(x.getAttribute('aria-posinset')), top: x.getBoundingClientRect().top, h: x.getBoundingClientRect().height }));
        const first = rows.sort((a, b) => a.step - b.step)[0];
        if (first === undefined) return false;
        l.scrollTop += first.top - box.top + (step - first.step) * first.h - box.height / 2;
      }
      await frames(2);
    }
    return false;
  };
  window.__frlRead = {
    rows: () => [...list().querySelectorAll('.frl-steprow[aria-posinset]')].map(record),
    row: (step) => { const row = rowOf(step); return row === null ? null : record(row); },
    view,
    reveal,
    frames,
    labels: () => [...list().querySelectorAll('[role=option]')].map((row) => row.getAttribute('aria-label')).join('\n'),
    box: (step) => { const row = rowOf(step); if (row === null) return null; const r = row.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
    panel: () => { const r = list().getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.right), height: window.innerHeight }; },
  };
})()`;
