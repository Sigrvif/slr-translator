// www/core/llmRuntime/tests/realServer.test.js
//
// Contract test against the REAL pinned llama-server payload. It is skipped unless
// LLMRUNTIME_REAL_SERVER points at an extracted payload directory (the folder that
// contains llama-server plus its shared libraries), e.g.:
//
//   LLMRUNTIME_REAL_SERVER=/tmp/payload node --test .../realServer.test.js
//
// It exercises the exact argument shape the runtime produces for a model's own server, which
// is the guard that catches a server rejecting a generated argument such as --slot-save-path
// (missing directory).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const Ports = require("../lib/Ports");
const ModelArgs = require("../lib/ModelArgs");
const ModelRegistry = require("../lib/ModelRegistry");
const RuntimeInfo = require("../lib/RuntimeInfo");
const FrontDoor = require("../lib/FrontDoor");

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function healthOk(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}

function getJson(port, requestPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: requestPath, timeout: 10000 }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let parsed;
                try { parsed = JSON.parse(text); }
                catch (err) {
                    reject(new Error(`non-JSON response from ${requestPath}: ${text.slice(0, 200)}`));
                    return;
                }
                if (parsed === null || typeof parsed !== "object") {
                    reject(new Error(`unexpected JSON from ${requestPath}: ${text.slice(0, 200)}`));
                    return;
                }
                resolve(parsed);
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout reading " + requestPath)); });
    });
}

function killTree(child) {
    return new Promise((resolve) => {
        const pid = child.pid;
        if (!pid) return resolve();
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        child.once("exit", finish);
        try { process.kill(-pid, "SIGTERM"); } catch (err) { finish(); return; }
        const timer = setTimeout(() => {
            try { process.kill(-pid, "SIGKILL"); } catch (err) { /* already gone */ }
            finish();
        }, 8000);
        if (typeof timer.unref === "function") timer.unref();
    });
}

// ---------------------------------------------------------------------------
// Task 7 (per-model server, real integration): prove a model's own settings
// actually reach its own llama-server child, and that the front door passes
// that model through unchanged. This is the defect the architecture fixes: the
// old shared-router path could not apply a model's context size at all, so
// clients saw 4096/4069 instead of the configured value. Both tests are
// guarded like the ones above: absent engine or user models -> log why and
// return, so the suite stays green on machines without them. The models live
// in data/llama/models and are never touched or copied.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function firstExisting(candidates) {
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function findPinnedServer() {
    const candidates = [];
    if (process.env.LLMRUNTIME_REAL_SERVER) candidates.push(path.join(process.env.LLMRUNTIME_REAL_SERVER, "llama-server"));
    // Only the binary for the current platform: the other copy of the repo ships the
    // other platform's payload, and a present-but-unrunnable file must not fail the suite.
    const base = path.join(REPO_ROOT, "runtime", "b10964");
    if (process.platform === "win32") {
        candidates.push(path.join(base, "win-x64", "llama-server.exe"));
    } else if (process.platform === "darwin") {
        candidates.push(path.join(base, "osx-arm64", "llama-server"));
        candidates.push(path.join(base, "osx-x64", "llama-server"));
    } else {
        candidates.push(path.join(base, "linux-x64", "llama-server"));
    }
    const found = firstExisting(candidates);
    if (!found || process.platform === "win32") return found;
    try { fs.accessSync(found, fs.constants.X_OK); return found; }
    catch (err) { return null; }
}

function findRealModelEntry() {
    const modelsDir = path.join(REPO_ROOT, "data", "llama", "models");
    if (!fs.existsSync(modelsDir)) return null;
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: modelsDir,
        registryPath: path.join(REPO_ROOT, "data", "llama", "drafts.json"),
        fs: fs,
        onError: (err) => console.log("real-model scan warning: " + err.message)
    });
    if (!entries.length) return null;
    // buildModelEntries returns selectable targets sorted by id (drafts, MTP
    // heads and projectors are already excluded). Use the first one and strip
    // the optional pairing so only this one model is loaded.
    const base = entries[0];
    return { id: base.id, modelPath: base.modelPath, arch: base.arch, contextSize: 8192, gpuLayers: 0 };
}

test("a real model's own llama-server /props reports the configured context (8192)", async () => {
    const serverBinary = findPinnedServer();
    if (!serverBinary) {
        console.log("skip real /props test: pinned llama-server payload not found");
        return;
    }
    const entry = findRealModelEntry();
    if (!entry) {
        console.log("skip real /props test: no selectable model in " + path.join(REPO_ROOT, "data", "llama", "models"));
        return;
    }
    const serverDir = path.dirname(serverBinary);
    const port = await Ports.findFreePort({ start: 18100, end: 18999, host: "127.0.0.1" });
    // The server-level globals the old router test used to exercise alongside the preset: they
    // are now emitted onto the model's own child, so the real engine is still proven to accept
    // the full generated argument list (a missing --slot-save-path directory used to exit 1).
    const slotsDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmruntime-real-slots-"));
    fs.mkdirSync(slotsDir, { recursive: true });
    const args = ModelArgs.buildModelArgs(entry, {
        host: "127.0.0.1", port,
        cacheRamMiB: 1024, cacheReuseChunk: 256, ctxCheckpoints: 16,
        slotSavePath: slotsDir, threads: 4
    });

    const child = spawn(serverBinary, args, {
        cwd: serverDir,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    if (child.stdout) child.stdout.on("data", () => {});
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d.toString(); });
    let exited = false;
    child.on("exit", () => { exited = true; });

    try {
        const deadline = Date.now() + 120000;
        let healthy = false;
        while (Date.now() < deadline) {
            if (exited) assert.fail(`llama-server exited early.\nargs: ${args.join(" ")}\nstderr:\n${stderr}`);
            if (await healthOk(port)) { healthy = true; break; }
            await delay(500);
        }
        assert.ok(healthy, `llama-server did not report healthy within 120s.\nargs: ${args.join(" ")}\nstderr:\n${stderr}`);

        // The instance's own answer. Under the old router this was 0/4096, never the model's context.
        const props = await getJson(port, "/props");
        assert.strictEqual(props.default_generation_settings.n_ctx, 8192,
            `expected the model server to report its configured context\nargs: ${args.join(" ")}`);
        console.log(`[task7] engine /props for ${entry.id}: default_generation_settings.n_ctx = ${props.default_generation_settings.n_ctx}`);
    } finally {
        try { await killTree(child); } catch (err) { console.log("real /props test cleanup: " + err.message); }
    }
});

test("the front door streams a real model's completion and reports its real context (8192)", async () => {
    const serverBinary = findPinnedServer();
    if (!serverBinary) {
        console.log("skip front-door real test: pinned llama-server payload not found");
        return;
    }
    const entry = findRealModelEntry();
    if (!entry) {
        console.log("skip front-door real test: no selectable model in " + path.join(REPO_ROOT, "data", "llama", "models"));
        return;
    }
    const serverDir = path.dirname(serverBinary);
    const childPort = await Ports.findFreePort({ start: 18100, end: 18999, host: "127.0.0.1" });
    const args = ModelArgs.buildModelArgs(entry, { host: "127.0.0.1", port: childPort });

    const child = spawn(serverBinary, args, {
        cwd: serverDir,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    if (child.stdout) child.stdout.on("data", () => {});
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d.toString(); });
    let exited = false;
    child.on("exit", () => { exited = true; });

    let door = null;
    try {
        const deadline = Date.now() + 120000;
        let healthy = false;
        while (Date.now() < deadline) {
            if (exited) assert.fail(`llama-server exited early.\nargs: ${args.join(" ")}\nstderr:\n${stderr}`);
            if (await healthOk(childPort)) { healthy = true; break; }
            await delay(500);
        }
        assert.ok(healthy, `llama-server did not report healthy within 120s.\nargs: ${args.join(" ")}\nstderr:\n${stderr}`);

        const globals = { host: "127.0.0.1" };
        door = FrontDoor.createFrontDoor({
            host: "127.0.0.1",
            port: 0,
            getModels: () => [entry.id],
            ensureModel: async () => ({ port: childPort }),
            loadedPort: () => childPort,
            defaultId: () => entry.id,
            getProps: () => RuntimeInfo.buildProps(entry, globals),
            getModelsList: () => RuntimeInfo.buildModelsList([entry], [entry.id])
        });
        const addr = await door.start();

        // (a) A streaming completion through the front door. The chunks must
        // arrive as separate data events spread over time, not one buffered body.
        const times = [];
        let endedAt = 0;
        const payload = JSON.stringify({
            model: entry.id,
            stream: true,
            max_tokens: 32,
            messages: [{ role: "user", content: "Count from one to twenty in words." }]
        });
        const body = await new Promise((resolve, reject) => {
            const req = http.request({
                host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
                headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            }, (res) => {
                const chunks = [];
                res.on("data", (b) => { times.push(Date.now()); chunks.push(b); });
                res.on("end", () => { endedAt = Date.now(); resolve(Buffer.concat(chunks).toString("utf8")); });
                res.on("error", reject);
            });
            // A hung generation must not leave this promise pending forever, or the
            // finally below would never run and the detached child would leak.
            req.setTimeout(30000, () => req.destroy(new Error("stream timeout")));
            req.on("error", reject);
            req.end(payload);
        });
        assert.ok(times.length >= 2, `expected the SSE response in more than one data event, got ${times.length}`);
        const span = endedAt - times[0];
        assert.ok(span >= 50, `expected the SSE response spread over time, not one buffered body (span ${span} ms)`);
        assert.match(body, /data: /);
        assert.match(body, /\[DONE\]/);

        // (b) The front door reports the model's real context, from its own entry.
        const doorProps = await getJson(addr.port, "/props");
        assert.strictEqual(doorProps.default_generation_settings.n_ctx, 8192,
            "the front door must report the model's configured context");
        const modelList = await getJson(addr.port, "/v1/models");
        assert.strictEqual(modelList.data[0].meta.n_ctx, 8192);
        console.log(`[task7] front door for ${entry.id}: /props n_ctx = ${doorProps.default_generation_settings.n_ctx}, ` +
            `/v1/models meta.n_ctx = ${modelList.data[0].meta.n_ctx}, streaming events = ${times.length}, span = ${span} ms`);
    } finally {
        // Kill the child first and isolate each cleanup: a rejecting door.stop()
        // must never skip the child kill (which would leave llama-server running).
        try { await killTree(child); } catch (err) { console.log("front-door real test cleanup: " + err.message); }
        if (door) { try { await door.stop(); } catch (err) { console.log("front-door real test cleanup: " + err.message); } }
    }
});
