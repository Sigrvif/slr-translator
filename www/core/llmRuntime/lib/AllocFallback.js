// www/core/llmRuntime/lib/AllocFallback.js
//
// Recovery for the one start failure a user could fix with a knob: the child died because the
// GPU could not hold the load. llama.cpp's fit usually prevents that by moving layers to the
// CPU, but its decision can come out wrong - measured on b10964, with --load-mode none and a
// draft whose own memory measurement had failed, the fit printed "need to reduce device memory
// by 1075 MiB" and still placed every layer, and the child died on the KV allocation (Vulkan
// ErrorOutOfDeviceMemory). The dead child's stderr states how much did not fit and how the
// model was placed, so ONE retry with a lower --gpu-layers count can be derived from it; when
// nothing can be derived (or the reduction would empty the GPU), the same numbers become the
// advice shown with the hard error. Pure module: parsing and arithmetic only.
"use strict";

// stderr signatures of "the device refused an allocation". Matched against the dead child's
// own captured tail, so a new backend spelling only needs another entry here.
const ALLOC_FAILURE_PATTERNS = [
    /OutOf(?:Device|Video)?Memory/,
    /\bout of (?:device|video) memory\b/i,
    /\bmemory allocation of size \d+ failed/i,
    /failed to allocate [^\n]{0,120}buffer/i,
    /failed to allocate buffer for kv cache/i,
    /\bcuda\b[^\n]{0,80}\bout of memory\b/i,
    /\b(?:hip|rocm)\b[^\n]{0,80}\bout of memory\b/i
];

function isAllocFailure(tailText) {
    const text = String(tailText || "");
    if (!text) return false;
    for (let i = 0; i < ALLOC_FAILURE_PATTERNS.length; i++) {
        if (ALLOC_FAILURE_PATTERNS[i].test(text)) return true;
    }
    return false;
}

// The numbers the fit and the loader print about a failed placement. The fit runs several
// trial measurements and prints these lines once per trial, so the LAST occurrence is the
// final decision - the earliest trial asked for a bigger reduction than the start actually
// died from (measured: first trial "need to reduce by 1587", final "by 1075"). Every field is
// null when its line never appeared; every consumer must cope with that.
function lastExec(text, source, flags) {
    const re = new RegExp(source, flags.indexOf("g") !== -1 ? flags : flags + "g");
    let m = null;
    let last = null;
    while ((m = re.exec(text)) !== null) last = m;
    return last;
}

function parseFitLines(text) {
    const t = String(text || "");
    const out = {
        reduceMiB: null, projectedMiB: null, freeMiB: null,
        placedLayers: null, totalLayers: null, modelBufferMiB: null
    };
    let m = lastExec(t, "need to reduce device memory by (\\d+) MiB", "i");
    if (m) out.reduceMiB = parseInt(m[1], 10);
    m = lastExec(t, "projected to use (\\d+) MiB of device memory vs\\.? (\\d+) MiB of free device memory", "i");
    if (m) {
        out.projectedMiB = parseInt(m[1], 10);
        out.freeMiB = parseInt(m[2], 10);
    }
    m = lastExec(t, "offloaded (\\d+)/(\\d+) layers to GPU", "i");
    if (m) {
        out.placedLayers = parseInt(m[1], 10);
        out.totalLayers = parseInt(m[2], 10);
    }
    // The largest "model buffer size" line is the target's device buffer; a draft's or a
    // CPU_Mapped buffer in the same tail is smaller, whichever order they print in.
    const bufRe = /model buffer size\s*=\s*([\d.]+) MiB/g;
    let bm = null;
    while ((bm = bufRe.exec(t)) !== null) {
        const size = parseFloat(bm[1]);
        if (isFinite(size) && (out.modelBufferMiB === null || size > out.modelBufferMiB)) {
            out.modelBufferMiB = size;
        }
    }
    return out;
}

// The layer count for one retry, derived from the failed placement, or null when the tail does
// not say enough - or the reduction would empty the GPU, which is a move to the CPU and a
// decision for the user, not a fallback. `entry.gpuLayers` is what the failed start asked for
// (a number, or "auto"/"all" when llama.cpp's fit chose); the retry only lowers it.
function computeFallbackGpuLayers(tailText, entry) {
    if (!isAllocFailure(tailText)) return null;
    const parsed = parseFitLines(tailText);
    if (!parsed.placedLayers || parsed.placedLayers < 1) return null;
    if (!parsed.modelBufferMiB || parsed.modelBufferMiB <= 0) return null;
    const perLayerMiB = parsed.modelBufferMiB / parsed.placedLayers;
    if (!isFinite(perLayerMiB) || perLayerMiB <= 0) return null;
    let reduceMiB = parsed.reduceMiB;
    if (reduceMiB === null && parsed.projectedMiB !== null && parsed.freeMiB !== null) {
        reduceMiB = Math.max(1, parsed.projectedMiB - parsed.freeMiB);
    }
    if (reduceMiB === null || reduceMiB < 1) {
        // No fit numbers at all: drop a tenth of the placement as the first guess.
        reduceMiB = Math.max(1, Math.round(parsed.placedLayers * 0.1)) * perLayerMiB;
    }
    const dropLayers = Math.max(1, Math.ceil(reduceMiB / perLayerMiB));
    const e = entry || {};
    const current = (typeof e.gpuLayers === "number" && Number.isInteger(e.gpuLayers))
        ? e.gpuLayers
        : parsed.placedLayers;
    const layers = current - dropLayers;
    if (layers < 1 || layers >= current) return null;
    return {
        layers: layers,
        dropped: current - layers,
        current: current,
        perLayerMiB: perLayerMiB,
        reduceMiB: reduceMiB,
        parsed: parsed
    };
}

// What to tell a user whose start died for lack of GPU memory and could not be retried
// automatically: the knob is per-model, so name it and suggest a value from the placement
// that failed. Returns "" for tails that are not allocation failures, so callers only attach
// advice where it belongs.
function failureAdvice(tailText, entry) {
    if (!isAllocFailure(tailText)) return "";
    const parsed = parseFitLines(tailText);
    const current = entry && typeof entry.gpuLayers === "number" ? entry.gpuLayers : null;
    let suggestion = "";
    if (parsed.placedLayers && parsed.placedLayers > 1) {
        const suggested = Math.max(1, parsed.placedLayers - Math.max(1, Math.ceil(parsed.placedLayers / 4)));
        suggestion = " The failed start placed " + parsed.placedLayers + " layers on the GPU; try " +
            suggested + " or fewer" + (current !== null ? " (currently " + current + ")" : "") + ".";
    }
    return "The GPU ran out of memory while loading the model. Lower the model's 'GPU layers' " +
        "setting on the Bundled Local Runtime card (per-model settings), or free GPU memory, " +
        "then start again." + suggestion;
}

module.exports = {
    ALLOC_FAILURE_PATTERNS,
    isAllocFailure,
    parseFitLines,
    computeFallbackGpuLayers,
    failureAdvice
};
