"use strict";
// Pure endpoint-value rules (see EndpointHelpers): additional endpoints never
// live-follow Main, and new endpoints start as a frozen copy of Main.
const test = require("node:test");
const assert = require("node:assert");
const EndpointHelpers = require("../EndpointHelpers");

const TEMPLATE = ["apiUrl", "apiKey", "model", "maxTokens", "maxContextLength"];
// values: { [id]: { value: live getValue(), def: factory getDefault() } }
function values() {
    return {
        apiUrl: { value: "http://main.example/v1", def: "" },
        model: { value: "main-model", def: "" },
        maxTokens: { value: 1234, def: 8000 },
        maxContextLength: { value: 9999, def: 0 },
        groupByUrl: { value: true, def: false },
        ep2_model: { value: "ep2-model", def: "" },
        ep2_maxTokens: { value: 2000, def: 8000 }
    };
}

test("resolveEndpointValue: endpoint 1 reads Main live", () => {
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 1, "model"), "main-model");
});

test("resolveEndpointValue: endpoint N reads its own option when present", () => {
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 2, "model"), "ep2-model");
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 2, "maxTokens"), 2000);
});

test("resolveEndpointValue: endpoint N falls back to factory default, never Main live", () => {
    // ep2_maxContextLength is missing: Main's live 9999 must NOT leak through.
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 2, "maxContextLength"), 0);
    // ep3_model is missing entirely: the factory default, not "main-model".
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 3, "model"), "");
});

test("resolveEndpointValue: true globals (no fallback twin) keep Main live", () => {
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 2, "groupByUrl"), true);
});

test("resolveEndpointValue: missing everywhere yields undefined", () => {
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 2, "nope"), undefined);
    assert.strictEqual(EndpointHelpers.resolveEndpointValue({}, TEMPLATE, 2, "model"), undefined);
});

test("resolveEndpointValue: endpoint number below 1 normalizes to 1", () => {
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, 0, "model"), "main-model");
    assert.strictEqual(EndpointHelpers.resolveEndpointValue(values(), TEMPLATE, undefined, "model"), "main-model");
});

test("endpointCopyValues: new endpoint copies Main live values under epN keys", () => {
    const out = EndpointHelpers.endpointCopyValues(
        { model: "main-model", maxTokens: 1234, maxContextLength: 9999 }, TEMPLATE, 2);
    assert.strictEqual(out.ep2_model, "main-model");
    assert.strictEqual(out.ep2_maxTokens, 1234);
    assert.strictEqual(out.ep2_maxContextLength, 9999);
});

test("endpointCopyValues: identity fields stay blank so the endpoint starts inactive", () => {
    const out = EndpointHelpers.endpointCopyValues(
        { apiUrl: "http://main.example/v1", apiKey: "secret", model: "m" }, TEMPLATE, 2);
    assert.strictEqual("ep2_apiUrl" in out, false);
    assert.strictEqual("ep2_apiKey" in out, false);
    assert.strictEqual(out.ep2_model, "m");
});

test("endpointCopyValues: undefined base values are skipped", () => {
    const out = EndpointHelpers.endpointCopyValues({ model: "m" }, TEMPLATE, 3);
    assert.strictEqual(out.ep3_model, "m");
    assert.strictEqual("ep3_maxTokens" in out, false);
});
