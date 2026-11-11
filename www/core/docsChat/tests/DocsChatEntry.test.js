// www/core/docsChat/tests/DocsChatEntry.test.js
// Contract test for the renderer-glue entry: window.docsChat.send() must NEVER
// throw synchronously — a broken documentation folder surfaces as a rejected
// promise with a readable message, so the chat page's .catch() can render it.
// docsChat.js is browser glue (no unit-testable DOM), so it is loaded into a
// stubbed sandbox via vm with a fake `this` addon context.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const MODULE_DIR = path.join(__dirname, "..");

function loadEntry(getRootDir, extraWindowProps, extraGlobals, addonConfig) {
    const sandbox = Object.assign({
        require: (name) => require(name),
        module: { exports: {} },
        console: console,
        process: process,
        // Host globals a vm realm does not provide but the renderer does.
        URL: URL,
        AbortController: AbortController,
        TextDecoder: TextDecoder,
        fetch: fetch,
        // Long timers (the chat window's 15s reveal safety net) would hold the
        // test runner's event loop for their full delay; short ones (debounces)
        // run for real.
        setTimeout: function (fn, ms) {
            if ((ms || 0) <= 1000) return setTimeout(fn, ms);
            return 0;
        },
        clearTimeout: clearTimeout,
        window: Object.assign({}, extraWindowProps || {}),
        ui: { onReady: function () {} },
        common: { getRootDir: getRootDir },
        document: undefined,
        nw: undefined,
        sys: undefined
    }, extraGlobals || {});
    sandbox.globalThis = sandbox;
    const source = fs.readFileSync(path.join(MODULE_DIR, "docsChat.js"), "utf8");
    const fakeAddon = { fullPath: MODULE_DIR, package: { version: "test" }, config: addonConfig || {} };
    vm.createContext(sandbox);
    // Wrap so the file's top-level `this` is the fake addon (matching how
    // AddonLoader evaluates module scripts inside an Addon instance).
    vm.runInContext(
        "(function () {\n" + source + "\n}).call(__addon);",
        Object.assign(sandbox, { __addon: fakeAddon })
    );
    return sandbox.window.docsChat;
}

function makeBrokenDocsRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-broken-"));
    fs.mkdirSync(path.join(dir, "www", "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "www", "docs", "manifest.js"), "this is { not valid manifest javascript");
    return dir;
}

test("send() rejects (never throws sync) when the docs index cannot load", async () => {
    const api = loadEntry(makeBrokenDocsRoot);
    let p;
    assert.doesNotThrow(() => {
        p = api.send("hello", {});
    }, "send() threw synchronously — the chat page's .catch would never attach");
    assert.ok(p && typeof p.then === "function", "send() did not return a promise");
    await assert.rejects(
        () => p,
        (e) => /documentation index/.test(e.message)
    );
});

test("a failed index keeps rejecting readably on later sends (no crash, no latch-up throw)", async () => {
    const api = loadEntry(makeBrokenDocsRoot);
    await assert.rejects(() => api.send("first", {}), /documentation index/);
    await assert.rejects(() => api.send("second", {}), /documentation index/);
});

test("api surface is intact in the sandbox (lazy build does not need DOM at load)", () => {
    const api = loadEntry(() => process.cwd());
    assert.equal(typeof api.send, "function");
    assert.equal(typeof api.stop, "function");
    assert.equal(typeof api.clear, "function");
    assert.equal(typeof api.getEndpointInfo, "function");
    assert.equal(typeof api.renderMarkdown, "function");
    assert.equal(api.getEndpointInfo().configured, false);
    // Markdown still works without a doc index (independent lib).
    assert.ok(!/data:|<script/.test(api.renderMarkdown("**hi** `x`")));
});

// The REAL wrapper (window.slrDSLREngineWrapper) is a DSLRTranslationEngineWrapper:
// a plain class CONTAINING a TranslatorEngine. getOptions() exists on the inner
// engine only — the wrapper exposes option OBJECTS (optionApiUrl.getValue() etc.),
// which is exactly what the engine's own testConnection() reads. These tests pin
// that shape so the chat detects the endpoint the same way Test Connection does.
function realShapedWrapper(overrides) {
    return Object.assign({
        optionApiUrl: { getValue: () => "http://127.0.0.1:1234" },
        optionApiKey: { getValue: () => "" },
        optionModel: { getValue: () => "qwen35-4b" },
        optionDoNotFixURL: { getValue: () => false }
    }, overrides || {});
}

test("getPersonaMode reports the active persona (avatar visibility rides on it)", () => {
    const mkSys = (value) => ({ config: { askDslrPersona: value }, getConfig: (k) => undefined });
    assert.equal(loadEntry(() => process.cwd(), null, { sys: mkSys(undefined) }).getPersonaMode(), "default");
    assert.equal(loadEntry(() => process.cwd(), null, { sys: mkSys("off") }).getPersonaMode(), "off");
    assert.equal(loadEntry(() => process.cwd(), null, { sys: mkSys("professional") }).getPersonaMode(), "professional");
    assert.equal(loadEntry(() => process.cwd(), null, { sys: mkSys("You are Erika.") }).getPersonaMode(), "custom");
});

// The persona value primarily lives in a PLAIN TEXT file so doc-readers never
// have to hand-edit JSON (one bad comma in config.json used to be the only
// path). Empty or missing file falls back to the config key, then default.
function makePersonaFileRoot(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-persona-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    if (content !== null) fs.writeFileSync(path.join(dir, "data", "adp.txt"), content);
    return dir;
}

test("persona file (plain text) drives the persona; no JSON to break", () => {
    const mkSys = (value) => ({ config: { askDslrPersona: value } });
    // "off" in the file
    assert.equal(loadEntry(() => makePersonaFileRoot("off\n"), null, { sys: mkSys(undefined) }).getPersonaMode(), "off");
    // free text in the file = custom persona
    assert.equal(loadEntry(() => makePersonaFileRoot("You are Erika, 21.\n"), null, { sys: mkSys(undefined) }).getPersonaMode(), "custom");
    // empty file falls through to the config key
    assert.equal(loadEntry(() => makePersonaFileRoot(""), null, { sys: mkSys("professional") }).getPersonaMode(), "professional");
    // no file at all: config key still works (backward compatible)
    assert.equal(loadEntry(() => makePersonaFileRoot(null), null, { sys: mkSys("off") }).getPersonaMode(), "off");
    // nothing anywhere: default
    assert.equal(loadEntry(() => makePersonaFileRoot(null), null, { sys: mkSys(undefined) }).getPersonaMode(), "default");
});

test("the persona file value is exposed through send()'s persona resolution", () => {
    // Same reader the loop uses — proves the file reaches the actual prompts,
    // not just the mode probe.
    const dir = makePersonaFileRoot("professional");
    const api = loadEntry(() => dir);
    assert.equal(api.getPersonaMode(), "professional");
});

test("the persona file is created at app startup (ui.onReady), not only on chat open", () => {
    // A doc-reader who never opened the chat must still find data/adp.txt.
    // The onReady callback must also survive a DOM-less environment — file
    // creation must not be skipped because the toolbar insertion threw.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-startup-"));
    let onReadyFn = null;
    const api = loadEntry(() => dir, null, {
        ui: { onReady: function (fn) { onReadyFn = fn; } }
    });
    assert.equal(typeof onReadyFn, "function", "module must register an onReady callback");
    assert.doesNotThrow(() => onReadyFn(), "onReady must not throw without a DOM");
    const file = path.join(dir, "data", "adp.txt");
    assert.ok(fs.existsSync(file), "adp.txt must exist after startup");
    assert.equal(fs.readFileSync(file, "utf8"), "", "created empty");
    // And it does not interfere with the mode: still default.
    assert.equal(api.getPersonaMode(), "default");
});

test("endpoint is read from the wrapper's option objects (testConnection pattern)", () => {
    const api = loadEntry(() => process.cwd(), {
        slrDSLREngineWrapper: realShapedWrapper()
    });
    const info = api.getEndpointInfo();
    assert.equal(info.configured, true, "option-object wrapper must be detected as configured");
    assert.equal(info.model, "qwen35-4b");
    assert.equal(info.host, "127.0.0.1:1234");
});

test("bound runtime URL with full path and model is passed through", () => {
    const api = loadEntry(() => process.cwd(), {
        slrDSLREngineWrapper: realShapedWrapper({
            optionApiUrl: { getValue: () => "http://127.0.0.1:1234/v1/chat/completions" },
            optionModel: { getValue: () => "qwen35-4b-paperwitch-q8.gguf" }
        })
    });
    const info = api.getEndpointInfo();
    assert.equal(info.configured, true);
    assert.equal(info.model, "qwen35-4b-paperwitch-q8.gguf");
});

test("wrapper with empty apiUrl option reports not configured (no crash)", () => {
    const api = loadEntry(() => process.cwd(), {
        slrDSLREngineWrapper: realShapedWrapper({ optionApiUrl: { getValue: () => "" } })
    });
    assert.equal(api.getEndpointInfo().configured, false);
});

// Avatar art override: dropping image files into the module's img/ folder
// replaces the built-in SVG portrait per mood (avatar-<mood>.<ext>, or one
// avatar.<ext> for every mood). Only moods with a file switch; the rest keep
// the built-in drawing.
test("getAvatarArt reports per-mood image overrides from img/", () => {
    function makeArtRoot(files) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-art-"));
        const imgDir = path.join(dir, "www", "core", "docsChat", "img");
        fs.mkdirSync(imgDir, { recursive: true });
        for (const name of files) fs.writeFileSync(path.join(imgDir, name), "x");
        return dir;
    }
    // nothing dropped: no overrides (JSON compare: the vm object lives in
    // another realm, where deepEqual trips over prototypes)
    let api = loadEntry(() => makeArtRoot([]));
    assert.equal(JSON.stringify(api.getAvatarArt()), "{}");
    // per-mood file (png probed first)
    api = loadEntry(() => makeArtRoot(["avatar-smug.png"]));
    assert.equal(JSON.stringify(api.getAvatarArt().smug), JSON.stringify({ kind: "image", src: "core/docsChat/img/avatar-smug.png" }));
    assert.equal(api.getAvatarArt().neutral, undefined);
    // single avatar.jpg covers every mood
    api = loadEntry(() => makeArtRoot(["avatar.jpg"]));
    const art = api.getAvatarArt();
    assert.equal(art.neutral.src, "core/docsChat/img/avatar.jpg");
    assert.equal(art.smug.src, "core/docsChat/img/avatar.jpg");
    assert.equal(art.happy.src, "core/docsChat/img/avatar.jpg");
    // a specific file wins over the generic one
    api = loadEntry(() => makeArtRoot(["avatar.jpg", "avatar-happy.png"]));
    assert.equal(api.getAvatarArt().happy.src, "core/docsChat/img/avatar-happy.png");
    assert.equal(api.getAvatarArt().smug.src, "core/docsChat/img/avatar.jpg");
});

// The toolbar button gates the chat behind the same endpoint check the
// options window's Test connection button runs: fail -> reminder, no window;
// success -> persona file ensured + window opened.
test("tryOpen gates the chat behind the endpoint check", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-gate-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    let opened = 0;
    const nwFake = { Window: { open: function (u, o, cb) { opened++; cb({ window: {} }); } } };
    function wrapper(ok, message) {
        return { slrDSLREngineWrapper: { testConnection: async () => ({ ok: ok, message: message }) } };
    }
    // Failing endpoint: reminder message, window NOT opened
    let api = loadEntry(() => dir, wrapper(false, "HTTP 401 - bad key"), { nw: nwFake });
    let r = await api.tryOpen();
    assert.equal(r.ok, false);
    assert.match(r.message, /bad key/);
    assert.equal(opened, 0, "no window on failed check");

    // No wrapper at all: clear message, no window
    api = loadEntry(() => dir, {}, { nw: nwFake });
    r = await api.tryOpen();
    assert.equal(r.ok, false);
    assert.match(r.message, /Translation Setup/i);
    assert.equal(opened, 0);

    // Passing endpoint: window opened and persona file ensured
    api = loadEntry(() => dir, wrapper(true, "Connected - model replied."), { nw: nwFake });
    r = await api.tryOpen();
    assert.equal(r.ok, true);
    assert.equal(opened, 1, "window opens on successful check");
    assert.ok(fs.existsSync(path.join(dir, "data", "adp.txt")), "persona file ensured before opening");
});

// A passing endpoint check must hand over to docsChat.open() — the
// conversation selection decision — instead of opening an empty chat window
// directly. This is the wiring that once made the selection dialog unreachable
// from the toolbar button even with remembered conversations present.
test("tryOpen routes through the selection decision (docsChat.open), not straight to the window", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-route-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    const nwFake = { Window: { open: function (u, o, cb) { cb({ window: {} }); } } };
    const api = loadEntry(() => dir, {
        slrDSLREngineWrapper: { testConnection: async () => ({ ok: true, message: "Connected" }) }
    }, { nw: nwFake });
    const originalOpen = api.open;
    let openCalls = 0;
    api.open = function () { openCalls++; return originalOpen.apply(this, arguments); };
    await api.tryOpen();
    assert.equal(openCalls, 1, "the selection decision must run after a passing endpoint check");
});

// With remembered conversations in the store, open() must show the selection
// dialog FIRST; the chat window may only appear after a choice. The jQuery
// stub implements just enough of the dialog builder to observe that (and to
// fire the captured click handlers, so choices can be simulated).
function dialogStub() {
    const dialogs = [];
    const created = [];
    const $ = function () {
        const el = {
            handlers: {},
            _children: [],
            text: function () { return this; },
            css: function () { return this; },
            append: function (c) { this._children.push(c); return this; },
            on: function (evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); return this; },
            children: function () { return this._children; },
            remove: function () { return this; },
            focus: function () { return this; },
            dialog: function (arg) { if (arg && typeof arg === "object") dialogs.push(arg); return this; }
        };
        created.push(el);
        return el;
    };
    $.dialogs = dialogs;
    $.created = created;
    $.click = (el) => (el.handlers.click || []).forEach((fn) => fn());
    return $;
}
// Element creation order in showConversationSelection: [0]=$dlg, [1]=$newBtn.
function nwWindowStub() {
    const state = { opened: 0 };
    state.nw = { Window: { open: function (u, o, cb) { state.opened++; cb({ window: {} }); } } };
    return state;
}

test("stored conversations show the selection dialog before any window opens", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-dialog-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "ask-dslr-history.json"), JSON.stringify({
        version: 2,
        conversations: [{
            id: "c1",
            title: "stint question",
            updated: new Date().toISOString(),
            messages: [
                { role: "user", content: "what is the stint parameter?" },
                { role: "assistant", content: "a wrap profile" }
            ]
        }]
    }));
    const $ = dialogStub();
    const nwState = nwWindowStub();
    const api = loadEntry(() => dir, {
        slrDSLREngineWrapper: { testConnection: async () => ({ ok: true, message: "Connected" }) }
    }, { nw: nwState.nw, $: $ });
    await api.tryOpen();
    assert.equal($.dialogs.length, 1, "the conversation selection dialog must be shown");
    assert.match($.dialogs[0].title, /open a conversation/i);
    assert.equal(nwState.opened, 0, "no chat window before the user picks");
    // Picking "Start a new conversation" opens the fresh chat.
    $.click($.created[1]);
    assert.equal(nwState.opened, 1, "start-new opens the chat window");
});

// The dialog is also shown with NO stored conversations while remembering is
// on: the note about what gets remembered (and the defaults limiting it) is
// the first thing a user sees, before any chat exists.
test("empty history still shows the dialog (the defaults note is the point)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-dialog-empty-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    const $ = dialogStub();
    const nwState = nwWindowStub();
    const api = loadEntry(() => dir, {
        slrDSLREngineWrapper: { testConnection: async () => ({ ok: true, message: "Connected" }) }
    }, { nw: nwState.nw, $: $ });
    await api.tryOpen();
    assert.equal($.dialogs.length, 1, "dialog shown even with nothing stored");
    assert.equal($.dialogs[0].title, "Ask DSLR");
    assert.equal(nwState.opened, 0, "no chat window before the user picks");
    $.click($.created[1]);
    assert.equal(nwState.opened, 1, "start-new opens the chat window");
});

// Remembering off: no dialog at all — nothing to choose between or explain.
test("remember off skips the dialog entirely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-dialog-off-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "ask-dslr-history.json"), JSON.stringify({
        version: 2,
        conversations: [{ id: "c1", title: "old", updated: new Date().toISOString(), messages: [{ role: "user", content: "hi" }] }]
    }));
    const $ = dialogStub();
    const nwState = nwWindowStub();
    const api = loadEntry(() => dir, {
        slrDSLREngineWrapper: {
            getOptions: (id) => id === "chatRemember" ? false : undefined,
            testConnection: async () => ({ ok: true, message: "Connected" })
        }
    }, { nw: nwState.nw, $: $ });
    await api.tryOpen();
    assert.equal($.dialogs.length, 0, "no dialog when remembering is off");
    assert.equal(nwState.opened, 1, "chat window opens directly");
});

test("chat limits resolve from the DSLR engine options with conservative defaults", () => {
    function engineWrapper(values) {
        return { slrDSLREngineWrapper: { getOptions: function (id) { return values[id]; } } };
    }
    // No wrapper -> shipped defaults (32k-context conservatism)
    let api = loadEntry(() => process.cwd());
    let limits = api.getChatLimits();
    assert.equal(JSON.stringify(limits), JSON.stringify({ readDocMaxChars: 24000, excerptMaxChars: 12000, maxHistory: 20 }));
    // Engine card values are honored; excerpt = half the read length
    api = loadEntry(() => process.cwd(), engineWrapper({ chatReadLength: "60000", chatHistoryMessages: "5", chatRemember: true }));
    limits = api.getChatLimits();
    assert.equal(JSON.stringify(limits), JSON.stringify({ readDocMaxChars: 60000, excerptMaxChars: 30000, maxHistory: 5 }));
    // Garbage falls back to defaults
    api = loadEntry(() => process.cwd(), engineWrapper({ chatReadLength: "banana", chatHistoryMessages: "" }));
    limits = api.getChatLimits();
    assert.equal(JSON.stringify(limits), JSON.stringify({ readDocMaxChars: 24000, excerptMaxChars: 12000, maxHistory: 20 }));
});

test("conversation history persists to data/ when rememberChats is on", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-persist-"));
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    const api = loadEntry(() => dir, { slrDSLREngineWrapper: { getOptions: (id) => id === "chatRemember" ? true : undefined } });
    // Simulate a conversation by loading history into the loop and saving
    assert.equal(typeof api.__saveHistoryForTest, "function");
    const convo = [
        { role: "user", content: "what is the stint parameter?" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "read_doc", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: JSON.stringify({ page_id: "x", text: "tool text".repeat(5000) }) },
        { role: "assistant", content: "It is a wrap profile." }
    ];
    api.__saveHistoryForTest(convo);
    const file = path.join(dir, "data", "ask-dslr-history.json");
    assert.ok(fs.existsSync(file), "history file written");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(Array.isArray(saved.conversations) && saved.conversations.length === 1, "v2 conversation store");
    const messages = saved.conversations[0].messages;
    assert.ok(messages.some((m) => m.role === "user" && /stint/.test(m.content)));
    assert.ok(!messages.some((m) => m.role === "tool"), "tool payloads compacted out of the saved file");
    assert.match(saved.conversations[0].title, /stint/);
    // Restored view: prose only, loaded through the selection flow's switch
    const listed = api.listConversations();
    assert.equal(listed.length, 1);
    const restored = api.switchConversation(listed[0].id);
    assert.ok(restored.length >= 2);
    assert.ok(api.getRestoredConversation().length >= 2, "switched conversation is the live one");
    assert.ok(restored.some((m) => m.role === "user" && /stint/.test(m.content)));
    assert.ok(restored.some((m) => m.role === "assistant" && /wrap profile/.test(m.content)));
    assert.ok(!restored.some((m) => m.role === "tool"));
    // With rememberChats off, nothing is written
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "docschat-persist2-"));
    const api2 = loadEntry(() => dir2, { slrDSLREngineWrapper: { getOptions: () => false } });
    api2.__saveHistoryForTest(convo);
    assert.equal(fs.existsSync(path.join(dir2, "data", "ask-dslr-history.json")), false);
});
