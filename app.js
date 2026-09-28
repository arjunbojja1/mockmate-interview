(function () {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || 'ROOM01').toUpperCase();
  const role = params.get('role') === 'interviewer' ? 'interviewer' : 'candidate';
  const myName = params.get('name') || (role === 'interviewer' ? 'Interviewer' : 'Candidate');

  document.getElementById('roomChip').textContent = room;
  document.getElementById('localLabel').textContent = `${myName} (you)`;

  // ---------- CodeMirror ----------
  const editor = CodeMirror.fromTextArea(document.getElementById('codeArea'), {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    tabSize: 2,
    value: '// Write code here — it syncs live with your peer\nfunction twoSum(nums, target) {\n  \n}\n'
  });
  editor.setValue('// Write code here — it syncs live with your peer\nfunction twoSum(nums, target) {\n  \n}\n');

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

  // ---------- PeerJS: signaling + data + video ----------
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const remoteLabel = document.getElementById('remoteLabel');

  const peerId = role === 'interviewer' ? `mockmate-${room}` : `mockmate-${room}-${Math.random().toString(36).slice(2, 8)}`;
  const peer = new Peer(peerId);

  let dataConn = null;
  let localStream = null;

  function setConnected(remoteName) {
    connDot.classList.add('connected');
    connText.textContent = 'connected';
    remoteLabel.textContent = remoteName || 'Peer';
    addChatMsg('', `${remoteName || 'Your peer'} connected.`, true);
  }

  function broadcast(msg) {
    if (dataConn && dataConn.open) dataConn.send(msg);
  }

  function wireDataConn(conn) {
    dataConn = conn;
    conn.on('open', () => {
      conn.send({ type: 'hello', name: myName, role });
      if (role === 'interviewer') {
        conn.send({ type: 'timer-sync', startTime });
      }
    });
    conn.on('data', handleData);
    conn.on('close', () => {
      connDot.classList.remove('connected');
      connText.textContent = 'peer disconnected';
      remoteLabel.textContent = 'Disconnected';
      addChatMsg('', 'Your peer disconnected.', true);
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
    }
  }

  peer.on('open', () => {
    if (role === 'candidate') {
      const hostId = `mockmate-${room}`;
      const conn = peer.connect(hostId, { reliable: true });
      conn.on('open', () => wireDataConn(conn));
      conn.on('error', () => {
        connText.textContent = 'could not find that room';
      });
    }
  });

  peer.on('connection', conn => {
    wireDataConn(conn);
  });

  peer.on('error', err => {
    console.error(err);
    if (err.type === 'peer-unavailable') {
      connText.textContent = 'room not found — check the code';
    }
  });

  // Media
  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
      localStream = stream;
      localVideo.srcObject = stream;

      peer.on('call', call => {
        call.answer(stream);
        call.on('stream', remoteStream => {
          remoteVideo.srcObject = remoteStream;
        });
      });

      peer.on('open', () => {
        if (role === 'candidate') {
          const hostId = `mockmate-${room}`;
          const call = peer.call(hostId, stream);
          if (call) {
            call.on('stream', remoteStream => {
              remoteVideo.srcObject = remoteStream;
            });
          }
        }
      });
    })
    .catch(() => {
      addChatMsg('', 'Camera/mic access was denied — video call disabled, but code sync and chat still work.', true);
    });

  // Media controls
  let micOn = true, camOn = true;
  document.getElementById('toggleMic').addEventListener('click', e => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => t.enabled = micOn);
    e.target.textContent = micOn ? '🎙 Mute' : '🎙 Unmute';
    e.target.classList.toggle('off', !micOn);
  });
  document.getElementById('toggleCam').addEventListener('click', e => {
    if (!localStream) return;
    camOn = !camOn;
    localStream.getVideoTracks().forEach(t => t.enabled = camOn);
    e.target.textContent = camOn ? '📷 Camera off' : '📷 Camera on';
    e.target.classList.toggle('off', !camOn);
  });
})();
