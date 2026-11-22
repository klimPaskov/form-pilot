import { googleForms } from './google-forms';
import { socrative } from './socrative';

/**
 * A site adapter refines the universal detector for one platform. Every hook is optional: a site
 * with ordinary markup needs no adapter at all.
 */
export interface Adapter {
  name: string;
  match(host: string, path: string): boolean;
  /** One element per question. When given, the detector does not guess block boundaries. */
  blocks?(root: ParentNode): Element[];
  /** The question text of a block. */
  prompt?(block: Element): string;
  /** Controls that are not answers (e.g. the "Other" free-text option). */
  skip?(el: HTMLElement): boolean;
}

const ADAPTERS: Adapter[] = [googleForms, socrative];

export function pickAdapter(loc: { hostname: string; pathname: string } = location): Adapter | undefined {
  return ADAPTERS.find((a) => a.match(loc.hostname, loc.pathname));
}
