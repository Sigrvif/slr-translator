// www/core/docsChat/lib/ToolLoop.js
// Conversation manager for the "Ask DSLR" chat: builds messages, offers the
// documentation tools, executes tool calls locally, streams the final answer,
// and degrades to pre-fetched excerpts on endpoints without tool support.
"use strict";
const Persona = require("./Persona");

const TOOL_SPECS = [
    {
        type: "function",
        function: {
            name: "list_docs",
            description: "List every page of the SLR Translator manual with id, title and section.",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "read_doc",
            description: "Read one manual page in full (plain text). Use for the exact content of a page.",
            parameters: {
                type: "object",
                properties: {
                    page_id: { type: "string", description: "Page id from the table of contents, e.g. 'dslr'" }
                },
                required: ["page_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_docs",
            description: "Search the manual. Returns the best matching pages with snippets.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search terms" }
                },
                required: ["query"]
            }
        }
    }
];

// Manual-mode evidence rule, calibrated against a 13-question battery run on
// the real manual (see ledger, 2026-10-03). A hit qualifies as manual when:
//   - a RARE token (df <= ~35% of pages — the manual's own vocabulary, not its
//     stopwords like "word"/"japanese") hits the page's title/keywords, OR
//   - at least two rare tokens match with a meaningful score, OR
//   - the score clears the escape bar (questions whose every token is
//     corpus-common but are unmistakably manual, e.g. "error code E3").
// Corpus-common single/stray matches ("castle" -> rikaikun via "japanese" +
// "word") must stay in off-manual mode.
function isManualMatch(hit) {
    if (!hit || !hit.score || hit.score < 3) return false;
    const strongRare = !!hit.strongRareMatch;
    const twoRare = (hit.rareTokens || 0) >= 2 && hit.score >= 12;
    const escape = hit.score >= 17.5;
    return strongRare || twoRare || escape;
}

// Pure: build the outgoing message list from the system prompt and the stored
// history. Tool round-trips older than the last `keepToolTurns` assistant
// answers are compacted to their final assistant text; then everything is
// trimmed to the last `maxHistory` messages (system prompt always first).
function buildOutgoing(systemPrompt, history, opts) {
    opts = opts || {};
    const maxHistory = opts.maxHistory === undefined ? 20 : opts.maxHistory;
    const keepToolTurns = opts.keepToolTurns === undefined ? KEEP_TOOL_TURNS : opts.keepToolTurns;

    // A tool round is "old" when its opening assistant message sits before the
    // keepToolTurns-th newest assistant message in the history (spec: rounds
    // "older than the last N assistant answers" are compacted).
    const assistantIdx = [];
    history.forEach((m, i) => {
        if (m.role === "assistant") assistantIdx.push(i);
    });
    const recentFrom = assistantIdx.length === 0
        ? 0
        : assistantIdx[Math.max(0, assistantIdx.length - keepToolTurns)];

    const compacted = [];
    let roundOld = false;
    history.forEach((m, i) => {
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
            roundOld = i < recentFrom;
            if (roundOld) {
                compacted.push({ role: "assistant", content: m.content || "" });
            } else {
                compacted.push(m);
            }
            return;
        }
        if (m.role === "tool") {
            if (!roundOld) compacted.push(m);
            return;
        }
        compacted.push(m);
    });

    const trimmed = compacted.slice(-maxHistory);
    const outgoing = [];
    if (systemPrompt !== null) outgoing.push({ role: "system", content: systemPrompt });
    return outgoing.concat(trimmed);
}

// Conservative shipped defaults (a 32k-context model): the biggest manual page
// (local-runtime.html) is ~15k tokens of text; returned uncapped it floods a
// small model's context and crowds out everything else. Both caps are options —
// users with large-context models raise them in the Options window.
const DEFAULT_READ_DOC_MAX_CHARS = 24000;
// Pre-injected excerpts get a tighter cap: two of them ride in the system
// prompt on every manual-matching send, next to the persona and the TOC.
const DEFAULT_EXCERPT_MAX_CHARS = 12000;
// Conversation memory default (messages sent along with each new question).
const DEFAULT_MAX_HISTORY = 20;
// Tool round-trips older than the last N assistant answers are compacted away
// (see buildOutgoing). Shared by the compaction and the excerpt dedup so the
// two can never disagree about what is still in the conversation.
const KEEP_TOOL_TURNS = 3;

// Page ids whose read_doc result is still present in the OUTGOING view of the
// history (i.e. inside the KEEP_TOOL_TURNS window and a successful read). Used
// to avoid shipping the same page twice — once as a tool result, once as a
// system-prompt excerpt. Error results (hallucinated page ids) do not count.
function collectReadPageIds(history) {
    const assistantIdx = [];
    history.forEach((m, i) => { if (m.role === "assistant") assistantIdx.push(i); });
    const recentFrom = assistantIdx.length === 0 ? 0 : assistantIdx[Math.max(0, assistantIdx.length - KEEP_TOOL_TURNS)];
    const ids = new Set();
    let roundKept = false;
    history.forEach((m, i) => {
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
            roundKept = i >= recentFrom;
            return;
        }
        if (m.role === "tool" && roundKept) {
            try {
                const parsed = JSON.parse(m.content);
                if (parsed && parsed.page_id && parsed.text) ids.add(parsed.page_id);
            } catch (e) { /* not a read_doc payload */ }
        }
    });
    return ids;
}

// Shared excerpt formatter for both grounding paths (manual-match pre-fetch
// and the no-tools fallback).
function excerptsBlock(pages, maxChars) {
    let out = "";
    for (const page of pages) {
        let text = page.text || "";
        if (text.length > maxChars) {
            text = text.slice(0, maxChars) + "\n(page beginning only — use read_doc for more)";
        }
        out += "\n\n--- " + page.title + " (" + page.page_id + ") ---\n" + text;
    }
    return out;
}

function executeTool(name, args, docIndex, readDocMaxChars) {
    try {
        if (name === "list_docs") return docIndex.listDocs();
        if (name === "read_doc") {
            const page = docIndex.readDoc(args && args.page_id);
            if (page && typeof page.text === "string" && page.text.length > readDocMaxChars) {
                return {
                    page_id: page.page_id,
                    title: page.title,
                    text: page.text.slice(0, readDocMaxChars) +
                        "\n\n(page truncated at " + readDocMaxChars + " characters - use search_docs with narrower terms to find later sections)",
                    truncated: true
                };
            }
            return page;
        }
        if (name === "search_docs") return docIndex.search(String((args && args.query) || ""), 5);
    } catch (e) {
        return { error: "Tool execution failed: " + (e && e.message ? e.message : e) };
    }
    return { error: "Unknown tool '" + name + "'." };
}

function createToolLoop(opts) {
    const client = opts.client;
    const docIndex = opts.docIndex;
    const getPersonaValue = opts.getPersonaValue;
    const getModel = opts.getModel;
    const maxRounds = opts.maxRounds === undefined ? 8 : opts.maxRounds;
    const readDocMaxChars = opts.readDocMaxChars === undefined ? DEFAULT_READ_DOC_MAX_CHARS : opts.readDocMaxChars;
    const excerptMaxChars = opts.excerptMaxChars === undefined ? DEFAULT_EXCERPT_MAX_CHARS : opts.excerptMaxChars;
    const maxHistory = opts.maxHistory === undefined ? DEFAULT_MAX_HISTORY : opts.maxHistory;

    const state = {
        history: [],
        noToolsMode: false,
        controller: null,
        // Per-send loop hygiene: identical tool calls (name+args) execute at
        // most once; repeats get a corrective notice, and after a repeated
        // repeat the tools are stripped with an answer-now directive (a 4B
        // model was observed looping the same roast + search_docs ~12 times).
        seenToolCalls: {},
        duplicateRounds: 0,
        stripTools: false
    };

    function stop() {
        if (state.controller) {
            try { state.controller.abort(); } catch (e) { /* already aborted */ }
        }
    }

    function clear() {
        state.history = [];
    }

    // No-tools mode trades tool calls for pre-fetched excerpts: the manual is
    // searched locally with the user's question and the best pages are handed
    // to the model as text. Used both when the fallback first engages and on
    // every later send while the endpoint is known to reject tools — otherwise
    // documentation questions after the first would be answered blind.
    function withExcerpts(basePrompt, question) {
        const base = basePrompt || "You are the \"Ask DSLR\" assistant inside SLR Translator.";
        const readIds = collectReadPageIds(state.history);
        const pages = [];
        for (const hit of docIndex.search(question, 3)) {
            if (readIds.has(hit.page_id)) continue; // already in the conversation
            const page = docIndex.readDoc(hit.page_id);
            if (page && page.text) pages.push(page);
        }
        return base +
            "\n\nRelevant manual excerpts (pre-fetched for you — the endpoint has no tool support, so cite these when they answer the question):" +
            excerptsBlock(pages, readDocMaxChars);
    }

    async function runRounds(context) {
        // context: { systemPrompt, toolsAllowed, handlers }
        for (let round = 0; round <= maxRounds; round++) {
            const prompt = context.composeSystemPrompt
                ? context.composeSystemPrompt()
                : context.systemPrompt;
            const outgoing = buildOutgoing(prompt, state.history, { maxHistory: maxHistory });
            const res = await client.chat({
                url: context.endpoint.url,
                apiKey: context.endpoint.apiKey,
                model: context.endpoint.model,
                messages: outgoing,
                tools: context.toolsAllowed && !state.noToolsMode && !state.stripTools ? TOOL_SPECS : undefined,
                // Conservative sampling for chat (the engine tunes its own for
                // translation): small local models at llama-server's default
                // ~0.8 temperature flake on tool calls and persona discipline.
                temperature: 0.4,
                top_p: 0.9,
                stream: true,
                signal: context.controller.signal,
                onDelta: context.handlers.onDelta
            });

            if (!res.toolCalls || res.toolCalls.length === 0) {
                state.history.push({ role: "assistant", content: res.content || "" });
                return res.content || "";
            }

            if (round === maxRounds) {
                throw new Error("Tool loop limit exceeded (" + maxRounds + " rounds)");
            }

            if (context.handlers.onRoundReset) context.handlers.onRoundReset();
            state.history.push({
                role: "assistant",
                content: res.content || "",
                tool_calls: res.toolCalls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) }
                }))
            });
            let duplicates = 0;
            for (const call of res.toolCalls) {
                const key = call.name + "|" + JSON.stringify(call.args);
                const isDuplicate = Object.prototype.hasOwnProperty.call(state.seenToolCalls, key);
                state.seenToolCalls[key] = true;
                let result;
                if (isDuplicate) {
                    duplicates += 1;
                    result = { notice: "You already called " + call.name + " with these exact arguments in this conversation and its result is above. Do not call it again. Answer the user's question now using the information you already have." };
                } else {
                    result = executeTool(call.name, call.args, docIndex, readDocMaxChars);
                }
                state.history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
                if (context.handlers.onStatus) {
                    context.handlers.onStatus("reading documentation: " + call.name + "…");
                }
            }
            if (duplicates > 0) {
                state.duplicateRounds += 1;
                if (state.duplicateRounds >= 2 && !state.stripTools) {
                    state.stripTools = true;
                    const current = context.composeSystemPrompt ? context.composeSystemPrompt() : context.systemPrompt;
                    context.systemPrompt = current +
                        "\n\n(Tool use is disabled for the rest of this answer: the same tool call was repeated. Answer the user's question NOW, in full, using the information already in this conversation. Do not mention tools.)";
                    context.composeSystemPrompt = null;
                    if (context.handlers.onStatus) {
                        context.handlers.onStatus("the model repeated itself — pressing for an answer…");
                    }
                }
            }
        }
        throw new Error("Tool loop limit exceeded (" + maxRounds + " rounds)");
    }

    async function send(userText, handlers) {
        handlers = handlers || {};
        const text = String(userText || "").trim();
        if (text === "") throw new Error("Empty message");

        const endpoint = getModel();
        if (!endpoint || !endpoint.url) {
            throw Object.assign(new Error("No DSLR endpoint configured. Set one up in Translation Setup first."), { code: "NO_ENDPOINT" });
        }

        // Deterministic mode selection: the app, not the model, decides whether
        // the question is manual material. The manual is searched with the user's
        // question; a scoring hit selects the merciless persona variant plus an
        // evidence nudge naming the pages, a miss selects the off-manual variant
        // (which contains no shaming branch at all — live testing showed small
        // models cannot resist vivid shaming instructions otherwise).
        const hits = docIndex.search(text, 3);
        const manualMatch = hits.length > 0 && isManualMatch(hits[0]);
        // Mood hook for the avatar: fires before the first request so the
        // portrait flips (smug vs delighted) the moment a question is sent.
        if (handlers.onMode) handlers.onMode(manualMatch);
        const prompt = Persona.buildSystemPrompt(getPersonaValue(), docIndex.listDocs(), { manualMatch: manualMatch });
        const toolsAllowed = prompt.toolsAllowed;
        let systemPrompt = prompt.text;
        let composeSystemPrompt = null;
        if (state.noToolsMode && toolsAllowed) {
            systemPrompt = withExcerpts(prompt.text, text);
        } else if (toolsAllowed && manualMatch) {
            // Grounding by construction: the top matches' text goes straight
            // into the system prompt. Live testing showed small models
            // sometimes skip the tools entirely and free-style "according to
            // the manual" answers; with the content attached, the answer is
            // grounded whether or not the model chooses to read more. Tools
            // stay available for pages/parts not included here.
            const candidates = [];
            for (const hit of hits.slice(0, 2)) {
                const page = docIndex.readDoc(hit.page_id);
                if (page && page.text) candidates.push(page);
            }
            if (candidates.length) {
                if (handlers.onStatus) {
                    handlers.onStatus("reading the manual: " + candidates.map((p) => p.title).join(", ") + "…");
                }
                const base = prompt.text;
                // Composed per round: a page the model reads via read_doc is
                // dropped from the excerpt section for every later request —
                // the tool result in the conversation already carries a fuller
                // copy, and shipping both doubles the text into the context.
                composeSystemPrompt = function () {
                    const readIds = collectReadPageIds(state.history);
                    const pages = candidates.filter((p) => !readIds.has(p.page_id));
                    const skipped = candidates.length - pages.length;
                    let sp = base;
                    if (pages.length) {
                        sp += "\n\nExcerpts of the best-matching manual pages (pre-fetched by the app):" +
                            excerptsBlock(pages, excerptMaxChars) +
                            "\n\nAnswer from these excerpts and cite the page(s). Match what the user wants to DO, not just their words: if an excerpt describes a related but different feature than the question implies, check the table of contents and read_doc the page documenting the actual feature instead. Only cite sections that appear in the text you were given. Use read_doc if you need a part of a page that is not included here.";
                    }
                    if (skipped > 0) {
                        sp += "\n\n(The remaining best-matching manual page(s) were already read in this conversation — their full texts are above; cite them from there.)";
                    }
                    return sp;
                };
                systemPrompt = null;
            }
        }

        state.history.push({ role: "user", content: text });
        state.controller = new AbortController();
        state.seenToolCalls = {};
        state.duplicateRounds = 0;
        state.stripTools = false;

        const context = {
            endpoint: endpoint,
            systemPrompt: systemPrompt,
            composeSystemPrompt: composeSystemPrompt,
            toolsAllowed: toolsAllowed,
            controller: state.controller,
            handlers: handlers
        };

        try {
            return await runRounds(context);
        } catch (e) {
            // Only a rejection that actually looks like "this endpoint does not
            // know the tools parameter" may degrade the conversation to
            // pre-fetched excerpts. Other 4xx/404s (bad key, model_not_found,
            // malformed request) must surface their real error immediately —
            // mistaking them for missing tool support hides the actual problem.
            const errorText = ((e && e.body) || "") + " " + ((e && e.message) || "");
            const fallbackable = e && e.status &&
                (e.status === 400 || e.status === 404 || e.status === 422) &&
                /tool/i.test(errorText) &&
                toolsAllowed && !state.noToolsMode;
            if (!fallbackable) throw e;

            // Endpoint rejected the tools parameter: degrade to locally
            // pre-fetched excerpts and retry without tools. Sticky: later
            // sends skip the doomed tools attempt entirely (and keep getting
            // excerpts — see withExcerpts).
            state.noToolsMode = true;
            context.systemPrompt = withExcerpts(prompt.text, text);
            context.composeSystemPrompt = null;
            context.toolsAllowed = false;
            if (handlers.onStatus) handlers.onStatus("endpoint has no tool support — searching the manual locally…");
            return await runRounds(context);
        }
    }

    function loadHistory(messages) {
        if (!Array.isArray(messages)) return false;
        state.history = messages.filter(function (m) {
            return m && typeof m.role === "string" && (typeof m.content === "string" || m.role === "tool" || Array.isArray(m.tool_calls));
        });
        return true;
    }

    return {
        send: send,
        stop: stop,
        clear: clear,
        loadHistory: loadHistory,
        get history() { return state.history; }
    };
}

module.exports = {
    TOOL_SPECS: TOOL_SPECS,
    buildOutgoing: buildOutgoing,
    isManualMatch: isManualMatch,
    collectReadPageIds: collectReadPageIds,
    createToolLoop: createToolLoop
};
