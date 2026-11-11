// www/core/llmRuntime/lib/ModelRegistry.js
"use strict";
const nodePath = require("path");
const Offload = require("./Offload");
const ModelInfo = require("./ModelInfo");
const ModelAssociations = require("./ModelAssociations");

const VALID_SPEC_TYPES = ["draft-dflash", "draft-dspark", "draft-mtp"];
const DEFAULT_CONTEXT_SIZE = 32768;
const DEFAULT_GPU_LAYERS = "auto";
// The app's shipped max draft length (the old runtimeDraftMax default). An auto-detected draft
// must use it, otherwise it falls back to llama.cpp's own default of 3.
const DEFAULT_SPEC_DRAFT_N_MAX = 2;

function report(onError, err) {
    if (typeof onError === "function") onError(err);
}

function loadRegistry({ registryPath, fs, onError }) {
    if (!registryPath || !fs || !fs.existsSync(registryPath)) return { pairs: {} };
    let raw;
    try {
        raw = fs.readFileSync(registryPath, "utf8");
    } catch (err) {
        report(onError, err);
        return { pairs: {} };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        report(onError, err);
        return { pairs: {} };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        report(onError, new Error("Draft registry must be a JSON object mapping target files to pairs"));
        return { pairs: {} };
    }
    const pairs = {};
    for (const target of Object.keys(parsed)) {
        const entry = parsed[target];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            report(onError, new Error(`Draft registry entry for "${target}" must be an object`));
            continue;
        }
        if (typeof entry.draft !== "string" || !entry.draft) {
            report(onError, new Error(`Draft registry entry for "${target}" needs a "draft" filename`));
            continue;
        }
        if (VALID_SPEC_TYPES.indexOf(entry.specType) === -1) {
            report(onError, new Error(
                `Draft registry entry for "${target}" has unknown specType "${entry.specType}" ` +
                `(expected ${VALID_SPEC_TYPES.join(" or ")})`
            ));
            continue;
        }
        if (!Number.isInteger(entry.specDraftNMax)) {
            report(onError, new Error(`Draft registry entry for "${target}" needs an integer "specDraftNMax"`));
            continue;
        }
        pairs[target] = {
            draft: entry.draft,
            specType: entry.specType,
            specDraftNMax: entry.specDraftNMax
        };
    }
    return { pairs };
}

// Build the list of models the engine may bind. Drafts, MTP heads and projectors are
// recognised from their GGUF content (see ModelInfo/ModelAssociations) and are never
// offered as standalone entries: the router lists plain filenames sorted, and a draft
// name (e.g. "*-dflash-*") can easily sort before its target, which would make the UI
// bind the engine to an unusable model. An optional `readInfo(filePath)` seam lets
// tests inject detection without real GGUF bytes.
function buildModelEntries({ modelsDir, registryPath, fs, onError, readInfo }) {
    if (!modelsDir || !fs || !fs.existsSync(modelsDir)) return [];
    let names;
    try {
        names = fs.readdirSync(modelsDir);
    } catch (err) {
        report(onError, err);
        return [];
    }
    const read = function (filePath) {
        if (typeof readInfo === "function") return readInfo(filePath);
        return ModelInfo.readModelFile({ filePath: filePath, fs: fs });
    };
    const all = [];
    for (let i = 0; i < names.length; i++) {
        if (!/\.gguf$/i.test(names[i])) continue;
        const info = read(nodePath.join(modelsDir, names[i]));
        if (info) all.push(info);
    }
    // Every classified file by id, so an entry can consult its paired draft's own facts.
    const infoById = {};
    for (let i = 0; i < all.length; i++) infoById[all[i].id] = all[i];
    const assoc = ModelAssociations.associate(all);
    const { pairs } = loadRegistry({ registryPath, fs, onError });
    // Sort by id so the entry order is deterministic and independent of readdirSync order:
    // selectTargetModel falls back to entries[0], so an unsorted list would make the default
    // model the runtime loads depend on the filesystem.
    const selectable = assoc.selectable.slice().sort(function (a, b) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const entries = [];
    for (let i = 0; i < selectable.length; i++) {
        const info = selectable[i];
        const entry = {
            id: info.id,
            arch: info.arch,
            expertCount: info.expertCount,
            // Layer count and attention KV widths: the load-mode recommendation's VRAM
            // accounting sizes the KV cache (and recognises a manual partial layer count)
            // from these. null mirrors expertCount - the key is simply absent.
            blockCount: info.blockCount,
            attnKeyLength: info.attnKeyLength,
            attnValueLength: info.attnValueLength,
            contextSize: DEFAULT_CONTEXT_SIZE,
            gpuLayers: DEFAULT_GPU_LAYERS,
            // GGUF facts the serving layer needs but the registry never carried: RuntimeInfo
            // reads them for /v1/models meta and the /props fallback, so a client sees the
            // model's real trained context and size instead of zeros. nParams is deliberately
            // not invented: the GGUF does not expose a parameter count this reader collects.
            contextLengthTrain: info.contextLength == null ? null : info.contextLength,
            bytes: info.bytes == null ? null : info.bytes,
            hasVision: info.vision === true,
            // The raw general.file_type enum, as a string (RuntimeInfo's shape), or "" when the
            // model does not declare it.
            ftype: info.fileType == null ? "" : String(info.fileType),
            // Always carry the absolute path. Each model's server arguments need a real
            // `-m <path>` even for a discovered model: without it llama-server has no model
            // to load and every request hangs until it fails with "model ... is not running".
            modelPath: info.path || nodePath.join(modelsDir, info.id)
        };
        const detected = assoc.byTarget[info.id] || { draft: null, mmproj: null };
        // An explicit drafts.json entry wins over the content association, unchanged from before.
        const pair = pairs[info.id];
        let draftId = detected.draft ? detected.draft.id : null;
        let specType = detected.draft ? detected.draft.specType : info.specType;
        let pairApplied = false;
        if (pair) {
            if (!fs.existsSync(nodePath.join(modelsDir, pair.draft))) {
                report(onError, new Error(
                    "Draft model \"" + pair.draft + "\" for \"" + info.id + "\" was not found in " +
                    modelsDir + "; ignoring the pairing"));
            } else {
                draftId = pair.draft;
                specType = pair.specType;
                pairApplied = true;
            }
        }
        if (draftId) {
            entry.draftPath = nodePath.join(modelsDir, draftId);
            entry.specType = specType;
            entry.specDraftNMax = pairApplied ? pair.specDraftNMax : DEFAULT_SPEC_DRAFT_N_MAX;
            // The draft's own expert count: the draft MoE flags only mean anything (for the
            // load mode as for placement) when the paired file itself has expert weights.
            // Normalised to null when unknown, mirroring the target's expertCount.
            const draftInfo = infoById[draftId];
            entry.draftExpertCount = draftInfo && draftInfo.expertCount != null ? draftInfo.expertCount : null;
        } else if (specType && info.mtpCapable) {
            entry.specType = specType;   // embedded MTP head: no model-draft
            entry.mtpCapable = true;
            // An embedded head drafts exactly like a detected draft, so it gets the same
            // recommended default bound. llama.cpp's own default proposes more tokens than
            // the acceptance rate pays for on translation workloads, and the head cannot
            // be tuned at all without this - the profile's draftMax/draftMin ride the same
            // spec flags (verified in the b11429 source: the MTP drafting loop reads
            // n_max / n_min / p_min itself).
            entry.specDraftNMax = DEFAULT_SPEC_DRAFT_N_MAX;
        }
        if (detected.mmproj) entry.mmprojPath = nodePath.join(modelsDir, detected.mmproj.id);
        entries.push(entry);
    }
    return entries;
}

// Pick the model the engine should bind. Preference order:
//   1. preferredId, if it names a known entry;
//   2. the first entry that has a paired draft (a configured or content-detected target);
//   3. the first entry;
//   4. null when there are no entries.
function selectTargetModel({ entries, preferredId }) {
    const list = Array.isArray(entries) ? entries : [];
    if (preferredId) {
        const match = list.find((e) => e.id === preferredId);
        if (match) return match.id;
    }
    const paired = list.find((e) => e.draftPath);
    if (paired) return paired.id;
    return list.length ? list[0].id : null;
}

function hasModels(entries) {
    return Array.isArray(entries) && entries.length > 0;
}

// Apply the UI's runtime tuning to the entries before each model's server arguments are built. The draft
// values affect a model with speculation active - a paired draft file or the model's own embedded
// MTP head: `draftMax` must be a positive integer and `draftMin` a
// non-negative integer to take effect; anything else leaves the registry's per-model value in
// place. `contextLength` is a plain-model setting, so it is applied to the selected entry
// whether or not it is paired, but only when it is an integer >= 512. `offload` carries the
// manual GPU/MoE settings (see Offload.js); only recognised values are applied.
// `chatTemplatePath` overrides the model's embedded chat template when set.
// `fitTarget` is the per-device VRAM margin llama.cpp's fit leaves free (MiB); it is a scalar
// beside `contextLength`, applied to the selected entry only.
// Returns a new array; the input entries are not mutated.
function applyRuntimeTuning({ entries, modelId, draftMax, draftMin, contextLength, offload, chatTemplatePath, fitTarget }) {
    const list = Array.isArray(entries) ? entries : [];
    return list.map((entry) => {
        if (entry.id !== modelId) return entry;
        let tuned = entry;
        if (entry.draftPath || entry.mtpCapable === true) {
            tuned = Object.assign({}, entry);
            if (Number.isInteger(draftMax) && draftMax >= 1) tuned.specDraftNMax = draftMax;
            if (Number.isInteger(draftMin) && draftMin >= 0) {
                tuned.specDraftNMin = Math.min(draftMin, tuned.specDraftNMax);
            }
        }
        if (Number.isInteger(contextLength) && contextLength >= 512) {
            if (tuned === entry) tuned = Object.assign({}, entry);
            tuned.contextSize = contextLength;
        }
        const normalisedFitTarget = Offload.normalizeFitTarget(fitTarget);
        if (normalisedFitTarget !== undefined) {
            if (tuned === entry) tuned = Object.assign({}, entry);
            tuned.fitTarget = normalisedFitTarget;
        }
        if (offload) tuned = Offload.applyOffloadTuning(tuned, offload);
        if (typeof chatTemplatePath === "string" && chatTemplatePath) {
            if (tuned === entry) tuned = Object.assign({}, entry);
            tuned.chatTemplatePath = chatTemplatePath;
        }
        return tuned;
    });
}

module.exports = {
    VALID_SPEC_TYPES,
    loadRegistry,
    buildModelEntries,
    selectTargetModel,
    hasModels,
    applyRuntimeTuning
};
