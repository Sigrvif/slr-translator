"use strict";
// Per-endpoint settings are derived as "options that have a fallback (`2`) variant".
// That rule also caught the quality-control toggles (retry/reject/glossary/repetition
// cleanup), which are shared across the whole endpoint pool and read by the engine from
// the base/`2` options directly — so the generated ep{N}_ clones were dead UI. This
// checks the fallback-only toggles are excluded while genuine per-endpoint settings stay.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("module");

const DIR = path.join(__dirname, "..");

function loadWrapper() {
    const originalLoad = Module._load;
    Module._load = function (request) {
        if (request === "@redsugoi/mtl-text-processor") return {};
        if (request === "./TranslationEngineOption") return { TranslationEngineOption: class {} };
        return originalLoad.apply(this, arguments);
    };
    try {
        return require(path.join(DIR, "DSLRTranslationEngineWrapper.js"));
    } finally {
        Module._load = originalLoad;
    }
}

const SAMPLE_IDS = [
    "apiUrl", "apiUrl2", "temperature", "temperature2", "top_k", "top_k2",
    "maxTokens", "maxTokens2", "enableRetry", "enableRetry2",
    "enableReject", "enableReject2", "enableRejectJapanese", "enableRejectJapanese2",
    "enableRejectGlossary", "enableRejectGlossary2",
    "enableRemoveRepetition", "enableRemoveRepetition2",
    "enableRemoveInnerIDSP", "enableRemoveInnerIDSP2"
];

function settingsList(mod) {
    const fake = { storedOptionsHash: {}, _endpointSettingsCache: null };
    for (const id of SAMPLE_IDS) fake.storedOptionsHash[id] = { getId: () => id };
    return mod.DSLRTranslationEngineWrapper.prototype._getEndpointSettingsList.call(fake);
}

test("genuine per-endpoint settings are still materialized", () => {
    const list = settingsList(loadWrapper());
    for (const id of ["apiUrl", "temperature", "top_k", "maxTokens"]) {
        assert.ok(list.indexOf(id) !== -1, id + " should be per-endpoint");
    }
});

test("fallback-only quality-control toggles are never per-endpoint", () => {
    const mod = loadWrapper();
    const list = settingsList(mod);
    assert.ok(mod.FALLBACK_ONLY_SETTINGS.length >= 6);
    for (const id of mod.FALLBACK_ONLY_SETTINGS) {
        assert.ok(list.indexOf(id) === -1, id + " must not be materialized as an ep{N}_ clone");
    }
});

test("the fallback-only set names exactly the shared toggles", () => {
    const { FALLBACK_ONLY_SETTINGS } = loadWrapper();
    assert.deepStrictEqual(FALLBACK_ONLY_SETTINGS.slice().sort(), [
        "enableReject", "enableRejectGlossary", "enableRejectJapanese",
        "enableRemoveInnerIDSP", "enableRemoveRepetition", "enableRetry"
    ].sort());
});
