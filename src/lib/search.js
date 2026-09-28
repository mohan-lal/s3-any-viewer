// In-viewer search shared by the text and tree renderers.
//
//   makeSearchBar   the toolbar control: input, match counter, previous / next
//   highlightText   wraps every case-insensitive occurrence of a term in <mark>
//   searchableLines a line list that shows an "idle" view while the box is empty and a
//                   virtualized, filtered, highlighted list while a term is present
import { el, debounce } from './util.js';

export const LINE_H = 20;
const OVERSCAN = 10;

/**
 * Toolbar control. All controls carry the `view-search` class so a renderer can remove them
 * when it switches tabs.
 */
export function makeSearchBar({ placeholder = 'Search…', onQuery, onStep }) {
  const input = el('input.tb-input.view-search', { type: 'search', placeholder, spellcheck: false, autocomplete: 'off' });
  const count = el('span.tb-stat.view-search');
  const prev = el('button.tb-btn.view-search', { title: 'Previous match (Shift+Enter)', disabled: true, onclick: () => onStep(-1) }, '▲');
  const next = el('button.tb-btn.view-search', { title: 'Next match (Enter)', disabled: true, onclick: () => onStep(1) }, '▼');
  input.addEventListener('input', debounce(() => onQuery(input.value), 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; onQuery(''); }
  });
  return {
    nodes: [input, count, prev, next],
    input,
    setCount(text, hasMatches) { count.textContent = text; prev.disabled = next.disabled = !hasMatches; },
    focus() { input.focus(); },
  };
}

/** Text node(s) with every occurrence of `q` (case-insensitive) wrapped in <mark>. */
export function highlightText(text, q, { current = false } = {}) {
  const frag = document.createDocumentFragment();
  if (!q) { frag.appendChild(document.createTextNode(text)); return frag; }
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0, at;
  while ((at = lower.indexOf(ql, i)) !== -1) {
    if (at > i) frag.appendChild(document.createTextNode(text.slice(i, at)));
    const m = el('mark', text.slice(at, at + q.length));
    if (current) m.classList.add('cur');
    frag.appendChild(m);
    i = at + q.length;
  }
  if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
  return frag;
}

function indentOf(s) {
  let w = 0;
  for (const c of s) { if (c === ' ') w++; else if (c === '\t') w += 4; else break; }
  return w;
}
const CLOSER = /^\s*([}\])]|<\/)/;

/**
 * Widen matching lines to the block they open. A line that is followed by more deeply indented
 * lines (a JSON object, a YAML mapping, an XML element, a stack trace under a log line) brings
 * those lines with it, plus the closing bracket or tag at its own indentation.
 * Returns the lines to show and, among them, the positions that are actual matches.
 */
export function expandBlocks(lines, hitIdx) {
  const n = lines.length;
  const include = new Uint8Array(n);
  const isHit = new Uint8Array(n);
  let lastEnd = -1;
  for (const h of hitIdx) {
    include[h] = 1; isHit[h] = 1;
    if (h <= lastEnd) continue;                 // already inside a block pulled in above
    const base = indentOf(lines[h]);
    let end = h;
    for (let j = h + 1; j < n; j++) {
      const s = lines[j];
      if (!s.trim()) continue;                  // blank lines do not end a block
      const ind = indentOf(s);
      if (ind > base) { end = j; continue; }
      if (ind === base && CLOSER.test(s)) end = j;
      break;
    }
    for (let k = h + 1; k <= end; k++) include[k] = 1;
    if (end > lastEnd) lastEnd = end;
  }
  const view = [], hits = [];
  for (let i = 0; i < n; i++) if (include[i]) { if (isHit[i]) hits.push(view.length); view.push(i); }
  return { view, hits };
}

/**
 * Line viewer with search.
 *
 * @param {HTMLElement} mount   where the content goes (emptied by this function)
 * @param {HTMLElement} toolbar where the search controls go (appended)
 * @param {string[]} lines
 * @param {{ idle: () => HTMLElement, virtualWhenIdle?: boolean, onModeChange?: (filtering:boolean)=>void }} opts
 *   idle             builds the no-filter view (e.g. the syntax-highlighted <pre>); cached after first call
 *   virtualWhenIdle  if true, the idle view is the virtual list itself (large files)
 */
export function searchableLines(mount, toolbar, lines, { idle, virtualWhenIdle = false, onModeChange } = {}) {
  // view: line indices shown; hits: positions in `view` that match; cur: index into hits
  const state = { q: '', view: null, hits: [], hitPos: null, cur: -1, nested: true };
  let idleNode = null;

  // ----- virtual list -----
  const box = el('div.vlines');
  const top = el('div'), body = el('div'), bot = el('div');
  box.append(top, body, bot);
  let drawn = { start: -1, end: -1, q: null, cur: -1 };
  let all = null;
  const allIndices = () => (all ??= lines.map((_, i) => i));

  function draw(force) {
    const view = state.view || allIndices();
    const start = Math.max(0, Math.floor(box.scrollTop / LINE_H) - OVERSCAN);
    const end = Math.min(view.length, Math.ceil((box.scrollTop + (box.clientHeight || 600)) / LINE_H) + OVERSCAN);
    if (!force && start === drawn.start && end === drawn.end && drawn.q === state.q && drawn.cur === state.cur) return;
    drawn = { start, end, q: state.q, cur: state.cur };
    top.style.height = start * LINE_H + 'px';
    bot.style.height = Math.max(0, (view.length - end) * LINE_H) + 'px';
    const curPos = state.q && state.cur >= 0 ? state.hits[state.cur] : -1;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const li = view[i];
      const cls = ['line'];
      if (i === curPos) cls.push('cur');
      if (state.hitPos?.has(i)) cls.push('hitline');
      const row = el('div.line', { className: cls.join(' ') }, el('span.ln', String(li + 1)));
      const t = el('span.lt');
      if (state.q) t.appendChild(highlightText(lines[li] || ' ', state.q, { current: i === curPos }));
      else t.textContent = lines[li] || ' ';
      row.appendChild(t);
      frag.appendChild(row);
    }
    body.replaceChildren(frag);
  }
  box.addEventListener('scroll', () => draw(false), { passive: true });
  new ResizeObserver(() => draw(true)).observe(box);

  function scrollToCur() {
    if (state.cur < 0) return;
    const pos = state.hits[state.cur];
    box.scrollTop = Math.max(0, pos * LINE_H - (box.clientHeight || 600) / 2 + LINE_H / 2);
    draw(true);
  }

  function run(q) {
    state.q = q;
    if (!q) { state.view = null; state.hits = []; state.hitPos = null; state.cur = -1; bar.setCount('', false); showIdle(); return; }
    const ql = q.toLowerCase();
    const hitIdx = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(ql)) hitIdx.push(i);
    if (state.nested) ({ view: state.view, hits: state.hits } = expandBlocks(lines, hitIdx));
    else { state.view = hitIdx; state.hits = hitIdx.map((_, i) => i); }
    state.hitPos = new Set(state.hits);
    state.cur = state.hits.length ? 0 : -1;
    showList();
    box.scrollTop = 0;
    updateCount();
    draw(true);
  }

  // ----- search bar -----
  const bar = makeSearchBar({
    placeholder: 'Search lines…',
    onQuery: run,
    onStep(dir) {
      if (!state.hits.length) return;
      state.cur = (state.cur + dir + state.hits.length) % state.hits.length;
      updateCount();
      scrollToCur();
    },
  });
  const nestedCb = el('input', { type: 'checkbox', checked: true });
  nestedCb.addEventListener('change', () => { state.nested = nestedCb.checked; if (state.q) run(state.q); });
  const nestedLbl = el('label.ctl.view-search', { title: 'When a matching line opens a block, show the lines inside it' }, nestedCb, ' Show nested');
  toolbar.append(...bar.nodes, nestedLbl);

  function updateCount() {
    const n = state.hits.length;
    if (!n) { bar.setCount('No matches', false); return; }
    const extra = state.view.length - n;
    bar.setCount(`${n.toLocaleString()} matching line${n === 1 ? '' : 's'}${extra ? ` (+${extra.toLocaleString()} nested)` : ''} · ${(state.cur + 1).toLocaleString()} of ${n.toLocaleString()}`, true);
  }

  // ----- mode switching -----
  let mode = null;
  function showIdle() {
    if (virtualWhenIdle) { showList(); draw(true); return; }
    if (mode === 'idle') return;
    mode = 'idle';
    idleNode ??= idle();
    mount.replaceChildren(idleNode);
    onModeChange?.(false);
  }
  function showList() {
    if (mode === 'list') return;
    mode = 'list';
    mount.replaceChildren(box);
    onModeChange?.(true);
  }

  showIdle();
  return { focus: () => bar.focus(), destroy() { [...bar.nodes, nestedLbl].forEach(n => n.remove()); } };
}
