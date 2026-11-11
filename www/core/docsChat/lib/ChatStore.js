// www/core/docsChat/lib/ChatStore.js
// Conversation archive for the "Ask DSLR" chat: several topic-scoped
// conversations in one JSON file (data/ask-dslr-history.json), prose only —
// tool payloads are large and re-derivable and are never stored. Node-safe
// (real fs) so it is fully unit-testable.
//
// File format v2: { version: 2, conversations: [{ id, title, updated, messages }] }
// The legacy v1 format (a plain message array, the original rolling history)
// migrates into a single conversation on load.
"use strict";
const fs = require("fs");

const KEEP_CONVERSATIONS = 20;

// Monotonic timestamp: several conversations can be upserted within the same
// millisecond (tests, quick switches) and "most recent" must stay well-defined.
// Never below the wall clock, and never below the previous stamp — same-ms
// offsets must not leak above the next millisecond's base.
let _lastStamp = 0;
function nowStamp() {
    let n = Date.now();
    if (n <= _lastStamp) n = _lastStamp + 1;
    _lastStamp = n;
    return n;
}

function emptyStore() {
    return { version: 2, conversations: [] };
}

// Prose-only projection: user turns and assistant turns that said something.
function proseOnly(messages) {
    return (messages || []).filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" && m.content !== "";
    }).map(function (m) {
        return { role: m.role, content: m.content };
    });
}

function titleFrom(messages) {
    const first = (messages || []).find(function (m) { return m.role === "user" && m.content; });
    if (!first) return "conversation";
    let t = String(first.content).replace(/\s+/g, " ").trim();
    if (t.length > 40) t = t.slice(0, 40) + "…";
    return t || "conversation";
}

function loadStore(file) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        return emptyStore();
    }
    if (Array.isArray(raw)) {
        // v1 rolling history -> one conversation
        const prose = proseOnly(raw);
        if (!prose.length) return emptyStore();
        return {
            version: 2,
            conversations: [{
                id: String(Date.now()),
                title: titleFrom(raw),
                updated: nowStamp(),
                messages: prose
            }]
        };
    }
    if (raw && Array.isArray(raw.conversations)) {
        return { version: 2, conversations: raw.conversations.filter(function (c) { return c && c.id && Array.isArray(c.messages); }) };
    }
    return emptyStore();
}

function saveStore(file, store) {
    fs.mkdirSync(require("path").dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(store), "utf8");
}

// Add or update a conversation. With id: update in place (keeping its title
// unless a new one is given). Without: create, titled from the first message.
function upsertConversation(store, opts) {
    const s = store || emptyStore();
    const messages = proseOnly((opts && opts.messages) || []);
    if (!messages.length) return s; // nothing worth keeping
    if (opts && opts.id) {
        for (let i = 0; i < s.conversations.length; i++) {
            if (s.conversations[i].id === opts.id) {
                s.conversations[i].messages = messages;
                s.conversations[i].updated = nowStamp();
                if (opts.title) s.conversations[i].title = opts.title;
                return s;
            }
        }
    }
    s.conversations.push({
        id: String(nowStamp()) + "-" + Math.floor(Math.random() * 1e6),
        title: (opts && opts.title) || titleFrom(messages),
        updated: nowStamp(),
        messages: messages
    });
    return s;
}

function listConversations(store) {
    const s = store || emptyStore();
    return s.conversations.slice().sort(function (a, b) { return b.updated - a.updated; })
        .map(function (c) { return { id: c.id, title: c.title, updated: c.updated }; });
}

function loadProse(store, id) {
    const s = store || emptyStore();
    const c = s.conversations.find(function (x) { return x.id === id; });
    return c ? c.messages.slice() : [];
}

function removeConversation(store, id) {
    const s = store || emptyStore();
    s.conversations = s.conversations.filter(function (c) { return c.id !== id; });
    return s;
}

function prune(store, keep) {
    const s = store || emptyStore();
    const n = keep === undefined ? KEEP_CONVERSATIONS : keep;
    if (s.conversations.length <= n) return s;
    s.conversations.sort(function (a, b) { return b.updated - a.updated; });
    s.conversations = s.conversations.slice(0, n);
    return s;
}

module.exports = {
    KEEP_CONVERSATIONS: KEEP_CONVERSATIONS,
    emptyStore: emptyStore,
    proseOnly: proseOnly,
    loadStore: loadStore,
    saveStore: saveStore,
    upsertConversation: upsertConversation,
    listConversations: listConversations,
    loadProse: loadProse,
    removeConversation: removeConversation,
    prune: prune
};
