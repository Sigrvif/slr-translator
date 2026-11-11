"use strict";
// Pure class-string parsing for the options form's collapsible sections (see
// optionSectionState.js). renderOptions captures the expanded section keys before a rebuild
// wipes the DOM, so a model switch or stale-panel refresh keeps the user's layout instead of
// collapsing everything that is not flagged default-expanded.
const test = require("node:test");
const assert = require("node:assert");
const state = require("../optionSectionState.js");

test("reads the section key from a real fieldset class attribute", () => {
    assert.strictEqual(
        state.keyFromClass("option-section option-section-localruntime option-section-default-expanded expanded"),
        "localruntime"
    );
    assert.strictEqual(
        state.keyFromClass("option-section option-section-quickstart option-section-default-expanded"),
        "quickstart"
    );
});

test("never mistakes the default-expanded modifier for a section key", () => {
    assert.strictEqual(state.keyFromClass("option-section option-section-default-expanded"), null);
    assert.strictEqual(
        state.keyFromClass("option-section-default-expanded option-section-default-expanded expanded"),
        null
    );
});

test("returns null for fieldsets without a section key", () => {
    assert.strictEqual(state.keyFromClass(""), null);
    assert.strictEqual(state.keyFromClass("option-section expanded"), null);
    assert.strictEqual(state.keyFromClass(null), null);
    assert.strictEqual(state.keyFromClass("fieldset option-role-group"), null);
});

test("keys may contain digits, hyphens and underscores", () => {
    assert.strictEqual(state.keyFromClass("option-section option-section-ep2_sampling"), "ep2_sampling");
    assert.strictEqual(state.keyFromClass("option-section option-section-misc"), "misc");
});
