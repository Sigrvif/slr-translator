"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseFindings, windows, SEVERITIES, CATEGORIES, NOTE_MAX } = require("../qc");

test("CLEAN yields no findings and no log", () => {
    assert.deepStrictEqual(parseFindings("CLEAN", new Set([0, 1])), { findings: [], log: [] });
});

test("empty response is a log entry, not CLEAN", () => {
    const { findings, log } = parseFindings("   ", new Set([0]));
    assert.strictEqual(findings.length, 0);
    assert.strictEqual(log.length, 1);
});

test("parses a scalar finding and gates unserved lines", () => {
    const served = new Set([10, 11, 12]);
    const { findings, log } = parseFindings(
        "@11｜high｜mistranslation｜wrong pronoun", served);
    assert.deepStrictEqual(findings, [{
        line: 11, severity: "high", category: "mistranslation",
        note: "wrong pronoun"
    }]);
    assert.deepStrictEqual(log, []);
    const rejected = parseFindings("@99｜high｜mistranslation｜x", served);
    assert.strictEqual(rejected.findings.length, 0);
    assert.strictEqual(rejected.log.length, 1);
});

test("long finding notes truncate at a word boundary, never mid-word", () => {
    const long = ("word " + "x".repeat(100) + " ").repeat(20).trim();
    assert.ok(long.length > NOTE_MAX, "fixture must exceed the note cap");
    const { findings } = parseFindings("@1｜high｜mistranslation｜" + long, new Set([1]));
    assert.strictEqual(findings.length, 1);
    const note = findings[0].note;
    assert.ok(note.endsWith("…"), note.slice(-20));
    assert.ok(note.length <= NOTE_MAX + 1, "cap plus ellipsis, got " + note.length);
    const head = note.slice(0, -1);
    assert.ok(long.startsWith(head), "truncation must keep a whole-word prefix");
    assert.strictEqual(long[head.length], " ", "cut must land on a word boundary");
});

test("notes within the cap pass through untouched", () => {
    const exact = "w".repeat(NOTE_MAX);
    const kept = parseFindings("@1｜high｜mistranslation｜" + exact, new Set([1]));
    assert.strictEqual(kept.findings[0].note, exact);
    const short = parseFindings("@1｜high｜mistranslation｜wrong pronoun", new Set([1]));
    assert.strictEqual(short.findings[0].note, "wrong pronoun");
});

test("the hard cap is generous: a thorough note survives whole", () => {
    assert.ok(NOTE_MAX >= 1000, "hard cutoff must be far above the short-note guidance");
    const thorough = ("The source says X but the translation says Y, " +
        "which changes the scene because the speaker cannot know this yet. ").repeat(8).trim();
    assert.ok(thorough.length > 300 && thorough.length <= NOTE_MAX,
        "fixture must exceed guidance but fit the cap, got " + thorough.length);
    const { findings } = parseFindings("@1｜high｜mistranslation｜" + thorough, new Set([1]));
    assert.strictEqual(findings[0].note, thorough);
});

test("parses an explicit span and rejects invalid enums", () => {
    const served = new Set([5, 6, 7]);
    const span = parseFindings("@5-7｜low｜omission｜three lines dropped", served);
    assert.deepStrictEqual(span.findings[0].targets, [5, 6, 7]);
    const bad = parseFindings("@5｜urgent｜omission｜x", served);
    assert.strictEqual(bad.findings.length, 0);
    assert.strictEqual(bad.log.length, 1);
});

test("drops a prose multi-line note that cites a scalar line", () => {
    const { findings, log } = parseFindings(
        "@5｜low｜omission｜Lines 5-7 were dropped", new Set([5, 6, 7]));
    assert.strictEqual(findings.length, 0);
    assert.strictEqual(log.length, 1);
});

test("dedupes same line and category and caps findings lowest-first", () => {
    const served = new Set([1, 2, 3]);
    const dup = parseFindings(
        "@1｜high｜pov｜a\n@1｜high｜pov｜b", served);
    assert.strictEqual(dup.findings.length, 1);
    const text = [
        "@1｜low｜other｜a", "@2｜medium｜other｜b", "@3｜high｜other｜c"
    ].join("\n");
    const capped = parseFindings(text, served, 2);
    assert.strictEqual(capped.findings.length, 2);
    assert.deepStrictEqual(capped.findings.map((f) => f.line), [3, 2]);
    assert.strictEqual(capped.log.length, 1);
});

test("strips a leading think block before parsing", () => {
    const { findings } = parseFindings(
        "<think>noise</think>\n@1｜low｜other｜real", new Set([1]));
    assert.strictEqual(findings.length, 1);
});

test("windows overlap and clamp at the end", () => {
    assert.deepStrictEqual(windows(10, 4, 1), [[0, 4], [3, 7], [6, 10]]);
    assert.deepStrictEqual(windows(3, 4, 1), [[0, 3]]);
    assert.deepStrictEqual(windows(0, 4, 1), []);
});

test("severity ranking is low < medium < high", () => {
    assert.deepStrictEqual(SEVERITIES, ["low", "medium", "high"]);
    assert.ok(CATEGORIES.includes("content-softening"));
});
