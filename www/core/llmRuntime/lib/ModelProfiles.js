// www/core/llmRuntime/lib/ModelProfiles.js
//
// Per-model settings, keyed by GGUF filename. Detection stays authoritative and is recomputed every
// start; only the user's choices live here. Defaults are exactly the option defaults that existed
// before profiles, so an untouched install emits the same preset it always did.
"use strict";

const DEFAULTS = {
    contextLength: 32768, kvTypeK: "q8_0", kvTypeV: "q8_0",
    batchSize: "", ubatchSize: "", gpuLayers: "auto",
    cpuMoe: false, cpuMoeLayers: "", loadMode: "", splitMode: "", tensorSplit: "",
    mainGpu: "", overrideTensor: "", expertCount: "", moeCacheMib: "",
    draftMax: 2, draftMin: 0, specDraftPMin: "", draftKvType: "",
    specMode: "auto", draftId: null,
    mmprojMode: "auto", mmprojId: null,
    parallelSlots: "",
    // The paired draft's own placement, per model like every other draft setting. The
    // card-level fields these replace were server-wide, which was wrong for a value that only
    // makes sense relative to the model whose draft it is (and its layer count).
    draftGpuLayers: "auto", draftCpuMoe: false, draftCpuMoeLayers: "", draftUbatchSize: ""
};

// The KV types the runtime accepts. Kept here rather than imported from StartConfig so a profile can
// be validated without loading the runtime.
const VALID_KV_TYPES = ["f32", "f16", "bf16", "q8_0", "q5_1", "q5_0", "q4_1", "q4_0", "iq4_nl"];

const LEGACY_OPTION_MAP = {
    runtimeContextLength: "contextLength", runtimeGpuLayers: "gpuLayers",
    runtimeCpuMoe: "cpuMoe", runtimeCpuMoeLayers: "cpuMoeLayers", runtimeLoadMode: "loadMode",
    runtimeSplitMode: "splitMode", runtimeTensorSplit: "tensorSplit", runtimeMainGpu: "mainGpu",
    runtimeOverrideTensor: "overrideTensor", runtimeExpertCount: "expertCount",
    runtimeDraftMax: "draftMax", runtimeDraftMin: "draftMin",
    runtimeDraftGpuLayers: "draftGpuLayers", runtimeDraftCpuMoe: "draftCpuMoe",
    runtimeDraftCpuMoeLayers: "draftCpuMoeLayers",
    runtimeParallelSlots: "parallelSlots"
};

function has(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }

function resolveProfile(profiles, targetId) {
    const stored = profiles && has(profiles, targetId) ? profiles[targetId] : null;
    const out = {};
    for (const key of Object.keys(DEFAULTS)) out[key] = DEFAULTS[key];
    if (stored) for (const key of Object.keys(stored)) out[key] = stored[key];
    // A profile written before the split carries one kvType. It becomes both sides unless the new
    // keys are already present, and an unrecognised value falls back to the default rather than
    // being carried into argv.
    if (stored && has(stored, "kvType") && !has(stored, "kvTypeK") && !has(stored, "kvTypeV")) {
        out.kvTypeK = stored.kvType;
        out.kvTypeV = stored.kvType;
    }
    if (VALID_KV_TYPES.indexOf(out.kvTypeK) === -1) out.kvTypeK = DEFAULTS.kvTypeK;
    if (VALID_KV_TYPES.indexOf(out.kvTypeV) === -1) out.kvTypeV = DEFAULTS.kvTypeV;
    if (out.draftKvType !== "" && VALID_KV_TYPES.indexOf(out.draftKvType) === -1) out.draftKvType = DEFAULTS.draftKvType;
    delete out.kvType;
    return out;
}

function setProfile(profiles, targetId, patch) {
    const next = {};
    const source = profiles || {};
    for (const key of Object.keys(source)) next[key] = Object.assign({}, source[key]);
    const merged = {};
    const current = has(next, targetId) ? next[targetId] : {};
    for (const key of Object.keys(current)) merged[key] = current[key];
    for (const key of Object.keys(patch || {})) merged[key] = patch[key];
    next[targetId] = merged;
    return next;
}

function migrate({ legacy, drafts, selectedId }) {
    const profiles = {};
    if (drafts && typeof drafts === "object") {
        for (const target of Object.keys(drafts)) {
            const entry = drafts[target];
            // Only a real file id may seed the pairing. The mode words are select values, not
            // ids: seeding one as draftId would both force a bogus draftPath at start and make
            // the panel render the "Off"/"Auto" pseudo-options from a stored id.
            if (entry && typeof entry === "object" && typeof entry.draft === "string" &&
                entry.draft !== "" && entry.draft !== "auto" && entry.draft !== "off" && entry.draft !== "none") {
                profiles[target] = { draftId: entry.draft, specMode: "auto" };
            }
        }
    }
    if (selectedId && legacy && typeof legacy === "object") {
        const seeded = {};
        for (const optionId of Object.keys(LEGACY_OPTION_MAP)) {
            if (has(legacy, optionId)) {
                const value = legacy[optionId];
                if (value !== undefined && value !== null && value !== "") {
                    seeded[LEGACY_OPTION_MAP[optionId]] = value;
                }
            }
        }
        // The single legacy KV type seeds both sides of the split.
        const legacyKv = legacy.runtimeKvType;
        if (legacyKv !== undefined && legacyKv !== null && legacyKv !== "") {
            seeded.kvTypeK = legacyKv;
            seeded.kvTypeV = legacyKv;
        }
        const existing = has(profiles, selectedId) ? profiles[selectedId] : {};
        profiles[selectedId] = Object.assign({}, seeded, existing);
    }
    return profiles;
}

function validate(profile, info) {
    const errors = [];
    const merged = resolveProfile({ x: profile }, "x");
    if (Number.isInteger(merged.contextLength) && merged.contextLength < 512) errors.push("context length must be at least 512");
    if (Number.isInteger(merged.expertCount) && info && info.expertCount &&
        merged.expertCount > info.expertCount) {
        errors.push("experts used per token (" + merged.expertCount + ") is larger than the model has (" + info.expertCount + ")");
    }
    if (merged.draftMax !== undefined && merged.draftMax !== "" && !Number.isInteger(merged.draftMax)) {
        errors.push("max draft tokens must be a whole number");
    }
    // KV types are checked against the raw profile, not the resolved one: resolveProfile
    // normalises an unknown value to the default, which would hide a user's bad choice here.
    if (profile && profile.kvTypeK !== undefined && VALID_KV_TYPES.indexOf(profile.kvTypeK) === -1) {
        errors.push("unknown K cache type: " + profile.kvTypeK);
    }
    if (profile && profile.kvTypeV !== undefined && VALID_KV_TYPES.indexOf(profile.kvTypeV) === -1) {
        errors.push("unknown V cache type: " + profile.kvTypeV);
    }
    if (profile && profile.draftKvType !== undefined && profile.draftKvType !== "" &&
        VALID_KV_TYPES.indexOf(profile.draftKvType) === -1) {
        errors.push("unknown draft cache type: " + profile.draftKvType);
    }
    // Batch sizes are emitted only from a real positive integer; empty keeps llama.cpp's own
    // default (2048 logical / 512 physical). The physical size must not exceed the effective
    // logical size (the configured batchSize, or the runtime's 2048 default when unset).
    const positiveIntOrEmpty = (value) => value === "" || (Number.isInteger(value) && value > 0);
    if (!positiveIntOrEmpty(merged.batchSize)) errors.push("logical batch size must be a whole number above zero");
    if (!positiveIntOrEmpty(merged.ubatchSize)) errors.push("physical batch size must be a whole number above zero");
    if (!positiveIntOrEmpty(merged.draftUbatchSize)) errors.push("draft physical batch size must be a whole number above zero");
    // The MoE GPU cache is off at 0 upstream, so only a positive size is a usable override;
    // empty (or a cleared field) keeps the flag unemitted.
    if (!positiveIntOrEmpty(merged.moeCacheMib)) errors.push("MoE GPU cache must be a whole number above zero");
    const effectiveBatch = Number.isInteger(merged.batchSize) && merged.batchSize > 0 ? merged.batchSize : 2048;
    if (Number.isInteger(merged.ubatchSize) && merged.ubatchSize > effectiveBatch) {
        errors.push("physical batch size (" + merged.ubatchSize + ") is larger than the logical batch size (" + effectiveBatch + ")");
    }
    // A draft probability threshold of 0 is meaningful (it is the flag's own default), so only a
    // number in [0, 1] is accepted; empty keeps the flag off.
    if (merged.specDraftPMin !== "" && !(typeof merged.specDraftPMin === "number" && merged.specDraftPMin >= 0 && merged.specDraftPMin <= 1)) {
        errors.push("draft probability threshold must be between 0 and 1");
    }
    return { ok: errors.length === 0, errors: errors };
}

module.exports = { DEFAULTS, LEGACY_OPTION_MAP, resolveProfile, setProfile, migrate, validate };
