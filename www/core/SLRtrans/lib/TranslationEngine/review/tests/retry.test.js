"use strict";
const test = require("node:test");
const assert = require("node:assert");
const retry = require("../retry");

test("isNoProgress spots identical and whitespace-only retranslations", () => {
    assert.strictEqual(retry.isNoProgress("abc", "abc"), true);
    assert.strictEqual(retry.isNoProgress("a b\nc", "a  b c"), true);
    assert.strictEqual(retry.isNoProgress("abc", "abd"), false);
    assert.strictEqual(retry.isNoProgress("", "abc"), false);
    assert.strictEqual(retry.isNoProgress("abc", ""), false);
    assert.strictEqual(retry.isNoProgress(null, "abc"), false);
});

test("rankAttempt orders clean above kept-flag above redo by severity", () => {
    assert.strictEqual(retry.rankAttempt({ verdict: null }), 0);
    assert.ok(retry.rankAttempt({ verdict: { redo: false, why: "" } }) > 0);
    const low = retry.rankAttempt({ verdict: { redo: true, why: "x", sev: "low" } });
    const medium = retry.rankAttempt({ verdict: { redo: true, why: "x", sev: "medium" } });
    const high = retry.rankAttempt({ verdict: { redo: true, why: "x", sev: "high" } });
    const failed = retry.rankAttempt({ verdict: undefined });
    assert.ok(1 < low && low < medium && medium < high && high < failed);
});

test("chooseBest returns the earliest text among the best-ranked attempts", () => {
    const attempts = [
        { text: "original", verdict: { redo: true, why: "a", sev: "medium" } },
        { text: "worse", verdict: { redo: true, why: "b", sev: "high" } },
        { text: "better", verdict: { redo: true, why: "c", sev: "low" } }
    ];
    assert.strictEqual(retry.chooseBest(attempts), "better");
    assert.strictEqual(retry.chooseBest([
        { text: "first-clean", verdict: null },
        { text: "second-clean", verdict: null }
    ]), "first-clean");
    assert.strictEqual(retry.chooseBest([]), undefined);
    assert.strictEqual(retry.chooseBest(null), undefined);
});

test("sameComplaint spots a repeated ruling in different words", () => {
    // Consecutive WHYs from one real loop (owner-sent-to-check-Moe row):
    // same defect, reworded ruling.
    const a = { redo: true, cat: "mistranslation",
        why: "The retranslation must accurately convey that the guest was instructed by the owner to come check on Moe" };
    const b = { redo: true, cat: "mistranslation",
        why: "The translation must accurately reflect that the guest was sent by the owner to check on Moe, while preserving the original meaning" };
    assert.strictEqual(retry.sameComplaint(a, b), true);
});

test("sameComplaint rejects different defects sharing a category", () => {
    const a = { redo: true, cat: "mistranslation",
        why: "The translation must accurately convey the meaning of repelling as defeat, repel, or push back an attacker rather than the vague repelled it" };
    const b = { redo: true, cat: "mistranslation",
        why: "The translation must accurately convey that the brothel staff are assisting with physically demanding tasks required to run the establishment, rather than using a vague general activity" };
    assert.strictEqual(retry.sameComplaint(a, b), false);
});

test("sameComplaint needs redo verdicts, one category, and real words", () => {
    const base = { redo: true, cat: "mistranslation", why: "The guest was sent by the owner to check on Moe" };
    assert.strictEqual(retry.sameComplaint(base,
        { redo: true, cat: "register", why: "The guest was sent by the owner to check on Moe" }), false);
    assert.strictEqual(retry.sameComplaint(base, { redo: false, why: "" }), false);
    assert.strictEqual(retry.sameComplaint(base, { redo: true, cat: "mistranslation", why: "fix it" }), false);
    assert.strictEqual(retry.sameComplaint(null, base), false);
});

test("reviewRetryBudget allows 3 network attempts and 5 repetition attempts", () => {
    // First network failure: another attempt is worth it, count advances to 1.
    let s = retry.reviewRetryBudget("network", { net: 0, repeats: 0 });
    assert.deepStrictEqual(s, { retry: true, net: 1, repeats: 0 });
    s = retry.reviewRetryBudget("network", s);
    assert.deepStrictEqual(s, { retry: true, net: 2, repeats: 0 });
    // Third network failure: budget spent, give up (no 20-minute tail).
    s = retry.reviewRetryBudget("network", s);
    assert.deepStrictEqual(s, { retry: false, net: 3, repeats: 0 });
    // Repetition is cheap: five attempts before giving up.
    let r = { net: 0, repeats: 0 };
    for (let i = 1; i <= 4; i++) {
        r = retry.reviewRetryBudget("repetition", r);
        assert.deepStrictEqual(r, { retry: true, net: 0, repeats: i });
    }
    r = retry.reviewRetryBudget("repetition", r);
    assert.deepStrictEqual(r, { retry: false, net: 0, repeats: 5 });
});

test("reviewRetryBudget keeps the two budgets independent", () => {
    // A repetition retry must not consume a network attempt, or vice versa.
    const mixed = retry.reviewRetryBudget("repetition", { net: 2, repeats: 4 });
    assert.deepStrictEqual(mixed, { retry: false, net: 2, repeats: 5 });
    const netAfterReps = retry.reviewRetryBudget("network", { net: 0, repeats: 4 });
    assert.deepStrictEqual(netAfterReps, { retry: true, net: 1, repeats: 4 });
});

test("reviewRetryBudget is defensive about unknown kinds and counters", () => {
    // Unknown kind is treated as the conservative network budget.
    assert.deepStrictEqual(retry.reviewRetryBudget("weird", { net: 0, repeats: 0 }),
        { retry: true, net: 1, repeats: 0 });
    assert.deepStrictEqual(retry.reviewRetryBudget("network", undefined),
        { retry: true, net: 1, repeats: 0 });
    assert.deepStrictEqual(retry.reviewRetryBudget("network", { net: NaN, repeats: "x" }),
        { retry: true, net: 1, repeats: 0 });
    assert.strictEqual(retry.REVIEW_NET_ATTEMPTS, 3);
    assert.strictEqual(retry.REVIEW_REPEAT_ATTEMPTS, 5);
});
