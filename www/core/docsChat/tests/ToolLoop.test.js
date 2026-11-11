// www/core/docsChat/tests/ToolLoop.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ToolLoop = require("../lib/ToolLoop");

// ---- fakes ---------------------------------------------------------------

function makeScriptedClient(script) {
    const calls = [];
    let i = 0;
    const client = {
        calls: calls,
        chat: async (req) => {
            calls.push(req);
            if (i >= script.length) throw new Error("unexpected client call #" + (i + 1));
            const step = script[i++];
            if (step instanceof Error) throw step;
            const result = typeof step === "function" ? step(req, i) : step;
            // Simulate a streaming client: final content arrives via onDelta too.
            if (result && typeof result.content === "string" && result.content && req.onDelta) {
                req.onDelta(result.content);
            }
            return result;
        }
    };
    return client;
}

function httpError(status, body) {
    return Object.assign(new Error("HTTP " + status), { status: status, body: body || "{}" });
}

const fakeDocIndex = {
    listDocs: () => [
        { id: "dslr", title: "DSLR Translation Engine", section: "Translation Engines" },
        { id: "faq", title: "FAQ", section: "Reference" }
    ],
    readDoc: (id) => id === "dslr"
        ? { page_id: "dslr", title: "DSLR Translation Engine", text: "DSLR page body text." }
        : { error: "Unknown page_id '" + id + "'. Use list_docs for valid ids." },
    search: () => [
        { page_id: "dslr", title: "DSLR Translation Engine", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "DSLR page body..." }
    ]
};

function makeLoop(client, opts) {
    opts = opts || {};
    return ToolLoop.createToolLoop({
        client: client,
        docIndex: opts.docIndex || fakeDocIndex,
        getPersonaValue: opts.getPersonaValue || (() => ""),
        getModel: opts.getModel || (() => ({ url: "http://x/v1/chat/completions", apiKey: "k", model: "m" })),
        maxRounds: opts.maxRounds,
        readDocMaxChars: opts.readDocMaxChars,
        excerptMaxChars: opts.excerptMaxChars,
        maxHistory: opts.maxHistory
    });
}

// ---- tests ----------------------------------------------------------------

test("happy path: one tool round then final answer streams", async () => {
    const client = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "read_doc", args: { page_id: "dslr" } }], finishReason: "tool_calls" },
        { content: "It's on the dslr page.", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client);
    const deltas = [];
    const statuses = [];
    let roundResets = 0;
    const final = await loop.send("how do endpoints work?", {
        onDelta: (t) => deltas.push(t),
        onStatus: (s) => statuses.push(s),
        onRoundReset: () => roundResets++
    });
    assert.equal(final, "It's on the dslr page.");
    assert.deepEqual(deltas, ["It's on the dslr page."]);
    assert.ok(statuses.some((s) => /reading documentation/.test(s)), JSON.stringify(statuses));
    assert.equal(roundResets, 1);

    // Second request carries the assistant tool_calls message + tool result
    const second = client.calls[1];
    const assistantToolMsg = second.messages.find((m) => m.role === "assistant" && m.tool_calls);
    assert.ok(assistantToolMsg, "assistant tool_calls message missing");
    assert.equal(assistantToolMsg.tool_calls[0].function.name, "read_doc");
    assert.equal(assistantToolMsg.tool_calls[0].function.arguments, JSON.stringify({ page_id: "dslr" }));
    const toolMsg = second.messages.find((m) => m.role === "tool");
    assert.ok(toolMsg, "tool result message missing");
    assert.equal(toolMsg.tool_call_id, "c1");
    assert.ok(/DSLR page body text/.test(toolMsg.content));

    // First request carries tools + system prompt with TOC
    assert.ok(Array.isArray(client.calls[0].tools) && client.calls[0].tools.length === 3);
    assert.ok(client.calls[0].messages[0].role === "system");
    assert.ok(client.calls[0].messages[0].content.includes("dslr"));
    // Chat sends conservative sampling params: small local models at the
    // server's default temperature (~0.8) flake on tool calls and persona
    // discipline run-to-run.
    assert.equal(client.calls[0].temperature, 0.4);
    assert.equal(client.calls[0].top_p, 0.9);
});

test("unknown tool name returns an error result to the model, no throw", async () => {
    const client = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "invented_tool", args: {} }], finishReason: "tool_calls" },
        { content: "ok then", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client);
    const final = await loop.send("q", {});
    assert.equal(final, "ok then");
    const toolMsg = client.calls[1].messages.find((m) => m.role === "tool");
    assert.ok(/Unknown tool/.test(toolMsg.content));
});

test("fallback on 400: retries without tools with injected excerpts, sticks", async () => {
    const client = makeScriptedClient([
        httpError(400, "{\"error\":\"tools not supported\"}"),
        { content: "answer from excerpts", toolCalls: [], finishReason: "stop" },
        { content: "second answer", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client);
    const first = await loop.send("what is dslr?", {});
    assert.equal(first, "answer from excerpts");
    assert.equal(client.calls.length, 2);
    assert.ok(!client.calls[1].tools, "fallback request must not carry tools");
    const sys = client.calls[1].messages[0];
    assert.ok(/Relevant manual excerpts/.test(sys.content), "excerpts header missing");
    assert.ok(/DSLR page body text/.test(sys.content), "page text not injected");

    const second = await loop.send("again", {});
    assert.equal(second, "second answer");
    assert.equal(client.calls.length, 3, "sticky no-tools mode must not retry tools");
    assert.ok(!client.calls[2].tools);
    // Sticky mode must still fetch manual excerpts for the NEW question on every
    // send — otherwise docs questions after the first are answered blind.
    const sys2 = client.calls[2].messages[0];
    assert.ok(/Relevant manual excerpts/.test(sys2.content), "excerpts missing on sticky send 2");
    assert.ok(/DSLR page body text/.test(sys2.content), "page text missing on sticky send 2");
});

test("401 does not fall back: error surfaces immediately", async () => {
    const client = makeScriptedClient([httpError(401, "{\"error\":\"bad key\"}")]);
    const loop = makeLoop(client);
    await assert.rejects(
        () => loop.send("q", {}),
        (e) => e.status === 401
    );
    assert.equal(client.calls.length, 1, "no fallback retry for auth errors");
});

test("model_not_found 404 surfaces immediately — not treated as missing tool support", async () => {
    // The bundled runtime's router answers unknown model ids with this body.
    // It has nothing to do with tool support; claiming so (and retrying without
    // tools) hides the real problem from the user.
    const client = makeScriptedClient([httpError(404, "{\"error\":{\"code\":\"model_not_found\",\"message\":\"model 'qwen3.5-4b-paperwitch-heresy' not found\",\"type\":\"invalid_request_error\"}}")]);
    const loop = makeLoop(client);
    await assert.rejects(
        () => loop.send("q", {}),
        (e) => e.status === 404 && /not found/.test(e.body)
    );
    assert.equal(client.calls.length, 1, "model_not_found must not trigger the no-tools fallback");
});

test("missing endpoint rejects with NO_ENDPOINT before any client call", async () => {
    const client = makeScriptedClient([]);
    const loop = makeLoop(client, { getModel: () => ({ url: "", apiKey: "", model: "" }) });
    await assert.rejects(
        () => loop.send("q", {}),
        (e) => e.code === "NO_ENDPOINT"
    );
    assert.equal(client.calls.length, 0);
});

test("stop() mid-round rejects with AbortError and history keeps the user message", async () => {
    const client = {
        calls: [],
        chat: (req) => new Promise((resolve, reject) => {
            client.calls.push(req);
            req.signal.addEventListener("abort", () => {
                const e = new Error("The operation was aborted");
                e.name = "AbortError";
                reject(e);
            });
        })
    };
    const loop = makeLoop(client);
    const pending = loop.send("q", {});
    const failure = assert.rejects(pending, (e) => e.name === "AbortError");
    loop.stop();
    await failure;
    assert.ok(loop.history.some((m) => m.role === "user" && m.content === "q"));

    // And the loop recovers for the next send.
    const client2 = { chat: async () => ({ content: "recovered", toolCalls: [] }) };
    const loop2 = makeLoop(client2);
    assert.equal(await loop2.send("next", {}), "recovered");
});

test("tool round cap rejects with a limit error", async () => {
    let n = 0;
    const client = {
        chat: async () => ({ content: "", toolCalls: [{ id: "c" + (n++), name: "list_docs", args: {} }], finishReason: "tool_calls" })
    };
    const loop = makeLoop(client);
    await assert.rejects(() => loop.send("q", {}), /Tool loop limit/);
});

test("buildOutgoing compacts old tool rounds and trims to maxHistory", () => {
    const history = [];
    // Old turn with a tool round-trip (must be compacted to its assistant text)
    history.push({ role: "user", content: "old q" });
    history.push({ role: "assistant", content: "", tool_calls: [{ id: "t0", function: { name: "read_doc", arguments: "{}" } }] });
    history.push({ role: "tool", tool_call_id: "t0", content: "{}" });
    history.push({ role: "assistant", content: "old a" });
    // Recent turn with a tool round-trip (must stay intact)
    history.push({ role: "user", content: "new q" });
    history.push({ role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "read_doc", arguments: "{}" } }] });
    history.push({ role: "tool", tool_call_id: "t1", content: "{}" });
    history.push({ role: "assistant", content: "new a" });
    // Enough plain padding that compaction matters for the 20-message window,
    // but the old assistant answer still lands inside it (4 + 14 + 4 = 22
    // messages -> 21 after compaction -> 20 + system after trim).
    for (let i = 0; i < 14; i++) history.push({ role: "user", content: "filler " + i });

    const out = ToolLoop.buildOutgoing("SYSTEM", history, { maxHistory: 20, keepToolTurns: 3 });
    assert.equal(out[0].role, "system");
    assert.equal(out[0].content, "SYSTEM");
    assert.ok(out.length <= 21, "expected <= system + 20 messages, got " + out.length);
    assert.ok(!out.some((m) => m.role === "tool" && m.tool_call_id === "t0"), "old tool result must be compacted away");
    assert.ok(!out.some((m) => m.tool_call_id === "t0"), "old assistant tool_calls must be stripped");
    assert.ok(out.some((m) => m.role === "assistant" && m.content === "old a"), "old assistant answer survives");
    assert.ok(out.some((m) => m.tool_call_id === "t1"), "recent tool round stays intact");
});

test("manual-matching questions get page excerpts injected — grounding by construction", async () => {
    // The doc index decides triage in code AND supplies the content: the top
    // matches' text goes straight into the system prompt, so the answer is
    // grounded even when a small model skips the tools entirely (observed
    // live: "according to the manual" answers with zero read_doc calls).
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: (q) => /stint/i.test(String(q))
            ? [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "stint is a font profile for wrapping" }]
            : [],
        readDoc: (id) => id === "quirkfolio"
            ? { page_id: "quirkfolio", title: "The Quirkfolio Page", text: "quirkfolio body: the stint is a font profile." }
            : fakeDocIndex.readDoc(id)
    });
    const client = makeScriptedClient([{ content: "answer", toolCalls: [], finishReason: "stop" }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    const statuses = [];
    await loop.send("what is the stint parameter?", { onStatus: (s) => statuses.push(s) });
    const sys = client.calls[0].messages[0].content;
    assert.ok(/quirkfolio body: the stint is a font profile/.test(sys), "excerpt text must be injected: " + sys.slice(-300));
    assert.ok(/The Quirkfolio Page/.test(sys), "excerpt must name the page");
    assert.ok(/Use read_doc if/.test(sys), "must point at read_doc for the rest");
    assert.ok(/Match what the user wants to DO/.test(sys), "goal-matching nudge present");
    assert.ok(statuses.some((s) => /reading the manual/.test(s)), "UI must show the manual-read status: " + JSON.stringify(statuses));
    assert.ok(Array.isArray(client.calls[0].tools) && client.calls[0].tools.length === 3, "tools remain available");
});

test("injected excerpts are capped so two pages cannot flood the context", async () => {
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => [
            { page_id: "big1", title: "Big One", score: 9, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" },
            { page_id: "big2", title: "Big Two", score: 8, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }
        ],
        readDoc: (id) => ({ page_id: id, title: id, text: "z".repeat(60000) })
    });
    const client = makeScriptedClient([{ content: "answer", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("anything manual-ish?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(sys.length < 32000, "system prompt must stay bounded, got " + sys.length);
    assert.ok((sys.match(/page beginning only/g) || []).length === 2, "both truncated excerpts must carry the note");
});

test("read_doc caps huge pages with a truncation note", async () => {
    // local-runtime.html is ~15k tokens of text; uncapped it floods a small
    // model's context and crowds out everything else.
    const docIndex = Object.assign({}, fakeDocIndex, {
        readDoc: (id) => ({ page_id: id, title: "Huge", text: "x".repeat(60000) }),
        search: (q) => /stint/i.test(String(q))
            ? [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }]
            : []
    });
    const client = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "read_doc", args: { page_id: "quirkfolio" } }], finishReason: "tool_calls" },
        { content: "ok", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("what is the stint parameter?", {});
    const toolMsg = client.calls[1].messages.find((m) => m.role === "tool");
    assert.ok(toolMsg.content.length < 30000, "read_doc result must be capped, got " + toolMsg.content.length);
    assert.ok(/page truncated/i.test(toolMsg.content), "cap must come with a truncation note");
    assert.ok(/search_docs/.test(toolMsg.content), "note should point at search_docs");
});

test("questions with no manual hits get no nudge", async () => {
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: (q) => /stint/i.test(String(q))
            ? [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "stint..." }]
            : []
    });
    const client = makeScriptedClient([{ content: "pancakes!", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("what is a good pancake recipe?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(!/Quirkfolio/.test(sys), "no nudge for off-manual questions");
    // Deterministic mode split: with no manual match, the system prompt is the
    // off-manual persona variant — the merciless paragraph is simply not there.
    assert.ok(sys.startsWith(require("../lib/Persona").DEFAULT_PERSONA_OFF), "off-manual questions must select the off variant");
});

test("manual-matching questions receive the manual persona variant", async () => {
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: (q) => /stint/i.test(String(q))
            ? [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "stint..." }]
            : []
    });
    const client = makeScriptedClient([{ content: "answer", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("what is the stint parameter?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(/merciless/.test(sys), "manual questions keep the full persona");
});

test("persona off sends no tools, no TOC and no nudge", async () => {
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => [{ page_id: "word-wrap", title: "Automatic Word Wrapping", score: 5, snippet: "x" }]
    });
    const client = makeScriptedClient([{ content: "plain", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex, getPersonaValue: () => "off" });
    assert.equal(await loop.send("what is stint?", {}), "plain");
    assert.ok(!client.calls[0].messages.some((m) => m.role === "system"), "persona off must send no system message");
});

test("mode evidence rule: single weak token matches do NOT trigger manual mode", async () => {
    // Production incident: "gun chambered for 3.57 Magnum, safe to shoot 38
    // Special?" matched ONE weak token on some page (score 7.9) and the chat
    // roasted the user about the manual before answering a ballistics
    // question. Off-manual questions need EVIDENCE: >= 2 matching tokens and
    // either a title/keyword hit or a substantial score.
    function hit(pageId, score, matchedTokens, strongMatch) {
        return [{ page_id: pageId, title: "Page " + pageId, score: score, matchedTokens: matchedTokens, strongMatch: strongMatch, rareTokens: 2, strongRareMatch: strongMatch, snippet: "s" }];
    }
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: (q) => /magnum/i.test(String(q)) ? hit("noise", 7.9, 1, false) : [],
        readDoc: (id) => ({ page_id: id, title: "Page " + id, text: "noise page text" })
    });
    const client = makeScriptedClient([{ content: "ballistics!", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("is it safe to shoot magnum rounds?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(sys.startsWith(require("../lib/Persona").DEFAULT_PERSONA_OFF), "single weak token must select the off variant");
    assert.ok(!/noise page text/.test(sys), "no excerpts for weak matches");
});

test("mode evidence rule: weak multi-token matches below the score bar stay off-manual", async () => {
    function hit(pageId, score, matchedTokens, strongMatch) {
        return [{ page_id: pageId, title: "Page " + pageId, score: score, matchedTokens: matchedTokens, strongMatch: strongMatch, rareTokens: 2, strongRareMatch: strongMatch, snippet: "s" }];
    }
    // Translation-nuance questions ("would aniki read better as boss?") match
    // several weak tokens (~9.4) — the spec puts those in off-manual mode.
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => hit("gray", 9.4, 3, false),
        readDoc: (id) => ({ page_id: id, title: "Page " + id, text: "gray page text" })
    });
    const client = makeScriptedClient([{ content: "nuance", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("would aniki read better as boss?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(sys.startsWith(require("../lib/Persona").DEFAULT_PERSONA_OFF), "weak multi-token match must stay off variant");
    assert.ok(!/gray page text/.test(sys), "no excerpts below the score bar");
});

test("mode evidence rule: strong (title/keyword) matches and high scores trigger manual mode", async () => {
    function hit(pageId, score, matchedTokens, strongMatch) {
        return [{ page_id: pageId, title: "Page " + pageId, score: score, matchedTokens: matchedTokens, strongMatch: strongMatch, rareTokens: 2, strongRareMatch: strongMatch, snippet: "s" }];
    }
    const cases = [
        hit("real", 6, 2, true),   // keyword hit, modest score
        hit("real", 26.9, 3, false) // high score, no keyword hit
    ];
    let i = 0;
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => cases[i++ % cases.length],
        readDoc: (id) => ({ page_id: id, title: "Page " + id, text: "real page text" })
    });
    for (let n = 0; n < 2; n++) {
        const client = makeScriptedClient([{ content: "answer", toolCalls: [] }]);
        const loop = makeLoop(client, { docIndex: docIndex });
        await loop.send("stint fallback question " + n, {});
        const sys = client.calls[0].messages[0].content;
        assert.ok(/merciless/.test(sys), "case " + n + " must select the manual persona");
        assert.ok(/real page text/.test(sys), "case " + n + " must inject excerpts");
    }
});

test("a page read via read_doc is not re-shipped as an excerpt on later rounds", async () => {
    // Within one turn: round 1 reads page X (also an excerpt candidate);
    // round 2's system prompt must drop X's excerpt — the tool result in the
    // conversation already carries a fuller copy. Shipping both doubles the
    // same text into every later request of the turn.
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }],
        readDoc: (id) => id === "quirkfolio"
            ? { page_id: "quirkfolio", title: "The Quirkfolio Page", text: "quirkfolio body: the stint is a font profile." }
            : fakeDocIndex.readDoc(id)
    });
    const client = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "read_doc", args: { page_id: "quirkfolio" } }], finishReason: "tool_calls" },
        { content: "answer", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("what is the stint parameter?", {});
    // Round 1 still carries the excerpt (the read hasn't happened yet).
    assert.ok(/quirkfolio body/.test(client.calls[0].messages[0].content), "round 1 keeps the excerpt");
    // Round 2 must not duplicate it in the system prompt.
    const sys2 = client.calls[1].messages[0].content;
    assert.ok(!/quirkfolio body/.test(sys2), "round 2 system prompt must not re-ship the read page");
    assert.ok(/already read/i.test(sys2), "round 2 must say where the text is");
    // ...and the tool result itself is still in the round-2 conversation.
    assert.ok(client.calls[1].messages.some((m) => m.role === "tool" && /quirkfolio body/.test(m.content)));
});

test("a follow-up question about a just-read page does not re-excerpt it", async () => {
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }],
        readDoc: (id) => id === "quirkfolio"
            ? { page_id: "quirkfolio", title: "The Quirkfolio Page", text: "quirkfolio body: the stint is a font profile." }
            : fakeDocIndex.readDoc(id)
    });
    const client = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "read_doc", args: { page_id: "quirkfolio" } }], finishReason: "tool_calls" },
        { content: "first answer", toolCalls: [], finishReason: "stop" },
        { content: "second answer", toolCalls: [], finishReason: "stop" }
    ]);
    const loop = makeLoop(client, { docIndex: docIndex });
    await loop.send("what is the stint parameter?", {});
    await loop.send("tell me more about stint?", {});
    const sys = client.calls[2].messages[0].content;
    assert.ok(!/quirkfolio body/.test(sys), "follow-up must not re-ship the page as an excerpt");
    assert.ok(/already read/i.test(sys), "follow-up must note the page is in the conversation");
    assert.ok(client.calls[2].messages.some((m) => m.role === "tool" && /quirkfolio body/.test(m.content)),
        "the earlier read must still be in the outgoing conversation");
});

test("a failed read (hallucinated page id) does not suppress the excerpt", () => {
    // Unit-level: collectReadPageIds only counts SUCCESSFUL reads. A model
    // read_doc on a hallucinated id yields an error payload — that page must
    // not be treated as "already in the conversation".
    const history = [
        { role: "user", content: "q" },
        {
            role: "assistant", content: "",
            tool_calls: [{ id: "c1", type: "function", function: { name: "read_doc", arguments: "{\"page_id\":\"ghost\"}" } }]
        },
        { role: "tool", tool_call_id: "c1", content: JSON.stringify({ error: "Unknown page_id 'ghost'." }) },
        {
            role: "assistant", content: "",
            tool_calls: [{ id: "c2", type: "function", function: { name: "read_doc", arguments: "{\"page_id\":\"real\"}" } }]
        },
        { role: "tool", tool_call_id: "c2", content: JSON.stringify({ page_id: "real", title: "Real", text: "..." }) },
        { role: "assistant", content: "answer" }
    ];
    const ids = ToolLoop.collectReadPageIds(history);
    assert.ok(ids.has("real"), "successful read counts");
    assert.ok(!ids.has("ghost"), "error read must not count");
});

test("onMode reports the manual-vs-off decision for each send", async () => {
    // The avatar rides on this: smug when the manual covers the question,
    // delighted when it doesn't.
    const manualIdx = Object.assign({}, fakeDocIndex, {
        search: (q) => /stint/i.test(String(q))
            ? [{ page_id: "quirkfolio", title: "Q", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }]
            : []
    });
    const offIdx = Object.assign({}, fakeDocIndex, { search: () => [] });
    const modes = [];
    let loop = makeLoop(makeScriptedClient([{ content: "a", toolCalls: [] }]), { docIndex: manualIdx });
    await loop.send("stint?", { onMode: (m) => modes.push(m) });
    loop = makeLoop(makeScriptedClient([{ content: "b", toolCalls: [] }]), { docIndex: manualIdx });
    await loop.send("pancake?", { onMode: (m) => modes.push(m) });
    loop = makeLoop(makeScriptedClient([{ content: "c", toolCalls: [] }]), { docIndex: offIdx });
    await loop.send("anything?", { onMode: (m) => modes.push(m) });
    assert.deepEqual(modes, [true, false, false], "manual question -> true; off questions -> false");
});

test("isManualMatch: calibrated shapes from the live question battery", () => {
    const F = ToolLoop.isManualMatch;
    // Castle question: corpus-common tokens only (japanese/word/common), one
    // rare-ish, no rare keyword hit, score just under the escape bar -> OFF.
    assert.equal(F({ score: 17.3, matchedTokens: 3, strongMatch: true, rareTokens: 1, strongRareMatch: false }), false);
    // Aniki gray zone: two rare-but-generic English words, low score -> OFF.
    assert.equal(F({ score: 9.4, matchedTokens: 3, strongMatch: false, rareTokens: 2, strongRareMatch: false }), false);
    // Gun question: one stray rare token -> OFF.
    assert.equal(F({ score: 7.9, matchedTokens: 1, strongMatch: false, rareTokens: 1, strongRareMatch: false }), false);
    // Fallback question: rare token hitting keywords -> MANUAL.
    assert.equal(F({ score: 17.9, matchedTokens: 2, strongMatch: true, rareTokens: 1, strongRareMatch: true }), true);
    // Rotation question: two rare tokens, strong score -> MANUAL.
    assert.equal(F({ score: 33.9, matchedTokens: 3, strongMatch: true, rareTokens: 2, strongRareMatch: true }), true);
    // Caching question: no rare evidence, clears the escape bar -> MANUAL.
    assert.equal(F({ score: 18.2, matchedTokens: 2, strongMatch: true, rareTokens: 1, strongRareMatch: false }), true);
    // Error-code question: all corpus-common, high score -> MANUAL via escape.
    assert.equal(F({ score: 26.9, matchedTokens: 3, strongMatch: true, rareTokens: 0, strongRareMatch: false }), true);
    // Junk guard: nothing below the floor.
    assert.equal(F({ score: 2, matchedTokens: 5, strongMatch: true, rareTokens: 5, strongRareMatch: true }), false);
    assert.equal(F(null), false);
});

test("empty user text rejects without any client call", async () => {
    const client = makeScriptedClient([]);
    const loop = makeLoop(client);
    await assert.rejects(() => loop.send("   \n  ", {}), /Empty/);
    assert.equal(client.calls.length, 0);
});

test("persona 'off' sends no tools and no TOC", async () => {
    const client = makeScriptedClient([{ content: "plain", toolCalls: [] }]);
    const loop = makeLoop(client, { getPersonaValue: () => "off" });
    assert.equal(await loop.send("q", {}), "plain");
    assert.ok(!client.calls[0].tools);
    assert.ok(!client.calls[0].messages.some((m) => m.role === "system"), "persona off must send no system message");
});

test("repeated identical tool calls are not re-executed and break the loop", async () => {
    // Production incident: a 4B model streamed the same roast and the SAME
    // search_docs call round after round (~12 times until the user aborted).
    // An identical name+args call must never execute twice; after the second
    // repeat, tools are stripped with an answer-now directive.
    const searchCalls = [];
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: (q) => {
            searchCalls.push(String(q));
            return [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }];
        },
        readDoc: (id) => ({ page_id: id, title: "Q", text: "quirkfolio text" })
    });
    const dupCall = { content: "Let me check the manual.", toolCalls: [{ id: "c1", name: "search_docs", args: { query: "concurrent endpoints" } }], finishReason: "tool_calls" };
    const client = makeScriptedClient([dupCall, dupCall, dupCall, { content: "The answer you need.", toolCalls: [], finishReason: "stop" }]);
    const loop = makeLoop(client, { docIndex: docIndex });
    const final = await loop.send("How do I setup multiple concurrent endpoints?", {});
    assert.equal(final, "The answer you need.");
    // The search executed exactly ONCE despite three identical requests.
    const toolExecutions = searchCalls.filter(q => q === "concurrent endpoints");
    assert.equal(toolExecutions.length, 1, "identical tool call must not re-execute: " + JSON.stringify(searchCalls));
    // Request 2 carries round 1's REAL result; request 3 carries the corrective.
    const req3ToolMsg = client.calls[2].messages.filter((m) => m.role === "tool").pop();
    assert.ok(/already called/i.test(req3ToolMsg.content), req3ToolMsg.content.slice(0, 120));
    // Request 3 still offers tools (first repeat only corrects)...
    assert.ok(Array.isArray(client.calls[2].tools), "first repeat corrects without stripping");
    // ...request 4 has them stripped and carries the answer-now directive.
    assert.ok(!client.calls[3].tools, "tools must be stripped after a repeated repeat");
    const sys4 = client.calls[3].messages[0].content;
    assert.ok(/answer the user/i.test(sys4) && /do not (call|mention) tools/i.test(sys4), sys4.slice(-300));
    // Request 4's response produced the final content and resolved.
    assert.equal(final, "The answer you need.");
});

test("read and excerpt caps are configurable for large-context models", async () => {
    // A 1M-context user can afford far bigger reads than the 32k default.
    const bigText = "B".repeat(90000);
    const docIndex = Object.assign({}, fakeDocIndex, {
        search: () => [{ page_id: "quirkfolio", title: "The Quirkfolio Page", score: 5, matchedTokens: 2, strongMatch: true, rareTokens: 2, strongRareMatch: true, snippet: "s" }],
        readDoc: (id) => ({ page_id: id, title: "Q", text: bigText })
    });
    const client = makeScriptedClient([{ content: "answer", toolCalls: [] }]);
    const loop = makeLoop(client, { docIndex: docIndex, readDocMaxChars: 60000, excerptMaxChars: 30000 });
    await loop.send("what is the stint parameter?", {});
    const sys = client.calls[0].messages[0].content;
    assert.ok(sys.length > 30000 + 2000, "excerpt must honor the custom cap (got " + sys.length + ")");
    assert.ok(sys.length < 30000 + 4000, "excerpt must not exceed the custom cap (got " + sys.length + ")");
    // read_doc honors the custom cap too
    const client2 = makeScriptedClient([
        { content: "", toolCalls: [{ id: "c1", name: "read_doc", args: { page_id: "quirkfolio" } }], finishReason: "tool_calls" },
        { content: "ok", toolCalls: [], finishReason: "stop" }
    ]);
    const loop2 = makeLoop(client2, { docIndex: docIndex, readDocMaxChars: 60000 });
    await loop2.send("what is the stint parameter?", {});
    const toolMsg = client2.calls[1].messages.find((m) => m.role === "tool");
    assert.ok(toolMsg.content.length < 60000 + 500, "read_doc must honor the custom cap (got " + toolMsg.content.length + ")");
    assert.ok(toolMsg.content.length > 50000, "read_doc must use the larger custom cap (got " + toolMsg.content.length + ")");
});

test("history depth is configurable", async () => {
    const client = makeScriptedClient([{ content: "a", toolCalls: [] }]);
    const loop = makeLoop(client, { maxHistory: 3 });
    for (let i = 0; i < 5; i++) {
        const c = makeScriptedClient([{ content: "answer " + i, toolCalls: [] }]);
        const l = makeLoop(c, { maxHistory: 3 });
        await l.send("question " + i, {});
        const sys = c.calls[0].messages;
        // system + at most 3 history messages
        assert.ok(sys.length <= 4, "request must carry at most system + 3 messages, got " + sys.length);
    }
});
