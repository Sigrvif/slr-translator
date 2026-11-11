"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createRouterClient, waitForHealth, parseSpecMetrics, parseRuntimeMetrics,
    parseModelStatuses, parseSlotActivity, selectModelStatus } = require("../lib/RouterClient");

function fakeHttp(routes) {
    return {
        get: async (url) => {
            if (!(url in routes)) throw new Error(`no route: ${url}`);
            return routes[url];
        },
        post: async (url, body) => {
            if (!(url in routes)) throw new Error(`no route: ${url}`);
            return routes[url](body);
        }
    };
}

test("listModels returns model ids and props accepts an optional model", async () => {
    const http = fakeHttp({
        "http://x/v1/models": { status: 200, body: { data: [{ id: "a.gguf" }, { id: "b.gguf" }] } },
        "http://x/props?model=a.gguf": { status: 200, body: { is_sleeping: false } }
    });
    const client = createRouterClient({ http, baseUrl: "http://x" });
    assert.deepStrictEqual(await client.listModels(), ["a.gguf", "b.gguf"]);
    assert.deepStrictEqual(await client.props("a.gguf"), { is_sleeping: false });
});

test("waitForHealth polls until status 200", async () => {
    let calls = 0;
    const client = {
        health: async () => {
            calls += 1;
            return calls < 3 ? { status: 503, body: { error: { message: "Loading model" } } } : { status: 200, body: { status: "ok" } };
        }
    };
    const result = await waitForHealth(client, {
        timeoutMs: 5000, intervalMs: 10, sleep: async () => {}, now: () => 0
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(calls, 3);
});

test("waitForHealth times out with the last observed state", async () => {
    let t = 0;
    const client = { health: async () => { throw new Error("ECONNREFUSED"); } };
    await assert.rejects(
        () => waitForHealth(client, {
            timeoutMs: 100, intervalMs: 50, sleep: async (ms) => { t += ms; }, now: () => t
        }),
        /did not become healthy within 100 ms/
    );
});

test("metrics requests the bare endpoint and appends an encoded model id", async () => {
    const calls = [];
    const http = {
        get: async (url) => { calls.push(url); return { status: 200, body: "" }; },
        post: async () => { throw new Error("unused"); }
    };
    const client = createRouterClient({ http, baseUrl: "http://x/" });
    await client.metrics();
    await client.metrics("a b.gguf");
    assert.deepStrictEqual(calls, [
        "http://x/metrics",
        "http://x/metrics?model=a%20b.gguf"
    ]);
});

test("parseSpecMetrics reads the speculative-decoding counters", () => {
    const text = [
        "# HELP llamacpp:spec_decode_num_draft_tokens_total Draft tokens",
        "# TYPE llamacpp:spec_decode_num_draft_tokens_total counter",
        "llamacpp:spec_decode_num_draft_tokens_total 400",
        "llamacpp:spec_decode_num_accepted_tokens_total 250",
        "llamacpp:spec_decode_num_drafts_total 40",
        "llamacpp:tokens_predicted_total 999"
    ].join("\n");
    assert.deepStrictEqual(parseSpecMetrics(text), {
        draftTokens: 400,
        acceptedTokens: 250,
        drafts: 40,
        acceptance: 0.625
    });
});

test("parseSpecMetrics returns null when no speculative counters are present", () => {
    assert.strictEqual(parseSpecMetrics("llamacpp:tokens_predicted_total 12\n"), null);
    assert.strictEqual(parseSpecMetrics(""), null);
    assert.strictEqual(parseSpecMetrics(null), null);
});

test("parseSpecMetrics treats zero draft tokens as zero acceptance", () => {
    const text = [
        "llamacpp:spec_decode_num_draft_tokens_total 0",
        "llamacpp:spec_decode_num_accepted_tokens_total 0",
        "llamacpp:spec_decode_num_drafts_total 0"
    ].join("\n");
    assert.deepStrictEqual(parseSpecMetrics(text), {
        draftTokens: 0,
        acceptedTokens: 0,
        drafts: 0,
        acceptance: 0
    });
});

test("parseRuntimeMetrics reads throughput counters and the gauges", () => {
    const text = [
        "# TYPE llamacpp:prompt_tokens_total counter",
        "llamacpp:prompt_tokens_total 1000",
        "llamacpp:prompt_tokens_cached_total 750",
        "llamacpp:prompt_seconds_total 40",
        "llamacpp:tokens_predicted_total 200",
        "llamacpp:tokens_predicted_seconds_total 20",
        "llamacpp:prompt_tokens_seconds 25.5",
        "llamacpp:predicted_tokens_seconds 10.25"
    ].join("\n");
    assert.deepStrictEqual(parseRuntimeMetrics(text), {
        promptTokens: 1000,
        promptTokensCached: 750,
        promptSeconds: 40,
        predictedTokens: 200,
        predictedSeconds: 20,
        promptTokensPerSecond: 25.5,
        predictedTokensPerSecond: 10.25,
        cacheReuse: 0.75
    });
});

test("parseRuntimeMetrics reports zero cache reuse when no prompt tokens were counted", () => {
    const text = "llamacpp:predicted_tokens_seconds 0\nllamacpp:tokens_predicted_total 0";
    const parsed = parseRuntimeMetrics(text);
    assert.strictEqual(parsed.cacheReuse, 0);
    assert.strictEqual(parsed.predictedTokensPerSecond, 0);
});

test("parseRuntimeMetrics returns null when none of its counters are present", () => {
    assert.strictEqual(parseRuntimeMetrics(null), null);
    assert.strictEqual(parseRuntimeMetrics(""), null);
    assert.strictEqual(parseRuntimeMetrics("llamacpp:something_else 1"), null);
});

test("parseModelStatuses reads the router load state per model", () => {
    const body = {
        data: [
            { id: "a.gguf", status: { value: "loaded" } },
            { id: "b.gguf", status: { value: "loading" } },
            { id: "c.gguf" },
            { status: { value: "unloaded" } },
            "junk"
        ]
    };
    assert.deepStrictEqual(parseModelStatuses(body), [
        { id: "a.gguf", status: "loaded" },
        { id: "b.gguf", status: "loading" },
        { id: "c.gguf", status: "unknown" }
    ]);
    assert.deepStrictEqual(parseModelStatuses(null), []);
    assert.deepStrictEqual(parseModelStatuses({ data: "no" }), []);
});

test("parseSlotActivity reports the prompt phase with its progress", () => {
    // The build does report how much of the prompt has been read: measured partway through a
    // short prompt it was 22 of 26 tokens, and it climbs in coarse steps on long ones. The
    // phase must therefore be decided by whether the prompt is finished, not by testing for an
    // exact zero - requiring zero misreported an in-progress prefill as generation.
    const body = [
        { n_ctx: 4096, is_processing: false, n_prompt_tokens: 205, n_prompt_tokens_processed: 0 },
        { n_ctx: 4096, is_processing: true, n_prompt_tokens: 2048, n_prompt_tokens_processed: 512,
          next_token: [{ has_next_token: true, n_decoded: 0, n_remain: 96 }] }
    ];
    assert.deepStrictEqual(parseSlotActivity(body),
        { phase: "prompt", slots: 1, promptTokens: 2048, promptProcessed: 512 });
});

test("parseSlotActivity treats a fully-processed prompt with no decoded tokens as generation", () => {
    const body = [{
        is_processing: true, n_prompt_tokens: 300, n_prompt_tokens_processed: 300,
        next_token: [{ has_next_token: true, n_decoded: 0, n_remain: 59 }]
    }];
    assert.deepStrictEqual(parseSlotActivity(body),
        { phase: "generating", slots: 1, decoded: 0, remain: 59 });
});

test("parseSlotActivity reports real generation progress from next_token", () => {
    const body = [{
        is_processing: true, n_prompt_tokens: 300, n_prompt_tokens_processed: 296,
        next_token: [{ has_next_token: true, n_decoded: 37, n_remain: 59 }]
    }];
    assert.deepStrictEqual(parseSlotActivity(body), { phase: "generating", slots: 1, decoded: 37, remain: 59 });
});

test("parseSlotActivity sums only the busy slots, never the idle ones", () => {
    // Idle slots keep their previous counts; counting them is what made the totals jump.
    const body = [
        { is_processing: false, n_prompt_tokens: 205, n_prompt_tokens_processed: 0 },
        { is_processing: false, n_prompt_tokens: 14, n_prompt_tokens_processed: 14 },
        { is_processing: true, n_prompt_tokens: 500, n_prompt_tokens_processed: 496,
          next_token: [{ n_decoded: 10, n_remain: 90 }] },
        { is_processing: true, n_prompt_tokens: 500, n_prompt_tokens_processed: 500,
          next_token: [{ n_decoded: 5, n_remain: 95 }] }
    ];
    assert.deepStrictEqual(parseSlotActivity(body), { phase: "generating", slots: 2, decoded: 15, remain: 185 });
});

test("parseSlotActivity prefers the prompt phase while any slot is still reading", () => {
    const body = [
        { is_processing: true, n_prompt_tokens: 800, n_prompt_tokens_processed: 320, next_token: [{ n_decoded: 0 }] },
        { is_processing: true, n_prompt_tokens: 100, n_prompt_tokens_processed: 100, next_token: [{ n_decoded: 20, n_remain: 10 }] }
    ];
    assert.deepStrictEqual(parseSlotActivity(body),
        { phase: "prompt", slots: 1, promptTokens: 800, promptProcessed: 320 });
});

test("parseSlotActivity returns null when nothing is processing", () => {
    assert.strictEqual(parseSlotActivity([{ is_processing: false, n_prompt_tokens: 205 }]), null);
    assert.strictEqual(parseSlotActivity([]), null);
    assert.strictEqual(parseSlotActivity(null), null);
    assert.strictEqual(parseSlotActivity({ error: "model name is missing" }), null);
});

test("selectModelStatus picks the serving entry when the router lists a file twice", () => {
    // Exactly what the router reports: the auto-discovered twin of the target sits at
    // "unloaded" forever, while the preset-named entry is the one that actually loads.
    const list = parseModelStatuses({
        data: [
            { id: "qwen35-4b-dflash-Q8_0", status: { value: "unloaded" } },
            { id: "qwen35-4b-paperwitch-q8", status: { value: "unloaded" } },
            { id: "qwen35-4b-paperwitch-q8.gguf", status: { value: "loading" } }
        ]
    });
    assert.strictEqual(selectModelStatus(list, "qwen35-4b-paperwitch-q8.gguf").status, "loading");
    // The draft is never a target, so asking for it must not fall back to the target either.
    assert.strictEqual(selectModelStatus(list, "qwen35-4b-dflash-Q8_0.gguf").status, "unloaded");
});

test("selectModelStatus prefers the loaded state over an idle duplicate", () => {
    const list = [
        { id: "m", status: "unloaded" },
        { id: "m.gguf", status: "loaded" }
    ];
    assert.strictEqual(selectModelStatus(list, "m.gguf").id, "m.gguf");
    // Reversed order, same answer.
    assert.strictEqual(selectModelStatus(list.slice().reverse(), "m.gguf").id, "m.gguf");
});

// Regression: the registry's model id is normally the stem (no ".gguf"), while the router's
// preset entry carries the extension. Matching only against the query's own stem missed the
// loaded ".gguf" twin entirely in that case and returned the auto-discovered twin sitting at
// "unloaded", so a busy model was reported as unloaded and the status window showed a stale
// "loading into memory..." during generation.
test("selectModelStatus finds the loaded twin when the id has no extension", () => {
    const list = [
        { id: "gemma-4-26B-A4B-it-uncensored-apex-quality", status: "unloaded" },
        { id: "gemma-4-26B-A4B-it-uncensored-apex-quality.gguf", status: "loaded" }
    ];
    const stemQuery = selectModelStatus(list, "gemma-4-26B-A4B-it-uncensored-apex-quality");
    assert.strictEqual(stemQuery.id, "gemma-4-26B-A4B-it-uncensored-apex-quality.gguf");
    assert.strictEqual(stemQuery.status, "loaded");
    // Order must not matter, and the extension query must reach the same answer.
    assert.strictEqual(selectModelStatus(list.slice().reverse(), "gemma-4-26B-A4B-it-uncensored-apex-quality").status, "loaded");
    assert.strictEqual(selectModelStatus(list, "gemma-4-26B-A4B-it-uncensored-apex-quality.gguf").status, "loaded");
});

test("selectModelStatus still matches when only the stem form exists", () => {
    const list = [{ id: "m", status: "loading" }];
    assert.strictEqual(selectModelStatus(list, "m.gguf").status, "loading");
    assert.strictEqual(selectModelStatus(list, "m").status, "loading");
});

test("selectModelStatus never matches an unrelated model", () => {
    const list = [{ id: "qwen35-4b-paperwitch-q8", status: "loaded" }];
    assert.strictEqual(selectModelStatus(list, "gemma-4-26B-A4B-it.gguf"), null);
    assert.strictEqual(selectModelStatus(list, "other"), null);
    assert.strictEqual(selectModelStatus(list, null), null);
    assert.strictEqual(selectModelStatus(null, "m"), null);
});

test("selectModelStatus prefers the exact id when the states tie", () => {
    const list = [
        { id: "m", status: "unloaded" },
        { id: "m.gguf", status: "unloaded" }
    ];
    assert.strictEqual(selectModelStatus(list, "m.gguf").id, "m.gguf");
    assert.strictEqual(selectModelStatus(list, "m").id, "m");
});

test("selectModelStatus matches by name without the extension", () => {
    const list = [{ id: "m", status: "loaded" }];
    assert.strictEqual(selectModelStatus(list, "m.gguf").status, "loaded");
});

test("selectModelStatus returns null when nothing matches", () => {
    assert.strictEqual(selectModelStatus([{ id: "other", status: "loaded" }], "m.gguf"), null);
    assert.strictEqual(selectModelStatus([], "m.gguf"), null);
    assert.strictEqual(selectModelStatus(null, "m.gguf"), null);
    assert.strictEqual(selectModelStatus([{ id: "m", status: "loaded" }], null), null);
    assert.strictEqual(selectModelStatus([{ id: "m", status: "loaded" }], ""), null);
});
