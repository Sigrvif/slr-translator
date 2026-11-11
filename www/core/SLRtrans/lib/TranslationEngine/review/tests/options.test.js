"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { concernFor, REVIEW_OPTION_IDS, DISPLAY_IDS, createReviewOptions } = require("../options");

test("toggles live in Retry & Quality Control", () => {
    assert.deepStrictEqual(concernFor("reviewTranslations"), { parent: "retry" });
    assert.deepStrictEqual(concernFor("reviewAutoFix"), { parent: "retry" });
    assert.deepStrictEqual(concernFor("reviewJudge"), { parent: "retry" });
    assert.deepStrictEqual(concernFor("reviewRetryRounds"), { parent: "retry" });
    assert.deepStrictEqual(concernFor("reviewMinSeverity"), { parent: "retry" });
    assert.deepStrictEqual(concernFor("reviewEscalateMinSeverity"), { parent: "retry" });
});

test("review prompts live under the review role in Prompts", () => {
    assert.deepStrictEqual(concernFor("reviewQcSystemPrompt"),
        { parent: "prompts", child: "review" });
    assert.deepStrictEqual(concernFor("reviewFixUserPrompt"), null);
    assert.deepStrictEqual(concernFor("reviewJudgeUserPrompt"), { parent: "prompts", child: "review" });
});

test("review model options group under their concern with the review child", () => {
    assert.deepStrictEqual(concernFor("reviewApiUrl"), { parent: "connection", child: "review" });
    assert.deepStrictEqual(concernFor("reviewModel"), { parent: "connection", child: "review" });
    assert.deepStrictEqual(concernFor("reviewTemperature"), { parent: "sampling", child: "review" });
    assert.deepStrictEqual(concernFor("reviewReasoningFormat"), { parent: "sampling", child: "review" });
    assert.deepStrictEqual(concernFor("reviewMaxTokens"), { parent: "limits", child: "review" });
    assert.deepStrictEqual(concernFor("reviewMaxContextLength"), { parent: "limits", child: "review" });
    assert.deepStrictEqual(concernFor("reviewTokenCap"), null);
});

test("review stream display toggles live under the review role in Sampling", () => {
    assert.deepStrictEqual(DISPLAY_IDS,
        ["reviewDisableStream", "reviewEnableTokenProgress", "reviewEnableStreamPreview"]);
    for (const id of DISPLAY_IDS) {
        assert.deepStrictEqual(concernFor(id), { parent: "sampling", child: "review" });
    }
});

test("every declared id is mapped", () => {
    for (const id of REVIEW_OPTION_IDS) {
        assert.ok(concernFor(id), "unmapped " + id);
    }
});

test("createReviewOptions builds every option with the right category/default", () => {
    const created = [];
    class StubOption {
        constructor(cfg) { this.cfg = cfg; created.push(cfg); }
        getId() { return this.cfg.id; }
    }
    const wrapper = { addOption() {} };
    const cats = { OPTIONS: "Options", PROMPTS: "Prompts" };
    const opts = createReviewOptions(wrapper, StubOption, cats);
    assert.strictEqual(opts.length, REVIEW_OPTION_IDS.length);
    const byId = {};
    for (const o of opts) byId[o.getId()] = o.cfg;
    assert.strictEqual(byId.reviewTranslations.default, false);
    assert.strictEqual(byId.reviewAutoFix.default, false);
    assert.strictEqual(byId.reviewJudge.default, true);
    assert.strictEqual(byId.reviewJudge.formType, "checkbox");
    assert.strictEqual(byId.reviewTranslations.category, "Options");
    assert.strictEqual(byId.reviewQcSystemPrompt.category, "Prompts");
    assert.strictEqual(byId.reviewApiUrl.category, "Options");
    assert.strictEqual(byId.reviewApiUrl.default, "");
    assert.strictEqual(byId.reviewModel.default, "");
    assert.strictEqual(byId.reviewTemperature.default, null);
    assert.strictEqual(byId.reviewReasoningFormat.default, "none");
    assert.strictEqual(byId.reviewRetryRounds.default, 5);
    assert.strictEqual(byId.reviewMinSeverity.default, "low");
    assert.strictEqual(byId.reviewEscalateMinSeverity.default, true);
    assert.strictEqual(byId.reviewEscalateMinSeverity.formType, "checkbox");
    assert.strictEqual(byId.reviewDisableStream.default, false);
    assert.strictEqual(byId.reviewEnableTokenProgress.default, true);
    assert.strictEqual(byId.reviewEnableStreamPreview.default, true);
    assert.strictEqual(byId.reviewDisableStream.formType, "checkbox");
    assert.strictEqual(byId.reviewEnableTokenProgress.formType, "checkbox");
    assert.strictEqual(byId.reviewEnableStreamPreview.formType, "checkbox");
    for (const id of REVIEW_OPTION_IDS) assert.ok(byId[id], "missing " + id);
});
