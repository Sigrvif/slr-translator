"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { reviewWindows, meetsSeverity, windowPairs, REREVIEW_RADIUS, escalateSeverity, escalateStepsForRound } = require("../linecheck");

const PAIRS = [{ index: 1, speaker: "", wireSrc: "JP", wireDst: "EN" }];

function makeDeps(responses) {
    const calls = [];
    return {
        calls,
        deps: {
            callModel: async (system, user, kind) => {
                calls.push({ system, user, kind });
                const next = responses.shift();
                if (next instanceof Error) throw next;
                return next;
            },
            replacers: {}
        }
    };
}

test("meetsSeverity compares the low<medium<high ladder", () => {
    assert.strictEqual(meetsSeverity("low", "low"), true);
    assert.strictEqual(meetsSeverity("low", "high"), false);
    assert.strictEqual(meetsSeverity("high", "medium"), true);
    assert.strictEqual(meetsSeverity("medium", "low"), true);
});

test("escalateSeverity raises the bar one rank for re-reviews", () => {
    assert.strictEqual(escalateSeverity("low"), "medium");
    assert.strictEqual(escalateSeverity("medium"), "high");
    assert.strictEqual(escalateSeverity("high"), "high");
    assert.strictEqual(escalateSeverity(undefined), "medium");
});

test("escalateSeverity is progressive and caps at high across rounds", () => {
    // First re-review judges at the configured bar, then each further round
    // raises it one rank.
    assert.strictEqual(escalateSeverity("low", 0), "low");
    assert.strictEqual(escalateSeverity("low", 1), "medium");
    assert.strictEqual(escalateSeverity("low", 2), "high");
    assert.strictEqual(escalateSeverity("low", 3), "high");
    assert.strictEqual(escalateSeverity("medium", 0), "medium");
    assert.strictEqual(escalateSeverity("medium", 1), "high");
    assert.strictEqual(escalateSeverity("medium", 2), "high");
    assert.strictEqual(escalateSeverity("high", 2), "high");
    // Unknown input escalates from low; non-finite steps are treated as 0.
    assert.strictEqual(escalateSeverity(undefined, 0), "low");
    assert.strictEqual(escalateSeverity(undefined, 2), "high");
    assert.strictEqual(escalateSeverity("low", -1), "low");
    assert.strictEqual(escalateSeverity("low", NaN), "low");
});

test("escalateStepsForRound maps fix rounds to rank increments", () => {
    assert.strictEqual(escalateStepsForRound(0), 0);
    assert.strictEqual(escalateStepsForRound(1), 0);
    assert.strictEqual(escalateStepsForRound(2), 1);
    assert.strictEqual(escalateStepsForRound(3), 2);
    assert.strictEqual(escalateStepsForRound(undefined), 0);
    assert.strictEqual(escalateStepsForRound(null), 0);
    assert.strictEqual(escalateStepsForRound(-4), 0);
    assert.strictEqual(escalateStepsForRound(NaN), 0);
    assert.strictEqual(escalateStepsForRound("2"), 1);
});

test("windowPairs centers on the retried row with real batch indices", () => {
    const srcs = ["s0", "s1", "s2", "s3", "s4"];
    const dsts = ["d0", "d1", "d2", "d3", "d4"];
    const pairs = windowPairs(2, srcs, dsts, "D2-NEW", 1);
    assert.deepStrictEqual(pairs.map((p) => p.index), [1, 2, 3]);
    assert.strictEqual(pairs[1].wireSrc, "s2");
    assert.strictEqual(pairs[1].wireDst, "D2-NEW");
    assert.strictEqual(pairs[0].wireDst, "d1");
});

test("windowPairs clamps at the batch edges", () => {
    const srcs = ["s0", "s1", "s2"];
    const dsts = ["d0", "d1", "d2"];
    assert.deepStrictEqual(windowPairs(0, srcs, dsts, "NEW", 10).map((p) => p.index), [0, 1, 2]);
    assert.deepStrictEqual(windowPairs(2, srcs, dsts, "NEW", 10).map((p) => p.index), [0, 1, 2]);
});

test("windowPairs defaults to REREVIEW_RADIUS and skips unpaired rows", () => {
    assert.ok(REREVIEW_RADIUS >= 5);
    const pairs = windowPairs(1, ["a", "b", null], ["A", "B", "C"], "B-NEW");
    assert.deepStrictEqual(pairs.map((p) => p.index), [0, 1]);
    assert.strictEqual(pairs[1].wireDst, "B-NEW");
});

test("CLEAN produces no findings", async () => {
    const { deps } = makeDeps(["CLEAN"]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, []);
    assert.deepStrictEqual(out.verdicts, {});
    assert.strictEqual(out.windowsFailed, 0);
});

test("a judged redo becomes a per-line verdict", async () => {
    const { deps, calls } = makeDeps([
        "@1｜high｜mistranslation｜wrong",          // QC
        "VERDICT: redo\nWHY: restore the subject"  // Judge
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts[1], { redo: true, why: "restore the subject", sev: "high", cat: "mistranslation" });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].kind, "QC");
    assert.strictEqual(calls[1].kind, "judge");
});

test("a dismissed finding is not a verdict and releases its flag", async () => {
    const { deps, calls } = makeDeps([
        "@1｜high｜mistranslation｜wrong",
        "VERDICT: dismiss"
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, []);        // dismissed => row leaves `flagged`
    assert.deepStrictEqual(out.verdicts, {});
    assert.strictEqual(calls.length, 2);
});

test("a malformed judge verdict keeps the flag (unadjudicated)", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong",
        "I think the translation is fine."          // no VERDICT line
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts, {});
});

test("a failed judge call keeps the flag (unadjudicated)", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong",
        new Error("judge endpoint down")
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts, {});
    assert.ok(out.log.some((l) => l.includes("review judge failed")), out.log.join("|"));
});

test("two findings on one row: only fully dismissed leaves flagged", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong\n@1｜medium｜register｜too casual", // QC: two findings
        "VERDICT: dismiss",                          // judge 1
        "VERDICT: dismiss"                           // judge 2
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, []);
    assert.deepStrictEqual(out.verdicts, {});
});

test("two findings on one row: one dismiss one redo keeps the row flagged and redo", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong\n@1｜medium｜register｜too casual", // QC: two findings
        "VERDICT: dismiss",                          // judge 1
        "VERDICT: redo\nWHY: fix the register"       // judge 2
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts[1], { redo: true, why: "fix the register", sev: "medium", cat: "register" });
});

test("a redo verdict carries the worst severity of its confirmed findings", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong\n@1｜medium｜register｜too casual",
        "VERDICT: redo\nWHY: fix the meaning",   // judge 1: high confirmed
        "VERDICT: redo\nWHY: fix the register"   // judge 2: medium confirmed
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.verdicts[1], { redo: true, why: "fix the meaning", sev: "high", cat: "mistranslation" });
});

test("a redo verdict's severity ignores dismissed findings", async () => {
    const { deps } = makeDeps([
        "@1｜high｜mistranslation｜wrong\n@1｜medium｜register｜too casual",
        "VERDICT: dismiss",                       // judge 1: high dropped
        "VERDICT: redo\nWHY: fix the register"    // judge 2: medium confirmed
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.verdicts[1], { redo: true, why: "fix the register", sev: "medium", cat: "register" });
});

test("a redo verdict carries the confirmed finding's category", async () => {
    const { deps } = makeDeps([
        "@1｜medium｜register｜too casual",
        "VERDICT: redo\nWHY: fix the register"
    ]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.verdicts[1],
        { redo: true, why: "fix the register", sev: "medium", cat: "register" });
});

test("a span finding dismissed for all its targets releases every target", async () => {
    const pairs = [1, 2, 3].map((n) => ({ index: n, speaker: "", wireSrc: "JP" + n, wireDst: "EN" + n }));
    const { deps } = makeDeps([
        "@1-3｜high｜omission｜dropped a sentence",
        "VERDICT: dismiss"
    ]);
    const out = await reviewWindows(pairs, deps);
    assert.deepStrictEqual(out.flagged, []);
    assert.deepStrictEqual(out.verdicts, {});
});

test("findings below minSeverity are flagged but never judged", async () => {
    const { deps, calls } = makeDeps([
        "@1｜low｜other｜nitpick"                   // QC only; no judge should run
    ]);
    const out = await reviewWindows(PAIRS, Object.assign({}, deps, { minSeverity: "high" }));
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts, {});
    assert.strictEqual(calls.length, 1);
});

test("judge off: an above-severity finding orders the retry without a judge call", async () => {
    const { deps, calls } = makeDeps([
        "@1｜high｜mistranslation｜wrong"          // QC only; no judge response queued
    ]);
    const out = await reviewWindows(PAIRS, Object.assign({}, deps, { judge: false }));
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts[1],
        { redo: true, why: "wrong", sev: "high", cat: "mistranslation" });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].kind, "QC");
});

test("judge off: below-minSeverity findings still only flag", async () => {
    const { deps, calls } = makeDeps([
        "@1｜low｜other｜nitpick"
    ]);
    const out = await reviewWindows(PAIRS, Object.assign({}, deps, { judge: false, minSeverity: "high" }));
    assert.deepStrictEqual(out.flagged, [1]);
    assert.deepStrictEqual(out.verdicts, {});
    assert.strictEqual(calls.length, 1);
});

test("judge off: the worst-severity finding on a row sets the verdict", async () => {
    const { deps } = makeDeps([
        "@1｜medium｜register｜too casual\n@1｜high｜mistranslation｜wrong"  // QC: two findings, worst second
    ]);
    const out = await reviewWindows(PAIRS, Object.assign({}, deps, { judge: false }));
    assert.deepStrictEqual(out.verdicts[1],
        { redo: true, why: "wrong", sev: "high", cat: "mistranslation" });
});

test("judge off: a dismissed-by-judge setup is irrelevant, findings act directly", async () => {
    // Guards against accidentally still calling the judge: the queued judge
    // text would be consumed as the QC response if a judge call happened.
    const { deps, calls } = makeDeps([
        "@1｜high｜mistranslation｜wrong",
        "VERDICT: dismiss"
    ]);
    const out = await reviewWindows(PAIRS, Object.assign({}, deps, { judge: false }));
    assert.deepStrictEqual(out.verdicts[1],
        { redo: true, why: "wrong", sev: "high", cat: "mistranslation" });
    assert.strictEqual(calls.length, 1);
});

test("a failed QC call is logged, never throws, and counts in windowsFailed", async () => {
    const { deps } = makeDeps([new Error("boom")]);
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.flagged, []);
    assert.strictEqual(out.windowsFailed, 1);
    assert.deepStrictEqual(out.unreviewed, [1]);
    assert.ok(out.log.some((l) => l.includes("review qc window failed")), out.log.join("|"));
});

test("a partially failed QC pass lists only the uncovered rows as unreviewed", async () => {
    const pairs = [1, 2].map((n) => ({ index: n, speaker: "", wireSrc: "JP" + n, wireDst: "EN" + n }));
    const { deps } = makeDeps([
        new Error("boom"),   // window over row 1 fails
        "CLEAN"              // window over row 2 succeeds
    ]);
    const out = await reviewWindows(pairs, Object.assign({}, deps, { span: 1 }));
    assert.strictEqual(out.windowsFailed, 1);
    assert.deepStrictEqual(out.unreviewed, [1]);
    assert.deepStrictEqual(out.flagged, []);
});

test("pairs without both wire sides are ignored", async () => {
    const { deps, calls } = makeDeps([]);
    const out = await reviewWindows([{ index: 1, wireSrc: "a" }], deps);
    assert.deepStrictEqual(out.flagged, []);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(out.windowsFailed, 0);
});

const FOCUS_PAIRS = [16, 17, 18].map((n) => ({ index: n, speaker: "", wireSrc: "JP" + n, wireDst: "EN" + n }));

function makeFocusDeps(responses) {
    const built = makeDeps(responses);
    const ui = [];
    built.deps.log = (m) => ui.push(m);
    built.deps.focusIndex = 17;
    return { deps: built.deps, calls: built.calls, ui };
}

test("focusIndex: the QC prompt scopes the re-review to the retried row", async () => {
    const { deps, calls } = makeFocusDeps(["CLEAN"]);
    await reviewWindows(FOCUS_PAIRS, deps);
    assert.strictEqual(calls[0].kind, "QC");
    assert.ok(calls[0].user.includes("Only row @17 is under review"), calls[0].user);
});

test("focusIndex: neighbor findings are never judged, logged, or recorded", async () => {
    const { deps, calls, ui } = makeFocusDeps([
        "@16｜high｜mistranslation｜wrong neighbor"   // QC only; the judge must never run
    ]);
    const out = await reviewWindows(FOCUS_PAIRS, deps);
    assert.deepStrictEqual(out.verdicts, {});
    assert.deepStrictEqual(out.flagged, []);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(ui, []);
});

test("focusIndex: the focused row is still judged and logged", async () => {
    const { deps, calls, ui } = makeFocusDeps([
        "@16｜high｜mistranslation｜wrong neighbor\n@17｜high｜mistranslation｜wrong focus",
        "VERDICT: redo\nWHY: fix row seventeen"
    ]);
    const out = await reviewWindows(FOCUS_PAIRS, deps);
    assert.deepStrictEqual(out.verdicts, { 17: { redo: true, why: "fix row seventeen", sev: "high", cat: "mistranslation" } });
    assert.deepStrictEqual(out.flagged, [17]);
    assert.strictEqual(calls.filter((c) => c.kind === "judge").length, 1);
    assert.ok(ui.some((m) => m.includes("@17")), ui.join("|"));
    assert.ok(!ui.some((m) => m.includes("@16")), ui.join("|"));
});

test("focusIndex: span verdicts touching focus apply to the focused row only", async () => {
    const { deps } = makeFocusDeps([
        "@16-18｜high｜omission｜dropped a sentence",
        "VERDICT: redo\nWHY: restore the sentence"
    ]);
    const out = await reviewWindows(FOCUS_PAIRS, deps);
    assert.deepStrictEqual(out.verdicts, { 17: { redo: true, why: "restore the sentence", sev: "high", cat: "omission" } });
    assert.deepStrictEqual(out.flagged, [17]);
});

test("deps.history reaches the QC and judge re-review messages", async () => {
    const { deps, calls } = makeFocusDeps([
        "@17｜high｜mistranslation｜wrong focus",
        "VERDICT: redo\nWHY: fix row seventeen"
    ]);
    deps.history = [{ text: "EN17-OLD", why: "keep it explicit" }];
    await reviewWindows(FOCUS_PAIRS, deps);
    const qc = calls.find((c) => c.kind === "QC");
    const judge = calls.find((c) => c.kind === "judge");
    assert.ok(qc && qc.user.includes("EN17-OLD"), qc && qc.user);
    assert.ok(judge && judge.user.includes("keep it explicit"), judge && judge.user);
});

test("review sections reach the QC user message", async () => {
    const { deps, calls } = makeDeps(["CLEAN"]);
    deps.sections = [["Glossary", "まおう = Demon King"]];
    await reviewWindows(PAIRS, deps);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].user.includes("まおう = Demon King"), calls[0].user);
});

function makeSplitDeps(responses, extraDeps) {
    const calls = [];
    const deps = Object.assign({
        callModel: async (...args) => {
            calls.push({ system: args[0], user: args[1], kind: args[2], extra: args[3] || null });
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
        replacers: {}
    }, extraDeps);
    return { deps, calls };
}

test("cacheFriendly sends sections as a separate context, not in the task", async () => {
    const { deps, calls } = makeSplitDeps(["CLEAN"], {
        sections: [["Glossary", "まおう = Demon King"]],
        cacheFriendly: true
    });
    await reviewWindows(PAIRS, deps);
    assert.strictEqual(calls.length, 1);
    assert.ok(!calls[0].user.includes("Demon King"), calls[0].user);
    assert.ok(calls[0].extra && calls[0].extra.context.includes("まおう = Demon King"));
});

test("cacheFriendly splits the judge message the same way", async () => {
    const { deps, calls } = makeSplitDeps([
        "@1｜high｜mistranslation｜wrong",
        "VERDICT: redo\nWHY: fix it"
    ], {
        sections: [["Scene context", "fantasy world"]],
        cacheFriendly: true
    });
    const out = await reviewWindows(PAIRS, deps);
    assert.deepStrictEqual(out.verdicts[1], { redo: true, why: "fix it", sev: "high", cat: "mistranslation" });
    const judgeCall = calls.find((c) => c.kind === "judge");
    assert.ok(judgeCall, "judge must run");
    assert.ok(!judgeCall.user.includes("fantasy world"), judgeCall.user);
    assert.ok(judgeCall.extra && judgeCall.extra.context.includes("fantasy world"));
});

test("cacheFriendly without sections sends no separate context", async () => {
    const { deps, calls } = makeSplitDeps(["CLEAN"], { cacheFriendly: true });
    await reviewWindows(PAIRS, deps);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].extra.context, null);
});

test("without cacheFriendly the context stays inside the task message", async () => {
    const { deps, calls } = makeSplitDeps(["CLEAN"], {
        sections: [["Glossary", "まおう = Demon King"]]
    });
    await reviewWindows(PAIRS, deps);
    assert.ok(calls[0].user.includes("Demon King"), calls[0].user);
    assert.strictEqual(calls[0].extra.context, null);
});

test("windowPairs prefers settled text for processed rows", () => {
    const srcs = ["s0", "s1", "s2", "s3", "s4"];
    const dsts = ["d0", "d1", "d2", "d3", "d4"];
    const pairs = windowPairs(2, srcs, dsts, "D2-NEW", 1,
        { settled: ["d0A", null, "d2A", "d3A", "d4A"] });
    assert.deepStrictEqual(pairs.map((p) => p.index), [1, 2, 3]);
    assert.strictEqual(pairs[0].wireDst, "d1");      // unsettled falls back to batch
    assert.strictEqual(pairs[1].wireDst, "D2-NEW");  // focus always uses the fresh text
    assert.strictEqual(pairs[2].wireDst, "d3A");     // settled wins over batch
});

test("windowPairs serves suspect rows source-only", () => {
    const pairs = windowPairs(1, ["a", "b", "c"], ["A", "B", "C"], "B-NEW", 10, { suspect: [2] });
    assert.deepStrictEqual(pairs.map((p) => p.index), [0, 1, 2]);
    assert.strictEqual(pairs[0].wireDst, "A");
    assert.strictEqual(pairs[1].wireDst, "B-NEW");
    assert.strictEqual(pairs[2].wireDst, "");
    assert.strictEqual(pairs[2].sourceOnly, true);
});

test("windowPairs never treats the focused row as suspect", () => {
    const pairs = windowPairs(1, ["a", "b", "c"], ["A", "B", "C"], "B-NEW", 10, { suspect: [1] });
    assert.strictEqual(pairs[1].wireDst, "B-NEW");
    assert.strictEqual(pairs[1].sourceOnly, undefined);
});

test("source-only pairs are served as context, never verdict targets", async () => {
    const pairs = [
        { index: 1, speaker: "", wireSrc: "JP1", wireDst: "EN1" },
        { index: 2, speaker: "", wireSrc: "JP2", wireDst: "", sourceOnly: true }
    ];
    const built = makeDeps([
        "@2｜high｜omission｜translation missing"   // QC baits on the empty row; must be dropped
    ]);
    const ui = [];
    built.deps.log = (m) => ui.push(m);
    built.deps.focusIndex = 1;
    const out = await reviewWindows(pairs, built.deps);
    assert.deepStrictEqual(out.verdicts, {});
    assert.deepStrictEqual(out.flagged, []);
    assert.strictEqual(built.calls.length, 1);   // QC only, no judge
    assert.deepStrictEqual(ui, []);
    assert.deepStrictEqual(out.unreviewed, []);
});
