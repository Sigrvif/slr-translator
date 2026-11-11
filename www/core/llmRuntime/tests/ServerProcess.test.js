"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { ServerProcess, applyModelBufferLine, placementLooksPossible, sanitiseBuffers, newFitReport, applyFitLine } = require("../lib/ServerProcess");

function fakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exit = (code) => child.emit("exit", code, null);
    return child;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("start spawns the server with the given args and forwards logs", async () => {
    const child = fakeChild(1234);
    const calls = [];
    const logs = [];
    const server = new ServerProcess({
        serverBinary: "/llama/llama-server",
        args: ["--port", "8730"],
        cwd: "/llama",
        spawn: (bin, args, options) => { calls.push({ bin, args, options }); return child; },
        killTree: async () => {},
        onLog: (stream, text) => logs.push(`${stream}:${text.trim()}`)
    });
    server.start();
    assert.strictEqual(server.running, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].bin, "/llama/llama-server");
    assert.deepStrictEqual(calls[0].args, ["--port", "8730"]);
    assert.strictEqual(calls[0].options.cwd, "/llama");
    child.stdout.write("hello\n");
    child.stderr.write("warn\n");
    await tick();
    assert.deepStrictEqual(logs, ["stdout:hello", "stderr:warn"]);
});

test("start refuses to launch twice", () => {
    const child = fakeChild(1);
    const server = new ServerProcess({ serverBinary: "s", spawn: () => child, killTree: async () => {} });
    server.start();
    assert.throws(() => server.start(), /already running/);
});

test("exit clears running state and records the code", async () => {
    const child = fakeChild(7);
    const server = new ServerProcess({ serverBinary: "s", spawn: () => child, killTree: async () => {} });
    server.start();
    child.exit(0);
    await server.exitPromise;
    assert.strictEqual(server.running, false);
    assert.deepStrictEqual(server.exitResult, { code: 0, signal: null });
});

test("stop asks killTree to terminate the process tree", async () => {
    const child = fakeChild(42);
    let killed = null;
    const server = new ServerProcess({
        serverBinary: "s",
        spawn: () => child,
        killTree: async (c, timeoutMs) => { killed = { pid: c.pid, timeoutMs }; child.exit(0); }
    });
    server.start();
    await server.stop({ timeoutMs: 50 });
    assert.deepStrictEqual(killed, { pid: 42, timeoutMs: 50 });
    assert.strictEqual(server.running, false);
});

// The process-exit path cannot run async I/O, so killNow must go through the synchronous
// tree kill, and a server without a live child must be a no-op.
test("killNow uses the synchronous tree kill on the live child only", () => {
    const child = fakeChild(7);
    const calls = [];
    const server = new ServerProcess({
        serverBinary: "s",
        spawn: () => child,
        killTree: async () => {},
        killTreeSync: (c) => { calls.push(c.pid); }
    });
    server.killNow();
    assert.deepStrictEqual(calls, [], "no child, no kill");
    server.start();
    server.killNow();
    assert.deepStrictEqual(calls, [7]);
});

test("start passes a configured environment to the child, and none when unset", () => {
    const calls = [];
    const spawn = (bin, args, options) => { calls.push(options); return fakeChild(1); };
    const withEnv = new ServerProcess({
        serverBinary: "/llama/llama-server", cwd: "/llama", spawn,
        env: { LD_LIBRARY_PATH: "/home/me/myrocm/lib" }
    });
    withEnv.start();
    assert.strictEqual(calls[0].env.LD_LIBRARY_PATH, "/home/me/myrocm/lib");

    const withoutEnv = new ServerProcess({ serverBinary: "/llama/llama-server", cwd: "/llama", spawn });
    withoutEnv.start();
    // Absent means "inherit", which is different from an empty environment.
    assert.strictEqual("env" in calls[1], false);
});


// The loader's per-buffer sizes are the only ground truth for placement. Its "offloaded N/M
// layers to GPU" line counts layer assignment, which reads as "everything is on the GPU" even
// when a MoE model's experts are in the CPU buffer.
test("applyModelBufferLine totals the buffers and separates VRAM from host memory", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors:   Vulkan0 model buffer size =  6450.00 MiB");
    applyModelBufferLine(state, "load_tensors:   CPU_Mapped model buffer size = 12380.00 MiB");
    assert.deepStrictEqual(state.target, { gpuMiB: 6450, cpuMiB: 12380, found: true });
});

// ggml names a backend's host buffer "<Backend>_Host" (libggml-vulkan.so contains
// "Vulkan_Host"). That is system RAM the backend can address, not VRAM, and counting it as GPU
// made an 18.4 GiB model on an 8 GiB card report "18.9 GiB on GPU".
test("applyModelBufferLine treats a backend's host buffer as host memory", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors:   Vulkan0 model buffer size =  6450.00 MiB");
    applyModelBufferLine(state, "load_tensors:   Vulkan_Host model buffer size = 12380.00 MiB");
    assert.deepStrictEqual(state.target, { gpuMiB: 6450, cpuMiB: 12380, found: true });
    const cuda = ServerProcess.newModelBuffers();
    applyModelBufferLine(cuda, "load_tensors:   CUDA0 model buffer size =  6000.00 MiB");
    applyModelBufferLine(cuda, "load_tensors:   CUDA_Host model buffer size = 12000.00 MiB");
    assert.deepStrictEqual(cuda.target, { gpuMiB: 6000, cpuMiB: 12000, found: true });
});

test("applyModelBufferLine still counts a plain CPU buffer with load-mode none", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors:   CPU model buffer size = 18776.45 MiB");
    assert.deepStrictEqual(state.target, { gpuMiB: 0, cpuMiB: 18776.45, found: true });
});

test("applyModelBufferLine ignores repack buffers, which duplicate weights", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors:   CPU_Mapped model buffer size = 18776.45 MiB");
    applyModelBufferLine(state, "load_tensors:   CPU_REPACK model buffer size =  2722.50 MiB");
    assert.strictEqual(state.target.cpuMiB, 18776.45);
});

test("applyModelBufferLine resets on a fresh load so a model switch cannot mix totals", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors:   CPU_Mapped model buffer size = 12380.00 MiB");
    applyModelBufferLine(state, "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)");
    assert.deepStrictEqual(state.target, { gpuMiB: 0, cpuMiB: 0, found: false });
});

test("applyModelBufferLine ignores unrelated lines and the misleading layer count", () => {
    const state = ServerProcess.newModelBuffers();
    applyModelBufferLine(state, "load_tensors: offloaded 31/31 layers to GPU");
    applyModelBufferLine(state, "llama_context:        CPU  output buffer size =     4.00 MiB");
    assert.deepStrictEqual(state.target, { gpuMiB: 0, cpuMiB: 0, found: false });
});

test("start collects the buffer split from the server output", async () => {
    const child = fakeChild(88);
    const server = new ServerProcess({ serverBinary: "s", spawn: () => child, killTree: async () => {}, onLog: () => {} });
    server.start();
    child.stdout.write("load_tensors: loading model tensors, this can take a while...\n");
    child.stdout.write("load_tensors:   Vulkan0 model buffer size =  6450.00 MiB\n");
    child.stderr.write("load_tensors:   CPU_Mapped model buffer size = 12380.00 MiB\n");
    await tick();
    assert.deepStrictEqual(server.modelBuffers, {
        gpuMiB: 6450, cpuMiB: 12380, found: true,
        draft: { gpuMiB: 0, cpuMiB: 0, found: false }
    });
});

// The guard that keeps a misread buffer name off the status line. Their real case: 18.9 GiB
// reported as GPU on an 8 GiB card, which is impossible.
test("placementLooksPossible rejects a split larger than the card", () => {
    assert.strictEqual(placementLooksPossible({ gpuMiB: 19353, cpuMiB: 0, found: true }, 8192), false);
    assert.strictEqual(placementLooksPossible({ gpuMiB: 6450, cpuMiB: 12380, found: true }, 8192), true);
});

test("placementLooksPossible allows a little rounding headroom", () => {
    // Reported totals are rounded, so a hair over the card is not a reason to hide the split.
    assert.strictEqual(placementLooksPossible({ gpuMiB: 8300, cpuMiB: 0, found: true }, 8192), true);
});

test("placementLooksPossible declines when there is nothing to show or no card to check", () => {
    assert.strictEqual(placementLooksPossible(null, 8192), false);
    assert.strictEqual(placementLooksPossible({ gpuMiB: 0, cpuMiB: 0, found: false }, 8192), false);
    // An unknown card is no basis to doubt the split, so it is left to the renderer, which
    // still shows nothing when there is no GPU buffer at all.
    assert.strictEqual(placementLooksPossible({ gpuMiB: 6450, cpuMiB: 0, found: true }, null), true);
});

// Each model loads in its own buffer block, so the card check is applied to each on its own. A
// draft whose reported VRAM exceeds the card is the same mis-parse the target guard exists for;
// checking only the flattened top level would let it through.
test("placementLooksPossible checks the draft as well as the target", () => {
    const goodTarget = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true };
    assert.strictEqual(
        placementLooksPossible(Object.assign({}, goodTarget, { draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } }), 8192),
        true
    );
    assert.strictEqual(
        placementLooksPossible(Object.assign({}, goodTarget, { draft: { gpuMiB: 19353, cpuMiB: 0, found: true } }), 8192),
        false
    );
    // A not-found draft is simply absent, not implausible.
    assert.strictEqual(
        placementLooksPossible(Object.assign({}, goodTarget, { draft: { gpuMiB: 0, cpuMiB: 0, found: false } }), 8192),
        true
    );
});

test("sanitiseBuffers drops an implausible draft but keeps a valid target", () => {
    const buffers = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 19353, cpuMiB: 0, found: true } };
    const cleaned = sanitiseBuffers(buffers, 8192);
    assert.deepStrictEqual(cleaned, { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 19353, cpuMiB: 0, found: false } });
});

test("sanitiseBuffers drops everything when the target itself is implausible", () => {
    const buffers = { gpuMiB: 19353, cpuMiB: 0, found: true,
        draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } };
    assert.strictEqual(sanitiseBuffers(buffers, 8192), null);
    assert.strictEqual(sanitiseBuffers(null, 8192), null);
});

test("sanitiseBuffers leaves a plausible pair untouched", () => {
    const buffers = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } };
    assert.strictEqual(sanitiseBuffers(buffers, 8192), buffers);
    // Unknown card: no basis to doubt either split.
    assert.strictEqual(sanitiseBuffers(buffers, null), buffers);
});

// Real captured log lines. A draft loads as a SECOND model in the same child, announcing
// itself with "loading draft model". Before the fix the reset on each load discarded the
// target's totals, so the status line reported the draft's size as the model's placement.
const LOG_35B = [
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors: offloaded 41/41 layers to GPU",
    "load_tensors:   CPU_Mapped model buffer size = 13570.58 MiB",
    "load_tensors:   Vulkan0 model buffer size =  3150.05 MiB",
    "common_speculative_init_result: loading draft model '/m/draft.gguf'",
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors: offloaded 42/42 layers to GPU",
    "load_tensors:   CPU_Mapped model buffer size =   272.81 MiB",
    "load_tensors:   Vulkan0 model buffer size =   851.72 MiB"
].join("\n");

// The 4B case: the target loads FIRST, the draft second, and the draft is announced before
// its own buffer block. The target's number is the one that must be reported.
const LOG_4B = [
    "load_model: loading model '/m/target.gguf'",
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors:   CPU_Mapped model buffer size =   644.14 MiB",
    "load_tensors:   Vulkan0 model buffer size =  4264.29 MiB",
    "common_speculative_init_result: loading draft model '/m/draft2.gguf'",
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors:   Vulkan0 model buffer size =   642.96 MiB"
].join("\n");

// Draft-FIRST ordering: the announcement and the draft's own buffer block arrive before the
// target's load. Attribution must not assume the target is always the first model loaded.
const LOG_DRAFT_FIRST = [
    "common_speculative_init_result: loading draft model '/m/draft.gguf'",
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors:   CPU_Mapped model buffer size =   272.81 MiB",
    "load_tensors:   Vulkan0 model buffer size =   851.72 MiB",
    "load_model: loading model '/m/target.gguf'",
    "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
    "load_tensors:   CPU_Mapped model buffer size = 13570.58 MiB",
    "load_tensors:   Vulkan0 model buffer size =  3150.05 MiB"
].join("\n");

function parseLog(text) {
    const st = ServerProcess.newModelBuffers();
    for (const line of text.split("\n")) ServerProcess.applyModelBufferLine(st, line);
    return ServerProcess.flattenModelBuffers(st);
}

test("target buffers are reported, not the draft's (35B)", () => {
    const b = parseLog(LOG_35B);
    assert.strictEqual(b.gpuMiB, 3150.05, "target GPU bytes, not the draft's 851.72");
    assert.strictEqual(b.cpuMiB, 13570.58, "target host bytes, not the draft's 272.81");
    assert.strictEqual(b.found, true);
});

test("draft buffers are reported separately (35B)", () => {
    const b = parseLog(LOG_35B);
    assert.strictEqual(b.draft.gpuMiB, 851.72);
    assert.strictEqual(b.draft.cpuMiB, 272.81);
    assert.strictEqual(b.draft.found, true);
});

test("target buffers are reported when the target loads first (4B)", () => {
    const b = parseLog(LOG_4B);
    assert.strictEqual(b.gpuMiB, 4264.29, "target, not the draft's 642.96");
    assert.strictEqual(b.cpuMiB, 644.14);
    assert.strictEqual(b.draft.gpuMiB, 642.96);
});

test("draft loads first and the target loads second: each keeps its own totals", () => {
    const b = parseLog(LOG_DRAFT_FIRST);
    assert.strictEqual(b.gpuMiB, 3150.05, "target GPU, loaded after the draft");
    assert.strictEqual(b.cpuMiB, 13570.58, "target host, loaded after the draft");
    assert.strictEqual(b.found, true);
    assert.strictEqual(b.draft.gpuMiB, 851.72);
    assert.strictEqual(b.draft.cpuMiB, 272.81);
    assert.strictEqual(b.draft.found, true);
});

test("a single model with no draft leaves draft not-found", () => {
    const b = parseLog([
        "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
        "load_tensors:   Vulkan0 model buffer size =  3000.00 MiB"
    ].join("\n"));
    assert.strictEqual(b.gpuMiB, 3000);
    assert.strictEqual(b.draft.found, false);
});

// --- Engine fit report capture -------------------------------------------------------------
// The status card's Fit: line is the engine's own placement decision, captured raw. These
// lines follow the trace wording of common/fit.cpp: decision lines carry the
// common_params_fit_impl prefix, and every measured trial prints a memory breakdown table
// (only the last one - the winning placement - is kept).

function fitLog(lines) {
    const r = newFitReport();
    for (const line of lines) applyFitLine(r, line);
    return r;
}

test("fit capture keeps the decisive lines and skips per-trial measurements", () => {
    const r = fitLog([
        "trs: common_params_fit_impl: getting device memory data for initial parameters:",
        "trs: common_params_fit_impl: projected to use 6619 MiB of device memory vs. 5877 MiB of free device memory",
        "trs: common_params_fit_impl: id=0, n_layer=27, n_part= 0, overflow_type=4, mem= 5865 MiB",
        "trs: common_params_fit_impl: cannot meet free memory target of 0 MiB, need to reduce device memory by 742 MiB",
        "trs: common_params_fit_impl:   - CUDA0 (GeForce GTX 1080): 27 layers,  5865 MiB used,   12 MiB free"
    ]);
    assert.strictEqual(r.lines.length, 3);
    assert.match(r.lines[0], /projected to use 6619 MiB of device memory vs\. 5877 MiB of free device memory/);
    assert.match(r.lines[1], /cannot meet free memory target of 0 MiB, need to reduce device memory by 742 MiB/);
    assert.match(r.lines[2], /27 layers,\s+5865 MiB used,\s+12 MiB free/);
});

test("fit capture keeps only the last memory breakdown table", () => {
    const r = fitLog([
        "trs: common_memory_breakdown_print: | memory breakdown [MiB] |  total | free | ... |",
        "trs: common_memory_breakdown_print: |  - CUDA0 (GTX 1080): | 8192 | 5877 | 5865 = 4200 + ( ... ) + 300 |",
        "trs: common_memory_breakdown_print: | memory breakdown [MiB] |  total | free | ... |",
        "trs: common_memory_breakdown_print: |  - CUDA0 (GTX 1080): | 8192 |   12 | 5877 = 4800 + ( ... ) + 300 |"
    ]);
    assert.strictEqual(r.breakdown.length, 1);
    assert.match(r.breakdown[0], /4800/);
    assert.doesNotMatch(r.breakdown[0], /4200/);
});

test("fit capture ignores non-fit log lines", () => {
    const r = fitLog([
        "load_tensors: loading model tensors, this can take a while... (load_mode = mmap)",
        "srv update_slots: prompt caching is enabled"
    ]);
    assert.strictEqual(r.lines.length, 0);
    assert.strictEqual(r.breakdown.length, 0);
});

test("fit capture attributes each offloaded line to the model block it belongs to", () => {
    const r = newFitReport();
    applyFitLine(r, "load_tensors: loading model tensors, this can take a while... (mmap)", "draft");
    applyFitLine(r, "load_tensors: offloaded 16/16 layers to GPU", "draft");
    applyFitLine(r, "load_tensors:   CUDA0 model buffer size =   615.00 MiB", "draft");
    applyFitLine(r, "load_tensors: loading model tensors, this can take a while... (mmap)", "target");
    applyFitLine(r, "load_tensors: offloaded 33/33 layers to GPU", "target");
    assert.deepStrictEqual(r.offloaded, [
        { model: "draft", n: 16, m: 16 },
        { model: "target", n: 33, m: 33 }
    ]);
    assert.strictEqual(r.lines.length, 0);
});
