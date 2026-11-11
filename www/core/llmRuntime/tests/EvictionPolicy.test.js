"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../lib/EvictionPolicy");

test("at 1 loaded model, starting another evicts the current one", () => {
    assert.deepStrictEqual(E.planStart({ loaded: ["a"], requested: "b", maxLoaded: 1 }), ["a"]);
});
test("an already loaded model evicts nothing", () => {
    assert.deepStrictEqual(E.planStart({ loaded: ["a", "b"], requested: "a", maxLoaded: 1 }), []);
});
test("with room for two, nothing is evicted", () => {
    assert.deepStrictEqual(E.planStart({ loaded: ["a"], requested: "b", maxLoaded: 2 }), []);
});
test("with two of two loaded, the oldest is evicted", () => {
    assert.deepStrictEqual(E.planStart({ loaded: ["a", "b"], requested: "c", maxLoaded: 2 }), ["a"]);
});
test("an unlimited setting evicts nothing", () => {
    assert.deepStrictEqual(E.planStart({ loaded: ["a", "b"], requested: "c", maxLoaded: 0 }), []);
});
