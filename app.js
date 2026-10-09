(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || 'ROOM01').toUpperCase();
  const role = params.get('role') === 'interviewer' ? 'interviewer' : 'candidate';
  // A candidate arriving from an invite link has no name yet; they're asked
  // for one before knocking (see the name form near the PeerJS section).
  let myName = (params.get('name') || '').trim() || (role === 'interviewer' ? 'Interviewer' : '');

  document.getElementById('roomChip').textContent = room;
  if (role === 'candidate') {
    document.getElementById('connText').textContent = 'Not connected yet';
    document.getElementById('timer').classList.add('hidden'); // shown once the interviewer's clock syncs
  }
  const inviteLink = `${window.location.href.replace(/interview\.html.*$/, '').replace(/\/$/, '')}/interview.html?room=${encodeURIComponent(room)}&role=candidate`;

  async function copyText(text, btn, doneLabel) {
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = doneLabel || 'Copied';
    } catch {
      window.prompt('Copy this:', text);
    }
    setTimeout(() => { btn.textContent = original; }, 1800);
  }

  // ---------- Sidebar tabs ----------
  const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
  if (role === 'interviewer') {
    // Only the interviewer sees Notes (solution/paste-activity) and
    // Feedback — both default to hidden in the markup.
    document.getElementById('notesTabBtn').classList.remove('hidden');
    document.getElementById('feedbackTabBtn').classList.remove('hidden');
  }
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      tabPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
    });
  });

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
  const INDENT = 4;
  const DEFAULT_PY_STARTER = '# Write code here — it syncs live with your peer\ndef two_sum(nums, target):\n    pass\n';

  // Python treats a tab and four spaces as different indentation, so a
  // literal tab next to space-indented lines is a TabError (or silently the
  // wrong block). Everything below keeps the buffer spaces-only.
  function leadingWidth(s) {
    let w = 0;
    for (const ch of s) {
      if (ch === ' ') w++;
      else if (ch === '\t') w += INDENT - (w % INDENT);
      else break;
    }
    return w;
  }
  function expandLeadingTabs(line) {
    const m = line.match(/^[ \t]*/)[0];
    return m.includes('\t') ? ' '.repeat(leadingWidth(m)) + line.slice(m.length) : line;
  }

  // Tab: indent the selection, or pad the cursor to the next indent stop.
  function smartTab(cm) {
    if (cm.somethingSelected()) {
      const multiLine = cm.listSelections().some(r => r.anchor.line !== r.head.line);
      if (multiLine) { cm.indentSelection('add'); return; }
    }
    cm.replaceSelections(cm.listSelections().map(r => {
      const ch = Math.min(r.anchor.ch, r.head.ch);
      return ' '.repeat(INDENT - (ch % INDENT));
    }));
  }

  // Backspace inside leading whitespace removes a whole indent level, so
  // deleting an indent is one keystroke, same as adding one.
  function smartBackspace(cm) {
    if (cm.somethingSelected()) return CodeMirror.Pass;
    const ranges = cm.listSelections();
    const allInIndent = ranges.every(r => {
      const before = cm.getLine(r.head.line).slice(0, r.head.ch);
      return r.head.ch > 0 && /^ +$/.test(before);
    });
    if (!allInIndent) return CodeMirror.Pass;
    cm.operation(() => {
      for (let i = ranges.length - 1; i >= 0; i--) {
        const { line, ch } = ranges[i].head;
        const target = Math.floor((ch - 1) / INDENT) * INDENT;
        cm.replaceRange('', { line, ch: target }, { line, ch }, '+delete');
      }
    });
  }

  const editor = CodeMirror.fromTextArea(document.getElementById('codeArea'), {
    mode: LANGS.python.cmMode,
    theme: 'onsite',
    lineNumbers: true,
    tabSize: INDENT,
    indentUnit: INDENT,
    indentWithTabs: false,
    smartIndent: true,
    electricChars: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    readOnly: role === 'candidate', // locked until the interviewer admits them
    value: '',
    extraKeys: {
      'Tab': smartTab,
      'Shift-Tab': 'indentLess',
      'Backspace': smartBackspace,
      'Cmd-]': 'indentMore',
      'Ctrl-]': 'indentMore',
      'Cmd-[': 'indentLess',
      'Ctrl-[': 'indentLess',
      'Cmd-Enter': () => runOrTest(),
      'Ctrl-Enter': () => runOrTest(),
      'Shift-Alt-F': () => formatCode(),
      'Cmd-Shift-F': () => formatCode(),
      'Ctrl-Shift-F': () => formatCode(),
      'Cmd-/': 'toggleComment',
      'Ctrl-/': 'toggleComment',
    },
  });
  editor.setValue(DEFAULT_PY_STARTER);
  editor.clearHistory();

  // Indent guides: a faint vertical rule at each indent level of a line's
  // leading whitespace, so block structure (which *is* the syntax in
  // Python) is visible at a glance.
  editor.addOverlay({
    token(stream) {
      const lead = stream.string.match(/^ */)[0].length;
      const start = stream.pos;
      if (start < lead && start % INDENT === 0 && stream.match(' '.repeat(INDENT))) {
        return start > 0 ? 'indent-guide' : null; // column 0 sits on the gutter edge
      }
      stream.skipToEnd();
      return null;
    },
  });

  // Re-indent multi-line pastes so the block lands at the cursor's indent
  // level (keeping its internal structure), and expand any tabs in it.
  editor.on('beforeChange', (cm, change) => {
    if (change.origin !== 'paste' || !change.update) return;
    let lines = change.text.map(expandLeadingTabs);
    const prefix = cm.getLine(change.from.line).slice(0, change.from.ch);
    if (lines.length > 1 && /^ *$/.test(prefix)) {
      const target = prefix.length;
      const rest = lines.slice(1).filter(l => l.trim());
      const minRest = rest.length ? Math.min(...rest.map(leadingWidth)) : 0;
      // The first line's original indent is only known when the copy
      // started at the beginning of the line; otherwise infer it from the
      // lines after it (one level shallower if it opens a block).
      let firstIndent;
      if (/^\s/.test(lines[0]) || !rest.length) firstIndent = leadingWidth(lines[0]);
      else if (/[:{(\[]\s*(#.*)?$/.test(lines[0])) firstIndent = Math.max(0, minRest - INDENT);
      else firstIndent = minRest;
      const delta = target - firstIndent;
      lines = lines.map((l, i) => {
        if (i === 0) return l.replace(/^ */, '');
        if (!l.trim()) return '';
        const w = leadingWidth(l);
        return ' '.repeat(Math.max(0, w + delta)) + l.slice(l.match(/^ */)[0].length);
      });
    }
    change.update(change.from, change.to, lines);
  });

  const langSelect = document.getElementById('langSelect');
  langSelect.addEventListener('change', () => {
    editor.setOption('mode', LANGS[langSelect.value].cmMode);
    broadcast({ type: 'lang', value: langSelect.value });
    saveRoomStateSoon();
  });

  // Edits go to the peer as range replacements rather than the whole
  // document, so the receiver's cursor, scroll position, and undo history
  // stay intact. Each message also carries the full resulting text, so a
  // receiver can tell when both sides typed at once and reconcile (see
  // applyRemoteCode).
  let suppressEmit = false;
  let pendingOps = [];
  let opFlushScheduled = false;
  function flushCodeOps() {
    opFlushScheduled = false;
    if (!pendingOps.length) return;
    broadcast({ type: 'code-ops', ops: pendingOps, value: editor.getValue() });
    pendingOps = [];
  }
  editor.on('change', (cm, changeObj) => {
    if (suppressEmit) return;
    // Plain objects only — PeerJS's binary serializer rejects class
    // instances like CodeMirror's Pos.
    pendingOps.push({
      from: { line: changeObj.from.line, ch: changeObj.from.ch },
      to: { line: changeObj.to.line, ch: changeObj.to.ch },
      text: changeObj.text.slice(),
    });
    if (!opFlushScheduled) {
      opFlushScheduled = true;
      Promise.resolve().then(flushCodeOps);
    }

    // Flag large pastes from the candidate so the interviewer has a
    // low-friction signal, without capturing clipboard content itself.
    if (role === 'candidate' && changeObj.origin === 'paste') {
      const pastedLen = (changeObj.text || []).join('\n').length;
      if (pastedLen > 40) {
        broadcast({ type: 'paste-flag', chars: pastedLen, at: Date.now() });
      }
    }
  });

  function applyRemoteCode(ops, value) {
    suppressEmit = true;
    try {
      if (ops) {
        editor.operation(() => {
          ops.forEach(op => editor.replaceRange(op.text.join('\n'), op.from, op.to, 'remote'));
        });
      }
      if (editor.getValue() !== value) {
        // Both sides edited at once. The interviewer's copy is the
        // tiebreaker: it keeps its best-effort merge (the peer's ops applied
        // on top of its own edit) and sends that back; the candidate adopts
        // whatever the interviewer sends.
        if (ops && role === 'interviewer') {
          broadcast({ type: 'code', value: editor.getValue() });
          return;
        }
        const cursor = editor.getCursor();
        const scroll = editor.getScrollInfo();
        editor.setValue(value);
        editor.setCursor(clampPos(cursor.line, cursor.ch));
        editor.scrollTo(scroll.left, scroll.top);
      }
    } finally {
      suppressEmit = false;
    }
  }

  // Replaces the whole buffer as one undoable edit (unlike setValue, which
  // the peer would see as a full rewrite and which jumps the cursor).
  function replaceAllCode(text) {
    const cursor = editor.getCursor();
    const scroll = editor.getScrollInfo();
    const last = editor.lastLine();
    editor.replaceRange(text, { line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length }, '+format');
    editor.setCursor(clampPos(cursor.line, cursor.ch));
    editor.scrollTo(scroll.left, scroll.top);
  }

  // ---------- Format code ----------
  // Real formatters compiled to WebAssembly, loaded on first use: Ruff
  // (Black-compatible) for Python, clang-format for C++/Java/JavaScript.
  // Both reject code that doesn't parse rather than guessing, so a syntax
  // error is reported instead of silently mangling the code.
  const formatterCache = {};
  function loadFormatter(kind) {
    if (!formatterCache[kind]) {
      formatterCache[kind] = (async () => {
        if (kind === 'ruff') {
          const mod = await import('./vendor/ruff-fmt/ruff_fmt_web.js');
          await mod.default(new URL('vendor/ruff-fmt/ruff_fmt_bg.wasm', document.baseURI));
          return mod;
        }
        const mod = await import('./vendor/clang-format/clang-format-web.js');
        await mod.default(new URL('vendor/clang-format/clang-format.wasm', document.baseURI));
        return mod;
      })();
      formatterCache[kind].catch(() => { delete formatterCache[kind]; });
    }
    return formatterCache[kind];
  }

  const CLANG_STYLE = '{BasedOnStyle: Google, IndentWidth: 4, ContinuationIndentWidth: 4, AccessModifierOffset: -4, ColumnLimit: 100, AllowShortIfStatementsOnASingleLine: false, AllowShortLoopsOnASingleLine: false, AllowShortFunctionsOnASingleLine: Empty}';
  const CLANG_FILENAMES = { cpp: 'main.cpp', java: 'Main.java', javascript: 'main.js' };

  // Byte offset (UTF-8, as Ruff reports it) -> 1-based line number.
  function lineAtByte(text, byteOffset) {
    const bytes = new TextEncoder().encode(text).slice(0, byteOffset);
    return new TextDecoder().decode(bytes).split('\n').length;
  }

  // Last resort when a formatter can't load (offline, very old browser):
  // whitespace-only cleanup that can't change what the code means.
  function basicCleanup(text) {
    return text
      .split('\n')
      .map(l => expandLeadingTabs(l).replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*$/, '\n');
  }

  const formatBtn = document.getElementById('formatCodeBtn');
  let formatting = false;
  async function formatCode() {
    if (formatting || editor.getOption('readOnly')) return;
    const lang = langSelect.value;
    const source = editor.getValue();
    if (!source.trim()) return;
    formatting = true;
    formatBtn.disabled = true;
    formatBtn.textContent = 'Formatting…';
    let result = null;
    let note = '';
    try {
      if (lang === 'python') {
        const ruff = await loadFormatter('ruff');
        const input = source.split('\n').map(expandLeadingTabs).join('\n');
        try {
          result = ruff.format(input, undefined, { indent_width: INDENT, line_width: 88 });
        } catch (e) {
          const msg = String(e && e.message || e);
          const m = msg.match(/byte range (\d+)\.\./);
          const where = m ? ` (line ${lineAtByte(input, +m[1])})` : '';
          note = `Format skipped — Python syntax error${where}: ${msg.replace(/ at byte range.*$/, '')}`;
        }
      } else {
        const clang = await loadFormatter('clang');
        result = clang.format(source, CLANG_FILENAMES[lang], CLANG_STYLE);
      }
    } catch (e) {
      console.warn('formatter unavailable, falling back to whitespace cleanup', e);
      result = basicCleanup(source);
      note = 'Full formatter unavailable — only cleaned up whitespace.';
    } finally {
      formatting = false;
      formatBtn.disabled = false;
      formatBtn.textContent = 'Format';
    }
    // The buffer may have changed (peer typing) while the formatter loaded.
    if (result !== null && editor.getValue() === source && result !== source) replaceAllCode(result);
    if (note) setOutput(note);
  }
  formatBtn.addEventListener('click', formatCode);

  // ---------- Editor settings (per viewer, never synced) ----------
  const settingsBtn = document.getElementById('editorSettingsBtn');
  const settingsMenu = document.getElementById('editorSettingsMenu');
  const fontSizeOut = document.getElementById('fontSizeOut');
  const FONT_MIN = 11;
  const FONT_MAX = 22;
  let editorPrefs = { fontSize: 14, theme: 'dark' };
  try { editorPrefs = { ...editorPrefs, ...JSON.parse(localStorage.getItem('onsite-editor-prefs') || '{}') }; } catch {}

  function applyEditorPrefs() {
    editorPrefs.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, +editorPrefs.fontSize || 14));
    document.documentElement.style.setProperty('--code-size', editorPrefs.fontSize + 'px');
    document.body.classList.toggle('editor-light', editorPrefs.theme === 'light');
    fontSizeOut.textContent = String(editorPrefs.fontSize);
    document.getElementById('fontDownBtn').disabled = editorPrefs.fontSize <= FONT_MIN;
    document.getElementById('fontUpBtn').disabled = editorPrefs.fontSize >= FONT_MAX;
    settingsMenu.querySelectorAll('[data-editor-theme]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.editorTheme === editorPrefs.theme));
    });
    editor.refresh();
    try { localStorage.setItem('onsite-editor-prefs', JSON.stringify(editorPrefs)); } catch {}
  }

  function setSettingsOpen(open) {
    settingsMenu.classList.toggle('hidden', !open);
    settingsBtn.setAttribute('aria-expanded', String(open));
    settingsBtn.classList.toggle('active', open);
  }
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    setSettingsOpen(settingsMenu.classList.contains('hidden'));
  });
  settingsMenu.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => setSettingsOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !settingsMenu.classList.contains('hidden')) {
      setSettingsOpen(false);
      settingsBtn.focus();
    }
  });
  document.getElementById('fontDownBtn').addEventListener('click', () => { editorPrefs.fontSize--; applyEditorPrefs(); });
  document.getElementById('fontUpBtn').addEventListener('click', () => { editorPrefs.fontSize++; applyEditorPrefs(); });
  settingsMenu.querySelectorAll('[data-editor-theme]').forEach(b => {
    b.addEventListener('click', () => { editorPrefs.theme = b.dataset.editorTheme; applyEditorPrefs(); });
  });
  applyEditorPrefs();

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

  // ---------- Whiteboard (shared object-based canvas — either side can draw) ----------
  const whiteboardWrap = document.getElementById('whiteboardWrap');
  const wbCanvasWrap = document.querySelector('.wb-canvas-wrap');
  const wbCanvas = document.getElementById('wbCanvas');
  const wbCtx = wbCanvas.getContext('2d');
  const whiteboardToggle = document.getElementById('whiteboardToggle');

  let mode = 'code';
  let wbObjects = []; // {id, type: path|erase|rect|ellipse|line|arrow|text, color, width, ...geometry} in world units
  let wbTool = 'select';
  let wbColor = '#1C222A';
  let wbWidth = 2.5;
  let wbSelectedId = null;
  let wbView = { panX: 0, panY: 0, zoom: 1 };

  let wbDrawing = false;
  let wbActiveObj = null;
  let wbDragMode = null; // 'move' | 'resize:<handleKey>' | null
  let wbDragStart = null;
  let wbDragOrig = null;
  let wbUndoStack = [];
  let wbRedoStack = [];
  let wbPendingUndoSnapshot = null;

  function wbSnapshot() { return JSON.parse(JSON.stringify(wbObjects)); }
  function wbBeginAction() { wbPendingUndoSnapshot = wbSnapshot(); }
  function wbCommitAction() {
    if (!wbPendingUndoSnapshot) return;
    wbUndoStack.push(wbPendingUndoSnapshot);
    if (wbUndoStack.length > 100) wbUndoStack.shift();
    wbRedoStack = [];
    wbPendingUndoSnapshot = null;
  }
  function wbUndo() {
    if (!wbUndoStack.length) return;
    wbRedoStack.push(wbSnapshot());
    wbObjects = wbUndoStack.pop();
    wbSelectedId = null;
    redrawWhiteboard();
    broadcast({ type: 'wb-sync', objects: wbObjects });
  }
  function wbRedo() {
    if (!wbRedoStack.length) return;
    wbUndoStack.push(wbSnapshot());
    wbObjects = wbRedoStack.pop();
    wbSelectedId = null;
    redrawWhiteboard();
    broadcast({ type: 'wb-sync', objects: wbObjects });
  }

  function worldToScreen(x, y) { return { x: x * wbView.zoom + wbView.panX, y: y * wbView.zoom + wbView.panY }; }
  function screenToWorld(x, y) { return { x: (x - wbView.panX) / wbView.zoom, y: (y - wbView.panY) / wbView.zoom }; }
  function pointerWorld(e) {
    const rect = wbCanvas.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  function applyWbTransform() {
    const dpr = window.devicePixelRatio || 1;
    wbCtx.setTransform(dpr * wbView.zoom, 0, 0, dpr * wbView.zoom, dpr * wbView.panX, dpr * wbView.panY);
  }

  function resizeWbCanvas() {
    const rect = wbCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    wbCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    wbCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    applyWbTransform();
    redrawWhiteboard();
  }

  function objectBounds(o) {
    if (o.type === 'path' || o.type === 'erase') {
      const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    if (o.type === 'text') {
      const lines = (o.text || '').split('\n');
      const w = Math.max(40, Math.max(...lines.map(l => l.length)) * o.fontSize * 0.6);
      const h = o.fontSize * 1.3 * lines.length;
      return { x1: o.x, y1: o.y, x2: o.x + w, y2: o.y + h };
    }
    return { x1: Math.min(o.x1, o.x2), y1: Math.min(o.y1, o.y2), x2: Math.max(o.x1, o.x2), y2: Math.max(o.y1, o.y2) };
  }

  function objectContains(o, x, y) {
    const b = objectBounds(o);
    const pad = 6 / wbView.zoom;
    return x >= b.x1 - pad && x <= b.x2 + pad && y >= b.y1 - pad && y <= b.y2 + pad;
  }

  function hitTest(x, y) {
    for (let i = wbObjects.length - 1; i >= 0; i--) {
      if (objectContains(wbObjects[i], x, y)) return wbObjects[i];
    }
    return null;
  }

  function getHandles(o) {
    if (o.type === 'line' || o.type === 'arrow') return [{ x: o.x1, y: o.y1, key: 'p1' }, { x: o.x2, y: o.y2, key: 'p2' }];
    if (o.type === 'rect' || o.type === 'ellipse') return [{ x: o.x2, y: o.y2, key: 'br' }];
    return [];
  }

  function applyMove(obj, orig, dx, dy) {
    if (obj.type === 'path' || obj.type === 'erase') {
      obj.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else if (obj.type === 'text') {
      obj.x = orig.x + dx; obj.y = orig.y + dy;
    } else {
      obj.x1 = orig.x1 + dx; obj.y1 = orig.y1 + dy; obj.x2 = orig.x2 + dx; obj.y2 = orig.y2 + dy;
    }
  }
  function applyResize(obj, key, w) {
    if (key === 'br' || key === 'p2') { obj.x2 = w.x; obj.y2 = w.y; }
    else if (key === 'p1') { obj.x1 = w.x; obj.y1 = w.y; }
  }
  function extractGeom(obj) {
    if (obj.type === 'path' || obj.type === 'erase') return { points: obj.points };
    if (obj.type === 'text') return { x: obj.x, y: obj.y };
    return { x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 };
  }

  function drawObject(obj) {
    wbCtx.strokeStyle = obj.color;
    wbCtx.fillStyle = obj.color;
    wbCtx.lineWidth = obj.width || 2.5;
    wbCtx.lineCap = 'round';
    wbCtx.lineJoin = 'round';
    wbCtx.globalCompositeOperation = obj.type === 'erase' ? 'destination-out' : 'source-over';
    switch (obj.type) {
      case 'path':
      case 'erase':
        if (!obj.points.length) return;
        wbCtx.beginPath();
        obj.points.forEach((p, i) => (i === 0 ? wbCtx.moveTo(p.x, p.y) : wbCtx.lineTo(p.x, p.y)));
        wbCtx.stroke();
        break;
      case 'rect':
        wbCtx.strokeRect(Math.min(obj.x1, obj.x2), Math.min(obj.y1, obj.y2), Math.abs(obj.x2 - obj.x1), Math.abs(obj.y2 - obj.y1));
        break;
      case 'ellipse': {
        const cx = (obj.x1 + obj.x2) / 2, cy = (obj.y1 + obj.y2) / 2;
        const rx = Math.abs(obj.x2 - obj.x1) / 2, ry = Math.abs(obj.y2 - obj.y1) / 2;
        wbCtx.beginPath();
        wbCtx.ellipse(cx, cy, rx || 0.01, ry || 0.01, 0, 0, Math.PI * 2);
        wbCtx.stroke();
        break;
      }
      case 'line':
        wbCtx.beginPath(); wbCtx.moveTo(obj.x1, obj.y1); wbCtx.lineTo(obj.x2, obj.y2); wbCtx.stroke();
        break;
      case 'arrow': {
        wbCtx.beginPath(); wbCtx.moveTo(obj.x1, obj.y1); wbCtx.lineTo(obj.x2, obj.y2); wbCtx.stroke();
        const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
        const headLen = 9 + (obj.width || 2.5) * 1.5;
        wbCtx.beginPath();
        wbCtx.moveTo(obj.x2, obj.y2);
        wbCtx.lineTo(obj.x2 - headLen * Math.cos(angle - Math.PI / 6), obj.y2 - headLen * Math.sin(angle - Math.PI / 6));
        wbCtx.moveTo(obj.x2, obj.y2);
        wbCtx.lineTo(obj.x2 - headLen * Math.cos(angle + Math.PI / 6), obj.y2 - headLen * Math.sin(angle + Math.PI / 6));
        wbCtx.stroke();
        break;
      }
      case 'text':
        wbCtx.font = `${obj.fontSize}px 'IBM Plex Mono', monospace`;
        wbCtx.textBaseline = 'top';
        (obj.text || '').split('\n').forEach((line, i) => wbCtx.fillText(line, obj.x, obj.y + i * obj.fontSize * 1.3));
        break;
    }
    wbCtx.globalCompositeOperation = 'source-over';
  }

  function drawSelectionHandles(obj) {
    if (!obj) return;
    const b = objectBounds(obj);
    wbCtx.save();
    wbCtx.strokeStyle = '#2C5AA0';
    wbCtx.lineWidth = 1 / wbView.zoom;
    wbCtx.setLineDash([4 / wbView.zoom, 3 / wbView.zoom]);
    wbCtx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    wbCtx.setLineDash([]);
    wbCtx.fillStyle = '#2C5AA0';
    getHandles(obj).forEach(h => {
      const r = 4 / wbView.zoom;
      wbCtx.fillRect(h.x - r, h.y - r, r * 2, r * 2);
    });
    wbCtx.restore();
  }

  function redrawWhiteboard() {
    wbCtx.save();
    wbCtx.setTransform(1, 0, 0, 1, 0, 0);
    wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    wbCtx.restore();
    wbObjects.forEach(drawObject);
    if (wbSelectedId && wbTool === 'select') {
      const sel = wbObjects.find(o => o.id === wbSelectedId);
      if (sel) drawSelectionHandles(sel);
    }
  }

  function openWbTextInput(w) {
    const screen = worldToScreen(w.x, w.y);
    const input = document.createElement('textarea');
    input.className = 'wb-text-input';
    input.style.left = screen.x + 'px';
    input.style.top = screen.y + 'px';
    input.style.color = wbColor;
    input.style.fontSize = (16 * wbView.zoom) + 'px';
    wbCanvasWrap.appendChild(input);
    input.focus();
    let done = false;
    function commit() {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      if (!text.trim()) return;
      wbBeginAction();
      const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const obj = { id, type: 'text', color: wbColor, x: w.x, y: w.y, text, fontSize: 16 };
      wbObjects.push(obj);
      broadcast({ type: 'wb-obj-start', obj });
      wbCommitAction();
      redrawWhiteboard();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { done = true; input.remove(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
    });
  }

  wbCanvas.addEventListener('pointerdown', e => {
    if (mode !== 'draw') return;
    const w = pointerWorld(e);

    if (wbTool === 'select') {
      if (wbSelectedId) {
        const sel = wbObjects.find(o => o.id === wbSelectedId);
        const handle = sel && getHandles(sel).find(h => Math.hypot(h.x - w.x, h.y - w.y) < 8 / wbView.zoom);
        if (handle) {
          wbBeginAction();
          wbDragMode = 'resize:' + handle.key;
          wbCanvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = hitTest(w.x, w.y);
      wbSelectedId = hit ? hit.id : null;
      if (hit) {
        wbBeginAction();
        wbDragMode = 'move';
        wbDragStart = w;
        wbDragOrig = JSON.parse(JSON.stringify(hit));
        wbCanvas.setPointerCapture(e.pointerId);
      }
      redrawWhiteboard();
      return;
    }

    if (wbTool === 'text') { openWbTextInput(w); return; }

    wbDrawing = true;
    wbBeginAction();
    wbCanvas.setPointerCapture(e.pointerId);
    const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let obj;
    if (wbTool === 'pen' || wbTool === 'eraser') {
      obj = { id, type: wbTool === 'eraser' ? 'erase' : 'path', color: wbColor, width: wbTool === 'eraser' ? wbWidth * 6 : wbWidth, points: [w] };
    } else {
      obj = { id, type: wbTool, color: wbColor, width: wbWidth, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    }
    wbActiveObj = obj;
    wbObjects.push(obj);
    broadcast({ type: 'wb-obj-start', obj });
  });

  wbCanvas.addEventListener('pointermove', e => {
    if (mode !== 'draw') return;
    const w = pointerWorld(e);

    if (wbDragMode && wbSelectedId) {
      const sel = wbObjects.find(o => o.id === wbSelectedId);
      if (!sel) return;
      if (wbDragMode === 'move') applyMove(sel, wbDragOrig, w.x - wbDragStart.x, w.y - wbDragStart.y);
      else applyResize(sel, wbDragMode.split(':')[1], w);
      redrawWhiteboard();
      broadcast({ type: 'wb-obj-patch', id: sel.id, patch: extractGeom(sel) });
      return;
    }

    if (!wbDrawing || !wbActiveObj) return;
    if (wbActiveObj.type === 'path' || wbActiveObj.type === 'erase') wbActiveObj.points.push(w);
    else { wbActiveObj.x2 = w.x; wbActiveObj.y2 = w.y; }
    redrawWhiteboard();
    broadcast({ type: 'wb-obj-patch', id: wbActiveObj.id, patch: extractGeom(wbActiveObj) });
  });

  function endWbInteraction() {
    if (wbDragMode) { wbDragMode = null; wbCommitAction(); }
    if (wbDrawing && wbActiveObj) wbCommitAction();
    wbDrawing = false;
    wbActiveObj = null;
    redrawWhiteboard();
  }
  wbCanvas.addEventListener('pointerup', endWbInteraction);
  wbCanvas.addEventListener('pointerleave', endWbInteraction);
  wbCanvas.addEventListener('pointercancel', endWbInteraction);

  wbCanvas.addEventListener('wheel', e => {
    if (mode !== 'draw') return;
    e.preventDefault();
    const rect = wbCanvas.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (e.ctrlKey || e.metaKey) {
      setWbZoom(wbView.zoom * Math.exp(-e.deltaY * 0.01), anchor);
    } else {
      wbView.panX -= e.deltaX;
      wbView.panY -= e.deltaY;
      applyWbTransform();
      redrawWhiteboard();
    }
  }, { passive: false });

  function setWbZoom(next, anchorScreen) {
    next = Math.min(4, Math.max(0.2, next));
    if (anchorScreen) {
      const before = screenToWorld(anchorScreen.x, anchorScreen.y);
      wbView.zoom = next;
      const after = worldToScreen(before.x, before.y);
      wbView.panX += anchorScreen.x - after.x;
      wbView.panY += anchorScreen.y - after.y;
    } else {
      wbView.zoom = next;
    }
    applyWbTransform();
    redrawWhiteboard();
    document.getElementById('wbZoomReset').textContent = Math.round(wbView.zoom * 100) + '%';
  }

  document.querySelectorAll('.wb-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      wbTool = btn.dataset.tool;
      document.querySelectorAll('.wb-tool').forEach(b => b.classList.toggle('active', b === btn));
      wbCanvas.className = 'tool-' + wbTool;
      if (wbTool !== 'select') { wbSelectedId = null; redrawWhiteboard(); }
    });
  });
  document.querySelectorAll('.wb-color').forEach(btn => {
    btn.addEventListener('click', () => {
      wbColor = btn.dataset.color;
      document.querySelectorAll('.wb-color').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.querySelectorAll('.wb-width').forEach(btn => {
    btn.addEventListener('click', () => {
      wbWidth = parseFloat(btn.dataset.width);
      document.querySelectorAll('.wb-width').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.getElementById('wbUndo').addEventListener('click', wbUndo);
  document.getElementById('wbRedo').addEventListener('click', wbRedo);
  document.getElementById('wbZoomIn').addEventListener('click', () => setWbZoom(wbView.zoom * 1.2, { x: wbCanvas.clientWidth / 2, y: wbCanvas.clientHeight / 2 }));
  document.getElementById('wbZoomOut').addEventListener('click', () => setWbZoom(wbView.zoom / 1.2, { x: wbCanvas.clientWidth / 2, y: wbCanvas.clientHeight / 2 }));
  document.getElementById('wbZoomReset').addEventListener('click', () => { wbView.panX = 0; wbView.panY = 0; setWbZoom(1); });
  document.getElementById('wbClear').addEventListener('click', () => {
    wbBeginAction();
    wbObjects = [];
    wbSelectedId = null;
    redrawWhiteboard();
    broadcast({ type: 'wb-clear' });
    wbCommitAction();
  });

  window.addEventListener('keydown', e => {
    if (mode !== 'draw') return;
    const t = document.activeElement && document.activeElement.tagName;
    if (t === 'TEXTAREA' || t === 'INPUT') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && wbSelectedId) {
      e.preventDefault();
      wbBeginAction();
      wbObjects = wbObjects.filter(o => o.id !== wbSelectedId);
      broadcast({ type: 'wb-obj-delete', id: wbSelectedId });
      wbSelectedId = null;
      wbCommitAction();
      redrawWhiteboard();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) wbRedo(); else wbUndo();
    }
  });

  function setMode(next, fromPeer) {
    mode = next;
    const drawing = mode === 'draw';
    whiteboardWrap.classList.toggle('hidden', !drawing);
    whiteboardToggle.classList.toggle('active', drawing);
    whiteboardToggle.textContent = drawing ? 'Back to code' : 'Whiteboard';
    if (drawing) requestAnimationFrame(resizeWbCanvas);
    if (!fromPeer) broadcast({ type: 'mode', value: mode });
  }
  whiteboardToggle.addEventListener('click', () => setMode(mode === 'draw' ? 'code' : 'draw'));
  window.addEventListener('resize', () => { if (mode === 'draw') resizeWbCanvas(); });

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
  document.getElementById('clearOutputBtn').addEventListener('click', () => { outputPane.textContent = ''; });

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
    if (result.stdout) parts.push(result.stdout.replace(/\n+$/, ''));
    if (result.compile_output) parts.push('Compile error:\n' + result.compile_output.trim());
    if (result.stderr) parts.push(result.stderr.replace(/\n+$/, ''));
    // Judge0's message ("Exited with error status 1") just restates the
    // traceback when there is one.
    if (result.message && !result.stderr && !result.compile_output) parts.push(result.message);
    const ok = !result.status || result.status.id === 3;
    const timing = result.time ? ` · ${Math.round(parseFloat(result.time) * 1000)} ms` : '';
    const header = ok ? `Finished${timing}` : `${result.status.description}${timing}`;
    return `${header}\n\n${parts.join('\n\n') || '(no output)'}`;
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
      // First public method — skips __init__ and private helpers.
      const re = /def\s+(\w+)\s*\(\s*self\b/g;
      let m;
      while ((m = re.exec(code))) {
        if (!m[1].startsWith('_')) return `Solution().${m[1]}`;
      }
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

  // LeetCode's Python environment pre-imports typing and the common
  // stdlib modules, so solutions routinely use List[int] / deque / heapq
  // without importing them. Mirror that, and shift traceback line numbers
  // back so they still match what the candidate sees in the editor.
  const PY_PRELUDE = 'from typing import *\nfrom collections import *\nimport collections, heapq, math, bisect, itertools, functools, string, re\n';
  const PY_PRELUDE_LINES = PY_PRELUDE.split('\n').length - 1;
  function withPrelude(langKey, code) {
    return langKey === 'python' && !/^from __future__/m.test(code) ? PY_PRELUDE + code : code;
  }
  function fixTracebackLines(langKey, code, text) {
    if (!text || langKey !== 'python' || /^from __future__/m.test(code)) return text;
    return text.replace(/(File "[^"]*", line )(\d+)/g, (_, pre, n) => pre + Math.max(1, n - PY_PRELUDE_LINES));
  }

  // The driver prints this marker before the JSON result, so anything the
  // candidate print()s while debugging is shown separately instead of
  // breaking the comparison.
  const RESULT_MARKER = '__MOCKMATE_RESULT__';
  function splitDriverOutput(stdout) {
    const text = stdout || '';
    const idx = text.lastIndexOf(RESULT_MARKER);
    if (idx < 0) return { printed: text.replace(/\n+$/, ''), result: null };
    return {
      printed: text.slice(0, idx).replace(/\n+$/, ''),
      result: text.slice(idx + RESULT_MARKER.length).trim(),
    };
  }

  function withDriver(langKey, code) {
    if (langKey === 'python') {
      const entry = detectPythonEntry(code);
      if (!entry) return code;
      return `${code}

if __name__ == "__main__":
    import json as _mm_json, sys as _mm_sys
    _mm_args = [_mm_json.loads(l) for l in _mm_sys.stdin.read().splitlines() if l.strip()]
    _mm_result = ${entry}(*_mm_args)
    _mm_sys.stdout.flush()
    print("\\n${RESULT_MARKER}" + _mm_json.dumps(
        _mm_result, separators=(",", ":"),
        default=lambda o: sorted(o) if isinstance(o, (set, frozenset)) else list(o) if hasattr(o, "__iter__") else str(o)))
`;
    }
    if (langKey === 'javascript') {
      const entry = detectJsEntry(code);
      if (!entry) return code;
      return `${code}

const __mm_lines = require('fs').readFileSync(0, 'utf8').split(/\\r?\\n/).filter(l => l.trim() !== '');
const __mm_args = __mm_lines.map(l => JSON.parse(l));
const __mm_result = ${entry}(...__mm_args);
console.log('\\n${RESULT_MARKER}' + JSON.stringify(__mm_result === undefined ? null : __mm_result));
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

  // Run output stays on the interviewer's screen only.
  const OUTPUT_EMPTY = role === 'interviewer' ? 'Run the code or the tests to see output here.' : 'Format messages show up here.';
  outputPane.textContent = OUTPUT_EMPTY;
  if (role === 'interviewer') document.getElementById('outputPrivate').classList.remove('hidden');
  else {
    // The candidate never sees run output; this area only carries Format
    // messages, so it stays out of the way until there is one.
    document.querySelector('.output-head > span').textContent = 'Messages';
    document.querySelector('.output-head').classList.add('hidden');
    outputPane.classList.add('hidden');
  }
  function setOutput(text) {
    outputPane.textContent = text;
    if (role === 'candidate' && text) {
      document.querySelector('.output-head').classList.remove('hidden');
      outputPane.classList.remove('hidden');
    }
  }

  function formatRunResultFor(langKey, code, result) {
    return formatRunResult({
      ...result,
      stderr: fixTracebackLines(langKey, code, result.stderr),
    });
  }

  async function runCode() {
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    setOutput('Running…');
    try {
      const langKey = langSelect.value;
      const code = editor.getValue();
      const result = await executeCode(LANGS[langKey].judge0, withPrelude(langKey, code), '');
      setOutput(formatRunResultFor(langKey, code, result));
      const ok = !result.status || result.status.id === 3;
      addLogEntry('run', ok ? 'Ran the code' : `Ran the code: ${result.status.description}`);
      replayMark('run');
    } catch (e) {
      setOutput('Error running code: ' + e.message);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
  }

  async function runTests() {
    if (!testCases.length) {
      setOutput('Add at least one test case first.');
      return;
    }
    runTestsBtn.disabled = true;
    const langKey = langSelect.value;
    const lang = LANGS[langKey];
    const rawCode = editor.getValue();
    const code = withPrelude(langKey, withDriver(langKey, rawCode));
    const hasDriver = code !== withPrelude(langKey, rawCode);
    const noAutoDriver = !hasDriver && langKey !== 'python' && langKey !== 'javascript';
    const summaryLines = [];
    let passCount = 0;
    testCases.forEach(tc => { delete tc.result; });
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      runTestsBtn.textContent = `Running ${i + 1}/${testCases.length}…`;
      setOutput(`Running test case ${i + 1} of ${testCases.length}…`);
      try {
        const result = await executeCode(lang.judge0, code, tc.input);
        const { printed, result: returned } = hasDriver
          ? splitDriverOutput(result.stdout)
          : { printed: '', result: (result.stdout || '').trim() };
        const actual = returned || '';
        const expected = (tc.expected || '').trim();
        const pass = result.status && result.status.id === 3 && returned !== null && outputsMatch(actual, expected);
        if (pass) passCount++;
        const errDetail = fixTracebackLines(langKey, rawCode, result.stderr) || result.compile_output;
        const parts = [];
        if (pass) parts.push('Passed');
        else {
          parts.push(`Expected: ${expected || '(empty)'}`);
          parts.push(`Got: ${actual || (result.status && result.status.id !== 3 ? result.status.description : '(empty)')}`);
        }
        if (printed) parts.push(`Printed:\n${printed}`);
        if (errDetail && !pass) parts.push(errDetail.trim());
        if (!pass && !actual && noAutoDriver) {
          parts.push("C++/Java aren't auto-run yet — your code needs its own main() that reads stdin and prints the result.");
        }
        tc.result = { status: pass ? 'pass' : 'fail', text: parts.join('\n') };
        summaryLines.push(`Case ${i + 1}: ${pass ? 'PASS' : 'FAIL'}`);
      } catch (e) {
        tc.result = { status: 'fail', text: 'Error: ' + e.message };
        summaryLines.push(`Case ${i + 1}: ERROR — ${e.message}`);
      }
      renderTestcases();
    }
    setOutput(`${passCount}/${testCases.length} test cases passed\n\n` + summaryLines.join('\n'));
    addLogEntry('run', `Ran tests: ${passCount}/${testCases.length} passed`);
    if (role === 'interviewer') {
      questions[activeQ].lastRun = { passed: passCount, total: testCases.length, at: Date.now() };
    }
    replayMark('run');
    runTestsBtn.disabled = false;
    runTestsBtn.textContent = 'Run tests';
  }

  // ---------- Test cases ----------
  const testcasePane = document.getElementById('testcasePane');
  const testcaseList = document.getElementById('testcaseList');
  const addTestcaseBtn = document.getElementById('addTestcaseBtn');
  let testCases = [];
  let testcaseSyncTimer = null;

  if (role === 'interviewer') {
    testcasePane.classList.remove('hidden');
  } else {
    // Stays hidden until the interviewer reveals the question — test
    // cases are part of the question, not something to see early.
    testcasePane.classList.add('hidden');
    addTestcaseBtn.classList.add('hidden');
    document.getElementById('testcaseHint').classList.add('hidden');
  }

  function renderTestcases() {
    testcaseList.innerHTML = '';
    if (!testCases.length) {
      const empty = document.createElement('div');
      empty.className = 'testcase-empty';
      empty.textContent = role === 'interviewer' ? 'No test cases yet. Add one, or choose a question from the bank to get a set.' : 'No example cases for this question.';
      testcaseList.appendChild(empty);
      return;
    }
    testCases.forEach((tc, i) => {
      const row = document.createElement('div');
      row.className = 'testcase-row' + (tc.hidden ? ' is-hidden' : '') + (tc.result ? ' has-result ' + tc.result.status : '');

      const header = document.createElement('div');
      header.className = 'testcase-row-header';
      const label = document.createElement('span');
      label.className = 'testcase-label';
      label.textContent = `Case ${i + 1}`;
      header.appendChild(label);
      if (tc.result) {
        const status = document.createElement('span');
        status.className = 'testcase-status';
        status.textContent = tc.result.status === 'pass' ? 'Passed' : 'Failed';
        header.appendChild(status);
      }
      if (role === 'interviewer') {
        const hiddenToggle = document.createElement('label');
        hiddenToggle.className = 'testcase-hidden-toggle';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!tc.hidden;
        cb.addEventListener('change', () => {
          testCases[i].hidden = cb.checked;
          row.classList.toggle('is-hidden', cb.checked);
          syncTestcases();
        });
        hiddenToggle.append(cb, document.createTextNode('Hidden'));
        header.appendChild(hiddenToggle);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'testcase-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.setAttribute('aria-label', `Remove case ${i + 1}`);
        removeBtn.addEventListener('click', () => {
          testCases.splice(i, 1);
          renderTestcases();
          syncTestcases();
        });
        header.appendChild(removeBtn);
      }
      row.appendChild(header);

      const inputArea = document.createElement('textarea');
      inputArea.placeholder = 'Input — one argument per line\n[2,7,11,15]\n9';
      inputArea.setAttribute('aria-label', `Case ${i + 1} input`);
      inputArea.rows = Math.max(2, (tc.input || '').split('\n').length);
      inputArea.value = tc.input || '';
      inputArea.readOnly = role !== 'interviewer';
      inputArea.addEventListener('input', () => {
        testCases[i].input = inputArea.value;
        scheduleSyncTestcases();
      });
      row.appendChild(inputArea);

      const expectedArea = document.createElement('textarea');
      expectedArea.placeholder = 'Expected return value, e.g. [0,1]';
      expectedArea.setAttribute('aria-label', `Case ${i + 1} expected output`);
      expectedArea.rows = 1;
      expectedArea.value = tc.expected || '';
      expectedArea.readOnly = role !== 'interviewer';
      expectedArea.addEventListener('input', () => {
        testCases[i].expected = expectedArea.value;
        scheduleSyncTestcases();
      });
      row.appendChild(expectedArea);

      if (tc.result && tc.result.status !== 'pass') {
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
    // Only actually send the content once the question is revealed — before
    // that, send an empty set so nothing leaks to the candidate early.
    // Hidden cases are never sent.
    broadcast(testcasesMsg());
    saveRoomStateSoon();
  }
  function testcasesMsg() {
    return {
      type: 'testcases',
      value: questionVisible ? testCases.filter(tc => !tc.hidden).map(tc => ({ input: tc.input, expected: tc.expected })) : [],
      visible: questionVisible,
    };
  }

  if (role === 'interviewer') {
    addTestcaseBtn.addEventListener('click', () => {
      testCases.push({ input: '', expected: '' });
      renderTestcases();
      syncTestcases();
    });
  }

  // ---------- Timer (counts down from the chosen length; hitting 0 auto-fails) ----------
  const timerEl = document.getElementById('timer');
  const durationSelect = document.getElementById('durationSelect');
  const DURATIONS = [30, 45, 60, 90];
  let durationMin = DURATIONS.includes(+params.get('duration')) ? +params.get('duration') : 45;
  let startTime = null;
  let timerInterval = null;
  let sessionEnded = false;

  function fmtClock(totalSec) {
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  // "mm:ss into the interview", used to stamp log entries and replay
  // markers. Falls back to wall-clock time before the interview starts.
  function interviewClock(at) {
    if (!startTime || at < startTime) {
      return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return fmtClock(Math.floor((at - startTime) / 1000));
  }

  function updateTimerDisplay() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, durationMin * 60 - elapsed);
    timerEl.textContent = fmtClock(remaining);
    timerEl.classList.toggle('timer-warning', remaining > 0 && remaining <= 5 * 60);
    timerEl.classList.add('timer-running');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      // The interviewer is the authority here — they broadcast the fail
      // verdict (same path as clicking "No pass"), and the candidate reacts
      // to that broadcast rather than independently declaring the end.
      if (role === 'interviewer' && !sessionEnded && dataConn) setVerdict('fail', false, 'timeout');
    }
  }

  function startTimer(t0) {
    startTime = t0;
    if (timerInterval) clearInterval(timerInterval);
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
    if (role === 'interviewer') {
      startTimerBtn.classList.add('hidden');
      durationSelect.classList.add('hidden');
    }
  }

  function resetTimerDisplay() {
    startTime = null;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerEl.textContent = fmtClock(durationMin * 60);
    timerEl.classList.remove('timer-warning', 'timer-running');
    if (role === 'interviewer') {
      startTimerBtn.classList.remove('hidden');
      durationSelect.classList.remove('hidden');
    }
  }

  function timerSyncMsg() {
    return { type: 'timer-sync', startTime, duration: durationMin };
  }

  const startTimerBtn = document.getElementById('startTimerBtn');
  durationSelect.value = String(durationMin);
  if (role === 'interviewer') {
    startTimerBtn.classList.remove('hidden');
    durationSelect.classList.remove('hidden');
    durationSelect.addEventListener('change', () => {
      durationMin = +durationSelect.value;
      resetTimerDisplay();
      broadcast(timerSyncMsg());
      saveRoomStateSoon();
    });
    startTimerBtn.addEventListener('click', () => {
      startTimer(Date.now());
      broadcast(timerSyncMsg());
      addLogEntry('event', 'Interview started');
      replayMark('start');
      saveRoomStateSoon();
    });
  }
  timerEl.textContent = fmtClock(durationMin * 60);

  // ---------- Question pane ----------
  const questionArea = document.getElementById('questionArea');
  const revealBtn = document.getElementById('revealBtn');
  const interviewerQuestionActions = document.getElementById('interviewerQuestionActions');
  const candidateHiddenNote = document.getElementById('candidateHiddenNote');
  let questionVisible = false;

  if (role === 'candidate') {
    questionArea.readOnly = true;
    questionArea.placeholder = '';
    questionArea.classList.add('hidden');
    interviewerQuestionActions.classList.add('hidden');
    candidateHiddenNote.classList.remove('hidden');
  }

  let suppressQuestionEmit = false;
  questionArea.addEventListener('input', () => {
    if (suppressQuestionEmit || role !== 'interviewer') return;
    if (questionVisible) broadcast({ type: 'question', value: questionArea.value, visible: true });
    saveRoomStateSoon();
  });

  function setQuestionVisible(visible) {
    questionVisible = visible;
    trackQuestionVisibility(visible);
    revealBtn.textContent = visible ? 'Hide from candidate' : 'Show to candidate';
    revealBtn.classList.toggle('active', visible);
    if (role === 'interviewer') {
      broadcast({ type: 'question', value: questionArea.value, visible });
      syncTestcases();
    }
  }

  if (role === 'interviewer') {
    revealBtn.addEventListener('click', () => {
      setQuestionVisible(!questionVisible);
      addLogEntry('event', questionVisible ? 'Question shown to candidate' : 'Question hidden from candidate');
      saveRoomStateSoon();
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
    // The interviewer already sees the difficulty on the selector itself.
    questionBadges.classList.toggle('hidden', !meta.difficulty || role === 'interviewer');
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
    solutionArea.addEventListener('input', () => saveRoomStateSoon());
  }

  // ---------- Import from LeetCode ----------
  // LeetCode's API sends no CORS header allowing fetch from another origin
  // (verified directly against it), and scraping their problem content
  // programmatically would sidestep access controls their own ToS puts on
  // it — so this doesn't fetch anything. It parses text the interviewer
  // already has lawful access to and pastes in themselves: LeetCode's own
  // "select all" copy of a problem page has a very consistent shape
  // (title/difficulty line, description, "Example N: Input:/Output:"
  // blocks, Constraints, and often the starter code), so pulling
  // difficulty/description/test cases/signature out of it is just parsing,
  // not scraping.
  function splitTopLevelArgs(s) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '[' || ch === '(' || ch === '{') depth++;
      if (ch === ']' || ch === ')' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => x.trim());
  }
  function stripArgName(seg) {
    const eq = seg.indexOf('=');
    return eq >= 0 && !/[<>!]=/.test(seg.slice(Math.max(0, eq - 1), eq + 2)) ? seg.slice(eq + 1).trim() : seg.trim();
  }

  function parseLeetCodePaste(raw) {
    const text = raw.replace(/\r\n/g, '\n');
    const lines = text.split('\n');

    const diffMatch = text.match(/\b(Easy|Medium|Hard)\b/);
    const difficulty = diffMatch ? diffMatch[1].toLowerCase() : '';

    // Strip common chrome lines (title number, bare difficulty, nav labels)
    // only near the top, so the same words appearing later in the
    // description (rare, but possible) are left alone.
    const noiseLine = /^(Topics?|Companies|Hint|Easy|Medium|Hard|Show Hint.*|\d+\.\s.+)$/;
    const cleaned = lines.filter((l, i) => !(i < 10 && noiseLine.test(l.trim())));
    const description = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    const testCases = [];
    const exampleRe = /Example\s*\d+:?[\s\S]*?Input:\s*(.+?)\n\s*Output:\s*(.+?)(?:\n|$)/gi;
    let m;
    while ((m = exampleRe.exec(text))) {
      const inputRaw = m[1].trim();
      const outputRaw = m[2].trim().split(/\bExplanation\b/)[0].trim();
      const args = splitTopLevelArgs(inputRaw).map(stripArgName);
      if (args.length) testCases.push({ input: args.join('\n'), expected: outputRaw });
    }

    let signature = null;
    const pyMatch = text.match(/def\s+(\w+)\s*\([^)]*\)[^\n:]*:/);
    if (pyMatch) {
      const sigLine = pyMatch[0];
      const hasClass = /class\s+Solution\b/.test(text);
      signature = {
        lang: 'python',
        code: hasClass ? `class Solution:\n    ${sigLine}\n        pass\n` : `${sigLine}\n    pass\n`,
      };
    }

    return { difficulty, description, testCases, signature };
  }

  // Auto-fetch via alfa-leetcode-api (github.com/alfaarghya/alfa-leetcode-api):
  // an established, MIT-licensed, CORS-open community wrapper around
  // LeetCode's GraphQL endpoint (verified: 800+ stars, 17+ contributors,
  // access-control-allow-origin: * confirmed directly against it). It only
  // serves problems LeetCode itself shows to any visitor for free
  // (isPaidOnly ones come back empty) — same public content the paste flow
  // already reads, just fetched instead of typed in. It doesn't expose
  // per-language starter code, so the function-signature detection still
  // only runs on a manual paste that includes the code panel.
  function extractLeetCodeSlug(url) {
    const m = url.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
    return m ? m[1] : null;
  }

  async function fetchLeetCodeQuestion(slug) {
    const res = await fetch(`https://alfa-leetcode-api.onrender.com/select?titleSlug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  }

  function htmlToPlainText(html) {
    const withBreaks = html
      .replace(/<\/(p|div|li|pre)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li>/gi, '• ');
    const div = document.createElement('div');
    div.innerHTML = withBreaks;
    return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }

  const importPanel = document.getElementById('importPanel');
  if (role === 'interviewer') {
    document.getElementById('importLeetcodeBtn').addEventListener('click', () => {
      importPanel.classList.toggle('hidden');
    });
    document.getElementById('importCancelBtn').addEventListener('click', () => {
      importPanel.classList.add('hidden');
    });
    function applyImportedQuestion(parsed, url, sourceLabel) {
      const composed = url ? `Source: ${url}\n\n${parsed.description}` : parsed.description;
      questionArea.value = composed;
      const slug = url && extractLeetCodeSlug(url);
      questions[activeQ].title = slug ? slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
      renderQuestionTabs();
      if (questionVisible) broadcast({ type: 'question', value: composed, visible: true });

      if (parsed.difficulty) {
        currentMeta = { difficulty: parsed.difficulty };
        setDifficultyButtonsActive(parsed.difficulty);
        renderQuestionBadges(currentMeta);
        broadcast({ type: 'meta', value: currentMeta });
      }

      const hadExistingCases = testCases.length > 0;
      if (parsed.testCases.length && !hadExistingCases) {
        testCases = parsed.testCases;
        renderTestcases();
        syncTestcases();
      }

      if (parsed.signature && parsed.signature.lang === 'python' && langSelect.value === 'python' && editor.getValue() === DEFAULT_PY_STARTER) {
        replaceAllCode(parsed.signature.code);
      }

      const summary = [];
      if (parsed.difficulty) summary.push('difficulty');
      if (parsed.testCases.length) summary.push(`${parsed.testCases.length} test case${parsed.testCases.length === 1 ? '' : 's'}`);
      if (parsed.signature) summary.push('starter code');
      if (summary.length) {
        setOutput(`Imported ${sourceLabel}: ${summary.join(', ')}.` + (hadExistingCases && parsed.testCases.length ? ' Existing test cases were kept.' : ''));
      }

      importPanel.classList.add('hidden');
      document.getElementById('importUrlInput').value = '';
      document.getElementById('importPasteArea').value = '';
      saveRoomStateSoon();
    }

    // ---------- Question bank ----------
    const BANK = window.ONSITE_QUESTIONS || [];
    const bankStarters = new Set(BANK.flatMap(q => Object.values(q.starter || {})));

    function applyBankQuestion(q) {
      questionArea.value = `${q.title}\n\n${q.prompt}`;
      if (questionVisible) broadcast({ type: 'question', value: questionArea.value, visible: true });

      currentMeta = { difficulty: q.difficulty };
      setDifficultyButtonsActive(q.difficulty);
      renderQuestionBadges(currentMeta);
      broadcast({ type: 'meta', value: currentMeta });

      testCases = q.tests.map(tc => ({ input: tc.input, expected: tc.expected, hidden: !!tc.hidden }));
      renderTestcases();
      syncTestcases();

      solutionArea.value = q.solution || '';
      questions[activeQ].title = q.title;
      renderQuestionTabs();

      const starter = q.starter && q.starter[langSelect.value];
      const current = editor.getValue();
      const untouched = !current.trim() || current === DEFAULT_PY_STARTER || bankStarters.has(current);
      if (starter && (untouched || confirm(`Replace the code in the editor with the ${q.title} starter?`))) {
        replaceAllCode(starter);
      }

      const hiddenCount = q.tests.filter(t => t.hidden).length;
      setOutput(`Loaded ${q.title}: ${q.tests.length} test cases (${hiddenCount} hidden), starter code, and a reference approach in Log. The question stays hidden until you click Show to candidate.`);
      addLogEntry('event', `Question set: ${q.title}`);
      importPanel.classList.add('hidden');
      saveRoomStateSoon();
    }

    const bankList = document.getElementById('bankList');
    BANK.forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bank-item';
      const title = document.createElement('span');
      title.className = 'bank-title';
      title.textContent = q.title;
      const meta = document.createElement('span');
      meta.className = 'bank-meta';
      meta.textContent = q.topics;
      const diff = document.createElement('span');
      diff.className = 'bank-diff difficulty-' + q.difficulty;
      diff.textContent = q.difficulty;
      b.append(title, meta, diff);
      b.addEventListener('click', () => applyBankQuestion(q));
      bankList.appendChild(b);
    });

    document.getElementById('importConfirmBtn').addEventListener('click', () => {
      const url = document.getElementById('importUrlInput').value.trim();
      const pasted = document.getElementById('importPasteArea').value.trim();
      if (!pasted) {
        alert('Paste the problem page first, or use Fetch above.');
        return;
      }
      applyImportedQuestion(parseLeetCodePaste(pasted), url, 'from paste');
    });

    document.getElementById('importFetchBtn').addEventListener('click', async () => {
      const urlInput = document.getElementById('importUrlInput');
      const url = urlInput.value.trim();
      const slug = extractLeetCodeSlug(url);
      if (!slug) {
        alert('Paste a LeetCode problem URL first, e.g. https://leetcode.com/problems/two-sum/');
        return;
      }
      const btn = document.getElementById('importFetchBtn');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Fetching…';
      try {
        const data = await fetchLeetCodeQuestion(slug);
        if (!data || data.isPaidOnly || !data.question) {
          alert("Couldn't get that problem — it may be premium-only (the free API can't return those). Paste it manually below instead.");
          return;
        }
        const text = htmlToPlainText(data.question);
        const parsed = parseLeetCodePaste(text);
        parsed.difficulty = (data.difficulty || parsed.difficulty || '').toLowerCase();
        parsed.description = text;
        applyImportedQuestion(parsed, url, 'from LeetCode');
      } catch (e) {
        alert('Could not fetch that problem (' + e.message + '). Paste it manually below instead.');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  // ---------- Multiple questions per interview (interviewer only) ----------
  // The question pane, test cases, reference notes, and editor always show
  // the *active* question; each question's copy of them lives in a slot and
  // is swapped in and out when the interviewer switches. Time is counted
  // only while a question is shown to the candidate.
  const questionTabsEl = document.getElementById('questionTabs');
  function blankQuestionSlot() {
    return { title: '', question: '', meta: { difficulty: '' }, testCases: [], solution: '', code: null, lang: null, visible: false, timeMs: 0, visibleSince: null, lastRun: null };
  }
  let questions = [blankQuestionSlot()];
  let activeQ = 0;

  function questionTitle(slot, i) {
    if (slot.title) return slot.title;
    const first = (slot.question || '').split('\n').find(l => l.trim() && !/^Source:/.test(l.trim()));
    return first ? first.trim().slice(0, 48) : `Question ${i + 1}`;
  }
  function questionTimeMs(slot) {
    return slot.timeMs + (slot.visibleSince ? Date.now() - slot.visibleSince : 0);
  }

  // Copy the live panes into the active slot.
  function snapshotActive() {
    const slot = questions[activeQ];
    slot.question = questionArea.value;
    slot.meta = { ...currentMeta };
    slot.testCases = testCases.map(tc => ({ input: tc.input, expected: tc.expected, hidden: !!tc.hidden }));
    slot.solution = solutionArea.value;
    slot.code = editor.getValue();
    slot.lang = langSelect.value;
    slot.visible = questionVisible;
  }

  // Called by setQuestionVisible: the clock for a question runs while the
  // candidate can see it.
  function trackQuestionVisibility(visible) {
    if (role !== 'interviewer') return;
    const slot = questions[activeQ];
    slot.visible = visible;
    if (visible && !slot.visibleSince) slot.visibleSince = Date.now();
    if (!visible && slot.visibleSince) {
      slot.timeMs += Date.now() - slot.visibleSince;
      slot.visibleSince = null;
    }
  }

  function loadActiveQuestion() {
    const slot = questions[activeQ];
    questionArea.value = slot.question;
    currentMeta = { ...slot.meta };
    setDifficultyButtonsActive(currentMeta.difficulty);
    renderQuestionBadges(currentMeta);
    broadcast({ type: 'meta', value: currentMeta });
    testCases = slot.testCases.map(tc => ({ ...tc }));
    renderTestcases();
    solutionArea.value = slot.solution;
    if (slot.lang && slot.lang !== langSelect.value) {
      langSelect.value = slot.lang;
      editor.setOption('mode', LANGS[slot.lang].cmMode);
      broadcast({ type: 'lang', value: slot.lang });
    }
    replaceAllCode(slot.code == null ? '' : slot.code);
    setQuestionVisible(!!slot.visible);
  }

  function switchQuestion(i, logText) {
    if (i === activeQ || !questions[i]) return;
    snapshotActive();
    trackQuestionVisibility(false);
    questions[activeQ].visible = false; // leaving a question hides it from the candidate
    activeQ = i;
    loadActiveQuestion();
    addLogEntry('event', logText || `Switched to question ${i + 1}: ${questionTitle(questions[i], i)}`);
    replayMark('question');
    renderQuestionTabs();
    saveRoomStateSoon();
  }

  function addQuestion() {
    questions.push(blankQuestionSlot());
    switchQuestion(questions.length - 1, `Added question ${questions.length}`);
    importPanel.classList.remove('hidden');
  }

  function removeQuestion(i) {
    if (questions.length < 2) return;
    if (i === activeQ) snapshotActive();
    const slot = questions[i];
    const hasContent = slot.question.trim() || (slot.code && slot.code.trim()) || slot.testCases.length;
    if (hasContent && !confirm(`Remove question ${i + 1} (${questionTitle(slot, i)}) and its code from this interview?`)) return;
    if (i === activeQ) {
      trackQuestionVisibility(false);
      questions.splice(i, 1);
      activeQ = Math.min(i, questions.length - 1);
      loadActiveQuestion();
    } else {
      questions.splice(i, 1);
      if (i < activeQ) activeQ--;
    }
    renderQuestionTabs();
    saveRoomStateSoon();
  }

  function fmtQuestionTime(ms) {
    const m = Math.floor(ms / 60000);
    return m < 1 ? '<1m' : `${m}m`;
  }

  function renderQuestionTabs() {
    if (role !== 'interviewer') return;
    questionTabsEl.classList.remove('hidden');
    questionTabsEl.innerHTML = '';
    questions.forEach((slot, i) => {
      const tab = document.createElement('div');
      tab.className = 'q-tab' + (i === activeQ ? ' active' : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-tab-main';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(i === activeQ));
      const num = document.createElement('span');
      num.className = 'q-tab-num';
      num.textContent = String(i + 1);
      const title = document.createElement('span');
      title.className = 'q-tab-title';
      title.textContent = questionTitle(slot, i);
      btn.append(num, title);
      const t = questionTimeMs(slot);
      if (t > 0) {
        const time = document.createElement('span');
        time.className = 'q-tab-time' + (slot.visibleSince ? ' live' : '');
        time.textContent = fmtQuestionTime(t);
        btn.appendChild(time);
      }
      btn.addEventListener('click', () => switchQuestion(i));
      tab.appendChild(btn);
      if (questions.length > 1) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'q-tab-remove';
        x.textContent = '×';
        x.setAttribute('aria-label', `Remove question ${i + 1}`);
        x.addEventListener('click', () => removeQuestion(i));
        tab.appendChild(x);
      }
      questionTabsEl.appendChild(tab);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'q-tab-add';
    add.textContent = 'Add question';
    add.addEventListener('click', addQuestion);
    questionTabsEl.appendChild(add);
  }

  if (role === 'interviewer') {
    renderQuestionTabs();
    setInterval(() => { if (questions.some(q => q.visibleSince)) renderQuestionTabs(); }, 15000);
    questionArea.addEventListener('input', () => {
      if (!questions[activeQ].title) renderQuestionTabs();
    });
  }

  // ---------- Interview log (interviewer only) ----------
  // One timeline for everything worth remembering when writing feedback:
  // the interviewer's own notes plus candidate pastes, tab switches, and
  // test runs, each stamped with the interview clock.
  const pasteLog = document.getElementById('pasteLog');
  const pasteLogList = document.getElementById('pasteLogList');
  const logForm = document.getElementById('logForm');
  const logInput = document.getElementById('logInput');
  const LOG_EMPTY_HTML = pasteLogList.innerHTML;
  let logEntries = []; // { at, kind: note|event|paste|away|run, text }
  if (role === 'interviewer') pasteLog.classList.remove('hidden');

  function renderLog() {
    if (!logEntries.length) { pasteLogList.innerHTML = LOG_EMPTY_HTML; return; }
    pasteLogList.innerHTML = '';
    for (let i = logEntries.length - 1; i >= 0; i--) {
      const e = logEntries[i];
      const row = document.createElement('div');
      row.className = 'log-row log-' + e.kind;
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = interviewClock(e.at);
      const text = document.createElement('span');
      text.className = 'log-text';
      text.textContent = e.text;
      row.append(time, text);
      pasteLogList.appendChild(row);
    }
  }

  function addLogEntry(kind, text, at) {
    if (role !== 'interviewer') return;
    logEntries.push({ at: at || Date.now(), kind, text });
    renderLog();
    saveRoomStateSoon();
  }

  if (role === 'interviewer') {
    logForm.addEventListener('submit', e => {
      e.preventDefault();
      const text = logInput.value.trim();
      if (!text) return;
      addLogEntry('note', text);
      logInput.value = '';
    });
  }

  // The candidate's tab visibility (switched away / came back) is a useful,
  // low-friction signal for the interviewer — not proctoring-grade, just a
  // heads up, same spirit as the paste flag.
  if (role === 'candidate') {
    document.addEventListener('visibilitychange', () => {
      broadcast({ type: 'visibility', hidden: document.hidden, at: Date.now() });
    });
  }

  // ---------- Code playback (interviewer only) ----------
  // Every edit (from either side) is recorded as range replacements with a
  // timestamp, starting from a snapshot of the buffer. Playing them back
  // shows how the solution was built: false starts, rewrites, big pastes.
  const REPLAY_MAX_EVENTS = 15000;
  let replay = { start: { t: Date.now(), value: editor.getValue() }, events: [], marks: [] };

  function resetReplay() {
    replay = { start: { t: Date.now(), value: editor.getValue() }, events: [], marks: [] };
  }

  function applyOpsToDoc(doc, ops) {
    ops.forEach(op => doc.replaceRange(op.text.join('\n'), op.from, op.to));
  }

  if (role === 'interviewer') {
    editor.on('changes', (cm, changes) => {
      replay.events.push({
        t: Date.now(),
        ops: changes.map(c => ({ from: { line: c.from.line, ch: c.from.ch }, to: { line: c.to.line, ch: c.to.ch }, text: c.text.slice() })),
      });
      // Keep storage bounded: fold the oldest edits into the snapshot.
      if (replay.events.length > REPLAY_MAX_EVENTS) {
        const fold = replay.events.splice(0, 2000);
        const doc = new CodeMirror.Doc(replay.start.value);
        fold.forEach(ev => applyOpsToDoc(doc, ev.ops));
        replay.start = { t: fold[fold.length - 1].t, value: doc.getValue() };
      }
      saveRoomStateSoon();
    });
  }

  function replayMark(kind, at) {
    if (role !== 'interviewer') return;
    replay.marks.push({ t: at || Date.now(), kind });
  }

  const replayOverlay = document.getElementById('replayOverlay');
  const replaySlider = document.getElementById('replaySlider');
  const replayPlayBtn = document.getElementById('replayPlay');
  const replayTimeEl = document.getElementById('replayTime');
  const replaySpeed = document.getElementById('replaySpeed');
  const replayMarkersEl = document.getElementById('replayMarkers');
  let replayViewer = null;
  let replayState = null; // { timeline, idx, pos, playing, raf, last }

  // Idle stretches are squeezed to at most 2s so playback isn't mostly
  // waiting; positions are in this compressed "virtual" time.
  const REPLAY_MAX_GAP = 2000;
  function buildTimeline() {
    const points = [];
    let v = 0;
    let prev = replay.start.t;
    replay.events.forEach(ev => {
      v += Math.min(Math.max(0, ev.t - prev), REPLAY_MAX_GAP);
      points.push(v);
      prev = ev.t;
    });
    const toVirtual = t => {
      // Map a real timestamp onto the compressed timeline.
      let i = replay.events.findIndex(ev => ev.t >= t);
      if (i < 0) return v;
      const before = i === 0 ? replay.start.t : replay.events[i - 1].t;
      const base = i === 0 ? 0 : points[i - 1];
      return base + Math.min(Math.max(0, t - before), REPLAY_MAX_GAP);
    };
    return { points, total: v, toVirtual };
  }

  function replaySeek(pos) {
    const st = replayState;
    pos = Math.max(0, Math.min(pos, st.timeline.total));
    let target = 0;
    while (target < st.timeline.points.length && st.timeline.points[target] <= pos) target++;
    if (target < st.idx) {
      replayViewer.setValue(replay.start.value);
      st.idx = 0;
    }
    let lastOp = null;
    replayViewer.operation(() => {
      for (; st.idx < target; st.idx++) {
        const ops = replay.events[st.idx].ops;
        applyOpsToDoc(replayViewer, ops);
        lastOp = ops[ops.length - 1];
      }
    });
    if (lastOp) {
      const end = CodeMirror.changeEnd({ from: lastOp.from, to: lastOp.to, text: lastOp.text });
      replayViewer.setCursor(end);
      replayViewer.scrollIntoView(end, 80);
    }
    st.pos = pos;
    replaySlider.value = String(Math.round(pos));
    const realT = st.idx > 0 ? replay.events[st.idx - 1].t : replay.start.t;
    replayTimeEl.textContent = interviewClock(realT);
  }

  function replayStop() {
    if (!replayState) return;
    replayState.playing = false;
    cancelAnimationFrame(replayState.raf);
    replayPlayBtn.textContent = 'Play';
  }

  function replayTick(now) {
    const st = replayState;
    if (!st || !st.playing) return;
    const dt = (now - st.last) * +replaySpeed.value;
    st.last = now;
    replaySeek(st.pos + dt);
    if (st.pos >= st.timeline.total) { replayStop(); return; }
    st.raf = requestAnimationFrame(replayTick);
  }

  function openReplay() {
    if (!replay.events.length) {
      setOutput('Nothing to play back yet — playback records every edit from when the room opened.');
      return;
    }
    replayOverlay.classList.remove('hidden');
    if (!replayViewer) {
      replayViewer = CodeMirror.fromTextArea(document.getElementById('replayArea'), {
        theme: 'onsite', lineNumbers: true, readOnly: true, tabSize: INDENT, indentUnit: INDENT,
      });
    }
    replayViewer.setOption('mode', LANGS[langSelect.value].cmMode);
    replayViewer.setValue(replay.start.value);
    const timeline = buildTimeline();
    replayState = { timeline, idx: 0, pos: 0, playing: false, raf: 0, last: 0 };
    replaySlider.max = String(Math.max(1, Math.round(timeline.total)));
    replayMarkersEl.innerHTML = '';
    // Pastes and tab switches are the markers that matter most, so draw
    // them last (on top), and stack markers that would overlap.
    const priority = { start: 0, question: 1, run: 2, away: 3, paste: 4 };
    const placed = [];
    replay.marks.slice().sort((a, b) => (priority[a.kind] || 0) - (priority[b.kind] || 0)).forEach(m => {
      const pct = (timeline.toVirtual(m.t) / Math.max(1, timeline.total)) * 100;
      let row = 0;
      while (placed.some(p => p.row === row && Math.abs(p.pct - pct) < 1.2)) row++;
      placed.push({ row, pct });
      const dot = document.createElement('span');
      dot.className = 'mk mk-' + m.kind;
      dot.style.left = `${pct}%`;
      dot.style.top = `${-row * 10}px`;
      dot.title = `${{ paste: 'Paste', away: 'Left the tab', run: 'Code run', start: 'Interview started', question: 'Switched question' }[m.kind] || m.kind} at ${interviewClock(m.t)}`;
      replayMarkersEl.appendChild(dot);
    });
    replaySeek(0);
    setTimeout(() => replayViewer.refresh(), 0);
    replayPlayBtn.focus();
  }

  function closeReplay() {
    replayStop();
    replayOverlay.classList.add('hidden');
  }

  if (role === 'interviewer') {
    document.getElementById('replayBtn').addEventListener('click', openReplay);
    document.getElementById('replayClose').addEventListener('click', closeReplay);
    replayOverlay.addEventListener('click', e => { if (e.target === replayOverlay) closeReplay(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !replayOverlay.classList.contains('hidden')) closeReplay();
    });
    replayPlayBtn.addEventListener('click', () => {
      const st = replayState;
      if (!st) return;
      if (st.playing) { replayStop(); return; }
      if (st.pos >= st.timeline.total) replaySeek(0);
      st.playing = true;
      st.last = performance.now();
      replayPlayBtn.textContent = 'Pause';
      st.raf = requestAnimationFrame(replayTick);
    });
    replaySlider.addEventListener('input', () => {
      replayStop();
      replaySeek(+replaySlider.value);
    });
  }

  // ---------- Scorecard (interviewer only) ----------
  const feedbackPane = document.getElementById('feedbackPane');
  const feedbackScoresEl = document.getElementById('feedbackScores');
  const feedbackSummary = document.getElementById('feedbackSummary');
  const verdictBadge = document.getElementById('verdictBadge');
  const FEEDBACK_CATEGORIES = ['Problem solving', 'Coding', 'Communication'];
  const SCORE_LABELS = { 1: 'Weak', 2: 'Mixed', 3: 'Solid', 4: 'Strong' };
  const feedbackScores = {};
  let currentVerdict = null;
  let candidateDisplayName = '';

  // Questions that have anything in them, with the active one's live state.
  function questionsForReport() {
    if (role === 'interviewer') snapshotActive();
    return questions
      .map((q, i) => ({
        title: questionTitle(q, i),
        difficulty: q.meta.difficulty || null,
        timeMs: questionTimeMs(q),
        lastRun: q.lastRun,
        testsTotal: q.testCases.length,
        lang: q.lang,
        code: (q.code || '').slice(0, 20000),
        empty: !q.question.trim() && !(q.code || '').trim(),
      }))
      .filter(q => !q.empty);
  }

  function buildSessionSummary() {
    const reportQuestions = questionsForReport();
    const lines = [`Onsite interview — room ${room}`, `Date: ${new Date().toLocaleString()}`];
    if (candidateDisplayName) lines.push(`Candidate: ${candidateDisplayName}`);
    if (startTime) {
      const mins = Math.round((Date.now() - startTime) / 60000);
      lines.push(`Duration: ${mins} of ${durationMin} min`);
    }
    if (currentMeta.difficulty) {
      lines.push(`Difficulty: ${currentMeta.difficulty}`);
    }
    lines.push('');
    FEEDBACK_CATEGORIES.forEach(cat => {
      lines.push(`${cat}: ${feedbackScores[cat] ? `${feedbackScores[cat]}/4 (${SCORE_LABELS[feedbackScores[cat]]})` : 'not rated'}`);
    });
    lines.push('');
    lines.push(`Overall: ${currentVerdict === 'pass' ? 'Pass' : currentVerdict === 'fail' ? 'No pass' : 'Not set'}`);
    const summary = feedbackSummary.value.trim();
    if (summary) { lines.push(''); lines.push('Summary:'); lines.push(summary); }
    if (logEntries.length) {
      lines.push('');
      lines.push('Interview log:');
      logEntries.forEach(e => lines.push(`  ${interviewClock(e.at)}  ${e.text}`));
    }
    reportQuestions.forEach((q, i) => {
      lines.push('');
      const facts = [q.difficulty, q.timeMs ? `${Math.round(q.timeMs / 60000)} min` : null, q.lastRun ? `tests ${q.lastRun.passed}/${q.lastRun.total}` : null].filter(Boolean);
      lines.push(`Question ${i + 1}: ${q.title}${facts.length ? ` (${facts.join(', ')})` : ''}`);
      lines.push(`Final code (${LANGS[q.lang] ? LANGS[q.lang].label : 'code'}):`);
      lines.push(q.code || '(none)');
    });
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
        plannedMin: durationMin,
        notes: logEntries.filter(e => e.kind === 'note').map(e => `${interviewClock(e.at)} ${e.text}`),
        log: logEntries.map(e => ({ time: interviewClock(e.at), kind: e.kind, text: e.text })),
        questions: reportQuestions.map(({ empty, ...q }) => q),
        questionSnippet: reportQuestions.map(q => q.title).join(', ').slice(0, 140),
      },
    };
  }

  function saveSessionToHistory() {
    if (role !== 'interviewer') return;
    const { record } = buildSessionSummary();
    const hasContent = record.verdict || record.summary || record.notes.length || Object.keys(record.scores).length > 0;
    if (!hasContent) return; // nothing happened yet — don't clutter history
    try {
      const existing = JSON.parse(localStorage.getItem('onsite-history') || localStorage.getItem('mockmate-history') || '[]');
      existing.unshift(record);
      localStorage.setItem('onsite-history', JSON.stringify(existing.slice(0, 50)));
    } catch {}
  }

  document.getElementById('leaveLink').addEventListener('click', () => {
    if (role !== 'interviewer') return;
    saveSessionToHistory();
    clearRoomState();
  });

  function renderScores() {
    feedbackScoresEl.querySelectorAll('.feedback-category').forEach(row => {
      const cat = row.dataset.cat;
      row.querySelectorAll('button').forEach(b => b.classList.toggle('active', +b.dataset.score === feedbackScores[cat]));
      row.querySelector('.feedback-score-word').textContent = feedbackScores[cat] ? SCORE_LABELS[feedbackScores[cat]] : '';
    });
  }

  if (role !== 'interviewer') {
    feedbackPane.classList.add('hidden');
  } else {
    feedbackPane.classList.remove('hidden');
    FEEDBACK_CATEGORIES.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'feedback-category';
      row.dataset.cat = cat;
      const label = document.createElement('span');
      label.className = 'feedback-category-label';
      label.textContent = cat;
      const word = document.createElement('span');
      word.className = 'feedback-score-word';
      const scale = document.createElement('div');
      scale.className = 'feedback-scale';
      scale.setAttribute('role', 'group');
      scale.setAttribute('aria-label', cat);
      [1, 2, 3, 4].forEach(n => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(n);
        b.dataset.score = String(n);
        b.title = SCORE_LABELS[n];
        b.addEventListener('click', () => {
          feedbackScores[cat] = feedbackScores[cat] === n ? undefined : n;
          if (!feedbackScores[cat]) delete feedbackScores[cat];
          renderScores();
          saveRoomStateSoon();
        });
        scale.appendChild(b);
      });
      row.append(label, word, scale);
      feedbackScoresEl.appendChild(row);
    });
    feedbackSummary.addEventListener('input', saveRoomStateSoon);

    document.getElementById('passBtn').addEventListener('click', () => setVerdict('pass'));
    document.getElementById('failBtn').addEventListener('click', () => setVerdict('fail'));
    document.getElementById('clearVerdictBtn').addEventListener('click', () => setVerdict(null));

    document.getElementById('openReportBtn').addEventListener('click', () => {
      window.OnsiteReport.open(buildSessionSummary().record);
    });

    document.getElementById('copyFeedbackBtn').addEventListener('click', e => {
      copyText(buildSessionSummary().text, e.currentTarget);
    });

    function resetRoomForNextCandidate() {
      if (!confirm('Reset the room for the next candidate? This saves the scorecard to Past interviews, clears everything else, and disconnects the current candidate.')) return;
      saveSessionToHistory();
      if (dataConn) {
        dataConn.send({ type: 'kicked' });
        dataConn.close();
        dataConn = null;
      }
      updateEndAccessVisibility();

      suppressEmit = true;
      editor.setValue(DEFAULT_PY_STARTER);
      editor.clearHistory();
      suppressEmit = false;
      langSelect.value = 'python';
      editor.setOption('mode', LANGS.python.cmMode);
      outputPane.textContent = OUTPUT_EMPTY;

      questionArea.value = '';
      setQuestionVisible(false);
      currentMeta = { difficulty: '' };
      setDifficultyButtonsActive('');
      renderQuestionBadges(currentMeta);

      testCases = [];
      renderTestcases();
      questions = [blankQuestionSlot()];
      activeQ = 0;
      renderQuestionTabs();

      solutionArea.value = '';
      logEntries = [];
      renderLog();

      wbObjects = [];
      wbSelectedId = null;
      wbUndoStack = [];
      wbRedoStack = [];
      setMode('code');

      FEEDBACK_CATEGORIES.forEach(cat => delete feedbackScores[cat]);
      renderScores();
      feedbackSummary.value = '';
      setVerdict(null); // also un-ends the session if it had ended (timeout/fail)
      candidateDisplayName = '';
      admittedName = '';

      resetTimerDisplay();
      broadcast(timerSyncMsg());
      resetReplay();
      clearRoomState();
      setConnStatus('Waiting for your candidate', 'waiting');
    }

    document.getElementById('resetRoomBtn').addEventListener('click', resetRoomForNextCandidate);
    document.getElementById('sessionEndResetBtn').addEventListener('click', resetRoomForNextCandidate);
  }

  function endSession(reason) {
    if (sessionEnded) return;
    sessionEnded = true;
    if (timerInterval) clearInterval(timerInterval);
    editor.setOption('readOnly', true);
    document.querySelector('.main-layout').classList.add('hidden');
    document.getElementById('sessionEndOverlay').classList.remove('hidden');
    const timeout = reason === 'timeout';
    document.getElementById('sessionEndTitle').textContent =
      role === 'interviewer' ? (timeout ? "Time's up" : 'Interview ended') : (timeout ? "Time's up" : 'You failed');
    document.getElementById('sessionEndReason').textContent = timeout
      ? `The ${durationMin}-minute interview ended automatically.`
      : role === 'interviewer'
        ? 'You marked this interview as no pass. Your scorecard and log are saved.'
        : 'The interviewer marked this as a fail.';
    if (role === 'interviewer') document.getElementById('sessionEndResetBtn').classList.remove('hidden');
  }

  function unendSession() {
    if (!sessionEnded) return;
    sessionEnded = false;
    document.getElementById('sessionEndOverlay').classList.add('hidden');
    const candidateStillWaiting = role === 'candidate' && !admitted;
    if (!candidateStillWaiting) document.querySelector('.main-layout').classList.remove('hidden');
    if (role === 'interviewer') editor.setOption('readOnly', false);
  }

  function setVerdict(value, fromPeer, reason) {
    currentVerdict = value;
    if (value === 'pass') {
      verdictBadge.textContent = 'Pass';
      verdictBadge.className = 'verdict-badge pass';
    } else if (value === 'fail') {
      verdictBadge.textContent = 'No pass';
      verdictBadge.className = 'verdict-badge fail';
      endSession(reason || 'fail');
    } else {
      verdictBadge.className = 'verdict-badge hidden';
      unendSession();
    }
    if (!fromPeer) {
      broadcast({ type: 'verdict', value, reason });
      saveRoomStateSoon();
    }
  }

  // ---------- Room state that survives a refresh (interviewer only) ----------
  // Saved to this browser only, keyed by room code, so an accidental
  // refresh or closed tab mid-interview doesn't wipe the code, question,
  // tests, log, scorecard, or playback. Cleared on Leave or reset.
  const ROOM_STATE_KEY = `onsite-room-${room}`;
  const ROOM_STATE_TTL = 3 * 24 * 3600 * 1000;
  let roomStateTimer = null;
  let roomStateReady = false; // don't save over saved state before restoring it

  function saveRoomStateSoon() {
    if (role !== 'interviewer' || !roomStateReady) return;
    if (roomStateTimer) clearTimeout(roomStateTimer);
    roomStateTimer = setTimeout(saveRoomState, 800);
  }

  function saveRoomState() {
    if (role !== 'interviewer' || !roomStateReady) return;
    if (roomStateTimer) { clearTimeout(roomStateTimer); roomStateTimer = null; }
    snapshotActive();
    const state = {
      questions,
      activeQ,
      v: 1,
      savedAt: Date.now(),
      code: editor.getValue(),
      lang: langSelect.value,
      question: questionArea.value,
      questionVisible,
      meta: currentMeta,
      testCases: testCases.map(tc => ({ input: tc.input, expected: tc.expected, hidden: !!tc.hidden })),
      solution: solutionArea.value,
      log: logEntries,
      scores: feedbackScores,
      summary: feedbackSummary.value,
      verdict: currentVerdict,
      startTime,
      durationMin,
      candidateName: candidateDisplayName,
      admittedName,
      wb: wbObjects,
      replay,
    };
    try {
      localStorage.setItem(ROOM_STATE_KEY, JSON.stringify(state));
    } catch {
      // Over quota — playback is by far the largest part; drop it first.
      try { localStorage.setItem(ROOM_STATE_KEY, JSON.stringify({ ...state, replay: null })); } catch {}
    }
  }

  function clearRoomState() {
    if (roomStateTimer) { clearTimeout(roomStateTimer); roomStateTimer = null; }
    try { localStorage.removeItem(ROOM_STATE_KEY); } catch {}
  }

  function restoreRoomState() {
    if (role !== 'interviewer') return;
    let state = null;
    try {
      // Prune other rooms' state that's gone stale.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('onsite-room-') || k === ROOM_STATE_KEY) continue;
        const other = JSON.parse(localStorage.getItem(k) || 'null');
        if (!other || Date.now() - other.savedAt > ROOM_STATE_TTL) localStorage.removeItem(k);
      }
      state = JSON.parse(localStorage.getItem(ROOM_STATE_KEY) || 'null');
    } catch {}
    if (!state || state.v !== 1 || Date.now() - state.savedAt > ROOM_STATE_TTL) return;

    suppressEmit = true;
    langSelect.value = LANGS[state.lang] ? state.lang : 'python';
    editor.setOption('mode', LANGS[langSelect.value].cmMode);
    editor.setValue(state.code || '');
    editor.clearHistory();
    suppressEmit = false;
    questionArea.value = state.question || '';
    setQuestionVisible(!!state.questionVisible);
    currentMeta = state.meta || { difficulty: '' };
    setDifficultyButtonsActive(currentMeta.difficulty);
    renderQuestionBadges(currentMeta);
    testCases = (state.testCases || []).map(tc => ({ ...tc }));
    renderTestcases();
    if (Array.isArray(state.questions) && state.questions.length) {
      questions = state.questions;
      activeQ = Math.min(state.activeQ || 0, questions.length - 1);
    }
    renderQuestionTabs();
    solutionArea.value = state.solution || '';
    logEntries = state.log || [];
    Object.assign(feedbackScores, state.scores || {});
    renderScores();
    feedbackSummary.value = state.summary || '';
    candidateDisplayName = state.candidateName || '';
    admittedName = state.admittedName || '';
    wbObjects = state.wb || [];
    if (state.replay && state.replay.start) replay = state.replay;
    else resetReplay();
    if (DURATIONS.includes(state.durationMin)) {
      durationMin = state.durationMin;
      durationSelect.value = String(durationMin);
    }
    if (state.startTime) startTimer(state.startTime);
    else resetTimerDisplay();
    renderLog();
    if (state.verdict) setVerdict(state.verdict, true);
    setOutput('Restored this room from your last visit.');
  }
  window.addEventListener('pagehide', saveRoomState);

  // ---------- Invite link (interviewer only) ----------
  const copyRoomLinkBtn = document.getElementById('copyRoomLink');
  const inviteCard = document.getElementById('inviteCard');
  if (role === 'interviewer') {
    copyRoomLinkBtn.classList.remove('hidden');
    copyRoomLinkBtn.addEventListener('click', () => copyText(inviteLink, copyRoomLinkBtn, 'Link copied'));
    document.getElementById('roomCodePill').addEventListener('click', () => copyText(inviteLink, document.getElementById('roomChip'), 'Copied'));
    document.getElementById('inviteLinkText').textContent = inviteLink.replace(/^https?:\/\//, '');
    const inviteCopyBtn = document.getElementById('inviteCopyBtn');
    inviteCopyBtn.addEventListener('click', () => copyText(inviteLink, inviteCopyBtn));
  } else {
    document.getElementById('roomCodePill').disabled = true;
  }
  // The invite card is the interviewer's empty state: shown until a
  // candidate is in the room.
  function updateInviteCard() {
    if (role !== 'interviewer') return;
    inviteCard.classList.toggle('hidden', !!(dataConn && dataConn.open) || !!pendingConn);
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
      const saved = localStorage.getItem('onsite-sidebar-width');
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
      localStorage.setItem('onsite-sidebar-width', String(Math.round(sidePane.getBoundingClientRect().width)));
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
    connDot.classList.toggle('error', state === 'error');
    updateInviteCard();
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

  const peerId = role === 'interviewer' ? `onsite-${room}` : `onsite-${room}-${Math.random().toString(36).slice(2, 8)}`;
  const peer = new Peer(peerId, { config: { iceServers } });

  // dataConn is only set once the interviewer has actually admitted the
  // candidate — broadcast() (and everyone's UI) treats "connected" as
  // "admitted", not just "the data channel happens to be open".
  let dataConn = null;
  let admitted = role === 'interviewer'; // the interviewer doesn't need admitting
  let pendingConn = null; // interviewer: a connection waiting on a decision
  let admittedName = ''; // interviewer: who's been let in (auto-readmitted on reconnect)
  let deniedPermanently = false; // candidate: interviewer explicitly said no — stop auto-retrying

  function broadcast(msg) {
    if (!(dataConn && dataConn.open && admitted)) return;
    try {
      dataConn.send(msg);
    } catch (e) {
      console.error('failed to send', msg.type, e);
    }
  }

  // Restore after everything above exists (it calls broadcast(), which
  // is a no-op until a candidate is admitted).
  restoreRoomState();
  roomStateReady = true;

  const admitBanner = document.getElementById('admitBanner');
  const admitBannerText = document.getElementById('admitBannerText');

  function sendFullState(conn) {
    conn.send(timerSyncMsg());
    conn.send({ type: 'question', value: questionArea.value, visible: questionVisible });
    conn.send({ type: 'meta', value: currentMeta });
    conn.send(testcasesMsg());
    conn.send({ type: 'code', value: editor.getValue() });
    conn.send({ type: 'lang', value: langSelect.value });
    conn.send({ type: 'verdict', value: currentVerdict });
    conn.send({ type: 'mode', value: mode });
    conn.send({ type: 'wb-sync', objects: wbObjects });
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
      setConnStatus(`${candidateDisplayName || 'Candidate'} is here`, 'connected');
      updateEndAccessVisibility();
      addLogEntry('event', admittedName === candidateDisplayName ? `${candidateDisplayName} reconnected` : `${candidateDisplayName || 'Candidate'} joined`);
      admittedName = candidateDisplayName;
      saveRoomStateSoon();
    });
    document.getElementById('denyBtn').addEventListener('click', () => {
      if (!pendingConn) return;
      pendingConn.send({ type: 'denied' });
      pendingConn.close();
      pendingConn = null;
      admitBanner.classList.add('hidden');
      setConnStatus('Waiting for your candidate', 'waiting');
    });
    endAccessBtn.addEventListener('click', () => {
      if (!dataConn) return;
      dataConn.send({ type: 'kicked' });
      dataConn.close();
      dataConn = null;
      admittedName = '';
      addLogEntry('event', `Removed ${candidateDisplayName || 'the candidate'} from the room`);
      setConnStatus('Waiting for your candidate', 'waiting');
      updateEndAccessVisibility();
    });
  }

  function watchConnectionHealth(conn) {
    const pc = conn.peerConnection;
    if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') {
        setConnStatus('Connection failed — a firewall or VPN on one side is likely blocking it', 'error');
      } else if (pc.iceConnectionState === 'disconnected') {
        setConnStatus('Connection dropped. Reconnecting…', 'waiting');
      } else if ((pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') && conn.open && admitted) {
        setConnStatus(connectedLabel(), 'connected');
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
        setConnStatus('Waiting for the interviewer to let you in…', 'waiting');
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
        setConnStatus(role === 'interviewer' ? 'Candidate left' : 'Interviewer disconnected. Reconnecting…', 'idle');
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
      setConnStatus('Connection error. Refresh both windows to reconnect.', 'error');
    });
  }

  function handleData(msg, conn) {
    switch (msg.type) {
      case 'join-request':
        if (role !== 'interviewer') break;
        remoteName = `${msg.name} (candidate)`;
        // Someone you already let in, reconnecting after a refresh or a
        // dropped connection on either side, comes straight back in.
        if (admittedName && msg.name === admittedName) {
          candidateDisplayName = msg.name;
          document.getElementById('admitBtn').click();
          break;
        }
        candidateDisplayName = msg.name;
        admitBannerText.textContent = `${msg.name} wants to join the room.`;
        admitBanner.classList.remove('hidden');
        setConnStatus(`${msg.name} is waiting to join`, 'waiting');
        break;
      case 'admitted':
        admitted = true;
        editor.setOption('readOnly', false);
        setConnStatus(connectedLabel(), 'connected');
        break;
      case 'denied':
        editor.setOption('readOnly', true);
        deniedPermanently = msg.reason !== 'occupied';
        setConnStatus(
          msg.reason === 'occupied'
            ? 'This room already has a candidate in it.'
            : "The interviewer didn't let you in. Check with them, then refresh to ask again.",
          'error'
        );
        break;
      case 'kicked':
        unendSession();
        editor.setOption('readOnly', true);
        deniedPermanently = true;
        admitted = false;
        setConnStatus('The interviewer removed you from the room. Refresh to ask to join again.', 'error');
        break;
      case 'hello':
        remoteName = `${msg.name} (${msg.role})`;
        break;
      case 'cursor':
        showRemoteCursor(msg.line, msg.ch, msg.sel);
        break;
      case 'code':
        applyRemoteCode(null, msg.value);
        break;
      case 'code-ops':
        applyRemoteCode(msg.ops, msg.value);
        break;
      case 'lang':
        langSelect.value = msg.value;
        editor.setOption('mode', LANGS[msg.value].cmMode);
        break;
      case 'timer-sync':
        if (role === 'candidate') {
          timerEl.classList.remove('hidden');
          if (msg.duration) durationMin = msg.duration;
          if (msg.startTime) startTimer(msg.startTime);
          else resetTimerDisplay();
        }
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
        if (role === 'candidate') questionArea.classList.toggle('hidden', !msg.visible);
        suppressQuestionEmit = false;
        break;
      case 'testcases':
        testCases = (msg.value || []).map(tc => ({ input: tc.input, expected: tc.expected }));
        renderTestcases();
        if (role === 'candidate') testcasePane.classList.toggle('hidden', !msg.visible);
        break;
      case 'meta':
        currentMeta = msg.value || { difficulty: '' };
        renderQuestionBadges(currentMeta);
        break;
      case 'paste-flag':
        if (role === 'interviewer') {
          addLogEntry('paste', `Pasted ${msg.chars} characters`, msg.at);
          replayMark('paste', msg.at);
        }
        break;
      case 'visibility':
        if (role === 'interviewer') {
          addLogEntry(msg.hidden ? 'away' : 'event', msg.hidden ? 'Left the interview tab' : 'Came back to the tab', msg.at);
          if (msg.hidden) replayMark('away', msg.at);
        }
        break;
      case 'verdict':
        setVerdict(msg.value, true, msg.reason);
        break;
      case 'mode':
        setMode(msg.value, true);
        break;
      case 'wb-obj-start': {
        const idx = wbObjects.findIndex(o => o.id === msg.obj.id);
        if (idx >= 0) wbObjects[idx] = msg.obj; else wbObjects.push(msg.obj);
        if (mode === 'draw') redrawWhiteboard();
        break;
      }
      case 'wb-obj-patch': {
        const obj = wbObjects.find(o => o.id === msg.id);
        if (obj) {
          Object.assign(obj, msg.patch);
          if (mode === 'draw') redrawWhiteboard();
        }
        break;
      }
      case 'wb-obj-delete':
        wbObjects = wbObjects.filter(o => o.id !== msg.id);
        if (wbSelectedId === msg.id) wbSelectedId = null;
        if (mode === 'draw') redrawWhiteboard();
        break;
      case 'wb-clear':
        wbObjects = [];
        wbSelectedId = null;
        if (mode === 'draw') redrawWhiteboard();
        break;
      case 'wb-sync':
        wbObjects = msg.objects || [];
        wbSelectedId = null;
        if (mode === 'draw') redrawWhiteboard();
        break;
    }
  }

  function connectedLabel() {
    return role === 'interviewer' ? `${candidateDisplayName || 'Candidate'} is here` : 'Connected to your interviewer';
  }

  let connectAttempts = 0;
  function connectToHost() {
    const hostId = `onsite-${room}`;
    setConnStatus(connectAttempts === 0 ? 'Connecting…' : 'Waiting for the interviewer to open the room…', 'waiting');
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

  // Candidates who arrive via an invite link name themselves before knocking.
  const nameForm = document.getElementById('nameForm');
  const nameFormInput = document.getElementById('nameFormInput');
  document.getElementById('waitingRoom').textContent = room;
  let peerOpen = false;
  function candidateReady() {
    if (peerOpen && myName) connectToHost();
  }
  if (role === 'candidate' && !myName) {
    try { nameFormInput.value = localStorage.getItem('onsite-name') || ''; } catch {}
    nameForm.classList.remove('hidden');
    waitingText.classList.add('hidden');
    setTimeout(() => nameFormInput.focus(), 0);
    nameForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = nameFormInput.value.trim();
      if (!name) return;
      myName = name;
      try { localStorage.setItem('onsite-name', name); } catch {}
      nameForm.classList.add('hidden');
      waitingText.classList.remove('hidden');
      candidateReady();
    });
  }

  peer.on('open', () => {
    peerOpen = true;
    if (role === 'candidate') {
      candidateReady();
    } else {
      setConnStatus('Waiting for your candidate', 'waiting');
    }
  });

  peer.on('connection', conn => {
    wireDataConn(conn);
  });

  peer.on('disconnected', () => {
    setConnStatus('Lost the connection to the server. Reconnecting…', 'waiting');
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
      setConnStatus("The interviewer isn't in the room yet. You'll connect as soon as they open it.", 'waiting');
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      setConnStatus("Can't reach the connection server. Check your internet connection.", 'error');
    } else if (err.type === 'unavailable-id') {
      setConnStatus('This room is already open in another tab or browser. Close it there, or start a new interview.', 'error');
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
        ? 'Still connecting — this can take a little longer on some networks…'
        : 'Waiting for your candidate',
      'waiting'
    );
  }, 12000);
})();
