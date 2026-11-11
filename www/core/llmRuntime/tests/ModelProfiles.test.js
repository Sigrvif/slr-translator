// www/core/llmRuntime/tests/ModelProfiles.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/ModelProfiles");

test("resolveProfile returns defaults and overlays stored values without mutating them", () => {
    const stored = { "a.gguf": { contextLength: 8192, kvType: "q5_0" } };
    const r = P.resolveProfile(stored, "a.gguf");
    assert.strictEqual(r.contextLength, 8192);
    // A profile written before the split carries one kvType; it reaches both sides.
    assert.strictEqual(r.kvTypeK, "q5_0");
    assert.strictEqual(r.kvTypeV, "q5_0");
    assert.strictEqual(r.gpuLayers, "auto");
    assert.strictEqual(r.specMode, "auto");
    // parallel slots are a per-model setting now and default to empty ("let llama.cpp decide").
    assert.strictEqual(P.DEFAULTS.parallelSlots, "");
    assert.strictEqual(r.parallelSlots, "");
    assert.deepStrictEqual(stored["a.gguf"], { contextLength: 8192, kvType: "q5_0" });
});
test("setProfile writes a copy and does not disturb other models", () => {
    const before = { "a.gguf": { contextLength: 1 } };
    const after = P.setProfile(before, "b.gguf", { draftId: "head.gguf" });
    assert.strictEqual(after["a.gguf"].contextLength, 1);
    assert.strictEqual(after["b.gguf"].draftId, "head.gguf");
    assert.strictEqual(before["b.gguf"], undefined);
});
test("setProfile copies every entry so the returned map never aliases the input", () => {
    const before = { "a.gguf": { contextLength: 1 }, "b.gguf": { contextLength: 2 } };
    const after = P.setProfile(before, "b.gguf", { draftId: "head.gguf" });
    after["a.gguf"].contextLength = 999;
    assert.strictEqual(before["a.gguf"].contextLength, 1);
    assert.strictEqual(after["b.gguf"].contextLength, 2);
    assert.strictEqual(after["b.gguf"].draftId, "head.gguf");
});
test("migrate seeds drafts.json pairings and the selected model's legacy settings", () => {
    const profiles = P.migrate({
        legacy: { runtimeContextLength: 16384, runtimeKvType: "f16", runtimeExpertCount: 3,
            runtimeDraftMax: 4, runtimeDraftMin: 1, runtimeParallelSlots: 4 },
        drafts: { "t.gguf": { draft: "d.gguf", specType: "draft-dflash", specDraftNMax: 15 } },
        selectedId: "t.gguf"
    });
    assert.strictEqual(profiles["t.gguf"].contextLength, 16384);
    assert.strictEqual(profiles["t.gguf"].kvTypeK, "f16");
    assert.strictEqual(profiles["t.gguf"].kvTypeV, "f16");
    assert.strictEqual(profiles["t.gguf"].expertCount, 3);
    assert.strictEqual(profiles["t.gguf"].draftMax, 4);
    assert.strictEqual(profiles["t.gguf"].draftMin, 1);
    assert.strictEqual(profiles["t.gguf"].draftId, "d.gguf");
    // The retired global parallel option migrates into the selected model's profile.
    assert.strictEqual(profiles["t.gguf"].parallelSlots, 4);
});
test("migrate never seeds a mode word as a draft id", () => {
    // drafts.json pairings are file ids; the select's mode words ("auto"/"off"/"none") must not
    // become a stored draftId, or start would force a bogus draftPath and the panel would render
    // the pseudo-option ("Off (no speculative decoding)") from stored state.
    const profiles = P.migrate({
        legacy: {},
        drafts: {
            "a.gguf": { draft: "" },
            "b.gguf": { draft: "auto" },
            "c.gguf": { draft: "off" },
            "d.gguf": { draft: "none" },
            "e.gguf": { draft: "real.gguf" }
        },
        selectedId: "e.gguf"
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profiles, "a.gguf"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profiles, "b.gguf"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profiles, "c.gguf"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profiles, "d.gguf"), false);
    assert.strictEqual(profiles["e.gguf"].draftId, "real.gguf");
});
test("validate refuses an expert count above the model's own", () => {
    const bad = P.validate(Object.assign({}, P.DEFAULTS, { expertCount: 300 }), { expertCount: 256 });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.errors.join(" "), /larger than the model/);
    assert.strictEqual(P.validate(Object.assign({}, P.DEFAULTS, { expertCount: 4 }), { expertCount: 256 }).ok, true);
});

test("defaults split the KV type and add the new knobs", () => {
    assert.strictEqual(P.DEFAULTS.kvTypeK, "q8_0");
    assert.strictEqual(P.DEFAULTS.kvTypeV, "q8_0");
    assert.strictEqual(P.DEFAULTS.batchSize, "");
    assert.strictEqual(P.DEFAULTS.ubatchSize, "");
    assert.strictEqual(P.DEFAULTS.specDraftPMin, "");
    assert.strictEqual(P.DEFAULTS.draftKvType, "");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(P.DEFAULTS, "kvType"), false);
});

test("defaults carry the MoE GPU cache and the draft physical batch as empty (llama.cpp's own default)", () => {
    // Both flags are off by default upstream (--moe-cache-mib 0, --spec-draft-n-ubatch 0), so
    // the profile default is the empty string: StartConfig emits nothing for it and the panel
    // shows an empty field.
    assert.strictEqual(P.DEFAULTS.moeCacheMib, "");
    assert.strictEqual(P.DEFAULTS.draftUbatchSize, "");
    const r = P.resolveProfile({ "a.gguf": { moeCacheMib: 2048, draftUbatchSize: 256 } }, "a.gguf");
    assert.strictEqual(r.moeCacheMib, 2048);
    assert.strictEqual(r.draftUbatchSize, 256);
});

test("the draft placement trio is per-model profile state with engine-matching defaults", () => {
    // The card's old server-wide fields moved here: a draft layer count only means something
    // relative to the model whose draft it is. Defaults mirror the retired card fields, so an
    // untouched profile behaves exactly as before ("leave it to llama.cpp").
    assert.strictEqual(P.DEFAULTS.draftGpuLayers, "auto");
    assert.strictEqual(P.DEFAULTS.draftCpuMoe, false);
    assert.strictEqual(P.DEFAULTS.draftCpuMoeLayers, "");
    const r = P.resolveProfile({ "a.gguf": { draftGpuLayers: 12, draftCpuMoeLayers: 4 } }, "a.gguf");
    assert.strictEqual(r.draftGpuLayers, 12);
    assert.strictEqual(r.draftCpuMoe, false);
    assert.strictEqual(r.draftCpuMoeLayers, 4);
});

test("the retired card draft fields seed the selected model's profile", () => {
    const profiles = P.migrate({
        legacy: { runtimeDraftGpuLayers: 10, runtimeDraftCpuMoe: true, runtimeDraftCpuMoeLayers: 2 },
        drafts: {},
        selectedId: "t.gguf"
    });
    assert.strictEqual(profiles["t.gguf"].draftGpuLayers, 10);
    assert.strictEqual(profiles["t.gguf"].draftCpuMoe, true);
    assert.strictEqual(profiles["t.gguf"].draftCpuMoeLayers, 2);
});

test("a stored single kvType migrates to both sides", () => {
    const r = P.resolveProfile({ "a.gguf": { kvType: "q5_0" } }, "a.gguf");
    assert.strictEqual(r.kvTypeK, "q5_0");
    assert.strictEqual(r.kvTypeV, "q5_0");
});

test("the new keys win over a leftover kvType", () => {
    const r = P.resolveProfile({ "a.gguf": { kvType: "q5_0", kvTypeK: "f16", kvTypeV: "q8_0" } }, "a.gguf");
    assert.strictEqual(r.kvTypeK, "f16");
    assert.strictEqual(r.kvTypeV, "q8_0");
});

// Spec 4: an unknown legacy value becomes the default. The same holds for a junk value in either
// split key, so a bad stored KV type can never reach argv.
test("an unknown stored kvType or split key resolves to the default on both sides", () => {
    const legacy = P.resolveProfile({ "a.gguf": { kvType: "nope" } }, "a.gguf");
    assert.strictEqual(legacy.kvTypeK, "q8_0");
    assert.strictEqual(legacy.kvTypeV, "q8_0");
    const split = P.resolveProfile({ "a.gguf": { kvTypeK: "nope", kvTypeV: "bogus" } }, "a.gguf");
    assert.strictEqual(split.kvTypeK, "q8_0");
    assert.strictEqual(split.kvTypeV, "q8_0");
});

test("migrate seeds both KV fields from the legacy runtime option", () => {
    const profiles = P.migrate({
        legacy: { runtimeKvType: "f16" }, drafts: null, selectedId: "t.gguf"
    });
    assert.strictEqual(profiles["t.gguf"].kvTypeK, "f16");
    assert.strictEqual(profiles["t.gguf"].kvTypeV, "f16");
});

test("validation rejects bad batch sizes, p-min and KV types", () => {
    const bad = (patch) => P.validate(Object.assign({}, P.DEFAULTS, patch), null).ok;
    assert.strictEqual(bad({ batchSize: 512 }), true);
    assert.strictEqual(bad({ batchSize: -1 }), false);
    assert.strictEqual(bad({ batchSize: 1.5 }), false);
    assert.strictEqual(bad({ ubatchSize: 4096 }), false);            // > the runtime's default 2048
    assert.strictEqual(bad({ batchSize: 2048, ubatchSize: 4096 }), false);
    assert.strictEqual(bad({ batchSize: 4096, ubatchSize: 4096 }), true);
    assert.strictEqual(bad({ specDraftPMin: 0.5 }), true);
    assert.strictEqual(bad({ specDraftPMin: 1.2 }), false);
    assert.strictEqual(bad({ specDraftPMin: -0.1 }), false);
    assert.strictEqual(bad({ kvTypeK: "iq4_nl" }), true);
    assert.strictEqual(bad({ kvTypeK: "nope" }), false);
    assert.strictEqual(bad({ draftKvType: "nope" }), false);
    // The MoE GPU cache and the draft physical batch follow the batch-size rule: a positive
    // integer or empty passes, zero/negative/fractional does not (both flags are off at 0
    // upstream, so 0 is never a value worth storing).
    assert.strictEqual(bad({ moeCacheMib: 2048 }), true);
    assert.strictEqual(bad({ moeCacheMib: 0 }), false);
    assert.strictEqual(bad({ moeCacheMib: -512 }), false);
    assert.strictEqual(bad({ moeCacheMib: 1.5 }), false);
    assert.strictEqual(bad({ draftUbatchSize: 256 }), true);
    assert.strictEqual(bad({ draftUbatchSize: 0 }), false);
    assert.strictEqual(bad({ draftUbatchSize: -1 }), false);
    assert.strictEqual(bad({ draftUbatchSize: 1.5 }), false);
});
