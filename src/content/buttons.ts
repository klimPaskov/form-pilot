// Fallback for quiz UIs that use plain buttons as answer choices (no radios or checkboxes).

import { inView, isVisible, precedingText, readText } from './dom';
import type { Detected } from './types';

// Buttons that navigate or submit are never answer choices - and must never be clicked.
const NOT_A_CHOICE =
  /^(submit|next|back|prev|continue|skip|finish|done|cancel|close|save|send|ok|log ?in|log ?out|sign|menu|clear|reset|start|hint|check|help|share|settings|more)/i;
const SEL = 'button,[role=button],[role=option],[role=menuitemradio]';
const label = (b: HTMLElement): string =>
  readText(b, { keepButtons: true, cap: 300 }) || (b.getAttribute('aria-label') ?? '').trim();

export function buttonChoices(root: ParentNode, site: string): Detected | null {
  const groups = new Map<Element, HTMLElement[]>();
  for (const b of root.querySelectorAll<HTMLElement>(SEL)) {
    if ((b as HTMLButtonElement).disabled || b.closest('nav,header,footer,[data-form-pilot]') || !isVisible(b)) continue;
    const text = label(b);
    if (!text || NOT_A_CHOICE.test(text)) continue;
    // Choices are siblings, or each sits alone in a sibling wrapper.
    let parent = b.parentElement;
    if (parent && parent.querySelectorAll(SEL).length === 1) parent = parent.parentElement;
    if (!parent) continue;
    groups.set(parent, [...(groups.get(parent) ?? []), b]);
  }
  const candidates = [...groups].filter(([, els]) => els.length >= 2 && els.length <= 10);
  const [block, els] = candidates.find(([g]) => inView(g)) ?? candidates[0] ?? [];
  if (!block || !els) return null;
  const prompt = precedingText(block, (e) => e.matches(SEL) || !!e.querySelector(SEL));
  if (prompt.length < 3) return null; // buttons with no question text above them are not a quiz
  return {
    block,
    question: { kind: 'single', prompt, site, options: els.map((b, i) => ({ id: i + 1, label: label(b) })) },
    target: { t: 'choice', els, multi: false },
  };
}
