// Auto mode for sites that show one question at a time (Socrative): when a new question appears,
// ask the background worker to answer it, exactly as the single-question shortcut would. It only
// selects the answer; submitting stays with the user. Registered as a content script only while
// the auto setting is on.

if (window.top === window && !(globalThis as { __formPilotWatch?: boolean }).__formPilotWatch) {
  (globalThis as { __formPilotWatch?: boolean }).__formPilotWatch = true;

  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Changes when the question changes, but not when an answer is merely selected. */
  const signature = (): string => {
    const area = document.querySelector('main') ?? document.body;
    return `${location.pathname}|${(area?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400)}`;
  };
  const hasQuestion = (): boolean => !!document.querySelector('[role=radiogroup],[role=radio],[role=checkbox],input,textarea,select');

  const check = (attempt = 0): void => {
    const now = signature();
    if (now === last || !hasQuestion()) return;
    chrome.runtime.sendMessage({ type: 'answer', mode: 'one', auto: true }, (reply) => {
      if (chrome.runtime.lastError) return; // extension reloaded: stay quiet until the page reloads
      if (reply?.started) last = now;
      else if (attempt < 5) timer = setTimeout(() => check(attempt + 1), 1000); // worker was busy: try again
    });
  };

  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, 500); // let the new question finish rendering
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  timer = setTimeout(check, 800);
}
