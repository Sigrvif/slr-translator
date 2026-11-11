// www/core/llmRuntime/lib/ReasoningCaps.js
//
// What a served model can do about reasoning, and how to ask for reasoning in the shape that model
// accepts. Pure: everything comes from the model's own /props document — the capability flags it
// advertises and the effort values its own template validates against. Nothing here knows a model
// family; a family name is never consulted.
"use strict";

// The template validator is plain Jinja. Read the literal list it compares the effort variable
// against, and only when the shape is unambiguous; anything else yields null, which the caller treats
// as "supported, accepted values unknown" and covers with its retry.
function parseEfforts(template) {
    if (typeof template !== "string" || !template) return null;
    const guard = /reasoning_effort\s+not\s+in\s*\(([^)]*)\)/.exec(template);
    if (!guard) return null;
    const out = [];
    const parts = guard[1].split(",");
    for (const part of parts) {
        // An empty entry (a trailing comma, or the whitespace around the list) is not a value and
        // carries no information; skip it. Any other entry that has no quoted match cannot be read
        // as a value, so the list is not unambiguous and the whole thing yields null rather than a
        // partial one: a partial list would drop a tier the model actually accepts locally.
        if (!part.trim()) continue;
        const raw = /['"]([^'"]*)['"]/.exec(part);
        if (!raw) return null;
        // A quoted entry that is not a plain value name means the list cannot be read reliably.
        // Yield null for the whole list rather than a partial one, so the caller does not drop a
        // tier the model actually accepts on the strength of a guess.
        if (!/^[a-z_]+$/i.test(raw[1])) return null;
        out.push(raw[1]);
    }
    return out.length ? out : null;
}

function fromProps(props) {
    const p = (props && typeof props === "object") ? props : {};
    const caps = (p.chat_template_caps && typeof p.chat_template_caps === "object") ? p.chat_template_caps : {};
    return {
        supportsEffort: caps.supports_reasoning_effort === true,
        supportsPreserve: caps.supports_preserve_reasoning === true,
        efforts: caps.supports_reasoning_effort === true ? parseEfforts(p.chat_template) : null
    };
}

// Does this request ask for reasoning at all?
function asksForReasoning(body) {
    if (typeof body.reasoning_effort === "string" && body.reasoning_effort !== "" &&
        body.reasoning_effort !== "none") return true;
    if (body.thinking && typeof body.thinking === "object" && body.thinking.type === "enabled") return true;
    if (body.generationConfig && typeof body.generationConfig === "object" &&
        body.generationConfig.thinkingConfig && typeof body.generationConfig.thinkingConfig === "object") return true;
    if (body.chat_template_kwargs && typeof body.chat_template_kwargs === "object" &&
        body.chat_template_kwargs.enable_thinking === true) return true;
    return false;
}

// Does this request explicitly refuse reasoning? A refusal always wins: a caller must never be given
// reasoning it tried to prevent.
function refusesReasoning(body) {
    if (body.reasoning_effort === "none") return true;
    if (body.thinking && typeof body.thinking === "object" && body.thinking.type === "disabled") return true;
    if (body.chat_template_kwargs && typeof body.chat_template_kwargs === "object" &&
        body.chat_template_kwargs.enable_thinking === false) return true;
    return false;
}

// Returns { body, changed, droppedEffort }. The body is only ever replaced when something must change;
// otherwise the original object is returned untouched so a silent request stays byte-identical.
function normalizeReasoning(body, caps) {
    const out = { body: body, changed: false, droppedEffort: false };
    if (!body || typeof body !== "object" || Array.isArray(body)) return out;
    if (!asksForReasoning(body)) return out;
    if (refusesReasoning(body)) return out;
    const c = caps || {};
    const next = Object.assign({}, body);
    // The one channel every reasoning-capable template reads, and the channel the server honours as a
    // per-request override of its own default.
    const kwargs = Object.assign({}, next.chat_template_kwargs || {});
    kwargs.enable_thinking = true;
    next.chat_template_kwargs = kwargs;
    if (typeof next.reasoning_effort === "string" && next.reasoning_effort !== "") {
        const accepted = Array.isArray(c.efforts) ? c.efforts : null;
        const send = c.supportsEffort === true && (accepted === null || accepted.indexOf(next.reasoning_effort) !== -1);
        if (!send) {
            delete next.reasoning_effort;
            out.droppedEffort = true;
        }
    }
    out.body = next;
    out.changed = true;
    return out;
}

module.exports = { fromProps, normalizeReasoning, asksForReasoning, refusesReasoning, parseEfforts };