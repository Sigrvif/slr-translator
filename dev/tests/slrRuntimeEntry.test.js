"use strict";
// Smoke test for the standalone console launcher's files. These files must keep the exact
// invocation shape that makes the bundled NW.js binary run a script in Node context:
// the engine re-exec'd BY ITS REAL PATH with the script path as the first argument.
// Two dangerous forms must never come back (both were tried and both fail):
//   - `nw .` / node-main style: boots the window runtime and needs a display;
//   - a symlink-style `node` alias pointing at nw: fails because the V8 snapshot is
//     resolved relative to argv[0].
//
// The launcher files are PLATFORM-EXCLUSIVE: the Linux copy ships SLR Runtime.sh and
// dev/node-linux, the Windows copy ships SLR Runtime.cmd, dev/node-win.cmd and the
// dev/node-win-run.ps1 output relay, and the shared dev/ folder keeps both shims for
// development and tests. Each content test therefore reads its file from the copy that
// ships it, and the whole file runs unchanged from all three locations (shared dev
// folder, Linux copy, Windows copy).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const TOOLS_DIR = path.resolve(__dirname, "..");
const APP_ROOT = path.resolve(TOOLS_DIR, "..");
// The dev root is the directory holding both app copies: APP_ROOT itself when this test
// runs from the shared dev/ folder, one level up when it runs from an app copy.
const ROOT = fs.existsSync(path.join(APP_ROOT, "SLR Translator Linux")) ? APP_ROOT : path.dirname(APP_ROOT);
const LINUX = path.join(ROOT, "SLR Translator Linux");
const WINDOWS = path.join(ROOT, "SLR Translator");

function read(...names) {
    return fs.readFileSync(path.join(...names), "utf8");
}

test("the node-linux shim re-execs the real nw binary with the script as the argument", () => {
    const shim = read(LINUX, "dev", "node-linux");
    // The real binary, addressed by path relative to the shim (never a bare `nw` lookup,
    // and never a `node` symlink-style alias).
    assert.match(shim, /exec\s+"\$SCRIPT_DIR\/\.\.\/nw"\s+"\$@"/, "must exec ../nw with \"$@\"");
    assert.doesNotMatch(shim, /ln\s+-s/, "must not create a symlink-style alias");
    assert.doesNotMatch(shim, /\bnw\s+\.\b/, "must not invoke `nw .`");
});

test("the node-win.cmd shim resolves the packaged binary and relays through PowerShell", () => {
    const shim = read(WINDOWS, "dev", "node-win.cmd");
    assert.match(shim, /%~dp0\.\.\\nw\.exe/, "must run the nw binary next to the app");
    // The packaged app renames nw.exe (here: "SLR Translator.exe"), so the shim falls back
    // to that real binary path when nw.exe is absent.
    assert.match(shim, /not exist "%NWEXE%" set "NWEXE=%~dp0\.\.\\SLR Translator\.exe"/,
        "must fall back to the renamed SLR Translator.exe");
    assert.doesNotMatch(shim, /\bnw(\.exe)?\s+\.\b/, "must not invoke `nw .`");
    // The GUI-subsystem binary cannot write to the console itself: the shim must hand the
    // launcher to the PowerShell relay.
    assert.match(shim, /powershell\b/, "must invoke PowerShell");
    assert.match(shim, /-File "%~dp0node-win-run\.ps1"/, "must run the node-win-run.ps1 relay");
    assert.match(shim, /-Exe "%NWEXE%"/, "must pass the resolved binary to the relay");
    assert.match(shim, /-Script "%~dp0\.\.\\dev\\slr-runtime\.js"/, "must pass the launcher script to the relay");
    // Exit-code propagation: the relay's exit code becomes the shim's, for SLR Runtime.cmd.
    assert.match(shim, /exit \/b %errorlevel%/, "must propagate the exit code");
});

test("the node-win-run.ps1 relay pipes the GUI binary's output and exits with its code", () => {
    const relay = read(WINDOWS, "dev", "node-win-run.ps1");
    // The safety-critical process settings: piped (not inherited) stdio and no extra
    // window, without which the GUI child writes nowhere or pops a second window.
    assert.match(relay, /UseShellExecute = \$false/, "must not use the shell to launch");
    assert.match(relay, /RedirectStandardOutput = \$true/, "must pipe stdout");
    assert.match(relay, /RedirectStandardError = \$true/, "must pipe stderr");
    assert.match(relay, /CreateNoWindow = \$true/, "must not create a second window");
    // The relay exits with the launcher's exit code so SLR Runtime.cmd's echo/pause logic
    // sees 0/1/2 as designed.
    assert.match(relay, /exit \$p\.ExitCode/, "must exit with the launcher's exit code");
    // The stderr relay must run off the main read loop (a full stderr pipe deadlocks it).
    assert.match(relay, /StandardError\.ReadLine/, "must relay stderr");
    assert.match(relay, /\$p\.WaitForExit\(\)/, "must wait for the launcher before exiting");
});

test("the Windows shim forwards user arguments only when present", () => {
    // Regression: with no user arguments, a trailing "-AppArgs" binds no value and
    // PowerShell -File mode rejects it as MissingArgument - the launcher could never
    // start argument-less. The shim must omit -AppArgs entirely instead.
    const cmd = read(WINDOWS, "dev", "node-win.cmd");
    assert.match(cmd, /if not "%~1"=="" set "APPARGS=-AppArgs %\*"/,
        "must set -AppArgs only when the user passed arguments");
    assert.match(cmd, /%APPARGS%/, "must forward the arguments through APPARGS");
    // The buggy form ended the powershell line with a bare, unconditional "-AppArgs %*";
    // the conditional setter ends with a quote, so anchoring to the line end pins the
    // regression without matching the guard itself.
    assert.doesNotMatch(cmd, /-AppArgs %\*\s*$/m,
        "must never emit an unconditional trailing -AppArgs (the argument-less deadlock)");
});

test("SLR Runtime.sh (Linux copy) re-opens itself in a terminal emulator on a desktop launch", () => {
    const launcher = read(LINUX, "SLR Runtime.sh");
    // It must run from its own directory (the launcher sits next to the app).
    assert.match(launcher, /SCRIPT_DIR="\$\(cd "\$\(dirname "\$0"\)" && pwd\)"/, "must resolve its own directory");
    assert.match(launcher, /cd "\$SCRIPT_DIR" \|\| exit 1/, "must cd to its own directory");
    // Desktop-launch detection: stdout is not a terminal, and this is not the re-entered
    // inner invocation (the env var is belt-and-braces on top of the tty check).
    assert.match(launcher, /\[ ! -t 1 \]/, "must detect a non-terminal stdout");
    assert.match(launcher, /SLR_RUNTIME_IN_TERMINAL/, "must guard the re-exec with the env var");
    // The re-exec goes through the first available terminal emulator ...
    for (const prog of ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"]) {
        assert.ok(launcher.includes(prog), "must try the " + prog + " emulator");
    }
    // ... and the inner command holds the window open after the runtime stops, so the
    // exit status can be read instead of the window vanishing.
    assert.match(launcher, /Press Enter to close this window\./, "must hold the window open after the runtime stops");
    // From a real terminal the behaviour is unchanged: exec the shim with the entry script,
    // forwarding all arguments.
    assert.match(launcher, /exec\s+"\$SCRIPT_DIR\/dev\/node-linux"\s+"\$SCRIPT_DIR\/dev\/slr-runtime\.js"\s+"\$@"/,
        "must exec dev/node-linux dev/slr-runtime.js \"$@\"");
    assert.doesNotMatch(launcher, /\bnw\b\s+\./, "must not invoke `nw .`");
});

test("SLR Runtime.cmd (Windows copy) calls the shim and pauses on failure", () => {
    const launcher = read(WINDOWS, "SLR Runtime.cmd");
    assert.match(launcher, /cd \/d "%~dp0"/, "must cd to its own directory");
    // The relay shim picks the launcher script itself; the caller forwards only arguments.
    assert.match(launcher, /call dev\\node-win\.cmd %\*/,
        "must call dev\\node-win.cmd with the forwarded arguments");
    assert.match(launcher, /pause/, "must pause on a non-zero exit so the window stays open");
    // Exit-code propagation through the call: the shim's code drives the echo/pause block.
    assert.match(launcher, /set "SLRRUN_EXIT=%ERRORLEVEL%"/, "must capture the shim's exit code");
});

test("each copy ships only its own platform's launcher, shim, and relay", () => {
    const L = path.join(ROOT, "SLR Translator Linux");
    const W = path.join(ROOT, "SLR Translator");
    assert.ok(fs.existsSync(path.join(L, "SLR Runtime.sh")), "Linux copy needs SLR Runtime.sh");
    assert.ok(fs.existsSync(path.join(L, "dev/node-linux")), "Linux copy needs the node shim");
    assert.strictEqual(fs.existsSync(path.join(L, "SLR Runtime.cmd")), false, "Linux copy must not ship the Windows launcher");
    assert.strictEqual(fs.existsSync(path.join(L, "dev/node-win.cmd")), false, "Linux copy must not ship the Windows shim");
    assert.strictEqual(fs.existsSync(path.join(L, "dev/node-win-run.ps1")), false, "Linux copy must not ship the Windows relay");
    assert.ok(fs.existsSync(path.join(W, "SLR Runtime.cmd")), "Windows copy needs SLR Runtime.cmd");
    assert.ok(fs.existsSync(path.join(W, "dev/node-win.cmd")), "Windows copy needs the node shim");
    assert.ok(fs.existsSync(path.join(W, "dev/node-win-run.ps1")), "Windows copy needs the PowerShell relay");
    assert.strictEqual(fs.existsSync(path.join(W, "SLR Runtime.sh")), false, "Windows copy must not ship the Linux launcher");
    assert.strictEqual(fs.existsSync(path.join(W, "dev/node-linux")), false, "Windows copy must not ship the Linux shim");
    // The shared dev/ folder keeps both shims for development.
    assert.ok(fs.existsSync(path.join(ROOT, "dev/node-linux")));
    assert.ok(fs.existsSync(path.join(ROOT, "dev/node-win.cmd")));
});

test("the entry script exists, is guard-covered, and runs on the bundled engine shape", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    assert.match(entry, /ConsoleApp/, "must drive the shared ConsoleApp runner");
    assert.match(entry, /StartConfig/, "must use the shared StartConfig settings mapping");
    assert.match(entry, /argv\.slice\(2\)/, "must forward the arguments after the script path");
    // The shipped engine lacks these runtime APIs (dev/check-node15-syntax.js guards
    // this file too; this is the textual backstop for the most direct spellings).
    for (const banned of [".at(", "Object.hasOwn", "structuredClone", ".findLast(", ".toSorted("]) {
        assert.ok(!entry.includes(banned), "entry must not use " + banned);
    }
});

test("the console start path applies per-model profiles and the same detection as the editor", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    // The recorded profiles must reach the shared mapping: the entry composes the start config
    // through ConsoleApp, which carries settings.profiles and computes the draft/projector
    // associations so a forced draftId/mmprojId resolves that file's detected spec type.
    assert.match(entry, /ConsoleApp\.startConfigFor\(/, "must compose the start config through ConsoleApp");
    assert.match(entry, /ConsoleApp\.listModels\(/, "must build the model list through ConsoleApp");
    assert.match(entry, /StartConfig: StartConfig/, "must hand the shared StartConfig mapping in");
    // And the runner must use the editor's own content detection to compute the associations,
    // so drafts/MTP heads/projectors are hidden from the model list and resolvable when forced.
    const app = read(LINUX, "www", "core", "llmRuntime", "lib", "ConsoleApp.js");
    assert.match(app, /ModelInfo/, "must classify model files with ModelInfo");
    assert.match(app, /ModelAssociations/, "must pair drafts/projectors with ModelAssociations");
});

test("the console binds the recorded model as the front door's default", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    // The front door routes a request with no model field to the default model, so the console
    // must tell the manager which model its recorded settings selected. Without it the manager
    // falls back to the first configured entry and preloads a different model than the settings
    // named. Both the normal start and the CPU retry carry it, exactly like the editor.
    const hits = entry.match(/defaultId:\s*cfg\.targetId/g) || [];
    assert.ok(hits.length >= 2, "both start attempts must bind the recorded model as the default");
    assert.match(entry, /const startOpts = \{ defaultId: cfg\.targetId \}/);
});

test("the console status follows the loaded model through the front door", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    // The status block reads the loaded model's own /slots through the front door (its real
    // n_ctx and is_processing), like the editor, and never starts a model to answer a read.
    assert.match(entry, /function loadedIdForStatus/, "must resolve the loaded id like the editor");
    assert.match(entry, /manager\.client\.slots\(loadedId\)/, "must read /slots for the loaded id");
    assert.match(entry, /loadedId: loadedId, slots: slots/, "must pass them to RuntimeStatus.describe");
});

test("the console records every loaded child pid for a dead-launcher --stop", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    // A start records all loaded child pids (serverPids), and the status tick keeps them current
    // as models load on demand, so a --stop that finds the launcher already dead can stop every
    // child rather than only the last one the compatibility server handle names.
    assert.match(entry, /manager\.loadedChildPids\(\)/, "must ask the manager for every loaded child pid");
    assert.match(entry, /state\.serverPids\s*=/, "must carry the pids on the start result");
    assert.match(entry, /function refreshRecordPids/, "must refresh the record as models come and go");
    const app = read(LINUX, "www", "core", "llmRuntime", "lib", "ConsoleApp.js");
    assert.match(app, /serverPids/, "the record must be written with serverPids");
    const manager = read(LINUX, "www", "core", "llmRuntime", "lib", "RuntimeManager.js");
    assert.match(manager, /loadedChildPids\(\)/, "RuntimeManager must expose loadedChildPids()");
});

test("the shipped-engine guard lists every file the console runtime ships", () => {
    const guard = read(TOOLS_DIR, "check-node15-syntax.js");
    for (const target of [
        "www/core/llmRuntime/lib/ConsoleApp.js",
        "www/core/llmRuntime/lib/RuntimeState.js",
        "www/core/llmRuntime/lib/StartConfig.js",
        "www/core/llmRuntime/lib/Ports.js",
        "dev/slr-runtime.js"
    ]) {
        assert.ok(guard.includes(JSON.stringify(target)), "TARGETS must include " + target);
    }
});

// sanitiseBuffers is a MODULE export, not a class static (the class carries only
// newModelBuffers/applyModelBufferLine/flattenModelBuffers). Calling it on the class throws,
// and modelBuffers()'s bare catch then swallows it into a permanent null - so the status line
// would never show any placement. llmRuntime.js calls the module export; the console must too.
test("sanitiseBuffers exists on the ServerProcess module, not the class", () => {
    const mod = require(path.join(LINUX, "www", "core", "llmRuntime", "lib", "ServerProcess.js"));
    assert.strictEqual(typeof mod.sanitiseBuffers, "function", "module must export sanitiseBuffers");
    assert.strictEqual(mod.ServerProcess.sanitiseBuffers, undefined,
        "the class must not (and does not) carry sanitiseBuffers");
});

test("the console modelBuffers path calls the module-level sanitiseBuffers, not the class", () => {
    const entry = read(TOOLS_DIR, "slr-runtime.js");
    assert.match(entry, /const serverProcessModule = lib\("ServerProcess\.js"\);/,
        "must resolve the ServerProcess module, not only its class");
    assert.match(entry, /serverProcessModule\.sanitiseBuffers\(b, vram\)/,
        "modelBuffers must call the module-level sanitiseBuffers");
    // The exact buggy form: on the class this is undefined and the bare catch hides it.
    assert.doesNotMatch(entry, /ServerProcess\.sanitiseBuffers\(/,
        "must not call sanitiseBuffers on the class (undefined -> silent null)");
    // The class is still needed for construction, so the fix must not remove it.
    assert.match(entry, /new ServerProcess\(/, "must still construct the class");
});
