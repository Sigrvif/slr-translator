"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const ConsoleApp = require("../lib/ConsoleApp.js");
const ModelArgs = require("../lib/ModelArgs.js");

const STATE = {
    version: 1, pid: 4242, port: 1234,
    baseUrl: "http://127.0.0.1:1234", modelId: "m1",
    startedAt: "2026-09-25T11:00:00.000Z"
};

function fakeFs(initial) {
    const files = Object.assign({}, initial || {});
    return {
        files,
        existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFileSync: (p) => files[p],
        writeFileSync: (p, t) => { files[p] = t; },
        unlinkSync: (p) => { delete files[p]; }
    };
}

// A deps bundle with every collaborator faked. Each test overrides only what it exercises.
function makeDeps(over) {
    const lines = [];
    const deps = {
        fs: fakeFs(),
        path: { join: (...a) => a.join("/") },
        dataDir: "/app/data/llama",
        http: { get: async () => { throw new Error("ECONNREFUSED"); } },
        readStartState: () => ({ autoStart: false, settings: { modelId: "m1" } }),
        startLocal: async () => ({ status: "ready", baseUrl: "http://127.0.0.1:1234", modelId: "m1" }),
        stopLocal: async () => {},
        statusOf: () => ({ status: "ready", backend: "cpu", device: null, baseUrl: "http://127.0.0.1:1234", modelId: "m1" }),
        describeStatus: async () => "Status: ready\nURL: http://127.0.0.1:1234",
        now: () => new Date("2026-09-25T11:00:00.000Z"),
        out: (s) => { lines.push(s); },
        waitForExit: () => Promise.resolve(),
        pid: 4242,
        // Default: every PID looks dead, so a test that writes a state file gets the
        // "stale record" path unless it opts into a live one.
        kill: () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; }
    };
    Object.assign(deps, over || {});
    deps.lines = lines;
    return deps;
}

test("refuses to start a second runtime when one is live, and names its port", async () => {
    const deps = makeDeps({
        kill: () => {},                  // the recorded PID is alive
        isRuntimeLive: async () => true  // and it really answers on /health + serves the model
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(STATE) });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 2);
    assert.match(deps.lines.join("\n"), /1234/);
});

test("clears a stale record and starts fresh", async () => {
    let started = 0;
    const deps = makeDeps({
        startLocal: async () => { started++; return { status: "ready", baseUrl: "http://127.0.0.1:1234", modelId: "m1" }; }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { pid: 999999 })) });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.strictEqual(started, 1);
    assert.match(deps.lines.join("\n"), /stale/i);
});

test("reports clearly when no settings were ever recorded", async () => {
    const deps = makeDeps({ readStartState: () => ({ autoStart: false, settings: null }) });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 1);
    assert.match(deps.lines.join("\n"), /start the runtime once from SLR Translator/i);
});

test("prints the status text the editor's window would show", async () => {
    const deps = makeDeps();
    await ConsoleApp.buildRunner(deps).run([]);
    assert.match(deps.lines.join("\n"), /Status: ready/);
});

test("does not reprint an unchanged status block", async () => {
    // Real timers: ~6.5 s of wait so several 2 s ticks fire while nothing changes. The
    // status block must appear exactly once, at startup.
    const deps = makeDeps({
        waitForExit: () => new Promise((resolve) => { setTimeout(resolve, 6500); })
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    const printed = deps.lines.filter((l) => l.indexOf("Status: ready") !== -1);
    assert.strictEqual(printed.length, 1, "status block must print once, not every tick");
});

test("prints the activity line only when it changes", async () => {
    // The injected activity probe walks generation -> generation (changed) -> idle across
    // the startup call and the 2 s ticks (~6.5 s of wait). Each distinct line must print
    // exactly once, and finishing generation must leave one blank separator line.
    const seq = [
        { kind: "line", text: "Generating: 10 tokens", metrics: null },
        { kind: "line", text: "Generating: 20 tokens", metrics: null },
        { kind: "idle", text: null, metrics: null }
    ];
    const deps = makeDeps({
        activityLine: async () => (seq.length ? seq.shift() : { kind: "idle", text: null, metrics: null }),
        waitForExit: () => new Promise((resolve) => { setTimeout(resolve, 6500); })
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    const gen = deps.lines.filter((l) => l.indexOf("Generating:") === 0);
    assert.deepStrictEqual(gen, ["Generating: 10 tokens", "Generating: 20 tokens"],
        "each activity line prints once; no duplicates");
    assert.ok(deps.lines.includes(""), "one blank line separates the finished generation");
});

test("an unknown activity result changes nothing", async () => {
    // The load-window bug: a probe that cannot tell must not clear the remembered line,
    // or the same stable line re-prints every tick.
    const seq = [
        { kind: "line", text: "Loading model into memory...", metrics: null },
        { kind: "unknown", text: null, metrics: null },
        { kind: "unknown", text: null, metrics: null },
        { kind: "line", text: "Loading model into memory...", metrics: null }
    ];
    const deps = makeDeps({
        activityLine: async () => (seq.length ? seq.shift() : { kind: "unknown", text: null, metrics: null }),
        waitForExit: () => new Promise((resolve) => { setTimeout(resolve, 6500); })
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    const loading = deps.lines.filter((l) => l === "Loading model into memory...");
    assert.strictEqual(loading.length, 1, "the same line must not repeat across unknown ticks");
});

test("an idle result ends a burst once", async () => {
    // After generation: exactly one blank separator, then the metrics summary once; further
    // idle ticks print nothing.
    const summary = "Last generation: 9.1 tok/s, 41.0 tok/s prompt";
    const seq = [
        { kind: "line", text: "Generating: 120 tokens (0 left)", metrics: null },
        { kind: "idle", text: null, metrics: summary },
        { kind: "idle", text: null, metrics: summary },
        { kind: "idle", text: null, metrics: summary }
    ];
    const deps = makeDeps({
        activityLine: async () => (seq.length ? seq.shift() : { kind: "idle", text: null, metrics: summary }),
        waitForExit: () => new Promise((resolve) => { setTimeout(resolve, 6500); })
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.strictEqual(deps.lines.filter((l) => l === "").length, 1, "one blank separator line");
    assert.strictEqual(deps.lines.filter((l) => l === summary).length, 1, "the summary prints once");
});

test("a failed start exits non-zero and reports the reason", async () => {
    const deps = makeDeps({ startLocal: async () => { throw new Error("No GGUF models found in /app/data/llama/models."); } });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 1);
    assert.match(deps.lines.join("\n"), /No GGUF models found/);
});

test("stops the server and clears the record on a clean exit", async () => {
    let stopped = 0;
    const deps = makeDeps({ stopLocal: async () => { stopped++; } });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.strictEqual(stopped, 1);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
});

test("--port overrides the recorded port", async () => {
    const seen = [];
    const deps = makeDeps({ startLocal: async (opts) => { seen.push(opts.port); return { status: "ready", baseUrl: "http://127.0.0.1:4321", modelId: "m1" }; } });
    await ConsoleApp.buildRunner(deps).run(["--port", "4321"]);
    assert.deepStrictEqual(seen, ["4321"]);
});

test("an invalid --port is rejected before anything starts", async () => {
    let started = 0;
    const deps = makeDeps({ startLocal: async () => { started++; } });
    const code = await ConsoleApp.buildRunner(deps).run(["--port", "not-a-port"]);
    assert.strictEqual(code, 1);
    assert.strictEqual(started, 0);
    assert.match(deps.lines.join("\n"), /port/i);
});

test("--stop stops a live recorded runtime and clears the record", async () => {
    let stopped = 0;
    // The state file is the only source: --stop reads it, and the PID in it must be alive.
    const deps = makeDeps({
        kill: () => {},                       // the recorded PID is alive
        isRuntimeLive: async () => true,      // and the record verifies as our runtime
        stopRecorded: async () => { stopped++; }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(STATE) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 0);
    assert.strictEqual(stopped, 1);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
});

test("teardown still runs when waitForExit rejects", async () => {
    let stopped = 0;
    const deps = makeDeps({
        stopLocal: async () => { stopped++; },
        waitForExit: () => Promise.reject(new Error("boom"))
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 1);
    assert.strictEqual(stopped, 1);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
    assert.match(deps.lines.join("\n"), /boom/);
});

test("a server that dies on its own reports the failure and tears down once with exit 1", async () => {
    let stopped = 0;
    // waitForExit resolves only when the injected server-exit trigger fires, like the
    // launcher's race against manager.server.exitPromise.
    let fireServerExit = null;
    const deps = makeDeps({
        stopLocal: async () => { stopped++; },
        waitForExit: () => new Promise((resolve) => { fireServerExit = () => resolve({ code: 1, signal: null }); })
    });
    const done = ConsoleApp.buildRunner(deps).run([]);
    while (!fireServerExit) await new Promise((r) => setTimeout(r, 1));
    fireServerExit();
    assert.strictEqual(await done, 1);
    assert.strictEqual(stopped, 1);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
    assert.match(deps.lines.join("\n"), /llama-server exited unexpectedly \(code 1\); stopping\./);
});

test("the refusal names the baseUrl when a live record has no port", async () => {
    const deps = makeDeps({
        kill: () => {},                  // the recorded PID is alive
        isRuntimeLive: async () => true  // and it really answers
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { port: null })) });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 2);
    assert.match(deps.lines.join("\n"), /already serving on http:\/\/127\.0\.0\.1:1234/);
    assert.doesNotMatch(deps.lines.join("\n"), /port null/);
});

test("--port with no value or an empty value is rejected before anything starts", async () => {
    for (const argv of [["--port"], ["--port", ""], ["--port="]]) {
        let started = 0;
        const deps = makeDeps({ startLocal: async () => { started++; } });
        const code = await ConsoleApp.buildRunner(deps).run(argv);
        assert.strictEqual(code, 1, "exit for " + JSON.stringify(argv));
        assert.strictEqual(started, 0, "startLocal for " + JSON.stringify(argv));
        assert.match(deps.lines.join("\n"), /port/i);
    }
});

test("--port rejects non-plain-decimal values instead of forwarding them", async () => {
    for (const value of ["0x50", "1e3", "+4321", " 4321 "]) {
        let started = 0;
        const deps = makeDeps({ startLocal: async () => { started++; } });
        const code = await ConsoleApp.buildRunner(deps).run(["--port", value]);
        assert.strictEqual(code, 1, "exit for " + value);
        assert.strictEqual(started, 0, "startLocal for " + value);
    }
});

test("--stop refuses to kill a live PID whose record is not a verified runtime", async () => {
    let stopped = 0;
    const deps = makeDeps({
        kill: () => {},                       // the recorded PID is alive
        stopRecorded: async () => { stopped++; }
        // default liveCheck: fake http throws, so the record does not verify
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(STATE) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 1);
    assert.strictEqual(stopped, 0);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), true);
    assert.match(deps.lines.join("\n"), /could not be confirmed/i);
});

test("--stop does not clear an alive record that has no baseUrl", async () => {
    let stopped = 0;
    const deps = makeDeps({
        kill: () => {},
        stopRecorded: async () => { stopped++; }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { baseUrl: null })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 1);
    assert.strictEqual(stopped, 0);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), true);
});

test("an unknown argument is rejected and no server is started", async () => {
    let started = 0;
    const deps = makeDeps({ startLocal: async () => { started++; } });
    const code = await ConsoleApp.buildRunner(deps).run(["--stpo"]);
    assert.strictEqual(code, 1);
    assert.strictEqual(started, 0);
    assert.match(deps.lines.join("\n"), /--stpo/);
});

test("a record without an injected pid uses the runner's own pid", async () => {
    let recordedPid = null;
    const deps = makeDeps({
        pid: undefined,
        stopLocal: async () => {
            recordedPid = JSON.parse(deps.fs.readFileSync("/app/data/llama/runtime.json")).pid;
        }
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.strictEqual(recordedPid, process.pid);
});

test("--stop with nothing running says so instead of failing silently", async () => {
    const deps = makeDeps();
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 0);
    assert.match(deps.lines.join("\n"), /no runtime is running/i);
});

// --- Windows recovery: a server left running by a dead launcher -------------------------

// Liveness for exactly the given pids: every other pid (the launcher's) looks dead.
function killAliveOnly() {
    const alive = Array.prototype.slice.call(arguments);
    return (target) => {
        if (alive.indexOf(target) !== -1) return;
        const e = new Error("ESRCH"); e.code = "ESRCH"; throw e;
    };
}

test("--stop stops a server left running by a dead launcher and clears the record", async () => {
    const stoppedPids = [];
    const deps = makeDeps({
        kill: killAliveOnly(5171),            // launcher pid dead, serverPid alive
        stopByPid: async (pid) => { stoppedPids.push(pid); }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { pid: 999999, serverPid: 5171 })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(stoppedPids, [5171]);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
    assert.match(deps.lines.join("\n"), /Stopped the runtime left running \(pid 5171\)\./);
});

test("--stop stops every child pid left running by a dead launcher", async () => {
    const stoppedPids = [];
    const deps = makeDeps({
        kill: killAliveOnly(5171, 5172),      // launcher pid dead; both recorded children alive
        stopByPid: async (pid) => { stoppedPids.push(pid); }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, {
        pid: 999999, serverPid: 5172, serverPids: [5171, 5172]
    })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(stoppedPids, [5171, 5172], "every recorded child is stopped");
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
    assert.match(deps.lines.join("\n"), /Stopped the runtime left running \(pids 5171, 5172\)\./);
});

test("--stop keeps the record when one of several left-behind children cannot be stopped", async () => {
    const stoppedPids = [];
    const deps = makeDeps({
        kill: killAliveOnly(5171, 5172),
        stopByPid: async (pid) => { stoppedPids.push(pid); if (pid === 5172) throw new Error("taskkill failed"); }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, {
        pid: 999999, serverPid: 5172, serverPids: [5171, 5172]
    })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 1);
    assert.deepStrictEqual(stoppedPids, [5171, 5172], "the rest are still attempted");
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), true, "what could not be stopped is never cleared");
    assert.match(deps.lines.join("\n"), /Could not stop the runtime left running \(pid 5172\): taskkill failed/);
});

test("--stop with a dead launcher and no recorded serverPid still reports nothing running", async () => {
    const deps = makeDeps();              // every pid looks dead
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { pid: 999999 })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 0);
    assert.match(deps.lines.join("\n"), /no runtime is running/i);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), false);
});

test("--stop keeps the record when the left-behind server cannot be stopped", async () => {
    const deps = makeDeps({
        kill: killAliveOnly(5171),
        stopByPid: async () => { throw new Error("taskkill failed"); }
    });
    deps.fs = fakeFs({ "/app/data/llama/runtime.json": JSON.stringify(Object.assign({}, STATE, { pid: 999999, serverPid: 5171 })) });
    const code = await ConsoleApp.buildRunner(deps).run(["--stop"]);
    assert.strictEqual(code, 1);
    assert.strictEqual(deps.fs.existsSync("/app/data/llama/runtime.json"), true);
    assert.match(deps.lines.join("\n"), /taskkill failed/);
});

test("a successful start records the server's pid alongside the launcher's", async () => {
    let seen = null;
    const deps = makeDeps({
        startLocal: async () => ({ status: "ready", baseUrl: "http://127.0.0.1:1234", modelId: "m1", serverPid: 5171 }),
        stopLocal: async () => {
            // Read the record before teardown clears it (the established pattern).
            seen = JSON.parse(deps.fs.readFileSync("/app/data/llama/runtime.json"));
        }
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.strictEqual(seen.serverPid, 5171);
    assert.strictEqual(seen.pid, 4242);
});

test("a start records every loaded child pid, keeping the single serverPid for compatibility", async () => {
    let seen = null;
    const deps = makeDeps({
        startLocal: async () => ({ status: "ready", baseUrl: "http://127.0.0.1:1234", modelId: "m1",
            serverPid: 5172, serverPids: [5171, 5172] }),
        stopLocal: async () => {
            seen = JSON.parse(deps.fs.readFileSync("/app/data/llama/runtime.json"));
        }
    });
    const code = await ConsoleApp.buildRunner(deps).run([]);
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(seen.serverPids, [5171, 5172]);
    assert.strictEqual(seen.serverPid, 5172);
});

test("a start with only a serverPid still records a one-element serverPids list", async () => {
    let seen = null;
    const deps = makeDeps({
        startLocal: async () => ({ status: "ready", baseUrl: "http://127.0.0.1:1234", modelId: "m1", serverPid: 5171 }),
        stopLocal: async () => {
            seen = JSON.parse(deps.fs.readFileSync("/app/data/llama/runtime.json"));
        }
    });
    await ConsoleApp.buildRunner(deps).run([]);
    assert.deepStrictEqual(seen.serverPids, [5171]);
});

// --- Console start path: model list and per-model settings -------------------------------

// A read-only fs over an in-memory path map: enough for the ModelRegistry/ModelInfo
// discovery (existsSync for the directory, readdirSync for the names).
function modelFs(files) {
    return {
        existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readdirSync: (dir) => Object.keys(files).filter(
            (p) => p.indexOf(dir + "/") === 0 && p.slice(dir.length + 1).indexOf("/") === -1
        ).map((p) => p.slice(dir.length + 1)),
        statSync: () => ({ isDirectory: () => true })
    };
}

// A readInfo seam keyed by absolute path, returning the synthetic classified info.
function reader(infos) {
    return (filePath) => infos[filePath] || null;
}

function classified(filePath, extra) {
    return Object.assign({
        id: filePath.split("/").pop(), path: filePath, kind: "model", arch: "llama", name: "Alpha",
        basename: null, embeddingLength: 4096, blockCount: 12, specType: null, mtpCapable: false,
        targetLayers: null
    }, extra || {});
}

test("the console model list never offers a detected draft, MTP head or projector", () => {
    const files = {
        "/models": true,
        "/models/alpha.gguf": true,
        "/models/alpha-dflash.gguf": true,
        "/models/alpha-mtp.gguf": true,
        "/models/alpha-mmproj.gguf": true
    };
    const infos = {
        "/models/alpha.gguf": classified("/models/alpha.gguf"),
        "/models/alpha-dflash.gguf": classified("/models/alpha-dflash.gguf", {
            kind: "draft", arch: "dflash", name: "Alpha DFlash", blockCount: null,
            targetLayers: [2, 10], specType: "draft-dflash"
        }),
        "/models/alpha-mtp.gguf": classified("/models/alpha-mtp.gguf", {
            kind: "mtp-head", arch: "qwen2", name: "Qwen MTP", specType: "draft-mtp"
        }),
        "/models/alpha-mmproj.gguf": classified("/models/alpha-mmproj.gguf", {
            kind: "projector", arch: "clip", name: "Alpha vision", embeddingLength: null, blockCount: null
        })
    };
    const entries = ConsoleApp.listModels({ modelsDir: "/models", fs: modelFs(files), readInfo: reader(infos) });
    assert.deepStrictEqual(entries.map((e) => e.id), ["alpha.gguf"]);
    // The hidden files are still detected and attached to the served model.
    assert.strictEqual(entries[0].draftPath, "/models/alpha-dflash.gguf");
    assert.strictEqual(entries[0].mmprojPath, "/models/alpha-mmproj.gguf");
});

test("a console start applies a model's profile: specMode off emits no spec keys", () => {
    const files = {
        "/models": true,
        "/models/alpha.gguf": true,
        "/models/alpha-dflash.gguf": true
    };
    const infos = {
        "/models/alpha.gguf": classified("/models/alpha.gguf"),
        "/models/alpha-dflash.gguf": classified("/models/alpha-dflash.gguf", {
            kind: "draft", arch: "dflash", name: "Alpha DFlash", blockCount: null,
            targetLayers: [2, 10], specType: "draft-dflash"
        })
    };
    const cfg = ConsoleApp.startConfigFor({
        settings: { modelId: "alpha.gguf", profiles: { "alpha.gguf": { specMode: "off" } } },
        modelsDir: "/models", fs: modelFs(files), readInfo: reader(infos),
        templatesDir: null, defaultPort: 1234
    });
    assert.strictEqual("specType" in cfg.tunedTarget, false);
    assert.strictEqual("draftPath" in cfg.tunedTarget, false);
    // The child's real argv is built by ModelArgs (the front-door path); specMode "off" must
    // emit no speculation arguments at all, so the served instance has none.
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    for (const flag of ["--model-draft", "--spec-type", "--spec-draft-n-max", "--spec-draft-n-min"]) {
        assert.strictEqual(args.indexOf(flag), -1, "specMode off must not emit " + flag);
    }
});

test("a console start resolves a forced draftId's spec type through the computed associations", () => {
    const files = { "/models": true, "/models/alpha.gguf": true, "/models/odd-draft.gguf": true };
    const infos = {
        "/models/alpha.gguf": classified("/models/alpha.gguf"),
        // This draft's embedding length differs, so content detection cannot pair it with the
        // model; a forced draftId must still resolve its spec type from the associations the
        // console computes itself.
        "/models/odd-draft.gguf": classified("/models/odd-draft.gguf", {
            kind: "draft", arch: "dflash", name: "Odd", embeddingLength: 2048, blockCount: null,
            targetLayers: [2, 10], specType: "draft-dspark"
        })
    };
    const cfg = ConsoleApp.startConfigFor({
        settings: {
            modelId: "alpha.gguf",
            profiles: { "alpha.gguf": { draftId: "odd-draft.gguf", draftMax: 5, draftMin: 2 } }
        },
        modelsDir: "/models", fs: modelFs(files), readInfo: reader(infos),
        templatesDir: null, defaultPort: 1234
    });
    assert.strictEqual(cfg.tunedTarget.specType, "draft-dspark");
    assert.strictEqual(cfg.tunedTarget.draftPath, path.join("/models", "odd-draft.gguf"));
    assert.strictEqual(cfg.tunedTarget.specDraftNMax, 5);
    assert.strictEqual(cfg.tunedTarget.specDraftNMin, 2);
    // The forced draft really reaches the child's argv (the contrast that proves the
    // specMode-"off" assertion above is not vacuous).
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--model-draft") + 1], path.join("/models", "odd-draft.gguf"));
    assert.strictEqual(args[args.indexOf("--spec-type") + 1], "draft-dspark");
    assert.strictEqual(args[args.indexOf("--spec-draft-n-max") + 1], "5");
    assert.strictEqual(args[args.indexOf("--spec-draft-n-min") + 1], "2");
});
