"use strict";
// Stale-runtime rebuild for the per-model Options panel.
//
// www/core/SLRtrans/lib/Main.js builds the DSLR options form during addon load, but the
// llmRuntime addon (which supplies the model list, detection and model metadata) loads after
// SLRtrans. The first build therefore degrades: the per-field hints lose their model-specific
// sentence and the spec/projector Auto labels come out empty. options.translatorMenu.renderOptions
// now calls the registered engine's onBeforeRenderOptions() before it renders; when the first
// build predates the runtime, that hook rebuilds the form once, with the runtime present.
//
// The decision is extracted into three pure helpers (exported from the wrapper) so both the
// build and the hook reach the same verdict and it can be pinned without a browser.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("module");

const DIR = path.join(__dirname, "..");

// The wrapper pulls in two browser-only modules; the rest resolve normally.
function loadWrapper() {
    const originalLoad = Module._load;
    Module._load = function (request) {
        if (request === "@redsugoi/mtl-text-processor") return {};
        if (request === "./TranslationEngineOption") return { TranslationEngineOption: class {} };
        return originalLoad.apply(this, arguments);
    };
    try {
        return require(path.join(DIR, "DSLRTranslationEngineWrapper.js"));
    } finally {
        Module._load = originalLoad;
    }
}

const wrapper = loadWrapper();
const proto = wrapper.DSLRTranslationEngineWrapper.prototype;
const runtimeIsUsable = wrapper.runtimeIsUsable;
const runtimePanelIsStale = wrapper.runtimePanelIsStale;
const shouldRebuildStaleRuntimePanel = wrapper.shouldRebuildStaleRuntimePanel;

function withWindow(win, fn) {
    const saved = globalThis.window;
    try {
        globalThis.window = win;
        return fn();
    } finally {
        if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
    }
}

test("runtimeIsUsable accepts only a present runtime without a load error", () => {
    assert.strictEqual(runtimeIsUsable(null), false);
    assert.strictEqual(runtimeIsUsable(undefined), false);
    assert.strictEqual(runtimeIsUsable({}), false);
    assert.strictEqual(runtimeIsUsable({ llmRuntime: null }), false);
    assert.strictEqual(runtimeIsUsable({ llmRuntime: {} }), true);
    assert.strictEqual(runtimeIsUsable({ llmRuntime: { selectedModel: () => "m.gguf" } }), true);
    // A module that failed to load exposes loadError; it is not usable.
    assert.strictEqual(runtimeIsUsable({ llmRuntime: { loadError: "boom" } }), false);
    assert.strictEqual(runtimeIsUsable({ llmRuntime: { loadError: 0 } }), true);
});

test("runtimeIsUsable survives a hostile window/llmRuntime getter", () => {
    const win = {};
    Object.defineProperty(win, "llmRuntime", { get() { throw new Error("blocked"); } });
    assert.strictEqual(runtimeIsUsable(win), false);
});

test("runtimePanelIsStale inverts usability, so a missing runtime marks the build stale", () => {
    assert.strictEqual(runtimePanelIsStale(null), true);
    assert.strictEqual(runtimePanelIsStale({}), true);
    assert.strictEqual(runtimePanelIsStale({ llmRuntime: { loadError: "x" } }), true);
    assert.strictEqual(runtimePanelIsStale({ llmRuntime: {} }), false);
});

test("shouldRebuildStaleRuntimePanel rebuilds only a stale build once the runtime exists", () => {
    assert.strictEqual(shouldRebuildStaleRuntimePanel(true, null), false);
    assert.strictEqual(shouldRebuildStaleRuntimePanel(true, {}), false);
    assert.strictEqual(shouldRebuildStaleRuntimePanel(true, { llmRuntime: { loadError: "x" } }), false);
    assert.strictEqual(shouldRebuildStaleRuntimePanel(false, { llmRuntime: {} }), false);
    assert.strictEqual(shouldRebuildStaleRuntimePanel(undefined, { llmRuntime: {} }), false);
    assert.strictEqual(shouldRebuildStaleRuntimePanel(true, { llmRuntime: {} }), true);
});

// A fake engine exposing only what onBeforeRenderOptions touches. _buildOptionsForm mirrors
// the real one: it recomputes the flag from the window (clearing it when the runtime is
// present) and produces a fresh optionsForm whose schema defaults are the factory values.
function fakeEngine(stale, engineValues, schemaDefaults) {
    return {
        _runtimePanelStale: stale,
        buildCalls: 0,
        translatorEngine: Object.assign({ optionsForm: { schema: {} } }, engineValues || {}),
        _buildOptionsForm() {
            this.buildCalls++;
            this._runtimePanelStale = runtimePanelIsStale(globalThis.window);
            const schema = {};
            const defaults = schemaDefaults || {};
            for (const key in defaults) schema[key] = { default: defaults[key] };
            this.translatorEngine.optionsForm = { schema: schema };
        },
        onBeforeRenderOptions: proto.onBeforeRenderOptions
    };
}

test("onBeforeRenderOptions rebuilds exactly once when the first build predates the runtime", () => {
    withWindow({ llmRuntime: { targetModels: () => [] } }, () => {
        const engine = fakeEngine(true);
        engine.onBeforeRenderOptions();
        assert.strictEqual(engine.buildCalls, 1);
        assert.strictEqual(engine._runtimePanelStale, false, "a rebuild with the runtime clears the flag");
        // renderOptions runs on every render; the now-fresh form must not be rebuilt again.
        engine.onBeforeRenderOptions();
        engine.onBeforeRenderOptions();
        assert.strictEqual(engine.buildCalls, 1, "no double build after the first successful one");
    });
});

test("onBeforeRenderOptions re-applies the engine's current values after the rebuild", () => {
    withWindow({ llmRuntime: {} }, () => {
        const engine = fakeEngine(true,
            { runtimeModel: "MiniCPM5-2B-heretic.gguf", endpointCount: 2 },
            { runtimeModel: "", endpointCount: 1, untouched: "keep" });
        engine.onBeforeRenderOptions();
        const schema = engine.translatorEngine.optionsForm.schema;
        // renderOptions already ran assignDefault on the old form; the rebuilt defaults are
        // factory values, so the hook must restore the current values for this first render.
        assert.strictEqual(schema.runtimeModel.default, "MiniCPM5-2B-heretic.gguf");
        assert.strictEqual(schema.endpointCount.default, 2);
        // A key the engine does not expose keeps its built default (assignDefault skips it too).
        assert.strictEqual(schema.untouched.default, "keep");
    });
});

test("onBeforeRenderOptions does nothing while the runtime is still missing", () => {
    withWindow({}, () => {
        const engine = fakeEngine(true);
        engine.onBeforeRenderOptions();
        assert.strictEqual(engine.buildCalls, 0);
        assert.strictEqual(engine._runtimePanelStale, true, "the flag survives so a later render can rebuild");
    });
});

test("onBeforeRenderOptions does nothing when the runtime reported a load error", () => {
    withWindow({ llmRuntime: { loadError: "incomplete copy" } }, () => {
        const engine = fakeEngine(true);
        engine.onBeforeRenderOptions();
        assert.strictEqual(engine.buildCalls, 0);
        assert.strictEqual(engine._runtimePanelStale, true);
    });
});

test("onBeforeRenderOptions never throws, even if the rebuild does", () => {
    withWindow({ llmRuntime: {} }, () => {
        const engine = fakeEngine(true);
        engine._buildOptionsForm = () => { throw new Error("jsonform exploded"); };
        assert.doesNotThrow(() => engine.onBeforeRenderOptions());
    });
});

test("options.translatorMenu.renderOptions calls the hook without changing the render path", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "js", "options.js"), "utf8");
    const assign = src.indexOf("options.translatorMenu.assignDefault(thisTranslator);");
    const hook = src.indexOf("onBeforeRenderOptions");
    const render = src.indexOf("$elm.jsonForm(thisTranslator.optionsForm)");
    assert.ok(assign !== -1 && hook !== -1 && render !== -1, "the renderOptions anchors must exist");
    assert.ok(assign < hook && hook < render, "the hook must sit between assignDefault and jsonForm");
    assert.match(src, /typeof thisTranslator\.onBeforeRenderOptions === "function"/);
});
