# Form Pilot

Answers form and quiz questions with Claude. It reads the question on the page, asks Claude once, and
fills in the answer. **It never presses Submit** — that is always left to you.

- **Desktop:** a Chrome extension, driven by keyboard shortcuts.
- **Android:** a helper app that works on top of regular Chrome, driven by a floating dot.

You need your own [Anthropic API key](https://console.anthropic.com/). Nothing in the downloads
contains one.

| Works on | Desktop extension | Android helper |
| --- | --- | --- |
| Google Forms | every question type except file upload | all except date, time and file upload |
| Socrative | multiple choice, true/false, pictures | multiple choice, true/false, pictures |
| Other sites | standard HTML forms; anything else is best effort | best effort |

## Install on a computer (about a minute)

1. Download `form-pilot.zip` from the [latest release](https://github.com/klimPaskov/form-pilot/releases/latest)
   and unzip it to a folder you will keep (Chrome runs the extension from that folder).
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Click the Form Pilot icon and paste your API key into **API key**.

Nothing appears on pages and no settings page opens. On a managed computer where Developer mode is
blocked by an administrator, the extension cannot be installed, and Form Pilot does not try to get
around that.

To update: download the new zip, replace the folder's contents, and click the reload arrow on the
Form Pilot card in `chrome://extensions`.

## Use on a computer

| Shortcut | What it does |
| --- | --- |
| **Alt+Q** | Answers one question: the one your cursor is in, otherwise the first unanswered one on screen |
| **Alt+W** | Answers every unanswered question on the page |
| **Alt+Shift+W** | Answers every page of a multi-page form, pressing Next between pages; stops on the last page |

- Questions that already have an answer are left alone. Clear an answer to have it redone.
- Pressing any shortcut during a page or form run stops it.
- On **Socrative**, the answer is selected automatically as each question appears (switch it off in
  the popup). "Submit Answer" is still yours to press.
- A small dot in the bottom-right corner shows progress: grey while working, green when filled, amber
  for a low-confidence answer, red with a short message on a problem. Click it to dismiss.
- Change the keys at `chrome://extensions/shortcuts`. If a shortcut does nothing after an update, set
  it there once.

The popup (extension icon) has the settings: on/off, model, effort, indicator style, explanations,
web search, screenshot fallback, Socrative auto mode, and a Run button for each mode.

## Install on Android

Chrome for Android cannot run extensions, so there is a separate helper app.

1. Download `form-pilot-helper.apk` from the [latest release](https://github.com/klimPaskov/form-pilot/releases/latest)
   and install it (allow installs from your browser or file manager when asked).
2. Open **Form Pilot** and paste your API key.
3. Go to Settings > Accessibility, find **Form Pilot** and switch it on. If the switch is greyed out,
   open the app's App info, tap the three dots and choose "Allow restricted settings".

A semi-transparent blue dot appears over other apps. To switch the helper off, turn Form Pilot off
under Accessibility; the dot disappears and nothing is read.

## Use on Android

- **Tap the dot:** answers the question on screen.
- **Hold the dot:** answers every unanswered question on the page.
- **Tap during a run:** stops it.
- **Socrative:** the answer is selected automatically as each question appears (switch in the app).
- Drag the dot anywhere. It turns green when filled, amber for low confidence, red on a problem.

The helper selects answers with real taps and never presses buttons on the page, so it cannot submit
or move to the next page. Tested on one phone (Android 16) with Google Forms and Socrative.

## What gets sent, and what does not

- Only the question text, its answer options and any picture in the question go to the Anthropic API.
- Pictures: the extension sends the image file the page embeds, and falls back to a screenshot of the
  question when it cannot fetch it. The Android helper always uses a screenshot of the question.
- The extension's page script is injected only when you press a shortcut (or, with auto mode on, on
  Socrative). The Android helper reads the screen only when you use the dot, or on Socrative in auto mode.
- Your API key is stored only on your device.

## Limits

- Claude can be wrong. An amber dot means low confidence: check those answers.
- Validation messages are not read, so an answer a form rejects is not noticed.
- Date and time questions on Android, and file uploads everywhere, are left to you.
- Kahoot and Quizizz have not been tested.

## Build from source

```
npm install
npm test                 # unit tests
npm run package:public   # dist/ + form-pilot.zip and form-pilot.crx, without an API key
npm run package          # same, with the key from config.local.json baked in (private use only)
```

Android helper (needs the Android SDK and Gradle 8.9 or later): `cd android && gradle assembleRelease`.

`config.local.json` (`{"apiKey": "sk-ant-..."}`) is git-ignored. A build with a baked-in key is
readable by anyone who has the file, so keep it private and set a spend limit on the key.

## How it is organised

| Part | Where | Job |
| --- | --- | --- |
| Shortcut controller | `src/background/index.ts` | Shortcuts, single-flight guard, orchestration, toolbar badge |
| Multi-question runner | `src/background/runner.ts` | Whole-page and whole-form modes |
| Question detection | `src/content/detect.ts` | Finds controls, groups them into questions, reads text and options |
| Site adapters | `src/content/adapters/` | Per-site refinements (Google Forms, Socrative) |
| AI reasoning | `src/ai/` | `Provider` interface, Claude implementation, prompt and JSON schema |
| Answer mapping | `src/content/apply.ts` | Checks the answer against the question, confirms it registered |
| Form interaction | `src/content/fill.ts` | Clicks, typing, dropdowns |
| Android helper | `android/` | Accessibility service: screen reader, Claude client, tap gestures |
| Dev tools | `scripts/`, `test-pages/` | Local test quiz, and a harness for exercising live pages |

To support another site, add an adapter (`blocks`, `prompt`, `next`, `skip` are all optional) and
register it in `src/content/adapters/index.ts`. To support another AI provider, implement `Provider`.
