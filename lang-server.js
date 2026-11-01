// Language servers for the editor, in a module worker so the page never stalls:
// Jedi (with pyflakes for problems) on Pyodide for Python, and TypeScript's
// language service for JavaScript. Both load from jsDelivr the first time
// they're needed and then answer every request from memory.
//
// Requests: { id, op, lang, files: [{ name, content }], file, line, ch, newName }
// op: definition | references | rename | hover | completions | diagnostics
// Positions are 0-based lines and columns. Replies: { id, result } or { id, error }.
// Loading progress is posted as { type: 'status', lang, state, message }.

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const TS_URL = 'https://cdn.jsdelivr.net/npm/typescript@5.9.3/lib/';

const engines = {};
function engine(lang) {
  if (!engines[lang]) {
    const start = lang === 'python' ? startPython : lang === 'javascript' ? startTypeScript : null;
    if (!start) return Promise.reject(new Error(`No language server for ${lang}`));
    status(lang, 'loading');
    engines[lang] = start().then(
      e => { status(lang, 'ready'); return e; },
      err => { status(lang, 'failed', String(err && err.message || err)); delete engines[lang]; throw err; },
    );
  }
  return engines[lang];
}
function status(lang, state, message = '') {
  postMessage({ type: 'status', lang, state, message });
}

self.onmessage = async ({ data }) => {
  const { id, lang } = data;
  try {
    const e = await engine(lang);
    postMessage({ id, result: await e.handle(data) });
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err) });
  }
};

// ---------- Python: Jedi + pyflakes on Pyodide ----------
const PY_SERVER = String.raw`
import json, os
import jedi

ROOT = '/workspace'
os.makedirs(ROOT, exist_ok=True)
_project = jedi.Project(ROOT, added_sys_path=[ROOT])
_written = {}

try:
    from pyflakes import api as _flakes_api, messages as _flakes_messages
except ImportError:
    _flakes_api = None

def sync(files_json):
    files = json.loads(files_json)
    names = set()
    for f in files:
        names.add(f['name'])
        if _written.get(f['name']) == f['content']:
            continue
        path = os.path.join(ROOT, f['name'])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as fh:
            fh.write(f['content'])
        _written[f['name']] = f['content']
    for name in list(_written):
        if name not in names:
            try:
                os.remove(os.path.join(ROOT, name))
            except OSError:
                pass
            del _written[name]

def _script(name):
    return jedi.Script(_written.get(name, ''), path=os.path.join(ROOT, name), project=_project)

def _where(n):
    path = str(n.module_path) if n.module_path else ''
    inside = path.startswith(ROOT + '/')
    return {
        'file': path[len(ROOT) + 1:] if inside else None,
        'line': (n.line or 1) - 1,
        'ch': n.column or 0,
        'len': len(n.name or ''),
        'name': n.name,
        'module': n.module_name,
        'kind': n.type,
        'text': (n.get_line_code() or '').strip() if inside else '',
    }

def definition(name, line, ch):
    s = _script(name)
    found = s.goto(line + 1, ch, follow_imports=True, follow_builtin_imports=True)
    if not found:
        found = s.infer(line + 1, ch)
    return json.dumps([_where(n) for n in found])

def references(name, line, ch):
    refs = _script(name).get_references(line + 1, ch, scope='project')
    return json.dumps([_where(n) for n in refs if n.module_path and str(n.module_path).startswith(ROOT + '/')])

def rename(name, line, ch, new_name):
    changed = _script(name).rename(line + 1, ch, new_name=new_name).get_changed_files()
    out = {}
    for path, change in changed.items():
        path = str(path)
        if path.startswith(ROOT + '/'):
            out[path[len(ROOT) + 1:]] = change.get_new_code()
    return json.dumps(out)

def hover(name, line, ch):
    s = _script(name)
    names = s.infer(line + 1, ch) or s.goto(line + 1, ch)
    if not names:
        return json.dumps(None)
    n = names[0]
    sigs = []
    try:
        sigs = [sig.to_string() for sig in n.get_signatures()]
    except Exception:
        pass
    if sigs:
        title = ('class ' if n.type == 'class' else 'def ') + sigs[0]
    else:
        hint = ''
        try:
            hint = n.get_type_hint()
        except Exception:
            pass
        title = f'({n.type}) {n.name}' + (f': {hint}' if hint and n.type in ('instance', 'statement', 'param') else '')
    doc = n.docstring(raw=True) or ''
    where = n.module_name if n.module_name and n.module_name != '__main__' else ''
    return json.dumps({'title': title, 'doc': doc[:1500], 'module': where})

def completions(name, line, ch):
    out = []
    for c in _script(name).complete(line + 1, ch)[:150]:
        out.append({'name': c.name, 'kind': c.type})
    return json.dumps(out)

def diagnostics(name):
    s = _script(name)
    out = []
    for e in s.get_syntax_errors():
        out.append({'line': e.line - 1, 'ch': e.column, 'endLine': e.until_line - 1, 'endCh': e.until_column,
                    'severity': 'error', 'message': e.get_message()})
    if out or _flakes_api is None:
        return json.dumps(out)

    class Collect:
        def __init__(self):
            self.items = []
        def unexpectedError(self, filename, msg):
            pass
        def syntaxError(self, filename, msg, lineno, offset, text):
            pass
        def flake(self, m):
            self.items.append(m)

    collect = Collect()
    _flakes_api.check(_written.get(name, ''), name, collect)
    errors = (_flakes_messages.UndefinedName, _flakes_messages.UndefinedLocal, _flakes_messages.UndefinedExport)
    for m in collect.items:
        text = m.message % m.message_args
        out.append({'line': m.lineno - 1, 'ch': m.col or 0, 'endLine': None, 'endCh': None,
                    'severity': 'error' if isinstance(m, errors) else 'warning', 'message': text})
    return json.dumps(out)
`;

async function startPython() {
  const { loadPyodide } = await import(`${PYODIDE_URL}pyodide.mjs`);
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  await py.loadPackage(['jedi', 'parso', 'micropip']);
  try {
    await py.pyimport('micropip').install('pyflakes'); // problems; definitions still work without it
  } catch {}
  py.runPython(PY_SERVER);
  const fn = name => py.globals.get(name);
  const call = (name, ...args) => JSON.parse(fn(name)(...args));
  return {
    handle(req) {
      const files = req.files.filter(f => /\.py$/.test(f.name));
      fn('sync')(JSON.stringify(files));
      switch (req.op) {
        case 'definition': return call('definition', req.file, req.line, req.ch);
        case 'references': return call('references', req.file, req.line, req.ch);
        case 'rename': return call('rename', req.file, req.line, req.ch, req.newName);
        case 'hover': return call('hover', req.file, req.line, req.ch);
        case 'completions': return call('completions', req.file, req.line, req.ch);
        case 'diagnostics': return call('diagnostics', req.file);
        default: throw new Error(`Unknown op ${req.op}`);
      }
    },
  };
}

// ---------- JavaScript: TypeScript's language service ----------
async function startTypeScript() {
  // typescript.js is a classic script that defines a global; module workers
  // have no importScripts, so run it in global scope with an indirect eval.
  const res = await fetch(`${TS_URL}typescript.js`);
  if (!res.ok) throw new Error(`TypeScript failed to load (${res.status})`);
  (0, eval)(await res.text());
  const ts = globalThis.ts;
  const libs = new Map(); // lib file name -> text (null if missing)
  function lib(name) {
    if (!libs.has(name)) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', TS_URL + name, false); // the host API is synchronous; workers may block
      xhr.send();
      libs.set(name, xhr.status === 200 ? xhr.responseText : null);
    }
    return libs.get(name);
  }
  const isLib = path => path.startsWith('/lib/');
  const files = new Map(); // '/name.js' -> { text, version }
  const host = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: path => String(files.get(path)?.version ?? 0),
    getScriptSnapshot: path => {
      const text = isLib(path) ? lib(path.slice(5)) : files.get(path)?.text;
      return text == null ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({
      allowJs: true,
      checkJs: false,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    }),
    getDefaultLibFileName: () => '/lib/lib.es2022.d.ts',
    fileExists: path => (isLib(path) ? lib(path.slice(5)) != null : files.has(path)),
    readFile: path => (isLib(path) ? lib(path.slice(5)) : files.get(path)?.text) ?? undefined,
    directoryExists: dir => dir === '/' || dir === '/lib' || [...files.keys()].some(f => f.startsWith(dir.replace(/\/?$/, '/'))),
    getDirectories: () => [],
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  lib('lib.es2022.d.ts'); // fail now, while loading, if the CDN is unreachable

  const path = name => '/' + name;
  const nameOf = p => (isLib(p) ? null : p.slice(1));
  const text = name => files.get(path(name))?.text ?? '';
  function offsetOf(name, line, ch) {
    const t = text(name);
    let at = 0;
    for (let i = 0; i < line; i++) at = t.indexOf('\n', at) + 1;
    return at + ch;
  }
  function posOf(p, offset) {
    const t = isLib(p) ? lib(p.slice(5)) || '' : files.get(p)?.text || '';
    const before = t.slice(0, offset);
    const line = before.split('\n').length - 1;
    return { line, ch: offset - before.lastIndexOf('\n') - 1, lineText: t.split('\n')[line] || '' };
  }
  const place = (p, span) => {
    const at = posOf(p, span.start);
    return { file: nameOf(p), line: at.line, ch: at.ch, len: span.length, text: isLib(p) ? '' : at.lineText.trim(), module: isLib(p) ? p.slice(5) : null };
  };
  const flat = parts => (parts || []).map(p => p.text).join('');

  return {
    handle(req) {
      const seen = new Set();
      for (const f of req.files.filter(f => /\.[cm]?js$/.test(f.name))) {
        const p = path(f.name);
        seen.add(p);
        const cur = files.get(p);
        if (!cur || cur.text !== f.content) files.set(p, { text: f.content, version: (cur ? cur.version : 0) + 1 });
      }
      for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p);
      const file = path(req.file);
      const at = files.has(file) ? offsetOf(req.file, req.line, req.ch) : 0;

      switch (req.op) {
        case 'definition': {
          const defs = service.getDefinitionAtPosition(file, at) || [];
          return defs.map(d => ({ ...place(d.fileName, d.textSpan), name: d.name, kind: d.kind }));
        }
        case 'references': {
          const refs = service.getReferencesAtPosition(file, at) || [];
          return refs.filter(r => !isLib(r.fileName)).map(r => place(r.fileName, r.textSpan));
        }
        case 'rename': {
          const info = service.getRenameInfo(file, at, { allowRenameOfImportPath: false });
          if (!info.canRename) throw new Error(info.localizedErrorMessage || 'This name can’t be renamed');
          const locs = service.findRenameLocations(file, at, false, false, { providePrefixAndSuffixTextForRename: false }) || [];
          const byFile = {};
          locs.forEach(l => (byFile[l.fileName] = byFile[l.fileName] || []).push(l.textSpan));
          const out = {};
          for (const [p, spans] of Object.entries(byFile)) {
            if (isLib(p)) continue;
            let t = files.get(p).text;
            spans.sort((a, b) => b.start - a.start).forEach(s => { t = t.slice(0, s.start) + req.newName + t.slice(s.start + s.length); });
            out[nameOf(p)] = t;
          }
          return out;
        }
        case 'hover': {
          const info = service.getQuickInfoAtPosition(file, at);
          if (!info) return null;
          return { title: flat(info.displayParts), doc: flat(info.documentation), module: '' };
        }
        case 'completions': {
          const list = service.getCompletionsAtPosition(file, at, { includeCompletionsForModuleExports: false });
          return (list ? list.entries : []).slice(0, 300).map(e => ({ name: e.name, kind: e.kind }));
        }
        case 'diagnostics': {
          const diags = [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)];
          return diags.filter(d => d.start != null).map(d => {
            const from = posOf(file, d.start);
            const to = posOf(file, d.start + (d.length || 1));
            return {
              line: from.line, ch: from.ch, endLine: to.line, endCh: to.ch,
              severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
              message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
            };
          });
        }
        default: throw new Error(`Unknown op ${req.op}`);
      }
    },
  };
}
