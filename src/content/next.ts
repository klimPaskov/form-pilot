// Finds the "next page" control of a multi-page form. It must never return a submit control:
// submitting is always left to the user.

import type { Adapter } from './adapters';
import { isVisible, readText } from './dom';

const NEXT = /^(next|continue|next page|next question|next section)\s*[>›→»]?$/i;
const SUBMIT = /submit|finish|send|done|complete|turn in|hand in|end (quiz|test|exam)/i;

export function findNext(root: ParentNode, adapter: Adapter | undefined): HTMLElement | null {
  if (adapter?.next) return adapter.next(root);
  for (const el of root.querySelectorAll<HTMLElement>('button,[role=button],input[type=button],a')) {
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || !isVisible(el)) continue;
    const text = readText(el, { keepButtons: true, cap: 60 }) || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '';
    if (NEXT.test(text.trim()) && !SUBMIT.test(text)) return el;
  }
  return null;
}
