// www/core/llmRuntime/lib/StartConfig.js
//
// The pure settings -> runtime-start mapping. Every caller that starts the runtime from a
// recorded settings object - the editor's startLocalInner and the console launcher - goes
// through this one module, so the two can never drift: whatever options were last set are
// applied the same way no matter who starts the server.
//
// The mapping is a function: it takes the settings object plus the discovered model entries
// and returns the manager config patch, the tuned model entries, the selected target and the
// resolved scalars the caller records. It touches no manager and no global state; the caller
// applies the patch. Validation errors (invalid port, impossible expert count, missing extra
// library folder, no models) throw with the exact messages the editor has always shown, and a
// throw means the caller applies nothing.
//
// Runs on the shipped Node 15 engine: no Array.prototype.at/findLast/toSorted, no
// Object.hasOwn, no structuredClone (see dev/check-node15-syntax.js).
"use strict";
const nodePath = require("path");
const { DEFAULT_CONFIG } = require("./RuntimeManager");
const Ports = require("./Ports");
const ModelRegistry = require("./ModelRegistry");
const ModelProfiles = require("./ModelProfiles");
const Offload = require("./Offload");
const GgufMeta = require("./GgufMeta");

// KV cache quantization values llama-server accepts for --cache-type-k/--cache-type-v.
// Anything else from a caller is replaced by DEFAULT_KV_TYPE.
const VALID_KV_TYPES = ["f32", "f16", "bf16", "q8_0", "q5_1", "q5_0", "q4_1", "q4_0", "iq4_nl"];

// The shipped KV cache type. Every model entry always carries an effective value - the
// configured one when it is a known type, otherwise this - so an untouched install emits
// q8_0 in each model section instead of falling back to llama.cpp's f16. The manager's own
// cacheTypeK/cacheTypeV defaults are a record only; nothing passes them to the server args.
const DEFAULT_KV_TYPE = "q8_0";

// A saved chat template is stored per model, named after the model file. The id is already a
// filename, but it can still contain characters a path must not, so it is sanitised. Mirrors
// llmRuntime.js exactly: the addon and the console must agree on where a template lives.
function templateFileName(modelId) {
    const base = String(modelId || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.+$/, "");
    return (base || "model") + ".jinja";
}

// The saved template override for a model, or null when there is none. `templatesDir` may be
// null (a caller that cannot or will not look at templates), which reads as "no override".
function chatTemplatePathFor({ templatesDir, modelId, fs }) {
    if (!templatesDir || !modelId || !fs) return null;
    const p = nodePath.join(templatesDir, templateFileName(modelId));
    try {
        return fs.existsSync(p) ? p : null;
    } catch (err) {
        return null;
    }
}

// A per-model profiles map is only used when it is an actual object. Anything else (absent,
// null, an array) keeps the legacy single-model path, which is the byte-identical compatibility
// path: an install that predates per-model settings emits exactly the model arguments it always did.
function isProfileMap(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

// The draft/head info (id + specType) the association detection recorded for a forced draft id,
// or null when the id is unknown.
function findDraftInfo(associations, draftId) {
    const drafts = associations && associations.drafts;
    if (!Array.isArray(drafts)) return null;
    for (let i = 0; i < drafts.length; i++) {
        if (drafts[i] && drafts[i].id === draftId) return drafts[i];
    }
    return null;
}

// The draft bounds from a profile. draftMax must be a positive integer, draftMin a non-negative
// one; the min is clamped to the max, exactly as the legacy tuning did. Meaningful for any entry
// with speculation active: a paired draft file, or a model drafting for itself with an embedded
// MTP head (llama.cpp's MTP loop reads the same n_max/n_min flags).
function applyDraftBounds(entry, profile) {
    if (Number.isInteger(profile.draftMax) && profile.draftMax >= 1) {
        entry.specDraftNMax = profile.draftMax;
    }
    if (Number.isInteger(profile.draftMin) && profile.draftMin >= 0) {
        const max = Number.isInteger(entry.specDraftNMax) ? entry.specDraftNMax : profile.draftMax;
        entry.specDraftNMin = Number.isInteger(max) ? Math.min(profile.draftMin, max) : profile.draftMin;
    }
}

// Fold one model's profile onto a copy of its entry: context size, the split KV cache types and
// batch sizes, the manual offload/MoE placement, the load mode and the number of parallel slots.
// Speculation/projector overrides are applied separately (applySpecProjectorOverride) because they
// can also remove detected keys.
function applyProfile(entry, profile) {
    let out = Object.assign({}, entry);
    if (Number.isInteger(profile.contextLength) && profile.contextLength >= 512) {
        out.contextSize = profile.contextLength;
    }
    // Requests this model serves at once (llama.cpp --parallel). Only a real positive integer is
    // accepted; anything else (empty, 0, negative, non-numeric, a string) leaves the entry
    // without the key, so ModelArgs omits the flag and llama.cpp uses its own default.
    if (Number.isInteger(profile.parallelSlots) && profile.parallelSlots > 0) {
        out.parallelSlots = profile.parallelSlots;
    }
    const kvTypeK = VALID_KV_TYPES.indexOf(profile.kvTypeK) === -1 ? DEFAULT_KV_TYPE : profile.kvTypeK;
    const kvTypeV = VALID_KV_TYPES.indexOf(profile.kvTypeV) === -1 ? DEFAULT_KV_TYPE : profile.kvTypeV;
    out.kvTypeK = kvTypeK;
    out.kvTypeV = kvTypeV;
    // Batch sizes are emitted only from a real positive integer; anything else leaves the key absent
    // so ModelArgs omits the flag and llama.cpp keeps its own default (2048 / 512).
    const batchSize = Number.isInteger(profile.batchSize) && profile.batchSize > 0 ? profile.batchSize : null;
    if (batchSize !== null) out.batchSize = batchSize;
    if (Number.isInteger(profile.ubatchSize) && profile.ubatchSize > 0) {
        // Enforce the same rule ModelProfiles.validate expresses (ubatch must not exceed the
        // effective batch) on the path that actually builds argv. The form-level validation is
        // not wired to the options form yet (a known limitation), so a UI-reachable
        // batchSize="" + ubatchSize=4096 used to reach the child unbounded; the clamp means the
        // child can never receive --ubatch-size above --batch-size (or the runtime's 2048 default
        // when no logical batch size is set).
        const effectiveBatch = batchSize !== null ? batchSize : 2048;
        out.ubatchSize = Math.min(profile.ubatchSize, effectiveBatch);
    }
    // The draft context's own physical batch (--spec-draft-n-ubatch). Upstream's default is
    // "same as --n-ubatch" (the flag's 0), so only a real positive integer is emitted and
    // anything else leaves the key absent, keeping llama.cpp's default. No cross-clamp against
    // the target's ubatch: the draft runs its own context, and upstream imposes no such rule.
    if (Number.isInteger(profile.draftUbatchSize) && profile.draftUbatchSize > 0) {
        out.draftUbatchSize = profile.draftUbatchSize;
    }
    // The GPU-side cache of the CPU-kept MoE experts (--moe-cache-mib). Upstream's default is
    // 0 (disabled), so like the draft ubatch only a positive integer is ever emitted - and only
    // for a model that actually has experts: llama.cpp refuses the whole start on a dense model
    // ("MoE cache requires a MoE model", measured on b12110), so a stored value on a dense
    // model is dropped here rather than persisted into a server that cannot come up.
    if (entry.expertCount > 0 && Number.isInteger(profile.moeCacheMib) && profile.moeCacheMib > 0) {
        out.moeCacheMib = profile.moeCacheMib;
    }
    // A draft probability threshold of 0 is meaningful (it is the flag's own default), so the key is
    // set whenever the value is a number in range.
    if (typeof profile.specDraftPMin === "number" && profile.specDraftPMin >= 0 && profile.specDraftPMin <= 1) {
        out.specDraftPMin = profile.specDraftPMin;
    }
    if (typeof profile.draftKvType === "string" && VALID_KV_TYPES.indexOf(profile.draftKvType) !== -1) {
        out.draftKvType = profile.draftKvType;
    }
    out = Offload.applyOffloadTuning(out, {
        gpuLayers: profile.gpuLayers,
        cpuMoe: profile.cpuMoe,
        cpuMoeLayers: profile.cpuMoeLayers,
        // The draft's own placement, a per-model profile field like the rest of the draft
        // settings (the old card-level fields seed a profile once and are gone).
        draftGpuLayers: profile.draftGpuLayers,
        draftCpuMoe: profile.draftCpuMoe,
        draftCpuMoeLayers: profile.draftCpuMoeLayers,
        splitMode: profile.splitMode,
        tensorSplit: profile.tensorSplit,
        mainGpu: profile.mainGpu,
        overrideTensor: profile.overrideTensor,
        loadMode: profile.loadMode
    });
    // VRAM margin for llama.cpp's fit, a scalar beside contextLength. Normalised the same way
    // the legacy tuning path does, so ModelArgs never receives a non-numeric value.
    const fitTarget = Offload.normalizeFitTarget(profile.fitTarget);
    if (fitTarget !== undefined) out.fitTarget = fitTarget;
    return out;
}

// Apply the profile's speculation and projector choices on top of the entry detection.
//   - specMode "off" drops every speculation key;
//   - a forced draftId wins and carries that file's detected spec type plus the profile bounds;
//   - otherwise ("auto") detection stands, and the bounds are applied whenever speculation is
//     active - a paired draft file, or the model's own embedded MTP head;
//   - mmprojMode "off" drops the projector, a forced mmprojId sets it, otherwise detection.
function applySpecProjectorOverride(entry, profile, associations, modelsDir) {
    const out = Object.assign({}, entry);
    const dir = modelsDir || "";
    if (profile.specMode === "off") {
        delete out.specType;
        delete out.draftPath;
        delete out.specDraftNMax;
        delete out.specDraftNMin;
        delete out.mtpCapable;
        // Spec 3.3: "off" drops every speculation key, so the draft's KV type, its physical
        // batch size and p-min go too.
        delete out.draftKvType;
        delete out.draftUbatchSize;
        delete out.specDraftPMin;
    } else if (profile.draftId) {
        out.draftPath = nodePath.join(dir, profile.draftId);
        const info = findDraftInfo(associations, profile.draftId);
        if (info && info.specType) out.specType = info.specType;
        applyDraftBounds(out, profile);
    } else if (out.draftPath || out.mtpCapable === true) {
        applyDraftBounds(out, profile);
    }
    // The draft KV type needs a --model-draft (an embedded MTP head has no separate cache of
    // its own - its context is derived from the target's), so an entry with no draft path
    // carries none; the draft's physical batch size follows the same rule, since the flag only
    // tunes the draft context. The probability threshold is different: the MTP head's own
    // drafting loop reads it, so it stays for a model that drafts for itself - but a plain
    // model with no speculation at all still drops it.
    if (!out.draftPath) {
        delete out.draftKvType;
        delete out.draftUbatchSize;
        if (out.mtpCapable !== true) delete out.specDraftPMin;
    }
    if (profile.mmprojMode === "off") {
        delete out.mmprojPath;
    } else if (profile.mmprojId) {
        out.mmprojPath = nodePath.join(dir, profile.mmprojId);
    }
    return out;
}

// The arch-keyed expert override for one entry's profile. The key must carry the entry's own
// architecture, and the count is checked against the entry's own expert count discovered with
// the model, falling back to reading the GGUF. For the selected entry (strict) a failure throws
// the exact messages the editor has always shown; for any other entry a failure simply leaves
// the override off, so a stale setting on a model that is not starting cannot block the start.
function expertOverrideForEntry(entry, expertCount, fs, strict) {
    const count = parseInt(expertCount, 10);
    if (!isFinite(count) || count < 1) return null;
    let arch = entry.arch;
    let available = entry.expertCount;
    if (!arch) {
        if (!entry.modelPath) {
            if (strict) {
                throw new Error("The selected model has no file path, so the expert count cannot be applied.");
            }
            return null;
        }
        const meta = GgufMeta.readModelInfo({ filePath: entry.modelPath, fs: fs });
        if (!meta || !meta.arch) {
            if (strict) {
                throw new Error("Could not read the model's architecture from " + entry.modelPath +
                    ", so the expert count cannot be applied. Check that the file is a complete GGUF.");
            }
            return null;
        }
        arch = meta.arch;
        available = meta.expertCount;
    }
    if (!available) {
        if (strict) {
            throw new Error("This model is not a Mixture-of-Experts model (its metadata has no expert count), " +
                "so the expert count does not apply to it.");
        }
        return null;
    }
    if (count > available) {
        if (strict) {
            throw new Error("This model has only " + available + " experts, so " + count + " cannot be used.");
        }
        return null;
    }
    const overrideKv = {};
    overrideKv[GgufMeta.expertUsedCountKey(arch)] = "int:" + count;
    return { overrideKv: overrideKv, expertInfo: { count: count, available: available, arch: arch } };
}

// Build everything a start needs. Input:
//   opts          - the settings object (startLocal opts, or the recorded settings from
//                   laststart.json); every key the editor records is consumed:
//                   modelId, draftMax, draftMin, contextLength, kvType (legacy single value,
//                   split into kvTypeK/kvTypeV on the entries), kvUnified, kvOffload,
//                   backend, gpuLayers, cpuMoe, cpuMoeLayers, splitMode, tensorSplit, mainGpu,
//                   overrideTensor, expertCount, libDir, loadMode, modelsMax, sleepIdleSeconds,
//                   threads, threadsBatch, cacheRam, ctxCheckpoints, cacheReuse,
//                   waitIdleSeconds, port, profiles
//   associations  - the ModelAssociations.associate result, used to resolve a forced draft's
//                   spec type (optional; only read when profiles are present)
//   entries       - model entries from ModelRegistry.buildModelEntries
//   modelsDir     - the models directory, for the no-models error message
//   templatesDir  - the per-model chat-template override directory (or null)
//   fs            - the filesystem module
//   defaultPort   - the shipped default port (defaults to RuntimeManager.DEFAULT_CONFIG.port)
//
// Resolves { managerConfigPatch, tunedModels, targetId, tunedTarget, expertInfo, overrideKv,
// kvType (the status scalar; the entries carry kvTypeK/kvTypeV), kvUnified, kvOffload,
// modelsMax, sleepIdleSeconds, threads, threadsBatch, port,
// waitIdleSeconds, libDir, backend, forceCpu }.
function buildStartConfig(opts) {
    const input = opts || {};
    const settings = input.opts || {};
    const entries = input.entries || [];
    const fs = input.fs;
    const defaultPort = input.defaultPort === undefined ? DEFAULT_CONFIG.port : input.defaultPort;
    if (!fs) throw new Error("StartConfig needs a fs module");

    if (!ModelRegistry.hasModels(entries)) {
        throw new Error("No GGUF models found in " + input.modelsDir +
            ". Put GGUF files in data/llama/models/.");
    }
    // Resolve the target first so the runtime tuning is applied to the right entry, then hand
    // the tuned entries to the manager for both the normal start and the CPU retry.
    const targetId = ModelRegistry.selectTargetModel({ entries, preferredId: settings.modelId });
    if (!targetId) {
        throw new Error("No GGUF models found in " + input.modelsDir +
            ". Put GGUF files in data/llama/models/.");
    }
    // Per-model profiles. When the map is present every entry is decorated with its own stored
    // settings; when it is absent the legacy single-model tuning below runs byte-for-byte, so an
    // install that predates per-model settings emits exactly the model arguments it always did.
    const useProfiles = isProfileMap(input.profiles);
    const associations = isProfileMap(input.associations) ? input.associations : null;
    // A saved template overrides the model's own; the child then carries the file path. It is a
    // per-target file, so it is applied to the selected entry in both paths.
    const chatTemplatePath = chatTemplatePathFor({
        templatesDir: input.templatesDir, modelId: targetId, fs: fs
    });
    let tunedModels;
    let tunedTarget = null;
    let expertInfo = null;
    let overrideKv = null;
    if (useProfiles) {
        tunedModels = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const profile = ModelProfiles.resolveProfile(input.profiles, entry.id);
            // The card's VRAM-headroom option is not a profile field: it decorates the selected
            // model's entry on every start. The draft placement trio used to be stamped the same
            // way, which let the card's one global value override the per-model stored one on
            // every start; those are profile fields now, so the profile's own value stands.
            if (entry.id === targetId) {
                profile.fitTarget = settings.fitTarget;
            }
            let next = applyProfile(entry, profile);
            next = applySpecProjectorOverride(next, profile, associations, input.modelsDir);
            const expert = expertOverrideForEntry(next, profile.expertCount, fs, entry.id === targetId);
            if (expert) {
                next.overrideKv = expert.overrideKv;
                if (entry.id === targetId) {
                    expertInfo = expert.expertInfo;
                    overrideKv = expert.overrideKv;
                }
            }
            if (entry.id === targetId && chatTemplatePath) next.chatTemplatePath = chatTemplatePath;
            tunedModels.push(next);
        }
        for (let i = 0; i < tunedModels.length; i++) {
            if (tunedModels[i].id === targetId) { tunedTarget = tunedModels[i]; break; }
        }
    } else {
        // Manual offload/MoE settings. Offload.js keeps only values the pinned engine
        // accepts, so a blank or malformed field simply leaves the default in place.
        const offload = {
            gpuLayers: settings.gpuLayers,
            cpuMoe: settings.cpuMoe,
            cpuMoeLayers: settings.cpuMoeLayers,
            // The paired draft's own placement trio. Harmless on an unpaired entry: ModelArgs
            // gates every --spec-draft-* flag on the entry actually having a draft.
            draftGpuLayers: settings.draftGpuLayers,
            draftCpuMoe: settings.draftCpuMoe,
            draftCpuMoeLayers: settings.draftCpuMoeLayers,
            splitMode: settings.splitMode,
            tensorSplit: settings.tensorSplit,
            mainGpu: settings.mainGpu,
            overrideTensor: settings.overrideTensor,
            loadMode: settings.loadMode
        };
        tunedModels = ModelRegistry.applyRuntimeTuning({
            entries: entries,
            modelId: targetId,
            draftMax: settings.draftMax,
            draftMin: settings.draftMin,
            contextLength: settings.contextLength,
            // The VRAM margin is a scalar beside contextLength, applied to the selected entry.
            // It is normalised inside applyRuntimeTuning, so only an integer (or nothing) can
            // reach the entry ModelArgs emits verbatim.
            fitTarget: settings.fitTarget,
            offload: offload,
            chatTemplatePath: chatTemplatePath
        });
        for (let i = 0; i < tunedModels.length; i++) {
            if (tunedModels[i].id === targetId) { tunedTarget = tunedModels[i]; break; }
        }
    }

    const patch = {};
    // KV cache quantization is per model now: every entry carries the effective types. The legacy
    // single-model path predates the K/V split, so its one value is validated here and applied to
    // both sides of each entry below. Only a known value is accepted; anything else (including an
    // unset option) falls back to the shipped q8_0, which each model's server arguments emit
    // explicitly.
    let kvType = settings.kvType;
    if (VALID_KV_TYPES.indexOf(kvType) === -1) {
        kvType = DEFAULT_KV_TYPE;
    }
    // Unified KV and KV offload are on unless explicitly turned off.
    const kvUnified = !(settings.kvUnified === false);
    const kvOffload = !(settings.kvOffload === false);
    patch.kvUnified = kvUnified;
    patch.kvOffload = kvOffload;
    // Reasoning is a server-side default, not a lock: a request that explicitly asks for
    // thinking still gets it (measured on the pinned build). Anything outside the three real
    // values - including an unset option from a start that predates it - falls back to the
    // shipped off, so a bad value never reaches a child's argv.
    const reasoning = ["off", "auto", "on"].indexOf(settings.reasoning) === -1 ? "off" : settings.reasoning;
    patch.reasoning = reasoning;
    // Server-level knobs that are not per-model: how many models may be resident at once, how
    // long an idle model is kept before it is put to sleep, and the CPU thread count. Only
    // explicit, in-range values are accepted; anything else restores the manager's default so
    // a blank form field behaves exactly as it did before these options existed.
    let modelsMax = parseInt(settings.modelsMax, 10);
    if (isFinite(modelsMax) && modelsMax >= 1) {
        patch.modelsMax = modelsMax;
    } else {
        modelsMax = null;
        patch.modelsMax = DEFAULT_CONFIG.modelsMax;
    }
    let sleepIdle = parseInt(settings.sleepIdleSeconds, 10);
    if (isFinite(sleepIdle) && sleepIdle > 0) {
        patch.sleepIdleSeconds = sleepIdle;
    } else {
        sleepIdle = 0;
        patch.sleepIdleSeconds = 0;
    }
    let threads = parseInt(settings.threads, 10);
    let threadsBatch = parseInt(settings.threadsBatch, 10);
    if (isFinite(threads) && threads > 0) {
        patch.threads = threads;
        patch.threadsBatch = (isFinite(threadsBatch) && threadsBatch > 0) ? threadsBatch : threads;
    } else {
        threads = null;
        threadsBatch = null;
        patch.threads = 0;
        patch.threadsBatch = 0;
    }
    // KV cache knobs. Each keeps the shipped default when blank or out of range, so clearing
    // the field is always safe; 0 is valid for ctx-checkpoints (no minimum spacing) and for
    // cache-ram (disable the prompt cache), so only a negative or non-numeric value resets.
    let cacheRam = parseInt(settings.cacheRam, 10);
    if (isFinite(cacheRam) && cacheRam >= 0) patch.cacheRamMiB = cacheRam;
    let ctxCheckpoints = parseInt(settings.ctxCheckpoints, 10);
    if (isFinite(ctxCheckpoints) && ctxCheckpoints >= 0) patch.ctxCheckpoints = ctxCheckpoints;
    let cacheReuse = parseInt(settings.cacheReuse, 10);
    if (isFinite(cacheReuse) && cacheReuse > 0) patch.cacheReuseChunk = cacheReuse;
    // How long a model switch waits for the outgoing model's in-flight request(s) to finish
    // before evicting it anyway, in seconds. 0 disables the wait (the switch evicts at once);
    // a blank, whitespace, non-numeric or negative value restores the shipped default (30
    // minutes). Fractions are kept so "0.5" is a real 500 ms cap rather than silently becoming
    // 0 (which would disable the wait - the opposite of what was asked).
    const rawWait = settings.waitIdleSeconds;
    let waitIdleSeconds = NaN;
    if (typeof rawWait === "number") {
        waitIdleSeconds = rawWait;
    } else if (typeof rawWait === "string" && rawWait.trim() !== "") {
        waitIdleSeconds = Number(rawWait);
    }
    if (isFinite(waitIdleSeconds) && waitIdleSeconds >= 0) {
        patch.waitIdleSeconds = waitIdleSeconds;
    } else {
        waitIdleSeconds = DEFAULT_CONFIG.waitIdleSeconds;
        patch.waitIdleSeconds = waitIdleSeconds;
    }
    // The port the server should serve on. A blank field means the shipped default; an explicit
    // value is honored exactly or the start fails, so a client's address never changes silently.
    // A configured but invalid value is refused rather than quietly replaced with the default.
    const portInfo = Ports.normalizePort(settings.port);
    if (!portInfo.ok) throw new Error(portInfo.reason);
    const port = portInfo.port === null ? defaultPort : portInfo.port;
    patch.port = port;
    if (!useProfiles) {
        // Expert count for MoE models. llama.cpp changes how many experts are active per token
        // through a metadata override keyed by the model's architecture ("gemma4.expert_used_count",
        // not the generic "llama.expert_used_count" most tutorials show, which is silently ignored
        // for any other architecture). Entries carry the architecture and expert count discovered
        // with the model (see ModelRegistry.buildModelEntries), so the override is keyed by the
        // selected entry's own arch and checked against that entry's own expert count. An entry
        // without that discovery falls back to reading the GGUF, so the old error messages stand.
        const expertCount = parseInt(settings.expertCount, 10);
        if (isFinite(expertCount) && expertCount >= 1) {
            let arch = tunedTarget ? tunedTarget.arch : null;
            let available = tunedTarget ? tunedTarget.expertCount : null;
            if (!arch) {
                if (!tunedTarget || !tunedTarget.modelPath) {
                    throw new Error("The selected model has no file path, so the expert count cannot be applied.");
                }
                const meta = GgufMeta.readModelInfo({ filePath: tunedTarget.modelPath, fs: fs });
                if (!meta || !meta.arch) {
                    throw new Error("Could not read the model's architecture from " + tunedTarget.modelPath +
                        ", so the expert count cannot be applied. Check that the file is a complete GGUF.");
                }
                arch = meta.arch;
                available = meta.expertCount;
            }
            if (!available) {
                throw new Error("This model is not a Mixture-of-Experts model (its metadata has no expert count), " +
                    "so the expert count does not apply to it.");
            }
            if (expertCount > available) {
                throw new Error("This model has only " + available + " experts, so " +
                    expertCount + " cannot be used.");
            }
            overrideKv = {};
            overrideKv[GgufMeta.expertUsedCountKey(arch)] = "int:" + expertCount;
            expertInfo = { count: expertCount, available: available, arch: arch };
        }
        // The cache type and the expert override now travel with each model entry instead of the
        // manager patch, so different models can start with different runtime settings. Every
        // entry carries the chosen cache type; only the selected entry carries the override. The
        // legacy path threads one kvType and applies it to both sides of the split.
        tunedModels = tunedModels.map(function (item) {
            const copy = Object.assign({}, item, { kvTypeK: kvType, kvTypeV: kvType });
            if (item.id === targetId) copy.overrideKv = overrideKv;
            return copy;
        });
        tunedTarget = null;
        for (let i = 0; i < tunedModels.length; i++) {
            if (tunedModels[i].id === targetId) { tunedTarget = tunedModels[i]; break; }
        }
    } else {
        // The profile path already decorated every entry; the status scalars now describe the
        // selected entry, whose own profile is what the server will actually run with. Both sides
        // of the split are equal there, so either one feeds the legacy status scalar.
        kvType = tunedTarget ? tunedTarget.kvTypeK : DEFAULT_KV_TYPE;
    }
    // Backend selection. "cpu" forces the CPU; a specific backend becomes the preference;
    // "auto" (or anything unknown) restores the automatic priority order. The `opts &&`
    // shape mirrors the editor exactly: a wholly absent opts object reads as null here, not
    // undefined, which the recorded settings distinguish ("auto" vs null).
    const backend = input.opts && input.opts.backend;
    const forceCpu = backend === "cpu";
    if (backend === "cuda" || backend === "rocm" || backend === "vulkan") {
        patch.backendPreference = backend;
    } else if (backend === "auto" || backend === "" || backend === undefined || backend === null) {
        patch.backendPreference = null;
    }
    // Extra library folder, for a GPU runtime installed outside the system paths (a ROCm tree
    // in a user folder, say). Checked here so a typo is reported at once instead of surfacing
    // later as a mysterious "no GPU found".
    let libDir = settings.libDir;
    if (typeof libDir === "string" && libDir.trim() !== "") {
        libDir = libDir.trim();
        let libStat = null;
        try { libStat = fs.statSync(libDir); } catch (err) { libStat = null; }
        if (!libStat || !libStat.isDirectory()) {
            throw new Error("The extra library folder does not exist: " + libDir);
        }
        patch.libDir = libDir;
    } else {
        libDir = null;
        patch.libDir = null;
    }

    return {
        managerConfigPatch: patch,
        tunedModels: tunedModels,
        targetId: targetId,
        tunedTarget: tunedTarget,
        expertInfo: expertInfo,
        overrideKv: overrideKv,
        kvType: kvType,
        kvUnified: kvUnified,
        kvOffload: kvOffload,
        modelsMax: modelsMax,
        sleepIdleSeconds: sleepIdle,
        threads: threads,
        threadsBatch: threadsBatch,
        cacheRamMiB: isFinite(cacheRam) ? cacheRam : null,
        ctxCheckpoints: isFinite(ctxCheckpoints) ? ctxCheckpoints : null,
        cacheReuseChunk: isFinite(cacheReuse) ? cacheReuse : null,
        waitIdleSeconds: waitIdleSeconds,
        port: port,
        libDir: libDir,
        backend: backend,
        forceCpu: forceCpu
    };
}

module.exports = {
    VALID_KV_TYPES,
    templateFileName,
    chatTemplatePathFor,
    buildStartConfig
};
