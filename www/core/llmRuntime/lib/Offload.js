// www/core/llmRuntime/lib/Offload.js
//
// Normalisation for the manual GPU/MoE offload settings. Every value that reaches the
// generated preset must be one the pinned b10964 parser accepts, so each helper either
// returns a clean value or undefined (meaning "do not emit this key at all").
"use strict";

const SPLIT_MODES = ["none", "layer", "row", "tensor"];

// The load modes the pinned b10964 parser accepts. "auto" is the llama.cpp default and is
// therefore never written; the rest are passed through to --load-mode.
const LOAD_MODES = ["none", "mmap", "mlock", "mmap+mlock", "dio"];

function toInteger(value) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
}

// -ngl accepts either the literal "auto" or an exact layer count (0 = keep everything on
// the CPU). Anything else means "leave the registry default in place".
function normalizeGpuLayers(value) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "auto") return "auto";
    // The engine's own spelling for "every layer plus the output weights". n_layer alone is
    // NOT everything: the output/embedding weights are one more unit beyond the block count,
    // so a card that measures-fit for N blocks may still hold N+1 units - "all" says so
    // without the user having to know either number.
    if (String(value).trim().toLowerCase() === "all") return "all";
    const n = toInteger(value);
    if (n !== null && n >= 0) return n;
    return undefined;
}

// --cpu-moe keeps every expert weight on the CPU; it is a plain switch, so only a real
// boolean is accepted (strings from a form field are not treated as truthy).
function normalizeCpuMoe(value) {
    return value === true ? true : undefined;
}
// --n-cpu-moe N keeps the expert weights of the first N layers on the CPU. 0 is a valid,
// explicit "off"; negative or non-numeric values are ignored.
function normalizeCpuMoeLayers(value) {
    const n = toInteger(value);
    if (n !== null && n >= 0) return n;
    return undefined;
}

// --fit-target is the per-device margin llama.cpp's fit leaves free. 0 is allowed (maximum
// control, and documented as OOM-risky); anything unrecognised is dropped so the engine's own
// 1024 default stands.
function normalizeFitTarget(value) {
    const n = toInteger(value);
    if (n !== null && n >= 0) return n;
    return undefined;
}

function normalizeSplitMode(value) {
    if (typeof value !== "string") return undefined;
    const v = value.trim();
    return SPLIT_MODES.indexOf(v) === -1 ? undefined : v;
}

// --tensor-split takes a comma-separated list of per-GPU fractions.
function normalizeTensorSplit(value) {
    if (typeof value !== "string") return undefined;
    const v = value.trim();
    if (!v || !/^\d+(\.\d+)?(,\d+(\.\d+)?)*$/.test(v)) return undefined;
    return v;
}

function normalizeMainGpu(value) {
    const n = toInteger(value);
    if (n !== null && n >= 0) return n;
    return undefined;
}

// --override-tensor takes one or more "pattern=buffer" pairs, e.g. "exps=CPU" or
// "exps=CPU,attn=CUDA0". Every pair must have a non-empty pattern and buffer type.
function normalizeOverrideTensor(value) {
    if (typeof value !== "string") return undefined;
    const v = value.trim();
    if (!v) return undefined;
    for (const part of v.split(",")) {
        if (!/^[^=\s]+=[^=\s]+$/.test(part.trim())) return undefined;
    }
    return v;
}

// --load-mode accepts one of the loader's mode names. "auto" is the default and means
// "do not emit the flag at all".
function normalizeLoadMode(value) {
    if (typeof value !== "string") return undefined;
    const v = value.trim();
    if (!v || v === "auto") return undefined;
    return LOAD_MODES.indexOf(v) === -1 ? undefined : v;
}

// Whether any setting actually keeps MoE expert weights in system RAM. This is a condition
// under which llama.cpp's loader reads weights back through the memory mapping while compute
// runs, which is what --load-mode none avoids. The flags can only move weights that exist:
// on a dense model --cpu-moe is ignored by llama.cpp, so it must not influence the load mode
// here either. `count` is the model's own expert count from its GGUF (null = the key is
// absent = dense; a positive number = MoE); undefined means the caller supplied no model
// facts, and the flag is then taken at its word so synthetic entries keep the old behaviour.
// The draft's flags are judged against the draft's own count (draftExpertCount) the same way.
function modelHasExperts(count) {
    if (count === undefined) return true;
    return typeof count === "number" && count > 0;
}

function hasCpuExpertOffload(value) {
    if (!value) return false;
    if (value.cpuMoe === true && modelHasExperts(value.expertCount)) return true;
    const layers = toInteger(value.cpuMoeLayers);
    if (layers !== null && layers > 0 && modelHasExperts(value.expertCount)) return true;
    if (value.draftCpuMoe === true && modelHasExperts(value.draftExpertCount)) return true;
    const draftLayers = toInteger(value.draftCpuMoeLayers);
    if (draftLayers !== null && draftLayers > 0 && modelHasExperts(value.draftExpertCount)) return true;
    if (typeof value.overrideTensor === "string" && modelHasExperts(value.expertCount)) {
        for (const part of value.overrideTensor.split(",")) {
            const m = part.trim().match(/^([^=\s]+)=([^=\s]+)$/);
            if (!m) continue;
            if (/^exps$/i.test(m[1]) && /^(cpu|accel_host)$/i.test(m[2])) return true;
        }
    }
    return false;
}

// The offload keys the generated preset may carry, in the order they are written. Each
// maps an entry field to the preset key and its normaliser. `n-gpu-layers` is handled
// separately because it always has a value (its "auto" default).
const OFFLOAD_KEYS = [
    { field: "cpuMoe", key: "cpu-moe", normalize: normalizeCpuMoe },
    { field: "cpuMoeLayers", key: "n-cpu-moe", normalize: normalizeCpuMoeLayers },
    { field: "splitMode", key: "split-mode", normalize: normalizeSplitMode },
    { field: "tensorSplit", key: "tensor-split", normalize: normalizeTensorSplit },
    { field: "mainGpu", key: "main-gpu", normalize: normalizeMainGpu },
    { field: "overrideTensor", key: "override-tensor", normalize: normalizeOverrideTensor }
];

// A model that cannot be held entirely in the selected device's memory has to compute some of
// its weights on the CPU, and those weights are then read back through the memory mapping. The
// file is compared against a fraction of VRAM rather than all of it, because the KV cache and
// the compute buffers need room too: a model that only just fits the file would still offload.
const VRAM_FIT_FACTOR = 0.9;

function fitsInVram(modelBytes, vramMiB, factor) {
    const bytes = Number(modelBytes);
    const vram = Number(vramMiB);
    const f = typeof factor === "number" && factor > 0 ? factor : VRAM_FIT_FACTOR;
    // An unknown size or an unknown card means "assume it fits", which keeps mmap. That is the
    // previous behaviour, and guessing wrong here would slow every load for no benefit.
    if (!isFinite(bytes) || bytes <= 0) return true;
    if (!isFinite(vram) || vram <= 0) return true;
    return bytes <= vram * 1024 * 1024 * f;
}

// Approximate bytes per KV element per quantization type, from the ggml block layouts (a q8_0
// block holds 32 elements in 34 bytes, a q4_0 block in 18). The sub-q8 entries err high; this
// only feeds the load-mode recommendation, where erring high means 'none' a little too often.
const KV_TYPE_BYTES = {
    f32: 4, f16: 2, bf16: 2, q8_0: 1.0625, q5_1: 0.75, q5_0: 0.6875,
    q4_1: 0.6875, q4_0: 0.5625, iq4_nl: 0.5625
};

// The KV cache the start will allocate, from the facts the model entry carries: context size,
// layer count and the per-layer attention K/V widths llama.cpp reads from the GGUF. Unknown
// facts contribute nothing rather than a guess. Sliding-window layers cap their cache at the
// window, which this deliberately ignores: an over-estimate errs toward 'none', which only
// costs load time, and llama.cpp's own fit still decides the real placement.
function estimateKvBytes(entry) {
    const e = entry || {};
    const layers = typeof e.blockCount === "number" && e.blockCount > 0 ? e.blockCount : null;
    const ctx = typeof e.contextSize === "number" && e.contextSize > 0 ? e.contextSize : null;
    if (!layers || !ctx) return 0;
    const kWidth = typeof e.attnKeyLength === "number" && e.attnKeyLength > 0 ? e.attnKeyLength : null;
    const vWidth = typeof e.attnValueLength === "number" && e.attnValueLength > 0 ? e.attnValueLength : null;
    if (!kWidth || !vWidth) return 0;
    const kBytes = KV_TYPE_BYTES[e.kvTypeK] !== undefined ? KV_TYPE_BYTES[e.kvTypeK] : 2;
    const vBytes = KV_TYPE_BYTES[e.kvTypeV] !== undefined ? KV_TYPE_BYTES[e.kvTypeV] : 2;
    return Math.ceil(ctx * layers * (kWidth * kBytes + vWidth * vBytes));
}

// A manual GPU layer count below the model's full height is a partial offload the user asked
// for: those layers live in system RAM and are read during compute, exactly like an expert
// split. The output/embedding weights are one more unit beyond the blocks, so 'all' is
// blockCount + 1; a count at or above it is a full offload with nothing left in RAM.
function isExplicitPartialOffload(entry) {
    const e = entry || {};
    if (typeof e.gpuLayers !== "number" || !Number.isInteger(e.gpuLayers) || e.gpuLayers <= 0) return false;
    if (typeof e.blockCount !== "number" || !(e.blockCount > 0)) return false;
    return e.gpuLayers < e.blockCount + 1;
}

// Everything a start reads into memory before the first request: the target file, the paired
// draft and projector files, and the KV cache it will allocate. The caller's ctx carries the
// file sizes it can measure; anything unknown contributes nothing.
function totalStartBytes(entry, ctx) {
    const c = ctx || {};
    let total = estimateKvBytes(entry);
    const sizes = [c.modelBytes, c.draftBytes, c.mmprojBytes];
    for (let i = 0; i < sizes.length; i++) {
        const n = Number(sizes[i]);
        if (isFinite(n) && n > 0) total += n;
    }
    return total;
}

// The recommended mode for an entry the caller did not set explicitly. 'none' is recommended
// whenever part of the model's weights will be read from system RAM while compute runs -
// MoE or dense alike:
//   - expert weights kept on the CPU by an explicit setting the model actually has experts
//     for (the options show these);
//   - a manual GPU layer count below the model's full height (a partial offload by design);
//   - a start whose files plus KV cache do not fit the selected device, which llama.cpp
//     resolves by offloading part of the model on its own. Nothing in the options reveals
//     that, so it is computed here from the entry against the card.
// With no GPU in play there is nothing for the mapping to contend with - measurements on a
// CPU-only setup showed no benefit at all - so it stays on mmap.
function resolveAutoLoadMode(entry, ctx) {
    const e = entry || {};
    if (hasCpuExpertOffload(e)) return "none";
    if (isExplicitPartialOffload(e)) return "none";
    const c = ctx || {};
    if (!c.gpuActive) return undefined;
    if (e.gpuLayers === 0) return undefined;
    if (fitsInVram(totalStartBytes(e, c), c.vramMiB)) return undefined;
    return "none";
}

// The load mode actually used when the caller did not name one. An explicit mode always wins,
// so choosing 'mmap' is the opt-out. Otherwise the recommendation applies: weights read from
// system RAM while the file is mapped are what the loader warns about and what costs
// prompt-processing time - measured 116 -> 198 tokens/s on a Vulkan GPU with a 26B A4B and
// its experts on the CPU, and about 105 -> 73 tokens/s on a dense 12B with 8 of 49 layers
// on the CPU once the OS had evicted the mapped pages; 'none' kept both flat. A translation
// run lasts hours and the model stays loaded by default, so the slower load is paid once and
// normally worth it, which is why this is the recommendation rather than an opt-in. `ctx`
// carries the GPU details the entry alone cannot express; without it only the explicit
// expert and layer-count triggers apply.
function resolveLoadMode(requested, entry, ctx) {
    const explicit = normalizeLoadMode(requested);
    if (explicit !== undefined) return explicit;
    return resolveAutoLoadMode(entry, ctx);
}

// Apply every recognised offload setting from a tuning object onto a model entry. Returns
// a new entry; the input is not mutated. Only fields with a valid value are set.
function applyOffloadTuning(entry, tuning) {
    const t = tuning || {};
    let out = Object.assign({}, entry);
    const gpuLayers = normalizeGpuLayers(t.gpuLayers);
    if (gpuLayers !== undefined) out.gpuLayers = gpuLayers;
    // The draft is a second model inside the same child, so it needs its own placement trio.
    // These reuse the target's normalisers verbatim (no new normalisation logic); they only
    // reach a flag when the entry is actually paired (ModelArgs gates on draftPath).
    const draftGpuLayers = normalizeGpuLayers(t.draftGpuLayers);
    if (draftGpuLayers !== undefined) out.draftGpuLayers = draftGpuLayers;
    const draftCpuMoe = normalizeCpuMoe(t.draftCpuMoe);
    if (draftCpuMoe !== undefined) out.draftCpuMoe = draftCpuMoe;
    const draftCpuMoeLayers = normalizeCpuMoeLayers(t.draftCpuMoeLayers);
    if (draftCpuMoeLayers !== undefined) out.draftCpuMoeLayers = draftCpuMoeLayers;
    for (const spec of OFFLOAD_KEYS) {
        const value = spec.normalize(t[spec.field]);
        if (value !== undefined) out[spec.field] = value;
    }
    // The MoE pair is resolved before the load mode is chosen, because the choice depends on
    // whether experts ended up on the CPU.
    out = resolveMoEExclusivity(out);
    // A mode the user picked is theirs; anything the runtime worked out is marked, so the
    // status line can show which of the two it was.
    const explicitMode = normalizeLoadMode(t.loadMode);    if (explicitMode !== undefined) {
        out.loadMode = explicitMode;
        out.loadModeAuto = false;
    } else {
        const recommended = resolveAutoLoadMode(out);
        if (recommended !== undefined) {
            out.loadMode = recommended;
            out.loadModeAuto = true;
        }
    }
    return out;
}

// The preset must never carry both MoE switches at once. llama.cpp accepts the pair and
// silently lets --cpu-moe win (verified against b10964: both keys produce byte-identical
// placement to --cpu-moe alone), so emitting both is redundant rather than conflicting. When
// a fully-populated form requests both, the broader switch is the one the user can see is in
// charge, so n-cpu-moe - the finer setting it would override - is dropped. The draft's own
// pair is resolved the same way, independently of the target's.
function resolveMoEExclusivity(entry) {
    const out = Object.assign({}, entry);
    if (out.cpuMoe === true) delete out.cpuMoeLayers;
    if (out.draftCpuMoe === true) delete out.draftCpuMoeLayers;
    return out;
}

module.exports = {
    SPLIT_MODES,
    LOAD_MODES,
    normalizeGpuLayers,
    normalizeCpuMoe,
    normalizeCpuMoeLayers,
    normalizeFitTarget,
    normalizeSplitMode,
    normalizeTensorSplit,
    normalizeMainGpu,
    normalizeOverrideTensor,
    normalizeLoadMode,
    hasCpuExpertOffload,
    resolveLoadMode,
    resolveAutoLoadMode,
    fitsInVram,
    estimateKvBytes,
    isExplicitPartialOffload,
    totalStartBytes,
    KV_TYPE_BYTES,
    VRAM_FIT_FACTOR,
    OFFLOAD_KEYS,
    applyOffloadTuning,
    resolveMoEExclusivity
};
