# Onsite

Run a coding interview in one browser tab: a shared editor that runs code, a whiteboard, a question bank, and a private scorecard for the interviewer. Everything is client-side with no backend ([PeerJS](https://peerjs.com/) handles the peer-to-peer connection).

## Running an interview

1. Choose an interview length and click **Start an interview**. You land in a new room.
2. Copy the invite link and send it to your candidate. They enter their name and knock; you click **Let them in**.
3. Choose a question from the bank (or write one, or import from LeetCode), then click **Show to candidate** when you're ready.
4. Click **Start interview** to start the clock. When it runs out, the interview ends automatically.
5. Fill in the scorecard as you go. Leaving or resetting the room saves it to **Past interviews**.

## What the interviewer gets

- **Run code and tests** in Python, JavaScript, C++, and Java (via the public [Judge0 CE](https://ce.judge0.com) service). Output and test results are visible only to the interviewer.
- **Hidden test cases**: tick *Hidden* on any case and the candidate never sees it.
- **Question bank** (`questions.js`): eight classic problems, each with starter code, example and hidden test cases, and a reference approach that loads into your private notes.
- **Interview log**: notes you type are stamped with the interview clock, alongside candidate pastes, tab switches, test runs, and joins.
- **Code playback**: replay every edit from the session, with pastes, tab switches, and runs marked on the timeline.
- **Refresh-safe rooms**: the room's state is saved in your browser, so a refresh or closed tab doesn't lose anything, and a candidate you already admitted reconnects without knocking again.

## Editor

- Spaces-only indentation (4 wide): Tab / Shift-Tab indent and dedent, Backspace removes a whole indent level, and pasted code is re-indented to the cursor with any tabs expanded, so mixed tabs and spaces can't cause Python `TabError`s.
- **Format** (Cmd/Ctrl+Shift+F) runs real formatters in the browser via WebAssembly: [Ruff](https://docs.astral.sh/ruff/formatter/) (Black-compatible) for Python and clang-format for C++/Java/JavaScript. Code that doesn't parse is left untouched and the syntax error is reported.
- Python runs with LeetCode's usual implicit imports (`typing`, `collections`, `heapq`, `math`, …), and test runs show anything the code `print()`s separately from the returned value.

## Notes

- Connections use PeerJS's free public signaling server, which is fine for practice and small-scale use.
- Judge0 CE is free and public, and can be slow or rate-limited under load.
- The formatters (`vendor/ruff-fmt`, `vendor/clang-format`, from the MIT-licensed [wasm-fmt](https://github.com/wasm-fmt) project) load on first use. They need the site served over HTTP(S), not opened as a local file.
- Scorecards, logs, and room state stay in the interviewer's browser (`localStorage`) and are never uploaded.
