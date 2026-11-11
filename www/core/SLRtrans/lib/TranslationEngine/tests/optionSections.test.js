"use strict";
// Section placement of the repetition-loop tiers. These four options are described as a set and
// belong together in Sampling & Generation; the fourth was missing from the wrapper's section
// map and quietly ended up in Other Options, away from the three it is documented alongside.
// The map now reads the ids from one exported list, and this checks that list against the
// options the engine actually defines, so adding a fifth tier cannot repeat the mistake.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const DIR = path.join(__dirname, "..");

// The wrapper pulls in two browser-only modules; the rest resolve normally.
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

// Every repetition tier the engine declares, read from its source. The options are built in the
// constructor, so the declarations are the only listing available without a full engine.
function tierIdsDeclaredByEngine() {
    const src = fs.readFileSync(path.join(DIR, "DSLREngine.js"), "utf8");
    const ids = new Set();
    for (const m of src.matchAll(/id: '(repetition[A-Za-z]*Limit)'/g)) ids.add(m[1]);
    return Array.from(ids).sort();
}

test("the repetition tier list holds every tier the engine declares", () => {
    const wrapper = loadWrapper();
    const declared = tierIdsDeclaredByEngine();
    assert.ok(declared.length >= 4, `expected the engine to declare the tiers, found ${declared.join(", ")}`);
    for (const id of declared) {
        assert.ok(wrapper.REPETITION_TIER_IDS.indexOf(id) !== -1,
            `${id} is a repetition tier but is not in REPETITION_TIER_IDS, so it would fall into Other Options`);
    }
});

test("the repetition tier list holds no id the engine does not declare", () => {
    const wrapper = loadWrapper();
    const declared = new Set(tierIdsDeclaredByEngine());
    for (const id of wrapper.REPETITION_TIER_IDS) {
        assert.ok(declared.has(id), `${id} is in REPETITION_TIER_IDS but the engine does not declare it`);
    }
});

// The Bundled Local Runtime card must start collapsed: most users never open it, and an
// always-open card pushes the rest of the options off screen (team decision, 2026-09-29).
// The wrapper wires the quickstart flag from DEFAULT_EXPANDED_SECTION_KEYS, so the list
// pinning the single key is the guard; the source scan catches a hardcoded flag returning.
test("only Quick Start starts expanded; the Bundled Local Runtime card starts collapsed", () => {
    const wrapper = loadWrapper();
    assert.deepStrictEqual(wrapper.DEFAULT_EXPANDED_SECTION_KEYS.slice().sort(), ["quickstart"],
        "exactly Quick Start may carry the default-expanded flag");
    const src = fs.readFileSync(path.join(DIR, "DSLRTranslationEngineWrapper.js"), "utf8");
    const sectionLines = src.split("\n").filter((l) => /\{ key: '(quickstart|localruntime)'/.test(l));
    assert.strictEqual(sectionLines.length, 2, "expected exactly one quickstart and one localruntime section line");
    const runtime = sectionLines.find((l) => l.indexOf("localruntime") !== -1);
    assert.ok(runtime.indexOf("defaultExpanded") === -1,
        "the Bundled Local Runtime section must not carry a defaultExpanded flag (it starts collapsed)");
    const quickstart = sectionLines.find((l) => l.indexOf("quickstart") !== -1);
    assert.ok(quickstart.indexOf("defaultExpanded") !== -1,
        "the Quick Start section must still wire defaultExpanded (it starts expanded)");
});
