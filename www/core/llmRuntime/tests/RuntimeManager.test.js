// www/core/llmRuntime/tests/RuntimeManager.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { RuntimeManager, buildSpawnEnv, argValue } = require("../lib/RuntimeManager");
const Ports = require("../lib/Ports");

// The front door is a real HTTP server on a real loopback port, so the public-port assertions
// exercise the actual serving layer. Model children are fakes (they record their argv and stop
// state) because a per-model llama-server load is not what this unit file tests.
function freePort() {
    return Ports.findFreePort({ start: 22000, end: 22999, host: "127.0.0.1" });
}

function request(port, method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const headers = payload ? { "content-type": "application/json", "content-length": payload.length } : {};
        const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, agent: false }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.setTimeout(10000, () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        if (payload) req.end(payload); else req.end();
    });
}

async function getJson(port, urlPath) {
    const res = await request(port, "GET", urlPath);
    let parsed = null;
    try { parsed = JSON.parse(res.text); } catch (err) { /* leave null */ }
    return { status: res.status, body: parsed };
}

function makeDeps(overrides) {
    const events = [];
    const written = [];
    const servers = [];
    const deps = {
        resolvePayload: () => ({
            dir: "/llama/linux-x64",
            serverBinary: "/llama/linux-x64/llama-server",
            manifest: { version: "b10964", platforms: { "linux-x64": { backends: ["cpu", "vulkan"], files: {} } } }
        }),
        verifyPayload: () => [],
        listDevices: async () => "  Vulkan0: AMD Radeon RX 7900 XTX (24576 MiB, 24576 MiB free)\n",
        // An explicit preferred port is honoured exactly (the front door binds it); otherwise a
        // real free loopback port in the 22000-22999 range is returned.
        findFreePort: (opts) => freePort(),
        writeFile: async (p, text) => { written.push({ p, text }); },
        createServer: (opts) => {
            let resolveExit = null;
            const idx = servers.length;
            const server = {
                opts: opts, started: false, stopped: false,
                // Mirrors ServerProcess: alive until stopped. The health wait checks this to
                // tell "still loading" from "the child died", so the fake must carry it.
                running: true,
                // A real ServerProcess exposes its ChildProcess and an exitPromise; the fake does
                // too so the compatibility handle and the exit wiring are exercised.
                child: { pid: 5000 + servers.length },
                exitPromise: new Promise((r) => { resolveExit = r; }),
                // Distinguishable per-child placement numbers, so a test can tell which child
                // the compatibility handle's modelBuffers describes.
                modelBuffers: { gpuMiB: 1000 + idx, cpuMiB: 0, found: true },
                _exit(result) { resolveExit(result || { code: 0, signal: null }); },
                // A real ServerProcess pushes its log lines through opts.onLog; the fake does too
                // so the stderr-tail capture is exercised.
                emitLog(stream, text) { if (opts && typeof opts.onLog === "function") opts.onLog(stream, text); },
                start() { this.started = true; },
                async stop(stopOpts) { this.stopped = true; this.stopOpts = stopOpts; this.running = false; }
            };
            servers.push(server);
            return server;
        },
        createRouter: () => ({ async listModels() { return []; } }),
        waitForHealth: async () => ({ status: 200 }),
        onStatus: (s) => { events.push(s.status); },
        // port 0 means "no explicit port": the findFreePort seam above allocates a real one.
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0 }
    };
    const merged = Object.assign(deps, overrides || {});
    merged._servers = servers;
    merged._events = events;
    merged._written = written;
    return merged;
}

function argOf(server, flag) {
    const args = server.opts.args;
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
}

test("argValue reads a flag's value from an argument list", () => {
    assert.strictEqual(argValue(["--host", "127.0.0.1", "--port", "9000"], "--port"), "9000");
    assert.strictEqual(argValue(["--port"], "--port"), null);
    assert.strictEqual(argValue([], "--port"), null);
});

test("start selects a backend, starts the front door and preloads the selected model", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "qwen3-4b-q4_k_m.gguf", contextSize: 8192 }]);
    try {
        assert.strictEqual(state.status, "ready");
        assert.strictEqual(state.backend, "vulkan");
        assert.strictEqual(state.device, "Vulkan0");
        assert.strictEqual(state.frontDoor, true);
        assert.match(state.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.deepStrictEqual(state.models, ["qwen3-4b-q4_k_m.gguf"]);
        assert.deepStrictEqual(state.loadedModels, ["qwen3-4b-q4_k_m.gguf"]);
        assert.deepStrictEqual(deps._events, ["starting", "ready"]);
        // The router/preset path is gone: nothing is written to disk.
        assert.strictEqual(deps._written.length, 0);
        // The selected model was started as a real child, with its own context and the selected
        // device and the server-level args the old router used to receive.
        assert.strictEqual(deps._servers.length, 1);
        assert.strictEqual(argOf(deps._servers[0], "--alias"), "qwen3-4b-q4_k_m.gguf");
        assert.strictEqual(argOf(deps._servers[0], "-c"), "8192");
        assert.strictEqual(argOf(deps._servers[0], "--device"), "Vulkan0");
        assert.strictEqual(argOf(deps._servers[0], "--flash-attn"), "on");
        assert.strictEqual(argOf(deps._servers[0], "--cache-reuse"), "256");
        // Why this backend was chosen, so a "Backend: cpu" on a GPU machine is explainable.
        assert.strictEqual(state.backendReason, "device-available:vulkan");
        // Pin today's shipped KV defaults so a later task exposing them cannot silently change
        // behaviour while only the config override (below) is proven to reach the child.
        assert.strictEqual(argOf(deps._servers[0], "--cache-ram"), "4096");
        assert.strictEqual(argOf(deps._servers[0], "--ctx-checkpoints"), "16");
        assert.ok(deps._servers[0].opts.args.includes("--cache-prompt"));
        assert.ok(deps._servers[0].opts.args.includes("--cache-idle-slots"));
        assert.ok(deps._servers[0].started === true);
        // The compatibility handle reports the loaded child (so the console records its pid).
        assert.ok(manager.server, "manager.server must be published");
        assert.strictEqual(manager.server.child.pid, deps._servers[0].child.pid);
        // The public port answers.
        const health = await getJson(state.port, "/health");
        assert.deepStrictEqual(health.body, { status: "ok" });
        const list = await getJson(state.port, "/v1/models");
        assert.deepStrictEqual(list.body.data.map((m) => m.id), ["qwen3-4b-q4_k_m.gguf"]);
        assert.strictEqual(list.body.data[0].status.value, "loaded");
        assert.strictEqual(list.body.data[0].meta.n_ctx, 8192);
    } finally {
        await manager.stop();
    }
});

// A large model read from a cold disk can take minutes to become healthy: the engine's fit
// alone runs for seconds, then every tensor is read. The old single-shot health wait failed
// such a start at 120 s, and the caller's GPU->CPU retry then downgraded it ("Backend: cpu"
// on machines with a working GPU) - while the engine, left without a --device, went on using
// the GPU anyway. The health wait must keep waiting for as long as the child is alive.
test("a child that is still loading past the health timeout is waited out, not failed", async () => {
    let calls = 0;
    const deps = makeDeps({
        waitForHealth: async () => {
            calls++;
            if (calls === 1) {
                throw new Error("llama-server did not become healthy within 120000 ms (last: ...)");
            }
            return { status: 200 };
        }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "qwen3-4b-q4_k_m.gguf", contextSize: 8192 }]);
    try {
        assert.strictEqual(state.status, "ready");
        assert.strictEqual(state.backend, "vulkan");
        assert.strictEqual(calls, 2, "waited a second chunk instead of failing at the first");
    } finally {
        await manager.stop();
    }
});

test("a status note survives until the next start clears it", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    manager.setNote("GPU backend failed (test); running on CPU.");
    assert.strictEqual(manager.status.note, "GPU backend failed (test); running on CPU.");
    const state = await manager.start([{ id: "qwen3-4b-q4_k_m.gguf", contextSize: 8192 }]);
    try {
        assert.strictEqual(manager.status.note, null, "a new start must clear the previous note");
    } finally {
        await manager.stop();
    }
});

test("start fails when the payload checksum check fails", async () => {
    const deps = makeDeps({ verifyPayload: () => ["llama-server"] });
    const manager = new RuntimeManager(deps);
    await assert.rejects(() => manager.start([]), /Runtime payload is corrupted: llama-server/);
    assert.strictEqual(manager.status.status, "error");
    assert.match(manager.status.error, /corrupted/);
});

test("start stops the front door and the child when a model never becomes healthy", async () => {
    // A child that is alive but never healthy is waited out (see the waited-out test); the
    // injectable cap makes that wait observable here. The failure must still tear everything
    // down and leave the runtime in the error state.
    const deps = makeDeps({
        waitForHealth: async () => { throw new Error("health timeout"); },
        healthHardCapMs: 30
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        /did not become healthy/
    );
    assert.strictEqual(manager.status.status, "error");
    assert.strictEqual(manager.frontDoor, null);
    assert.strictEqual(deps._servers[0].stopped, true);
});

test("start falls back to CPU when no GPU device is present", async () => {
    const deps = makeDeps({ listDevices: async () => "  CPU: Ryzen (131072 MiB, 131072 MiB free)\n" });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(state.backend, "cpu");
        assert.strictEqual(state.device, null);
        // The child reached the CPU path with no device flag.
        assert.ok(!deps._servers[0].opts.args.includes("--device"));
    } finally {
        await manager.stop();
    }
});

test("start with forceCpu ignores GPU devices and sends no device flag", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }], { forceCpu: true });
    try {
        assert.strictEqual(state.backend, "cpu");
        assert.strictEqual(state.device, null);
        assert.ok(!deps._servers[0].opts.args.includes("--device"));
        // Forced CPU is a user choice, not a detection failure: the status line must not show
        // the "no GPU detected" hint for it.
        assert.strictEqual(state.backendReason, "cpu-forced");
    } finally {
        await manager.stop();
    }
});

test("a backendPreference whose pack is not installed fails the start instead of falling back", async () => {
    // The reported silent fallback: rocm picked, only the base runtime installed, and the start
    // came up on Vulkan anyway. Strict mode must end the start with the reason instead.
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message, /The selected backend \(rocm\) is not installed/);
            assert.match(err.message, /installed: cpu, vulkan/);
            assert.match(err.message, /or set the local runtime backend back to auto/);
            return true;
        }
    );
    assert.strictEqual(manager.status.status, "error");
    assert.match(manager.status.error, /not installed/);
    // Nothing was started: no child, no fallback backend in the error state.
    assert.strictEqual(deps._servers.length, 0);
    assert.strictEqual(manager.status.backend, null);
});

test("an installed backendPreference with no matching device fails with the detected devices", async () => {
    const deps = makeDeps({
        resolvePayload: () => ({
            dir: "/llama/linux-x64",
            serverBinary: "/llama/linux-x64/llama-server",
            manifest: { version: "b10964", platforms: { "linux-x64": { backends: ["cpu", "vulkan", "rocm"], files: {} } } }
        }),
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message, /installed, but no matching device was found/);
            // The message names what the probe DID see, so a pasted report is diagnosable.
            assert.match(err.message, /Vulkan0 AMD Radeon RX 7900 XTX/);
            return true;
        }
    );
    assert.strictEqual(manager.status.status, "error");
});

test("a refused installed backend surfaces the probe's stderr and the ROCm pack generation", async () => {
    // The field report: HIP SDK installed, ROCm pack installed, yet the probe lists only the
    // Vulkan device because the HIP backend DLL failed to load. The error must carry the
    // probe's own stderr (it names the missing library) and, for a HIP 7 pack, say that this
    // generation cannot work on Windows 10 at all.
    const deps = makeDeps({
        listDevices: async () => ({
            stdout: "  Vulkan0: AMD Radeon RX 7900 XT (20468 MiB, 20468 MiB free)\n",
            stderr: "ggml_backend_load_best: failed to load ggml-hip.dll - The specified module could not be found."
        }),
        resolvePayload: () => ({
            dir: "/llama/linux-x64",
            serverBinary: "/llama/linux-x64/llama-server",
            manifest: { version: "b10964", platforms: { "linux-x64": { backends: ["cpu", "vulkan", "rocm"], files: {} } } },
            packs: { backends: ["rocm"], files: { "ggml-hip.dll": "x", "amdhip64_7.dll": "y" } }
        }),
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message, /no matching device was found/);
            assert.match(err.message, /failed to load ggml-hip\.dll/);
            assert.match(err.message, /HIP SDK 7\.x, which AMD ships\s+for Windows 11 only/);
            assert.match(err.message, /ROCm 6 pack/);
            return true;
        }
    );
});

test("a HIP 6 pack gets the SDK-bin-folder hint instead of the Windows 11 one", async () => {
    const deps = makeDeps({
        listDevices: async () => ({
            stdout: "  Vulkan0: AMD Radeon RX 7900 XT (20468 MiB, 20468 MiB free)\n",
            stderr: ""
        }),
        resolvePayload: () => ({
            dir: "/llama/linux-x64",
            serverBinary: "/llama/linux-x64/llama-server",
            manifest: { version: "b10964", platforms: { "linux-x64": { backends: ["cpu", "vulkan", "rocm"], files: {} } } },
            packs: { backends: ["rocm"], files: { "ggml-hip.dll": "x", "amdhip64_6.dll": "y" } }
        }),
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message, /HIP SDK 6\.4\.2\. Its bin folder/);
            assert.match(err.message, /extra library folder/);
            assert.ok(!/Windows 11 only/.test(err.message));
            return true;
        }
    );
});

test("a not-installed refusal stays short: no probe stderr, no generation hint", async () => {
    const deps = makeDeps({
        listDevices: async () => ({
            stdout: "  Vulkan0: AMD Radeon RX 7900 XT (20468 MiB, 20468 MiB free)\n",
            stderr: "probe banner noise"
        }),
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message, /is not installed in this runtime/);
            assert.ok(!/probe banner noise/.test(err.message), "stderr is noise for a not-installed refusal");
            assert.ok(!/HIP SDK 7\.x/.test(err.message), "no pack is installed, so no generation hint");
            return true;
        }
    );
});

test("the probe's stderr is logged when no device parses, and auto mode still falls back", async () => {
    const logged = [];
    const deps = makeDeps({
        listDevices: async () => ({
            stdout: "banner only, no device lines\n",
            stderr: "ggml_backend_load: failed to load ggml-vulkan.so"
        }),
        log: (msg) => logged.push(msg)
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(state.backend, "cpu");
        assert.ok(logged.some((m) => m.indexOf("the device probe reported on stderr:") !== -1 &&
            m.indexOf("failed to load ggml-vulkan") !== -1),
            "the probe's stderr must reach the diagnostic log");
    } finally {
        await manager.stop();
    }
});

// --- The standard HIP SDK location auto-probe ----------------------------------------------
//
// The Windows HIP SDK never adds its bin folder to the PATH, so a correctly installed ROCm
// pack finds no device when the app's own process lacks the folder. The manager probes the
// standard install location once and adopts it for the probe AND the server children.

const HIPSDK_BIN = "C:\\Program Files\\AMD\\ROCm\\6.4\\bin";

// Reads the library entry the spawn env carries, whatever the faked platform spelled it.
function envLibEntry(env) {
    const key = Object.keys(env).find((k) =>
        k.toLowerCase() === "path" || k.toLowerCase() === "ld_library_path");
    return key ? [key, env[key]] : null;
}

function rocmPackDeps(overrides) {
    return makeDeps(Object.assign({
        resolvePayload: () => ({
            dir: "/llama/win-x64",
            serverBinary: "/llama/win-x64/llama-server.exe",
            manifest: { version: "b11429", platforms: { "win-x64": { backends: ["cpu", "vulkan", "rocm"], files: {} } } },
            packs: { backends: ["rocm"], files: { "ggml-hip.dll": "x", "amdhip64_6.dll": "y" } }
        }),
        config: { platformKey: "win-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" },
        platform: "win32"
    }, overrides || {}));
}

const VULKAN_ONLY = {
    stdout: "  Vulkan0: AMD Radeon RX 7900 XT (20468 MiB, 20468 MiB free)\n",
    stderr: "ggml_backend_load_best: failed to load ggml-hip.dll - The specified module could not be found."
};
const ROCM_AND_VULKAN = {
    stdout: "  ROCm0: AMD Radeon RX 7900 XT (20464 MiB, 20305 MiB free)\n" +
        "  Vulkan0: AMD Radeon RX 7900 XT (20464 MiB, 19652 MiB free)\n",
    stderr: ""
};

test("the standard HIP SDK location is probed and adopted when the ROCm pack finds no device", async () => {
    const probes = [];
    let probeGeneration = null;
    const logged = [];
    const deps = rocmPackDeps({
        listDevices: async (binary, env) => {
            probes.push(env || null);
            return probes.length === 1 ? VULKAN_ONLY : ROCM_AND_VULKAN;
        },
        standardLibDirs: (probeOpts) => {
            probeGeneration = probeOpts && probeOpts.packGeneration;
            return [HIPSDK_BIN];
        },
        log: (msg) => logged.push(msg)
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(state.backend, "rocm");
        assert.strictEqual(state.device, "ROCm0");
        assert.strictEqual(probes.length, 2, "the probe ran twice: plain, then with the adopted SDK folder");
        assert.strictEqual(probes[0], null, "without a libDir the first probe inherits the process env");
        // The retry probe and the spawned child both run with the adopted folder.
        const retryEntry = envLibEntry(probes[1]);
        assert.ok(retryEntry && retryEntry[1].indexOf(HIPSDK_BIN) === 0,
            "the retry probe must run with the adopted folder in its library path");
        const childEntry = envLibEntry(deps._servers[0].opts.env);
        assert.ok(childEntry && childEntry[1].indexOf(HIPSDK_BIN) === 0,
            "the server child must inherit the adopted folder too");
        assert.strictEqual(probeGeneration, 6, "the pack's HIP generation steers the SDK choice");
        assert.ok(logged.some((m) => m.indexOf("retrying the device probe with the HIP SDK found at " + HIPSDK_BIN) !== -1),
            "the adoption must be logged");
    } finally {
        await manager.stop();
    }
});

test("auto mode upgrades to the ROCm device when the standard-location probe finds one", async () => {
    const deps = rocmPackDeps({
        config: { platformKey: "win-x64", modelsDir: "/models", port: 0 },
        listDevices: async (binary, env) => (env ? ROCM_AND_VULKAN : VULKAN_ONLY),
        standardLibDirs: () => [HIPSDK_BIN]
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        // ROCm outranks Vulkan in the automatic priority order, so the adopted SDK wins.
        assert.strictEqual(state.backend, "rocm");
        assert.strictEqual(state.backendReason, "device-available:rocm");
    } finally {
        await manager.stop();
    }
});

test("a user-set extra library folder is never second-guessed by the standard-location probe", async () => {
    const probes = [];
    let probedStandard = false;
    const deps = rocmPackDeps({
        config: { platformKey: "win-x64", modelsDir: "/models", port: 0, backendPreference: "rocm", libDir: "C:\\rocm\\custom\\bin" },
        listDevices: async (binary, env) => {
            probes.push(env || null);
            return VULKAN_ONLY; // the custom folder does not help in this scenario
        },
        standardLibDirs: () => { probedStandard = true; return [HIPSDK_BIN]; }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(() => manager.start([{ id: "m.gguf", contextSize: 4096 }]), /no matching device was found/);
    assert.strictEqual(probes.length, 1, "no retry probe behind a user-set folder");
    const entry = envLibEntry(probes[0]);
    assert.ok(entry && entry[1].indexOf("C:\\rocm\\custom\\bin") === 0,
        "the probe must run with the user's folder, not a discovered one");
    assert.strictEqual(probedStandard, false, "the user's folder wins; no standard-location probe");
});

test("a fruitless standard-location probe is named in the strict error", async () => {
    const deps = rocmPackDeps({
        listDevices: async () => VULKAN_ONLY,
        standardLibDirs: () => [HIPSDK_BIN]
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "m.gguf", contextSize: 4096 }]),
        (err) => {
            assert.match(err.message,
                /The HIP SDK found at C:\\Program Files\\AMD\\ROCm\\6\.4\\bin was probed as well/);
            assert.match(err.message, /still produced no ROCm device/);
            return true;
        }
    );
});

test("the device probe runs with the extra library folder's environment", async () => {
    // The pre-existing bug this rides on: the probe never saw the configured folder, so even
    // a correctly set extra library folder stayed invisible to backend selection.
    const probes = [];
    let probedStandard = false;
    const deps = rocmPackDeps({
        config: { platformKey: "win-x64", modelsDir: "/models", port: 0, backendPreference: "rocm", libDir: HIPSDK_BIN },
        listDevices: async (binary, env) => {
            probes.push(env || null);
            return env ? ROCM_AND_VULKAN : VULKAN_ONLY;
        },
        standardLibDirs: () => { probedStandard = true; return []; }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(state.backend, "rocm");
        assert.strictEqual(probes.length, 1, "with the folder configured, one probe suffices");
        const entry = envLibEntry(probes[0]);
        assert.ok(entry && entry[1].indexOf(HIPSDK_BIN) === 0,
            "the first probe must already run with the configured folder");
        assert.strictEqual(probedStandard, false);
    } finally {
        await manager.stop();
    }
});

test("no standard-location probe when ROCm is already visible, not installed, or the CPU is forced", async () => {
    let probedStandard = false;
    const neverProbe = () => { probedStandard = true; return [HIPSDK_BIN]; };

    // A ROCm device on the first probe: nothing to heal.
    const visible = rocmPackDeps({
        listDevices: async () => ROCM_AND_VULKAN,
        standardLibDirs: neverProbe
    });
    const managerA = new RuntimeManager(visible);
    const stateA = await managerA.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(stateA.backend, "rocm");
    } finally { await managerA.stop(); }

    // No ROCm pack installed: a probed SDK could not change anything.
    const unpacked = rocmPackDeps({
        resolvePayload: () => ({
            dir: "/llama/win-x64",
            serverBinary: "/llama/win-x64/llama-server.exe",
            manifest: { version: "b11429", platforms: { "win-x64": { backends: ["cpu", "vulkan"], files: {} } } }
        }),
        config: { platformKey: "win-x64", modelsDir: "/models", port: 0, backendPreference: "rocm" },
        listDevices: async () => VULKAN_ONLY,
        standardLibDirs: neverProbe
    });
    const managerB = new RuntimeManager(unpacked);
    await assert.rejects(() => managerB.start([{ id: "m.gguf", contextSize: 4096 }]), /is not installed/);

    // A forced CPU has nothing for ROCm to win.
    const forced = rocmPackDeps({
        listDevices: async () => VULKAN_ONLY,
        standardLibDirs: neverProbe
    });
    const managerC = new RuntimeManager(forced);
    const stateC = await managerC.start([{ id: "m.gguf", contextSize: 4096 }], { forceCpu: true });
    try {
        assert.strictEqual(stateC.backend, "cpu");
    } finally { await managerC.stop(); }

    assert.strictEqual(probedStandard, false, "the standard location must stay unprobed in all three cases");
});

test("an available backendPreference is used exactly as picked", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "vulkan" }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(state.backend, "vulkan");
        assert.strictEqual(state.backendReason, "device-available:vulkan");
        assert.strictEqual(argOf(deps._servers[0], "--device"), "Vulkan0");
    } finally {
        await manager.stop();
    }
});

test("a start failure is logged, and a cancelled start is not", async () => {
    const logged = [];
    const deps = makeDeps({
        log: (msg) => logged.push(msg),
        waitForHealth: async () => { throw new Error("health timeout"); },
        healthHardCapMs: 30
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(() => manager.start([{ id: "m.gguf", contextSize: 4096 }]), /health timeout/);
    assert.ok(logged.some((m) => m.indexOf("start failed: ") !== -1 && m.indexOf("health timeout") !== -1),
        "the failure must reach the diagnostic log");
    // A deliberate stop mid-start cancels the start; that is not a failure and must not log one.
    // The start is waited on until it is parked at the port wait, stopped, and the held wait is
    // then released, exactly as a real settle would be.
    let releasePort = null;
    const quiet = makeDeps({
        log: (msg) => logged.push("quiet:" + msg),
        findFreePort: () => new Promise((r) => { releasePort = r; })
    });
    const manager2 = new RuntimeManager(quiet);
    const starting = manager2.start([{ id: "m.gguf", contextSize: 4096 }]).catch((err) => err);
    while (!releasePort) await new Promise((r) => setTimeout(r, 1));
    await manager2.stop();
    releasePort(22001);
    const outcome = await starting;
    assert.ok(outcome && outcome.cancelled, "the mid-start stop must cancel the start");
    assert.ok(!logged.some((m) => m.indexOf("quiet:start failed:") !== -1),
        "a cancelled start must not be logged as a failure");
});

test("a failed GPU attempt records the attempted backend in the error state", async () => {
    const deps = makeDeps({ waitForHealth: async () => { throw new Error("health timeout"); }, healthHardCapMs: 30 });
    const manager = new RuntimeManager(deps);
    await assert.rejects(() => manager.start([{ id: "m.gguf", contextSize: 4096 }]), /health timeout/);
    assert.strictEqual(manager.status.status, "error");
    assert.strictEqual(manager.status.backend, "vulkan");
});

test("stop stops the front door, every child, and releases the public port", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const started = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    const port = started.port;
    const state = await manager.stop();
    assert.strictEqual(state.status, "stopped");
    assert.strictEqual(state.baseUrl, null);
    assert.strictEqual(state.error, null);
    assert.strictEqual(state.frontDoor, false);
    assert.strictEqual(manager.client, null);
    assert.strictEqual(deps._servers[0].stopped, true);
    const health = await getJson(port, "/health").catch((err) => ({ status: "refused", error: err.message }));
    assert.strictEqual(health.status, "refused", "the public port must not answer after stop");
});

test("stop clears a stale error left by a failed start", async () => {
    const deps = makeDeps({ waitForHealth: async () => { throw new Error("health timeout"); }, healthHardCapMs: 30 });
    const manager = new RuntimeManager(deps);
    await assert.rejects(() => manager.start([{ id: "m.gguf", contextSize: 4096 }]), /health timeout/);
    assert.match(manager.status.error, /health timeout/);
    const state = await manager.stop();
    assert.strictEqual(state.status, "stopped");
    assert.strictEqual(state.error, null);
    assert.strictEqual(manager.status.error, null);
});

// Ownership must be explicit on every transition. Otherwise Object.assign's merge preserves
// attached/owner from a previous attach, so the editor's teardown guards skip a server the window
// genuinely owns (orphaning it) and the status line reports an owned runtime as attached.
test("start and stop report the runtime as owned by this window", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const started = await manager.start([]);
    assert.strictEqual(started.attached, false);
    assert.strictEqual(started.owner, null);
    const stopped = await manager.stop();
    assert.strictEqual(stopped.attached, false);
    assert.strictEqual(stopped.owner, null);
});

test("stop clears an attached state left by a previous attach", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    manager.state = Object.assign({}, manager.state, {
        status: "ready", attached: true, owner: "external",
        baseUrl: "http://127.0.0.1:1234", port: 1234, modelId: "m1"
    });
    const state = await manager.stop();
    assert.strictEqual(state.attached, false);
    assert.strictEqual(state.owner, null);
    assert.strictEqual(state.baseUrl, null);
    // An attached runtime owns nothing here, so no child was stopped.
    assert.strictEqual(deps._servers.length, 0);
});

test("an owned start clears an attached state instead of inheriting it", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    // The stale case the bug produced: status stopped but attached still true. The next owned
    // start must not report itself as attached.
    manager.state = Object.assign({}, manager.state, {
        status: "stopped", attached: true, owner: "external"
    });
    const state = await manager.start([]);
    assert.strictEqual(state.status, "ready");
    assert.strictEqual(state.attached, false);
    assert.strictEqual(state.owner, null);
    await manager.stop();
});

test("buildSpawnEnv prepends the extra library folder on Linux", () => {
    const env = buildSpawnEnv("/home/me/myrocm/lib", "linux", { LD_LIBRARY_PATH: "/usr/lib", PATH: "/usr/bin" });
    assert.strictEqual(env.LD_LIBRARY_PATH, "/home/me/myrocm/lib:/usr/lib");
    assert.strictEqual(env.PATH, "/usr/bin", "other variables must be preserved");
});

test("buildSpawnEnv sets LD_LIBRARY_PATH when there was none", () => {
    const env = buildSpawnEnv("/opt/rocm/lib", "linux", {});
    assert.strictEqual(env.LD_LIBRARY_PATH, "/opt/rocm/lib");
});

test("buildSpawnEnv uses Path on Windows and keeps the existing spelling", () => {
    const upper = buildSpawnEnv("C:\\rocm\\bin", "win32", { PATH: "C:\\Windows" });
    assert.strictEqual(upper.PATH, "C:\\rocm\\bin;C:\\Windows");
    assert.strictEqual(upper.Path, undefined, "must not create a second, differently-cased entry");

    const titled = buildSpawnEnv("C:\\rocm\\bin", "win32", { Path: "C:\\Windows" });
    assert.strictEqual(titled.Path, "C:\\rocm\\bin;C:\\Windows");
});

test("buildSpawnEnv returns null when no folder is configured", () => {
    for (const libDir of [null, undefined, ""]) {
        assert.strictEqual(buildSpawnEnv(libDir, "linux", {}), null, String(libDir));
    }
});

test("the manager hands the spawn environment to the child it creates", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, libDir: "/home/me/myrocm/lib" }
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    try {
        assert.ok(deps._servers[0].opts.env, "expected an env to be passed");
        assert.match(deps._servers[0].opts.env.LD_LIBRARY_PATH, /^\/home\/me\/myrocm\/lib/);
    } finally {
        await manager.stop();
    }
});

// The shipped defaults are deliberately conservative for a small GPU: one resident model, no
// idle unloading, and llama.cpp's own thread choice unless the user pins one.
test("default config keeps one model resident and never unloads it", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    assert.strictEqual(manager.config.modelsMax, 1);
    assert.strictEqual(manager.config.sleepIdleSeconds, 0);
    assert.strictEqual(manager.config.threads, 0);
    assert.strictEqual(manager.config.threadsBatch, 0);

    await manager.start([{ id: "qwen3-4b-q4_k_m.gguf", contextSize: 8192 }]);
    try {
        const args = deps._servers[0].opts.args;
        assert.ok(!args.includes("--threads"), "threads 0 must stay unset");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["qwen3-4b-q4_k_m.gguf"]);
    } finally {
        await manager.stop();
    }
});

test("KV settings reach every child's arguments", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0,
                  cacheRamMiB: 2048, ctxCheckpoints: 4, cacheReuseChunk: 128 }
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }]);
    try {
        const s = deps._servers[0];
        assert.strictEqual(argOf(s, "--cache-ram"), "2048");
        assert.strictEqual(argOf(s, "--ctx-checkpoints"), "4");
        assert.strictEqual(argOf(s, "--cache-reuse"), "128");
    } finally {
        await manager.stop();
    }
});

test("a pinned thread count reaches every child, and models kept loaded 2 keeps both", async () => {
    const deps = makeDeps({
        config: {
            platformKey: "linux-x64", modelsDir: "/models", port: 0,
            modelsMax: 2, threads: 8, threadsBatch: 8
        }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.strictEqual(argOf(deps._servers[0], "--threads"), "8");
        // --threads-batch defaults to --threads, so it is not duplicated.
        assert.ok(!deps._servers[0].opts.args.includes("--threads-batch"));
        // The second model is loaded on demand and keeps the pinned count; models kept loaded 2
        // means the first stays resident too (reach proven through the pool, not a config read).
        await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(argOf(deps._servers[1], "--threads"), "8");
        const loaded = manager.pool.loadedIds().slice().sort();
        assert.deepStrictEqual(loaded, ["a.gguf", "b.gguf"]);
    } finally {
        await manager.stop();
    }
});

// `unload after idle` is the front door's own policy (spec §3.3): the manager stops an idle
// child itself. It is never handed to a child as `--sleep-idle-seconds` - that was the retired
// router/preset path, which never actually applied it.
test("idle unload is our own policy and is never passed to the child", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 900 }
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(manager.config.sleepIdleSeconds, 900);
        assert.ok(!deps._servers[0].opts.args.includes("--sleep-idle-seconds"));
        // The policy is armed: a timer exists while a positive idle window is configured.
        assert.ok(manager._idleTimer != null, "idle unload must be scheduled");
    } finally {
        await manager.stop();
    }
    assert.strictEqual(manager._idleTimer, null, "teardown must clear the idle timer");
});

// With a positive idle window the last routed use of a loaded model is tracked and the child
// is stopped once it has been idle longer than configured; the next request loads it again.
// The injected clock keeps the assertions deterministic.
test("a loaded child is stopped after the idle period and restarted by a later request", async () => {
    let clock = 100000;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 5 },
        now: () => clock,
        // The child's own /slots reports it idle, so the sweep may stop it.
        createRouter: () => ({
            async listModels() { return []; },
            async slots() { return [{ id: 0, is_processing: false }]; }
        })
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);
        // Four seconds idle: still inside the window.
        clock += 4000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"], "not idle long enough yet");
        // Six seconds: past the five-second window.
        clock += 2000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), [], "the idle child must be stopped");
        assert.strictEqual(deps._servers[0].stopped, true);
        // A later request starts it again as a fresh child.
        const res = await request(state.port, "POST", "/v1/chat/completions",
            { model: "a.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(res.status, 502, "the fake child is not an HTTP server");
        assert.strictEqual(deps._servers.length, 2, "a fresh child must be spawned");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);
    } finally {
        await manager.stop();
    }
});

// The idle clock starts when a request is ROUTED, so a generation that runs longer than the
// window must not be truncated: the sweep probes the child's own /slots and leaves a working
// child alone, then stops it once the slot goes idle and the window passes again.
test("idle sweep never stops a child that is still generating", async () => {
    let clock = 50000;
    let processing = true;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 5 },
        now: () => clock,
        createRouter: () => ({
            async listModels() { return []; },
            async slots() { return [{ id: 0, is_processing: processing }]; }
        })
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        // Far past the idle window while the slot is still processing.
        clock += 60000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"], "a busy child must not be stopped");
        assert.strictEqual(deps._servers[0].stopped, false, "no stop may be emitted while generating");
        // Still processing on the next tick: still left alone.
        clock += 60000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);
        assert.strictEqual(deps._servers[0].stopped, false);
        // The generation ends; once the window passes from the last check it is stopped.
        processing = false;
        clock += 6000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), [], "an idle child past the window must stop");
        assert.strictEqual(deps._servers[0].stopped, true);
    } finally {
        await manager.stop();
    }
});

// An unreachable /slots probe must never cause a stop: the sweep is conservative and re-checks
// on a later tick rather than risking a mid-stream kill.
test("idle sweep is conservative when the child's /slots cannot be read", async () => {
    let clock = 70000;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 5 },
        now: () => clock,
        // No slots method: the probe rejects, as it would for an unreachable child.
        createRouter: () => ({ async listModels() { return []; } })
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        clock += 60000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"], "an unreadable child must not be stopped");
        assert.strictEqual(deps._servers[0].stopped, false);
    } finally {
        await manager.stop();
    }
});

test("with idle unload 0 a loaded child is never stopped", async () => {
    let clock = 0;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 0 },
        now: () => clock
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }]);
    try {
        clock += 1000 * 1000 * 1000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);
        assert.strictEqual(deps._servers.length, 1);
        assert.strictEqual(manager._idleTimer, null, "no sweep is scheduled when idle unload is off");
    } finally {
        await manager.stop();
    }
});

const GiB = 1024 * 1024 * 1024;

// The size-based half of the load-mode recommendation needs both the selected device and the
// model, which only exist together here. The caller's tuning pass runs before device selection,
// so this is the first place it can be decided.
test("a model too large for the card is given load mode none automatically", async () => {
    const deps = makeDeps({
        listDevices: async () => "  Vulkan0: AMD Radeon RX Vega (8192 MiB, 8192 MiB free)\n",
        modelBytes: () => 19 * GiB
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "big.gguf", contextSize: 4096, gpuLayers: "auto", modelPath: "/models/big.gguf" }]);
    try {
        assert.strictEqual(argOf(deps._servers[0], "--load-mode"), "none");
        assert.deepStrictEqual(state.loadModes, { "big.gguf": { mode: "none", auto: true } });
    } finally {
        await manager.stop();
    }
});

test("a model that fits keeps mmap", async () => {
    const deps = makeDeps({
        listDevices: async () => "  Vulkan0: AMD Radeon RX Vega (8192 MiB, 8192 MiB free)\n",
        modelBytes: () => 4 * GiB
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "small.gguf", contextSize: 4096, gpuLayers: "auto", modelPath: "/models/small.gguf" }]);
    try {
        assert.ok(!deps._servers[0].opts.args.includes("--load-mode"));
        assert.deepStrictEqual(state.loadModes, { "small.gguf": { mode: "mmap", auto: true } });
    } finally {
        await manager.stop();
    }
});

test("the size trigger needs a GPU: a CPU-only start keeps mmap", async () => {
    const deps = makeDeps({
        listDevices: async () => "",
        modelBytes: () => 19 * GiB,
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, backendPreference: "cpu" }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "big.gguf", contextSize: 4096, gpuLayers: "auto", modelPath: "/models/big.gguf" }]);
    try {
        assert.ok(!deps._servers[0].opts.args.includes("--load-mode"));
        assert.deepStrictEqual(state.loadModes, { "big.gguf": { mode: "mmap", auto: true } });
    } finally {
        await manager.stop();
    }
});

test("an explicit load mode is never overridden by the size trigger", async () => {
    const deps = makeDeps({
        listDevices: async () => "  Vulkan0: AMD Radeon RX Vega (8192 MiB, 8192 MiB free)\n",
        modelBytes: () => 19 * GiB
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "big.gguf", contextSize: 4096, gpuLayers: "auto", modelPath: "/models/big.gguf", loadMode: "mmap" }]);
    try {
        assert.strictEqual(argOf(deps._servers[0], "--load-mode"), "mmap");
        assert.deepStrictEqual(state.loadModes, { "big.gguf": { mode: "mmap", auto: false } });
    } finally {
        await manager.stop();
    }
});

test("a model entirely on the CPU is not given a load mode", async () => {
    const deps = makeDeps({
        listDevices: async () => "  Vulkan0: AMD Radeon RX Vega (8192 MiB, 8192 MiB free)\n",
        modelBytes: () => 19 * GiB
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "big.gguf", contextSize: 4096, gpuLayers: 0, modelPath: "/models/big.gguf" }]);
    try {
        assert.ok(!deps._servers[0].opts.args.includes("--load-mode"));
        assert.deepStrictEqual(state.loadModes, { "big.gguf": { mode: "mmap", auto: true } });
    } finally {
        await manager.stop();
    }
});

// The caller sanity-checks any placement it reads back from the server against this, so a
// buffer name it did not expect cannot be reported as VRAM.
test("the selected device's memory is reported for placement sanity checks", async () => {
    const deps = makeDeps({ listDevices: async () => "  Vulkan0: AMD Radeon RX Vega (8192 MiB, 8192 MiB free)\n" });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "m.gguf", contextSize: 4096 }]);
    assert.strictEqual(state.deviceMemoryMiB, 8192);
    await manager.stop();
});

test("a CPU-only start reports no device memory", async () => {
    const deps = makeDeps({ listDevices: async () => "" });
    const manager = new RuntimeManager(deps);
    const state = await manager.start([]);
    assert.strictEqual(state.deviceMemoryMiB, null);
    await manager.stop();
});

// A port the user configured is used exactly or the start fails: scanning forward would publish
// an address the user did not ask for, and an external client pointed at it would fail with no
// obvious cause.
test("an explicitly configured port that is taken fails the start rather than drifting", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 1234 },
        findFreePort: async (opts) => {
            if (opts && opts.preferred) throw new Error(`port ${opts.preferred} is already in use`);
            return freePort();
        }
    });
    const manager = new RuntimeManager(deps);
    await assert.rejects(
        () => manager.start([{ id: "qwen3-4b-q4_k_m.gguf", contextSize: 8192 }]),
        /already in use/i
    );
    assert.strictEqual(manager.status.status, "error");
});

// --- Multi-model serving through the public port ------------------------------------------

test("two models with different configured contexts both answer on the public port", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        // /props is answered by the front door from each model's effective entry, and must not
        // start the model it names.
        const pa = await getJson(state.port, "/props?model=a.gguf");
        const pb = await getJson(state.port, "/props?model=b.gguf");
        assert.strictEqual(pa.status, 200);
        assert.strictEqual(pa.body.default_generation_settings.n_ctx, 4096);
        assert.strictEqual(pb.status, 200);
        assert.strictEqual(pb.body.default_generation_settings.n_ctx, 8192);
        // No model field routes to the selected default.
        const pd = await getJson(state.port, "/props");
        assert.strictEqual(pd.body.default_generation_settings.n_ctx, 4096);
        // /v1/models carries both, with their own contexts.
        const list = await getJson(state.port, "/v1/models");
        const byId = {};
        for (const m of list.body.data) byId[m.id] = m;
        assert.strictEqual(byId["a.gguf"].meta.n_ctx, 4096);
        assert.strictEqual(byId["b.gguf"].meta.n_ctx, 8192);
        assert.strictEqual(byId["a.gguf"].status.value, "loaded");
        assert.strictEqual(byId["b.gguf"].status.value, "unloaded");
    } finally {
        await manager.stop();
    }
});

test("each child gets its own -c, and at models kept loaded 1 the second evicts the first", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        // The selected default was preloaded with its own context.
        assert.strictEqual(deps._servers.length, 1);
        assert.strictEqual(argOf(deps._servers[0], "-c"), "4096");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);

        // Request the second model through the public port. The child fake is not an HTTP
        // server, so the proxied request answers 502, but the request's model was loaded first.
        const res = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(res.status, 502);
        assert.strictEqual(deps._servers.length, 2);
        assert.strictEqual(argOf(deps._servers[1], "--alias"), "b.gguf");
        assert.strictEqual(argOf(deps._servers[1], "-c"), "8192");
        // models kept loaded = 1: the first child was stopped and is no longer loaded.
        assert.strictEqual(deps._servers[0].stopped, true);
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
        assert.strictEqual(manager.status.loadedModels.length, 1);
    } finally {
        await manager.stop();
    }
});

test("an evicted child that frees its internal port does not break the next model's health wait", async () => {
    // Regression: with the shipped "models kept loaded" of 1 the next model is normally given
    // the port the evicted child just freed. The dead child's port mapping must not be mistaken
    // for the new child by _idForPort, or the health wait races the evicted child's resolved
    // exit and reports a good load as failed. The fake mirrors ServerProcess: stop() ends the
    // child (null pid) and resolves its exitPromise.
    const fixedInternal = 22950;
    const servers = [];
    const deps = makeDeps({
        // The public allocation carries a `preferred` key (its configured port); internal
        // allocations do not. The public port is real and free; every internal one is the same
        // port, so the second child reuses the first's exactly as the real scan does after eviction.
        findFreePort: (opts) => (opts && Object.prototype.hasOwnProperty.call(opts, "preferred"))
            ? freePort() : Promise.resolve(fixedInternal),
        // Real health checks poll, so the wait is pending for a moment - that is the window in
        // which a resolved exit of the evicted child would win the race. Without the fix this
        // test fails with "exited before becoming healthy" on a healthy new child.
        waitForHealth: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 400)),
        createServer: (opts) => {
            let resolveExit = null;
            const server = {
                opts: opts, stopped: false,
                child: { pid: 6000 + servers.length },
                exitPromise: new Promise((resolve) => { resolveExit = resolve; }),
                start() {},
                stop() {
                    if (server.stopped) return;
                    server.stopped = true;
                    // The listener closes and the child reports its exit before the process is
                    // fully gone, so the pid lingers for a moment - exactly the window in which a
                    // port lookup would still name the evicted child.
                    setTimeout(() => { resolveExit({ code: 0, signal: null }); }, 50);
                    setTimeout(() => { server.child = null; }, 500);
                }
            };
            servers.push(server);
            return server;
        }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        const res = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        // The fake child is not an HTTP server, so the proxied request is a 502 - but the model
        // was loaded first, which is what matters. A stale mapping made this a 500.
        assert.strictEqual(res.status, 502);
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
        assert.strictEqual(servers[0].stopped, true);
        assert.strictEqual(servers[1].stop ? servers[1].stopped : false, false);
    } finally {
        await manager.stop();
    }
});

test("a request for an unknown model is a 404 and starts nothing", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        const before = deps._servers.length;
        const res = await request(state.port, "POST", "/v1/chat/completions",
            { model: "nope.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(deps._servers.length, before, "an unknown model must not load anything");
    } finally {
        await manager.stop();
    }
});

test("a loadedPort read never starts a model", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        const before = deps._servers.length;
        // /metrics and /slots are not model paths: with only the default loaded they proxy to it
        // (the fake child is not HTTP, so 502), but they must never ensure a second model.
        await request(state.port, "GET", "/metrics?model=b.gguf");
        assert.strictEqual(deps._servers.length, before);
    } finally {
        await manager.stop();
    }
});

// A child that actually answers HTTP, on the internal port the pool allocated, so per-model
// routing through the real front door is exercised end to end.
//
// `options.realNctx(alias)` makes each child answer its own `/props` with that value (as a real
// llama.cpp would after adjusting the requested context); `options.withRouter` adds a router
// whose `props()` reads the child's `/props`, so the manager's capture path is exercised.
function httpBackends(options) {
    const o = options || {};
    const servers = [];
    return {
        servers: servers,
        create: (opts) => {
            const alias = argOf({ opts: opts }, "--alias");
            const childPort = Number(argOf({ opts: opts }, "--port"));
            const realNctx = typeof o.realNctx === "function" ? o.realNctx(alias) : null;
            const srv = http.createServer((req, res) => {
                res.writeHead(200, { "content-type": "application/json" });
                if (realNctx != null && String(req.url || "").split("?")[0] === "/props") {
                    res.end(JSON.stringify({
                        default_generation_settings: { n_ctx: realNctx },
                        model_alias: alias, model_path: "/models/" + alias
                    }));
                    return;
                }
                res.end(JSON.stringify({ model: alias, path: req.url }));
            });
            let resolveListening = null;
            const listening = new Promise((r) => { resolveListening = r; });
            const idx = servers.length;
            const server = {
                opts: opts, child: { pid: 9000 + idx },
                exitPromise: new Promise(() => {}),
                listening: listening,
                modelBuffers: { gpuMiB: 2000 + idx, cpuMiB: 0, found: true },
                start() { srv.listen(childPort, "127.0.0.1", resolveListening); },
                stop() { return new Promise((r) => srv.close(r)); }
            };
            servers.push(server);
            return server;
        },
        // A minimal router whose props() reads the child's own /props on the port in baseUrl.
        router: (baseUrl) => ({
            async health() { return { status: 200 }; },
            props: () => new Promise((resolve, reject) => {
                const childPort = Number(String(baseUrl).replace(/^.*:/, ""));
                const r = http.get("http://127.0.0.1:" + childPort + "/props", (res) => {
                    const chunks = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () => {
                        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                        catch (err) { reject(err); }
                    });
                });
                r.on("error", reject);
            })
        })
    };
}

test("two models on one public port: each request reaches its own child with its own -c and context", async () => {
    const backs = httpBackends();
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 2 },
        createServer: backs.create,
        // The stub health wait lets each backend's listen() settle before the load is reported ready.
        waitForHealth: () => backs.servers[backs.servers.length - 1].listening.then(() => ({ status: 200 }))
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        // a is preloaded; b is loaded on demand (kept resident at models kept loaded 2).
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });

        // Both children are resident on the one public port, each spawned with its own context,
        // and the manager reports every loaded child pid (the console records these).
        assert.deepStrictEqual(manager.loadedChildPids(), [9000, 9001]);
        assert.strictEqual(argOf(backs.servers[0], "-c"), "4096");
        assert.strictEqual(argOf(backs.servers[1], "-c"), "8192");

        // A completion is routed by its model field to the right child (each fake answers with
        // its own alias), so Main and Glossary can use different models on the same URL/port.
        const ra = await request(state.port, "POST", "/v1/chat/completions",
            { model: "a.gguf", messages: [{ role: "user", content: "hi" }] });
        const rb = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(ra.status, 200);
        assert.strictEqual(JSON.parse(ra.text).model, "a.gguf");
        assert.strictEqual(rb.status, 200);
        assert.strictEqual(JSON.parse(rb.text).model, "b.gguf");

        // The front door reports each model's own configured context (/props), and its own data
        // by ?model= (/metrics, /slots).
        const pa = await getJson(state.port, "/props?model=a.gguf");
        const pb = await getJson(state.port, "/props?model=b.gguf");
        assert.strictEqual(pa.body.default_generation_settings.n_ctx, 4096);
        assert.strictEqual(pb.body.default_generation_settings.n_ctx, 8192);
        const ma = await getJson(state.port, "/metrics?model=a.gguf");
        const mb = await getJson(state.port, "/metrics?model=b.gguf");
        assert.strictEqual(ma.body.model, "a.gguf");
        assert.strictEqual(mb.body.model, "b.gguf");
        const sa = await getJson(state.port, "/slots?model=a.gguf");
        const sb = await getJson(state.port, "/slots?model=b.gguf");
        assert.strictEqual(sa.body.model, "a.gguf");
        assert.strictEqual(sb.body.model, "b.gguf");
        // An unloaded model is a 503, and a status read starts nothing.
        const before = backs.servers.length;
        const missing = await getJson(state.port, "/metrics?model=c.gguf");
        assert.strictEqual(missing.status, 503);
        assert.strictEqual(backs.servers.length, before);
} finally {
        await manager.stop();
    }
});

// I2: /props must report the loaded instance's own context, not the configured entry. A child
// whose real n_ctx differs from the configured value is reported truthfully while loaded; an
// unloaded model still reports its configured value (and answering must never start it).
test("while loaded, /props reports the child's real n_ctx; unloaded reports the configured value", async () => {
    const backs = httpBackends({ realNctx: (alias) => (alias === "a.gguf" ? 777 : 888) });
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 2 },
        createServer: backs.create,
        createRouter: backs.router,
        waitForHealth: () => backs.servers[backs.servers.length - 1].listening.then(() => ({ status: 200 }))
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        // a is loaded: its own /props (real 777), not the configured 4096.
        const pa = await getJson(state.port, "/props?model=a.gguf");
        assert.strictEqual(pa.status, 200);
        assert.strictEqual(pa.body.default_generation_settings.n_ctx, 777,
            "a loaded model must report the child's real context");
        // b is not loaded: the configured value, and answering must not start it.
        const before = backs.servers.length;
        const pb = await getJson(state.port, "/props?model=b.gguf");
        assert.strictEqual(pb.status, 200);
        assert.strictEqual(pb.body.default_generation_settings.n_ctx, 8192,
            "an unloaded model must report the configured context");
        assert.strictEqual(backs.servers.length, before, "a /props read must never start a model");
        // Once b is loaded it too reports its own real value.
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });
        const pb2 = await getJson(state.port, "/props?model=b.gguf");
        assert.strictEqual(pb2.body.default_generation_settings.n_ctx, 888);
        // The no-model default resolves to the loaded a and reports its real value.
        const pd = await getJson(state.port, "/props");
        assert.strictEqual(pd.body.default_generation_settings.n_ctx, 777);
    } finally {
        await manager.stop();
    }
});

// With several resident models, server.modelBuffers must describe the child the status line
// names (the selected default while it is loaded), not merely the last one loaded.
test("server.modelBuffers describes the currently served child, not the last-loaded one", async () => {
    const backs = httpBackends();
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 2 },
        createServer: backs.create,
        waitForHealth: () => backs.servers[backs.servers.length - 1].listening.then(() => ({ status: 200 }))
    });
    const manager = new RuntimeManager(deps);
    await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.strictEqual(manager.server.modelBuffers.gpuMiB, 2000, "the served default's buffers");
        // Load b on demand; the served model is still the selected default a.
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });
        assert.deepStrictEqual(manager.pool.loadedIds().slice().sort(), ["a.gguf", "b.gguf"]);
        assert.strictEqual(manager.server.modelBuffers.gpuMiB, 2000,
            "must describe the served child a, not the last-loaded b (2001)");
    } finally {
        await manager.stop();
    }
});

// The compatibility server handle's stop({ timeoutMs }) is documented by the launcher as a
// shutdown grace; it must reach each child's own stop rather than being ignored.
test("server.stop honours a timeoutMs grace and passes it to every child", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    const handle = manager.server;
    await handle.stop({ timeoutMs: 3000 });
    assert.deepStrictEqual(deps._servers[0].stopOpts, { timeoutMs: 3000 });
    assert.strictEqual(manager.pool, null, "the teardown must release the pool");
});

// Eviction must not leave a stopped model's chat template, props or reasoning capabilities
// cached: a later child for the same model would otherwise report the previous instance's facts.
test("an evicted model's cached chat template, props and reasoning caps are cleared", async () => {
    const servers = [];
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 1 },
        // Easy-to-settle exits, so the killed child's exit handler (which clears the caches)
        // actually runs, plus a router whose props carries a chat template and capability flags
        // so all three caches are populated.
        createServer: (opts) => {
            let resolveExit = null;
            const server = {
                opts: opts, stopped: false,
                child: { pid: 8000 + servers.length },
                exitPromise: new Promise((r) => { resolveExit = r; }),
                modelBuffers: { gpuMiB: 0, cpuMiB: 0, found: false },
                start() {},
                stop() {
                    if (server.stopped) return;
                    server.stopped = true;
                    server.child = null;
                    resolveExit({ code: 0, signal: null });
                }
            };
            servers.push(server);
            return server;
        },
        createRouter: (baseUrl) => ({
            async health() { return { status: 200 }; },
            async props() {
                return {
                    chat_template: "template-for-" + baseUrl,
                    default_generation_settings: { n_ctx: 1 },
                    chat_template_caps: { supports_reasoning_effort: true }
                };
            }
        }),
        waitForHealth: async () => ({ status: 200 })
    });
    const manager = new RuntimeManager(deps);
    await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.ok(manager._chatTemplates["a.gguf"], "a's template was cached at health");
        assert.ok(manager._childProps["a.gguf"], "a's props were cached at health");
        assert.ok(manager._reasoningCaps["a.gguf"], "a's reasoning caps were derived at health");
        // Loading b at modelsMax 1 evicts (deliberately kills) a.
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });
        // Let the killed child's exit settle.
        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(manager._chatTemplates["a.gguf"], undefined, "evicted a's template must be gone");
        assert.strictEqual(manager._childProps["a.gguf"], undefined, "evicted a's props must be gone");
        assert.strictEqual(manager._reasoningCaps["a.gguf"], undefined,
            "evicted a's reasoning caps must be gone, or a reload could be judged by its predecessor");
        // The new child for b has its own cache.
        assert.ok(manager._chatTemplates["b.gguf"]);
        assert.ok(manager._reasoningCaps["b.gguf"]);
    } finally {
        await manager.stop();
    }
});

// Reasoning capabilities are a per-model fact derived from the loaded child's own /props at the
// same capture point as the template, never from anything the manager already knows. The fixture
// is named after its behaviour - a model whose /props advertises effort support with a readable
// validator - never after a model family.
test("a loaded model's reasoning capabilities are derived from its own /props", async () => {
    const deps = makeDeps({
        createRouter: () => ({
            async health() { return { status: 200 }; },
            async props() {
                return {
                    default_generation_settings: { n_ctx: 4096 },
                    model_alias: "effort-model.gguf",
                    model_path: "/models/effort-model.gguf",
                    chat_template_caps: {
                        supports_reasoning_effort: true,
                        supports_preserve_reasoning: true
                    },
                    chat_template: [
                        "{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}",
                        "{%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}",
                        "    {{- raise_exception('Unexpected reasoning effort') }}",
                        "{%- endif %}"
                    ].join("\n")
                };
            }
        }),
        waitForHealth: async () => ({ status: 200 })
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "effort-model.gguf", contextSize: 4096 }]);
    try {
        const caps = manager.capsFor("effort-model.gguf");
        assert.strictEqual(caps.supportsEffort, true);
        assert.strictEqual(caps.supportsPreserve, true);
        assert.deepStrictEqual(caps.efforts, ["xhigh", "medium", "low"]);
    } finally {
        await manager.stop();
    }
});

// The safe direction: a model whose /props never arrived (or was never loaded) must report no
// effort support, never undefined and never a throw, so the front door routes the request through
// the chat-template channel without a tier it has no facts to justify.
test("a model whose props were never captured reports no effort support", () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    for (const id of ["never-loaded.gguf", "", null]) {
        const caps = manager.capsFor(id);
        assert.deepStrictEqual(caps, { supportsEffort: false, supportsPreserve: false, efforts: null },
            "capsFor(" + String(id) + ") must yield the safe default");
    }
});

test("loadedChildPids lists every loaded child and is empty after stop", async () => {
    const backs = httpBackends();
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 2 },
        createServer: backs.create,
        waitForHealth: () => backs.servers[backs.servers.length - 1].listening.then(() => ({ status: 200 }))
    });
    const manager = new RuntimeManager(deps);
    assert.deepStrictEqual(manager.loadedChildPids(), []);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.deepStrictEqual(manager.loadedChildPids(), [9000], "only the preloaded default is loaded");
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });
        assert.deepStrictEqual(manager.loadedChildPids(), [9000, 9001], "both loaded children are listed");
    } finally {
        await manager.stop();
    }
    assert.deepStrictEqual(manager.loadedChildPids(), [], "a stopped manager has no child pids");
});

// Task 11: error paths and concurrency.

test("GET /health answers 200 with the front door up and nothing loaded", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    const state = await manager.start([]);
    try {
        assert.deepStrictEqual(state.loadedModels, []);
        assert.strictEqual(deps._servers.length, 0, "no model was started");
        const health = await getJson(state.port, "/health");
        assert.strictEqual(health.status, 200);
        assert.deepStrictEqual(health.body, { status: "ok" });
        // A status read with nothing loaded is a 503, not a start.
        const metrics = await getJson(state.port, "/metrics");
        assert.strictEqual(metrics.status, 503);
        assert.strictEqual(deps._servers.length, 0);
    } finally {
        await manager.stop();
    }
});

test("a model that fails to load reports its stderr tail, is not loaded, and is retryable", async () => {
    let calls = 0;
    const deps = makeDeps({
        waitForHealth: async () => {
            calls++;
            if (calls === 2) {
                // The failed child's own stderr, captured by the manager's onLog hook. The
                // child also dies: the health wait only keeps waiting for a LIVE child.
                const latest = deps._servers[deps._servers.length - 1];
                if (latest) {
                    latest.emitLog("stderr", "error loading model: invalid magic bytes");
                    latest.running = false;
                    latest._exit({ code: 1, signal: null });
                }
                throw new Error("llama-server exited before becoming healthy (exit code 1)");
            }
            return { status: 200 };
        }
    });
    const manager = new RuntimeManager(deps);
    // a is preloaded (call 1 succeeds); the request for b evicts a and its health wait fails.
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 4096 }],
        { defaultId: "a.gguf" }
    );
    try {
        const failed = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(failed.status, 500);
        const body = JSON.parse(failed.text);
        assert.strictEqual(body.error.message, "b.gguf failed to load: error loading model: invalid magic bytes");
        assert.deepStrictEqual(manager.pool.loadedIds(), [], "a failed model must not be marked loaded");
        // The failed attempt's record carries its stderr tail ...
        assert.match(manager.children["b.gguf"].stderrTail.text, /invalid magic bytes/);
        // A later request retries the start instead of being poisoned by the failure (call 3
        // succeeds and its child answers 502 because the fake is not an HTTP server).
        const retried = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(retried.status, 502);
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
        assert.strictEqual(deps._servers.length, 3, "each attempt spawns exactly one child");
        // ... and the successful retry's fresh record does not inherit it.
        assert.strictEqual(manager.children["b.gguf"].stderrTail.text, "",
            "a successful start must clear the failed child's stale stderr tail");
    } finally {
        await manager.stop();
    }
});

// The cause of a load failure can sit many lines from the end of the child's stderr (the
// real-world case: "unknown model architecture" printed mid-dump, then a dozen cleanup
// lines). Error messages must carry the WHOLE retained tail, not an excerpt - a window
// over the last few lines hides exactly the line that says why the model did not load.
test("a child that dies mid-load reports its full stderr, cause line included", async () => {
    const lines = ["E llama_model_load: error loading model: unknown model architecture: 'xing4_0'"];
    for (let i = 1; i <= 11; i++) lines.push("I srv load dump line " + i + " of 11");
    lines.push("E srv llama_server: exiting due to model loading error");
    const full = lines.join("\n");
    let calls = 0;
    const deps = makeDeps({
        // The health wait never settles for the dying child, so the load failure comes
        // from the manager's own exited-child path - the one that builds the start error
        // from the retained stderr.
        waitForHealth: () => {
            calls++;
            if (calls === 2) {
                const latest = deps._servers[deps._servers.length - 1];
                if (latest) {
                    latest.emitLog("stderr", full);
                    latest.running = false;
                    latest._exit({ code: 1, signal: null });
                }
                return new Promise(() => {});
            }
            return { status: 200 };
        }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 4096 }],
        { defaultId: "a.gguf" }
    );
    try {
        const failed = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(failed.status, 500);
        const body = JSON.parse(failed.text);
        assert.strictEqual(body.error.message, "b.gguf failed to load: " + full);
        assert.match(manager.children["b.gguf"].stderrTail.text, /unknown model architecture/);
    } finally {
        await manager.stop();
    }
});

// C1: a failed on-demand load at models kept loaded 1 must not be mistaken for the runtime
// dying. The sequence is "request B -> evict+kill A -> B fails health -> the pool kills B",
// which leaves the pool empty and idle. Both exits are deliberate, so neither the evicted A
// nor the cleaned-up B may resolve the compatibility exitPromise - the console watches that
// promise and would otherwise stop the whole runtime (taking /health with it) and make the
// failed request unretryable.
test("a failed load at models kept loaded 1 leaves the runtime up and retryable", async () => {
    let healthCalls = 0;
    const servers = [];
    const deps = makeDeps({
        waitForHealth: async () => {
            healthCalls++;
            if (healthCalls === 2) {
                // The child dies: the health wait only keeps waiting for a LIVE child, so a
                // failed load must flip running and resolve the exit promise, exactly as a
                // real ServerProcess would on crash.
                const latest = servers[servers.length - 1];
                if (latest) { latest.running = false; latest._exit({ code: 1, signal: null }); }
                throw new Error("llama-server exited before becoming healthy (exit code 1)");
            }
            return { status: 200 };
        },
        // Unlike the default fake, this one mirrors ServerProcess: stopping the child resolves
        // its exitPromise. That is exactly what the old fake never did, which is why the defect
        // could not be caught before.
        createServer: (opts) => {
            let resolveExit = null;
            const server = {
                opts: opts, stopped: false, running: true,
                child: { pid: 7000 + servers.length },
                exitPromise: new Promise((r) => { resolveExit = r; }),
                modelBuffers: { gpuMiB: 0, cpuMiB: 0, found: false },
                _exit(result) { resolveExit(result || { code: 0, signal: null }); },
                start() {},
                stop() {
                    if (server.stopped) return;
                    server.stopped = true;
                    setTimeout(() => { server.child = null; server.running = false; resolveExit({ code: 0, signal: null }); }, 0);
                }
            };
            servers.push(server);
            return server;
        }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 4096 }],
        { defaultId: "a.gguf" }
    );
    try {
        let settled = false;
        manager.server.exitPromise.then(() => { settled = true; });

        const failed = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(failed.status, 500);
        assert.deepStrictEqual(manager.pool.loadedIds(), []);
        // Let the deliberately killed children's exit promises resolve.
        await new Promise((r) => setTimeout(r, 60));

        assert.strictEqual(settled, false, "a deliberately killed child must not resolve exitPromise");
        assert.strictEqual(manager.status.status, "ready", "the runtime must stay up");
        // /health is still served by the front door.
        const health = await getJson(state.port, "/health");
        assert.strictEqual(health.status, 200);
        assert.deepStrictEqual(health.body, { status: "ok" });

        // A retry spawns a fresh child and succeeds.
        const before = servers.length;
        const retried = await request(state.port, "POST", "/v1/chat/completions",
            { model: "b.gguf", messages: [{ role: "user", content: "hi" }] });
        assert.strictEqual(retried.status, 502, "the retry loaded b; the fake child is not HTTP");
        assert.strictEqual(servers.length, before + 1, "a retry must spawn a fresh child");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
    } finally {
        await manager.stop();
    }
});

test("two concurrent requests for the same unloaded model spawn exactly one child", async () => {
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 2 }
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 4096 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.strictEqual(deps._servers.length, 1, "only the default was preloaded");
        await Promise.all([
            request(state.port, "POST", "/v1/chat/completions", { model: "b.gguf", messages: [{ role: "user", content: "hi" }] }),
            request(state.port, "POST", "/v1/chat/completions", { model: "b.gguf", messages: [{ role: "user", content: "hi" }] })
        ]);
        assert.strictEqual(deps._servers.length, 2, "two concurrent requests must share one start");
        assert.deepStrictEqual(manager.pool.loadedIds().slice().sort(), ["a.gguf", "b.gguf"]);
    } finally {
        await manager.stop();
    }
});

// --- Teardown during a start (C1) and the compatibility handle (I4) ----------------------

// A signal/close that calls stop() while a start is waiting on a model must not leave the
// detached child (or the front door) behind.
test("stop during a start cancels it, kills the in-flight child, and never reports ready", async () => {
    let releaseHealth = null;
    const deps = makeDeps({ waitForHealth: () => new Promise((r) => { releaseHealth = r; }) });
    const manager = new RuntimeManager(deps);
    const startP = manager.start([{ id: "a.gguf", contextSize: 4096 }]);
    // Wait until the pool has spawned the child but its health wait is still pending.
    while (deps._servers.length === 0) await new Promise((r) => setTimeout(r, 1));
    const child = deps._servers[0];
    assert.deepStrictEqual(manager.pool.loadedIds(), [], "the child is in flight, not loaded yet");

    const stopped = await manager.stop();
    assert.strictEqual(stopped.status, "stopped");

    // Let the held health wait settle; the cancelled start must reject, not reach ready.
    releaseHealth({ status: 200 });
    await assert.rejects(() => startP, /cancel/i);
    assert.strictEqual(child.stopped, true, "the in-flight child must be killed");
    assert.strictEqual(manager.status.status, "stopped");
    assert.notStrictEqual(manager.status.status, "ready");
});

// --- Wait for the outgoing model's in-flight generation before evicting (regression) ----------
//
// The user's requirement: with "models kept loaded" 1, a request for a DIFFERENT model must not
// abort the current model's in-flight generation. It waits for it to finish, then evicts and
// loads ("slow rather than crash"). These children really stream HTTP, so the public-port stream
// is exercised end to end through the real front door and the shipped pool.
function streamingBackends(options) {
    const o = options || {};
    const servers = [];
    return {
        servers: servers,
        create: (opts) => {
            const alias = argOf({ opts: opts }, "--alias");
            const childPort = Number(argOf({ opts: opts }, "--port"));
            const srv = http.createServer((req, res) => {
                const chunks = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (err) { /* not json */ }
                    if (!parsed || parsed.stream !== true) {
                        res.writeHead(200, { "content-type": "application/json" });
                        res.end(JSON.stringify({ model: alias, path: req.url }));
                        return;
                    }
                    res.writeHead(200, { "content-type": "text/event-stream" });
                    const total = o.chunks === undefined ? 8 : o.chunks;
                    const intervalMs = o.intervalMs === undefined ? 30 : o.intervalMs;
                    let n = 0;
                    const iv = setInterval(function () {
                        n += 1;
                        res.write("data: {\"n\":" + n + "}\n\n");
                        if (n >= total) { clearInterval(iv); res.end("data: [DONE]\n\n"); }
                    }, intervalMs);
                    res.on("close", function () { clearInterval(iv); });
                });
            });
            // A real child is SIGTERM'd, which drops its open sockets and truncates any stream in
            // progress. Mirror that here: a graceful server.close() would let an in-flight
            // response finish and hide the abort the regression test exists to catch.
            const sockets = new Set();
            srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
            let resolveListening = null;
            const listening = new Promise((r) => { resolveListening = r; });
            const idx = servers.length;
            const server = {
                opts: opts, child: { pid: 9500 + idx },
                exitPromise: new Promise(() => {}),
                listening: listening,
                modelBuffers: { gpuMiB: 0, cpuMiB: 0, found: false },
                start() { srv.listen(childPort, "127.0.0.1", resolveListening); },
                stop() {
                    return new Promise((r) => {
                        sockets.forEach((s) => { try { s.destroy(); } catch (err) { /* gone */ } });
                        srv.close(r);
                    });
                }
            };
            servers.push(server);
            return server;
        }
    };
}

function streamRequest(port, model) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model: model, stream: true, messages: [] });
        const req = http.request({
            host: "127.0.0.1", port: port, path: "/v1/chat/completions", method: "POST",
            headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(payload);
    });
}

test("while A streams, a request for B waits: A completes, then B is served (both complete)", async () => {
    const backs = streamingBackends({ chunks: 8, intervalMs: 30 });
    // Distinct ports per allocation: the evicted child's internal port must not be immediately
    // reused by the next child here, or the front door's pooled upstream socket could race the
    // old child's teardown (a real port-reuse concern, but not what this regression is about).
    let portSeq = 0;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 1 },
        findFreePort: () => {
            portSeq += 1;
            return Ports.findFreePort({ start: 23000 + portSeq * 30, end: 23029 + portSeq * 30, host: "127.0.0.1" });
        },
        createServer: backs.create,
        waitForHealth: () => backs.servers[backs.servers.length - 1].listening.then(() => ({ status: 200 }))
    });
    const manager = new RuntimeManager(deps);
    const state = await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 4096 }],
        { defaultId: "a.gguf" }
    );
    try {
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"]);
        // Start streaming A and wait until it is genuinely in flight.
        let aChunkEvents = 0;
        const aDone = streamRequest(state.port, "a.gguf").then((r) => { aChunkEvents = r.text.split('data: {"n"').length - 1; return r; });
        while (manager.frontDoor.activeRequests("a.gguf") === 0) await new Promise((r) => setTimeout(r, 5));
        assert.strictEqual(manager.frontDoor.activeRequests("a.gguf"), 1);
        const serverCountDuringA = backs.servers.length;

        // Two requests for B while A is still generating. Both must queue behind the one switch;
        // neither may abort A.
        const [b1, b2] = await Promise.all([streamRequest(state.port, "b.gguf"), streamRequest(state.port, "b.gguf")]);
        const a = await aDone;

        // A completed with every chunk (it was not aborted mid-stream).
        assert.strictEqual(a.status, 200);
        assert.strictEqual(aChunkEvents, 8, "A must deliver all 8 SSE frames");
        assert.match(a.text, /\[DONE\]/);
        // B was then served, twice, from exactly one new child (the two requests shared one start).
        assert.strictEqual(b1.status, 200);
        assert.strictEqual(b2.status, 200);
        assert.match(b1.text, /\[DONE\]/);
        assert.match(b2.text, /\[DONE\]/);
        assert.strictEqual(backs.servers.length, serverCountDuringA + 1, "both B requests share one child");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
    } finally {
        await manager.stop();
    }
});

// The wait is a real poll of the front door's count, bounded by waitForIdleTimeoutMs. It resolves
// as soon as the count reaches 0, and on a cap hit it logs a warning and resolves anyway.
test("_waitForIdle resolves when the count drains, and logs+resolves at its cap", async () => {
    const logs = [];
    const deps = makeDeps({
        log: (m) => logs.push(m),
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, waitForIdleTimeoutMs: 60 }
    });
    const manager = new RuntimeManager(deps);
    // No front door yet: nothing to wait for.
    await manager._waitForIdle("a.gguf");
    assert.deepStrictEqual(logs, []);
    // Count 0: resolves at once, no log.
    manager.frontDoor = { activeRequests: () => 0 };
    await manager._waitForIdle("a.gguf");
    assert.deepStrictEqual(logs, []);
    // Count 1 for a while then drains: resolves once it reaches 0, no cap warning.
    let count = 1;
    manager.frontDoor = { activeRequests: () => count };
    const drained = manager._waitForIdle("a.gguf");
    setTimeout(() => { count = 0; }, 30);
    await drained;
    assert.deepStrictEqual(logs, []);
    // Count never drains: the cap logs a warning and resolves anyway.
    manager.frontDoor = { activeRequests: () => 1 };
    await manager._waitForIdle("a.gguf");
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /waitForIdle timeout for a\.gguf/);
});

// The switch wait is the `runtimeWaitIdleSeconds` option: the configured seconds are the cap in
// ms, an empty/invalid value falls back to the shipped 30 minutes, and 0 disables the wait so an
// eviction does not wait at all.
test("waitIdleSeconds sets the cap in ms, falls back when empty, and 0 disables the wait", async () => {
    const base = { platformKey: "linux-x64", modelsDir: "/models", port: 0 };
    assert.strictEqual(new RuntimeManager(makeDeps({ config: Object.assign({}, base, { waitIdleSeconds: 30 }) }))._waitForIdleTimeoutMs(), 30000);
    assert.strictEqual(new RuntimeManager(makeDeps({ config: Object.assign({}, base, { waitIdleSeconds: 0.05 }) }))._waitForIdleTimeoutMs(), 50);
    assert.strictEqual(new RuntimeManager(makeDeps({ config: Object.assign({}, base, { waitIdleSeconds: "" }) }))._waitForIdleTimeoutMs(), 30 * 60 * 1000);
    assert.strictEqual(new RuntimeManager(makeDeps({ config: Object.assign({}, base, { waitIdleSeconds: "abc" }) }))._waitForIdleTimeoutMs(), 30 * 60 * 1000);
    assert.strictEqual(new RuntimeManager(makeDeps({ config: Object.assign({}, base, { waitIdleSeconds: -5 }) }))._waitForIdleTimeoutMs(), 30 * 60 * 1000);

    // 0 disables: with a live in-flight count the wait resolves at once, no warning.
    const logs = [];
    const zero = new RuntimeManager(makeDeps({ log: (m) => logs.push(m), config: Object.assign({}, base, { waitIdleSeconds: 0 }) }));
    zero.frontDoor = { activeRequests: () => 1 };
    const started = Date.now();
    await zero._waitForIdle("a.gguf");
    assert.ok(Date.now() - started < 50, "0 must not wait");
    assert.deepStrictEqual(logs, []);
});

// The stronger form of the same rule: an eviction at models kept loaded 1 must not stall behind a
// front-door count that never drains when the wait is disabled.
test("an eviction does not wait when waitIdleSeconds is 0", async () => {
    const deps = makeDeps({ config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, modelsMax: 1, waitIdleSeconds: 0 } });
    const manager = new RuntimeManager(deps);
    await manager.start(
        [{ id: "a.gguf", contextSize: 4096 }, { id: "b.gguf", contextSize: 8192 }],
        { defaultId: "a.gguf" }
    );
    try {
        // Report A as permanently in flight; with the wait disabled the switch must still evict
        // A at once rather than block until the (30-minute) cap.
        manager.frontDoor = Object.assign({}, manager.frontDoor, { activeRequests: () => 1 });
        const started = Date.now();
        await manager.pool.ensure("b.gguf", { id: "b.gguf", contextSize: 8192 });
        assert.ok(Date.now() - started < 500, "a switch with the wait disabled must not wait");
        assert.deepStrictEqual(manager.pool.loadedIds(), ["b.gguf"]);
        assert.strictEqual(deps._servers[0].stopped, true, "A was evicted");
    } finally {
        await manager.stop();
    }
});

test("the per-model parallelSlots reaches a child's args; the retired global does not", async () => {
    const deps = makeDeps({ config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, parallel: 4 } });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096, parallelSlots: 4 }]);
    try {
        assert.strictEqual(argOf(deps._servers[0], "--parallel"), "4");
    } finally {
        await manager.stop();
    }
    // A config.parallel (the retired global) must not reach the child if the entry is unset.
    const globalOnly = makeDeps({ config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, parallel: 4 } });
    const manager2 = new RuntimeManager(globalOnly);
    await manager2.start([{ id: "a.gguf", contextSize: 4096 }]);
    try {
        assert.strictEqual(argOf(globalOnly._servers[0], "--parallel"), null,
            "--parallel must be omitted when the entry does not set parallelSlots");
    } finally {
        await manager2.stop();
    }
});

// The front door's count is authoritative for the idle sweep too: a model with a request being
// proxied is working even when its own /slots briefly reports idle.
test("idle sweep leaves a model with an in-flight request alone even when /slots says idle", async () => {
    let clock = 90000;
    const deps = makeDeps({
        config: { platformKey: "linux-x64", modelsDir: "/models", port: 0, sleepIdleSeconds: 5 },
        now: () => clock,
        createRouter: () => ({
            async listModels() { return []; },
            async slots() { return [{ id: 0, is_processing: false }]; }
        })
    });
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        // Keep the real door's stop, but report A as having one request in flight.
        manager.frontDoor = Object.assign({}, manager.frontDoor, {
            activeRequests: (id) => (id === "a.gguf" ? 1 : 0)
        });
        clock += 60000;
        await manager._sweepIdle();
        assert.deepStrictEqual(manager.pool.loadedIds(), ["a.gguf"], "an in-flight model must not be stopped");
        assert.strictEqual(deps._servers[0].stopped, false);
    } finally {
        await manager.stop();
    }
});

test("the server handle exposes the loaded child's pid and a settling exitPromise", async () => {
    const deps = makeDeps();
    const manager = new RuntimeManager(deps);
    await manager.start([{ id: "a.gguf", contextSize: 4096 }], { defaultId: "a.gguf" });
    try {
        assert.ok(manager.server, "manager.server must be published for the console/app");
        assert.ok(manager.server.child, "the loaded child must be exposed");
        assert.strictEqual(manager.server.child.pid, deps._servers[0].child.pid);
        // The loaded child exits on its own: the pool empties and exitPromise settles, which is
        // the signal the console/app use to detect a dead server.
        deps._servers[0]._exit({ code: 1, signal: null });
        const result = await manager.server.exitPromise;
        assert.deepStrictEqual(result, { code: 1, signal: null });
        assert.deepStrictEqual(manager.pool.loadedIds(), []);
        assert.strictEqual(manager.server.child, null);
    } finally {
        await manager.stop();
    }
});
