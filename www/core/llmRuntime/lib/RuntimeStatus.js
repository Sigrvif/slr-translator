// www/core/llmRuntime/lib/RuntimeStatus.js
//
// Pure formatting helpers for the bundled local runtime's status line. This module
// requires nothing and does no work at evaluation time, so the addon loader can pull
// it in lazily without any risk of failing the module load.
"use strict";

function basename(p) {
    if (!p) return "";
    const s = String(p);
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i === -1 ? s : s.slice(i + 1);
}

// One line describing whether speculative decoding is configured for a targetModels()
// entry. A draft may be paired from data/llama/drafts.json (draftPath set) or built into
// the model itself (specType set, no draftPath); either way speculation is active.
function describeSpec(entry) {
    if (entry && entry.specOff) {
        return "Speculative decoding: off (disabled for this model)";
    }
    if (!entry || (!entry.specType && !entry.draftPath)) {
        return "Speculative decoding: none (no draft model detected for this model)";
    }
    if (entry.specType && !entry.draftPath) {
        // The embedded head runs with the same bounds the token fields set (the registry
        // defaults them like a detected draft), so report them exactly as the draft branch
        // does - without the numbers a user tuning them cannot tell they took effect.
        const nMinEmb = (entry.specDraftNMin === undefined || entry.specDraftNMin === null)
            ? 0
            : entry.specDraftNMin;
        return Number.isInteger(entry.specDraftNMax)
            ? "Speculative decoding: " + entry.specType +
                " (head built into the model, n-max " + entry.specDraftNMax +
                ", n-min " + nMinEmb + ")"
            : "Speculative decoding: " + entry.specType + " (head built into the model)";
    }
    const nMin = (entry.specDraftNMin === undefined || entry.specDraftNMin === null)
        ? 0
        : entry.specDraftNMin;
    return "Speculative decoding: " + entry.specType +
        " (draft " + basename(entry.draftPath) +
        ", n-max " + entry.specDraftNMax +
        ", n-min " + nMin + ")";
}

function formatPercent(fraction) {
    const pct = Math.round(Number(fraction) * 1000) / 10;
    return String(pct);
}

function formatRate(value) {
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return "0";
    return String(Math.round(n * 10) / 10);
}

// Buffer totals arrive in MiB; GiB is the unit a model size is usually thought about in.
function formatGiB(mib) {
    const v = Number(mib) || 0;
    return (v / 1024).toFixed(1) + " GiB";
}

function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) / 1000));
    if (total < 60) return total + "s";
    return Math.floor(total / 60) + "m " + (total % 60) + "s";
}

// What the running instance reports about itself, from the /slots body the front door proxies
// from the loaded child. `n_ctx` is the context the child actually runs with (the truthful
// value, and the one the status line shows), and `is_processing` says whether it is busy right
// now. Returns null for anything that is not a slot list (a 503 body, an error object), so the
// caller falls back to the configured entry rather than inventing a value.
function summariseSlots(slots) {
    if (!Array.isArray(slots) || slots.length === 0) return null;
    let nCtx = null;
    let processing = false;
    let found = false;
    for (const slot of slots) {
        if (!slot || typeof slot !== "object") continue;
        found = true;
        const n = Number(slot.n_ctx);
        if (nCtx === null && isFinite(n) && n > 0) nCtx = n;
        if (slot.is_processing === true) processing = true;
    }
    if (!found) return null;
    return { nCtx: nCtx, processing: processing };
}

// One line describing how the model is placed across CPU/VRAM. Only settings the entry
// actually carries are named, so an untouched card reads as plain "GPU layers: auto".
function describeOffload(entry, buffers) {
    const e = entry || {};
    const parts = [];
    const requested = (e.gpuLayers === undefined || e.gpuLayers === null) ? "auto" : e.gpuLayers;
    // Where the model actually ended up, for an auto choice AND a manual one. For auto the
    // breakdown is what "settled on" means; for a manual count it is the only proof the count
    // did what the user expected. The loader's "offloaded N/M layers to GPU" line is not used:
    // it counts layer assignment, and a MoE model can have every layer assigned to the GPU
    // while its experts sit in the CPU buffer, which reads as "the whole model is on the GPU"
    // when it is not. The per-buffer sizes are the ground truth, and a CPU-only start has no
    // GPU buffer at all.
    if (buffers && buffers.gpuMiB > 0) {
        parts.push("GPU layers: " + requested + " (" + formatGiB(buffers.gpuMiB) + " on GPU, " +
            formatGiB(buffers.cpuMiB) + " on CPU)");
    } else {
        parts.push("GPU layers: " + requested);
    }
    if (e.cpuMoe === true) parts.push("MoE experts: all on CPU");
    else if (e.cpuMoeLayers !== undefined && e.cpuMoeLayers !== null) {
        parts.push("MoE experts: first " + e.cpuMoeLayers + " layer(s) on CPU");
    }
    if (e.splitMode) parts.push("split: " + e.splitMode);
    if (e.tensorSplit) parts.push("tensor-split: " + e.tensorSplit);
    if (e.mainGpu !== undefined && e.mainGpu !== null) parts.push("main GPU: " + e.mainGpu);
    if (e.overrideTensor) parts.push("override: " + e.overrideTensor);
    // "(auto)" marks a mode the runtime chose, so it is never mistaken for one you picked.
    if (e.loadMode) parts.push("load mode: " + e.loadMode + (e.loadModeAuto === true ? " (auto)" : ""));
    return "Offload: " + parts.join(", ");
}

// The draft model's placement, when one is paired. Rendered as its own line because the
// Offload line names the loaded model, and mixing the two is what made a 1.1 GiB draft read
// as a 16.3 GiB model's placement.
function describeDraftOffload(entry, buffers) {
    const b = buffers || {};
    const d = b.draft;
    if (!d || !d.found) return null;
    const e = entry || {};
    const requested = (e.draftGpuLayers === undefined || e.draftGpuLayers === null)
        ? "auto"
        : e.draftGpuLayers;
    return "Draft offload: GPU layers: " + requested +
        " (" + formatGiB(d.gpuMiB) + " on GPU, " + formatGiB(d.cpuMiB) + " on CPU)";
}

// The engine's fit decision, translated into compact wording from the raw lines ServerProcess
// captures. The Offload lines show placement; this line shows the reasoning, kept short enough
// to read without resizing the window: what the device had free, whether the full load fits,
// and what the loader assigned. Two clauses exist because two different things put weights on
// the CPU, and the card must not conflate them:
//   - a large MoE model: fit keeps the expert weights in system RAM and still assigns every
//     layer to the GPU ("41/41" is layer assignment, not tensor placement);
//   - a fully assigned dense model: a small remainder of tensors has no GPU placement and sits
//     in host buffers - backend-placed, not a fit decision.
function describeFit(fit, buffers, entry) {
    if (!fit) return null;
    const offloaded = fit.offloaded || [];
    const lines = fit.lines || [];
    const text = lines.join("\n");
    const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
    const fullLoad = num(/projected to use (\d+) MiB of (?:device|host) memory vs/);
    const free = num(/vs\. (\d+) MiB of free (?:device|host) memory/);
    const spare = num(/will leave (\d+) >= \d+ MiB of free (?:device|host) memory/);
    const requested = (() => {
        const m = text.match(/will leave \d+ >= (\d+) MiB of free (?:device|host) memory/);
        return m ? Number(m[1]) : null;
    })();
    const deficit = num(/need to reduce (?:device|host) memory by (\d+) MiB/);
    // A MoE model keeps its experts in system RAM even at full layer assignment, so the
    // assignment fragments must not read as "everything is in VRAM". Detected from the model's
    // own metadata (works on manual counts, where the fit MoE trace never prints) and from the
    // fit trace's dense-weights measurement.
    const moeModel = Boolean(entry && ((entry.expertCount != null && entry.expertCount > 0) ||
        /moe/i.test(String(entry.arch || ""))));
    const isMoe = moeModel || /with only dense weights in device memory there/.test(text);

    const target = offloaded.find((o) => o && o.model !== "draft" && o.n != null);
    const draft = offloaded.find((o) => o && o.model === "draft" && o.n != null);
    const targetAssigned = target
        ? (target.n === target.m ? "all " + target.n : target.n + " of " + target.m)
        : null;

    const parts = [];
    if (fullLoad != null && free != null) {
        if (spare != null) {
            parts.push(fullLoad + " of " + free + " MiB free used; fits with " + spare + " spare" +
                (requested != null ? " (" + requested + " requested)" : ""));
        } else if (deficit != null) {
            parts.push(fullLoad + " of " + free + " MiB free needed; " + deficit + " MiB over");
        }
    }
    if (isMoe) {
        const cpuMiB = (buffers && buffers.cpuMiB) || 0;
        parts.push("the " + formatGiB(cpuMiB) + " on CPU is dominated by the expert weights - on a card much smaller than the model the experts stay in system RAM, and the loader still assigns " +
            (targetAssigned ? targetAssigned + " target layers" : "every target layer") +
            " (assignment, not placement)");
    } else if (targetAssigned) {
        parts.push(targetAssigned + " target units assigned to the GPU");
    }
    if (draft) parts.push("draft " + draft.n + "/" + draft.m + " assigned");

    if (!parts.length) {
        // Wording this build does not know: keep the raw lines rather than showing nothing.
        if (!lines.length && !offloaded.length) return null;
        return "Fit: " + lines.map(cleanFitLine)
            .concat(offloaded.map((o) => o && o.n != null ? "offloaded " + o.n + "/" + o.m + " layers to GPU" : ""))
            .filter(Boolean)
            .join(" | ");
    }

    // Reconciliation clauses, only where they apply.
    const draftBuf = buffers && buffers.draft;
    if (isMoe) {
        if (draftBuf && draftBuf.found && draftBuf.cpuMiB > 0 && draft && draft.n === draft.m) {
            parts.push("the draft's " + formatGiB(draftBuf.cpuMiB) + " on CPU is host-buffer placement at full assignment");
        }
    } else if (target && target.n === target.m && buffers && buffers.found && buffers.cpuMiB > 0) {
        parts.push("the " + formatGiB(buffers.cpuMiB) + " on CPU is backend-placed host-buffer weights, not a fit remainder");
    }
    return "Fit: " + parts.join("; ") + ".";
}

function cleanFitLine(l) {
    return String(l || "")
        .replace(/^.*?common_params_fit_impl:\s*/, "")
        .replace(/^.*?load_tensors:\s*/, "")
        .replace(/ {2,}/g, " ").trim();
}

// One line for the server-level knobs that are not tied to a single model: how many models may
// be resident, whether an idle model is unloaded, and the CPU thread count. Each part is only
// named when it differs from the runtime's own default, so an untouched card reads simply
// "Server: defaults".
function describeServer(opts) {
    const o = opts || {};
    const parts = [];
    if (o.modelsMax && o.modelsMax > 1) parts.push("models resident: " + o.modelsMax);
    if (o.sleepIdleSeconds > 0) {
        parts.push("unload after " + formatDuration(o.sleepIdleSeconds * 1000) + " idle");
    } else if (o.sleepIdleSeconds === 0 && o.hasSleepSetting) {
        parts.push("stays loaded");
    }
    if (o.threads > 0) {
        parts.push("threads: " + o.threads +
            (o.threadsBatch > 0 && o.threadsBatch !== o.threads ? " / batch " + o.threadsBatch : ""));
    }
    return "Server: " + (parts.length ? parts.join(", ") : "defaults");
}

// One line describing where the KV cache lives, when the caller knows.
function describeKv(kv) {
    if (!kv) return null;
    const parts = [];
    if (kv.type) parts.push(kv.type);
    parts.push(kv.unified === false ? "per-slot" : "unified");
    parts.push(kv.offload === false ? "in system RAM" : "in VRAM");
    return "KV placement: " + parts.join(", ");
}

// Multi-line status text. `metrics` is the object returned by RouterClient.parseSpecMetrics
// (or null); its presence adds a measured draft-acceptance line. `kvType` is the KV cache
// quantization the server was started with (or falsy when unknown); when set it adds a line.
function describe(opts) {
    const state = (opts && opts.state) || {};
    const entry = opts && opts.entry;
    const metrics = opts && opts.metrics;
    const kvType = opts && opts.kvType;
    const runtime = opts && opts.runtime;
    const progress = opts && opts.progress;
    const expert = opts && opts.expert;
    const template = opts && opts.template;
    const libDir = opts && opts.libDir;
    // Which model is actually loaded right now (from the pool, through the front door) and what
    // its own /slots says about the context it runs with and whether it is busy.
    const loadedId = opts && opts.loadedId;
    const slotInfo = summariseSlots(opts && opts.slots);
    const lines = [];
    // Ownership is visible because it decides what the user can do: an attached runtime belongs
    // to another process, so this window can neither stop it nor rebind it.
    lines.push("Status: " + (state.status || "-") + (state.attached ? " (attached)" : ""));
    // A cpu backend on a machine with a working GPU is the app's most confusing failure: the
    // engine auto-uses the GPU anyway, so the card contradicts itself. Name the cause where
    // the user looks. Genuine no-GPU machines get the same line and it is simply true. A CPU
    // the user forced themselves is neither of those: it says so, without the no-GPU warning.
    if (state.backend === "cpu" && state.backendReason === "cpu-forced") {
        lines.push("Backend: cpu (forced by the backend option)");
    } else if (state.backend === "cpu" && state.backendReason === "cpu-fallback") {
        lines.push("Backend: cpu (no GPU detected at start - the engine may still use one; restart the runtime to re-detect)");
    } else {
        lines.push("Backend: " + (state.backend || "-") + (state.device ? " (" + state.device + ")" : ""));
    }
    lines.push("URL: " + (state.baseUrl || "-"));
    lines.push("Model: " + ((entry && entry.id) || state.modelId || "-"));
    if (loadedId) lines.push("Loaded model: " + loadedId);
    // The instance's own n_ctx is preferred when it is known: it is what the server really runs
    // with, while the entry's contextSize is only what it was asked for. The configured value is
    // still the fallback for when no instance is loaded (a /slots read answers 503 then).
    const contextSize = (slotInfo && slotInfo.nCtx !== null)
        ? slotInfo.nCtx
        : (entry && entry.contextSize != null ? entry.contextSize : "-");
    lines.push("Context: " + contextSize);
    if (slotInfo) lines.push("Slots: " + (slotInfo.processing ? "processing" : "idle"));
    if (kvType) lines.push("KV cache: " + kvType);
    const kvLine = describeKv(opts && opts.kv);
    if (kvLine) lines.push(kvLine);
    lines.push(describeOffload(entry, opts && opts.buffers));
    const draftLine = describeDraftOffload(entry, opts && opts.buffers);
    if (draftLine) lines.push(draftLine);
    const fitLine = describeFit(opts && opts.fit, opts && opts.buffers, entry);
    if (fitLine) lines.push(fitLine);
    const serverLine = describeServer(opts && opts.server);
    if (serverLine) lines.push(serverLine);
    if (libDir) lines.push("Extra library folder: " + libDir);
    if (expert) {
        lines.push("Experts used: " + expert.count +
            (expert.available ? " of " + expert.available : "") +
            " per token (metadata override " + expert.arch + ".expert_used_count)");
    }
    lines.push(template
        ? "Chat template: custom (" + basename(template) + ")"
        : "Chat template: the model's own");
    lines.push(describeSpec(entry));
    if (metrics) {
        lines.push("Draft acceptance: " + formatPercent(metrics.acceptance) + "% (" +
            metrics.acceptedTokens + " accepted / " + metrics.draftTokens + " draft tokens)");
    }
    if (runtime) {
        // The per-second gauges are instantaneous: llama-server zeroes them the moment a slot
        // goes idle, so on their own they show a number for about a second and then read 0.
        // The cumulative counters survive, and their ratio gives a stable average over
        // everything the runtime has done since it started. So: show the live figure while it
        // exists, and fall back to the average when it does not, rather than showing 0.
        const genLive = Number(runtime.predictedTokensPerSecond) || 0;
        const promptLive = Number(runtime.promptTokensPerSecond) || 0;
        const genAverage = runtime.predictedSeconds > 0 ? runtime.predictedTokens / runtime.predictedSeconds : 0;
        const promptAverage = runtime.promptSeconds > 0 ? runtime.promptTokens / runtime.promptSeconds : 0;
        const gen = genLive > 0 ? genLive : genAverage;
        const prompt = promptLive > 0 ? promptLive : promptAverage;
        if (gen > 0 || prompt > 0) {
            const label = (genLive > 0 || promptLive > 0) ? "Throughput" : "Throughput (average)";
            lines.push(label + ": " + formatRate(gen) +
                " tok/s generation, " + formatRate(prompt) + " tok/s prompt");
        }
        if (runtime.promptTokens > 0) {
            lines.push("Prompt cache reuse: " + formatPercent(runtime.cacheReuse) + "% (" +
                runtime.promptTokensCached + " / " + runtime.promptTokens + " prompt tokens)");
        }
    }
    if (progress) {
        // "loaded" is the steady state and adds nothing; "loading" is worth naming because
        // it explains a long wait.
        if (progress.model === "loading") lines.push("Model state: loading into memory...");
        else if (progress.model && progress.model !== "loaded") lines.push("Model state: " + progress.model);
        const activity = progress.activity;
        if (activity && activity.phase === "prompt") {
            // The server does report how much of the prompt it has read, so a real percentage
            // is shown alongside the elapsed time.
            const total = activity.promptTokens;
            const done = Number(activity.promptProcessed) || 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            lines.push("Processing prompt: " + (total > 0 ? pct + "% (" + done + " / " + total + " tokens)" : "starting...") +
                (activity.elapsedMs > 0 ? " - " + formatDuration(activity.elapsedMs) + " so far" : ""));
        } else if (activity && activity.phase === "generating") {
            lines.push("Generating: " + activity.decoded + " tokens" +
                (activity.remain > 0 ? " (" + activity.remain + " left)" : "") +
                (activity.elapsedMs > 0 ? " - " + formatDuration(activity.elapsedMs) : ""));
        }
    }
    if (state.error) lines.push("Error: " + state.error);
    if (state.note) lines.push(state.note);
    return lines.join("\n");
}

module.exports = { describe, describeSpec, describeOffload, describeDraftOffload, describeKv, describeServer, summariseSlots };
