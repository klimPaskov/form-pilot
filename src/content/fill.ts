// Form interaction: the only module that changes the page. It never clicks submit/next controls.

import { clean, isVisible, readText, wait } from './dom';

const fire = (el: Element, type: string): boolean => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

/** A full pointer sequence plus a real click, which is what custom (ARIA) widgets listen for. */
export function click(el: HTMLElement): void {
  el.scrollIntoView?.({ block: 'nearest' });
  if (el.tagName !== 'INPUT') {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  }
  el.click();
}

/** Sets a value the way typing would, so React/Vue-controlled inputs notice the change. */
export function setText(el: HTMLElement, value: string): void {
  el.focus();
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const input = el as HTMLInputElement;
    if (input.maxLength > 0) value = value.slice(0, input.maxLength);
    const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    fire(el, 'change');
  } else {
    // contenteditable: go through the editing pipeline when the browser has one.
    window.getSelection?.()?.selectAllChildren(el);
    if (!document.execCommand?.('insertText', false, value)) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
  }
  el.blur(); // so the next activation is not pinned to this field by focus
}

export function setSelect(el: HTMLSelectElement, option: HTMLOptionElement): void {
  el.value = option.value;
  option.selected = true;
  fire(el, 'input');
  fire(el, 'change');
}

/**
 * ARIA dropdown (e.g. Google Forms): open it, click the option in the popup, and confirm it took.
 * Google Forms ignores clicks that arrive while the popup is still animating open, so this waits
 * first and retries if the selection did not register.
 */
export async function setListbox(el: HTMLElement, label: string): Promise<boolean> {
  const text = (o: Element): string => readText(o) || clean(o.getAttribute('data-value'));
  const find = (): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')].filter((o) => text(o) === label && isVisible(o)).pop();
  const selected = (): boolean => {
    const sel = el.querySelector('[role=option][aria-selected=true]');
    return !!sel && text(sel) === label;
  };
  click(el);
  await wait(600);
  for (let attempt = 0; attempt < 3; attempt++) {
    const option = find();
    if (option) {
      click(option);
      await wait(250);
      if (selected()) return true;
    }
    if (el.getAttribute('aria-expanded') !== 'true') {
      click(el); // closed without selecting: reopen and try again
    }
    await wait(350);
  }
  return selected();
}
