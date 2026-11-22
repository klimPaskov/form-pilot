import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAnswer } from '../src/content/apply';
import { detectCurrent } from '../src/content/detect';

const base = { answerable: true, confidence: 'high' as const };
const page = (html: string): void => void (document.body.innerHTML = html);
const current = () => detectCurrent(document, undefined)!.d;

beforeEach(() => page(''));

describe('answer insertion', () => {
  it('selects the chosen radio and fires a change event', async () => {
    page(`<fieldset><legend>Pick one</legend>
      <label><input type="radio" name="q" value="a"> A</label><label><input type="radio" name="q" value="b"> B</label></fieldset>`);
    const onChange = vi.fn();
    document.addEventListener('change', onChange);
    const res = await applyAnswer(current(), { ...base, choices: [2] });
    expect(res).toEqual({ ok: true, message: 'B' });
    expect(document.querySelector<HTMLInputElement>('[value=b]')!.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('sets checkboxes to exactly the chosen set', async () => {
    page(`<div><p>Primes?</p><label><input type="checkbox" name="p" checked> 4</label>
      <label><input type="checkbox" name="p"> 5</label><label><input type="checkbox" name="p"> 7</label></div>`);
    const d = detectCurrent(document, undefined);
    expect(d).toBeNull(); // already has a tick, so it counts as answered
    page(`<div><p>Primes?</p><label><input type="checkbox" name="p"> 4</label>
      <label><input type="checkbox" name="p"> 5</label><label><input type="checkbox" name="p"> 7</label></div>`);
    await applyAnswer(current(), { ...base, choices: [2, 3] });
    expect([...document.querySelectorAll<HTMLInputElement>('input')].map((i) => i.checked)).toEqual([false, true, true]);
  });

  it('types text through the native setter so framework-controlled inputs update', async () => {
    page(`<label for="t">Symbol for gold</label><input id="t" type="text" maxlength="2">`);
    const input = document.querySelector<HTMLInputElement>('#t')!;
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    await applyAnswer(current(), { ...base, texts: ['Au!'] });
    expect(seen).toEqual(['Au']); // respects maxlength
  });

  it('chooses a dropdown option and accepts option text instead of a number', async () => {
    page(`<label for="s">Largest planet</label>
      <select id="s"><option value="">Choose</option><option value="m">Mars</option><option value="j">Jupiter</option></select>`);
    await applyAnswer(current(), { ...base, texts: ['jupiter.'] });
    expect(document.querySelector<HTMLSelectElement>('#s')!.value).toBe('j');
  });

  it('fills every blank and every matching row', async () => {
    page(`<p>Water is <input type="text"> and salt is <input type="text">.</p>`);
    await applyAnswer(current(), { ...base, texts: ['H2O', 'NaCl'] });
    expect([...document.querySelectorAll('input')].map((i) => i.value)).toEqual(['H2O', 'NaCl']);

    page(`<p>Match.</p><table><tr><th></th><th>Mammal</th><th>Bird</th></tr>
      <tr><td>Eagle</td><td><input type="radio" name="r1"></td><td><input type="radio" name="r1"></td></tr>
      <tr><td>Whale</td><td><input type="radio" name="r2"></td><td><input type="radio" name="r2"></td></tr></table>`);
    await applyAnswer(current(), { ...base, pairs: [{ row: 1, option: 2 }, { row: 2, option: 1 }] });
    expect([...document.querySelectorAll('input')].map((i) => i.checked)).toEqual([false, true, true, false]);
  });

  it('rejects an answer that matches nothing and leaves the page untouched', async () => {
    page(`<fieldset><legend>Pick</legend><label><input type="radio" name="q"> A</label>
      <label><input type="radio" name="q"> B</label></fieldset>`);
    const res = await applyAnswer(current(), { ...base, choices: [9] });
    expect(res.ok).toBe(false);
    expect(document.querySelectorAll('input:checked').length).toBe(0);
  });

  it('never clicks a submit button', async () => {
    page(`<form><fieldset><legend>Pick</legend><label><input type="radio" name="q"> A</label>
      <label><input type="radio" name="q"> B</label></fieldset><button type="submit">Submit</button></form>`);
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('form')!.addEventListener('submit', onSubmit);
    await applyAnswer(current(), { ...base, choices: [1] });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
