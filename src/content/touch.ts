// Optional floating trigger for touch devices, where there is no keyboard shortcut. Registered as a
// content script only while the "floating button" setting is on (the default on Android).

if (window.top === window && !document.querySelector('[data-form-pilot-button]')) {
  const host = document.createElement('div');
  host.setAttribute('data-form-pilot', '');
  host.setAttribute('data-form-pilot-button', '');
  host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:72px;z-index:2147483647';
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Answer current question');
  button.style.cssText =
    'all:initial;display:block;width:44px;height:44px;border-radius:50%;background:#1a73e8;opacity:.55;' +
    'box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:pointer;-webkit-tap-highlight-color:transparent';
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void chrome.runtime.sendMessage({ type: 'answer' });
  });
  host.attachShadow({ mode: 'closed' }).append(button);
  document.documentElement.append(host);
}
