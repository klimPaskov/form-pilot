import type { Question } from '../shared/types';

/** Where an answer goes. Arrays are parallel to the 1-based ids in the Question. */
export type Target =
  | { t: 'choice'; els: HTMLElement[]; multi: boolean }
  | { t: 'text'; els: HTMLElement[] }
  | { t: 'select'; el: HTMLSelectElement; opts: HTMLOptionElement[] }
  | { t: 'listbox'; el: HTMLElement; labels: string[] }
  | { t: 'grid'; rows: HTMLElement[][] };

/** A question found on the page, with the live elements needed to fill it in. */
export interface Detected {
  block: Element;
  question: Question;
  target: Target;
}
