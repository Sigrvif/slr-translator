"use strict";
// Request-shaping fixes in DSLREngine that have no other coverage:
//  - chat_template_kwargs must be sent as an object, not the raw option string
//  - the global Qwen thinking control must also apply to Review
// The engine module pulls in two browser-only siblings, so they are stubbed; the methods
// under test are taken from the real prototype and called with a minimal fake engine.
const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");
const path = require("node:path");

// The real Option class is a browser form wrapper that self-registers with the wrapper; the
// DSLREngine constructor only touches a small surface of it eagerly (getId and getFormOptions at
// build time, getValue/setValue from the runtime buttons), so this stub carries just that. The
// rest of what the real class does with the DOM is out of scope for these tests.
class StubTranslationEngineOption {
    constructor(opts) {
        this.id = (opts && opts.id) || "";
        this.options = Object.assign({}, (opts && opts.options) || {},
            { formOptions: (opts && opts.formOptions) || {} });
        this._value = (opts && opts.default !== undefined) ? opts.default : undefined;
    }
    getId() { return this.id; }
    getValue() { return this._value; }
    setValue(value) { this._value = value; return this; }
    getFormOptions() { return { titleMap: {}, enum: [] }; }
    getSchemaOptions() { return { enum: [] }; }
}

function loadEngine() {
    const originalLoad = Module._load;
    const optionStub = { TranslationEngineOption: StubTranslationEngineOption, TranslationEngineOptionCategories: { OPTIONS: "options" } };
    const wrapperStub = {
        DSLRTranslationEngineWrapper: class {},
        TranslationEngineOptionCategories: { OPTIONS: "options" }
    };
    Module._load = function (request, parent, isMain) {
        if (request === "./TranslationEngineOption") return optionStub;
        if (request === "./DSLRTranslationEngineWrapper") return wrapperStub;
        return originalLoad.apply(this, arguments);
    };
    const saved = {
        window: globalThis.window,
        localStorage: globalThis.localStorage
    };
    globalThis.window = {};
    globalThis.localStorage = { getItem: () => null };
    try {
        return require(path.join(__dirname, "..", "DSLREngine.js"));
    } finally {
        Module._load = originalLoad;
        if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
        if (saved.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved.localStorage;
    }
}

const engineModule = loadEngine();
const DSLREngine = engineModule.DSLREngine;
const localRuntimeStopDecision = engineModule.localRuntimeStopDecision;
const localRuntimeModelProfiles = engineModule.localRuntimeModelProfiles;
const runtimeChoiceOptions = engineModule.runtimeChoiceOptions;
const runtimeFieldHints = engineModule.runtimeFieldHints;
const runtimeHardwareNote = engineModule.runtimeHardwareNote;
const runtimeProfilePatch = engineModule.runtimeProfilePatch;
const rolePickerUpdates = engineModule.rolePickerUpdates;
const roleReloadNote = engineModule.roleReloadNote;
const proto = DSLREngine.prototype;

// A minimal engine exposing only what the methods under test touch.
function fakeEngine() {
    return {
        _isQwenModel: proto._isQwenModel,
        _setEnableThinking: proto._setEnableThinking,
        _setChatTemplateKwargs: proto._setChatTemplateKwargs,
        _isLocalEndpoint: proto._isLocalEndpoint,
        _applyThinkingDisable: proto._applyThinkingDisable,
        _applyReviewThinking: proto._applyReviewThinking,
        _applyReviewQwenThinking: proto._applyReviewQwenThinking
    };
}

// A fake exposing what _applyReasoningParams touches, so the thinking-disable decision can be
// exercised without the whole engine.
function fakeReasoningEngine(format) {
    return {
        _isQwenModel: proto._isQwenModel,
        _setEnableThinking: proto._setEnableThinking,
        _setChatTemplateKwargs: proto._setChatTemplateKwargs,
        _isLocalEndpoint: proto._isLocalEndpoint,
        _applyThinkingDisable: proto._applyThinkingDisable,
        _reasoningFormatFor: () => format,
        _reasoningSettingsFor: () => ({ effort: "low", budget: null }),
        _applyReasoningParams: proto._applyReasoningParams,
        _endpointIsOurs: proto._endpointIsOurs,
        _invalidateEndpointOwnership: proto._invalidateEndpointOwnership,
        _shouldProbeEndpointOwnership: proto._shouldProbeEndpointOwnership
    };
}

function systemMessage(text) {
    return { role: "system", content: text };
}

test("_setChatTemplateKwargs sends a parsed object, not the raw string", () => {
    const engine = fakeEngine();
    const body = {};
    engine._setChatTemplateKwargs(body, '{"top_k": 40, "enable_thinking": true}');
    assert.deepStrictEqual(body.chat_template_kwargs, { top_k: 40, enable_thinking: true });
    assert.strictEqual(typeof body.chat_template_kwargs, "object");
});

test("_setChatTemplateKwargs ignores malformed JSON instead of sending a string", () => {
    const engine = fakeEngine();
    const body = {};
    engine._setChatTemplateKwargs(body, "{not json");
    assert.strictEqual(body.chat_template_kwargs, undefined);
});

test("_setChatTemplateKwargs ignores empty, null and non-object JSON", () => {
    const engine = fakeEngine();
    for (const raw of ["", null, undefined, "[1,2,3]", '"a string"', "42"]) {
        const body = {};
        engine._setChatTemplateKwargs(body, raw);
        assert.strictEqual(body.chat_template_kwargs, undefined, String(raw));
    }
});

test("_setChatTemplateKwargs accepts an already-parsed object", () => {
    const engine = fakeEngine();
    const body = {};
    engine._setChatTemplateKwargs(body, { a: 1 });
    assert.deepStrictEqual(body.chat_template_kwargs, { a: 1 });
});

test("a parsed chat_template_kwargs is merged with enable_thinking, not replaced", () => {
    const engine = fakeEngine();
    const body = {};
    engine._setChatTemplateKwargs(body, '{"top_k": 40}');
    engine._setEnableThinking(body, false);
    assert.deepStrictEqual(body.chat_template_kwargs, { top_k: 40, enable_thinking: false });
});

// The user's other chat_template_kwargs keys must survive reasoning handling: _setChatTemplateKwargs
// parses the user's JSON into an object and _setEnableThinking merges enable_thinking into it instead
// of replacing it, so e.g. preserve_thinking reaches the server alongside the reasoning switch. Each
// assertion is on the produced body, so a refactor that starts clobbering sibling keys fails here.
test("a user's other chat_template_kwargs survive the enable_thinking merge on a local endpoint", () => {
    const engine = fakeReasoningEngine("qwen");
    const body = {};
    engine._setChatTemplateKwargs(body, '{"preserve_thinking": true}');
    engine._applyReasoningParams(body, "model1", "some-model", 1,
        "http://127.0.0.1:8730/v1/chat/completions");
    assert.deepStrictEqual(body.chat_template_kwargs, { preserve_thinking: true, enable_thinking: true });
});

test("a user's other chat_template_kwargs survive the disable path on a local endpoint", () => {
    const engine = fakeReasoningEngine("none");
    const body = {};
    engine._setChatTemplateKwargs(body, '{"preserve_thinking": true}');
    engine._applyReasoningParams(body, "model1", "some-model", 1,
        "http://127.0.0.1:8730/v1/chat/completions");
    assert.deepStrictEqual(body.chat_template_kwargs, { preserve_thinking: true, enable_thinking: false });
});

test("a user's other chat_template_kwargs survive on a remote endpoint with an active reasoning format", () => {
    const engine = fakeReasoningEngine("qwen");
    const body = {};
    engine._setChatTemplateKwargs(body, '{"preserve_thinking": true}');
    engine._applyReasoningParams(body, "model1", "some-model", 1,
        "https://api.example.com/v1/chat/completions");
    assert.deepStrictEqual(body.chat_template_kwargs, { preserve_thinking: true, enable_thinking: true });
});

test("_applyReviewThinking disables thinking for a local endpoint on any model", () => {
    const engine = fakeEngine();
    const body = {};
    engine._applyReviewThinking(body, "http://127.0.0.1:8730/v1/chat/completions",
        { model: "gemma-4-26B-A4B-it", reasoningFormat: "none" });
    assert.deepStrictEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("_applyReviewThinking leaves a remote non-Qwen model untouched", () => {
    const engine = fakeEngine();
    const body = {};
    engine._applyReviewThinking(body, "https://api.openai.com/v1/chat/completions",
        { model: "gpt-4o", reasoningFormat: "none" });
    assert.strictEqual(body.chat_template_kwargs, undefined);
    assert.strictEqual(body.reasoning_effort, undefined);
});

test("_applyReviewThinking sends nothing at all for Not enabled", () => {
    const engine = fakeEngine();
    for (const apiUrl of ["http://127.0.0.1:8730/v1/chat/completions",
                          "https://api.deepseek.com/v1/chat/completions"]) {
        const body = {};
        engine._applyReviewThinking(body, apiUrl, { model: "gemma-4", reasoningFormat: "not_enabled" });
        assert.deepStrictEqual(body, {}, apiUrl);
    }
});

test("_applyReviewThinking disables v4/DeepSeek review endpoints like the translation path", () => {
    const engine = fakeEngine();
    const ds = {};
    engine._applyReviewThinking(ds, "https://api.deepseek.com/v1/chat/completions",
        { model: "deepseek-reasoner", reasoningFormat: "none" });
    assert.deepStrictEqual(ds.thinking, { type: "disabled" });
    // DeepSeek accepts only its own documented reasoning_effort enum, so it gets no "none".
    assert.strictEqual(ds.reasoning_effort, undefined);

    const v4 = {};
    engine._applyReviewThinking(v4, "https://host/v4/chat/completions",
        { model: "some-model", reasoningFormat: "none" });
    assert.deepStrictEqual(v4.thinking, { type: "disabled" });
    assert.strictEqual(v4.reasoning_effort, "none");
});

test("_applyReviewThinking does nothing while a reasoning format is active", () => {
    const engine = fakeEngine();
    const body = {};
    engine._applyReviewThinking(body, "http://127.0.0.1:8730/v1/chat/completions",
        { model: "gemma-4", reasoningFormat: "qwen" });
    assert.deepStrictEqual(body, {});
});

test("_applyReviewQwenThinking appends /no_think for a Qwen review model", () => {
    const engine = fakeEngine();
    const body = {};
    const messages = [systemMessage("You are a QC reviewer."), { role: "user", content: "check" }];
    engine._applyReviewQwenThinking(body, messages, { model: "Qwen3-4B", reasoningFormat: "none" });
    assert.match(messages[0].content, /You are a QC reviewer\.\n\/no_think$/);
});

test("_applyReviewQwenThinking leaves a non-Qwen model alone", () => {
    const engine = fakeEngine();
    const body = {};
    const messages = [systemMessage("You are a QC reviewer.")];
    engine._applyReviewQwenThinking(body, messages, { model: "gemma-4-26B", reasoningFormat: "none" });
    assert.strictEqual(body.chat_template_kwargs, undefined);
    assert.strictEqual(messages[0].content, "You are a QC reviewer.");
});

test("_applyReviewQwenThinking does nothing while a reasoning format is active", () => {
    const engine = fakeEngine();
    const body = {};
    const messages = [systemMessage("You are a QC reviewer.")];
    engine._applyReviewQwenThinking(body, messages, { model: "Qwen3-4B", reasoningFormat: "qwen" });
    assert.strictEqual(messages[0].content, "You are a QC reviewer.");
});

test("_applyReviewQwenThinking sends nothing for Not enabled", () => {
    const engine = fakeEngine();
    const messages = [systemMessage("You are a QC reviewer.")];
    engine._applyReviewQwenThinking({}, messages, { model: "Qwen3-4B", reasoningFormat: "not_enabled" });
    assert.strictEqual(messages[0].content, "You are a QC reviewer.");
});

test("_applyReviewQwenThinking does not append /no_think twice", () => {
    const engine = fakeEngine();
    const messages = [systemMessage("You are a QC reviewer.\n/no_think")];
    engine._applyReviewQwenThinking({}, messages, { model: "Qwen3-4B", reasoningFormat: "none" });
    assert.strictEqual(messages[0].content, "You are a QC reviewer.\n/no_think");
});

test("_applyReviewQwenThinking tolerates a missing system message", () => {
    const engine = fakeEngine();
    const messages = [{ role: "user", content: "check" }];
    engine._applyReviewQwenThinking({}, messages, { model: "Qwen3-4B", reasoningFormat: "none" });
    assert.strictEqual(messages[0].content, "check");
});

// The bundled local runtime is llama.cpp, which honors the template's enable_thinking switch.
// Verified against the pinned build with a Gemma 4 model that thinks by default: sending the
// switch dropped reasoning_content from 254 characters to none. Cloud APIs are left alone,
// because chat_template_kwargs is not a standard field there.
test("_isLocalEndpoint accepts only loopback hosts", () => {
    const engine = fakeEngine();
    const local = [
        "http://127.0.0.1:8730/v1/chat/completions",
        "http://localhost:1234/v1/chat/completions",
        "http://[::1]:8080/v1/chat/completions",
        "http://127.0.0.1:8730"
    ];
    for (const u of local) assert.strictEqual(engine._isLocalEndpoint(u), true, u);
    const remote = [
        "https://api.openai.com/v1/chat/completions",
        "https://openrouter.ai/api/v1/chat/completions",
        "http://192.168.1.50:1234/v1/chat/completions",
        "http://127.0.0.1.evil.com/v1",
        "",
        undefined
    ];
    for (const u of remote) assert.strictEqual(engine._isLocalEndpoint(u), false, String(u));
});

// Ownership of a loopback endpoint is decided by a sentinel this project controls, never by its
// address and never by a llama.cpp-family trait: port 1234 is deliberately shared with LM Studio,
// Ollama and a hand-run llama-server, so the URL cannot tell them apart, and a stock llama.cpp
// server emits chat_template_caps too. The runtime's /v1/models list stamps every entry
// owned_by "slrcpp"; anything else (refused, non-OK, unreadable, wrong shape) is NOT ours, so the
// engine asks for reasoning itself rather than silently stripping the ask.
test("a loopback endpoint whose model list carries our sentinel is ours", async () => {
    const engine = fakeReasoningEngine();
    engine._fetchForProbe = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ object: "list", data: [{ id: "m", object: "model", owned_by: "slrcpp" }] })
    });
    assert.strictEqual(await engine._endpointIsOurs("http://127.0.0.1:1234/v1/chat/completions"), true);
});

test("a loopback endpoint whose model list is another program's is not ours", async () => {
    const engine = fakeReasoningEngine();
    engine._fetchForProbe = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ object: "list", data: [{ id: "m", object: "model", owned_by: "llamacpp" }] })
    });
    assert.strictEqual(await engine._endpointIsOurs("http://127.0.0.1:1234/v1/chat/completions"), false);
});

// The failure the previous discriminator had: a stock llama.cpp server answers with
// chat_template_caps (common_chat_templates_get_caps), so that field only says "llama.cpp-family"
// and must never decide ownership. Without the project's own sentinel this is not ours.
test("a llama.cpp-family answer with chat_template_caps but no sentinel is not ours", async () => {
    const engine = fakeReasoningEngine();
    engine._fetchForProbe = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
            object: "list",
            chat_template_caps: { supports_reasoning_effort: true },
            data: [{ id: "m", object: "model", owned_by: "llamacpp" }]
        })
    });
    assert.strictEqual(await engine._endpointIsOurs("http://127.0.0.1:1234/v1/chat/completions"), false);
});

test("a remote endpoint is never ours and is never probed", async () => {
    const engine = fakeReasoningEngine();
    let probed = false;
    engine._fetchForProbe = () => { probed = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    assert.strictEqual(await engine._endpointIsOurs("https://api.example.com/v1/chat/completions"), false);
    assert.strictEqual(probed, false);
});

test("a failed or unreadable probe is not ours and does not throw", async () => {
    for (const fetchImpl of [
        () => Promise.reject(new Error("refused")),
        () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
        () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) })
    ]) {
        const engine = fakeReasoningEngine();
        engine._fetchForProbe = fetchImpl;
        assert.strictEqual(await engine._endpointIsOurs("http://127.0.0.1:9999/v1/chat/completions"), false);
    }
});

test("the answer is cached per endpoint so the probe runs once", async () => {
    const engine = fakeReasoningEngine();
    let calls = 0;
    engine._fetchForProbe = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    const url = "http://127.0.0.1:1234/v1/chat/completions";
    await engine._endpointIsOurs(url);
    await engine._endpointIsOurs(url);
    assert.strictEqual(calls, 1);
});

// The shared loopback port can change owner without the app restarting: the runtime is stopped and
// another local server takes the same URL. Ownership is cached, so a translation that failed at the
// transport level must drop the cached answer; otherwise every later translation keeps treating the
// foreign server as ours and stops sending the engine's own reasoning ask, which is the regression
// this work exists to prevent.
test("a transport failure drops the cached ownership answer so the next call probes again", async () => {
    const engine = fakeReasoningEngine();
    let calls = 0;
    engine._fetchForProbe = () => {
        calls++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ object: "list", data: [{ id: "m", owned_by: "slrcpp" }] }) });
    };
    const url = "http://127.0.0.1:1234/v1/chat/completions";
    assert.strictEqual(await engine._endpointIsOurs(url), true);
    assert.strictEqual(await engine._endpointIsOurs(url), true);
    assert.strictEqual(calls, 1, "a successful run must not re-probe");
    engine._invalidateEndpointOwnership(url);
    assert.strictEqual(await engine._endpointIsOurs(url), true);
    assert.strictEqual(calls, 2, "after a transport failure the next call must probe again");
});

test("_invalidateEndpointOwnership is inert before any probe and for a remote URL", () => {
    const engine = fakeReasoningEngine();
    // No probe has run, so there is no cache to touch: this must not create one or throw.
    assert.doesNotThrow(() => engine._invalidateEndpointOwnership("http://127.0.0.1:1234/v1/chat/completions"));
    assert.strictEqual(engine._oursCache, undefined);
});

// Both request catch blocks (Full Batch and individual) must route the transport failure through
// that invalidation; a helper the request path never calls would leave the stale answer in place.
test("both request catch blocks invalidate the ownership cache on a transport failure", () => {
    const src = require("node:fs").readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    assert.strictEqual((src.match(/this\._invalidateEndpointOwnership\(apiUrl\);/g) || []).length, 2,
        "both request seams must drop a stale ownership answer after a transport failure");
});

// The cache exists so concurrent callers share one in-flight probe: the second call must reuse the
// first call's promise rather than launch its own GET.
test("concurrent calls to the same endpoint share one in-flight probe", async () => {
    const engine = fakeReasoningEngine();
    let calls = 0;
    let release = null;
    engine._fetchForProbe = () => {
        calls++;
        return new Promise(function (resolve) { release = resolve; });
    };
    const url = "http://127.0.0.1:1234/v1/chat/completions";
    const first = engine._endpointIsOurs(url);
    const second = engine._endpointIsOurs(url);
    release({ ok: true, json: () => Promise.resolve({ object: "list", data: [{ id: "m", owned_by: "slrcpp" }] }) });
    const answers = await Promise.all([first, second]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(answers[0], true);
    assert.strictEqual(answers[1], true);
});

// The probe must never stall a translation: a peer that accepts the connection and never answers is
// abandoned, and the abandoned probe resolves to "not ours" instead of throwing into the request.
test("a probe that never answers times out to not ours and does not throw", async () => {
    const engine = fakeReasoningEngine();
    engine._fetchForProbe = proto._fetchForProbe;
    engine._probeTimeoutMs = 20;
    const originalFetch = globalThis.fetch;
    let sawSignal = false;
    globalThis.fetch = (url, init) => new Promise(function (resolve, reject) {
        if (init && init.signal) {
            sawSignal = true;
            if (init.signal.aborted) { reject(new Error("aborted")); return; }
            init.signal.addEventListener("abort", function () { reject(new Error("aborted")); });
        }
        // otherwise never settles
    });
    try {
        assert.strictEqual(await engine._endpointIsOurs("http://127.0.0.1:9999/v1/chat/completions"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.strictEqual(sawSignal, true, "the probe request must carry an abort signal");
});

test("_fetchForProbe asks the front door's model list, where the sentinel lives", async () => {
    const engine = fakeReasoningEngine();
    engine._probeTimeoutMs = 20;
    const originalFetch = globalThis.fetch;
    let seenUrl = null;
    globalThis.fetch = (url) => { seenUrl = url; return Promise.resolve({ ok: true, json: () => Promise.resolve({ object: "list", data: [] }) }); };
    try {
        await proto._fetchForProbe.call(engine, "http://127.0.0.1:1234/v1/chat/completions");
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.strictEqual(seenUrl, "http://127.0.0.1:1234/v1/models");
});

// Ownership can only change the request when a reasoning format is active; "none"/"not_enabled"
// are decided without it, so they must not pay a probe at all.
test("ownership is only probed for an active reasoning format on a loopback endpoint", () => {
    const active = fakeReasoningEngine("openai_effort");
    assert.strictEqual(active._shouldProbeEndpointOwnership("http://127.0.0.1:1234/v1/chat/completions", "primary", 1), true);
    for (const format of ["none", "not_enabled"]) {
        const engine = fakeReasoningEngine(format);
        assert.strictEqual(engine._shouldProbeEndpointOwnership("http://127.0.0.1:1234/v1/chat/completions", "primary", 1), false, format);
    }
    const remote = fakeReasoningEngine("openai_effort");
    assert.strictEqual(remote._shouldProbeEndpointOwnership("https://api.example.com/v1/chat/completions", "primary", 1), false);
});

// Both request-preparation seams must route the probe through that guard; an unconditional probe
// would make every "none"/"not_enabled" request pay one GET whose answer it cannot use.
test("both request seams guard the ownership probe behind the format check", () => {
    const src = require("node:fs").readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    assert.strictEqual((src.match(/this\._shouldProbeEndpointOwnership\(apiUrl, llmToUse, endpointNumber\)/g) || []).length, 2,
        "both seams must consult _shouldProbeEndpointOwnership");
    assert.strictEqual((src.match(/endpointIsOurs = await this\._endpointIsOurs\(apiUrl\);/g) || []).length, 2,
        "both seams must assign the probe result inside the guard");
    assert.strictEqual((src.match(/var endpointIsOurs = await this\._endpointIsOurs\(apiUrl\);/g) || []).length, 0,
        "no seam may probe unconditionally");
});

test("_applyReasoningParams disables thinking for a local endpoint, any model name", () => {
    const engine = fakeReasoningEngine("none");
    const body = {};
    engine._applyReasoningParams(body, "model1", "gemma-4-26B-A4B-it-uncensored-apex-quality", 1,
        "http://127.0.0.1:8730/v1/chat/completions");
    assert.deepStrictEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("_applyReasoningParams leaves a remote request untouched when reasoning is off", () => {
    const engine = fakeReasoningEngine("none");
    const body = {};
    engine._applyReasoningParams(body, "model1", "gemma-4-26B-A4B-it", 1,
        "https://api.openai.com/v1/chat/completions");
    assert.strictEqual(body.chat_template_kwargs, undefined);
});

test("_applyReasoningParams does not disable thinking when a reasoning format is active", () => {
    const engine = fakeReasoningEngine("openai_effort");
    const body = {};
    engine._applyReasoningParams(body, "model1", "gemma-4", 1,
        "http://127.0.0.1:8730/v1/chat/completions", true);
    // An active format runs its own field and must not run the disable path; for an endpoint
    // that IS ours the intent is left for the front door, and the remote case stays untouched
    // and is covered by its own test below.
    assert.strictEqual(body.chat_template_kwargs, undefined);
    assert.strictEqual(body.reasoning_effort, "low");
});

// The engine no longer translates reasoning intent for a local endpoint that IS our front door:
// the front door does that, once, for every client — it is the only place that knows the served
// model's own capabilities. The intent (the requested effort included) is left as the caller sent
// it, so the front door has something to normalise. A remote provider body must stay exactly as it
// was: its format-specific field, and no chat_template_kwargs.
test("a local endpoint's reasoning intent is left for the front door to normalise", () => {
    const engine = fakeReasoningEngine("openai_effort");
    const body = { messages: [{ role: "user", content: "hi" }] };
    engine._reasoningSettingsFor = () => ({ effort: "high" });
    engine._applyReasoningParams(body, "primary", "local-model", 1, "http://127.0.0.1:1234/v1/chat/completions", true);
    // The intent survives for the front door; the engine does not translate it itself any more.
    assert.strictEqual(body.reasoning_effort, "high");
    assert.strictEqual(body.chat_template_kwargs, undefined);
});

// A loopback endpoint that is NOT our front door (LM Studio, a hand-run llama-server, anything
// else on the shared port) has no normaliser behind it, so the engine must ask for reasoning the
// way it did before the front door existed: the format's own field, plus the template switch.
test("a local endpoint that is not ours still asks for reasoning itself", () => {
    const engine = fakeReasoningEngine("openai_effort");
    engine._reasoningSettingsFor = () => ({ effort: "high", budget: null });
    const body = { messages: [{ role: "user", content: "hi" }] };
    engine._applyReasoningParams(body, "primary", "local-model", 1, "http://127.0.0.1:1234/v1/chat/completions", false);
    assert.strictEqual(body.reasoning_effort, "high");
    assert.deepStrictEqual(body.chat_template_kwargs, { enable_thinking: true });
});

test("a local endpoint that is ours leaves reasoning to the front door", () => {
    const engine = fakeReasoningEngine("openai_effort");
    engine._reasoningSettingsFor = () => ({ effort: "high", budget: null });
    const body = { messages: [{ role: "user", content: "hi" }] };
    engine._applyReasoningParams(body, "primary", "local-model", 1, "http://127.0.0.1:1234/v1/chat/completions", true);
    assert.strictEqual(body.reasoning_effort, "high");
    assert.strictEqual(body.chat_template_kwargs, undefined);
});

test("a remote endpoint's explicit reasoning format is unchanged", () => {
    const engine = fakeReasoningEngine("openai_effort");
    engine._reasoningSettingsFor = () => ({ effort: "medium", budget: null });
    const body = { messages: [{ role: "user", content: "hi" }] };
    engine._applyReasoningParams(body, "primary", "remote-model", 1, "https://api.example.com/v1/chat/completions");
    assert.strictEqual(body.chat_template_kwargs, undefined);
    assert.strictEqual(body.reasoning_effort, "medium");
});

// The endpoint-aware disable is the single mechanism behind Reasoning Format "None". It must
// only ever send a parameter the endpoint actually understands: inventing one for an
// unrecognised provider is how working requests start failing.
test("_applyThinkingDisable picks the right mechanism per endpoint", () => {
    const engine = fakeEngine();

    const ds = {};
    engine._applyThinkingDisable(ds, "https://api.deepseek.com/v1/chat/completions", "deepseek-reasoner");
    assert.deepStrictEqual(ds.thinking, { type: "disabled" });
    assert.strictEqual(ds.reasoning_effort, undefined, "DeepSeek rejects reasoning_effort none");

    const v4 = {};
    engine._applyThinkingDisable(v4, "https://host/v4/chat/completions", "some-model");
    assert.deepStrictEqual(v4.thinking, { type: "disabled" });
    assert.strictEqual(v4.reasoning_effort, "none");

    const local = {};
    engine._applyThinkingDisable(local, "http://127.0.0.1:8730/v1/chat/completions", "gemma-4");
    assert.deepStrictEqual(local.chat_template_kwargs, { enable_thinking: false });

    const qwenRemote = {};
    engine._applyThinkingDisable(qwenRemote, "https://api.example.com/v1/chat/completions", "Qwen3-4B");
    assert.deepStrictEqual(qwenRemote.chat_template_kwargs, { enable_thinking: false });
});

test("_applyThinkingDisable sends nothing to an endpoint it cannot identify", () => {
    const engine = fakeEngine();
    const body = {};
    const sent = engine._applyThinkingDisable(body, "https://api.openai.com/v1/chat/completions", "gpt-4o");
    assert.strictEqual(sent, false);
    assert.deepStrictEqual(body, {});
});

test("_applyThinkingDisable reports whether it sent anything", () => {
    const engine = fakeEngine();
    assert.strictEqual(engine._applyThinkingDisable({}, "http://127.0.0.1:8730/v1/chat/completions", "m"), true);
    assert.strictEqual(engine._applyThinkingDisable({}, "https://api.openai.com/v1/chat/completions", "m"), false);
});

test("_applyReasoningParams sends nothing for Not enabled", () => {
    const engine = fakeReasoningEngine("not_enabled");
    for (const apiUrl of ["http://127.0.0.1:8730/v1/chat/completions",
                          "https://api.deepseek.com/v1/chat/completions",
                          "https://api.openai.com/v1/chat/completions"]) {
        const body = {};
        engine._applyReasoningParams(body, "model1", "gemma-4", 1, apiUrl);
        assert.deepStrictEqual(body, {}, apiUrl);
    }
});

test("_applyReasoningParams drops stale disable fields when a format is enabled", () => {
    const engine = fakeReasoningEngine("openai_effort");
    const body = { thinking: { type: "disabled" }, reasoning_effort: "none" };
    engine._applyReasoningParams(body, "model1", "gemma-4", 1, "http://127.0.0.1:8730/v1/chat/completions", true);
    assert.strictEqual(body.thinking, undefined);
    assert.strictEqual(body.reasoning_effort, "low");
});

const fs = require("node:fs");

test("the runtime port option exists, is declared, and defaults to 1234", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    const block = src.match(/id: 'runtimePort',[\s\S]*?category:/);
    assert.ok(block, "runtimePort must be a declared option");
    assert.match(block[0], /type:\s*'number'/);
    assert.match(block[0], /default:\s*1234/);
});

test("the runtime port declaration lands in the localruntime section, not Other Options", () => {
    // An option that exists but lands in the wrong section is as good as missing to a user
    // looking under the runtime settings. Checking only that the id appears somewhere in the
    // wrapper would still pass if it were moved into the misc fallback ("Other Options"), so
    // this isolates sectionOf and the branch that returns the Bundled Local Runtime section.
    const engineSrc = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    assert.match(engineSrc, /id: 'runtimePort'/);
    const wrapperSrc = fs.readFileSync(path.join(__dirname, "..", "DSLRTranslationEngineWrapper.js"), "utf8");

    const mapStart = wrapperSrc.indexOf("const sectionOf = (option) => {");
    const mapEnd = wrapperSrc.indexOf("const sections = [", mapStart);
    assert.ok(mapStart !== -1 && mapEnd > mapStart, "sectionOf must be locatable in the wrapper");
    const mapSrc = wrapperSrc.slice(mapStart, mapEnd);
    // Exactly one branch decides it: a duplicate in an earlier branch would win.
    assert.strictEqual((mapSrc.match(/'runtimePort'/g) || []).length, 1,
        "runtimePort must be decided by exactly one branch of sectionOf");

    const branch = mapSrc.match(/id === 'runtimeDraftMax'[\s\S]*?return \{ parent: 'localruntime', child: 'general' \};/);
    assert.ok(branch, "the general sub-group branch must exist in sectionOf");
    assert.match(branch[0], /id === 'runtimePort'/,
        "runtimePort must be in the general branch, not the misc/Other Options fallback");
});

test("the runtime reasoning option defaults to off and is sent on start", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    const block = src.match(/id: 'runtimeReasoning',[\s\S]*?titleMap: \{ off: 'Off \(recommended\)'/);
    assert.ok(block, "runtimeReasoning must be a declared option");
    assert.match(block[0], /default:\s*'off'/);
    assert.match(block[0], /formType:\s*'select'/);
    assert.match(block[0], /schemaOptions:\s*\{ enum: \['off', 'auto', 'on'\] \}/);
    // The start handler must read the option with an off fallback and forward the resolved
    // value in the startLocal payload, exactly like the other server-level runtime options.
    assert.ok(src.indexOf("var reasoning = readOption(wrapper, 'optionRuntimeReasoning', 'off')") !== -1,
        "the start handler must read the option with an off fallback");
    assert.ok(src.indexOf("reasoning: reasoning") !== -1,
        "the resolved value must be part of the startLocal payload");
});

// localRuntimeStopDecision is the ownership gate behind the "Stop Local Runtime" button: a
// runtime the editor attached to is owned by the standalone console launcher, so Stop must
// refuse (and say why) instead of pretending to stop a server this window cannot stop. The
// button's onClick closure is not unit-testable - it is built in the engine constructor and
// drives the form's DOM - so this pure decision function is the deliverable under test here.
test("an attached runtime must not be stopped from the editor: it belongs to the console launcher", () => {
    const decision = localRuntimeStopDecision({ status: "ready", baseUrl: "http://127.0.0.1:1234", attached: true });
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.message, /console launcher/i);
    assert.match(decision.message, /console window/i);
    assert.match(decision.message, /Ctrl\+C|--stop/);
});

test("a runtime this window owns can still be stopped", () => {
    assert.strictEqual(
        localRuntimeStopDecision({ status: "ready", baseUrl: "http://127.0.0.1:1234" }).allowed, true,
        "attached absent means this window owns the runtime");
    assert.strictEqual(
        localRuntimeStopDecision({ status: "ready", baseUrl: "http://127.0.0.1:1234", attached: false }).allowed, true,
        "attached false means this window owns the runtime");
});

test("a missing status fails open so an owned stop is never blocked", () => {
    assert.strictEqual(localRuntimeStopDecision(null).allowed, true);
    assert.strictEqual(localRuntimeStopDecision(undefined).allowed, true);
    assert.strictEqual(localRuntimeStopDecision(null).message, "");
    assert.strictEqual(localRuntimeStopDecision(undefined).message, "");
});

test("ownership wins over an error status: an attached runtime stays unstoppable from here", () => {
    const decision = localRuntimeStopDecision({ status: "error", error: "backend died", attached: true });
    assert.strictEqual(decision.allowed, false);
});

// --- Per-model profile map (runtimeModelProfiles) -----------------------------------------
// The Start handler carries a persisted map of per-model settings to the runtime but does not
// consume it for emission yet (Task 9b). Two things must hold regardless: a stored map must
// survive a round-trip untouched, and a corrupt one must degrade to {} rather than throwing, so
// a bad config can never stop a start. On the first start with an empty map the profile store
// is seeded once from the legacy model-level options plus the selected model's drafts.json
// pairing. Only the pure resolver is unit-tested; the button's onClick just wires it up.

test("localRuntimeModelProfiles parses a stored JSON map and round-trips it unchanged", () => {
    const stored = { "a.gguf": { contextLength: 8192, kvType: "q4_0" } };
    const map = localRuntimeModelProfiles({ raw: JSON.stringify(stored) });
    assert.deepStrictEqual(map, stored);
});

test("localRuntimeModelProfiles degrades a corrupt or non-object value to {} without throwing", () => {
    const raws = ["{not json", "[1,2,3]", '"a string"', "42", "true", "null", "", null, undefined, {}];
    for (const raw of raws) {
        const map = localRuntimeModelProfiles({ raw });
        assert.deepStrictEqual(map, {}, "raw " + String(raw) + " must degrade to an empty map");
    }
});

test("an empty map is seeded once from the legacy options and the drafts.json pairing", () => {
    const map = localRuntimeModelProfiles({
        raw: "",
        legacy: { runtimeContextLength: 8192, runtimeKvType: "q4_0", runtimeDraftMax: 5, runtimeParallelSlots: 4 },
        drafts: { "target.gguf": { draft: "target-dflash.gguf" } },
        selectedId: "target.gguf"
    });
    assert.strictEqual(map["target.gguf"].contextLength, 8192);
    // The single legacy KV type seeds both sides of the split.
    assert.strictEqual(map["target.gguf"].kvTypeK, "q4_0");
    assert.strictEqual(map["target.gguf"].kvTypeV, "q4_0");
    assert.strictEqual(map["target.gguf"].draftMax, 5);
    assert.strictEqual(map["target.gguf"].parallelSlots, 4);
    assert.strictEqual(map["target.gguf"].draftId, "target-dflash.gguf");
    assert.strictEqual(map["target.gguf"].specMode, "auto");
});

test("a non-empty map is never re-migrated over the user's stored choices", () => {
    const map = localRuntimeModelProfiles({
        raw: JSON.stringify({ "target.gguf": { contextLength: 4096 } }),
        legacy: { runtimeContextLength: 8192 },
        selectedId: "target.gguf"
    });
    assert.deepStrictEqual(map, { "target.gguf": { contextLength: 4096 } });
});

test("empty numeric legacy values are dropped rather than seeded as null", () => {
    // The handler reads empty number fields as NaN. NaN is not a value: seeding it would
    // JSON.stringify to null and, once Task 9b consumes the map, override the default.
    const map = localRuntimeModelProfiles({
        raw: "",
        legacy: { runtimeContextLength: NaN, runtimeDraftMax: NaN, runtimeKvType: "q4_0" },
        selectedId: "m.gguf"
    });
    assert.deepStrictEqual(map, { "m.gguf": { kvTypeK: "q4_0", kvTypeV: "q4_0" } });
});

test("the runtimeModelProfiles option exists, defaults to an empty string, and is inert", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    const block = src.match(/id: 'runtimeModelProfiles',[\s\S]*?category:/);
    assert.ok(block, "runtimeModelProfiles must be a declared option");
    assert.match(block[0], /default:\s*''/);
});

test("the runtimeWaitIdleSeconds option is a number and defaults to 1800", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    const block = src.match(/id: 'runtimeWaitIdleSeconds',[\s\S]*?category:/);
    assert.ok(block, "runtimeWaitIdleSeconds must be a declared option");
    assert.match(block[0], /type:\s*'number'/);
    assert.match(block[0], /default:\s*1800/);
    // 0 must be documented as "do not wait" so the option is not mistaken for "use the default".
    assert.match(block[0], /0 to not wait at all/);
});

test("the runtimeParallelSlots option is declared but retired as a global", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    const block = src.match(/id: 'runtimeParallelSlots',[\s\S]*?category:/);
    assert.ok(block, "runtimeParallelSlots must stay registered for migration");
    assert.match(block[0], /type:\s*'number'/);
    assert.match(block[0], /default:\s*''/);
    assert.match(block[0], /--parallel/);
    // It no longer renders: the wrapper lists it among the retired runtime option ids.
    const wrapperSrc = fs.readFileSync(path.join(__dirname, "..", "DSLRTranslationEngineWrapper.js"), "utf8");
    const retired = wrapperSrc.match(/_retiredRuntimeProfileIds = \[[\s\S]*?\];/);
    assert.ok(retired, "the retired runtime profile ids must be declared");
    assert.match(retired[0], /'runtimeParallelSlots'/, "runtimeParallelSlots must be retired from the card");
});

test("the server-level runtime options land in the general sub-group and runtimeModel heads the per-model one", () => {
    const wrapperSrc = fs.readFileSync(path.join(__dirname, "..", "DSLRTranslationEngineWrapper.js"), "utf8");
    const mapStart = wrapperSrc.indexOf("const sectionOf = (option) => {");
    const mapEnd = wrapperSrc.indexOf("const sections = [", mapStart);
    assert.ok(mapStart !== -1 && mapEnd > mapStart, "sectionOf must be locatable in the wrapper");
    const mapSrc = wrapperSrc.slice(mapStart, mapEnd);
    // The model picker is in the per-model sub-group of the one runtime card.
    assert.match(mapSrc, /id === 'runtimeModel'\) return \{ parent: 'localruntime', child: 'permodel' \};/);
    const branch = mapSrc.match(/id === 'runtimeDraftMax'[\s\S]*?return \{ parent: 'localruntime', child: 'general' \};/);
    assert.ok(branch, "the general sub-group branch must exist in sectionOf");
    for (const id of ["runtimeWaitIdleSeconds", "runtimePort", "runtimeModelsMax", "runtimeReasoning"]) {
        // Exactly one branch decides each id: a duplicate in an earlier branch would win.
        assert.strictEqual((mapSrc.match(new RegExp("'" + id + "'", "g")) || []).length, 1,
            id + " must be decided by exactly one branch of sectionOf");
        assert.match(branch[0], new RegExp("id === '" + id + "'"),
            id + " must be in the general branch, not the misc/Other Options fallback");
    }
    // runtimeParallelSlots is retired, so sectionOf must not decide it at all.
    assert.strictEqual((mapSrc.match(/'runtimeParallelSlots'/g) || []).length, 0,
        "runtimeParallelSlots must not appear in sectionOf");
});

test("one Bundled Local Runtime section holds the general, per-model and role sub-groups", () => {
    const wrapperSrc = fs.readFileSync(path.join(__dirname, "..", "DSLRTranslationEngineWrapper.js"), "utf8");
    const sectionsSrc = wrapperSrc.slice(wrapperSrc.indexOf("const sections = ["), wrapperSrc.indexOf("const childTitles ="));
    // Exactly one runtime card; the old top-level permodel/roles sections are gone.
    assert.match(sectionsSrc, /key: 'localruntime', title: 'Bundled Local Runtime'/);
    assert.ok(sectionsSrc.indexOf("key: 'permodel'") === -1, "no top-level permodel section may remain");
    assert.ok(sectionsSrc.indexOf("key: 'roles'") === -1, "no top-level roles section may remain");
    // The three sub-groups are named by childTitles.
    const titlesSrc = wrapperSrc.slice(wrapperSrc.indexOf("const childTitles ="), wrapperSrc.indexOf("const actionNodes ="));
    assert.match(titlesSrc, /general: 'General settings \(apply to every model\)'/);
    assert.match(titlesSrc, /permodel: 'Per-model settings \(for the selected model\)'/);
    assert.match(titlesSrc, /roles: 'Role assignment \(Main \/ Fallback \/ Glossary \/ Review\)'/);
    // The button/status nodes lead the CARD itself via sectionPrepend (directly under the
    // legend, above all sub-groups); the per-model panel and the role pickers are appended to
    // the card's child groups by sectionAppend (object form).
    const appendSrc = wrapperSrc.slice(wrapperSrc.indexOf("const _sectionAppend = {"), wrapperSrc.indexOf("this.translatorEngine.optionsForm = OptionFormBuilder.build"));
    assert.match(appendSrc, /localruntime: \{/);
    assert.match(appendSrc, /permodel: \(runtimePanels && runtimePanels\.nodes\) \? runtimePanels\.nodes : \[\]/);
    assert.match(appendSrc, /roles: \(runtimePanels && runtimePanels\.roleNodes\) \? runtimePanels\.roleNodes : \[\]/);
    assert.ok(appendSrc.indexOf("prepend: _runtimeLeadNodes") === -1,
        "the buttons/status must not be nested into a sub-group any more");
    const prependSrc = wrapperSrc.slice(wrapperSrc.indexOf("const _sectionPrepend = {"), wrapperSrc.indexOf("this.translatorEngine.optionsForm = OptionFormBuilder.build"));
    assert.match(prependSrc, /localruntime: _runtimeLeadNodes/);
    const buildSrc = wrapperSrc.slice(wrapperSrc.indexOf("this.translatorEngine.optionsForm = OptionFormBuilder.build"), wrapperSrc.indexOf("sectionAppend: _sectionAppend"));
    assert.match(buildSrc, /sectionPrepend: _sectionPrepend/);
});

test("the runtime card's child order puts general, per-model then roles first", () => {
    const wrapperSrc = fs.readFileSync(path.join(__dirname, "..", "DSLRTranslationEngineWrapper.js"), "utf8");
    const orderSrc = wrapperSrc.slice(wrapperSrc.indexOf("childOrder:"), wrapperSrc.indexOf("childTitle:"));
    assert.match(orderSrc, /\['general', 'permodel', 'roles'\]/);
});

test("the runtime action and status nodes are no longer the model picker's childForm", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "DSLREngine.js"), "utf8");
    // The picker must have no childForm push at all.
    assert.ok(src.indexOf("optionRuntimeModel.getChildForm()") === -1,
        "the action/status nodes must not be pushed into the model picker's childForm");
    // The nodes still exist; the wrapper leads the runtime card with them.
    assert.match(src, /this\.localRuntimeActionNodes = \[/);
    assert.match(src, /this\.localRuntimeStatusNode = \{/);
});

// --- Per-model panel helpers (Task 11) ----------------------------------------------------
// The Models panel, the speculation/projector controls and the role pickers are DOM shells over
// three pure functions. These tests pin the decisions that matter; the jsonform node assembly in
// buildRuntimePanelNodes is source-only (no display in this environment).

test("runtimeChoiceOptions offers Auto / Off / explicit FILE candidates and labels Auto with the detection", () => {
    const choices = runtimeChoiceOptions({
        detection: {
            draft: { id: "target-dflash.gguf", specType: "draft-dflash", candidates: ["target-model.gguf", "other-target.gguf"], ambiguous: false },
            mmproj: { id: "target-mmproj.gguf", candidates: ["target-model.gguf"], ambiguous: false }
        },
        profile: {},
        draftCandidates: [{ id: "target-dflash.gguf", specType: "draft-dflash", score: 900 }, { id: "other-draft.gguf", specType: "draft-mtp", score: 100 }],
        mmprojCandidates: [{ id: "target-mmproj.gguf", specType: null, score: 900 }]
    });
    assert.strictEqual(choices.spec.value, "auto");
    assert.strictEqual(choices.spec.options[0].value, "auto");
    assert.match(choices.spec.options[0].title, /draft-dflash/);
    assert.match(choices.spec.options[0].title, /target-dflash\.gguf/);
    // The explicit values are the FILE ids from candidateDraftsFor, never the detector's target ids.
    assert.deepStrictEqual(choices.spec.options.map((o) => o.value), ["auto", "off", "target-dflash.gguf", "other-draft.gguf"]);
    assert.ok(choices.spec.options.every((o) => o.value !== "target-model.gguf" && o.value !== "other-target.gguf"),
        "detection candidates are target ids and must not be offered as explicit drafts");
    assert.strictEqual(choices.spec.ambiguous, false);
    assert.strictEqual(choices.spec.note, "");

    assert.strictEqual(choices.mmproj.value, "auto");
    assert.strictEqual(choices.mmproj.options[0].value, "auto");
    assert.match(choices.mmproj.options[0].title, /target-mmproj\.gguf/);
    assert.deepStrictEqual(choices.mmproj.options.map((o) => o.value), ["auto", "off", "target-mmproj.gguf"]);
});

test("runtimeChoiceOptions ignores detection candidate target ids even without explicit candidates", () => {
    const choices = runtimeChoiceOptions({
        detection: { draft: { id: "draft.gguf", specType: "draft-dflash", candidates: ["a-model.gguf", "b-model.gguf"], ambiguous: true } },
        profile: {}
    });
    assert.deepStrictEqual(choices.spec.options.map((o) => o.value), ["auto", "off"]);
});

test("runtimeChoiceOptions reflects Off and a forced draft/projector id", () => {
    const off = runtimeChoiceOptions({ detection: {}, profile: { specMode: "off", mmprojMode: "off" } });
    assert.strictEqual(off.spec.value, "off");
    assert.strictEqual(off.mmproj.value, "off");

    const forced = runtimeChoiceOptions({
        detection: { draft: null, mmproj: null },
        profile: { specMode: "auto", draftId: "forced-draft.gguf", mmprojMode: "auto", mmprojId: "forced-mmproj.gguf" }
    });
    assert.strictEqual(forced.spec.value, "forced-draft.gguf");
    assert.strictEqual(forced.mmproj.value, "forced-mmproj.gguf");
    // The forced ids are still offered even though detection found nothing.
    assert.ok(forced.spec.options.some((o) => o.value === "forced-draft.gguf"));
    assert.ok(forced.mmproj.options.some((o) => o.value === "forced-mmproj.gguf"));
});

test("runtimeChoiceOptions notes that an external head was chosen for an MTP-capable model", () => {
    // The relaxation: a model that carries its own MTP head can still be pointed at a separate
    // head file. When that happens the picker must say so rather than silently overriding the
    // built-in head. The note is produced by the real helper from the candidate entry's
    // `embeddedHead` flag (Task 2), not restated here.
    const chosen = runtimeChoiceOptions({
        detection: { draft: null },
        profile: { draftId: "head.gguf" },
        draftCandidates: [{ id: "head.gguf", specType: "draft-mtp", kind: "mtp-head", embeddedHead: true }]
    });
    assert.ok(chosen.spec.note.indexOf("already has an embedded MTP head") !== -1);

    // A plain DFlash draft chosen for the same model carries no such note.
    const plain = runtimeChoiceOptions({
        detection: { draft: null },
        profile: { draftId: "draft.gguf" },
        draftCandidates: [{ id: "draft.gguf", specType: "draft-dflash", kind: "draft", embeddedHead: false }]
    });
    assert.strictEqual(plain.spec.note, "");

    // The ambiguity note is preserved alongside; a chosen entry with embeddedHead adds both.
    const ambiguous = runtimeChoiceOptions({
        detection: { draft: { id: "x.gguf", specType: "draft-mtp", ambiguous: true } },
        profile: { draftId: "head.gguf" },
        draftCandidates: [{ id: "head.gguf", specType: "draft-mtp", kind: "mtp-head", embeddedHead: true }]
    });
    assert.match(ambiguous.spec.note, /pick one explicitly/i);
    assert.match(ambiguous.spec.note, /already has an embedded MTP head/i);
});

test("runtimeChoiceOptions labels a built-in MTP head instead of claiming nothing is detected", () => {
    // A model that drafts for itself is speculative decoding ACTIVE with no draft file; the
    // picker must say so in the Auto entry and the note, not "Auto (none detected)".
    const embedded = runtimeChoiceOptions({
        detection: { draft: null },
        profile: {},
        info: { mtpCapable: true }
    });
    assert.strictEqual(embedded.spec.options[0].title, "Auto (built-in MTP head)");
    assert.match(embedded.spec.note, /built-in MTP head/);
    assert.match(embedded.spec.note, /no separate draft model/i);
    // The note survives an Off selection: it is what explains what Off turns off.
    const off = runtimeChoiceOptions({ detection: { draft: null }, profile: { specMode: "off" }, info: { mtpCapable: true } });
    assert.match(off.spec.note, /built-in MTP head/);

    // A model without a built-in head keeps the old label and no note.
    const plain = runtimeChoiceOptions({ detection: {}, profile: {}, info: { mtpCapable: false } });
    assert.strictEqual(plain.spec.options[0].title, "Auto (none detected)");
    assert.strictEqual(plain.spec.note, "");

    // An explicitly chosen external head replaces the built-in note with the override note.
    const forced = runtimeChoiceOptions({
        detection: { draft: null },
        profile: { draftId: "head.gguf" },
        draftCandidates: [{ id: "head.gguf", specType: "draft-mtp", kind: "mtp-head", embeddedHead: true }],
        info: { mtpCapable: true }
    });
    assert.match(forced.spec.note, /external head is used instead/);
    assert.ok(forced.spec.note.indexOf("no separate draft model") === -1,
        "the built-in note must not claim the model drafts for itself while an external head is forced");
});

test("runtimeChoiceOptions surfaces an ambiguity note and an Auto-with-nothing-detected label", () => {
    const ambiguous = runtimeChoiceOptions({
        detection: {
            draft: { id: "a.gguf", specType: "draft-dflash", candidates: ["a.gguf", "b.gguf"], ambiguous: true },
            mmproj: { id: "p.gguf", candidates: ["p.gguf", "q.gguf"], ambiguous: true }
        },
        profile: {}
    });
    assert.strictEqual(ambiguous.spec.ambiguous, true);
    assert.match(ambiguous.spec.note, /pick one explicitly/i);
    assert.strictEqual(ambiguous.mmproj.ambiguous, true);
    assert.match(ambiguous.mmproj.note, /pick one explicitly/i);

    const none = runtimeChoiceOptions({ detection: {}, profile: {} });
    assert.strictEqual(none.spec.options[0].title, "Auto (none detected)");
    assert.strictEqual(none.mmproj.options[0].title, "Auto (none detected)");
    assert.strictEqual(none.spec.value, "auto");
    assert.strictEqual(none.mmproj.value, "auto");
});

test("runtimeProfilePatch coerces integer fields and omits a cleared or invalid field", () => {
    assert.deepStrictEqual(runtimeProfilePatch("contextLength", "8192"), { contextLength: 8192 });
    assert.strictEqual(Number.isInteger(runtimeProfilePatch("contextLength", "8192").contextLength), true);
    assert.deepStrictEqual(runtimeProfilePatch("draftMax", " 3 "), { draftMax: 3 });
    assert.deepStrictEqual(runtimeProfilePatch("draftMin", "0"), { draftMin: 0 });
    assert.deepStrictEqual(runtimeProfilePatch("expertCount", "6"), { expertCount: 6 });
    assert.deepStrictEqual(runtimeProfilePatch("mainGpu", "1"), { mainGpu: 1 });
    assert.deepStrictEqual(runtimeProfilePatch("cpuMoeLayers", "40"), { cpuMoeLayers: 40 });
    assert.deepStrictEqual(runtimeProfilePatch("parallelSlots", "4"), { parallelSlots: 4 });

    for (const raw of ["", "   ", null, undefined, "abc", "8a", NaN, Infinity]) {
        assert.deepStrictEqual(runtimeProfilePatch("contextLength", raw), { contextLength: null }, "cleared/invalid: " + String(raw));
    }
    // A fractional value is rounded to a real integer so StartConfig's Number.isInteger accepts it.
    assert.deepStrictEqual(runtimeProfilePatch("contextLength", "8192.6"), { contextLength: 8193 });

    // The batch sizes clear to "" rather than null: ModelProfiles.validate's positiveIntOrEmpty
    // accepts "" or a positive integer and rejects null, so null would be a state the profile's
    // own validator rejects. A real value still persists the number.
    assert.deepStrictEqual(runtimeProfilePatch("batchSize", "1024"), { batchSize: 1024 });
    assert.deepStrictEqual(runtimeProfilePatch("ubatchSize", " 512 "), { ubatchSize: 512 });
    assert.deepStrictEqual(runtimeProfilePatch("batchSize", ""), { batchSize: "" });
    assert.deepStrictEqual(runtimeProfilePatch("ubatchSize", "abc"), { ubatchSize: "" });
    // A non-positive value normalises to "" as well: storing 0 (or -1) would be a state
    // ModelProfiles.validate's positiveIntOrEmpty rejects.
    assert.deepStrictEqual(runtimeProfilePatch("batchSize", "0"), { batchSize: "" });
    assert.deepStrictEqual(runtimeProfilePatch("ubatchSize", "-1"), { ubatchSize: "" });

    // The draft probability threshold is fractional, and clearing it stores the default's own
    // empty string rather than null: ModelProfiles.validate accepts "" but rejects null.
    assert.deepStrictEqual(runtimeProfilePatch("specDraftPMin", "0"), { specDraftPMin: 0 });
    assert.deepStrictEqual(runtimeProfilePatch("specDraftPMin", "0.25"), { specDraftPMin: 0.25 });
    assert.deepStrictEqual(runtimeProfilePatch("specDraftPMin", ""), { specDraftPMin: "" });
    assert.deepStrictEqual(runtimeProfilePatch("specDraftPMin", "abc"), { specDraftPMin: "" });

    // The MoE GPU cache and the draft physical batch behave like the batch sizes: a value
    // persists as an integer, cleared/invalid/non-positive stores "" (the default's own state,
    // which ModelProfiles.validate accepts) so a stored override can never survive a clear.
    assert.deepStrictEqual(runtimeProfilePatch("moeCacheMib", "2048"), { moeCacheMib: 2048 });
    assert.deepStrictEqual(runtimeProfilePatch("moeCacheMib", " 1024 "), { moeCacheMib: 1024 });
    for (const raw of ["", "   ", null, undefined, "abc", "0", "-1"]) {
        assert.deepStrictEqual(runtimeProfilePatch("moeCacheMib", raw), { moeCacheMib: "" }, "cleared/invalid: " + String(raw));
    }
    assert.deepStrictEqual(runtimeProfilePatch("draftUbatchSize", "256"), { draftUbatchSize: 256 });
    for (const raw of ["", null, "abc", "0"]) {
        assert.deepStrictEqual(runtimeProfilePatch("draftUbatchSize", raw), { draftUbatchSize: "" }, "cleared/invalid: " + String(raw));
    }
});

test("a cleared numeric field persists an explicit null so a stored override cannot survive", () => {
    const ModelProfiles = require(path.join(__dirname, "..", "..", "..", "..", "llmRuntime", "lib", "ModelProfiles.js"));
    let map = ModelProfiles.setProfile({}, "m.gguf", { contextLength: 8192, draftMax: 4, kvType: "q4_0" });
    // Clearing contextLength must remove it again, not leave the stored 8192 to reappear.
    map = ModelProfiles.setProfile(map, "m.gguf", runtimeProfilePatch("contextLength", ""));
    assert.strictEqual(map["m.gguf"].contextLength, null);
    // resolveProfile keeps the explicit null (it is not undefined), so the UI shows an empty
    // field; StartConfig's Number.isInteger guard then falls back to its own default.
    const resolved = ModelProfiles.resolveProfile(map, "m.gguf");
    assert.strictEqual(resolved.contextLength, null);
    assert.strictEqual(resolved.draftMax, 4);
});

test("the MoE GPU cache and draft ubatch round-trip through the stored profile and clear cleanly", () => {
    const ModelProfiles = require(path.join(__dirname, "..", "..", "..", "..", "llmRuntime", "lib", "ModelProfiles.js"));
    let map = ModelProfiles.setProfile({}, "m.gguf", Object.assign({},
        runtimeProfilePatch("moeCacheMib", "2048"),
        runtimeProfilePatch("draftUbatchSize", "256")
    ));
    assert.deepStrictEqual(map["m.gguf"], { moeCacheMib: 2048, draftUbatchSize: 256 });
    // resolve overlays the stored values on the defaults, so a saved pick survives a restart.
    let resolved = ModelProfiles.resolveProfile(map, "m.gguf");
    assert.strictEqual(resolved.moeCacheMib, 2048);
    assert.strictEqual(resolved.draftUbatchSize, 256);
    // Clearing either field stores the default's own "" (not an override), and the resolved
    // profile is byte-identical to a profile that never set them.
    map = ModelProfiles.setProfile(map, "m.gguf", runtimeProfilePatch("moeCacheMib", ""));
    map = ModelProfiles.setProfile(map, "m.gguf", runtimeProfilePatch("draftUbatchSize", "abc"));
    resolved = ModelProfiles.resolveProfile(map, "m.gguf");
    assert.strictEqual(resolved.moeCacheMib, ModelProfiles.DEFAULTS.moeCacheMib);
    assert.strictEqual(resolved.draftUbatchSize, ModelProfiles.DEFAULTS.draftUbatchSize);
});

test("runtimeProfilePatch coerces the boolean, string and gpuLayers fields", () => {
    for (const raw of [true, 1, "1", "true", "on"]) {
        assert.deepStrictEqual(runtimeProfilePatch("cpuMoe", raw), { cpuMoe: true }, String(raw));
    }
    for (const raw of [false, 0, "0", "", "off", null, undefined]) {
        assert.deepStrictEqual(runtimeProfilePatch("cpuMoe", raw), { cpuMoe: false }, String(raw));
    }

    // The retired single kvType is gone: the split K/V fields carry it now.
    assert.deepStrictEqual(runtimeProfilePatch("kvType", " q4_0 "), {});
    assert.deepStrictEqual(runtimeProfilePatch("kvTypeK", " q4_0 "), { kvTypeK: "q4_0" });
    assert.deepStrictEqual(runtimeProfilePatch("kvTypeV", " f16 "), { kvTypeV: "f16" });
    assert.deepStrictEqual(runtimeProfilePatch("draftKvType", " q5_1 "), { draftKvType: "q5_1" });
    // The draft KV "Default" selection and an empty string clear to "" (not null): validate's
    // raw-profile guard rejects null for this field as an unknown cache type.
    assert.deepStrictEqual(runtimeProfilePatch("draftKvType", ""), { draftKvType: "" });
    assert.deepStrictEqual(runtimeProfilePatch("draftKvType", null), { draftKvType: "" });
    assert.deepStrictEqual(runtimeProfilePatch("tensorSplit", "0.7,0.3"), { tensorSplit: "0.7,0.3" });
    assert.deepStrictEqual(runtimeProfilePatch("overrideTensor", " exps=CPU "), { overrideTensor: "exps=CPU" });
    assert.deepStrictEqual(runtimeProfilePatch("loadMode", ""), { loadMode: null });
    assert.deepStrictEqual(runtimeProfilePatch("splitMode", null), { splitMode: null });

    assert.deepStrictEqual(runtimeProfilePatch("gpuLayers", "auto"), { gpuLayers: "auto" });
    assert.deepStrictEqual(runtimeProfilePatch("gpuLayers", "32"), { gpuLayers: 32 });
    assert.deepStrictEqual(runtimeProfilePatch("gpuLayers", ""), { gpuLayers: null });
    assert.deepStrictEqual(runtimeProfilePatch("gpuLayers", "nonsense"), { gpuLayers: null });
});

test("runtimeProfilePatch normalizes the spec/projector mode and id fields", () => {
    assert.deepStrictEqual(runtimeProfilePatch("specMode", "off"), { specMode: "off" });
    assert.deepStrictEqual(runtimeProfilePatch("specMode", "auto"), { specMode: "auto" });
    assert.deepStrictEqual(runtimeProfilePatch("specMode", ""), { specMode: "auto" });
    assert.deepStrictEqual(runtimeProfilePatch("mmprojMode", "off"), { mmprojMode: "off" });
    assert.deepStrictEqual(runtimeProfilePatch("mmprojMode", "anything-else"), { mmprojMode: "auto" });

    assert.deepStrictEqual(runtimeProfilePatch("draftId", "target-dflash.gguf"), { draftId: "target-dflash.gguf" });
    assert.deepStrictEqual(runtimeProfilePatch("draftId", ""), { draftId: null });
    assert.deepStrictEqual(runtimeProfilePatch("draftId", "auto"), { draftId: null });
    assert.deepStrictEqual(runtimeProfilePatch("draftId", "off"), { draftId: null });
    assert.deepStrictEqual(runtimeProfilePatch("mmprojId", ""), { mmprojId: null });
    assert.deepStrictEqual(runtimeProfilePatch("mmprojId", "../x.gguf"), { mmprojId: "../x.gguf" });

    assert.deepStrictEqual(runtimeProfilePatch("notAProfileField", "x"), {});
    assert.deepStrictEqual(runtimeProfilePatch("", "x"), {});
});

test("runtimeProfilePatch output composes into a valid ModelProfiles.setProfile patch", () => {
    const ModelProfiles = require(path.join(__dirname, "..", "..", "..", "..", "llmRuntime", "lib", "ModelProfiles.js"));
    let map = {};
    for (const [field, raw] of [
        ["contextLength", "8192"], ["draftMax", "4"], ["kvTypeK", "q4_0"], ["kvTypeV", "q4_0"],
        ["cpuMoe", "true"], ["batchSize", "1024"], ["ubatchSize", "256"], ["specDraftPMin", "0"],
        ["draftKvType", "q5_1"]
    ]) {
        map = ModelProfiles.setProfile(map, "m.gguf", runtimeProfilePatch(field, raw));
    }
    const resolved = ModelProfiles.resolveProfile(map, "m.gguf");
    assert.strictEqual(resolved.contextLength, 8192);
    assert.strictEqual(resolved.draftMax, 4);
    // The split K/V fields are stored directly now; there is no single kvType any more.
    assert.strictEqual(resolved.kvType, undefined);
    assert.strictEqual(resolved.kvTypeK, "q4_0");
    assert.strictEqual(resolved.kvTypeV, "q4_0");
    assert.strictEqual(resolved.batchSize, 1024);
    assert.strictEqual(resolved.ubatchSize, 256);
    assert.strictEqual(resolved.specDraftPMin, 0);
    assert.strictEqual(resolved.draftKvType, "q5_1");
    assert.strictEqual(resolved.cpuMoe, true);
    assert.strictEqual(ModelProfiles.validate(resolved, {}).ok, true);

    // The same composition with each new field cleared must also be a state the profile's own
    // validator accepts: an empty batch size / draft probability / draft KV type stores "" (not
    // null), which positiveIntOrEmpty and the raw guard accept. Cleared contextLength keeps its
    // documented null, which validate tolerates. An explicit "0" is normalised to "" too, because
    // a stored 0 is a state validate's positiveIntOrEmpty rejects.
    let cleared = {};
    for (const [field, raw] of [
        ["contextLength", ""], ["batchSize", ""], ["ubatchSize", ""],
        ["batchSize", "0"], ["ubatchSize", "0"],
        ["specDraftPMin", ""], ["draftKvType", ""]
    ]) {
        cleared = ModelProfiles.setProfile(cleared, "m.gguf", runtimeProfilePatch(field, raw));
    }
    // The raw patch must not carry a null the validator rejects for these fields.
    for (const key of ["batchSize", "ubatchSize", "specDraftPMin", "draftKvType"]) {
        assert.notStrictEqual(cleared["m.gguf"][key], null, key + " must not persist null when cleared");
    }
    // validate() is given the raw profile here, so its own guards (which normalise null away in
    // resolveProfile) actually run.
    const rawValidation = ModelProfiles.validate(cleared["m.gguf"], {});
    assert.strictEqual(rawValidation.ok, true,
        "a cleared profile must validate: " + JSON.stringify(rawValidation.errors));
    const clearedResolved = ModelProfiles.resolveProfile(cleared, "m.gguf");
    assert.strictEqual(clearedResolved.batchSize, "");
    assert.strictEqual(clearedResolved.ubatchSize, "");
    assert.strictEqual(clearedResolved.specDraftPMin, "");
    assert.strictEqual(clearedResolved.draftKvType, "");
    assert.strictEqual(ModelProfiles.validate(clearedResolved, {}).ok, true);
});

test("rolePickerUpdates maps a chosen local model to the RoleBinding model+URL pair", () => {
    assert.deepStrictEqual(rolePickerUpdates("main", "gemma-4.gguf", 1234), [
        { id: "model", value: "gemma-4.gguf" },
        { id: "apiUrl", value: "http://127.0.0.1:1234/v1/chat/completions" }
    ]);
    assert.deepStrictEqual(rolePickerUpdates("fallback", "qwen.gguf", 1234), [
        { id: "model2", value: "qwen.gguf" },
        { id: "apiUrl2", value: "http://127.0.0.1:1234/v1/chat/completions" }
    ]);
    assert.deepStrictEqual(rolePickerUpdates("glossary", "qwen.gguf", 7777), [
        { id: "glossaryModel", value: "qwen.gguf" },
        { id: "glossaryApiUrl", value: "http://127.0.0.1:7777/v1/chat/completions" }
    ]);
    assert.deepStrictEqual(rolePickerUpdates("review", "qwen.gguf", 1234), [
        { id: "reviewModel", value: "qwen.gguf" },
        { id: "reviewApiUrl", value: "http://127.0.0.1:1234/v1/chat/completions" }
    ]);
});

test("rolePickerUpdates clears both options for the not-bundled choice", () => {
    assert.deepStrictEqual(rolePickerUpdates("main", "", 1234), [
        { id: "model", value: "" }, { id: "apiUrl", value: "" }
    ]);
    assert.deepStrictEqual(rolePickerUpdates("review", null, 1234), [
        { id: "reviewModel", value: "" }, { id: "reviewApiUrl", value: "" }
    ]);
    assert.deepStrictEqual(rolePickerUpdates("glossary", "none", 1234), [
        { id: "glossaryModel", value: "" }, { id: "glossaryApiUrl", value: "" }
    ]);
});

test("rolePickerUpdates rejects an unknown role", () => {
    assert.throws(() => rolePickerUpdates("constructor", "m.gguf", 1234), /unknown role/);
    assert.throws(() => rolePickerUpdates("nope", "", 1234), /unknown role/);
});

test("roleReloadNote warns only when one model may be loaded and roles differ", () => {
    assert.match(roleReloadNote(["a.gguf", "b.gguf"], 1), /reloads the model/);
    assert.strictEqual(roleReloadNote(["a.gguf", "b.gguf"], 2), "");
    assert.strictEqual(roleReloadNote(["a.gguf", "a.gguf"], 1), "");
    assert.strictEqual(roleReloadNote(["a.gguf", "", null, undefined], 1), "");
    assert.strictEqual(roleReloadNote([], 1), "");
    assert.strictEqual(roleReloadNote(["a.gguf", "b.gguf"], "1"), roleReloadNote(["a.gguf", "b.gguf"], 1));
});

// --- Model-specific field hints (Task 18) --------------------------------------------------
// runtimeFieldHints is a pure builder: each sentence states the selected model's own limits
// (trained context, layer count, experts) and the effective value of the field left empty.
// Nothing may be pre-filled into the form itself; the hint is where the effective value lives.
test("runtimeFieldHints recommends F16 only for a publisher on the allowlist", () => {
    // Task 1 put general.quantized_by on the detection result as info.publisher. The publisher's
    // own release notes for this family recommend F16 K and V; the hint is advisory only and the
    // default stays q8_0.
    const flagged = runtimeFieldHints({ info: { publisher: "HauhauCS", blockCount: 65, contextLength: 262144 } });
    assert.ok(flagged.kvTypeK.indexOf("publisher recommends F16") !== -1);
    assert.ok(flagged.kvTypeV.indexOf("publisher recommends F16") !== -1);
    // Case-insensitive allowlist match.
    const lower = runtimeFieldHints({ info: { publisher: "hauhaucs" } });
    assert.ok(lower.kvTypeK.indexOf("publisher recommends F16") !== -1);

    for (const publisher of [null, undefined, "", "someone else"]) {
        const plain = runtimeFieldHints({ info: { publisher: publisher, blockCount: 65, contextLength: 262144 } });
        assert.strictEqual(plain.kvTypeK.indexOf("publisher recommends F16"), -1,
            "no F16 hint for publisher " + String(publisher));
        assert.ok(plain.kvTypeK.indexOf("q8_0 halves KV memory") !== -1);
    }
    // No model info at all: the default wording, never the publisher claim.
    const none = runtimeFieldHints({ info: null });
    assert.strictEqual(none.kvTypeK.indexOf("publisher recommends F16"), -1);
    assert.ok(none.kvTypeK.indexOf("q8_0 halves KV memory") !== -1);
});

test("runtimeFieldHints tells a built-in MTP head apart from a paired draft file", () => {
    // The token fields and the probability threshold bound a built-in head through the same
    // spec flags as a paired draft, so the hints must say they APPLY - not the bare "only
    // applies when a draft model is paired", which reads as "this model has no speculation".
    const embedded = runtimeFieldHints({ info: { mtpCapable: true, blockCount: 30 } });
    assert.ok(embedded.draftMax.indexOf("bounds that head") !== -1);
    assert.ok(embedded.draftMin.indexOf("bounds that head") !== -1);
    assert.ok(embedded.specDraftPMin.indexOf("built-in MTP head") !== -1);
    // The placement fields: a built-in head follows the model's own GPU layers (placement
    // flags stay draft-file-only), and the draft KV cache type stays draft-only too.
    assert.ok(embedded.draftGpuLayers.indexOf("follows its GPU layers") !== -1);
    assert.strictEqual(embedded.draftKvType, "Only applies when a draft model is paired.");

    // Without a built-in head the plain wording stands (this model really has nothing paired).
    const plain = runtimeFieldHints({ info: { blockCount: 30 } });
    assert.strictEqual(plain.draftMax, "Only applies when a draft model is paired.");
    assert.strictEqual(plain.draftMin, "Only applies when a draft model is paired.");
    assert.strictEqual(plain.specDraftPMin, "Only applies when a draft model is paired.");
    assert.strictEqual(plain.draftGpuLayers, "Only used when this model has a draft model paired; it is ignored otherwise.");

    // A PAIRED draft still gets the draft's own facts; the target's mtpCapable never enters it.
    const paired = runtimeFieldHints({ info: { blockCount: 30 }, draftInfo: { blockCount: 8 } });
    assert.ok(paired.draftGpuLayers.indexOf("paired draft model has 8 layer blocks") !== -1);
});

test("runtimeFieldHints checks the metadata chain publisher, then name, then basename", () => {
    // Spec §3.5: a file derived from this family that omits general.quantized_by is still flagged
    // by its general.name or general.basename. Metadata only - no path or file name is consulted.
    const byName = runtimeFieldHints({ info: { publisher: null, name: "Qwen3.8-HauhauCS-Aggressive-FastMTP", basename: "Qwen3.8-HauhauCS" } });
    assert.ok(byName.kvTypeK.indexOf("publisher recommends F16") !== -1);
    assert.ok(byName.kvTypeV.indexOf("publisher recommends F16") !== -1);

    // Name is already a recognised token but obscured by case; still matches case-insensitively.
    const byNameMixedCase = runtimeFieldHints({ info: { publisher: null, name: "hAuHaUcS-variant", basename: null } });
    assert.ok(byNameMixedCase.kvTypeK.indexOf("publisher recommends F16") !== -1);

    // Publisher is first in the chain: a name that does not match must not defeat a matching
    // publisher, and vice versa (the publisher is consulted before the name).
    const publisherWins = runtimeFieldHints({ info: { publisher: "HauhauCS", name: "plain-name", basename: "plain" } });
    assert.ok(publisherWins.kvTypeK.indexOf("publisher recommends F16") !== -1);

    // None of the three carries the token: the plain, default wording.
    for (const info of [
        { publisher: null, name: "Qwen3.8-Uncensored", basename: "Qwen3.8" },
        { publisher: "", name: "", basename: "" },
        { publisher: null, name: null, basename: null },
        { publisher: null, name: undefined, basename: undefined }
    ]) {
        const plain = runtimeFieldHints({ info: info });
        assert.strictEqual(plain.kvTypeK.indexOf("publisher recommends F16"), -1,
            "no F16 hint for " + JSON.stringify(info));
        assert.ok(plain.kvTypeK.indexOf("q8_0 halves KV memory") !== -1);
    }
});

test("runtimeFieldHints states a MoE model's own numbers and the effective values", () => {
    const hints = runtimeFieldHints({
        info: { blockCount: 41, contextLength: 262144, expertCount: 256, expertUsedCount: 8 },
        profile: {}, threads: 12
    });
    assert.strictEqual(hints.contextLength,
        "This model was trained for up to 262,144 tokens. Shipped default: 32768.");
    assert.strictEqual(hints.gpuLayers,
        "This model has 41 layer blocks, plus its output weights as one more unit, so 42 or 'all' places the whole model. auto lets llama.cpp fit as many as your VRAM allows; 0 keeps it all on the CPU.");
    assert.strictEqual(hints.cpuMoe,
        "This model has 41 layers; keeps the first N layers' experts in system RAM. Empty lets llama.cpp decide.");
    assert.strictEqual(hints.cpuMoeLayers, hints.cpuMoe);
    assert.strictEqual(hints.expertCount,
        "This model has 256 experts and activates 8 per token by default. Lower is faster; empty keeps 8.");
    assert.strictEqual(hints.mainGpu, "Empty uses the first GPU.");
    assert.strictEqual(hints.tensorSplit, "Empty divides the work evenly.");
    assert.strictEqual(hints.overrideTensor, "Empty means no tensor overrides.");
    assert.strictEqual(hints.draftMax, "Only applies when a draft model is paired.");
    assert.strictEqual(hints.draftMin, "Only applies when a draft model is paired.");
});

test("runtimeFieldHints tells a dense model its expert settings are ignored", () => {
    const hints = runtimeFieldHints({
        info: { blockCount: 42, contextLength: null, expertCount: null, expertUsedCount: null }
    });
    assert.strictEqual(hints.contextLength, "Shipped default: 32768.");
    assert.strictEqual(hints.gpuLayers,
        "This model has 42 layer blocks, plus its output weights as one more unit, so 43 or 'all' places the whole model. auto lets llama.cpp fit as many as your VRAM allows; 0 keeps it all on the CPU.");
    assert.strictEqual(hints.cpuMoe, "This model has no expert weights to offload; this setting is ignored.");
    assert.strictEqual(hints.cpuMoeLayers, hints.cpuMoe);
    assert.strictEqual(hints.expertCount, "This model has no mixture-of-experts; this setting is ignored.");
});

test("runtimeFieldHints degrades to default-only wording with no model info", () => {
    const hints = runtimeFieldHints({ info: null });
    assert.strictEqual(hints.contextLength, "Shipped default: 32768.");
    assert.strictEqual(hints.gpuLayers,
        "auto lets llama.cpp fit as many as your VRAM allows; 0 keeps it all on the CPU.");
    // With nothing known, the expert-dependent hints are omitted rather than guessed.
    assert.strictEqual(hints.cpuMoe, undefined);
    assert.strictEqual(hints.cpuMoeLayers, undefined);
    assert.strictEqual(hints.expertCount, undefined);
    assert.strictEqual(hints.mainGpu, "Empty uses the first GPU.");
    assert.strictEqual(hints.draftMin, "Only applies when a draft model is paired.");
    // The whole input is optional.
    assert.deepStrictEqual(runtimeFieldHints(), runtimeFieldHints({ info: null }));
});

test("runtimeFieldHints drops the activation count when only the expert total is known", () => {
    const hints = runtimeFieldHints({ info: { blockCount: 41, expertCount: 256, expertUsedCount: null } });
    assert.strictEqual(hints.expertCount, "This model has 256 experts. Lower is faster.");
});

test("runtimeFieldHints formats thousands and ignores non-numeric facts", () => {
    const hints = runtimeFieldHints({
        info: { blockCount: 1000, contextLength: 1234567, expertCount: 12, expertUsedCount: 2 }
    });
    assert.match(hints.contextLength, /1,234,567 tokens/);
    assert.match(hints.gpuLayers, /1,000 layer blocks/);
    assert.match(hints.gpuLayers, /1,001 or 'all'/);
    assert.match(hints.expertCount, /activates 2 per token by default/);

    const junk = runtimeFieldHints({
        info: { blockCount: "many", contextLength: NaN, expertCount: "lots", expertUsedCount: Infinity }
    });
    assert.strictEqual(junk.contextLength, "Shipped default: 32768.");
    assert.match(junk.gpuLayers, /^auto lets llama\.cpp/);
    assert.match(junk.expertCount, /no mixture-of-experts/);
});

test("runtimeHardwareNote reports logical CPUs and omits unknown counts", () => {
    assert.strictEqual(runtimeHardwareNote(12), "This machine reports 12 logical CPUs.");
    assert.strictEqual(runtimeHardwareNote(1024), "This machine reports 1,024 logical CPUs.");
    for (const bad of [null, undefined, 0, -2, NaN, Infinity, "8", {}]) {
        assert.strictEqual(runtimeHardwareNote(bad), "", "must omit: " + String(bad));
    }
});

test("buildRuntimePanelNodes appends hints to field descriptions without adding help nodes", () => {
    const savedWindow = globalThis.window;
    globalThis.window = {}; // no window.llmRuntime: the model info is null and hints degrade
    try {
        const engine = {
            buildRuntimePanelNodes: proto.buildRuntimePanelNodes,
            refreshPanelValues: proto.refreshPanelValues,
            optionRuntimeModel: { getValue: () => "" }
        };
        const panel = engine.buildRuntimePanelNodes();
        function nodeFor(key) {
            return panel.nodes.filter((node) => node.key === key)[0];
        }
        assert.match(nodeFor("rtProfile_contextLength").description, /Shipped default: 32768\.$/);
        assert.match(nodeFor("rtProfile_gpuLayers").description, /0 keeps it all on the CPU\.$/);
        assert.match(nodeFor("rtProfile_draftMax").description, /Only applies when a draft model is paired\.$/);
        // The parallel-slots field carries the context-sharing caveat and llama.cpp's default of 4.
        assert.match(nodeFor("rtProfile_parallelSlots").description, /context between concurrent requests/);
        assert.match(nodeFor("rtProfile_parallelSlots").description, /llama\.cpp's default of 4/);
        // The hints must not add extra keyed nodes or schema entries.
        assert.strictEqual(panel.nodes.filter((node) => node.type === "help").length, 3);
        assert.strictEqual(Object.keys(panel.schema).length,
            panel.nodes.filter((n) => n.key !== undefined).length + panel.roleNodes.filter((n) => n.key !== undefined).length);
    } finally {
        if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    }
});

// --- jsonform node/schema invariant (empty model list) -----------------------------------
// jsonform throws during init when a "help" node carries a key that links it to a schema
// entry: "The JSONForm contains an element that links to an element in the JSON schema ...
// and that should not based on its type (\"help\")". www/js/options.js alerts on that init
// error, which hangs the Options window permanently. buildRuntimePanelNodes used to add each
// of its four notice nodes with its local add() (key + schema); they must instead be rendered
// bare, exactly like this.localRuntimeStatusNode and the OptionFormBuilder help nodes.
test("buildRuntimePanelNodes renders keyless help nodes and keeps keyed fields in schema with no models", () => {
    const savedWindow = globalThis.window;
    globalThis.window = {}; // no window.llmRuntime: the empty model list the user reported
    try {
        const engine = {
            buildRuntimePanelNodes: proto.buildRuntimePanelNodes,
            refreshPanelValues: proto.refreshPanelValues,
            optionRuntimeModel: { getValue: () => "" }
        };
        const panel = engine.buildRuntimePanelNodes();
        assert.ok(Array.isArray(panel.nodes), "panel must return a nodes array");
        assert.ok(Array.isArray(panel.roleNodes), "panel must return the role nodes separately");
        assert.strictEqual(typeof panel.schema, "object");
        assert.strictEqual(typeof panel.defaults, "object");

        const helpNodes = panel.nodes.filter((node) => node.type === "help");
        assert.strictEqual(helpNodes.length, 3, "the three per-model notice nodes must still be rendered");
        assert.strictEqual(panel.roleNodes.filter((node) => node.type === "help").length, 1,
            "the role notice node lives with the role nodes");
        for (const node of panel.nodes.concat(panel.roleNodes)) {
            if (node.type === "help") assert.strictEqual(node.key, undefined, "a help node must carry no key");
        }
        for (const key of Object.keys(panel.schema)) {
            assert.ok(!helpNodes.some((node) => node.key === key),
                "schema must hold no entry for a help node: " + key);
        }

        const keyed = panel.nodes.concat(panel.roleNodes).filter((node) => node.key !== undefined);
        for (const node of keyed) {
            assert.ok(Object.prototype.hasOwnProperty.call(panel.schema, node.key),
                "keyed node " + node.key + " must have a matching schema entry");
        }
        for (const key of Object.keys(panel.schema)) {
            assert.ok(keyed.some((node) => node.key === key),
                "schema key " + key + " must correspond to a keyed node");
        }

        const keys = keyed.map((node) => node.key);
        for (const expected of [
            "rtProfile_contextLength", "rtProfile_parallelSlots", "rtProfile_gpuLayers",
            "rtProfile_cpuMoe", "rtProfile_loadMode", "rtProfile_splitMode", "rtProfile_draftMax",
            "rtSpecMode", "rtMmprojMode"
        ]) {
            assert.ok(keys.indexOf(expected) !== -1, "expected keyed field " + expected);
        }
        // The single KV field is retired; the K/V split and the new knobs are the per-model
        // surface now (Task 3's profile fields, Task 6's card).
        assert.strictEqual(keys.indexOf("rtProfile_kvType"), -1, "the legacy single KV field must be gone");
        for (const expected of [
            "rtProfile_kvTypeK", "rtProfile_kvTypeV", "rtProfile_batchSize", "rtProfile_ubatchSize",
            "rtProfile_specDraftPMin", "rtProfile_draftKvType"
        ]) {
            assert.ok(keys.indexOf(expected) !== -1, "expected keyed field " + expected);
        }
        // The role pickers are separate so the wrapper can put them in the roles section.
        const roleKeys = panel.roleNodes.filter((node) => node.key !== undefined).map((node) => node.key);
        for (const expected of ["rtRole_main", "rtRole_fallback", "rtRole_glossary", "rtRole_review"]) {
            assert.ok(roleKeys.indexOf(expected) !== -1, "expected role field " + expected);
            assert.strictEqual(panel.nodes.some((node) => node.key === expected), false,
                expected + " must not also be in the per-model nodes");
        }
    } finally {
        if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    }
});

// Spec 3.5 asks both KV selects to carry the existing quality/memory trade-off description. The K
// select must not regress to a bare "quantization of the key cache" line.
test("the K cache type field carries the same trade-off description as V", () => {
    const savedWindow = globalThis.window;
    globalThis.window = {};
    try {
        const engine = {
            buildRuntimePanelNodes: proto.buildRuntimePanelNodes,
            refreshPanelValues: proto.refreshPanelValues,
            optionRuntimeModel: { getValue: () => "" }
        };
        const panel = engine.buildRuntimePanelNodes();
        const nodes = panel.nodes.concat(panel.roleNodes).filter((node) => node.key !== undefined);
        const k = nodes.find((node) => node.key === "rtProfile_kvTypeK");
        const v = nodes.find((node) => node.key === "rtProfile_kvTypeV");
        assert.ok(k && k.description, "the K field must carry a description");
        // The shared trade-off sentence from optionRuntimeKvType, which the appended model hint does
        // not contain, so this asserts the field's own text.
        assert.match(String(k.description), /trades a little quality for memory and speed/i);
        assert.match(String(k.description), /f16\/bf16/i);
        // V keeps its value-cache-specific caveat.
        assert.match(String(v.description), /flash attention/i);
    } finally {
        if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    }
});

// --- Ticker model-list gate (no Options window open) -------------------------------------
// syncRuntimeModelSelect runs from the engine's 3s background ticker. Its only job is to fill
// and persist the Options window's model picker, so with no such element it must not request
// the model list at all - that request reads every GGUF's metadata and saturated the main
// thread even while the Options window was closed.
test("_syncRuntimeModelSelect does not request the model list when no select element exists", () => {
    const engine = { _syncRuntimeModelSelect: proto._syncRuntimeModelSelect };
    let requested = 0;
    const result = engine._syncRuntimeModelSelect(null, {
        findRuntimeSelect: () => null,
        runtimeModelIds: () => { requested++; return ["a.gguf"]; }
    });
    assert.strictEqual(result, false);
    assert.strictEqual(requested, 0, "the model list must not be requested with no element");
});

test("_syncRuntimeModelSelect requests the list and fills the picker when the element exists", () => {
    const engine = { _syncRuntimeModelSelect: proto._syncRuntimeModelSelect };
    let requested = 0;
    let value = "";
    const el = {
        val: function (v) { if (arguments.length === 0) return value; value = v; return this; },
        find: function () { return { length: 1 }; },
        empty: function () { return this; },
        append: function () { return this; }
    };
    const result = engine._syncRuntimeModelSelect(null, {
        findRuntimeSelect: () => el,
        runtimeModelIds: () => { requested++; return ["a.gguf"]; }
    });
    assert.strictEqual(result, true);
    assert.strictEqual(requested, 1, "the list must be requested when the picker is present");
    assert.strictEqual(value, "a.gguf");
});

// --- Start handler profile validation (Task 5) -------------------------------------------
// The Start button's onClick is built inside the engine constructor, so driving it needs a
// constructed engine and a fake runtime. The constructor's only eager browser dependencies are
// the window handle and the 3s status ticker, both stubbed here; with no DOM the status line
// falls back to the alert() path, which is what captures the messages under test. The handler
// reads the model id and the persisted profile map straight off the option stubs, exactly like
// the real form would, so the validation runs on the handler's own values.
async function runStartHandler(profilesJson) {
    const saved = {
        setInterval: globalThis.setInterval,
        alert: globalThis.alert,
        window: globalThis.window
    };
    const statusTexts = [];
    let startCalls = 0;
    const fakeRuntime = {
        readDrafts: () => ({}),
        associations: () => ({ byTarget: { "m.gguf": { draft: null, mmproj: null } } }),
        startLocal: () => { startCalls++; return Promise.resolve({ modelId: "m.gguf" }); },
        setSelectedModel: () => {},
        bindToDslr: () => {},
        describeStatus: () => Promise.resolve("Running - test - m.gguf"),
        status: () => ({ status: "stopped" })
    };
    globalThis.setInterval = () => 0;
    globalThis.alert = (text) => statusTexts.push(String(text));
    globalThis.window = { llmRuntime: fakeRuntime };
    try {
        const engine = new DSLREngine({}, { package: { description: "test" } });
        engine.optionRuntimeModel.getValue = () => "m.gguf";
        engine.optionRuntimeModelProfiles.getValue = () => profilesJson;
        const start = engine.localRuntimeActionNodes[0].items[0];
        start.onClick({});
        // Let the startLocal promise chain settle so the final status write happens too.
        await new Promise((resolve) => setImmediate(resolve));
        return { statusTexts, startCalls };
    } finally {
        globalThis.setInterval = saved.setInterval;
        globalThis.alert = saved.alert;
        if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    }
}

test("an invalid model profile refuses the start and reports why", async () => {
    // A model whose profile has ubatchSize above the effective batch (batchSize empty, so the
    // runtime's 2048 logical default), driven through the Start handler's own path.
    const result = await runStartHandler(JSON.stringify({ "m.gguf": { ubatchSize: 4096 } }));
    assert.strictEqual(result.startCalls, 0,
        "the runtime must not be asked to start when the selected model's profile is invalid");
    assert.ok(result.statusTexts.some((t) => t.indexOf("Cannot start the local runtime: ") === 0),
        "the status line must carry the refusal in the validator's own words");
    assert.ok(result.statusTexts.some((t) => t.indexOf("physical batch size (4096) is larger than the logical batch size (2048)") !== -1),
        "the validator's batch-size message must be surfaced");
    assert.ok(result.statusTexts.every((t) => t.indexOf("Starting the local runtime...") === -1),
        "the start-progress message must not appear when the start is refused");
});

test("a valid profile still starts", async () => {
    const result = await runStartHandler(JSON.stringify({ "m.gguf": { contextLength: 8192 } }));
    assert.strictEqual(result.startCalls, 1, "a valid profile must reach the runtime's startLocal");
    assert.ok(result.statusTexts.some((t) => t.indexOf("Starting the local runtime...") === 0),
        "the start-progress message must still be shown");
    assert.ok(result.statusTexts.every((t) => t.indexOf("Cannot start the local runtime") === -1),
        "a valid profile must not raise the refusal message");
});

// --- Draft placement hints know the paired draft ------------------------------------------
// detection.draft is the association OBJECT ({ id, specType, ... }), so the panel must read
// `.id` before looking the draft up in modelInfos. Regression: the object went straight into
// the id lookup, never matched, and the draft fields rendered the generic "no draft paired"
// hint even for a model whose draft was detected and in use.
test("buildRuntimePanelNodes states the paired draft's own layer count in the draft hints", () => {
    const savedWindow = globalThis.window;
    globalThis.window = {
        llmRuntime: {
            targetModels: function () { return [{ id: "t.gguf" }]; },
            readDrafts: function () { return {}; },
            associations: function () {
                return { byTarget: { "t.gguf": { draft: { id: "d.gguf", specType: "draft-dflash" }, mmproj: null } } };
            },
            candidateDraftsFor: function () { return []; },
            candidateProjectorsFor: function () { return []; },
            modelInfos: function () {
                return [
                    { id: "t.gguf", blockCount: 32, kind: "model" },
                    { id: "d.gguf", blockCount: 7, kind: "draft" }
                ];
            }
        }
    };
    try {
        const engine = {
            buildRuntimePanelNodes: proto.buildRuntimePanelNodes,
            refreshPanelValues: proto.refreshPanelValues,
            optionRuntimeModel: { getValue: () => "t.gguf" }
        };
        const panel = engine.buildRuntimePanelNodes();
        const nodeFor = (key) => panel.nodes.filter((node) => node.key === key)[0];
        const draftDesc = nodeFor("rtProfile_draftGpuLayers").description;
        assert.match(draftDesc, /The paired draft model has 7 layer blocks, plus its output weights as one more unit, so 8 or 'all' places all of it\./);
        assert.doesNotMatch(draftDesc, /it is ignored otherwise/);
        // The target's own field still states the target's block count, not the draft's.
        assert.match(nodeFor("rtProfile_gpuLayers").description, /This model has 32 layer blocks/);
        // The build publishes the panel's current values onto the engine: options.js
        // assignDefault copies engine[key] onto schema[key].default, and that default is the
        // ONLY thing jsonform renders for a keyed field. Without the emission the panel showed
        // build-time fallbacks on every reopen, whatever was stored.
        assert.strictEqual(engine.rtSpecMode, "auto");
        assert.strictEqual(engine.rtMmprojMode, "auto");
        assert.strictEqual(engine["rtProfile_contextLength"], "32768");
        assert.strictEqual(engine["rtProfile_draftGpuLayers"], "auto");
        assert.strictEqual(engine["rtRole_main"], "");
    } finally {
        globalThis.window = savedWindow;
    }
});

test("applyPanelValuesToProfiles commits the panel's live form values to the selected model's profile", () => {
    // Close-time safety net for the per-model panel: a pick must land even when jsonform never
    // delivered the field's change event (the lossy layer that made a draft pick behave like
    // Auto and the menu reopen on Off).
    const applyPanelValuesToProfiles = engineModule.applyPanelValuesToProfiles;
    const stored = JSON.stringify({
        "t.gguf": { specMode: "off", draftId: null },
        "other.gguf": { contextLength: 4096 }
    });
    let savedValue = null;
    const engine = {
        optionRuntimeModel: { getValue: () => "t.gguf" },
        optionRuntimeModelProfiles: {
            getValue: () => stored,
            setValue: (v) => { savedValue = v; }
        }
    };

    const result = applyPanelValuesToProfiles(engine, {
        rtSpecMode: "forced-draft.gguf",
        "rtProfile_contextLength": "8192",
        "rtProfile_gpuLayers": "12",
        "rtProfile_moeCacheMib": "2048",
        "rtProfile_draftUbatchSize": "256",
        unrelatedKey: "must be ignored"
    });
    assert.deepStrictEqual(result.patch, {
        specMode: "auto", draftId: "forced-draft.gguf",
        contextLength: 8192, gpuLayers: 12,
        moeCacheMib: 2048, draftUbatchSize: 256
    });
    assert.strictEqual(result.modelId, "t.gguf");
    const map = JSON.parse(savedValue);
    // The pick overrides the stored Off and the other model's profile is untouched.
    assert.strictEqual(map["t.gguf"].specMode, "auto");
    assert.strictEqual(map["t.gguf"].draftId, "forced-draft.gguf");
    assert.strictEqual(map["t.gguf"].contextLength, 8192);
    assert.strictEqual(map["t.gguf"].gpuLayers, 12);
    assert.strictEqual(map["t.gguf"].moeCacheMib, 2048);
    assert.strictEqual(map["t.gguf"].draftUbatchSize, 256);
    assert.strictEqual(map["other.gguf"].contextLength, 4096);
    // The render-time engine properties (options.js assignDefault copies engine[key] onto the
    // schema default) must reflect the flushed values, or the next Options render shows the
    // previous state again.
    assert.strictEqual(engine.rtSpecMode, "forced-draft.gguf");
    assert.strictEqual(engine["rtProfile_contextLength"], "8192");
    assert.strictEqual(engine["rtProfile_gpuLayers"], "12");
    assert.strictEqual(engine["rtProfile_moeCacheMib"], "2048");
    assert.strictEqual(engine["rtProfile_draftUbatchSize"], "256");
});

test("applyPanelValuesToProfiles maps Auto/Off and ignores an empty or model-less flush", () => {
    const applyPanelValuesToProfiles = engineModule.applyPanelValuesToProfiles;
    let writes = 0;
    const engine = {
        optionRuntimeModel: { getValue: () => "t.gguf" },
        optionRuntimeModelProfiles: {
            getValue: () => JSON.stringify({ "t.gguf": { draftId: "d.gguf" } }),
            setValue: () => { writes += 1; }
        }
    };
    // Picking Off clears the forced draft id, exactly like the select's own handler.
    const off = applyPanelValuesToProfiles(engine, { rtSpecMode: "off" });
    assert.deepStrictEqual(off.patch, { specMode: "off", draftId: null });
    assert.strictEqual(writes, 1);
    assert.strictEqual(engine.rtSpecMode, "off");
    // A flush with no panel keys writes nothing.
    assert.strictEqual(applyPanelValuesToProfiles(engine, { unrelated: "x" }), null);
    assert.strictEqual(writes, 1);
    // No selected model, no write.
    const noModel = applyPanelValuesToProfiles(
        { optionRuntimeModel: { getValue: () => "" }, optionRuntimeModelProfiles: engine.optionRuntimeModelProfiles },
        { rtSpecMode: "auto" });
    assert.strictEqual(noModel, null);
});

test("refreshPanelValues republishes the stored profile onto the render target", () => {
    // The panel builds at engine initialization, BEFORE the engine's own config lands in
    // sys.config - the startup build reads storedDraftId=none and emits "auto". The render-time
    // refresh is what carries the persisted pick into the rendered select, and it must write
    // onto translatorEngine (the object assignDefault and the Options window read).
    const refreshPanelValues = engineModule.DSLREngine.prototype.refreshPanelValues;
    const renderTarget = {};
    const engine = {
        translatorEngine: renderTarget,
        optionRuntimeModel: { getValue: () => "t.gguf" },
        optionRuntimeModelProfiles: { getValue: () => JSON.stringify({
            "t.gguf": { specMode: "auto", draftId: "forced-draft.gguf", contextLength: 8192, gpuLayers: 12 }
        }) }
    };
    const result = refreshPanelValues.call(engine);
    assert.strictEqual(result.modelId, "t.gguf");
    assert.strictEqual(result.draftId, "forced-draft.gguf");
    assert.strictEqual(renderTarget.rtSpecMode, "forced-draft.gguf");
    assert.strictEqual(renderTarget["rtProfile_contextLength"], "8192");
    assert.strictEqual(renderTarget["rtProfile_gpuLayers"], "12");
    // Off clears the forced id in the rendered value too.
    engine.optionRuntimeModelProfiles.getValue = () => JSON.stringify({ "t.gguf": { specMode: "off", draftId: null } });
    refreshPanelValues.call(engine);
    assert.strictEqual(renderTarget.rtSpecMode, "off");
    // No selected model: nothing written.
    engine.optionRuntimeModel.getValue = () => "";
    assert.strictEqual(refreshPanelValues.call(engine), null);
});
