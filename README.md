# Onsite

Run a coding interview in one browser tab: a shared editor that runs code, a whiteboard, a question bank, and a private scorecard for the interviewer. Everything is client-side with no backend ([PeerJS](https://peerjs.com/) handles the peer-to-peer connection).

## Running an interview

1. Choose the kind of interview (**LeetCode**, **Backend**, or **Debugging**) and its length, then click **Start an interview**. You land in a new room.
2. Copy the invite link and send it to your candidate. They enter their name and knock; you click **Let them in**.
3. Choose a question or project from the bank (or write your own), then click **Show to candidate** when you're ready.
4. Click **Start interview** to start the clock. When it runs out, the interview ends automatically.
5. Fill in the scorecard as you go. Leaving or resetting the room saves it to **Past interviews**.

## Kinds of interview

The kind is chosen when the interview is created, and decides the room's interface:

- **LeetCode**: one function in a single editor, with input/output test cases and the NeetCode 150 (below).
- **Backend**: a small multi-file service with part of it left to build against a test suite. Comes with a URL shortener API (Python) and a task queue with retries and a concurrency limit (JavaScript).
- **Debugging**: a multi-file codebase with bugs and failing tests. Comes with a checkout service and an API rate limiter (Python), and a users API with routing and pagination bugs (JavaScript).

Backend and Debugging rooms work in a project (`projects.js`):

- **Files** sit in tabs above the editor. Each side can have a different file open; edits sync per file, and a dot marks the file your peer is in. The interviewer can add, delete, and hide files, or start from a blank Python or JavaScript project.
- **Run** executes the entry file. **Run tests** runs every test file and lists each test's result with its traceback. Python tests are `test_*.py` (unittest classes or plain `test_` functions with `assert`); JavaScript tests are `*.test.js` or anything in `test/`, written with `node:test` and `node:assert`.
- **Hidden files** are never sent to the candidate but run with every test run, so they work as hidden tests.
- **The candidate can run code and tests** (switch it off with *Candidate can run*). Runs go through the interviewer's browser, so the candidate only sees results for files they can see. The log records who ran what, including hidden results.
- Each kind has its own scorecard categories. Each bundled project has a reference approach and follow-ups in Log, and was checked to fail before its fixes and pass after.

`project-runner.js` packs a project into a single Judge0 program: a small bootstrap writes the files to a temp directory, then runs the entry file or the tests, reporting each test as it finishes.

## What the interviewer gets

- **Run code and tests** in Python 3.12, JavaScript (Node 22), C++ (GCC 14), and Java 17 (via the public [Judge0 CE](https://ce.judge0.com) service). Output and test results are visible only to the interviewer.
- **Hidden test cases**: tick *Hidden* on any case and the candidate never sees it.
- **NeetCode 150 question bank**, grouped by topic in NeetCode's order and searchable. Choosing a problem fetches its description and examples from LeetCode (via the community [alfa-leetcode-api](https://github.com/alfaarghya/alfa-leetcode-api)) and loads LeetCode's own starter code for the editor's language. LeetCode doesn't let a browser fetch starter code, so it's bundled in `neetcode150.js`, which was generated from LeetCode's API. The 7 Premium problems carry a short original statement instead. Eight problems (`questions.js`) are hand-written with extra hidden edge cases and a reference approach.
- **LeetCode-style test runs**: linked lists and trees are written the LeetCode way (`[1,2,3]`, `[3,9,20,null,null,15,7]`) and converted to `ListNode` / `TreeNode` for Python and JavaScript. "Modify in place" problems are graded on the mutated input. Design problems (MinStack, LRU Cache…) skip auto-tests, since they're driven by your own calls.
- **Interview log**: notes you type are stamped with the interview clock, alongside candidate pastes, tab switches, test runs, and joins.
- **Multiple questions per interview**: add a warm-up and a main problem as numbered tabs. Each keeps its own question, test cases, notes, and code, and tracks how long it was shown to the candidate. You can add and prepare the next question while the candidate keeps working; they only switch when you click *Move candidate to this question*.
- **Interview report**: Scorecard → *Open report* builds a clean, printable page (Save as PDF) with scores, summary, each question's time, test results, and final code, plus the log. Past interviews can reopen it.
- **Code playback**: replay every edit from the session, with pastes, tab switches, and runs marked on the timeline.
- **Refresh-safe rooms**: the room's state is saved in your browser, so a refresh or closed tab doesn't lose anything, and a candidate you already admitted reconnects without knocking again.

## Editor

- Spaces-only indentation (4 wide): Tab / Shift-Tab indent and dedent, Backspace removes a whole indent level, and pasted code is re-indented to the cursor with any tabs expanded, so mixed tabs and spaces can't cause Python `TabError`s.
- Code shows exactly as typed: no font ligatures turning `<=` into ≤ or `->` into →.
- **Format** (Cmd/Ctrl+Shift+F) runs real formatters in the browser via WebAssembly: [Ruff](https://docs.astral.sh/ruff/formatter/) (Black-compatible) for Python and clang-format for C++/Java/JavaScript. Code that doesn't parse is left untouched and the syntax error is reported.
- **Editor settings** (the *Aa* button): text size and a light or dark editor. These apply only to your screen.
- Python runs with LeetCode's usual implicit imports (`typing`, `collections`, `heapq`, `math`, …), and test runs show anything the code `print()`s separately from the returned value.

## Notes

- Connections use PeerJS's free public signaling server, which is fine for practice and small-scale use.
- Judge0 CE is free and public, and can be slow or rate-limited under load.
- The formatters (`vendor/ruff-fmt`, `vendor/clang-format`, from the MIT-licensed [wasm-fmt](https://github.com/wasm-fmt) project) load on first use. They need the site served over HTTP(S), not opened as a local file.
- Scorecards, logs, and room state stay in the interviewer's browser (`localStorage`) and are never uploaded.
