// www/core/docsChat/lib/ChatClient.js
// Minimal OpenAI-compatible chat-completions client for the "Ask DSLR" chat.
// Deliberately self-contained (same patterns as the engine's proven code, but the
// bundled DSLREngine's methods are coupled to translation state and are not reused).
"use strict";

// Normalize an API URL. Mirrors EndpointHelpers.fixApiUrl in
// www/core/SLRtrans/lib/TranslationEngine/EndpointHelpers.js — that file is the
// source of truth; keep this regex chain identical so the chat accepts exactly
// the URLs the engine accepts.
function normalizeUrl(rawUrl, doNotFix) {
    let url = rawUrl == null ? "" : String(rawUrl);
    if (!url) return "";
    if (doNotFix) return url;
    if (!/http/gi.test(url)) {
        url = url.replace(/^h?t?t?p?s?:?\/?\/?(.+)/gi, "https://$1");
    }
    // Responses API endpoint (/responses) is valid as-is; do not append chat/completions.
    if (/\/responses(?:\/|\?|#|$)/i.test(url)) return url;
    if (/\/v\d\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi.test(url) &&
        !/\/v\d\/chat\/completions$|\/v\d\/message$|\/message$/gi.test(url)) {
        url = url.replace(/\/(v\d)\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi, "/$1/chat/completions");
    } else if (!/\/v\d\/chat\/completions$/gi.test(url)) {
        if (!/\/$/g.test(url)) url = url + "/";
        url = url.replace(/(.+)\/$/gi, "$1/v1/chat/completions");
    }
    return url;
}

function decodeChunk(value, decoder) {
    if (typeof value === "string") return value;
    return decoder.decode(value, { stream: true });
}

// Parse one SSE stream via its reader. Calls onEvent(parsedJsonObject) for every
// `data: {...}` line and stops at `data: [DONE]`.
async function consumeSse(reader, onEvent) {
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decodeChunk(value, decoder);
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            if (!payload) continue;
            try {
                onEvent(JSON.parse(payload));
            } catch (e) {
                // Ignore keep-alives / partial JSON noise rather than killing the stream.
            }
        }
    }
}

function finalizeToolCalls(toolCallMap) {
    const indexes = Object.keys(toolCallMap).map(Number).sort((a, b) => a - b);
    return indexes.map((index) => {
        const entry = toolCallMap[index];
        let args;
        try {
            args = JSON.parse(entry.arguments || "{}");
        } catch (e) {
            args = { __parseError: entry.arguments || "" };
        }
        return { id: entry.id || "", name: entry.name || "", args: args };
    });
}

function createChatClient(opts) {
    opts = opts || {};
    const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) throw new Error("No fetch implementation available");

    async function chat(request) {
        const body = {
            model: request.model,
            messages: request.messages
        };
        if (request.tools) body.tools = request.tools;
        if (request.temperature !== undefined) body.temperature = request.temperature;
        if (request.top_p !== undefined) body.top_p = request.top_p;
        const stream = request.stream !== false;
        if (stream) body.stream = true;

        const headers = { "Content-Type": "application/json" };
        if (request.apiKey) headers["Authorization"] = "Bearer " + request.apiKey;

        let res;
        try {
            res = await fetchImpl(request.url, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
                signal: request.signal || undefined
            });
        } catch (e) {
            if (e && e.name === "AbortError") throw e;
            throw Object.assign(new Error("Network error: " + (e && e.message ? e.message : e)), { cause: e });
        }

        if (!res.ok) {
            let text = "";
            try { text = await res.text(); } catch (e) { /* body unavailable */ }
            const truncated = text.length > 500 ? text.slice(0, 500) + "…" : text;
            throw Object.assign(
                new Error("HTTP " + res.status + " " + truncated),
                { status: res.status, body: text }
            );
        }

        const result = { content: "", reasoning: "", toolCalls: [], finishReason: null, usage: null };

        if (!stream) {
            const json = await res.json();
            const choice = (json.choices && json.choices[0]) || {};
            const message = choice.message || {};
            result.content = message.content || "";
            const rawCalls = message.tool_calls || [];
            const map = {};
            rawCalls.forEach((call, i) => {
                map[i] = {
                    id: call.id || "",
                    name: (call.function && call.function.name) || "",
                    arguments: (call.function && call.function.arguments) || "{}"
                };
            });
            result.toolCalls = finalizeToolCalls(map);
            result.finishReason = choice.finish_reason || null;
            result.usage = json.usage || null;
            return result;
        }

        const toolCallMap = {};
        await consumeSse(res.body.getReader(), (evt) => {
            const choice = (evt.choices && evt.choices[0]) || {};
            const delta = choice.delta || {};
            if (typeof delta.content === "string" && delta.content !== "") {
                result.content += delta.content;
                if (request.onDelta) request.onDelta(delta.content);
            }
            const reasoning = delta.reasoning_content !== undefined ? delta.reasoning_content : delta.reasoning;
            if (typeof reasoning === "string" && reasoning !== "") {
                result.reasoning += reasoning;
            }
            if (Array.isArray(delta.tool_calls)) {
                for (const part of delta.tool_calls) {
                    const index = part.index || 0;
                    if (!toolCallMap[index]) toolCallMap[index] = { id: "", name: "", arguments: "" };
                    if (part.id) toolCallMap[index].id = part.id;
                    const fn = part.function || {};
                    if (fn.name) toolCallMap[index].name = fn.name;
                    if (typeof fn.arguments === "string") toolCallMap[index].arguments += fn.arguments;
                }
            }
            if (choice.finish_reason) result.finishReason = choice.finish_reason;
            if (evt.usage) result.usage = evt.usage;
        });
        result.toolCalls = finalizeToolCalls(toolCallMap);
        return result;
    }

    return { chat: chat };
}

module.exports = {
    normalizeUrl: normalizeUrl,
    consumeSse: consumeSse,
    createChatClient: createChatClient
};
