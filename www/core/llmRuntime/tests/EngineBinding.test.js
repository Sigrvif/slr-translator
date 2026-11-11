// www/core/llmRuntime/tests/EngineBinding.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bindEngine } = require("../lib/EngineBinding");

function fakeWrapper() {
    const updates = [];
    const option = (id) => ({
        id,
        value: undefined,
        setValue(v) { this.value = v; }
    });
    const wrapper = {
        optionApiUrl: option("apiUrl"),
        optionModel: option("model"),
        _updates: updates,
        getEngine() {
            return { update: (k, v) => updates.push([k, v]) };
        }
    };
    return wrapper;
}

test("bindEngine sets the API URL and model and persists both", () => {
    const wrapper = fakeWrapper();
    const result = bindEngine(wrapper, {
        apiUrl: "http://127.0.0.1:8731/v1/chat/completions",
        modelId: "qwen3-4b-q4_k_m.gguf"
    });
    assert.strictEqual(wrapper.optionApiUrl.value, "http://127.0.0.1:8731/v1/chat/completions");
    assert.strictEqual(wrapper.optionModel.value, "qwen3-4b-q4_k_m.gguf");
    assert.deepStrictEqual(wrapper._updates, [
        ["apiUrl", "http://127.0.0.1:8731/v1/chat/completions"],
        ["model", "qwen3-4b-q4_k_m.gguf"]
    ]);
    assert.deepStrictEqual(result, {
        apiUrl: "http://127.0.0.1:8731/v1/chat/completions",
        modelId: "qwen3-4b-q4_k_m.gguf"
    });
});

test("bindEngine skips the model when none is given", () => {
    const wrapper = fakeWrapper();
    bindEngine(wrapper, { apiUrl: "http://127.0.0.1:8731/v1/chat/completions" });
    assert.strictEqual(wrapper.optionModel.value, undefined);
    assert.deepStrictEqual(wrapper._updates.map((u) => u[0]), ["apiUrl"]);
});

test("bindEngine fails loudly on a malformed wrapper", () => {
    assert.throws(() => bindEngine({}, { apiUrl: "http://x" }), /wrapper/);
    assert.throws(
        () => bindEngine({ getEngine: () => ({}), optionApiUrl: {} }, { apiUrl: "http://x" }),
        /optionApiUrl/
    );
});
