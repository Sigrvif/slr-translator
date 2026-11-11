// www/core/llmRuntime/lib/ModelArgs.js
//
// One model's resolved settings as the argument list of its own llama-server child. Every
// load-time setting is a real CLI argument here: llama.cpp's router ignores these keys in a model
// preset section (measured), which is why this replaces the preset entirely.
"use strict";

function push(args, flag, value) {
    if (value === undefined || value === null || value === "") return;
    args.push(flag);
    if (value !== true) args.push(String(value));
}

function buildModelArgs(entry, globals) {
    const model = entry || {};
    const g = globals || {};
    const args = [];
    push(args, "-m", model.modelPath);
    push(args, "--alias", model.id);
    push(args, "--host", g.host || "127.0.0.1");
    push(args, "--port", g.port);
    // The device the backend selection resolved (e.g. "Vulkan0"). Omitted when none was
    // selected, which is the CPU path; llama.cpp then uses its own default placement.
    push(args, "--device", g.device);
    // The margin fit leaves free on the device. Only meaningful on the GPU path; on the CPU
    // path the flag does nothing, so it is omitted exactly as --device is.
    if (g.device) push(args, "--fit-target", model.fitTarget);
    args.push("--jinja", "--offline", "--metrics", "--no-webui");
    // The server-level reasoning default (--reasoning off/auto/on). A default, not a lock: a
    // request that carries chat_template_kwargs.enable_thinking true still thinks even with
    // --reasoning off. The globals always carry a validated value; nothing emits the flag bare.
    push(args, "--reasoning", g.reasoning);
    push(args, "--flash-attn", g.flashAttn);
    push(args, "-c", model.contextSize);
    push(args, "-ngl", model.gpuLayers);
    // llama.cpp reports how many layers it actually put on the GPU ("offloaded N/M layers") and
    // the per-buffer placement only at debug verbosity. The status card's Offload/Draft offload
    // lines are parsed from exactly those lines, and they are the only way to VERIFY a placement
    // choice worked - measured in GiB, not trust. That holds for a manual layer count just as
    // much as for auto (a user who forces -ngl 32 needs to see where the weights actually went),
    // so the report is always requested. The extra lines are load-time only and live in the
    // child's in-memory log buffer.
    push(args, "--verbosity", 4);
    push(args, "--cache-type-k", model.kvTypeK);
    push(args, "--cache-type-v", model.kvTypeV);
    if (Number.isInteger(model.batchSize) && model.batchSize > 0) push(args, "--batch-size", model.batchSize);
    if (Number.isInteger(model.ubatchSize) && model.ubatchSize > 0) push(args, "--ubatch-size", model.ubatchSize);
    push(args, "--load-mode", model.loadMode);
    push(args, "--chat-template-file", model.chatTemplatePath);
    push(args, "--mmproj", model.mmprojPath);
    push(args, "--model-draft", model.draftPath);
    // One draft KV type covers both sides: the draft's cache is small, and a single choice keeps the
    // control honest about how little it is worth.
    push(args, "--spec-draft-type-k", model.draftKvType);
    push(args, "--spec-draft-type-v", model.draftKvType);
    push(args, "--spec-type", model.specType);
    push(args, "--spec-draft-n-max", model.specDraftNMax);
    push(args, "--spec-draft-n-min", model.specDraftNMin);
    if (typeof model.specDraftPMin === "number") push(args, "--spec-draft-p-min", model.specDraftPMin);
    // Draft-model offload. A draft is a second model inside this child, so its placement needs
    // its own flags; the app emitted none before, leaving it entirely to llama.cpp's default.
    // Gated on the pairing, exactly as the draft's other spec args are: without a draft the
    // engine rejects them. The broad MoE switch drops the finer layer count, mirroring
    // --cpu-moe/--n-cpu-moe (Offload.resolveMoEExclusivity resolves the tuned entry the same way).
    if (model.draftPath) {
        push(args, "--spec-draft-ngl", model.draftGpuLayers);
        if (model.draftCpuMoe === true) {
            args.push("--spec-draft-cpu-moe");
        } else {
            push(args, "--spec-draft-n-cpu-moe", model.draftCpuMoeLayers);
        }
        // The draft context's own physical batch. Upstream's default (flag value 0) mirrors the
        // target's --ubatch-size; a smaller value trims the draft's VRAM footprint when it
        // competes with the target for a full card. Like the MoE cache, only a positive size is
        // ever sent - 0 is the upstream default, not a value worth an argument.
        if (Number.isInteger(model.draftUbatchSize) && model.draftUbatchSize > 0) {
            push(args, "--spec-draft-n-ubatch", model.draftUbatchSize);
        }
    }
    if (model.cpuMoe === true) args.push("--cpu-moe");
    push(args, "--n-cpu-moe", model.cpuMoeLayers);
    // A VRAM-side cache for the experts kept on the CPU (see --cpu-moe/--n-cpu-moe). Gated on
    // the model actually having experts, because llama.cpp refuses the start otherwise
    // (measured on b12110: "failed to initialize the context: MoE cache requires a MoE model"
    // kills a dense model's server before it listens) - the option is always visible in the
    // panel, so a dense model must silently ignore a stored value exactly like the MoE switches.
    // Upstream's default is 0 = disabled, so only a real positive size is ever sent.
    if (model.expertCount > 0 && Number.isInteger(model.moeCacheMib) && model.moeCacheMib > 0) {
        push(args, "--moe-cache-mib", model.moeCacheMib);
    }
    push(args, "--split-mode", model.splitMode);
    push(args, "--tensor-split", model.tensorSplit);
    push(args, "--main-gpu", model.mainGpu);
    push(args, "--override-tensor", model.overrideTensor);
    if (model.overrideKv) {
        const pairs = [];
        for (const key of Object.keys(model.overrideKv)) pairs.push(key + "=" + model.overrideKv[key]);
        if (pairs.length) push(args, "--override-kv", pairs.join(","));
    }
    push(args, "--threads", g.threads);
    if (g.threadsBatch && g.threadsBatch !== g.threads) push(args, "--threads-batch", g.threadsBatch);
    // Requests this model handles at once (llama.cpp --parallel). It is a per-model setting that
    // travels on the entry; only a positive integer is emitted. Anything else (empty, 0, negative,
    // non-numeric) leaves llama.cpp's own default.
    if (Number.isInteger(model.parallelSlots) && model.parallelSlots > 0) push(args, "--parallel", model.parallelSlots);
    push(args, "--cache-ram", g.cacheRamMiB);
    // These were server-level arguments the shared router used to receive; a per-model child
    // needs them too or the setting silently stops applying.
    if (g.cacheReuseChunk > 0) push(args, "--cache-reuse", g.cacheReuseChunk);
    push(args, "--cache-prompt", g.cachePrompt);
    push(args, "--cache-idle-slots", g.cacheIdleSlots);
    push(args, "--ctx-checkpoints", g.ctxCheckpoints);
    push(args, "--slot-save-path", g.slotSavePath);
    args.push(g.kvUnified === false ? "--no-kv-unified" : "--kv-unified");
    args.push(g.kvOffload === false ? "--no-kv-offload" : "--kv-offload");
    return args;
}

module.exports = { buildModelArgs };
