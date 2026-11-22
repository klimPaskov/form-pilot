import { beforeEach, describe, expect, it } from 'vitest';
import { googleForms } from '../src/content/adapters/google-forms';
import { applyAnswer } from '../src/content/apply';
import { detectAll, detectCurrent } from '../src/content/detect';

const page = (html: string): void => void (document.body.innerHTML = html);
const current = (adapter?: typeof googleForms) => detectCurrent(document, adapter)!.d;

beforeEach(() => page(''));

describe('standard HTML forms', () => {
  it('reads a radio question from a fieldset', () => {
    page(`<form><fieldset><legend>Capital of France?</legend>
      <label><input type="radio" name="q1" value="a"> Berlin</label>
      <label><input type="radio" name="q1" value="b"> Paris</label></fieldset></form>`);
    const q = current().question;
    expect(q.kind).toBe('single');
    expect(q.prompt).toBe('Capital of France?');
    expect(q.options).toEqual([{ id: 1, label: 'Berlin' }, { id: 2, label: 'Paris' }]);
  });

  it('keeps flat questions apart and reads bare text labels', () => {
    page(`<form><p>Is the sky blue?</p>
      <input type="radio" name="a" value="t"> True<br><input type="radio" name="a" value="f"> False<br>
      <p>Is grass red?</p>
      <input type="radio" name="b" value="t"> True<br><input type="radio" name="b" value="f"> False<br></form>`);
    const all = detectAll(document, undefined);
    expect(all.map((d) => d.question.prompt)).toEqual(['Is the sky blue?', 'Is grass red?']);
    expect(all[1].question.options!.map((o) => o.label)).toEqual(['True', 'False']);
  });

  it('detects checkboxes, selects, short and long text', () => {
    page(`<div class="q"><h3>Pick the primes</h3>
        <label><input type="checkbox" name="p"> 2</label><label><input type="checkbox" name="p"> 4</label>
        <label><input type="checkbox" name="p"> 5</label></div>
      <div class="q"><label for="s">Largest planet</label>
        <select id="s"><option value="">Choose</option><option>Mars</option><option>Jupiter</option></select></div>
      <div class="q"><label for="t">Chemical symbol for gold</label><input id="t" type="text"></div>
      <div class="q"><p>Explain photosynthesis.</p><textarea></textarea></div>`);
    const all = detectAll(document, undefined);
    expect(all.map((d) => d.question.kind)).toEqual(['multi', 'dropdown', 'text', 'longtext']);
    expect(all.map((d) => d.question.prompt)).toEqual([
      'Pick the primes',
      'Largest planet',
      'Chemical symbol for gold',
      'Explain photosynthesis.',
    ]);
    expect(all[1].question.options!.map((o) => o.label)).toEqual(['Mars', 'Jupiter']);
  });

  it('turns inline inputs into one fill-in-the-blank question', () => {
    page(`<p>The capital of France is <input type="text"> and of Spain is <input type="text">.</p>`);
    const q = current().question;
    expect(q.kind).toBe('blanks');
    expect(q.blanks).toBe(2);
    expect(q.prompt).toBe('The capital of France is [1] and of Spain is [2] .');
  });

  it('reads a radio table as a matching grid', () => {
    page(`<p>Match each animal to its class.</p><table>
      <tr><th></th><th>Mammal</th><th>Bird</th></tr>
      <tr><td>Eagle</td><td><input type="radio" name="r1"></td><td><input type="radio" name="r1"></td></tr>
      <tr><td>Whale</td><td><input type="radio" name="r2"></td><td><input type="radio" name="r2"></td></tr></table>`);
    const q = current().question;
    expect(q.kind).toBe('matching');
    expect(q.prompt).toBe('Match each animal to its class.');
    expect(q.rows!.map((r) => r.label)).toEqual(['Eagle', 'Whale']);
    expect(q.options!.map((o) => o.label)).toEqual(['Mammal', 'Bird']);
  });

  it('ignores personal fields, lone checkboxes and non-answer inputs', () => {
    page(`<label>Name <input type="text"></label><input type="email"><input type="password">
      <label><input type="checkbox"> I agree</label><input type="text" autocomplete="email">`);
    expect(detectCurrent(document, undefined)).toBeNull();
  });

  it('attaches figures to the question', () => {
    page(`<div class="q"><p>What shape is this?</p><img src="https://example.com/shape.png">
      <label><input type="radio" name="s"> Circle</label><label><input type="radio" name="s"> Square</label></div>`);
    expect(current().question.images).toEqual([{ url: 'https://example.com/shape.png', caption: 'Figure for the question:' }]);
  });
});

describe('button-choice quizzes', () => {
  it('finds answer buttons but never navigation buttons', () => {
    page(`<main><h2>2 + 2 = ?</h2><div><button>3</button><button>4</button><button>5</button></div>
      <button>Submit Answer</button></main>`);
    const q = current().question;
    expect(q.prompt).toBe('2 + 2 = ?');
    expect(q.options!.map((o) => o.label)).toEqual(['3', '4', '5']);
  });
});

describe('Google Forms adapter', () => {
  const form = `<div role="list">
    <div role="listitem"><div role="heading"><span>Capital of Italy? <span>*</span></span></div>
      <div role="radiogroup">
        <label><div role="radio" aria-checked="false" aria-label="Rome" data-value="Rome"></div><span>Rome</span></label>
        <label><div role="radio" aria-checked="false" aria-label="Milan" data-value="Milan"></div><span>Milan</span></label>
        <label><div role="radio" aria-checked="false" aria-label="Other:" data-value="__other_option__"></div></label>
        <input type="text" aria-label="Other response"></div></div>
    <div role="listitem"><div role="heading"><span>Even numbers</span></div><div role="list">
        <div role="listitem"><label><div role="checkbox" aria-checked="false" aria-label="2" data-answer-value="2"></div></label></div>
        <div role="listitem"><label><div role="checkbox" aria-checked="false" aria-label="3" data-answer-value="3"></div></label></div>
        <div role="listitem"><label><div role="checkbox" aria-checked="false" aria-label="4" data-answer-value="4"></div></label></div>
      </div></div>
    <div role="listitem"><div role="heading"><span>Symbol for water</span></div><input type="text" aria-labelledby="x"></div>
  </div>`;
  const toggle = (): void => {
    for (const el of document.querySelectorAll('[role=radio],[role=checkbox]')) {
      el.addEventListener('click', () => el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true')));
    }
  };

  it('reads each list item as one question and drops the "Other" option', () => {
    page(form);
    const all = detectAll(document, googleForms);
    expect(all.map((d) => [d.question.kind, d.question.prompt])).toEqual([
      ['single', 'Capital of Italy?'],
      ['multi', 'Even numbers'],
      ['text', 'Symbol for water'],
    ]);
    expect(all[0].question.options!.map((o) => o.label)).toEqual(['Rome', 'Milan']);
  });

  it('answers exactly one question per activation, in order', async () => {
    page(form);
    toggle();
    const base = { answerable: true, confidence: 'high' as const };

    let d = current(googleForms);
    expect(d.question.prompt).toBe('Capital of Italy?');
    expect((await applyAnswer(d, { ...base, choices: [1] })).ok).toBe(true);
    expect(document.querySelector('[aria-label=Rome]')!.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll('[role=checkbox][aria-checked=true]').length).toBe(0);

    d = current(googleForms);
    expect(d.question.prompt).toBe('Even numbers');
    await applyAnswer(d, { ...base, choices: [1, 3] });
    expect([...document.querySelectorAll('[role=checkbox]')].map((e) => e.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);

    d = current(googleForms);
    expect(d.question.prompt).toBe('Symbol for water');
    await applyAnswer(d, { ...base, texts: ['H2O'] });
    expect((d.target as unknown as { els: HTMLInputElement[] }).els[0].value).toBe('H2O');

    expect(detectCurrent(document, googleForms)).toBeNull();
  });
});

describe('regressions from live Google Forms', () => {
  it('uses clean column names in a grid and skips e-mail questions', () => {
    document.body.innerHTML = `<div role="list">
      <div role="listitem"><div role="heading">How often do you...</div>
        <div role="radiogroup" aria-label="Laugh.">
          <div role="radio" aria-label="Never, response for row Laugh." data-value="Never"></div>
          <div role="radio" aria-label="Often, response for row Laugh." data-value="Often"></div></div>
        <div role="radiogroup" aria-label="Dance.">
          <div role="radio" aria-label="Never, response for row Dance." data-value="Never"></div>
          <div role="radio" aria-label="Often, response for row Dance." data-value="Often"></div></div></div>
      <div role="listitem"><div role="heading">10. Email address (to receive links)</div><input type="text"></div>
      <div role="listitem"><div><div role="heading">When do you get up? *</div><div>Use 24-hour time.</div></div>
        <input type="text" aria-label="Hour"><input type="text" aria-label="Minute"></div></div>`;
    const all = detectAll(document, googleForms);
    expect(all.map((d) => d.question.kind)).toEqual(['matching', 'blanks']);
    expect(all[0].question.options!.map((o) => o.label)).toEqual(['Never', 'Often']);
    expect(all[0].question.rows!.map((o) => o.label)).toEqual(['Laugh.', 'Dance.']);
    expect(all[1].question.prompt).toBe('When do you get up? Use 24-hour time. Fields: [1] Hour, [2] Minute');
  });

  it('does not mistake "Name the..." questions for a personal field', () => {
    document.body.innerHTML = `<label for="a">Name the capital of France</label><input id="a" type="text">`;
    expect(detectCurrent(document, undefined)?.d.question.prompt).toBe('Name the capital of France');
  });
});

describe('button radios (Socrative-style)', () => {
  it('reads labels from button[role=radio] and the question from the text before the group', () => {
    document.body.innerHTML = `<main><div><p>Question 1 of 5</p><h2>What is the world's longest river?</h2></div>
      <form><div role="radiogroup" aria-label="Select one answer">
        <button type="button" role="radio" aria-checked="false" value="11"><span>A</span><div>The Mississippi River</div></button>
        <button type="button" role="radio" aria-checked="false" value="12"><span>B</span><div>The Nile River</div></button>
      </div></form><button>Submit Answer</button></main>`;
    const q = detectCurrent(document, undefined)!.d.question;
    expect(q.kind).toBe('single');
    expect(q.prompt).toBe("Question 1 of 5 What is the world's longest river?");
    expect(q.options!.map((o) => o.label)).toEqual(['A The Mississippi River', 'B The Nile River']);
  });
});

describe('question pictures outside the option group', () => {
  it('includes an image that sits beside the options inside the same article', () => {
    document.body.innerHTML = `<main><article><p>This is an outline of which country?</p>
      <img src="https://example.com/outline.jpg">
      <div><div role="radiogroup" aria-label="Select one answer">
        <button type="button" role="radio" aria-checked="false">France</button>
        <button type="button" role="radio" aria-checked="false">Italy</button></div></div></article></main>`;
    const q = detectCurrent(document, undefined)!.d.question;
    expect(q.prompt).toBe('This is an outline of which country?');
    expect(q.images).toEqual([{ url: 'https://example.com/outline.jpg', caption: 'Figure for the question:' }]);
  });
});

describe('date fields and tick-box grids', () => {
  it('treats a native date input as an answerable question and fills it', async () => {
    document.body.innerHTML = `<div class="q"><label for="d">When did the Berlin Wall fall?</label><input id="d" type="date"></div>`;
    const d = detectCurrent(document, undefined)!.d;
    expect(d.question.kind).toBe('text');
    expect(d.question.inputHint).toBe('date');
    await applyAnswer(d, { answerable: true, confidence: 'high', texts: ['1989-11-09'] });
    expect((document.getElementById('d') as HTMLInputElement).value).toBe('1989-11-09');
  });

  it('labels tick-box grid options by row and column', () => {
    document.body.innerHTML = `<div role="list"><div role="listitem"><div role="heading">Where would you do these?</div>
      <div role="group" aria-label="Dining">
        <div role="checkbox" aria-checked="false" aria-label="Japan, vastus reale Dining" data-answer-value="Japan"></div>
        <div role="checkbox" aria-checked="false" aria-label="Peru, vastus reale Dining" data-answer-value="Peru"></div></div>
      <div role="group" aria-label="Skiing">
        <div role="checkbox" aria-checked="false" aria-label="Japan, vastus reale Skiing" data-answer-value="Japan"></div>
        <div role="checkbox" aria-checked="false" aria-label="Peru, vastus reale Skiing" data-answer-value="Peru"></div></div></div></div>`;
    const q = detectCurrent(document, googleForms)!.d.question;
    expect(q.kind).toBe('multi');
    expect(q.options!.map((o) => o.label)).toEqual(['Dining: Japan', 'Dining: Peru', 'Skiing: Japan', 'Skiing: Peru']);
  });
});

describe('pages that reuse elements for the next question', () => {
  it('treats new question text in the same elements as a new question', async () => {
    document.body.innerHTML = `<main><h2 id="q">First question?</h2><div role="radiogroup">
      <button type="button" role="radio" aria-checked="false">Yes</button>
      <button type="button" role="radio" aria-checked="false">No</button></div></main>`;
    for (const el of document.querySelectorAll('[role=radio]')) el.addEventListener('click', () => el.setAttribute('aria-checked', 'true'));
    await applyAnswer(detectCurrent(document, undefined)!.d, { answerable: true, confidence: 'high', choices: [1] });
    expect(detectCurrent(document, undefined)).toBeNull();
    // The app swaps in the next question without replacing the elements.
    document.getElementById('q')!.textContent = 'Second question?';
    for (const el of document.querySelectorAll('[role=radio]')) el.setAttribute('aria-checked', 'false');
    expect(detectCurrent(document, undefined)?.d.question.prompt).toBe('Second question?');
  });
});

describe('after an answer is submitted', () => {
  it('does not mistake image controls for a question once the options are disabled', () => {
    document.body.innerHTML = `<main><h2>What is the direction of the car?</h2>
      <div><button>Zoom in</button><button>Zoom out</button><button>Enter fullscreen</button></div>
      <div role="radiogroup"><button role="radio" aria-checked="true" disabled>Left</button>
        <button role="radio" aria-checked="false" disabled>Right</button></div><button>Next Question</button></main>`;
    expect(detectCurrent(document, undefined)).toBeNull();
  });

  it('separates a letter badge from its label', () => {
    document.body.innerHTML = `<main><h2>Who was fastest?</h2><div role="radiogroup">
      <button role="radio" aria-checked="false"><span>A</span><span>Mike</span></button>
      <button role="radio" aria-checked="false"><span>B</span><span>Alex</span></button></div></main>`;
    expect(detectCurrent(document, undefined)!.d.question.options!.map((o) => o.label)).toEqual(['A Mike', 'B Alex']);
  });
});
