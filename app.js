(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || 'ROOM01').toUpperCase();
  const role = params.get('role') === 'interviewer' ? 'interviewer' : 'candidate';
  const myName = params.get('name') || (role === 'interviewer' ? 'Interviewer' : 'Candidate');

  document.getElementById('roomChip').textContent = room;

  // ---------- Language mapping (CodeMirror mode <-> Judge0 language id) ----------
  // Judge0 CE (ce.judge0.com) is a free, unauthenticated, CORS-open community
  // instance — used instead of Piston's public API, which went whitelist-only
  // as of Feb 2026 and no longer works for arbitrary sites.
  const LANGS = {
    python: { cmMode: 'python', judge0: 71, label: 'Python' },
    javascript: { cmMode: 'javascript', judge0: 63, label: 'JavaScript' },
    cpp: { cmMode: 'text/x-c++src', judge0: 54, label: 'C++' },
    java: { cmMode: 'text/x-java', judge0: 62, label: 'Java' },
  };

  // ---------- CodeMirror ----------
  const editor = CodeMirror.fromTextArea(document.getElementById('codeArea'), {
    mode: LANGS.python.cmMode,
    theme: 'dracula',
    lineNumbers: true,
    tabSize: 4,
    indentUnit: 4,
    readOnly: role === 'candidate', // locked until the interviewer admits them
    value: '',
    extraKeys: {
      'Cmd-Enter': () => runOrTest(),
      'Ctrl-Enter': () => runOrTest(),
    },
  });
  editor.setValue('# Write code here — it syncs live with your peer\ndef two_sum(nums, target):\n    pass\n');

  const langSelect = document.getElementById('langSelect');
  langSelect.addEventListener('change', () => {
    editor.setOption('mode', LANGS[langSelect.value].cmMode);
    broadcast({ type: 'lang', value: langSelect.value });
  });

  let suppressEmit = false;
  editor.on('change', (cm, changeObj) => {
    if (suppressEmit) return;
    broadcast({ type: 'code', value: editor.getValue() });

    // Flag large pastes from the candidate so the interviewer has a
    // low-friction signal, without capturing clipboard content itself.
    if (role === 'candidate' && changeObj.origin === 'paste') {
      const pastedLen = (changeObj.text || []).join('\n').length;
      if (pastedLen > 40) {
        broadcast({ type: 'paste-flag', chars: pastedLen, at: Date.now() });
      }
    }
  });

  // ---------- Remote cursor + selection indicator ----------
  const remoteRoleLabel = role === 'interviewer' ? 'Candidate' : 'Interviewer';
  let remoteName = remoteRoleLabel;
  let remoteCursorMark = null;
  let remoteSelectionMark = null;
  let remoteCursorFadeTimer = null;

  function clampPos(line, ch) {
    const lineCount = editor.lineCount();
    const safeLine = Math.min(Math.max(line, 0), lineCount - 1);
    const safeCh = Math.min(Math.max(ch, 0), editor.getLine(safeLine).length);
    return { line: safeLine, ch: safeCh };
  }

  function showRemoteCursor(line, ch, sel) {
    if (remoteCursorMark) { remoteCursorMark.clear(); remoteCursorMark = null; }
    if (remoteSelectionMark) { remoteSelectionMark.clear(); remoteSelectionMark = null; }

    const remoteClass = role === 'interviewer' ? 'remote-cursor-candidate' : 'remote-cursor-interviewer';
    const wrap = document.createElement('span');
    wrap.className = 'remote-cursor ' + remoteClass;
    const flag = document.createElement('span');
    flag.className = 'remote-cursor-flag';
    flag.textContent = remoteName;
    wrap.appendChild(flag);
    const pos = clampPos(line, ch);
    remoteCursorMark = editor.setBookmark(pos, { widget: wrap, insertLeft: true });

    // Show the name label briefly on movement, then fade it so it doesn't
    // sit permanently over whatever code is next to the cursor.
    if (remoteCursorFadeTimer) clearTimeout(remoteCursorFadeTimer);
    remoteCursorFadeTimer = setTimeout(() => flag.classList.add('faded'), 1800);

    if (sel) {
      const a = clampPos(sel.anchorLine, sel.anchorCh);
      const h = clampPos(sel.headLine, sel.headCh);
      const [from, to] = (a.line < h.line || (a.line === h.line && a.ch <= h.ch)) ? [a, h] : [h, a];
      if (from.line !== to.line || from.ch !== to.ch) {
        const selClass = role === 'interviewer' ? 'remote-selection-candidate' : 'remote-selection-interviewer';
        remoteSelectionMark = editor.markText(from, to, { className: selClass });
      }
    }
  }

  function clearRemoteCursor() {
    if (remoteCursorMark) { remoteCursorMark.clear(); remoteCursorMark = null; }
    if (remoteSelectionMark) { remoteSelectionMark.clear(); remoteSelectionMark = null; }
  }

  let cursorSendTimer = null;
  editor.on('cursorActivity', () => {
    if (suppressEmit) return;
    if (cursorSendTimer) return;
    cursorSendTimer = setTimeout(() => {
      cursorSendTimer = null;
      const pos = editor.getCursor();
      const sel = editor.somethingSelected() ? editor.listSelections()[0] : null;
      broadcast({
        type: 'cursor',
        line: pos.line,
        ch: pos.ch,
        sel: sel ? { anchorLine: sel.anchor.line, anchorCh: sel.anchor.ch, headLine: sel.head.line, headCh: sel.head.ch } : null,
      });
    }, 80);
  });

  // ---------- Code execution (Judge0 CE: free, no-key, multi-language) ----------
  const outputPane = document.getElementById('outputPane');
  const runBtn = document.getElementById('runBtn');
  const runTestsBtn = document.getElementById('runTestsBtn');
  // If test cases are defined, "Run" runs against them (calling the
  // function with no case to run against would just print nothing) —
  // "Run tests" stays as the explicit/repeatable way to do the same.
  function runOrTest() {
    if (role !== 'interviewer') return;
    return testCases.length ? runTests() : runCode();
  }
  runBtn.addEventListener('click', runOrTest);
  runTestsBtn.addEventListener('click', runTests);
  document.getElementById('clearOutputBtn').addEventListener('click', () => outputPane.textContent = '');

  if (role !== 'interviewer') {
    runBtn.classList.add('hidden');
    runTestsBtn.classList.add('hidden');
  }

  async function executeCode(languageId, code, stdin) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('https://ce.judge0.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: code, language_id: languageId, stdin: stdin || '' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`execution request failed (${res.status})`);
      return res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('execution timed out — the free judge server may be under load, try again');
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  function formatRunResult(result) {
    const parts = [];
    if (result.status && result.status.id !== 3) parts.push(`Status: ${result.status.description}`);
    if (result.compile_output) parts.push('Compile error:\n' + result.compile_output.trim());
    if (result.stdout) parts.push(result.stdout.replace(/\n+$/, ''));
    if (result.stderr) parts.push('stderr:\n' + result.stderr.replace(/\n+$/, ''));
    if (result.message) parts.push(result.message);
    return parts.join('\n\n') || '(no output)';
  }

  // ---------- Auto-driver for test cases ----------
  // A LeetCode-style solution (bare function, or a class Solution with a
  // method) has nothing that reads stdin or prints — running it against a
  // test case would always come back empty. Detect the entry point and
  // append a small driver that reads one JSON value per line from stdin
  // (one per argument), calls it, and prints the JSON result. Only done for
  // Python/JavaScript, where the call syntax is simple enough to be
  // reliable; C++/Java are left as-is (candidate must read stdin manually).
  function detectPythonEntry(code) {
    if (/class\s+Solution\b/.test(code)) {
      const m = code.match(/def\s+(\w+)\s*\(\s*self\b/);
      if (m) return `Solution().${m[1]}`;
    }
    const m = code.match(/^def\s+(\w+)\s*\(/m);
    return m ? m[1] : null;
  }

  function detectJsEntry(code) {
    let m = code.match(/class\s+Solution\b[\s\S]*?(\w+)\s*\(/);
    if (m) return `new Solution().${m[1]}`;
    m = code.match(/function\s+(\w+)\s*\(/);
    if (m) return m[1];
    m = code.match(/(?:var|let|const)\s+(\w+)\s*=\s*function/);
    if (m) return m[1];
    m = code.match(/(?:var|let|const)\s+(\w+)\s*=\s*\(/);
    if (m) return m[1];
    return null;
  }

  function withDriver(langKey, code) {
    if (langKey === 'python') {
      const entry = detectPythonEntry(code);
      if (!entry) return code;
      return `${code}

if __name__ == "__main__":
    import json, sys
    _lines = [l for l in sys.stdin.read().splitlines() if l.strip() != ""]
    _args = [json.loads(l) for l in _lines]
    _result = ${entry}(*_args)
    print(json.dumps(_result, separators=(",", ":")))
`;
    }
    if (langKey === 'javascript') {
      const entry = detectJsEntry(code);
      if (!entry) return code;
      return `${code}

const __mm_lines = require('fs').readFileSync(0, 'utf8').split(/\\r?\\n/).filter(l => l.trim() !== '');
const __mm_args = __mm_lines.map(l => JSON.parse(l));
const __mm_result = ${entry}(...__mm_args);
console.log(JSON.stringify(__mm_result));
`;
    }
    return code; // cpp/java: no auto-driver, run as written
  }

  // Compares by parsing both sides as JSON and re-stringifying, so
  // "[[1,2], [3]]" and "[[1,2],[3]]" compare equal — falls back to trimmed
  // string equality for plain (non-JSON) output.
  function outputsMatch(actual, expected) {
    const norm = s => {
      try { return JSON.stringify(JSON.parse(s)); } catch { return s.trim(); }
    };
    return norm(actual) === norm(expected);
  }

  async function runCode() {
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    outputPane.textContent = 'Running…';
    try {
      const lang = LANGS[langSelect.value];
      const result = await executeCode(lang.judge0, editor.getValue(), '');
      outputPane.textContent = formatRunResult(result);
    } catch (e) {
      outputPane.textContent = 'Error running code: ' + e.message;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
  }

  async function runTests() {
    if (!testCases.length) {
      outputPane.textContent = 'Add at least one test case first.';
      return;
    }
    runTestsBtn.disabled = true;
    runTestsBtn.textContent = 'Running tests…';
    const lang = LANGS[langSelect.value];
    const rawCode = editor.getValue();
    const code = withDriver(langSelect.value, rawCode);
    const noAutoDriver = code === rawCode && langSelect.value !== 'python' && langSelect.value !== 'javascript';
    const summaryLines = [];
    let passCount = 0;
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      try {
        const result = await executeCode(lang.judge0, code, tc.input);
        const actual = (result.stdout || '').trim();
        const expected = (tc.expected || '').trim();
        const pass = outputsMatch(actual, expected);
        if (pass) passCount++;
        const errDetail = result.stderr || result.compile_output;
        let text = pass
          ? 'Passed'
          : `Expected: ${expected || '(empty)'}\nGot: ${actual || '(empty)'}` +
            (errDetail ? `\n${errDetail.trim()}` : '');
        if (!pass && !actual && noAutoDriver) {
          text += '\nC++/Java aren\'t auto-run yet — your code needs its own main() that reads stdin and prints the result.';
        }
        tc.result = { status: pass ? 'pass' : 'fail', text };
        summaryLines.push(`Case ${i + 1}: ${pass ? 'PASS' : 'FAIL'}`);
      } catch (e) {
        tc.result = { status: 'fail', text: 'Error: ' + e.message };
        summaryLines.push(`Case ${i + 1}: ERROR — ${e.message}`);
      }
    }
    renderTestcases();
    outputPane.textContent = `${passCount}/${testCases.length} test cases passed\n\n` + summaryLines.join('\n');
    runTestsBtn.disabled = false;
    runTestsBtn.textContent = 'Run tests';
  }

  // ---------- Test cases ----------
  const testcasePane = document.getElementById('testcasePane');
  const testcaseList = document.getElementById('testcaseList');
  const addTestcaseBtn = document.getElementById('addTestcaseBtn');
  let testCases = [];
  let testcaseSyncTimer = null;

  testcasePane.classList.remove('hidden');
  if (role !== 'interviewer') {
    addTestcaseBtn.classList.add('hidden');
    document.getElementById('testcaseHint').classList.add('hidden');
  }

  function renderTestcases() {
    testcaseList.innerHTML = '';
    if (!testCases.length) {
      const empty = document.createElement('div');
      empty.className = 'testcase-empty';
      empty.textContent = role === 'interviewer' ? 'No test cases yet — add one to enable "Run tests".' : 'No test cases yet.';
      testcaseList.appendChild(empty);
      return;
    }
    testCases.forEach((tc, i) => {
      const row = document.createElement('div');
      row.className = 'testcase-row';

      const header = document.createElement('div');
      header.className = 'testcase-row-header';
      const label = document.createElement('span');
      label.textContent = `Case ${i + 1}`;
      header.appendChild(label);
      if (role === 'interviewer') {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          testCases.splice(i, 1);
          renderTestcases();
          syncTestcases();
        });
        header.appendChild(removeBtn);
      }
      row.appendChild(header);

      const inputArea = document.createElement('textarea');
      inputArea.placeholder = 'one argument per line, e.g.\n[2,7,11,15]\n9';
      inputArea.value = tc.input || '';
      inputArea.readOnly = role !== 'interviewer';
      inputArea.addEventListener('input', () => {
        testCases[i].input = inputArea.value;
        scheduleSyncTestcases();
      });
      row.appendChild(inputArea);

      const expectedArea = document.createElement('textarea');
      expectedArea.placeholder = 'expected return value, e.g. [[1,2]]';
      expectedArea.value = tc.expected || '';
      expectedArea.readOnly = role !== 'interviewer';
      expectedArea.addEventListener('input', () => {
        testCases[i].expected = expectedArea.value;
        scheduleSyncTestcases();
      });
      row.appendChild(expectedArea);

      if (tc.result) {
        const resultEl = document.createElement('div');
        resultEl.className = 'testcase-result ' + tc.result.status;
        resultEl.textContent = tc.result.text;
        row.appendChild(resultEl);
      }

      testcaseList.appendChild(row);
    });
  }
  renderTestcases();

  function scheduleSyncTestcases() {
    if (testcaseSyncTimer) clearTimeout(testcaseSyncTimer);
    testcaseSyncTimer = setTimeout(syncTestcases, 300);
  }
  function syncTestcases() {
    if (role !== 'interviewer') return;
    broadcast({ type: 'testcases', value: testCases.map(tc => ({ input: tc.input, expected: tc.expected })) });
  }

  if (role === 'interviewer') {
    addTestcaseBtn.addEventListener('click', () => {
      testCases.push({ input: '', expected: '' });
      renderTestcases();
      syncTestcases();
    });
  }

  // ---------- Timer ----------
  const timerEl = document.getElementById('timer');
  let startTime = null;
  let timerInterval = null;

  function startTimer(t0) {
    startTime = t0;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - startTime) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  if (role === 'interviewer') {
    startTimer(Date.now());
  }

  // ---------- Question pane ----------
  const questionArea = document.getElementById('questionArea');
  const revealBtn = document.getElementById('revealBtn');
  const interviewerQuestionActions = document.getElementById('interviewerQuestionActions');
  const candidateHiddenNote = document.getElementById('candidateHiddenNote');
  let questionVisible = false;

  if (role === 'candidate') {
    questionArea.readOnly = true;
    questionArea.placeholder = "The interviewer hasn't shared the question yet.";
    interviewerQuestionActions.classList.add('hidden');
    candidateHiddenNote.classList.remove('hidden');
  }

  let suppressQuestionEmit = false;
  questionArea.addEventListener('input', () => {
    if (suppressQuestionEmit || role !== 'interviewer') return;
    if (questionVisible) broadcast({ type: 'question', value: questionArea.value, visible: true });
  });

  if (role === 'interviewer') {
    revealBtn.addEventListener('click', () => {
      questionVisible = !questionVisible;
      revealBtn.textContent = questionVisible ? 'Hide from candidate' : 'Show to candidate';
      revealBtn.classList.toggle('active', questionVisible);
      broadcast({ type: 'question', value: questionArea.value, visible: questionVisible });
    });
  }

  // ---------- Difficulty ----------
  const questionMeta = document.getElementById('questionMeta');
  const questionBadges = document.getElementById('questionBadges');
  const difficultyBtns = Array.from(document.querySelectorAll('.difficulty-btn'));
  let currentMeta = { difficulty: '' };

  function renderQuestionBadges(meta) {
    questionBadges.innerHTML = '';
    if (meta.difficulty) {
      const span = document.createElement('span');
      span.className = 'question-badge difficulty-' + meta.difficulty;
      span.textContent = meta.difficulty;
      questionBadges.appendChild(span);
    }
    questionBadges.classList.toggle('hidden', !meta.difficulty);
  }

  function setDifficultyButtonsActive(value) {
    difficultyBtns.forEach(b => b.classList.toggle('active', b.dataset.difficulty === value));
  }

  if (role === 'candidate') {
    questionMeta.classList.add('hidden');
  } else {
    difficultyBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.difficulty;
        currentMeta = { difficulty: currentMeta.difficulty === value ? '' : value };
        setDifficultyButtonsActive(currentMeta.difficulty);
        renderQuestionBadges(currentMeta);
        broadcast({ type: 'meta', value: currentMeta });
      });
    });
  }

  // ---------- Solution pane (interviewer only, never broadcast) ----------
  const solutionPane = document.getElementById('solutionPane');
  const solutionArea = document.getElementById('solutionArea');
  if (role === 'interviewer') {
    solutionPane.classList.remove('hidden');
  }

  // ---------- Import from LeetCode ----------
  const importPanel = document.getElementById('importPanel');
  if (role === 'interviewer') {
    document.getElementById('importLeetcodeBtn').addEventListener('click', () => {
      importPanel.classList.toggle('hidden');
    });
    document.getElementById('importCancelBtn').addEventListener('click', () => {
      importPanel.classList.add('hidden');
    });
    document.getElementById('importConfirmBtn').addEventListener('click', () => {
      const url = document.getElementById('importUrlInput').value.trim();
      const pasted = document.getElementById('importPasteArea').value.trim();
      if (!pasted) {
        alert('Paste the problem statement first — LeetCode blocks fetching it automatically from another site, so bring the text over yourself.');
        return;
      }
      const composed = url ? `Source: ${url}\n\n${pasted}` : pasted;
      questionArea.value = composed;
      importPanel.classList.add('hidden');
      document.getElementById('importUrlInput').value = '';
      document.getElementById('importPasteArea').value = '';
      if (questionVisible) broadcast({ type: 'question', value: composed, visible: true });
    });
  }

  // ---------- Candidate activity log (interviewer only): pastes + tab switches ----------
  const pasteLog = document.getElementById('pasteLog');
  const pasteLogList = document.getElementById('pasteLogList');
  if (role === 'interviewer') pasteLog.classList.remove('hidden');

  function logActivityEvent(text, at) {
    const empty = pasteLogList.querySelector('.paste-log-empty');
    if (empty) empty.remove();
    const row = document.createElement('div');
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.textContent = `${time} — ${text}`;
    pasteLogList.prepend(row);
    while (pasteLogList.children.length > 8) pasteLogList.removeChild(pasteLogList.lastChild);
  }

  // The candidate's tab visibility (switched away / came back) is a useful,
  // low-friction signal for the interviewer — not proctoring-grade, just a
  // heads up, same spirit as the paste flag.
  if (role === 'candidate') {
    document.addEventListener('visibilitychange', () => {
      broadcast({ type: 'visibility', hidden: document.hidden, at: Date.now() });
    });
  }

  // ---------- Feedback pane (interviewer only) ----------
  const feedbackPane = document.getElementById('feedbackPane');
  const feedbackScoresEl = document.getElementById('feedbackScores');
  const feedbackSummary = document.getElementById('feedbackSummary');
  const verdictBadge = document.getElementById('verdictBadge');
  const FEEDBACK_CATEGORIES = ['Problem solving', 'Coding', 'Communication'];
  const feedbackScores = {};
  let currentVerdict = null;
  let candidateDisplayName = '';

  function buildSessionSummary() {
    const lines = [`MockMate session — room ${room}`, `Date: ${new Date().toLocaleString()}`];
    if (candidateDisplayName) lines.push(`Candidate: ${candidateDisplayName}`);
    if (startTime) {
      const mins = Math.round((Date.now() - startTime) / 60000);
      lines.push(`Duration: ${mins} min`);
    }
    if (currentMeta.difficulty) {
      lines.push(`Question: ${currentMeta.difficulty}`);
    }
    lines.push('');
    FEEDBACK_CATEGORIES.forEach(cat => {
      lines.push(`${cat}: ${feedbackScores[cat] ? feedbackScores[cat] + '/4' : 'not rated'}`);
    });
    lines.push('');
    lines.push(`Overall: ${currentVerdict === 'pass' ? 'Pass' : currentVerdict === 'fail' ? 'No pass' : 'Not set'}`);
    const summary = feedbackSummary.value.trim();
    if (summary) { lines.push(''); lines.push('Summary:'); lines.push(summary); }
    if (questionArea.value.trim()) {
      lines.push('');
      lines.push('Question:');
      lines.push(questionArea.value.trim());
    }
    lines.push('');
    lines.push(`Final code (${LANGS[langSelect.value].label}):`);
    lines.push(editor.getValue());
    return {
      text: lines.join('\n'),
      record: {
        date: new Date().toISOString(),
        room,
        candidateName: candidateDisplayName || null,
        durationMin: startTime ? Math.round((Date.now() - startTime) / 60000) : null,
        difficulty: currentMeta.difficulty || null,
        scores: { ...feedbackScores },
        verdict: currentVerdict,
        summary: summary || null,
        questionSnippet: questionArea.value.trim().slice(0, 140),
      },
    };
  }

  function saveSessionToHistory() {
    if (role !== 'interviewer') return;
    const { record } = buildSessionSummary();
    const hasContent = record.verdict || record.summary || Object.keys(record.scores).length > 0;
    if (!hasContent) return; // nothing happened yet — don't clutter history
    try {
      const existing = JSON.parse(localStorage.getItem('mockmate-history') || '[]');
      existing.unshift(record);
      localStorage.setItem('mockmate-history', JSON.stringify(existing.slice(0, 50)));
    } catch {}
  }

  document.getElementById('leaveLink').addEventListener('click', e => {
    if (role !== 'interviewer') return;
    saveSessionToHistory();
  });

  if (role !== 'interviewer') {
    feedbackPane.classList.add('hidden');
  } else {
    feedbackPane.classList.remove('hidden');
    FEEDBACK_CATEGORIES.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'feedback-category';
      const label = document.createElement('span');
      label.className = 'feedback-category-label';
      label.textContent = cat;
      row.appendChild(label);
      const scale = document.createElement('div');
      scale.className = 'feedback-scale';
      [1, 2, 3, 4].forEach(n => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(n);
        b.addEventListener('click', () => {
          feedbackScores[cat] = n;
          scale.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        });
        scale.appendChild(b);
      });
      row.appendChild(scale);
      feedbackScoresEl.appendChild(row);
    });

    document.getElementById('passBtn').addEventListener('click', () => setVerdict('pass'));
    document.getElementById('failBtn').addEventListener('click', () => setVerdict('fail'));
    document.getElementById('clearVerdictBtn').addEventListener('click', () => setVerdict(null));

    document.getElementById('copyFeedbackBtn').addEventListener('click', async e => {
      const { text } = buildSessionSummary();
      const btn = e.currentTarget;
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        window.prompt('Copy this summary:', text);
      }
      setTimeout(() => { btn.textContent = original; }, 1800);
    });

    document.getElementById('resetRoomBtn').addEventListener('click', () => {
      if (!confirm('Reset the room for the next candidate? This clears the code, question, test cases, and feedback, and disconnects the current candidate.')) return;
      saveSessionToHistory();
      if (dataConn) {
        dataConn.send({ type: 'kicked' });
        dataConn.close();
        dataConn = null;
      }
      updateEndAccessVisibility();

      suppressEmit = true;
      editor.setValue('# Write code here — it syncs live with your peer\ndef two_sum(nums, target):\n    pass\n');
      suppressEmit = false;
      langSelect.value = 'python';
      editor.setOption('mode', LANGS.python.cmMode);
      outputPane.textContent = 'Output shows up here once you run your code.';

      questionArea.value = '';
      questionVisible = false;
      revealBtn.textContent = 'Show to candidate';
      revealBtn.classList.remove('active');
      currentMeta = { difficulty: '' };
      setDifficultyButtonsActive('');
      renderQuestionBadges(currentMeta);

      testCases = [];
      renderTestcases();

      solutionArea.value = '';
      pasteLogList.innerHTML = '<div class="paste-log-empty">No activity yet.</div>';

      FEEDBACK_CATEGORIES.forEach(cat => delete feedbackScores[cat]);
      feedbackScoresEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      feedbackSummary.value = '';
      setVerdict(null);

      startTimer(Date.now());
      setConnStatus('waiting for peer', 'waiting');
    });
  }

  function setVerdict(value, fromPeer) {
    currentVerdict = value;
    if (value === 'pass') {
      verdictBadge.textContent = 'Pass';
      verdictBadge.className = 'verdict-badge pass';
    } else if (value === 'fail') {
      verdictBadge.textContent = 'No pass';
      verdictBadge.className = 'verdict-badge fail';
    } else {
      verdictBadge.className = 'verdict-badge hidden';
    }
    if (!fromPeer) broadcast({ type: 'verdict', value });
  }

  // ---------- In-room invite link (interviewer only) ----------
  const copyRoomLinkBtn = document.getElementById('copyRoomLink');
  if (role === 'interviewer') {
    copyRoomLinkBtn.classList.remove('hidden');
    copyRoomLinkBtn.addEventListener('click', async () => {
      const base = window.location.href.replace(/interview\.html.*$/, '').replace(/\/$/, '');
      const link = `${base}/interview.html?room=${encodeURIComponent(room)}&role=candidate`;
      const original = copyRoomLinkBtn.textContent;
      try {
        await navigator.clipboard.writeText(link);
        copyRoomLinkBtn.textContent = 'Copied';
      } catch {
        window.prompt('Copy this link:', link);
      }
      setTimeout(() => { copyRoomLinkBtn.textContent = original; }, 1800);
    });
  }

  // ---------- Resizable side panel ----------
  const mainLayout = document.querySelector('.main-layout');
  const resizeHandle = document.getElementById('resizeHandle');
  const sidePane = document.getElementById('sidePane');

  function applySidebarWidth(px) {
    mainLayout.style.gridTemplateColumns = `1fr 6px ${px}px`;
  }

  if (window.innerWidth > 820) {
    try {
      const saved = localStorage.getItem('mockmate-sidebar-width');
      if (saved) applySidebarWidth(parseInt(saved, 10));
    } catch {}
  }

  let resizing = false;
  resizeHandle.addEventListener('mousedown', e => {
    resizing = true;
    resizeHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!resizing) return;
    const rect = mainLayout.getBoundingClientRect();
    const width = Math.min(Math.max(rect.right - e.clientX, 260), 600);
    applySidebarWidth(Math.round(width));
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.userSelect = '';
    try {
      localStorage.setItem('mockmate-sidebar-width', String(Math.round(sidePane.getBoundingClientRect().width)));
    } catch {}
  });

  // ---------- PeerJS: signaling + data ----------
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');
  const waitingOverlay = document.getElementById('waitingOverlay');
  const waitingText = document.getElementById('waitingText');

  function setConnStatus(text, state) {
    connText.textContent = text;
    connDot.classList.toggle('connected', state === 'connected');
    connDot.classList.toggle('waiting', state === 'waiting');
    // The candidate sees a blank waiting screen instead of the editor until
    // actually admitted — nothing to read or interact with while waiting.
    if (role === 'candidate') {
      waitingOverlay.classList.toggle('hidden', admitted);
      mainLayoutEl.classList.toggle('hidden', !admitted);
      waitingText.textContent = text;
    }
  }

  const mainLayoutEl = document.querySelector('.main-layout');
  if (role === 'candidate') {
    waitingOverlay.classList.remove('hidden');
    mainLayoutEl.classList.add('hidden');
  }

  // Public STUN-only ICE often fails to establish a path across two different
  // networks (symmetric NAT, campus/corporate firewalls). Add a TURN relay as
  // a fallback so the data channel can still connect in those cases.
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];

  const peerId = role === 'interviewer' ? `mockmate-${room}` : `mockmate-${room}-${Math.random().toString(36).slice(2, 8)}`;
  const peer = new Peer(peerId, { config: { iceServers } });

  // dataConn is only set once the interviewer has actually admitted the
  // candidate — broadcast() (and everyone's UI) treats "connected" as
  // "admitted", not just "the data channel happens to be open".
  let dataConn = null;
  let admitted = role === 'interviewer'; // the interviewer doesn't need admitting
  let pendingConn = null; // interviewer: a connection waiting on a decision
  let deniedPermanently = false; // candidate: interviewer explicitly said no — stop auto-retrying

  function broadcast(msg) {
    if (dataConn && dataConn.open && admitted) dataConn.send(msg);
  }

  const admitBanner = document.getElementById('admitBanner');
  const admitBannerText = document.getElementById('admitBannerText');

  function sendFullState(conn) {
    conn.send({ type: 'timer-sync', startTime });
    conn.send({ type: 'question', value: questionArea.value, visible: questionVisible });
    conn.send({ type: 'meta', value: currentMeta });
    conn.send({ type: 'testcases', value: testCases.map(tc => ({ input: tc.input, expected: tc.expected })) });
    conn.send({ type: 'code', value: editor.getValue() });
    conn.send({ type: 'lang', value: langSelect.value });
    conn.send({ type: 'verdict', value: currentVerdict });
  }

  const endAccessBtn = document.getElementById('endAccessBtn');
  function updateEndAccessVisibility() {
    if (role !== 'interviewer') return;
    endAccessBtn.classList.toggle('hidden', !(dataConn && dataConn.open));
  }

  if (role === 'interviewer') {
    document.getElementById('admitBtn').addEventListener('click', () => {
      if (!pendingConn) return;
      const conn = pendingConn;
      pendingConn = null;
      admitBanner.classList.add('hidden');
      dataConn = conn;
      conn.send({ type: 'admitted' });
      conn.send({ type: 'hello', name: myName, role });
      sendFullState(conn);
      setConnStatus('connected', 'connected');
      updateEndAccessVisibility();
    });
    document.getElementById('denyBtn').addEventListener('click', () => {
      if (!pendingConn) return;
      pendingConn.send({ type: 'denied' });
      pendingConn.close();
      pendingConn = null;
      admitBanner.classList.add('hidden');
      setConnStatus('waiting for peer', 'waiting');
    });
    endAccessBtn.addEventListener('click', () => {
      if (!dataConn) return;
      dataConn.send({ type: 'kicked' });
      dataConn.close();
      dataConn = null;
      setConnStatus('waiting for peer', 'waiting');
      updateEndAccessVisibility();
    });
  }

  function watchConnectionHealth(conn) {
    const pc = conn.peerConnection;
    if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') {
        setConnStatus('connection failed — likely blocked by a firewall/VPN on one side', 'error');
      } else if (pc.iceConnectionState === 'disconnected') {
        setConnStatus('connection dropped, trying to recover…', 'waiting');
      } else if ((pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') && conn.open) {
        setConnStatus('connected', 'connected');
      }
    });
  }

  function wireDataConn(conn) {
    watchConnectionHealth(conn);
    conn.on('open', () => {
      if (role === 'candidate') {
        // Don't treat the raw channel as "connected" — wait for the
        // interviewer to actually admit us before syncing anything.
        dataConn = conn;
        admitted = false;
        editor.setOption('readOnly', true);
        setConnStatus('waiting for the interviewer to let you in…', 'waiting');
        conn.send({ type: 'join-request', name: myName });
      } else {
        // Interviewer: a new connection is just a knock — hold it until
        // admitted/denied. If someone's already in, auto-deny extras.
        if (dataConn && dataConn.open) {
          conn.send({ type: 'denied', reason: 'occupied' });
          conn.close();
          return;
        }
        pendingConn = conn;
      }
    });
    conn.on('data', msg => handleData(msg, conn));
    conn.on('close', () => {
      if (conn === dataConn) {
        setConnStatus('peer disconnected', 'idle');
        clearRemoteCursor();
        dataConn = null;
        admitted = role === 'interviewer';
        updateEndAccessVisibility();
        if (role === 'candidate' && !deniedPermanently) {
          editor.setOption('readOnly', true);
          setTimeout(connectToHost, 1500);
        }
      } else if (conn === pendingConn) {
        pendingConn = null;
        admitBanner.classList.add('hidden');
      }
    });
    conn.on('error', err => {
      console.error('data connection error', err);
      setConnStatus('connection error — try refreshing both windows', 'error');
    });
  }

  function handleData(msg, conn) {
    switch (msg.type) {
      case 'join-request':
        if (role !== 'interviewer') break;
        remoteName = `${msg.name} (candidate)`;
        candidateDisplayName = msg.name;
        admitBannerText.textContent = `${msg.name} wants to join the room.`;
        admitBanner.classList.remove('hidden');
        setConnStatus(`${msg.name} is waiting to be let in`, 'waiting');
        break;
      case 'admitted':
        admitted = true;
        editor.setOption('readOnly', false);
        setConnStatus('connected', 'connected');
        break;
      case 'denied':
        editor.setOption('readOnly', true);
        deniedPermanently = msg.reason !== 'occupied';
        setConnStatus(
          msg.reason === 'occupied'
            ? 'this room already has a candidate connected'
            : "the interviewer didn't let you in — check with them and refresh to try again",
          'error'
        );
        break;
      case 'kicked':
        editor.setOption('readOnly', true);
        deniedPermanently = true;
        admitted = false;
        setConnStatus('the interviewer ended your access — refresh to ask again', 'error');
        break;
      case 'hello':
        remoteName = `${msg.name} (${msg.role})`;
        break;
      case 'cursor':
        showRemoteCursor(msg.line, msg.ch, msg.sel);
        break;
      case 'code':
        suppressEmit = true;
        const cursor = editor.getCursor();
        editor.setValue(msg.value);
        editor.setCursor(cursor);
        suppressEmit = false;
        break;
      case 'lang':
        langSelect.value = msg.value;
        editor.setOption('mode', LANGS[msg.value].cmMode);
        break;
      case 'timer-sync':
        if (role === 'candidate') startTimer(msg.startTime);
        break;
      case 'question':
        suppressQuestionEmit = true;
        if (msg.visible) {
          questionArea.value = msg.value;
          if (role === 'candidate') candidateHiddenNote.classList.add('hidden');
        } else if (role === 'candidate') {
          questionArea.value = '';
          candidateHiddenNote.classList.remove('hidden');
        }
        suppressQuestionEmit = false;
        break;
      case 'testcases':
        testCases = (msg.value || []).map(tc => ({ input: tc.input, expected: tc.expected }));
        renderTestcases();
        break;
      case 'meta':
        currentMeta = msg.value || { difficulty: '' };
        renderQuestionBadges(currentMeta);
        break;
      case 'paste-flag':
        if (role === 'interviewer') logActivityEvent(`candidate pasted ${msg.chars} characters`, msg.at);
        break;
      case 'visibility':
        if (role === 'interviewer') {
          logActivityEvent(msg.hidden ? 'candidate switched away from the tab' : 'candidate came back to the tab', msg.at);
        }
        break;
      case 'verdict':
        setVerdict(msg.value, true);
        break;
    }
  }

  let connectAttempts = 0;
  function connectToHost() {
    const hostId = `mockmate-${room}`;
    setConnStatus(connectAttempts === 0 ? 'connecting…' : 'waiting for the interviewer to join…', 'waiting');
    const conn = peer.connect(hostId, { reliable: true });
    // Wire listeners immediately, synchronously — PeerJS's 'open' event is a
    // one-time EventEmitter emission (confirmed in vendor/peerjs source:
    // `this._open = true; this.emit("open")`), so a listener attached later,
    // e.g. inside a `conn.on('open', () => wireDataConn(conn))` wrapper,
    // would silently never fire if 'open' already happened. wireDataConn
    // itself registers the real 'open' handler, so it must be called before
    // that event can possibly fire, not after.
    wireDataConn(conn);
  }

  peer.on('open', () => {
    if (role === 'candidate') {
      connectToHost();
    } else {
      setConnStatus('waiting for peer', 'waiting');
    }
  });

  peer.on('connection', conn => {
    wireDataConn(conn);
  });

  peer.on('disconnected', () => {
    setConnStatus('lost connection to server, reconnecting…', 'waiting');
    peer.reconnect();
  });

  peer.on('error', err => {
    console.error('peer error', err);
    if (err.type === 'peer-unavailable' && role === 'candidate') {
      // The interviewer hasn't opened their room yet (or refreshed). Keep
      // retrying rather than dead-ending — joining via the invite link
      // before the interviewer is in the room is an expected flow.
      connectAttempts++;
      const delay = Math.min(2000 + connectAttempts * 500, 5000);
      setTimeout(connectToHost, delay);
      setConnStatus('waiting for the interviewer to let you in…', 'waiting');
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      setConnStatus('trouble reaching the signaling server — check your connection', 'error');
    } else if (err.type === 'unavailable-id') {
      setConnStatus('this room code is already in use — go back and create a new one', 'error');
    }
  });

  // If the data channel never opens (common when both sides are behind
  // restrictive NATs and even the TURN relay can't negotiate), surface that
  // instead of leaving the status stuck on a silent "connecting…".
  setTimeout(() => {
    if (dataConn && dataConn.open) return;
    if (role === 'candidate' && connectAttempts > 0) return; // already showing "waiting for the interviewer"
    setConnStatus(
      role === 'candidate'
        ? 'still trying to connect — this can take longer on some networks'
        : 'still waiting for your candidate to connect',
      'waiting'
    );
  }, 12000);
})();
