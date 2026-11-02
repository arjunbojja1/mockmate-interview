// Runs a Python practical in this browser (Pyodide) instead of on Judge0.
//
// The point is reach: code running here can call services on the
// interviewer's own computer, like a local model on http://localhost:11434,
// which Judge0's sandbox can't. requests and urllib are patched to go
// through the browser (synchronous XHR, allowed in workers), so practicals
// use them unchanged.
//
// Message in:  { id, code, timeoutMs }   (code is a full program, e.g. from
//              OnsiteProjectRunner.buildProgram)
// Message out: { id, stdout, stderr, status: { id, description }, time } in
//              Judge0's result shape, or { id, progress } while loading.
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

let pyodide = null;
let loading = null;

async function boot() {
  postMessage({ progress: 'Loading Python in your browser (first run only, about 10 seconds)…' });
  const py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/' });
  await py.loadPackage('micropip');
  await py.pyimport('micropip').install(['requests', 'pyodide-http']);
  py.runPython(`
import os, sys
import pyodide_http
pyodide_http.patch_all()          # requests and urllib go through the browser

_ONSITE_HOME = os.getcwd()

def _onsite_run(src):
    """Runs one program; returns its exit code. Leaves no trace for the next run."""
    code = 0
    try:
        exec(compile(src, "onsite_program.py", "exec"), {"__name__": "__main__"})
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        # The project's modules were imported from a temp dir; drop them so
        # the next run imports the edited files fresh.
        for name, mod in list(sys.modules.items()):
            path = getattr(mod, "__file__", None) or ""
            if "/onsite_" in path:
                del sys.modules[name]
        sys.path[:] = [p for p in sys.path if "/onsite_" not in p]
        os.chdir(_ONSITE_HOME)
    return code
`);
  return py;
}

self.onmessage = async (event) => {
  const { id, code } = event.data;
  try {
    if (!pyodide) {
      loading = loading || boot();
      pyodide = await loading;
    }
  } catch (e) {
    loading = null;
    postMessage({ id, error: 'Could not load Python in the browser: ' + (e && e.message ? e.message : e) });
    return;
  }

  let stdout = '';
  let stderr = '';
  pyodide.setStdout({ write: (buf) => { stdout += new TextDecoder().decode(buf); return buf.length; } });
  pyodide.setStderr({ write: (buf) => { stderr += new TextDecoder().decode(buf); return buf.length; } });

  const started = performance.now();
  let status = { id: 3, description: 'Accepted' };
  try {
    const exitCode = pyodide.globals.get('_onsite_run')(code);
    if (exitCode) status = { id: 11, description: 'Runtime Error (NZEC)' };
  } catch (e) {
    stderr += (e && e.message) ? e.message : String(e);
    status = { id: 11, description: 'Runtime Error (NZEC)' };
  }
  postMessage({
    id,
    stdout,
    stderr,
    status,
    time: ((performance.now() - started) / 1000).toFixed(3),
  });
};
