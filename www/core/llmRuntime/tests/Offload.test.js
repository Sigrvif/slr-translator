"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Offload = require("../lib/Offload");

test("normalizeGpuLayers accepts auto, all, zero and exact counts, rejects junk", () => {
    assert.strictEqual(Offload.normalizeGpuLayers("auto"), "auto");
    assert.strictEqual(Offload.normalizeGpuLayers("all"), "all");
    assert.strictEqual(Offload.normalizeGpuLayers(" ALL "), "all");
    assert.strictEqual(Offload.normalizeGpuLayers(0), 0);
    assert.strictEqual(Offload.normalizeGpuLayers(33), 33);
    assert.strictEqual(Offload.normalizeGpuLayers("12"), 12);
    for (const bad of ["", null, undefined, -1, "many", 1.5, "auto "]) {
        assert.strictEqual(Offload.normalizeGpuLayers(bad), undefined, String(bad));
    }
});

test("normalizeCpuMoe only accepts a real boolean true", () => {
    assert.strictEqual(Offload.normalizeCpuMoe(true), true);
    for (const bad of [false, "true", 1, "", null, undefined]) {
        assert.strictEqual(Offload.normalizeCpuMoe(bad), undefined, String(bad));
    }
});

test("normalizeCpuMoeLayers accepts zero and up, rejects negatives", () => {
    assert.strictEqual(Offload.normalizeCpuMoeLayers(0), 0);
    assert.strictEqual(Offload.normalizeCpuMoeLayers(20), 20);
    assert.strictEqual(Offload.normalizeCpuMoeLayers("8"), 8);
    for (const bad of [-1, "x", null, undefined, 2.5]) {
        assert.strictEqual(Offload.normalizeCpuMoeLayers(bad), undefined, String(bad));
    }
});

test("normalizeFitTarget accepts 0 and positive integers, rejects the rest", () => {
    assert.strictEqual(Offload.normalizeFitTarget(512), 512);
    assert.strictEqual(Offload.normalizeFitTarget("256"), 256);
    assert.strictEqual(Offload.normalizeFitTarget(0), 0);
    assert.strictEqual(Offload.normalizeFitTarget(""), undefined);
    assert.strictEqual(Offload.normalizeFitTarget(-1), undefined);
    assert.strictEqual(Offload.normalizeFitTarget("abc"), undefined);
    assert.strictEqual(Offload.normalizeFitTarget(null), undefined);
});

test("normalizeSplitMode accepts only the four llama.cpp split modes", () => {
    for (const good of Offload.SPLIT_MODES) {
        assert.strictEqual(Offload.normalizeSplitMode(good), good);
    }
    // Surrounding whitespace from a form field is trimmed rather than rejected.
    assert.strictEqual(Offload.normalizeSplitMode(" layer "), "layer");
    for (const bad of ["bogus", "", null, 3]) {
        assert.strictEqual(Offload.normalizeSplitMode(bad), undefined, String(bad));
    }
});

test("normalizeTensorSplit accepts a comma-separated numeric list", () => {
    assert.strictEqual(Offload.normalizeTensorSplit("1,1"), "1,1");
    assert.strictEqual(Offload.normalizeTensorSplit("0.7,0.3"), "0.7,0.3");
    for (const bad of ["", "a,b", "1,,2", "1;2", null]) {
        assert.strictEqual(Offload.normalizeTensorSplit(bad), undefined, String(bad));
    }
});

test("normalizeMainGpu accepts a non-negative index", () => {
    assert.strictEqual(Offload.normalizeMainGpu(0), 0);
    assert.strictEqual(Offload.normalizeMainGpu("1"), 1);
    assert.strictEqual(Offload.normalizeMainGpu(-1), undefined);
    assert.strictEqual(Offload.normalizeMainGpu("gpu0"), undefined);
});

test("normalizeOverrideTensor requires a pattern=buffer pair", () => {
    assert.strictEqual(Offload.normalizeOverrideTensor("exps=CPU"), "exps=CPU");
    assert.strictEqual(Offload.normalizeOverrideTensor("blk\\.0\\.ffn_.*=CUDA0"), "blk\\.0\\.ffn_.*=CUDA0");
    for (const bad of ["", "exps", "=CPU", null]) {
        assert.strictEqual(Offload.normalizeOverrideTensor(bad), undefined, String(bad));
    }
});

test("applyOffloadTuning sets only recognised fields and never mutates the input", () => {
    const entry = { id: "m.gguf", gpuLayers: "auto" };
    const out = Offload.applyOffloadTuning(entry, {
        gpuLayers: 20,
        cpuMoe: true,
        cpuMoeLayers: 10,
        splitMode: "layer",
        tensorSplit: "1,1",
        mainGpu: 0,
        overrideTensor: "exps=CPU"
    });
    assert.strictEqual(out.gpuLayers, 20);
    assert.strictEqual(out.cpuMoe, true);
    // cpu-moe subsumes n-cpu-moe, so the pair is resolved to the broader switch alone.
    assert.strictEqual(out.cpuMoeLayers, undefined);
    assert.strictEqual(out.splitMode, "layer");
    assert.strictEqual(out.tensorSplit, "1,1");
    assert.strictEqual(out.mainGpu, 0);
    assert.strictEqual(out.overrideTensor, "exps=CPU");
    assert.strictEqual(entry.gpuLayers, "auto");
    assert.strictEqual(entry.cpuMoe, undefined);
});

test("applyOffloadTuning leaves invalid values off the entry", () => {
    const out = Offload.applyOffloadTuning({ id: "m.gguf" }, {
        gpuLayers: "nonsense", cpuMoe: "yes", cpuMoeLayers: -2,
        splitMode: "diagonal", tensorSplit: "a,b", mainGpu: -1, overrideTensor: "exps"
    });
    assert.deepStrictEqual(out, { id: "m.gguf" });
});

test("applyOffloadTuning with no tuning keeps the entry as it was", () => {
    const out = Offload.applyOffloadTuning({ id: "m.gguf", gpuLayers: 12 }, undefined);
    assert.strictEqual(out.gpuLayers, 12);
});

test("normalizeLoadMode accepts the loader's modes and treats auto as unset", () => {
    for (const mode of ["none", "mmap", "mlock", "mmap+mlock", "dio"]) {
        assert.strictEqual(Offload.normalizeLoadMode(mode), mode);
    }
    assert.strictEqual(Offload.normalizeLoadMode(""), undefined);
    assert.strictEqual(Offload.normalizeLoadMode("auto"), undefined);
    assert.strictEqual(Offload.normalizeLoadMode(undefined), undefined);
    assert.strictEqual(Offload.normalizeLoadMode("none; rm -rf /"), undefined);
    assert.strictEqual(Offload.normalizeLoadMode("loaded"), undefined);
});

test("applyOffloadTuning carries a valid load mode and drops auto", () => {
    assert.strictEqual(Offload.applyOffloadTuning({}, { loadMode: "none" }).loadMode, "none");
    assert.strictEqual(Offload.applyOffloadTuning({}, { loadMode: "auto" }).loadMode, undefined);
});

// hasCpuExpertOffload mirrors the exact condition llama.cpp's loader warns about: expert
// weights sitting in system RAM while the file is still memory-mapped.
test("hasCpuExpertOffload ignores each way experts can be kept on the CPU", () => {
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoe: true }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoeLayers: 24 }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "exps=CPU" }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "attn=CUDA0,exps=CPU" }), true);
});

// The expert flags can only move weights that exist: on a dense model (expertCount null, the
// GGUF key absent) llama.cpp ignores --cpu-moe, so the setting must not flip the load mode
// either. A positive count is a MoE; an absent field means the caller supplied no model facts
// and the flag is taken at its word.
test("hasCpuExpertOffload ignores expert settings on a model that has no experts", () => {
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoe: true, expertCount: null }), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoeLayers: 24, expertCount: null }), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "exps=CPU", expertCount: null }), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoe: true, expertCount: 0 }), false);
    // The draft's flags are judged against the draft's own expert count.
    assert.strictEqual(Offload.hasCpuExpertOffload({ draftCpuMoe: true, draftExpertCount: null }), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ draftCpuMoeLayers: 4, draftExpertCount: null }), false);
});

test("hasCpuExpertOffload keeps counting expert settings on a model that has experts", () => {
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoe: true, expertCount: 256 }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoeLayers: 24, expertCount: 8 }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "exps=CPU", expertCount: 8 }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ draftCpuMoe: true, draftExpertCount: 64 }), true);
    assert.strictEqual(Offload.hasCpuExpertOffload({ draftCpuMoeLayers: 4, draftExpertCount: 64 }), true);
});

test("hasCpuExpertOffload ignores settings that do not put experts on the CPU", () => {
    assert.strictEqual(Offload.hasCpuExpertOffload({}), false);
    assert.strictEqual(Offload.hasCpuExpertOffload(undefined), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoe: false }), false);
    // 0 is an explicit "off" for the layer form, not a CPU placement.
    assert.strictEqual(Offload.hasCpuExpertOffload({ cpuMoeLayers: 0 }), false);
    // A GPU override, or a non-expert tensor pinned to the CPU, is not the warned-about case.
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "exps=CUDA0" }), false);
    assert.strictEqual(Offload.hasCpuExpertOffload({ overrideTensor: "attn=CPU" }), false);
});

// Verified against b10964: the parser accepts both switches and silently lets --cpu-moe win,
// so the preset must never carry the pointless pair.
test("resolveMoEExclusivity drops n-cpu-moe when all experts are already on the CPU", () => {
    const out = Offload.resolveMoEExclusivity({ cpuMoe: true, cpuMoeLayers: 24 });
    assert.strictEqual(out.cpuMoe, true);
    assert.strictEqual(out.cpuMoeLayers, undefined);
});

test("resolveMoEExclusivity leaves n-cpu-moe alone when cpu-moe is off", () => {
    const out = Offload.resolveMoEExclusivity({ cpuMoeLayers: 24 });
    assert.strictEqual(out.cpuMoeLayers, 24);
    assert.strictEqual(Offload.resolveMoEExclusivity({ cpuMoe: false, cpuMoeLayers: 24 }).cpuMoeLayers, 24);
});

test("resolveMoEExclusivity drops draftCpuMoeLayers when draftCpuMoe is true", () => {
    const out = Offload.resolveMoEExclusivity({ cpuMoe: true, cpuMoeLayers: 2, draftCpuMoe: true, draftCpuMoeLayers: 4 });
    assert.strictEqual(out.cpuMoeLayers, undefined);
    assert.strictEqual(out.draftCpuMoeLayers, undefined);
    assert.strictEqual(out.cpuMoe, true);
    assert.strictEqual(out.draftCpuMoe, true);
});

test("applyOffloadTuning resolves the MoE pair as a whole", () => {
    const out = Offload.applyOffloadTuning({ id: "m.gguf" }, { cpuMoe: true, cpuMoeLayers: 24 });
    assert.strictEqual(out.cpuMoe, true);
    assert.strictEqual(out.cpuMoeLayers, undefined);
});

// With experts on the CPU, mmap makes the loader read them back through the mapping, which is
// what costs prompt-processing time. A run lasts hours and the model stays loaded, so the
// slower load is paid once - hence 'none' is the default rather than an opt-in. Choosing a
// mode explicitly always wins, which is how a user opts out.
test("resolveLoadMode chooses none when experts are kept on the CPU", () => {
    assert.strictEqual(Offload.resolveLoadMode(undefined, { cpuMoe: true }), "none");
    assert.strictEqual(Offload.resolveLoadMode("", { cpuMoeLayers: 24 }), "none");
    assert.strictEqual(Offload.resolveLoadMode("auto", { overrideTensor: "exps=CPU" }), "none");
    assert.strictEqual(Offload.resolveLoadMode(undefined, { cpuMoe: true, cpuMoeLayers: 24 }), "none");
});

test("resolveLoadMode leaves a model with no CPU experts on the loader default", () => {
    assert.strictEqual(Offload.resolveLoadMode(undefined, {}), undefined);
    assert.strictEqual(Offload.resolveLoadMode("auto", { gpuLayers: 0 }), undefined);
    assert.strictEqual(Offload.resolveLoadMode("", { cpuMoe: false }), undefined);
    // A GPU override, or a non-expert tensor on the CPU, is not the warned-about case.
    assert.strictEqual(Offload.resolveLoadMode(undefined, { overrideTensor: "exps=CUDA0" }), undefined);
    assert.strictEqual(Offload.resolveLoadMode(undefined, { cpuMoeLayers: 0 }), undefined);
});

test("an explicit load mode always overrides the recommendation", () => {
    // 'mmap' is the documented opt-out for a model larger than free RAM.
    assert.strictEqual(Offload.resolveLoadMode("mmap", { cpuMoe: true, expertCount: 8 }), "mmap");
    assert.strictEqual(Offload.resolveLoadMode("mmap+mlock", { cpuMoe: true, expertCount: 8 }), "mmap+mlock");
    assert.strictEqual(Offload.resolveLoadMode("none", { cpuMoe: true, expertCount: 8 }), "none");
    assert.strictEqual(Offload.resolveLoadMode("dio", { cpuMoe: true, expertCount: 8 }), "dio");
});

test("applyOffloadTuning applies the recommendation through the tuning path", () => {
    assert.strictEqual(Offload.applyOffloadTuning({}, { cpuMoe: true }).loadMode, "none");
    assert.strictEqual(Offload.applyOffloadTuning({}, { cpuMoeLayers: 20 }).loadMode, "none");
    assert.strictEqual(Offload.applyOffloadTuning({}, { cpuMoe: true, loadMode: "mmap" }).loadMode, "mmap");
    assert.strictEqual(Offload.applyOffloadTuning({}, { gpuLayers: 0 }).loadMode, undefined);
});

// Auto has two triggers: an explicit MoE setting, which the options show, and a model that
// cannot fit in the selected GPU, which llama.cpp resolves by offloading on its own. The
// second one is invisible in the options, so it is computed from size against VRAM.
const GiB = 1024 * 1024 * 1024;

test("fitsInVram compares the file against a fraction of the card, not all of it", () => {
    // 19 GB model, 8 GiB card: cannot fit, so CPU weights are certain.
    assert.strictEqual(Offload.fitsInVram(19 * GiB, 8192), false);
    // 4 GB model, 8 GiB card: fits comfortably.
    assert.strictEqual(Offload.fitsInVram(4 * GiB, 8192), true);
    // 7.5 GB on an 8 GiB card fits the file but leaves no room for KV/compute, so it counts
    // as not fitting at the 90% threshold.
    assert.strictEqual(Offload.fitsInVram(7.5 * GiB, 8192), false);
});

test("fitsInVram assumes it fits when the size or the card is unknown", () => {
    // Unknown means keep mmap: a wrong guess here would slow every load for no benefit.
    for (const [bytes, vram] of [[null, 8192], [undefined, 8192], [0, 8192], [4 * GiB, null], [4 * GiB, 0], [4 * GiB, undefined]]) {
        assert.strictEqual(Offload.fitsInVram(bytes, vram), true, `${bytes} / ${vram}`);
    }
});

test("resolveAutoLoadMode uses the size trigger when the model does not fit", () => {
    const entry = { id: "m.gguf", gpuLayers: "auto" };
    assert.strictEqual(Offload.resolveAutoLoadMode(entry, { gpuActive: true, vramMiB: 8192, modelBytes: 19 * GiB }), "none");
});

test("resolveAutoLoadMode keeps mmap when the model fits", () => {
    const entry = { id: "m.gguf", gpuLayers: "auto" };
    assert.strictEqual(Offload.resolveAutoLoadMode(entry, { gpuActive: true, vramMiB: 8192, modelBytes: 4 * GiB }), undefined);
});

test("resolveAutoLoadMode never triggers without a GPU", () => {
    const entry = { id: "m.gguf", gpuLayers: "auto" };
    // No GPU backend, or the model entirely on the CPU: nothing contends with the mapping.
    assert.strictEqual(Offload.resolveAutoLoadMode(entry, { gpuActive: false, vramMiB: 8192, modelBytes: 19 * GiB }), undefined);
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: 0 }, { gpuActive: true, vramMiB: 8192, modelBytes: 19 * GiB }), undefined);
});

test("resolveAutoLoadMode still honours the explicit MoE trigger without any GPU context", () => {
    assert.strictEqual(Offload.resolveAutoLoadMode({ cpuMoe: true }, undefined), "none");
    assert.strictEqual(Offload.resolveAutoLoadMode({ cpuMoeLayers: 24 }, {}), "none");
});

test("an explicit mode still overrides the size trigger", () => {
    const entry = { id: "m.gguf", gpuLayers: "auto" };
    const ctx = { gpuActive: true, vramMiB: 8192, modelBytes: 19 * GiB };
    assert.strictEqual(Offload.resolveLoadMode("mmap", entry, ctx), "mmap");
    assert.strictEqual(Offload.resolveLoadMode("none", entry, ctx), "none");
});

// A manual layer count below the model's full height leaves those layers in system RAM by
// design, so it derives 'none' exactly like an expert split - dense or MoE alike. The
// output/embedding weights are one more unit beyond the blocks, so blockCount + 1 is "all".
test("a manual layer count below the model's height is a partial offload and derives none", () => {
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: 41, blockCount: 48 }, {}), "none");
    assert.strictEqual(Offload.applyOffloadTuning({ gpuLayers: 41, blockCount: 48 }, {}).loadMode, "none");
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: 49, blockCount: 48 }, {}), undefined);
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: "all", blockCount: 48 }, {}), undefined);
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: "auto", blockCount: 48 }, {}), undefined);
    // Without the block count nothing can be compared, so the setting stands.
    assert.strictEqual(Offload.resolveAutoLoadMode({ gpuLayers: 41 }, {}), undefined);
});

// The KV estimate from the entry's own facts: context, layers, per-layer K/V widths and the
// cache types. The numbers are the reporter's dense gemma-4 12B (32768 ctx, 48 layers,
// 512-wide K and V, q8_0 both sides); llama.cpp's real cache was smaller because
// sliding-window layers cap their cells, so the estimate deliberately errs high.
test("estimateKvBytes approximates the cache from context, layers and widths", () => {
    const bytes = Offload.estimateKvBytes({
        contextSize: 32768, blockCount: 48, attnKeyLength: 512, attnValueLength: 512,
        kvTypeK: "q8_0", kvTypeV: "q8_0"
    });
    assert.strictEqual(bytes, Math.ceil(32768 * 48 * (512 * 1.0625 + 512 * 1.0625)));
    // Unknown facts contribute nothing rather than a guess.
    assert.strictEqual(Offload.estimateKvBytes({ contextSize: 32768 }), 0);
    assert.strictEqual(Offload.estimateKvBytes({ blockCount: 48 }), 0);
    assert.strictEqual(Offload.estimateKvBytes({ contextSize: 32768, blockCount: 48 }), 0);
    assert.strictEqual(Offload.estimateKvBytes({}), 0);
});

// The size trigger must see the whole start - the model file, the paired draft and projector,
// and the KV cache - or a start with a big draft or context reads as "fits" and keeps mmap
// while llama.cpp offloads part of it anyway (the reporter's case: a 6.9 GiB file that "fits"
// an 8 GiB card at the 90% threshold until the 1.6 GiB KV estimate is counted).
test("the size trigger counts the draft, the projector and the KV estimate", () => {
    const reporterEntry = {
        id: "m.gguf", gpuLayers: "auto",
        contextSize: 32768, blockCount: 48, attnKeyLength: 512, attnValueLength: 512,
        kvTypeK: "q8_0", kvTypeV: "q8_0"
    };
    const fitsFile = { gpuActive: true, vramMiB: 8273, modelBytes: 7219673376 };
    // The file alone fits 0.9 x 8273 MiB; with the KV estimate it does not.
    assert.strictEqual(Offload.resolveAutoLoadMode(reporterEntry, fitsFile), "none");
    const noKvFacts = Object.assign({}, reporterEntry, { blockCount: null, attnKeyLength: null, attnValueLength: null });
    assert.strictEqual(Offload.resolveAutoLoadMode(noKvFacts, fitsFile), undefined);
    // A draft that does not fit alongside flips a start that otherwise would.
    assert.strictEqual(Offload.resolveAutoLoadMode(
        { id: "m.gguf", gpuLayers: "auto" },
        { gpuActive: true, vramMiB: 8192, modelBytes: 7 * GiB, draftBytes: 242 * 1024 * 1024, mmprojBytes: null }
    ), "none");
    assert.strictEqual(Offload.resolveAutoLoadMode(
        { id: "m.gguf", gpuLayers: "auto" },
        { gpuActive: true, vramMiB: 8192, modelBytes: 7 * GiB, draftBytes: null, mmprojBytes: null }
    ), undefined);
});
