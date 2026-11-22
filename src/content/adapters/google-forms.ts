import { clean, readText } from '../dom';
import type { Adapter } from './index';

/**
 * Google Forms renders every question as a role=listitem containing a role=heading, with ARIA
 * radios / checkboxes / listboxes inside. The universal ARIA handling does the rest.
 */
export const googleForms: Adapter = {
  name: 'google-forms',
  match: (host, path) => host === 'docs.google.com' && path.startsWith('/forms'),
  blocks: (root) =>
    [...root.querySelectorAll('[role=listitem]')].filter(
      (b) => b.querySelector('[role=heading]') && !b.parentElement?.closest('[role=listitem]'),
    ),
  // The title is the heading; the optional description (often the actual question) is its next sibling.
  prompt: (block) => {
    const heading = block.querySelector('[role=heading]');
    const title = readText(heading).replace(/\s*\*$/, '');
    const next = heading?.nextElementSibling;
    const isDescription = next && !next.querySelector('input,textarea,[role=radio],[role=checkbox],[role=listbox]');
    return clean(`${title} ${isDescription ? readText(next) : ''}`);
  },
  skip: (el) =>
    el.getAttribute('data-value') === '__other_option__' ||
    el.getAttribute('data-answer-value') === '__other_option__' ||
    /^other/i.test(el.getAttribute('aria-label') ?? ''),
};
