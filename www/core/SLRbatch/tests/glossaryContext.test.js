"use strict";
// GlossaryExtractor is a browser-global script (window.GlossaryExtractor) with
// no module exports. Stub `window` so it loads under plain node, then reach
// the class (and its pure static helpers) through the stub.
const test = require("node:test");
const assert = require("node:assert");

global.window = global.window || {};
require("../GlossaryExtractor.js");
const { GlossaryExtractor } = global.window;

test("extractor class loads under node", () => {
    assert.strictEqual(typeof GlossaryExtractor, "function");
});

test("fitTextToTokenBudget keeps text that fits", () => {
    assert.strictEqual(GlossaryExtractor.fitTextToTokenBudget("aaa", 100), "aaa");
    assert.strictEqual(GlossaryExtractor.fitTextToTokenBudget("", 100), "");
});

test("fitTextToTokenBudget trims head lines over budget (chars/4 estimate)", () => {
    // "aaa\nbbb\nccc" ~= 3 tokens; a budget of 2 keeps the head line only.
    assert.strictEqual(GlossaryExtractor.fitTextToTokenBudget("aaa\nbbb\nccc", 2), "aaa");
});

test("fitTextToTokenBudget empties on non-positive budget", () => {
    assert.strictEqual(GlossaryExtractor.fitTextToTokenBudget("aaa", 0), "");
    assert.strictEqual(GlossaryExtractor.fitTextToTokenBudget("aaa", -5), "");
});
