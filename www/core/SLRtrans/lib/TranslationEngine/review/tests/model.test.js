"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { resolveReviewEndpoint, parseJsonObject, isSet, isUrlSet, classifyReviewFailure, reviewStreamFlags, reviewRepetitionConfig, reviewMaxTokensForInput } = require("../model");

const BATCH = {
    apiUrl: "http://batch.example/v1/chat/completions",
    apiKey: "batch-key",
    model: "batch-model",
    doNotFixURL: false,
    disableStream: true,
    enableTokenProgress: false,
    enableStreamPreview: false,
    temperature: 0.7,
    requestDelay: 50,
    top_k: 20,
    top_p: 0.8,
    min_p: 0.01,
    repeat_penalty: 1.1,
    repetition_penalty: 1.2,
    frequency_penalty: 0.5,
    presence_penalty: 0.3,
    maxTokens: 4096,
    maxContextLength: 32000,
    chat_template_kwargs: '{"a":1}',
    customHeaders: '{"X-Batch": "1"}',
    customParameters: '{"seed": 7}',
    reasoningFormat: "openai_effort",
    reasoningEffort: "high",
    reasoningBudget: 2048
};

test("blank review URL uses the batch endpoint wholesale", () => {
    const r = resolveReviewEndpoint({}, BATCH);
    assert.strictEqual(r.apiUrl, BATCH.apiUrl);
    assert.strictEqual(r.apiKey, BATCH.apiKey);
    assert.strictEqual(r.model, BATCH.model);
    assert.strictEqual(r.temperature, 0.7);
    assert.strictEqual(r.maxTokens, 4096);
    assert.strictEqual(r.requestDelay, 50);
    assert.strictEqual(r.repeat_penalty, 1.1);
    assert.strictEqual(r.repetition_penalty, 1.2);
    assert.strictEqual(r.frequency_penalty, 0.5);
    assert.strictEqual(r.presence_penalty, 0.3);
    assert.strictEqual(r.top_k, 20);
    assert.strictEqual(r.top_p, 0.8);
    assert.strictEqual(r.min_p, 0.01);
    assert.strictEqual(r.chatTemplateKwargs, '{"a":1}');
    assert.deepStrictEqual(r.customHeaders, BATCH.customHeaders);
    assert.deepStrictEqual(r.customParameters, BATCH.customParameters);
    assert.strictEqual(r.reasoningFormat, "openai_effort");
    assert.strictEqual(r.reasoningEffort, "high");
    assert.strictEqual(r.reasoningBudget, 2048);
    assert.strictEqual(r.doNotFixURL, false);
    assert.strictEqual(r.disableStream, true);
    assert.strictEqual(r.enableTokenProgress, false);
    assert.strictEqual(r.enableStreamPreview, false);
});

test("whitespace-only review URL counts as blank", () => {
    const r = resolveReviewEndpoint({ apiUrl: "   ", temperature: 0.1, model: "other" }, BATCH);
    assert.strictEqual(r.apiUrl, BATCH.apiUrl);
    assert.strictEqual(r.model, BATCH.model);
    assert.strictEqual(r.temperature, 0.7);
});

test("blank review URL ignores all review endpoint values", () => {
    const r = resolveReviewEndpoint({
        apiUrl: "",
        apiKey: "review-key",
        model: "review-model",
        temperature: 0.1,
        maxTokens: 900,
        topK: 40,
        topP: 0.9,
        minP: 0.05,
        requestDelay: 250,
        repeatPenalty: 2.0,
        doNotFixURL: true,
        disableStream: false,
        enableTokenProgress: true,
        enableStreamPreview: true,
        reasoningFormat: "qwen",
        chatTemplateKwargs: '{"b":2}',
        customHeaders: '{"X-Review": "1"}'
    }, BATCH);
    assert.strictEqual(r.apiUrl, BATCH.apiUrl);
    assert.strictEqual(r.apiKey, BATCH.apiKey);
    assert.strictEqual(r.model, BATCH.model);
    assert.strictEqual(r.temperature, 0.7);
    assert.strictEqual(r.maxTokens, 4096);
    assert.strictEqual(r.top_k, 20);
    assert.strictEqual(r.disableStream, true);
    assert.strictEqual(r.enableTokenProgress, false);
    assert.strictEqual(r.reasoningFormat, "openai_effort");
    assert.deepStrictEqual(r.customHeaders, BATCH.customHeaders);
});

test("set review URL uses only review values, no per-option inheritance", () => {
    const r = resolveReviewEndpoint({
        apiUrl: "http://review.example/v1/chat/completions",
        apiKey: "review-key",
        model: "review-model",
        temperature: 0.1,
        maxTokens: 900,
        topK: 40,
        topP: 0.9,
        minP: 0.05,
        requestDelay: 250,
        reasoningFormat: "openai_effort",
        reasoningEffort: "high"
    }, BATCH);
    assert.strictEqual(r.apiUrl, "http://review.example/v1/chat/completions");
    assert.strictEqual(r.apiKey, "review-key");
    assert.strictEqual(r.model, "review-model");
    assert.strictEqual(r.temperature, 0.1);
    assert.strictEqual(r.maxTokens, 900);
    assert.strictEqual(r.top_k, 40);
    assert.strictEqual(r.top_p, 0.9);
    assert.strictEqual(r.min_p, 0.05);
    assert.strictEqual(r.requestDelay, 250);
    assert.strictEqual(r.reasoningFormat, "openai_effort");
    assert.strictEqual(r.reasoningEffort, "high");
    // Blank review fields stay blank/undefined instead of inheriting the batch.
    assert.strictEqual(r.repeat_penalty, undefined);
    assert.strictEqual(r.repetition_penalty, undefined);
    assert.strictEqual(r.frequency_penalty, undefined);
    assert.strictEqual(r.presence_penalty, undefined);
    assert.strictEqual(r.chatTemplateKwargs, undefined);
});

test("dedicated review endpoint leaves unset numerics unsent", () => {
    const r = resolveReviewEndpoint({ apiUrl: "http://review.example/v1/chat/completions" }, BATCH);
    assert.strictEqual(r.temperature, undefined);
    assert.strictEqual(r.maxTokens, undefined);
    assert.strictEqual(r.requestDelay, undefined);
    assert.strictEqual(r.top_k, undefined);
    assert.strictEqual(r.repeat_penalty, undefined);
    assert.strictEqual(r.model, undefined);
    assert.strictEqual(r.apiKey, undefined);
});

test("boolean flags follow the active side wholesale", () => {
    const fallback = resolveReviewEndpoint({}, BATCH);
    assert.strictEqual(fallback.doNotFixURL, false);
    assert.strictEqual(fallback.disableStream, true);
    const dedicated = resolveReviewEndpoint(
        { apiUrl: "http://review.example/v1/chat/completions" }, BATCH);
    assert.strictEqual(dedicated.doNotFixURL, false);
    assert.strictEqual(dedicated.disableStream, false);
    const dedicatedOn = resolveReviewEndpoint(
        { apiUrl: "http://review.example/v1/chat/completions", doNotFixURL: true }, BATCH);
    assert.strictEqual(dedicatedOn.doNotFixURL, true);
});

test("reviewMaxTokensForInput: seed reviews scale like full-batch requests (chars x 1.5)", () => {
    assert.strictEqual(reviewMaxTokensForInput(8000, 1000, "seed"), 1500);
    // Exact-scale parity with the batch path: truncate, don't round.
    assert.strictEqual(reviewMaxTokensForInput(8000, 701, "seed"), 1051);
});

test("reviewMaxTokensForInput: seed reviews never scale below a 1000 floor", () => {
    assert.strictEqual(reviewMaxTokensForInput(8000, 100, "seed"), 1000);
    assert.strictEqual(reviewMaxTokensForInput(8000, 0, "seed"), 1000);
});

test("reviewMaxTokensForInput: seed reviews keep a smaller configured ceiling", () => {
    assert.strictEqual(reviewMaxTokensForInput(800, 1000, "seed"), 800);
});

test("reviewMaxTokensForInput: retry reviews scale like single-line requests (chars x 3.5)", () => {
    assert.strictEqual(reviewMaxTokensForInput(8000, 500, "retry"), 1750);
});

test("reviewMaxTokensForInput: retry reviews never scale below a 500 floor", () => {
    assert.strictEqual(reviewMaxTokensForInput(8000, 50, "retry"), 500);
    assert.strictEqual(reviewMaxTokensForInput(8000, 0, "retry"), 500);
});

test("reviewMaxTokensForInput: retry reviews keep a smaller configured ceiling", () => {
    assert.strictEqual(reviewMaxTokensForInput(400, 500, "retry"), 400);
});

test("reviewMaxTokensForInput: unset ceiling sends no max_tokens", () => {
    assert.strictEqual(reviewMaxTokensForInput(undefined, 1000, "seed"), undefined);
    assert.strictEqual(reviewMaxTokensForInput(null, 1000, "seed"), undefined);
    assert.strictEqual(reviewMaxTokensForInput("", 1000, "retry"), undefined);
    assert.strictEqual(reviewMaxTokensForInput(0, 1000, "retry"), undefined);
});

test("reviewMaxTokensForInput: unknown mode falls back to seed scaling", () => {
    assert.strictEqual(reviewMaxTokensForInput(8000, 1000, "bogus"), 1500);
    assert.strictEqual(reviewMaxTokensForInput(8000, 1000, undefined), 1500);
});

test("maxContextLength follows the active side like maxTokens", () => {
    const f = resolveReviewEndpoint({}, BATCH);
    assert.strictEqual(f.maxContextLength, 32000);
    const d = resolveReviewEndpoint(
        { apiUrl: "http://review.example/v1/chat/completions", maxContextLength: 16000 }, BATCH);
    assert.strictEqual(d.maxContextLength, 16000);
    const blank = resolveReviewEndpoint(
        { apiUrl: "http://review.example/v1/chat/completions" }, BATCH);
    assert.strictEqual(blank.maxContextLength, undefined);
});

test("custom fields follow the active side", () => {
    const f = resolveReviewEndpoint({}, BATCH);
    assert.strictEqual(f.customHeaders, '{"X-Batch": "1"}');
    assert.strictEqual(f.customParameters, '{"seed": 7}');
    const d = resolveReviewEndpoint({
        apiUrl: "http://review.example/v1/chat/completions",
        customHeaders: '{"X": "1"}', customParameters: '{"seed": 42}'
    }, BATCH);
    assert.strictEqual(d.customHeaders, '{"X": "1"}');
    assert.strictEqual(d.customParameters, '{"seed": 42}');
});

test("stream display flags follow the active side", () => {
    const f = resolveReviewEndpoint({}, BATCH);
    assert.strictEqual(f.disableStream, true);
    assert.strictEqual(f.enableTokenProgress, false);
    assert.strictEqual(f.enableStreamPreview, false);
    const d = resolveReviewEndpoint(
        { apiUrl: "http://review.example/v1/chat/completions" }, BATCH);
    assert.strictEqual(d.disableStream, false);
    assert.strictEqual(d.enableTokenProgress, true);
    assert.strictEqual(d.enableStreamPreview, true);
});

test("reviewStreamFlags: disabled stream forces everything off", () => {
    assert.deepStrictEqual(reviewStreamFlags({ disableStream: true }),
        { useTokenProgress: false, showPreview: false });
});

test("reviewStreamFlags: blank config streams with counter and preview", () => {
    assert.deepStrictEqual(reviewStreamFlags({}),
        { useTokenProgress: true, showPreview: true });
});

test("reviewStreamFlags: progress off kills the preview too", () => {
    assert.deepStrictEqual(reviewStreamFlags({ enableTokenProgress: false }),
        { useTokenProgress: false, showPreview: false });
});

test("reviewStreamFlags: preview off keeps the counter", () => {
    assert.deepStrictEqual(reviewStreamFlags({ enableStreamPreview: false }),
        { useTokenProgress: true, showPreview: false });
});

test("parseJsonObject is tolerant of malformed input", () => {
    assert.deepStrictEqual(parseJsonObject(""), {});
    assert.deepStrictEqual(parseJsonObject(undefined), {});
    assert.deepStrictEqual(parseJsonObject("not json"), {});
    assert.deepStrictEqual(parseJsonObject("[1,2]"), {});
    assert.deepStrictEqual(parseJsonObject('{"seed": 42}'), { seed: 42 });
});

test("isSet treats empty string, null and undefined as unset", () => {
    assert.strictEqual(isSet(0), true);
    assert.strictEqual(isSet(false), true);
    assert.strictEqual(isSet(""), false);
    assert.strictEqual(isSet(null), false);
    assert.strictEqual(isSet(undefined), false);
});

test("isUrlSet treats whitespace-only as unset", () => {
    assert.strictEqual(isUrlSet(undefined), false);
    assert.strictEqual(isUrlSet(null), false);
    assert.strictEqual(isUrlSet(""), false);
    assert.strictEqual(isUrlSet("   "), false);
    assert.strictEqual(isUrlSet("http://x.example/v1"), true);
});

test("classifyReviewFailure: auth/permission errors never retry", () => {
    for (const s of [401, 403, 404, "401", "403", "404"]) {
        assert.strictEqual(classifyReviewFailure(s), "unrecoverable", String(s));
    }
});

test("classifyReviewFailure: rate-limit/overload cooldown and rotate", () => {
    for (const s of [429, 524, "429", "524"]) {
        assert.strictEqual(classifyReviewFailure(s), "rate-limit", String(s));
    }
});

test("classifyReviewFailure: everything else is an ordinary retry", () => {
    for (const s of [400, 500, 502, 503, undefined, null, "", "ETIMEDOUT", "TypeError"]) {
        assert.strictEqual(classifyReviewFailure(s), "retry", String(s));
    }
});

test("reviewRepetitionConfig uses the character and word tiers, never entries", () => {
    assert.deepStrictEqual(reviewRepetitionConfig({ charLimit: 20, wordLimit: 15, entryLimit: 4 }),
        { charLimit: 20, wordLimit: 15, entryLimit: 0 });
});

test("reviewRepetitionConfig disables detection when both tiers are off", () => {
    assert.strictEqual(reviewRepetitionConfig({ charLimit: 0, wordLimit: 0, entryLimit: 4 }), 0);
    assert.strictEqual(reviewRepetitionConfig({}), 0);
    assert.strictEqual(reviewRepetitionConfig(null), 0);
    assert.strictEqual(reviewRepetitionConfig(undefined), 0);
});

test("reviewRepetitionConfig attaches the fuzzy-loop check when the skeleton tier is on", () => {
    const cfg = reviewRepetitionConfig({ charLimit: 0, wordLimit: 0, entryLimit: 0, skeletonLimit: 6 });
    assert.strictEqual(typeof cfg.inspect, "function");
    const looped = [];
    for (let n = 0; n < 6; n++) {
        looped.push("Let's check @6 again. The addition of \"special\" is the issue here.");
    }
    assert.ok(cfg.inspect(looped.join("\n")), "repeated line must be reported");
    assert.strictEqual(cfg.inspect("@1｜high｜mistranslation｜the subject is wrong here"), "");
    const distinct = [5, 6, 7, 8, 9, 10].map((n) =>
        "@" + n + "\uFF5Clow\uFF5Cother\uFF5CExtra quotation mark at the end of the line.").join("\n");
    assert.strictEqual(cfg.inspect(distinct), "",
        "findings about different rows must never count as a loop");
});

test("reviewRepetitionConfig omits the fuzzy-loop check when the skeleton tier is off", () => {
    for (const tiers of [
        { charLimit: 20, wordLimit: 15, entryLimit: 4 },
        { charLimit: 20, wordLimit: 15, entryLimit: 4, skeletonLimit: 0 },
        { charLimit: 20, wordLimit: 15, entryLimit: 4, skeletonLimit: 1 }
    ]) {
        const cfg = reviewRepetitionConfig(tiers);
        assert.strictEqual(cfg.inspect, undefined);
    }
    assert.strictEqual(reviewRepetitionConfig(
        { charLimit: 0, wordLimit: 0, entryLimit: 0, skeletonLimit: 0 }), 0);
});

test("reviewRepetitionConfig stays active for the skeleton tier alone", () => {
    // With every size tier disabled, the inspect callback is the only
    // detector — the shared resolver must still mark the config active, or
    // the check is silently skipped.
    const rail = require("../../ResponsesApiHelpers");
    const cfg = reviewRepetitionConfig(
        { charLimit: 0, wordLimit: 0, entryLimit: 0, skeletonLimit: 6 });
    assert.notStrictEqual(cfg, 0);
    const resolved = rail.resolveRepetitionConfig(cfg, 0);
    assert.ok(resolved.active, "inspect-only config must be active");
    assert.strictEqual(typeof resolved.inspect, "function");
});
