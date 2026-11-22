// Development harness: the page module plus the multi-question runner, wired to placeholder answers
// instead of Claude. Lets the fill-page / fill-form logic be exercised on a live page from the
// console without the extension:  npx esbuild scripts/harness.ts --bundle --outfile=dist/harness.js

import '../src/content/index';
import { fillPage, summary, type Ask, type PageDriver, type RunReport } from '../src/background/runner';
import type { PageApi } from '../src/content/index';

const page = (globalThis as unknown as { __formPilot: PageApi }).__formPilot;

const driver: PageDriver = {
  list: async () => {
    const questions = page.list();
    return questions.length ? [{ frameId: 0, questions }] : [];
  },
  images: async () => [],
  applyAt: async (_f, i, a) => page.applyAt(i, a),
  skipAt: async (_f, i) => page.skipAt(i),
  next: async () => page.next(),
  signature: async () => page.signature(),
  settle: async () => {},
};

/** Placeholder answers: first option(s), first column for every row, fixed text. */
const ask: Ask = async (q) => {
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 150)); // answers arrive out of order, like real calls
  const base = { answerable: true, confidence: 'high' as const };
  if (q.kind === 'matching') return { ...base, pairs: q.rows!.map((r) => ({ row: r.id, option: 1 })) };
  if (q.kind === 'multi') return { ...base, choices: [1, 2] };
  if (q.options) return { ...base, choices: [1] };
  return { ...base, texts: q.kind === 'blanks' ? Array(q.blanks).fill('7') : ['placeholder answer'] };
};

(globalThis as unknown as { __fpHarness: unknown }).__fpHarness = {
  async fillPage(): Promise<{ report: RunReport; text: string; questions: string[] }> {
    const questions = page.list().map((q) => `${q.kind}: ${q.prompt.slice(0, 60)}`);
    const report: RunReport = { filled: 0, skipped: 0, failed: 0, pages: 1 };
    await fillPage(driver, ask, { cancelled: () => false, progress: () => {} }, report);
    return { report, text: summary(report, false), questions };
  },
  next: () => page.next(),
  signature: () => page.signature(),
};
