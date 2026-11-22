// Answer mapping: checks the model's answer against the detected question and turns it into
// concrete element interactions.

import type { Answer, ApplyResult, Choice } from '../shared/types';
import { isChecked, markHandled } from './detect';
import { clean, wait } from './dom';
import { click, setListbox, setSelect, setText } from './fill';
import type { Detected } from './types';

const norm = (s: string): string => clean(s).toLowerCase().replace(/[.,;:!?"'()]/g, '');

/** Falls back to matching by text when the model answered with option text instead of numbers. */
function idsByText(options: Choice[], texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) {
    const n = norm(t);
    const hit = options.find((o) => norm(o.label) === n) ?? options.find((o) => n && norm(o.label).includes(n));
    if (hit) out.push(hit.id);
  }
  return out;
}

function chosen(d: Detected, a: Answer): number[] {
  const options = d.question.options ?? [];
  let ids = (a.choices ?? []).filter((id) => Number.isInteger(id) && id >= 1 && id <= options.length);
  if (!ids.length && a.texts?.length) ids = idsByText(options, a.texts);
  return [...new Set(ids)];
}

const fail = (message: string): ApplyResult => ({ ok: false, message });

export async function applyAnswer(d: Detected, a: Answer): Promise<ApplyResult> {
  const t = d.target;
  const options = d.question.options ?? [];
  const labels = (ids: number[]): string => ids.map((id) => options[id - 1].label).join('; ');
  let message: string;

  switch (t.t) {
    case 'choice': {
      const ids = chosen(d, a);
      if (!ids.length) return fail('The answer did not match any option');
      const want = new Set(t.multi ? ids : ids.slice(0, 1));
      for (let i = 0; i < t.els.length; i++) {
        const on = want.has(i + 1);
        // Radios only need the chosen one clicked; checkboxes are set to exactly the chosen set.
        if (isChecked(t.els[i]) !== on && (on || t.multi)) {
          click(t.els[i]);
          await wait(40); // let the page re-render between clicks
        }
      }
      message = labels([...want]);
      break;
    }
    case 'select':
    case 'listbox': {
      const id = chosen(d, a)[0];
      if (!id) return fail('The answer did not match any option');
      if (t.t === 'select') setSelect(t.el, t.opts[id - 1]);
      else if (!(await setListbox(t.el, t.labels[id - 1]))) return fail('Could not open the dropdown');
      message = labels([id]);
      break;
    }
    case 'grid': {
      const pairs = (a.pairs ?? []).filter((p) => t.rows[p.row - 1]?.[p.option - 1]);
      if (!pairs.length) return fail('The answer did not match the grid');
      for (const p of pairs) {
        const el = t.rows[p.row - 1][p.option - 1];
        if (!isChecked(el)) {
          click(el);
          await wait(40);
        }
      }
      message = `${pairs.length} of ${t.rows.length} rows matched`;
      break;
    }
    case 'text': {
      const texts = (a.texts ?? []).map((s) => s.trim());
      if (!texts.some(Boolean)) return fail('The answer was empty');
      t.els.forEach((el, i) => texts[i] && setText(el, texts[i]));
      message = texts.slice(0, t.els.length).join(' | ');
      break;
    }
  }
  markHandled(d);
  return { ok: true, message: message.length > 160 ? `${message.slice(0, 157)}...` : message };
}
