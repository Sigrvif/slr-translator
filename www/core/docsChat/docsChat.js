// www/core/docsChat/docsChat.js
// "Ask DSLR a Question" — chat window that talks to the configured DSLR endpoint
// with tool access to the built-in documentation (www/docs/).
//
// Entry point of the docsChat core module: inserts the toolbar button, owns the
// singleton chat window, and exposes the window.docsChat API the chat page uses.
// Everything heavy (doc index, client, loop) is built lazily on first use, the
// same loadability discipline as llmRuntime.js — a failure inside the chain must
// never take the whole module (and the toolbar button) down with it.
"use strict";
var thisAddon = this;
var nwPath = require("path");
var fs = require("fs");

var addonDir = nwPath.resolve(thisAddon.fullPath);
function lib(name) { return require(nwPath.join(addonDir, "lib", name)); }

var PERSONA_CONFIG_KEY = "askDslrPersona";

// Chat settings live in the DSLR engine card (chatReadLength /
// chatHistoryMessages / chatRemember, declared next to the runtime settings)
// because the chat talks to this engine's endpoint. They are read through the
// wrapper's option chain; the conservative defaults mirror the declarations.
function engineOption(id) {
    // Live option object first (the same reader style as getModel/testConnection):
    // setValue on the option object must be seen immediately, while getOptions
    // resolves through the stored config chain and can lag a live change.
    try {
        var wrapper = window.slrDSLREngineWrapper;
        if (wrapper) {
            var opt = wrapper["option" + id.charAt(0).toUpperCase() + id.slice(1)];
            if (opt && typeof opt.getValue === "function") return opt.getValue();
            if (typeof wrapper.getOptions === "function") return wrapper.getOptions(id);
        }
    } catch (e) { /* wrapper not ready */ }
    return undefined;
}

function chatRememberEnabled() {
    // Defaults to ON: only an explicit false (stored or the checkbox) turns
    // remembering off.
    var v = engineOption("chatRemember");
    return v !== false && v !== "false";
}

function chatKeepCount() {
    var n = parseInt(engineOption("chatKeepCount"), 10);
    return (isFinite(n) && n >= 1) ? n : 20;
}

function chatHistoryFile() {
    return nwPath.join(rootDir(), "data", "ask-dslr-history.json");
}

function getChatLimits() {
    var read = parseInt(engineOption("chatReadLength"), 10);
    var hist = parseInt(engineOption("chatHistoryMessages"), 10);
    var readDocMaxChars = (isFinite(read) && read > 0) ? read : 24000;
    return {
        readDocMaxChars: readDocMaxChars,
        excerptMaxChars: Math.floor(readDocMaxChars / 2),
        maxHistory: (isFinite(hist) && hist > 0) ? hist : 20
    };
}
// The persona value primarily lives in this PLAIN TEXT file (created empty on
// first chat open): doc-readers must not have to hand-edit config.json — one
// bad comma there breaks the whole app, while garbage in this file only makes
// the assistant act odd until the file is emptied again. The deliberately
// cryptic name keeps casual browsers of data/ from connecting it to the chat
// (garbage WOULD replace the joke persona until emptied) — the documentation
// names it, and that is the only non-chat place that does.
var PERSONA_FILE = "adp.txt";

function personaFilePath() {
    return nwPath.join(rootDir(), "data", PERSONA_FILE);
}

function rootDir() {
    try {
        if (typeof common !== "undefined" && common.getRootDir) return common.getRootDir();
    } catch (err) { /* fall through to the process working directory */ }
    try { return process.cwd(); } catch (err) { return "."; }
}

// ---------------------------------------------------------------------------
// Lazy singleton: doc index + client + loop
// ---------------------------------------------------------------------------

var _chat = null;
var _chatError = null;
var _tried = false;
var _chatSignature = null;

function getPersonaValue() {
    // File first (plain text, trimmed; empty = not set), then the config key.
    try {
        var file = personaFilePath();
        if (fs.existsSync(file)) {
            var text = fs.readFileSync(file, "utf8").trim();
            if (text !== "") return text;
        }
    } catch (e) { /* unreadable file - fall through to config */ }
    try {
        if (typeof sys !== "undefined" && sys.config) return sys.config[PERSONA_CONFIG_KEY] || "";
    } catch (e) { /* config not ready */ }
    return "";
}

// Best-effort: make the persona file exist (empty) so a user who read the
// documentation only has to open it and type, not create it.
function ensurePersonaFile() {
    try {
        var file = personaFilePath();
        if (!fs.existsSync(file)) {
            fs.mkdirSync(nwPath.dirname(file), { recursive: true });
            fs.writeFileSync(file, "", "utf8");
        }
    } catch (e) { /* read-only install - the docs path still works as text */ }
}

// Read the DSLR engine's endpoint settings. The wrapper global is exposed by the
// engine itself (DSLREngine.js, window.slrDSLREngineWrapper) precisely so sibling
// modules can reach it; read lazily at interaction time — this module loads
// alphabetically before SLRtrans constructs the engine.
//
// IMPORTANT: the wrapper is a DSLRTranslationEngineWrapper, a plain class that
// CONTAINS a TranslatorEngine (wrapper.getEngine()). getOptions() exists on the
// inner engine only, NOT on the wrapper — calling it here was the bug behind
// "No DSLR endpoint is configured" showing while Test Connection worked. The
// wrapper exposes option OBJECTS (optionApiUrl.getValue() etc.), which is
// exactly what the engine's own testConnection() reads; this mirrors it.
function getModel() {
    var empty = { url: "", apiKey: "", model: "" };
    try {
        var wrapper = window.slrDSLREngineWrapper;
        if (!wrapper || !wrapper.optionApiUrl || typeof wrapper.optionApiUrl.getValue !== "function") {
            return empty;
        }
        function opt(name) {
            return wrapper[name] && typeof wrapper[name].getValue === "function"
                ? wrapper[name].getValue()
                : "";
        }
        var ChatClient = lib("ChatClient");
        return {
            url: ChatClient.normalizeUrl(opt("optionApiUrl"), opt("optionDoNotFixURL") === true),
            apiKey: opt("optionApiKey") || "",
            model: opt("optionModel") || ""
        };
    } catch (e) {
        console.error("[docsChat] could not read the DSLR endpoint settings:", e);
        return empty;
    }
}

function getEndpointInfo() {
    var model = getModel();
    var host = "";
    if (model.url) {
        try { host = new URL(model.url).host; } catch (e) { host = ""; }
    }
    return { configured: !!model.url, model: model.model, host: host };
}

function ensureChat() {
    if (_tried && !_chatError && _chat) {
        // Option changes take effect on the next open: rebuild the loop with
        // the new limits, carrying the conversation over.
        var sig = getChatLimits().readDocMaxChars + ":" + getChatLimits().maxHistory;
        if (sig !== _chatSignature) {
            var carry = _chat.loop.history.slice();
            _chat = null;
            _tried = false;
            var rebuilt = ensureChat();
            rebuilt.loop.loadHistory(carry);
            return rebuilt;
        }
        return _chat;
    }
    if (_tried) {
        if (_chatError) throw _chatError;
        return _chat;
    }
    _tried = true;
    try {
        var DocIndex = lib("DocIndex");
        var ChatClient = lib("ChatClient");
        var ToolLoop = lib("ToolLoop");
        var docIndex = new DocIndex({
            docsRoot: nwPath.join(rootDir(), "www", "docs"),
            // addon docs (www/addons/*/package.json "docs" field) join the index
            addonsRoot: nwPath.join(rootDir(), "www", "addons")
        });
        // init() is synchronous inside (readFileSync) — defer it onto a promise
        // so a broken docs folder becomes a readable rejection instead of a
        // synchronous throw that escapes this constructor-shaped block and
        // latches the module in a half-built state.
        var initPromise = Promise.resolve().then(function () {
            return docIndex.init();
        }).catch(function (err) {
            _chatError = new Error("Could not load the documentation index: " + (err && err.message ? err.message : err));
            throw _chatError;
        });
        // Paths that never send (a broken docs folder + a peek at the restored
        // conversation) must not leave this rejection unhandled; send() still
        // sees it through its own .then chain.
        initPromise.catch(function () { /* observed by send() */ });
        var client = ChatClient.createChatClient({});
        var limits = getChatLimits();
        var loop = ToolLoop.createToolLoop({
            client: client,
            docIndex: docIndex,
            getPersonaValue: getPersonaValue,
            getModel: getModel,
            readDocMaxChars: limits.readDocMaxChars,
            excerptMaxChars: limits.excerptMaxChars,
            maxHistory: limits.maxHistory
        });
        _chatSignature = limits.readDocMaxChars + ":" + limits.maxHistory;
        _chat = {
            initPromise: initPromise,
            loop: loop
        };
    } catch (e) {
        _chatError = e;
        throw e;
    }
    return _chat;
}

// Conversation archive: several topic-scoped conversations in one file, so a
// small follow-up on an old topic does not drag an unrelated rolling history
// into the context. Prose only (tool payloads are re-derivable). The id of
// the conversation currently open in the window; null = a fresh unnamed one.
var _currentConversationId = null;

function saveCurrentConversation() {
    if (!chatRememberEnabled()) return;
    if (!_chat) return;
    try {
        var ChatStore = lib("ChatStore");
        var store = ChatStore.prune(ChatStore.upsertConversation(
            ChatStore.loadStore(chatHistoryFile()),
            { id: _currentConversationId, messages: _chat.loop.history }
        ), chatKeepCount());
        ChatStore.saveStore(chatHistoryFile(), store);
        // A conversation created by this save (New chat -> first save) must be
        // adopted as the current one, or every later save would duplicate it.
        if (_currentConversationId === null) {
            var recent = ChatStore.listConversations(store)[0];
            if (recent) _currentConversationId = recent.id;
        }
    } catch (e) { /* best effort */ }
}

// Loads a stored conversation into the live loop (prose only) and returns it.
function loadConversation(id) {
    var chat = ensureChat(); // switching can be the first thing that ever builds the loop
    var ChatStore = lib("ChatStore");
    var prose = ChatStore.loadProse(ChatStore.loadStore(chatHistoryFile()), id);
    chat.loop.loadHistory(prose);
    return prose;
}

// ---------------------------------------------------------------------------
// window.docsChat — the API the chat page (www/docsChat.html) consumes
// ---------------------------------------------------------------------------

window.docsChat = {
    version: thisAddon.package.version,
    PERSONA_CONFIG_KEY: PERSONA_CONFIG_KEY,

    open: function () { decideSelectionAndOpen(); },
    tryOpen: tryOpen,

    send: function (text, handlers) {
        var chat;
        try {
            chat = ensureChat();
        } catch (e) {
            // Build failures (missing libs, unreadable docs root) must surface
            // as rejections: the chat page attaches .catch() after this returns.
            return Promise.reject(e);
        }
        var loop = chat.loop;
        return chat.initPromise.then(function () {
            return loop.send(text, handlers || {});
        });
    },

    stop: function () {
        try { ensureChat().loop.stop(); } catch (e) { /* not built yet — nothing to stop */ }
    },

    clear: function () {
        try { ensureChat().loop.clear(); } catch (e) { /* not built yet */ }
    },

    getEndpointInfo: getEndpointInfo,

    // The chat page shows the avatar only for the shipped default (joke)
    // persona — professional/off/custom replace the character, so the
    // portrait goes away with her.
    getChatLimits: getChatLimits,

    // Prose-only view of the restored/kept conversation, for the page to re-render.
    getRestoredConversation: function () {
        try {
            return lib("ChatStore").proseOnly(ensureChat().loop.history);
        } catch (e) {
            return [];
        }
    },

    listConversations: function () {
        if (!chatRememberEnabled()) return [];
        try {
            return lib("ChatStore").listConversations(lib("ChatStore").loadStore(chatHistoryFile()));
        } catch (e) { return []; }
    },

    // Switch the live window to a stored conversation. The current one is
    // saved first so switching away never loses it.
    switchConversation: function (id) {
        saveCurrentConversation();
        _currentConversationId = id;
        return loadConversation(id);
    },

    deleteConversation: function (id) {
        try {
            var ChatStore = lib("ChatStore");
            var store = ChatStore.removeConversation(ChatStore.loadStore(chatHistoryFile()), id);
            ChatStore.saveStore(chatHistoryFile(), store);
        } catch (e) { /* best effort */ }
        if (_currentConversationId === id) {
            _currentConversationId = null;
            try { if (_chat) _chat.loop.clear(); } catch (e) {}
        }
        return true;
    },

    // Starting a fresh conversation: the current one is saved under its own id.
    beginNewConversation: function () {
        saveCurrentConversation();
        _currentConversationId = null;
        try { if (_chat) _chat.loop.clear(); } catch (e) {}
    },

    __saveHistoryForTest: function (history) {
        if (!chatRememberEnabled()) return;
        _currentConversationId = null;
        try {
            var ChatStore = lib("ChatStore");
            var store = ChatStore.prune(ChatStore.upsertConversation(
                ChatStore.loadStore(chatHistoryFile()), { messages: history }), chatKeepCount());
            ChatStore.saveStore(chatHistoryFile(), store);
        } catch (e) { /* best effort */ }
    },

    getPersonaMode: function () {
        try {
            return lib("Persona").resolvePersona(getPersonaValue()).mode;
        } catch (e) {
            return "default";
        }
    },

    renderMarkdown: function (text) {
        return lib("Markdown").render(text);
    },

    // Which avatar expressions have a user-dropped replacement image in the
    // module's img/ folder. Per mood: avatar-<mood>.<ext>; a single
    // avatar.<ext> stands in for every mood that has no specific file. Only
    // moods with a file switch — the rest keep the built-in drawing.
    getAvatarArt: function () {
        var out = {};
        var moods = ["neutral", "smug", "happy"];
        var exts = ["png", "jpg", "jpeg", "webp", "gif"];
        function find(name) {
            for (var j = 0; j < exts.length; j++) {
                var rel = "core/docsChat/img/" + name + "." + exts[j];
                try {
                    if (fs.existsSync(nwPath.join(rootDir(), "www", rel))) return rel;
                } catch (e) { /* probe failed */ }
            }
            return null;
        }
        var generic = find("avatar");
        for (var i = 0; i < moods.length; i++) {
            var rel = find("avatar-" + moods[i]) || generic;
            if (rel) out[moods[i]] = { kind: "image", src: rel };
        }
        return out;
    }
};

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

function insertToolbarButton() {
    var group = document.querySelector('.toolbar-content[data-id="toolbar-tools"]');
    if (!group || group.querySelector(".askDslrBtn")) return;
    var wrench = group.querySelector(".toolsMenuBtn");
    var btn = document.createElement("button");
    btn.className = "menu-button askDslrBtn";
    btn.title = "Ask DSLR a Question - chat with your configured DSLR endpoint. It reads the documentation so you don't have to.";
    // Responsive-label metadata (ui.toolbarLabelFit): the group only collapses
    // labels when marked data-responsive-labels, and only buttons carrying
    // data-label participate. Priority 5 = least sticky in this group's
    // convention (lower number = hidden later; workflow buttons use 1-4).
    if (!group.hasAttribute("data-responsive-labels")) {
        group.setAttribute("data-responsive-labels", "true");
    }
    btn.setAttribute("data-button-id", "askDslr");
    btn.setAttribute("data-label", "Ask DSLR");
    btn.setAttribute("data-label-priority", "5");
    btn.innerHTML = '<i class="icon-chat"></i><span class="menu-button-label">Ask DSLR</span>';
    var checkingLabel = '<i class="icon-chat"></i><span class="menu-button-label">Checking\u2026</span>';
    btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true;
        var restore = btn.innerHTML;
        btn.innerHTML = checkingLabel;
        function done() {
            btn.disabled = false;
            btn.innerHTML = restore;
        }
        Promise.resolve().then(tryOpen).then(function (r) {
            done();
            if (!r.ok) {
                alert("Ask DSLR could not reach your DSLR endpoint:\n\n" + r.message +
                    "\n\nSet up or start your endpoint first \u2014 Translation Setup (step 1), or start the bundled local runtime \u2014 then try again.");
            }
        }).catch(function (e) {
            done();
            console.error("[docsChat] endpoint check failed:", e);
            alert("Ask DSLR could not check the endpoint:\n\n" + ((e && e.message) || e));
        });
    });
    if (wrench) {
        group.insertBefore(btn, wrench);
    } else {
        group.appendChild(btn);
    }
    if (typeof ui !== "undefined" && ui.toolbarLabelFit && typeof ui.toolbarLabelFit.apply === "function") {
        ui.toolbarLabelFit.apply(group);
    }
}

// ---------------------------------------------------------------------------
// Conversation selection (shown instead of opening straight into the chat
// when Remember chat conversations is on — even with nothing stored yet, so
// the note about what gets remembered (and the defaults limiting it) is the
// first thing the user sees, not something that appears only after a chat)
// ---------------------------------------------------------------------------

function decideSelectionAndOpen() {
    var list = [];
    var remember = chatRememberEnabled();
    if (remember) {
        try {
            // Enforce the keep limit at read time too, so the dialog (and any
            // hand-edited or restored store) shows exactly what would be kept.
            var ChatStore = lib("ChatStore");
            var store = ChatStore.prune(ChatStore.loadStore(chatHistoryFile()), chatKeepCount());
            ChatStore.saveStore(chatHistoryFile(), store);
            list = ChatStore.listConversations(store);
        } catch (e) { list = []; }
    }
    // Remembering off: there is nothing to choose between or explain, so the
    // button goes straight to the chat.
    if (!remember || typeof $ === "undefined") {
        openChatWindow(null);
        return;
    }
    showConversationSelection(list);
}

function showConversationSelection(list) {
    var $dlg = $("<div></div>").css({ "font-size": "14px", "line-height": "1.5" });
    var $newBtn = $("<button type='button'></button>")
        .text("Start a new conversation")
        .css({ display: "block", width: "100%", "margin-bottom": "12px", padding: "9px 10px", "font-size": "14px" });
    $newBtn.on("click", function () { $dlg.dialog("close"); openChatWindow(null); });
    $dlg.append($newBtn);
    var $list = $("<div></div>");
    for (var i = 0; i < list.length; i++) {
        (function (entry) {
            var when = new Date(entry.updated).toLocaleString();
            var $row = $("<div></div>").css({ display: "flex", "align-items": "center", gap: "4px", "margin-bottom": "4px" });
            var $open = $("<button type='button'></button>")
                .text(entry.title + "  \u2014  " + when)
                .css({ flex: "1", "text-align": "left", padding: "9px 9px", "font-size": "14px" });
            $open.on("click", function () { $dlg.dialog("close"); openChatWindow(entry.id); });
            var $del = $("<button type='button' title='Delete this conversation'></button>")
                .text("\u2715")
                .css({ flex: "0 0 auto", padding: "9px 10px", "font-size": "14px" });
            $del.on("click", function () {
                try {
                    var ChatStore = lib("ChatStore");
                    ChatStore.saveStore(chatHistoryFile(), ChatStore.removeConversation(ChatStore.loadStore(chatHistoryFile()), entry.id));
                    if (_currentConversationId === entry.id) {
                        _currentConversationId = null;
                        if (_chat) _chat.loop.clear();
                    }
                } catch (e) { /* best effort */ }
                $row.remove();
                if (!$list.children().length) { $dlg.dialog("close"); openChatWindow(null); }
            });
            $row.append($open).append($del);
            $list.append($row);
        })(list[i]);
    }
    $dlg.append($list);
    // The note is the point of showing this dialog before any chat exists:
    // it names the actual limits in force, so the defaults restricting how
    // much of a conversation is kept and re-sent are seen up front.
    $dlg.append($("<div></div>")
        .css({ "margin-top": "12px", "font-size": "13px", color: "#777" })
        .text("Chats are remembered as plain text only \u2014 pages the assistant reads from the manual are not stored. The " + chatKeepCount() + " most recent conversations are kept, and only the last " + getChatLimits().maxHistory + " messages of a conversation are sent back to the model. These defaults can be changed in the DSLR options."));
    $dlg.dialog({
        title: list.length ? "Ask DSLR \u2014 open a conversation?" : "Ask DSLR",
        modal: true,
        width: 540,
        maxHeight: 560,
        close: function () { $dlg.dialog("destroy").remove(); }
    });
    // Focus the default action so Enter starts a new chat.
    try { $newBtn.focus(); } catch (e) { /* focus is a nicety */ }
}

// ---------------------------------------------------------------------------
// Connection gate + singleton window
// ---------------------------------------------------------------------------

// The toolbar button opens the chat through this: it runs the engine's own
// testConnection() (the same check the options window's Test connection button
// uses), so the assistant never greets anyone whose endpoint is dead. The
// caller shows the reminder on failure; success ensures the persona file and
// hands over to docsChat.open(), which decides between the conversation
// selection dialog (remembered conversations exist) and a fresh chat window.
async function tryOpen() {
    var wrapper = window.slrDSLREngineWrapper;
    if (!wrapper || typeof wrapper.testConnection !== "function") {
        return { ok: false, message: "No DSLR engine endpoint found. Configure Translation Setup first.", opened: false };
    }
    var result;
    try {
        result = await wrapper.testConnection();
    } catch (e) {
        return { ok: false, message: (e && e.message) ? e.message : String(e), opened: false };
    }
    if (!result || !result.ok) {
        return { ok: false, message: (result && result.message) ? result.message : "endpoint check failed", opened: false };
    }
    ensurePersonaFile();
    window.docsChat.open();
    return { ok: true, message: (result && result.message) || "", opened: true };
}

var _chatWin = null;

function openChatWindow(conversationId) {
    var existing = (typeof ui !== "undefined" && ui.windows && ui.windows["docsChat"]);
    if (existing && !existing.closed) {
        // The window is already open and the selection dialog still made a
        // choice: apply it to the module state and let the page re-render
        // from the live loop (greet() pulls getRestoredConversation()) —
        // focusing alone would leave the OLD conversation on screen.
        if (conversationId !== undefined) {
            try {
                ensurePersonaFile();
                ensureChat();
                if (conversationId) {
                    _currentConversationId = conversationId;
                    loadConversation(conversationId);
                } else {
                    // beginNewConversation's body (that one lives on the api object)
                    saveCurrentConversation();
                    _currentConversationId = null;
                    if (_chat) _chat.loop.clear();
                }
                if (typeof existing.__docsChatRenderSwitched === "function") existing.__docsChatRenderSwitched();
            } catch (e) { console.error("[docsChat] could not apply the selected conversation:", e); }
        }
        try { existing.focus(); } catch (e) { /* window gone */ }
        return;
    }
    // Load (or reset) the conversation BEFORE the window opens, so the page's
    // greeting renders the right history immediately.
    try {
        ensurePersonaFile();
        ensureChat();
        if (conversationId) {
            _currentConversationId = conversationId;
            loadConversation(conversationId);
        } else {
            _currentConversationId = null;
            if (_chat) _chat.loop.clear();
        }
    } catch (e) { console.error("[docsChat] could not prepare the conversation:", e); }
    nw.Window.open("www/docsChat.html", {
        id: "docsChat",
        frame: false,
        show: false,
        // Default sized for the 128px portrait plus a healthy message area;
        // fits 768p screens. Resized windows keep their size (nw remembers it
        // per window id), so this only matters for the first open.
        width: 540,
        height: 720,
        min_width: 380,
        min_height: 420,
        resizable: true
    }, function (thisWin) {
        if (!thisWin) return;
        _chatWin = thisWin;
        try { ui.windows["docsChat"] = thisWin.window; } catch (e) { /* ui not ready */ }
        try { thisWin.window.__nwHandle = thisWin; } catch (e) { /* see ui.openOptionsWindow */ }

        var revealed = false;
        function reveal() {
            if (revealed) return;
            revealed = true;
            try {
                thisWin.show();
                thisWin.focus();
            } catch (e) { /* window closed before reveal */ }
        }
        function revealWhenPainted() {
            // Two rAFs = one painted frame; avoids the white-canvas flash.
            try {
                thisWin.window.requestAnimationFrame(function () {
                    thisWin.window.requestAnimationFrame(reveal);
                });
            } catch (e) { reveal(); }
        }
        try {
            if (thisWin.window.document.readyState === "complete") {
                revealWhenPainted();
            } else {
                thisWin.window.addEventListener("load", revealWhenPainted);
            }
        } catch (e) {
            revealWhenPainted();
        }
        // Safety net if the page never fires load (see ui.openOptionsWindow).
        setTimeout(function () { try { thisWin.show(); } catch (e) { /* gone */ } }, 15000);

        try {
            thisWin.on("closed", function () {
                if (ui.windows && ui.windows["docsChat"] === thisWin.window) delete ui.windows["docsChat"];
                _chatWin = null;
                try { saveCurrentConversation(); } catch (e) { /* best effort */ }
            });
        } catch (e) { /* older nw without window events here */ }
    });
}

// ---------------------------------------------------------------------------
// Ready hook
// ---------------------------------------------------------------------------

function onAppReady() {
    // The persona file must exist from the first launch: a doc-reader who has
    // never opened the chat still goes looking for it. Created before anything
    // DOM-dependent, and each step guarded so one failure cannot skip the rest.
    try { ensurePersonaFile(); } catch (e) { /* read-only install */ }
    try { insertToolbarButton(); } catch (e) { console.error("[docsChat] toolbar button:", e); }
}

if (typeof ui !== "undefined" && typeof ui.onReady === "function") {
    ui.onReady(onAppReady);
} else if (typeof $ !== "undefined") {
    $(onAppReady);
}
