// Small DOM helpers. Everything here must also work in jsdom (no layout, no innerText).

export const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OPTION', 'TEMPLATE']);
const INLINE_TAGS = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'SUB', 'SUP', 'A', 'U', 'CODE', 'SMALL', 'MARK', 'FONT', 'LABEL']);

export interface ReadOpts {
  /** Subtrees to leave out (e.g. option labels when reading the question text). */
  exclude?: Set<Element>;
  /** Bare text directly after one of these elements is treated as its label and left out. */
  labelled?: Set<Element>;
  /** Elements replaced by a marker such as "[1]" (fill-in-the-blank inputs). */
  markers?: Map<Element, string>;
  cap?: number;
}

/** Readable text of a subtree, with spaces between block elements but not inside "H<sub>2</sub>O". */
export function readText(root: Element | null | undefined, opts: ReadOpts = {}): string {
  if (!root) return '';
  const cap = opts.cap ?? 2000;
  let out = '';
  const walk = (n: Node): void => {
    if (out.length > cap) return;
    if (n.nodeType === 3) {
      if (opts.labelled) {
        let prev = n.previousSibling;
        while (prev && prev.nodeType === 3 && !clean(prev.textContent)) prev = prev.previousSibling;
        if (prev && opts.labelled.has(prev as Element)) return;
      }
      out += n.textContent;
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    const marker = opts.markers?.get(e);
    if (marker) {
      out += ` ${marker} `;
      return;
    }
    if (opts.exclude?.has(e) || e.hidden) return;
    // Buttons inside a block are controls, not question text - but a button read on its own
    // (an answer choice such as <button role="radio">) is read for its label.
    if (SKIP_TAGS.has(e.tagName) && !(e.tagName === 'BUTTON' && e === root)) return;
    const role = e.getAttribute('role');
    if (e !== root && (role === 'option' || role === 'listbox')) return;
    if (e.tagName === 'IMG') out += ` ${e.getAttribute('alt') ?? ''} `;
    const block = !INLINE_TAGS.has(e.tagName);
    if (block) out += ' ';
    for (const c of e.childNodes) walk(c);
    if (block) out += ' ';
  };
  walk(root);
  return clean(out).slice(0, cap);
}

/** True when the browser actually lays out the page (false in jsdom). */
export function hasLayout(): boolean {
  return document.documentElement.getBoundingClientRect().width > 0;
}

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const check = (el as any).checkVisibility;
  if (typeof check === 'function') return check.call(el, { checkVisibilityCSS: true, visibilityProperty: true });
  for (let e: Element | null = el; e; e = e.parentElement) {
    if ((e as HTMLElement).hidden) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

export function inView(el: Element): boolean {
  if (!hasLayout()) return true;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
}

/** Lowest common ancestor (the element itself for a single element). */
export function lca(els: Element[]): Element {
  let a: Element | null = els[0];
  while (a && !els.every((e) => a!.contains(e))) a = a.parentElement;
  return a ?? document.body;
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Text that sits just before `start` in the page: walks back through earlier siblings (climbing a few
 * levels if needed) and stops at the first element holding another form control, so it never reads a
 * neighbouring question.
 */
export function precedingText(start: Element, hasControl: (e: Element) => boolean): string {
  let node: Element | null = start;
  for (let depth = 0; node && depth < 5 && !node.matches('body,html'); depth++, node = node.parentElement) {
    const parts: string[] = [];
    let bare = 0; // trailing parts that came from bare text nodes
    let len = 0;
    for (let sib = node.previousSibling; sib && parts.length < 4 && len < 1200; sib = sib.previousSibling) {
      let t = '';
      const isText = sib.nodeType === 3;
      if (isText) t = clean(sib.textContent);
      else if (sib.nodeType === 1) {
        const e = sib as Element;
        // Bare text directly after a control is that control's label, not question text.
        if (hasControl(e)) return parts.slice(0, parts.length - bare).reverse().join(' ');
        t = readText(e, { cap: 1200 });
      }
      if (t) {
        parts.push(t);
        len += t.length;
        bare = isText ? bare + 1 : 0;
      }
    }
    if (parts.length) return parts.reverse().join(' ');
  }
  return '';
}
