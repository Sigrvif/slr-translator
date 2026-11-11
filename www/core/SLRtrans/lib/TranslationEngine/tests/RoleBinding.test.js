"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../RoleBinding");

test("bindingsFor maps each role to its own model and url option", () => {
    assert.deepStrictEqual(R.bindingsFor("main", "a.gguf", 1234),
        [{ id: "model", value: "a.gguf" }, { id: "apiUrl", value: "http://127.0.0.1:1234/v1/chat/completions" }]);
    assert.deepStrictEqual(R.bindingsFor("fallback", "b.gguf", 1234).map(function (b) { return b.id; }),
        ["model2", "apiUrl2"]);
    assert.deepStrictEqual(R.bindingsFor("fallback", "b.gguf", 1234),
        [{ id: "model2", value: "b.gguf" }, { id: "apiUrl2", value: "http://127.0.0.1:1234/v1/chat/completions" }]);
    assert.deepStrictEqual(R.bindingsFor("glossary", "c.gguf", 1234).map(function (b) { return b.id; }),
        ["glossaryModel", "glossaryApiUrl"]);
    assert.deepStrictEqual(R.bindingsFor("glossary", "c.gguf", 1234),
        [{ id: "glossaryModel", value: "c.gguf" }, { id: "glossaryApiUrl", value: "http://127.0.0.1:1234/v1/chat/completions" }]);
    assert.deepStrictEqual(R.bindingsFor("review", "d.gguf", 1234).map(function (b) { return b.id; }),
        ["reviewModel", "reviewApiUrl"]);
    assert.deepStrictEqual(R.bindingsFor("review", "d.gguf", 1234),
        [{ id: "reviewModel", value: "d.gguf" }, { id: "reviewApiUrl", value: "http://127.0.0.1:1234/v1/chat/completions" }]);
});
test("bindingsFor refuses an unknown role", () => {
    assert.throws(function () { R.bindingsFor("bogus", "a.gguf", 1234); }, /unknown role/i);
    assert.throws(function () { R.bindingsFor("constructor", "a.gguf", 1234); }, /unknown role/i);
    assert.throws(function () { R.bindingsFor("toString", "a.gguf", 1234); }, /unknown role/i);
    assert.throws(function () { R.bindingsFor("hasOwnProperty", "a.gguf", 1234); }, /unknown role/i);
});
test("ROLES is deeply frozen", () => {
    assert.strictEqual(Object.isFrozen(R.ROLES), true);
    assert.strictEqual(Object.isFrozen(R.ROLES.main), true);
    assert.strictEqual(Object.isFrozen(R.ROLES.fallback), true);
    assert.strictEqual(Object.isFrozen(R.ROLES.glossary), true);
    assert.strictEqual(Object.isFrozen(R.ROLES.review), true);
});
