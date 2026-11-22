# Form Pilot

A Chrome extension that answers the current form or quiz question with Claude. One shortcut press
handles exactly one question: it finds the question, asks Claude once, fills in the answer and stops.
It never submits a form or moves to the next page.

## Install (under a minute)

1. Download `form-pilot.zip` from the [latest release](https://github.com/klimPaskov/form-pilot/releases/latest) and unzip it anywhere.
2. Open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.

That is all: no settings page opens and nothing appears on pages. Press **Alt+Q** on a page with a
question. Release builds contain no API key: click the extension icon once and paste your Anthropic
key. A private build can have the key baked in (see Build).

On a managed computer where Developer mode is disabled by the administrator, the extension cannot be
installed. That restriction is intentional and Form Pilot does not try to get around it.

### Android

Chrome for Android does not run extensions, so Form Pilot needs an Android browser that does.
Each release also has a signed `form-pilot.crx` for browsers that install from a file:

- **Microsoft Edge Canary**: Settings > About > tap the build number five times to unlock Developer
  options, then "Extension install by crx" and pick `form-pilot.crx`.
- Other Chromium-based browsers with extension support (for example Kiwi, Quetta, Lemur) may accept
  the `.crx` or the `.zip` from their extensions page.

On Android the extension switches on a small floating button on every page (there is no keyboard
shortcut on a phone): one tap answers one question. It can be turned off in the popup. This route
has not been verified on a device yet.

## Use

- **Alt+Q** answers the question you are on: the unanswered question that has keyboard focus,
  otherwise the first unanswered one on screen.
- **Alt+W** answers every unanswered question on the open page.
- **Alt+Shift+W** answers every page of a multi-page form, pressing "Next" between pages. It stops
  on the last page, and also if a page does not advance (for example a required question it could
  not answer).
- No mode ever submits: the final Submit is always yours. Questions that already have an answer are
  left alone. Pressing any shortcut during a page or form run stops it.
- Change the keys at `chrome://extensions/shortcuts` (the popup has a button for it). If you
  installed an earlier version, the two new shortcuts may need to be set there once.
- A small dot in the bottom-right corner shows progress: grey while working, green when filled,
  amber for a low-confidence answer, red with a short message on errors. Click it to dismiss.
- The popup (extension icon) is optional: enable/disable, model, effort, indicator style,
  explanations, web search, screenshot fallback, API key.
- If a page has no recognisable form fields, a screenshot is sent instead and the answer is shown
  next to the dot rather than filled in.

## Build

```
npm install
npm test          # unit tests (jsdom)
npm run package   # builds dist/ and form-pilot.zip
```

To bake your key into a private build, create `config.local.json` (`{"apiKey": "sk-ant-..."}`) before
building. The key is then readable by anyone who has the zip, so keep that file private and set a
spend limit on the key in the Anthropic Console.

Manual test page: `node scripts/serve.mjs`, then open http://localhost:4173/test-pages/quiz.html.

## How it is organised

| Module | File | Job |
| --- | --- | --- |
| Shortcut controller | `src/background/index.ts` | Shortcut, single-flight guard, orchestration, toolbar badge |
| Question detection | `src/content/detect.ts` | Finds controls, groups them into questions, reads text/options, picks the current one |
| Site adapters | `src/content/adapters/` | Per-site refinements (Google Forms, Socrative) on top of the universal detector |
| AI reasoning | `src/ai/` | `Provider` interface, Claude implementation, prompt and JSON schema |
| Answer mapping | `src/content/apply.ts` | Validates the model's answer against the question |
| Form interaction | `src/content/fill.ts` | Clicks, typing, dropdowns, in a way React-style pages notice |
| Indicator | `src/content/indicator.ts` | The corner dot |

The page script is injected only when the shortcut is pressed; nothing runs on pages otherwise. Only
the question text, its options and any figure in it are sent to the Anthropic API.

To support a new site, add an adapter (`blocks`, `prompt`, `skip` are all optional) and register it
in `src/content/adapters/index.ts`. To support another AI provider, implement `Provider`.
