// Runs a multi-file project (a backend practical) on Judge0 as a single
// program: a small bootstrap carries every file inside it, writes them to a
// temp directory, then either runs the entry file or runs the test suite.
// This only needs Judge0's ordinary Python/Node languages, so it behaves
// the same as single-file runs.
//
// Tests report one line per test as they finish (TEST_MARKER + JSON), so a
// run that hits the time limit partway through still shows what passed.
(function (global) {
  const TEST_MARKER = '__ONSITE_TEST__';
  const DONE_MARKER = '__ONSITE_DONE__';

  function b64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const PY_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
  const JS_TEST_FILE = /(^|\/)([^/]*[.-](test|spec)\.c?js|test_[^/]*\.c?js)$|(^|\/)(test|tests|__tests__)\/[^/]*\.c?js$/;
  function isTestFile(lang, name) {
    return (lang === 'python' ? PY_TEST_FILE : JS_TEST_FILE).test(name);
  }

  const PY_BOOTSTRAP = `
def _onsite_main():
    import base64, json, os, sys, tempfile, traceback, unittest, importlib, runpy, types
    cfg = json.loads(base64.b64decode("__PAYLOAD__").decode("utf-8"))
    try:
        root = tempfile.mkdtemp(prefix="onsite_")
    except OSError:
        root = tempfile.mkdtemp(prefix="onsite_", dir=os.getcwd())
    root = os.path.realpath(root)
    for name, content in cfg["files"].items():
        path = os.path.join(root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    os.chdir(root)
    sys.path.insert(0, root)
    sys.dont_write_bytecode = True
    out = sys.__stdout__

    def clean(text):
        return text.replace(root + os.sep, "")

    def fmt(exc):
        te = traceback.TracebackException.from_exception(exc)
        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename.startswith(root)])
        return clean("".join(te.format()))

    if cfg["mode"] == "run":
        sys.argv = [cfg["entry"]]
        try:
            runpy.run_path(os.path.join(root, cfg["entry"]), run_name="__main__")
        except SystemExit:
            raise
        except BaseException as e:
            sys.stdout.flush()
            sys.stderr.write(fmt(e))
            sys.exit(1)
        return

    count = 0

    def report(file, name, status, message=""):
        nonlocal count
        count += 1
        out.write("\\n${TEST_MARKER}" + json.dumps({"file": file, "name": name, "status": status, "message": clean(message)}) + "\\n")
        out.flush()

    def test_name(test):
        if isinstance(test, unittest.FunctionTestCase):
            return test._testFunc.__name__
        parts = test.id().split(".")
        return ".".join(parts[-2:]) if len(parts) > 1 else test.id()

    class Result(unittest.TestResult):
        def __init__(self, file):
            super().__init__()
            self.file = file
            self.buffer = True

        def addSuccess(self, test):
            super().addSuccess(test)
            report(self.file, test_name(test), "pass")

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self._mirrorOutput = False  # captured output is already in the message
            report(self.file, test_name(test), "fail", self._exc_info_to_string(err, test))

        def addError(self, test, err):
            super().addError(test, err)
            self._mirrorOutput = False
            name = test_name(test) if isinstance(test, unittest.TestCase) else str(test)
            report(self.file, name, "error", self._exc_info_to_string(err, test))

        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            report(self.file, test_name(test), "skip", reason)

        def addExpectedFailure(self, test, err):
            super().addExpectedFailure(test, err)
            report(self.file, test_name(test), "pass")

        def addUnexpectedSuccess(self, test):
            super().addUnexpectedSuccess(test)
            report(self.file, test_name(test), "fail", "Expected this test to fail, but it passed.")

    loader = unittest.TestLoader()
    for file in cfg["tests"]:
        module_name = file[:-3].replace("/", ".")
        try:
            module = importlib.import_module(module_name)
        except BaseException as e:
            report(file, "(loading the file)", "error", fmt(e))
            continue
        suite = loader.loadTestsFromModule(module)
        # pytest-style plain functions: def test_something(): assert ...
        for attr in sorted(dir(module)):
            fn = getattr(module, attr)
            if attr.startswith("test") and isinstance(fn, types.FunctionType) and fn.__module__ == module.__name__:
                suite.addTest(unittest.FunctionTestCase(fn))
        suite.run(Result(file))
    out.write("\\n${DONE_MARKER}" + json.dumps({"count": count}) + "\\n")

_onsite_main()
`;

  const JS_BOOTSTRAP = `
const __onsite = (() => {
const fs = require('fs'), path = require('path'), os = require('os'), util = require('util'), Module = require('module');
const cfg = JSON.parse(Buffer.from("__PAYLOAD__", 'base64').toString('utf8'));
let root;
try { root = fs.mkdtempSync(path.join(os.tmpdir(), 'onsite_')); } catch { root = fs.mkdtempSync(path.join(process.cwd(), 'onsite_')); }
root = fs.realpathSync(root);
for (const [name, content] of Object.entries(cfg.files)) {
  const p = path.join(root, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
process.chdir(root);
const clean = s => String(s).split(root + path.sep).join('');
// Keep the error message and only the stack frames inside the project.
const fmtErr = e => {
  if (!(e instanceof Error)) return 'Thrown: ' + clean(util.inspect(e));
  const lines = String(e.stack || e).split('\\n');
  const firstFrame = lines.findIndex(l => /^\\s+at /.test(l));
  const head = firstFrame < 0 ? lines : lines.slice(0, firstFrame);
  const frames = firstFrame < 0 ? [] : lines.slice(firstFrame).filter(l => l.includes(root));
  return clean(head.concat(frames).join('\\n'));
};
const write = s => fs.writeSync(1, s);

if (cfg.mode === 'run') {
  const fail = e => { process.stderr.write(fmtErr(e) + '\\n'); process.exit(1); };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  require(path.join(root, cfg.entry));
  return;
}

// A node:test-compatible test()/describe() that runs in this process, one
// test at a time, so results can be reported as they finish.
const newSuite = (name, skip) => ({ name, skip, items: [], before: [], after: [], beforeEach: [], afterEach: [] });
let suite = null;
const SKIP = Symbol('skip');
const args = (a, b, c) => typeof a === 'function' ? ['', {}, a] : typeof b === 'function' ? [a, {}, b] : [a, b || {}, c];
function test(a, b, c) {
  const [name, opts, fn] = args(a, b, c);
  suite.items.push({ kind: 'test', name: name || (fn && fn.name) || '(anonymous)', fn, skip: !!(opts.skip || opts.todo) || !fn });
}
function describe(a, b, c) {
  const [name, opts, fn] = args(a, b, c);
  const child = newSuite(name, !!(opts.skip || opts.todo));
  suite.items.push({ kind: 'suite', suite: child });
  const parent = suite;
  suite = child;
  try { if (fn) fn(); } finally { suite = parent; }
}
test.skip = (a, b, c) => { const [n, o, f] = args(a, b, c); test(n, { ...o, skip: true }, f); };
test.todo = test.skip;
test.only = test;
describe.skip = (a, b, c) => { const [n, o, f] = args(a, b, c); describe(n, { ...o, skip: true }, f); };
describe.todo = describe.skip;
describe.only = describe;
const shim = test;
Object.assign(shim, { test, it: test, describe, suite: describe });
['before', 'after', 'beforeEach', 'afterEach'].forEach(h => { shim[h] = fn => suite[h].push(fn); });
try { shim.mock = require('node:test').mock; } catch {}
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'node:test' || request === 'test') return shim;
  return origLoad.apply(this, arguments);
};

let count = 0;
const report = (file, name, status, message) => {
  count++;
  write('\\n${TEST_MARKER}' + JSON.stringify({ file, name, status, message: clean(message || '') }) + '\\n');
};
const TIMEOUT_MS = 3000;
async function call(fn) {
  let timer;
  const ctx = { name: '', skip() { throw SKIP; }, todo() { throw SKIP; }, diagnostic() {}, plan() {}, mock: shim.mock };
  const run = fn.length >= 2
    ? new Promise((res, rej) => { try { fn(ctx, err => (err ? rej(err) : res())); } catch (e) { rej(e); } })
    : Promise.resolve().then(() => fn(ctx));
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Test timed out after ' + TIMEOUT_MS + ' ms (a promise that never settles?)')), TIMEOUT_MS); });
  try { await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
}
async function runSuite(file, s, prefix, eachBefore, eachAfter) {
  const label = n => (prefix ? prefix + ' > ' : '') + n;
  if (s.skip) {
    for (const x of s.items) {
      if (x.kind === 'test') report(file, label(x.name), 'skip');
      else await runSuite(file, { ...x.suite, skip: true }, label(x.suite.name), [], []);
    }
    return;
  }
  try { for (const h of s.before) await call(h); } catch (e) {
    report(file, label('before hook'), 'error', fmtErr(e));
    return;
  }
  const before = eachBefore.concat(s.beforeEach);
  const after = s.afterEach.concat(eachAfter);
  for (const x of s.items) {
    if (x.kind === 'suite') { await runSuite(file, x.suite, label(x.suite.name), before, after); continue; }
    const name = label(x.name);
    if (x.skip) { report(file, name, 'skip'); continue; }
    try {
      try {
        for (const h of before) await call(h);
        await call(x.fn);
      } finally {
        for (const h of after) await call(h);
      }
      report(file, name, 'pass');
    } catch (e) {
      if (e === SKIP) report(file, name, 'skip');
      else report(file, name, e && e.code === 'ERR_ASSERTION' ? 'fail' : 'error', fmtErr(e));
    }
  }
  try { for (const h of s.after) await call(h); } catch (e) { report(file, label('after hook'), 'error', fmtErr(e)); }
}
process.on('unhandledRejection', () => {}); // a stray rejection is reported by the test that awaited it, if any
(async () => {
  for (const file of cfg.tests) {
    suite = newSuite('', false);
    const fileSuite = suite;
    try { require(path.join(root, file)); } catch (e) {
      report(file, '(loading the file)', 'error', fmtErr(e));
      continue;
    }
    await runSuite(file, fileSuite, '', [], []);
  }
  write('\\n${DONE_MARKER}' + JSON.stringify({ count }) + '\\n');
  process.exit(0);
})();
})();
`;

  // files: [{ name, content }]; mode: 'run' | 'tests'.
  function buildProgram(lang, files, mode, entry) {
    const map = {};
    files.forEach(f => { map[f.name] = f.content; });
    const tests = files.map(f => f.name).filter(n => isTestFile(lang, n)).sort();
    const payload = b64(JSON.stringify({ files: map, mode, entry, tests }));
    return (lang === 'python' ? PY_BOOTSTRAP : JS_BOOTSTRAP).replace('__PAYLOAD__', payload);
  }

  // stdout -> { printed, tests: [{file, name, status, message}], complete }
  function parseOutput(stdout) {
    const tests = [];
    const printed = [];
    let complete = false;
    (stdout || '').split('\n').forEach(line => {
      if (line.startsWith(TEST_MARKER)) {
        try { tests.push(JSON.parse(line.slice(TEST_MARKER.length))); } catch {}
      } else if (line.startsWith(DONE_MARKER)) {
        complete = true;
      } else {
        printed.push(line);
      }
    });
    return { printed: printed.join('\n').replace(/^\n+|\n+$/g, ''), tests, complete };
  }

  // Temp-directory paths that slip into stderr (e.g. a SyntaxError raised
  // before the bootstrap can format it).
  function cleanPaths(text) {
    return (text || '').replace(/[^\s"'(]*[\\/]onsite_[A-Za-z0-9_]+[\\/]/g, '');
  }

  const api = { buildProgram, parseOutput, cleanPaths, isTestFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.OnsiteProjectRunner = api;
})(typeof window !== 'undefined' ? window : globalThis);
