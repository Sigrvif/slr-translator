// www/core/docsChat/tests/ChatClient.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ChatClient = require("../lib/ChatClient");

// Build a Response-like object whose reader yields the given SSE payload strings
// one per read(). `chunks` items are raw strings already shaped as SSE lines.
function sseResponse(chunks, opts) {
    opts = opts || {};
    let i = 0;
    return {
        ok: opts.ok !== false,
        status: opts.status || 200,
        headers: { get: () => "text/event-stream" },
        body: {
            getReader() {
                return {
                    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true })
                };
            }
        }
    };
}

function sse(obj) {
    return "data: " + JSON.stringify(obj) + "\n\n";
}

test("normalizeUrl mirrors EndpointHelpers.fixApiUrl", () => {
    assert.equal(ChatClient.normalizeUrl("127.0.0.1:1234", false), "https://127.0.0.1:1234/v1/chat/completions");
    assert.equal(ChatClient.normalizeUrl("http://127.0.0.1:1234/v1/chat/completions", false), "http://127.0.0.1:1234/v1/chat/completions");
    assert.equal(ChatClient.normalizeUrl("https://x.dev/api/responses", false), "https://x.dev/api/responses");
    assert.equal(ChatClient.normalizeUrl("anything", true), "anything");
});

test("streams content deltas and returns assembled content", async () => {
    const calls = [];
    const fetchImpl = async () => sseResponse([
        sse({ choices: [{ delta: { content: "Hel" } }] }),
        sse({ choices: [{ delta: { content: "lo " } }] }),
        sse({ choices: [{ delta: { content: "world" } }] }),
        sse({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } }),
        "data: [DONE]\n\n"
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const fragments = [];
    const res = await client.chat({
        url: "http://x/v1/chat/completions", apiKey: "k", model: "m",
        messages: [{ role: "user", content: "hi" }],
        onDelta: (t) => fragments.push(t)
    });
    assert.deepEqual(fragments, ["Hel", "lo ", "world"]);
    assert.equal(res.content, "Hello world");
    assert.equal(res.finishReason, "stop");
    assert.deepEqual(res.usage, { prompt_tokens: 3, completion_tokens: 3 });
    assert.deepEqual(res.toolCalls, []);
});

test("assembles tool-call arguments from fragments split across chunks", async () => {
    const fetchImpl = async () => sseResponse([
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_doc", arguments: "{\"page" } }] } }] }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '_id":"dslr"}' } }] } }] }),
        sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({
        url: "http://x/v1/chat/completions", model: "m",
        messages: [{ role: "user", content: "hi" }]
    });
    assert.deepEqual(res.toolCalls, [{ id: "call_1", name: "read_doc", args: { page_id: "dslr" } }]);
    assert.equal(res.finishReason, "tool_calls");
});

test("two parallel tool calls stay separated by index", async () => {
    const fetchImpl = async () => sseResponse([
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "list_docs", arguments: "{}" } }] } }] }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 1, id: "b", function: { name: "search_docs", arguments: "{\"query\":\"x\"}" } }] } }] }),
        "data: [DONE]\n\n"
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({ url: "http://x", model: "m", messages: [] });
    assert.equal(res.toolCalls.length, 2);
    assert.equal(res.toolCalls[0].name, "list_docs");
    assert.equal(res.toolCalls[1].name, "search_docs");
    assert.deepEqual(res.toolCalls[1].args, { query: "x" });
});

test("unparsable tool arguments become __parseError, never a throw", async () => {
    const fetchImpl = async () => sseResponse([
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "read_doc", arguments: "{oops" } }] } }] }),
        "data: [DONE]\n\n"
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({ url: "http://x", model: "m", messages: [] });
    assert.deepEqual(res.toolCalls[0].args, { __parseError: "{oops" });
});

test("HTTP 401 rejects with status and body attached", async () => {
    const fetchImpl = async () => ({
        ok: false, status: 401,
        headers: { get: () => "application/json" },
        text: async () => "{\"error\":{\"message\":\"bad key\"}}"
    });
    const client = ChatClient.createChatClient({ fetchImpl });
    await assert.rejects(
        () => client.chat({ url: "http://x", model: "m", messages: [] }),
        (e) => e.status === 401 && /bad key/.test(e.body)
    );
});

test("non-streaming JSON response is parsed (content + tool_calls)", async () => {
    const fetchImpl = async () => ({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({
            choices: [{
                message: {
                    content: "hi there",
                    tool_calls: [{ id: "c1", function: { name: "list_docs", arguments: "{}" } }]
                },
                finish_reason: "stop"
            }],
            usage: { prompt_tokens: 1, completion_tokens: 2 }
        })
    });
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({ url: "http://x", model: "m", messages: [], stream: false });
    assert.equal(res.content, "hi there");
    assert.deepEqual(res.toolCalls, [{ id: "c1", name: "list_docs", args: {} }]);
    assert.deepEqual(res.usage, { prompt_tokens: 1, completion_tokens: 2 });
});

test("reasoning deltas are separated from content", async () => {
    const fetchImpl = async () => sseResponse([
        sse({ choices: [{ delta: { reasoning_content: "thinking..." } }] }),
        sse({ choices: [{ delta: { content: "answer" } }] }),
        "data: [DONE]\n\n"
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({ url: "http://x", model: "m", messages: [] });
    assert.equal(res.content, "answer");
    assert.equal(res.reasoning, "thinking...");
});

test("Uint8Array chunks are decoded like strings", async () => {
    const enc = new TextEncoder();
    const fetchImpl = async () => sseResponse([
        enc.encode(sse({ choices: [{ delta: { content: "bytes" } }] })),
        enc.encode("data: [DONE]\n\n")
    ]);
    const client = ChatClient.createChatClient({ fetchImpl });
    const res = await client.chat({ url: "http://x", model: "m", messages: [] });
    assert.equal(res.content, "bytes");
});
