"use strict";
// Every `this._method()` the engine calls must exist somewhere. The engine is mixed with the
// wrapper - endpoint helpers such as _markEndpoint429 and _groupByUrl live there and are called
// defensively behind a typeof check - so both sources are checked.
//
// This catches a helper being deleted while a call site survives, which is exactly how
// _qwenNoThinkActive went missing: the thinking-control consolidation removed the helper (and
// the option that gated it) but two response-cleanup call sites remained, so translation failed
// at runtime with "this._qwenNoThinkActive is not a function". A static check like this is the
// only thing that catches it, because the call sits inside a streaming handler that no unit
// test exercises.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const DIR = path.join(__dirname, "..");

function loadEnginePrototype() {
    const originalLoad = Module._load;
    Module._load = function (request) {
        if (request === "./TranslationEngineOption") return { TranslationEngineOption: class {} };
        if (request === "./DSLRTranslationEngineWrapper") {
            return { DSLRTranslationEngineWrapper: class {}, TranslationEngineOptionCategories: { OPTIONS: "options" } };
        }
        return originalLoad.apply(this, arguments);
    };
    const savedWindow = globalThis.window;
    const savedStorage = globalThis.localStorage;
    globalThis.window = globalThis.window || {};
    // The engine reads localStorage at module scope.
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    try {
        return require(path.join(DIR, "DSLREngine.js")).DSLREngine.prototype;
    } finally {
        Module._load = originalLoad;
        if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
        if (savedStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = savedStorage;
    }
}

function methodsCalledByEngine() {
    const src = fs.readFileSync(path.join(DIR, "DSLREngine.js"), "utf8");
    return Array.from(new Set(Array.from(src.matchAll(/this\.(_[A-Za-z0-9_]+)\s*\(/g), (m) => m[1])));
}

function methodsProvidedByWrapper() {
    const src = fs.readFileSync(path.join(DIR, "DSLRTranslationEngineWrapper.js"), "utf8");
    return new Set(Array.from(src.matchAll(/^\s{4}(_[A-Za-z0-9_]+)\s*\(/gm), (m) => m[1]));
}

test("every this._ method the engine calls is defined on the engine or the wrapper", () => {
    const proto = loadEnginePrototype();
    const wrapperMethods = methodsProvidedByWrapper();
    const unresolved = methodsCalledByEngine()
        .filter((name) => typeof proto[name] !== "function" && !wrapperMethods.has(name))
        .sort();
    assert.deepStrictEqual(unresolved, [],
        "these methods are called but defined nowhere, so they would throw at runtime: " + unresolved.join(", "));
});

test("the check would notice a deleted helper", () => {
    // Guards the check itself: a name that is called but defined nowhere must be reported.
    const proto = loadEnginePrototype();
    const wrapperMethods = methodsProvidedByWrapper();
    const fakeCall = "_aMethodThatDoesNotExistAnywhere";
    const unresolved = [fakeCall].filter((name) => typeof proto[name] !== "function" && !wrapperMethods.has(name));
    assert.deepStrictEqual(unresolved, [fakeCall]);
});
