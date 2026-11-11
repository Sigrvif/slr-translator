"use strict";
// Pure ordering rules for the responsive Home-toolbar labels.
const test = require("node:test");
const assert = require("node:assert");
const toolbarLayout = require("../toolbarLayout.js");

// Mirrors the real workflow group: Setup, Glossary, Batch, Word Wrap, Export.
// Batch is the essential primary action and keeps a short label.
function workflowItems() {
    return [
        { id: "setup", priority: 1 },
        { id: "glossary", priority: 3 },
        { id: "batch", priority: 0, essential: true, shortLabel: "Translate" },
        { id: "wrap", priority: 2 },
        { id: "export", priority: 4 }
    ];
}

test("hide order drops the least important label first", () => {
    assert.deepStrictEqual(
        toolbarLayout.sortLabelHideOrder(workflowItems()),
        ["export", "glossary", "wrap", "setup"]
    );
});

test("essential labels are never hidden", () => {
    assert.ok(toolbarLayout.sortLabelHideOrder(workflowItems()).indexOf("batch") === -1);
});

test("ties are broken rightmost-first", () => {
    const items = [
        { id: "left", priority: 2 },
        { id: "middle", priority: 2 },
        { id: "right", priority: 2 }
    ];
    assert.deepStrictEqual(
        toolbarLayout.sortLabelHideOrder(items),
        ["right", "middle", "left"]
    );
});

test("essential fallback only lists essential items with a short label", () => {
    assert.deepStrictEqual(
        toolbarLayout.essentialFallbackOrder(workflowItems()),
        ["batch"]
    );
});

test("essential fallback runs most important first", () => {
    const items = [
        { id: "second", priority: 5, essential: true, shortLabel: "S2" },
        { id: "first", priority: 1, essential: true, shortLabel: "S1" }
    ];
    assert.deepStrictEqual(
        toolbarLayout.essentialFallbackOrder(items),
        ["first", "second"]
    );
});

test("missing/invalid input yields empty orders instead of throwing", () => {
    assert.deepStrictEqual(toolbarLayout.sortLabelHideOrder(undefined), []);
    assert.deepStrictEqual(toolbarLayout.sortLabelHideOrder([]), []);
    assert.deepStrictEqual(toolbarLayout.essentialFallbackOrder(null), []);
});

test("non-numeric priority defaults to zero", () => {
    const items = [
        { id: "a" },
        { id: "b", priority: "not-a-number" },
        { id: "c", priority: -1 }
    ];
    // a and b share priority 0 (b is later, so hides first among the two),
    // and c is the most important so hides last.
    assert.deepStrictEqual(
        toolbarLayout.sortLabelHideOrder(items),
        ["b", "a", "c"]
    );
});
