"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ModelArgs = require("../lib/ModelArgs");

const ENTRY = {
    id: "MiniCPM5-2B-heretic-abliterated-Q8_0.gguf",
    modelPath: "/models/MiniCPM5.gguf",
    arch: "llama", expertCount: null,
    contextSize: 32768, gpuLayers: 0, kvTypeK: "q8_0", kvTypeV: "q8_0",
    loadMode: "mmap", cpuMoe: false, cpuMoeLayers: "", splitMode: "", tensorSplit: "",
    mainGpu: "", overrideTensor: ""
};
const GLOBALS = { host: "127.0.0.1", port: 41234, threads: 6, cacheRamMiB: 4096, ctxCheckpoints: 16 };

function has(args, flag, value) {
    const i = args.indexOf(flag);
    return i !== -1 && (value === undefined || args[i + 1] === String(value));
}

test("emits the model's own settings as real arguments", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, GLOBALS);
    assert.ok(has(a, "-m", "/models/MiniCPM5.gguf"));
    assert.ok(has(a, "--alias", ENTRY.id));
    assert.ok(has(a, "--host", "127.0.0.1"));
    assert.ok(has(a, "--port", 41234));
    assert.ok(has(a, "-c", 32768));
    assert.ok(has(a, "-ngl", 0));
    assert.ok(has(a, "--cache-type-k", "q8_0"));
    assert.ok(has(a, "--cache-type-v", "q8_0"));
    assert.ok(has(a, "--load-mode", "mmap"));
    assert.ok(has(a, "--threads", 6));
    assert.ok(has(a, "--metrics"));
    assert.ok(has(a, "--jinja"));
    assert.ok(has(a, "--offline"));
});
test("omits every setting the model has not set", () => {
    const a = ModelArgs.buildModelArgs({ id: "x.gguf", modelPath: "/m/x.gguf" }, GLOBALS);
    for (const flag of ["-c", "-ngl", "--cache-type-k", "--cache-type-v", "--batch-size", "--ubatch-size", "--load-mode", "--override-tensor", "--split-mode", "--tensor-split", "--main-gpu", "--override-kv", "--model-draft", "--spec-type", "--spec-draft-type-k", "--spec-draft-type-v", "--spec-draft-p-min", "--moe-cache-mib", "--spec-draft-n-ubatch", "--mmproj", "--chat-template-file"]) {
        assert.strictEqual(a.indexOf(flag), -1, flag + " must be omitted when unset");
    }
});
test("never emits the tuning knob the retired preset parser rejected", () => {
    // Moved from Preset.test.js: the old INI generator carefully omitted spec-draft-conf-min
    // because the pinned engine's preset parser refused it. The per-model CLI path has no
    // --spec-draft-conf-min flag, and must never grow one. (spec-draft-p-min is a real flag on
    // this engine and is covered by the p-min tests below.)
    const a = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, {
        specType: "draft-mtp", specDraftConfMin: 0, specDraftPMin: 0.5
    }), GLOBALS);
    assert.strictEqual(a.indexOf("--spec-draft-conf-min"), -1, "--spec-draft-conf-min must never be emitted");
});
test("always raises verbosity so the placement report is parseable", () => {
    // The Offload/Draft offload status lines are parsed from the per-buffer placement llama.cpp
    // prints only at debug verbosity, and that report is the only way to verify a placement
    // choice worked. That holds for an explicit layer count exactly as for auto (a user who
    // forces -ngl 32 must be able to see where the weights went), so the report is unconditional.
    const auto = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { gpuLayers: "auto" }), GLOBALS);
    assert.ok(has(auto, "--verbosity", 4));
    const unset = ModelArgs.buildModelArgs({ id: "x.gguf", modelPath: "/m/x.gguf" }, GLOBALS);
    assert.ok(has(unset, "--verbosity", 4));
    const explicit = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { gpuLayers: 20 }), GLOBALS);
    assert.ok(has(explicit, "--verbosity", 4), "a manual layer count still needs the placement report");
    const cpu = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { gpuLayers: 0 }), GLOBALS);
    assert.ok(has(cpu, "--verbosity", 4));
});
test("emits speculation, projector, template and the expert override", () => {
    const a = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, {
        arch: "qwen35moe", expertCount: 256, overrideKv: { "qwen35moe.expert_used_count": "int:3" },
        draftPath: "/m/draft.gguf", specType: "draft-dspark", specDraftNMax: 2, specDraftNMin: 0,
        mmprojPath: "/m/mm.gguf", chatTemplatePath: "/t/x.jinja"
    }), GLOBALS);
    assert.ok(has(a, "--override-kv", "qwen35moe.expert_used_count=int:3"));
    assert.ok(has(a, "--model-draft", "/m/draft.gguf"));
    assert.ok(has(a, "--spec-type", "draft-dspark"));
    assert.ok(has(a, "--spec-draft-n-max", 2));
    assert.ok(has(a, "--spec-draft-n-min", 0));
    assert.ok(has(a, "--mmproj", "/m/mm.gguf"));
    assert.ok(has(a, "--chat-template-file", "/t/x.jinja"));
});
test("an embedded MTP head emits spec-type with no model-draft", () => {
    const a = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { specType: "draft-mtp" }), GLOBALS);
    assert.ok(has(a, "--spec-type", "draft-mtp"));
    assert.strictEqual(a.indexOf("--model-draft"), -1);
});
test("emits the MoE CPU flags and the thread-batch override", () => {
    const a = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { cpuMoe: true, cpuMoeLayers: 18 }), Object.assign({}, GLOBALS, { threadsBatch: 8 }));
    assert.ok(has(a, "--cpu-moe"));
    assert.ok(has(a, "--n-cpu-moe", 18));
    assert.ok(has(a, "--threads-batch", 8));
});
test("suppresses --threads-batch when it equals --threads", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, { threadsBatch: GLOBALS.threads }));
    assert.strictEqual(a.indexOf("--threads-batch"), -1);
});
test("emits --parallel from the entry for a positive integer only, ignoring any global", () => {
    const on = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { parallelSlots: 8 }), GLOBALS);
    assert.ok(has(on, "--parallel", 8));
    for (const value of ["", 0, -1, "8", "abc", 2.5, NaN, null, undefined]) {
        const off = ModelArgs.buildModelArgs(Object.assign({}, ENTRY, { parallelSlots: value }), GLOBALS);
        assert.strictEqual(off.indexOf("--parallel"), -1, "--parallel must be omitted for " + String(value));
    }
    // A parallel value on the globals is dead: the setting is per model now.
    const globalOnly = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, { parallel: 8 }));
    assert.strictEqual(globalOnly.indexOf("--parallel"), -1, "the globals must not emit --parallel");
});
test("emits --slot-save-path", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, { slotSavePath: "/saves" }));
    assert.ok(has(a, "--slot-save-path", "/saves"));
});
test("kv flags default to the positive form", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, GLOBALS);
    assert.ok(has(a, "--kv-unified"));
    assert.ok(has(a, "--kv-offload"));
});
test("kv flags emit the negative form when disabled", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, { kvUnified: false, kvOffload: false }));
    assert.ok(has(a, "--no-kv-unified"));
    assert.ok(has(a, "--no-kv-offload"));
    assert.strictEqual(a.indexOf("--kv-unified"), -1);
    assert.strictEqual(a.indexOf("--kv-offload"), -1);
});
test("emits the device, flash-attn and cache server args the old router received", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, {
        device: "Vulkan0", flashAttn: "on", cacheReuseChunk: 256, cachePrompt: true, cacheIdleSlots: true
    }));
    assert.ok(has(a, "--device", "Vulkan0"));
    assert.ok(has(a, "--flash-attn", "on"));
    assert.ok(has(a, "--cache-reuse", 256));
    assert.ok(has(a, "--cache-prompt"));
    assert.ok(has(a, "--cache-idle-slots"));
});
test("omits the device flag and cache toggles when they are unset", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, GLOBALS);
    for (const flag of ["--device", "--flash-attn", "--cache-reuse", "--cache-prompt", "--cache-idle-slots"]) {
        assert.strictEqual(a.indexOf(flag), -1, flag + " must be omitted when unset");
    }
});
test("--reasoning is emitted from the globals and defaults to off", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, Object.assign({}, GLOBALS, { reasoning: "off" }));
    assert.ok(has(a, "--reasoning", "off"));
});
test("--reasoning is omitted when the globals do not carry a value", () => {
    const a = ModelArgs.buildModelArgs(ENTRY, GLOBALS);
    assert.strictEqual(a.indexOf("--reasoning"), -1);
});
test("the split KV types are emitted from their own fields", () => {
    const args = ModelArgs.buildModelArgs({ modelPath: "m.gguf", kvTypeK: "f16", kvTypeV: "q8_0" }, { port: 1234 });
    assert.deepStrictEqual(args.slice(args.indexOf("--cache-type-k"), args.indexOf("--cache-type-k") + 2), ["--cache-type-k", "f16"]);
    assert.deepStrictEqual(args.slice(args.indexOf("--cache-type-v"), args.indexOf("--cache-type-v") + 2), ["--cache-type-v", "q8_0"]);
});
test("batch sizes are emitted only for positive integers", () => {
    assert.strictEqual(ModelArgs.buildModelArgs({ modelPath: "m.gguf", batchSize: 1024, ubatchSize: 256 }, {}).indexOf("--batch-size") !== -1, true);
    assert.strictEqual(ModelArgs.buildModelArgs({ modelPath: "m.gguf", batchSize: 0, ubatchSize: -1 }, {}).indexOf("--batch-size"), -1);
    assert.strictEqual(ModelArgs.buildModelArgs({ modelPath: "m.gguf", batchSize: 1.5 }, {}).indexOf("--batch-size"), -1);
    assert.strictEqual(ModelArgs.buildModelArgs({ modelPath: "m.gguf" }, {}).indexOf("--ubatch-size"), -1);
});
test("one draft KV type fills both draft flags; p-min is emitted when set, including zero", () => {
    const args = ModelArgs.buildModelArgs({ modelPath: "m.gguf", draftPath: "d.gguf", draftKvType: "f16", specDraftPMin: 0 }, {});
    const k = args.indexOf("--spec-draft-type-k");
    assert.deepStrictEqual(args.slice(k, k + 2), ["--spec-draft-type-k", "f16"]);
    const v = args.indexOf("--spec-draft-type-v");
    assert.deepStrictEqual(args.slice(v, v + 2), ["--spec-draft-type-v", "f16"]);
    const p = args.indexOf("--spec-draft-p-min");
    assert.deepStrictEqual(args.slice(p, p + 2), ["--spec-draft-p-min", "0"]);
});
test("p-min and draft KV are omitted when empty", () => {
    const args = ModelArgs.buildModelArgs({ modelPath: "m.gguf", specDraftPMin: "", draftKvType: "" }, {});
    assert.strictEqual(args.indexOf("--spec-draft-p-min"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-type-k"), -1);
});
test("draft offload flags are emitted only when a draft is paired", () => {
    const args = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, gpuLayers: "auto",
        draftPath: "/d.gguf", specType: "draft-mtp",
        draftGpuLayers: 99, draftCpuMoe: true
    }, { port: 1234 });
    assert.ok(args.includes("--spec-draft-ngl"), "draft ngl emitted");
    assert.strictEqual(args[args.indexOf("--spec-draft-ngl") + 1], "99");
    assert.ok(args.includes("--spec-draft-cpu-moe"), "draft cpu-moe emitted");
});

test("draft offload flags are absent without a draft", () => {
    const args = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, gpuLayers: "auto",
        draftGpuLayers: 99, draftCpuMoe: true
    }, { port: 1234 });
    assert.ok(!args.includes("--spec-draft-ngl"), "no draft, no draft ngl");
    assert.ok(!args.includes("--spec-draft-cpu-moe"), "no draft, no draft cpu-moe");
});

test("draft MoE switches are mutually exclusive, the broad one wins", () => {
    const args = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, draftPath: "/d.gguf", specType: "draft-mtp",
        draftCpuMoe: true, draftCpuMoeLayers: 3
    }, { port: 1234 });
    assert.ok(args.includes("--spec-draft-cpu-moe"));
    assert.ok(!args.includes("--spec-draft-n-cpu-moe"), "n-cpu-moe dropped when cpu-moe is set");
});

test("--moe-cache-mib is emitted only for a real positive size on a MoE model", () => {
    const args = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, expertCount: 128, moeCacheMib: 2048
    }, { port: 1234 });
    assert.ok(has(args, "--moe-cache-mib", 2048));

    for (const bad of [undefined, null, "", 0, -512]) {
        const without = ModelArgs.buildModelArgs({
            id: "m", modelPath: "/m.gguf", contextSize: 4096, expertCount: 128, moeCacheMib: bad
        }, { port: 1234 });
        assert.strictEqual(without.indexOf("--moe-cache-mib"), -1, "not emitted for " + String(bad));
    }

    // A dense model must never see the flag: llama.cpp refuses the whole start otherwise
    // ("MoE cache requires a MoE model", measured on b12110).
    for (const dense of [undefined, null, 0]) {
        const refused = ModelArgs.buildModelArgs({
            id: "m", modelPath: "/m.gguf", contextSize: 4096, expertCount: dense, moeCacheMib: 2048
        }, { port: 1234 });
        assert.strictEqual(refused.indexOf("--moe-cache-mib"), -1, "dense model (" + String(dense) + ") must not emit it");
    }
});

test("--spec-draft-n-ubatch rides the draft block and needs a draft", () => {
    const args = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, draftPath: "/d.gguf", specType: "draft-mtp",
        draftUbatchSize: 256
    }, { port: 1234 });
    assert.ok(has(args, "--spec-draft-n-ubatch", 256));

    const noDraft = ModelArgs.buildModelArgs({
        id: "m", modelPath: "/m.gguf", contextSize: 4096, draftUbatchSize: 256
    }, { port: 1234 });
    assert.ok(!noDraft.includes("--spec-draft-n-ubatch"), "no draft, no draft ubatch");
});

test("--fit-target is emitted on the GPU path only", () => {
    const withGpu = ModelArgs.buildModelArgs({ id: "m", modelPath: "/m.gguf", fitTarget: 512 },
        { port: 1234, device: "Vulkan0" });
    const i = withGpu.indexOf("--fit-target");
    assert.ok(i !== -1, "emitted with a device");
    assert.strictEqual(withGpu[i + 1], "512");

    const withoutGpu = ModelArgs.buildModelArgs({ id: "m", modelPath: "/m.gguf", fitTarget: 512 },
        { port: 1234 });
    assert.ok(withoutGpu.indexOf("--fit-target") === -1, "omitted without a device");
});

test("argument order groups the new flags where the plan says", () => {
    const args = ModelArgs.buildModelArgs({ modelPath: "m.gguf", kvTypeK: "f16", kvTypeV: "q8_0", batchSize: 1024, ubatchSize: 256,
        draftPath: "d.gguf", specType: "draft-mtp", draftKvType: "f16", specDraftNMin: 0, specDraftPMin: 0.25 }, {});
    assert.ok(args.indexOf("--cache-type-v") < args.indexOf("--batch-size"));
    assert.ok(args.indexOf("--batch-size") < args.indexOf("--ubatch-size"));
    assert.ok(args.indexOf("--model-draft") < args.indexOf("--spec-draft-type-k"));
    assert.ok(args.indexOf("--spec-draft-n-min") < args.indexOf("--spec-draft-p-min"));
});
