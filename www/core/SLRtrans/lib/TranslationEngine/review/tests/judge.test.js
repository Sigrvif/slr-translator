"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseVerdict } = require("../judge");

test("dismiss needs no WHY", () => {
    assert.deepStrictEqual(parseVerdict("VERDICT: dismiss"),
        { verdict: "dismiss", why: null });
});

test("redo requires WHY", () => {
    assert.deepStrictEqual(parseVerdict("VERDICT: redo\nWHY: pronoun is wrong"),
        { verdict: "redo", why: "pronoun is wrong" });
    assert.strictEqual(parseVerdict("VERDICT: redo"), null);
});

test("fix is unsupported in v1 and fails closed", () => {
    assert.strictEqual(parseVerdict("VERDICT: fix\nFIX: corrected line"), null);
});

test("garbage is null", () => {
    assert.strictEqual(parseVerdict(""), null);
    assert.strictEqual(parseVerdict("VERDICT: maybe"), null);
    assert.strictEqual(parseVerdict("I think it is fine"), null);
});
