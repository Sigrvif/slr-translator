"use strict";
const test = require("node:test");
const assert = require("node:assert");
const RuntimeStatus = require("../lib/RuntimeStatus");

test("describeSpec names the draft and block size when a pair is configured", () => {
    const line = RuntimeStatus.describeSpec({
        id: "qwen35-4b-paperwitch-q8.gguf",
        draftPath: "/models/qwen35-4b-dflash-Q8_0.gguf",
        specType: "draft-dflash",
        specDraftNMax: 16
    });
    assert.strictEqual(
        line,
        "Speculative decoding: draft-dflash (draft qwen35-4b-dflash-Q8_0.gguf, n-max 16, n-min 0)"
    );
});

test("describeSpec reports the applied n-max and n-min when present", () => {
    const line = RuntimeStatus.describeSpec({
        id: "qwen35-4b-paperwitch-q8.gguf",
        draftPath: "/models/qwen35-4b-dflash-Q8_0.gguf",
        specType: "draft-dflash",
        specDraftNMax: 2,
        specDraftNMin: 1
    });
    assert.strictEqual(
        line,
        "Speculative decoding: draft-dflash (draft qwen35-4b-dflash-Q8_0.gguf, n-max 2, n-min 1)"
    );
});

test("describeSpec reports no pairing when the entry has no draft", () => {
    assert.strictEqual(
        RuntimeStatus.describeSpec({ id: "plain.gguf" }),
        "Speculative decoding: none (no draft model detected for this model)"
    );
    assert.strictEqual(
        RuntimeStatus.describeSpec(null),
        "Speculative decoding: none (no draft model detected for this model)"
    );
});

test("describeSpec names an MTP head built into the model, with the bounds it runs under", () => {
    // No bounds on the entry (defensive; the registry always sets them now): the plain line.
    assert.strictEqual(
        RuntimeStatus.describeSpec({ id: "qwen35-4b-paperwitch-q8.gguf", specType: "draft-mtp" }),
        "Speculative decoding: draft-mtp (head built into the model)"
    );
    // The token fields bound an embedded head exactly like a paired draft, and the status
    // must show the numbers so a user tuning them can tell they took effect.
    assert.strictEqual(
        RuntimeStatus.describeSpec({
            id: "qwen35-4b-paperwitch-q8.gguf",
            specType: "draft-mtp",
            specDraftNMax: 2,
            specDraftNMin: 0
        }),
        "Speculative decoding: draft-mtp (head built into the model, n-max 2, n-min 0)"
    );
});

test("describe renders state, model, spec line and measured acceptance", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", device: null, baseUrl: "http://127.0.0.1:8730" },
        entry: {
            id: "target.gguf",
            draftPath: "/models/draft.gguf",
            specType: "draft-dflash",
            specDraftNMax: 15
        },
        metrics: { draftTokens: 400, acceptedTokens: 250, drafts: 40, acceptance: 0.625 }
    });
    assert.match(text, /^Status: ready$/m);
    assert.match(text, /^Backend: cpu$/m);
    assert.match(text, /^URL: http:\/\/127\.0\.0\.1:8730$/m);
    assert.match(text, /^Model: target\.gguf$/m);
    assert.match(text, /^Speculative decoding: draft-dflash \(draft draft\.gguf, n-max 15, n-min 0\)$/m);
    assert.match(text, /^Draft acceptance: 62\.5% \(250 accepted \/ 400 draft tokens\)$/m);
});

test("describe includes the device in the backend line when present", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "vulkan", device: "Vulkan0", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^Backend: vulkan \(Vulkan0\)$/m);
});

// A cpu fallback on a machine with a working GPU read as a contradiction: the Offload line
// showed real VRAM buffers while the Backend line said cpu. Name the cause where the user
// looks, and tell them the escape hatch.
test("describe explains a cpu fallback in the backend line", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", backendReason: "cpu-fallback", device: null, baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^Backend: cpu \(no GPU detected at start/m);
});

// A CPU the user forced is a choice, not a detection failure: it must not wear the
// "no GPU detected" hint.
test("describe marks a forced cpu as forced, without the no-GPU hint", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", backendReason: "cpu-forced", device: null, baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^Backend: cpu \(forced by the backend option\)$/m);
});

test("a cpu backend without the fallback reason renders plain", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", device: null, baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^Backend: cpu$/m);
});

test("describe appends state.error", () => {
    const text = RuntimeStatus.describe({
        state: { status: "error", backend: "cpu", baseUrl: null, error: "payload corrupted" },
        entry: null
    });
    assert.match(text, /^Error: payload corrupted$/m);
});

test("describe appends state.note", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", baseUrl: "http://x", note: "GPU backend failed; running on CPU." },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^GPU backend failed; running on CPU\.$/m);
});

test("describe falls back to state.modelId and then - when no entry exists", () => {
    const withId = RuntimeStatus.describe({
        state: { status: "ready", modelId: "state-model.gguf", baseUrl: "http://x" },
        entry: null
    });
    assert.match(withId, /^Model: state-model\.gguf$/m);
    const noId = RuntimeStatus.describe({ state: { status: "stopped" }, entry: null });
    assert.match(noId, /^Model: -$/m);
    assert.match(noId, /^Speculative decoding: none \(no draft model detected for this model\)$/m);
    assert.doesNotMatch(noId, /Draft acceptance/);
});

test("describe reports the entry context size", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", contextSize: 8192 }
    });
    assert.match(text, /^Context: 8192$/m);
});

test("describe reports the context as - when the entry has none", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(text, /^Context: -$/m);
});

test("describe reports the KV cache type when provided", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", contextSize: 32768 },
        kvType: "q8_0"
    });
    assert.match(text, /^KV cache: q8_0$/m);
});

test("describe omits the KV cache line when kvType is absent", () => {
    for (const kvType of [undefined, null, ""]) {
        const text = RuntimeStatus.describe({
            state: { status: "ready", baseUrl: "http://x" },
            entry: { id: "m.gguf", contextSize: 32768 },
            kvType
        });
        assert.doesNotMatch(text, /KV cache:/);
    }
});

test("describeOffload names only the settings the entry carries", () => {
    assert.strictEqual(RuntimeStatus.describeOffload({ id: "m.gguf" }), "Offload: GPU layers: auto");
    assert.strictEqual(
        RuntimeStatus.describeOffload({ id: "m.gguf", gpuLayers: 0 }),
        "Offload: GPU layers: 0"
    );
    assert.strictEqual(
        RuntimeStatus.describeOffload({
            id: "m.gguf", gpuLayers: 24, cpuMoeLayers: 10, splitMode: "layer", mainGpu: 0
        }),
        "Offload: GPU layers: 24, MoE experts: first 10 layer(s) on CPU, split: layer, main GPU: 0"
    );
    assert.strictEqual(
        RuntimeStatus.describeOffload({ id: "m.gguf", cpuMoe: true }),
        "Offload: GPU layers: auto, MoE experts: all on CPU"
    );
});

test("describe includes the offload line", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", contextSize: 4096, gpuLayers: 24, cpuMoeLayers: 8 }
    });
    assert.match(text, /^Offload: GPU layers: 24, MoE experts: first 8 layer\(s\) on CPU$/m);
});

test("describeKv describes placement and describe renders it", () => {
    assert.strictEqual(
        RuntimeStatus.describeKv({ type: "q8_0", unified: true, offload: true }),
        "KV placement: q8_0, unified, in VRAM"
    );
    assert.strictEqual(
        RuntimeStatus.describeKv({ type: null, unified: false, offload: false }),
        "KV placement: per-slot, in system RAM"
    );
    assert.strictEqual(RuntimeStatus.describeKv(null), null);
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        kvType: "q8_0",
        kv: { type: "q8_0", unified: true, offload: true }
    });
    assert.match(text, /^KV placement: q8_0, unified, in VRAM$/m);
});

test("describe renders throughput and prompt-cache reuse when runtime metrics exist", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        runtime: {
            predictedTokensPerSecond: 12.34, promptTokensPerSecond: 25,
            promptTokens: 1000, promptTokensCached: 750, cacheReuse: 0.75
        }
    });
    assert.match(text, /^Throughput: 12\.3 tok\/s generation, 25 tok\/s prompt$/m);
    assert.match(text, /^Prompt cache reuse: 75% \(750 \/ 1000 prompt tokens\)$/m);
});

test("describe falls back to the counter average when the live gauges have reset", () => {
    // llama-server zeroes the per-second gauges as soon as the slot goes idle; the counters
    // survive, so the average is what keeps the line meaningful instead of reading 0.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        runtime: {
            predictedTokensPerSecond: 0, promptTokensPerSecond: 0,
            predictedTokens: 24, predictedSeconds: 4.79039,
            promptTokens: 491, promptSeconds: 20,
            promptTokensCached: 0, cacheReuse: 0
        }
    });
    assert.match(text, /^Throughput \(average\): 5 tok\/s generation, 24\.6 tok\/s prompt$/m);
});

test("describe prefers the live gauge while it is still reporting", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        runtime: {
            predictedTokensPerSecond: 12.34, promptTokensPerSecond: 25,
            predictedTokens: 24, predictedSeconds: 4.79,
            promptTokens: 491, promptSeconds: 20
        }
    });
    assert.match(text, /^Throughput: 12\.3 tok\/s generation, 25 tok\/s prompt$/m);
    assert.doesNotMatch(text, /average/);
});

test("describe omits the throughput line before anything has been measured", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        runtime: {
            predictedTokensPerSecond: 0, promptTokensPerSecond: 0,
            predictedTokens: 0, predictedSeconds: 0,
            promptTokens: 0, promptSeconds: 0
        }
    });
    assert.doesNotMatch(text, /Throughput/);
});

test("describe omits the throughput and cache lines without runtime metrics", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.doesNotMatch(text, /Throughput:/);
    assert.doesNotMatch(text, /Prompt cache reuse:/);
});

test("describe names a model that is still loading", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loading", prompt: null }
    });
    assert.match(text, /^Model state: loading into memory\.\.\.$/m);
});

test("describe reports the prompt phase with its real progress and elapsed time", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loaded", activity: { phase: "prompt", slots: 1, promptTokens: 2048, promptProcessed: 512, elapsedMs: 12000 } }
    });
    assert.doesNotMatch(text, /Model state:/);
    assert.match(text, /^Processing prompt: 25% \(512 \/ 2048 tokens\) - 12s so far$/m);
});

test("describe reports generation with the real decoded count", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loaded", activity: { phase: "generating", slots: 1, decoded: 37, remain: 59 } }
    });
    assert.match(text, /^Generating: 37 tokens \(59 left\)$/m);
    assert.doesNotMatch(text, /Processing prompt/);
});

test("describe omits the remaining count when it is unknown", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loaded", activity: { phase: "generating", slots: 1, decoded: 5, remain: 0 } }
    });
    assert.match(text, /^Generating: 5 tokens$/m);
});

test("describe shows the prompt line without a duration when none is measured", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loaded", activity: { phase: "prompt", slots: 1, promptTokens: 512, promptProcessed: 128 } }
    });
    assert.match(text, /^Processing prompt: 25% \(128 \/ 512 tokens\)$/m);
});

test("describe shows the prompt line as starting when the size is not yet known", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "loaded", activity: { phase: "prompt", slots: 1, promptTokens: 0, promptProcessed: 0 } }
    });
    assert.match(text, /^Processing prompt: starting\.\.\.$/m);
});

test("describe reports a model state other than loaded or loading", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        progress: { model: "unloaded", prompt: null }
    });
    assert.match(text, /^Model state: unloaded$/m);
});

test("describe omits progress lines when progress is absent", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.doesNotMatch(text, /Model state:/);
    assert.doesNotMatch(text, /Processing prompt:/);
});

test("describe reports an applied expert-count override", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        expert: { count: 3, available: 128, arch: "gemma4" }
    });
    assert.match(text, /^Experts used: 3 of 128 per token \(metadata override gemma4\.expert_used_count\)$/m);
});

test("describe omits the expert line when no override was applied", () => {
    for (const expert of [undefined, null]) {
        const text = RuntimeStatus.describe({
            state: { status: "ready", baseUrl: "http://x" },
            entry: { id: "m.gguf" },
            expert
        });
        assert.doesNotMatch(text, /Experts used:/);
    }
});

test("describe reports whether a custom chat template is in use", () => {
    const custom = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        template: "/data/llama/templates/m.gguf.jinja"
    });
    assert.match(custom, /^Chat template: custom \(m\.gguf\.jinja\)$/m);

    const model = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.match(model, /^Chat template: the model's own$/m);
});

test("describe reports an extra library folder when one is configured", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        libDir: "/home/me/myrocm/lib"
    });
    assert.match(text, /^Extra library folder: \/home\/me\/myrocm\/lib$/m);

    const none = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.doesNotMatch(none, /Extra library folder:/);
});

test("describeServer reports the non-default server settings and summarises the defaults", () => {
    const custom = RuntimeStatus.describeServer({
        modelsMax: 3, sleepIdleSeconds: 600, hasSleepSetting: true, threads: 8, threadsBatch: 12
    });
    assert.match(custom, /^Server: models resident: 3, unload after 10m 0s idle, threads: 8 \/ batch 12$/);

    const defaults = RuntimeStatus.describeServer({
        modelsMax: 1, sleepIdleSeconds: 0, hasSleepSetting: true, threads: 0, threadsBatch: 0
    });
    assert.match(defaults, /^Server: stays loaded$/);
});

test("describeServer names a single thread count once when batch matches", () => {
    const text = RuntimeStatus.describeServer({ modelsMax: 1, sleepIdleSeconds: 0, threads: 6, threadsBatch: 6 });
    assert.match(text, /^Server: threads: 6$/);
});

test("describe includes the server line and names the load mode in the offload line", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: 0, loadMode: "none" },
        server: { modelsMax: 1, sleepIdleSeconds: 0, hasSleepSetting: true, threads: 0 }
    });
    assert.match(text, /^Offload: .*load mode: none$/m);
    assert.match(text, /^Server: stays loaded$/m);
});

test("describe never writes a load mode that is not in effect", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: 0 }
    });
    assert.doesNotMatch(text, /load mode:/);
});


// Auto settings should report what they settled on, so the status line answers "what did it
// pick" instead of leaving the user to guess from a bare "auto".
test("describeOffload reports where the model actually ended up, marked as auto", () => {
    const text = RuntimeStatus.describeOffload({ gpuLayers: "auto" }, { gpuMiB: 6450, cpuMiB: 12380, found: true });
    assert.match(text, /^Offload: GPU layers: auto \(6\.3 GiB on GPU, 12\.1 GiB on CPU\)$/);
});

test("describeOffload shows a plain auto when no GPU buffer exists", () => {
    // A CPU-only start has no device buffer, so there is no split worth reporting. This is
    // also what keeps the misleading "every layer on GPU" reading from appearing.
    assert.match(RuntimeStatus.describeOffload({ gpuLayers: "auto" }, null), /^Offload: GPU layers: auto$/);
    assert.match(RuntimeStatus.describeOffload({ gpuLayers: "auto" }, { gpuMiB: 0, cpuMiB: 18776, found: true }), /^Offload: GPU layers: auto$/);
});

test("describeOffload reports the measured split for a manual layer count too", () => {
    // The buffers are the only proof a manual count did what the user expected, so the line
    // annotates a manual count exactly like an auto one (the verbosity that produces the
    // buffer report is unconditional). A manual count is never labelled "(auto)".
    const text = RuntimeStatus.describeOffload({ gpuLayers: 20 }, { gpuMiB: 6450, cpuMiB: 12380, found: true });
    assert.match(text, /GPU layers: 20 \(6\.3 GiB on GPU, 12\.1 GiB on CPU\)/);
    assert.doesNotMatch(text, /\(auto\)/);
    // Without buffer metrics the line stays a bare count rather than inventing numbers.
    assert.match(RuntimeStatus.describeOffload({ gpuLayers: 20 }, null), /^Offload: GPU layers: 20/);
});

test("describeOffload marks a runtime-chosen load mode and leaves a user's choice unmarked", () => {
    const auto = RuntimeStatus.describeOffload({ gpuLayers: "auto", loadMode: "none", loadModeAuto: true });
    assert.match(auto, /load mode: none \(auto\)/);
    // Auto settling on the default is still reported, which is the case that used to show nothing.
    const fallback = RuntimeStatus.describeOffload({ gpuLayers: "auto", loadMode: "mmap", loadModeAuto: true });
    assert.match(fallback, /load mode: mmap \(auto\)/);
    const chosen = RuntimeStatus.describeOffload({ gpuLayers: "auto", loadMode: "mmap", loadModeAuto: false });
    assert.match(chosen, /load mode: mmap$/);
    assert.doesNotMatch(chosen, /\(auto\)/);
});

test("describe passes the buffer split through to the offload line", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: "auto", loadMode: "none", loadModeAuto: true },
        buffers: { gpuMiB: 6450, cpuMiB: 12380, found: true }
    });
    assert.match(text, /^Offload: GPU layers: auto \(6\.3 GiB on GPU, 12\.1 GiB on CPU\), load mode: none \(auto\)$/m);
});

test("an attached runtime says so, and does not claim to be owned by this window", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", device: null, baseUrl: "http://127.0.0.1:1234", modelId: "m1", attached: true }
    });
    assert.match(text, /Status: ready \(attached\)/);
});

test("a runtime this window owns is reported plainly", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", backend: "cpu", device: null, baseUrl: "http://127.0.0.1:1234", modelId: "m1" }
    });
    assert.match(text, /^Status: ready$/m);
});

// Task 10: the loaded model's own /slots, read through the front door, supplies n_ctx and
// is_processing; the status line names which model is loaded.
test("describe names the loaded model and reads its n_ctx and is_processing from slots", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "a.gguf", contextSize: 4096 },
        loadedId: "b.gguf",
        slots: [
            { id: 0, n_ctx: 8192, is_processing: false },
            { id: 1, n_ctx: 8192, is_processing: true }
        ]
    });
    assert.match(text, /^Model: a\.gguf$/m);
    assert.match(text, /^Loaded model: b\.gguf$/m);
    assert.match(text, /^Context: 8192$/m);
    assert.match(text, /^Slots: processing$/m);
});

test("describe reports the loaded model's own n_ctx over the entry's configured value", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "a.gguf", contextSize: 4096 },
        loadedId: "a.gguf",
        slots: [{ id: 0, n_ctx: 2048, is_processing: false }]
    });
    assert.match(text, /^Context: 2048$/m);
    assert.match(text, /^Slots: idle$/m);
});

test("describe falls back to the configured context when no slots are available", () => {
    // A /slots read with nothing loaded answers 503 (an error object), not a slot list; the
    // status line then shows the configured value exactly as before.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "a.gguf", contextSize: 4096 },
        loadedId: null,
        slots: { error: { message: "no model is loaded" } }
    });
    assert.match(text, /^Context: 4096$/m);
    assert.doesNotMatch(text, /Loaded model:/);
    assert.doesNotMatch(text, /Slots:/);
});

test("summariseSlots rejects anything that is not a slot list", () => {
    assert.strictEqual(RuntimeStatus.summariseSlots(undefined), null);
    assert.strictEqual(RuntimeStatus.summariseSlots(null), null);
    assert.strictEqual(RuntimeStatus.summariseSlots([]), null);
    assert.strictEqual(RuntimeStatus.summariseSlots({ error: { message: "no model is loaded" } }), null);
    assert.deepStrictEqual(RuntimeStatus.summariseSlots([{ n_ctx: 0 }]), { nCtx: null, processing: false });
});

test("offload line reports the target when a draft is present", () => {
    const entry = { gpuLayers: "auto" };
    const buffers = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } };
    const line = RuntimeStatus.describeOffload(entry, buffers);
    assert.match(line, /^Offload: GPU layers: auto \(3\.1 GiB on GPU, 13\.3 GiB on CPU\)$/);
});

test("draft offload line is rendered separately", () => {
    const entry = { gpuLayers: "auto" };
    const buffers = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } };
    const line = RuntimeStatus.describeDraftOffload(entry, buffers);
    assert.match(line, /^Draft offload: GPU layers: auto \(0\.8 GiB on GPU, 0\.3 GiB on CPU\)$/);
});

test("draft line is null when there is no draft", () => {
    const buffers = { gpuMiB: 3000, cpuMiB: 0, found: true, draft: { gpuMiB: 0, cpuMiB: 0, found: false } };
    assert.strictEqual(RuntimeStatus.describeDraftOffload({ gpuLayers: "auto" }, buffers), null);
});

test("describeDraftOffload tolerates the old flat buffer shape (no draft key)", () => {
    // The pre-Task-1 shape carried no `.draft` key at all; the draft line must be absent
    // rather than rendered from undefined. (The target's own rendering of this shape is
    // already covered by the pre-existing test above, so only the new behaviour is asserted.)
    assert.strictEqual(
        RuntimeStatus.describeDraftOffload({ gpuLayers: "auto" }, { gpuMiB: 6450, cpuMiB: 12380, found: true }),
        null
    );
});

test("describe renders the draft offload line from the draft's own placement", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: "auto" },
        buffers: { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
            draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } }
    });
    assert.match(text, /^Offload: GPU layers: auto \(3\.1 GiB on GPU, 13\.3 GiB on CPU\)$/m);
    assert.match(text, /^Draft offload: GPU layers: auto \(0\.8 GiB on GPU, 0\.3 GiB on CPU\)$/m);
    // The target's line must never carry the draft's figures.
    assert.doesNotMatch(text, /^Offload: GPU layers: auto \(0\.8 GiB on GPU/m);
});

test("draft label reads the draft's own layer setting, not the target's", () => {
    const entry = { gpuLayers: "auto", draftGpuLayers: 7 };
    const buffers = { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
        draft: { gpuMiB: 851.72, cpuMiB: 272.81, found: true } };
    assert.match(
        RuntimeStatus.describeOffload(entry, buffers),
        /^Offload: GPU layers: auto \(3\.1 GiB on GPU, 13\.3 GiB on CPU\)$/
    );
    assert.match(
        RuntimeStatus.describeDraftOffload(entry, buffers),
        /^Draft offload: GPU layers: 7 \(0\.8 GiB on GPU, 0\.3 GiB on CPU\)$/
    );
});

test("a draft that failed the card check renders no draft line, target still does", () => {
    // This is what sanitiseBuffers() hands the renderer when the draft's reported VRAM exceeds
    // the card: `found` cleared, so the draft line is omitted while the target's split stands.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: "auto" },
        buffers: { gpuMiB: 3150.05, cpuMiB: 13570.58, found: true,
            draft: { gpuMiB: 19353, cpuMiB: 0, found: false } }
    });
    assert.match(text, /^Offload: GPU layers: auto \(3\.1 GiB on GPU, 13\.3 GiB on CPU\)$/m);
    assert.doesNotMatch(text, /Draft offload:/);
});

test("a captured fit report renders as compact wording with the reconciliation clause", () => {
    // Dense, fully assigned: the card translates the engine's decision and explains the small
    // CPU-side host-buffer remainder, so "everything assigned" and "0.6 GiB on CPU" cannot read
    // as a contradiction.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: "auto" },
        buffers: { gpuMiB: 4300, cpuMiB: 615, found: true,
            draft: { gpuMiB: 615, cpuMiB: 0, found: true } },
        fit: {
            offloaded: [
                { model: "target", n: 33, m: 33 },
                { model: "draft", n: 7, m: 7 }
            ],
            lines: [
                "trs: common_params_fit_impl: projected to use 5621 MiB of device memory vs. 6583 MiB of free device memory",
                "trs: common_params_fit_impl: will leave 961 >= 512 MiB of free device memory, no changes needed"
            ]
        }
    });
    const line = text.split("\n").find((l) => l.startsWith("Fit:"));
    assert.ok(line, "a Fit: line is rendered below the offload lines");
    assert.strictEqual(line,
        "Fit: 5621 of 6583 MiB free used; fits with 961 spare (512 requested); " +
        "all 33 target units assigned to the GPU; draft 7/7 assigned; " +
        "the 0.6 GiB on CPU is backend-placed host-buffer weights, not a fit remainder.");
    assert.ok(line.indexOf("common_params_fit_impl") === -1, "no raw function prefixes on the card");
});

test("a large MoE model renders the expert-weights explanation, not the host-buffer one", () => {
    // Regression: for a MoE model far larger than the card, fit keeps the expert tensors in
    // system RAM and still assigns every layer ("41/41"). The old wording called that CPU share
    // "backend-placed host-buffer weights, not a fit remainder", which was wrong here - it IS
    // the fit decision. The model's own expertCount/arch selects this explanation, so it also
    // works on manual layer counts where the fit MoE trace never prints.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "big.gguf", gpuLayers: "auto", arch: "qwen35moe", expertCount: 256 },
        buffers: { gpuMiB: 2150, cpuMiB: 11776, found: true,
            draft: { gpuMiB: 819, cpuMiB: 307, found: true } },
        fit: {
            offloaded: [
                { model: "target", n: 41, m: 41 },
                { model: "draft", n: 42, m: 42 }
            ],
            lines: [
                "trs: common_params_fit_impl: projected to use 15975 MiB of device memory vs. 5882 MiB of free device memory",
                "trs: common_params_fit_impl: cannot meet free memory target of 512 MiB, need to reduce device memory by 11435 MiB",
                "trs: common_params_fit_impl: with only dense weights in device memory there is a total surplus of 900 MiB"
            ]
        }
    });
    const line = text.split("\n").find((l) => l.startsWith("Fit:"));
    assert.strictEqual(line,
        "Fit: 15975 of 5882 MiB free needed; 11435 MiB over; " +
        "the 11.5 GiB on CPU is dominated by the expert weights - on a card much smaller than the model the experts stay in system RAM, and the loader still assigns all 41 target layers (assignment, not placement); " +
        "draft 42/42 assigned; the draft's 0.3 GiB on CPU is host-buffer placement at full assignment.");
});

test("a fit deficit renders as over-budget with the partial assignment", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: "auto" },
        buffers: { gpuMiB: 4200, cpuMiB: 717, found: true,
            draft: { gpuMiB: 615, cpuMiB: 0, found: true } },
        fit: {
            offloaded: [
                { model: "target", n: 27, m: 33 },
                { model: "draft", n: 7, m: 7 }
            ],
            lines: [
                "trs: common_params_fit_impl: projected to use 6619 MiB of device memory vs. 5877 MiB of free device memory",
                "trs: common_params_fit_impl: cannot meet free memory target of 512 MiB, need to reduce device memory by 742 MiB"
            ]
        }
    });
    const line = text.split("\n").find((l) => l.startsWith("Fit:"));
    assert.strictEqual(line,
        "Fit: 6619 of 5877 MiB free needed; 742 MiB over; " +
        "27 of 33 target units assigned to the GPU; draft 7/7 assigned.");
    // Partial assignment: the CPU weights are expected, so no reconciliation clause.
    assert.doesNotMatch(line, /not a fit remainder/);
});

test("no captured fit report renders no Fit: line", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" }
    });
    assert.ok(text.split("\n").every((l) => !l.startsWith("Fit:")));
});

test("an offloaded-only report (manual count short-circuits fit) still renders the assignment", () => {
    // With the layer count set by hand the fit search never runs, but the loader still prints
    // what it assigned - the arbiter when the requested count and the buffers disagree.
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf", gpuLayers: 33 },
        buffers: { gpuMiB: 4300, cpuMiB: 615, found: true,
            draft: { gpuMiB: 615, cpuMiB: 0, found: true } },
        fit: { lines: [], offloaded: [{ model: "target", n: 33, m: 33 }, { model: "draft", n: 7, m: 7 }] }
    });
    const line = text.split("\n").find((l) => l.startsWith("Fit:"));
    assert.match(line, /all 33 target units assigned to the GPU/);
    assert.match(line, /draft 7\/7 assigned/);
    // Full assignment with CPU weights present: the contradiction is addressed on the card.
    assert.match(line, /not a fit remainder/);
});

test("unknown fit wording falls back to the raw captured lines", () => {
    const text = RuntimeStatus.describe({
        state: { status: "ready", baseUrl: "http://x" },
        entry: { id: "m.gguf" },
        fit: { lines: ["trs: common_params_fit_impl: some future decision wording 12 MiB"],
            offloaded: [] }
    });
    const line = text.split("\n").find((l) => l.startsWith("Fit:"));
    assert.match(line, /some future decision wording 12 MiB/);
});

test("describeSpec reports an explicitly disabled speculation instead of a missing draft", () => {
    // A model whose detection pairs a draft but whose profile sets specMode "off" must not be
    // described as "no draft model detected" - the draft exists, the user turned it off.
    assert.strictEqual(
        RuntimeStatus.describeSpec({ id: "m.gguf", specOff: true }),
        "Speculative decoding: off (disabled for this model)"
    );
    // A cleared overlay (start applied no draft) still reads as none.
    assert.strictEqual(
        RuntimeStatus.describeSpec({ id: "m.gguf", draftPath: null, specType: null }),
        "Speculative decoding: none (no draft model detected for this model)"
    );
});
