// Renders a finished interview as a standalone, printable page. Shared by
// the room (Scorecard → Open report) and the Past interviews list, so a
// report can be reopened later from history.
(function () {
  const SCORE_LABELS = { 1: 'Weak', 2: 'Mixed', 3: 'Solid', 4: 'Strong' };
  const CATEGORIES = ['Problem solving', 'Coding', 'Communication'];
  const LANG_LABELS = { python: 'Python', javascript: 'JavaScript', cpp: 'C++', java: 'Java' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function minutes(ms) {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'under a minute' : `${m} min`;
  }

  function render(r) {
    const date = new Date(r.date);
    const verdict = r.verdict === 'pass' ? 'Pass' : r.verdict === 'fail' ? 'No pass' : 'No verdict';
    const meta = [date.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })];
    if (r.durationMin != null) meta.push(r.plannedMin ? `${r.durationMin} of ${r.plannedMin} min` : `${r.durationMin} min`);
    meta.push(`Room ${r.room}`);

    const scores = CATEGORIES.map(cat => {
      const v = r.scores && r.scores[cat];
      const cells = [1, 2, 3, 4].map(n => `<span class="cell${v && n <= v ? ' on' : ''}"></span>`).join('');
      return `<div class="score"><span class="score-name">${esc(cat)}</span><span class="cells" aria-hidden="true">${cells}</span><span class="score-val">${v ? `${SCORE_LABELS[v]} (${v}/4)` : 'Not rated'}</span></div>`;
    }).join('');

    const questions = (r.questions || []).map((q, i) => {
      const facts = [];
      if (q.difficulty) facts.push(`<span class="diff diff-${esc(q.difficulty)}">${esc(q.difficulty)}</span>`);
      if (q.timeMs) facts.push(`<span>${minutes(q.timeMs)} on this question</span>`);
      if (q.lastRun) facts.push(`<span class="${q.lastRun.passed === q.lastRun.total ? 'ok' : 'bad'}">Tests ${q.lastRun.passed}/${q.lastRun.total} on the last run</span>`);
      else if (q.testsTotal) facts.push('<span>Tests never run</span>');
      return `
        <section class="question">
          <h2><span class="qnum">Question ${i + 1}</span>${esc(q.title || 'Untitled question')}</h2>
          <p class="facts">${facts.join('')}</p>
          ${q.code && q.code.trim() ? `<p class="code-label">Final code${q.lang ? ` (${esc(LANG_LABELS[q.lang] || q.lang)})` : ''}</p><pre><code>${esc(q.code)}</code></pre>` : '<p class="muted">No code written.</p>'}
        </section>`;
    }).join('');

    const log = (r.log || []).length
      ? `<section><h2>Interview log</h2><table class="log">${r.log.map(e => `<tr class="k-${esc(e.kind)}"><td>${esc(e.time)}</td><td>${esc(e.text)}</td></tr>`).join('')}</table></section>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(r.candidateName || 'Candidate')} — interview report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap" />
<style>
  :root { --ink:#1A2238; --ink-2:#4B556E; --ink-3:#7C859A; --rule:#DCE1E4; --board:#F3F5F4; --blue:#2648D8; --green:#16865A; --red:#D6382F; --amber:#A86400; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--board); color: var(--ink); font: 15px/1.55 'Schibsted Grotesk', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .page { max-width: 820px; margin: 32px auto; padding: 48px 56px; background: #fff; border: 1px solid var(--rule); border-radius: 14px; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 36px; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: -0.02em; }
  .mark { position: relative; width: 20px; height: 20px; border-radius: 6px; background: var(--ink); }
  .mark::before { content: ''; position: absolute; inset: 5px; border: 2px solid #fff; border-radius: 50%; }
  .mark::after { content: ''; position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; border-radius: 50%; background: var(--red); }
  button { font: inherit; font-weight: 600; font-size: 14px; height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--blue); background: var(--blue); color: #fff; cursor: pointer; }
  h1 { font-size: 40px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 8px; font-weight: 800; }
  .meta { color: var(--ink-3); margin: 0 0 18px; }
  .verdict { display: inline-block; padding: 3px 12px; border-radius: 999px; font-weight: 700; font-size: 14px; }
  .v-pass { background: rgba(22,134,90,.1); color: var(--green); }
  .v-fail { background: rgba(214,56,47,.09); color: var(--red); }
  .v-none { background: var(--board); color: var(--ink-3); }
  section { margin-top: 36px; }
  h2 { font-size: 19px; letter-spacing: -0.01em; margin: 0 0 12px; font-weight: 700; }
  .scores { margin-top: 28px; border-top: 1px solid var(--rule); }
  .score { display: grid; grid-template-columns: 170px auto 1fr; gap: 16px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--rule); }
  .score-name { font-weight: 600; }
  .cells { display: inline-flex; gap: 4px; }
  .cell { width: 26px; height: 10px; border-radius: 3px; background: var(--rule); }
  .cell.on { background: var(--ink); }
  .score-val { color: var(--ink-2); font-size: 14px; }
  .summary { white-space: pre-wrap; margin: 0; max-width: 68ch; }
  .qnum { display: block; font-size: 13px; color: var(--ink-3); font-weight: 600; margin-bottom: 2px; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 14px; font-size: 14px; color: var(--ink-2); }
  .facts .ok { color: var(--green); font-weight: 600; }
  .facts .bad { color: var(--red); font-weight: 600; }
  .diff { text-transform: capitalize; font-weight: 700; }
  .diff-easy { color: var(--green); } .diff-medium { color: var(--amber); } .diff-hard { color: var(--red); }
  .code-label { margin: 0 0 6px; font-size: 13px; color: var(--ink-3); font-weight: 600; }
  pre { margin: 0; padding: 16px 18px; background: #151B2D; color: #E4E8F2; border-radius: 10px; overflow: auto; font: 13px/1.6 'JetBrains Mono', ui-monospace, monospace; white-space: pre; font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
  .muted { color: var(--ink-3); margin: 0; }
  .log { width: 100%; border-collapse: collapse; font-size: 14px; }
  .log td { padding: 7px 0; border-top: 1px solid var(--rule); vertical-align: top; color: var(--ink-2); }
  .log td:first-child { width: 80px; font: 12.5px 'JetBrains Mono', monospace; color: var(--ink-3); padding-top: 9px; }
  .log .k-note td:last-child { color: var(--ink); font-weight: 500; }
  .log .k-paste td:last-child, .log .k-away td:last-child { color: var(--amber); font-weight: 600; }
  footer { margin-top: 44px; color: var(--ink-3); font-size: 13px; }
  @media (max-width: 700px) { .page { margin: 0; border-radius: 0; border: 0; padding: 28px 16px; } .score { grid-template-columns: 1fr auto; } .score-val { grid-column: 1 / -1; } h1 { font-size: 32px; } }
  @media print {
    body { background: #fff; }
    .page { margin: 0; padding: 0; border: 0; max-width: none; }
    .no-print { display: none; }
    pre { white-space: pre-wrap; background: #F3F5F4; color: var(--ink); }
    section { break-inside: avoid-page; }
    .question { break-inside: auto; }
  }
</style>
</head>
<body>
<main class="page">
  <div class="top">
    <span class="brand"><span class="mark" aria-hidden="true"></span>Onsite</span>
    <button class="no-print" type="button" onclick="window.print()">Save as PDF</button>
  </div>
  <h1>${esc(r.candidateName || 'Unnamed candidate')}</h1>
  <p class="meta">${meta.map(esc).join(', ')}</p>
  <span class="verdict ${r.verdict === 'pass' ? 'v-pass' : r.verdict === 'fail' ? 'v-fail' : 'v-none'}">${verdict}</span>
  <div class="scores">${scores}</div>
  ${r.summary ? `<section><h2>Summary</h2><p class="summary">${esc(r.summary)}</p></section>` : ''}
  ${questions}
  ${log}
  <footer>Report generated ${esc(new Date().toLocaleString())}. Scores use a 4-point scale: 1 Weak, 2 Mixed, 3 Solid, 4 Strong.</footer>
</main>
</body>
</html>`;
  }

  function open(record) {
    const url = URL.createObjectURL(new Blob([render(record)], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) {
      // Pop-up blocked. Never navigate away (this may be a live room), so
      // save the report as a file instead.
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(record.candidateName || 'candidate').replace(/[^\w-]+/g, '-')}-interview-report.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.OnsiteReport = { render, open };
})();
