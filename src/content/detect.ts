// Universal question detection: finds form controls, groups them into questions, reads the question
// text and options, and picks the one question the user is currently on.

import type { Choice, QImage, Question } from '../shared/types';
import { pickAdapter, type Adapter } from './adapters';
import { buttonChoices } from './buttons';
import { clean, hasLayout, inView, isVisible, lca, precedingText, readText } from './dom';
import type { Detected, Target } from './types';

type CK = 'radio' | 'check' | 'text' | 'long' | 'select' | 'listbox';
interface Ctl {
  el: HTMLElement;
  k: CK;
}
interface Unit {
  ctls: Ctl[];
  /** Radio groups forming the rows of a matching grid. */
  grid?: HTMLElement[][];
  /** Container of a fill-in-the-blank sentence. */
  cloze?: Element;
}

export const CONTROL_SEL =
  'input,textarea,select,[role=radio],[role=checkbox],[role=listbox],[role=textbox],[contenteditable]';
const SKIP_TYPES = new Set(
  'hidden password email tel file submit button reset image week color range search'.split(' '),
);
const PERSONAL_AUTOCOMPLETE = /name|email|tel|address|street|postal|organization|cc-|bday|username/i;
const PERSONAL_PROMPT =
  /^(\d+[.)]\s*)?(your |full |first |last |student )?((name|surname|id( number)?|class|group|date)\s*[:*]?$|(e-?mail|phone)\b)/i;
const INLINE = new Set(['SPAN', 'LABEL', 'B', 'I', 'EM', 'STRONG', 'FONT', 'A', 'U']);
const STOP_CLIMB = 'form,main,body,[role=main],[role=form]';

/** Blocks this page session already answered or gave up on, so the next activation moves on. */
// Keyed by the block and remembered together with the question it held: single-page apps
// (Socrative) reuse the same elements for the next question, which must not count as handled.
const handled = new WeakMap<Element, string>();
const fingerprint = (d: Detected): string => `${d.question.prompt}|${d.question.options?.map((o) => o.label).join('|') ?? ''}`;
export const markHandled = (d: Detected): void => void handled.set(d.block, fingerprint(d));

export const hasControl = (e: Element): boolean => e.matches(CONTROL_SEL) || !!e.querySelector(CONTROL_SEL);

function classify(el: HTMLElement): CK | null {
  if (el.closest('[data-form-pilot]')) return null;
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
  const role = el.getAttribute('role');
  switch (el.tagName) {
    case 'INPUT': {
      const i = el as HTMLInputElement;
      const type = (i.getAttribute('type') || 'text').toLowerCase();
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'check';
      if (SKIP_TYPES.has(type) || i.readOnly || PERSONAL_AUTOCOMPLETE.test(i.getAttribute('autocomplete') ?? '')) return null;
      return 'text';
    }
    case 'TEXTAREA':
      return (el as HTMLTextAreaElement).readOnly ? null : 'long';
    case 'SELECT':
      return (el as HTMLSelectElement).multiple ? null : 'select';
  }
  if (role === 'radio') return 'radio';
  if (role === 'checkbox') return 'check';
  if (role === 'listbox')
    return el.querySelector('[role=option]') && el.getAttribute('aria-multiselectable') !== 'true' ? 'listbox' : null;
  const ce = el.getAttribute('contenteditable');
  if (role === 'textbox' || (ce !== null && ce !== 'false')) return 'long';
  return null;
}

function collect(root: ParentNode): Ctl[] {
  const out: Ctl[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CONTROL_SEL)) {
    const k = classify(el);
    if (!k) continue;
    // Radios and checkboxes are often visually hidden behind a styled label; text-like controls are not.
    if (k !== 'radio' && k !== 'check' && !isVisible(el)) continue;
    out.push({ el, k });
  }
  return out;
}

// ---- labels ---------------------------------------------------------------------------------------

function byIds(ids: string | null): string {
  if (!ids) return '';
  return clean(ids.split(/\s+/).map((id) => readText(document.getElementById(id))).join(' '));
}

/** Accessible label of a control: aria-labelledby, aria-label, <label for>, wrapping <label>. */
export function labelOf(el: HTMLElement): string {
  const viaRef = byIds(el.getAttribute('aria-labelledby'));
  if (viaRef) return viaRef;
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const t = clean([...labels].map((l) => readText(l)).join(' '));
    if (t) return t;
  }
  return readText(el.closest('label'));
}

/** Bare text following a control, up to the next control or line break: `<input type=radio> Paris<br>`. */
function siblingText(el: HTMLElement): string {
  let out = '';
  for (let n = el.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.tagName === 'BR' || hasControl(e)) break;
      out += ' ' + readText(e);
    }
    if (out.length > 300) break;
  }
  return clean(out);
}

/** For a control inside a table cell: the header text of its column. */
function columnHeader(el: HTMLElement): string {
  const cell = el.closest('td,th') as HTMLTableCellElement | null;
  const table = cell?.closest('table');
  if (!cell || !table) return '';
  const head = table.querySelector('tr');
  if (!head || head === cell.parentElement) return '';
  return readText(head.children[cell.cellIndex]);
}

function optionLabel(el: HTMLElement, own = false): string {
  const direct = labelOf(el) || readText(el) || siblingText(el);
  if (direct || own) return direct;
  const value = el.getAttribute('data-value') ?? el.getAttribute('value') ?? '';
  return columnHeader(el) || (value && value !== 'on' ? clean(value) : '');
}

/** Elements holding an option's label, so they can be left out of the question text. */
function labelEls(el: HTMLElement): Element[] {
  const out: Element[] = [el];
  const labels = (el as HTMLInputElement).labels;
  if (labels) out.push(...labels);
  const wrap = el.closest('label');
  if (wrap) out.push(wrap);
  for (const id of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
    const ref = id && document.getElementById(id);
    if (ref) out.push(ref);
  }
  return out;
}

// ---- grouping controls into questions ---------------------------------------------------------------

const formIds = new WeakMap<Element, number>();
let nextFormId = 1;
function nameKey(el: HTMLElement): string | null {
  const i = el as HTMLInputElement;
  if (el.tagName !== 'INPUT' || !i.name) return null;
  let id = 0;
  if (i.form) {
    id = formIds.get(i.form) ?? nextFormId++;
    formIds.set(i.form, id);
  }
  return `${i.name}|${id}`;
}

/** The element that scopes a group of same-kind controls when they share no `name`. */
function groupRoot(c: Ctl, all: Ctl[]): Element {
  const scoped = c.el.closest(c.k === 'radio' ? '[role=radiogroup],fieldset,[role=group]' : '[role=group],fieldset');
  if (scoped) return scoped;
  let p = c.el.parentElement;
  for (let i = 0; p && i < 6; i++, p = p.parentElement) {
    if (all.filter((o) => o.k === c.k && p!.contains(o.el)).length >= 2) return p;
  }
  return c.el.parentElement ?? c.el;
}

/** For an inline text input, the element whose own text surrounds it (a sentence with blanks). */
function clozeRoot(el: HTMLElement): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if ([...p.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent).length > 1)) return p;
    if (!INLINE.has(p.tagName)) return null;
  }
  return null;
}

function genericUnits(all: Ctl[]): Unit[] {
  const units: Unit[] = [];
  const group = (k: CK): Ctl[][] => {
    const map = new Map<unknown, Ctl[]>();
    for (const c of all) {
      if (c.k !== k) continue;
      const key = nameKey(c.el) ?? groupRoot(c, all);
      const g = map.get(key);
      if (g) g.push(c);
      else map.set(key, [c]);
    }
    return [...map.values()];
  };

  // Radio rows in a table with no labels of their own form a matching grid (labels are the column headers).
  const tables = new Map<Element, Ctl[][]>();
  for (const g of group('radio')) {
    const table = g[0].el.closest('table');
    if (table && g.every((c) => table.contains(c.el) && !optionLabel(c.el, true))) {
      const rows = tables.get(table);
      if (rows) rows.push(g);
      else tables.set(table, [g]);
    } else units.push({ ctls: g });
  }
  for (const rows of tables.values()) {
    if (rows.length === 1) units.push({ ctls: rows[0] });
    else units.push({ ctls: rows.flat(), grid: rows.map((r) => r.map((c) => c.el)) });
  }

  // A lone checkbox is a consent tick, not a question.
  for (const g of group('check')) if (g.length >= 2) units.push({ ctls: g });

  const clozes = new Map<Element, Ctl[]>();
  for (const c of all) {
    if (c.k === 'text') {
      const root = clozeRoot(c.el);
      if (root) {
        const g = clozes.get(root);
        if (g) g.push(c);
        else clozes.set(root, [c]);
      } else units.push({ ctls: [c] });
    } else if (c.k === 'long' || c.k === 'select' || c.k === 'listbox') units.push({ ctls: [c] });
  }
  for (const [root, g] of clozes) {
    if (g.length >= 2) units.push({ ctls: g, cloze: root });
    else units.push({ ctls: g });
  }
  return units;
}

/** Widest ancestor that still belongs to this question alone. */
function blockOf(els: HTMLElement[], others: HTMLElement[]): Element {
  let b = lca(els);
  for (let p = b.parentElement; p && !p.matches(STOP_CLIMB); p = p.parentElement) {
    if ((p.textContent?.length ?? 0) > 2500 || others.some((o) => p!.contains(o))) break;
    b = p;
  }
  return b;
}

// ---- building a question from a block -----------------------------------------------------------------

const numbered = (labels: string[]): Choice[] => labels.map((label, i) => ({ id: i + 1, label: label || `(option ${i + 1})` }));

function images(block: Element, options: HTMLElement[]): { images: QImage[]; needsShot: boolean } {
  const out: QImage[] = [];
  let needsShot = false;
  const optionOf = (img: Element): number =>
    options.findIndex((o) => labelEls(o).some((l) => l.contains(img)) || o.nextElementSibling === img);
  for (const img of block.querySelectorAll('img')) {
    const url = img.currentSrc || img.src;
    if (!url) continue;
    if (hasLayout() && (img.width < 32 || img.height < 32)) continue; // icons and spacers
    if (url.startsWith('blob:')) needsShot = true;
    else if (out.length < 5) {
      const o = optionOf(img);
      out.push({ url, caption: o >= 0 ? `Image for option ${o + 1}:` : 'Figure for the question:' });
    }
  }
  for (const fig of block.querySelectorAll('canvas,svg')) {
    const r = fig.getBoundingClientRect();
    if (r.width >= 80 && r.height >= 60) needsShot = true;
  }
  return { images: out, needsShot };
}

function build(block: Element, ctls: Ctl[], adapter: Adapter | undefined, unit: Unit = { ctls }): Detected | null {
  const of = (k: CK): HTMLElement[] => ctls.filter((c) => c.k === k).map((c) => c.el);
  const radios = of('radio');
  const checks = of('check');
  let target: Target;
  let kind: Question['kind'];
  let options: string[] | undefined;
  let rows: string[] | undefined;
  let optionEls: HTMLElement[] = [];
  const markers = new Map<Element, string>();
  let inputHint: string | undefined;

  // ARIA radiogroups inside one adapter block (e.g. a Google Forms grid) are rows of a matching question.
  let grid = unit.grid;
  if (!grid && radios.length) {
    const groups = new Map<Element | null, HTMLElement[]>();
    for (const r of radios) {
      const g = r.closest('[role=radiogroup]');
      groups.set(g, [...(groups.get(g) ?? []), r]);
    }
    if (groups.size >= 2 && !groups.has(null)) grid = [...groups.values()];
  }

  if (grid) {
    kind = 'matching';
    target = { t: 'grid', rows: grid };
    optionEls = grid.flat();
    options = grid[0].map((el) => clean(el.getAttribute('data-value')) || optionLabel(el));
    rows = grid.map((row) => {
      const g = row[0].closest('[role=radiogroup]') as HTMLElement | null;
      const tr = row[0].closest('tr');
      return (g && labelOf(g)) || readText(tr?.querySelector('th,td')) || '';
    });
  } else if (radios.length || checks.length) {
    optionEls = radios.length ? radios : checks;
    kind = radios.length ? 'single' : 'multi';
    target = { t: 'choice', els: optionEls, multi: !radios.length };
    options = optionEls.map((el) => optionLabel(el));
    const rowOf = (el: HTMLElement): string => clean(el.closest('[role=group][aria-label]')?.getAttribute('aria-label'));
    if (!radios.length && new Set(optionEls.map(rowOf)).size >= 2 && optionEls.every((el) => rowOf(el) && el.getAttribute('data-answer-value'))) {
      options = optionEls.map((el) => `${rowOf(el)}: ${clean(el.getAttribute('data-answer-value'))}`);
    }
  } else if (of('select').length) {
    const el = of('select')[0] as HTMLSelectElement;
    const opts = [...el.options].filter((o, i) => !o.disabled && !(i === 0 && o.value === ''));
    kind = 'dropdown';
    target = { t: 'select', el, opts };
    options = opts.map((o) => clean(o.textContent));
  } else if (of('listbox').length) {
    const el = of('listbox')[0];
    const seen = new Set<string>();
    for (const o of el.querySelectorAll<HTMLElement>('[role=option]')) {
      const label = readText(o) || clean(o.getAttribute('data-value'));
      if (label && o.getAttribute('data-value') !== '' && o.getAttribute('aria-disabled') !== 'true') seen.add(label);
    }
    kind = 'dropdown';
    options = [...seen];
    target = { t: 'listbox', el, labels: options };
  } else if (of('text').length >= 2 && (unit.cloze || adapter)) {
    kind = 'blanks';
    target = { t: 'text', els: of('text') };
    of('text').forEach((el, i) => markers.set(el, `[${i + 1}]`));
  } else {
    const el = of('text')[0] ?? of('long')[0];
    if (!el) return null;
    kind = el.tagName === 'INPUT' ? 'text' : 'longtext';
    target = { t: 'text', els: [el] };
    const inputType = (el as HTMLInputElement).type;
    if (['number', 'date', 'time', 'datetime-local', 'month'].includes(inputType)) inputHint = inputType;
  }
  if (options && options.length < (kind === 'dropdown' ? 1 : 2) && kind !== 'matching') return null;

  // Question text: adapter, then the block's own text minus the option labels, then nearby fallbacks.
  const exclude = new Set<Element>(optionEls.flatMap(labelEls));
  const table = grid && optionEls[0].closest('table'); // row and column headers are sent as lists already
  if (table) exclude.add(table);
  const first = ctls[0].el;
  let prompt = adapter?.prompt?.(block) ?? '';
  if (!prompt) prompt = readText(unit.cloze ?? block, { exclude, labelled: new Set(optionEls), markers });
  if (prompt.length < 3 && target.t !== 'choice' && target.t !== 'grid') prompt = labelOf(first);
  // Text just before the block beats the group's own label, which is often generic ("Select one answer").
  if (prompt.length < 3 || (markers.size && prompt.length < 60)) {
    prompt = clean(`${precedingText(block, hasControl)} ${prompt}`);
  }
  if (prompt.length < 3) {
    const g = first.closest('[role=radiogroup],[role=group],fieldset') as HTMLElement | null;
    prompt = (g && labelOf(g)) || prompt;
  }
  if (prompt.length < 3) prompt = clean(first.getAttribute('placeholder') ?? first.getAttribute('title'));
  if (!prompt) return null;
  if (kind === 'blanks' && !unit.cloze) {
    prompt += ` Fields: ${of('text').map((el, i) => `[${i + 1}] ${labelOf(el) || 'answer'}`).join(', ')}`;
  }

  const figs = images(block, optionEls);
  const question: Question = {
    kind,
    prompt,
    site: adapter?.name ?? 'generic',
    ...(options && { options: numbered(options) }),
    ...(rows && { rows: numbered(rows) }),
    ...(kind === 'blanks' && { blanks: markers.size }),
    ...(inputHint && { inputHint }),
    ...(figs.images.length && { images: figs.images }),
    ...(figs.needsShot && { needsShot: true }),
  };
  return { block, question, target };
}

// ---- choosing the current question --------------------------------------------------------------------

export function isChecked(el: HTMLElement): boolean {
  if (el.tagName === 'INPUT') return (el as HTMLInputElement).checked;
  return ['aria-checked', 'aria-pressed', 'aria-selected'].some((a) => el.getAttribute(a) === 'true');
}

export function isAnswered(d: Detected): boolean {
  if (handled.get(d.block) === fingerprint(d)) return true;
  const t = d.target;
  switch (t.t) {
    case 'choice':
      return t.els.some(isChecked);
    case 'grid':
      return t.rows.every((r) => r.some(isChecked));
    case 'text':
      return t.els.every((el) => clean('value' in el ? (el as HTMLInputElement).value : el.textContent) !== '');
    case 'select':
      return t.opts.includes(t.el.selectedOptions[0]);
    case 'listbox': {
      const sel = t.el.querySelector('[role=option][aria-selected=true]');
      return !!sel && sel.getAttribute('data-value') !== '' && t.labels.includes(readText(sel));
    }
  }
}

/** Every question on the page, in document order. */
export function detectAll(root: ParentNode = document, adapter = pickAdapter()): Detected[] {
  const all = collect(root);
  let found: Detected[] = [];
  if (adapter?.blocks) {
    for (const block of adapter.blocks(root)) {
      const ctls = all.filter((c) => block.contains(c.el) && !adapter.skip?.(c.el));
      const d = ctls.length ? build(block, ctls, adapter) : null;
      if (d) found.push(d);
    }
  }
  if (!found.length) {
    const els = all.map((c) => c.el);
    for (const unit of genericUnits(all)) {
      const mine = new Set(unit.ctls.map((c) => c.el));
      const others = els.filter((e) => !mine.has(e));
      let block = blockOf([...mine], others);
      // Flat markup (questions share one container): anchor on the first control instead, so the
      // question text is read from what precedes it rather than from the shared container.
      if (others.some((o) => block.contains(o))) block = unit.cloze ?? unit.ctls[0].el.closest('label') ?? unit.ctls[0].el;
      const d = build(block, unit.ctls, adapter, unit);
      if (d) found.push(d);
    }
  }
  // Plain buttons are only read as answer choices on pages with no real answer controls at all.
  // (Once a Socrative answer is submitted its options are disabled; the image's zoom buttons
  // must not then be mistaken for a question.)
  const hasAnswerControls = !!root.querySelector('[role=radio],[role=checkbox],input[type=radio],input[type=checkbox]');
  if (!found.length && !hasAnswerControls) {
    const d = buttonChoices(root, adapter?.name ?? 'generic');
    if (d) found.push(d);
  }
  return found
    .filter((d) => isVisible(d.block) && !PERSONAL_PROMPT.test(d.question.prompt))
    .sort((a, b) => (a.block.compareDocumentPosition(b.block) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * The one question to answer now: the unanswered question holding keyboard focus, else the first
 * unanswered one on screen, else the first unanswered one on the page.
 */
export function detectCurrent(root: ParentNode = document, adapter = pickAdapter()): { d: Detected; score: number } | null {
  const open = detectAll(root, adapter).filter((d) => !isAnswered(d));
  const focus = document.activeElement;
  const focused = focus && focus !== document.body ? open.find((d) => d.block.contains(focus)) : undefined;
  const d = focused ?? open.find((q) => inView(q.block)) ?? open[0];
  if (!d) return null;
  return { d, score: 1 + (inView(d.block) ? 2 : 0) + (focused ? 4 : 0) };
}
