(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || 'ROOM01').toUpperCase();
  const role = params.get('role') === 'interviewer' ? 'interviewer' : 'candidate';
  const myName = params.get('name') || (role === 'interviewer' ? 'Interviewer' : 'Candidate');

  document.getElementById('roomChip').textContent = room;

  // ---------- CodeMirror ----------
  const editor = CodeMirror.fromTextArea(document.getElementById('codeArea'), {
    mode: 'python',
    theme: 'dracula',
    lineNumbers: true,
    tabSize: 4,
    indentUnit: 4,
    value: ''
  });
  editor.setValue('# Write code here — it syncs live with your peer\ndef two_sum(nums, target):\n    pass\n');

  const langSelect = document.getElementById('langSelect');
  langSelect.addEventListener('change', () => {
    editor.setOption('mode', langSelect.value);
    broadcast({ type: 'lang', value: langSelect.value });
  });

  let suppressEmit = false;
  editor.on('change', () => {
    if (suppressEmit) return;
    broadcast({ type: 'code', value: editor.getValue() });
  });

  // ---------- Run (JS only, sandboxed) ----------
  const outputPane = document.getElementById('outputPane');
  document.getElementById('runBtn').addEventListener('click', runCode);
  document.getElementById('clearOutputBtn').addEventListener('click', () => outputPane.textContent = '');

  function runCode() {
    if (langSelect.value !== 'javascript') {
      outputPane.textContent = 'Running is only supported for JavaScript in this demo.';
      return;
    }
    const code = editor.getValue();
    const logs = [];
    const fakeConsole = {
      log: (...args) => logs.push(args.map(String).join(' ')),
      error: (...args) => logs.push('Error: ' + args.map(String).join(' ')),
    };
    try {
      const fn = new Function('console', code);
      fn(fakeConsole);
      outputPane.textContent = logs.length ? logs.join('\n') : '(no output)';
    } catch (e) {
      outputPane.textContent = 'Error: ' + e.message;
    }
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

  // ---------- Chat ----------
  const chatLog = document.getElementById('chatLog');
  function addChatMsg(who, text, system) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (system ? ' system' : '');
    if (system) {
      div.textContent = text;
    } else {
      div.innerHTML = `<span class="who">${escapeHtml(who)}</span>${escapeHtml(text)}`;
    }
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
  function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    addChatMsg(myName, text, false);
    broadcast({ type: 'chat', from: myName, text });
    input.value = '';
  }

  addChatMsg('', `Room ${room} created. Share the room code with your friend to begin.`, true);

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

  // ---------- Solution pane (interviewer only, never broadcast) ----------
  const solutionPane = document.getElementById('solutionPane');
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

  // ---------- Verdict controls (interviewer only) ----------
  const verdictPane = document.getElementById('verdictPane');
  const verdictBadge = document.getElementById('verdictBadge');

  if (role !== 'interviewer') {
    verdictPane.classList.add('hidden');
  } else {
    document.getElementById('passBtn').addEventListener('click', () => setVerdict('pass'));
    document.getElementById('failBtn').addEventListener('click', () => setVerdict('fail'));
    document.getElementById('clearVerdictBtn').addEventListener('click', () => setVerdict(null));
  }

  function setVerdict(value, fromPeer) {
    if (value === 'pass') {
      verdictBadge.textContent = 'Pass';
      verdictBadge.className = 'verdict-badge pass';
      addChatMsg('', 'Verdict: pass.', true);
    } else if (value === 'fail') {
      verdictBadge.textContent = 'No pass';
      verdictBadge.className = 'verdict-badge fail';
      addChatMsg('', 'Verdict: no pass.', true);
    } else {
      verdictBadge.className = 'verdict-badge hidden';
      addChatMsg('', 'Verdict cleared.', true);
    }
    if (!fromPeer) broadcast({ type: 'verdict', value });
  }

  // ---------- PeerJS: signaling + data ----------
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');

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

  let dataConn = null;

  function setConnected(remoteName) {
    connDot.classList.add('connected');
    connText.textContent = 'connected';
    addChatMsg('', `${remoteName || 'Your peer'} connected.`, true);
  }

  function broadcast(msg) {
    if (dataConn && dataConn.open) dataConn.send(msg);
  }

  function watchConnectionHealth(conn) {
    const pc = conn.peerConnection;
    if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') {
        connText.textContent = 'connection failed — likely blocked by a firewall/VPN on one side';
      } else if (pc.iceConnectionState === 'disconnected') {
        connText.textContent = 'connection dropped, trying to recover…';
      } else if ((pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') && conn.open) {
        connText.textContent = 'connected';
      }
    });
  }

  function wireDataConn(conn) {
    dataConn = conn;
    watchConnectionHealth(conn);
    conn.on('open', () => {
      conn.send({ type: 'hello', name: myName, role });
      if (role === 'interviewer') {
        conn.send({ type: 'timer-sync', startTime });
        conn.send({ type: 'question', value: questionArea.value, visible: questionVisible });
      }
    });
    conn.on('data', handleData);
    conn.on('close', () => {
      connDot.classList.remove('connected');
      connText.textContent = 'peer disconnected';
      addChatMsg('', 'Your peer disconnected.', true);
    });
    conn.on('error', err => {
      console.error('data connection error', err);
      connText.textContent = 'connection error — try refreshing both windows';
    });
  }

  function handleData(msg) {
    switch (msg.type) {
      case 'hello':
        setConnected(msg.name);
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
        editor.setOption('mode', msg.value);
        break;
      case 'chat':
        addChatMsg(msg.from, msg.text, false);
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
      case 'verdict':
        setVerdict(msg.value, true);
        break;
    }
  }

  let connectAttempts = 0;
  function connectToHost() {
    const hostId = `mockmate-${room}`;
    connText.textContent = connectAttempts === 0 ? 'connecting…' : `reconnecting (attempt ${connectAttempts + 1})…`;
    const conn = peer.connect(hostId, { reliable: true });
    conn.on('open', () => wireDataConn(conn));
  }

  peer.on('open', () => {
    if (role === 'candidate') {
      connectToHost();
    } else {
      connText.textContent = 'waiting for peer';
    }
  });

  peer.on('connection', conn => {
    wireDataConn(conn);
  });

  peer.on('disconnected', () => {
    connText.textContent = 'lost connection to server, reconnecting…';
    peer.reconnect();
  });

  peer.on('error', err => {
    console.error('peer error', err);
    if (err.type === 'peer-unavailable' && role === 'candidate') {
      connectAttempts++;
      if (connectAttempts < 5) {
        setTimeout(connectToHost, 2000);
      } else {
        connText.textContent = 'room not found — check the code with your interviewer';
      }
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      connText.textContent = 'trouble reaching the signaling server — check your connection';
    } else if (err.type === 'unavailable-id') {
      connText.textContent = 'this room code is already in use — go back and create a new one';
    }
  });

  // If the data channel never opens (common when both sides are behind
  // restrictive NATs and even the TURN relay can't negotiate), surface that
  // instead of leaving the status stuck on a silent "connecting…".
  setTimeout(() => {
    if (!dataConn || !dataConn.open) {
      connText.textContent = role === 'candidate'
        ? 'still trying to connect — this can take longer on some networks'
        : 'still waiting for your candidate to connect';
    }
  }, 12000);
})();
