// www/core/llmRuntime/lib/ConsoleApp.js
"use strict";
const RuntimeState = require("./RuntimeState");

// Exit codes. 2 is distinct so a caller can tell "someone else is already serving" from a
// genuine failure.
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_REFUSED = 2;

// How often the status is redrawn. Matches the editor's own status ticker.
const TICK_MS = 2000;

function parseArgs(argv) {
    const out = { port: null, portProvided: false, stop: false, help: false, unknown: [] };
    const list = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a === "--stop") out.stop = true;
        else if (a === "--help" || a === "-h") out.help = true;
        else if (a === "--port") { out.port = list[i + 1]; out.portProvided = true; i++; }
        else if (a.indexOf("--port=") === 0) { out.port = a.slice("--port=".length); out.portProvided = true; }
        else out.unknown.push(a);
    }
    return out;
}

// A port is good only when it is a plain decimal integer in range. Returns the canonical decimal
// string so `--port 04321` is forwarded as "4321"; returns false for anything else, including a
// missing/empty value. This is deliberately strict: `--port 0x50`, `--port 1e3`, `--port "+1"`
// and `--port " 1 "` are refused here, before a server is spawned, rather than being forwarded
// raw and turning into a confusing llama-server argument error. Only called when the flag was
// actually provided, so "no flag" and "bad flag" stay distinguishable (see parseArgs).
function validPort(value) {
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return false;
    const n = Number(value);
    if (!isFinite(n) || n < 1 || n > 65535) return false;
    return String(n);
}

const HELP = [
    "SLR Runtime - serves the bundled local model without opening SLR Translator.",
    "",
    "Usage:",
    "  node slr-runtime.js [--port <n>]   start and serve (Ctrl+C to stop)",
    "  node slr-runtime.js --stop         stop a runtime left running",
    "  node slr-runtime.js --help         this text",
    "",
    "Options come from the last start recorded by SLR Translator."
].join("\n");

// --- Console start path: model list and per-model settings -------------------------------
//
// These mirror the editor's discovery exactly, using the same ModelInfo/ModelAssociations/
// ModelProfiles the editor uses, so a model keeps its settings whether it is served from the
// app or from SLR Runtime. `listModels` wraps the shared registry, so the drafts, MTP heads
// and projectors detected from GGUF content are never offered as servable models;
// `modelAssociations` exposes that same detection for resolving a profile's forced draft or
// projector; `startConfigFor` composes the StartConfig input. Keeping the composition here
// (rather than in the launcher) makes the exact path the console runs unit-testable.

// Every GGUF in the models directory as a content-classified ModelInfo, then paired with
// ModelAssociations. `readInfo` is the same test seam the registry accepts. Never throws: an
// unreadable directory resolves to null (no associations).
function modelAssociations(deps) {
    const nodePath = require("path");
    const ModelInfo = require("./ModelInfo.js");
    const ModelAssociations = require("./ModelAssociations.js");
    const read = deps.readInfo || function (filePath) {
        return ModelInfo.readModelFile({ filePath: filePath, fs: deps.fs });
    };
    let names;
    try { names = deps.fs.readdirSync(deps.modelsDir); } catch (err) { return null; }
    const infos = [];
    for (let i = 0; i < names.length; i++) {
        if (!/\.gguf$/i.test(names[i])) continue;
        const info = read(nodePath.join(deps.modelsDir, names[i]));
        if (info) infos.push(info);
    }
    return ModelAssociations.associate(infos);
}

// The models the console may serve, built with the shared registry (drafts, MTP heads and
// projectors are hidden there; see ModelRegistry.buildModelEntries).
function listModels(deps) {
    const ModelRegistry = require("./ModelRegistry.js");
    return ModelRegistry.buildModelEntries({
        modelsDir: deps.modelsDir,
        registryPath: deps.registryPath,
        fs: deps.fs,
        onError: deps.onError,
        readInfo: deps.readInfo
    });
}

// Compose the shared StartConfig for a recorded settings object. The per-model profile map
// travels inside the settings (the editor persists it in laststart.json); the draft/projector
// associations are computed from the models directory unless the caller already provided
// them, so a profile that forces a draftId or mmprojId resolves that file's detected spec
// type exactly as the editor's start does.
function startConfigFor(deps) {
    const StartConfig = deps.StartConfig || require("./StartConfig.js");
    const settings = deps.settings || {};
    const profiles = settings.profiles;
    let associations = settings.associations || null;
    if (profiles && !associations) {
        try {
            associations = modelAssociations({
                modelsDir: deps.modelsDir, fs: deps.fs, readInfo: deps.readInfo
            });
        } catch (err) {
            associations = null;
        }
    }
    const entries = deps.entries || listModels(deps);
    return StartConfig.buildStartConfig({
        opts: settings,
        entries: entries,
        modelsDir: deps.modelsDir,
        templatesDir: deps.templatesDir,
        fs: deps.fs,
        defaultPort: deps.defaultPort,
        profiles: profiles,
        associations: associations
    });
}

function buildRunner(deps) {
    const fs = deps.fs;
    const out = deps.out || function (s) { process.stdout.write(s + "\n"); };
    const stateFile = RuntimeState.statePath(deps.dataDir);
    // A record with no PID can never be refused, so the next start would load a second copy of
    // the model. Fall back to our own PID rather than writing an unusable record.
    const pid = deps.pid || process.pid;

    // Defaulted here so the module works uninjected, and so the tests only override what they
    // exercise. `kill` is injected so a test never signals a real process.
    const kill = deps.kill || process.kill;
    const liveCheck = deps.isRuntimeLive || function (state) {
        return RuntimeState.isRuntimeLive(state, {
            http: deps.http,
            verifyProcess: function () { return RuntimeState.isProcessAlive(state.pid, kill); }
        });
    };
    const stopRecorded = deps.stopRecorded || function (state) {
        if (deps.stopByPid) return deps.stopByPid(state.pid);
        kill(state.pid, "SIGTERM");
    };
    // Stops one pid through the platform-aware injected killer (taskkill tree on win32,
    // SIGTERM elsewhere); used for a server whose launcher is already gone.
    const stopByPid = deps.stopByPid || function (target) {
        kill(target, "SIGTERM");
    };

    function clearStale(state) {
        if (!state) return false;
        if (RuntimeState.isProcessAlive(state.pid, kill)) return false;
        RuntimeState.clearState({ path: stateFile, fs: fs });
        out("A previous runtime (pid " + state.pid + ") is no longer running; clearing its stale record.");
        return true;
    }

    // Change-driven console output. The full status block prints only when it differs
    // from the last printed one (always on the first call), so an idle runtime does not
    // re-print the same block every tick. The optional injected `activityLine(modelId)`
    // reports the live state as an object:
    //   {kind:"line", text}      - work in progress: print when the text changes
    //   {kind:"idle", metrics}   - nothing running: end a generation burst once (one blank
    //                              separator line, then the metrics summary once)
    //   {kind:"unknown", ...}    - probe could not tell (e.g. /slots timing out while a
    //                              model loads): change NOTHING, so a stable line is not
    //                              forgotten and re-printed
    let lastStatus = null;
    let lastActivity = null;
    let lastSummary = null;
    async function printStatus(modelId) {
        try {
            const text = await deps.describeStatus();
            if (text && text !== lastStatus) {
                lastStatus = text;
                out(text);
            }
        } catch (err) { /* status is informational */ }
        if (typeof deps.activityLine !== "function") return;
        let result;
        try {
            result = await deps.activityLine(modelId || null);
        } catch (err) { /* activity is informational */ return; }
        if (!result || result.kind === "unknown") return;
        if (result.kind === "line") {
            if (result.text && result.text !== lastActivity) {
                lastActivity = result.text;
                out(result.text);
            }
            return;
        }
        if (result.kind === "idle") {
            if (lastActivity !== null) {
                if (lastActivity.indexOf("Generating:") !== -1) out("");
                lastActivity = null;
            }
            if (result.metrics && result.metrics !== lastSummary) {
                lastSummary = result.metrics;
                out(result.metrics);
            }
        }
    }

    // A PID that exists is not proof it is our runtime: it can be recycled, or the state file can
    // be hand-edited. Because stopping means signalling that PID, confirm the record actually
    // answers as the SLR runtime first. An unconfirmed process is left alone (refused) rather
    // than killed.
    async function recordIsLive(state) {
        if (!state || !state.baseUrl) return false;
        try {
            return !!(await liveCheck(state));
        } catch (err) {
            return false;
        }
    }

    async function runStop() {
        const state = RuntimeState.readState({ path: stateFile, fs: fs });
        if (!state || !RuntimeState.isProcessAlive(state.pid, kill)) {
            // A closed console window can leave the launcher dead while the servers it spawned
            // live on holding their ports (empirically the Windows case: the GUI-subsystem
            // launcher dies with its cmd window, the spawned llama-servers do not). The record's
            // server pids are then the only handles --stop has, so stop every one of them here
            // instead of just reporting nothing running. serverPids is the current list; a record
            // written before it existed carries only serverPid, and both are accepted. Same rule
            // as below: what could not be stopped is never cleared.
            const recorded = [];
            if (state && Array.isArray(state.serverPids)) {
                for (let i = 0; i < state.serverPids.length; i++) {
                    if (recorded.indexOf(state.serverPids[i]) === -1) recorded.push(state.serverPids[i]);
                }
            }
            if (state && state.serverPid != null && recorded.indexOf(state.serverPid) === -1) {
                recorded.push(state.serverPid);
            }
            const alive = [];
            for (let i = 0; i < recorded.length; i++) {
                if (RuntimeState.isProcessAlive(recorded[i], kill)) alive.push(recorded[i]);
            }
            if (alive.length) {
                const failed = [];
                for (let i = 0; i < alive.length; i++) {
                    try {
                        await stopByPid(alive[i]);
                    } catch (err) {
                        failed.push({ pid: alive[i], message: (err && err.message) || String(err) });
                    }
                }
                if (failed.length) {
                    for (let i = 0; i < failed.length; i++) {
                        out("Could not stop the runtime left running (pid " + failed[i].pid + "): " +
                            failed[i].message);
                    }
                    return EXIT_ERROR;
                }
                RuntimeState.clearState({ path: stateFile, fs: fs });
                out(alive.length === 1
                    ? "Stopped the runtime left running (pid " + alive[0] + ")."
                    : "Stopped the runtime left running (pids " + alive.join(", ") + ").");
                return EXIT_OK;
            }
            RuntimeState.clearState({ path: stateFile, fs: fs });
            out("No runtime is running.");
            return EXIT_OK;
        }
        if (!(await recordIsLive(state))) {
            out("A process (pid " + state.pid + ") is running on port " + state.port +
                ", but it could not be confirmed as the SLR runtime.");
            out("Leaving it alone; close the process manually if it is yours.");
            return EXIT_ERROR;
        }
        try {
            await stopRecorded(state);
        } catch (err) {
            out("Could not stop the runtime on port " + state.port + ": " + ((err && err.message) || err));
            return EXIT_ERROR;
        }
        RuntimeState.clearState({ path: stateFile, fs: fs });
        out("Stopped the runtime on port " + state.port + ".");
        return EXIT_OK;
    }

    async function runStart(args) {
        const recorded = deps.readStartState();
        if (!recorded || !recorded.settings || !recorded.settings.modelId) {
            out("No runtime settings have been recorded yet.");
            out("Start the runtime once from SLR Translator, then run this again.");
            return EXIT_ERROR;
        }
        const previous = RuntimeState.readState({ path: stateFile, fs: fs });
        clearStale(previous);
        // A record whose process is still alive is a refusal, not a second start.
        const alive = previous && RuntimeState.isProcessAlive(previous.pid, kill);
        if (alive && await liveCheck(previous)) {
            // A hand-edited record can lack a port: name the baseUrl (or admit the port is
            // unknown) rather than printing "port null".
            const where = previous.port != null ? "port " + previous.port
                : (previous.baseUrl || "(unknown port)");
            out("A runtime is already serving on " + where + " (" + previous.baseUrl + ").");
            out("Use it directly, or stop it first with --stop.");
            return EXIT_REFUSED;
        }
        const settings = Object.assign({}, recorded.settings);
        if (args.port !== null) settings.port = args.port;
        let state;
        try {
            state = await deps.startLocal(settings);
        } catch (err) {
            out("Could not start the runtime: " + ((err && err.message) || err));
            return EXIT_ERROR;
        }
        // Every loaded child pid, so a --stop that finds this launcher already dead can stop all
        // of them, not just the one the compatibility `server` handle names. serverPid is kept
        // for anything that still reads the single-pid form.
        const serverPids = Array.isArray(state.serverPids) ? state.serverPids.slice()
            : (state.serverPid != null ? [state.serverPid] : []);
        RuntimeState.writeState({
            path: stateFile, fs: fs,
            state: {
                pid: pid, serverPid: state.serverPid || null, serverPids: serverPids,
                port: state.port || settings.port || null,
                baseUrl: state.baseUrl || null, modelId: state.modelId || settings.modelId,
                startedAt: deps.now().toISOString()
            }
        });
        out("Serving " + (state.baseUrl || "the local runtime") + " - v1/chat/completions is ready.");
        out("Press Ctrl+C to stop.");
        // The model id the start resolved to: the activity line asks the router about it.
        const modelId = state.modelId || settings.modelId || null;
        // Print once up front so a caller (or a test with an already-resolved waitForExit) sees
        // the status even if no tick ever fires.
        await printStatus(modelId);
        const timer = setInterval(function () { printStatus(modelId); }, TICK_MS);
        // Teardown is unconditional: whatever ends the wait (signal, normal exit, or a rejected
        // promise) the child is stopped and the record removed, or the next start would take the
        // stale path and load a duplicate model.
        let exitCode = EXIT_OK;
        // A caller may resolve the wait with the server's exit result when the server died on
        // its own (a signal resolves it with no reason); a rejection is the caller's own
        // unexpected failure. Either way the teardown below runs exactly once - this only
        // decides the message and the exit code.
        let exitReason = null;
        try {
            exitReason = await deps.waitForExit();
        } catch (err) {
            out("The runtime stopped unexpectedly: " + ((err && err.message) || err));
            exitCode = EXIT_ERROR;
        }
        if (exitReason) {
            const detail = exitReason.code != null ? "code " + exitReason.code
                : (exitReason.signal != null ? "signal " + exitReason.signal : "an unknown reason");
            out("llama-server exited unexpectedly (" + detail + "); stopping.");
            exitCode = EXIT_ERROR;
        }
        clearInterval(timer);
        try {
            await deps.stopLocal();
        } catch (err) { /* shutting down anyway */ }
        RuntimeState.clearState({ path: stateFile, fs: fs });
        out("Stopped.");
        return exitCode;
    }

    async function run(argv) {
        const args = parseArgs(argv);
        if (args.help) { out(HELP); return EXIT_OK; }
        // A typo like `--stpo` must not silently start a server.
        if (args.unknown.length) {
            out("Unknown option: " + args.unknown[0]);
            out("Run with --help for usage.");
            return EXIT_ERROR;
        }
        let port = null;
        if (args.portProvided) {
            port = validPort(args.port);
            if (port === false) {
                out("--port needs a whole number between 1 and 65535 (got: " +
                    (args.port === undefined || args.port === "" ? "<missing>" : args.port) + ").");
                return EXIT_ERROR;
            }
        }
        args.port = port;
        if (args.stop) return runStop();
        return runStart(args);
    }

    return { run, stateFile };
}

module.exports = {
    buildRunner, parseArgs, validPort, modelAssociations, listModels, startConfigFor,
    EXIT_OK, EXIT_ERROR, EXIT_REFUSED, TICK_MS, HELP
};
