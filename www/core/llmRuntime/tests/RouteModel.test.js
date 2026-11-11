"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const RouteModel = require("../lib/RouteModel");

test("an empty model name routes to the default", () => {
    assert.deepStrictEqual(RouteModel.routeModel({ requested: "", defaultId: "a.gguf", knownIds: ["a.gguf"] }), { id: "a.gguf" });
    assert.deepStrictEqual(RouteModel.routeModel({ requested: undefined, defaultId: "a.gguf", knownIds: ["a.gguf"] }), { id: "a.gguf" });
    assert.deepStrictEqual(RouteModel.routeModel({ requested: "   ", defaultId: "a.gguf", knownIds: ["a.gguf"] }), { id: "a.gguf" });
});
test("with no default, an empty model name routes to the first known model", () => {
    assert.deepStrictEqual(RouteModel.routeModel({ requested: "", defaultId: "", knownIds: ["a.gguf"] }), { id: "a.gguf" });
    assert.deepStrictEqual(RouteModel.routeModel({ requested: "   ", defaultId: "", knownIds: ["a.gguf"] }), { id: "a.gguf" });
});
test("a known model name routes to itself", () => {
    assert.deepStrictEqual(RouteModel.routeModel({ requested: "b.gguf", defaultId: "a.gguf", knownIds: ["a.gguf", "b.gguf"] }), { id: "b.gguf" });
});
test("an unknown model name is an OpenAI-style not-found error", () => {
    const r = RouteModel.routeModel({ requested: "nope.gguf", defaultId: "a.gguf", knownIds: ["a.gguf"] });
    assert.strictEqual(r.error.code, "model_not_found");
    assert.match(r.error.message, /nope\.gguf/);
});
test("no known models and no default is an error, not a crash", () => {
    const r = RouteModel.routeModel({ requested: "", defaultId: "", knownIds: [] });
    assert.strictEqual(r.error.code, "model_not_found");
});
test("a model name without the .gguf extension still routes (clean ids, like other endpoints)", () => {
    assert.deepStrictEqual(
        RouteModel.routeModel({ requested: "b", defaultId: "a.gguf", knownIds: ["a.gguf", "b.gguf"] }),
        { id: "b.gguf" }
    );
});
test("exact id match wins over the extensionless fallback", () => {
    assert.deepStrictEqual(
        RouteModel.routeModel({ requested: "b.gguf", defaultId: "a.gguf", knownIds: ["a.gguf", "b.gguf", "b.gguf.gguf"] }),
        { id: "b.gguf" }
    );
});
test("an extensionless unknown name is still a not-found error", () => {
    const r = RouteModel.routeModel({ requested: "nope", defaultId: "a.gguf", knownIds: ["a.gguf"] });
    assert.strictEqual(r.error.code, "model_not_found");
});
