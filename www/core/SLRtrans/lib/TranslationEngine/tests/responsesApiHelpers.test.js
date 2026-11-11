"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { findDuplicateIds, validationSeedSkips, resolveRepetitionConfig, repetitionReason, chatContentOf } = require("../ResponsesApiHelpers");

test("findDuplicateIds returns [] when every id is unique", () => {
    assert.deepStrictEqual(findDuplicateIds([{ id: 0 }, { id: 1 }, { id: 2 }]), []);
    assert.deepStrictEqual(findDuplicateIds([]), []);
    assert.deepStrictEqual(findDuplicateIds(null), []);
});

test("findDuplicateIds names a twice-emitted id once", () => {
    // The gemma run: id 21 arrived twice, first as a truncated stub.
    const items = [{ id: 20 }, { id: 21 }, { id: 21 }];
    assert.deepStrictEqual(findDuplicateIds(items), [21]);
});

test("findDuplicateIds sorts and dedupes multiple duplicates", () => {
    const items = [{ id: 5 }, { id: 3 }, { id: 5 }, { id: 3 }, { id: 3 }, { id: 4 }];
    assert.deepStrictEqual(findDuplicateIds(items), [3, 5]);
});

test("findDuplicateIds ignores entries without a usable id", () => {
    const items = [{ id: 1 }, {}, { translated: "x" }, { id: 1 }, { id: null }];
    assert.deepStrictEqual(findDuplicateIds(items), [1]);
});

test("chatContentOf reads the assistant text from any result shape", () => {
    assert.strictEqual(chatContentOf({
        choices: [{ message: { content: "partial text" } }]
    }), "partial text");
    assert.strictEqual(chatContentOf({ choices: [{ message: {} }] }), "");
    assert.strictEqual(chatContentOf({ choices: [] }), "");
    assert.strictEqual(chatContentOf({}), "");
    assert.strictEqual(chatContentOf(null), "");
    assert.strictEqual(chatContentOf(undefined), "");
    // A repetition kill returns the accumulated content this way.
    assert.strictEqual(chatContentOf({
        choices: [{ message: { content: "Ahhhhh" }, finish_reason: "length" }],
        repetition_loop: true
    }), "Ahhhhh");
});

test("an inspect callback alone keeps a repetition config active", () => {
    // The inspect hook (id checks, repeated-content detection) is a detector
    // in its own right: with every size tier disabled it must still run.
    const cfg = resolveRepetitionConfig({
        charLimit: 0, wordLimit: 0, entryLimit: 0,
        inspect: () => ""
    }, 0);
    assert.strictEqual(cfg.charLimit, 0);
    assert.strictEqual(cfg.wordLimit, 0);
    assert.ok(cfg.active, "inspect must activate the config");
    assert.strictEqual(repetitionReason("ordinary text without repetition", "", cfg), "");
    const fired = resolveRepetitionConfig({
        charLimit: 0, wordLimit: 0, entryLimit: 0,
        inspect: () => "duplicated id 21"
    }, 0);
    assert.strictEqual(repetitionReason("anything", "", fired), "duplicated id 21");
});

test("validationSeedSkips collects tolerated Japanese and missing-quote rows", () => {
    const result = {
        passed: true,
        perLineIssues: { perLineIssueGroups: { japanese: [4, 9] } },
        commandIssues: { missingQuotesById: { 7: [{}], 9: [{}] } }
    };
    assert.deepStrictEqual(validationSeedSkips(result), [4, 7, 9]);
});

test("validationSeedSkips returns [] unless the batch passed", () => {
    const flagged = {
        passed: false,
        perLineIssues: { perLineIssueGroups: { japanese: [4] } },
        commandIssues: { missingQuotesById: { 7: [{}] } }
    };
    assert.deepStrictEqual(validationSeedSkips(flagged), []);
    assert.deepStrictEqual(validationSeedSkips(null), []);
    assert.deepStrictEqual(validationSeedSkips([]), []);
    assert.deepStrictEqual(validationSeedSkips({ passed: true }), []);
    assert.deepStrictEqual(validationSeedSkips({ passed: true, perLineIssues: null, commandIssues: null }), []);
});
