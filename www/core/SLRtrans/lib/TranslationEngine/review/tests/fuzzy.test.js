"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { lineKey, fuzzyLoopReason, MIN_LINE_CHARS } = require("../fuzzy");

test("lineKey folds case and whitespace but keeps row numbers", () => {
    // Row numbers are identity, not filler: folding them would make findings
    // about different rows look like one repeated line.
    assert.strictEqual(lineKey("  Extra quotation mark at @12  "), "extra quotation mark at @12");
    assert.strictEqual(lineKey("EXTRA quotation mark at @12"), "extra quotation mark at @12");
    assert.notStrictEqual(lineKey("extra quote at @12"), lineKey("extra quote at @13"));
});

test("fuzzyLoopReason ignores findings about different rows sharing one wording", () => {
    // The observed false positive: a legitimate QC pass reporting the same
    // defect class for many distinct batch rows. Each row is mentioned once.
    const lines = [];
    for (let n = 5; n <= 12; n++) {
        lines.push("@" + n + "｜low｜other｜Extra quotation mark at the end of the line.");
    }
    assert.strictEqual(fuzzyLoopReason(lines.join("\n"), 6), "");
});

test("fuzzyLoopReason fires when one line is re-issued verbatim", () => {
    const line = "Let's check @6 again. The addition of \"special\" is the issue.";
    const lines = [];
    for (let n = 0; n < 6; n++) lines.push(line);
    const reason = fuzzyLoopReason(lines.join("\n"), 6);
    assert.ok(reason, "must fire on 6 verbatim repeats");
    assert.ok(reason.includes("repeated at least 6 times"), reason);
    assert.ok(reason.includes("let's check @6 again"), reason);
});

test("fuzzyLoopReason fires on a paraphrase loop that keeps revisiting one row", () => {
    // Real loop shape: the same row discussed over and over with small
    // wording drift, so lines are near- but not byte-identical.
    const lines = [
        "Let's check @6 again. The addition of special is the issue here.",
        "Let's check @6 again. The addition of special is the issue.",
        "Let's check @6 again. The addition of \"special\" is the issue.",
        "Let's check @6 again. The addition of special is the issue here!",
        "Let's check @6 again. The addition of special is the issue",
        "Let's check @6 again. The addition of special is the issue."
    ];
    const reason = fuzzyLoopReason(lines.join("\n"), 6);
    assert.ok(reason, "must fire when one row is revisited 6 times");
});

test("fuzzyLoopReason honors the limit", () => {
    const line = "Let's check @6 again. The addition of \"special\" is the issue.";
    const five = new Array(5).fill(line).join("\n");
    assert.strictEqual(fuzzyLoopReason(five, 6), "");
    assert.ok(fuzzyLoopReason(five, 5));
});

test("fuzzyLoopReason ignores short repeats", () => {
    assert.ok(MIN_LINE_CHARS >= 20, "short verdict tics must stay below the bar");
    const lines = [];
    for (let n = 0; n < 10; n++) lines.push("Accurate.");
    assert.strictEqual(fuzzyLoopReason(lines.join("\n"), 6), "");
});

test("fuzzyLoopReason rejects bad input", () => {
    assert.strictEqual(fuzzyLoopReason("Let's check @6 again. Nothing else to add here.", 1), "");
    assert.strictEqual(fuzzyLoopReason("", 6), "");
    assert.strictEqual(fuzzyLoopReason(null, 6), "");
    assert.strictEqual(fuzzyLoopReason(undefined, 6), "");
});
