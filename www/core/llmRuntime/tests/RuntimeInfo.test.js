"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const RuntimeInfo = require("../lib/RuntimeInfo");

const A = { id: "a.gguf", modelPath: "/m/a.gguf", contextSize: 32768, contextLengthTrain: 131072,
    nParams: 2516756480, bytes: 2674565120, ftype: "Q8_0", hasVision: false, arch: "llama" };
const B = { id: "b.gguf", modelPath: "/m/b.gguf", contextSize: 8192, contextLengthTrain: 262144 };

test("props reports the configured context, not zero", () => {
    const p = RuntimeInfo.buildProps(A, { totalSlots: 1 });
    assert.strictEqual(p.default_generation_settings.n_ctx, 32768);
    assert.strictEqual(p.model_path, "/m/a.gguf");
    assert.strictEqual(p.model_alias, "a.gguf");
});
test("props falls back to the trained context when nothing is configured", () => {
    assert.strictEqual(RuntimeInfo.buildProps({ id: "x.gguf", modelPath: "/m/x.gguf", contextLengthTrain: 262144 }, {}).default_generation_settings.n_ctx, 262144);
});
test("the models list carries meta.n_ctx and the loaded flag for every model", () => {
    const body = RuntimeInfo.buildModelsList([A, B], ["b.gguf"]);
    const byId = {};
    for (const m of body.data) byId[m.id] = m;
    assert.strictEqual(byId["a.gguf"].meta.n_ctx, 32768);
    assert.strictEqual(byId["a.gguf"].meta.n_ctx_train, 131072);
    assert.strictEqual(byId["a.gguf"].status.value, "unloaded");
    assert.strictEqual(byId["b.gguf"].status.value, "loaded");
    assert.strictEqual(byId["b.gguf"].object, "model");
    assert.deepStrictEqual(byId["a.gguf"].architecture.input_modalities, ["text"]);
});
test("a vision model advertises the image modality", () => {
    const body = RuntimeInfo.buildModelsList([Object.assign({}, A, { hasVision: true })], []);
    assert.deepStrictEqual(body.data[0].architecture.input_modalities, ["text", "image"]);
});
