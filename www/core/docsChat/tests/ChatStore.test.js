// www/core/docsChat/tests/ChatStore.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ChatStore = require("../lib/ChatStore");

function tmpFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatstore-"));
    return path.join(dir, "ask-dslr-history.json");
}

const MSGS = [
    { role: "user", content: "what is the stint parameter?" },
    { role: "assistant", content: "It is a wrap profile." }
];

test("an empty or missing store lists nothing", () => {
    const file = tmpFile();
    assert.deepEqual(ChatStore.listConversations(ChatStore.loadStore(file)), []);
});

test("conversations round-trip: upsert, list, load prose", () => {
    const file = tmpFile();
    let store = ChatStore.loadStore(file);
    store = ChatStore.upsertConversation(store, { title: null, messages: MSGS });
    const second = [
        { role: "user", content: "pancake recipe?" },
        { role: "assistant", content: "Flour, milk, egg." }
    ];
    store = ChatStore.upsertConversation(store, { title: null, messages: second });
    ChatStore.saveStore(file, store);

    const reloaded = ChatStore.loadStore(file);
    const list = ChatStore.listConversations(reloaded);
    assert.equal(list.length, 2);
    assert.equal(list[0].title, "pancake recipe?"); // most recent first
    assert.equal(list[1].title, "what is the stint parameter?");

    const prose = ChatStore.loadProse(reloaded, list[1].id);
    assert.equal(prose.length, 2);
    assert.ok(prose.some((m) => m.role === "user" && /stint/.test(m.content)));
});

test("upsert with an id updates the same conversation instead of adding", () => {
    const file = tmpFile();
    let store = ChatStore.loadStore(file);
    store = ChatStore.upsertConversation(store, { title: null, messages: MSGS });
    const id = ChatStore.listConversations(store)[0].id;
    store = ChatStore.upsertConversation(store, { id: id, title: null, messages: MSGS.concat([{ role: "user", content: "more" }]) });
    const list = ChatStore.listConversations(store);
    assert.equal(list.length, 1);
    assert.equal(ChatStore.loadProse(store, id).length, 3);
});

test("tool payloads and empty assistant turns are never stored", () => {
    const file = tmpFile();
    let store = ChatStore.loadStore(file);
    store = ChatStore.upsertConversation(store, {
        title: null,
        messages: MSGS.concat([
            { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
            { role: "tool", tool_call_id: "c1", content: JSON.stringify({ page_id: "x", text: "big".repeat(9000) }) },
            { role: "assistant", content: "Done." }
        ])
    });
    const id = ChatStore.listConversations(store)[0].id;
    const prose = ChatStore.loadProse(store, id);
    assert.ok(!prose.some((m) => m.role === "tool"));
    assert.ok(!prose.some((m) => m.content.length > 200));
});

test("only the newest N conversations are kept", () => {
    let store = ChatStore.loadStore(tmpFile());
    for (let i = 0; i < 25; i++) {
        store = ChatStore.upsertConversation(store, { title: "conv " + i, messages: [{ role: "user", content: "q" + i }] });
    }
    store = ChatStore.prune(store, 20);
    const list = ChatStore.listConversations(store);
    assert.equal(list.length, 20);
    assert.equal(list[0].title, "conv 24"); // newest survives
    assert.equal(list[19].title, "conv 5");
});

test("the legacy single-history format migrates into one conversation", () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify(MSGS), "utf8");
    const store = ChatStore.loadStore(file);
    const list = ChatStore.listConversations(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "what is the stint parameter?");
    assert.equal(ChatStore.loadProse(store, list[0].id).length, 2);
});

test("deleting a conversation works and unknown ids are safe", () => {
    let store = ChatStore.loadStore(tmpFile());
    store = ChatStore.upsertConversation(store, { title: null, messages: MSGS });
    const id = ChatStore.listConversations(store)[0].id;
    store = ChatStore.removeConversation(store, id);
    assert.equal(ChatStore.listConversations(store).length, 0);
    store = ChatStore.removeConversation(store, "nope"); // must not throw
    assert.equal(ChatStore.listConversations(store).length, 0);
});
