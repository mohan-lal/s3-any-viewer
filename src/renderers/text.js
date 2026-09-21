import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import ini from 'highlight.js/lib/languages/ini';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import markdown from 'highlight.js/lib/languages/markdown';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import less from 'highlight.js/lib/languages/less';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';
import accesslog from 'highlight.js/lib/languages/accesslog';
import properties from 'highlight.js/lib/languages/properties';
import kotlin from 'highlight.js/lib/languages/kotlin';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import scala from 'highlight.js/lib/languages/scala';
import r from 'highlight.js/lib/languages/r';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';
import protobuf from 'highlight.js/lib/languages/protobuf';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import swift from 'highlight.js/lib/languages/swift';
import dart from 'highlight.js/lib/languages/dart';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import clojure from 'highlight.js/lib/languages/clojure';
import haskell from 'highlight.js/lib/languages/haskell';
import vbnet from 'highlight.js/lib/languages/vbnet';
import x86asm from 'highlight.js/lib/languages/x86asm';
import latex from 'highlight.js/lib/languages/latex';
import { HLJS_LANG } from '../lib/formats.js';
import { el } from '../lib/util.js';
import { searchableLines } from '../lib/search.js';

const langs = { json, xml, yaml, javascript, typescript, python, java, sql, bash, ini, csharp, cpp, c, go, rust, markdown, css, scss, less, dockerfile, makefile, powershell, dos, diff, plaintext, accesslog, properties, kotlin, ruby, php, scala, r, lua, perl, protobuf, graphql, groovy, swift, dart, elixir, erlang, clojure, haskell, vbnet, x86asm, latex };
for (const [n, l] of Object.entries(langs)) hljs.registerLanguage(n, l);

const HL_LIMIT = 1.5 * 1024 * 1024;   // highlight only below this
const VIRTUAL_LINES = 20_000;         // switch to virtual line rendering above this

export function langFor(ext) {
  if (!ext) return null;
  const l = HLJS_LANG[ext] || ext;
  return hljs.getLanguage(l) ? l : null;
}

/** Render highlighted (or plain) text with a line-number gutter. */
export function highlightInto(mount, text, lang, { wrap = false } = {}) {
  const wrapEl = el('div.code-wrap', { className: wrap ? 'code-wrap wrap' : 'code-wrap' });
  const lineCount = text.length ? text.split('\n').length : 0;
  const gutter = el('div.gutter');
  gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  const code = el('code');
  if (lang && text.length < HL_LIMIT) {
    try { code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value; code.className = `hljs language-${lang}`; }
    catch { code.textContent = text; }
  } else code.textContent = text;
  wrapEl.append(gutter, el('pre', code));
  mount.appendChild(wrapEl);
  return wrapEl;
}

/**
 * Text view with search, used by every renderer that shows source text.
 * Small files idle as a syntax-highlighted <pre>; large files idle as a virtual list.
 * Typing in the search box filters to matching lines with the term highlighted.
 */
export function searchableText(mount, toolbar, text, lang, { wrapToggle = null, stats = null } = {}) {
  const lines = text.split(/\r?\n/);
  const large = lines.length > VIRTUAL_LINES || text.length > 8 * 1024 * 1024;
  let pre = null;
  const api = searchableLines(mount, toolbar, lines, {
    virtualWhenIdle: large,
    idle: () => { pre = el('div'); highlightInto(pre, text, lang, { wrap: !!wrapToggle?.checked }); return pre.firstChild; },
    onModeChange: (filtering) => { if (wrapToggle) wrapToggle.disabled = filtering || large; },
  });
  if (wrapToggle) {
    wrapToggle.disabled = large;
    wrapToggle.onchange = () => mount.querySelector('.code-wrap')?.classList.toggle('wrap', wrapToggle.checked);
  }
  if (stats) toolbar.prepend(stats);
  return api;
}

export async function renderText(ctx) {
  const text = ctx.text();
  const ext = ctx.ext;
  const lang = ctx.raw ? null : langFor(ext) || (ctx.format === 'code' || ctx.format === 'text' ? autoLang(text, ext) : null);
  const lineCount = text.length ? text.split(/\r?\n/).length : 0;

  const wrapCb = el('input', { type: 'checkbox' });
  const stats = el('span.tb-stat', `${lineCount.toLocaleString()} lines · ${text.length.toLocaleString()} chars${lang ? ` · ${lang}` : ''}${ctx.partial ? ' · partial preview' : ''}`);
  ctx.toolbar.append(el('label.ctl', wrapCb, ' Wrap lines'), stats);
  return searchableText(ctx.mount, ctx.toolbar, text, lang, { wrapToggle: wrapCb });
}

function autoLang(text, ext) {
  if (ext && hljs.getLanguage(ext)) return ext;
  const head = text.slice(0, 20000);
  if (/^\s*[{[]/.test(head)) return 'json';
  if (/^\s*<\?xml|^\s*<[a-zA-Z]/.test(head)) return 'xml';
  if (/^#!.*\b(bash|sh|zsh)\b/.test(head)) return 'bash';
  if (/^#!.*\bpython/.test(head)) return 'python';
  if (/^\s*(SELECT|INSERT|CREATE|WITH|UPDATE|DELETE)\b/im.test(head)) return 'sql';
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/m.test(head) || /\[(INFO|WARN|ERROR|DEBUG)\]/.test(head)) return 'accesslog';
  return null;
}
