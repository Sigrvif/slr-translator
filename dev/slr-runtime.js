// dev/slr-runtime.js
//
// SLR Runtime - the standalone console launcher for the bundled llama.cpp runtime. It serves
// the last model and settings recorded by SLR Translator (data/llama/laststart.json) without
// opening the editor, and it shares the editor's exact settings mapping
// (www/core/llmRuntime/lib/StartConfig.js), so a console start applies the same options a
// start from the editor would.
//
// This script runs on the NW.js binary in Node context - `nw dev/slr-runtime.js` (the
// re-exec is done by dev/node-linux / dev/node-win.cmd) - which gives a plain Node
// environment on the shipped Node 15.12.0 engine: no window, no display. It must therefore
// not touch nw.* window APIs, and it must not use the runtime APIs that engine lacks
// (see dev/check-node15-syntax.js for the guarded list).
//
// Exit codes (from ConsoleApp): 0 ok, 1 error, 2 another runtime is already live.
"use strict";

const fs = require("fs");
const nodePath = require("path");

// When the terminal window closes, the pty dies while this process may still be
// tearing down (or serving). Node emits an 'error' event on the dead streams and an
// unhandled one aborts the process, which NW.js reports as a crash. Every actual
// write goes through writeOut/writeErr, which tolerate a closed output, so the
// stream error is swallowed here.
// Defensively wrapped: some environments hand out a stream without .on, and a throw
// here would kill the launcher at startup - worse than what this guards against.
try {
    process.stdout.on("error", function () {});
    process.stderr.on("error", function () {});
} catch (err) { /* keep going without the listeners */ }

// The app root this script was installed into (the launcher sits next to the app copy).
const appRoot = nodePath.resolve(__dirname, "..");
const libDir = nodePath.join(appRoot, "www", "core", "llmRuntime", "lib");
function lib(name) { return require(nodePath.join(libDir, name)); }

// Pinned deliberately - must match RUNTIME_VERSION in www/core/llmRuntime/llmRuntime.js.
// Updating the runtime means shipping a new llama/<version>/ dir and bumping both.
const RUNTIME_VERSION = "b12110";

// Matches RuntimeManager.DEFAULT_CONFIG.port: a blank recorded port means the shipped
// default, never "pick one".
const DEFAULT_CONFIG_PORT = 1234;

const ConsoleApp = lib("ConsoleApp.js");
const RuntimeStatus = lib("RuntimeStatus.js");
const RuntimeState = lib("RuntimeState.js");
const Payload = lib("Payload.js");
const GgufMeta = lib("GgufMeta.js");
const Ports = lib("Ports.js");
const StartConfig = lib("StartConfig.js");
const RouterClient = lib("RouterClient.js");
const serverProcessModule = lib("ServerProcess.js");
const ServerProcess = serverProcessModule.ServerProcess;
const RuntimeManager = lib("RuntimeManager.js").RuntimeManager;
const HipSdkLocator = lib("HipSdkLocator.js");

function writeOut(s) {
    try { fs.writeSync(1, s + "\n"); } catch (err) { /* stdout closed (EPIPE): keep serving */ }
}
function writeErr(s) {
    try { fs.writeSync(2, s + "\n"); } catch (err) { /* stderr closed */ }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const dataDirPath = nodePath.join(appRoot, "data", "llama");
// The pinned llama-server exits 1 when --slot-save-path points at a directory that does not
// exist, so the data tree is created before anything else. Existing dirs are left untouched.
ensureDir(dataDirPath);
ensureDir(nodePath.join(dataDirPath, "models"));
ensureDir(nodePath.join(dataDirPath, "slots"));
const templatesDirPath = nodePath.join(dataDirPath, "templates");
ensureDir(templatesDirPath);

// The install directory for the pinned payload. `localConfig.llama` lets a packager rename
// it; the default matches the shipped layout. Mirrors runtimeDirName() in llmRuntime.js.
function runtimeDirName() {
    try {
        const manifest = JSON.parse(fs.readFileSync(nodePath.join(appRoot, "package.json"), "utf8"));
        const config = (manifest && manifest.localConfig) || {};
        return config.llama || "runtime";
    } catch (err) {
        return "runtime";
    }
}

function platformKey() {
    return Payload.platformDir(process.platform, process.arch);
}

// The recorded settings from the editor (data/llama/laststart.json). Same format and
// tolerance as llmRuntime.js's readStartState.
function readStartState() {
    try {
        const p = nodePath.join(dataDirPath, "laststart.json");
        if (!fs.existsSync(p)) return { autoStart: false, settings: null };
        const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
        if (!parsed || typeof parsed !== "object") return { autoStart: false, settings: null };
        return {
            autoStart: parsed.autoStart === true,
            settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : null
        };
    } catch (err) {
        return { autoStart: false, settings: null };
    }
}

// An HTTP adapter over the core modules, shaped so every consumer in this tree agrees:
// both `status` and `statusCode` carry the response code (RuntimeState.isRuntimeLive reads
// either), and the body is parsed as JSON when it is one, left as text otherwise (the
// Prometheus /metrics exposition must survive as a string).
function httpAdapter() {
    const http = require("http");
    const https = require("https");
    const url = require("url");
    function call(method, requestUrl, body) {
        return new Promise(function (resolve, reject) {
            const parsed = url.parse(requestUrl);
            const transport = parsed.protocol === "https:" ? https : http;
            const payload = body === undefined ? null : JSON.stringify(body);
            const options = {
                method: method,
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.path,
                headers: {}
            };
            if (payload !== null) {
                options.headers["Content-Type"] = "application/json";
                options.headers["Content-Length"] = Buffer.byteLength(payload);
            }
            const req = transport.request(options, function (res) {
                const chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let parsedBody = text;
                    try { parsedBody = JSON.parse(text); } catch (err) { /* text endpoints */ }
                    resolve({ status: res.statusCode, statusCode: res.statusCode, body: parsedBody });
                });
            });
            req.setTimeout(30000, function () {
                req.destroy(new Error("request timed out after 30000 ms"));
            });
            req.on("error", reject);
            if (payload !== null) req.write(payload);
            req.end();
        });
    }
    return {
        get: function (requestUrl) { return call("GET", requestUrl); },
        post: function (requestUrl, body) { return call("POST", requestUrl, body); }
    };
}

// `--list-devices` output for the backend selection, like common.aSpawn provides in the
// editor. stdout carries the device list; stderr carries the backend loaders' own failures
// (a HIP DLL the loader could not resolve), which a "pack installed but no device found"
// report needs. `env` (when given) is the exact environment the spawned server children
// get, so a backend whose libraries live in an extra/adopted library folder is visible to
// the probe too; without it the child inherits this process's environment. The probe never
// rejects when it produced ANY output: a backend that fails to load still lists the other
// devices and may exit nonzero, and that partial result plus its stderr is exactly what the
// strict backend error should carry.
function listDevices(serverBinary, env) {
    return new Promise(function (resolve, reject) {
        const opts = { cwd: nodePath.dirname(serverBinary) };
        if (env) opts.env = env;
        require("child_process").execFile(serverBinary, ["--list-devices"], opts,
            function (err, stdout, stderr) {
                const out = String(stdout || "");
                const errs = String(stderr || "");
                if (err && !out.trim() && !errs.trim()) { reject(err); return; }
                resolve({ stdout: out, stderr: errs });
            });
    });
}

const manager = new RuntimeManager({
    resolvePayload: function () {
        return Payload.resolvePayload({
            rootDir: appRoot,
            version: RUNTIME_VERSION,
            platform: process.platform,
            arch: process.arch,
            fs: fs,
            dirName: runtimeDirName()
        });
    },
    verifyPayload: function (payload) {
        return Payload.verifyPayload({
            dir: payload.dir,
            manifest: payload.manifest,
            platformKey: platformKey(),
            fs: fs,
            crypto: require("crypto"),
            onError: function (err) { writeErr("[llama] " + err.message); }
        });
    },
    listDevices: listDevices,
    // The HIP SDK's bin folder in its standard install locations, best match first (the
    // generation matching the installed pack, then the newer version). The manager probes
    // it when a ROCm pack finds no device on Windows and adopts the result for the probe
    // and the server children.
    standardLibDirs: function (probeOpts) {
        return HipSdkLocator.standardBinDirs({
            platform: process.platform,
            env: process.env,
            fs: fs,
            packGeneration: probeOpts && probeOpts.packGeneration
        });
    },
    findFreePort: function (opts) { return Ports.resolvePort(opts); },
    writeFile: function (p, text) { fs.writeFileSync(p, text, "utf8"); },
    createServer: function (opts) {
        return new ServerProcess({
            serverBinary: opts.serverBinary,
            args: opts.args,
            cwd: opts.cwd,
            env: opts.env,
            onLog: function (stream, text) {
                // The server's own log goes to stderr, so the launcher's stdout stays
                // machine-readable while the load progress stays visible.
                writeErr("[llama/" + stream + "] " + text);
            }
        });
    },
    createRouter: function (baseUrl) {
        return RouterClient.createRouterClient({ http: httpAdapter(), baseUrl: baseUrl });
    },
    // Used to tell whether a model can stay entirely on the GPU.
    modelBytes: function (modelPath) {
        try { return fs.statSync(modelPath).size; } catch (err) { return null; }
    },
    waitForHealth: RouterClient.waitForHealth,
    onStatus: function () { /* the status line is rendered on demand; nothing to push */ },
    // The wait-for-idle cap warning is diagnostic; keep it on stderr with the rest of the log.
    log: function (msg) { writeErr("[llmRuntime] " + msg); },
    config: {
        platformKey: platformKey(),
        modelsDir: nodePath.join(dataDirPath, "models"),
        slotSavePath: nodePath.join(dataDirPath, "slots"),
        cacheRamMiB: 4096,
        cacheReuseChunk: 256,
        ctxCheckpoints: 16
    }
});

// The bundled engine deadlocks when process.exit is called from inside a signal
// handler, and shutdown is therefore flaky when it is called from the signal-
// triggered teardown chain. Exit by draining instead: drop the signal listeners
// (nothing needs them once the runtime is stopped), set the exit code, and let the
// event loop empty on its own. A short ref'd fallback forces the exit if some other
// idle handle would otherwise keep the loop spinning without draining (measured on
// the shipped engine). Tearing the stdio streams down lets the loop empty even with
// a dead pty, whose polls would otherwise hold it.
// idle handle would otherwise keep the loop spinning without draining (measured on
// the shipped engine).
let watchdogStop = null; // set by the win32 watchdog, if installed
function finish(code) {
    code = code || 0;
    try {
        process.removeAllListeners("SIGINT");
        process.removeAllListeners("SIGTERM");
        process.removeAllListeners("SIGHUP");
    } catch (err) { /* nothing registered */ }
    if (watchdogStop) { watchdogStop(); watchdogStop = null; }
    // Destroy the stdio streams before draining: with a dead pty their polls keep the
    // loop alive (and can stall the engine's own process.exit for 10 s and more, which
    // was measured on the shipped engine). Tearing them down lets the loop empty and the
    // process exit naturally; the fallback below remains as the last resort. Teardown
    // output happens before this point, so nothing printable is lost.
    try {
        process.stdin.on("error", function () {});
        process.stdin.destroy();
    } catch (err) { /* stdin may be gone already */ }
    try { process.stdout.destroy(); } catch (err) { /* see above */ }
    try { process.stderr.destroy(); } catch (err) { /* see above */ }
    process.exitCode = code;
    // Deliberately ref'd (not unref'd): measured on the shipped engine, an unref'd fallback
    // starved for 15 s while an idle post-teardown handle kept the loop alive without
    // iterating, blowing the shutdown budget. A ref'd timer guarantees the exit fires
    // within 2 s of finish; normal output is synchronous (fs.writeSync), so nothing can
    // still need flushing after the teardown printed its last line. The exit itself uses
    // process.reallyExit when available: with a dead pty, the full process.exit teardown
    // stalled for 10 s and more on the shipped engine before the process finally went away.
    setTimeout(function () {
        if (typeof process.reallyExit === "function") process.reallyExit(process.exitCode || 0);
        else process.exit(process.exitCode);
    }, 2000);
}

// ONE signal-handler pair for the whole launcher, installed before anything starts. The
// console's teardown wait (waitForExit) only exists AFTER a successful start, so a Ctrl+C
// during the model load used to kill this launcher by default disposition while the detached
// llama-server kept loading - an orphan holding the port, with no record --stop could use.
// From process start the first SIGINT/SIGTERM/SIGHUP is therefore ours, on one shared
// deferred and one `stopping` flag, so the two exits below can never both run:
//   - started phase (ConsoleApp is waiting on the deferred): the wait resolves and the
//     console's normal teardown runs exactly as before - server stopped, record cleared,
//     "Stopped.", exit 0.
//   - still starting (including mid model-load): the server may already have been spawned,
//     so stop it here - ServerProcess's killTree reaches a half-loaded child - then print
//     "Stopped." and exit 0. No record was written yet, so none needs clearing.
// The flag also swallows a second signal while either teardown is running.
const signals = (function () {
    let settle = null;
    let stopping = false;
    let awaited = false;
    const promise = new Promise(function (resolve) { settle = resolve; });
    function settleOnce(reason) {
        if (stopping) return;
        stopping = true;
        settle(reason);
    }
    function handler(signal) {
        if (stopping) return;
        stopping = true;
        writeOut("Received " + signal + " - stopping the runtime...");
        if (awaited) { settle(null); return; }
        finishEarly();
    }
    // The Windows console-close path: the packaged launcher is a GUI-subsystem process that
    // never attaches to the console, so no close signal reaches it - the watchdog below
    // notices the console's disappearance and raises the same exactly-once stop, with a
    // message that tells a reader this was a window close, not Ctrl+C.
    function consoleClosed() {
        if (stopping) return;
        stopping = true;
        writeOut("The console window was closed - stopping the runtime...");
        if (awaited) { settle(null); return; }
        finishEarly();
    }
    // The still-starting teardown shared by every close path: stop the (possibly
    // half-loaded) server, print, then drain (never process.exit from signal context).
    // No record was written yet, so none needs clearing. Note: draining lets the in-flight
    // manager.start() chain reject once the server dies; that rejection lands in
    // ConsoleApp's catch, so an interrupted start may end with exit code 1.
    // 3 s of server-stop grace (SIGTERM, then SIGKILL): the shutdown budget is tight - a
    // router that is mid-load ignores SIGTERM until the cap - and a local runtime gets no
    // value from a long dying grace period.
    function finishEarly() {
        const s = manager.server;
        const done = s ? s.stop({ timeoutMs: 3000 }) : Promise.resolve();
        done.then(function () {
            writeOut("Stopped.");
            finish(0);
        }, function () {
            writeOut("Stopped.");
            finish(0);
        });
    }
    // SIGHUP is what a closing terminal window sends to the launcher's process group on
    // Linux: it stops the runtime exactly like Ctrl+C, in both phases.
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    process.on("SIGHUP", handler);
    return {
        // Called the moment a start has succeeded - BEFORE ConsoleApp writes the record or
        // prints the status. From here a signal must resolve the console's wait so the full
        // teardown (server stopped, record cleared, "Stopped.") runs, even if the signal
        // lands while the status is still being printed.
        startDone: function () {
            awaited = true;
        },
        // Hand the wait to the console's teardown phase (idempotent with startDone): from
        // here on a signal resolves the deferred and ConsoleApp runs its normal teardown.
        awaitPhase: function () {
            awaited = true;
            return promise;
        },
        // The server died on its own during the started phase (it raced the signals through
        // its exitPromise): the wait resolves with the exit result, which the console reports
        // as a failure before the normal teardown. A signal resolves with no reason, so the
        // console can tell the two apart.
        serverExit: settleOnce,
        // Windows only (see the watchdog below): the console window went away.
        consoleClosed: consoleClosed
    };
})();

// Windows parent watchdog. The packaged SLR Translator.exe is a GUI-subsystem process: it
// never attaches to the console, so a console close delivers no signal to it and SIGHUP
// does not exist there - without this poll, closing the window on Windows orphaned both
// the launcher and the server, invisibly. Every 2 s it probes the parent (the cmd.exe
// hosting the console) with signal 0, which is a pure existence check; when the parent is
// gone the console window is closed, and the same exactly-once stop as a signal runs. The
// 2 s poll means the stop can lag the close by up to ~2 s. The watchdog keeps firing after
// startDone() - it is the only close detector on Windows - and is disabled only by the
// shared `stopping` flag. It is deliberately NOT unref'd: it must keep firing for the
// process's whole life, and the process's exit is always driven by the wait/teardown paths
// (which process.exit) or the server child keeping the loop alive. Guarded by process.ppid:
// if it is unavailable, there is no watchdog and the pre-watchdog behaviour applies.
if (process.platform === "win32" && process.ppid) {
    const watchdog = setInterval(function () {
        let alive = true;
        try { process.kill(process.ppid, 0); } catch (err) { alive = false; }
        if (!alive) signals.consoleClosed();
    }, 2000);
    // finish() cancels the watchdog via this stop function, so a drained exit is not
    // held open by (or racing) the interval.
    watchdogStop = function () { clearInterval(watchdog); };
}

// --- Start-path state, mirroring the editor's _rt.lastStart ----------------------------
// What the running server was started with, so the status line reports the applied values
// rather than the registry defaults. Caller-side on purpose: StartConfig stays pure.
let lastStartRecord = null;
let lastEntry = null;

// The offload fields a start actually applied, taken from the tuned entry. Only the ones
// with a value are copied, so the status line overlays exactly what the server was told.
function offloadOfEntry(entry) {
    if (!entry) return {};
    const out = {};
    if (entry.gpuLayers !== undefined) out.gpuLayers = entry.gpuLayers;
    const keys = ["cpuMoe", "cpuMoeLayers", "splitMode", "tensorSplit", "mainGpu", "overrideTensor", "loadMode", "loadModeAuto",
        "draftGpuLayers", "draftCpuMoe", "draftCpuMoeLayers", "fitTarget"];
    for (let i = 0; i < keys.length; i++) {
        if (entry[keys[i]] !== undefined) out[keys[i]] = entry[keys[i]];
    }
    return out;
}

// The drafts, MTP heads and projectors detected from GGUF content are hidden by the shared
// registry, so the console can never bind to one of them.
function targetModels() {
    return ConsoleApp.listModels({
        modelsDir: manager.config.modelsDir,
        registryPath: nodePath.join(dataDirPath, "drafts.json"),
        fs: fs,
        onError: function (err) { writeErr("[llama] " + err.message); }
    });
}

// Start the runtime from a settings object (the recorded settings, with the console's
// --port folded in by ConsoleApp). Shares the editor's StartConfig mapping, so both
// callers consume every recorded key the same way, including each model's own profile
// (context, KV type, GPU layers, experts, speculation and projector) and the MoE expert
// override. The console recomputes the draft/projector associations from the models
// directory (ConsoleApp.startConfigFor), exactly like the editor's auto-start, so a profile
// that forces a draftId/mmprojId resolves that file's detected spec type. The manager here
// is fresh per process, so applying the patch cannot inherit values from an earlier start.
async function startLocal(settings) {
    const cfg = ConsoleApp.startConfigFor({
        settings: settings,
        entries: targetModels(),
        modelsDir: manager.config.modelsDir,
        templatesDir: templatesDirPath,
        fs: fs,
        defaultPort: DEFAULT_CONFIG_PORT,
        StartConfig: StartConfig
    });
    Object.assign(manager.config, cfg.managerConfigPatch);
    lastEntry = cfg.tunedTarget;
    const applied = offloadOfEntry(cfg.tunedTarget);
    lastStartRecord = {
        modelId: cfg.targetId,
        contextSize: cfg.tunedTarget ? cfg.tunedTarget.contextSize : null,
        kvType: cfg.kvType,
        kvUnified: cfg.kvUnified,
        kvOffload: cfg.kvOffload,
        offload: applied,
        expert: cfg.expertInfo,
        template: (cfg.tunedTarget && cfg.tunedTarget.chatTemplatePath) || null,
        libDir: cfg.libDir,
        modelsMax: cfg.modelsMax,
        sleepIdleSeconds: cfg.sleepIdleSeconds,
        threads: cfg.threads,
        threadsBatch: cfg.threadsBatch,
        port: cfg.port,
        loadMode: applied.loadMode,
        specDraftNMax: cfg.tunedTarget ? cfg.tunedTarget.specDraftNMax : undefined,
        specDraftNMin: cfg.tunedTarget ? cfg.tunedTarget.specDraftNMin : undefined
    };
    function bindTarget(state) {
        state.modelId = cfg.targetId;
        // The ownership record keeps the server's own pid alongside the launcher's, so --stop
        // can still stop a server whose launcher is already gone (a closed console window on
        // Windows). Read straight from the manager, like the exit handler's child access.
        state.serverPid = manager.server && manager.server.child ? manager.server.child.pid : null;
        // Every model child loaded now, so a dead-launcher --stop can stop all of them. On-demand
        // loads later refresh the record through refreshRecordPids (called from describeStatus).
        state.serverPids = typeof manager.loadedChildPids === "function" ? manager.loadedChildPids() : [];
        // The manager resolves the recommended load mode once it knows which GPU is in use,
        // so fold what it actually applied into the record for the status line.
        try {
            const modes = state && state.loadModes;
            const record = modes && modes[cfg.targetId];
            if (record && lastStartRecord) {
                lastStartRecord.offload = Object.assign({}, lastStartRecord.offload, {
                    loadMode: record.mode,
                    loadModeAuto: record.auto === true
                });
            }
        } catch (err) { /* status is best-effort */ }
        return state;
    }
    // The front door routes a request with no model field to the selected model, so the manager
    // must be told which one this start bound, exactly as the editor's startLocalInner does.
    // Without it the manager falls back to the first configured entry and preloads a different
    // model than the one the recorded settings selected (the console would serve the wrong model
    // and record the wrong default).
    const startOpts = { defaultId: cfg.targetId };
    if (cfg.forceCpu) startOpts.forceCpu = true;
    try {
        const state = await manager.start(cfg.tunedModels, startOpts);
        // The start succeeded: from here a signal belongs to the console's teardown wait
        // (see signals.startDone), not to the still-starting path, or a signal arriving
        // while the status is being printed would leave the fresh record behind.
        signals.startDone();
        return bindTarget(state);
    } catch (err) {
        // A GPU backend can fail on driver/OOM problems. In automatic mode, retry once on CPU
        // rather than leaving the user without a runtime. An explicitly chosen backend is
        // strict, exactly like the editor's start: the user asked for that one backend, so the
        // failure is reported instead of silently starting on something else.
        const picked = cfg.backend === "cuda" || cfg.backend === "rocm" || cfg.backend === "vulkan";
        if (!picked && !cfg.forceCpu && manager.status.backend && manager.status.backend !== "cpu") {
            writeErr("[llmRuntime] GPU backend failed (" + ((err && err.message) || err) + "); retrying on CPU.");
            const state = await manager.start(cfg.tunedModels, { forceCpu: true, defaultId: cfg.targetId });
            signals.startDone();
            state.note = "GPU backend failed (" + ((err && err.message) || err) + "); running on CPU.";
            return bindTarget(state);
        }
        throw err;
    }
}

// Where the model actually ended up, from the loader's per-buffer report. Only shown when
// the split is physically possible on the selected card (see ServerProcess). The target and
// the draft are checked separately, and an implausible draft is dropped alone, so a mis-parsed
// draft cannot suppress a valid target's split (same path as llmRuntime.js).
function modelBuffers() {
    try {
        const b = manager.server && manager.server.modelBuffers;
        const vram = manager.status && manager.status.deviceMemoryMiB;
        return serverProcessModule.sanitiseBuffers(b, vram);
    } catch (err) { return null; }
}

// The engine's own fit decision, captured raw from the child log (see ServerProcess). Passed
// through verbatim: it is the reasoning behind the placement, not a value to re-parse.
function fitReport() {
    try {
        const f = manager.server && manager.server.fitReport;
        return f || null;
    } catch (err) { return null; }
}

// The server-level settings the running process was started with, for the status line.
function serverSettings() {
    const s = lastStartRecord || {};
    const cfg = manager.config || {};
    return {
        modelsMax: s.modelsMax != null ? s.modelsMax : cfg.modelsMax,
        sleepIdleSeconds: s.sleepIdleSeconds != null ? s.sleepIdleSeconds : (cfg.sleepIdleSeconds || 0),
        hasSleepSetting: s.sleepIdleSeconds != null || cfg.sleepIdleSeconds != null,
        threads: s.threads != null ? s.threads : (cfg.threads || 0),
        threadsBatch: s.threadsBatch != null ? s.threadsBatch : (cfg.threadsBatch || 0)
    };
}

// The loaded model whose own /slots the status block reports: the model this start bound when
// it is among the loaded ids, else the most recently loaded one. null when nothing is loaded,
// so the front door answers 503 and a status read never starts a model. Mirrors the editor's
// loadedIdFor so both status lines name the same instance.
function loadedIdForStatus() {
    const list = (manager.pool && manager.pool.loadedIds && manager.pool.loadedIds()) || [];
    if (!list.length) return null;
    const bound = lastStartRecord && lastStartRecord.modelId;
    if (bound && list.indexOf(bound) !== -1) return bound;
    return list[list.length - 1];
}

// Keep the ownership record's server pids current as models load on demand or are evicted, so a
// --stop that finds this launcher already dead can still stop every child, not only the one
// loaded at start. Best effort: a read/write failure never affects serving. Called from
// describeStatus, which the console runs once at start and then on every status tick.
function refreshRecordPids() {
    try {
        const stateFile = RuntimeState.statePath(dataDirPath);
        const state = RuntimeState.readState({ path: stateFile, fs: fs });
        if (!state) return;
        const pids = typeof manager.loadedChildPids === "function" ? manager.loadedChildPids() : [];
        const current = Array.isArray(state.serverPids) ? state.serverPids : [];
        let same = current.length === pids.length;
        if (same) {
            for (let i = 0; i < pids.length; i++) {
                if (current[i] !== pids[i]) { same = false; break; }
            }
        }
        if (same) return;
        RuntimeState.writeState({
            path: stateFile, fs: fs,
            state: Object.assign({}, state, {
                serverPid: pids.length ? pids[pids.length - 1] : state.serverPid,
                serverPids: pids
            })
        });
    } catch (err) { /* status is best-effort */ }
}

// The full human-readable status, from the same RuntimeStatus.describe the editor uses.
// STATIC on purpose: state, configuration and everything the start applied. Live load
// progress, throughput and draft acceptance moved to activityText below, so the console
// prints this block once and then only when it actually changes.
async function describeStatus() {
    // The record's server pids track the pool as models come and go; a dead launcher's --stop
    // then has every child to stop.
    refreshRecordPids();
    const state = manager.status;
    let entry = lastEntry;
    let kvType = null;
    let kv = null;
    let expert = null;
    let template = null;
    let libDir = null;
    if (entry && lastStartRecord && lastStartRecord.modelId === entry.id) {
        kvType = lastStartRecord.kvType || null;
        expert = lastStartRecord.expert || null;
        template = lastStartRecord.template || null;
        libDir = lastStartRecord.libDir || null;
        entry = Object.assign({}, entry, lastStartRecord.offload || {}, {
            contextSize: lastStartRecord.contextSize != null ? lastStartRecord.contextSize : entry.contextSize,
            specDraftNMax: lastStartRecord.specDraftNMax,
            specDraftNMin: lastStartRecord.specDraftNMin
        });
        kv = { type: kvType, unified: lastStartRecord.kvUnified, offload: lastStartRecord.kvOffload };
    }
    // The loaded model's own /slots through the front door: its n_ctx and is_processing are
    // what the status block shows (the configured context remains the fallback). Bounded, so a
    // busy generation cannot wedge the tick, and read-only, so it never starts a model.
    const loadedId = loadedIdForStatus();
    let slots = null;
    if (loadedId && manager.client && typeof manager.client.slots === "function") {
        try { slots = await withTimeout(manager.client.slots(loadedId), 1200); } catch (err) { slots = null; }
    }
    return RuntimeStatus.describe({
        state: state, entry: entry,
        kvType: kvType, kv: kv, expert: expert, template: template, libDir: libDir,
        buffers: modelBuffers(), fit: fitReport(), server: serverSettings(),
        loadedId: loadedId, slots: slots
    });
}

// One-decimal formatter for the activity line's rates.
function fmt1(n) {
    const v = Number(n) || 0;
    return (Math.round(v * 10) / 10).toFixed(1);
}

// Prometheus text for the bound model. Mirrors the editor's fetchMetricsText: when the
// router answers 400 (a single-model router wants no model argument) or fails, retry once
// without the model id. Resolves to null on any failure - activity is best-effort.
async function fetchRuntimeMetricsText(modelId) {
    const client = manager.client;
    if (!client || typeof client.metrics !== "function") return null;
    for (let i = 0; i < 2; i++) {
        try {
            const res = await client.metrics(i === 0 ? (modelId || null) : null);
            if (res && res.status >= 200 && res.status < 300 && res.body != null) {
                const text = res.body;
                return typeof text === "object" ? JSON.stringify(text) : String(text);
            }
        } catch (err) { /* retry without the id, then give up */ }
        if (!modelId) break;
    }
    return null;
}

// Bounded wait: resolve with the promise's value, or null when it takes longer than ms.
// The router SERIALIZES model-proxied requests (/slots, /metrics) behind an active
// completion - measured: both hang for the whole generation and only answer afterwards -
// so without this cap one busy generation would wedge every tick's fetch for 30 s each.
function withTimeout(promise, ms) {
    let timer = null;
    const cap = new Promise(function (resolve) {
        timer = setTimeout(function () { resolve(null); }, ms);
    });
    return Promise.race([
        Promise.resolve(promise).catch(function () { return null; }),
        cap
    ]).then(function (v) { clearTimeout(timer); return v == null ? null : v; });
}

// The one-line closing summary for a finished burst: the stable after-burst numbers, so
// exactly one line prints per generation (the per-tick "Generating:" line carries the live
// rate). The rates always come from the CUMULATIVE counters (tokens / seconds), never the
// instantaneous gauges - the gauges reset to 0 when the slot goes idle, which once produced
// a duplicate, re-labelled line. The label is fixed and honest about being an average,
// mirroring the editor's own "Throughput" wording. Draft acceptance is unchanged.
function summarizeMetrics(runtime, spec) {
    const parts = [];
    if (runtime) {
        const gen = runtime.predictedSeconds > 0 ? runtime.predictedTokens / runtime.predictedSeconds : 0;
        const prompt = runtime.promptSeconds > 0 ? runtime.promptTokens / runtime.promptSeconds : 0;
        if (gen > 0 || prompt > 0) {
            parts.push("Throughput: " + fmt1(gen) + " tok/s generation, " +
                fmt1(prompt) + " tok/s prompt");
        }
    }
    if (spec && (spec.draftTokens || 0) > 0) {
        parts.push("draft acceptance " + Math.round((spec.acceptance || 0) * 100) + "% (" +
            spec.acceptedTokens + " / " + spec.draftTokens + " tokens)");
    }
    if (parts.length === 0) return null;
    return parts.join(" - ");
}

// The model entry the router reports for modelId, plus its live HTTP port. /models is the
// one proxied endpoint that stays fast while a model works (measured); its loaded entry's
// args carry the instance's --port, so the live per-slot and metrics data can be read from
// the instance DIRECTLY. The router's own /slots?model= and /metrics?model= block for the
// whole of a generation on the pinned build (measured: no answer at any cap), which is why
// the instance is preferred. Falls back to the router when no port is discoverable.
function instanceFor(modelsBody, modelId) {
    const data = modelsBody && modelsBody.data;
    if (!Array.isArray(data)) return { status: null, port: null };
    const q = String(modelId || "");
    const stem = q.replace(/\.gguf$/i, "");
    let best = null;
    for (const entry of data) {
        if (!entry || typeof entry.id !== "string") continue;
        const entryStem = entry.id.replace(/\.gguf$/i, "");
        if (entry.id !== q && entryStem !== stem) continue;
        const status = (entry.status && entry.status.value) || "unknown";
        // The most-loaded entry wins, exactly like selectModelStatus.
        if (!best || (status === "loaded" && best.status !== "loaded")) {
            best = { status: status, args: entry.status && entry.status.args };
        }
    }
    if (!best) return { status: null, port: null };
    let port = null;
    const args = Array.isArray(best.args) ? best.args : [];
    for (let i = 0; i < args.length - 1; i++) {
        if (args[i] === "--port") { port = Number(args[i + 1]) || null; break; }
    }
    return { status: best.status, port: port };
}

// The activity probe, consumed by ConsoleApp's change-driven ticker:
//   { kind: "line",    text: "<one live line>", metrics: null }             - work in progress
//   { kind: "idle",    text: null,              metrics: "<summary>"|null } - nothing running
//   { kind: "unknown", text: null,              metrics: null }             - probe could not tell
// "unknown" must change NOTHING on the console: the load window's blocked /slots used to
// look like "no activity" and clear the remembered line, which re-printed the same
// "Loading model into memory..." every tick. Slots and metrics are read from the model
// instance when its port is known (see instanceFor), with short independent caps; the
// router's endpoints are the fallback. Never throws.
async function activityText(modelId) {
    try {
        const client = manager.client;
        if (!client) return { kind: "unknown", text: null, metrics: null };
        const modelsBody = await withTimeout(client.modelStatuses(), 1200);
        const mine = instanceFor(modelsBody, modelId);
        const inst = mine.port ? httpAdapter() : null;
        const instBase = mine.port ? "http://127.0.0.1:" + mine.port : null;
        const slotsFetch = inst
            ? inst.get(instBase + "/slots").then(function (res) { return res ? res.body : null; })
            : client.slots(modelId);
        const metricsFetch = inst
            ? inst.get(instBase + "/metrics").then(function (res) {
                if (!res || res.body == null) return null;
                return typeof res.body === "object" ? JSON.stringify(res.body) : String(res.body);
            })
            : fetchRuntimeMetricsText(modelId);
        const results = await Promise.all([
            withTimeout(slotsFetch, 1200),
            withTimeout(metricsFetch, 1200)
        ]);
        const slotsSeen = results[0] !== null && results[0] !== undefined;
        const activity = slotsSeen ? RouterClient.parseSlotActivity(results[0]) : null;
        const metricsText = results[1];
        const runtime = metricsText === null ? null : RouterClient.parseRuntimeMetrics(metricsText);
        const spec = metricsText === null ? null : RouterClient.parseSpecMetrics(metricsText);

        if (!slotsSeen) {
            // The load window (or a hiccup): /slots is the only phase signal, so without an
            // answer there is no honest activity - except what /models can still say.
            if (mine.status === "loading") {
                return { kind: "line", text: "Loading model into memory...", metrics: null };
            }
            return { kind: "unknown", text: null, metrics: null };
        }

        if (!activity) {
            // Slots answered and nothing is busy: idle, with the burst's closing summary.
            return { kind: "idle", text: null, metrics: summarizeMetrics(runtime, spec) };
        }

        const parts = [];
        if (activity.phase === "prompt") {
            if (activity.promptTokens > 0) {
                const pct = Math.round((100 * activity.promptProcessed) / activity.promptTokens);
                parts.push("Processing prompt: " + pct + "% (" + activity.promptProcessed + " / " +
                    activity.promptTokens + " tokens)");
            } else {
                parts.push("Processing prompt: starting...");
            }
        } else if (activity.phase === "generating") {
            parts.push("Generating: " + activity.decoded + " tokens (" + activity.remain + " left)");
        }
        if (runtime && ((runtime.predictedTokensPerSecond || 0) > 0 || (runtime.promptTokensPerSecond || 0) > 0)) {
            parts.push(fmt1(runtime.predictedTokensPerSecond) + " tok/s generation, " +
                fmt1(runtime.promptTokensPerSecond) + " tok/s prompt");
        }
        if (spec && (spec.draftTokens || 0) > 0) {
            parts.push("draft acceptance " + Math.round((spec.acceptance || 0) * 100) + "% (" +
                spec.acceptedTokens + " / " + spec.draftTokens + " tokens)");
        }
        return { kind: "line", text: parts.join(" - "), metrics: null };
    } catch (err) {
        return { kind: "unknown", text: null, metrics: null };
    }
}

// The console's teardown wait, over the shared signal wiring installed above (the handlers
// themselves run from process start, so a signal during the start is ours too).
function makeWaitForExit() {
    const wait = signals.awaitPhase();
    const server = manager.server;
    if (server && server.exitPromise) {
        server.exitPromise.then(function (result) {
            signals.serverExit(result || { code: null, signal: null });
        });
    }
    return wait;
}

// --stop stops the recorded PID, which is the launcher's. On Linux that one SIGTERM is
// enough: the server runs detached and this launcher's own SIGTERM handler stops it during
// teardown. On Windows it must be a tree kill: Node's kill with SIGTERM is an unconditional
// TerminateProcess of the single process there, so the launcher would die while its
// llama-server child (spawned with detached: false) kept running and --stop could never
// actually stop anything. The same taskkill tree kill ServerProcess's defaultKillTree uses
// on win32 reaches the child. The pid is validated (a positive integer probed for liveness,
// and the record confirmed as our runtime) before this is ever called.
function stopByPid(pid) {
    if (process.platform === "win32") {
        return new Promise(function (resolve, reject) {
            require("child_process").exec("taskkill /pid " + pid + " /T /F", function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    process.kill(pid, "SIGTERM");
    return Promise.resolve();
}

const app = ConsoleApp.buildRunner({
    fs: fs,
    dataDir: dataDirPath,
    http: httpAdapter(),
    readStartState: readStartState,
    startLocal: startLocal,
    stopLocal: function () {
        // Same 3 s server-stop grace as finishEarly (see there): the launcher's shutdown
        // must fit a desktop-sized budget, and manager.stop() alone would wait out the
        // 10 s default cap whenever the router ignores SIGTERM. manager.stop() afterwards
        // resets the manager state; against an already-stopped server it is instant.
        const s = manager.server;
        if (!s) return manager.stop();
        return s.stop({ timeoutMs: 3000 }).then(function () { return manager.stop(); });
    },
    stopByPid: stopByPid,
    describeStatus: describeStatus,
    activityLine: function (modelId) { return activityText(modelId); },
    now: function () { return new Date(); },
    pid: process.pid,
    out: writeOut,
    waitForExit: makeWaitForExit
});

app.run(process.argv.slice(2)).then(function (code) {
    // Exit by draining (see finish): process.exit from the signal-triggered chain
    // deadlocks this engine. The ref'd fallback inside finish covers a wedged drain.
    finish(code);
}, function (err) {
    writeErr("slr-runtime: " + ((err && err.message) || err));
    finish(1);
});
