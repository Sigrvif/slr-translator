"use strict";
// Auto-extracted glossary English is sometimes an alternative ("Charm/talisman")
// or a definition rather than a single term, which defeats the glossary and makes
// the missing-term check reject correct translations. Those terms are dropped at
// extraction; this guards the predicate.
//
// GlossaryExtractor is a browser-global script (window.GlossaryExtractor) with no
// module exports, so stub `window` and reach the class through it.
const test = require("node:test");
const assert = require("node:assert");

global.window = global.window || {};
require("../GlossaryExtractor.js");
const { GlossaryExtractor } = global.window;

const bad = GlossaryExtractor.prototype._isUnusableGlossaryEnglish;

test("the filter class loads", () => {
    assert.strictEqual(typeof GlossaryExtractor, "function");
    assert.strictEqual(typeof bad, "function");
});

test("alternative and non-term English is rejected", () => {
    const cases = [
        "Charm/talisman",
        "Charm / talisman",
        "A|B",
        "A\\B",
        "Charm or talisman",
        "talisman (charm)",
        "talisman [charm]",
        "お札",
        "a charm used to ward off evil spirits and bad luck around the home"
    ];
    for (const e of cases) assert.strictEqual(bad(e), true, JSON.stringify(e));
});

test("a single usable rendering is kept", () => {
    const cases = ["Charm", "Talisman", "Demon King", "Aida", "Brainwashing", "Gun and Sword"];
    for (const e of cases) assert.strictEqual(bad(e), false, JSON.stringify(e));
});

test("empty English is fine (term kept without a translation)", () => {
    assert.strictEqual(bad(""), false);
    assert.strictEqual(bad("   "), false);
    assert.strictEqual(bad(null), false);
    assert.strictEqual(bad(undefined), false);
});
