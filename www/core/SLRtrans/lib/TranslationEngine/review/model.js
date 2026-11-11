"use strict";
// Resolve the effective Review endpoint/model settings.
//
// All-or-nothing contract, driven solely by the Review URL:
// - Review URL blank (unset / empty / whitespace-only) -> use the endpoint that
//   translated the batch wholesale. Every Review connection/sampling/limits/
//   display value is ignored.
// - Review URL set -> use ONLY the Review values. Nothing is inherited from the
//   translation endpoint on a per-option basis: a blank Review field means
//   "do not send / default off", never "copy the translation value".
//
// Per-option fallback is intentionally NOT done: it is confusing, it cannot work
// for toggles, and it breaks parameters that must stay empty to be omitted.
// Pure and dependency-free so it can be unit tested without the app.
function isSet(value) {
    return !(value === undefined || value === null || value === "");
}

function isUrlSet(value) {
    if (value === undefined || value === null) return false;
    return String(value).trim() !== "";
}

// batch is the endpoint settings object produced by getEndpointSettings(),
// optionally extended with the global display toggles (enableTokenProgress /
// enableStreamPreview) which are not per-endpoint settings. Only the fields it
// actually exposes can be used for the fallback.
function resolveReviewEndpoint(review, batch) {
    const r = review || {};
    const b = batch || {};
    // Blank Review URL -> the translating endpoint wholesale.
    if (!isUrlSet(r.apiUrl)) {
        return {
            apiUrl: b.apiUrl,
            apiKey: b.apiKey,
            model: b.model,
            doNotFixURL: b.doNotFixURL === true,
            disableStream: b.disableStream === true,
            enableTokenProgress: (b.enableTokenProgress !== undefined)
                ? b.enableTokenProgress !== false : true,
            enableStreamPreview: (b.enableStreamPreview !== undefined)
                ? b.enableStreamPreview !== false : true,
            temperature: b.temperature,
            requestDelay: b.requestDelay,
            top_k: b.top_k,
            top_p: b.top_p,
            min_p: b.min_p,
            repeat_penalty: b.repeat_penalty,
            repetition_penalty: b.repetition_penalty,
            frequency_penalty: b.frequency_penalty,
            presence_penalty: b.presence_penalty,
            maxTokens: b.maxTokens,
            maxContextLength: b.maxContextLength,
            chatTemplateKwargs: b.chat_template_kwargs,
            customHeaders: b.customHeaders,
            customParameters: b.customParameters,
            reasoningFormat: isSet(b.reasoningFormat) ? b.reasoningFormat : "none",
            reasoningEffort: isSet(b.reasoningEffort) ? b.reasoningEffort : "low",
            reasoningBudget: b.reasoningBudget
        };
    }
    // Dedicated Review endpoint -> ONLY Review values, no inheritance.
    return {
        apiUrl: r.apiUrl,
        apiKey: r.apiKey,
        model: r.model,
        doNotFixURL: r.doNotFixURL === true,
        disableStream: r.disableStream === true,
        enableTokenProgress: r.enableTokenProgress !== false,
        enableStreamPreview: r.enableStreamPreview !== false,
        temperature: r.temperature,
        requestDelay: r.requestDelay,
        top_k: isSet(r.topK) ? r.topK : undefined,
        top_p: isSet(r.topP) ? r.topP : undefined,
        min_p: isSet(r.minP) ? r.minP : undefined,
        repeat_penalty: isSet(r.repeatPenalty) ? r.repeatPenalty : undefined,
        repetition_penalty: isSet(r.repetitionPenalty) ? r.repetitionPenalty : undefined,
        frequency_penalty: isSet(r.frequencyPenalty) ? r.frequencyPenalty : undefined,
        presence_penalty: isSet(r.presencePenalty) ? r.presencePenalty : undefined,
        maxTokens: isSet(r.maxTokens) ? r.maxTokens : undefined,
        maxContextLength: isSet(r.maxContextLength) ? r.maxContextLength : undefined,
        chatTemplateKwargs: isSet(r.chatTemplateKwargs) ? r.chatTemplateKwargs : undefined,
        customHeaders: r.customHeaders,
        customParameters: r.customParameters,
        reasoningFormat: isSet(r.reasoningFormat) ? r.reasoningFormat : "none",
        reasoningEffort: isSet(r.reasoningEffort) ? r.reasoningEffort : "low",
        reasoningBudget: r.reasoningBudget
    };
}

// Streaming contract for one review call, mirroring the translation and
// glossary paths: `disableStream` forces stream off; otherwise the live token
// counter drives streaming (`stream: true` + `include_usage` on chat
// completions), and the stream preview is a display-only subset of it.
function reviewStreamFlags(resolved) {
    const r = resolved || {};
    const disabled = r.disableStream === true;
    const progress = !disabled && r.enableTokenProgress !== false;
    return {
        useTokenProgress: progress,
        showPreview: progress && r.enableStreamPreview !== false
    };
}

// Parse a JSON object option value, returning {} on any failure (a malformed
// custom-headers/parameters field must never break a review call).
function parseJsonObject(text) {
    if (!isSet(text)) return {};
    try {
        const v = JSON.parse(text);
        return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
    } catch (e) {
        return {};
    }
}

// How a review HTTP failure should be handled, mirroring the translation path:
// 401/403/404 are configuration/permission errors that will not recover, 429/524
// are transient overload (cooldown + rotate), everything else is an ordinary
// retry (5xx, network, 400, ...).
function classifyReviewFailure(status) {
    const s = (status === undefined || status === null) ? "" : String(status);
    if (/^(401|403|404)$/.test(s)) return "unrecoverable";
    if (/429|524/.test(s)) return "rate-limit";
    return "retry";
}

// Repetition config for review streams, from the engine-wide tier thresholds:
// character + word + paraphrased-loop (skeleton) tiers. Review responses
// carry no structured entries (same rationale as the single-line translation
// path), so the entries tier never applies. Returns 0 (detection off) when
// all tiers are disabled.
function reviewRepetitionConfig(tiers) {
    const FuzzyLoop = require("./fuzzy");
    const t = tiers || {};
    const charLimit = Number(t.charLimit) || 0;
    const wordLimit = Number(t.wordLimit) || 0;
    const skeletonLimit = Math.floor(Number(t.skeletonLimit) || 0);
    if (!(charLimit > 0 || wordLimit > 0 || skeletonLimit >= 2)) return 0;
    const cfg = { charLimit: charLimit, wordLimit: wordLimit, entryLimit: 0 };
    // Repeated-content tier: the same line re-issued, or one row revisited
    // again and again, anywhere in the response (a derailed reviewer working
    // through the same material). Runs through the shared repetition
    // `inspect` hook, so a firing terminates the stream exactly like any
    // other tier. Off below 2.
    if (skeletonLimit >= 2) {
        cfg.skeletonLimit = skeletonLimit;
        cfg.inspect = function (content) { return FuzzyLoop.fuzzyLoopReason(content, skeletonLimit); };
    }
    return cfg;
}

// Downscale the resolved Review max_tokens ceiling by input size, mirroring
// the translation paths: seed reviews (whole batch under review) scale like
// full-batch requests (chars x 1.5, 1000 floor); re-review retries (one row
// under verdict) scale like single-line requests (chars x 3.5, 500 floor so a
// verdict always has room to ramble a bit). An unset/non-positive ceiling
// means "send no max_tokens" (same as before). Unknown modes use seed scaling.
function reviewMaxTokensForInput(ceiling, inputChars, mode) {
    const mt = Number(ceiling);
    if (!(mt > 0) || isNaN(mt)) return undefined;
    const retry = mode === "retry";
    const factor = retry ? 3.5 : 1.5;
    const floor = retry ? 500 : 1000;
    const chars = Number(inputChars) || 0;
    const scaled = chars * factor;
    if (mt > scaled) {
        const down = parseInt(scaled, 10);
        return down < floor ? floor : down;
    }
    return mt;
}

module.exports = { resolveReviewEndpoint, parseJsonObject, isSet, isUrlSet, classifyReviewFailure, reviewStreamFlags, reviewRepetitionConfig, reviewMaxTokensForInput };
