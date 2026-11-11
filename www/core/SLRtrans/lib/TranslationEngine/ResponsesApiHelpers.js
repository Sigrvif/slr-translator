"use strict";
// Pure + runtime helpers for the OpenAI/DeepSeek "Responses API"
// (endpoint path ends in /responses, e.g. https://host/v1/responses).
//
// The DSLR engine and glossary extractor both build chat-completion requests and
// reduce every response (stream or not) to a chat-completion-shaped object:
//     { choices: [{ message: { content, reasoning_content? }, finish_reason }], usage? }
// These helpers let a /responses endpoint slot into that pipeline without changes
// to any downstream (retry-context assembly, JSON-batch validation, content
// extraction, token-progress UI): the request body is transformed to the
// Responses shape before the fetch, and the response is normalized back to the
// chat-completion shape after.
//
// The pure functions (isResponsesApiUrl, toResponsesBody, reduceResponsesEvent,
// normalizeResponsesResult, toChatShape and the _helpers) reference no host
// globals, so they can be unit-tested in plain Node exactly like EndpointHelpers.
// Only streamResponsesCompletion uses runtime globals (fetch Response body
// reader + TextDecoder), which are available in the nw.js host.
//
// This module is also the home of the shared streaming repetition guard
// (isRepetitiveTail / normalizeRepetitionLimit): the DSLR engine's stream
// reader, the glossary extractor's stream reader and streamResponsesCompletion
// all use it to terminate a response early when the model gets stuck repeating
// itself, instead of letting it generate until it exhausts max_tokens.

// ---------------------------------------------------------------------------
// URL detection
// ---------------------------------------------------------------------------

// True if the URL targets a /responses endpoint (e.g. /v1/responses, /responses,
// with optional trailing slash / query / fragment). Case-insensitive.
function isResponsesApiUrl(url) {
    if (!url) return false;
    return /\/responses(?:\/|\?|#|$)/i.test(String(url));
}

// ---------------------------------------------------------------------------
// Reasoning effort mapping
// ---------------------------------------------------------------------------

// Map the DSLR reasoning-effort enum (minimal/low/medium/high/max) to the Responses
// API effort enum (none/low/high/max). "minimal" maps to "low" (not "none")
// because the caller has explicitly enabled reasoning; "none" is reserved for an
// explicit disable signal (see _deriveEffort).
function _mapEffort(eff) {
    switch (String(eff || "").toLowerCase()) {
        case "minimal": return "low";
        case "low": return "low";
        case "medium": return "high";
        case "high": return "max";
        case "max": return "max";
        default: return "low";
    }
}

// Derive reasoning.effort from a chat-completion body that may carry
// reasoning_effort and/or a thinking object. Returns the effort string to send,
// or null when there is no reasoning signal at all (so the caller can omit the
// reasoning field and let the provider default apply). An explicit
// thinking:{type:"disabled"} (set when Reasoning Format is None) yields
// "none", as does reasoning_effort:"none" (the Ollama/OpenAI-style disable);
// an explicit reasoning request yields a mapped effort. Sending "none"
// is therefore tied to the existing disable-thinking signals, not applied
// unconditionally.
function _deriveEffort(chatBody) {
    if (chatBody && chatBody.reasoning_effort) {
        if (String(chatBody.reasoning_effort).toLowerCase() === "none") return "none";
        return _mapEffort(chatBody.reasoning_effort);
    }
    var thinking = chatBody && chatBody.thinking;
    if (thinking && typeof thinking === "object") {
        if (thinking.type === "enabled") return _mapEffort("low");
        if (thinking.type === "disabled") return "none";
    }
    return null;
}

// ---------------------------------------------------------------------------
// Request body transform
// ---------------------------------------------------------------------------

// Transform a chat-completion request body into a Responses-API request body.
// Only the structural fields are remapped; unsupported samplers are left in
// place (DeepSeek silently ignores unknown top-level params, per their docs).
function toResponsesBody(chatBody) {
    if (!chatBody || typeof chatBody !== "object") return chatBody;
    var out = {};
    out.model = chatBody.model;
    // System/developer messages go into the Responses API 'instructions' field
    // (its canonical system-prompt slot), and the remaining (user/assistant)
    // messages become the 'input' item list. This is required because some
    // /responses backends (e.g. Ollama behind proxies) only honor
    // reasoning.effort:"none" when the system prompt is supplied via
    // 'instructions'; delivering it as a system-role input item makes them
    // reason anyway.
    var sysParts = [];
    var inputItems = [];
    if (Array.isArray(chatBody.messages)) {
        for (var mi = 0; mi < chatBody.messages.length; mi++) {
            var m = chatBody.messages[mi];
            if (m && (m.role === "system" || m.role === "developer")) {
                if (typeof m.content === "string" && m.content !== "") sysParts.push(m.content);
            } else {
                inputItems.push(m);
            }
        }
    }
    if (sysParts.length > 0) out.instructions = sysParts.join("\n\n");
    out.input = inputItems;
    // Always send an explicit 'stream' value (never omit it): some backends
    // default to streaming (and then ignore reasoning.effort) when 'stream' is
    // absent. Honor the caller's stream flag (true when token-progress streaming
    // is active, false otherwise). stream_options is unsupported here and is
    // dropped below.
    out.stream = (chatBody.stream === true);
    if (chatBody.temperature !== undefined && chatBody.temperature !== null) out.temperature = chatBody.temperature;
    if (chatBody.top_p !== undefined && chatBody.top_p !== null) out.top_p = chatBody.top_p;
    if (chatBody.max_tokens !== undefined && chatBody.max_tokens !== null) out.max_output_tokens = chatBody.max_tokens;
    if (chatBody.response_format) {
        out.text = { format: chatBody.response_format };
    }
    var effort = _deriveEffort(chatBody);
    if (effort !== null) {
        out.reasoning = { effort: effort };
    }
    // Pass through any remaining params (custom params, samplers, etc.). Drop
    // the chat-only fields that have been remapped or are unsupported here.
    var drop = {
        model: true, messages: true, stream: true, temperature: true, top_p: true,
        max_tokens: true, response_format: true, thinking: true, reasoning_effort: true,
        stream_options: true
    };
    for (var key in chatBody) {
        if (!Object.prototype.hasOwnProperty.call(chatBody, key)) continue;
        if (drop[key]) continue;
        out[key] = chatBody[key];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Response normalization (shared by stream + non-stream)
// ---------------------------------------------------------------------------

function _newState() {
    return { content: "", reasoning: "", finishReason: null, usage: null, tokenCount: 0, failed: null };
}

function _extractText(item) {
    if (!item) return "";
    if (typeof item.content === "string") return item.content;
    if (Array.isArray(item.content)) {
        var s = "";
        for (var j = 0; j < item.content.length; j++) {
            var c = item.content[j];
            if (c && typeof c.text === "string") s += c.text;
        }
        return s;
    }
    return "";
}

// Absorb a Responses usage object into state.usage, normalizing field names to
// the chat-completion usage shape downstream expects.
function _absorbUsage(state, obj) {
    if (!obj || !obj.usage) return;
    var u = obj.usage;
    var completion = (u.output_tokens != null) ? u.output_tokens : ((u.completion_tokens != null) ? u.completion_tokens : 0);
    var prompt = (u.input_tokens != null) ? u.input_tokens : ((u.prompt_tokens != null) ? u.prompt_tokens : 0);
    var total = (u.total_tokens != null) ? u.total_tokens : (prompt + completion);
    state.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

// Extract the authoritative full content/reasoning from a Responses response
// object (carried by response.completed / response.incomplete, or a non-stream
// body). Only overwrites the accumulator when content is actually present, so
// incrementally-accumulated deltas remain as a fallback for endpoints that do
// not echo the full text in the completion event.
function _absorbContentFromResponse(state, obj) {
    if (!obj || typeof obj !== "object") return;
    var content = null;
    var reasoning = "";
    if (typeof obj.output_text === "string") {
        content = obj.output_text;
    } else if (Array.isArray(obj.output)) {
        var c = "";
        for (var i = 0; i < obj.output.length; i++) {
            var item = obj.output[i];
            if (!item) continue;
            if (item.type === "reasoning" || item.role === "reasoning") {
                reasoning += _extractText(item);
            } else {
                c += _extractText(item);
            }
        }
        content = c;
    }
    // Fallback: some proxies/bridges return chat-completion shape (choices) even
    // on a /responses endpoint. Pull content from there when Responses fields
    // (output_text / output[]) are absent.
    if ((content == null || content === "") && Array.isArray(obj.choices)) {
        var ch = obj.choices[0];
        if (ch) {
            var part = ch.message || ch.delta;
            if (part) {
                if (typeof part.content === "string") content = (content || "") + part.content;
                if (typeof part.reasoning_content === "string") reasoning += part.reasoning_content;
            }
        }
    }
    if (content != null && content !== "") state.content = content;
    if (reasoning !== "") state.reasoning = reasoning;
}

// Pure per-SSE-event reducer. Mutates and returns state.
//   state      - accumulator from _newState()
//   eventType  - SSE event name (e.g. "response.output_text.delta") or data.type
//   parsedData - parsed JSON object from the data: line
function reduceResponsesEvent(state, eventType, parsedData) {
    if (!state) state = _newState();
    var et = eventType ? String(eventType) : "";
    var d = parsedData || {};
    if (et === "response.output_text.delta") {
        if (d.delta != null) { state.content += String(d.delta); state.tokenCount++; }
    } else if (et === "response.reasoning_text.delta") {
        if (d.delta != null) { state.reasoning += String(d.delta); state.tokenCount++; }
    } else if (et === "response.output_text.done") {
        if (typeof d.text === "string" && d.text !== "") state.content = d.text;
    } else if (et === "response.reasoning_text.done") {
        if (typeof d.text === "string" && d.text !== "") state.reasoning = d.text;
    } else if (et === "response.completed") {
        state.finishReason = "stop";
        _absorbContentFromResponse(state, d.response || d);
        _absorbUsage(state, d.response || d);
    } else if (et === "response.incomplete") {
        state.finishReason = "length";
        _absorbContentFromResponse(state, d.response || d);
        _absorbUsage(state, d.response || d);
    } else if (et === "response.failed") {
        state.finishReason = "error";
        var err = (d.response && d.response.error) || d.error || d;
        state.failed = (err && (err.message || JSON.stringify(err))) || "Responses API response.failed";
        _absorbUsage(state, d.response || d);
    }
    // Fallback: chat-completion-shaped stream chunks (some proxies/bridges emit
    // these even on a /responses endpoint). Activates only when the data carries
    // a choices array, so genuine Responses events are unaffected.
    if (Array.isArray(d.choices)) {
        var cc = d.choices[0];
        if (cc) {
            var cpart = cc.delta || cc.message;
            if (cpart) {
                if (cpart.content != null) { state.content += String(cpart.content); state.tokenCount++; }
                if (cpart.reasoning_content != null) state.reasoning += String(cpart.reasoning_content);
            }
            if (cc.finish_reason && !state.finishReason) state.finishReason = cc.finish_reason;
        }
        if (d.usage) _absorbUsage(state, d);
    }
    return state;
}

// Build the chat-completion-shaped result that downstream DSLR code expects.
// repetition_loop is set when the streaming repetition guard terminated the
// response early (informational; the finish reason is already "length").
function toChatShape(state) {
    var message = { content: state.content || "" };
    if (state.reasoning) message.reasoning_content = state.reasoning;
    var result = { choices: [{ index: 0, message: message, finish_reason: state.finishReason || "stop" }] };
    if (state.usage) result.usage = state.usage;
    if (state.failed) result.error = state.failed;
    if (state.repetitionLoop) result.repetition_loop = true;
    if (state.repetitionReason) result.repetition_loop_reason = state.repetitionReason;
    return result;
}

// Normalize a parsed non-stream Responses object into the chat-completion shape.
function normalizeResponsesResult(parsed) {
    var state = _newState();
    if (!parsed || typeof parsed !== "object") return toChatShape(state);
    _absorbContentFromResponse(state, parsed);
    if (parsed.status === "incomplete") state.finishReason = "length";
    else if (parsed.status === "failed") {
        state.finishReason = "error";
        if (parsed.error) state.failed = parsed.error.message || JSON.stringify(parsed.error);
    } else {
        state.finishReason = "stop";
    }
    _absorbUsage(state, parsed);
    return toChatShape(state);
}

// Parse a raw /responses body that may be EITHER a single JSON object OR an SSE
// event stream (some proxies stream even when stream:false was requested).
// Returns the normalized chat-completion shape.
function parseResponsesText(rawText) {
    if (typeof rawText !== "string" || rawText === "") {
        return normalizeResponsesResult(null);
    }
    // Detect an SSE stream: presence of "data:" or an "event:" line.
    if (rawText.indexOf("data:") !== -1 || /^event:/m.test(rawText)) {
        var state = _newState();
        var lines = rawText.split(/\r?\n/);
        var pendingEvent = null;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, "");
            if (line === "") { pendingEvent = null; continue; }
            if (line.charAt(0) === ":") continue;
            var colon = line.indexOf(":");
            if (colon === -1) continue;
            var field = line.slice(0, colon).trim();
            var value = line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") {
                pendingEvent = value;
            } else if (field === "data") {
                if (value === "[DONE]") continue;
                var parsed;
                try { parsed = JSON.parse(value); } catch (e) { continue; }
                var et = pendingEvent || (parsed && parsed.type) || "";
                reduceResponsesEvent(state, et, parsed);
            }
        }
        if (state.usage && state.usage.completion_tokens != null) state.tokenCount = state.usage.completion_tokens;
        return toChatShape(state);
    }
    // Single JSON object.
    var obj;
    try { obj = JSON.parse(rawText); } catch (e) { obj = null; }
    return normalizeResponsesResult(obj);
}

// ---------------------------------------------------------------------------
// Streaming repetition guard (shared by the DSLR engine + glossary extractor)
// ---------------------------------------------------------------------------

// Longest repeating unit (in characters) the guard classifies as a loop.
// Covers repeated letters, words, sentences, whole entries/lines (e.g. the
// same term definition over and over during glossary generation), AND whole
// blocks of DISTINCT entries cycled as a group (a model stuck in a loop often
// repeats a 10-20 entry glossary block, which is a period of several thousand
// characters, not a single entry). Units longer than this are treated as
// legitimate content.
var REPETITION_MAX_UNIT_CHARS = 10000;

// Units at least this long count as "entry-sized" (a full glossary entry, a full
// batch section, a JSON entry): structured content that can never legitimately
// repeat back to back, so it fires after far fewer repeats than sounds/words.
var REPETITION_ENTRY_MIN_CHARS = 60;
// Factory-default thresholds for the three customizable tiers.
var REPETITION_DEFAULT_CHAR_LIMIT = 20;
var REPETITION_DEFAULT_WORD_LIMIT = 15;
var REPETITION_DEFAULT_ENTRY_LIMIT = 4;

// Normalize a user-configured repetition threshold into an integer limit.
// Missing/unparseable values ("" counts as missing, so an empty option field
// falls back to the factory default instead of disabling) return `fallback`;
// values below 2 (0, 1, negatives) return 0, meaning that tier is disabled.
function normalizeRepetitionLimit(value, fallback) {
    if (value === null || value === undefined || value === "") {
        return (fallback === undefined) ? 0 : fallback;
    }
    var n = Math.floor(Number(value));
    if (!isFinite(n) || n < 0) return (fallback === undefined) ? 0 : fallback;
    if (n < 2) return 0;
    return n;
}

// Resolve the full repetition-guard configuration. Accepts either a plain
// threshold (number/string -> both char and word tier, entry tier off; legacy
// callers only) or an object:
//   { charLimit?, wordLimit?|limit?, entryMinChars?, entryLimit?, inspect? }
// The three tiers are independently customizable and independently disableable
// (0 or 1 turns a tier off):
//   charLimit  - single-character units ("Ahhhhhh...", "………"), default 20
//   wordLimit  - word/phrase/sentence-sized units, default 15 (legacy field
//                name `limit` is accepted as an alias)
//   entryLimit - entry-sized units (>= entryMinChars) AND duplicated response
//                ids (the inspect callback), default 4
// entryMinChars defaults to REPETITION_ENTRY_MIN_CHARS when entryLimit is on.
// `inspect` is an optional callback inspect(content) -> string|truthy reporting
// structural duplication; a truthy return terminates the response like a
// repetition loop, using the returned string as the human-readable reason.
function resolveRepetitionConfig(value, fallbackLimit) {
    var cfg = { charLimit: 0, wordLimit: 0, entryMinChars: 0, entryLimit: 0, inspect: null, active: false };
    var _def = function (v, def) {
        return (v === undefined || v === null || v === "") ? def : normalizeRepetitionLimit(v, def);
    };
    if (value && typeof value === "object") {
        cfg.charLimit = _def(value.charLimit, REPETITION_DEFAULT_CHAR_LIMIT);
        cfg.wordLimit = _def(value.wordLimit !== undefined ? value.wordLimit : value.limit, REPETITION_DEFAULT_WORD_LIMIT);
        cfg.entryLimit = _def(value.entryLimit, REPETITION_DEFAULT_ENTRY_LIMIT);
        var emc = _def(value.entryMinChars, REPETITION_ENTRY_MIN_CHARS);
        // The entry/word size boundary exists only while the entries tier is on:
        // with entryLimit 0 the tier is disabled and long units (e.g. whole
        // sentences) fall back to the word/sentence tier.
        if (cfg.entryLimit >= 2 && emc >= 1) {
            cfg.entryMinChars = emc;
        } else {
            cfg.entryLimit = 0;
            cfg.entryMinChars = 0;
        }
        if (typeof value.inspect === "function") cfg.inspect = value.inspect;
    } else {
        var n = normalizeRepetitionLimit(value, fallbackLimit);
        cfg.charLimit = n;
        cfg.wordLimit = n;
    }
    // `inspect` is a detector in its own right (duplicated batch ids, repeated
    // review content): a config carrying one must stay active even when every
    // size tier is disabled, otherwise its callback is silently never called.
    cfg.active = cfg.charLimit >= 2 || cfg.wordLimit >= 2 || cfg.entryLimit >= 2 ||
        typeof cfg.inspect === "function";
    return cfg;
}

// True when `text` ends with the same unit repeated back to back more times
// than its tier allows. Tiers are chosen by unit size and each is separately
// customizable/disableable:
//   - single-character units ("Ahhhhhh...", "………")       -> charLimit
//   - word/phrase/sentence-sized units ("Ah Ah Ah Ah...") -> wordLimit
//   - entry-sized units (>= entryMinChars: full glossary
//     entries, batch sections, JSON entries, blocks of
//     entries cycled as a group)                          -> entryLimit
// Implemented as tail periodicity: find the smallest unit length p for which
// the last p * R characters are exactly R copies of the final p characters,
// where R is the repeat count the unit's tier allows. Purely-whitespace units
// are ignored so pretty-printed indentation never triggers the guard.
//
// Returns the repeat threshold that fired (a number >= 2) or false.
// Truthy = repetitive.
//
// Performance: candidates p are rejected by cheap positional char samples
// first (a true period forces the same character at n-1-k*p for every k),
// so only a handful of candidates per call ever reach the slice-based full
// verification, even with the 10000-char unit cap and a check on every
// streamed chunk.
function isRepetitiveTail(text, charLimit, wordLimit, entryMinChars, entryLimit) {
    if (!text || typeof text !== "string") return false;
    var _lim = function (v) {
        v = Math.floor(Number(v) || 0);
        return (isFinite(v) && v >= 2) ? v : 0;
    };
    var cLim = _lim(charLimit);
    var wLim = _lim(wordLimit);
    var eLim = _lim(entryLimit);
    var eMin = Math.floor(Number(entryMinChars) || 0);
    // The entry/word size boundary (entryMinChars) exists only while the entries
    // tier is on: with the tier disabled, long units (e.g. whole sentences) are
    // judged by the word/sentence tier instead.
    if (eMin < 1 || eLim < 2) { eMin = 0; eLim = 0; }
    if (cLim < 2 && wLim < 2 && eLim < 2) return false;
    var smallest = Math.min.apply(null, [cLim, wLim, eLim].filter(function (v) { return v >= 2; }));
    var n = text.length;
    if (n < 2) return false;
    var cap = Math.min(REPETITION_MAX_UNIT_CHARS, Math.floor(n / smallest));
    if (cap < 1) return false;
    var last = text.charCodeAt(n - 1);
    for (var p = 1; p <= cap; p++) {
        var need;
        if (eMin && p >= eMin) need = eLim;
        else if (p === 1) need = cLim;
        else need = wLim;
        if (need < 2) continue; // this tier is disabled
        if (n < p * need) continue;
        // How many last-char positions to sample (one per previous unit copy).
        var samples = Math.min(need - 1, 6);
        var ok = true;
        // Sample the final character of each of the previous copies; every
        // position lies inside the verification window (k*p <= (need-1)*p < need*p <= n).
        for (var k = 1; k <= samples; k++) {
            if (text.charCodeAt(n - 1 - k * p) !== last) { ok = false; break; }
        }
        // Small thresholds sample too few positions on their own; add
        // pseudo-random mid-unit pair samples until six samples were taken.
        if (ok && samples < 6) {
            for (var s = samples; s < 6; s++) {
                var j = (s * 2654435761) % p;
                if (text.charCodeAt(n - 1 - j) !== text.charCodeAt(n - 1 - j - p)) { ok = false; break; }
            }
        }
        if (!ok) continue;
        var unit = text.slice(n - p);
        if (/^\s+$/.test(unit)) continue; // whitespace runs: formatting, not a loop
        // Verify the last `need` units are all identical copies.
        var start = n - p * need;
        var periodic = true;
        for (var c = 0; c < need - 1; c++) {
            if (text.slice(start + c * p, start + (c + 1) * p) !== unit) {
                periodic = false;
                break;
            }
        }
        if (!periodic) continue;
        // The window may also be periodic with a SMALLER period d dividing p
        // ("AA" is just "A" repeated). Smaller periods were already judged by
        // their own tier earlier in this loop (possibly disabled or stricter),
        // so a run must only fire at its fundamental period - otherwise e.g. a
        // disabled character tier could be bypassed through 2-character windows.
        var fundamental = true;
        for (var d = 1; d < p; d++) {
            if (p % d !== 0) continue;
            if (unit.slice(d) === unit.slice(0, p - d)) { fundamental = false; break; }
        }
        if (fundamental) return need;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Streaming (runtime: uses fetch Response body reader + TextDecoder)
// ---------------------------------------------------------------------------

// Build the human-readable reason for terminating a response early, or "" when
// no repetition was detected. Shared by all three stream readers (chat, glossary,
// /responses) so DSLR and the glossary extractor log identical phrasing.
function repetitionReason(content, reasoning, cfg) {
    if (!cfg || !cfg.active) return "";
    var describe = function (fired) {
        if (cfg.entryMinChars >= 1 && fired === cfg.entryLimit && fired !== cfg.wordLimit && fired !== cfg.charLimit) {
            return "an entry-sized text block was repeated back to back at least " + fired + " times";
        }
        if (fired === cfg.charLimit && fired !== cfg.wordLimit) {
            return "a single character was repeated back to back at least " + fired + " times";
        }
        return "the same text was repeated back to back at least " + fired + " times";
    };
    if (content) {
        var fired = isRepetitiveTail(content, cfg.charLimit, cfg.wordLimit, cfg.entryMinChars, cfg.entryLimit);
        if (fired) return describe(fired);
        if (cfg.inspect) {
            var ir = cfg.inspect(content);
            if (ir) return (typeof ir === "string") ? ir : "the response repeated content that may only appear once";
        }
    }
    if (reasoning) {
        var fired2 = isRepetitiveTail(reasoning, cfg.charLimit, cfg.wordLimit, cfg.entryMinChars, cfg.entryLimit);
        if (fired2) return "the model's reasoning repeated itself back to back at least " + fired2 + " times";
    }
    return "";
}

// Read a Responses-API SSE stream and resolve to a chat-completion-shaped
// result. onProgress(tokenCount, content, reasoning) is invoked as tokens arrive
// (content/reasoning are the accumulated texts so far, for live previews),
// mirroring _streamChatCompletion / _streamGlossaryResponse.
//
// repetition (optional; plain threshold or config object, see
// resolveRepetitionConfig): when the accumulated content or reasoning is
// repetitive (or the optional inspect callback reports structural duplication),
// the stream reader is cancelled (terminating the fetch), the finish reason is
// set to "length", and the caller's existing "length" retry handling kicks in
// (which raises the repetition penalty parameters).
async function streamResponsesCompletion(response, onProgress, repetition) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var state = _newState();
    var lastReported = -1;
    var pendingEvent = null;
    var repCfg = resolveRepetitionConfig(repetition, 0);

    var report = function () {
        if (onProgress && state.tokenCount !== lastReported) {
            lastReported = state.tokenCount;
            onProgress(state.tokenCount, state.content, state.reasoning);
        }
    };

    var handleLine = function (line) {
        line = line.replace(/\r$/, "");
        if (line === "") { pendingEvent = null; return; } // event boundary
        if (line.charAt(0) === ":") return;               // comment / keep-alive
        var colon = line.indexOf(":");
        if (colon === -1) return;
        var field = line.slice(0, colon).trim();
        var value = line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") {
            pendingEvent = value;
        } else if (field === "data") {
            if (value === "[DONE]") return;
            var parsed;
            try { parsed = JSON.parse(value); } catch (e) { return; }
            var et = pendingEvent || (parsed && parsed.type) || "";
            reduceResponsesEvent(state, et, parsed);
            report();
        }
    };

    while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        var text = decoder.decode(chunk.value, { stream: true });
        buffer += text;
        var lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) handleLine(lines[i]);
        if (repCfg.active && !state.finishReason) {
            var repReason = repetitionReason(state.content, state.reasoning, repCfg);
            if (repReason) {
                console.error("[DSLR] Excessive repetition detected in the streamed response (" + repReason + "). Terminating the response early; the retry will use an increased repetition penalty.");
                state.finishReason = "length";
                state.repetitionLoop = true;
                state.repetitionReason = repReason;
                try { await reader.cancel(); } catch (e) { /* already closed */ }
                break;
            }
        }
    }
    if (state.repetitionLoop) {
        // Stream was cancelled mid-read: skip the final decoder flush, the tail
        // belongs to the aborted repetition loop anyway.
        report();
        return toChatShape(state);
    }
    var finalText = decoder.decode();
    buffer += finalText;
    if (buffer.length) {
        var tail = buffer.split(/\r?\n/);
        for (var j = 0; j < tail.length; j++) handleLine(tail[j]);
    }

    if (state.usage && state.usage.completion_tokens != null) {
        state.tokenCount = state.usage.completion_tokens;
    }
    report();
    return toChatShape(state);
}

// ---------------------------------------------------------------------------
// Batch-validation id helpers
// ---------------------------------------------------------------------------

// Assistant text of a chat-completion-shaped result (the shape every reader —
// chat completions, streaming, /responses, glossary — normalizes to). Used to
// log what a model had generated when a repetition kill cut a stream short,
// so a terminated response stays diagnosable from the console. Never throws:
// a malformed result yields "".
function chatContentOf(result) {
    try {
        var choice = result && result.choices && result.choices[0];
        var msg = choice && choice.message;
        var content = msg && msg.content;
        return (typeof content === "string") ? content : (content == null ? "" : String(content));
    } catch (e) { return ""; }
}

// Ids emitted more than once in a translation batch response (e.g. a model
// repeating id 21, first as a truncated stub and then correctly). Set-based
// extra/missing checks cannot see these — a duplicated id is a member of the
// original set — so they need their own count-based pass, otherwise the
// duplicate's own defects (order shift, missing quotes on the stub) are
// reported as if they belonged to the real entry. Returns the duplicated ids
// sorted ascending, each listed once; entries without a finite numeric id are
// ignored.
function findDuplicateIds(items) {
    var seen = {};
    var dupes = {};
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i++) {
        var id = list[i] ? list[i].id : undefined;
        if (typeof id !== "number" || !isFinite(id)) continue;
        if (seen[id]) dupes[id] = true;
        else seen[id] = true;
    }
    return Object.keys(dupes).map(Number).sort(function (a, b) { return a - b; });
}

// Ids the batch validator already knows about but tolerated (batch passed):
// leftover-Japanese rows and missing-quote rows within their thresholds.
// The seed review skips these positions — the single-line structural pass
// fixes (or tolerates) them first, and the fixed text re-reviews on the
// first structurally-clean attempt via the normal unreviewed path — instead
// of QC/Judge re-reporting known problems. Only applies when the validation
// passed (clean order means validation ids match batch positions 1:1);
// anything else returns [] (review everything, current behavior).
function validationSeedSkips(result) {
    try {
        if (!result || result.passed !== true) return [];
        var skip = {};
        var groups = result.perLineIssues && result.perLineIssues.perLineIssueGroups;
        var jp = groups && groups.japanese;
        if (Array.isArray(jp)) {
            for (var i = 0; i < jp.length; i++) {
                if (typeof jp[i] === "number" && isFinite(jp[i])) skip[jp[i]] = true;
            }
        }
        var mq = result.commandIssues && result.commandIssues.missingQuotesById;
        if (mq && typeof mq === "object") {
            Object.keys(mq).forEach(function (k) {
                var n = Number(k);
                if (isFinite(n)) skip[n] = true;
            });
        }
        return Object.keys(skip).map(Number).sort(function (a, b) { return a - b; });
    } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Exports (CommonJS for DSLREngine require; global for cross-addon use by the
// glossary extractor, which lives in a different addon folder).
// ---------------------------------------------------------------------------

var ResponsesApiHelpers = {
    isResponsesApiUrl: isResponsesApiUrl,
    toResponsesBody: toResponsesBody,
    reduceResponsesEvent: reduceResponsesEvent,
    normalizeResponsesResult: normalizeResponsesResult,
    parseResponsesText: parseResponsesText,
    toChatShape: toChatShape,
    streamResponsesCompletion: streamResponsesCompletion,
    isRepetitiveTail: isRepetitiveTail,
    normalizeRepetitionLimit: normalizeRepetitionLimit,
    resolveRepetitionConfig: resolveRepetitionConfig,
    repetitionReason: repetitionReason,
    findDuplicateIds: findDuplicateIds,
    validationSeedSkips: validationSeedSkips,
    chatContentOf: chatContentOf
};

module.exports = ResponsesApiHelpers;
try { if (typeof window !== "undefined") window.ResponsesApiHelpers = ResponsesApiHelpers; } catch (e) { /* Node unit tests have no window */ }
