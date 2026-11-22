import type { Adapter } from './index';

/**
 * Socrative's student view shows one question at a time and uses buttons for answer choices rather
 * than form controls, so it is served by the generic button-choice detector (see buttons.ts).
 * This adapter is the place for Socrative-specific selectors once they are confirmed on a live room.
 */
export const socrative: Adapter = {
  name: 'socrative',
  match: (host) => host.endsWith('socrative.com'),
};
