"use strict";

function createRouterClient({ http, baseUrl }) {
    if (!http) throw new Error("RouterClient needs an http adapter with get/post");
    const base = String(baseUrl).replace(/\/+$/, "");
    return {
        health() {
            return http.get(`${base}/health`);
        },
        async listModels() {
            const res = await http.get(`${base}/v1/models`);
            const data = res && res.body && res.body.data;
            return Array.isArray(data) ? data.map((m) => m.id) : [];
        },
        props(modelId) {
            const url = modelId
                ? `${base}/props?model=${encodeURIComponent(modelId)}`
                : `${base}/props`;
            return http.get(url).then((res) => res.body);
        },
        // Router-level model list, which (unlike /v1/models) carries each model's load
        // state: "unloaded", "loading" or "loaded". Used for load progress.
        modelStatuses() {
            return http.get(`${base}/models`).then((res) => res.body);
        },
        // Per-slot state. Carries n_prompt_tokens / n_prompt_tokens_processed, which is the
        // only real prompt-processing percentage the server exposes. A multi-model router
        // requires the model name.
        slots(modelId) {
            const url = modelId
                ? `${base}/slots?model=${encodeURIComponent(modelId)}`
                : `${base}/slots`;
            return http.get(url).then((res) => res.body);
        },
        // Prometheus metrics. A multi-model router can require a model name, so a
        // caller with an id should pass it; the caller retries with the id if a
        // model-less request comes back 400 "model name is missing".
        metrics(modelId) {
            const url = modelId
                ? `${base}/metrics?model=${encodeURIComponent(modelId)}`
                : `${base}/metrics`;
            return http.get(url);
        },
        chat(body) {
            return http.post(`${base}/v1/chat/completions`, body);
        }
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(client, opts) {
    const options = opts || {};
    const timeoutMs = options.timeoutMs === undefined ? 120000 : options.timeoutMs;
    const intervalMs = options.intervalMs === undefined ? 250 : options.intervalMs;
    const sleep = options.sleep || delay;
    const now = options.now || Date.now;
    const deadline = now() + timeoutMs;
    let last = null;
    while (now() <= deadline) {
        try {
            last = await client.health();
            if (last && last.status === 200) return last;
        } catch (err) {
            last = { error: String((err && err.message) || err) };
        }
        await sleep(intervalMs);
    }
    throw new Error(
        `llama-server did not become healthy within ${timeoutMs} ms (last: ${JSON.stringify(last)})`
    );
}

const SPEC_METRIC_NAMES = {
    "llamacpp:spec_decode_num_draft_tokens_total": "draftTokens",
    "llamacpp:spec_decode_num_accepted_tokens_total": "acceptedTokens",
    "llamacpp:spec_decode_num_drafts_total": "drafts"
};

// Throughput and prompt-cache counters, read from the same exposition. The two gauges are
// already in tokens per second; the counters allow an average to be computed over a run.
const RUNTIME_METRIC_NAMES = {
    "llamacpp:prompt_tokens_total": "promptTokens",
    "llamacpp:prompt_tokens_cached_total": "promptTokensCached",
    "llamacpp:prompt_seconds_total": "promptSeconds",
    "llamacpp:tokens_predicted_total": "predictedTokens",
    "llamacpp:tokens_predicted_seconds_total": "predictedSeconds",
    "llamacpp:prompt_tokens_seconds": "promptTokensPerSecond",
    "llamacpp:predicted_tokens_seconds": "predictedTokensPerSecond"
};

// Pull the named series out of a Prometheus text exposition. Returns { found, any }.
function parseExposition(text, names) {
    const found = {};
    let any = false;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.charAt(0) === "#") continue;
        const m = /^([^\s{]+)(?:\{[^}]*\})?\s+([^\s]+)/.exec(line);
        if (!m) continue;
        const key = names[m[1]];
        if (!key) continue;
        const value = Number(m[2]);
        if (!isFinite(value)) continue;
        found[key] = value;
        any = true;
    }
    return { found, any };
}

// Parse the Prometheus text exposition for the speculative-decoding counters. Returns
// null when none of the counters are present (metrics disabled or not a speculative
// run). `acceptance` is acceptedTokens / draftTokens, or 0 when no draft tokens were
// counted yet.
function parseSpecMetrics(text) {
    if (text === null || text === undefined) return null;
    const { found, any } = parseExposition(text, SPEC_METRIC_NAMES);
    if (!any) return null;
    const draftTokens = found.draftTokens || 0;
    const acceptedTokens = found.acceptedTokens || 0;
    const drafts = found.drafts || 0;
    return {
        draftTokens,
        acceptedTokens,
        drafts,
        acceptance: draftTokens > 0 ? acceptedTokens / draftTokens : 0
    };
}

// Parse the throughput / prompt-cache counters. Returns null when the exposition carries
// none of them (metrics disabled, or the server is not running). `cacheReuse` is the
// fraction of prompt tokens served from the cache across the whole run, which is the
// number that shows whether prefix caching is actually paying off.
function parseRuntimeMetrics(text) {
    if (text === null || text === undefined) return null;
    const { found, any } = parseExposition(text, RUNTIME_METRIC_NAMES);
    if (!any) return null;
    const promptTokens = found.promptTokens || 0;
    const promptTokensCached = found.promptTokensCached || 0;
    return {
        promptTokens,
        promptTokensCached,
        promptSeconds: found.promptSeconds || 0,
        predictedTokens: found.predictedTokens || 0,
        predictedSeconds: found.predictedSeconds || 0,
        promptTokensPerSecond: found.promptTokensPerSecond || 0,
        predictedTokensPerSecond: found.predictedTokensPerSecond || 0,
        cacheReuse: promptTokens > 0 ? promptTokensCached / promptTokens : 0
    };
}

// Load state of every model the router knows, from /models. Returns [] for any unexpected
// shape so a caller can treat "no information" and "no models" the same way.
function parseModelStatuses(body) {
    const data = body && body.data;
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const entry of data) {
        if (!entry || typeof entry !== "object") continue;
        const id = entry.id || (entry.name || null);
        if (!id) continue;
        out.push({ id: id, status: (entry.status && entry.status.value) || "unknown" });
    }
    return out;
}

// What the server is doing right now, from /slots.
//
// The build reports prompt progress on ordinary prompts: while a prompt is being read,
// n_prompt_tokens_processed climbs towards n_prompt_tokens (measured: 22/26 partway through a
// short prompt), and it also advances on a long prompt in coarse steps. So the prefill vs
// generation phase must be decided by whether the prompt has been finished, not by testing for
// an exact zero: requiring processed === 0 misreported an in-progress prefill as the
// generation phase, which then showed "Generating: 0 tokens" while the model was still
// reading the prompt.
//
// A slot counts as generating once its prompt is fully processed and it is still busy. The
// numbers reported are then the real ones:
//   - prompt phase : processed / total, which is a true percentage
//   - generating   : next_token[0].n_decoded / n_remain, which count up properly
// Idle slots are skipped entirely: they keep their previous counts and would otherwise be
// summed in, which is what made the totals jump between refreshes.
function parseSlotActivity(body) {
    const list = Array.isArray(body) ? body : null;
    if (!list) return null;
    let busy = 0;
    let prefilling = 0;
    let promptTokens = 0;
    let promptProcessed = 0;
    let decoded = 0;
    let remain = 0;
    for (const slot of list) {
        if (!slot || typeof slot !== "object") continue;
        if (slot.is_processing !== true) continue;
        busy++;
        const prompt = Number(slot.n_prompt_tokens) || 0;
        const processed = Number(slot.n_prompt_tokens_processed) || 0;
        const next = Array.isArray(slot.next_token) ? slot.next_token[0] : null;
        const slotDecoded = next ? (Number(next.n_decoded) || 0) : 0;
        // Still reading the prompt: the prompt has been sized but not finished, and no token
        // has been decoded from it yet.
        if (prompt > 0 && processed < prompt && slotDecoded === 0) {
            prefilling++;
            promptTokens += prompt;
            promptProcessed += processed;
            continue;
        }
        decoded += slotDecoded;
        remain += next ? (Number(next.n_remain) || 0) : 0;
    }
    if (busy === 0) return null;
    if (prefilling > 0) {
        return { phase: "prompt", slots: prefilling, promptTokens, promptProcessed };
    }
    return { phase: "generating", slots: busy, decoded, remain };
}

// Pick the entry that actually describes the model we asked about. The router lists a file
// twice when it is both auto-discovered in the models dir and named by a preset section: once
// as "<name>" and once as "<name>.gguf". Only the preset entry ever loads, while the
// auto-discovered twin sits at "unloaded" forever - so matching on the first id that fits
// reports a busy model as unloaded. The most-loaded state wins, and an exact id beats the
// name-without-extension match on a tie.
const MODEL_STATUS_RANK = { loaded: 3, loading: 2, unloaded: 1 };

function selectModelStatus(list, id) {
    if (!id || !Array.isArray(list)) return null;
    const q = String(id);
    const stem = q.replace(/\.gguf$/i, "");
    let best = null;
    for (const entry of list) {
        if (!entry || typeof entry.id !== "string") continue;
        // The query can arrive in either shape (the registry id is usually the stem, the
        // router's preset entry carries ".gguf"), so a match is any entry whose id is the
        // query, the query with ".gguf", or the query without it. Comparing only against the
        // query's own stem missed the loaded ".gguf" twin entirely whenever the query was the
        // stem form, which is the common case.
        const entryStem = entry.id.replace(/\.gguf$/i, "");
        const isExact = entry.id === q;
        if (!isExact && entryStem !== stem) continue;
        if (!best) { best = entry; continue; }
        const rank = MODEL_STATUS_RANK[entry.status] || 0;
        const bestRank = MODEL_STATUS_RANK[best.status] || 0;
        const bestIsExact = best.id === q;
        if (rank > bestRank || (rank === bestRank && isExact && !bestIsExact)) best = entry;
    }
    return best;
}

module.exports = { createRouterClient, waitForHealth, parseSpecMetrics, parseRuntimeMetrics, parseModelStatuses, parseSlotActivity, selectModelStatus };
